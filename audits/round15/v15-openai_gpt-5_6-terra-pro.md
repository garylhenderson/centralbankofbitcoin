## R1 — `bank/cosign.mjs`

### CRITICAL — The co-signer signs arbitrary customer-selected instructions, including theft from the Bank

**Construct:** `judgeRedemptionTx()` accepts any instruction not addressed to SEAL or BURN:

```js
for (const ix of ixs) {
  if (ix === open || ix === burn) continue
  if (ix.programId === cfg.sealProgram || ix.programId === cfg.burnProgram) {
    bad.push(...)
  }
}
```

`inspect()` normalizes only `programId`, account pubkeys, and data. It discards account writable/signer flags and never applies an allowlist to non-SEAL/BURN instructions. After this check, `tx.partialSign(bank)` signs the complete transaction message.

**Impact:** A customer can submit a syntactically valid redemption containing arbitrary additional top-level instructions and obtain the Bank signature for all of them.

Concrete additions the current tool will bless include:

- `SystemProgram.transfer` with the Bank as writable signer, moving Bank SOL to the attacker.
- SPL Token `Transfer`, `Approve`, `SetAuthority`, `CloseAccount`, or Token-2022 equivalents involving Bank-owned token accounts, where the Bank is an authority signer.
- Calls to any arbitrary program that treats the Bank pubkey as an authority, permit signer, payer, delegate, escrow controller, upgrade authority, or configuration authority.
- A transaction charging fees to the Bank by making it fee payer. This is smaller than direct theft but still an uncontrolled Bank debit.
- Any Core instruction involving assets for which the customer already has authority.
- Compute-budget, nonce, address-management, or other instructions that alter execution semantics or cost. These may be legitimate in some cases, but are presently unreviewed rather than explicitly permitted.

The Bank signature does not mean “sign only the two redemption instructions.” It authorizes the entire message. The presence of a genuine `open_for_redemption` and `burn_vault` does not constrain the other instructions.

The tool will also sign arbitrary instruction ordering outside the two checked instructions. It only enforces `open < burn`; it does not constrain where arbitrary instructions execute relative to them.

**Evidence to verify:**

Construct a legacy transaction containing:

1. valid `open_for_redemption`;
2. a `SystemProgram.transfer({ fromPubkey: bank.publicKey, toPubkey: attacker, lamports: ... })` whose Bank account meta is writable and signer;
3. valid sweep and `burn_vault`.

Pass it to `node bank/cosign.mjs --tx ... --live`. The current shape judge should return `ok: true`, and the returned serialized transaction should contain a valid Bank signature. Submission should transfer the Bank’s SOL atomically with the redemption.

A safer test can use a test Bank funded with a small amount and assert that the co-signer refuses before signing. That test should currently fail.

**Fix:**

Default-deny the entire transaction.

At minimum, the co-signer should parse and require an exact instruction allowlist:

- exactly one SEAL `open_for_redemption`;
- only the specific Core `ExecuteV1` calls needed to sweep the identified vault;
- only validated SPL transfer/close instructions from accounts owned by that vault’s asset-signer PDA to destinations controlled by the redeeming owner;
- at most the narrowly specified PDA-lamport sweep;
- exactly one BURN `burn_vault`;
- optionally narrowly validated ATA creation and ComputeBudget instructions, if operationally required.

It must validate:

- each instruction’s program ID;
- each account pubkey;
- signer and writable flags;
- source and destination ownership;
- token mint;
- transfer amount semantics;
- exact Core Execute payloads;
- no Bank-owned account is writable except the Bank’s required signer meta in the two redemption instructions;
- fee payer policy.

Do not solve this merely by rejecting known dangerous program IDs. The safe model is an explicit redemption transaction grammar.

---

### HIGH — The co-signer does not inspect fee payer, signer set, account privileges, or transaction message version

**Construct:** `inspect()` does:

```js
const tx = Transaction.from(Buffer.from(b64, 'base64'))
const ixs = tx.instructions.map(ix => ({
  programId: ix.programId.toBase58(),
  accounts: ix.keys.map(k => k.pubkey.toBase58()),
  data: [...ix.data],
}))
```

It does not retain or judge:

- `tx.feePayer`;
- required signer list;
- per-instruction `isSigner`;
- per-instruction `isWritable`;
- durable-nonce state;
- address lookup tables;
- message version;
- loaded addresses;
- pre-existing signatures and their identity.

**Impact:** This is the mechanism enabling the preceding theft. Even apart from direct debit instructions, a Bank signature can be repurposed wherever account flags make it meaningful. The tool cannot distinguish “the Bank is merely the required signer in open/burn” from “the Bank is fee payer and authority for another instruction.”

For transaction versions, `Transaction.from()` is a legacy-transaction parser. A valid v0 transaction with address lookup tables will not be meaningfully inspected by this implementation; it should reject rather than sign. That is fail-closed, but it means the claimed redemption capacity migration path using versioned transactions is incompatible with this co-signer until explicit v0 parsing and address-table resolution are implemented.

**Evidence to verify:**

- Build a valid legacy redemption with the Bank as fee payer and inspect it. It should presently be accepted.
- Build a transaction containing a Bank-writable account meta on an unrelated instruction. The judge receives only the pubkey and cannot identify the writable escalation.
- Build a v0 redemption with an ALT. `Transaction.from()` should throw or fail to parse; confirm that the tool never silently converts or signs it.

**Fix:** Preserve and validate the complete compiled message. Add explicit tests for:

- Bank fee payer refusal;
- unexpected Bank signer refusal;
- Bank writable meta refusal outside expected open/burn account positions;
- arbitrary signer refusal;
- arbitrary writable account refusal;
- legacy transaction acceptance only if that is the supported protocol;
- explicit v0 rejection until a complete VersionedTransaction parser plus ALT resolver is implemented.

---

### HIGH — The co-signer’s “complete” DAS scan fails open on malformed or incomplete successful responses

**Construct:**

```js
const j = await r.json()
if (j.error) throw new Error(...)
for (const it of (j.result?.items || [])) { ... }
if ((j.result?.items || []).length >= 1000) throw ...
return owned
```

A response with no JSON-RPC `error` but with a missing, null, malformed, or schema-incomplete `result.items` is treated as an empty asset list.

**Impact:** A DAS provider failure or schema variation can become “this vault owns no nested Core assets,” allowing a burn that destroys an unreported nested asset. The full-page guard catches one particular truncation shape; it does not establish that the response was a valid complete answer.

Examples currently accepted as empty:

```json
{"jsonrpc":"2.0","id":"c","result":null}
```

```json
{"jsonrpc":"2.0","id":"c"}
```

```json
{"jsonrpc":"2.0","id":"c","result":{"items":null}}
```

A provider may also enforce a smaller server-side page limit, omit `items`, return partial data with a non-error envelope, or return pagination metadata inconsistent with the first page. The code treats all but the exactly-1000-item case as complete.

**Evidence to verify:**

Unit-test `scanPda` with mocked `fetch()` responses above. It should currently return an empty asset set and allow coverage to pass. Test a response with `items: []` plus an indicated total or pagination continuation, if supported by the provider schema.

**Fix:**

Fail closed unless all of the following are validated:

- HTTP success status;
- JSON-RPC version/id consistency if relied upon;
- `result` is an object;
- `result.items` is an array;
- every item has a valid asset ID and expected ownership fields;
- pagination metadata proves there is no next page, or page 2 is fetched and required to be empty;
- provider result is tied to a sufficiently recent/minimum-context slot if the RPC supports it.

The “1000 means refuse” guard is directionally correct but is not a complete answer-validation policy.

---

### MEDIUM — `scanPda()` silently discards token accounts based only on base-account amount offset

**Construct:**

```js
const amount = account.data.readBigUInt64LE(64).toString()
if (amount !== '0') owned.push(...)
```

The scan:

- assumes the returned data is a valid binary token-account layout;
- does not validate owner program, length, initialized state, mint, account owner field, or extensions;
- discards every zero-base-amount account;
- does not inspect Token-2022 extensions.

**Impact:** The scan’s statement “everything the PDA owns” is stronger than what it actually reads. In particular, Token-2022 extension-bearing accounts may contain value or state not represented by the classic base `amount` at offset 64. A confidential-balance or extension-bearing account is exactly the class that the on-chain BURN code treats conservatively rather than interpreting as a normal 165-byte account.

Even where a discarded zero account does not contain transferable customer balance, the tool is using it as a completeness proof while not validating its state. That is unsafe design for a control whose consequence is permanent destruction of accounts behind a burned PDA.

**Evidence to verify:**

Create or mock a Token-2022 account returned by `getTokenAccountsByOwner` with:

- base amount zero;
- extension data beyond 165 bytes;
- a meaningful extension state.

The current scan will either discard it as zero or read it as though it were a classic token account. Separately, provide malformed account data shorter than 72 bytes and observe an uncaught range exception rather than an explicit refusal reason.

**Fix:** Use a token-account decoder appropriate to each token program and fail closed on accounts not fully understood. For Token-2022, treat any extension-bearing account as a holding requiring explicit review/declaration, rather than using base amount zero as proof of no value.

---

### MEDIUM — Bank/config disagreement is only discovered by transaction failure, and BURN’s separate bank copy remains operationally dangerous

**Construct:**

- Co-signer reads `seal.bank` at raw offset 73:

```js
const bank = new PublicKey(data.subarray(73, 105)).toBase58()
```

- BURN independently stores `BurnConfig.bank`.
- BURN later requires both:

```rust
require_keys_eq!(ctx.accounts.bank.key(), cfg.bank, BurnError::NotTheBank);
...
require_keys_eq!(Pubkey::new_from_array(b), cfg.bank, BurnError::WiringDiverged);
```

**Impact:** If SEAL and BURN Bank values diverge, the co-signer will sign using the SEAL Bank but BURN will reject because BURN requires its own Bank and requires SEAL’s Bank to equal it. This fails closed for asset movement because the transaction is atomic, but it causes a redemption outage. The co-signer does not diagnose the actual cross-program disagreement before asking the Bank to sign.

This is not a theft path under the shown code; it is a recovery and availability failure on the irreversible exit path.

**Evidence to verify:**

On a validator, arm/apply a SEAL Bank rotation without applying the equivalent BURN rotation, then construct a redemption. `cosign.mjs` should identify the SEAL Bank, sign with it, and BURN should reject `WiringDiverged` or `NotTheBank`.

**Fix:** Before signing, read and pin BURN’s config as well, require:

- BURN bank == SEAL bank;
- BURN collection == SEAL collection;
- expected config versions/layouts;
- Bank key matches both.

Prefer removing duplicated Bank state where architecture permits; otherwise make coordinated rotation an explicit operational transaction set with preflight checks and alarms.

---

### LOW — Refusing two redemptions is not a security problem, but it is an unnecessary compatibility restriction

**Construct:**

```js
if (opens.length !== 1 || burns.length !== 1) refuse
```

The on-chain programs expressly permit correctly paired multiple redemptions in one transaction.

**Impact:** This does not open a theft path. It breaks legitimate batching, including a wallet consolidating several customer-owned vault exits, and may increase fees and operational failure opportunities by forcing separate transactions.

**Evidence to verify:** Build `open A / sweep A / burn A / open B / sweep B / burn B`; the programs permit it but the co-signer refuses.

**Fix:** Either document batching as unsupported product policy, or support it by independently validating every pair and every PDA scan. Do not describe the refusal as “free” if it changes a legitimate on-chain behavior.

---

## R2 — `bank/lock.mjs`

### CRITICAL — The rename/restore path still permits two holders and therefore duplicate payments

**Construct:**

```js
fs.renameSync(file, stolen)
...
if (takenToken !== held.token) {
  try {
    const bytes = fs.readFileSync(stolen)
    const fd = fs.openSync(file, 'wx')
    fs.writeSync(fd, bytes)
    fs.closeSync(fd)
  } catch { /* somebody already holds it; theirs stands */ }
  try { fs.unlinkSync(stolen) } catch {}
  return { ok: false, ... }
}
```

The rename is atomic, but it atomically removes whichever lock happens to be at `file`, not necessarily the stale lock previously examined. The restore is not atomic with preserving the displaced live holder’s ownership.

**Three-runner interleaving:**

1. Stale lock `S` exists.
2. A and B both read `S`, judge it stale/dead, and pass the token re-read.
3. B wins first:
   - `rename(file, B.breaking)` moves `S`;
   - B `claim(file, B)` succeeds. B is now running payments.
4. A executes `rename(file, A.breaking)`. It succeeds because `file` now contains B’s fresh lock.
5. A reads `A.breaking`, sees B’s token differs from S, and enters restore path.
6. Between A’s rename and A’s `open(file, 'wx')`, C calls `acquireLock()`:
   - `file` is absent;
   - C’s `claim(file, C)` succeeds;
   - C starts payments.
7. A’s `wx` restore fails because C owns `file`; A swallows that failure and deletes `A.breaking`, thereby deleting the only remaining record of B’s lock.
8. B continues payment work believing it owns the lock; C holds the visible lock and also runs payment work.

B and C concurrently pay against independently loaded ledgers.

The code’s own comment says “somebody already holds it; theirs stands.” That is wrong: B still holds the logical lock and is still executing, but its lock was removed and C was allowed in.

**Evidence to verify:**

Add a deterministic seam between `rename(file, stolen)` and restore `openSync(file, 'wx')`, then:

- have B acquire a fresh lock after A’s stale read;
- have A rename B’s lock;
- have C claim the now-absent lock before A restores;
- assert B’s `fn` and C’s `fn` both execute.

The current selftest tests only restoration where no third claimant takes the gap. It does not test the decisive three-party interval.

**Fix:** This is not fixable safely with rename/unlink/recreate protocol alone. Use an OS-supported advisory lock or lease held on an open file descriptor (`flock`, `fcntl`/`lockf`, or a small trusted helper). The lock lifetime must be coupled to the process/file descriptor, not inferred from replacing pathnames.

Until then, do not claim exclusivity or that the double-payment problem is fixed.

---

### HIGH — `releaseLock()` still has a check-then-unlink race

**Construct:**

```js
held = JSON.parse(fs.readFileSync(file, 'utf8'))
if (!token || held?.token !== token) return false
fs.unlinkSync(file)
```

**Impact:** The token is checked in one operation and the pathname is deleted in a later operation. If the lock is replaced after the read but before unlink, the old owner removes the new owner’s lock.

This is the same ownership-transfer race the code tried to remove from stale breaking, retained in release.

**Evidence to verify:**

Add a seam after `readFileSync()` in `releaseLock()`:

1. A reads its own token.
2. Replace `file` with a fresh lock B.
3. Resume A.
4. A unlinks B’s lock and returns true.

A new runner can then enter while B continues work.

**Fix:** Use an fd-bound lock. If retaining files temporarily, at least acknowledge that pathname-based token checking cannot atomically compare-and-delete. Do not treat `releaseLock()` as ownership-safe under concurrent replacement.

---

### MEDIUM — The implementation is a narrowing, not an exclusive-lock fix; headers overstate what exists

The new rename removes the simple two-racer stale-break interleaving, but it does not solve stale lock handover generally. The restore path creates an unlocked interval by design. The comments claim:

> “Exactly one process can ever take the lock out of the way”

That is not sufficient for exclusivity. A process can take a fresh replacement out of the way, and another process can claim the empty pathname before restoration.

The durable answer named in the header—an OS lease/open-fd lock—is still required.

---

### LOW — Ledger durability is incomplete across power loss

`writeLedger()` fsyncs the temporary file, writes the marker, and renames:

```js
fs.fsyncSync(fd)
...
fs.renameSync(tmp, file)
```

It does not fsync the containing directory after rename. On filesystems/crash conditions where rename metadata is not durable until directory fsync, the new ledger name may be lost after a power failure.

The marker-first arrangement tends toward refusal rather than duplicate payment, which is safer, but the claimed atomic durable write is incomplete.

**Fix:** fsync the target directory after rename; define recovery behavior for marker-present/ledger-missing state.

---

## R3 — Other round-14 repairs

### HIGH — Acknowledgements can downgrade any asset-scoped CRITICAL, including live theft indicators

**Construct:**

```js
const why = acks[`${f.kind}:${f.asset}`]
if (typeof why !== 'string' || !why.trim()) return f
return { ...f, severity: S.INFO, acked: true, ... }
```

There is no allowlist of ackable finding kinds, no expiry, no chain-state condition, no integrity boundary, and no requirement that the finding is inherently permanent/unactionable.

**Impact:** An acknowledgement can downgrade:

- `vault_left_index`;
- `vault_burned`;
- `undeclared_token_account`;
- `approve_by_vault_pda`;
- `reserve_fell`;
- `vault_vanished`;
- any future asset-scoped CRITICAL accidentally using the same key format.

The system says the motivation is permanent, non-remediable findings. The implementation grants a general-purpose severity downgrade for every asset-scoped finding. A stale acknowledgement can therefore hide a new incident affecting the same vault and same finding kind.

Example: acknowledge `undeclared_token_account:<vault>` for a harmless historical zero account; later an attacker creates a different undeclared account containing cbBTC or another asset. The detector emits the same kind and asset, and the new event is automatically INFO.

**Evidence to verify:**

Run:

```js
applyAcks(
  [{ kind: 'undeclared_token_account', severity: 'CRITICAL', asset: A, detail: 'new account X' }],
  { [`undeclared_token_account:${A}`]: 'old account accepted' }
)
```

It returns INFO. The key does not include the account address that distinguished the old condition from the new one.

**Fix:**

- Permit acknowledgements only for explicitly non-actionable kinds.
- Include the condition identity in the key: e.g. `kind:asset:holding-address`, or a stable finding fingerprint.
- Include issuance time, expiry/review date, actor identity, and intended condition.
- Keep critical security findings non-ackable, or require a separate signed/operator-reviewed override mechanism that remains urgent on changed evidence.
- Make `acks.json` ownership and permissions part of deployment checks.

---

### MEDIUM — `<kind>:<asset>` is too coarse for findings that describe multiple independent conditions on one vault

This is the keying failure behind the prior finding. It is especially unsafe for:

- `undeclared_token_account`: identity should include token-account address and preferably mint;
- `approve_by_vault_pda`: identity should include source account and delegate;
- `reserve_fell`: identity should include before/after baseline or event;
- `nested_vault`: identity should include host vault;
- `unredeemable_owner`: identity should include observed owner.

The selftests prove isolation only across kind and asset, not across distinct facts within the same kind and asset.

---

### MEDIUM — `detectNestedVaults` has a meaningful false-negative class: on-curve wrapper/smart-wallet ownership

The detector treats only off-curve addresses as non-signable:

```js
if (ok === null || ok) continue
```

An on-curve pubkey can still be operationally controlled only through a wrapper/relayer/program policy and unable or unwilling to produce the two required top-level signatures. The project already recognizes this limitation for Bank keys; the same limitation applies to vault owners.

This is not solvable by `isOnCurve`, but the detector description should not imply that “on curve” means redeemable. It means only “not ruled out by this test.”

**Fix:** Phrase output and control requirements accordingly. Require the mint/redeem client to demonstrate an owner’s direct top-level signing capability where possible, and treat known smart-wallet ownership schemes explicitly.

---

### MEDIUM — The ceiling harness is still not a complete production redemption measurement

The harness serializes a constructed transaction but does not execute that exact maximum-shaped transaction under compute constraints. It also excludes common production additions such as Compute Budget instructions.

The carry-over CU issue remains real: 1119 bytes fitting in 1232 does not prove that:

- `open_for_redemption`;
- three Core ExecuteV1 calls;
- six SPL token operations;
- the PDA SOL sweep;
- BURN’s reserve scans and Core BurnV1;
- transaction signature verification and any production compute-budget policy

fit in the transaction CU ceiling.

The test’s `sizeFor()` uses `Transaction.serialize`, not `simulateTransaction`/send with a measured CU budget. The byte result is useful but not a full redemption feasibility proof.

**Evidence to verify:**

Construct and simulate/send the actual 3-reserve worst-case transaction with:

- all three source accounts populated;
- all source accounts closed;
- PDA lamports swept;
- real Bank and owner signatures;
- the production client’s ComputeBudget instructions, if any;
- destination ATAs already created.

Record `unitsConsumed` and require an explicit margin below the selected CU limit.

**Fix:** Add an execution harness for maximum reserve count and pin:

- legacy wire bytes;
- CU consumed;
- required ComputeBudget instruction bytes;
- maximum fee;
- destination ATA precondition behavior.

---

### LOW — “Destination ATAs MUST be created in a PRIOR transaction” is only documentation, not an enforced client precondition

The measurement establishes that three reserve mints do not fit if destination ATAs are created in the redemption transaction. The client implementation is not shown, and the co-signer does not enforce or preflight this condition.

A client that ignores the instruction will create an oversized transaction and fail to serialize/send. This is primarily an availability and customer-experience failure, not a path to stealing funds.

**Fix:** The redemption builder should:

- resolve all destination ATAs first;
- refuse to construct a three-reserve redemption until they exist;
- offer a separate prior ATA-creation transaction;
- preflight exact message size and CU before requesting a Bank signature.

---

### LOW — `validate-core-gate.sh` validates compare behavior, but not the pin source

The rewritten script correctly checks absent Core, tampered expected bytes, and genuine local bytes. It does not independently verify the SHA-256 pin used by `run-tests.sh`; it trusts `$CACHE/core-mainnet.so`.

That is acceptable if the script’s stated purpose is only “validate gate behavior,” but it should not be represented as independently proving that the tested Core is the pinned mainnet Core. That proof remains solely in `run-tests.sh` and `build-mainnet.sh`.

---

### LOW — Assertion floors detect deletion below a count, not replacement with vacuous assertions

The internal/external floors are better than no floor, but a floor only proves that at least N calls reached the assertion collector. It does not prove that the assertions retain meaningful predicates. The project has already had self-comparisons and wrong-reason rejects; count equality would not catch either.

The 9.14 self-comparison was one such example before its repair.

**Fix:** Keep floors, but add mutation tests or deliberate fault injection for critical controls: alter the detector/function under test and assert the specific intended test fails. The highest-risk gates should not rely solely on count floors.

---

## R4 — Comment and specification drift

### MEDIUM — Multiple headers still deny a co-signer that now exists

The new control table says `bank/cosign.mjs` exists and signs under `--live`. Several comments still state the opposite.

Examples:

1. **SEAL header:**

> “**NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.** Nothing scans before it signs, because nothing signs.”

2. **BURN header:**

> “but **no Bank co-signing tool exists in this repository**, so nothing scans before it signs.”

3. **SPEC, Proven Impossibilities §2:**

> “today is two post-hoc detectors and, explicitly, NOT the Bank co-signature, because nothing in this repository signs a redemption.”

These are now false. They direct operators away from a control that is present.

**Impact:** This is not merely editorial. The project explicitly treats comments as operational control declarations. A future operator may continue manual, inconsistent signing or fail to install/use `cosign.mjs` because program headers say it does not exist.

**Fix:** Replace all such statements with a pointer to the SPEC control table, as required by the project’s own comment policy. Do not restate partial control behavior in each program header.

---

### MEDIUM — BURN’s `burn_vault` documentation claims a mandatory scan-before-sign without defining the executable control or its limitations

BURN says:

> “the Bank because this is the one instruction that can permanently remove value, so it must SCAN THE PDA BEFORE IT SIGNS and alarm on every call.”

That is now directionally true only if the Bank uses `bank/cosign.mjs --live`, but it omits the critical limitation that the scan is one slot old and can be bypassed by the known airdrop race. It also does not state the much more urgent transaction-shape issue above: until fixed, this signer can sign arbitrary Bank-authorized instructions.

**Fix:** Point to the SPEC control table rather than make an abbreviated local claim.

---

### LOW — MINT still describes `owner: Signer` as “strictly stronger” than an on-curve test

The MINT `MintVault.owner` comment says:

> “Requiring a SIGNATURE is the enforceable form of the same property, and it is strictly stronger.”

The repository itself now recognizes that a PDA may be presented as a CPI signer. Therefore `Signer` is not stronger than on-curve status for the property that matters: direct top-level redeemability.

This is a known carry-over defect, but it remains present in the shipped source and is materially misleading.

---

## Carry-over list

### HIGH — Cross-pass correlation lag is worse than a noisy alert if acknowledgements are enabled

The existing issue is that a legitimate redemption can generate a CRITICAL before its `burn_via_program` observation arrives in a later pass. With acknowledgements, an operator may acknowledge the recurring apparent `vault_burned:<asset>` condition. A later real bare burn/new disappearance on that asset can then be downgraded to INFO by the broad `<kind>:<asset>` ack key.

This combines the known lag with the new ack defect into a potential suppression path.

**Fix:** Store bounded correlation state keyed by burn transaction/asset and only downgrade a disappearance when the matching proven redemption is observed. Do not use permanent broad acknowledgements for dynamic burn findings.

---

### HIGH — The fixed ProgramData hash offset remains wrong for immutable programs

Confirmed carry-over:

```js
snap[`prog.${name}.hash`] =
  createHash('sha256').update(acc.data.subarray(45))
```

Upgradeable ProgramData layout has an optional authority. If authority is absent, the ELF starts at offset 13, not 45. The resulting hash omits the first 32 bytes of the ELF for immutable programs.

This applies to Core as well as the four programs. The watch will still detect many changes, but it does not hash the program bytes it claims to hash.

**Evidence:** Obtain or construct a ProgramData account with `Option<Pubkey>::None` at byte 12 and ELF bytes starting at 13. Mutate only ELF bytes 13–44. The computed hash remains unchanged.

**Fix:** Hash from `hasAuth ? 45 : 13`, after validating ProgramData tag/layout/length.

---

### MEDIUM — Foreign nested Core assets remain an unclosed destruction path

`detectNestedVaults` only compares CBOB collection vault owners against CBOB vault PDAs. A foreign Core asset owned by a CBOB vault PDA is not found by the normal alarm reconcile. The new co-signer improves this only when it receives a complete valid DAS response and is actually used.

The known gap is worse operationally because the daily reconcile is still represented as a broad completeness control while it is structurally blind to Core assets.

**Fix:** Per live vault, call DAS `getAssetsByOwner` and treat every unburned asset as a declared holding requiring review. This is already conceptually implemented in `cosign.mjs`; it needs a periodic detector counterpart.

---

### MEDIUM — `burn_via_program` remains caller-keyed and can corrupt correlation

The carry-over remains: `detectBurns()` records:

```js
asset: ix.accounts?.[0] ?? null
```

without proving that account 0 is an actual CBOB vault asset or that the observed BURN instruction succeeded as a valid redemption. The later correlation treats it as evidence that the asset was redeemed.

The detector should derive “valid BURN redemption for vault A” from a decoded successful BURN instruction and validated asset membership, not from caller-selected account index zero in any observed program invocation.

**Fix:** Decode the BURN instruction, validate discriminator, successful transaction status, asset membership, expected account positions, and ideally the paired SEAL instruction in the same top-level transaction before using it as correlation evidence.

---

### MEDIUM — Distribution and swap reconciliation still rely materially on operator-written ledgers

This remains a stated limit. The chain-derived checks catch some missing or mismatched sweeps/splits, but the off-chain trusted hop still relies on ledger assertions for return attribution, quote comparison, and sequencing. The fresh per-cycle operator wallet is also still absent.

The risk is not eliminated by alarms; it is detected after exposure, and a compromised operator wallet can contain more than a single cycle unless operations enforce the stated wallet hygiene.

---

## Verdict challenges

### Confirmed: the admin exemption from `detectBankIsNotSignable` is correct under the shown programs

I did not find an admin instruction in SEAL, MINT, BURN, or GOV that requires the admin to produce two top-level paired calls or relies on instruction-sysvar pairing in the way redemption does.

An off-curve Squads admin can sign by CPI for:

- SEAL/BURN/GOV config updates and pending-rotation cancellation;
- MINT `update_wiring`, `set_paused`, and pending-rotation cancellation;
- GOV `update_gov_config`;
- MINT collection royalties, subject to its separate governance signer requirement.

The separate governance signer requirement can make some MINT admin operations unavailable after governance becomes the GOV PDA, but that is a governance architecture limitation, not an admin-PDA/top-level-signature pairing defect.

---

### Confirmed narrowly: closed-ATA delegate allow is safe for the stated delegate hazard

If the reserve token account is genuinely closed during the same transaction, its delegate cannot later drain that account. A recreated ATA starts without the old delegate. The measured allow appears correct for that narrow property.

This does not make arbitrary close-account layouts safe generally; it only supports the stated case where the delegated account is actually closed and the burn is terminal.

---

### HIGH — The audit coverage gate excludes files that control the certification process

`scripts/audit-coverage.sh` excludes:

```bash
grep -v '^scripts/audit' | grep -v '^scripts/audit-coverage.sh'
```

This excludes the audit prompt generators and the coverage script itself from the claimed “every file that is part of the system” inventory.

But `scripts/audit14.ts` determines what auditors actually see, and `audit-coverage.sh` determines whether the freeze gate claims coverage. These are part of the certification mechanism under the project’s stated model. Excluding them permits the process to certify its own selection/filtering code without audit coverage.

It also omits important non-globbed control files such as Cargo/workspace configuration, package manifests/lockfiles, Anchor configuration, deployment configuration, and JSON operational configuration such as `bank/acks.json`.

**Evidence:** Add a new `scripts/audit15.ts` that omits a security-critical file or changes collection logic. The coverage script’s `have` list excludes it, so it can still return zero.

**Fix:** Define the audit surface from version-controlled tracked files plus an explicit reviewed exclusion list. Do not exclude the prompt generators or coverage gate. Include manifests, lockfiles, configuration, JSON state schemas/templates, and all CI/deployment scripts.

---

## Anything else

### HIGH — The co-signer is not wired into cron, deployment, or an enforced redemption service

The repository contains a signing tool, but the shown `cron-install.sh` does not install it, and there is no demonstrated redemption client/service that requires every redemption to pass through it. The SPEC says the tool is inspect-only by default and no Bank key is on the box.

This means the control exists as code but is not yet an enforced production control. A Bank operator can still sign arbitrary redemption transactions manually, and a customer cannot rely on the tool being used unless the Bank’s key custody and redemption workflow enforce it.

**Evidence to verify:** Trace the deployed Bank key’s signing path. There should be no viable path to produce a Bank redemption signature except a service that invokes `cosign.mjs` after a successful validation. The shown tree does not establish that.

**Fix:** Move the Bank key into a constrained signing service/HSM boundary that accepts only a validated canonical redemption request. The service must reject raw arbitrary transaction messages until the transaction grammar issue is fixed. Logging should retain the exact message hash, scan slot, holdings, declarations, and decision.

---

# Given that no human firm will ever see this

Fifteen AI rounds cannot substitute for several things this project still lacks:

1. **Independent execution in a production-like environment.** Run adversarial integration tests against real RPC providers, real v0/ALT transactions, actual wallet flows, malformed DAS responses, concurrency races, power-loss simulations, and compute-unit limits.

2. **Independent key-custody and signing design.** A raw-transaction co-signer holding a real Bank key is a critical security boundary. It needs a dedicated, minimal, reviewed service or HSM policy—not a general Node process that signs customer-provided base64 transactions.

3. **Independent reproducible-build verification.** Build artifacts should be reproducible from committed source by a separate environment and compared byte-for-byte before deployment. The current local scripts are not independence.

4. **Operational incident exercises.** Practice Bank rotation, BURN/SEAL wiring divergence recovery, stuck redemptions, DAS outage behavior, lock contention, ledger corruption, operator compromise, and alert delivery failure before holding funds.

5. **Real security ownership.** A written acknowledgement file cannot be the final authority for downgrading security incidents. Establish named operators, access controls, change approval, key compromise procedures, and immutable audit logs.

6. **Do not deploy real customer value until the arbitrary-instruction signing flaw and the lock exclusivity flaw are fixed and demonstrated by adversarial tests.**