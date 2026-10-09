# Round 45 Independent Audit Report

## R0. Round 44 Verdict Verification

I read both round 44 verdicts (`audits/round44/VERDICT-programs.md`, `audits/round44/VERDICT-offchain.md`) and the validation record (`audits/round44/VALIDATION.md`). I independently verified every confirmed repair at all sites of its shape.

### V44-1 (rehearsal ceremony profile and judge) — VERIFIED
- `web/src/config.js` `rehearsal.initAuthority` is now the localnet test key `GmaDrpp...` (line 100-102). ✓
- `web/src/config.js` `rehearsal.squads` is now `null` (line 108-110). ✓
- `web/src/lib/plan-ceremony.mjs` `judgeRehearsal` still treats every null as OPEN (line 69), but the ceremony page delegates to `check-launch-params.mjs --rehearsal` for the actual judgment, which is the correct gate. ✓
- Stale comments in `config.js` and `web/README.md` corrected. ✓

### V44-2 (release_gate) — VERIFIED
- `run-tests.sh` `release_gate` now reads `MAINNET_PROGRAMS` from `web/src/config.js` and requires each left-side token to be exactly the named RELEASE id (not just any reversible swap). ✓
- Requires each right-side token to be a 32-byte base58 key equal to `solana-keygen pubkey target/deploy/<crate>-keypair.json`. ✓
- Both branches now run `git ls-files --others --exclude-standard -- programs Cargo.toml .cargo` and refuse if non-empty. ✓
- The gate's selftest (selftest V43o-1) was not re-run in this tree; the repair is verified by reading the code, not by measurement.

### V44-3 (audit-coverage.sh) — VERIFIED
- `scripts/audit-coverage.sh` `first_line_quorate` regex now accepts `(?:NOT )?(?:LAUNCH-)?CLEAN; QUORUM MET` (line 107). ✓
- Selftest cases include both launch-vocabulary headlines (lines 137-145). ✓

### V44-4 (status vocabulary) — VERIFIED
- `launch/rehearsal-init.json` uses RULED for approved values. ✓
- SPEC and `check-launch-params.mjs` legends include RULED. ✓

### V44-5 (limit 59 cost) — VERIFIED
- SPEC limit 59 now cites 650,240 lamports on mainnet. ✓

### V44-6 (holder guide) — VERIFIED
- `HOLDER-GUIDE.md` now names the bare burn as a second exception. ✓

### V44-7 (ceremony absent-collection message) — VERIFIED
- `ceremony-reads.mjs` `readStep` returns `{absent: ...}` for a missing pinned collection (line 25-35). ✓
- `ceremony.mjs` renders "absent" as a distinct result from "broken" (line 190-193). ✓

### Round 43 repairs re-verified
All five round-43 repairs hold at the current HEAD: R43.V1/R43.V1a in the suite, the crank's `planRescues`, the e2e header, the release gate's rehearsal-tree handling, and the reveal-skip arm.

## R0b. The New Rehearsal Driver (a3cfd79)

I audited `scripts/rehearsal-run.mjs`, `scripts/rehearsal-steps.mjs`, `scripts/rehearsal-recover.mjs`, `bank/rehearsal-env.mjs`, `sim/rehearsal-local.sh`, and `sim/das-shim.mjs`.

### Guards — ALL SOUND
- `judgeTree` refuses without `REHEARSAL-RECORD.txt` and runs the release gate. ✓
- `judgeProgramIds` refuses any id equal to a mainnet id, requires five distinct ids. ✓
- `judgeNoMainnetKeys` refuses any value in `MAINNET_ONLY` (Gary's wallet, Squads, swap operator, $CBOB mint/release, PoB collection/root). ✓
- `judgeCore` refuses if the deployed Core bytes don't hash to the pin. ✓
- `capAllows` refuses if `--max-sol` would be exceeded. ✓
- `nextAction` never re-sends a completed step; re-reads unknown outcomes. ✓
- `judgeSigs` waits out pending signatures (until blockhash expiry), never re-sends. ✓
- `rehearsalOnly` throws if a rehearsal override is set outside a recorded tree. ✓

### Init-then-read-back — SOUND
Each ceremony step calls `readStep` after landing and compares every field to the ruled value. A mismatch throws `STOP` with the field name. ✓

### Program close at the end — SOUND
Programs are closed largest-first (rent returned before the next deploy), then `solana program close` recovers the remaining rent. The programs are never made final. ✓

### rehearsal-env cannot change PRODUCTION behaviour — SOUND
`inRehearsalTree()` checks for `REHEARSal-RECORD.txt` at the repo root. Production never has this file. `rehearsalOnly` throws if an override is set without the marker. The cron installer refuses trees with the marker. ✓

### das-shim — SOUND
Listens on 127.0.0.1 only. Forwards all RPC/websocket to the validator unchanged. Answers `getAssetsByGroup`/`getAsset` from Core accounts read off that same validator, tracking burned assets by their tombstone. It is explicitly not DAS and proves nothing about DAS; item 22.5 is mainnet-only. ✓

### rehearsal-recover — SOUND
Refuses outside a recorded tree. Looks up every recorded/candidate signature with `searchTransactionHistory`. Never repeats a swap that may have landed. Swaps by hand through the same builder and judge the automatic path uses. Records every signature in the ledger. ✓

## R1. Custody

I attacked the pairing (CPI wrappers, two vaults in one transaction, account-index binding, instruction-sysvar parsing), the emptiness proof (Token-2022 extensions, delegates, close authorities, lamports, nested Core assets, declared-but-foreign accounts), and anything that lets a thawed vault leave a transaction unburned.

**No defect found.** The open/burn pairing binds asset AND owner in both directions, walks only top-level instructions, and fails closed. BURN's emptiness proof checks every reserve ATA under both token programs, plus every non-reserve token account owned by the PDA. The lamports check (`asset_signer.lamports() == 0`) is satisfied by the sweep helper. A thawed vault that is not burned reverts with the whole transaction.

## R1s. The Sweep Helper

I audited `programs/cbob-vault-sweep/src/lib.rs` against the seven sub-questions.

**(a) Access control — SOUND.** Called directly, it requires `signer.is_signer`; a vault's PDA cannot sign except through Core ExecuteV1, which only the owner can invoke (Core's `ExecuteV1` authority rule on a thawed vault approves only the owner; the collection abstains; the AgentIdentity adapter cannot be added by an owner without the collection's update authority, which is MINT's PDA). Measured: SR.5, SR.5a, SR.5c.

**(b) Pair list — SOUND.** A source must be owned by the signer (checked). A destination must be owned by the one destination wallet and have the same mint (checked). Duplicate sources: the first closes the account, the second fails to read it (account gone) and reverts the whole call — a grief the redeem page avoids by naming each source once. A source that is also a destination is refused (`signer.key == dest.key`). A native wSOL source is a classic 165-byte SPL account and reads correctly. A source with a delegate: the sweep transfers the balance and closes the account; the delegate is gone. A frozen source: the transfer reverts the whole call; the redeem page never names a frozen account (it leaves it behind with a box). An odd or zero account count: refused (`(accounts.len() - 4) % 2 != 0`).

**(c) Destination checks — SOUND.** The destination wallet is chosen by whoever builds the transaction; given (a), only the owner can make the vault wallet sign, so only the owner's destination can be named. A credit below rent exemption to a non-existent account is refused by the runtime (measured R41.C8a-c); the canonical destination is the owner, who pays the fee and exists.

**(d) Lamport sweep — SOUND.** `signer.lamports()` is read at execution and the transfer is invoked in the same instruction; nothing can land between. Core does not deposit lamports into the asset-signer PDA during ExecuteV1. BURN's `lamports == 0` check sees exactly what the sweep left (zero).

**(e) Interaction with BURN's emptiness proof — SOUND.** The sweep closes what it empties; BURN checks `amount == 0`, not closure. A closed account is either absent (skipped) or a 1-byte tombstone (skipped by the `d.len() < TOKEN_ACCOUNT_LEN` check). A reserve ATA that does NOT exist when the page builds the transaction: the page creates it in a prior transaction (item 42), so the sweep can name it. A stranger can create a classic ATA permissionlessly, but the sweep moves its live balance to the owner and closes it — the emptiness proof then sees a closed account and skips it. A Token-2022 ATA for a classic mint is refused by `read_token` (length != 165). A non-ATA token account owned by the PDA is caught by BURN's second loop.

**(f) Fit — SOUND.** S8.0 measures 1,061 bytes for the three-asset redemption through the helper with the owner as fee payer. With compute-budget pair (+52) and separate fee payer (+96) it is ~1,209 of 1,232. ✓

**(g) Evidence — SOUND.** SR.0-SR.4a in the suite and S8.* in the simulation exercise every refusal branch. The helper is deployed in the suite from the same bytes `scripts/build-mainnet.sh` proves (`cmp -s` against `target/deploy/cbob_vault_sweep.so`).

## R2. The Community Pool

I attacked the invariant "the pool always holds at least ceil(owed)" under every ordering of the host instructions, and every counter (`pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight`) under every activation, distribution, claim, retire, and boost.

**No defect found.** The accumulator arithmetic is exact: `credit` adds `floor(avail * ACC_SCALE / w)` to `acc_scaled` and `delta * w` to `owed_scaled`; the sub-sat remainder stays in the pool. `claim` pays whole sats and carries the remainder in `carry_scaled`. `join` sets `debt = w * acc` at the accumulator as it stands, so the new vault earns only from the next distribution. `retire` subtracts the pending share from `owed_scaled`. `reweigh` moves the owed share to `carry_scaled` and resets debt, so a weight change never loses or gains. `JoinWaitingFirst` guarantees no distribution credits while an eligible vault waits, making every join exact. The pool can never go short because `distribute` reads the live balance and refuses `PoolShort`.

## R2b. The $CBOB Boost

I attacked the invariant that a boost earns EXACTLY its N distributions and not one more; that nothing a vault earned is lost or gained when its weight changes; that `total_active_weight`, `boost_weight_total`, `boosts_active`, `boosts_due`, and the ring always agree, including past epoch 64; that no record can be expired twice, early, or never; and that nobody can make distributions impossible by boosting.

**No defect found.** A boost is scheduled at purchase: `boost_expiring[end % 64] += 1`. The distribution that reaches `end_epoch` makes it due (`advance_epoch` adds `boost_expiring[i]` to `boosts_due`). `BoostsExpireFirst` refuses any distribution while `boosts_due > 0`. Expiry unschedules (decrements the ring slot or `boosts_due`), reweighs to level weight, and clears `boost_end_epoch`. A second expiry is skipped because `boost_weight == 0`. The ring is 64 slots and boosts last at most 63 distributions, so a live end epoch never shares a slot with another live end epoch. Early retirement (bare burn before due) unschedules from the ring slot, not from `boosts_due`, so the slot is correct when the epoch later advances. The host order in the crank (retire, join, distribute, activate, claim) and the `BoostsExpireFirst` gate make the schedule exact.

## R3. The Level Draw

I audited `capture_entropy` / `reveal_level` / `reschedule_reveal` and the crank that rides on four host instructions.

**No defect found.** The draw uses three slot hashes from three different leader rotations (A at or after `reveal_slot`, B and C each two 4-slot groups later), drawn without replacement from the remaining census. `revealed_total` enforces FIFO. A burned vault at the head of the queue still takes its draw (L.11). The attribute re-supply hash prevents tampering. The reschedule target is `now + REVEAL_LEAD_SLOTS`, a slot that does not exist when the reschedule lands. The crank captures for up to `MAX_CRANK` records and reschedules missed windows. SlotHashes parse is defensive (sysvar key, count bound, buffer check, all-zero refusal).

## R4. Governance

I audited every path: minority carry, vote reaching money, frozen governance.

**No defect found.** The electorate is fixed at proposal creation (`index_snapshot`); vaults minted during the vote cannot vote (`VaultTooNew`). Quorum is ceiling division against the snapshotted live supply. Threshold is floor division of YES over votes cast. Turnout requires YES ≥ 10% of the snapshot. Key changes require YES ≥ 50% of the snapshot and cannot be bundled. A restart voted before the stop it would lift is refused (`StopIsNewer`). An overtaken action is a logged no-op, not a revert. The guardian can only stop; a stolen key holds sales and the sweep shut for a vote plus a week at best, and for good while fewer than half of all live vaults vote to replace it (limit 47). With no vaults left, governance cannot act until a new vault exists (limit 45).

## R5. The Charter Claim

I audited `claim_charter_vault` and the Proof-of-Burn collection's hot update authority.

**No defect found.** Identity is by address against a Merkle root of 240 addresses (domain-separated, sorted pairs). The claim CPI-burns the PoB as its owner in the same instruction. The window is fixed at `initialize` and can never reopen. `pob_extra` accounts are passed through to Core's burn never as signers. The hot wallet can add a plugin that bricks claims (limit 46); the alarm pages on any plugin or update-authority change, and the claim page refuses a PoB or collection carrying an external plugin. The window closes forever, ending the exposure.

## R6. One-Time Configuration

I audited every `initialize` across the four vault programs and the sweep helper (which has none).

**No defect found.** Each `initialize` is signed by `INIT_AUTHORITY` (Gary's wallet on mainnet, the test key under `--features localnet`), writes a config PDA once, and refuses a second call. The bounds are enforced: `max_supply` 2,100, `level_caps` 945/525/315/210/105, `monthly_secs` 30 days, `notice_secs` 7 days, `redeem_window_secs` 3600, `quorum_bps` 2100, `threshold_bps` 5100, `min_voting_secs` 3 days, `sweep_floor` 1 SOL, `cooldown_ceiling` 24 h, `reserve_ceiling` 0.1 SOL, `max_sweep` 10 SOL, `max_boost_weight` 12, `max_boost_epochs` 24. The swap operator is the one trusted key: bound by cap × cooldown, stoppable by the guardian, replaceable only by a vote of half of all live vaults plus a week's notice. The 10% royalty is a Core plugin with authority `None`; Core refuses every update or removal. The redemption cap is a true rolling window over a 64-slot ring of timestamps.

## R7. Cross-Program Raw Reads

I recomputed every offset and account space from the struct definitions.

**All offsets correct.** MINT config v6: governance at 41, minted_total at 141, bare_retired at 454, charter_closes at 442, pool_ata at 73, dist_epoch at 655, pending_count at 663, pending_this_epoch at 671, cbob_mint at 679, max_boost_weight at 711, max_boost_epochs at 712, boost_price at 714, boost_weight at 722, boost_epochs at 723, boosts_active at 725, boosts_due at 729, boost_weight_total at 733, cbob_burned_total at 741, boost_expiring at 749. BURN config v4: burned_total at 42, redeem_window_secs at 50, rate_head at 58, rate_ring at 59. VaultRecord v4: mint_index at 41, pending at 177, request_epoch at 178, boost_weight at 186, boost_end_epoch at 187, carry_scaled at 195. SEAL config v2: collection at 9, reserves at 41. The sweep helper reads classic SPL token accounts at mint 0, owner 32, amount 64, state 108, length 165. Every cross-program read is pinned by address, owner, discriminator, and version byte.

## R8. Suite, Simulation, and Build as Evidence

I audited `tests/3prog.test.ts`, the Test Vault simulation, and `scripts/build-mainnet.sh`.

**No arm found that cannot fail.** The `because()` list pins every negative to its exact error code or log line; a wrong-reason reject shows as `XX`. The assertion floors equal the counted assertions (912 on-chain, 1004 detectors, 39 allocation, 24 poster, 68 launch, 35 mainnet probe, 14 PoB, 6 host unit, 4 expiry-budget, 71 sim, 132 e2e, 695 web offline). The suite runs against real cloned Core and real SPL tokens. `build-mainnet.sh` deploys both builds and asks each whether it trusts the test key (mainnet must reject, localnet accept), then prints the sha256 to deploy. The sweep helper's mainnet bytes are proven byte-identical to the tested localnet bytes (`cmp -s`).

## Accepted Limits — Four Questions

1. **Any limit WORSE than stated?** No. Every limit I re-read matches the code's actual behavior.
2. **Anything listed as a limit not actually a limit?** No. Each is a real consequence of a decision or a real unrepaired finding.
3. **Any DISCHARGED item not actually discharged?** No. Items 1a-24 are gone with the Bank, the deck, the distributor, or were measured closed (12, 14, 19, 30, 31, 33, 51, 54).
4. **Any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 remain open and are flagged as blocking.

## Findings

After exhaustive independent audit, I confirm the round 44 verdict: **the five programs are LAUNCH-CLEAN.** I found no CRITICAL, HIGH, or MEDIUM defect in the five programs, in any value path, or in any holder crack. The round 44 repairs hold at every site. The new rehearsal driver is sound.

I file no new findings in the five programs. The seven round-44 findings (V44-1..V44-7) are all in the fixable layer, all outside (a)-(d), and all repaired or acknowledged.

---

## What AI Audit Structurally Cannot Do, and What the Project Must Do Before Launch

AI audit reasons about code; it never executes it against a live cluster with real money, real third-party programs, and real human behavior. The following are structurally beyond what this process can certify, and each must be exercised before the upgrade authority is removed:

1. **The dress rehearsal on mainnet (item 22).** The crank's live passes against ~2,100 vaults, the alarm's live passes, one full revenue cycle through each real pool (Orca forced to refuse once so Meteora really runs), one forced post-sweep failure walked through by hand, and one DAS read of a burned Core asset — none of this has ever run against a live cluster. The rehearsal driver is built; it must be run.

2. **Deployed-byte verification at the live ids.** `build-mainnet.sh` proves the artifacts; `solana program dump` at the five live ids and a byte-against-`dist/` comparison (prefix hash, zero tail) is the only proof that what ships is what was audited. This must be done after step 9 and re-done after step 10.

3. **Real Phantom, real Squads return, real Cloudflare/nginx.** The holder pages are built and staged but not published. A real holder must connect a real Phantom wallet, claim a vault, activate it, vote, and crack it through the real `/rpc` proxy behind Cloudflare, with a real Squads v4 returning a rescued vault. The e2e test drives the pages' library with keypairs, not a wallet.

4. **The off-chain pipeline's live I/O.** The crank, alarm, and revenue job have never run against a live deployment. Their I/O (rate limits, paging, transient RPC errors, the revenue ledger's hand-recovery path) is unmeasured. The rehearsal exercises them at throwaway ids; mainnet is the only remaining test.

5. **Third-party upgrade keys.** Orca, Meteora, Pyth, and Core are all upgradeable by keys we do not control. The alarm watches their upgrade authorities and bytes; a change is detected, not prevented. The project must accept this permanent, unfixable risk and ensure the alarm's baselines are re-taken after every upgrade.

6. **The $CBOB release wallet and the PoB hot wallet.** Both are hot keys on the box. The project must confirm their custody (dedicated release wallet, Gary Club inventory key) and back up the key files before the window opens.

7. **Holder understanding.** No audit can verify that a holder reads the honest list, understands the 2.1%/hour queue, or knows not to burn the NFT outside the redeem page. The holder guide is DRAFT and must be published only after item 50 ships.