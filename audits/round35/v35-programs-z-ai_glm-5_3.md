# Round 35 — independent audit of the whole v6 tree

**Verdict up front: no new CRITICAL or HIGH. Round 34 was NOT CLEAN (1 MEDIUM, 1 LOW, 4 INFO); I verified every one of its repairs is present in this tree and found no regression in them, and I independently confirmed its three measurement-based refutations (W1, W2, W9) from the code and the new suite arms. My own pass over all five programs, the bundled off-chain readers, the suite, the simulation and the build scripts found two new LOWs and one new INFO, all in procedure and test-evidence, none in money logic. This round is therefore also not clean, but nothing I found moves value.**

Boundaries of this audit, stated first: I read; I did not execute. Every claim below that depends on a run rests on the bundled suite/sim/runner text and the round-34 validation logs, which I read as evidence, not as authority. The off-chain files **not** in this bundle (`bank/detectors.mjs`, `alarm.mjs`, `crank.mjs`, `swap.mjs`, `revenue.mjs`, `accrual.mjs`, `check-launch-params.mjs`, `redemption-poster.mjs`, `sim/swap-fork.sh`, `cron-install.sh`, `audits/FREEZE.md`) are outside what I could check; where a finding of mine touches them I say so.

---

## R0. Round 34's verdict and repairs — verified

Round 34's six confirmed findings, checked against this tree one by one:

| Round-34 finding | Repair claimed | Independently verified |
|---|---|---|
| M1 ProgramData pre-fund | ids claimed on mainnet with an inert placeholder; SPEC step 9 rewritten as extend + upgrade + verify + `--final` | **Present.** SPEC step 9 carries the full procedure with mainnet rent (5,080/byte, 650,240 / 833,120), the prefix-hash-plus-zero-tail check, the re-check after `--final`, and the alarm-baseline re-take. The rehearsal log is cited. See **F1** below for a defect this repair introduced. |
| L1 minter metadata | SPEC item 57 + holder-guide honest list | **Present**, both, and accurate to the code (`create_vault` checks lengths only; `check_attributes` reserves keys by exact string). |
| D1 test-validator rent in a mainnet step | both rates stated | **Present** in step 9. |
| D2 R33.G1 mislabelled | relabelled; full shape built | **Present**: R33.G1's comment now defers to R34.G1b, and R34.G1a/b mint and reveal the full worst shape (64/200 name/URI, largest v0-carried attribute list, five owner plugins, 10,198-byte autograph) at the default budget. The fit loop trims across all values (the review defect is fixed in the bundled source). |
| D3 sweep-helper comment | corrected | **Present** in `programs/cbob-vault-sweep/src/lib.rs` and SPEC. |
| D4 SPEC 53 "five programs patched" | "four keyed programs plus layout.mjs" | **Present.** |

Round 34's four gate-5 obligations are all now pinned in the suite (R34.G1a/b, R34.G2, R34.G3, R34.G4), and the floor arithmetic is consistent: 866 + 5 = 871 = `MIN_ASSERTIONS`, and the validation's second canonical run records 871/871 with `CBOB_SHIP_GATE=1`. I re-derived the refutations independently: W1 (a stranger cannot take an ATA address — the address is a PDA of the ATA program; System allocate/create need its signature; `InitializeAccount3` on dusted bytes is refused) is now a permanent arm; W2 (a no-CPI transaction returns `innerInstructions: []` and the reader parses it) is pinned against the real RPC shape; W9 (the seal against its owner: remove 0x9, re-delegate 0x1b, revoke 0x1a, thaw 0x1a, control thaws) is pinned on a real vault.

**F1 (LOW, launch procedure). The round-34 M1 repair left the runbook internally contradictory about when the upgrade authority is removed.**
- **Construct:** SPEC road table. Step 9 (rewritten by the repair) now ends each program's deploy with `solana program set-upgrade-authority <id> --final`. Step 11 still reads "**Remove the upgrade authority from all four programs, and from the sweep helper… PRECONDITION … item 50's redeem page exists**", and step 9's own placeholder-key note says the upgrade key "must not be lost before step 11".
- **What an accident gains:** an operator following step 9 as written locks all five programs *before* step 10 (initialize) and while item 50's redeem page is still OPEN — silently satisfying step 11's precondition in the wrong order and ending the fixable window earlier than the runbook's own gate requires (item 39's cost, taken early). Read the other way, an operator who trusts the "before step 11" note keeps the placeholder upgrade key `FZjLB4e9…` — a single key that can replace all five programs — hot for the entire deploy→initialize→page-build period, which is longer than the procedure needs it.
- **Evidence if I am right:** the three texts quoted above, in the same document, disagree. `audits/round34/VALIDATION.md` confirms "make final" is inside step 9's rehearsed path. No funds are at risk in either direction (nothing is initialized before step 10, and the team controls step 10's timing), which is why this is LOW and not MEDIUM.
- **Fix:** rewrite step 11 as a verification ("confirm all five are final; if any `--final` was deferred, do it now, only after item 50's page exists"), move the item-50 precondition onto step 9, and correct the key note to "before step 9's `--final`".

---

## R1 / R1s. Custody and the sweep helper — attacked, holds

I attacked each named surface independently; each held. Summary of what I checked and the mechanism that holds it:

- **The pairing.** Both halves bind asset (account 0) and owner (account 2), both walk the instructions sysvar for *top-level* instructions only, and a CPI'd half reports the outer instruction's index, so wrappers fail in both directions (WR.1–WR.4, and my own trace agrees). Two vaults in one transaction cannot borrow each other's halves (3.9/3.10/4.10). A thawed vault cannot leave a transaction unburned: SEAL's walk requires a later top-level `burn_vault` for the same pair, and any instruction failure reverts the thaw with it.
- **The emptiness proof.** Both ATA derivations per reserve mint must be declared; a declared account owned by no token program is skipped (this is exactly why the sweep's *closed* accounts pass — after `CloseAccount` the account reads non-Token/zero-length, both "empty" outcomes), and a declared token account owned by the PDA is checked for delegate/close-authority/extension/amount. The second loop now applies the same checks to non-reserve declared accounts. Token-2022 cannot supply an ATA for a classic mint (mainnet probe, `IncorrectProgramId`), so the T22 derivation is always a declared-and-skipped address.
- **R1s(a) who may move value.** The helper's whole access control is Core's `ExecuteV1` rule; the permanent seal (authority = SEAL's PDA) blocks Execute outside a redemption, and the owner cannot remove/re-delegate/revoke/thaw that seal (R34.G4, 0x9/0x1b/0x1a/0x1a). An owner-added `FreezeExecute` is irrelevant while the permanent freeze is frozen. I could not construct a path where anyone but the owner moves a sealed vault's holdings.
- **R1s(b) the pair list.** Duplicate source: the second read of the closed account fails (IllegalOwner), and SR.12b pins that it failed at the second read, not the first guard. Source-also-destination is impossible (owner fields conflict unless signer==dest, refused). wSOL is an ordinary classic account. Delegates/close authorities on a vault account can only be set by the owner via Execute. Frozen source reverts the redemption (limit 28, disclosed). Destination need not be an ATA, only same-mint and owned by the one destination wallet. Odd/short account lists refused; zero pairs is the lamports-only sweep (SR.13).
- **R1s(c) destinations.** The destination wallet is chosen by the transaction builder, and the builder is the owner (only the owner can sign the Execute). Lamports to a non-System destination land (R27.S1); a lamports-only sweep to a non-existent destination fails — a client obligation already written down (round 25 D9).
- **R1s(d) the lamport sweep.** A later instruction in the same transaction could re-fund the PDA only if the *owner's own* transaction includes it; a stranger cannot inject instructions. Core's `BurnV1` neither sweeps nor adds lamports to the asset-signer (measured fact 4), so BURN's `lamports == 0` sees exactly what the sweep left.
- **R1s(e) missing reserve accounts.** The prior-transaction rule is sufficient, and the reasoning in SPEC's sweep-helper limit entry is correct as written: once the page (or anyone) has created the canonical ATA, a stranger's later deposit lands in the account the sweep names and is moved at execution; a stranger cannot create the T22 derivation; a non-ATA classic account a stranger creates for the PDA is rescuable by the sweep if named and is destroyed if not (limit 44, disclosed); a nested Core asset is limit 9/44. I looked for an account class that is neither nameable by the sweep nor skippable by BURN and found none beyond the disclosed ones.
- **R1s(f) does it fit.** S8.0's 1,061 bytes includes the claim (which carries the pool), the open, the helper with all three pairs, and the burn (which carries MINT, config, record and pool for the retire CPI and the in-line monthly). A fourth reserve cannot exist (`MAX_RESERVE_MINTS = 3`, written once). Extra rescue pairs cost ~66 bytes each against 23 bytes of spare in the padded shape — stated in item 50.
- **R1s(g) evidence and bytes.** SR.0–SR.5e, SR.6–SR.14, S8.* are present, each pinned to a measured refusal reason, and I found no arm in this family that cannot fail. The helper has no `localnet` feature, so the suite's build, `target/deploy` and `dist/` are byte-identical by construction and by `build-mainnet.sh`'s two `cmp`s.

---

## R2 / R2b. The community pool and the boost — no new defect

- **The invariant "pool ≥ ceil(owed)".** Traced through `credit` (`delta·w ≤ avail·SCALE`, so the pool's fall always covers the owed rise), `claim` (owed falls by exactly what is paid), `retire` (owed falls, balance unchanged), and the forfeit path. Holds. P.32 and the `ledger()`/`books()` re-derivations from every record check it after every money operation.
- **Counters under every ordering.** `pending_count ≥ pending_this_epoch` always (epoch reset plus the join-eligibility rule make the this-epoch count a subset); `active_count`/`total_active_weight` move only with join/retire/reweigh; F21.1/F21.2 exercise the same-epoch and later-epoch retires of waiting vaults. The host test drives 260 epochs of random orderings through the program's own functions and checks every ring slot per index.
- **Liveness.** Both gates (`JoinWaitingFirst`, `BoostsExpireFirst`) are clearable permissionlessly: joining needs only a claim naming the vault (the join path never touches the destination account, so a missing account cannot wedge it — and I verified a pending vault's recorded ATA cannot be closed except by a redemption, which also retires it), and `expire_boosts` needs only records, which is precisely why it exists. A stranger cannot create waiting vaults (activation requires the vault's own funded account) or make boosts due (only distributions do). No permanent block found.
- **Boost exactness.** A boost bought at epoch e ends at e+N; the distribution that advances the epoch to e+N is its Nth; the gate then refuses until expiry. Both one-transaction orderings ([boost, distribute] and [distribute, boost]) are measured (BO.21/BO.35). Nothing earned is lost or gained across reweigh: the owed share moves to `carry` and the debt restarts, verified in code and by BO.7c/BO.14/BO.37.
- **SPEC's weaker wording (round 24 W11).** SPEC already states the true rule ("it is NOT 'a vault never earns from revenue that arrived before it joined'") and item 55 states the unsplit-revenue edge with its corrected 100-$GARY cost. I found no stronger wording left to attack.

---

## R3. The level draw — holds; one disposition verified

The SlotHashes parse is fail-closed (key pinned, count bounded, buffer bounded, zero-hash refused); the window is inclusive of `want+64`; the skipped-slot model matches the host tests and the suite's independent re-derivation (L.3c, L.23). The FIFO cannot be bypassed (`RevealOutOfOrder` against `revealed_total`), a burned head still takes its draw, and the attribute re-supply is hash-checked except for burned assets, where nothing is written.

Round 34 A2 (the C-leader's single choice serves every vault whose A falls in the same 4-slot group, a wider cohort than "minted in the same slot") is **true by code** — B and C are derived from A's group alone (`try_capture`) — and was dispositioned as an optional disclosure. I do not re-file it; I confirm the mechanism and the disposition. HOLDER-GUIDE's "created in that moment" is vague but not false.

---

## R4. Governance — no minority path, no money reach, no new freeze

Vote binding to the asset, the mint-index snapshot, the live-supply divisor, the 10% turnout, the half-of-all-live-vaults key change, the never-bundled key changes, the per-kind ordering with logged skips, and MINT's re-checks at execute all read correctly, and the suite exercises each refusal by name. The concentration facts (largest holder 17.1%, top three carrying a key change below 24.2% unclaimed) are stated, not hidden. The only permanent-freeze shape remains limit 45 (all vaults redeemed, all 2,100 minted), already accepted.

---

## R5. The charter claim — holds; SPEC 46 complete modulo its stated blind spots

The Merkle scheme is sound: domain-separated leaf/node tags defeat second-preimage; sorted pairs defeat reordering; the proof bound (16) is above any depth this 240-leaf tree produces (8); the JS and Rust agree and the program verifying a JS-built proof is the drift check. The PoB is identified by address, owner-checked from the asset bytes, collection-checked, and burned by CPI in the same instruction; `pob_extra` accounts pass through never as signers. The window is clock-only and cannot reopen. I enumerated what the hot Moments key can still do (gate claims, admit only its own PoBs, per-asset plugins between alarm passes, move the collection authority) and each is in SPEC 46; I found nothing it omits.

---

## R6. One-time configuration, the trusted hop, the royalty, the rate limit

- **Launch values.** Every value in `launch/mainnet-init.json` satisfies the corresponding program bound (I checked each: sweep bounds chain correctly, periods inside their ranges, caps sum to supply, boost ceilings inside the program maxima, quorum/threshold inside GOV's ranges). The two OPEN nulls (`charter_opens_at`, `lock_deadline`) are still refused by the checker. The known gap that the programs check less than the checker (SEAL validates reserve "mints" by owner only; MINT never validates `payment_mint` is a mint) is round-24 A6, documented, and gated by item 38.
- **The trusted hop.** Worst case unchanged from limit 10: cap × cooldown windows (10 SOL × 4/day) above the reserve, until the guardian stops it; the operator signs; a vote can only tighten inside the fixed bounds; a replacement needs half of all live vaults plus notice; the guardian can stop and cancel.
- **The royalty.** Authority `None`, installed once at initialize; no instruction in any of our programs builds a Core collection-plugin update; the collection's update authority is MINT's off-curve PDA, which nothing can sign as; Core refuses updates/removal/re-delegation from anyone (R.3–R.6c, R33.G3). Confirmed unreachable.
- **The redemption cap.** It is exactly a ring of the last 64 redemption *timestamps* with `cap = ceil(live × 210/10000)` floored at 1, `k = min(cap, 64)`, admission iff `now − ring[(head−k) mod 64] ≥ window`, write at `head`, advance `head`. I re-derived the index arithmetic (the k-th most recent is at `(head−k) mod 64`) and the cold-start behaviour (zeros admit the first `cap`), and both match RL.2–RL.7 and the replay.

**F2 (LOW, programs/tests). GOV's duplicated MINT constants `MIN_ROUND_PRICE_SATS` and `MAX_ROUND_SECS` have no mirror pin.**
- **Construct:** `programs/cbob-vault-gov/src/lib.rs` carries its own `const MIN_ROUND_PRICE_SATS: u64 = 21_000` and `const MAX_ROUND_SECS: i64 = 365 * 24 * 3600`, used in `create_proposal`'s pre-checks; MINT carries the same-named constants used in `set_round`. The suite pins the third duplicated constant, `RENT_EXEMPT_0_BYTES`, across both sources (arm 3c.M1) and pins every discriminator — but no arm compares either of these two.
- **What a drift gains:** nothing today (both match). If GOV's copy is ever looser than MINT's, a proposal with a price or window in between passes creation and fails execution, reverting its whole bundle and wasting a ratified vote — the exact failure the creation-time checks exist to prevent ("Refuse a proposal MINT would reject anyway"). Note the suite's G.1 proves GOV's floor > 20,999 but never reads MINT's constant, so the GOV-looser direction is unproven.
- **Evidence if I am right:** grep both `lib.rs` files for the two constants (present in both); grep `tests/3prog.test.ts` for a comparison (only `RENT_EXEMPT_0_BYTES` is compared, at 3c.M1).
- **Fix:** one arm per constant in 3c.M1's style (regex both sources, compare), in the same commit as any future change to either.

**F3 (INFO, procedure). Step 10 does not re-verify the five programs' on-chain hashes in the same session as `initialize`.**
- **Construct:** SPEC road step 9 verifies bytes at each upgrade and again after `--final`; step 10 (initialize) names no hash check. Until each `--final`, the placeholder upgrade authority `FZjLB4e9…` can replace any of the five programs.
- **What an attacker gains:** an upgrade planted between step 9's verification and step 10's initialize would have its bytes initialized; the alarm's 30-minute hash watch narrows but does not close the window, and a page is not prevention.
- **Evidence if I am right:** step 10's text contains no dump/verify; the alarm cadence is 30 minutes (SPEC off-chain table).
- **Fix:** dump-and-verify all five hashes immediately before sending the initialize transactions (and again before any deferred `--final`), and keep the placeholder key offline except during those sessions.

---

## R7. Cross-program raw reads — every offset recomputed, all correct

I rebuilt the full MintConfig layout from the struct definition (65 fields, ending at 1005 + 256 padding = 1261, matching the space constant term for term) and confirmed every pinned offset: GOV's 41/141/454/442/257/266/274/191/192/518/526/631/639/647/711/712; BURN's 141/454; VaultRecord 8/9/41 (and the suite's 125/126/177/178/186/187/195); BurnConfig 42; SEAL Config 8/9/41. The discriminators are asserted against the Anchor derivations in the suite (3.1a–3.1u). The sweep helper's token-account offsets (mint 0, owner 32, amount 64, state 108, length 165) are the classic SPL layout. **No misread found.**

---

## R8. The suite, the simulation and the build as evidence

- **Floors equal counts.** `MIN_ASSERTIONS=871`, `DET_FLOOR=912`, `ALLOC_FLOOR=39`, `POSTER_FLOOR=23`, `POB_FLOOR=14`, `LAUNCH_FLOOR=47`, `HOST_FLOOR=6` (five authored tests plus Anchor's generated `test_id`), `MAINNET_FLOOR=33` (I recounted the probe's `t()` calls: 5 walk + 15 reserve + 8 ELF + 5 PoB), `EXPIRY_FLOOR=4`, `SIM_FLOOR=71`. All match the prompt's claims.
- **Arms that cannot fail / wrong-reason refusals.** I specifically hunted these in the sweep-helper family (SR.*), the rate-limit family (RL.*, including the cap-stamping model, which is a genuine both-direction test of the evidence itself), the boost family (BO.*, including the frozen-destination expiry BO.37 and the ring-wrap BO.34/38), and the round-34 additions. Every arm I examined can fail, and every `because()` pin I checked names the error the construct actually produces (including the two-pin arms SR.11 and SR.14, where both pins must appear in one error). The `ID.1` uniqueness check guards the pin mechanism itself.
- **Claims no arm exercises.** The 16 swap-fork assertions and the 912 detector assertions live in files outside this bundle; I can confirm their floors are enforced by the runner but not their content — a boundary, not a finding. Within the bundled suite, the one unpinned duplicated fact is F2's subject.
- **Mainnet bytes vs tested bytes.** The four keyed programs' mainnet binaries are, by design, *not* the bytes the suite ran (the `localnet` feature swaps `INIT_AUTHORITY`); the gap is closed only by the behavioural key-proof (mainnet rejects the test key for the `NotTheInitAuthority` reason, localnet accepts), the source grep, and reproducibility — exactly what `build-mainnet.sh` says it proves and does not prove. The sweep helper's mainnet bytes are proven identical to the tested bytes (no feature, two `cmp`s). I confirm the script's own honesty here and found no overclaim.

---

## The four questions about the accepted limits

1. **Is any limit worse than stated?** I attacked each against the code. The one candidate I found — a Token-2022 account created *for* the vault PDA by a stranger (possible: `InitializeAccount3` lets the funder set any owner), which the helper cannot name and BURN cannot see undeclared — is already limit 44's disclosed "Not covered: Token-2022 accounts", and the detection half now covers it (round 34's off-chain repair reads T22 amounts in the reconcile). Limit 28's frozen-account block, limit 32's ring bound, limit 46's hot-key scope, limit 47's permanent-stop condition and limit 10's rate-not-total bound all match the code. **None found worse.** The step-9/11 contradiction (F1) is a procedure defect, not an understated limit.
2. **Is anything listed as a limit not actually a limit?** No. Limit 35's "never binds at the ruled numbers" is arithmetically true (21% × 51% ⇒ 10.71% > 10%); limit 42's narrow-shape exception is correctly scoped as an offline measurement.
3. **Is any DISCHARGED item not discharged?** No. Items 51 and 54 are built and measured; the v5 family is genuinely gone with the Bank; the closed items (14, 19, 30, 31, 33) each have the on-chain construct or the `initialize` parameter the discharge names.
4. **Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22 (nothing has run against a live chain), 38 (two nulls), 50 (surfaces unbuilt; the guide is DRAFT and restricted), 52 and 53 (the rehearsal value set still unwritten) are all still stated as open with their exits named. The nearest thing to quiet acceptance is that item 53's rehearsal proof is stale at `d57ee3a` and must be re-run at the release commit — it says so itself; keep it said.

---

## Findings table

| ID | Sev | Construct | Gain | Evidence | Fix |
|---|---|---|---|---|---|
| F1 | LOW | SPEC road steps 9 vs 11 + the placeholder-key note | Premature permanent lock (or an over-long hot upgrade key) from following contradictory runbook text | The three quoted texts disagree; VALIDATION puts "make final" in step 9's rehearsed path | Rewrite step 11 as verification; move the item-50 precondition to step 9; fix the key note |
| F2 | LOW | GOV's `MIN_ROUND_PRICE_SATS` / `MAX_ROUND_SECS` vs MINT's | A drift lets a ratified proposal pass creation and fail execution, wasting the vote and its bundle | Both constants in both sources; no suite arm compares them (3c.M1 covers only `RENT_EXEMPT_0_BYTES`) | One mirror arm per constant, 3c.M1's style |
| F3 | INFO | SPEC step 10 vs the placeholder upgrade key's window | An upgrade planted between step 9's verify and step 10's initialize is initialized | Step 10 names no hash check; alarm cadence 30 min | Dump-and-verify all five hashes in-session before initialize and before `--final`; key offline otherwise |

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE: what should this project do before launch that AI audit structurally cannot?

1. **Run the dress rehearsal (item 22) as the certification it is, with named pass/fail artifacts.** No amount of reading surfaces RPC paging under 2,100-vault `getProgramAccounts`, crank cost, a transient error at vault 1,900, the reveal lane keeping up, or the alarm's live I/O — its selftests read source, not a cluster. Record the signatures; treat any skip as a fail (the ship-gate condition already says so).
2. **Have a second party rebuild the artifacts from the release commit and compare sha256s.** `build-mainnet.sh`'s own closing paragraph names reproducibility as the whole bridge for the INIT_AUTHORITY constant; nobody independent has crossed it. This is the single cheapest check that closes the one acknowledged tested-vs-shipped gap.
3. **Get an attestation of the pinned Core binary.** The suite pins bytes; round 25 N3 concedes the source is "not proven identical to the pinned binary". Ask Metaplex to confirm the `f03e7537…` dump corresponds to `e72d63e`, or build Core from that source and compare. Every seal, thaw, Execute and burn is a CPI into it, forever.
4. **Run a human adversarial UX pass on the redeem page with real wallets.** Whether Phantom/Ledger retain compute-budget instructions, how the prior-transaction flow behaves on a cold wallet, and whether the coverage warnings render under a real airdrop are client behaviours the suite measures only through web3.js. Item 50's obligations are all client-side; only a human with a real wallet can test them.
5. **Cross-check the accumulator with an independent implementation.** Every reader of the payout arithmetic so far is the authors' own (`bank/accrual.mjs`, the crank, the alarm). Commission a small third-party explorer/wallet that computes each vault's owed share from raw chain state and run it against the rehearsal and the first live months. The pool is the money; a second implementation is the only independent arithmetic audit there will ever be.
6. **Do a key ceremony with witnesses and a written loss story for each key.** The placeholder upgrade authority (until `--final`), the $CBOB release wallet, the swap operator key, and Gary's wallet (guardian + INIT_AUTHORITY). AI can read that these files exist; it cannot verify a safe, a backup, or a two-person rule. Write down, for each, what happens the day it is believed lost.
7. **Chaos-drill the detection live.** Deliberately freeze a pool account in the rehearsal, truncate a transaction's logs, flood one program's signature scan, kill the crank mid-pass. The detectors are proven both ways as pure functions; their live I/O is proven nowhere but the rehearsal.
8. **Staff the charter window.** Seven days during which one hot key can end the project or capture the electorate, with a 30-minute sampling blind spot. Name a human responder, on a schedule, with a drilled reaction to a plugin or authority change on `F9TDm35J…`.
9. **Take the legal and issuer questions to humans.** cbBTC's freeze terms and the fact that Solana does not force a marketplace to pay the 10% are trust and business facts, not code facts; the holder guide already says the second, and a lawyer should say the first.
10. **Fund a standing bounty after launch.** Immutability means a post-launch finding needs the guardian-plus-vote path, and someone must be paid to keep looking once the audit rounds stop. Decide now who that is and what it costs.

Nothing in this round's findings should delay the freeze on its own — F1, F2 and F3 are documentation, one test arm, and one runbook step — but all three should land before the two clean rounds are counted, because gate 2 resets on any change to `programs/`, `bank/` or `scripts/`, and F2's arm belongs in `tests/` beside the repairs it pins.