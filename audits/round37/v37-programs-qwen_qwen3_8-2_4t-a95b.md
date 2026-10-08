

# Round 37 — independent audit of the v6 tree (programs + web)

Scope note up front: this pass's bundle contains the five programs, the suite/sim/build evidence, and `web/`. It does **not** contain `bank/layout.mjs`, `bank/detectors.mjs`, `bank/crank.mjs`, `bank/revenue.mjs`, `bank/swap.mjs`, `bank/alarm.mjs`, `bank/selftest.mjs`, `bank/accrual.mjs`, or `scripts/check-launch-params.mjs`, even though `web/src/lib/reads.mjs`, `web/src/lib/plan-redeem.mjs`, `web/src/pages/ceremony.mjs` and `web/meta/generate.mjs` import three of them. Those belong to the off-chain pass. Where my conclusion rests on one of them I say so explicitly instead of asserting it.

---

## R0 — Round 36's verdict and its repairs

I re-read every confirmed round-36 item against the current source rather than trusting VALIDATION.md.

**H1 (stranger freezes the holder's destination for a junk mint).** Repair is present and correctly shaped. `readRedemptionSnapshot` now reads `ownerAtaFrozen` and `mintFreeze` (`web/src/lib/reads.mjs`), and `planRedemption`'s `undeliverable()` (`web/src/lib/plan-redeem.mjs`) moves a stray to the acknowledge list when its mint has a freeze authority (unless it is a reserve), when its destination is frozen, or when its mint is unreadable. The reserve path still refuses when the holder's own reserve destination is frozen, and reserves bypass the freezable-mint test via `reservesSet.has(m)`, which is correct because cbBTC's freeze authority is Coinbase (not a stranger) and $GARY/$GIRAFFISH have none (probe-mainnet-facts). I looked for the same "destination state never read" shape elsewhere: the sweep helper itself still does not read destination state, but that is the owner's own choice inside an atomic redemption and a frozen destination there only reverts the owner's own transaction — not a stranger-blockable path for the reserves. No regression found.

**L1 (proxy relays non-CBOB transactions).** `txRefusal` (`web/deploy/rpc-proxy.mjs`) now requires at least one CBOB program, or exactly one of: ATA-create-only, the ceremony collection create (Core disc 21 with `MINT_AUTH` as update authority), or System transfers whose second account is the revenue PDA. I checked the three exempt shapes cannot move someone else's value: all are signed by the sender, who pays their own lamports/rent; the revenue transfer is a donation to a PDA nobody holds a key for. No relay for a plain SOL or token transfer between strangers. Consistent with `proxy.test.mjs` L1 arms.

**L2 ("Run a payout" cannot clear a due boost).** `planPayout` now prepends `expire_boosts` batches (20/call) and join batches (14/call) before the `distribute`, and refuses if the counts it found differ from `boosts_due` / waiting. This matches MINT's `BoostsExpireFirst` and `JoinWaitingFirst`. The e2e gate-5 item 3 exercises a real due boost.

**L3/I2 (SPEC text), L4 (release-commit binding), L5/I1 (ceremony reference and step-9 wording).** Present. `web/build.mjs` refuses unless `dist/MANIFEST.txt` names `RELEASE_COMMIT` clean and `dist/SHA256SUMS` equals the pins in `config.js`; `config.js` pins MINT `0d91662a…` (the round-35 build that contains `rescue_nested`), not the pre-rescue hash. The ceremony footer points at the committed README hash table, and `bundle.test.mjs` checks that table against a fresh build of both profiles.

I did not re-file any round-36 claim. I found no surviving round-36 defect in the code I can see.

---

## Findings

### F1 — LOW — The holder guide and DESIGN state the $CBOB boost price "helped put bitcoin in the pool"; the program burns it and adds nothing to the pool

**Construct.** `HOLDER-GUIDE.md`, "Boosting your vault with $CBOB": *"Part of what you are bidding for is bitcoin your own purchase helped put there."* `DESIGN-v6.md` §3, "What a boost does NOT do": *"A burner is partly bidding for bitcoin their own purchase helped put in the pool."* The code is `programs/cbob-vault-mint/src/lib.rs`, `boost_vault`.

**What is actually true.** `boost_vault` performs exactly one token CPI: an SPL `Burn` (`IX_SPL_BURN = 8`) of `boost_price` base units of the pinned `cbob_mint` from the burner's own account. There is no `Transfer`/`TransferChecked` to `pool_ata`, to the revenue PDA, or anywhere else on that path; `cbob_burned_total` is an informational counter only. The pool is funded solely by `split_revenue` (85% of sales and royalties). So a boost reduces $CBOB supply and increases the booster's share of the *existing* pool; it contributes no bitcoin. The natural reading of "your own purchase helped put [bitcoin] there" — in the section about buying/burning $CBOB — is false of the boost purchase. A holder could boost believing they are growing the pot for everyone, when the effect is to take a larger slice of a pot they did not add to (diluting every other active vault).

**Why I am not dismissing it as a ruling.** The prompt directs me to report where HOLDER-GUIDE states something the code does not do. This is a factual claim about where money goes, contradicted by the program. It is mitigated (not cured) by the adjacent correct sentence "a payout is only as large as the sales and royalties behind it," and by limit 51's disclosure. I note the phrase is defensible only under a strained reading where "your own purchase" means the original vault purchase; in context a reader will take it to mean the boost.

**Evidence that would exist if I am right.** A test that reads the pool balance before and after `boost_vault` would show it unchanged while the $CBOB supply falls by exactly `boost_price`. The suite's BO.7a already proves the supply fall; nothing asserts the pool is untouched because the code makes that self-evident (no credit instruction exists). Grepping `boost_vault` for any CPI into `pool_ata` returns none.

**Fix.** Reword both documents to: "The $CBOB you burn is destroyed; it does not add to the pool. A boost buys a larger share of the next N payouts, and those payouts are only as large as the sales and royalties already behind them." Same commit rule as the rest of the guide.

### F2 — INFO — This pass cannot verify three modules the pages bundle and rely on

**Construct.** `web/src/lib/reads.mjs` imports `decode` from `bank/layout.mjs`; `web/src/lib/plan-redeem.mjs` imports `judgeRedemptionCoverage` and `classifyPdaTokenAccount` from `bank/detectors.mjs`; `web/src/pages/ceremony.mjs` imports `judgeLaunch` from `scripts/check-launch-params.mjs`. None of those files is in this pass's bundle.

**What it means.** The redeem page's final cross-check ("anything the coverage check finds that the page has not named is a refusal") and the ceremony's launch gate are only as sound as those unseen modules. `web/test/bundle.test.mjs` proves the *bundled copy equals the node copy* and that `judgeLaunch` refuses/passes in lock-step, which is real evidence, but it is not an independent read of the module logic in this pass. I am not filing this as a defect against the programs; I am stating a measurement boundary so the off-chain pass's verdict on those three modules is not silently assumed here. If the off-chain pass has not independently confirmed `judgeRedemptionCoverage`'s completeness against every stray class the redeem page now acknowledges (Token-2022, frozen, freezable-mint, cNFT, unreadable), that confirmation should exist before item 50 closes.

---

## R1 — Custody: I found no path for a non-owner to extract value from a sealed vault, and no path for an emptied vault to survive

- The seal is the only thaw. `set_frozen` is the single caller of Core `UpdatePluginV1` for `PermanentFreezeExecute`, and it is only reached from `open_for_redemption`, which requires a matching top-level `burn_vault` (same asset **and** owner) later in the same transaction. BURN symmetrically requires a matching top-level `open_for_redemption` earlier. Both walks use `load_instruction_at_checked` (top-level only), so a CPI-buried half cannot satisfy either side; the suite's WR.1–WR.4 prove the wrapper attacks fail closed and the vault stays sealed.
- A thawed vault cannot leave the transaction unburned: if the burn fails, the whole transaction reverts, including the Core thaw. There is no re-seal instruction and no second thaw path.
- The emptiness proof: PDA lamports == 0; every reserve ATA under both token programs declared; declared token accounts checked for PDA ownership, no delegate, no close authority, exactly 165 bytes (no Token-2022 extensions), amount == 0; no declared live Core asset. The sweep helper closes what it empties, and a closed account is skipped by BURN because its owner is no longer a token program — suite 3.3/3.3a pin both the open-with-delegate refusal and the closed-with-delegate pass.
- I re-derived all four cross-program raw-offset sets (MINT config v6, VaultRecord v4, BurnConfig v4, SEAL config v2) field by field from the struct definitions; every offset GOV and BURN pin (`141`, `454`, `191/192`, `518/526`, `631/639/647`, `711/712`, record `41`, burn `42`) matches a packed Borsh layout with no alignment padding. The suite's 3.1*/X.* arms and the web `ids`/`decode` tests cross-check the same numbers.

## R1s — Sweep helper

I could not break (a)–(g). Access control is Core `ExecuteV1`'s owner rule on a thawed vault (SR.5/SR.5a/SR.5c measure stranger, transfer-delegate and collection-update-authority refusals; the collection authority is an off-curve PDA nobody can sign for). The pair list refuses duplicate sources (second read hits a closed account), mismatched mints, foreign owners, odd counts, wrong program ids, and self-destination. Destination choice is safe because only the owner can invoke it and the page always names the connected owner. The lamport sweep reads `signer.lamports()` at execution and empties to zero; nothing can credit the PDA between sweep and burn inside one atomic transaction. It fits (S8.0 reserves room for compute-budget + separate payer). The one behavioural note is that it cannot close an account whose close authority a stranger kept — that is the documented C5 rule, handled by the page with a plain `Transfer` and an undeclared empty account, and pinned by R36.C5.

## R2 / R2b — Pool and boost

I traced the invariant `pool balance >= ceil(owed_scaled / ACC_SCALE)` through `credit`, `claim`, `join`, `retire` (both forfeit and non-forfeit), `reweigh` and `expire_boost`. `credit` floors `delta`, so `owed_scaled` grows by at most `avail * ACC_SCALE` and the ceiling never overtakes the unchanged balance; `claim` subtracts exactly `pay * ACC_SCALE` from `owed_scaled` while moving exactly `pay` tokens; the forfeit path subtracts the pending share without moving tokens, leaving the forfeited sats in the pool. `reweigh` moves owed into `carry` and resets `debt` at the new weight without touching `owed_scaled`, so a weight change neither creates nor destroys value. The counters (`pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight`) are adjusted symmetrically on join, retire-of-pending (with the same-epoch test), and boost/expire. I found no ordering of the host instructions that leaves them inconsistent, and no liveness lock: `JoinWaitingFirst` and `BoostsExpireFirst` are always clearable by permissionless `claim`/`expire_boosts`/`retire_burned`.

The boost ring: with `max_boost_epochs <= 63 = BOOST_RING - 1`, a live boost's end-epoch slot cannot be zeroed by `advance_epoch` between purchase and processing, because the only earlier epochs sharing that residue are `< purchase epoch`. The host tests wrap the ring four times and the on-chain BO.34/BO.38 arms exercise a wrapped purchase and a wrapped early retirement. A boost earns exactly N distributions (BO.21/BO.35 pin both `[boost, distribute]` and `[distribute, boost]` orderings).

## R3 — Level draw

`blockhash_in_window` parses the sysvar defensively (bounded count, length check, refuses an all-zero hash) and takes the smallest produced slot in `[want, want+64]`; `try_capture` chains A→B→C two leader-groups apart and fails closed (`NotYet`) if any is absent. The FIFO (`revealed_total`) cannot stall at a burned vault (reveal skips the Core write but still draws and advances). Reschedule moves to a future slot and is logged/alarmed. The residual influence is exactly limit 26 as stated; I did not find it worse — A's and B's leaders cannot evaluate the draw without hC, so their skip-power is a blind re-roll, and only C's leader selects.

## R4 — Governance

Electorate and tally rule are snapshotted at creation; `VaultTooNew` blocks mid-vote mints; quorum/threshold/turnout/key-change ceilings all use the snapshot divisor with ceiling division and a non-zero floor. A guardian or swap-operator change needs YES from half of all live vaults at creation, cannot share a proposal, and lands only after notice via a permissionless apply the guardian cannot cancel (but can cancel a pending *operator*). Overtaken actions are logged skips, never reverts, and `tighten_sweep` is monotone and bounded by the `initialize` floors/ceilings. I found no minority path that carries a key change or reaches the split/destinations/max_supply (those have no instruction). Limit 47 (stolen guardian → permanent stop at low turnout) is real and as stated; it is not worse, because the guardian has no power over money or its own replacement.

## R5 — Charter claim

Identity is by address against the 240-leaf Merkle root (domain-separated, sorted, odd-node promoted); the PoB is CPI-burned as its owner in the same instruction, inside a window fixed at init that cannot reopen, not gated by the guardian. `pob_extra` pass-through accounts are never signers. The hot Moments update-authority exposure is exactly limit 46 as written; I confirmed the positive bound (that key cannot transfer or burn an individual PoB) is measured by R32.A22a/b.

## R6 — One-time configuration and the trusted hop

Each `initialize` is gated by the compile-time `INIT_AUTHORITY`, refuses re-initialisation, and cross-checks sibling wiring (SEAL→collection, MINT→SEAL+payment-mint-is-reserve, BURN→SEAL, GOV→MINT). MINT refuses a dirty/foreign/already-minted collection, a default treasury, a non-reserve payment mint, out-of-bound sweep/notice/monthly/boost values, and an already-closed charter window. The royalty is installed with `PluginAuthority::None` (R.1–R.6c prove it is immutable even to the update authority, and R33.G3 proves it cannot be re-delegated). The redemption cap is a true rolling window over a 64-slot timestamp ring; I verified the cap arithmetic (`ceil(live*210/10000)`, floor 1) and that at max supply 2,100 the cap is 45 < 64, so the ring never loosens the intended limit. The swap operator is bounded by cap × cooldown × reserve, can only be tightened by vote inside fixed bounds, must sign, and is stoppable/cancellable by the guardian.

## R7 — Cross-program raw reads

Recomputed above (R1). All pinned discriminators match `sha256("global:…")`/`sha256("account:…")` derivations asserted in the suite (3.1a–3.1u) and regenerated for the pages by `web/gen-errors.mjs`. All offsets and account spaces match the struct layouts.

## R8 — Suite, simulation, build as evidence

The suite pins negative reasons via `because(...)` (a reject for the wrong reason fails), floors must EQUAL counts in `run-tests.sh`, and `build-mainnet.sh` proves which key each of the four keyed programs carries by deploying both builds and asking each, plus byte-comparing the keyless sweep helper between `dist/`, `target/deploy/` and the localnet release. I did not run these myself this pass (no validator); my negative statements about program behaviour rest on reading the code plus the recorded 895/518/103/920 results in VALIDATION.md. I found no arm whose negative fires for a reason other than the one named among those I inspected, and no claim in the prompt that is obviously unexercised, except the two noted under "measurement limits" below.

---

## The four questions on the accepted limits

1. **Is any limit worse than stated?** I found none materially worse. I specifically re-checked 26 (C-leader grinding — the A/B leaders are blind, so it is not wider than stated), 28 (frozen pool — the forfeit path really does keep redemptions landing), 32 (ring never loosens below max supply), 40 (the sweep helper's access control is exactly Core's Execute rule; not wider), 41, 43, 46, 47. Each reads accurately against the code.
2. **Is anything listed as a limit not actually a limit?** No. Limit 44 (undeclared airdrops destroyed) and 9 (foreign nested asset) remain real: the page acknowledges rather than refuses, and on-chain enumeration is still impossible. Limit 55 (unsplit revenue share) remains real and bounded by the crank's per-pass split.
3. **Is any DISCHARGED item not actually discharged?** No. I verified 14 (`DuplicateAttribute` present in both mint paths), 19 (activate requires a drawn level; no off-chain allocator exists), 30/31 (no `update_wiring`, period is an init value), 33 (apply exercised in 3c.K5/3c.G2), 51/54 (boost built; compute measured). The v5 Bank/co-signer/deck/distributor items are gone with those components.
4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are still open and the tree is scope-frozen. `launch/mainnet-init.json` still carries `charter_opens_at`, `lock_deadline` and `vault_collection` as OPEN, so `judgeLaunch` (and the ceremony) refuse today — which is the correct, fail-closed state. The holder guide remains DRAFT and item 50 remains a precondition of publishing it.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what must be done before launch that AI audit structurally cannot

1. **Execute and record the mainnet dress rehearsal (item 22) with real signatures.** AI can specify it; only a live run at throwaway ids produces the named evidence: crank passes at ~2,100 vaults, alarm passes in rehearsal mode, one full revenue cycle through *each* pool, and one forced post-sweep failure walked through hand recovery. Until those transaction signatures exist, the off-chain pipeline is unproven against a live cluster.
2. **Physically secure the four hot secrets and prove custody.** The swap-operator key, the $CBOB release wallet, the guardian/INIT_AUTHORITY wallet, and the deploy upgrade-authority key live on one box and its backups. No audit can attest to their generation environment, file permissions over time, or backup encryption. Move the ones Gary can move (limit 56 suggests the release wallet), and write down who holds each and the recovery path if the box dies before step 11.
3. **Guard the Giraffish Moments hot key through the 7-day charter window.** Limit 46 is a time-boxed, people-and-process risk (end the project or capture governance). The only real mitigation is custody of that key during the window — cold or multisig — which is an operational act, not a code property.
4. **Do the real-wallet and real-multisig checks the suite cannot.** (a) Sign each page's transaction with a real Phantom (desktop and mobile in-app browser) to settle U1 — whether Phantom ever appends/reorders instructions, which `signExact` would then refuse. (b) Run one real Squads v4 return of a rescued vault (U2) to confirm the "returns it to whoever sent it in" promise is operationally true.
5. **Perform and verify the actual deployment sequence by hand.** Steps 9–11 (extend/upgrade over the placeholders, dump-and-check prefix-hash + zero tail, create the collection, run the four initializes with the ruled values, create the three cbBTC accounts, fund revenue, then remove all five upgrade authorities) must be executed once against mainnet and each dump re-verified. An AI can rehearse the ceremony logic but cannot be the signer, and the upgrade-authority removal is irreversible — it deserves a human four-eyes check on each `set-upgrade-authority --final` and a final dump comparison.
6. **Decide the two OPEN launch values and publish the surfaces.** `charter_opens_at` and `lock_deadline` are Gary's; `vault_collection` only exists after step 10. Until those are set, `judgeLaunch` refuses and nothing can mint. The holder pages and the holder guide must be published together (item 50 gates the guide), and the redemption-poster needs an actual sender if "every opening is public" is to be true rather than drafted.
7. **Keep a human on the alarm.** The pipeline detects; it cannot prevent (Core upgrades, third-party upgrade keys, cbBTC freezes) and it cannot respond. The dead-man's switch pages someone — that someone must exist, be reachable, and know the runbooks for a swept-with-no-return cycle and a pulled brake.

None of the above is a code change to the five programs; that is the point. The programs are the part AI can audit, and I found no defect in them this pass that survives the existing measurements — only one holder-facing sentence (F1) that misstates where the boost price goes, and one coverage boundary (F2) to close with the off-chain verdict.