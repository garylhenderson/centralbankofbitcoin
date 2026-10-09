
# Independent Audit Findings — Round 45 Tree (`0d58d4e`)

I audited the five programs and the off-chain pipeline in the working tree at `0d58d4e`, treating the prior round's LAUNCH-CLEAN verdict as the prior measurement, not the answer. Programs are byte-identical to `RELEASE_COMMIT 0b3ddb3` (verified with `git diff --quiet 0b3ddb3 0d58d4e -- programs Cargo.toml Cargo.lock`).

The audit found one CRITICAL bug, several smaller concerns, and no other launch-blocking defects. The critical bug is in `apply_swap_operator` — it is broken, the suite does not appear to exercise the broken path, and it would lock the swap operator to the System program if anyone called it.

---

## CRITICAL — `MINT::apply_swap_operator` is inverted and will lock the swap operator to the System program

**Where:** `programs/cbob-vault-mint/src/lib.rs`, function `apply_swap_operator` (around line ~715 in the file as provided).

**Code:**
```rust
pub fn apply_swap_operator(ctx: Context<ApplySwapOperator>) -> Result<()> {
    let c = &mut ctx.accounts.config;
    require_keys_eq!(c.pending_swap_operator, Pubkey::default(), MintError::NoPendingOperator);
    let now = Clock::get()?.unix_timestamp;
    require!(now >= c.pending_swap_operator_at.checked_add(c.notice_secs)
        .ok_or(MintError::Overflow)?, MintError::OperatorNoticeNotElapsed);
    c.swap_operator = c.pending_swap_operator;
    c.pending_swap_operator = Pubkey::default();
    c.pending_swap_operator_at = 0;
    emit_wiring(c);
    Ok(())
}
```

**The bug:** The check uses `require_keys_eq!` where it should use `require_keys_neq!`. In `anchor_lang`, `require_keys_eq!(a, b, err)` expands to `require!(a.key() == b.key(), err)`, which passes when `a == b` and errors when `a != b`. So with this code:

- If `pending_swap_operator == Pubkey::default()` (no arm yet, the initial state), the check **passes** and execution proceeds.
- If `pending_swap_operator != Pubkey::default()` (an `arm_swap_operator` was called with a real key), the check **fails** with `NoPendingOperator`.

The error name "NoPendingOperator" reveals the intent: refuse if there is no pending operator. The implementation does the opposite — it refuses when there IS one and proceeds when there isn't.

**The inconsistency proves the intent:** `apply_guardian`, right next to it, gets this right:
```rust
pub fn apply_guardian(ctx: Context<ApplySwapOperator>) -> Result<()> {
    let c = &mut ctx.accounts.config;
    require!(c.pending_guardian_set, MintError::NoPendingGuardian);
    ...
}
```
A separate `pending_guardian_set: bool` field is used precisely because checking a pubkey against `default()` is fragile. The swap operator struct has no such bool:
```rust
pub pending_swap_operator: Pubkey,
pub pending_swap_operator_at: i64,
```
which is why the check is on the pubkey itself. The check direction is wrong.

**Impact:**
1. **`apply_swap_operator` after an arm: always errors.** `arm_swap_operator` requires `operator != default()` and sets `pending = operator`, so after any arm the pending operator is non-default. `apply` then refuses with `NoPendingOperator`. The guardian can never be rotated through the intended path. This violates the design ("A `arm_swap_operator` (governance) arms a replacement; nothing changes yet. ... `apply_swap_operator` (anyone, after `notice_secs`) lands the armed key").
2. **`apply_swap_operator` without a prior arm: succeeds and DOSes the sweep.** When `pending` is still `default()` (the initial state), the check passes, the time check passes (since `pending_swap_operator_at` is initialized to 0, and `0 + notice_secs` is some positive number well before `now`), and then `c.swap_operator = c.pending_swap_operator = Pubkey::default()` (the all-zeros pubkey). The swap operator is now the System program. `sweep_sol_for_swap` requires `ctx.accounts.swap_operator.key() == cfg.swap_operator`; with the operator as the System program, this can only match if the caller is the System program, which cannot sign arbitrary instructions. Royalty SOL therefore accumulates in the revenue address forever. Anyone can call `apply_swap_operator` (it has no auth check beyond the program signer), so this is a one-shot, zero-cost, permanent grief against the Squads' 15% royalty flow.

**Fix:** change `require_keys_eq!` to `require_keys_neq!`:
```rust
require_keys_neq!(c.pending_swap_operator, Pubkey::default(), MintError::NoPendingOperator);
```
After the fix, `apply` proceeds iff there IS a pending operator and refuses iff there isn't, matching both the error name and the design. The guardian's `apply_guardian` (which uses a bool) is unchanged. After the fix, a future `arm_swap_operator` followed by `apply_swap_operator` works as intended.

**Why the suite's 912/912 does not catch this:** the suite's 3c.K5 ("ANYONE lands the armed swap operator once its notice has run") is described in the spec as PASS, but the test in `tests/3prog.test.ts` as provided does not call `apply_swap_operator` after arming — `B1.rotOp = await x('newOp')` only executes the proposal, which calls `arm_swap_operator` and emits the wiring event, then asserts the LIVE operator is unchanged. The actual `apply_swap_operator` (permissionless, after `notice_secs`) is not invoked in the test block I can see. I recommend adding an arm-and-wait-and-apply test that asserts the operator actually changes, with a fixture that proves the current code is broken (call `apply` on a fresh config; assert the operator is now the System program) and a fixture that proves the fix is real (arm with a real key, wait, apply, assert the operator is the armed key).

**Other call sites of `apply_swap_operator`** (none, in the source as provided): the function is only reachable through the transaction instruction, so a one-line test in `tests/3prog.test.ts` closes it.

**Severity:** CRITICAL. Direct impact on the swap operator, which is the only on-chain pointer to the one off-chain trusted hop (limit 10) and the gate for the only `spl-token` transfer that converts royalty SOL into cbBTC for the Squads. A permanent DOS is reachable by anyone, and the design's intended rotation path is permanently blocked.

---

## Other findings

### LOW — `MINT::initialize` and `boost_vault` do not verify `$CBOB` decimals

`MINT::initialize` checks the `$CBOB` mint is classic SPL, 82 bytes, initialized, and not equal to the payment mint or `$GARY`. It does not check the decimals field at offset 44. `boost_vault` reads `(bal, state)` from the burner's `$CBOB` ATA and requires `bal >= price`, then `SPL_Burn` for `price` raw base units. If `$CBOB` is created with `decimals != 6` (ruled for mainnet, so not a mainnet defect), the human-readable price and the actual base units burned will differ. A local rule that stores `cbob_decimals` at `initialize` and checks `price` matches `displayed_price * 10^cbob_decimals` at `boost_vault` would close the foot-gun. Not launch-blocking on mainnet.

### LOW — `GOV::create_proposal` does not validate `SetRound.cap` against remaining supply

`SetRound` requires `cap > 0`, `price >= 21_000 sats`, and a sensible window, but it does not check `cap <= max_supply - minted_total - sum(level_caps) - pending` (or similar). A round opened with a `cap` larger than the remaining supply will run until `check_supply` in `mint_vault` refuses the 51st mint. The cap value is then misleading, and the UI/UX shows a round that is effectively shorter. A straightforward bound at proposal time is feasible and user-friendly.

### INFO — `charter_claimed` does not bind to a specific PoB, and the PoB's own address is the only uniqueness

`charter_claimed` is incremented in `claim_charter_vault`, but there is no per-PoB registry. The only guarantee against double-claim is the atomic burn of the PoB in the same transaction: after the burn, the asset's `data[0] == 0` and `data.len() == 1`, and `claim_charter_vault`'s checks `d[0] == KEY_ASSET_V1` and `d.len() >= 66` both fail. So a successfully-claimed PoB cannot be claimed again. The check is correct but indirect; documenting "double-claim is prevented by the atomic burn, not by a per-PoB set" would help.

### INFO — `redemption` rate limit is 1 per hour when fewer than 10 vaults are sealed

`ceil(2.1% * live)` floors to 1 (`cap.max(1)`), and the ring has 64 slots. With `live < 10`, the cap is 1. So very small deployments (the rehearsal at 5 vaults) cannot redeem faster than one per hour. This is by design and the spec calls it out. Worth noting in the launch checklist that the FIRST redemption after launch can wait an hour.

### INFO — `boost_active` and `boost_expiring` ring rely on a 64-slot ring

`BOOST_RING = 64`. The `boost_expiring[end % 64]` slot is shared by any boost ending at the same epoch mod 64. Multiple boosts ending at the same ring slot are summed; the sum is moved to `boosts_due` on the right epoch and decremented as each expires. This is correct as long as no single ring slot gets more than `u32::MAX` simultaneous boosts, which is bounded by `max_supply = 2100`. No issue.

### INFO — `epoch` arithmetic in `try_capture` rounds to multiples of 4

`want = (slot / 4 + 2) * 4` rounds to the next multiple of 4 that's at least 8 slots after `slot`. The B window's start is 5-8 slots after A (depending on A's offset within its leader group), and the C window is 5-8 after B. The total A→C span is 10-16 slots. The window size is 64 slots. The third hash is always reachable within `reveal_slot + 100 + 64 + 64 + 64` (well within the 300-slot reveal window). Not a defect, but worth noting that the per-iteration offsets are not constant.

### INFO — `migrate` does not exist; no path for `init_authority` to rotate

The one-time `init_authority` is the only writer of the configs. There is no `migrate` instruction, so a launch with a wrong value is permanent. The launch checklist (item 38) already calls this out: every value must be the ruled one before deploy, and `scripts/check-launch-params.mjs` refuses an OPEN value. Not a code defect, but a process point worth keeping prominent.

---

## Confirmed: the program source equals the release

`git diff --quiet 0b3ddb3 0d58d4e -- programs Cargo.toml Cargo.lock` exits 0, so round 45's repairs from round 44 are all present. The layout versions are unchanged from the ruled numbers:
- SEAL config: 2
- MINT config: 6 (the $CBOB boost, the only addition over stage 3c)
- BURN config: 4 (the rolling window, the only addition over stage 3b)
- GOV config: 4
- VaultRecord: 4 (the $CBOB boost fields)

I read the layouts at the offsets named in the spec (`OFF_COLLECTION = 9`, `OFF_VERSION = 8`, `MINT_CONFIG_DISC = [168, 252, 88, 182, 219, 205, 39, 53]`, `BURN_CONFIG_DISC = [90, 69, 15, 87, 119, 190, 109, 45]`, etc.) and confirmed each against the source.

I did not re-run the canonical test suite (the rules say I should not), but the source check is the same check the suite's release gate makes at the top of its run.

---

## What I did not check

- **The off-chain pipeline** (crank, alarm, revenue, poster, redemption-poster, layout, detectors, payout tests). The previous rounds' tabled findings (R44o-1..R44o-6, R44-1..R44-6) cover the off-chain defects and the repairs are in place. I did not re-audit line-by-line.
- **The web pages** (`web/src/pages/*`). The 695/695 web offline test (round 36 L4) covers them; I did not re-run it.
- **The off-chain Probe Mainnet Facts** and the **mainnet fork** of the swap. These depend on the network, and my audit is local.
- **The `test_id` generated by Anchor**. Counted in the floor but never seen; per measurement fact 11 it is one assertion.

---

## My verdict

The five programs are largely correct against the spec, but `MINT::apply_swap_operator` has an inverted check that will permanently lock the swap operator to the System program the first time anyone calls apply on a fresh config, and will refuse every legitimate guardian rotation through the design's intended path. The suite's 912/912 does not catch this because the test "lands the armed swap operator" (3c.K5) only exercises the arm; the apply step is permissionless and never invoked in the test code I can see. The fix is one line: change `require_keys_eq!` to `require_keys_neq!`. I recommend adding a gate-5 test that arms, waits `notice_secs`, applies, and asserts the operator changed, plus a fixture that proves calling `apply` on a fresh config does NOT clobber the operator (the fix's property).

On the gate:
- (a) **Any finding in the five programs, at any severity** — yes, one CRITICAL (`apply_swap_operator`).
- (b) **Any path that moves value out of a vault, the pool or the revenue address, or credits value wrongly** — yes, the `apply_swap_operator` bug prevents the swap bot from sweeping royalty SOL ever again (a one-shot permanent DOS of the operator's value path).
- (c) **Anything that stops or wrongly refuses a holder's crack (redemption)** — no, redemption is unaffected.
- (d) **Any HIGH or MEDIUM finding, anywhere** — no HIGH or MEDIUM in the programs; one LOW in the programs (decimals), one LOW elsewhere (cap-vs-supply), and several INFOs.

Under SPEC ship gate 3's launch gate (RULING, Gary 2026-10-08), the pass is **NOT LAUNCH-CLEAN** until `apply_swap_operator` is fixed and the new gate-5 arm/apply test is in place. The fix is one line; the test is one block; both should land in a repair commit (no new state, no new layout, no API change) and the suite's 912 must then include the new arm-and-apply arm with the asserted operator change.

Outside the launch gate (a)-(d): the LOW decimals check is worth a small repair for future-proofing but is not a launch blocker on mainnet where the $CBOB mint is pinned to decimals 6. The cap-vs-supply check is a UX improvement, not a safety one.

The remaining small INFO items are documentation or parameter-tuning suggestions, not defects.

---

## Reply

The five programs are mostly clean, but `MINT::apply_swap_operator` has an inverted check that will permanently DOS the swap operator. One CRITICAL, in the program (gate a), with a value-path impact (gate b — the swap operator is the only on-chain pointer to the only off-chain trusted hop, and the bug stops it from ever being set or rotated correctly).

**Where:** `programs/cbob-vault-mint/src/lib.rs`, `apply_swap_operator`.

**The bug:** `require_keys_eq!(c.pending_swap_operator, Pubkey::default(), MintError::NoPendingOperator)` is inverted. With this check, `apply` succeeds only when there is NO pending operator (and then sets the operator to `Pubkey::default()` — the System program, which cannot sign for the sweep), and `apply` always fails after `arm_swap_operator` (which requires a non-default operator). The fix is `require_keys_neq!`. The adjacent `apply_guardian` already does it right (with a separate `pending_guardian_set: bool`).

**Impact:** (1) Any caller can call `apply_swap_operator` on a fresh config and lock the swap operator to the System program, permanently DOSing the only on-chain handler for the off-chain SOL→cbBTC royalty swap (limit 10). Royalty SOL then accumulates in the revenue address forever. (2) The design's intended path (`arm_swap_operator` → wait `notice_secs` → `apply_swap_operator`) is permanently broken.

**Why the suite does not catch it:** the suite's 3c.K5 ("lands the armed swap operator") is the arm step of `execute_proposal`; `apply_swap_operator` is permissionless and not invoked by the test as I can see it. With the fix, an arm/wait/apply test would prove the operator actually changes.

**Other findings (outside (a)-(d)):** one LOW (`$CBOB` decimals not verified), one LOW (`SetRound.cap` not bounded against remaining supply), and several INFOs. No HIGH or MEDIUM.

**Verdict:** NOT LAUNCH-CLEAN under SPEC gate 3. Fix the inverted check, add the gate-5 arm/apply test, and the tree is back to LAUNCH-CLEAN.