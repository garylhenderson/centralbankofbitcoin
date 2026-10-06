I'll focus on finding surviving defects rather than re-listing the design. Let me work through the targets, concentrating on the places where immutability makes an error permanent.

# FINDINGS

## R2 — CRITICAL (if true): `monthly_inline` can run inside `retire_redeemed` and credit the *departing* vault, but the ordering claim hides a worse case — the pool-short abort path in a redemption

Let me look carefully at `retire_redeemed`'s tail:

```rust
let forfeit = pool_is_frozen(...)?;
retire(&mut config, &mut vault_record, true, forfeit)?;  // removes weight, subtracts owed
let k = config.key(); let now = Clock::get()?.unix_timestamp;
monthly_inline(&mut config, &pool_token, &k, now)
```

`retire` has already subtracted this vault's weight from `total_active_weight` and its owed from `owed_scaled`. Then `monthly_inline` runs. Inside `monthly_inline`:

```rust
let avail = balance.saturating_sub(ceil_sats(c.owed_scaled));
...
credit(c, avail, w, now)?;  // w = total_active_weight
```

**The evidence that would exist if I'm right:** a redemption that lands exactly when the month is due, where the departing vault's claimed share was swept out between the `claim` (earlier in the same tx) and this point, could leave `balance` reading higher than `owed`, and `credit` distributes the residue to remaining vaults. That is actually *intended*. I cannot construct a theft here. **This is not a confirmed defect** — the arithmetic holds because `claim` paid out of the pool (lowering `balance`) and `retire` lowered `owed_scaled` by exactly the vault's pending. I withdraw this as a finding; stating the attempt so you can check: a measured redemption-at-month-boundary (IN.5) exercises it and the books balance (BK checks). Measurement contradicts the worry.

## R2 / R7 — HIGH: `claim`'s join path can **double-count** `pending_this_epoch` vs `pending_count` underflow across a retire in the same batch

Look at `retire` on a pending vault:

```rust
if r.pending {
    c.pending_count = c.pending_count.checked_sub(1)...;
    if r.request_epoch == c.dist_epoch {
        c.pending_this_epoch = c.pending_this_epoch.checked_sub(1)...;
    }
    r.pending = false;
}
```

And `join`:
```rust
c.pending_count = c.pending_count.checked_sub(1)...;
r.pending = false;
```

Join does **not** touch `pending_this_epoch`. That is correct only because a vault reaching `join` has `dist_epoch > request_epoch`, so it cannot be counted in `pending_this_epoch` (which is reset to 0 at every `advance_epoch`). Consistent.

**But consider `activate`'s second (join) call followed by a redemption in a later host within the same epoch.** `pending_this_epoch` is only ever incremented in `activate`'s first-call path and only ever decremented in `retire` (same-epoch) or zeroed in `advance_epoch`. `waiting_to_join = pending_count - pending_this_epoch`. 

The `checked_sub` in `waiting_to_join` means if `pending_this_epoch > pending_count` it **aborts the whole instruction**. Can that happen? `pending_this_epoch` counts requests made this epoch; `pending_count` counts all un-joined requests. Every increment of `pending_this_epoch` is paired with an increment of `pending_count` in `activate`. A same-epoch `retire` decrements both. So `pending_this_epoch <= pending_count` is invariant **unless** a vault requested in epoch E, the epoch advanced (its `pending_this_epoch` contribution was zeroed, but `pending_count` still counts it), then it is retired while `request_epoch == dist_epoch` is **false** → only `pending_count` drops. That keeps the invariant. 

I could not break this. The host unit test (`the_boost_ring_wraps`) and F21 exercise the retire-while-waiting counters and they hold. **Rejected — measurement (F21.1/F21.2) covers the exact counter-pair case.**

## R1s(e) / R7 — HIGH: the sweep helper closes a source account, but BURN's second emptiness loop can still see a **recreated** account a stranger plants after the sweep and before the burn — **within the same transaction this is impossible, but across the prior-transaction boundary it is not**

SPEC's REDEEMING says the page creates missing *vault reserve* accounts in a **prior** transaction. Target R1s(e) asks the key question: is there any account a stranger can create for the vault that neither the sweep can name nor BURN will skip?

Walk it:
- BURN requires every reserve mint's ATA under **both** token programs to be DECLARED (`ReserveNotDeclared` if absent from `remaining_accounts`).
- The sweep (helper) can only move **classic** 165-byte accounts it is *named*.
- A stranger can permissionlessly create a **classic ATA** for the vault PDA for a reserve mint and deposit into it **after the page builds the sweep transaction but before it lands**.

If the page did not name that account in the sweep (because it didn't exist at build time), then at burn time:
- BURN derives the expected ATA (it does this itself from `pda || token_program || mint`), finds the account present, owned by SPL Token, 165 bytes, with a nonzero `amount` → **`VaultNotEmpty`**.

So the redemption **reverts** — it does not destroy funds, it blocks. That is the griefing vector R1s(e) names, and SPEC claims the prior-transaction creation closes it. **It does not fully close it:** the page creates the account in a prior transaction, then the sweep names it, but the sweep moves `amount` *at execution*. So a stranger depositing between the prior-tx creation and the sweep landing is swept (good). The residual griefing case is a reserve ATA for a **mint the page did not expect to exist** — but there are only three reserve mints and the page knows all three. 

**The real gap:** a stranger can create the **Token-2022** ATA for a reserve mint (classic mint, but Token-2022 ATA — permitted, the mint just needs to be owned by classic SPL... actually no: an SPL-classic mint cannot have a Token-2022 ATA created against it because `createAssociatedTokenAccount` with the T22 program requires the mint be owned by T22). The probe `scripts/probe-mainnet-facts.mjs` **confirms this**: "Token-2022 ATA creation refuses IncorrectProgramId" for each classic reserve mint. So BURN's T22-derivation loop finds that account absent → `ReserveNotDeclared` only if the page failed to pass it. The page passes a declared (absent) account; BURN's loop does: `let acc = remaining.find(...).ok_or(ReserveNotDeclared)`. So the page **must declare the T22 ATA address even though it can never exist**, and BURN then `continue`s because no token program owns it. Fine.

**Confirmed griefing (MEDIUM, not new):** a stranger depositing one base unit of a reserve mint into the vault's classic reserve ATA in the window between the page's prior transaction and the redemption landing is **swept** (the sweep reads live balance). So that's closed. A stranger creating a **classic ATA for a non-reserve mint** → BURN's second loop skips it (not a reserve, nonzero amount, PDA-owned → it enters the `d.len() >= 165` branch, owner==pda, then `require!(amount == 0)` → **`VaultNotEmpty`!**).

Wait — re-read BURN's second loop:

```rust
for acc in ctx.remaining_accounts.iter() {
    ...
    if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }
    let d = acc.try_borrow_data()?;
    if d.len() >= TOKEN_ACCOUNT_LEN {
        let mut o = ...; // owner
        if Pubkey::new_from_array(o) == pda {
            require!(d.len() == TOKEN_ACCOUNT_LEN, ...);
            ... require!(amount == 0, VaultNotEmpty);
        }
    }
}
```

This loop only inspects accounts **in `remaining_accounts`** (declared). It does **not** enumerate what the PDA owns (it can't). So a stranger's non-reserve classic ATA that the page did **not** declare is simply **not seen** by BURN → the burn succeeds and **destroys** that token (proven impossibility 2, accepted limit 44). No new defect; this is the accepted destruction, not a block.

**Conclusion for R1s(e):** I find **no new surviving block/destroy case** beyond accepted limit 44. The prior-transaction creation of the three reserve accounts is sufficient to prevent a *block*, and non-reserve destruction is the accepted limit. **Confirmed: accepted limit 44 is correctly scoped; not worse than stated.**

## R1s(c) — MEDIUM, surviving: the lamport sweep to a **non-existent, non-owner destination** below rent exemption reverts the redemption, and nothing on chain forces the destination to be the owner

The helper:
```rust
if signer.key == dest.key { return Err(InvalidArgument); }   // refuses self
let lamports = signer.lamports();
if lamports > 0 {
    invoke(&system_instruction::transfer(signer.key, dest.key, lamports), ...);
}
```

The destination wallet is chosen by whoever builds the transaction. It is **not** compared to the asset owner. R1s(a) establishes only the owner can invoke through Core, so a hostile third party cannot redirect. But a **buggy page**, or a holder who mistypes, can name a destination that:
- is below rent exemption and does not exist → the System transfer of a sub-rent amount to a nonexistent account **fails**, reverting the whole redemption. That's a failed redemption, recoverable by retrying.
- is a **non-system-owned account** (e.g. a token account) → System transfer to a non-system account **succeeds** (System transfer only checks the *source* is system-owned; crediting any account is allowed). So lamports can be sent to, e.g., a PDA the holder cannot withdraw from.

This is the holder's own choice and bounded (W6/W8 in the round-26 verdict correctly note System transfer does not require a system-owned recipient). **Not a theft.** The item 50 page obligation ("a lamports-only sweep needs a destination that exists") is the control, and that page is **not built** (item 50, OPEN). 

**What's worse than SPEC states:** SPEC item 50's bullet says "The canonical destination is the owner, who pays the fee and so exists; a page that names any other destination must check it." But the helper **does not** enforce owner == destination, and the Core access check (R1s(a)) only governs *who may invoke*, not *where value goes*. So a holder redeeming through *any client that is not the official page* can sweep their vault's cbBTC to an arbitrary wallet — which is their right, but the **lamport sweep to a non-existent destination** is a foot-gun that permanently costs a retry, not funds. **LOW, already covered by item 50.** No new finding.

## R3 / R6 — HIGH, surviving and under-stated: `MAX_SKIPPED_SLOTS = 64` interacts with `REVEAL_WINDOW_SLOTS = 300` such that C's leader has a **wider** grinding window than SPEC 26 states

SPEC 26 / accepted limit 26 says C's leader can skip its own first slot(s) to move C within its 4-slot group (best-of-4) plus block-content grinding. Let me recompute the actual window C's leader controls.

`try_capture`:
```rust
let mut want = reveal_slot;
for h in hs.iter_mut() {
    Some((hash, slot)) => {
        want = (slot / LEADER_GROUP_SLOTS + ENTROPY_GROUP_STRIDE) * LEADER_GROUP_SLOTS;  // next group start
    }
}
```

C is picked as the **smallest produced slot in `[want_C, want_C + 64]`**. If C's leader controls a 4-slot rotation starting at `want_C`, it can produce or skip each of those 4 slots. But `MAX_SKIPPED_SLOTS = 64` means if the leader skips its **entire** 4-slot rotation, C falls to the **next** leader's group — *losing* control. So the leader's grinding set is its 4 produced-or-skipped slots = best-of-4 by skip, times content-grinding on whichever it produces. SPEC 26 states this ("best-of-4, P(V) 5%→18.6%"). 

**But here is the under-statement:** B's `want` is computed from C's... no, C's `want` is computed from B's slot. If C's leader *also* happens to lead B's group (measured: one validator held two adjacent rotations), it controls **both hB and hC**, and `want_C = (B_slot/4 + 2)*4`. By choosing *which* of its B-rotation slots to produce, it moves `B_slot`, hence moves `want_C`, hence can position C's group boundary. A leader holding B and C's rotations gets **best-of-(4×4)** on the (hB,hC) pair plus content grinding on both. SPEC 26 says "three different leaders is likely, not guaranteed" and that C's leader chooses among many — but it frames the amplification as *within C's own group*. **A leader holding both B and C has quadratically more draws than stated (best-of-16 by skipping alone, before content grinding, reaching P(V) far above 18.6%).** 

**Evidence if true:** on mainnet, measure epochs where one validator holds two rotations ≥ `ENTROPY_GROUP_STRIDE` apart within the reveal window; compute the realized P(Level V) for cohorts minted into such windows. SPEC's own measurement ("one validator holding two adjacent rotations") is the precondition, and ENTROPY_GROUP_STRIDE=2 was chosen precisely because of it — but with STRIDE=2 and 4-slot groups, B's group and C's group are only 8 slots apart, well within a large validator's multi-leader stretch. **This is WORSE than accepted limit 26 states, and it is the kind of thing immutability locks in.** 

**Severity HIGH** because the level decides every payout weight forever, and a large validator can self-deal a cohort of Level-V vaults with materially higher probability than the documented 18.6%. **Fix (pre-launch only):** increase `ENTROPY_GROUP_STRIDE` to exceed the maximum observed single-validator leader run (the mainnet measurement should set it empirically with margin), or draw A/B/C from slots separated by more than one epoch's worth of a single validator's maximum consecutive leadership. This is a one-line constant but it is **permanent**.

## R4 — MEDIUM: the `KEY_CHANGE_YES_BPS` snapshot makes a stolen-guardian cure **easier than SPEC 47 claims**, in the opposite direction from the stated risk — a mid-vote mint-out collapses the effective bar to 5.71%

Round 25 D1 (quoted in SPEC 47) says: half-of-snapshot can be 5.71% of 2,100 if the rest mint mid-vote. That is disclosed. But examine the mechanism: `quorum_supply` is snapshotted at **proposal creation** as `minted - burned - bare_retired`. A guardian-replacement proposal created when only the 240 charter vaults exist needs YES from 120 of them. If a sale round then mints 1,860 vaults during the 3-day vote, those 1,860 cannot vote (`VaultTooNew`) and do not raise the bar.

SPEC frames this as a *weakening* of the thief's protection (good for holders fighting a thief). But it is **symmetric and dangerous**: the top-three charter holders (91 of 240, per DESIGN §10) can create a guardian-replacement or swap-operator-arm proposal **at charter close** needing 120 YES, and with 58+ unclaimed (24.2%, DESIGN §10's own figure) they reach it. SPEC §10/§Where-this-stands discloses the top-three-carry-a-key-change case. **So this is disclosed, not new.** I verify it holds against the code (`need_key = ceil(quorum_supply * 5000/10000)` against the *creation* snapshot). **Confirmed consistent with disclosure; not worse.**

## R2b — MEDIUM, surviving: `boost_vault` reads the asset owner from `data[1..33]` without the `require_live_vault` collection/key check being applied to the **owner read**, and `reweigh` is applied before the burn CPI — a failed burn after reweigh is impossible, but the ordering of state mutation vs CPI is fragile

Re-read `boost_vault`:
```rust
require_live_vault(&asset, &collection)?;
{ let d = asset.try_borrow_data()?; ... require_keys_eq!(owner, burner.key()); }  // owner check
require_keys_eq!(cbob_mint.key(), cbob);
let (bal, state) = read_token(...)?;
require!(state == INITIALIZED && bal >= price);
invoke(SPL Burn)?;                 // CPI first
// then state mutation:
c.boost_expiring[i] += 1; c.boosts_active += 1; ...
reweigh(c, r, extra)?;
```

Burn is first, then state. If the burn succeeds and a later line (`reweigh`, `boost_weight_total += extra`) overflows → `overflow-checks=true` **aborts the whole transaction**, reverting the burn. So the $CBOB is not lost. Good. **No defect.**

The one thing worth flagging: `boost_weight_total` and `total_active_weight` can in principle be driven up by many boosts. With `MAX_BOOST_WEIGHT_BOUND=12` and `active_count ≤ 2100`, max added weight is 2100×12=25,200, plus level weights ≤ 12,600 → `total_active_weight ≤ 37,800`, trivially inside u64, and `credit`'s `avail * 1e12 / w` stays inside u128. **No overflow risk. Rejected.**

## R6 — HIGH, surviving: `initialize` accepts `sol_reserve_lamports == 0`, and the sweep's reserve check then permits draining the revenue PDA to **below rent exemption**, closing it — after which no royalty can ever be received again

`initialize`:
```rust
require!(sol_reserve_lamports == 0 || sol_reserve_lamports >= RENT_EXEMPT_0_BYTES, BadSweepBound);
```
So `0` is explicitly allowed. With `sol_reserve_lamports = 0`, `sweep_sol_for_swap` permits:
```rust
require!(bal >= keep.checked_add(amount)?, ReserveWouldBreach);  // keep = 0
```
So the operator can sweep the revenue PDA to **0 lamports**. A system account at 0 lamports with no data is **garbage-collected** by the runtime. The `["revenue"]` PDA is also the **payment target of every mint** (`mint_vault` transfers cbBTC into `revenue_token`, the PDA's ATA — not the PDA itself). The PDA's *lamport* balance only matters for the SOL royalty path, and a PDA at 0 lamports is re-fundable (anyone can send SOL to it; it's a valid derived address). Re-created on next royalty. **So this is self-healing, not permanent.** The mainnet value is ruled at 0.05 SOL anyway (`launch/mainnet-init.json`). 

**But:** `launch/mainnet-init.json` ruled `sol_reserve_lamports = 50000000` (0.05 SOL), which is **below** `RENT_EXEMPT_0_BYTES = 890880`? No — 50,000,000 > 890,880. Fine. And `initialize` would reject a value in `(0, 890880)`. So the only accepted-but-dangerous value is exactly `0`, and it is self-healing. **Rejected as permanent; it's a transient.** The launch value is correct.

## R6 / R0 — CRITICAL candidate: round 26's own verdict confirms **C1 (RL.7 cap overstatement)** is a LIVE repair that was made in `8fe3120`, but the audited tree here is `1d8ec10` (post-repair). Is the repair actually present and correct?

The tree I'm given contains `pob-merkle.mjs` (round-26 new), `rehearsal-tree.sh` (round-26 new), the `RL.S1–S6` cap-stamp arms and `stampCaps`/`capAt` in `3prog.test.ts` — these are the **C1 repair**. So this is the post-repair tree. Verify the repair:

```js
const capAt=(live)=>{const n=(live*210n+9_999n)/10_000n;return n<1n?1n:n}
const stampCaps=(a,b,stamps)=>{
  ...
  for(let k=a.burned;k<b.burned;k++){
    const lo=capAt(a.minted-k-b.bare), hi=capAt(b.minted-k-a.bare)
    if(lo!==hi) throw new Error(`ambiguous redemption cap at ordinal ${k}`)
    ...
  }
}
```

`lo` uses the *minimum-live* reading (a.minted is the before-snapshot minted, b.bare is the after-snapshot bare → smallest live), `hi` the maximum. If they disagree the stamp is rejected as ambiguous. This correctly bounds the cap for each burned ordinal across concurrent supply changes. **The repair is present and sound.** But note this is a **test-harness** fix, not a program fix — the program's rate limit was never wrong; the *suite's certification of it* was overstated. RL.7 now replays against certified-exact caps. **Confirmed discharged correctly.**

## R0 — the verdict's quorum failure is the governing fact

Round 26's own `VERDICT-programs.md` states: **"INCOMPLETE QUORUM (5/8, need 6) and NOT CLEAN. Clean streak 0/2."** The ship gate (SPEC) requires **two consecutive clean rounds with different rosters**. Round 26 produced seven new confirmed repair topics (three LOW, four INFO) and failed quorum. Per the owner's own rules, **this does not count as a clean round**, and the repairs in `8fe3120`/`1d8ec10` **reset the freeze counter** (any change to `programs/`, `bank/`, `scripts/` resets gates 2 and 3). 

**Therefore the single most important finding is structural:** the repairs committed as `8fe3120` touched `tests/` and `scripts/pob-merkle.mjs`/`scripts/rehearsal-tree.sh`. `scripts/` is in the freeze-reset set. **The two-clean-round counter is 0, and this tree has not yet had even one clean round.** Launching now would violate the author's own ship gate. This is not a code bug; it is a process state the prompt asks me to verify, and it is **not satisfied**.

# ANSWERS TO THE FOUR ACCEPTED-LIMIT QUESTIONS

1. **Worse than stated:** Accepted limit **26 (entropy grinding)** is worse than stated. The analysis assumes C's leader grinds within its own single group; a validator holding both the B-group and C-group rotations (a condition SPEC itself measured as real — "one validator holding two adjacent rotations") controls both hB and hC and gets a multiplicative, not additive, grind. With `ENTROPY_GROUP_STRIDE=2` the B and C groups are only 8 slots apart, inside a large validator's reach. The documented 18.6% P(V) is a floor, not the realized ceiling. **This is permanent and should move `ENTROPY_GROUP_STRIDE` before launch.**

2. **Listed as a limit but actually closed / closed by something unnoticed:** Accepted limit **42** was already corrected by round 26 D4 (the narrow owner-payer helper shape fits three creates at 1,219 bytes), and the SPEC/ACCEPTED text now reflects that. Nothing additional to close.

3. **A DISCHARGED item not actually discharged:** **Item 54** is marked DISCHARGED but its own text records that "in round 25's third suite run a paid mint carrying one capture ran out at exactly 200,000 and failed." The discharge rests on the *client* obligation (item 50, still OPEN) to set the compute-unit limit. A DISCHARGED item that depends on an OPEN item for its safety is not independently discharged; it is contingent. Flag it as contingent-on-50, not discharged.

4. **An OPEN AND BLOCKING item being quietly treated as accepted:** **Item 22** (no distribution/revenue cycle has ever run against a live chain) and **item 50** (holder surfaces not built) remain OPEN AND BLOCKING and are correctly *not* demoted — but the narrative in "Where this stands" and the road table treat them as near-complete background. They are the two items that, with immutability, decide whether real Bitcoin is recoverable, and neither has been exercised. They are not being demoted in the list, but the surrounding prose underweights them.

# WHAT AI AUDIT STRUCTURALLY CANNOT DO — concrete pre-launch actions

1. **Run the dress rehearsal and the revenue cycle, for real, and publish the signatures.** No amount of reading closes item 22. A model cannot observe a transient RPC error on vault 1,900 of 2,100, a Pyth feed going stale mid-swap, or the Meteora fallback firing. Execute road step 8 end-to-end on mainnet-fork and throwaway-ID mainnet, including the forced post-sweep failure and the hand recovery, and attach the transaction signatures to a record a human signs.

2. **Set `ENTROPY_GROUP_STRIDE` from a fresh mainnet leader-schedule measurement**, choosing a stride that exceeds the 99th-percentile single-validator consecutive-leadership run with margin. This is the one permanent constant where a wrong value silently biases every payout, and it is a value judgment no static read can make — it requires measuring the live validator set.

3. **Have a human physically confirm the signing ceremony**: that `INIT_AUTHORITY` is the hardware wallet Gary controls, that the four `initialize` transactions were built *from* `launch/mainnet-init.json` (not hand-edited), that the three cbBTC accounts exist and the revenue PDA is funded above rent (item 52), and that `set-upgrade-authority --final` actually landed for all five programs. `build-mainnet.sh` itself admits it "NOT PROVEN that the compiled constant IS that key."

4. **Stop treating a failed-quorum round as progress.** Round 26 was not clean and the counter is 0/2. Before anything mints, run the two genuinely-clean consecutive rounds the ship gate demands, on a frozen tree, with disjoint rosters — and do not relax quorum because a verdict is inconvenient.

5. **Independently reproduce the build on a second machine** and diff the `.so` bytes, because the entire "which key shipped" proof reduces to reproducibility, and a single box can be compromised in ways no in-tree check can vouch for (SPEC item 10(c) concedes this).