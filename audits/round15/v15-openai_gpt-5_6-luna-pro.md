# R1 — `bank/cosign.mjs`

## HIGH — The co-signer signs the customer’s entire transaction, not a redemption-only transaction

**Construct:** `inspect()` accepts every top-level instruction except additional instructions addressed to SEAL or BURN. It does not restrict the transaction to a safe instruction allowlist, accounts, writable accounts, signer set, fee payer, or address set. After the narrow shape check, `tx.partialSign(bank)` signs the complete customer-composed transaction.

A customer can append arbitrary instructions to a transaction that contains a well-shaped redemption, including:

- System transfers involving the Bank’s account;
- SPL or Token-2022 instructions involving Bank-owned accounts;
- arbitrary instructions to attacker-controlled programs;
- instructions requiring the Bank as a signer;
- instructions changing or draining assets that the Bank key controls;
- additional fee-payer and signer arrangements;
- arbitrary writable accounts;
- arbitrary address-table accounts if a versioned transaction were later supported.

The current legacy parser rejects versioned transactions rather than signing them, but it does not otherwise enforce that the transaction is a legacy transaction with only the expected account graph.

**Gain:** If the Bank key controls anything beyond the intended signature role, the customer can obtain a Bank signature over unrelated operations. Even if the Bank wallet is intended to hold only a signing SOL balance, this violates the stated meaning of the Bank signature and can drain that balance or authorize future Bank-controlled operations.

**Evidence:** A transaction containing:

1. exactly one valid SEAL `open_for_redemption`;
2. exactly one valid BURN `burn_vault`;
3. an additional instruction to an attacker program with the Bank account marked signer/writable;

is accepted by `judgeRedemptionTx`, and `--live` emits a transaction containing the Bank signature. The on-chain redemption pair can still succeed while the extra instruction also executes.

**Fix:** Construct the transaction to be signed from a server-side allowlist rather than signing customer bytes. At minimum:

- require exactly the expected redemption instructions and explicitly permitted Core Execute instructions;
- reject all unknown programs;
- require exact instruction data lengths and account layouts;
- require the expected signer set, fee payer, and writable accounts;
- reject any instruction involving Bank-controlled accounts outside the intended pair;
- reject all address-table lookups unless their contents are independently resolved and allowlisted;
- preferably make the customer submit an unsigned redemption intent and have the Bank construct the final transaction.

The Bank key should be isolated in a wallet that cannot hold or control anything valuable except the signature role.

## HIGH — The claimed co-signer control is not operationally wired into redemption

**Construct:** `cosign.mjs` is a standalone CLI. No redemption client, service, cron job, RPC gateway, or transaction submission path invokes it. The programs require a Bank signature, but nothing in this repository obtains that signature automatically or enforces that customer redemption transactions pass through this tool.

The `--live` path merely prints a newly signed base64 transaction. There is no authenticated request channel, nonce, transaction approval record, submission, confirmation, or binding between the signed transaction and a transaction later submitted by the customer.

**Gain:** The control table and SPEC now state that the Bank co-signer is a pre-signature control, but the production path remains manual or external. A transaction submitted without this tool cannot receive a valid Bank signature from this repository; a separate signer implementation can bypass all checks. This is both a denial-of-service risk and a control-evasion risk.

**Evidence:** There is no caller of `cosign.mjs`, no service endpoint, and no test that submits a customer redemption through the intended operational flow. A grep for `cosign.mjs` outside its own file and documentation should produce no redemption integration.

**Fix:** Define one enforced redemption service:

1. receive an unsigned transaction or structured redemption request;
2. validate it;
3. sign only the validated transaction;
4. submit or return it through an authenticated channel;
5. record the exact message hash, asset, owner, bank, scan slot, and signature;
6. refuse direct customer paths that do not use the service.

Until then, the SPEC must describe this as a manual procedure, not a running control.

## HIGH — Legacy-only parsing rejects legitimate versioned redemptions

**Construct:** `const tx = Transaction.from(...)` parses only legacy transactions. Versioned transactions, including v0 transactions using address lookup tables, are rejected before judgment.

**Gain:** This does not directly steal funds, but it creates a protocol availability failure. A future redemption requiring address lookup tables—or a client that naturally produces v0 transactions—cannot be co-signed. The project simultaneously says a fourth reserve mint requires a v0 transaction while the co-signer cannot process one.

**Evidence:** Supplying a serialized `VersionedTransaction` to `inspect()` produces a parse exception and no Bank signature.

**Fix:** Either explicitly prohibit versioned transactions everywhere and remove the v0/LUT claim from the documentation, or parse `VersionedTransaction`, resolve every lookup-table entry at a known slot, and apply the same complete allowlist to static and loaded accounts.

## MEDIUM — `judgeRedemptionTx` does not validate the actual signer set or fee payer

**Construct:** Shape judgment compares instruction program IDs, selected account positions, discriminator prefixes, and the declared count. It does not inspect transaction message header signer flags, required signatures, fee payer, or duplicate account metadata.

**Gain:** Most malformed cases fail later when `partialSign` or the on-chain programs reject them, but the function’s `ok` result is not equivalent to “this transaction is one safe redemption.” A caller of the pure function can treat malformed or differently authorized transactions as approved.

**Evidence:** Synthetic instruction lists with the expected account strings but no signer metadata are accepted by `judgeRedemptionTx`. The selftest does not model a transaction message or signer header at all.

**Fix:** Make the pure judgment operate on a normalized message containing:

- transaction version;
- fee payer;
- static keys;
- loaded address-table keys;
- signer indexes;
- writable indexes;
- exact instruction data and accounts.

Require the precise signer and fee-payer policy.

## MEDIUM — PDA token-account scanning can silently treat malformed DAS responses as empty

**Construct:** `scanPda()` checks `j.error`, but otherwise uses `(j.result?.items || [])`. A successful HTTP/RPC response with a missing, malformed, incomplete, or provider-specific result object is interpreted as zero Core assets. There is no validation of response shape, pagination metadata, slot, or completeness marker.

The full-page check only catches the particular case where exactly 1000 or more items are returned.

**Gain:** A provider response that omits `items` or returns a partial page can lead to a clean coverage decision and a Bank signature over a burn that destroys an undeclared Core asset.

**Evidence:** Returning `{jsonrpc:"2.0", result:{}}`, `{result:null}`, or a provider response with a short but incomplete page causes `scanPda()` to return no Core holdings and proceed to coverage.

**Fix:** Require a validated DAS response schema, a known slot, explicit pagination termination, and provider-specific completeness metadata. Treat missing `result`, missing `items`, invalid item IDs, HTTP failures, and unexpected pagination fields as fatal. Use at least two independent reads where possible.

## MEDIUM — Token-account scanning trusts account bytes without validating the returned account

**Construct:** The amount is read directly with `account.data.readBigUInt64LE(64)`. The code does not validate the returned account’s owner, data length, token-account state, mint, or encoding before interpreting it.

The RPC filter narrows the program owner, but the response itself remains unvalidated.

**Gain:** A malformed provider response can throw, causing fail-closed denial of service; a malformed or incorrectly decoded account can be misclassified. The scan also discards all zero-balance accounts, making the returned set unsuitable for any future check that needs account existence, delegates, close authority, or mint identity.

**Evidence:** A synthetic or provider-injected account record with fewer than 72 bytes causes a range exception. An account with an unexpected mint but a nonzero amount is reported merely as a generic token holding.

**Fix:** Use the shared `readTokenAccount` parser, require the expected account owner and mint, verify the encoding, and preserve full account metadata. Fail closed on malformed data.

## LOW — The full-page refusal is conservative but not sufficient

Refusing a response with 1000 items is the right direction, but it is not the only incomplete-answer case. Missing result fields, short partial pages, provider truncation, inconsistent page tokens, stale slots, and HTTP-level failures all need explicit handling. The current code throws on some failures, but accepts structurally incomplete successful responses.

## LOW — Refusing two redemptions is an availability policy, not a safety requirement

The on-chain programs explicitly permit multiple correctly paired redemptions in one transaction. Rejecting two is not a security fix; it increases fees and reduces composability. It is acceptable as an operational limit only if documented as such and tested as a client policy, not presented as necessary for correctness.

# R2 — `bank/lock.mjs`

## HIGH — The restore path can leave two live runners holding the lock

**Construct:** After `renameSync(file, stolen)`, the target path does not exist. The code reads the stolen file and, if it is a replacement lock, attempts:

```js
const fd = fs.openSync(file, 'wx')
...
catch { /* somebody already holds it; theirs stands */ }
try { fs.unlinkSync(stolen) } catch {}
```

The restoration is not atomic with respect to a third claimant.

Interleaving:

1. A reads stale lock `S`.
2. B replaces `S` and claims fresh lock `B`.
3. A renames `B` to A’s temporary name.
4. The lock path is absent.
5. C claims the absent lock and obtains fresh lock `C`.
6. A sees that the stolen token is B’s, not S’s.
7. A’s exclusive restore fails because C now owns the path.
8. A deletes the temporary copy containing B’s lock.
9. B continues running, but its lock has disappeared; C also runs.

With three racers, B and C can both proceed. The same interval exists even if A is only restoring a lock that another process already acquired.

**Gain:** B and C may execute concurrent revenue or distribution jobs, recreating the double-payment condition the rewrite claims to eliminate.

**Evidence:** A multiprocess test must synchronize exactly between the rename and the `wx` restore, not merely invoke `_beforeSteal`. After the test, both the original holder and the new claimant should be allowed into `withLock`; both can then perform a payment operation.

**Fix:** Do not implement lock stealing with a pathname plus restore. Use an OS-level lock held on an open file descriptor (`flock`/`fcntl`) or a lease service. If a stale lock must be broken, use a single kernel-mediated compare-and-replace primitive or stop all money jobs and require an operator-mediated recovery. Never delete a temporary copy belonging to a process that may still be running.

## HIGH — `releaseLock` still has a compare-then-unlink race

**Construct:**

```js
held = JSON.parse(readFileSync(file))
if (held?.token !== token) return false
unlinkSync(file)
```

Another process or operator can replace the file after the token read and before the unlink. The releasing process then deletes the replacement lock.

**Gain:** A slow runner can delete a newer runner’s lock, allowing a third runner to enter while the newer runner is still paying.

**Evidence:** An injected or filesystem-observer test that replaces the lock between `readFileSync` and `unlinkSync` results in the replacement file being deleted and `releaseLock()` returning true.

**Fix:** Replace the pathname protocol with an open-file-descriptor lock. At minimum, release through an ownership primitive that cannot delete a replacement; a token in file contents is not sufficient for atomic compare-and-delete.

## MEDIUM — Atomic file replacement is not durable across host crashes

**Construct:** `writeLedger` fsyncs the temporary file but does not fsync the containing directory after `renameSync`. The marker is written separately and is not fsynced or atomically replaced.

**Gain:** After a power loss, the ledger and marker can disagree. A ledger may be durable while the marker is lost, causing a later deleted ledger to be treated as a first run, or the marker may persist while the renamed ledger does not, causing an operational refusal.

**Evidence:** A crash/power-loss or filesystem fault-injection test around marker write and rename yields combinations not represented by the recovery logic.

**Fix:** Use a durable journal or database. If retaining files, atomically replace both records, fsync the file, rename, fsync the directory, and define recovery for every ordering.

## MEDIUM — The lock file is not protected against same-host tampering

The lock, marker, and ledgers are ordinary files under the same user context as the money keys. A process with that account’s filesystem access can remove or rewrite them. This is not a Solana exploit, but it defeats the double-payment and reconciliation controls without needing the signing key.

**Fix:** Separate privileges, use a service account with restrictive ownership and permissions, store ledgers in an append-only or database-backed system, and make payment decisions chain-derived.

# R3 — Other repairs

## HIGH — Acknowledgements can mute any finding that carries an asset

**Construct:** `applyAcks()` accepts any `<kind>:<asset>` string with a nonempty reason and changes its severity to `INFO`. There is no allowlist of acknowledgeable kinds, expiry, approver identity, signature, or revalidation.

An operator can acknowledge:

- `vault_burned`;
- `vault_left_index`;
- `undeclared_token_account`;
- `approve_by_vault_pda`;
- `unredeemable_owner`;
- any future CRITICAL detector that includes an asset.

The finding remains printed, but the paging path only acts on CRITICAL/HIGH findings. An INFO finding is operationally close to silenced.

**Gain:** A genuine customer-funds finding can be made non-urgent permanently by a one-line file edit.

**Evidence:** Add `{"vault_left_index:<asset>":"accepted"}` or `{"undeclared_token_account:<asset>":"accepted"}` to `acks.json`; the next report contains no urgent alert and exits with no urgent status.

**Fix:** Allow acknowledgements only for explicitly classified, non-safety findings. Store approver, timestamp, expiry, evidence, and change-control ID. Never downgrade findings involving loss, unauthorized movement, incomplete redemption, or unverified chain state. Keep acknowledged CRITICAL findings in a separate urgent summary.

## HIGH — `correlateBurns` relies on an attacker-controlled correlation asset

**Construct:** `detectBurns()` emits `burn_via_program` for any successful-looking instruction addressed to the BURN program and takes `ix.accounts?.[0]` as the asset. It does not establish that the asset is in the CBOB collection or that the instruction succeeded with the expected account set. `correlateBurns()` then uses that caller-supplied asset string as the key for downgrading other findings.

**Gain:** A future or malformed BURN instruction can create a false correlation key. Any finding for the same asset in the same pass can then be downgraded by `REDEMPTION_NOISE`. The current on-chain BURN validation reduces the reachable cases, but the detector is making a safety decision from an unverified account position.

**Evidence:** Feed `detectBurns()` a BURN-program instruction with the expected discriminator and an unrelated asset at account 0; it emits `burn_via_program` even when the asset is absent from `assetSet`. The existing selftest does not assert that such a BURN finding is rejected.

**Fix:** Require exact decoded account layout, transaction success, expected BURN config, collection membership, owner binding, and preferably a matching `VaultBurned` event. Correlate by a chain-derived event, not by an instruction’s untrusted positional account.

## MEDIUM — `unredeemable_owner` has marketplace false positives and an unavoidable detector blind spot

The detector correctly identifies off-curve owners as unable to participate in the top-level redemption pair, but it classifies marketplace escrow and permanently unusable ownership identically. This can cause operators to acknowledge or ignore repeated CRITICALs. Conversely, if the owner field is absent, malformed, or the injected curve function fails, the detector returns no finding.

**Fix:** Distinguish known marketplace escrow contracts from arbitrary program addresses, and report “ownership cannot be classified” separately from “off-curve owner.” Add tests for real marketplace custody and transfer-delegate models.

## MEDIUM — The selftests are not independent of the implementation

The new tests construct synthetic instructions using the same hard-coded assumptions as the implementation:

- `burnFixedAccounts: 11`;
- account 0 and 2;
- discriminator arrays;
- declared-count placement.

They do not parse an actual serialized customer transaction, a versioned message, signer headers, address tables, or real DAS responses. A code change can preserve the test fixture’s shape while violating the actual wire format.

**Fix:** Add black-box tests using transactions built by the real Anchor/client interfaces, then mutate serialized messages and account metadata. Add integration fixtures for RPC and DAS response failures.

# R4 — Documentation and control drift

## HIGH — BURN still claims a control that does not run

The BURN header says:

> “Owner AND Bank must sign — the Bank because this is the one instruction that can permanently remove value, so it must SCAN THE PDA BEFORE IT SIGNS and alarm on every call.”

This is false as an operational statement. The Bank does not scan and sign through the BURN program. The newly added CLI is not wired into the redemption path, and its scan is a mitigation with a race.

This directly violates the project’s own comment rule.

**Fix:** Point to the actual control table, and state that the BURN program enforces only declared-account checks; any pre-signing scan is performed only if the external co-signer service is actually used.

## HIGH — MINT still claims `Signer` is “strictly stronger” than an on-curve test

The `MintVault.owner` comment says requiring a signature is “strictly stronger” and implies it excludes PDA ownership. The round-14 repair itself documents the counterexample: a PDA can be marked signer during CPI. A DAO/Squads treasury can therefore mint a vault it owns.

**Fix:** Replace the comment with the exact limitation: `Signer` proves the address participated as a signer in this invocation, not that it can sign the two required top-level redemption instructions. Add an integration test that mints with a PDA as the CPI signer and verifies the post-mint detector.

## MEDIUM — Stale `close_redemption` references remain

SEAL’s reserve-list documentation still says:

> “`close_redemption` requires each of these to be declared…”

The v5 program has no `close_redemption`. Similar stale v2–v4 language remains in comments describing the redemption stamp and surviving vault.

**Fix:** Remove or rewrite every stale reference. Add a documentation lint that rejects removed instruction names and assertions such as “close”/“re-seal” in v5 control descriptions.

## MEDIUM — MINT’s `BadSplit` error message remains false

The error says:

> “split_bps must be <= 10000 and a multiple of 100 so the royalty plugin can express it”

The royalty plugin does not use `split_bps`; it writes a separate royalty rate and creator list.

**Fix:** Correct the message to state the actual business invariant, or introduce a separate named validation if the royalty relationship is intended.

## MEDIUM — The control table overstates `bank/cosign.mjs`

SPEC says `bank/cosign.mjs` performs the pre-signature control. In the repository, it is an unauthenticated, manually invoked CLI, not an enforced service. The table should distinguish “implemented code exists” from “all redemptions pass through it.”

# Carry-over findings

## HIGH — Cross-pass correlation lag can emit and permanently retain the wrong CRITICAL

The current `correlateBurns()` only correlates findings present in the same pass. If DAS observes a burned vault first and the signature walk observes its `burn_vault` later, the CRITICAL is reported before correlation. The next pass may downgrade a new or repeated finding, but nothing retracts the already delivered alert or records that the original alert was later explained.

**Evidence:** Mock pass 1 with `vault_burned(asset)` and no `burn_via_program`; pass 2 with only `burn_via_program(asset)`. The first CRITICAL remains in delivered history with no correction.

**Fix:** Maintain a bounded, durable pending-correlation state keyed by asset and event slot/signature. Emit “pending verification” first where appropriate, or issue an explicit correction when later evidence arrives.

## MEDIUM — Compute-unit capacity remains unmeasured

The byte ceiling does not establish that three-reserve redemptions fit the compute budget. Each reserve adds Core Execute work, token transfers, account closes, ATA/account checks, and BURN parsing.

**Evidence:** `simulateTransaction`/confirmed transaction metadata showing `unitsConsumed` near or above the configured/default CU limit for the 3-mint worst case.

**Fix:** Measure worst-case CU with all reserves, lamport sweep, account closes, destination ATA creation where applicable, and real signer/account sets. Add a CI ceiling with margin and explicitly set the compute budget if required.

## MEDIUM — Fixed offset 45 makes program hash monitoring incomplete for immutable programs

`readConfigs()` always hashes `acc.data.subarray(45)`. For an upgradeable ProgramData account with no upgrade authority, the ELF begins at offset 13. The first 32 ELF bytes are omitted, so changes in that region are invisible and the reported hash is not the ELF hash.

**Evidence:** Compare two immutable ProgramData blobs differing only in bytes 13–44; the detector produces the same hash.

**Fix:** Hash from `13` when `acc.data[12] === 0`, otherwise from `45`. Add immutable and upgradeable fixtures for every watched program, including Core.

## HIGH — Foreign Core assets nested inside vault PDAs remain destroyable

The alarm checks only CBOB assets from the collection. A foreign Core asset can be transferred into a vault’s asset-signer PDA, remain invisible to `detectNestedVaults` and the daily token-account reconcile, and be destroyed when the outer vault is redeemed.

**Evidence:** A foreign Core asset owned by the vault PDA is absent from the current reconcile findings, while the outer burn succeeds without declaring it.

**Fix:** Perform per-PDA DAS ownership enumeration for all Core assets, or explicitly prohibit custody of foreign assets through an operational and pre-signing rule. The Bank co-signer must reject any scanned Core asset, regardless of collection.

## HIGH — Distribution still trusts a payer-controlled ledger

The distributor decides whether transfers already occurred from `distributions.json`, written by the same process and user that sends the transfers. A compromised process can delete or rewrite rows, and the current chain reconciliation is insufficient to prove all expected payments.

**Evidence:** Delete or alter a paid row, run distribution, and observe a second transfer or a changed allocation.

**Fix:** Derive payment state from chain history and destination balance deltas, or use an append-only externally authenticated ledger. Use a fresh per-cycle operator/distributor wallet as previously required.

## MEDIUM — SPEC and test counts remain stale

SPEC still documents old assertion counts and old invocation behavior. This is particularly dangerous because operators may run a command believing it certifies more than it does.

**Fix:** Generate test counts into documentation or remove counts from prose. Make the ship gate validate that the documented commands and actual commands match.

## MEDIUM — Dead redemption attributes and duplicate keys remain

`MINT` still reserves the obsolete `redemption` attribute and delegates the Attributes plugin to a SEAL PDA that does not write attributes. Duplicate attribute keys are accepted, allowing ambiguous provenance.

**Fix:** Remove dead fields/comments or implement the intended writer. Reject duplicate attribute keys and define canonical attribute semantics.

## MEDIUM — Governance and buyer timing limits remain

A vault minted during an active proposal can vote, and a buyer cannot atomically verify reserve continuity at purchase. The current controls are documentation and Bank duties, not enforcement.

**Fix:** If unacceptable, add creation-slot eligibility or a holder snapshot. For purchases, require a transaction-level balance/provenance attestation or move the reserve into a structure with atomic verification.

# Verdict challenges

## Admin exemption

The exemption is substantively correct based on the shown program interfaces. `update_config`, `update_wiring`, `set_paused`, and related admin operations are ordinary top-level instructions and do not use instructions-sysvar introspection requiring the admin to appear as a top-level signer of nested operations. A Squads PDA can authorize them through CPI.

However, this conclusion must remain limited to the current instruction set. Any future admin instruction that invokes or checks top-level instruction context would invalidate the exemption. Add a test that exercises every admin instruction through a Squads-style CPI wrapper, not merely a pure detector test.

## Closed-ATA delegate allow

The allow is correct for the measured case: once the token account is closed, its delegate and close authority no longer exist, and a newly created ATA is a fresh account. The test should nevertheless assert that the destination of the close is not attacker-controlled in a way that creates a replacement account or causes rent/account poisoning.

## “Create destination ATAs first” is not sufficient

The requirement is operationally insufficient by itself:

- clients can ignore it and create a transaction that exceeds the legacy packet limit;
- an attacker can poison a derived destination ATA before the client creates it;
- a missing or poisoned ATA can make the redemption fail indefinitely;
- the requirement is not enforced by SEAL or BURN;
- a future client may create only some ATAs and then fail during serialization.

A failed transaction is atomic and does not steal the reserve, but it is still a customer-facing denial of service. The client should perform a preparatory transaction, verify the resulting ATAs’ owner/mint/length/state, and the co-signer should reject a redemption whose destinations are absent or malformed. The UI and API must not allow a redemption request until the preparatory state is confirmed.

# Additional finding

## HIGH — Core upgrade monitoring detects changes after they can affect live customer funds

The alarm watches Core’s ProgramData authority and hash, but it is still post-hoc. A Core upgrade can change `BurnV1`, `ExecuteV1`, plugin semantics, or account handling and affect a redemption before the next alarm pass. The local validator gate does not protect production, and the production watcher cannot prevent the upgrade.

**Evidence:** Change or simulate the Core ProgramData authority/code between alarm passes; the first affected transaction can execute before the next report.

**Fix:** Put Core behind an operational admission gate:

- pause minting and redemptions on any Core authority/hash change;
- require explicit human approval before resuming;
- maintain a known-good Core hash allowlist;
- monitor upgrade transactions directly with a low-latency alert;
- if possible, use a controlled Core deployment or a protocol design that does not depend on mutable external semantics.

# Given that no human firm will ever see this

Fifteen AI rounds cannot substitute for independent operational control. The project should not ship based on another text review. It should do the following:

1. **Freeze the exact source and produce reproducible artifacts.**
   Record commit, toolchain, Core hash, every program hash, configuration, and dependency lockfiles.

2. **Run an adversarial black-box campaign.**
   Use independent operators—not the author of the code—to deploy the frozen artifacts, create real vaults, poison accounts, race locks, mutate RPC responses, submit malformed transactions, and attempt customer-composed co-signing attacks.

3. **Remove the customer-controlled co-signing surface.**
   The Bank must construct and sign an allowlisted transaction, not sign arbitrary customer bytes. The service must be the only path to a Bank signature.

4. **Replace the filesystem money ledgers and pathname lock.**
   Use an OS lease or database transaction for exclusivity and an append-only, independently authenticated chain reconciliation for payments and swaps.

5. **Require two-person production approval.**
   One person or process must not be able to deploy programs, alter the ship gate, modify acknowledgements, operate the Bank key, and change the monitoring configuration.

6. **Add fail-closed production drills.**
   Rehearse Core upgrades, RPC outages, DAS truncation, missing ledgers, poisoned ATAs, notification failure, process death, power loss, and signer-key rotation. The expected result must be an explicit halt with recoverable state.

7. **Do not treat the current suite as proof of absence.**
   The suite is largely self-authored, synthetic, and coupled to implementation assumptions. Require independent test generation, mutation testing, property-based fuzzing, and black-box transaction testing before any customer funds are accepted.

The current state is not a certification-ready custody system. It has several correct-looking mitigations, but the most important new one is not safely constrained or operationally enforced, and the replacement lock still admits a double-run interleaving.