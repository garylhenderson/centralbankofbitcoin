## R1 — SEAL confinement rewrite

### MEDIUM — compute budget regression is unmeasured and can make otherwise valid redemptions fail

**Construct:** `open_for_redemption` now loops from instruction `0` until `load_instruction_at_checked` fails, deserializing every top-level instruction even after it has found its matching burn.

```rust
let mut i = 0usize;
while let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
    ...
    i += 1;
}
```

**Impact:** Redemption already has a measured packet-size margin of only 113 bytes at three reserve mints. The packet limit and compute-unit limit are independent. A transaction can fit in 1,232 bytes but exceed the default CU budget after adding sysvar deserialization for every top-level instruction, including Compute Budget and sweep-related instructions. This turns a redemption into an unexplained runtime failure and can strand a customer until they rebuild the transaction with an explicit CU limit.

This is not presently demonstrated as an exploit or confirmed failure. It is a missing measurement on the newly expanded hot path.

**Evidence if true:** A local-validator test should:
1. Build the measured worst-case 3-reserve redemption.
2. Add the maximum legitimate top-level instruction shape expected in production.
3. Simulate and record `unitsConsumed`.
4. Execute it with the default CU limit and with a deliberately low/known limit.
5. Assert sufficient headroom, not merely success today.

**Fix:** Add a measured CU ceiling test alongside 9.14/9.14a. Either bound permitted transaction instruction count, require an explicit ComputeBudget limit in the redemption client, or demonstrate and retain a conservative CU margin.

---

### LOW — several comments now state the inverse of the deployed confinement behavior

The new code scans all top-level instructions. Multiple comments still say it only scans forward until the burn and never sees the rest.

Examples:

- `bank/cosign.mjs` header:

> "`open_for_redemption` walks the instruction sysvar forward only as far as its matching `burn_vault` and never enumerates the rest"

- SEAL module header:

> “The forward scan below stops at the matching burn; it never enumerates the rest.”

- `SPEC.md`:

> “The programs do NOT bound what else a redemption transaction contains: `open_for_redemption` walks the instruction sysvar forward only far enough to find its matching `burn_vault`, and never enumerates the rest.”

**Impact:** These understate the on-chain guarantee that was just added. A customer reading the documentation is told that the Bank-key confinement remains policy-only when it is actually enforced for top-level instruction account metas. This is the same under-claim category that motivated the new control-table work.

**Evidence:** The deployed Rust walk begins at `0`, never breaks, and applies `BankKeyOutsidePair` to every non-exempt top-level instruction.

**Fix:** Replace these statements with the exact residual limitation:

- SEAL now confines `config.bank` in **top-level instruction account lists**.
- It does not see the transaction fee payer.
- It does not apply a program allowlist.
- Approved pair instructions are exempt as complete instructions, including their payer accounts.

---

### No finding: discriminator-only exemption is not independently exploitable as described

A malformed instruction carrying the open or burn discriminator is exempt from confinement, but it is still dispatched to the real SEAL or BURN program. If malformed, it fails; because the transaction is atomic, it cannot both perform another action and leave the redemption committed. A foreign program cannot claim the exemption because `program_id` is checked too.

Likewise, a burn that executes must have a preceding top-level SEAL open under BURN’s current logic; that open performs the full confinement scan. A CPI does not create a bypass because the instruction sysvar exposes outer instructions, and a foreign outer instruction carrying the Bank account is itself rejected by the open’s scan.

This conclusion should be retained only with an end-to-end test for:
- a malformed discriminator-prefixed SEAL instruction containing Bank;
- a malformed discriminator-prefixed BURN instruction containing Bank;
- a burn reached by CPI;
- an open reached by CPI.

The present tests do not directly prove all four cases.

---

## R2 — weighted distribution and cadence

### HIGH — any user can cheaply halt all distributions by activating an unregistered vault

**Construct:**

```js
const unlevelled = activated.filter(v => !LEVEL_WEIGHTS[levels[v]])
if (unlevelled.length) return {
  ...empty,
  skip: `${unlevelled.length} activated vault(s) carry no level ...`
}
```

An activated vault is merely one whose cbBTC ATA balance is at least 21,000 sats:

```js
.filter(([, b]) => BigInt(b) >= ACTIVATION_SATS)
```

There is no on-chain registration or assignment check tying activation to a level-record entry.

**Impact:** An attacker can create or acquire a vault not present in `levels.json`, create/fund its PDA-owned cbBTC ATA, and deposit 21,000 sats. The next distribution sees an activated vault with no level and refuses the entire payout. No Bank signature, level-file write access, or ownership of another customer’s vault is necessary.

Depending on the operational mint flow, a newly minted but not-yet-assigned vault may cause the same outage accidentally.

This is a global denial of service over every holder’s cbBTC distribution, at approximately the activation threshold plus ATA/rent/transaction costs.

**Evidence if true:** On a validator or staging environment:
1. Mint a vault absent from `levels.json`.
2. Create its cbBTC ATA for the asset-signer PDA.
3. Transfer 21,000 sats into it.
4. Run distribution.
5. Observe `allocateWeighted` return the “activated vault(s) carry no level” skip and no vault receive payment.

**Fix:** Do not let a publicly observable balance threshold alone create a global data-integrity dependency. Options include:
- assign and durably record the level before the vault can become distribution-eligible;
- make activation an authenticated/off-chain enrollment state with an immutable assignment record;
- quarantine unlevelled activated vaults and alarm them while preserving the prior settlement set, if the business accepts that policy;
- most importantly, explicitly decide whether a hostile third party may activate a vault by depositing into its PDA.

A hard global stop is defensible for operator-data corruption, but not for a condition any stranger can manufacture.

---

### HIGH — `holdDays()` treats attempted, skipped, rejected, and ambiguous transfers as “actually paid”

**Construct:**

```js
const paid = days.filter(d => Object.keys(st.days[d]?.paid || {}).length > 0).sort()
```

The comment says:

> “The last day this ledger actually paid somebody”

But `paid` is populated before the send:

```js
done[v] = { amount: String(plan.per[v]), sig: null, sentAt: ... }
save(st)
```

It also retains rows for:
- rejected sends;
- ambiguous sends;
- vaults skipped because the asset was burned.

None proves a customer was paid.

**Impact:** A forced 31-day payout can fail for every recipient, yet the following day’s cadence anchor moves forward because the ledger has nonempty `paid`. The system can then hold for another 31 days instead of treating the unpaid forced distribution as unresolved. Since retries are only made for the current day’s `done` rows, old rejected rows are not automatically retried on later days.

This can indefinitely delay a holder’s distribution and can allow subsequent drops to be allocated without first curing an earlier failed forced drop.

**Evidence if true:** Add this test, which should currently fail:

```js
holdDays({
  days: {
    '2026-08-01': {
      paid: {
        vault: { amount: '1', sig: null, rejected: true }
      }
    }
  }
}, '2026-08-02')
// Expected: anchor should not be 2026-08-01 as a successful payout.
```

Also test `skipped` and an intent-only ambiguous row.

**Fix:** Define a successful-payout predicate and use it in `holdDays`, for example only rows with a transaction signature confirmed as valid, or a human `resolvedBy` value explicitly stating payment was made. Do not use the presence of a ledger row as proof of payment.

Separately, decide and implement how failed prior-day allocations are retried or carried forward before later-day distributions proceed.

---

### MEDIUM — the level register has unrestricted payout-authority semantics without integrity controls

**Construct:**

```js
const LEVELS_FILE = process.env.CBOB_LEVELS || '/opt/cbob-vaults/bank/levels.json'
...
const raw = JSON.parse(fs.readFileSync(LEVELS_FILE, 'utf8'))
```

The file determines every activated vault’s weight. There is no mode/owner validation, signature, append-only history, immutable settlement snapshot, commitment, or comparison to a prior register.

**Impact:** Anyone able to alter `levels.json`, or to control `CBOB_LEVELS` in the cron environment, can:
- promote selected vaults to V;
- demote others to I;
- omit one activated vault and halt all payments;
- change historical assignments immediately before a settlement;
- produce a payout plan whose census and denominator are arithmetically correct but economically fraudulent.

The stated absence of a commitment scheme captures unverifiable “fate,” but understates the operational blast radius: this file is not merely a record of fate; it is the live authorization input for every payout.

**Evidence if true:** Change one activated vault from I to V in a copy of the register and rerun `allocateWeighted`; the recipient’s allocation changes without any on-chain event or customer-verifiable authorization.

**Fix:** Before live use:
- lock down ownership and permissions of the register and cron environment;
- reject symlinks and validate ownership/mode;
- publish a signed, versioned assignment manifest;
- snapshot the manifest hash into each settlement plan;
- require a commit-before-activation/reveal-after-assignment process if “assigned by fate” is a customer claim;
- retain an append-only history so an altered historical assignment is detectable.

---

### MEDIUM — dust is not attributable and can be diluted by a changed activated set

**Construct:** Dust remains in the distributor pool and is included in the next `available` amount:

```js
dust: available - total
```

The next distribution computes weights against the then-current activated set.

**Impact:** A holder whose share generated part of a prior settlement’s dust has no claim on that dust. New activations before the next settlement participate in it. Therefore a holder can receive less than they would have under a same-day largest-remainder allocation, not merely later.

This does not violate integer arithmetic and does not over-distribute. It is a product/equity consequence of “dust carries” combined with a changing membership set.

**Evidence if true:** Use a drop with nonzero dust, then add a newly activated vault before the next drop. Compare the original holder’s cumulative amount against the counterfactual where dust was allocated in the first settlement.

**Fix:** Either state that dust becomes part of the next collective pool under the then-current census, or track dust by settlement/census if the intended promise is that it belongs to the holders who generated it.

---

### LOW — resume output lies about total and dust

A resumed plan reconstructs `activated`, `per`, `census`, and `denominator`, but not `total` or `dust`:

```js
plan = {
  activated: ...,
  per: ...,
  census: ...,
  denominator: ...,
  skip: null
}
```

The final log then prints:

```js
${String(plan.total ?? '')} sats out, dust ${String(plan.dust ?? 0n)}
```

**Impact:** A resumed settlement reports blank total and zero dust even if the fixed plan had dust. This weakens reconciliation and the published-settlement claim.

**Evidence:** Crash after writing a non-divisible plan, resume, and inspect the final log.

**Fix:** Persist and restore `total` and `dust`, or recompute them from the persisted `per` map and persisted `available`.

---

### Arithmetic review

The published arithmetic is correct:

- 240 census denominator:  
  `108×2 + 60×3 + 36×4 + 24×5 + 12×6 = 732`.

- 2,100 census denominator:  
  `945×2 + 525×3 + 315×4 + 210×5 + 105×6 = 6,405`.

- Level V / Level I per-vault ratio: `6 / 2 = 3`.

- 2,100-vault aggregate shares are approximately:
  - I: 29.5%
  - II: 24.6%
  - III: 19.7%
  - IV: 16.4%
  - V: 9.8%
  - Total: 100.0% after displayed rounding.

No arithmetic finding on the customer-card figures.

---

## R3 — `scripts/bank-sign.sh`

### HIGH — invoking the wrapper through a symlink can execute an attacker-controlled co-signer

**Construct:**

```bash
cd "$(dirname "$0")/.."
exec /usr/bin/env node bank/cosign.mjs --tx "$TX" ...
```

`dirname "$0"` is not canonicalized. It is the path by which the shell invoked the script, not necessarily the trusted repository containing the script.

**Attack:** An attacker creates:

```text
/tmp/evil/scripts/bank-sign.sh -> /opt/cbob-vaults/scripts/bank-sign.sh
/tmp/evil/bank/cosign.mjs       # attacker-controlled
```

Then convinces an operator to run:

```bash
/tmp/evil/scripts/bank-sign.sh tx.b64 --live
```

The wrapper reads the requested transaction correctly, then changes directory to `/tmp/evil` and executes `/tmp/evil/bank/cosign.mjs`. That process runs in the Bank-signing environment and can read the Bank key or exfiltrate it.

The fact that the script contains no key does not help once it launches attacker-selected Node code before the legitimate co-signer is reached.

**Evidence if true:** Build the harmless directory layout above with an attacker `bank/cosign.mjs` that prints `process.cwd()`. The wrapper will execute that file rather than `/opt/cbob-vaults/bank/cosign.mjs`.

**Fix:** Resolve the real path of the wrapper before deriving the repository root, for example with `readlink -f`/`realpath`, and use an absolute, fixed trusted path:

```bash
SCRIPT="$(readlink -f -- "$0")"
ROOT="$(cd "$(dirname -- "$SCRIPT")/.." && pwd -P)"
exec /usr/bin/env node "$ROOT/bank/cosign.mjs" --tx "$TX" ...
```

Also reject unexpected ownership/mode of the resolved script and target source tree if this is a real signing boundary.

---

### MEDIUM — the base64 filter is not a canonical base64 validator

**Construct:**

```bash
case "$TX" in
  *[!A-Za-z0-9+/=]*) ... ;;
esac
```

This only checks alphabet membership. It accepts invalid padding and `=` in arbitrary positions. Node’s base64 decoder is permissive.

**Impact:** The wrapper claims that it rejects any input that Node would silently decode differently. That is false for alphabet-valid malformed forms such as embedded/excess padding. An input can be accepted by the shell and decoded by `Buffer.from(..., 'base64')` as a prefix or altered byte sequence.

This matters because the operator may believe they approved the textual file while Node signs a decoded transaction different from the text’s apparent base64 structure.

**Evidence if true:** Test malformed inputs such as:

```text
AAAA=BBBB
A=AA
====
```

against the installed Node version and compare `Buffer.from(input, 'base64')` with canonical re-encoding. At least some accepted malformed forms will not round-trip.

**Fix:** Decode then require canonical round-trip encoding, with an explicit policy for optional omitted trailing padding. For example, normalize only permitted terminal padding and require:

```js
Buffer.from(tx, 'base64').toString('base64') === canonicalInput
```

Do this in Node immediately before `Transaction.from`, not only in shell.

---

### LOW — file check/read remains TOCTOU and accepts symlinks

**Construct:**

```bash
[ -f "$SRC" ] || ...
RAW=$(cat -- "$SRC")
```

**Impact:** Between the type check and read, a local attacker with directory write access can replace the file with a different regular file or a blocking object. This is primarily a local availability/integrity problem. Symlinks are accepted because `-f` follows them.

**Evidence if true:** Replace the path after the `-f` check under an instrumented shell or test harness; `cat` reads replacement bytes.

**Fix:** Open once through a safer helper, reject symlinks if that is the policy, use a bounded regular-file read, and record a hash of bytes read before invoking Node. This does not eliminate a hostile operator environment, but it removes the simple check-then-read gap.

---

## R4 — gates written this round

### MEDIUM — the ON-CHAIN control-table gate proves source-text co-occurrence, not a Bank 2-of-2 property

**Construct:**

```js
return /pub bank: Signer<'info>/.test(src)
  && /require_keys_eq!\(\s*ctx\.accounts\.bank\.key\(\),/.test(src)
```

**Impact:** A program passes if it contains those two text fragments anywhere, including in unrelated instructions. For example, a program can have:
- one handler with `pub bank: Signer<'info>` but no equality check;
- another handler with an equality check that does not protect redemption;
- a dead helper or unreachable code containing the expected text.

The table would then certify the program as enforcing the 2-of-2 even if the actual redemption path accepted any signer or did not use the check.

**Evidence if true:** Construct a synthetic Rust source containing the two patterns in separate account structs/handlers. `onChainBankPin` returns true.

**Fix:** Do not use source regex as proof of an authorization invariant. Add behavioral validator tests for each protected instruction:
- correct Bank succeeds;
- wrong signer fails;
- correct signer absent fails;
- account substitution fails;
- failure occurs for `NotTheBank`, not an incidental reason.

The current end-to-end suite does some of this for SEAL/BURN, which is stronger than this parser. The table gate should rely on those explicit test identifiers or a structured source analysis, not text fragments.

---

### MEDIUM — the signer-set scanner is materially bypassable

**Construct:**

```js
const sigPat = new RegExp(['from', 'Secret', 'Key'].join(''))
...
srcFiles = [
  ...readdirSync(bank).filter(.mjs),
  ...readdirSync(scripts).filter(.mjs || .sh),
  ...readdirSync(tests).filter(.ts),
]
```

**Impact:** This neither covers the whole repository nor detects all signing mechanisms. It misses, among other possibilities:

- nested source directories;
- `.js`, `.cjs`, `.mts`, `.cts`, Rust, Python, binaries, generated files, dependencies, and external commands;
- `Keypair.fromSeed`;
- a dynamically assembled constructor/property name;
- a signer passed in from another module;
- a hardware wallet, `solana` CLI, RPC signer service, or remote signer;
- direct Ed25519 signing without `Keypair.fromSecretKey`.

The assertion’s wording — “exactly THREE signers exist, each holding a different key” — is much stronger than the mechanism.

**Evidence if true:** Add a file in a nested directory using `Keypair.fromSeed`, or a shell wrapper invoking `solana transfer`/a signing service. It is outside `srcFiles` and/or does not match `sigPat`.

**Fix:** Narrow the claim. A repository grep cannot establish the global signer set. Enforce the actual security property through key custody:
- Bank key in a non-exportable HSM/remote signer;
- signer policy enforced by that signer;
- audited request logging;
- explicit allowlisted client identity;
- deny arbitrary host processes access to raw private-key bytes.

---

### LOW — the parser is fail-closed for some malformed rows but not all semantic omissions

The parser rejects rows it cannot classify by returning `NO FILE NAMED` or `NO PROGRAM NAMED`. That is fail-closed for the specific syntax it recognizes. However, it only sees rows matching:

```js
/^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/
```

A control-table row reformatted enough not to match is silently omitted from `rows`; the only protection is the expected count `4`.

**Impact:** A future edit can replace one classified row with an unclassified prose row and preserve four unrelated matching rows, or alter table layout so the parser’s count/checks no longer correspond to the human-visible controls.

**Fix:** Parse the bounded table section structurally, assert exact control names and exact row identities, and reject unexpected/unparsed table rows within that section.

---

## R5 — comment defects

### LOW — stale false claims about the old SEAL scan

The following comments describe the old behavior and are now false:

1. `bank/cosign.mjs` header: claims SEAL “walks … forward only” and “never enumerates the rest.”
2. SEAL top-level module comment: claims the forward scan “stops at the matching burn” and “never enumerates the rest.”
3. `SPEC.md` control-table discussion: claims programs “do NOT bound what else” and only scan until burn.
4. `SPEC.md` later repeats that the allowlist and confinement “rest entirely” off-chain because SEAL never enumerates the rest.

These should be corrected in both directions: the on-chain confinement is real, but it covers only Bank account metas in top-level instructions and leaves fee payer/program allowlisting/pair-internal payer uses outside that guarantee.

---

### LOW — stale lock “impossibility theorem” remains in shipped comments

`scripts/cron-install.sh` still says:

> “a pathname lock cannot compare-and-swap”  
> “No arrangement of rename, link and unlink closes that”

`bank/detectors.mjs`’s `judgeCronTemplate` header retains the same premise.

Round 16’s own verdict correctly states that `link()` is atomic CAS for absent-to-mine and that the lock design was changed around that fact. These comments now preserve the disproven theorem as a rationale for `flock`.

**Impact:** Future maintainers may make decisions based on a false statement about the in-process lock’s primitive and the reason for the dual-lock design.

**Fix:** Replace with the narrower true claim: `flock` provides kernel-managed process-lifetime exclusion for unattended cron jobs; the generation-record lock separately protects in-process/manual invocations and must not rely on deleting a contended pathname.

---

## R6 — published schedule arithmetic

No finding. The listed denominators, per-$1,000 figures, ratios, and displayed aggregate percentages derive correctly from the stated census and weights.

---

## Carry-over limits that are worse than stated

### HIGH — malformed ProgramData authority tags are still reported as `IMMUTABLE` in production

**Construct:** `bank/detectors.mjs` correctly repaired `readProgramData` to reject tags other than 0 or 1. But `bank/alarm.mjs` does not use it:

```js
const hasAuth = acc.data[12] === 1
snap[`prog.${name}.upgrade_authority`] = hasAuth
  ? new PublicKey(acc.data.subarray(13, 45)).toBase58()
  : 'IMMUTABLE'
```

**Impact:** A ProgramData account with an invalid tag, RPC-corrupted data, or a changed loader layout is still rendered as `IMMUTABLE` by the production alarm. This is exactly the false-confidence defect the new shared helper was written to repair, but the repair landed in a non-production helper while the live reader retained the old behavior.

**Evidence if true:** Feed a synthetic ProgramData buffer with `data[12] = 7` through the equivalent `alarm.mjs` branch. It emits `IMMUTABLE`; `D.readProgramData` returns `problem`.

**Fix:** Make `alarm.mjs` call `D.readProgramData(acc.data)` and abort/report a malformed ProgramData account instead of deriving an authority/hash from it. Add a test that reaches the actual production reader path, not only the helper.

---

### MEDIUM — `Anchor.toml` has no toolchain pin and points generic Anchor operations at mainnet

**Construct:**

```toml
[toolchain]

[provider]
cluster = "mainnet"
wallet = "~/.config/solana/id.json"
```

**Impact:** The repository’s build/test scripts use explicit toolchain and local-validator controls, but generic `anchor` commands inherit a mainnet cluster and a local default wallet. A developer using `anchor deploy`, `anchor upgrade`, or other provider-bound commands can target mainnet unintentionally with whichever local key is configured.

The empty `[toolchain]` also leaves Anchor CLI/version resolution outside the repository configuration, despite ABI/toolchain sensitivity elsewhere.

**Evidence if true:** Run `anchor config` / inspect resolved Anchor provider configuration on a deployment host. It will report mainnet and the default wallet unless overridden.

**Fix:** Remove mainnet as the default development provider, pin the Anchor toolchain version, and require explicit deployment scripts with expected program IDs, expected upgrade authority, clean-tree checks, artifact hashes, and an interactive/mainnet-specific confirmation barrier.

---

## Verdict challenges

1. **The claim that SEAL confinement closes the original Bank-account-meta theft is supported by the code.** A top-level `SystemProgram.transfer(from=BANK, ...)` is non-exempt and is rejected before thaw. I do not find a working discriminator-prefix bypass that can commit a different operation.

2. **The claim that BURN needs no duplicate confinement check is currently true only because BURN’s preceding-open requirement remains intact.** This is a cross-program dependency, not a local BURN invariant. Keep a direct test that attempts every plausible burn/CPI ordering, and treat any relaxation of `NoPrecedingOpen` as requiring a BURN-side confinement implementation.

3. **The stated fee-payer gap is exploitable if the Bank signs outside the sanctioned policy path.** A transaction with Bank as fee payer and a priority-fee instruction spends Bank SOL without listing Bank in an instruction account list. The on-chain SEAL scan cannot see it. `cosign.mjs` rejects it, but raw-key signing bypasses that policy. This is correctly listed as an accepted limit, not a newly discovered mechanism.

4. **The allowlist gap is also real but does not recreate the original Bank-account-meta theft once SEAL confinement runs.** A permitted or foreign instruction not naming Bank can still occur; it can harm the owner’s own redemption, not directly exercise Bank authority. The known “second bare Core burn” case remains relevant.

---

## Anything else

### MEDIUM — the documented distribution mode is still described as equal-per-vault in operational output

`scripts/cron-install.sh` prints:

> “distribute daily cbBTC to ACTIVATED vaults only (>= 21,000 sats), equal per vault”

The allocator is now weighted by level. This is a customer-money operational document asserting the wrong distribution rule.

**Evidence:** Run `scripts/cron-install.sh` and inspect its final “WHAT EACH LINE IS FOR” output.

**Fix:** Change it to weighted distribution according to the current level census and denominator.

---

## Given that no human firm will ever see this, what should this project do that sixteen rounds of AI audit structurally cannot?

1. **Move the Bank key out of a filesystem-readable JSON file.** Use a remote signer/HSM with a narrow redemption-signing API, mandatory request logging, transaction-byte retention, and approval policy enforced where the private key lives. Repository grep cannot secure a raw private key available to arbitrary host code.

2. **Run adversarial operational drills, not only unit tests.** Perform rehearsed incidents on an isolated environment:
   - Bank key signing request with malicious fee payer;
   - symlinked wrapper invocation;
   - corrupted/missing level register;
   - unregistered activated vault DoS;
   - crash after plan persistence, before and after transfer;
   - failed/ambiguous forced distribution;
   - reboot during every cron job;
   - DAS malformed response and RPC partial outage.

3. **Obtain independent execution traces from a separate environment.** A second machine/operator should reproduce build hashes, validator tests, redemption CU measurements, and distribution plans from clean checkout and independently acquired dependencies. This is not a human code audit; it is an independent reproducibility and operational-control check.

4. **Create a real settlement audit trail.** Every payout should publish a signed plan containing vault IDs, level-manifest hash, census, denominator, per-vault amounts, total, dust, source balance, and transaction signatures. Customers need enough data to independently verify both their own payment and the aggregate allocation.

5. **Treat the level system as financial authorization, not game metadata.** Before customers rely on it, implement a committed assignment process and immutable settlement snapshots. Without that, the same operator controls assignment, the live record, and the payment calculation.

6. **Measure production constraints on production-shaped transactions.** Packet-size testing is not sufficient. Establish CU, fee, confirmation-time, RPC-rate, and 2,100-recipient payout duration limits with recorded benchmarks and alert thresholds.