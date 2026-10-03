# AUDIT REPORT — CBOB Vault v6

**Scope note that governs everything below.** The bundle contains the full off-chain pipeline and **only one of the four programs** (`cbob-vault-mint/src/lib.rs`). SEAL, BURN and GOV source, `bank/sigwalk.mjs`, `scripts/check-launch-params.mjs`, `scripts/cron-install.sh`, `scripts/probe-mainnet-facts.mjs`, `scripts/pob-merkle.mjs`, `tests/3prog.test.ts` and `sim/` were **not delivered**. Every claim I make about the emptiness proof, the open/burn pairing, the rolling rate limit, the vote tally, or the signature walk is therefore a statement about code I could not read, and I have not written findings against those mechanisms. Findings below are confined to what was actually in the bundle.

---

## R1 — THE CRANK (`bank/crank.mjs`)

### CRANK-1 — LOW — captures are planned from a *lower bound*, so the crank pays for `RevealTooEarly` refusals
**Construct:** `readySlot()` + the capture branch of `planCrank()`.
`readySlot` returns `(floor(reveal_slot/4)+4)*4`, which is a correct **lower bound** on the third entropy slot C, not the slot C actually lands at (skipped slots push C later). The crank captures as soon as `slot > readySlot`, so between that bound and C's real production every pass sends a `capture_entropy` that the program refuses with `RevealTooEarly`.
**Gain/accident:** wasted fees only, bounded by the ~300-slot window and the every-minute lane (a couple of refusals per lapsed vault). No state corruption — the program refuses cleanly.
**Evidence if I am right:** on a validator, skip the leader slots after a mint and watch the reveal lane log `FAIL capture … RevealTooEarly` once or twice before the capture lands. The comment already concedes "a NotYet answer is harmless," so this is priced in, but it is a plan the program refuses.
**Fix:** capture only when the *previous pass* saw C present, or accept the refusals as designed and stop logging them as failures.

### CRANK-2 — LOW — the two lanes hold separate locks and can both send the same reveal; the loser pages a spurious failure
**Construct:** bottom of `crank.mjs` (`LOCK = …-reveal.lock` vs `.crank.lock`) + the reveal loop's `if (!ok) { failures.push(...); break }`.
The full pass and the `--reveal-only` lane are deliberately on different locks, so they run concurrently. Both plan reveals from the same `revealed_total`. When they race, the second sender hits `AlreadyRevealed`, pushes to `failures`, and the crank SMS-pages "action(s) failed" for a benign race.
**Gain/accident:** operator noise + a wasted fee; the full pass's reveal run also stops at the first raced vault.
**Evidence if I am right:** run both lanes against one unrevealed vault on a validator at the same slot; one logs `ok`, the other logs `FAIL … AlreadyRevealed` and exits 1.
**Fix:** treat `AlreadyRevealed` on a reveal as "done, not failed" (like `MonthNotElapsed` is handled in `runDistribute`).

### CRANK-3 — LOW — pending vaults are not joined during a pool freeze, although the program permits it
**Construct:** the claims gate `if (poolOk && !pool.frozen) { … ready.push(...plan.joins) … }`.
`plan.joins` is only emitted inside the claim batches, and the whole block is skipped when the pool is frozen. But the program's `claim` join branch (`if r.pending { … join … }`) never touches the pool balance and succeeds with a frozen pool. So the crank delays joining until thaw even though joining is possible.
**Gain/accident:** liveness only — vaults wait an extra freeze-length before they can earn. No funds at risk.
**Evidence if I am right:** freeze the pool on a validator, request activation for a vault, run the crank; the vault stays `pending` until thaw, while a hand-built `claim` naming it joins it immediately.
**Fix:** send the join batches outside the `!pool.frozen` gate.

**What I looked for and did not find (stated, not praise):** a reveal sent out of mint order (the loop stops at the first not-ready index and the program re-checks `RevealOutOfOrder`); a plan that pays or joins a positively burned vault (both `retireBurned`/claims/joins test `assets[r.asset] === 'burned'`, and retire runs before claims in the same plan); and value moved anywhere the program does not pin (the crank emits only `activate`, `capture_entropy`, `claim`, `distribute`, `reschedule_reveal`, `retire_burned`, `reveal_level`, all permissionless, fee-payer only). The residual pay-a-dead-vault window is exactly accepted limit 27 (burn between snapshot and landing) and I am not re-reporting it.

---

## R2 — THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

### ALARM-1 — HIGH — the production-value assertions do not cover several values that are permanent at `initialize`
**Construct:** `detectStandingRisks()`, the `opts.production` `want` array.
The array asserts exactly nine keys (`monthly_secs`, `redeem_window_secs`, `notice_secs`, `sweep_floor_lamports`, `cooldown_ceiling_secs`, `reserve_ceiling_lamports`, `quorum_bps`, `threshold_bps`, `min_voting_secs`). It does **not** assert `mint.max_supply`, `mint.level_caps`, `mint.payment_mint`, `mint.bank_treasury`, `mint.charter_opens_at`/`charter_closes_at`, or `mint.pob_root` — all of which SPEC and limit 38 call "fixed forever." Those keys are in `WATCH`, but `detectConfigDrift` only fires on a **change** from a prior pass; a value that is wrong from the first read never drifts. So a wrong `initialize` of any of them is permanent and produces **no** `test_value_in_production` finding.
**Why this is worse than limit 38 states:** limit 38 says "the alarm reports a wrong one only AFTER it is written (`test_value_in_production`)." For these six values that sentence is false. It also says `check-launch-params.mjs` checks "every ruled value equals the alarm's production list (**the same list, imported**)." If that is literally true, the launch checker inherits the same omission, and `max_supply`/`level_caps`/`payment_mint`/`bank_treasury` have **no automated ruled-value check anywhere**. `payment_mint` is the sharp one: `initialize` only requires it to be *a* SEAL reserve, so `$GARY` would pass and the pool would silently pay in the wrong asset.
**Evidence if I am right:** call `detectStandingRisks({'mint.max_supply':'21000'}, {production:true})` → returns `[]`; call it with `{'gov.min_voting_secs':60}` → returns `test_value_in_production`. I could not inspect `check-launch-params.mjs` (not in bundle) to confirm whether it independently checks these.
**Fix:** add the six permanent values (with ruled values 2100, 945/525/315/210/105, cbBTC mint, the Squads address, the charter window, `pob_root`) to the production list, and make the launch checker verify them from a source that is *not* the alarm's list so the two cannot share one blind spot.

### ALARM-2 — MEDIUM — `distribution_overdue` is silent exactly in the launch/tick case it most needs to catch
**Construct:** `detectDistributionOverdue()` — `if (w === 0n) return []` and `if (BigInt(poolAvail) <= 0n) return []`.
When vaults have *requested* activation but none has *joined* yet (the launch state), `total_active_weight` is 0 and the only useful action is the free **epoch tick**. If the crank is down and there is no protocol traffic, the tick never runs and those vaults are stuck. The detector returns `[]` because weight is 0, and `joins_waiting` does not fire either (it only counts vaults already eligible, `pending_count - pending_this_epoch`). So a stuck launch is fully quiet.
**Evidence if I am right:** `detectDistributionOverdue({'mint.last_distribute_at':'1000','mint.monthly_secs':'100','mint.total_active_weight':'0','mint.pending_this_epoch':'1'}, {nowSec: 999999, poolAvail: 0n})` → `[]`, even though the tick is long overdue and vaults wait on it.
**Fix:** add a branch — period overdue AND (`pending_count > 0`) → page, independent of weight and of `poolAvail` (the tick moves no money).

### ALARM-3 — MEDIUM — `redemptions_near_cap` pages every pass on an *idle* window whenever the cap is 1
**Construct:** `detectRedemptionRate()` — `near = max(1, floor(cap * 0.2))` then `if (c.remaining > near) return []`.
For live supply ≤ 47 the cap is 1, so `near = max(1, floor(0.2)) = 1`. With an empty ring, `remaining = cap = 1`, and `1 > 1` is false, so the detector emits a HIGH `redemptions_near_cap` **with zero redemptions in the window** — every pass, for as long as live supply is small. This is the R2 "routine state it pages on every pass" case.
**Evidence if I am right:** `redemptionCapacity` with `minted_total=3`, an all-zero ring, and any `nowSec` gives `{cap:1n, remaining:1n}`; `detectRedemptionRate` then returns one HIGH finding although nothing has been redeemed.
**Fix:** never page when the window is idle — e.g. `if (c.remaining >= c.cap) return []` (equivalently, require at least one redemption inside the window before "near cap" can mean anything).

**Checked, no finding:** pool insolvency/freeze detection (`detectPoolHealth` uses `ceil(owed)` correctly and catches absent/foreign/malformed as `pool_unreadable`), the invoke-stack attribution in `parseCbobLogs`, the DAS envelope hard-fail (`judgeDasEnvelope`), and the bare-burn vs redemption correlation. I could not verify the signature walk (`sigwalk.mjs` absent) on which the burn/sweep/split detectors depend.

---

## R3 — THE LAYOUTS (`bank/layout.mjs`)

I re-derived the `MintConfig` byte map by hand from the provided Rust and it agrees with `layout.mjs` field-for-field; the two cross-program offsets the prompt names check out from first principles: `minted_total` at **141** and `bare_burns_retired` at **454** (computed by summing field sizes from offset 8). The `u128` reader/writer is correct little-endian, and the version/discriminator/owner pinning in `readPinned`/`anchor.mjs` refuses wrong accounts rather than misreading.

**Coverage limit, not a clean bill:** `SealConfig`, `BurnConfig` and `GovConfig` are asserted only by the selftest parsing Rust I was not given, and `VaultRecord` likewise. I cannot confirm those structs match their programs. The mechanism (parse-and-compare, equality floor) is sound; its subject for three of four programs was outside the bundle.

---

## R4 — THE MONEY ARITHMETIC (`bank/accrual.mjs` vs MINT `lib.rs`)

I compared `ceilSats`/`ceil_sats`, `credit`/`credit`, `pendingSats`/the `claim` per-vault math, `debtAtActivation`/`join`, and `available`/`distribute`'s `avail`, line for line. **No divergence found** in scale (1e12), weights (2..6), truncation direction (dust stays in the pool, truncation is against the vaults by < 1 sat total), and the `owed += delta*w` invariant. The one behavioural difference is intentional and safe: JS `available` floors at 0 where the program raises `PoolShort`, which only makes the crank *not* send a distribute the program would refuse.

This is a non-finding for the code that was present; it is **not** a verification of BURN's rate-limit arithmetic or SEAL, whose source I do not have.

---

## R5 — THE SWAP HOP (`bank/revenue.mjs`)

### REV-1 — MEDIUM — the swap-transaction inspection never resolves address lookup tables
**Construct:** the pre-sign block in `main()` — it checks `msg.staticAccountKeys` against `FORBIDDEN`, requires exactly one required signer, and caps `msg.addressTableLookups?.length` at 4, but **never fetches or inspects the accounts those lookups load**.
A malicious or compromised quote/swap endpoint (or MITM) can return a transaction whose static keys look clean while an ALT loads the instruction or recipient that moves the swept SOL elsewhere. The operator signs the whole message, so every loaded instruction executes. The signer check does not help: it only proves no *other* signer is required, not that the instructions are benign.
**Bound:** one sweep (`max_sweep_lamports`, PROPOSED 10 SOL) per occurrence — this sits inside accepted limit 10's trust, but it converts "trusted operator" into "trusted operator **and** trusted Jupiter response path," which the documents do not separately accept.
**Evidence if I am right:** build a versioned message with one required signer (the operator) and one `addressTableLookup` whose table contains a transfer-to-attacker; the current checks pass it because they read only `staticAccountKeys` and count lookups.
**Fix:** resolve each lookup table on-chain and apply the same forbidden-program/destination checks to the resolved keys, or refuse any route carrying ALTs.

**Worst case and ledger:** the open-cycle guard (`cycleIsOpen`, imported once) prevents stacking a new sweep on an unresolved one; a rejected send is closed, an unconfirmed one stays open; `--audit` and the alarm both reconcile swept-vs-returned. I found no path where a failed cycle reads as closed. The destination of the return transfer is hard-coded to the revenue ATA and the split destinations are pinned on-chain, so nothing here routes value where the program does not pin, apart from the off-chain swap itself (accepted).

---

## R6 — THE GATES (`bank/selftest.mjs`, `scripts/run-tests.sh`)

### GATE-1 — LOW — the mainnet probe passes vacuously when the box has no network
**Construct:** `run-tests.sh` — the `if node -e "dns lookup…"` wrapper around `probe-mainnet-facts.mjs`.
With no network the 24 live-mainnet assertions are **skipped**, not failed, so an offline build certifies without ever asserting that cbBTC/$GARY/$GIRAFFISH are classic SPL or that the signature walk pages against a busy program. It is loudly skipped ("NOT asserted by this run"), so it is not silent — but it is a check that does not run when its input is absent.
**Fix:** acceptable as-is for CI-less boxes, but the ship gate should require one run where the probe actually executed.

### GATE-2 — LOW — SPEC drift that *understates* a control
**Construct:** SPEC "Distribution" paragraph: "since v5's `bank/distribute.mjs --selftest` was deleted **no selftest asserts them** any more," referring to the census denominators 732 and 6,405.
`bank/accrual.mjs --selftest` **does** assert both (`denom([108,60,36,24,12]) == 732n`, `denom([945,525,315,210,105]) == 6405n`). The documented claim is stale and tells an auditor a control is missing that exists.
**Fix:** correct SPEC.

**What I could verify about the floors:** `selftest.mjs` uses an **equality** floor (`R.length !== FLOOR` → exit 1), and `run-tests.sh`'s `floor()` demands `-eq`, not `-ge`. Neither can be satisfied by deleting assertions; both require a deliberate, visible constant change. The both-ways detector tests are real (each has a must-fire and a must-not-fire case). **What I could not verify:** the gates that read `cron-install.sh`, `check-launch-params.mjs`, `probe-mainnet-facts.mjs`, `pob-merkle.mjs` and the four Rust programs, because those files were not in the bundle — the selftest would execute them from `/opt/cbob-vaults`, which I cannot run.

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

**1. Is any limit WORSE than stated?**
Yes, one: **limit 38's residual detection is weaker than written.** It says "the alarm reports a wrong one only AFTER it is written (`test_value_in_production`)." As shown in ALARM-1, that is false for `max_supply`, `level_caps`, `payment_mint`, `bank_treasury`, the charter window and `pob_root` — the alarm never reports a wrong initial value for those. Since limit 38 is OPEN AND BLOCKING, this should be fixed before launch, not accepted. I found no other accepted limit that is exploitable beyond its wording.

**2. Is anything listed as a limit not actually a limit?**
I checked limit 35 (10% turnout never binds) against the ruled numbers and it is correct (smallest passing YES is 225/2100 = 10.71% ≥ 10%). I found no listed limit that is already closed or non-existent. I could not re-verify the measurement-based discharges (12/17 CU, 32 ring) without running the suite.

**3. Is any DISCHARGED item not actually discharged?**
For the items verifiable from the bundle, no: item 19 holds (`activate` requires `level ∈ 1..=5`, so no activated-unlevelled state exists); item 30 holds (no instruction writes `split_bps` after `initialize`); item 14 holds (`DuplicateAttribute` is enforced in `check_attributes`). Items discharged "by measurement" (12/17, 33) I cannot re-measure and am accepting on the stated basis.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**
Item 38 is partially in that state by construction: the runtime backstop it relies on (the alarm's production list) silently omits six permanent values (ALARM-1), which is functionally treating those six as if they need no post-initialize watch. Items 22 and 50 are honestly labelled (crank installed dry-run; redeem page marked PROCEDURE/"nothing runs it today").

---

## ANYTHING ELSE

- **The audit's own input was incomplete.** This is the single most important operational fact: the bundle omits three of the four programs, the signature walker, the launch checker, the cron installer, the probe, and the whole on-chain suite. Any certification that rests on "the AI read it" has not read most of the enforcement. This is not a code defect; it is a process defect that the ship gate must close.
- **`INIT_AUTHORITY` == guardian == Gary's wallet** in all four programs (confirmed in MINT). This is a ruling and I am not arguing it, but note it means the one-time `initialize` signer and the emergency brake are one key; the documents already accept the brake's risks (limit 47).

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what to do before launch that AI audit structurally cannot

1. **Deliver the whole tree, hash-manifested, and make the AI audit run against it.** SEAL, BURN, GOV, `sigwalk.mjs`, `check-launch-params.mjs`, `cron-install.sh`, the probe, `tests/`, and `sim/` were absent from this round. An AI reader cannot attest to what it was not handed; a manifest (sha256 of every file) bundled *with* the prompt removes the "file escaped every round" failure permanently.
2. **Execute, don't ask.** AI reasons; it cannot run. Before the authority is removed, capture and archive the actual outputs of `run-tests.sh` (645 + the four floors), the Test Vault simulation, and — critically — the **mainnet dress rehearsal (item 22)** with real small amounts and the crank/alarm live, including an injected transient RPC failure mid-claim-batch. A human should witness and sign those transcripts; an AI cannot.
3. **Break the shared-list dependency in launch values (ALARM-1).** Have a second, independently written checker recompute every `initialize` value from the ruling — *not* importing the alarm's production list — and require a human signature on `mainnet-init.json`. Because the programs are immutable, this one ceremony is the only moment a wrong `max_supply`/`payment_mint`/`level_caps` can be caught.
4. **Prove the deployed bytes match the audited source.** Run `build-mainnet.sh` in a witnessed environment and pin its sha256 for all four programs; AI cannot observe a deploy, so the hash must be the artifact that bridges "audited source" to "on-chain program."
5. **Key custody is a human task.** The guardian, swap operator, `INIT_AUTHORITY`, and the Giraffish Moments hot wallet (limit 46) are operational risks no AI can hold. Establish and document the multisig/handling procedure for these before any value moves; the code only bounds them, it does not secure them.
6. **Run two genuinely independent model rosters** (the ship gate already requires this) against the *complete* tree, and convert every rejected finding into a suite assertion, as the process specifies — but do it with the files actually present, or the convergence the freeze counter is meant to produce is being measured against a partial system.