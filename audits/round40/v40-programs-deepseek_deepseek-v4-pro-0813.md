# Round 40 audit

I read the current tree from first principles and independently checked the round-39 repairs. I did not re-run the validator or the 895-assertion suite; the program claims below are source-reads, with the round-39 `VALIDATION.md` measurements treated as evidence to verify, not authority.

## R0. Round 39 verdict and repairs

Both round-39 confirmed findings are repaired at the shapes I read:

- **V39-1** — the promised-stray drop at the press is closed in this tree: `freshPlan` in `web/src/pages/redeem.mjs` passes `final.known` into `readRedemptionSnapshot`, `reads.mjs:vaulWalletAccounts` re-reads those addresses by address together with the reserve ATAs, and `plan-redeem.mjs` turns a missing `known` account into a `lost:<address>` box, which `aboutKnown` exposes before a dry run. A listing failure alone no longer ships a silent drop.
- **V39-2** — a nested CBOB vault no longer pushes `refuse`. In `plan-redeem.mjs`, `n.ourVault` produces at most an optional rescue group or `pressInfo`, and the coverage cross-check names the address before judging. The final press path can proceed with the host opening and the inner vault rescued afterwards.

No surviving form of either old finding presented itself.

## R1 / R1s. Custody and the sweep helper

I did not find a path that lets anyone but the asset owner approve `ExecuteV1`, nor one that lets a thawed vault survive unburned.

The pairing remains fail-closed at the source level:

- SEAL requires a later top-level `burn_vault` for the same asset and owner.
- BURN requires an earlier top-level `open_for_redemption` for the same asset and owner.
- `retire_redeemed` is reachable only from BURN’s `burn_vault` because MINT checks both stack height and the instruction sysvar discriminator.

The sweep helper’s access control is still Core `ExecuteV1` for the asset owner. Its direct invocation requires the signer to be the account whose holdings move; through Core, the asset-signer PDA is the signer only when Core approves the owner.

The helper reads live balances and closes what it empties; BURN’s `lamports == 0` check sees exactly what the helper left. The accepted limitations around stray classic accounts with a foreign close authority and Token-2022 accounts are still the page/operator surface described in SPEC; I found no new program-side bypass.

## R2 / R2b. Pool, activation, joins, boosts

The accumulator arithmetic, activation requests, join gate, and boost schedule read as the SPEC describes.

The important invariants I checked:

- `credit` never credits more than `avail` in scaled terms.
- `claim` normalises each vault’s debt after paying a whole-sat floor, carrying the sub-sat residue.
- `pending_count` / `pending_this_epoch` are decremented correctly for both current-epoch and earlier-epoch retirements.
- A boost is scheduled into `boost_expiring[end % BOOST_RING]`, becomes due at `dist_epoch >= boost_end_epoch`, and `BoostsExpireFirst` blocks further distributions until `expire_boost` or a `claim` clears it.
- `reweigh` preserves existing owed value in `carry_scaled` and moves `total_active_weight` by the weight difference exactly.

No ordering I traced lets a distribution skip a due boost, pay a boost past its N distributions, or corrupt the ring counters at the u64/u32 ranges this system can actually reach.

## R3. Level draw

The SlotHashes parser is defensively bounded and pinned to the sysvar address. FIFO is enforced by `revealed_total`. A burned head still consumes its draw, so the queue does not stall. The C-leader selection residual remains exactly the accepted limit in SPEC 26: it is selection among draws for that cohort, not a stronger or new property.

## R4. Governance

The minority-carry and money-reach checks hold in source:

- Electorate is fixed at `index_snapshot` and `quorum_supply`.
- YES must clear quorum, threshold, 10% turnout, and for key changes half of the live snapshot.
- Guardian and operator changes cannot share a proposal.
- Overtaken actions are logged skips, not reverts.
- `tighten_sweep` is monotone and bound.

I did not find a frozen-governance mechanism beyond the documented turnout/guardian case.

## R5. Charter claim

The Proof of Burn is pinned by address against a domain-separated Merkle root, owned by the signer, in the pinned collection, and CPI-burned in the same instruction. `pob_extra` accounts pass through never as signers. The one-time window is clock-only and not gated by sales stop, matching the ruling.

SPEC 46 remains the complete stated exposure: the hot collection update authority can gate or capture the charter cohort through external plugins. I did not find a new PoB bypass.

## R6. Configuration and trusted hop

The one-time configs are init PDAs gated by `INIT_AUTHORITY`. The launch checker, not the programs, enforces the ruled exact values for the periods, quorum, threshold, sweep cap, cooldown and reserve; this is still OPEN item 38, not quietly accepted.

The swap operator remains the one trusted key, bounded by on-chain cap / cooldown / reserve and stoppable by the guardian. `sweep_sol_for_swap` requires that operator as signer and refuses amount zero, above cap, too soon, or reserve breach.

The redemption cap is the rolling 64-slot ring: `cap = max(1, ceil(live * 210 / 10000))`, the k-th most recent timestamp is tested, and the ring is overwritten oldest-first. That is exactly the stated rate limit, not a once-per-window counter.

## R7. Cross-program raw reads

I recomputed the offsets for `MintConfig`, `VaultRecord`, `BurnConfig`, and SEAL’s `Config` from the Rust struct definitions. The pinned offsets used by BURN and GOV match: `minted_total` 141, `bare_burns_retired` 454, `burned_total` 42, `VaultRecord.mint_index` 41, SEAL reserves 41. The sweep helper’s classic token-account reads are at the correct classic offsets: mint 0, owner 32, amount 64, length 165.

## R8. The suite, floors, and build evidence

I did not re-execute the full suite. The structure of the floors is no longer a mere threshold: `run-tests.sh` requires each count to equal its floor. `build-mainnet.sh` demonstrates the sweep helper’s shipped bytes equality claims by construction, and the four initializing programs’ authority key by behavior. This remains the correct evidence shape.

---

## Findings

### LOW — a discharged-limit sentence in SPEC is now false about the redeem page

- **Exact construct:** `SPEC.md`, DISCHARGED item **2**, “A coverage refusal had no override,” which says:
  > “**Gone:** nothing refuses a redemption off chain any more.”
- **What an attacker/accident gains:** No value loss. But the statement is measurably contradicted by the current client, and previous rounds spent effort making this exact wording true. A reader relying on it could believe the redeem page never refuses, or that all client-side refusals were deleted with the Bank.
- **Evidence that would exist if the claim were true:** `web/src/lib/plan-redeem.mjs` would contain no `refuse.push(...)` arms. It does. Current refusals include: non-owner (`plan-redeem.mjs`), vault retired/missing/foreign, reserve-account problems, an opening that does not fit, and the coverage cross-check finding something the page did not name. These are not the old Bank-side airdrop refusal, but “nothing refuses a redemption off chain any more” is broader than what remains.
- **Evidence if I am right on measurement:** `grep -n "refuse.push" web/src/lib/plan-redeem.mjs` shows the surviving refusal sites; comparing that against SPEC item 2 shows the stale sentence.
- **Fix:** Reword DISCHARGED item 2 to the narrower truth, e.g.: “The v5 Bank-side coverage refusal is gone; the redeem page does not refuse an opening because of an undeclared airdrop, but it still refuses for non-owner/retired/foreign vaults, reserve-account failures, packet overflow, and an uncovered cross-check item.” This is documentation-only and should qualify under the round-37 ruling.

I confirm **0 CRITICAL, 0 HIGH, 0 MEDIUM** new defects in the five programs or in the current page repair shapes. The single surviving issue above is documentation drift, LOW.

---

## The four accepted-limit questions

1. **Is any limit worse than stated?** No. Limits 27, 28, 41, 46, 47, and the rest read as stated, and the code supports the stated bounds rather than weakening them.
2. **Is anything listed as a limit not actually a limit, or already closed?** Effectively item 2’s discharged wording is stale as documented above. The actual old Bank-side coverage refusal is still removed; the wording is the defect.
3. **Is any DISCHARGED item not actually discharged?** None of the substantive discharges regressed. The Bank, deck, distributor, and co-signer removals remain real. The only issue is item 2’s over-broad text.
4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, and 53 remain OPEN in SPEC and in the launch data. `charter_opens_at`, `lock_deadline`, and `vault_collection` are still `null`/`OPEN` in `launch/mainnet-init.json` and the generated launch copy. The ceremony and checker refuse or treat those as blockers rather than defaults.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Concrete things this project should do before launch that AI audit structurally cannot:

1. **Adversarial differential reimplementation.** Pay a separate engineer or independent model to reimplement MINT’s accumulator, the boost ring, BURN’s rolling window, and the redemption planner in a different language or with different data structures, then fuzz the two against the artifact. AI reads source; it does not prove two arithmetic models agree.
2. **Property-based and failure-injection testing, not only happy-path assertions.** Drive random distributions, claims, freezes, boosts, retirements, and redemptions against the programs, comparing every counter to a model after every step. Property tests should run beyond the fixture that already exists.
3. **Mainnet-shadow observability with real `meta.computeUnitsConsumed` and `meta.innerInstructions`.** The dress rehearsal item 22 is the only live-chain arithmetic proof planned. Add repeated full-crank passes with 2,100 vaults, plus a trunk of redemptions at the exact cap, under load.
4. **A formal model checker for the open/burn pairing and retire-redeemed stack check.** The reason pins in the suite are good, but they do not explore the full transaction-scheduler / CPI state space.
5. **A signed-deploy ceremony whose artifact hashes are recorded at each step and verified by at least two independent parties.** This closes the gap between “the bytes built by X” and “the bytes on chain.”
6. **An independent archive of the audit bundles, verdicts, detached source tarballs, and binaries.** AI audit produces claims about a tree; the tree and binaries must be recoverable and identity-stable after the upgrade authority is removed.

These are the places where an AI-read process remains blindest before immutability.