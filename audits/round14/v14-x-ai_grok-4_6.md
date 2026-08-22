# Round 14 audit — repairs `bf8d62c..e16c5e2`, five never-seen files, verdict

No CRITICAL that I can defend with on-chain or test-run evidence. Several HIGH/MEDIUM defects live in the repairs themselves, in leftover “control exists” comments, and in the never-audited gate script.

---

## R1. `correlateBurns`

### R1-a — Laundering a bare BurnV1 into INFO
**Not shown.** `viaProgram` is a per-asset set. A redemption of A cannot downgrade a `vault_burned` on B (selftest covers this). Forging `burn_via_program` for the victim requires a *successful* tx whose program id is BURN and whose data starts with `burn_vault`’s discriminator, with accounts[0] = victim. That is a real `burn_vault`: Bank signature + paired open. Failed txs are dropped (`if (s.err) continue`). Inner CPI that fails fails the tx.

**Evidence if I were wrong:** a fixture tx that is `meta.err == null`, contains `burn_vault` bytes naming asset V, does not actually burn V through the emptiness proof, and a same-pass DAS `vault_burned` on V coming out INFO.

### R1-b — Fail-open ordering
**Not shown.** The dangerous order is: pass N sees `burn_via_program` (cursor advances), DAS still lists the vault live; pass N+1 DAS reports burnt, walk no longer sees the tx. `correlateBurns` has no memory. Uncorrelated `vault_burned` stays CRITICAL. That is a false alarm on a real redemption, not silence on a bare burn.

`vault_left_index` is not downgraded at all.

### R1-c — Downgrade of `burn_via_program` HIGH → INFO
**Correct given v5**, provided R1-a holds. The paging signal is uncorrelated `vault_burned` / `vault_left_index`. Keeping HIGH would recreate the burial this repair exists to stop.

**Residual (LOW):** INFO-only redemptions never email (`urgent = crit + high`). Intended. Operators who only read mail will not see volume of honest exits.

No R1 finding that survives the “what evidence would exist” test.

---

## R2. `MAX_RESERVE_MINTS` 8 → 3 and harness 9.14

### HIGH — The on-chain bound was set from a serialize-only harness that never lands the tx and does not measure CU
**Construct:** `sizeFor(n)` builds a legacy `Transaction`, `serialize({requireAllSignatures:false})`, never `sendAndConfirm`. 9.14 is a tautology (`want = got = String(fits)`). 9.15/9.16 only assert `MAX_RESERVE_MINTS == fits`. Nothing in the suite, or anywhere else, records `computeUnitsConsumed` for N=2 or N=3. Verdict item 6 already named this; it is worse than “unexamined” because the **Borsh/packet constant that can seal every vault is now 3 on the strength of that incomplete instrument**.

**What an accident gains:** if a 3-reserve redemption fits 1090 bytes but exceeds the default 200k CU (or cannot be made to land under 1.4M with the real Execute + emptiness loop), every vault that already holds the three business reserves is unredeemable. `update_config` cannot drop a mint (`ReserveMintDropped`).

**Evidence if true:** send the N=3 tx 9.14 already builds (after creating dest ATAs) on the same cloned-Core validator; read `meta.computeUnitsConsumed` and success/failure. If it fails with `Computational budget exceeded` or a Core CPI CU fault, the cap is too high.

**Fix:** land N=1/2/3 in the suite; assert CU; keep MAX at the largest N that both serializes **and confirms**. Until that number is measured, 3 is a guess that happens to match the product.

### MEDIUM — Harness is narrower than a production redemption
Missing versus a real send:
- no `ComputeBudget` ixs (limit + price); ~two small instructions, easily 80–120 bytes of the 142 claimed spare;
- dest ATAs for extra mints are not created (size of account keys is the same; runtime would fail without a pre-step);
- fee payer is assumed to be the Bank; a third payer is +64 bytes of signatures;
- fake blockhash is the right length (OK).

None of those, alone, proves 3 is wrong for *bytes*. Together they mean “142 bytes to spare” is the harness’s spare, not production’s. **Nothing in this repo builds a v0 + ALT redemption**; raising MAX without that client is still a kill switch. 3 is not needlessly low for legacy. It may be too high for CU (above).

### LOW — 9.14 cannot go red
`rec('9.14', …, String(fits), String(fits), …)` always matches. The binding is only 9.15/9.16. If someone “fixes” a flaky serialize by catching more errors into `99999`, `fits` drops and 9.15 fails (safe). If they slim the builder until exactly 3 fit, 9.15 stays green while production does not.

---

## R3. `detectNestedVaults`

### HIGH — Docstring claims a control that does not run
```text
BLIND TO: a FOREIGN Core asset … is the reconcile's job, not this one's.
```
`reconcile()` runs the same detector plus `getTokenAccountsByOwner`. It does **not** DAS-search owners of each vault PDA for foreign Core assets. SPEC is honest (“nothing does it”). The new detector is not.

**Same class as round 6 / the comment the author just rewrote.** A reader of `detectors.mjs` will believe `--reconcile` covers foreign nesting. It does not. Under v5 that nest is destroyed on the next undeclared burn.

**Evidence:** grep `reconcile()` — no `getAssetsByOwner` / per-PDA DAS. Fix: delete the sentence, or implement the search and test it.

### MEDIUM — Burnt hosts: right; burnt *rows* as a perpetual CRITICAL: wrong
Including burnt hosts in the PDA map is correct (orphan after 9.5). But `listVaults` pushes **every** DAS item, burnt included, into `all`, and the detector emits CRITICAL for every row whose `ownership.owner` is still a vault PDA.

**Evidence if true:** after 9.5, Helius `getAssetsByGroup` still returns the inner (and later the outer) with `burnt: true` and `ownership.owner` = outer PDA. Then every 30-minute pass reprints `nested_vault` CRITICAL forever. No `resolvedBy`, no “already reported”. That is how operators learn to scroll past CRITICAL.

**Fix:** only alert on **live** inners; or persist a fingerprint and require change; or drop severity for `burnt: true` inners to HIGH with a one-shot.

Scope “CBOB-in-CBOB only” is otherwise stated honestly in SPEC. Burnt-host inclusion is the right default. DAS inventing an owner equal to another vault’s PDA on a healthy wallet-owned vault would require an indexer bug (PDAs are off-curve). Missing a nest because DAS has not indexed a TransferV1 is stated.

---

## R4. `detectBankIsNotSignable` and the admin exemption

### The rejection of “also flag admin” is correct
Admin-gated handlers are a single top-level `Signer` (`has_one = admin`) with **no** `load_instruction_at_checked`: SEAL/BURN `update_config` / `cancel_pending`, MINT `update_wiring` / `set_paused` / `cancel_*` / `set_collection_royalties`, GOV `update_gov_config`. A Squads vault CPI-signs those today (`INIT_AUTHORITY` is already that PDA). None of them break if admin is off-curve.

`set_collection_royalties` also needs `governance` as a signer; that is already dead once governance is the GOV PDA (stated, 7.18). Not an admin-curve issue.

### MEDIUM — `mint.bank` is not part of the pairing
Only `open_for_redemption` and `burn_vault` introspect **top-level** instructions. `mint_vault` only needs `bank: Signer`, which a CPI signer satisfies. `mint.bank` **can** be a Squads PDA; the detector will CRITICAL that configuration and block the one hardening that actually works for mint.

**Evidence if true:** a Squads-executed `mint_vault` with `mint.bank` = Squads vault succeeds on the validator (same shape as `initialize`). Fix: watch only `seal.bank` and `burn.bank`.

Off-curve as proxy is incomplete (on-curve relayer). The comment already says so. Not a new finding.

---

## R5. Core in the drift watch

### ProgramData derivation
`findProgramAddressSync([prog.toBuffer()], BPFLoaderUpgradeable)` is the standard ProgramData PDA. Correct for upgradeable Core.

### Sentinel
Absent ProgramData → `NO_PROGRAMDATA` on both watched keys. First-run baseline then a successful read (or the reverse) is a CRITICAL drift, not silence. RPC flake is a false alarm, fail-safe. Does not hide a real upgrade.

### MEDIUM — `hash = sha256(data.subarray(45))` is wrong when authority is `None`
Layout: tag 4 + slot 8 + `Option` 1 + **32 only if Some** + ELF. Offset 45 is correct **only while byte 12 == 1**. If Core is made immutable, ELF starts at 13; the hash jumps without a byte of ELF changing (false CRITICAL), and thereafter an ELF edit confined to the first 32 bytes is invisible.

**Evidence if true:** dump ProgramData for an immutable program (or craft `data[12]=0`); compare `sha256(subarray(45))` vs `sha256(subarray(13))`.

**Fix:** `const elfOff = acc.data[12] === 1 ? 45 : 13`.

Core today has a live authority, so this is latent. Still the wrong slice for the case the `IMMUTABLE` branch already names.

---

## R6. Assertion floor

### The helper is fail-closed on format change
`grep -oE '[0-9]+/[0-9]+ detector assertions as predicted'` then `^[0-9]+` takes the **numerator**. Under `set -e`, `selftest.mjs` must already have exited 0, so numerator == denominator. A missing summary dies. Good.

### LOW — Two floors, one stale
`bank/selftest.mjs` still has `const FLOOR = 195`. The runner has `DET_FLOOR=221`. `node bank/selftest.mjs` alone can shrink to 195 and stay green. Certification goes through the runner; direct invocation does not.

Defeat of *quality* (221 `t('x',1,1)`) is inherent to a count floor. Not unique to this helper.

---

## R7. Account sizing after MAX 8 → 3

SEAL `Initialize` space is `8+1+32+32+32+4+(32*MAX)+1+32+8+32+8+256`. Sum matches Borsh of `Config` at MAX=3 (the `+1` in the formula is conceptually “bump” in the wrong place; totals still match). BURN’s config has no vec; MAX does not affect it.

Nothing is deployed, so shrinking init is safe. Padding (256) would absorb a later 4th mint **if** they also added `realloc`; they did not. Not a bug today.

No sizing finding.

---

## R8. Comments claiming controls that do not run

The rewrite fixed two sites and left the class standing. This project has treated that as a defect for five rounds.

### HIGH — The green suite still prints the lie
```javascript
// tests/3prog.test.ts 9.5
`THE GAP: … so the Bank must scan BEFORE it signs.`
```
Every certified run tells the operator the pre-sign scan exists.

### HIGH — BURN `burn_vault` rustdoc
“the Bank … must SCAN THE PDA BEFORE IT SIGNS and alarm on every call.”

### MEDIUM — BURN “WHAT THIS CAN AND CANNOT PROVE”
Still: gap “covered by the Bank’s co-signature … The Bank must alarm on every burn.” The new ⚠️ paragraph contradicts it in the same file.

### MEDIUM — SEAL `Config.reserve_mints`
Still names **`close_redemption`** (deleted) and “covered by the Bank co-signature”.

### MEDIUM — SPEC disagrees with itself
New text: cap 3, 9.15/9.16, Core watched. **Known limits** still: “list may hold up to 8 … **Nothing enforces this today.**” Alarm section still “69 assertions”.

### MEDIUM — `detectBalanceDrops` user-facing detail
Still: “Expected if it was redeemed”. The new comment says a **live** vault cannot legitimately fall. The line the human reads is the old one.

Over-correction of the two headers; under-correction everywhere else.

---

## Never-audited files

### `bank/anchor.mjs` — MEDIUM (latent), not a theft path
Pins owner, `account:` discriminator, version. `null` on absent; throws otherwise. Money jobs use it (`revenue.mjs`, `distribute.mjs`). Selftest covers wrong owner / disc / version.

Gaps: no length check beyond 9 bytes (callers can still `subarray` off the end — throw, fail-closed). Owner compared via `toBase58()` not `.equals()`. `revenue.mjs` still has a dead `if (!cfg)` after wrapping the return in `{ data }`. Alarm does **not** use this helper (duplicated pin in `readConfigs`). Address is a MINT PDA, so this is silence-after-upgrade, not substitution. The class it was written for is closed for the two money jobs.

### `scripts/validate-core-gate.sh` — HIGH
This is the script SPEC cites as proving the Core gate. It does not.

1. `CACHE=/tmp/cbob-vault-test` (world-writable; **not** `/opt/cbob-vaults/.cache`). `core-mainnet.so` is not there unless someone copied it. ARM 1 then “fires” because the expected file is missing, not because Core is absent.
2. ARM 3 is the tautology `run-tests.sh` already removed: boot with file F, dump, `cmp` to F. Cannot fail if boot worked.
3. **Never checks `CORE_SHA256_EXPECTED`.** The only pin that matters is untested.
4. Not called from `run-tests.sh`. Manual, wrong cache, wrong property.

**Evidence:** run it on a clean box without copying the dump into `/tmp/cbob-vault-test`. ARM 1 prints “correct” for the wrong reason; ARM 3 false-fails or boots nothing.

**Fix:** point at the real cache, `sha256sum` against the hardcoded pin, wire it into the runner or delete the SPEC line.

### `tests/initauth.test.ts` — no surviving functional fault
Authority is first in every `initialize`. SEAL empty vec → `NoReserveMints` counts as ACCEPTS (past the check). `build-mainnet.sh` treats anything but `REJECTS` / `ACCEPTS` as `die`. INCONCLUSIVE cannot bless bytes. Keep MINT’s arg list in step with the IDL (comment already says so).

### `tests/probe-round5.test.ts` — MEDIUM if trusted, LOW if fossil
`mint_vault` data is pre-`max_price_lamports` / `attributes`. Owner is `isSigner: false`. Destination is `treasury`, not the revenue PDA. Against current MINT this does not deserialize; D5 never reaches Core. Not in the runner. Do not use it to re-litigate the seal.

### `tests/probe-round5b.test.ts` — no new fault
Still a valid Core / T22 measurement (D4 PDA not swept; F4 T22 ATA length; T22 ATA for classic mint rejected). Historical, not wired.

---

## Verdict challenges

### Rejection: “BurnV1 closes the account / remintable”
**Stand.** 9.12/9.13 run against cloned mainnet Core: account remains, Core-owned, 2_495_280 lamports, 1 byte, `key = Uninitialized`; remint with the original keypair is `account already in use`.

Caveats, not overturns:
- Measured via `burn_vault`’s CPI, not a bare `BurnV1`. Same opcode (`12`); extremely likely identical. A one-line bare-burn probe would close the quibble.
- Tombstone is reclaimable **only if Core spends those lamports** (runtime deletes 0-lamport accounts). Only the owner (Core) can. A Core upgrade that reaps Uninitialized assets would make the address reusable. SPEC already ties that to `prog.core.hash`. Do not treat “never exists again” as a property we enforce.

### Rejection: “T22 derivation halves capacity / unreachable”
**Stand.** ATA program checks mint owner == token program (F4.2 REJECT). The T22 ATA is a PDA of the ATA program; no one else can create an account at that address. Unreachable is true. Cost is one extra pubkey per mint (~32 B), not half the packet. Removing it still changes the emptiness proof; leaving it is a capacity tax, not a lie.

### Accepted fixes — which one is wrong?
**Fix 1 (MAX=3)** is the one that can become a customer-funds bug if the harness is optimistic (R2). The *decision* to replace a Borsh 8 with a packet bound is right; **the number 3 is not fully earned**.

**Fix 2 (correlateBurns)** holds under the tests I can name.

**Fix 3** is incomplete (foreign nest comment; perpetual burnt CRITICAL).

**Fix 4** is right to add Core; the ELF slice is wrong for `IMMUTABLE`.

**Fix 5** is right for SEAL/BURN and for exempting admin; wrong to include `mint.bank`.

**Fix 6** did not finish the comment class (R8).

---

## Other (not in the eight repairs, not already-open)

None that I will spend the stopping-condition on. Known-open items (no co-signer, lock TOCTOU, ledger-as-testimony, T22 declarations, CU, CPI-wrapper untested) are not worse than stated.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Thirteen rounds of the same prompt cannot do four things this project now needs:

1. **Execute the transactions the comments describe.** 9.14 never sent N=3. CU is not a code-reading problem. Add a job that *lands* the redemption it claims to bound, prints CU, and fails the build if MAX exceeds what confirmed.

2. **Stop treating a rewritten comment as a control.** Grep the tree for `BEFORE it signs`, `co-signature`, `close_redemption`, `may hold up to 8`, `reconcile's job` and make SPEC / headers / suite strings match `ls bank/`. A future model will “fix” a detector to match a sentence that is already false.

3. **Build the Bank signer or stop minting.** The honest line is already in SPEC: detected in ≤30 minutes, never prevented; even a correct pre-sign scan is not a proof. That is not an audit finding anymore. It is a go/no-go. AI will keep re-describing it.

4. **Freeze a hash and run the programs, not the prompts.** One tagged commit, `build-mainnet.sh` artifacts, `CORE_SHA256` + four `.so` sums, a redemption that has been sent at MAX, and a written rule that the next change is one mechanic at a time. Another eight-model round on a moving tree will produce the same mix of real comment bugs and invented CRITICALS, with nobody left to sort them.

Until (1) and (3) exist, this process is not a certification. It is a very expensive linter with a history of being wrong about Core.