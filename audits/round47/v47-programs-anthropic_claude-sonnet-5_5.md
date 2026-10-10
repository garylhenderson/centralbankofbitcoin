# Round 47 audit report: five programs, sweep helper, off-chain pipeline and holder pages

I read the whole tree and ran nothing: no validator, no suite, no build. Everything below is source reading, plus recomputing offsets and account sizes by hand. Where I say "verified", I mean I re-derived it from the struct definitions or the code as given. I did not run the 912/912, 1072, 801 or 152 arms. Where a claim turns on `bank/crank.mjs`, `bank/detectors.mjs`, `bank/layout.mjs`, `scripts/check-launch-params.mjs` or `bank/swap.mjs`, I was not given those files and say so.

## Verdict

I found no CRITICAL, HIGH or MEDIUM finding and no defect in the five programs. I found nothing that moves value wrongly or refuses a crack. Six INFO items follow, all in docs, hardening or wording. Every claim that turns on a measurement I did not make is marked unmeasured.

## Findings

**INFO-1: the public README drops the qualifier SPEC attaches to road step 8.**
- The README's road table says "done on mainnet 2026-10-09 to 10-10".
- The SPEC row it is generated from says items 22.1, 22.3, 22.4 and 22.5 PASS and 22.2 was recorded FAIL, because pass 2 caught the real Core upgrade.
- RECORD.md confirms 22.1 is only "PASS at 5 vaults (scale not exercised)".
- SPEC item 22 is still OPEN AND BLOCKING.
- The README is the public front page, so the generator should carry the qualifier. Evidence: the README facts block against the SPEC row.

**INFO-2: stale comment in `web/deploy/rpc-proxy.mjs`.**
- The header says `getProgramAccounts` is served "only in the eight exact filtered shapes".
- `gpaShape` returns five, the comment above it says five, and the README says five.
- No behaviour is affected.

**INFO-3: the page-set compute limit shrinks headroom on the crack.**
- `pageUnits` is 1.1 × the dry-run units plus 20,000. For the measured claim-first crack of 194,694 CU that is about 234k.
- Without a page budget the runtime grants 200k per non-budget instruction, which is 800k for the four-instruction opening.
- The new limit is needed because Phantom's 200k default is too low for this opening. The cost is that a divergence between dry run and landing (a month falling due, so the in-line distribution runs during the claim) now has about 40k of room instead of about 600k.
- The failure mode is a refused transaction and a fee, and a retry re-simulates. I judge the margin adequate but did not measure it.
- A boundary arm (month becomes due between dry run and send) would close it.

**INFO-4: `judgeWalletEdits` allow-lists Lighthouse by program id, not by instruction.**
- The judge's other rules are enough that I could not construct an exploit. They are no new signer, no newly writable account, and the page's instructions byte for byte and contiguous.
- A discriminator allow-list (assert-type instructions only) would remove the question at no cost.
- This is hardening, not a defect.

**INFO-5: unmeasured with real Phantom.**
- The e2e uses a Phantom-like signer.
- Whether a real Phantom leaves a page-set limit and price untouched on the widest opening is stated as unmeasured in the SPEC and README.
- If a wallet version rewrites them, the strict judge refuses to send, and the holder cannot crack through the page until the page changes.
- That fails closed, but it blocks a crack on that route. RECORD.md says three real Phantom openings landed unchanged, but I cannot tell from the materials whether they carried the page's budget.

**INFO-6: limit 28 and the holder guide understate who can cause a vault freeze.** This is the wording issue in Q1 below.

## Targets

**R1 / R1s (custody and sweep helper).**
- I found no way for the pairing to be satisfied without a real burn.
  - SEAL requires a later top-level `burn_vault` for the same asset and owner.
  - BURN requires an earlier `open_for_redemption`, and fails its owner check if the asset changes hands in between.
  - A burn failure reverts the thaw.
- **(a)** The sweep helper has no authority of its own. Its only signer is the asset-signer PDA, so Core's `ExecuteV1` owner rule is the whole gate. I did not re-verify that rule against Core source.
- **(b)**
  - Duplicate sources fail: the second pass finds an account whose owner is no longer the token program.
  - A source also named as destination fails the owner check.
  - A native wSOL source transfers, then closes.
  - A delegate on a source cannot stop the owner's transfer.
  - A close authority held by someone else reverts the whole call (R36.C5).
  - A destination that is not an ATA is accepted if its owner and mint match, which is harmless because the holder chose it.
- **(c)** The destination wallet is chosen by the owner who signs the Execute, so not comparing it to the asset owner is safe.
- **(d)** After the helper, only the owner's own instructions can run before the burn, so BURN's `lamports == 0` check sees what the sweep left.
- **(e)** A closed account reads as System-owned, so BURN's loop skips it for the right reason. A Token-2022 ATA for a classic mint cannot exist (Token-2022 requires a Token-2022 mint).
- **(f), (g)** I did not re-measure packet size or compute.

**R2 / R2b (pool and boost).**
- I re-derived the invariant. `credit` adds at most `avail·SCALE` to owed, so `ceil(owed) ≤ balance` holds after it.
- `claim`, `join`, `reweigh`, `retire` and `expire_boost` each conserve `owed_scaled = Σ owed_of`. After a claim, `owed_of` equals the carry. After a weight change, `debt = weight·acc` and `carry = prior owed`.
- A boost bought at epoch e earns the distributions that move e→e+1 through e+N−1→e+N, then is due. Every credit path (`distribute`, `monthly_inline`, which runs in `claim` and `retire_redeemed`) is gated by `boosts_due`. With N ≤ 63 and a 64-slot ring, no two live end epochs collide.
- Nobody can block distributions: `expire_boosts` and `claim`'s pending-join branch need only records, not token accounts.

**R3.**
- The SlotHashes parse is length-checked, key-pinned, zero-hash-refused and bounded.
- A skipped slot is final once it is below `now`, and the A/B/C window arithmetic fits inside the 300-slot window.
- FIFO and the lapse-reschedule behaviour are as stated in limits 25 and 26.

**R4.**
- I found no path for a minority to carry a key change.
- The electorate is snapshotted at creation, vote records are per asset, and overtaken actions are logged no-ops.

**R5, R6.** Merkle domain separation holds: leaf tag 0x00, node tag 0x01, sorted pairs. `initialize` checks match what the docs state.

**R7.** I recomputed every pinned offset.
- MintConfig: GOV's 631/639/647/711/712/518/526/442/454/257/266/274, BURN's 141/454, and total 1,005 + 256 padding = 1,261.
- VaultRecord: 125…211, with total 221.
- BurnConfig: 42/50/58/59, with total 827. GovConfig 350. SEAL reserve vector at 41.
- Proxy slices: `mint-boosts` (125, 70) and the `waiting` filter at 177, with bs58 '2'/'3'/'6' for 1/2/5.
- The sweep's token offsets 0/32/64 and length 165.
- All consistent.

**R8.**
- The suite runs the localnet build, and the mainnet build is proven to differ only by `INIT_AUTHORITY` by behaviour, not by byte diff.
- The rehearsal ran the shipping build on mainnet at substituted ids.
- Q1 of the closing section recommends a diff that would close this.

## Accepted limits

**Q1: is any limit worse than stated?**
- **Limit 28 and the holder guide.**
  - Both name the pool as the target of tainted cbBTC.
  - Every vault's cbBTC ATA is equally exposed. A token account cannot refuse a deposit, and SEAL only blocks Execute.
  - SR.14 shows a frozen source reverts the helper and the whole opening.
  - The guide says "if Coinbase freezes your vault's cbBTC you cannot open it" but not that a stranger can send the trigger.
  - The practical risk depends on issuer policy for freezing recipients, which I cannot assess.
  - The text should say so.
- **Limit 47** gets structurally worse over time. Replacing a stolen guardian needs 50% of all live vaults, and dormant or lost-key vaults stay in the divisor. A thief's permanent stop becomes easier as holders go dormant.
- Limits 32, 41, 25, 26 and 46 read as stated.

**Q2: anything listed that is not a limit?** No. Limit 59's claim that the griefer cannot spend the funded address holds, since the key is the victim's.

**Q3: any DISCHARGED item not discharged?** I found none. Item 54's holder-page requirement is now carried by the Phantom wrapping paragraph.

**Q4: anything in OPEN AND BLOCKING quietly treated as accepted?** Item 22 is the only candidate, and it is stated openly. Road step 8 is "done" while 22.2 is FAIL and 22.1 is at 5 vaults. The README does not show that (INFO-1).

## Closing section: what AI audit cannot do before launch

1. **Diff the bytes.** I could not do this from the materials.
   - Build the final stripped bytes at real ids and the rehearsal's shipping bytes, then confirm they differ only in the id constants and the `INIT_AUTHORITY` immediates.
   - That proves the bytes that ran on mainnet in the rehearsal and with Phantom are the bytes being locked.
2. **Review `Cargo.lock` by human or tool.** It is excluded from coverage as "not authored behaviour", but in an immutable program the resolved dependency tree is permanent. Run `cargo audit`, `cargo deny` or `cargo vet`, and pin the lockfile hash in the release record.
3. **Add a stateful property test** over the free functions `credit`, `claim`, `join`, `retire`, `reweigh` and `expire_boost`, asserting pool ≥ ceil(owed) and `owed == Σ owed_of`. Only the boost schedule has one today, in the host tests.
4. **Move keys off the box.** The guardian and `INIT_AUTHORITY` should be a hardware-backed wallet, and the $CBOB release wallet and swap-operator key should leave the server.
5. **Run a guardian drill before step 11:** stop, vote to restart, replace. Confirm the real signers can do it.
6. **Have non-technical holders read the redeem page** and the honest list. Whether they understand "tick this box" is not testable by me.
7. **Ramp exposure by vote.** The first sale rounds can be small, so the first deposits are small while any unknown bug is still unknown. After step 11 nothing can be stopped except sales and the sweep.