# Audit disposition

**No CRITICAL or HIGH defect in the five on-chain programs is confirmed from the supplied source.** The round-39 repairs V39-1 and V39-2 are present in the current redemption-page code and appear to close the specific paths round 39 measured. This is **not a clean certification**: the holder guide still makes two material claims that do not match the program behavior, and key launch gates remain open.

This audit is limited by the delivered bundle. It does not include current source for `bank/crank.mjs`, `bank/revenue.mjs`, `bank/swap.mjs`, `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/layout.mjs`, `bank/accrual.mjs`, `bank/selftest.mjs`, `scripts/check-launch-params.mjs`, `sim/swap-fork.sh`, or `web/test/*`; nor is the round-39 off-chain verdict included. I therefore cannot independently certify those components, reproduce the claimed off-chain floors, or verify all consumer behavior of the transaction-history reader. I did not run a validator or any of the reported suites.

## Findings, by target

### R0. Round 39 repairs, web pages, holder promises

**V39-1 repair holds in the supplied code.** The redeem page re-reads promised addresses at press time. Although `vaultWalletAccounts` caps those direct reads at `PROMISED_MAX = 100`, `planRedemption` separately turns any promised address absent from the press-time token list into a `cannot` acknowledgement. The page’s `prepareOpening` then stops for that new acknowledgement unless it is already covered by the holder’s consent. Thus, the 100-address cap is a completeness/availability limit, not the silent-drop path round 39 found. If the direct account read fails, the press stops rather than silently proceeding.

**V39-2 repair holds in the supplied code.** A found nested CBOB vault creates an *optional* rescue setup transaction. If that rescue cannot be simulated or confirmed, the page proceeds with the host opening and represents the nested vault as recoverable afterward. The planner does not refuse merely because a nested CBOB vault is present. This is consistent with `rescue_nested` accepting a positively burned host.

#### LOW — Holder guide incorrectly says a bare burn permanently destroys everything inside

**Construct:** `HOLDER-GUIDE.md`, “Things to know before you open”: “Burning the NFT any other way … destroys everything inside it forever.”

**Effect:** A nested CBOB vault is an exception. If its host is burned, anyone can call MINT’s `rescue_nested` with the burned host; the inner vault can be moved to the CBOBTC Squads. A holder reading the guide is told that this recoverable vault is irretrievably lost.

**Evidence if true:** Nest an inner CBOB vault in an outer vault, bare-burn the outer asset through Core, then call `rescue_nested`. The expected chain evidence is a successful rescue event, the inner asset still live and owned by `bank_treasury`, and its MINT record unchanged. The supplied suite’s R35.N5 describes this case.

**Fix:** Qualify the warning: undeclared tokens and ordinary NFTs can be destroyed; a nested CBOB vault can be rescued to the Squads, subject to the rescue’s stated limits and the Squads’ return process.

#### LOW — Holder guide overstates when activation occurs and when rewards begin

**Construct:** `HOLDER-GUIDE.md`, “The four things you ever do,” item 2: “Once it holds at least 21,000 sats … it is activated: it joins the payouts at the next distribution and earns from every one after that.” The adjacent text also says “Activation is picked up automatically.”

**Effect:** A balance alone does not activate a vault. An `activate` instruction must first record a request. The vault is not active then: MINT sets `pending`. A distribution must pass before a later `activate` or `claim` can join it; the vault earns from a subsequent distribution, not the one that made the request eligible. Automation can submit these instructions, but it is an off-chain crank, not an effect of depositing cbBTC. Without a live crank or another caller, no activation occurs.

**Evidence if true:** Fund a revealed vault to the threshold without calling `activate`; its record stays inactive. Call `activate`; verify `pending = true`, `active = false`. Run a distribution; verify it is still excluded from that distribution. Call `activate` or `claim` to join, then verify it first accrues on the following distribution. Existing suite arms named in the bundle include P.4, 3c.A4, 3c.A5 and P.17b.

**Fix:** Say that the holder, another caller, or the crank must submit the activation request; explain that the request is followed by a distribution and a join before the vault begins earning. Do not describe a deposit itself as activation.

These findings misstate holder property/reward behavior, so they do **not** qualify for the documentation-only clean-round exception.

**No page-level value-loss finding is confirmed for the current V39 press flow** from the supplied source. Important remaining client dependencies and publication status are listed below under R8 and the launch blockers.

### R1. Custody, pairing, emptiness, sweep helper

**No confirmed theft or surviving-empty-vault path found.** The top-level instruction-sysvar checks bind asset and owner in both directions; the burn requires the prior open, while the open requires the later burn. CPI wrappers cannot satisfy those top-level checks. The sweep helper’s direct-call gate requires its signer; through Core, the supplied suite evidence is specifically about the pinned Core binary’s owner-only Execute rule, not a general guarantee about future Core versions.

The helper’s pair checks require a classic 165-byte token account owned by the signer and a same-mint destination account owned by the named destination wallet. Repeated source pairs fail when the second attempt reaches a closed source; duplicate destinations are harmless. An odd or zero-pair list is not inherently a hole: odd lists reject, while zero pairs permit the lamports-only path. A native wSOL source can transfer its live amount and then close; frozen balances or a third party’s close authority can make the helper transaction fail, atomically.

The redeem page uses the connected owner as destination, prepares missing destination and reserve ATAs beforehand, and calls the helper between open and burn. BURN then sees the post-close reserve accounts for the reasons its emptiness loop implements: a closed account has no live token balance to check. A stranger-created classic reserve ATA is not an unhandled gap if the prior setup completes; a Token-2022 ATA for a classic mint is refused by the ATA program, as the supplied measurements state. Missing non-reserve or nested holdings remain subject to the already documented limits 9 and 44.

**Packet and compute boundary:** S8.0’s 1,061-byte measurement is for the stated three-reserve redemption with a claim, but without arbitrary extra stray pairs. Adding two compute-budget instructions and a separate payer yields the documented 1,209-byte shape. It is not a ceiling for arbitrary strays. The page’s dynamic planner and dry run matter; the code removes stray transfers until the transaction fits. The supplied tests do not establish a compute upper bound for every possible extra-pair shape. The page sends no crank in a redemption, consistent with the CU constraint.

The current code also retains the documented limitation that the helper does not compare its caller-chosen destination wallet to the NFT owner. In the intended path the page builds the destination as the owner; Core authorization is the gate that prevents a stranger selecting a different destination. No contrary result is established against the pinned binary in the supplied evidence.

### R2. Community pool

**No new accounting invariant violation confirmed.** The visible arithmetic supports the weaker, documented invariant: credit allocates no more scaled value than the undistributed pool amount; claims reduce pool balance by whole sats and reduce `owed_scaled` by the same whole-sat amount; retiring or forfeiting a share reduces liabilities without taking tokens out of the pool. The ceiling reserve protects fractional owed sats from being distributed twice.

`pending_count` and `pending_this_epoch` are updated consistently in the visible request, epoch-advance, join and retirement paths. The known permissionless claim of a positively bare-burned record before retirement can create dead weight or pay to an inaccessible account. That is accepted limit 27, not a new finding; the crank’s mitigation is not an on-chain guarantee.

### R2b. $CBOB boost

**No new boost-counting or weight-accounting defect confirmed.** The visible code carries an existing share across reweighting, removes boosts from the due/ring counters on expiry or retirement, and blocks further distributions while any due boost remains. `expire_boosts` needs records rather than token accounts, so a missing vault token account does not itself prevent expiry. The 64-slot schedule, 63-epoch program bound, and described tests are consistent with exactly N distributions in the normal active-vault flow.

The validation described in the bundle is not equivalent to exercising every production-scale lifecycle: `tests/expiry-budget.mjs` uses synthetic layout/PDA genesis state for its 20-record CU check. That limitation is disclosed; it does not, by itself, establish a surviving accounting defect.

### R3. Level draw

**No defect worse than accepted limit 25 or 26 confirmed.** The parser checks the SlotHashes key, count and buffer size; chooses the smallest produced slot in the allowed window; and the draw processes the mint FIFO against the remaining census. The minter can compute the outcome from public hashes, withhold a capture, and—if nobody captures within the window—obtain a reschedule. C’s leader can grind its block after seeing A and B. Those are material weaknesses in fairness, but they are already disclosed and the holder guide does not promise a non-grindable VRF.

The host tests model skipped slots; the local validator does not reproduce real skipped-slot or leader behavior. That is an evidence limit, not grounds to claim the accepted leader-grinding risk is smaller than documented.

### R4. Governance

**No minority bypass or action reaching vault funds confirmed.** Proposal creation snapshots live supply and mint index; each asset has one vote record per proposal; guardian/operator actions require the stated half-of-snapshot YES threshold; and superseded actions are skipped/logged rather than reverting their whole bundle. The ordinary-vote concentration, possible permanent guardian stop at low participation, and per-kind ordering are disclosed limits/design consequences.

### R5. Charter claim and Proof of Burn collection authority

**No additional direct asset-theft capability confirmed from the supplied source.** The code checks PoB ownership and collection, verifies the address Merkle proof, and CPI-burns the PoB in the claim instruction. The pass-through accounts are non-signers and bounded at eight. The guide’s and SPEC’s major risk remains accurate: the Moments collection update authority can gate or selectively admit claims during the charter window, while the claim page refuses external-plugin cases it cannot safely construct. The disclosed per-asset monitoring blind spot and sampling gap remain real.

I cannot certify that this is a complete statement of all Core-side powers: the relevant Core source and the full off-chain alarm source were not supplied. The round-39 material itself records that its source reading was not proven byte-identical to the deployed Core binary.

### R6. One-time configuration and trusted hop

**This is a launch gate, not a new post-launch exploit finding.** The program checks are materially weaker than “all ruled values”:

| Program | What the visible initializer enforces | Wrong values it can still accept and permanently lock in |
|---|---|---|
| **SEAL** | 1–3 reserve entries; each supplied account must be owned by classic SPL Token; INIT_AUTHORITY required. | It does not verify that each account is an initialized mint, reject duplicates, or validate the collection account. A wrong or duplicate reserve list can omit a protected asset from BURN’s required reserve checks. |
| **MINT** | Nonzero supply; positive level caps whose sum is at most supply; sweep and boost bounds; valid future charter interval of at most 90 days; monthly and notice bounds; clean collection controlled by MINT; SEAL collection agreement and payment-mint membership. | It does not enforce the exact 2,100 supply, exact census, seven-day charter interval, 30-day month, seven-day notice, exact guardian/operator, exact mints/root, or the ruled sweep parameters. It does not validate the payment mint account at initialization because that account is not passed there. |
| **BURN** | SEAL collection agreement; redemption window 10 seconds to 24 hours; INIT_AUTHORITY. | It accepts any in-range window, not necessarily 3,600 seconds. |
| **GOV** | MINT collection agreement; quorum 5–100%; threshold above 50% and at most 75%; voting period 60 seconds to 30 days. | It accepts values other than the ruled 21% / 51% / three days. |
| **SWEEP** | No initializer or configuration. | Its behavior still depends on Core’s Execute authorization and Token/SPL semantics. |

The specified checker and ceremony are supposed to close the gap, but their source is absent from this bundle. The launch JSON still has `charter_opens_at`, `lock_deadline` and `vault_collection` OPEN. Do not initialize or remove upgrade authorities until those values are ruled and the ceremony’s exact transaction inputs and resulting accounts are independently verified.

The swap operator’s on-chain bound is **amount per cooldown**, not a lifetime cap. It can take up to the configured cap for each elapsed cooldown window, constrained by the revenue PDA’s balance above reserve, until the guardian stops it. The swap/oracle/RPC trust boundary is already stated; I cannot independently review current `bank/swap.mjs` or `bank/revenue.mjs` because neither is supplied.

Royalties are immutable under the pinned Core behavior when the plugin authority is `None`; this is still conditional on the third-party Core program and its upgrade authority.

### R7. Cross-program reads and account sizes

The visible offsets recompute consistently from the structs:

- SEAL: discriminator 0–7; version 8; collection 9–40; reserve vector length at 41; entries at 45; bump after the entries.
- MINT: governance 41; pool 73; minted total 141; stop flags 191/192; reserve/cap/cooldown fields 257/266/274; charter close 442; bare-retired 454; stop timestamps 518/526; bounds 631/639/647; boost ceilings 711/712.
- VaultRecord: version 8; asset 9–40; mint index 41–48; active 125; retired 126; pending 177; boost weight 186; boost end 187; carry 195 onward.
- BURN: burned total 42; redemption window 50; ring head 58; ring 59 onward. The 64 timestamps occupy 512 bytes.
- The helper’s classic SPL layout—mint 0, owner 32, amount 64, length 165—matches the token-account layout used by the supplied code.

The resulting spaces are consistent with the visible declarations: SEAL 398 bytes, MINT 1,261, VaultRecord 221, BURN 827, GOV config 350, Proposal 259 maximum allocated bytes, VoteRecord 74. I cannot independently compare the off-chain `bank/layout.mjs` field table against these structs because that file was not supplied.

### R8. Tests, simulation and build evidence

The supplied on-chain suite source contains meaningful positive and negative paths for pairing, wrapper calls, pool arithmetic, governance, boosts and the helper. Its named `because()` checks distinguish many refusals from the wrong reason. The supplied `sim/test-vault.ts` builds a real-Core/local-validator redemption through the helper and measures the stated transaction shape.

The supplied material does **not** let me independently establish all of the claimed evidence:

- `web/test/*` is absent, so I cannot inspect the current 642-page assertion bodies, their floors, or the claimed end-to-end exercise of V39 repairs.
- Current crank, alarm, detector, revenue and swap source is absent, as is the full round-39 off-chain verdict. The reported selftest counts and repair-validation record are not substitutes for source-level review.
- The current mainnet deployment remains an inert placeholder according to the supplied launch record. `build-mainnet.sh` documents how artifacts are built and checks the helper’s localnet/mainnet/target-deploy equality, but the actual release artifacts and a fresh build record are not provided here. The four feature-dependent binaries also are not the same bytes as the localnet suite; the behavioral key probe plus source/reproducibility bridge is the stated assurance.
- S8.0’s legacy byte measurement is not a measurement of every stray-token shape or every future transaction format. The stated transaction-format boundary correctly excludes a v1 client.
- The evidence provided does not close open item 22’s full live crank, alarm and revenue-cycle rehearsal, or item 53’s rehearsal values and rehearsal-mode checker.

## Accepted-limits carry list

1. **Worse than stated?** The main newly examined page defects from round 39 appear repaired. I found no new path allowing a stranger to take a live vault’s reserve assets through the supplied programs. The existing loss of unenumerated non-reserve holdings remains as stated. V39-1’s fix still relies on a client-side re-plan and acknowledgements; it is not on-chain protection. V39-2’s fix routes nested vaults through the Squads and a human return, not directly to their sender.

2. **Not actually a limit?** The three-reserve cap is a real legacy-transaction/client constraint, although v0 can fit more operations in other shapes; the protocol is fixed at three reserves. Item 42 is a required client contract, not a universal Solana impossibility. The staged page implements the prior-account setup in the supplied source, but it is not yet published. The descriptions of items 9, 44, 46, 47 and 58 are broadly consistent with the code and stated measurements.

3. **Discharged but not actually discharged?** I found no source-level contradiction for the visible discharged items. The boost expiry-budget test is synthetic by design; it is not evidence of 20 complete lifecycles. The broader boost lifecycle has separate tests described in the bundle. I cannot independently verify the web/off-chain test evidence because those files are missing.

4. **Open blockers quietly accepted?** No: items 22, 38, 50 and 53 remain explicitly OPEN AND BLOCKING. Item 52’s required pre-split accounts and revenue rent are also launch prerequisites. The open launch JSON values are still present. None should be relabeled “accepted.”

## Before launch: actions AI audit cannot supply

1. **Do not initialize or lock yet.** Rule the charter opening date, lock deadline and vault collection. Run the exact launch checker against the final JSON and verify the transactions actually signed are byte-for-byte built from those values.
2. **Complete and record the full rehearsal required by item 22:** live crank passes, live alarm passes in isolated rehearsal state, one revenue cycle on each venue, forced Orca refusal and Meteora fallback, and a post-sweep failure recovered by hand. Record signatures, balances and a clean `--audit`.
3. **Run the actual current holder-page end-to-end suite** against the rehearsal deployment, including the V39 promised-account cases and nested-vault case. The current web test sources and results must be available to the auditor; a floor count alone is insufficient.
4. **Have a person independently verify the launch transaction and final accounts** using a separate RPC/provider and the hardware-wallet display: program IDs, program bytes, all five upgrade authorities, every initialized config field, collection authority/plugins, reserve mints, pool/revenue/Squads ATAs, and revenue rent. An AI reading JSON cannot establish what the wallet actually signed or what the independent RPC actually returned.
5. **Exercise operations, not just code:** alert delivery and recovery, cron posture, backup restore, key isolation for the Moments authority, swap operator and $CBOB release wallet, and the manual return process for rescued vaults.
6. **Keep upgrade authorities until those checks pass.** Then verify the deployed bytes again and make all five programs immutable only after the redemption page and required monitoring are live.