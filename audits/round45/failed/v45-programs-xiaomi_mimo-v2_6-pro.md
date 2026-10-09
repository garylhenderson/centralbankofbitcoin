# Independent Security Audit — CBOB Vaults v6 (Round 45)

## R0. Round 44's Verdict, Its Repairs, and the New Rehearsal Driver

### Round 44 verdict verification

Round 44's programs verdict claims LAUNCH-CLEAN with 6/8 seats counted (quorum met, no margin). I verified the key structural claims:

- **Program source equals `RELEASE_COMMIT` `0b3ddb3`**: The verdict states `git diff --quiet 0b3ddb3 2e8c979 -- programs Cargo.toml Cargo.lock` is clean. The only code change between the audited head `03b70f9` and `2e8c979` is the `sendV0` helper in `tests/3prog.test.ts` (confirmation by blockhash instead of a bare 30-second `confirmTransaction`). This is a test-only change that can only remove false rejections. **Verified.**

- **Quorum margin**: The verdict itself states quorum rests on counting DeepSeek "narrowly" and that excluding it would fail quorum (5 of 6). This is disclosed honestly. The two excluded seats (MiniMax, Qwen max-prime) describe round 43's open items as current, which the verdict correctly identifies as stale-tree readings. **Verified as disclosed.**

- **Twelve confirmed findings from rounds 41-43 all outside (a)-(d)**: I re-checked each classification. V43-1 (host owner keeps nested vault during own crack) is correctly outside (a)-(d) on Gary's 2026-10-08 ruling. V43o-1 (release gate in rehearsal tree) is correctly outside. **Verified.**

### Round 44 repairs (94f06a8)

**V44-1 (rehearsal ceremony profile)**: The repair wires the rehearsal profile's `initAuthority` and `squads` from the value file, and the ceremony's judge now uses `check-launch-params.mjs`'s own `--rehearsal` judge. I verified `judgeFor` in `plan-ceremony.mjs` routes `rehearsal-file` to `judgeRehearsalFile`, which is the checker's `judgeRehearsal`. The `lock_deadline` REHEARSAL-NA skip is in the checker (`check-launch-params.mjs:212-213`). **Repair holds.**

**V44-2 (release gate)**: The repair reads the five mainnet ids from `web/src/config.js` `MAINNET_PROGRAMS` (which the rehearsal substitution never touches) and assembles the release root. The selftest pins the export against `bank/layout.mjs`. I verified the gate now checks each map entry's left side against `MAINNET[name]` and each right side is a 32-byte base58 key not equal to any mainnet id. The untracked-file check uses `git ls-files --others`. **Repair holds.**

**V44-3 (coverage gate)**: The regex now accepts `(?:NOT )?(?:LAUNCH-)?CLEAN; QUORUM MET`. Selftest cases include both launch headlines and reject malformed variants. **Repair holds.**

**V44o-1 through V44o-5**: Each off-chain repair is described in `VALIDATION.md` with measured red-under-mutation evidence. I verified the poster's per-signature count survives a draining backlog, revenue's split recovery records a refused signature, the null-SEAL baseline keeps reserves, the no-network exit names what was skipped, and the rehearsal swap-operator key lives where `revenue.mjs` reads it. **Repairs hold.**

### The new rehearsal driver (a3cfd79)

**Guards verified:**

1. **Recorded-tree check** (`judgeTree`): Refuses without `REHEARSAL-RECORD.txt`; runs `release_gate` on the tree. **Correct.**

2. **Mainnet-id refusal** (`judgeProgramIds`): Each rehearsal id must be five, distinct, and none equal to any mainnet id (read from `web/src/config.js`). **Correct.**

3. **Mainnet-key refusal** (`judgeNoMainnetKeys`): Every `REHEARSAL_OWN_KEYS` value must not be in `MAINNET_ONLY`; `init_authority` must be the localnet test key; on mainnet the funding wallet must be the deploy wallet. **Correct.**

4. **`--max-sol`** (`capAllows`): Tracks drawdown from `fundingStartLamports` plus the step's estimate against `maxLamports`. **Correct.**

5. **Resumable state / never-resend** (`nextAction` + `judgeSigs`): A completed step is skipped; a step whose chain read-back shows done is marked; a step with a landed or pending signature but no chain evidence is STOPPED (never re-sent); only a step with no landed signatures is run. `judgeSigs` treats a preflight-refused signature as never-forwarded. **Correct.**

6. **Init-then-read-back**: `sendWithInit` funds the init key inside the same transaction (sized by simulation), and every ceremony step's `done` callback re-reads the account against the filled values. A mismatch calls `broken()` which throws with "close every rehearsal program... and start again." **Correct.**

7. **Program close at the end**: Five `close-N` steps call `solana program close` with the funding wallet as authority and recipient. **Correct.**

8. **`rehearsal-env.mjs` cannot change production**: `rehearsalOnly` throws if an override is set outside a recorded rehearsal tree. `rehearsalFlag` requires exactly `'1'`. `jobRpc` falls back to the mainnet provider when unset. Production never has `REHEARSAL-RECORD.txt`. **Correct: a set override outside a rehearsal tree is refused, never silently ignored.**

**One observation on the driver** (LOW, not a defect): `rehearsal-steps.mjs` `sendWithInit` computes the init key's funding by simulating with a 0.1 SOL probe transfer and reading the post-balance. If the simulation's `accounts` array is not populated (some RPC providers omit it for `simulateTransaction` without explicit `accounts` config), `post` defaults to 0 and `fund` becomes `used - pre`, which could over-fund. The over-funded lamports are spent by the same transaction (the init key signs), so nothing is lost—but the estimate could be wrong. The `--max-sol` cap bounds the damage. **Not a defect; a robustness note.**

---

## R1. Custody: Can Anyone Get Value Out of a Sealed Vault?

### The seal/thaw/burn pairing

**SEAL `open_for_redemption`** (`programs/cbob-vaults/src/lib.rs`):
- Reads the asset's owner and collection from Core bytes (offsets 1-33, 33-66).
- Requires the signer to be the asset's owner.
- Walks the instructions sysvar FORWARD from `current + 1`, looking for BURN's `burn_vault` with matching asset (account 0) and owner (account 2).
- Fail-closed: if no matching burn is found, `NoTerminalBurn` is returned and the thaw does not happen.

**BURN `burn_vault`** (`programs/cbob-vault-burn/src/lib.rs`):
- Walks the instructions sysvar BACKWARD from `0` to `current - 1`, looking for SEAL's `open_for_redemption` with matching asset (account 0) and owner (account 2).
- Fail-closed: if no matching open is found, `NoPrecedingOpen` is returned.

**Both halves bind asset AND owner.** Neither can be borrowed from another vault's redemption sharing the transaction. The instruction-sysvar parsing uses `load_instruction_at_checked`, which sees top-level instructions only—so a CPI-wrapped burn or open cannot satisfy either half. **Verified by suite arms WR.1-WR.4 (wrapper attacks) and 3.9/3.10 (cross-vault pairing).**

**Account-index binding**: SEAL binds `BURN_IX_ASSET_IDX = 0` and `BURN_IX_OWNER_IDX = 2`; BURN binds `SEAL_IX_ASSET_IDX = 0` and `SEAL_IX_OWNER_IDX = 2`. These are asserted against the Anchor derivations in the suite (3.1a-3.1f). **Correct.**

### The emptiness proof

BURN checks:
- `asset_signer.lamports() == 0`
- Every reserve mint's ATA under BOTH token programs is declared, PDA-owned, undelegated (delegate tag, delegated amount, close authority all zero), extension-free (exactly 165 bytes), and empty.
- No declared account is a live Core asset (nested vault check).
- A non-reserve token account owned by the PDA is checked with the same delegate/extension/empty rules.

**Token-2022 extensions**: The check `d.len() == TOKEN_ACCOUNT_LEN` (165) refuses any account with extensions, because a confidential balance reads zero in the base `amount` field. **Correct.**

**Delegates**: `d[72..76] == [0,0,0,0]` (delegate COption tag), `d[121..129] == [0u8; 8]` (delegated amount), `d[129..133] == [0,0,0,0]` (close authority COption tag). Suite arm 3.3 pins the delegate refusal. **Correct.**

**Lamports**: `asset_signer.lamports() == 0` is checked. The sweep helper moves every lamport before the burn. Suite arm 9.10/9.11 pins the lamport grief and its resolution. **Correct.**

### Anything that lets a thawed vault leave unburned

The pairing is atomic: if the burn does not land, the thaw reverts with it. Suite arm 3.11 (partial sweep) proves this. **No path found.**

---

## R1s. The Sweep Helper

### (a) Nobody but the asset's owner can make it move value

The helper requires `signer.is_signer`. Through Core `ExecuteV1`, Core signs as the asset-signer PDA only for the asset's owner (verified: SR.5 refuses a stranger, SR.5a refuses a transfer delegate, SR.5c refuses the collection update authority). The collection update authority is MINT's PDA (off-curve, no key exists). AgentIdentity (the one Execute-approving adapter) cannot be added by an owner (R24.1a). **Verified.**

While frozen: Core's `ExecuteV1` checks `PermanentFreezeExecute` and refuses if frozen. The helper can only be reached during a thaw (i.e., inside a redemption). **Verified.**

### (b) The pair list

- **Same source twice**: First iteration transfers and closes; second iteration reads the closed account (data still readable in-transaction), attempts a transfer from a closed account, which fails. Suite SR.12a pins this. **Correct.**
- **Source is also a destination**: Both checks pass (same owner, same mint), but the token transfer from an account to itself fails. Suite SR.10 pins this. **Correct.**
- **Native wSOL source**: wSOL is a classic 165-byte SPL account; the helper reads it at offsets 0/32/64. **Correct.**
- **Frozen source**: The token transfer fails, reverting the whole call. Suite SR.14 pins this. **Correct.**
- **Destination not an ATA**: The helper only checks owner and mint, not ATA derivation. A non-ATA destination with the right owner and mint works. **Correct by design.**
- **Destination is the vault's own asset-signer**: Refused (`signer.key == dest.key`). **Correct.**
- **Odd account count**: Refused (`(accounts.len() - 4) % 2 != 0`). Suite SR.7 pins this. **Correct.**
- **Zero pairs**: The lamport sweep still runs. Suite SR.13 pins this. **Correct.**

### (c) Destination checks

The destination wallet is chosen by whoever builds the transaction. Given (a), only the owner can trigger the helper through Core, so the owner chooses where their own vault's contents go. **Safe.**

A lamport transfer to a non-System account: the System transfer succeeds (lamports are credited without changing data). Suite R27.S1 pins this. A transfer to a non-existent account below rent exemption is refused by the runtime. Suite R41.C8a-c pins this. **Correct.**

### (d) The lamport sweep

`signer.lamports()` is read at execution time. The System transfer empties the signer to zero. Nothing in the same transaction can deposit into the signer afterwards (the helper is the last instruction before the burn). BURN's `lamports == 0` check sees exactly what the sweep left. **Correct.**

### (e) Interaction with BURN's emptiness proof

The sweep closes what it empties (SPL `CloseAccount`). A closed account has `owner = System`, `data.length = 0`, `lamports = 0`. BURN's reserve loop checks `acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID` and skips such accounts. The `d.len() < TOKEN_ACCOUNT_LEN` check also skips them. **The closed account passes for the right reason: it is no longer a token account.**

If a reserve ATA does NOT exist when the page builds the transaction: the sweep cannot name it (it refuses a non-token account). SPEC's REDEEMING step 1 says the page creates missing reserve accounts in a PRIOR transaction. A stranger can create a classic ATA for any owner permissionlessly and deposit into it before the redemption lands—but the sweep moves live balances, so the deposit comes out with the rest. A Token-2022 ATA for a classic mint: the ATA program refuses this (suite F4.2). A non-ATA token account: the sweep can name it if the page lists it. A nested Core asset: BURN refuses if declared, destroys if undeclared (accepted limit 44). **Correct.**

### (f) Does it fit?

S8.0 measures the three-asset redemption through the helper (claim included) at 1,061 bytes with the owner as fee payer. Adding both compute-budget instructions (+52 bytes) and a separate fee payer (+96 bytes) gives ~1,209 of 1,232. S8.1a measures 168,343 CU. **Verified.**

A fourth reserve: `MAX_RESERVE_MINTS = 3` in both SEAL and BURN. The measured ceiling is 3 (9.14). **Correct.**

### (g) Evidence

SR.0-SR.4a and SR.5-SR.14 cover the helper's refusal arms. S8.0-S8.3 cover the three-asset redemption. The helper is deployed from the same bytes `scripts/build-mainnet.sh` proves (byte-identical between mainnet and localnet builds, and identical to `target/deploy`). **Verified.**

---

## R2. The Community Pool's Money

### The invariant "the pool always holds at least ceil(owed)"

`owed_scaled` tracks what is owed in scaled units. `ceil_sats(owed_scaled)` is the minimum the pool must hold.

- `credit` adds `delta * w` to `owed_scaled` (where `delta = avail * ACC_SCALE / w`).
- `claim` subtracts `settled = pay * ACC_SCALE` from `owed_scaled`.
- `retire` subtracts `pending` from `owed_scaled`.

The pool balance is checked in `distribute`: `avail = balance - ceil_sats(owed_scaled)`. If `avail < 0`, `PoolShort` is returned. **The invariant holds by construction: `distribute` refuses to credit more than the pool holds above what it owes.**

Suite P.32 asserts `pool.bal >= pool.owedCeil`. The `ledger()` function in the suite recomputes `owed_scaled` from every record after each money operation. **Verified.**

### Counter correctness

- `pending_count`: Incremented at activation request, decremented at join or retire. `waiting_to_join = pending_count - pending_this_epoch` (checked_sub, underflow is an error).
- `pending_this_epoch`: Reset to 0 at each `advance_epoch`. Decremented at retire if `request_epoch == dist_epoch`.
- `active_count`: Incremented at join, decremented at retire.
- `total_active_weight`: Incremented at join (by level weight), adjusted at `reweigh` (by weight delta), decremented at retire.

**All counters use checked arithmetic.** Suite BK.IN, BK.3c, BK.P verify the books balance after every money operation. **Verified.**

### Liveness

- `JoinWaitingFirst`: No distribution while any eligible-but-unjoined vault waits. This prevents a first-activator attack.
- `BoostsExpireFirst`: No distribution while any boost is due.
- The monthly in-line run never refuses its host: it logs `CBOB_MONTHLY_WAITS_FOR_BOOSTS` or `CBOB_MONTHLY_WAITS_FOR_JOINS` and does nothing.

**No path found that makes distributions or redemptions impossible for others.**

---

## R2b. The $CBOB Boost

### A boost earns EXACTLY N distributions

The boost is scheduled at `end = dist_epoch + epochs`. `advance_epoch` moves it to `boosts_due` when `dist_epoch` reaches `end`. `BoostsExpireFirst` prevents any distribution while `boosts_due > 0`. So the boost earns exactly the distributions in `[dist_epoch_at_purchase + 1, end]`, which is exactly `epochs` distributions. **Verified by suite BO.21, BO.35, BO.34.**

### Nothing earned is lost or gained at weight changes

`reweigh` moves `owed_of(r, acc)` into `carry_scaled` and resets `debt_scaled = new_weight * acc`. So `owed_of` after the change equals `owed_of` before. **Verified by suite BO.7c, BO.14.**

### Counters always agree

`boosts_active`, `boosts_due`, `boost_weight_total`, and `