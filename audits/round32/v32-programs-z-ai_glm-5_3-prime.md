# Round 32 Audit — Programs Pass

I read the whole bundled tree: all five programs, the suite, the simulation, the runners, the build scripts, the fixtures, the launch values, SPEC, DESIGN-v6, HOLDER-GUIDE, the round-31 verdict and validation, and the red-team report. I recomputed every cross-program offset, every account-space constant, every pinned discriminator, and the pool/boost/rate-limit algebra independently before writing anything below. Where I claim a defect, I name the on-chain or test evidence that would exist if I am right; where I refute, I say why.

---

## R0 — Round 31's verdict and repairs

Round 31 was NOT CLEAN (1 LOW, 2 INFO, no program defect). Its three findings and their repairs in this tree:

**L1 (coverage gate quorum wording) — repaired and verified.** `scripts/audit-coverage.sh` now contains `first_line_quorate()`, an exact anchored regex `# Round {num}, {LABEL} pass: (?:NOT )?CLEAN; QUORUM MET` applied to the verdict's first line, with an eight-case selftest (`GATE_SELFTEST=1`) covering the five failure wordings round 31 measured ("QUORUM FAILED", "NO QUORUM MET", "QUORUM MET for offchain; programs not reached", wrong focus, wrong round number, round-20 legacy wording). I traced the regex against each case by hand: all eight dispositions are correct, including the combined-verdict case where `combined=True` widens the label alternation and the focus argument is deliberately mismatched to force rejection. The manifest `auditors >= required` precondition is still read before the verdict line, which is correct order (a rerun manifest is the rerun's own). The residual round 31 named — a structured quorum record would be stronger than a headline match — is real but is a hardening suggestion, not a surviving defect. The gate now fails on every wording round 31 demonstrated as wrongly credited.

**D1 (prompt named round 29) — repaired.** The round-31 validation says the round-32 script derives the prior round number from the script's own number and the prose check asserts it. This prompt is the round-32 prompt: it says "Round 31" throughout and bundles `audits/round31/VERDICT-programs.md`. Consistent. The stale-label defect class is closed for this round.

**D2 (probe usage line) — repaired.** `scripts/probe-mainnet-facts.mjs` line 28 now reads `node scripts/probe-mainnet-facts.mjs`, which is the command `run-tests.sh:297` actually runs. Correct.

**Round-31 measurements I re-verified from source:**

- *W1 (reveal-heap HIGH, refuted):* the maximum owner-writable Autograph message is bounded by the runtime's `MAX_CPI_INSTRUCTION_DATA_LEN` (10,240) minus instruction overhead, because Core's `UpdatePluginV1` carries the whole signature list in one instruction and a second signer's partial update is refused. I confirmed the structural premise from the suite's R28 arms and the cpi-wrapper's `PADTAIL!` path (which itself refuses `len > 10_240`). The worst reachable shape (640-byte stored attributes, 64-char name, 200-char URI, five owner plugins, ~10,198-byte autograph) still reveals — the FIFO cannot be halted by asset shape on the pinned Core. Round 31's refutation holds.
- *W2 (PDA squat CRITICAL, refuted):* Anchor 0.31.1's generated `init` tops up rent on a pre-funded PDA and proceeds; the suite's 7.12d arm (proposal PDA pre-funded with 2,000,000 lamports) lands. A stranger cannot brick a config PDA by dusting it. Holds.
- *W9 (MINT_CONFIG_SPACE):* I recomputed the constant by hand from the struct: 1,005 bytes of fields + 256 padding = **1,261**. Round 31's figure is correct; the two auditors who said 1,253 were wrong (they dropped the 8-byte `cbob_burned_total` or miscounted the u128s). No finding depended on it.
- *Round-30 repairs present:* `sigwalk.mjs` carries `startBefore`; the alarm-side backlog logic is described in SPEC's "Scan backlog boundary" and the validation logs a full runner pass (855/901/39/23/14/47/6/33/4/16, floors equal to counts). I did not re-run the runner; I read the arms against the code and found the floors' subjects present.

**One process observation, not a defect:** round 31's verdict says the rerun manifest's `required` is 3 and "says nothing about the pass's quorum. This verdict is the only record of it." That is a documentation gap in the round-31 artifact, not in this tree — the gate now reads the verdict headline, which the verdict does record. No action needed beyond what L1's repair already did.

**R0 verdict: every round-31 repair holds at this tree. No regression found.**

---

## R1 — Custody: can anyone but the owner get value out of a sealed vault?

I attacked the pairing, the emptiness proof, and the thaw-survival question from first principles.

**The pairing.** SEAL walks the instructions sysvar forward from `current+1` requiring a top-level `burn_vault` matching asset (account 0) and owner (account 2); BURN walks backward requiring a top-level `open_for_redemption` matching the same. Both discriminators are pinned and asserted against their Anchor derivations in the suite (3.1a–3.1f). I verified the account indices against both `Accounts` structs: SEAL's `OpenForRedemption` is `[vault_asset, collection, owner, ...]` and BURN's `BurnVault` is `[vault_asset, collection, owner, ...]` — indices 0 and 2 bind correctly in both directions.

- *CPI wrapper:* an `open_for_redemption` reached by CPI reports the outer instruction's index; the outer instruction's program id is the wrapper's, so BURN's `ix.program_id == SEAL_PROGRAM_ID` check never sees it — the burn refuses `NoPrecedingOpen`. Symmetrically, a wrapped burn is invisible to SEAL's forward walk. WR.1–WR.4 measure exactly this with a real deployed forwarder. The stack-height check in `retire_redeemed` (`== TRANSACTION_LEVEL_STACK_HEIGHT + 1`) independently refuses a retire reached two levels down. Both defenses are present and non-redundant.
- *Two vaults in one transaction:* both halves bind asset AND owner, so open-A/burn-B fails both programs' matches (3.9, 3.10, 4.10, 9.0). The rate limit runs after the pairing check in `burn_vault`, so a `RateLimited` refusal on the second of two paired redemptions (4.9, 4.10a) is itself evidence the pairing accepted it — the suite uses this correctly.
- *A thawed vault surviving the transaction:* impossible by Solana atomicity. SEAL requires the burn instruction to be *present*; if any instruction in the transaction fails, the thaw reverts with it. There is no instruction anywhere that re-seals, and no path that ends a committed transaction with a thawed vault: the burn either landed (vault destroyed) or the transaction reverted (vault sealed). I looked for a way to make the burn instruction present-but-failing while the transaction commits — there is none; the runtime is all-or-nothing.

**The emptiness proof.** I re-derived every check:

- PDA lamports == 0 (measured necessity: Core's BurnV1 does not sweep the signer PDA — probe D4.2/D4.3).
- For each reserve mint, BOTH token-program ATA derivations must be *declared* (present in remaining accounts). I confirmed the Token-2022 derivation for a classic mint can never hold an account: the ATA program refuses `IncorrectProgramId` (probe F4.2, asserted per-mint in the mainnet probe), and the address is off-curve so no other creator exists. So the dual derivation is a sound completeness check, not a gap.
- Declared token accounts: owner == PDA, no delegate (three slots: delegate tag, delegated amount, close authority), exactly 165 bytes (refusing T22 extensions, whose confidential balance reads zero in the base amount), amount == 0.
- The second loop applies the same three delegate/extension/amount checks to *non-reserve* declared accounts owned by the PDA — the asymmetry round 24 fixed. I confirmed both loops now agree.
- Nested Core assets: a declared account owned by Core with `d[0] == KEY_ASSET_V1` refuses `VaultStillHoldsAVault`.

**One genuine gap I checked and confirmed closed by measurement elsewhere:** a stranger *can* create a non-ATA classic token account owned by the vault's PDA (SPL `initializeAccount` sets the owner field to any pubkey; the creator pays rent). Such an account is invisible to the reserve loop (wrong address) and, if undeclared, is destroyed by the burn. That is accepted limit 44, stated. If declared, the second loop catches a balance. If the page names it, the sweep helper moves it (it checks owner/mint/length, never ATA-ness — deliberately, and that is what makes the rescue path in item 50 possible). No new hole.

**R1 verdict: no defect. The owner's signature plus the two programs' rules are the whole gate, and the gate holds.**

---

## R1s — The sweep helper

**(a) Access control.** Direct calls need the asset-signer PDA's signature — only Core provides it, via `ExecuteV1`. On the pinned Core binary, Execute is approved only for `authority == owner`; a stranger and an owner-added transfer delegate are refused `NoApprovals` (0x1a) on a genuinely thawed vault (SR.5, SR.5a); the collection update authority is MINT's off-curve PDA (SR.5b) and is refused on a control asset (SR.5c) while the owner succeeds (SR.5d). While the vault is frozen, Core's PermanentFreezeExecute rejects the Execute before the helper is reached (3.7, D5.3) — so the helper cannot be reached outside a redemption. The one plugin route that could approve someone else (AgentIdentity) cannot be added by an owner (R24.1a) and requires the agent registry PDA even for a keypair update authority (R24.1c). I found no way to widen this with the pinned Core.

**(b) The pair list.** I traced every edge the prompt names:

- *Same source twice:* the first pair transfers and closes; the second `read_token` on the closed (System-owned) account fails `IllegalOwner`. SR.12a lands the refusal and SR.12b pins that it came from the closed account, not the source-owner guard — a real reason-pinning, not a tautology.
- *Source also a destination:* sources must be owned by the signer, destinations by `dest`; with `signer == dest` refused upfront, the roles are disjoint. A destination later used as a source fails the owner check.
- *wSOL source:* it is a 165-byte classic account; the helper transfers the balance to the destination's same-mint (native) account and closes it. Correct behavior, no special case needed.
- *Delegate or close authority on a source:* the helper transfers with the PDA as authority (a delegate does not block the owner's own transfer) and closes with the PDA as owner/close-authority. The account is then gone, so BURN's delegate checks are moot for it. No hole.
- *Frozen source:* the token program refuses the transfer, the Execute reverts, the redemption fails (SR.14) — the documented frozen-vault-account case (limit 28).
- *Destination not an ATA:* only owner/mint/length are checked; a non-ATA destination still credits the named wallet. Safe.
- *Destination wallet is another vault's asset-signer:* permitted (only `signer == dest` is refused). This moves the *owner's own* value into another PDA's accounts at the owner's sole discretion — the owner is the only person who can reach the helper, so this is their choice about their own money, and it cannot hide value from the burning vault's own emptiness proof (those accounts left the vault). Not a defect.
- *Odd account count:* `(len - 4) % 2 != 0` refuses (SR.7). *Zero pairs:* the lamports-only sweep (SR.13).

**(c) Destination checks.** The destination wallet is chosen by the transaction builder; the only person who can build an ExecuteV1 transaction is the owner. A lamports-only credit to a non-existent account below rent exemption is refused by the system program — the redemption fails closed, and the canonical destination (the fee-paying owner) exists by construction. R27.S1 measures a non-System destination (a token account) being credited with its data unchanged. All consistent with SPEC item 50's client contract.

**(d) The lamport sweep.** `signer.lamports()` is read at execution; the system transfer empties the PDA to zero. Nothing later in the redemption credits the PDA (Core's BurnV1 provably does not touch it), and a griefer cannot inject instructions into the owner's transaction. BURN's `lamports == 0` sees exactly what the sweep left. SR.4a's exact-delta accounting (stranger's gift + prior wallet balance + closed account rent + asset rent refund − fee) closes this.

**(e) Interaction with BURN's emptiness proof.** The sweep closes what it empties; a closed account is System-owned with zero lamports, so BURN's reserve loop skips it (`owner != token program`) — it passes *because it holds nothing and is no longer a token account*, which is the right reason. For the missing-reserve-ATA race: the page creates them in a prior transaction; a stranger's later deposit into them is swept at execution (the helper moves LIVE balances), so the race is closed. The residual stranger-creatable accounts (non-ATA classic, T22, nested Core) are exactly limit 44's documented set; the helper can name the classic ones, and the page's coverage check is the warning for the rest.

**(f) Does it fit?** S8.0 measures claim + open + helper(3 reserves) + burn at 1,061 bytes with the owner as payer, and explicitly reserves 52 (compute pair) + 96 (separate payer) = 1,209 of 1,232. A fourth reserve cannot exist (`MAX_RESERVE_MINTS = 3`, written once). The monthly run's pool account is already in the burn's fixed accounts. The measurement includes everything a real page adds.

**(g) Evidence and bytes.** SR.0–SR.14 and S8.* are arms that can all fail (I checked each `want` against a plausible wrong outcome). The helper's crate has no `localnet` feature (the metadata-hash defect round 25 fixed), and `build-mainnet.sh` `cmp`s the mainnet bytes against both the fresh localnet build and `target/deploy/` — the bytes the suite and sim actually deployed. The deployment identity is proven.

**R1s verdict: no defect.**

---

## R2 — The community pool's money

I attacked the invariant "the pool always holds at least ceil(owed)" through every path:

- `credit`: `owed += delta·w` where `delta·w = floor(avail·ACC/w)·w ≤ avail·ACC`. Since `avail = balance − ceil(owed_old)`, `ceil(owed_new) ≤ ceil(owed_old) + avail = balance`. Holds.
- `claim`: `owed -= pay·ACC` (a multiple of ACC, so the ceil drops by exactly `pay`) and `balance -= pay`. Holds.
- `retire`: `owed -= pending`, balance unchanged. Holds.
- `split_revenue`: only adds. Holds.

**Counters under every ordering.** `pending_count` / `pending_this_epoch`: requests increment both; `advance_epoch` zeroes `pending_this_epoch`; `join` decrements only `pending_count` (correct — a joining vault's request was by definition not this epoch); `retire` decrements `pending_this_epoch` only when `request_epoch == dist_epoch` (correct — an earlier-epoch request was already zeroed by the advance). I could not construct an ordering that underflows either or makes `waiting_to_join = pending_count − pending_this_epoch` miscount the eligible. F21.1/F21.2 exercise the same-epoch and earlier-epoch retires on chain.

`active_count` / `total_active_weight`: every entry (join) and exit (retire) moves both by the same weight, and `reweigh` moves the denominator by exactly the boost delta. The suite's `ledger()`/`books()` recompute both from every record after each money operation (BK.*), which is the strongest form of this check.

**SPEC's weaker wording on pre-join revenue (round 24 W11).** SPEC now says: "a vault is never credited by a distribution that ran BEFORE it joined. Revenue already sitting in the pool when it joins is shared at the next distribution by everyone joined then, the new vault included. It is NOT 'a vault never earns from revenue that arrived before it joined'." I checked this against the code: a vault joining at epoch e enters with `debt = w·acc_e`; the next distribution raises `acc` and the vault earns from it, regardless of when that revenue arrived. The wording is now accurate. The one remaining edge — *unsplit* revenue in the revenue address — is limit 55, accepted, with its cost correctly bounded (100 $GARY at the monthly boundary).

**Liveness.** Can anyone make distributions or redemptions impossible for others?

- A due boost blocks distributions until expired — but expiring is permissionless and free (`expire_boosts` needs only records; `claim` expires too). The gate cannot be held hostage by a vault whose token account is gone, because `expire_boosts` never touches token accounts. This was the design intent and it holds.
- An eligible-but-unjoined vault blocks distributions — but joining is permissionless and free. Holds.
- A frozen pool blocks paying claims — but redemptions still land via the forfeit (3c.F0–F3), and the monthly run never credits from a frozen pool. Holds.
- `distribute`'s burn path burns $GARY *before* `credit` but *after* every refusal check (waiting, balance, GARY mint/account) — I verified the order: the `waiting_to_join` check is explicitly before the burn CPI, and the balance/state checks precede it. A refused distribution burns nothing (PG.6a, 3c.A6c).

**One thing I checked that could have been a defect and is not:** `monthly_inline`'s early-return ladder. If the month is due but `boosts_due > 0`, it returns without stamping `last_distribute_at` — so the month stays due and the next host retries after someone expires the boosts. If eligible waiters exist, same. If weight is zero and `pending_this_epoch > 0`, it ticks (advancing the epoch so they can join). If weight is zero and nothing is pending, it does nothing — correct, there is nobody to pay and nothing to tick. No host is ever refused for these reasons. The only refusal is a wrong pool account, which is fail-closed. IN.0–IN.5 and BO.13 cover the branches.

**R2 verdict: no defect. The invariant holds under every ordering I could construct, and the suite's independent ledger recomputation is genuine evidence.**

---

## R2b — The $CBOB boost

**"Exactly N distributions, not one more."** A boost bought at epoch e with N distributions gets `end = e + N`. It is live for the distributions that advance the epoch from e to e+1 … e+N−1 to e+N — exactly N. The distribution that advances the epoch *to* e+N moves its ring count into `boosts_due` (in `advance_epoch`, after the increment), and `BoostsExpireFirst` refuses any further distribution until it is expired. BO.21 (boost-then-distribute in one transaction: the boost counts the distribution it rode in on) and BO.35 (distribute-then-boost: it does not) pin both orderings on chain, and the host unit test drives 260 epochs through the program's own functions against a model rebuilt from the records alone. I re-derived the ring arithmetic independently: with `epochs ≤ 63` and the slot zeroed at each advance, two live boosts can never collide in a ring slot, including past epoch 64 — the wrap case is exercised at four wraps with coverage assertions that the branches were actually reached.

**"Nothing earned is lost or gained when weight changes."** `reweigh` moves the entire current owed into `carry` and restarts `debt` at the new weight: new owed = new_w·acc − new_w·acc + carry = carry = old owed. `owed_scaled` is untouched. I verified this algebra for boost purchase, expiry, claim normalization, and both retire branches; the suite's `books()` checks `owed == Σ per-record owed` after every money operation, which would catch any drift.

**Counter agreement.** `boosts_active`, `boosts_due`, `boost_weight_total`, and the ring: every schedule change (buy, expire, retire-early, retire-due) moves exactly the right slots. `unschedule_boost`'s two branches (due → decrement `boosts_due`; not due → decrement the ring slot) are both exercised on chain at wrapped indices (BO.38/BO.38a: a wrapped boost retired three distributions early decrements exactly its own slot, `due` untouched). No record can be expired twice (`expire_boost` requires `boost_weight > 0`, and expiry zeroes it; `retire`/`claim` skip zero-weight records), early (`dist_epoch >= boost_end_epoch` required; BO.10b shows a not-yet-due record in an `expire_boosts` batch is skipped, never cut short), or never (the gate refuses every distribution while any is due, and expiring is permissionless — the crank does it every pass).

**Nobody can make distributions impossible by boosting or by a gone token account.** Boosting adds weight (diluting others, which is the product) but cannot block anything: the `BoostsExpireFirst` gate is only reachable while a boost is due, and expiry needs only the record. A vault whose token account is gone can still be expired (`expire_boosts` reads no token accounts) and retired (`retire_burned` reads no token accounts). The one residual — a boosted orphaned vault's dead weight — is round 29 D2, stated in SPEC under "What got worse" with its permanent per-orphan cost, and is an owner decision before the lock, not a fixable defect now.

**R2b verdict: no defect.**

---

## R3 — The level draw

**The SlotHashes parse.** `blockhash_in_window` pins the sysvar id, bounds the declared count at 512, bounds the buffer against the count, refuses an all-zero hash, and takes the smallest produced slot in `[want, want+64]`. The host unit tests build the sysvar bytes by hand and cover: skipped targets, runs of skips, the inclusive window edge (`want+64` in, `want+65` out), a target newer than the buffer, an older slot below the target, 513 declared entries, truncation, a forged account under another key, and the zero hash. Every malformed input is refused, never zero-filled. This is the most defensive sysvar parse I have seen in this codebase.

**The FIFO.** `reveal_level` requires `index == revealed_total`. I verified the census can never be exhausted ahead of the queue: `check_supply` enforces `minted_total ≤ cap_total` at every mint, every reveal consumes exactly one cap slot, and the vault at the FIFO head has `revealed_total ≤ minted_total − 1`, so `cap_total − revealed_total ≥ 1` always — `LevelCapReached` is unreachable at a legitimate FIFO reveal. A burned vault at the head still takes its draw (L.11) so the queue never stops. A missed window is rescheduled to `now + 16` (a slot that does not exist yet), never defaulted.

**The three-hash construction.** A, then B and C each two 4-slot leader groups after the previous. The capture deadline arithmetic is sound (A is at most `reveal_slot + 64`, all three within the 300-slot window, all within SlotHashes' 512). The independent re-derivation arm (L.3c) recomputes the stored entropy from the raw sysvar, and L.23 replays *every* draw in mint order against the census at its turn.

**What a leader can influence — is it worse than SPEC 26?** No. Only C's leader, producing its block knowing hA and hB, can select; A's and B's leaders cannot (their successors' hashes are unknown to them). C's leader can skip within its own group (best-of-4: P(Level V) 5.0% → 18.6%) and grind contents for more, for its own vault and every vault minted in the same slot (same `reveal_slot`, same three hashes, each mixing in its own asset address). SPEC 26 states exactly this, including the cohort effect and the measured numbers. HOLDER-GUIDE says "the validator producing the last of those blocks can pick among several results… That can be enough to choose the level of a vault created in the same moment (from the levels still left)" — accurate, including the "levels still left" qualifier that makes it selection rather than fabrication. I found nothing worse than stated.

**R3 verdict: no defect. The draw is as fair as a public-hash scheme permits, and both residuals are correctly buyer-facing.**

---

## R4 — Governance

**Minority carry.** The smallest passing ordinary vote at the ruled numbers is 21% quorum, all YES = 21% of the snapshot ≥ the 10% turnout floor — so 21% carries ordinary actions. That is the ruling (quorum deliberately reachable early). Key changes need YES from ⌈50% of the snapshotted live supply⌉, never of votes cast, never bundled with the other key change, landing only after the notice. I verified `KeyChangeNeedsHalf` divides by the snapshot, not the turnout, and that the bundle refusal (`KeyChangesBundled`) is checked at creation. Round 25 D1's mid-vote-mint nuance (minted vaults can neither vote nor raise the bar) is stated in SPEC and the holder guide.

**Reaching money it should not.** A ratified vote reaches exactly: `set_round` (bounded by the price floor, cap > 0, window ≤ 1 year, `max_supply`), `restart` (bounded by `StopIsNewer`), `tighten_sweep` (monotone, bounded by the three initialize bounds — GOV refuses at creation against the same fixed values MINT enforces at execution, so a ratified proposal can never be refused there), `arm_swap_operator`/`arm_guardian` (notice-gated), `set_boost_terms` (bounded by the initialize ceilings). The split, both destinations, `max_supply`, the royalty, the reserve list, and the charter window are reachable by nothing. I checked GOV's `SweepTighten` byte-for-byte against MINT's (P.0e asserts the struct bodies match and contain no money field; the suite executes a ratified tighten end to end).

**Frozen forever.** The electorate shrinks with redemptions (live supply divisor), so quorum gets *easier*, never harder — the v5 deadlock is gone. If every vault is redeemed, no proposal can be created until a new vault exists (limit 45, correctly corrected by round 24 D3: an open round can still mint). A stolen guardian's stop can be permanent below half turnout (limit 47, stated). `execute_proposal` is permissionless within the 7-day window; skips are logged no-ops that cannot take a bundle down (E.2, 3c.R1, 3b.S1). I looked for a way to make a proposal unexecutable forever — the only one is letting the 7-day window lapse, which is a vote-again matter, not a freeze.

**SPEC 47's question — is a stolen guardian's stop worse than stated?** I checked whether a thief could do anything beyond stop/cancel: `emergency_stop_*` write only the flags and the transition timestamp (which `restart`'s `StopIsNewer` and the re-stop immutability (3b.S2) correctly bound); `cancel_swap_operator` clears only a pending operator. There is no instruction the guardian holds that touches a vault, a payout, a rule, or its own replacement. Not worse than stated.

**R4 verdict: no defect.**

---

## R5 — The charter claim

Identity by address against the Merkle root: leaf `sha256(0x00‖pubkey)`, node `sha256(0x01‖min‖max)`, sorted pairs, odd-node promotion. I verified the Rust and the JS implementations agree structurally (domain separation prevents leaf-as-node replay; sorting removes direction bits), and the decisive check — the program verifying proofs the JS built — runs in the suite (C.2, C.8, C.12) and the simulation against the *real* 240-address root with real mainnet PoB assets (S0.3, S2.*). A lookalike minted by the hot wallet tomorrow is not a leaf (C.8). A spent PoB cannot be re-minted (Core tombstone, 9.12/9.13, S9.1/S9.2), so a leaf is spent once with no bitmap.

The window is fixed at initialize and refused by clock alone outside it (C.1, C.15); it is not gated by the guardian (ruling; C.13 exercises a claim while both stops are set). `pob_extra` accounts are passed through never as signers (OR.3 refuses a count exceeding the accounts; OR.4 lands a benign Oracle pass-through; OR.5 shows a rejecting Oracle still refuses *through Core*, pinned by the `OR.5!` reason check).

**Is SPEC 46 complete?** It states: the hot key can gate or brick claims through the window (end the project, or capture governance by admitting only its own PoBs), the alarm samples state (a hook added and removed between passes is invisible), per-asset plugin changes share the blind spot, owners can add owner-managed plugins including a freeze delegate that blocks the burn while frozen, and the positive bound (the key cannot transfer or burn a PoB). What can that wallet, a PoB holder, or a third party still do that SPEC 46 omits? I looked for: moving a PoB out of the collection (same brick class, named), rewriting a PoB's name/uri (cosmetic — identity is by address), adding an update-authority *plugin* to the collection (named), and the packet bound on `pob_extra` (measured: 4 distinct extras in the widest legacy shape, 8 without the separate payer/compute instructions — stated). I found nothing omitted. The one thing I would add is operational, not a hole: the charter window's *opening date* is still OPEN in `launch/mainnet-init.json`, and until it is set, the exposure window itself is unbounded in time — but that is item 38's open state, already blocking.

**R5 verdict: no defect.**

---

## R6 — One-time configuration and the trusted hop

Every `initialize` refusal is enumerated in the suite with a both-ways arm (0.1a–0.1v, 0.2–0.3b, 7.0–7.12e, RL.0). I checked each accepted-but-wrong value that would lock in forever:

- A wrong `payment_mint` not in SEAL's reserves: refused (`PaymentMintNotAReserve`) — the pool could otherwise pay what no vault can redeem.
- A wrong collection (dirty, foreign, already minted): refused.
- A default 15% destination: refused (every split would fail forever).
- Boost bounds outside [1,12]/[1,63], a $CBOB mint that is the payment mint, GARY, T22, or not a mint: refused.
- Sweep bounds outside their absolute ranges or mutually inconsistent: refused.
- Charter window already over, or an all-zero PoB root: refused.

The residual (round 24 A6, still true and stated): the programs check less than `check-launch-params.mjs` — off-curve guardian/operator keys are accepted, `redeem_window_secs` may be 10 s–24 h. The checker is the gate, and it validates the JSON, not the signed transaction; whoever builds the four initializes must build them from the file. This is item 38, OPEN AND BLOCKING, and correctly so.

**The swap operator's worst case:** cap × cooldown windows until the guardian stops it, bounded by the revenue PDA's balance above the reserve; the operator must sign; a vote can only tighten within the fixed bounds; a replacement needs half of all live vaults plus notice; the guardian can stop and cancel. I verified `sweep_sol_for_swap` enforces all of it (6.15–6.19b, 8.7–8.10b) and that three sweeps in one transaction are refused by the cooldown (6.17). The bound is honestly stated as a rate, not a total.

**The 10% royalty:** plugin authority None; Core refuses update and removal even by the update authority (R.5/R.6/R.6a with the UpdateAuthority control proving the calls are well formed), and nothing in our programs writes the collection's plugins after initialize. Confirmed.

**The redemption cap:** I re-derived the ring arithmetic. The k-th most recent redemption (k = min(cap, 64)) must be ≥ a full window old; the head advances on every landing; unwritten slots read 0. The rolling-window argument holds: any window of length `win` ending at a landing contains at most k−1 prior landings plus this one = cap. RL.2–RL.7 and S10 exercise it at a short window, and RL.7 replays every remembered redemption against the cap certified across its snapshot interval (the `stampCaps` coherence model, which refuses ambiguous supply interleavings rather than guessing). The 3,600 s value is the same arithmetic; the launch checker pins it.

**R6 verdict: no defect.**

---

## R7 — Cross-program raw reads

I recomputed every offset from the struct definitions:

- **MintConfig (v6):** version 8, collection 9, governance 41, pool_ata 73, round_id 105, opens 109, closes 117, price 125, cap 133, minted_this_round 137, minted_total 141, max_supply 149, bank_treasury 157, split_bps 189, sales_stopped 191, sweep_stopped 192, guardian 193, swap_operator 225, sol_reserve 257, bump 265, max_sweep 266, cooldown 274, last_sweep 282, level_caps 290, level_minted 310, revealed_total 330, payment_mint 338, pob_collection 370, pob_root 402, charter_opens 434, charter_closes 442, charter_claimed 450, bare_burns_retired 454, total_active_weight 462, active_count 470, acc 478, owed 494, last_distribute 510, sales_stopped_at 518, sweep_stopped_at 526, pending_op 534, pending_op_at 566, monthly 574, pending_guardian 582, pending_guardian_set 614, pending_guardian_at 615, notice 623, sweep_floor 631, cooldown_ceiling 639, reserve_ceiling 647, dist_epoch 655, pending_count 663, pending_this 671, cbob_mint 679, max_boost_weight 711, max_boost_epochs 712, boost_price 714, boost_weight 722, boost_epochs 723, boosts_active 725, boosts_due 729, boost_weight_total 733, cbob_burned 741, boost_expiring 749–1005. **Every GOV and BURN constant matches these.** The suite's own offsets (3.1w) agree.
- **VaultRecord (v4):** 221 bytes; version 8, asset 9, mint_index 41 — GOV's reads match.
- **BurnConfig (v4):** version 8, collection 9, bump 41, burned_total 42 — GOV's `OFF_BURN_TOTAL = 42` matches.
- **SealConfig (v2):** version 8, collection 9, reserves 41 — MINT's and BURN's reads match.
- **MINT_CONFIG_SPACE = 1,261** (1,005 + 256 padding) — matches round 31's W9 correction; the 1,253 claims were wrong.
- **The sweep helper's token offsets** (mint 0, owner 32, amount 64, length 165) — correct for classic SPL.

Every reader pins address, owner, discriminator, and version byte. A layout change fails loudly. The suite pins every discriminator against its Anchor derivation (3.1a–3.1u) and asserts the three readers agree on the MintConfig version (3.1v).

**R7 verdict: no defect. Every offset and space is correct.**

---

## R8 — The suite, the simulation, and the build as evidence

**Arms that cannot fail:** I looked hard for these. The closest candidates are the pure-JS model arms (RL.S1–S6), but those models genuinely detect ambiguity and backward motion — they can fail. `X.7` is explicitly honest about what an empty plan proves (the round-22 F20 fix). `SR.12b` is a real reason-discrimination check. `9.13a` pins the serializer's signature-slot reservation. I found no arm whose `want` cannot be falsified by any behavior of the code under test.

**Wrong-reason negatives:** the `because()` list is extensive and the `attP` fallback (round 25 N4) keeps `Program <id> failed:` lines so pins can name the refusing program. The ID.1 uniqueness check guards against a pin reading another arm's error. The one soft spot I found: several `because` pins match substrings that could in principle appear in a different program's error (e.g., `'0x1a'` for Core refusals), but each such pin is paired with a program-id pin in the same list (`because('R.6','CoREENxT6...failed')` *and* `because('R.6','0x9')`), so the pair is discriminating. Not a defect.

**Claims in this prompt no arm exercises:** the 3,600 s redemption window value (exercised only at 10 s; the launch checker pins 3,600 — stated in SPEC as "the same arithmetic, not separately exercised"); the 7-day execution window (stated, not exercised — SPEC says so); the 30-day monthly period (150 s in the suite; pinned by the checker and the alarm). All three are initialize values whose short-suite equivalents *are* exercised, and all three are named as such. Nothing is silently untested.

**Program bytes:** `build-mainnet.sh` proves the sweep helper's mainnet bytes are byte-identical to both the fresh localnet build and `target/deploy/` (what the suite and sim deployed), and proves all four keyed programs reject the test key (mainnet) and accept it (localnet), each for the `NotTheInitAuthority` reason specifically, with the `REACHED_PAST` fallback for programs whose later checks fire first. The stated boundary — the compiled constant is not proven to *be* Gary's key, bridged by reproducibility from a clean commit — is honest and unchanged.

**The simulation:** 71 assertions against real cloned Core, the real cbBTC/$GARY/$GIRAFFISH mint accounts (fixtures assert the patch touches only the mint authority), two real mainnet PoB assets (owner-only patch, asserted), the real 240-address root, and the production census and ratios. S8 runs the redemption through the helper after a stranger's deposit. S9b lands two redemptions in one v0 transaction at a cap of two. The floors equal the counts.

**R8 verdict: no defect in the evidence apparatus.**

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?**

I attacked each one for exploitability beyond its written cost:

- **Limit 9/44 (undeclared holdings destroyed):** the sweep helper narrows this for classic tokens (any mint, ATA or not, when the page names it). The residual set — T22 accounts, frozen strays with balance, nested Core — is exactly as stated. A stranger *can* create a non-ATA classic account owned by the vault PDA, but that is inside the documented "anything else a vault's PDA holds" set, and the helper can rescue it. Not worse.
- **Limit 28 (Coinbase freeze):** the frozen-pool redemption forfeit is measured (3c.F0–F3); the frozen-vault-account whole-redemption block is stated; the split halt is stated. I checked whether a frozen *revenue* account could strand mint payments — round 23 L9 already states it (paid mints refuse; the alarm pages). Not worse.
- **Limit 32 (rate limit):** the ring covers live supply to 3,047; max supply is 2,100 (cap 45). The "live includes unretired bare burns" one-high reading is stated (round 24 D8). Not worse.
- **Limit 46 (PoB hot wallet):** complete, including the sampling blind spot, the per-asset blind spot, and the positive bound. Not worse.
- **Limit 47 (stolen guardian):** the permanent-stop-at-low-turnout case is stated (round 24 A4). Not worse.
- **Limit 55 (unsplit revenue):** the 100 $GARY monthly-boundary cost is stated. Not worse.
- **Limit 10 (swap operator):** the double-key compromise (operator + absent guardian) is bounded by the combination of limits 10 and 47, both individually true; round 31's A2 called this optional wording. I agree it is optional — the sentences as written are not false.

**No accepted limit is worse than stated.**

**2. Is anything listed as a limit not actually a limit?**

- **Limit 35 (the 10% turnout rule never binds at the ruled numbers):** correct — 21% quorum × 51% threshold = 10.71% YES minimum > 10%. The rule is a floor for other initialize values. Accurately characterized.
- **Limit 42 (prior transaction for destination ATAs):** the narrow owner-payer helper shape with all three creates fits at 1,219 bytes (round 26 D4's correction), so the old categorical claim was false — but the item now states exactly this, calling the narrow variant an offline measurement and not the page contract. Accurately characterized as a client contract, not an impossibility.
- **Limit 43 (off-curve owner cannot redeem):** measured with the wrapper (WR.1–WR.4). Real.
- **Limit 27 (claim between bare burn and retirement):** real; the crank retires first every pass.

**Nothing on the list is already closed or phantom.**

**3. Is any DISCHARGED item not actually discharged?**

- **Item 19 (unlevelled-vault halt):** closed by construction — `activate` refuses `NotRevealed`, the payout reads the record's level, there is no off-chain allocator. Confirmed.
- **Item 14 (duplicate attributes):** `DuplicateAttribute` refused at mint (11.4). Confirmed.
- **Items 30/31/33:** the vote-reachable wiring is gone, the period is an initialize value exercised at 150 s, the notice is exercised at 60 s with both apply refusals and landings. Confirmed.
- **Item 51 (the boost):** built, measured by section BO and the host unit tests, the $CBOB mint exists on mainnet with no authorities. Confirmed.
- **Item 54 (compute):** measured; the page rule follows the measured numbers. Confirmed.
- **Items 12/17:** measured on the artifact; the byte wall binds first. Confirmed.
- **The v5 Bank-family items:** all gone with the Bank; each discharge names what replaced it. Confirmed.

**Every discharged item is genuinely discharged.**

**4. Is anything in OPEN AND BLOCKING quietly treated as accepted?**

- **Item 22 (nothing has run a distribution against a live chain):** still open; the rehearsal is road step 8, not started. Not demoted.
- **Item 38 (initialize values):** still open (charter date, lock deadline); the checker refuses until complete. Not demoted.
- **Item 50 (holder surfaces):** still open; the holder guide is DRAFT and the publication ban is stated. Not demoted.
- **Item 52 (cbBTC accounts before first split):** still open; road step 10. Not demoted.
- **Item 53 (rehearsal tree):** still open; the round-24 proof is stale and must be re-run at the release commit — the round-31 validation refreshed the worktree at `4ae79d6` but explicitly did not run the suite in it. Not demoted.

**Nothing open is being treated as accepted.**

---

## Findings

I have no CRITICAL, HIGH, or MEDIUM findings. I have two LOW findings, both in the certification apparatus rather than the programs, and both with the evidence that would confirm them:

**LOW-1. `scripts/audit-coverage.sh`'s prepared-round credit can be satisfied by a bundle the prepared round never delivers.**

*Construct:* `scripts/audit-coverage.sh`, the `--prepared` branch — `prepared = b['programs'] | b['offchain']` is taken from the *current* content of the newest `auditN.ts` on disk, and a file is credited in prepared mode if `f in prepared`. The comment says "the runner refuses to name a file it did not deliver," but that refusal lives in the runner, not in this gate: the gate itself credits any path present in the current script's TARGETS, whether or not the round has run, and `--prepared` is documented as answering "will the next round, once it runs, deliver every current file?" — which it answers correctly only if the script's bundle is what will actually be sent.

*What an accident gains:* nothing monetary. What it costs: a false preflight green — someone could treat a `--prepared` pass as evidence that coverage is arranged when the prepared script's TARGETS could still be edited before the round runs, or (worse) the script could be swapped after the preflight check. The strict gate (the freeze question) is unaffected because it requires a completed, quorate round.

*Evidence if I am right:* run `--prepared`, note the credited set; then remove one path from the prepared script's TARGETS and re-run — the file drops out (proving the gate reads the script, not a delivery record); then re-add the path and note the gate passes without any round having run. The asymmetry with the strict branch — which reads the bundle from the script *as it was at the audited commit* (`script_at(m.get('head'), name)`) precisely so a later edit cannot credit a file — is visible in the source: the prepared branch reads `open(f'scripts/{name}')`, the current file.

*Fix:* in prepared mode, read the bundle from the current script but also require a delivery manifest (or simply document that `--prepared` certifies intent, not delivery, and keep the strict gate as the only freeze input — which is already the case). Given the strict gate is the one that matters, this is a hardening note, not a blocker.

**LOW-2. The round-31 rerun manifests record `required: 3`, so the pass's quorum exists only in the verdict headline the L1 repair now trusts.**

*Construct:* `audits/round31/VERDICT-programs.md` records the rerun manifest's `required` as 3 and states "This verdict is the only record of it." The repaired gate reads `MANIFEST-<focus>.json`'s `auditors >= required` — which after a rerun is the *rerun's* manifest (3/3) — and then the verdict's first line. The quorum of the *pass* (8 of 8 seats, six required) is recorded nowhere machine-readable.

*What an accident gains:* nothing today; every credited round's verdict headline is correct. The cost is structural: the gate's quorum evidence for a rerun round is a headline a triage agent writes, not a count a runner records.

*Evidence if I am right:* read `MANIFEST-programs.json` (rerun: `required: 3`) and `MANIFEST-programs.first-run.json` (5/8) — neither records the pass-level requirement of six; only the verdict text does.

*Fix:* round 31's own repair suggestion — a structured `QUORUM-<focus>.json` written by triage with counted/required/met, required by the gate. This is the residual round 31 already named; I am confirming it survives as a LOW, not elevating it.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

What this process structurally cannot do, and what to do about each before the upgrade authority is removed:

1. **Execute the launch ceremony end-to-end at throwaway values with a human watching.** The rehearsal tree exists and is proven reversible, but the full `run-tests.sh` has been proven inside it only at a stale commit (`d57ee3a`), and the rehearsal value set (`launch/rehearsal-init.json`) and the checker's rehearsal mode are still unwritten. Re-run the whole gate inside the rehearsal tree at the release commit, with the alarm in `CBOB_ALARM_REHEARSAL=1` mode and its router pointed at a rehearsal directory. This is the only way the shipped off-chain code meets throwaway ids before it meets real ones.

2. **Run one full live revenue cycle through both pools and one forced post-sweep failure walked through hand recovery** (item 22's named items 3 and 4). No suite, sim, or fork exercises `bank/revenue.mjs`'s live I/O. The swap fork proves the *programs* accept the transactions; it does not prove the *job* survives a confirmation timeout without double-swapping. This is the single largest unexercised surface that moves real money.

3. **Have a human read the four initialize transactions against `launch/mainnet-init.json` before signing.** The checker validates the JSON; nothing validates that the built transactions carry those values. This is a ten-minute manual diff against a permanent, uncorrectable write. Do it twice, by two people, and record both readings.

4. **Build and exercise the redeem page before the lock, and treat its client obligations as a checklist a human signs off per release:** prior transaction for destination and vault reserve accounts; claim before the sweep except under a frozen pool; the helper sweep naming all three reserves; the compute-unit rule; `judgeRedemptionCoverage` before signature. Every one of these is a way a correct program can still destroy a holder's value through a wrong client, and none of them is enforceable on chain. The page is item 50, OPEN AND BLOCKING — it must not be demoted.

5. **Set the charter opening date and lock deadline now, and hold the PoB hot wallet cold or in a multisig through the seven-day window.** Limit 46's exposure is bounded by the window's existence; the window's date is still OPEN, which means the exposure's *start* is currently unbounded. Gary's ruling keeps the key hot, but the ruling and the risk are both his to hold — make sure he holds them with the dates in hand.

6. **Fund the revenue address above rent exemption and create the three cbBTC accounts (pool, revenue, Squads) before the first paid mint** (item 52, road step 10). A first royalty below rent exemption fails the first split, loudly but permanently confusingly.

7. **After deploy, verify the on-chain bytes against `dist/SHA256SUMS` and remove all five upgrade authorities, in that order, on the same day** — and treat the alarm's `program_not_locked` CRITICAL as the backstop, not the plan.

The programs themselves: I could not break them. The pairing, the emptiness proof, the pool arithmetic, the boost ring, the draw, the governance bounds, the charter claim, and every pinned cross-program read held under everything I could construct. What remains is the launch, and the launch is where the unexercised code is.