# CBOB v6 — Round 22, whole-tree read

Verdict up front: **no CRITICAL, no HIGH survived measurement discipline in the four programs.** I attacked the pairing, the pool accounting, the draw, governance, the charter claim, the raw offsets and the suite. Below, each target states what I tried, what held, and what did not. Three candidate findings collapsed under reachability analysis before I filed them; I name them so the next reader doesn't re-walk the same dead ends. What remains: two MEDIUM, five LOW, two INFO, and one process finding about what this round was not given.

---

## R1 — CUSTODY

**What I attacked and what held.**

*The pairing.* I built every wrapper shape I could think of and traced each through both instruction-sysvar walks:

1. `[wrapper→CPI open, top-level burn]` — SEAL's open sees the wrapper's index as "current", walks forward, finds the top-level burn, **thaws**. BURN's backward walk at the top-level burn looks for a top-level SEAL open, finds the *wrapper* at that index, program-id mismatch → `NoPrecedingOpen` → whole transaction reverts, thaw undone.
2. `[top-level open, wrapper→CPI burn]` — this is the interesting one. BURN's backward walk from the CPI'd burn sees the wrapper's index, walks `0..wrapper_index`, **finds the genuine top-level open — the pairing PASSES.** The rate limit runs, the reserve checks run, Core's `BurnV1` executes, and only then does MINT's `retire_redeemed` refuse: `get_stack_height()` is 2, not `TRANSACTION_LEVEL_STACK_HEIGHT + 1` → `NotFromBurn` → the transaction reverts, including the Core burn. **The pairing alone does not stop this shape; the stack-height check in `retire_redeemed` does.** That check is therefore load-bearing, not decorative, and it is doubly backed by the sysvar check (current top-level instruction must be BURN's `burn_vault` with this asset at account 0). Evidence this is the real behavior: the suite's redemptions (4.2, P.22) pass through height 1 and P.23's direct call is refused — both directions measured on a real validator. There is no arm for the wrapper shape itself; given the analysis above, one would be cheap insurance (see R8).
3. `[wrapper→CPI both]` — SEAL's forward walk finds no top-level burn → refuse.
4. Two vaults in one transaction, cross-borrowed asset/owner — both halves bind asset AND owner at pinned account indices (0 and 2, matching both `Accounts` structs); suite 3.9/3.10/4.10/9.0.

*The emptiness proof.* The reserve loop derives both token-program ATAs per reserve mint from the SEAL config (single source, no second copy), requires declaration, PDA ownership, no delegate/close-authority, exactly 165 bytes, zero amount. The second loop applies the same six checks to any declared PDA-owned token account. Token-2022 with extensions is refused by length. Closed accounts (0 bytes) are skipped — they hold nothing. The completeness gap (undeclared non-ATA accounts, undeclared nested assets) is the accepted limit 9/44 and I found nothing that narrows or widens it.

*Thawed-but-unburned.* Solana transaction atomicity is the whole answer: any burn failure reverts the thaw. I could not construct a shape where a thaw survives a transaction without the burn landing, and the burn destroys the asset in the same instruction.

**Candidate finding I killed before filing:** "a frozen vault cbBTC account plus an owed share ≥ 1 sat blocks redemption via `ClaimBeforeBurn` even when the sweep would succeed." It collapses on reachability: an *activated* vault always holds ≥ 21,000 sats (the activation seed, and a sealed vault's balance only rises), so a frozen vault ATA always fails the **sweep** first — the plain cbBTC-freeze consequence, already inside limit 28's envelope. Unactivated/pending vaults are owed nothing, so `ClaimBeforeBurn` never becomes the binding constraint. The residue is a documentation gap only (see L2).

---

## R2 — THE COMMUNITY POOL

**The two invariants, proven (not just asserted):**

*Pool ≥ ceil(owed).* `credit` adds `delta·w ≤ avail·10¹²` to `owed` where `avail = balance − ceil(owed_prior)`, so `ceil(owed_new) ≤ balance`. `claim` pays `floor(pending_i/10¹²)` per vault; the sum of floors ≤ floor of the sum, so balance and ceil(owed) fall in lockstep. `retire` only ever *decreases* `owed`. Deposits to the pool ATA can only increase balance; the only withdrawal path is `claim`'s Transfer, whose source is pinned by address to the pool ATA and whose authority is the config PDA (signs nowhere else). `distribute` refuses `PoolShort` and `monthly_inline` uses `saturating_sub` as a backstop. I could not construct a violation.

*No pre-join revenue.* `join` requires `dist_epoch > request_epoch` and sets `debt = w·acc` at the *current* accumulator; every distribution the vault can earn from is one that increments `acc` after that write. The `JoinWaitingFirst` gate (`pending_count − pending_this_epoch > 0`) blocks crediting while an eligible vault waits, and I verified the counter arithmetic under every retire/join ordering I could construct: `pending_this_epoch` is reset only by `credit`/`tick`, which also advance `dist_epoch`, so `request_epoch == dist_epoch` at retire time always implies the vault was counted — no underflow, no desync. `retire`'s same-epoch vs earlier-epoch decrement is correct in both cases.

**Liveness.** The join gate is always clearable (join is permissionless and unconditional given eligibility; `claim`'s join path only checks the dest *key*, so it works even if the ATA is gone). The rate limit is the only queue (accepted 32). The frozen-pool forfeit keeps redemptions alive. A frozen vault ATA blocks that vault's own redemption — unavoidable under cbBTC's freeze authority, subsumed by the sweep failure (see R1).

**LOW-1 (R8) — the pending-vault retire paths are never exercised.**
- Construct: `retire()`'s `if r.pending` block (`pending_count`/`pending_this_epoch` decrements), reachable via `retire_redeemed` on a requested-but-unjoined vault and via `retire_burned` on a bare-burned requested vault.
- Gain: none today (I traced the arithmetic by hand and believe it); the risk is that this is the one counter-mutation path with zero suite coverage, in the youngest code, about to be made permanent.
- Evidence: grep the suite — P.20–P.28 and 3c.F all redeem/retire **active** vaults; no arm redeems or retires a **pending** one.
- Fix: two arms — redeem a pending vault (assert `pending_count` falls, no `ClaimBeforeBurn` since nothing is owed), and bare-burn + `retire_burned` a pending vault in the same epoch (assert both counters fall).

---

## R3 — THE LEVEL DRAW

**The SlotHashes parse** is fail-closed: sysvar id pinned, count bounded at 512, buffer length checked against the count, all-zero hash refused (only when it would become `best` — a zero hash at a non-best in-range slot is silently skipped; fail-closed either way). The window arithmetic: worst case C lands at `reveal_slot + 208` (64 skip + 8 stride + 64 + 8 + 64), inside the 300-slot capture window and inside SlotHashes' 512 at the latest legal capture slot. Consistent.

**The FIFO** is strict (`index == revealed_total`), a burned vault at the head still draws (the Core write is skipped, positively identified), the reschedule only fires after the window has *passed* and targets a slot that does not yet exist. The re-supply hash is checked byte-for-byte. The crank skips non-record accounts and non-writable accounts; only a junk *first* remaining account (the sysvar slot) is fatal, and that is the caller's own transaction.

**Is the residual grind worse than stated? No — and I can say why precisely.** Only the last contributor can *evaluate* an outcome: A's leader chooses hA blind (hB, hC don't exist), B's leader chooses hB knowing hA but not hC — still blind to the final draw. Only C's leader, knowing hA and hB, can grind. This holds even if one validator holds A and C, or B and C: controlling B adds no evaluation power because B is produced before the outcome is computable. The minter cannot grind the asset keypair (the vault is already minted and paid for before any hash exists).

**INFO-1 — the "three different leader rotations" framing overstates the stride.** The stride of two groups defeats a validator holding *adjacent* groups (what was measured). Nothing on chain prevents one validator holding groups g and g+2, i.e. **both B and C**. The residual is unchanged (still only C's grind matters), so this is not worse than accepted limit 26 — but the comment's claim that the stride is *why* three different leaders is "likely" should say instead: the stride defeats adjacent-group co-holding only, and the residual does not depend on the leaders being distinct. No code change; fix the comment so a future reader doesn't lean on a guarantee that isn't there.

---

## R4 — GOVERNANCE

What I attacked: minority capture, vote-reach, freeze.

*Minority:* quorum (ceiling, never zero), threshold (floor-of-ratio, conservative), 10% turnout, and 50%-of-snapshot for key changes — all recomputed; the floor-division on `yes_bps` can only make the check stricter, never looser. VoteRecord is asset-seeded (transfer-then-revote hits an existing PDA). Vote lending is the accepted stated limit.

*Reach:* the CPI surface is exactly five MINT instructions, each independently bounded (`set_round` floor/cap/window; `tighten_sweep` monotone within initialize-fixed bounds, mirrored at creation; `arm_*` behind notice + supermajority; `restart` behind `StopIsNewer`, skipped-not-reverted in GOV). The 85/15, both destinations, `max_supply`, the royalty, the reserve list are unwritable by any instruction. The `KeyChangesBundled` split is enforced at creation. The per-kind ordering marks move before the over-check (RT3-4 fix verified in the code). `Some(default)` as an armed guardian is equivalent to retiring the brake and needs the same 50% — not a hole.

*Freeze:* no live vaults → no proposals (accepted 45); otherwise execution is permissionless with a 7-day window. `quorum_supply` cannot underflow (each vault retires exactly once, as redeemed or bare, and `burned_total`/`bare_burns_retired` increment in lockstep with those retires).

No finding.

---

## R5 — THE CHARTER CLAIM

The Merkle verification is sound: domain-separated leaf/node tags kill second-preimage; sorted pairs kill direction games; proof length ≤ 16 against a depth-8 tree; the root is written once. Identity is by address, so the hot wallet's lookalike mint is refused (C.8) and name/uri rewrites are inert. The PoB burn is owner-signed, in-instruction, CPI'd with `pob_extra` never as signers. The window is clock-only, un-gated by the guardian, un-reopenable. The rejecting-hook case is accepted 46. The pass-through accounts are caller-chosen; no current Core plugin writes to a passed account during Burn, and a Core that did is already inside accepted limit 40's envelope.

No finding.

---

## R6 — CONFIGURATION AND THE TRUSTED HOP

**MEDIUM-1 — SEAL's `initialize` accepts any classic-SPL mint as a reserve; a wrong-but-valid entry fails silently, destroying a promised reserve asset, not bricking.**
- Construct: `programs/cbob-vaults/src/lib.rs::initialize` → `assert_classic_spl` checks only `acc.owner == SPL_TOKEN_ID` per passed mint. MINT's `initialize` checks only `payment_mint ∈ seal_reserves` — it never verifies the *other two* entries. BURN reads the list from SEAL forever after.
- Gain: a launch-time typo or compromised launch terminal that swaps, say, the $GARY entry for any other valid classic-SPL mint is accepted. Every subsequent redemption's emptiness proof never derives or checks the real $GARY ATA; a vault funded with real $GARY burns cleanly and the $GARY is destroyed — the accepted completeness gap applied to an asset the product *promises* is checked. Contrast the Token-2022 case, which is refused loudly at `initialize`; this one emits no error anywhere, ever.
- Evidence if I'm right (a constructible run): initialize SEAL with `[cbBTC, someOtherClassicSplMint, GIRAFFISH]`, then MINT (payment_mint = cbBTC passes — it is in the list), mint a vault, fund it with real $GARY, redeem. The burn declares only the listed ATAs; the $GARY ATA is undeclared and invisible; the redemption lands and the $GARY is gone. No refusal at any step. The suite's S1.1 passes the real mints, so no arm exists for this.
- Fix: pin the three reserve mints by address at SEAL's `initialize` (compile-time constants with the same `--features localnet` swap `INIT_AUTHORITY` already uses), or have MINT's `initialize` refuse a SEAL list that does not contain all three pinned mints. Until then: `check-launch-params.mjs` must verify the reserve list *by address* (that file is not in this bundle — see the process finding), and the dress rehearsal must redeem a vault funded with **all three real assets**, which is currently the only execution-level control.

**The trusted hop's worst case is as stated.** Cap × cooldown windows until the guardian stops, bounded by the revenue PDA above the reserve; the operator signs; the stop is instant and one-way. Note the program-level bounds *permit* 50 SOL per 1-second sweep — the deployed values (PROPOSED, not ruled) are the only real rate limit, which is exactly why limit 38 must not be demoted. The royalty: authority `None`, proven immutable both ways against a control collection (R.5/R.6/R.6a/R.6c), and no instruction in any of our programs writes a collection plugin after `initialize`. The redemption cap is exactly a rolling window over a 64-entry ring of timestamps: the k-th most recent (k = min(cap,64)) must be a full window old; the write happens before the emptiness proof but reverts with the transaction on failure; shrinking live supply shrinks k, making the limit stricter, never looser.

---

## R7 — CROSS-PROGRAM RAW READS

I recomputed every offset from the struct declarations. Anchor layout: 8-byte discriminator, fields in declaration order, no alignment padding for these types.

**MintConfig (v5):** version 8 · collection 9 · governance 41 · pool_ata 73 · round_id 105 · opens 109 · closes 117 · price 125 · cap 133 · minted_this_round 137 · **minted_total 141** · max_supply 149 · bank_treasury 157 · split_bps 189 · **sales_stopped 191** · **sweep_stopped 192** · guardian 193 · swap_operator 225 · **sol_reserve 257** · bump 265 · **max_sweep 266** · **cooldown 274** · last_sweep 282 · level_caps 290 · level_minted 310 · revealed_total 330 · payment_mint 338 · pob_collection 370 · pob_root 402 · charter_opens 434 · **charter_closes 442** · charter_claimed 450 · **bare_burns_retired 454** · total_active_weight 462 · active_count 470 · acc 478 · owed 494 · last_distribute 510 · **sales_stopped_at 518** · **sweep_stopped_at 526** · pending_op 534 · pending_op_at 566 · monthly 574 · pending_guardian 582 · set 614 · at 615 · notice 623 · **sweep_floor 631** · **cooldown_ceiling 639** · **reserve_ceiling 647** · dist_epoch 655 · pending_count 663 · pending_this 671. Fields end at 679; space 8+671+256 = 935 ≥ 679. ✓

Every GOV offset (governance 41, minted_total 141, bare 454, charter_closes 442, sol_reserve 257, max_sweep 266, cooldown 274, stops 191/192, stop-times 518/526, bounds 631/639/647, collection 9) and every BURN offset (version 8, minted_total 141, bare 454) matches. **VaultRecord (v3):** version 8 · asset 9 · **mint_index 41** · reveal 49 · level 57 · charter 58 · set 59 · entropy 60 · hash 92 · bump 124 · active 125 · retired 126 · reschedules 127 · ata 129 · debt 161 · pending 177 · request_epoch 178; 221 bytes total, rent 2,429,040 ✓. **BurnConfig (v4):** version 8 · collection 9 · bump 41 · **burned_total 42** · window 50 · rate_head 58 · ring 59..571 ✓. **SealConfig (v2):** version 8 · collection 9 · reserves 41 (u32 len + keys) ✓.

Every reader pins address (PDA derivation), owner program, discriminator, and version byte before reading. **No misread found.** Two nits: GOV's comment says "nine fields appended" after `monthly_secs` — it is ten; and `distribute`'s token-program mismatch reuses the `WrongGaryMint` error name. Cosmetic.

**INFO-2 — the hand-built Core CPIs pass more `Instruction` accounts than `AccountInfo`s.** `create_vault` (8 vs 7) and both `BurnV1` CPIs (6 vs 5) end with a trailing `MPL_CORE` meta that has no corresponding `AccountInfo`. This works — every mint and redemption in the green suite proves it, and the unpaired account is always the read-only Core program account whose key is covered elsewhere in the slice — but it is non-idiomatic, undocumented in the source, and exactly the kind of thing a future "cleanup" commit would break. Add a comment at each site saying the trailing meta is resolved by key and must not be "fixed."

---

## R8 — THE SUITE AND SIMULATION AS EVIDENCE

The `because()` discipline is real and extensive; I found no wrong-reason negative that isn't pinned (the two honest exceptions — 9.13's record-PDA collision and 3c.F1's raw SPL code — are self-annotated). Arms I checked for can-fail: R.4 (plugin-kind regex), L.12 (budget constant), P.0e (source regex on both structs), L.23 (full draw replay), X.4/X.5 (hash both directions) — all can fail.

**Claims with no arm, beyond the two the SPEC already admits (3600 s window, 7-day execution window):**
1. The pending-vault retire paths (LOW-1 above).
2. The wrapper-CPI redemption shape from R1 case 2 — the stack-height check's negative direction is only exercised by P.23's *direct* call, never by a genuine CPI-from-CPI. One arm (a tiny wrapper program that CPIs `burn_vault` after a real top-level open) would pin the load-bearing check in both directions.
3. `pob_extra` "never as signers" has no negative arm (a pass-through that would be dangerous *as* a signer). Low value; note only.

**Process finding (this round's scope):** the bundle contains the four programs, the suite, the sim, the runner, the docs and RT3 — but **not** `bank/crank.mjs`, `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/layout.mjs`, `bank/accrual.mjs`, `bank/revenue.mjs`, `bank/lock.mjs`, `scripts/check-launch-params.mjs`, `scripts/pob-merkle.mjs`, `launch/mainnet-init.json`, or `scripts/build-mainnet.sh`. Accepted limits 6, 7, 8, 10 (the ledger half), 22, 36, 38 and 50 rest on exactly those files. The ship gate's coverage script is supposed to prevent files escaping *every* round; this round cannot certify any of them. Include them in the next round or this one's follow-up.

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

**1. Is any limit worse than stated?**
- **Limit 28 / HOLDER-GUIDE — yes, in the buyer-facing copy, not the code.** The guide's honest list says "If the pool is frozen… **you can still open your vault**," scoped to the pool case, and never states the vault-account case: a Coinbase freeze of a vault's own cbBTC account blocks redemption *entirely* (the sweep of a frozen account fails; the burn's emptiness proof would refuse a non-empty frozen ATA; and `CloseAccount` on frozen fails). The preceding sentence ("Coinbase can freeze any cbBTC account, including a vault") names the power but not this consequence. Fix: one sentence in the honest list.
- **Limit 36 / HOLDER-GUIDE — yes, in the copy.** "Payouts are credited to your vault at least once a month," "Activation is picked up automatically," "Everything else happens on its own" — all contingent on the crank being armed **live** (it is installed DRY-RUN today) and on protocol traffic existing. Limit 36 states the contingency in SPEC; the guide does not, and item 50's enumeration does not list the cadence promise among the unbuilt surfaces. Fix: caveat the guide, or add the promise to item 50's list so it can't drift into "accepted."
- Limits 10, 25, 26, 27, 32, 41, 42, 45, 46, 48: not worse than stated. I specifically verified 25/26 (only C's leader can evaluate; see R3) and 32 (the ring is exactly a rolling window; unretired bare burns inflating live supply only raises the cap against the inflator's own vaults and the crank deflates it within a pass).

**2. Is anything listed as a limit not actually a limit?**
- **Limit 43's claim "nothing on chain can refuse an off-curve owner at mint" is refutable — MEDIUM-2.** Construct: `MintVault`/`ClaimCharterVault` take `owner: Signer`; SPEC's impossibility sidebar says nothing can refuse an off-curve owner at mint. But a top-level-only guard — `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT`, the identical technique `retire_redeemed` already uses — makes CPI invocation impossible, and at top level the runtime's signature verification cannot be satisfied by an off-curve address (a PDA is not a valid Ed25519 point; no private key exists). Off-curve owners are then refused *at mint*. Evidence: a two-line arm — mint through a wrapper program with a PDA owner passed as a CPI signer: today it mints (the alarm later reports `unredeemable_owner`); with the guard it is refused. Note the suite's 5.2 passes the PDA with `isSigner:false` and is refused by `AccountNotSigner` — a different property, as the SPEC itself says. Cost: mint/claim become non-composable (no CPI callers exist today; suite and sim are top-level). Caveat: **transfers** to PDAs remain possible, so the alarm stays necessary — this closes the mint half only. Whether to take it is Gary's call, but the SPEC sentence should be corrected either way: a stated impossibility that isn't one will be trusted by the next reader.
- Everything else I checked (42, 45, 35, and the discharged 12/17, 14, 19, 30, 31, 33, 15) is genuinely a limit or genuinely discharged.

**3. Discharged items not actually discharged?** No. I re-verified 19 (no activated-but-unlevelled state exists; `activate` gates on level 1..5 and only `join` sets `active`), 14 (`DuplicateAttribute` refused in both mint paths), 15 (`VaultTooNew` against the snapshot), and the arithmetic behind 12/17's byte-vs-compute wall. All hold.

**4. OPEN AND BLOCKING quietly treated as accepted?** Not demoted — but two drift signals: the holder guide is written in the present tense about surfaces item 50 says do not exist ("The redeem page checks and warns you before you sign", "The redeem page offers this and does the steps for you"), which normalizes the promise before it's built; and limit 38's sweep cap/cooldown/reserve remain PROPOSED while the *program-level* initialize bounds would happily accept 50 SOL per 1-second sweep. Neither is a demotion; both are places where the paperwork is running ahead of the gate.

---

## ANYTHING ELSE

- **Candidate finding I killed:** "the reschedule mechanism lets a vault owner stall the reveal FIFO and block all later activations." It requires the same total silence as accepted limit 25's re-roll (capture is permissionless, rides on four host instructions, and the crank runs every minute), and any affected minter can clear it themselves at any moment. Same precondition, same controls, same accepted envelope.
- **Candidate finding I killed:** "unretired bare burns inflate live supply and raise the redemption cap for a key thief." Inflating the cap requires bare-burning ~as many vaults as exist (at full purchase price), `retire_burned` is permissionless and the crank deflates it within one pass, and the raised cap is spent against the attacker's own burned inventory. Not a real edge.
- The `invoke`/`invoke_signed` account-list pattern (INFO-2) and the GOV "nine fields" comment nit, both above.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

What this process structurally cannot do, and what to do about each — concretely:

1. **Enumerate orderings.** I traced the pool's counters by hand across the orderings I could think of; a machine can traverse all of them. Build an invariant oracle into the sim harness: after **every** transaction, assert `pool_balance ≥ ceil(owed_scaled)`, `owed_scaled == Σ pending over records`, `pending_count == # pending records`, `total_active_weight == Σ weights of active records`, no record both pending and active. Then run a randomized soak (random sequences of activate/distribute/claim/retire/redemption, including failures and reverts) for a few thousand transactions. The suite checks these at hand-picked moments; the class of bug I cannot rule out by reading is exactly the one this catches.
2. **Write arms an adversary would write.** The suite is written by the author; its blind spots (LOW-1, the wrapper-CPI shape, the pending-retire paths) are the author's blind spots. Hand a *different* model the spec — not the suite — with the task "write 20 arms for the pool counters and the redemption pairing" and run them against the frozen tree. Diff the coverage. The ship gate already requires different rosters for the clean rounds; make at least one of them write tests rather than only read code.
3. **Give the next round the files this one didn't get.** The crank, the alarm, the launch checker, `pob-merkle.mjs`, `mainnet-init.json` and `build-mainnet.sh` carry limits 6–8, 10, 22, 36, 38 and 50. This round certifies none of them.
4. **Make the dress rehearsal adversarial, not scripted.** It must specifically include: a redemption of a vault funded with **all three real assets** (the only execution-level control on MEDIUM-1's silent failure mode); a distribution to a realistic vault count (item 22's actual I/O); the rate limit at the real 3600 s window; and the launch runbook itself — initialize order, values, byte verification, authority removal — executed end to end with throwaway IDs by someone who did not write the runbook.
5. **Chaos-test the survivability claims.** Limit 7's "v6 makes the stall survivable" and limit 36's in-line monthly path are reasoned, never exercised against a killed crank. Kill `bank/crank.mjs` mid-pass on the rehearsal and verify `distribution_overdue` fires and ordinary traffic actually runs the month.
6. **A human reads HOLDER-GUIDE.md as a buyer would.** I can check sentences against code; what I cannot do is notice the *absence* of a sentence a frightened holder needs. The two gaps above (vault-account freeze blocks opening; monthly cadence needs traffic) are exactly that shape. Have someone who is not the author read it cold and ask "what would I believe after reading this?"
7. **Key custody is unauditable from here.** The guardian key, the swap operator key, and the Moments hot wallet are the three live trust anchors no code review reaches. Write the custody procedures down, keep the swap operator wallet holding nothing but the cycle's own funds (already stated as an operational instruction — make it a checklist item at launch), and treat the alarm as the detector of last resort.
8. **Keep the binary-identity checks inside the launch runbook, not just the build script.** The localnet/mainnet `INIT_AUTHORITY` swap means the tested binary is never byte-identical to the shipped one; `build-mainnet.sh`'s behavioral proof (mainnet build must refuse the test key) is the only bridge. It must be re-run and its sha256 recorded as a launch step, after the tree is frozen, not cached from an earlier build.

Nothing here says the design is sound; it says I could not break the four programs by reading them, and the places I would spend the next dollar are the ones where reading is not enough.