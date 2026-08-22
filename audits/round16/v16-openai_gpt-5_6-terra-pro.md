## R1 — co-signer refusals

### MEDIUM — DAS pagination still treats an internally contradictory partial reply as a complete empty/short ownership list

**Construct:** `bank/cosign.mjs`, `scanPda()`:

```js
const items = j.result?.items
if (!Array.isArray(items)) throw ...
...
if (items.length >= 1000) throw ...
return owned
```

The code validates that `items` is an array and rejects a full requested page. It does not validate DAS pagination metadata such as `result.total`, `result.page`, and `result.limit` when supplied.

**Impact:** A DAS provider can return, for example:

```json
{
  "result": {
    "total": 1,
    "limit": 1000,
    "page": 1,
    "items": []
  }
}
```

or a short partial page while reporting `total > items.length`. The current code accepts this as “the PDA owns no nested Core assets” despite a response that says otherwise. A nested asset omitted this way can be destroyed in a co-signed redemption.

This is not the normal airdrop race. It is a contradictory response received during the scan that is presently accepted as authoritative.

**Evidence if correct:** Unit-test `scanPda` or extract a pure DAS-response classifier and feed:
- `items: [], total: 1`;
- `items: [one item], total: 2`;
- `items.length < requestedLimit` with continuation metadata indicating another page.

The intended result should be refusal, not a clean scan.

**Fix:** Require a coherent pagination response. At minimum:
- if `total` is present, require `items.length === total` for this one-page query, or refuse when `total > items.length`;
- if pagination continuation fields indicate more pages, refuse;
- reject impossible combinations such as `total < items.length`;
- pin the expected provider response schema, rather than treating optional metadata as irrelevant.

---

### MEDIUM — the documentation still calls the co-signer a running completeness control although the key path is not wired through it

**Construct:** the revised SEAL and BURN headers, and the SPEC control table, describe `bank/cosign.mjs` as what “covers” the completeness gap and as a pre-signature control. The same SPEC later correctly states:

> “It is not wired into anything: no cron, no service and no client calls it…”

**Impact:** This is not merely prose inconsistency. The system has a Bank public key in on-chain configs, but nothing constrains the holder of the corresponding private key to use `cosign.mjs`. A different CLI, a one-off Node script, direct `web3.js` signing, a wallet export, or an external signer can co-sign the redemption pair without every R1 check.

The new “exactly one file in `bank/` reads the Bank key” assertion does not make this a control. It only constrains a narrow source-tree pattern in one directory. It cannot constrain:
- a signer outside `bank/`;
- an external signing service;
- a copied key;
- a hardware/software wallet importing the key;
- an alternate environment variable or secret-manager path;
- an operator manually signing a transaction.

**Evidence if correct:** Use the Bank key with a minimal script outside `bank/` to sign the known valid `[open, malicious extra instruction, burn]` message. The on-chain programs will accept the Bank signature as long as their own account constraints are satisfied; they cannot distinguish its origin.

**Fix:** Do not describe the CLI as a running control until key custody enforces it. The smallest meaningful implementation is:
1. move the Bank secret out of an operator-readable JSON file;
2. expose signing only through a dedicated service/HSM/remote signer;
3. have that signer accept only an approved redemption request, run the parser and scan itself, and refuse arbitrary raw signing;
4. firewall/audit the signer endpoint and remove alternative signing paths.

An ordinary client call to `cosign.mjs` is insufficient because the client can bypass it.

---

### Assessment of arm 1

The central claim behind arm 1 is materially correct for the parsed legacy message:

- **Address lookup tables:** not an escape in the currently accepted path. `Transaction.from` is legacy-only and the versioned-message assertion establishes refusal. If v0 support is later added, the resolved lookup keys must be included in the same confinement check.
- **Duplicate metas:** not an escape. A duplicate Bank key remains present in the instruction account list and is caught.
- **Nested CPI:** not an escape by itself. A callee can use the Bank’s signer privilege only if an outer instruction supplies the Bank account with signer privilege. That outer instruction necessarily names the Bank and is rejected.
- **Instructions sysvar:** not an escape. Reading another instruction or the transaction signer set does not grant the Bank’s signer privilege to a CPI account.
- **Compute budget / System / Token / Core / ATA instructions without the Bank:** these can spend the customer’s funds or the vault PDA’s funds during an owner-authorized redemption, but do not authorize debiting the Bank. This is still a dangerous customer-safety grammar gap, not a Bank-key theft path.

The permitted Core Execute path is not confinement-moot for the Bank key: Core needs the asset owner’s authority and cannot conjure the Bank signer. It does mean the Bank is approving a redemption where the owner may route their own proceeds anywhere, create arbitrary PDA-owned accounts, close accounts to arbitrary destinations, or operate on unrelated owner-controlled Core assets. If the product claim is “the Bank protects the customer from a malformed redemption,” the current judge does not meet that claim. If the narrower claim is only “the Bank key cannot be used for unrelated debits,” arm 1 addresses that narrow claim.

---

## R2 — lock restore and `flock`

### MEDIUM — `judgeCronTemplate` does not prove that the money commands are actually executed under `flock`

**Construct:** `bank/detectors.mjs`:

```js
if (!/^[0-9*]/.test(line)) continue
if (!/node\s+bank\/\S+\.mjs/.test(line)) continue
if (!/\bflock\b|\$FLOCK\b/.test(line)) bad.push(line.trim())
```

This is a substring test, not a shell-command parse.

**Impact:** The gate passes lines where `flock` or `$FLOCK` appears but does not wrap the Node invocation. Examples:

```cron
7 9 * * * cd $R && /usr/bin/node bank/distribute.mjs # $FLOCK
7 9 * * * flock=false; /usr/bin/node bank/distribute.mjs
7 9 * * * echo flock; /usr/bin/node bank/distribute.mjs
```

It also ignores valid cron forms it does not recognize, including `@daily` jobs and lines with leading whitespace. A future edit can remove exclusion while preserving a token that satisfies the regex.

**Evidence if correct:** Add each example above to the existing `judgeCronTemplate` selftest. The current implementation returns `[]` although the Node process is not protected by `flock`.

**Fix:** Do not infer shell semantics with a token-presence regex. Prefer one of:
- construct cron entries from a structured jobs array and assert every generated job has an explicit lock-file argument;
- parse only the exact generated command shape and require `$FLOCK $LOCKDIR/<job>.flock /usr/bin/node bank/<expected>.mjs` before redirection;
- after installation, parse `crontab -l` and compare the tagged entries to the generated expected entries exactly.

The last item matters because the current test checks the template source, not installed operational state.

---

### LOW — `flock -n` aborts overlapping jobs, but the installed operational behavior does not distinguish an overlap abort from an ordinary job failure

**Construct:** cron entries redirect both normal program output and `flock -n` failure to the same log:

```cron
$FLOCK $LOCKDIR/distribute.flock /usr/bin/node bank/distribute.mjs >> ... 2>&1
```

`flock -n` returns status 1 when the lease is held, generally without an explanatory log record of its own.

**Impact:** An overlap is expected to abort, but an operator cannot reliably distinguish:
- “another run is actively holding the OS lease,”
- “the Node job failed before emitting useful output,”
- “the cron command failed before Node started.”

This can hide repeated skipped daily distributions or cause incorrect incident handling. It is an availability and observability defect, not a concurrent-payment bypass.

**Evidence if correct:** Hold `/var/lock/cbob/distribute.flock` with `flock`, run the installed command, and inspect `distribute.log`. The exit status is 1, while the log need not identify the lock contention.

**Fix:** Wrap each invocation in a small shell function or wrapper that explicitly logs an `ELOCKED`/“skipped because flock is held” line and returns a distinct exit code. Monitor that code or log pattern separately from Node failures.

---

### Lock interleavings

The rename-back repair does preserve the original holder’s pathname lock in the tested three-runner restore race:

1. A’s fresh lock is renamed by a losing breaker B.
2. C claims the temporarily absent pathname.
3. B atomically renames A’s saved lock back onto the pathname.
4. C’s pathname is replaced; C will later fail `releaseLock`.

That prevents the prior “restore failure then unlink the saved true lock” destruction.

It does **not** prevent C from beginning work during the hole before its eventual release failure. Thus A and C can still both believe they own the job temporarily. The prompt already carries this limitation for hand-run/in-process paths. `flock` covers cron-installed runs only.

A pure filesystem exclusion scheme can avoid this by never implementing stale-lock takeover, e.g. `mkdir` as an atomic acquisition primitive and manual recovery only. That closes concurrency by sacrificing automatic recovery. It does not provide the desired safe stale-break semantics. For automated stale recovery with robust ownership and crash release, kernel file locking or a dedicated coordination service remains the appropriate primitive.

---

## R3 — ACK allowlist

### HIGH — `nested_vault` and `unredeemable_owner` are not categorically unactionable, so the kind-only allowlist can silence active recoverable hazards

**Construct:**

```js
export const ACKABLE_KINDS = new Set([
  'vault_owns_itself',
  'nested_vault',
  'unredeemable_owner'
])
```

**Impact:** The rationale says these are “unanswerable BY CONSTRUCTION.” That is false for at least two allowed kinds.

- A `nested_vault` whose host vault still exists may be recoverable. The host owner can perform an owner-authorized Core Execute while the host is valid, transferring the inner asset out before the host is redeemed. It may require a carefully constructed transaction and it may be operationally difficult, but it is not categorically impossible.
- `unredeemable_owner` can be a temporary marketplace escrow or a program/DAO account with an asset-transfer mechanism. The code itself acknowledges the marketplace-escrow interpretation as recoverable: delisting can return the asset to an ordinary owner.

An operator can acknowledge either finding permanently today, then the host can remain redeemable and be burned later, destroying a nested asset; or the escrow may remain unresolved indefinitely. The alarm becomes INFO by design.

**Evidence if correct:** Create a `nested_vault` finding for an unburned host and add a valid acknowledgement. `applyAcks` downgrades it to INFO regardless of whether the host still exists. Similarly, add an acknowledgement for an off-curve marketplace escrow owner.

**Fix:** Do not allow acknowledgements solely by `kind:asset` for conditions whose recoverability depends on live state. Options:
- only allow `vault_owns_itself` by default;
- split findings into explicit terminal and recoverable variants, e.g. `nested_vault_in_burnt_host` versus `nested_vault_recoverable`;
- require an acknowledgement to include an expiry/review date and retain paging until an operator records an on-chain remediation or a verified terminal state;
- re-evaluate acknowledged findings against current chain state and revoke the acknowledgement when the state changes.

Refused-ack flooding is less serious: every refused ack must correspond to a real finding because `applyAcks` iterates findings, not arbitrary ack-file keys. It can enlarge details for already-existing findings, but cannot create unlimited standalone report rows from arbitrary keys.

---

## R4 — round 16 repairs

### LOW — `readProgramData` silently interprets malformed ProgramData authority tags as immutable layout

**Construct:**

```js
if (!data || data.length < 13) ...
const hasAuth = data[12] === 1
return { hasAuth, elfOffset: hasAuth ? 45 : 13, problem: null }
```

**Impact:** Byte 12 is indeed the one-byte `Option<Pubkey>` discriminator after the 4-byte `UpgradeableLoaderState` variant and 8-byte deployment slot. The normal offsets 13 and 45 are correct.

However, every tag other than `1`, including malformed `2`, is treated as `None`, and a `Some` record shorter than 45 bytes is not rejected by this helper. A malformed loader account is reported as `IMMUTABLE` and hashed from byte 13 rather than causing a deliberate monitoring refusal.

This is mainly a monitoring-integrity and failure-mode issue. A valid mainnet ProgramData account should not naturally have this form.

**Evidence if correct:** Call:

```js
readProgramData(Buffer.from([...Buffer.alloc(13), 2]))
```

It returns `{ hasAuth: false, elfOffset: 13, problem: null }`.

**Fix:** Require:
- loader state discriminant is ProgramData (`3`) if this helper is intended to validate the whole layout;
- option tag is exactly `0` or `1`;
- `data.length >= 45` for `Some`;
- an ELF payload exists at the resulting offset and begins with ELF magic if this is meant to be a program fingerprint.

Return a problem and abort the alarm pass rather than classifying malformed bytes as immutable code.

---

### LOW — the source-regex assertion for failed-transaction skipping is not a robust dependency gate

**Construct:**

```js
/if \(s\.err\) continue/.test(alarmSrc)
```

**Impact:** This test does not establish the semantic property it claims:
- the exact text can survive in a comment, dead branch, helper, or unrelated loop;
- a harmless refactor to `if (s.err) { continue }` fails the build although failed transactions remain skipped;
- moving decode before the guard can retain the matched text but violate the intended “skip before decoding” property.

The claimed dependency is real: correlating a caller-supplied `burn_via_program` asset with a bare burn is safe only if failed transactions are excluded before detector input. The gate is too syntactic to protect it.

**Evidence if correct:** Modify the source to retain the exact text in a comment while changing the executing branch to decode failed transactions. The regex still passes. Conversely, add braces around the legitimate guard and it fails.

**Fix:** Export a small pure predicate or transaction-selection helper from `alarm.mjs` and test behavior:
- failed signature records produce no normalized instructions and no `burn_via_program`;
- successful records can proceed;
- detector correlation cannot be triggered from a failed transaction.

Do not certify a cross-file security dependency by grepping source text.

---

### Assessment of bank disagreement severity

`banks_disagree` is a justified urgent finding when `seal.bank` and `burn.bank` differ: BURN explicitly cross-checks the SEAL bank against its own and redemption is halted.

The detail is overbroad for a mismatch involving only `mint.bank`. That does not itself halt redemption; it halts or impairs minting because MINT cross-checks against SEAL. The finding can remain CRITICAL because it is an active cross-program wiring failure, but the report should say which subsystem is halted:
- SEAL/BURN mismatch: redemption halted;
- MINT/SEAL mismatch: minting halted;
- all three mismatch: both paths affected.

A legitimate staged rotation is not a false positive if it leaves inconsistent live configs. It is a real temporary outage. Operators should apply coordinated rotations atomically in one transaction where possible, or deliberately accept a monitored maintenance window.

---

## R5 — comments

### MEDIUM — the “one place that says what runs” rule is still violated by comments that state a control runs while the system explicitly says it is unwired

**Construct:** SEAL’s and BURN’s new headers say the co-signer “refuses in the moment, PRE-SIGNATURE” or identify the control table as what “covers” the completeness gap. The SPEC table likewise presents it as a control. Elsewhere, SPEC says it is “not wired into anything.”

**Impact:** The headers no longer deny that the tool exists, but they now overstate deployment reality. The distinction between “there is a CLI that can perform a check” and “every Bank signature is mediated by that check” is security-critical.

**Evidence if correct:** A direct Bank signature created outside `cosign.mjs` is accepted by SEAL/BURN. Nothing on chain checks a cosigner provenance marker or service attestation.

**Fix:** Every header should point only to the control table, and the table should label the current status accurately:

> `bank/cosign.mjs`: available manual signing tool; not enforcement until Bank key custody is restricted to the policy signer.

Do not call it a system control until this changes.

---

## R6 — gates

### MEDIUM — the cron gate can be defeated by syntactic token placement and does not inspect installed state

This is the `judgeCronTemplate` issue described in R2. It is both a R2 operational issue and an R6 certification-gate defect: the selftest proves only that the permissive regex recognizes the current heredoc, not that all money jobs are actually kernel-serialized.

The installed crontab remains unverified. `cron-install.sh` prints tagged lines after installation, but no automated gate compares the installed tagged entries against the desired generated entries. A `crontab -e` change, a partial manual installation, or a different host’s crontab can silently lose `flock` while every source-based assertion remains green.

---

## Carry-over list

### HIGH — “nothing wired to the co-signer” is worse than stated because the current key-file architecture makes bypass normal, not exceptional

The issue is not only that no cron invokes the CLI. The Bank private key is a raw JSON key file read by a general-purpose process. Any process or operator with file access can use it directly. A future redemption client that “uses the Bank key” will naturally bypass the policy unless it is designed around the tool.

The exact-one-reader assertion is not meaningful protection. It detects only a specific textual reference in `.mjs` files directly under `bank/`.

**Smallest real control:** remove raw-key access from ordinary programs and make a policy-enforcing signer the only entity that can produce Bank signatures. This needs key custody, not another assertion.

### MEDIUM — CU capacity remains an unmeasured hard ceiling

The 1,232-byte measurement establishes only packet size. It does not establish that the worst-case three-mint redemption:
- Core Execute with transfer and close operations,
- multiple token-program operations,
- BURN’s loops and account data reads,
- Core BurnV1,

fits the compute budget under mainnet conditions. A transaction can serialize under 1,232 bytes and still exceed default or requested compute units. The co-signer permits ComputeBudget instructions but does not constrain or measure them.

**Evidence:** Simulate the actual 3-mint worst-case redemption and record `unitsConsumed`; repeat with destination ATA creation excluded as required. Test default CU and the intended requested CU price/limit configuration.

**Fix:** Add an end-to-end CU ceiling test, pin a maximum measured consumption with margin, and specify the permitted ComputeBudget instruction grammar rather than merely allowing the entire program.

### MEDIUM — foreign nested Core assets remain more dangerous than the stated post-hoc gap

The co-signer can see a foreign Core asset through DAS at signing time, but it is not enforced and has the airdrop/response limitations described above. The periodic alarm does not inspect Core assets by each vault PDA, so a foreign nested asset can exist indefinitely without paging and be destroyed when the host is redeemed through any Bank-signing route that bypasses the CLI.

This becomes substantially worse while the co-signer remains unwired.

**Fix:** Add a per-vault DAS owner query to reconcile, with pagination and failure-closed semantics, or explicitly prevent production redemption until the signing service performs that scan.

---

## Verdict challenges

### Rejected: “co-signer does not verify collection or on-chain owner”

The rejection is substantially correct for transaction success: SEAL and BURN independently validate Core ownership and collection, and a Bank signature on a transaction that fails those checks cannot transfer vault contents.

A signature on a reverting transaction is not generally reusable for another message, and the Bank is rejected as fee payer. Therefore this is not established as a theft finding.

The remaining practical value of such a signature is limited to nuisance effects on the customer-selected fee payer or transaction simulation/relay behavior. That does not justify treating omitted prevalidation as a high-severity asset-loss defect. It would still be sensible defense-in-depth for `cosign.mjs` to fetch and validate the asset before performing expensive scans.

### Rejected: legacy-only parsing as HIGH availability failure

Fail-closed is the correct safety direction for a Bank signer. Versioned transaction support must not be added until lookup tables are resolved and every loaded account key undergoes the same confinement analysis.

However, this is an operational incompatibility with the project’s stated fourth-reserve-mint path. The current system says a fourth reserve mint needs v0 plus ALTs, while the Bank tool rejects v0. That means “add a fourth reserve mint after building a v0 client” is incomplete: it also requires a versioned-message-aware policy signer and a new security review. This should be recorded as an explicit deployment prerequisite, not merely as a test assertion.

### Rejected: declare-everything “bricks a vault”

The visible-refusal choice is defensible only as a safety-preserving manual process, not as a normal automated redemption path. An attacker can cheaply create a Token-2022 extension-bearing account owned by a vault PDA and force every ordinary tool-mediated redemption into manual review. That is a persistent operational denial of service until a human deliberately chooses whether to approve a destruction risk.

The issue is not that the refusal should be removed. It is that the project cannot claim reliable self-service redemption while it accepts this griefing vector and has no enforced, auditable human-exception procedure.

### Rejected: owner and Bank actual signer flags

The rejection is correct for landed transactions. Both relevant Anchor account definitions use `Signer<'info>`, so a transaction lacking the required signature cannot execute the relevant instruction. `judgeRedemptionTx` need not independently recreate Anchor’s signer-flag checks for on-chain safety.

---

## Anything else

### LOW — `releaseLock` still reports success after an unlink failure

**Construct:**

```js
try { fs.unlinkSync(file) } catch { /* already gone */ }
return true
```

**Impact:** The preceding read verifies the token, but an unlink failure other than an expected concurrent disappearance—permission failure, filesystem I/O failure, readonly remount—still returns `true`. `withLock` then suppresses its warning despite failing to release its lock.

This is primarily availability and incident-observability risk. It is not the old double-payment race by itself.

**Evidence:** Inject or mock `unlinkSync` to throw `EACCES` after the token check. `releaseLock` returns `true`.

**Fix:** Return false or throw on every unlink failure. If `ENOENT` is intentionally treated separately, return false as the code comments already imply. Include the error in the `withLock` warning.

---

# Given that no human firm will ever see this

Do not rely on more independent language-model reviews as the final safety mechanism. Add controls that generate evidence outside the author’s source tree and outside a model’s reasoning:

1. **Use an external signing boundary.** Put the Bank key in an HSM, hardware-backed remote signer, or narrowly scoped signing daemon. The policy signer must be the only signing route and must retain append-only request/decision logs.

2. **Perform adversarial integration testing on a public devnet or dedicated long-lived validator.** Exercise actual RPC/DAS behavior, transaction expiry, durable nonce refusal, provider pagination inconsistencies, cron installation, power-loss recovery, and signer-service bypass attempts. Preserve transaction signatures and logs as audit artifacts.

3. **Commission continuous independent implementation review by a separately controlled team or service, not only prompts chosen by the repository owner.** The reviewer should receive commit history, deployment scripts, host configuration, crontabs, key custody architecture, and actual deployment artifacts—not merely selected source files.

4. **Create reproducible release attestation.** Build in an isolated environment; publish artifact hashes, program IDs, upgrade authorities, signer-service policy version, exact dependency lockfiles, and the transaction that sets or verifies each authority. Make deployment reject any artifact not matching the attested build.

5. **Run disaster drills before customer funds exist.** Simulate: lost Bank key, compromised operator key, malformed DAS responses, airdropped Token-2022 extension account, cron overlap, missing `/var/lock/cbob`, failed notification delivery, stale ledger restoration, and signer-service outage. Require measured recovery time and written operator decisions.

6. **Make production monitoring independently observable.** Send signed or append-only alarm events to a system not writable by the signer host. A host that owns the keys, ledgers, logs, and alert configuration cannot be treated as its own complete auditor.