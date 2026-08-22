# R1 — Co-signer

## HIGH — The allowlist does not constrain redemption semantics

**Construct:** `judgeRedemptionTx` permits arbitrary top-level instructions for Core, both token programs, ATA, System, and ComputeBudget, provided they do not list the Bank.

**Impact:** A customer can obtain a Bank signature on a transaction containing:

- Core Execute instructions for the redemption vault that sweep reserve tokens to an address other than `owner`;
- token `CloseAccount` instructions whose lamports go to an unexpected recipient;
- token instructions involving unrelated accounts;
- Core instructions concerning other assets;
- System instructions that spend the customer’s accounts or alter customer-created accounts;
- an in-transaction transfer into a PDA-owned token account after `scanPda` has completed.

The first case is not merely “the customer spending their own money.” It lets a redemption transaction destroy the vault while directing the reserve to an arbitrary third party. A compromised owner, malicious client, or phishing flow can therefore turn the Bank’s signature into approval of a non-owner payout. The Bank’s stated purpose is not only to protect Bank SOL; it is also the completeness and destination control for customer reserves.

**Evidence:** Build a valid redemption with a Core Execute sweep whose destination is `attackerAta`, not the owner’s ATA. `judgeRedemptionTx` returns `ok: true`, and the chain completes the sweep followed by `burn_vault`. The resulting token balance is at `attackerAta`, while the vault is burned. Similar evidence exists for `CloseAccount` with an attacker destination.

**Fix:** Parse a complete redemption grammar, or reduce the Bank-signed transaction to a server-generated canonical message. At minimum bind:

- every Core Execute to the redemption asset and its asset-signer;
- every token source to a declared account owned by that asset-signer;
- every destination to the current owner or an explicitly approved owner-controlled ATA;
- every close destination to the owner;
- every System transfer source and destination;
- no instructions for unrelated assets;
- no duplicate or unexpected writable accounts.

The allowlist is useful as a coarse filter, but it is not a semantic authorization boundary.

## HIGH — Arm 1 protects the Bank account only when the Bank is passed as an account

**Construct:** The Bank confinement check uses:

```js
(ix.accounts || []).includes(cfg.bank)
```

This does not check `isSigner`, nor does it inspect the message’s signer set.

**Assessment of the proposed bypasses:**

- **Address lookup tables:** not an exploit against this implementation because `Transaction.from` rejects v0 transactions. The result is fail-closed availability loss, not hidden Bank-authority use.
- **Duplicate account metas:** do not bypass the check. Any duplicate occurrence of the Bank pubkey is still detected. Duplicate metas can cause semantic confusion, but not an invisible Bank account.
- **Nested CPI:** a CPI can exercise a signer only for accounts passed into the CPI. If the Bank account is not passed to the top-level instruction, the callee cannot use the Bank’s signer privilege. A malicious allowed program can read other instruction data or signer information, but it cannot make the Bank sign an account that is absent from the instruction account list.
- **Instructions sysvar:** a program can observe the instruction list, but the sysvar does not grant access to the Bank account or transfer authority. It is not a bypass by itself.
- **Fee payer:** this was correctly identified separately. The fee payer is not in instruction account lists.

The claim that presence is “the whole test” is therefore too broad. It is sufficient for preventing direct use of the Bank account in ordinary instructions, but it is not an authorization proof for arbitrary permitted programs.

**Evidence:** A custom or permitted instruction with no Bank account cannot debit the Bank account through the runtime. Conversely, a fee-payer transaction visibly debits the Bank without listing it in any instruction; the existing `feePayer` test catches this only when the caller supplies the field.

**Fix:** Decode and verify all signer metadata, reject any Bank signer role outside the two expected instructions, and treat any inability to determine the fee payer or version as refusal. More importantly, do not treat this arm as replacing semantic instruction validation.

## MEDIUM — `feePayer: null` is accepted although the Bank payer may be unknown

**Construct:**

```js
if (cfg.feePayer !== undefined && cfg.feePayer === cfg.bank) ...
```

`null` is accepted, and unknown payer information does not cause refusal.

**Impact:** Any alternate caller of `judgeRedemptionTx` that cannot resolve the fee payer can pass a transaction whose Bank fee-payer status is unknown. The production caller currently obtains it from `Transaction`, but the pure judge’s fail-closed property is incomplete and easy to lose when reused.

**Evidence:** The selftest explicitly asserts that `feePayer: null` passes. A fixture with the fee payer omitted or unresolved therefore receives an apparently clean result.

**Fix:** Require a valid fee payer for a signing decision. `null`, malformed, or unavailable payer data should be a refusal, not a clean result.

## MEDIUM — The Token-2022 “165 bytes” discriminator is conservative but not a type proof

**Construct:** `classifyPdaTokenAccount` treats every account whose length is not exactly 165 as undeclarable, while treating every 165-byte result as a classic account based only on length and the base amount.

**Impact:** Length does not prove the account’s semantic layout. A Token-2022 account without extensions can have the base 165-byte layout, while extension-bearing accounts may have different lengths. The scan also does not validate the token account’s owner, mint, authority, delegate, close authority, or TLV structure at this point.

The conservative direction prevents the known silent-loss case, but the implementation can still misclassify malformed or unexpected 165-byte accounts as ordinary token accounts. That can lead to a clean coverage result for an account whose actual mint or authority is not what the Bank believes.

**Evidence:** Supply a 165-byte Token-2022 account or a 165-byte account with a different mint/owner to the classifier. It is treated as an ordinary token holding and can pass if declared. The classifier itself has no information with which to distinguish these cases.

**Fix:** Validate account owner, token-account state, mint, token authority, delegate, close authority, and TLV extensions. For Token-2022, either implement a complete supported-extension parser or refuse the account independently of its length.

## MEDIUM — `scanPda` still trusts a plausible but incomplete DAS response

**Construct:** The new check requires `result.items` to be an array and rejects length `>= 1000`, but accepts any array shorter than 1000 as complete.

**Impact:** A provider can return HTTP 200 with a syntactically valid but truncated or incomplete list, for example because of an internal page limit, partial indexing, stale materialization, or an envelope that omits pagination metadata. The co-signer then interprets the incomplete list as “owns nothing else” and can sign a destructive burn.

**Evidence:** Return:

```json
{"result":{"items":[]}}
```

or a short prefix of the actual holdings with no pagination metadata. The function returns normally and coverage can pass. This is distinct from the already-fixed `{}`, `result:null`, and HTTP-error cases.

**Fix:** Require and verify DAS pagination metadata, query until an authenticated/declared terminal condition, cross-check counts against an independent source, or refuse to use DAS as a completeness proof.

## MEDIUM — The main alarm’s `listVaults` still has the old DAS fail-open shape

**Construct:** `bank/alarm.mjs:listVaults` still uses:

```js
const items = j.result?.items || []
```

and does not check `r.ok` or require an array.

**Impact:** The separate reconciliation scan was hardened, but the primary alarm’s collection-wide scan was not. A 200 response with `{}`, `result: null`, or a result lacking `items` is converted into an empty collection. Missing ownership fields are also converted to `null` and silently excluded from nested-vault detection.

The index-shortfall check catches many cases when `minted_total` is nonzero, but not all cases. A first-run or zero-supply state can still look clean, and a response with a plausible count but missing `ownership.owner` can suppress nested-vault findings.

**Evidence:** Stub `getAssetsByGroup` with HTTP 200 and `{}` while `minted_total` is zero: `listVaults` returns empty arrays without throwing. Stub an item with no `ownership` field: `detectNestedVaults` skips it.

**Fix:** Apply the same HTTP and shape checks to `listVaults`; reject missing IDs, ownership fields, pagination metadata, and inconsistent burnt/live status.

## MEDIUM — Coverage refusal creates an attacker-controlled automated redemption DoS

**Construct:** Any party can create an extension-bearing Token-2022 account owned by a vault’s asset-signer PDA. `scanPda` identifies it as `undeclarable`, and `judgeRedemptionCoverage` refuses even when the account is declared.

**Impact:** A one-transaction dust attack can prevent the automated redemption path for an otherwise healthy vault indefinitely. The human escape is not an operationally reliable control for a system holding customer funds; it is an emergency override whose safety depends on manually proving the account’s value and handling it correctly.

The visible refusal is safer than silently destroying the account, but the availability impact is still a real vulnerability.

**Evidence:** Create an extension-bearing account owned by the vault PDA, fund it minimally, and run the co-signer. It refuses every clean redemption until the account is manually resolved.

**Fix:** Provide a supported recovery path: allow the owner to remove/close harmless extension accounts through a controlled pre-redemption workflow, classify known harmless extensions, and require an explicit signed recovery transaction for nonzero or confidential balances. Do not rely on an undocumented “sign manually” escape.

# R2 — Locking and cron

## HIGH — `flock` does not protect hand-run jobs or cross-entrypoint races

**Construct:** Cron uses separate OS locks:

```text
alarm.flock
distribute.flock
revenue.flock
reconcile.flock
```

while the JavaScript jobs use separate pathname locks. A hand-run job does not acquire the corresponding `flock`.

**Impact:** The exact in-process pathname-lock race remains exploitable for manual invocations. More importantly, operators may believe “the money job is under flock” while a shell, deployment script, systemd unit, or manual invocation bypasses it. The project explicitly says the cron lease is load-bearing, but it is only load-bearing for those exact crontab lines.

**Evidence:** Start the cron command under `flock`, then invoke `node bank/distribute.mjs` directly. The direct process does not hold the OS lock and enters the JS lock path. Reproduce the previously measured restore-hole interleaving to obtain concurrent execution.

**Fix:** Put `flock` in a wrapper executable that is the only permitted entrypoint, or acquire an OS-level lock inside the jobs themselves before any pathname-lock logic. Do not treat a cron-template prefix as enforcement.

## MEDIUM — `judgeCronTemplate` is not a reliable gate

**Construct:** The checker accepts any line matching:

```js
/^[0-9*]/
...
/node\s+bank\/\S+\.mjs/
...
/\bflock\b|\$FLOCK\b/
```

It reads the shell template, not the installed crontab.

**Impact:**

- It misses `@daily`, `@hourly`, and indented cron entries.
- It accepts a line containing an unrelated `flock` word or command, even if the Node process is outside the lock.
- It does not require `-n`.
- It does not require the expected lock directory or a unique lock per job.
- It does not inspect the installed crontab after `crontab "$TMP"`.
- A hand-edited crontab can remove the lock while the selftest remains green.

A template assertion is therefore only a weak source check, not proof of the deployed schedule.

**Evidence:** These lines pass or evade the check despite not providing the intended control:

```text
@daily cd /opt/cbob-vaults && node bank/distribute.mjs
7 9 * * * echo flock && cd /opt/cbob-vaults && node bank/distribute.mjs
7 9 * * * cd /opt/cbob-vaults && /usr/bin/flock /tmp/x true; node bank/distribute.mjs
```

**Fix:** Generate a wrapper script and assert the installed crontab contains exact expected command hashes. Validate ordering, `-n`, lock paths, and command boundaries rather than searching for a substring.

## MEDIUM — Cron failure is not operationally distinguished from a skipped run

**Construct:** `flock -n` returns status 1 when a lock is held, but the cron line only redirects output to the job log. There is no dedicated alert for an expected lock refusal and no monitoring of its exit status.

**Impact:** An overlapping distribution or revenue run is aborted, but the event is indistinguishable from a job failure or ordinary log noise unless someone inspects the log. Repeated lock contention can suppress payouts without producing a direct alert. The “never queue” policy is safe only if lock refusals are monitored.

**Evidence:** Hold `/var/lock/cbob/distribute.flock`, allow cron to fire, and observe exit status 1 and a log entry but no notification or deadman distinction.

**Fix:** Wrap each command with a small launcher that distinguishes `flock` exit 1 from application failure and alerts after a threshold. Monitor job completion, not merely state-file freshness.

## LOW — The pure-filesystem claim is too absolute

The claim that no arrangement of `rename`, `link`, and `unlink` can provide the required compare-and-swap is effectively true for this pathname protocol: rename is atomic but unconditional, and there is no atomic “rename only if source still has token X.” However, a pure-filesystem design can avoid the stale-lock break entirely by using a lock directory created with `mkdir`/`O_EXCL` and never allowing ordinary workers to steal it, with stale recovery performed by an external supervisor or lease mechanism.

This does not close crash recovery automatically, but it demonstrates that the only choices are not precisely “pathname break or native `flock`.” The current code’s real weakness is its attempt to combine stale recovery with mutual exclusion.

# R3 — Acknowledgements

## MEDIUM — `ACKABLE_KINDS` includes conditions that can be acted upon

**Construct:**

```js
new Set(['vault_owns_itself', 'nested_vault', 'unredeemable_owner'])
```

**Impact:** `nested_vault` is often recoverable while the host vault remains live: transfer the inner vault out before burning the host. `unredeemable_owner` can also be recoverable when the address is a marketplace escrow or an organization that can transfer the asset back to a signable wallet. The implementation itself admits both possibilities.

Downgrading these to INFO can suppress the urgency of a customer asset that still has a recovery action.

**Evidence:** For `nested_vault`, transfer the inner asset out of the host PDA and observe that the condition clears. For an escrow-style off-curve owner, transfer the vault back to an on-curve wallet and observe that redemption becomes possible.

**Fix:** Make only mathematically permanent conditions acknowledgeable, likely `vault_owns_itself` and perhaps `nested_vault` only after the host has been burned. Otherwise require a separate resolution state with an expiry, owner, evidence, and re-evaluation rather than a permanent INFO downgrade.

## LOW — Refused acknowledgement text is unbounded

**Construct:** `parseAcks` accepts arbitrary nonempty strings, and `applyAcks` embeds them into every matching report and notification.

**Impact:** A local attacker who can modify `acks.json` can insert a very large or control-character-heavy reason. This can inflate logs, notification arguments, SMS/email payloads, or cause command/transport failures. The refusal remains at full severity, but the reporting path can be degraded or flooded.

**Evidence:** Put a multi-megabyte reason or strings containing newlines/control characters into `acks.json`. The report expands the finding and passes it to `notify-gary-sms.sh`.

**Fix:** Bound reason length, reject control characters, escape output, and report refused ack keys once per pass rather than appending attacker-controlled text to every finding.

# R4 — Round 16 repairs

## MEDIUM — `readProgramData` treats every non-`1` option tag as `None`

**Construct:**

```js
const hasAuth = data[12] === 1
return { hasAuth, elfOffset: hasAuth ? 45 : 13, ... }
```

**Impact:** A malformed or unexpected option tag, such as `2`, is classified as immutable and hashed from offset 13. The watcher can establish a baseline over an invalid ProgramData layout rather than refusing. The valid offsets 13 and 45 are correct for the supported loader format, but the parser does not validate the format.

**Evidence:** Pass a buffer with `data[12] = 2`; the function returns `hasAuth: false`, `elfOffset: 13`, and no error.

**Fix:** Require the ProgramData enum and valid option tag explicitly. Reject malformed lengths and any tag other than `0` or `1`; validate the ELF magic at the computed offset before hashing.

## MEDIUM — `BANK_KEYS` detects disagreement but not an incomplete bank set

**Construct:**

```js
const banks = BANK_KEYS.map(...).filter(([, v]) => v)
if (banks.length > 1 && distinctBanks.size > 1) ...
```

**Impact:** If only one or two bank values are available, `banks_disagree` is suppressed. This depends on `missingWatchedKeys` catching the omission, but that check exempts an entire program when `prog._missing` is set and does not distinguish “program absent” from “the config read failed or was malformed.” During a partial read, a bank mismatch can therefore be hidden.

**Evidence:** Supply `seal.bank = A` and omit `burn.bank`, while marking the burn program as missing or causing its read path to produce only a deployment marker. `detectStandingRisks` emits no `banks_disagree`.

**Fix:** Treat the bank set as an all-or-nothing invariant once the relevant programs are deployed. Missing or malformed bank values should produce a CRITICAL unreadable/incomplete-wiring finding, not “no disagreement.”

## MEDIUM — Bank rotation can cause deliberate but prolonged global denial of service

**Construct:** Each program independently applies its bank rotation. `banks_disagree` is raised only after the configs differ, and BURN/SEAL then reject redemption with `WiringDiverged`.

**Impact:** A legitimate staged rotation produces a period in which minting or redemption is halted. A failed operator action, an unavailable permissionless apply transaction, or a rotation applied to one program first can stop all redemptions. CRITICAL is justified for the resulting halt, but the detector does not distinguish “expected staged rotation” from unauthorized divergence, creating alert fatigue exactly around a control that requires immediate attention.

**Evidence:** Apply a SEAL bank rotation without applying BURN’s. Redemptions fail with `WiringDiverged`; the alarm reports CRITICAL. Apply all three later and observe recovery.

**Fix:** Use one canonical bank account or a coordinated rotation epoch/version shared by all programs. If separate fields must remain, expose pending/current epochs and make the on-chain programs reject or accept only a coordinated activation.

## MEDIUM — The “exactly one Bank key reader” assertion is bypassable by trivial refactoring

**Construct:** The selftest searches only `.mjs` files and only two textual patterns:

```js
CBOB_BANK_KEY
keys/bank.json
```

It does not analyze imports, aliases, dynamic paths, subprocesses, or other extensions.

**Impact:** A second signer can be introduced without failing the assertion:

```js
const env = ['CBOB', 'BANK', 'KEY'].join('_')
fs.readFileSync(process.env[env])
```

or:

```js
import { loadKey } from './key-loader.mjs'
```

The test still reports exactly one reader while a second process can load and use the Bank key.

**Evidence:** Add `bank/impostor.mjs` that imports a helper or assembles the environment name. The production assertion remains green.

**Fix:** Remove direct key-file access from application code and centralize signing in a single audited module/service. Enforce a denylist of signing APIs in all other files, or use static analysis/OS permissions so only one executable identity can read the key.

## LOW — The MINT comment is technically corrected but the on-chain control remains incomplete

The statement that a PDA can appear with `is_signer = true` in an inner CPI is correct. The remaining issue is that `MintVault.owner: Signer` consequently proves only that the invoking program supplied a signer privilege, not that a human-controlled wallet can later produce the required top-level signature. The implementation still relies on the off-chain `unredeemable_owner` detector, which is not wired into mint authorization.

# R5 — Comment and documentation drift

## MEDIUM — BURN still claims an operational control that is not wired

The BURN header says:

> “the Bank ... must SCAN THE PDA BEFORE IT SIGNS and alarm on every call.”

No BURN instruction invokes `bank/cosign.mjs`, and no service forces customers to obtain that signature from this tool. The Bank key can be used by another client implementation. This is not merely a stale historical sentence: it describes a current requirement as if it were an enforced operational fact.

**Fix:** Point only to the control table and explicitly label the co-signer as unwired until an enforced signing service exists.

## MEDIUM — MINT’s `BadSplit` error message still states the deleted royalty mechanism

The error text says:

> “split_bps must be ... a multiple of 100 so the royalty plugin can express it”

The current implementation explicitly says the royalty plugin does not read `split_bps`; the restriction is a holder-payout policy. This is the same drift class in an executable error surface rather than a header.

**Fix:** Change the error text to describe the actual whole-percent holder split policy.

## MEDIUM — MINT still contains dead redemption/provenance claims

The code retains:

- `ATTR_REDEMPTION`;
- comments saying SEAL rewrites a redemption attribute;
- mint comments describing a provenance stamp that the v5 burn permanently destroys;
- references to `close_redemption` in comments.

Some of this is listed as known, but it remains dangerous because clients and operators can infer that redeemed vaults retain provenance or that an attribute is maintained during redemption. In v5 the asset is burned and no surviving asset can carry the stamp.

**Fix:** Remove dead constants and rewrite the provenance documentation around mint transaction history and burnt DAS records.

## LOW — `SPEC.md` still mixes “the Bank duty” with “the Bank control”

The table correctly says the co-signer is unwired, but later sections describe the Bank’s refusal to co-sign mints as “the control” and state that supply growth is “never silent.” There is no mint co-signing service, and `minted_total` monitoring is delayed and post-hoc. The distinction between a written duty, an alarm, and an enforced pre-signature control needs to be made consistently.

# R6 — Gates and test integrity

## HIGH — Assertion counts can be preserved while all meaningful assertions are deleted

**Construct:** Floors check only the number of calls/results:

- `FLOOR = 328`;
- `DET_FLOOR = 328`;
- `MIN_ASSERTIONS = 270`;
- allocation floor `17`.

Nothing binds the count to specific assertion IDs, detectors, source properties, or coverage of both positive and negative cases.

**Impact:** An edit can delete all meaningful tests and replace them with trivial assertions such as `t('placeholder', true, true)`. The build remains green at the required count. This is particularly serious because the project treats the floors as certification.

**Evidence:** Replace a meaningful detector test with repeated `t('padding', true, true)` calls until the floor is met. The selftest exits zero and the runner accepts it.

**Fix:** Require a manifest of assertion IDs and compare it against a committed expected set. Reject duplicate IDs, require every detector/control to have named positive and negative cases, and hash the test sources or review them as part of the freeze process.

## MEDIUM — Source-regex assertions can pass for the wrong reason

Several assertions use regexes over source text. Examples include:

```js
BURN_SRC.match(/pub struct BurnVault<'info> \{([\s\S]*?)\n\}/)
```

and the alarm guard check:

```js
/if \(s\.err\) continue/
```

These checks verify textual presence, not execution or semantics. A dead comment, unreachable branch, string literal, or renamed equivalent can invalidate the intended property while preserving or breaking the regex independently.

**Evidence:** Move the `if (s.err) continue` into dead code or a comment-like string and leave the actual transaction loop decoding failed transactions. The assertion passes. Conversely, refactor to braces:

```js
if (s.err) { continue }
```

and the assertion fails despite unchanged behavior.

**Fix:** Test behavior with a controlled fixture or export the relevant function. Use AST-based checks where source inspection is unavoidable.

## MEDIUM — The new `BURN_FIXED_ACCOUNTS` assertion checks field count, not account order

**Construct:** The test counts fields in `BurnVault` and compares the number to `11`. It does not verify that the first eleven fields are the exact order expected by the co-signer.

**Impact:** A source edit can preserve the field count while changing account order or replacing one field with another. The co-signer continues slicing at 11 and checking indices 0/2/3. Depending on the change, it can parse the wrong declared accounts or approve a transaction whose declared-account boundary is not what BURN uses.

Many order changes will fail closed because the two programs’ instruction-sysvar checks reject them, but the assertion does not establish that property and does not detect all semantic drift.

**Evidence:** Reorder fields while keeping 11 total and leave the manually pinned index constants unchanged. `3.1g` and `3.1h` remain green.

**Fix:** Assert the complete ordered field-name sequence and independently derive/verify every fixed account index and the declared-account boundary.

# Carry-over and verdict challenges

## HIGH — The co-signer is still not a control, and its scope is narrower than the stated Bank duty

This is known, but it is worse than merely “a CLI nobody calls.” The specification assigns the Bank two duties:

1. refuse unsafe redemptions;
2. refuse mints during proposal voting and refuse unsupported charter-priced mints.

`cosign.mjs` implements neither mint policy. A separate signer can approve `mint_vault`, and no cron or service intercepts it. The “Bank co-signature” is therefore an on-chain signer requirement, not a policy enforcement point.

**Smallest real control:** make the Bank key unreadable by all clients except one signing service; require every mint and redemption client to submit an unsigned transaction to that service; have the service parse and approve both instruction classes. The on-chain `Signer` constraint alone does not enforce the policy.

## HIGH — Ledger-based distribution remains forgeable by the payer

The distribution and revenue ledgers are still local files written by the same process that controls the payout key. Atomic writes and fsync reduce crash corruption, but do not establish truth. A compromised distributor can write successful signatures or `resolvedBy` values without corresponding chain transfers, and the current watcher does not fully reconstruct every payout from chain state.

**Evidence:** Modify `distributions.json` to mark a payment `sig: "fake"` or `resolvedBy: "paid by hand"` without a transfer. The detector treats it as settled.

**Fix:** Derive payment state from chain-observed signatures and token balance deltas, with the ledger only as a cursor/cache. Require explicit on-chain evidence for every paid row.

## MEDIUM — The two-reserve destination-ATA requirement is an operational compatibility trap

The measured result that only two reserve mints fit when creating destination ATAs is credible, but the client requirement is not enforced. A first-time redeemer using a three-reserve client can construct a transaction that fails serialization or submission. This creates a customer-facing denial of service at exactly the first redemption.

**Fix:** Provide an enforced preflight that creates and verifies all destination ATAs before constructing the redemption, or supply a canonical redemption builder that refuses to construct an invalid transaction.

## MEDIUM — Compute-unit capacity is still unmeasured

The byte ceiling does not establish that a three-reserve redemption fits the cluster’s compute budget. Core Execute plus multiple token transfers, closes, ATA creation, and the two custom programs may exceed the default or operational CU limit.

**Evidence:** Run the exact worst-case three-reserve transaction with `simulateTransaction` and record `unitsConsumed`; test at the intended compute-budget instruction and on the deployed cluster configuration. A result above the permitted limit would demonstrate a real availability failure despite 1119-byte serialization.

**Fix:** Measure and assert compute units with margin, then include a canonical ComputeBudget limit/price policy in the transaction builder.

## MEDIUM — Cross-pass correlation can still emit stale CRITICALs and then lose context

The alarm can report a CRITICAL before the signature walk sees the corresponding legitimate burn. Although the next pass may correlate it, the original notification is never retracted, and the stored state can contain only the later normalized view. Operators may act on a stale “bare burn” alert or ignore subsequent alerts after repeated legitimate redemptions.

**Fix:** Track finding lifecycle by asset and pass, emit “opened/confirmed/resolved” events, and include correlation status in notifications.

## MEDIUM — Foreign Core nesting remains invisible to post-hoc monitoring

`detectNestedVaults` considers only assets returned from the CBOB collection. A foreign Core asset owned by a CBOB vault’s asset-signer PDA is not represented in that list and is not found by the daily token-account reconcile.

**Impact:** The co-signer may catch it if DAS happens to return it, but the only mandatory periodic detector does not. If the co-signer is bypassed, unwired, or DAS is incomplete, the foreign asset can be destroyed with the host vault.

**Fix:** Query Core/DAS by each asset-signer owner, or explicitly accept that no post-hoc detector covers foreign Core assets and prevent redemption without a complete owner query.

## LOW — Legacy-only parsing is fail-closed for safety but still a product availability defect

The rejection direction is safer than signing an unresolved v0 transaction. It nevertheless means the tool cannot process the transaction shape the project itself identifies as necessary for a fourth reserve mint. Treating this only as a test assertion hides the compatibility requirement.

**Fix:** Implement versioned transaction parsing with resolved address lookup tables, or make the client and protocol permanently document that the Bank-controlled redemption format is legacy-only and capped at three reserves.

# Final assessment

The repairs remove several previously measured fail-open paths, but the principal security claim remains false until the signing path is enforced. The Bank co-signer is not an authority boundary while other clients can use the Bank key, and even when used it approves too much transaction semantics.

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

The project should stop treating more model rounds and larger assertion counts as equivalent to independent security evidence. Concretely:

1. **Put all signing keys behind hardware-backed, policy-enforcing services.** No application, cron job, test, or operator shell should read the Bank/distributor/operator secret directly.
2. **Require canonical transaction construction.** Clients submit typed redemption intents; the service builds the transaction. Do not accept arbitrary customer-composed transactions for co-signing.
3. **Create an independent chain-derived accounting system.** Reconstruct sweeps, returns, splits, and distributions from finalized transaction data and token balances. Local ledgers may be caches, never authoritative records.
4. **Run continuous adversarial property tests, not only fixed assertions.** Generate arbitrary instruction orderings, duplicate metas, malformed DAS responses, ledger mutations, transaction versions, and concurrent lock schedules.
5. **Use two independently implemented verifiers.** One should not share the parser, source regexes, fixtures, or ledger assumptions of the production detector.
6. **Introduce a staged value limit.** Begin with a capped pilot and an automatic circuit breaker on any unexplained burn, payout mismatch, config divergence, or signer-policy violation.
7. **Require reproducible artifact attestation.** Record source commit, toolchain digest, dependency lockfile, binary hashes, deployed program data, and configuration snapshots in an append-only external store.
8. **Make every alert actionable and lifecycle-based.** Each alert needs an owner, deadline, evidence link, resolution proof, and automatic reopening if the condition returns.
9. **Have an independent operator perform recovery drills.** Delete ledgers, corrupt state, kill processes during transfers, rotate every authority, poison ATAs, and recover customer funds on a fresh machine.
10. **Do not ship based on a clean AI verdict.** Ship only after the signing service, independent accounting verifier, recovery drills, and limited-value pilot have demonstrated that the controls operate without relying on comments, source regexes, or an operator remembering a manual escape.