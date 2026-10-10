## Ordered findings

### R0. Round-46 verdict and its repairs

V46-1..V46-4, V46-6, V46-8 verified at their sites. `nextAction`/`resumable`,
`ceremony-values` re-fill + `recheck`, `nestedSent` on nest/treasury,
`handRecover` landed-swap continuation + `handClosed`, `walletRefusal`,
`judgeInitAccount`/`judgeCeremonyMode`/`sendWithInit` refusal hold.

No re-file. Two new-code gaps:

**R0-1 LOW, fixable tooling. `scripts/rehearsal-refresh.mjs:untracked()` misses ignored files.**
Claim: “snapshots EVERY untracked and ignored path”. Code: `git ls-files --others -z` without `--ignored`. Ignored keys survive `checkout --detach` on disk but are never snapshotted, so `judgeKept` cannot prove they were kept.
Evidence if true: put a key in an ignored path, refresh, `before` lacks it.
Fix: `ls-files --others --ignored --exclude-standard -z` or state only untracked is kept.

**R0-2 INFO. `scripts/readme-facts.mjs` gates the run but is in NEITHER pass.**
`run-tests.sh` fails when README facts are stale. This pass does not carry that file, per its own file list. A claim about it is a claim about a file not given.
Evidence: `run-tests.sh` `node scripts/readme-facts.mjs --check`.
Fix: carry it in the programs pass or drop the gate from the certifying runner.

Stripped build, `sbf-strip.sh`, `verifiable-build.yml`, `rehearsal-ceremony-helper.mjs`, placeholder fixture, `my-vaults.mjs` read. No value path found in them. Stripping is symbols only; runners now deploy stripped bytes, so CU/packet numbers are on the shipped shape.

### R1. Custody

SEAL `open_for_redemption` forward walk + BURN `burn_vault` backward walk both bind asset idx 0 and owner idx 2, top-level only via `load_instruction_at_checked`. Wrapper arms WR.1-WR.4 still refuse for the named reasons. No second privileged signature exists. No theft path found.

### R1s. Sweep helper — HIGH, class (c)

**R1s-1 HIGH. An empty Token-2022 ATA for a reserve mint, created permissionlessly by a stranger, makes every redemption of that vault fail, and the page has no path out.**

Construct: `programs/cbob-vault-burn/src/lib.rs:burn_vault` reserve loop + `programs/cbob-vault-sweep/src/lib.rs:read_token`.

Code:
```
for mint in reserves { for token_program in [CLASSIC, T22] {
  expected = ATA(pda, token_program, mint);
  acc = remaining.find(expected).ok_or(ReserveNotDeclared)?;
  if owner not token program: continue;
  ...
  require!(d.len()==165, ReserveHasExtensions);
```
Helper: `if owner != CLASSIC IllegalOwner; if len !=165 InvalidAccountData`.

Facts:
- Every Token-2022 ATA is 170 bytes, never 165, per measured pin.
- ATA create is permissionless for any `(owner, token_program, mint)`. Mint owner is not checked.
- Page declares both derivations and creates only classic ATAs in the prior transaction.

Attack: stranger calls ATA create with `token_program=T22`, `owner=vault PDA`, `mint=cbBTC`, no deposit. Empty 170-byte account now exists at the address BURN must be shown. Redemption:
- undeclared → `ReserveNotDeclared`;
- declared → `ReserveHasExtensions`, even with amount 0, because length is checked unconditionally.
Helper cannot name it (`IllegalOwner`/`InvalidAccountData`). No page `ExecuteV1` closes a T22 account. Owner cannot close it in a separate transaction: close needs PDA signature via `ExecuteV1`, which needs a thaw, which needs a burn in the same transaction.

Gain: grief any vault's opening for ~0.002 SOL + fee. Persistent until custom client adds a T22 close inside the open→burn transaction.

Evidence if true: on a validator, create T22 ATA for vault PDA/cbBTC empty, send `open + helper(classic only) + burn(6 declared)` → `ReserveHasExtensions`; omit it → `ReserveNotDeclared`; helper-only close never touches it.

Fix before lock, program change: in BURN reserve loop, skip a T22 expected account with `amount==0 && len!=165` only when a classic expected account for the same mint is also declared, or explicitly refuse T22 ATA creation by closing it via a T22 close in the page + helper support. At minimum state in SPEC 44 that an empty T22 reserve ATA is a blocking grief, not merely “not covered”. This is worse than ACCEPTED 44 as written.

Remaining R1s (a)-(d),(f),(g) hold: direct call needs signer, Core `ExecuteV1` 0x1a for stranger/delegate/collection UA per SR.5-5c, duplicate source reverts on second `read_token`, `signer==dest` refused, lamport sweep to zero with BURN `lamports==0` immediately after, S8.0 1,061-byte shape with room accounted.

### R2. Pool

`pending_count`/`pending_this_epoch`/`active_count`/`total_active_weight`, `join` only when `dist_epoch>request_epoch`, `waiting_to_join=pending-waiting_this_epoch`, `retire` pending branch, `monthly_inline` wrong-pool-only refusal, `claim` frozen-deferral, `retire_redeemed` forfeit path all re-read correct. `ledger()`-style invariant `pool>=ceil(owed)` enforced by `PoolShort` + `ceil_sats`. No liveness block: `expire_boosts` and join need records only, not token accounts.

### R2b. Boost

N-distribution exactness via `BoostsExpireFirst` + ring `boost_expiring[epoch%64]`, `reweigh` carry/debt move, `unschedule_boost` due/not-due branches, `expire_boost` at same `acc`, ring+due==active accounting hold past epoch 64 per host test N1. No double/early/never expiry found. Token-account-gone vault still joins/expires via records-only paths.

### R3. Draw

`blockhash_in_window` key/count/length/zero-hash pins, `MAX_SKIPPED_SLOTS` smallest-produced, B/C stride 2 groups, FIFO `revealed_total`, burned-head still draws + skips Core write, reschedule `now+16` future slot, `CBOB_REVEAL_RESCHEDULED` logging hold. Residuals remain exactly SPEC 25/26, holder guide states both.

### R4. Governance

Snapshot `minted-burned-bare`, `index_snapshot`, `CharterNotClosed`, quorum/threshold/10% turnout, `KeyChangeNeedsHalf` on snapshot, `KeyChangesBundled`, tighten one-way + bounds at creation and `max/min` at execution, per-kind skip + `CBOB_ACTION_SKIPPED`, 7-day execute window hold. No minority-carry, no money reach, no permanent freeze beyond SPEC 47 as stated.

### R5. Charter

Address Merkle with 0x00/0x01 sorted pairs, owner CPI-burn same instruction, window clock-only, `pob_extra` never signer, guardian-independent hold. SPEC 46 lists collection hook, per-asset blind spot, sampling gap, positive bound, owner freeze-delegate. Complete as far as code shows.

### R6. Init and trusted hop

SEAL/MINT/BURN/GOV `initialize` once + `INIT_AUTHORITY`, collection-clean/ours/unminted, treasury non-default, payment-in-reserves, tighten bounds, boost mint/bounds, window/period/notice floors hold. Royalty `authority None` + R.5/R.6/R.6a Core refusals hold. Rate ring `ceil(2.1%)`, floor 1, `k=min(cap,64)`, kth-oldest `>=window` is exactly a rolling window. Swap operator bound remains cap×windows, as SPEC 10 states.

### R7. Raw reads

SEAL `9/41`, MINT `41/141/454`, BURN `42`, VaultRecord `9/41`, MintConfig v6, BurnConfig v4, GovConfig v4, sweep `0/32/64/165` match structs. No mis-offset found in this read.

### R8. Suite/sim/build as evidence

912/912 + 71/71 + floors rest on runners now deploying stripped bytes, consistent. `because()` pins checked for R1s(e) shape; SR.12b correctly asserts second-close refusal. No arm proven vacuous in this read. Build proof still rests on `initauth.test.ts` both-directions + source-key grep, with stated non-proof of acceptance, unchanged.

## The four accepted-limits questions

1. **Worse than stated: yes — R1s-1.** Limit 44 says T22 accounts are “not covered” and destroyed/left. An empty T22 *reserve* ATA is not a stray: it is a required declaration that refuses the burn even empty, brick-by-brick for pennies, with no page recovery. That is a blocking grief on the crack, not merely loss of junk.
2. **Listed but not a limit: none confirmed here.**
3. **Discharged not discharged: none confirmed here.**
4. **OPEN treated as accepted: yes — item 22.2.**
`audits/rehearsal-2026-10-09/RECORD.md` records 22.2 FAIL (real Core upgrade mid-run, `config_drift` CRITICAL + `watchdog_gap`), yet road step 8 is marked “done on mainnet 2026-10-09 to 10-10” and README repeats it. Item 22 is OPEN AND BLOCKING and requires the named live alarm passes. A true-detection FAIL still leaves “a pass 2 with nothing to report” unproven. Ship with 22.2 FAIL means launching while the blocking rehearsal item is red. Fix: re-run pass 2 clean on the new Core baseline and record PASS, or keep step 8 not-done.

## Else

`web/` wallet-edit judge, own-budget `withComputeBudget`, relay CBOB-only + Lighthouse-as-non-work, ceremony `walletRefusal`/re-read/stop-on-broken, metadata fail-closed + no-backwards, `absentIfDust` dust rule hold as coded. No holder-value loss path found beyond R1s-1.

## What AI audit structurally cannot do before launch

1. Run the 2,100-vault crank/reveal against a live cluster with real paging, fees, and a transient failure deep in the walk; five vaults prove I/O, not scale. Do it on mainnet with the rehearsal ids before value.
2. Prove the pinned Core binary equals the reviewed Core source; all `ExecuteV1` authority reasoning rests on source `e72d63e` + binary behavior arms. Re-pin by hash on every Core change and re-run 912/912, e2e, sim, as just done for 51d41542, and keep `core-watch` alarming.
3. Watch the hot keys off-box: swap operator, $CBOB release, PoB collection authority, deploy authority. Box-owner compromise defeats every in-tree judge. Move release to cold/Squads, fund operator float minimally, cold the PoB authority after the window.
4. Publish the pages/proxy/metadata/ceremony and exercise them with real Phantom, real Helius limits, real DAS lag, and Gary’s signing ceremony end-to-end. Offline + local e2e do not prove Helius, Cloudflare, or holder comprehension.
