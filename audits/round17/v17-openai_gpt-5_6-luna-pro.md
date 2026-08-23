# Audit findings

## R1 — SEAL’s on-chain confinement rewrite

### HIGH — The confinement check exempts malformed discriminator-bearing instructions

**Construct:** `open_for_redemption` determines exemptions using only:

```rust
ix.program_id
ix.data.len() >= 8
ix.data[..8] == discriminator
```

It does not validate the account count, account positions, instruction argument layout, or whether the instruction is a valid invocation of the intended handler before exempting it from Bank-key confinement.

A top-level instruction to SEAL or BURN carrying the correct first eight bytes but malformed or adversarial trailing data is therefore exempt from the Bank-key scan. The author’s statement that “every such instruction is independently half of a redemption” is too strong: the scan has not established that.

This may be a denial-of-service rather than a theft route for the current handlers, because the malformed instruction will normally fail when dispatched. It is nevertheless a dangerous future-proofing failure: a later handler change could make a discriminator-bearing shape perform additional behavior while remaining automatically exempt.

**Evidence if true:** A transaction containing:

1. a valid `open_for_redemption`,
2. a malformed top-level SEAL or BURN instruction with the corresponding discriminator and the Bank key in an otherwise arbitrary account position,
3. a valid matching burn,

would pass the confinement phase and fail only later, or succeed if the malformed shape is accepted by a future handler. A regression test should assert that malformed exempt instructions are rejected specifically by a validation error before they can receive the exemption.

**Fix:** Validate exempt instructions structurally before exemption:

- exact program ID,
- exact discriminator,
- exact expected data length,
- exact minimum and maximum account count,
- required account positions and Bank position,
- matching asset/owner where applicable.

Better still, do not use “discriminator means trusted instruction” as the security boundary. Require the instruction to be a syntactically valid pair member and reject every malformed shape.

### MEDIUM — The new loop’s CU cost is unmeasured and may be below the measured byte ceiling

**Construct:** The old scan stopped after finding the matching burn. The new scan starts at index zero and deserializes every top-level instruction through the end of the transaction.

The project has measured transaction bytes but no compute-unit budget. The 1,119-byte three-reserve redemption measurement does not establish that the transaction fits the default or configured CU limit after the full scan, multiple Core CPIs, token transfers, ATA operations, and BURN’s own scans.

**Evidence if true:** A real validator run of the maximum-size redemption with `ComputeBudgetInstruction::set_compute_unit_limit` varied downward would show failure at a CU limit below the advertised transaction shape. The transaction would fail with a compute-budget exhaustion error despite fitting under 1,232 bytes.

**Fix:** Add a CU benchmark for:

- one, two, and three reserve mints,
- empty and fully funded vaults,
- lamport sweep,
- destination ATA creation,
- multiple top-level instructions,
- maximum declared accounts.

Set an explicit CU limit or reduce the scan cost. Do not claim the byte ceiling is the only practical ceiling.

### LOW — The allowlist rationale is incomplete as a protection claim

The confinement check protects the Bank key, but it does not constrain instructions that do not mention the Bank. The author acknowledges this as policy, but some comments still describe the on-chain confinement as closing the harm generally.

**Concrete transaction:** A customer can include an arbitrary instruction to an allowed program, such as System, Token, Token-2022, ATA, or Core, which moves the customer’s own or another permitted account without naming the Bank. The Bank-key theft is stopped, but the transaction is not a full redemption grammar.

**Fix:** Keep the narrower claim: the on-chain check protects the Bank key only. If the intended guarantee is “the Bank signs only the intended redemption,” implement a complete on-chain redemption grammar or make the policy tool mandatory through custody.

### R1 dependency check

The claim that BURN does not need its own confinement copy is currently true for successful `burn_vault` executions: BURN requires a preceding top-level SEAL open, and that SEAL instruction scans the transaction. A CPI-hidden open cannot satisfy BURN, because the instruction sysvar reports the outer instruction index and BURN only inspects earlier top-level instructions.

However, this is a brittle cross-program dependency. The suite tests today’s behavior, not preservation of the dependency under upgrades. BURN should either retain an explicit assertion that the preceding open must be a valid, fully formed SEAL instruction or duplicate the Bank-confinement invariant.

---

## R2 — Weighted distribution and cadence

### CRITICAL — The on-chain distribution amount is not actually “carried forward” as a stable pool allocation

**Construct:** `allocateWeighted` computes each amount from the entire current `available` balance:

```js
available * weight / denominator
```

The leftover remains in the distributor ATA, so ordinary dust does remain physically available. However, the next drop recalculates all shares against the new activated set and new denominator. The system does not preserve per-vault entitlement across changes in the activated set.

If the activated set changes between drops, the carried dust and accumulated pool are redistributed under a new denominator. A vault can receive less than it would have received had the prior pool been split before the set change, even though the code describes the pool as “the holders’” and the cadence as a stable schedule.

This is not an arithmetic over-distribution bug: with nonnegative weights and flooring, `total <= available` holds. It is an economic semantics defect in the “dust carries” rule.

**Evidence if true:** Use two drops with the same total pool but different activated sets:

- Drop 1: activated set `{A, B}`, both Level I.
- Hold the dust rather than distribute it.
- Before Drop 2, activate Level V vault `C`, or deactivate `B`.
- Compare each holder’s cumulative amount with a model that carried individual entitlements or split the previous pool before the set changed.

The outputs differ. The current implementation gives the new set control over previously accumulated dust.

**Fix:** Specify one of these explicitly and test it:

1. dust belongs to the next settlement and is allocated entirely using the next census;
2. dust is allocated according to the census that generated it;
3. maintain per-vault accrual balances.

The customer-facing documentation must not imply stronger continuity than the implementation provides.

### HIGH — A fixed resume plan can attempt payments that no longer fit the source balance

**Construct:** On resume, the job reconstructs the saved `per` map and skips the cadence gate:

```js
plan = { ... saved per ... }
```

It does not verify that the distributor still holds enough cbBTC to pay the remaining plan. If the distributor balance is reduced between plan creation and resume—through key compromise, an unauthorized token transfer, an administrator mistake, or another process—the job proceeds with stale amounts. It will generate rejected or ambiguous transfers, potentially leaving some rows unresolved and halting later retries.

**Evidence if true:** Save a plan for three vaults requiring 100 sats each, externally transfer 150 sats out of the distributor ATA, then resume. The first transfer may succeed and later transfers fail. The ledger records a fixed plan but no atomic reservation of the source balance.

**Fix:** Treat the plan as a reservation:

- record the source token-account identity and planned available balance;
- re-read the source on resume;
- refuse before sending if the remaining balance is below the remaining plan total;
- distinguish a balance shortfall from an individual destination failure;
- consider a dedicated distribution escrow or on-chain settlement record.

### MEDIUM — `holdDays()` accepts malformed or non-ISO ledger keys and can produce `NaN`

**Construct:**

```js
const days = Object.keys(st?.days || {}).filter(d => d < day)
...
Math.max(0, dayDiff(anchor, day))
```

The function relies on lexical ordering and `Date.parse()` of arbitrary strings. A malformed key, such as `"2026-99-99"` or `"yesterday"`, can become the anchor. `dayDiff()` then returns `NaN`; `Math.max(0, NaN)` is `NaN`. That value makes all cadence comparisons false:

```js
daysSinceLastPayout >= maxHoldDays
```

A pool can therefore remain below threshold indefinitely without being forced at the 31-day ceiling.

**Evidence if true:** Call:

```js
holdDays({
  days: {
    "2026-01-01": { paid: {} },
    "not-a-date": { paid: {} }
  }
}, "2026-02-01")
```

and observe `NaN`. A subsequent `decideEmission` with that value never takes the forced branch.

**Fix:** Validate every ledger key against a strict UTC `YYYY-MM-DD` parser before using it. Abort on malformed keys. Use numeric date ordering, not string ordering.

### MEDIUM — The “smallest holder” claim is false when no Level I vault is active

**Construct:** The comments repeatedly describe `smallestPer` as “a Level I share.” The implementation correctly computes the minimum actual assigned share, which may be Level II, III, IV, or V if no Level I vault is activated.

The cadence threshold is therefore not a fixed Level I guarantee. A pool containing only Level V holders can distribute at a much lower total pool size than the documentation’s “smallest Level I holder” explanation suggests.

**Evidence if true:** With one activated Level V vault and `available = 7`, `denominator = 6`, the vault receives 7 sats and clears the 21-sat threshold only at 21 sats. With no Level I vault, no Level I amount exists to judge.

**Fix:** Document the actual rule as “the lowest amount among currently activated vaults.” If the intended threshold is always based on a hypothetical Level I holder, calculate that explicitly and test it.

### MEDIUM — The level register can be rewritten without an integrity or ownership control

This is more serious than merely being “off-chain.” `loadLevels()` validates syntax and level names, but does not authenticate the file, pin a version, verify ownership, or require a review signature. The same operational domain writes the register and controls the distribution key.

A writer can change a customer from Level I to Level V immediately before a run, or vice versa. The blast radius is all future distributions, and the change is not necessarily visible as a config drift because the alarm does not watch `levels.json`.

**Evidence if true:** Change one asset’s level in `levels.json`, run the distributor, and observe a changed `per[asset]` with no on-chain event or alarm finding.

**Fix:** At minimum:

- root-owned or separately owned immutable deployment of the register;
- append-only versioned register;
- hash and commit published before activation;
- alarm on file hash and register-to-collection completeness;
- dual approval for changes.

The proposed commit-reveal should be treated as required for the “assigned by fate” customer claim, not merely a future enhancement.

### LOW — `levels.json` accepts stale and extraneous entries

The loader rejects invalid level values but does not reject:

- entries for assets outside the collection,
- entries for burned assets,
- missing entries for unactivated assets,
- duplicate logical records in alternate file formats,
- a register whose asset set does not match the current collection.

This can hide operator mistakes and makes the register less auditable than the comments imply.

**Fix:** Validate the register against the current complete collection and record a version/hash with every settlement.

### Allocation arithmetic

No over-distribution, unactivated payment, or “first element is not the smallest” defect was found in `allocateWeighted`. The BigInt flooring and reduction are correct for valid nonnegative inputs. The implementation should still reject negative or non-BigInt `available` explicitly rather than relying on callers.

---

## R3 — `scripts/bank-sign.sh`

### HIGH — `$0`-relative repository resolution is vulnerable to symlink invocation

**Construct:**

```bash
cd "$(dirname "$0")/.."
exec /usr/bin/env node bank/cosign.mjs ...
```

If the sanctioned script is invoked through a symlink, `$0` refers to the symlink path, not necessarily the real script path. The wrapper can change into an attacker-controlled or unintended directory and execute a different `bank/cosign.mjs`.

This defeats the claim that the wrapper guarantees the repository’s co-signer.

**Evidence if true:** Create:

```bash
ln -s /opt/cbob-vaults/scripts/bank-sign.sh /tmp/bank-sign.sh
mkdir -p /tmp/bankroot/bank
# place a different bank/cosign.mjs there
```

Invoke `/tmp/bank-sign.sh tx.b64`. The wrapper resolves `/tmp/..`, not `/opt/cbob-vaults`, and runs the wrong relative module if the directory structure is supplied.

**Fix:** Resolve the real script path before changing directory:

```bash
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
cd -- "$ROOT"
```

Also verify the resolved root contains the expected repository identity and the expected co-signer file.

### HIGH — TOCTOU exists between `-f` and `cat`

**Construct:**

```bash
[ -f "$SRC" ] || ...
RAW=$(cat -- "$SRC")
```

An attacker able to replace or retarget the path can swap the file after the test and before the read. Symlinks are accepted, and a symlink can be changed between those operations.

This can cause the Bank to sign a transaction different from the one inspected by the operator.

**Evidence if true:** Have a concurrent process replace `SRC` between the `test -f` and `cat`. The wrapper reads the replacement. A shell-level race test or `inotify`/rename harness can demonstrate this.

**Fix:** Open the file once, preferably with a small helper using `openat`/`O_NOFOLLOW` and regular-file checks, or read through a descriptor created before validation. For a shell wrapper, copy the file to a private temporary file using a safe open operation and validate/read that descriptor.

### MEDIUM — Base64 validation is not canonical and accepts malformed encodings

**Construct:** The filter checks only the character alphabet after whitespace removal:

```bash
*[!A-Za-z0-9+/=]*
```

It does not validate:

- length modulo four,
- padding placement,
- maximum one or two trailing `=`,
- unused low bits in the final sextet,
- canonical round-trip encoding.

Inputs such as `A`, `Zg`, `a===`, or strings with misplaced `=` pass the filter and are handed to Node. Node’s decoder may silently truncate, normalize, or decode a different byte sequence.

**Evidence if true:** Feed those strings to the wrapper and compare:

```js
Buffer.from(input, 'base64')
```

with the original normalized text and a canonical re-encoding. Some inputs are accepted despite not being canonical base64.

**Fix:** Decode once, re-encode canonically, and require exact equality after whitespace normalization. Then parse the transaction and reject any trailing or malformed bytes.

### LOW — The file-type check does not itself establish a safe immutable input

`-f` excludes ordinary FIFOs and devices, which is useful, but permits regular symlinks and does not check owner, mode, link count, or that the file is not writable by another user.

**Fix:** Require a regular non-symlink file owned by the invoking user, with restrictive permissions, or read from stdin only in the operational signing path.

### R3 exit status

`exec` correctly preserves `cosign.mjs`’s exit code. The wrapper does not swallow the child status on the normal path.

---

## R4 — New gates, test wiring, and test shape

### HIGH — The source-text ON-CHAIN gate does not prove a 2-of-2 implementation

**Construct:** `onChainBankPin()` returns true if a source file contains, anywhere:

```regex
pub bank: Signer<'info>
```

and, independently, a `require_keys_eq!` beginning with:

```regex
require_keys_eq!\(\s*ctx\.accounts\.bank\.key\(\),
```

A program can satisfy both patterns in unrelated instructions or use the equality check against the wrong authority/configuration. The gate does not parse Rust, associate the field with the handler, or prove that the checked account is actually used by the security-sensitive operation.

**Program that would pass without enforcing 2-of-2:** A program containing a harmless admin instruction with `bank: Signer` and an unrelated diagnostic instruction checking `ctx.accounts.bank.key() == config.bank`, while its redemption instruction accepts `UncheckedAccount` or never uses the Bank account.

**Evidence if true:** Create a fixture Rust file with the two strings in unrelated functions and run the gate. It will classify the file as ON-CHAIN.

**Fix:** Replace source regex with behavioral tests against built artifacts. At minimum, identify the exact instruction and account struct, then execute a negative transaction omitting the Bank and a wrong-Bank transaction, and require the relevant program error.

### HIGH — The signer-set gate misses signer mechanisms outside its narrow textual pattern

**Construct:** The scan searches selected `.mjs`, `.sh`, and `.ts` files for the literal assembled pattern `fromSecretKey`. It does not cover:

- `.js`, `.cjs`, `.py`, `.rs`, binaries, or generated files;
- `Keypair.fromSeed`;
- environment-backed wallet loaders;
- hardware wallet or CLI signing;
- `VersionedTransaction.sign`, `partialSign` aliases, or imported signing helpers;
- dynamic `import()` or subprocesses;
- a second repository or globally installed package.

**Evidence if true:** Add a file such as `scripts/alt.js` using `Keypair.fromSeed(...)` or invoking `solana`; the current signer-set remains unchanged.

**Fix:** Do not claim “every signer exists” from a grep. Enforce custody at the key boundary: the Bank key must be unavailable to repository processes except the controlled signer service, and signatures must be logged and policy-checked by a separate process.

### MEDIUM — The self-match arm is defeatable by runtime construction

The self-match check proves that four literal strings are not present in `selftest.mjs`. It can be bypassed by constructing those strings from character codes, concatenating different fragments, encoding them, or moving the search logic to an imported module.

This is not a meaningful security boundary; it only protects against accidental literal self-matches.

**Fix:** Remove self-reference as a control and make the scanner a separately built tool that does not scan itself, or use an AST/parser-based inventory with an explicit manifest that is independently signed.

### HIGH — The end-to-end suite still tests a production-incompatible redemption shape

**Construct:** The test fixed Core’s `payer` to `aliceU` inside `ExecuteV1`, but `ixOpen()` still supplies the Bank as the SEAL `payer`:

```ts
{ pubkey: bank.publicKey, isSigner: true, isWritable: true }
```

The transaction is also commonly sent with `[bank, alice]`, allowing the Bank to become the implicit fee payer. The off-chain judge explicitly rejects the Bank as fee payer.

Thus the happy-path suite does not model the documented production redemption, where the customer pays rent and fees and the Bank is not named outside the pair.

**Evidence if true:** Run the same serialized happy-path transaction through `judgeRedemptionTx` with `feePayer = bank.publicKey`. It is rejected. Inspect the SEAL instruction: the Bank is present as the `payer` account.

**Fix:** Use a distinct customer payer in the SEAL instruction and set the transaction fee payer explicitly to the customer. Add an assertion that the production-shaped redemption passes the judge and that the current Bank-payer shape is rejected.

### MEDIUM — Moving tests to avoid `minted_total` coupling does not remove the coupling

The test suite’s governance quorum depends on the monotonic MINT counter, while redemption tests mint additional vaults. Moving the tests later prevents the immediate failure but leaves a global state dependency in the suite.

A future test inserted before governance can again alter quorum. The suite’s current order is now load-bearing and not mechanically enforced.

**Evidence if true:** Add one successful `mkVault()` before section 7 and observe governance assertions change or fail.

**Fix:** Isolate governance and redemption tests on separate fresh validators or reset/reinitialize state per section. Do not rely on file ordering to preserve quorum assumptions.

### LOW — Cron parser uses substring matching rather than command parsing

`cronLines.includes(file)` can be satisfied by a filename appearing in a comment, argument, or unrelated command text. The parser also does not verify shell grouping or that `$FLOCK` expands to the intended executable at execution time.

**Fix:** Parse the generated crontab format into command fields, require the exact executable and exact `-n` lock invocation, and test the installed crontab rather than only the template.

---

## R5 — Documentation and comments

### HIGH — The documentation falsely claims a compromised operator key is limited to one sweep

**Construct:** SPEC states:

> “A compromised operator key costs one capped, cooled-down sweep rather than the treasury.”

The on-chain control limits each call and enforces a delay. It does not limit cumulative loss. A holder of the swap-operator key can call `sweep_sol_for_swap(max_sweep_lamports)` once per cooldown indefinitely and drain every unit that accumulates in the revenue PDA.

This is a material overclaim about customer/project treasury exposure.

**Evidence if true:** Fund the revenue PDA, use the operator key to perform one maximum sweep, wait for the cooldown, repeat. The total swept exceeds one cap and can approach the entire accumulated balance over time.

**Fix:** State the real guarantee:

> “A compromised operator key is limited to at most one configured sweep per cooldown; cumulative loss is not bounded while the key remains compromised.”

Add cumulative-exposure monitoring and an emergency pause/custody mechanism.

### MEDIUM — Distribution comments and cron output still claim equal per-vault payments

The new `bank/distribute.mjs` implements weighted payments, but the file header and `cron-install.sh` output still contain equal-split language:

- `distribute.mjs`: “Equal per activated vault...”
- `cron-install.sh`: “daily cbBTC to ACTIVATED vaults only ..., equal per vault.”

This is the exact inverse-direction documentation defect targeted in R5: the implementation is stronger/different than the documentation says, and customers/operators can be given the wrong economic expectation.

**Evidence if true:** Run three activated vaults at Levels I, I, and V with a 1,000-sat pool. The output is 200, 200, and 600, not equal.

**Fix:** Remove all equal-split statements and make the cron/operator documentation identify the level-weighted schedule.

### MEDIUM — “Level is enforced on-chain” is false

Several comments describe level permanence or assignment as if it were an on-chain property. The actual register is a mutable off-chain JSON file, and no Core attribute or program state stores the level.

The implementation is safer than a completely missing register because it refuses absent/invalid data, but it does not enforce permanence, fate, or non-appeal.

**Evidence if true:** Change `levels.json` between two runs without any on-chain transaction. The next distribution uses the new level.

**Fix:** Consistently call this an operational register until a commitment or on-chain record exists.

### MEDIUM — BURN comments imply a Bank scan occurs on every burn

BURN’s comments say the Bank “must scan the PDA before it signs” and that the alarm applies to every call. The on-chain BURN program does not scan the PDA’s unknown holdings and cannot force the off-chain tool to run. The Bank signature is mandatory; the policy scan is not.

The control table distinguishes these, but the BURN source itself still uses language that can be read as an enforced precondition.

**Fix:** Say “the sanctioned Bank policy tool is intended to scan before signing; the program cannot enforce that policy.”

### LOW — `decideEmission`’s Level I explanation is inaccurate

The function comment says the minimum is “a Level I share,” but the actual minimum is the lowest amount among activated levels. With no Level I holder, the minimum is not a Level I share.

**Fix:** Align the comment with the code.

---

## R6 — Published arithmetic

The published figures independently check out:

- 240-vault denominator:  
  `108×2 + 60×3 + 36×4 + 24×5 + 12×6 = 732`.
- 2,100-vault denominator:  
  `945×2 + 525×3 + 315×4 + 210×5 + 105×6 = 6,405`.
- Level V / Level I weight ratio: `6 / 2 = 3`.
- The displayed per-$1,000 values round correctly.
- The 2,100-vault percentages round to `29.5%, 24.6%, 19.7%, 16.4%, 9.8%`, summing to `100.0%`.

No arithmetic finding is warranted. The remaining issue is semantic: the card must explain that integer dust is allocated using the next settlement’s census, not necessarily the census that generated the dust.

---

# Carry-over list: items that are worse than stated

### CRITICAL — The Bank signature remains entirely optional as an operational process

The chain requires a Bank signature, but nothing requires the holder to use `cosign.mjs` or the wrapper. A key holder can sign a malicious redemption directly. This is correctly listed as an accepted limit, but its practical consequence is larger than the wording suggests: the new on-chain confinement closes one class of Bank theft only for all transactions, but the off-chain coverage scan remains bypassable entirely when the key holder signs elsewhere.

The project must treat the Bank private key as an external custody boundary, not as a repository file protected by grep gates.

### HIGH — A valid redemption can still use the Bank as payer inside the pair

This is listed, but the test suite actively uses the Bank as the SEAL payer and often as transaction fee payer. The suite therefore normalizes a shape that the policy judge rejects and does not prove the documented production shape.

### HIGH — The allowlist does not inspect sweep destinations

The Bank policy allows Core and token instructions but does not decode their account semantics. A validly structured transaction can sweep funds to a customer-selected destination if the customer supplies such a Core Execute instruction. This may be acceptable as “the owner spends their own vault,” but the current comments alternately describe the policy as protecting the redemption and as not checking destinations.

The specification must state whether the Bank is protecting only Bank funds or also the customer’s redemption destination.

### HIGH — The distribution ledger is still self-authored and can be rewritten

The distributor process writes the ledger, and the alarm trusts it for reconciliation. An operator with filesystem access can remove, alter, or fabricate payment rows. The marker prevents simple deletion from being treated as first run, but it does not provide integrity or chain-derived payment reconciliation.

At minimum, reconcile every `done[v]` row against chain signatures and destination balances, and make the ledger append-only or externally authenticated.

### MEDIUM — A wedged-but-alive lock holder can stop money jobs indefinitely

`flock -n` correctly prevents double execution, but a process that remains alive while wedged retains the lock. The in-process generation lock also refuses to break live holders. This is safer than double payment but is a permanent availability failure unless an operator notices and intervenes.

Add a separately monitored heartbeat and an explicit, audited operator kill/recovery procedure.

### MEDIUM — The level register is not included in the alarm’s watched state

A level change can change customer payouts without producing config drift. This is materially worse than merely lacking commit-reveal.

---

# Verdict challenges

## The repaired `readProgramData` helper is not used by the live alarm

### HIGH — Malformed ProgramData still reports as “IMMUTABLE”

`detectors.mjs` contains the repaired `readProgramData()` with explicit rejection of tags other than `0` and `1`. But `alarm.mjs` still directly performs:

```js
const hasAuth = acc.data[12] === 1
snap[`prog.${name}.upgrade_authority`] =
  hasAuth ? ... : 'IMMUTABLE'
snap[`prog.${name}.hash`] =
  createHash('sha256').update(acc.data.subarray(45))...
```

The live caller does not call `D.readProgramData()` and does not validate:

- account length,
- ProgramData enum,
- Option tag,
- authority payload length,
- ELF magic at offset 45.

A malformed tag such as `7` is still rendered as `IMMUTABLE`, exactly the defect the repair claims to fix.

**Evidence if true:** Supply a ProgramData account whose byte 12 is `7`. The helper returns `{ hasAuth: null, problem: ... }`, but `alarm.mjs` records `IMMUTABLE` and hashes the account. A source-level test should assert that `alarm.mjs` invokes `readProgramData`, and an integration fixture should verify malformed tags cause a loud failure.

**Fix:** Import and use `D.readProgramData()` in `alarm.mjs`; refuse malformed or short data. Also validate the loader enum and ELF magic before using the result.

### MEDIUM — `readProgramData()` itself accepts too-short authority payloads

It checks `data.length >= 45`, but for `data[12] === 1` it reads `data.subarray(13,45)` without separately proving the account has the full authority payload and ELF. A 20-byte malformed account can be treated as upgradeable with a truncated public key.

**Fix:** Require the complete ProgramData metadata and ELF magic before accepting either state.

---

# Anything else

### CRITICAL — Upgrade authorities remain a live code-replacement path

The alarm detects program hash and upgrade-authority drift after the fact. It does not prevent an upgrade from landing between alarm passes, and the project has four independent upgrade authorities plus Metaplex Core’s authority. This is documented, but certification must not treat detection as protection.

Before mainnet:

- place all four project upgrade authorities under independently controlled multisig custody;
- establish an emergency pause/withdrawal protocol;
- monitor upgrade transactions directly, not only periodic snapshots;
- obtain and verify the deployed program hashes from the actual cluster.

### HIGH — `set_collection_royalties` can still be operationally unratifiable after governance PDA rotation

The code requires a `governance: Signer` for royalty changes. Once governance is the GOV PDA, GOV only signs `set_round`, so royalty updates become unreachable except through governance rotation. This is documented for some wiring changes, but the customer-facing royalty control should explicitly include this instruction.

### HIGH — `split_revenue` does not validate the supplied mint’s account owner or decimals

The instruction pins the source and destination ATA addresses using the supplied mint and invokes the classic SPL Token program, but it does not validate that:

- `ctx.accounts.mint` is a classic SPL mint account;
- the mint account is owned by Tokenkeg;
- the `decimals` argument matches the mint’s on-chain decimals;
- the revenue ATA and destination ATAs are owned by Tokenkeg and have the expected mint.

A caller can invoke the instruction for arbitrary classic SPL mints or pass an incorrect decimals value, causing rejection or inconsistent event semantics. The current revenue pipeline uses cbBTC correctly, but the public permissionless instruction is broader than the comments imply.

**Fix:** Validate mint ownership, mint key, mint decimals, ATA ownership, and either pin cbBTC or explicitly specify and test supported arbitrary-token behavior.

### MEDIUM — `detectSplitClaims` trusts timestamps from RPC and ledger with weak validation

The split correlation logic uses `blockTime` and `returnedAt` comparisons with a one-minute tolerance. Missing or malformed timestamps can cause `NaN` comparisons and silently prevent an anchor match. The selftests cover missing block time but not malformed or future timestamps.

**Fix:** Validate timestamp types and ranges. Refuse malformed records and future-dated observations.

### MEDIUM — `normalise()` silently converts invalid base58 instruction data to empty bytes

`bs58decode()` returns `Buffer.alloc(0)` on any invalid character. The alarm then treats the instruction as having no data rather than reporting a malformed transaction. A malformed RPC response can therefore be scanned as a transaction with no recognizable instructions.

**Fix:** Throw on invalid base58 and report the transaction unreadable.

### LOW — Configuration readers do not enforce minimum lengths for every field before slicing

`readConfigs.g()` checks only `d.length < 9` before reading all declared offsets. `readBigUInt64LE`, `readUInt32LE`, and `PublicKey` construction can throw, but errors are not consistently converted into a structured “malformed account” finding. This is fail-stop rather than fail-open, but it creates avoidable outage behavior and inconsistent diagnostics.

---

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

The project should stop treating source-text gates and AI consensus as certification evidence. They are useful screening tools, not independent assurance. Concrete actions:

1. **Create an independent executable reference implementation** for every money rule:
   - redemption transaction grammar,
   - Bank-key confinement,
   - weighted distribution,
   - revenue reconciliation,
   - configuration decoding.

   Run production transactions through both implementations and fail on any disagreement.

2. **Use property-based and stateful fuzzing**, not only hand-written assertions:
   - arbitrary instruction ordering,
   - malformed discriminator-bearing instructions,
   - duplicate and missing accounts,
   - malformed RPC responses,
   - ledger corruption,
   - crash/restart points,
   - concurrent distribution and revenue processes,
   - changing activated sets and levels.

3. **Run a pre-mainnet adversarial harness on a persistent validator** that includes:
   - real Metaplex Core,
   - the exact mainnet artifacts,
   - hostile account creation and airdrops,
   - hostile operator behavior,
   - repeated compromised-key sweeps,
   - malformed and versioned transactions,
   - measured CU and packet limits.

4. **Move Bank signing into a separate custody system.** The private key must not be readable by the repository’s ordinary jobs. Require:
   - hardware or isolated signing,
   - transaction hash display,
   - policy evaluation in a separate process,
   - immutable signature logs,
   - dual approval for live signing,
   - an emergency revoke/rotate procedure.

5. **Make all off-chain state tamper-evident.** Levels, distribution state, revenue state, alarm state, and acknowledgements need append-only storage, authenticated hashes, independent backups, and alerts on rollback or rewrite.

6. **Perform a controlled canary launch with valueless assets and capped balances**, then deliberately exercise:
   - Bank-key compromise,
   - operator-key compromise,
   - stale locks,
   - RPC lies and truncation,
   - DAS outages,
   - alert delivery failure,
   - validator restart,
   - Core upgrade detection,
   - ledger deletion and restoration.

7. **Require an independent human execution review even if no audit firm is retained.** At minimum, two engineers who did not write the implementation should operate the full canary, inspect the emitted transactions and logs, and sign an operational readiness record. Sixteen rounds of AI text review cannot substitute for someone actually observing the deployed binary, custody boundary, cron environment, filesystem permissions, and failure recovery.