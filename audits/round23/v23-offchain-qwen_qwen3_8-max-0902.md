# ROUND 23 AUDIT — FAULTS FOUND

I read the whole tree. I attempted to break each target, checked every round-22 repair, and re-derived the money math against the Rust. I am reporting only what I can state with a checkable consequence. I found no theft path and no instruction that moves value anywhere the programs do not pin. What I found is concentrated in the alarm's newest detector and in documentation that has drifted from the code it describes.

---

## R2 — THE ALARM

### FINDING 1 — MEDIUM: `revenue_unsplit` cries wolf for the entire duration of any active sale, defeating the very control round 22 S1 added

**Construct:** `bank/alarm.mjs` `main()` (the revenue block) + `bank/detectors.mjs` `detectUnsplitRevenue`.

The detector is fed `sinceSec = prev?.revenueSince ?? nowSec`. `revenueSince` is only ever reset to `null` on a pass that observes the revenue ATA at **zero**. It is carried forward unchanged on every pass where `revenue.amount > 0`:

```js
if (r.state === 'ok' && r.amount > 0n) {
  revenueSince = prev?.revenueSince ?? nowSec     // carried, never reset by a split
  findings.push(...D.detectUnsplitRevenue({ amount: r.amount, sinceSec: revenueSince, nowSec }))
}
```

`detectUnsplitRevenue` then pages HIGH once `nowSec - sinceSec > 6h`.

The crank splits **hourly** (`37 * * * *`), and `split_revenue` moves the *entire* balance, so revenue does hit 0 at `:37`. But the alarm samples at `:23` and `:53`. During any sale round where mints land more often than roughly once every 16 minutes, the revenue ATA is **never zero at either sample point**: it is split at `:37`, re-funds by `:53`, and is still non-zero at `:23`. `revenueSince` is therefore set once, at the first mint of the sale, and never reset. Six hours into a perfectly healthy sale — with the crank splitting on schedule every hour — `revenue_unsplit` (severity HIGH, which triggers the notify path in `report()`) fires **every 30 minutes for the rest of the sale**.

**What an accident gains:** nothing is lost, but this is the exact failure the file's own header warns against. A HIGH that rings 48 times a day during the single most important operational window (a sale) is how operators learn to scroll past `revenue_unsplit`. The real fault this detector exists for — the crank genuinely stops splitting, and royalty/mint cbBTC sits undistributed in the revenue address — then arrives as the fifty-first identical page and gets missed. The early-warning layer (6 h) is destroyed; only the much later `distribution_overdue` (up to a month) remains.

**Evidence that would exist if I am right:** run the alarm against a cluster (or the dress rehearsal) while minting continuously for >6 h. (a) `state.json` shows `revenueSince` constant across all passes while `revenue.amount > 0`; (b) `revenue_unsplit` appears in findings; (c) in the same 6 h window, `getSignaturesForAddress(MINT)` contains landed `split_revenue` transactions (discriminator `IX_SPLIT`). (b) and (c) together are the contradiction: splits happened, yet the "unsplit" detector fired. A unit reproduction needs no cluster: call the block with `prev.revenueSince = now - 7h` and `amount > 0`; it returns the finding regardless of any split in between.

**Fix:** measure from the last **split**, not from first sight. The alarm already collects `seenSplits` with `blockTime` in the signature walk. Page only when `revenue.amount > 0` and `nowSec - max(lastSplitBlockTime, revenueSince) > grace`. If no split has ever been seen, fall back to the current `revenueSince`. This resets the clock on every real split and still fires when splitting truly stops.

---

## R1 — THE CRANK

I could not produce a plan the program will refuse for value, a reveal out of order, or a join/payment of a positively burned vault. Specifically I verified: the join/distribute/expire ordering predicts the post-retire/post-join/post-expire weight correctly (`w = total_active_weight + preJoinWeight − retiringWeight − expiringWeight`, with `retiringWeight` using level+boost and `expiringWeight` using boost only, matching `weight_of`/`reweigh`); pre-joins run as `claim` batches whose in-instruction `monthly_inline` correctly no-ops because `waiting_to_join > 0` until the last batch; and the post-join owed formula (`level_weight·(acc − acc₀)`) and the pre-expiry formula (`atExpiry + level_weight·(acc − acc₀)`) match the program's `owed_of` after `join`/`reweigh`. The one residual is a documentation fault, below.

### FINDING 2 — LOW: the control table, SPEC, and the crank's own header still say the fee payer is *refused* above 0.25 SOL; the code has *run-and-warned* since round 22 F8

**Construct:** `bank/crank.mjs` `judgeFeePayer` (returns `ok:true` with a `warn` above the ceiling) versus:
- `SPEC.md` control table, `bank/crank.mjs` row: "its key pays fees only and is **refused above 0.25 SOL**";
- `SPEC.md` off-chain table: "refused above 0.25 SOL";
- `bank/crank.mjs` header comment: "the crank **REFUSES to run** if it holds more than a small ceiling, so it is never a honeypot."

The behaviour change (F8: refusing let anyone DoS every crank lane by donating 0.25 SOL) is defensible and the selftest pins the *new* behaviour (`judgeFeePayer(ceiling+1).ok === true`). The defect is that three documents still assert the old one. This is the project's most-repeated shape — a comment asserting a control that no longer exists — now sitting in the control table, which is the one place SPEC says is mechanically true. The mechanical check covers the fourth column (AUTOMATIC/PROCEDURE/ON-CHAIN), not the prose, so this drifted silently.

**What it gains:** a reader of the control table believes the crank key cannot be a honeypot; it can (it runs above the ceiling and pages). An operator responding to the warn may not realise the stated invariant is already gone.

**Evidence:** `judgeFeePayer(250_000_001n).ok` is `true` (and the selftest asserts exactly that), while the three quoted passages say "refused."

**Fix:** update the control-table row, the SPEC off-chain table, and the crank header to "runs above the ceiling and pages every pass until the excess is moved." Add a selftest arm asserting the control-table prose no longer contains "refused above" for the crank row.

---

## R3 — LAYOUTS / R4 — MONEY ARITHMETIC / R4b — BOOST & TOKEN

I found no divergence. `accrual.mjs` `credit`/`pendingScaled`/`ceilSats`/`reweigh` are line-for-line the Rust `credit`/`owed_of`/`ceil_sats`/`reweigh`, including the carry-before-debt ordering that makes expiry non-negative. The layout field lists are asserted against the parsed Rust in both directions, and every pinned cross-program `OFF_*` is compared. The boost ring arithmetic (`BOOST_RING=64`, max epochs 24 < 63) prevents two live boosts sharing a slot, and `unschedule_boost` correctly decrements `boosts_due` versus `boost_expiring` by the due/not-due split.

`launch/create-cbob-token.mjs` cannot leave a live mint authority, a freeze authority, or a partial supply: all six instructions (create, init-mint with freeze=null, ATA, mint-to, metadata, revoke-mint-authority) are in one atomic transaction signed by `[release, mint]`, and a failure anywhere reverts the whole thing. A confirmation-timeout that actually landed is caught on re-run by the `getAccountInfo(mint)` existence guard. Two observations, neither a code fault:

- **INFO:** the metadata stays mutable with the update authority retained by Gary's wallet. That is ruled and disclosed, but it means a compromise of that wallet can swap the icon/URI to a phishing asset even though supply and freeze are locked. State this in holder-facing copy.
- **INFO:** the entire 2.1B CBOB supply sits in one hot release wallet. This is a centralization fact, not a protocol bug (boosts cost a fixed CBOB amount, so market price does not change boost cost), but it is a single key controlling all boost purchasing power. See the final section.

---

## R5 — THE SWAP HOP

Worst case, stated plainly: the swap transaction is signed by the operator, and the pre-sign check is a **bound, not a proof** — it verifies exactly one signer and a two-entry forbidden list, but does not enumerate route programs. A tampered or malicious `/swap` response could include a plain `SystemProgram.transfer` of the operator's swept SOL to an attacker and still pass the check (one signer, no forbidden program). This is bounded by `max_sweep_lamports` per cooldown and by the operator holding only cycle funds, and it is inside accepted limit 10's "the operator is the trusted hop." I confirm the ledger cannot read a failed cycle as closed: `cycleIsOpen` treats a timeout-after-sweep as open (only `intendedLamports` set), treats `sendRejected` as closed, and the split-by-other recovery requires a *provably empty* revenue ATA plus `returnedSats > 0`, which is only set after the return transfer lands. No finding here beyond the accepted limit.

---

## R6 — THE GATES

The floors are equality floors (`-eq`, and `R.length !== FLOOR` exits 1), the DAS/control-table/signer-set checks are non-vacuous (each has a "must not be empty / must catch the negative" arm), and `readLedger` distinguishes absent from corrupt. I found no arm that cannot fail and no floor satisfiable by deleting work. The one gap is FINDING 2's class: prose claims in the control table are not mechanically bound, so they drift. That is the actionable item.

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

**1. Is any limit WORSE than stated?** I found none materially worse. Limit 55's "about an hour of sales" is accurate given the hourly crank split. Limit 32's ring bound (64 ≥ cap up to 3,047 live) holds at the 2,100 cap. Limit 26's cohort-grinding is correctly stated after the round-22 correction.

**2. Is anything listed as a limit not actually a limit?** No. Limit 35 (10% turnout never binds at 21/51) is correctly described as a non-binding floor. The limits I checked are real.

**3. Is any DISCHARGED item not actually discharged?** I found the discharged items (12/17 compute, 14 duplicate attrs, 19 unlevelled halt, 30/31/33) genuinely closed by measurement or by deletion of the thing they were about. None reopens on my reading.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?** **Item 50 is the one at risk.** The redeem page (`judgeRedemptionCoverage` before signature) is the *only* preventive control for limits 9 and 44 (foreign nested assets and undeclared airdrops destroyed on redemption). It is a pure function with no caller, and there is **no hard code gate** that prevents removing the upgrade authority (road step 11) while it is unbuilt — unlike the ship gate's two-clean-rounds and dress-rehearsal requirements, which are procedural but explicit. As written, nothing mechanically stops a launch that skips step 6's holder surfaces. Recommend making item 50 an explicit precondition of step 11, in writing, so it cannot be silently waived. Item 38's three OPEN values (charter date, lock deadline, cbob_mint) are correctly refused by `check-launch-params.mjs` while null — that gate is real.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

AI audit reasons over static code; it structurally cannot do the following, and each must be done by a human with real time and real keys before the upgrade authority is removed:

1. **Run the mainnet dress rehearsal LIVE, with real (small) amounts, for at least one full distribution cycle.** This is item 22 and it is the single thing that cannot be substituted. It must exercise: the crank and alarm `--live` against the real RPC and DAS under realistic mint volume (this is also the only way to surface FINDING 1 in situ), a transient RPC error mid-claim-batch, the every-minute reveal lane keeping up, and a real `split_revenue`/`distribute`/`claim` landing on mainnet economics. Do not remove the upgrade authority until this has run green for a sustained period.

2. **Stand up a human who answers pages.** AI cannot respond to a 3 a.m. `pool_frozen` or `unreconciled_swap`. The alarm, dead-man's switch, and guardian stop are only as good as the person who receives the SMS and acts. Name that person and test the page path end-to-end before launch.

3. **Fix key custody that AI cannot assess.** The swap-operator key, the guardian key, `INIT_AUTHORITY`, and especially the **$CBOB release wallet (holding the entire 2.1B supply)** should be in hardware or multisig, not hot on the box. The code enforces nothing about where these secrets live; that is a human decision and currently the weakest link.

4. **Verify deployed bytes at the moment of deploy.** `build-mainnet.sh` proves which key shipped, but a human must run it, deploy, `program dump` each of the four programs, and compare the sha256 against the recorded artifact *after* deploy and *before* `initialize`. AI cannot observe the chain at that moment.

5. **Close the OPEN rulings in writing.** Charter opening date, lock deadline, the $CBOB mint address, and the two boost bounds are null/OPEN in `launch/mainnet-init.json`. The gate refuses them, but a human must record Gary's actual values and re-run `check-launch-params.mjs` to green before the signing ceremony.

6. **Accept the external trusts explicitly.** cbBTC's Coinbase freeze authority and the Jupiter route are outside every program here. No amount of audit removes them; they must be acknowledged as operating assumptions by whoever signs off on launch.

The code is in better shape than the round-22 repair surface suggested, but FINDING 1 is a live defect in the newest detector and FINDING 2 shows the control-table prose has already begun to drift from the code it certifies. Both are cheap to fix now and expensive to discover after the authority is gone.