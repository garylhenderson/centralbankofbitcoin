# Audit findings

I did not run the suite or inspect the unprovided `bank/` implementation in this pass. The findings below are based on the supplied source. Each names a chain-state or transaction test that can falsify it. I found no substantiated way for a non-owner to redeem a sealed vault, leave a thawed vault alive after a failed burn, double-claim the pool, or bypass the governance vote thresholds.

## R1 — Custody

**No new custody finding.** SEAL and BURN compare both the asset and owner in opposite directions against top-level instructions. A failed emptiness proof fails the transaction containing the thaw. The supplied tests exercise mismatched assets, owners, partial sweeps and undeclared holdings; the latter remain the expressly accepted destruction risk, not proof of a custody bypass.

One evidence gap remains: the round-22 verdict recommends a test-only CPI wrapper for `retire_redeemed`’s stack-height rule. None of the supplied suite arms calls BURN through such a wrapper.

## R2 — Community pool

### MEDIUM — Accepted limit 55 has no on-chain *one-hour* bound

**Construct:** `programs/cbob-vault-mint/src/lib.rs`, `activate`, `distribute`, `split_revenue`; SPEC accepted limit 55 and HOLDER-GUIDE’s “about an hour of extra sales.”

The documented attack is real and accepted, but its stated financial bound depends entirely on the hourly crank. Mint proceeds remain in the revenue ATA until somebody calls `split_revenue`; neither a mint nor a distribution forces that split. If splitting stalls while sales continue, **arbitrarily many hours of proceeds** can accumulate there. A funded newcomer can then become eligible, join, split that accumulated balance and share its subsequent distribution. The 200-$GARY cost does not rise with the balance captured. This is worse than calling the at-risk balance “about an hour of sales.”

**Checkable evidence:** On a validator, accumulate several periods of cbBTC in the revenue ATA without calling `split_revenue`. Run the accepted-limit-55 request → eligibility distribution → join → split → distribution sequence. Compare the newcomer’s credited share with the revenue balance that preceded its request. No program check imposes a time or amount ceiling.

**Fix:** Either enforce splitting before the relevant eligibility/distribution transition, or correct the accepted limit and holder copy: *about one hour only while the splitting job is healthy; no on-chain upper bound during a stall*. Alarm escalation limits detection time, not the amount at risk.

## R2b — $CBOB boost

### LOW — Retired records still say they carry a boost

**Construct:** `programs/cbob-vault-mint/src/lib.rs`, `retire` and `unschedule_boost`.

`retire` removes a boosted vault from `boosts_active`, `boost_weight_total` and either the ring or `boosts_due`, but never clears `r.boost_weight` or `r.boost_end_epoch`. Thus the promised agreement between boost records and the global schedule does not hold if “record carrying a boost” includes retired records. This does **not** appear to award another distribution: the record is made inactive and subsequent expiry skips it. It is nevertheless ambiguous permanent state for readers and reconciliation.

**Checkable evidence:** Immediately after suite arms **BO.16** and **BO.17**, read each retired `VaultRecord` at boost-weight offset 186 and boost-end offset 187. They should retain the purchased values while the corresponding global counts have fallen. The suite’s `books()` check skips inactive records, so it cannot catch this disagreement.

**Fix:** After unscheduling in `retire`, clear those two fields, or explicitly represent a historical boost separately from a live boost and make every reader use that distinction.

### MEDIUM, conditional launch trust — A live $CBOB mint authority can manufacture payout weight

**Construct:** MINT `initialize` validates that `cbob_mint` is an initialized classic SPL mint, but does not constrain its mint authority or supply; `boost_vault` then treats burned units as the price of additional pool weight.

If a key can continue minting $CBOB after launch, its holder can create the boost price at will and boost vaults it controls. That does not steal directly from the pool, but diverts a greater share of later distributions from other activated holders. This is **conditional**, not a claim about a mint that has not yet been created: the supplied `launch/mainnet-init.json` still has `cbob_mint: null`. The documents call the swap operator the one trusted money hop without identifying continuing $CBOB issuance as a separate power over payout shares.

**Checkable evidence:** Before initialization, inspect the selected SPL mint’s authority option and supply. In a test, retain its mint authority, enable boost terms by vote, mint the price to a controlled account and boost a controlled vault; observe its weight and share rise without an externally acquired $CBOB balance.

**Fix:** Decide and disclose the token’s issuance trust model before creating it. If boost price is intended to be supply-scarce, pre-issue the intended supply and revoke mint authority before MINT initialization; verify that state in the launch gate. If continuing issuance is intended, state plainly who can issue payout-weight purchasing power and protect that authority accordingly.

## R3–R4 — Draw and governance

**No new finding substantiated.** The supplied code uses captured entropy for a FIFO draw, snapshots voting eligibility by mint index, and applies the half-of-supply YES requirement to both key changes. The accepted last-leader and missed-capture influence remain relevant; I found no basis in the supplied source to relabel them as a new exploit.

## R5 — Charter claim

### LOW — The eight-extra-account claim shape is not supported by the cited packet measurement

**Construct:** MINT `claim_charter_vault` permits `pob_extra <= 8`; `tests/3prog.test.ts` arm **3c.P1** serializes a depth-eight claim with **one** distinct Oracle account and no crank.

That test does not establish that the advertised eight-account pass-through fits the same legacy transaction, particularly with a separate payer and compute-budget instructions. Seven more distinct accounts add roughly seven account keys and seven instruction indices—about 231 bytes—to the measured one-extra shape. A benign hook requiring several distinct accounts could therefore make the current legacy claim shape fail **before Core evaluates the hook**. This is a packet/client finding, not proof that no v0 transaction with an address lookup table could claim.

**Checkable evidence:** Repeat 3c.P1 with eight distinct extras, a depth-eight proof, separate owner/payer and the stated compute-budget instructions; record serialized size or the web3.js size refusal. Then demonstrate a successfully landed v0/lookup-table claim for that shape if eight-account support is promised.

**Fix:** Measure the maximum supported legacy shape, specify when the claim client must use v0/lookup tables, and exercise that client against an approving multi-account hook before the irreversible charter window.

## R6–R7 — Configuration, trusted hop and raw reads

The pinned offsets I recomputed from the supplied field orders agree with the readers: SEAL collection **9**, reserve vector **41**; MINT minted total **141**, bare burns **454**, stop timestamps **518/526**, sweep bounds **631/639/647**, boost bounds **711/712**; BURN burned total **42**; VaultRecord mint index **41**. The declared spaces also add up to **398** bytes for SEAL Config, **1,261** for MintConfig, **221** for VaultRecord, **827** for BurnConfig and **350** for GovConfig. I found no offset or space finding.

The trusted SOL hop remains the accepted cap-times-cooldown exposure. These calculations do not verify the unprovided off-chain launch checker or swap implementation.

## R8 — What the evidence does and does not show

- **BO.16/BO.17 miss the retired-record finding:** `books()` deliberately counts only active records.
- **3c.P1 proves one pass-through account, not eight.** It is not an eight-extra-account client measurement.
- **Simulation S6.11 calls `detectUndeclaredTokenAccounts`, not a built redeem page or `judgeRedemptionCoverage` integrated into one.** The page remains open-and-blocking item 50; that simulation arm must not be cited as proof a holder receives a pre-signature warning.
- The supplied material does not include `bank/crank.mjs`, `bank/alarm.mjs`, `bank/detectors.mjs`, or the round-22 off-chain repair diff. Their 509 assertions and reported fixes cannot be independently re-audited from this bundle. In particular, a detector selftest does not establish the live RPC paging and recovery required by open item 22.

# Accepted-limit review

1. **Worse than stated:** Item **55** has no enforced one-hour balance bound; see the R2 finding. Items **25–26** already state the named-record capture and last-leader/cohort weaknesses, so I am not re-filing them.
2. **Not actually a limit:** I found none that I can discharge from the supplied evidence.
3. **Discharged too broadly:** Item **12/17** says a fitting transaction cannot run out of compute “on this path.” That is true of its measured *plain/padded mint* comparison, not v6’s full-crank host: item **54** and arm **10.6a** explicitly show a fitting mint-plus-four-captures transaction refused under the default 200,000-CU budget. Narrow the discharge’s scope; item 54 supplies the operational rule.
4. **Open items being treated as accepted:** Do not convert **22, 38, 50, 51 or 52** into launch assumptions. In particular, the missing redeem page cannot be replaced by S6.11, and the prospective $CBOB mint must have its authority model checked before its address is pinned. The eight-extra-account claim client also needs a measured transaction shape before relying on the pass-through during the seven-day window.

# Before an immutable launch, without a human audit firm

Complete the named blocking work **before any customer mint**, then make the final rehearsal a release gate rather than a demonstration: run the shipped crank and alarm against a live-cluster-scale throwaway deployment, inject a late-page RPC failure, exercise multi-account charter claims and three-reserve redemptions through the actual holder pages, and verify alerts reach a person who can act. Add executable stateful/property tests that generate interleavings of request, join, distribution, boost, expiry, claim, freeze and both retire paths; compare *all* records and pool balances after every landed transaction, not only selected end states.

Finally, have two operators independently read the four actual on-chain initialization accounts, mint authorities, Core hash, deployed program hashes and upgrade-authority status against a signed launch manifest. Do not remove the upgrade authorities on the strength of a green local suite while the live-scale rehearsal, holder surfaces, charter date or token issuance model is unresolved.