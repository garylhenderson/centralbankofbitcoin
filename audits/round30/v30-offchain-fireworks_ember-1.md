# ROUND 30 AUDIT — off-chain pipeline, MINT, and the sweep helper

Audited the whole tree at `c5aab17` (round-29 repairs `88acce2` included) against the bundled round-29 verdict, the accepted-limits list, and the measured facts. I read every file in the bundle whole, re-derived the arithmetic independently, and checked each round-29 repair at all sites of its shape. Where I considered a claim and rejected it, I say what evidence would exist if it were true and why it does not exist.

**Verdict: no CRITICAL, no HIGH, no MEDIUM found. Three LOW findings, all in detection/gate coverage, none in a value path. Round 29's three repairs hold at all sites.**

---

## R0. ROUND 29'S VERDICT AND ITS REPAIRS

The verdict was NOT CLEAN with three confirmed findings (M1 MEDIUM, L1 LOW, D1 INFO) and 25 other dispositions. I verified each repair against the current tree, and spot-checked the dispositions.

**M1 (runtime-truncated logs halting every scanner) — repair holds at all four sites.**
- `bank/txread.mjs` `validateParsedTransaction(tx, sig, { truncatedLogs = 'refuse' })`: the marker is exactly the standalone line `Log truncated` (`meta.logMessages.includes('Log truncated')`); a program's own `Program log: Log truncated` does not match (R28 arm present and distinct). Flag mode returns `{ ...tx, logsTruncated: true }` with every other validation intact; an unknown option throws. Verified in source.
- `bank/alarm.mjs`: the walk opts in (`{ truncatedLogs: 'flag' }`), pages `log_coverage_gap` (HIGH, classified `once`/urgent in `ALARM_KINDS`), records the signature in `looked.logGaps` → state's `logGaps` (deduped, capped 500), passes `[]` to `parseCbobLogs` so no event lines are read, and still runs `detectApprovals`/`detectPdaTokenAccounts`/`detectBurns`/`detectUnledgeredSweeps` on the instructions. Cursor advance (`if (!gap && !unread && sigs.length)`) is unaffected because a flagged transaction is not `unread`. On delivery failure the `!delivered` branch restores `prev.cursors`, so the gap is re-scanned and re-paged; `logGaps` dedupes the re-record. Consistent with the SPEC boundary ("keeps every cursor when the page is not delivered").
- `bank/revenue.mjs` `splitsSince`: opts in; `revenueOutflow` reads instructions/inner instructions, never logs. A truncated split still anchors.
- `bank/redemption-poster.mjs`: opts in; never drafts from truncated logs; queues a REJECTED hand-draft entry only when a top-level instruction names BURN (`tx.transaction.message.instructions.some(ix => ix.programId === BURN_PROGRAM_ID)`). A redemption must call `burn_vault` at top level (`retire_redeemed` requires stack height +1), so no real redemption slips the queue.
- The selftest's R29 M1 arms drive the real extracted alarm walk with a real `CBOB_REVEAL_RESCHEDULED` line before the marker and assert it is NOT paged, that the instruction finding (`non_ata_token_account`) still fires, and that the cursor advances. The probe's fee-payer sampling also uses flag mode (round-29 review fix present).

One boundary I checked and accept: the marker is the runtime's; an RPC that truncates logs at its own layer without the marker would read as complete. That is the trusted-RPC residue (limit 10(b)), not attacker-reachable — an attacker padding a transaction always gets the runtime marker.

**L1 (coverage gate scope) — repair holds.** `scripts/audit-coverage.sh` now enumerates `git ls-files` over `programs/ bank/ scripts/ sim/ launch/ tests/` plus the four documents and manifests, names its three exclusions, exits 2 (not 0) when git cannot list, and reads both prompt shapes (`f('…')` and the anchored TARGETS array). `sim/fixtures.mjs` is now enumerable by it.

**D1 (selftest scan scope) — repair holds.** `srcFiles` includes `tests/*.mjs`; `tests/expiry-budget.mjs` contains no `fromSecretKey` and no retired key path, so the two-signer pin still holds with the wider scan.

**Dispositions spot-checked:** C02 (deviation-filter units) correctly disproved — raw cbBTC per raw wSOL IS sats per lamport at 8/9 decimals, and fork SW.0 measures both real pools within 100 bps of the oracle. C06 (`problemKey`) correctly disproved — `\b\d+\b` does not match inside base58 addresses. C13/C23 correctly classed optional. The verdict's counts (855 on-chain, 888→891 detector, 16 swap-fork) match the current floors (`MIN_ASSERTIONS=855`, `DET_FLOOR=891`, `FLOOR=891`, `SWAP_FLOOR=16`).

No repair regression found. The consecutive-clean counter correctly stays 0/2; this round is a fresh read of the repaired tree.

---

## R1. THE CRANK (`bank/crank.mjs`)

I checked every planned instruction's account list, order, mutability and data against MINT's `#[derive(Accounts)]` structs, and every plan branch against the program's refusals.

- **Account shapes all match.** `reschedule_reveal` `[W(record)]`; `capture_entropy` `[W(record), R(SlotHashes)]`; `reveal_level` `[W(config), W(record), W(asset), W(collection), payer(signer,W), R(mint_auth), R(SlotHashes), R(Core), R(System)]` with `disc + attrsBorsh(list)`; `retire_burned` `[W(config), W(record), R(asset)]`; `claim` `[W(config), W(pool), R(Token), …pairs]` with `crank_n=0`; `expire_boosts` `[W(config), …records]`; `split_revenue` `[R(config), W(revenue), R(mint), W(revAta), W(pool), W(bankAta), R(Token)]` with the decimals byte; `distribute` `[W(config), R(pool)]` with `burn=0`; `activate` `[W(config), W(record), R(asset), R(vault_token), R(pool)]`. All match MINT.
- **No plan the program refuses on a static read.** Joins precede distribute (`JoinWaitingFirst`); due boosts expire before (`BoostsExpireFirst`) and the ones the distribution makes due expire after (`boost_end_epoch === dist_epoch + 1`, which also covers a tick, since `tick` calls `advance_epoch`); the tick is planned only when `w === 0 && waitingThisEpoch` with this-epoch retirees subtracted (L3); a distribution is never planned from a frozen/unreadable pool, past an unreadable eligible vault, or with `avail === 0`. The owed arithmetic for claims (post-distribution accumulator, join debt `w × old acc`, expiry carry) matches `owed_of`/`reweigh`/`join` exactly (see R4).
- **No dead vault paid or joined.** Only positively-`live` assets are activated, pre-joined, joined or claimed; `burned` is retired first; `other` (null read) is reported and blocks the distribution. The residual race (asset read live at plan time, burned before the send) is accepted limit 27 — `claim` does not check liveness on chain — bounded by the per-pass retire and costing only the burned vault's own share.
- **Reveals strictly in mint order**, from `revealed_total`, breaking at the first not-ready/failed/skipped; `[]` sent only for a positively burned asset (the program skips the hash check only there); the hash is checked before any fee (`judgeRevealAttrs`, with the `level`-carrying list classed `revealed`, never `mismatch`).
- **No value anywhere the program does not pin.** The selftest pins the instruction-name set, the absence of any transfer/SystemProgram.transfer, and MINT as the only `programId`. The key signs as fee payer and as reveal `payer` (Core attribute rent) only.
- **Fee budgeting** (`budgetPlan`) drops reveals from the end of the mint-ordered list when short, keeps captures (so no lapse/re-roll is caused — a captured vault has no deadline), and pages the dropped count. `judgeFeePayer` checks the minimum before the ceiling (L6a holds).

One LOW found here (LOW-2 below).

## R2. THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

I walked every detector against the state it reads, looking for a dangerous state read as quiet and a routine state paged every pass.

- **Coverage of the required set is present and wired:** fixed-forever drift (CRITICAL on every `initialize` value including `cbob_mint` and the boost bounds), pending guardian/operator (CRITICAL every pass), PoB collection plugins and update authority (CRITICAL), redemption window nearly full (`redemptionCapacity` mirrors BURN's ring arithmetic: cap `max(1, ceil(live×210/10000))` bounded at 64, room = cap − in-window), frozen/insolvent pool (`owedCeil` against a same-read config), distribution overdue plus the three stalls (joins, boosts, launch tick), upgrade authority past the earlier of `lock_deadline` and `charter_opens_at` for all FIVE programs (sweep included), and Gary's production values (21%/51%/3-day, 7-day notice, 1 SOL/24 h/0.1 SOL bounds, 30-day month, 3600 s window, census, treasury, mints, PoB root and collection, 12/24 boost ceilings).
- **No routine pager found.** The standing INFO findings never page; the level findings assert only while a real condition holds and recover; `revenue_unsplit` restarts at the last seen split (M1 holds); `royalties_unswept` follows the on-chain cooldown (L4 holds); freezes page once and stand at INFO (I5 holds); `revenue_age_unknown` fires once at clock migration.
- **The ledger is held to the chain** at the points round 24/25/26 repaired: `rejected_row_has_sweep`, `sweep_on_rejected_row`, amount mismatch, `closesCycle` anchored on the return's chain time with total ≥ return, explicit `splitSig` held to the same anchor, the verification window following chain-seen sweeps, future-stamped cycles ungraced. I re-derived `closesCycle`'s filter/sort/find and the `splitByOther` pool attribution; both directions armed in the selftest.
- **The round-27/28/29 wiring gates are real:** the derived `V6_WIRED` list with comment-stripped, result-consumed call detection; the I4 pinned-argument list (order and values); the H1 kind classification with the router run live in a scratch state dir.

One LOW found here (LOW-1 below).

## R3. THE LAYOUTS (`bank/layout.mjs`)

- `parseRustStruct` is strict (throws on any non-`pub name: Type,` line), and the selftest compares every struct field-for-field, computes every offset, and holds them against every `OFF_` constant scraped from all four programs (with a none-scraped-and-ignored arm), every seed against its program's `*_SEED` (round-24 D6 assertion **exists now**: 11/11 scraped and compared, with mistyped/unmapped counterfactuals), every layout version against the Rust constants (including sibling copies), and `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` evaluated from the Rust expressions less padding against `fixedLength` (1005/211). I recomputed the MintConfig offsets independently (version 8 … `boost_expiring` 749, fixed length 1005) and the VaultRecord offsets (level 57, which the reveal lane's memcmp uses); they match.
- A struct edit, a retyped field under the same name, a bumped version, a moved seed, or a one-byte space change each turn the build red. The decode refuses wrong discriminator, wrong version, a non-0/1 bool, truncation, and an incredible Vec length. No slip path found.

## R4. THE MONEY ARITHMETIC (`bank/accrual.mjs` vs MINT)

Line-by-line:
- `credit`: `delta = avail × SCALE / w; acc += delta; owed += delta × w` — identical to MINT's `credit`.
- `pendingScaled`: `(weight + boost) × acc + carry − debt`, refusing negative — identical to `owed_of` (`weight_of` includes the boost).
- `reweigh`: carry ← owed, debt ← new weight × acc — identical.
- `ceilSats`, `available` (floor 0 where the program refuses `PoolShort`), `debtAtActivation` (`w × acc` = `join`'s debt) — identical.
- The crank's per-vault owed for the three claim cases (normal, joined-this-pass at `w × cfg.acc_scaled` debt, expired-this-pass at `atExpiry + w × (acc − cfg.acc_scaled)`) matches the on-chain sequence (expire at old acc → distribute → claim) exactly; the selftest asserts the sats (20/20, 29), not batch counts.
- The crank expires every due boost before distributing and every boost its own distribution makes due right after (including after a tick); the alarm pages `boosts_stalled` and watches `cbob_mint`, `max_boost_weight`, `max_boost_epochs` as fixed-forever CRITICAL. No divergence found.

## R5. THE SWAP (`bank/swap.mjs`) AND THE REVENUE CYCLE (`bank/revenue.mjs`)

**(a) Oracle math.** `sats = lamports × sol.price × 10^(es−eb) / (btc.price × 10)` — I re-derived the unit algebra (lamports/1e9 × SOL/USD ÷ BTC/USD × 1e8); correct for every exponent sign (e≥0 scales the numerator, e<0 the denominator). Integer division floors twice (expected, then floor), the safe direction for a minimum-out. `satsPerLamport` is float but feeds only the 100 bps deviation gate; mantissas ~1e10–1e13 are far below 2^53. No BigInt→Number overflow path.

**(b) Pyth verification.** The account is fetched at the derived sponsored PDA (shard 0, under the push-oracle program), must be owned by the receiver, must carry verification tag 1 (Full) at offset 40, and must carry the pinned feed id at 41. Offsets (price 73, conf 81, expo 89, publishTime 93) are proven against the real accounts on the fork (SW.7). Only the receiver program can write the account (it owns it), and it verifies Wormhole VAAs; a replayed old VAA yields a stale `publishTime`, which the 180 s age check refuses, and a future stamp past 30 s is refused. Age is judged against the Clock sysvar read in the same batch (owner checked), never the box clock. Bounded as stated in limit 10(a).

**(c) Deviation filter.** `orcaSpot` = (sqrt_price/2^64)² in raw units = sats/lamport (A=wSOL, B=cbBTC); `meteoraSpot` = 1/(1+bin_step/10⁴)^activeId (X=cbBTC, Y=wSOL, inverted). Both confirmed by SW.0 against real pool state. Float error is ~1e-15 relative against a 1e-2 gate.

**(d) Minimum out.** Same floor (oracle − 150 bps, floored to whole sats) rides in Orca's `other_amount_threshold` (offset 16, cbBTC sats out) and Meteora's `min_amount_out` (offset 16, cbBTC sats out). Same value, right units, right direction.

**(e) The judge.** Requires the exact seven-instruction sequence positionally: CU limit 400,000 at slot 0 (a `setComputeUnitPrice` fails both the slot-0 shape and the explicit tag-3 scan, and `ixs.length !== 7` leaves no room for an extra budget instruction); both ATA creates pinned to payer/account/owner/mint; the wrap pinned to exactly `lamportsIn` into the operator's own wSOL ATA; SyncNative of it; the swap pinned on program, pool, input (operator wSOL), output (operator cbBTC), amount, floor, and for Orca exact-input/a_to_b/min-sqrt-price; one close of wSOL back to the operator. Venue-owned accounts (vaults, reserves, tick/bin arrays, oracles) are validated by the venue programs against the pinned pool. Nothing value-moving routes past it; the same-tree residue is limit 10's accepted (3).

**(f) Derivations.** Orca tick arrays: span 88×spacing, current then two below for a_to_b, boundary tick starts its own array (armed), negative ticks floor correctly; oracle PDA `["oracle", pool]`; vaults read from the pool. Meteora: `floor(activeId/70)` then two above for Y→X; bin-array PDA `["bin_array", pool, i64 LE]`; bitmap `["bitmap", pool]` present-or-program-id; `host_fee_in` as program id (None); event authority `["__event_authority"]`; two token programs. All proven against the real programs on the fork (SW.1/SW.4/SW.8/SW.9). An uninitialised array makes the venue refuse — loud, cycle stays open (C13, optional hardening).

**(g) wSOL.** Wrap exactly `lamportsIn`, sync, exact-input swap, close. A pre-existing balance returns to the operator at the close; a frozen account fails the sync and the whole transaction (cycle open, loud); a delegate cannot block the owner's close; the ATA is deterministic regardless of creator.

**(h) Failure and retry.** `classifySendFailure` asks the chain: preflight refusal / landed-with-err / expired-and-never-landed → refused (next venue, or `sendRejected` for a sweep); landed-and-succeeded → recorded; anything else → unknown, cycle stays open, no second venue, no retry. The open-cycle guard blocks any new cycle; `cycleIsOpen` requires a return AND a split; a refused row carrying a sweep is itself CRITICAL. No double-swap, no double count, no failed cycle read as closed.

**(i) Adversary bound.** Worst honest-path execution is oracle − 150 bps, enforced on chain by the pool program; the 100 bps read-time gate does not bind execution. At the ruled 10 SOL cap that is ≤0.15 SOL per cycle, ≤0.6 SOL/day of royalty SOL only — consistent with the holder guide's "up to 1.5% below Pyth's price". A sandwich can take at most the floor; a pool pushed past the gate is skipped; a stale oracle is refused. The operator key's worst case is unchanged (cap × cooldown windows until the guardian stops; the float; nothing but cycle funds on the wallet — the last being operational, stated). A fully compromised RPC remains the accepted residue (10(b)): it can fake oracle and pool together, but the on-chain floor still bounds execution to the fake floor, and the post-swap delta check and the ledger hold the cycle open and loud.

## R6. THE GATES

- `scripts/run-tests.sh`: every floor must EQUAL its count (`floor()` dies on `≠`); `MIN_ASSERTIONS=855`, `DET_FLOOR=891`, `ALLOC_FLOOR=39`, `POSTER_FLOOR=22`, `POB_FLOOR=14`, `LAUNCH_FLOOR=47`, `HOST_FLOOR=6`, `MAINNET_FLOOR=33`, `EXPIRY_FLOOR=4`; the mainnet probe and the swap fork may not be skipped under `CBOB_SHIP_GATE=1`; the suite file and cache path are pinned; Core is pinned by hardcoded sha256 and re-dumped for comparison. Deleting work lowers a count below its floor; adding work breaks equality. No satisfiable-by-deletion floor found.
- `bank/selftest.mjs`: the round-24 arms are present in both directions (I drove the logic: the H1 kind table is complete in both directions, the wiring gate catches deletion/commenting/result-dropping, the I4 pin catches argument swaps, the L7 id gate is mutation-tested across all 14 copies plus keypairs plus unnamed 4-char-prefix literals, the control-table gate reads SPEC's real rows, the router is run live). One coverage gap found (LOW-3).
- `scripts/build-mainnet.sh`: five artifacts, exactly five; the sweep helper proven byte-identical across mainnet build, localnet build and `target/deploy` (it has no key to ask about); the four asked behaviourally about the test key in both builds; the "NOT PROVEN" paragraph is honest about the reproducibility bridge.
- `scripts/cron-install.sh`: the preserve logic is executed by the selftest against the real shell (commented lines, prose, foreign projects, both flag orders, the reveal-lane anchor); exactly six tagged jobs; `flock -n` asserted with `-n` as the property; the rehearsal marker refuses before any read; the revenue line's period is held to `REVENUE_CRON_PERIOD_SECS=3600` and below the ruled cooldown.
- `scripts/rehearsal-tree.sh`: forward/reverse byte proof, git-diff cross-check, 4-char-prefix refusal, required-patched list including the sweep's lib.rs and `bank/layout.mjs`; the R28 fixture arm runs the real python engine.
- `tests/expiry-budget.mjs`: synthetic but real execution — 20 distinct due boosts expired under the default 200,000 CU budget, landed on chain, state checked (weights 280→40, counters zeroed), floor 4 with equality.

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

**1. Is any limit worse than stated?**
- **Limit 10:** the trust set changed shape (two pool programs + the oracle, not an HTTP reply) and the documents say so ("What remains trusted", round 25 D1). The bound (cap × cooldown windows) is unchanged; the judge/builder repairs did not widen it. Not worse.
- **Limit 25:** the round-24 L6b budgeting (dropping reveals when the key is short) is newer than the limit's text, but it cannot cause a lapse — captures are in the base plan and a captured vault has no deadline — and it pages the dropped count. Not worse.
- **Limit 56:** "recorded and pinned" is pre-launch only (the launch gate). Post-launch nothing watches the wallet — see LOW-1. The stated cost stands; the silence around it is the gap.
- Limits 6–9, 13, 25–29, 32, 34–37, 39–49, 55: re-read against the code; none worse than stated. Limit 28's crank behaviour (no distribute/claims from a frozen pool; frozen revenue/Squads/pool reported, not split into) matches the text.

**2. Anything listed as a limit that is not one, or already closed?** None found. Limit 29 (only cbBTC splits) is still literally true (`split_revenue` refuses any other mint; no instruction moves a non-cbBTC token out of the revenue address). Limit 13 is correctly scoped "until the upgrade authority is removed".

**3. Any DISCHARGED item not actually discharged?** Item 51's boost schedule is driven through the program's own functions over 260 epochs (host test N1) and measured in suite section BO; item 54 and 12/17 are measured; the v5 family is gone with the Bank. Item 53's stale proof is correctly held OPEN, not discharged.

**4. Any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22 (with its five named rehearsal items), 38, 50, 52 and 53 remain OPEN with their sub-requirements named as not built (the rehearsal value set and the rehearsal mode of `check-launch-params.mjs` included). The holder guide's present-tense promises (redeem page, deposit address, public posts) are all gated on item 50 with the publication bar stated.

---

## FINDINGS

### LOW-1 — The $CBOB release wallet is unwatched after launch; a boost spree from a stolen backup key is invisible
**Construct:** `bank/alarm.mjs` (no read of the release wallet or its ATA anywhere), `bank/detectors.mjs` `parseCbobLogs` (its `owner` map covers REDEEMED/DISTRIBUTED/REVEAL_RESCHEDULED/CLAIM_DEFERRED_FROZEN/REDEEMED_POOL_FROZEN only, so MINT's `CBOB_BOOSTED` line is read and discarded by `if (!(type in owner)) continue`), `scripts/check-launch-params.mjs` (`CBOB_RELEASE_WALLET` pinned pre-launch only).
**What an attacker gains:** limit 56 accepts that whoever reads `bank/keys/cbob-release.json` — including from the off-box R2 backup, which touches neither the box nor the alarm's user — can burn the unreleased $CBOB to boost vaults they own (up to +12 weight for up to 24 distributions each, once a vote has switched boosts on). Because no balance is read and no `CBOB_BOOSTED` line is parsed, the first signal is holders noticing thinner payouts; nothing pages. The documents accept the custody cost but do not state the silence.
**Evidence if true:** a mainnet sequence of `CBOB_BOOSTED` events funded by the release wallet's ATA with no corresponding alarm page; the alarm's state showing no key for the wallet. (Checkable today: grep `alarm.mjs`/`detectors.mjs` for `AT2qf412` and `BOOSTED` — both absent.)
**Fix:** read the release wallet's $CBOB ATA each pass and page on any fall (the Bank's own releases are the only legitimate moves, and they are deliberate acts worth a page anyway), and/or add `CBOB_BOOSTED` to the parsed events as an INFO/HIGH one-shot. Bounded by the boost ceilings, so LOW.

### LOW-2 — The crank cannot tell a confirmation timeout from a failure; a landed distribute pages "action failed" once
**Construct:** `bank/crank.mjs` `send()` + `judgeDistributeRefusal`. On a confirmation timeout, `mintFailureCode` finds no AnchorError (a landed transaction's logs carry none; a never-landed one has none either), so `lastFailure = ''`, and `judgeDistributeRefusal('', …)` returns `'fail'` even when the fresh config shows `dist_epoch` moved — the race branch requires a race CODE, which a timeout never has. `bank/revenue.mjs` solves the same problem with `SW.classifySendFailure` (status lookup); the crank has no equivalent.
**What an accident gains:** one false "FAIL distribute (monthly, free)" page on the lane's stream per timeout of a transaction that actually landed. Self-correcting (next pass plans nothing, the month is no longer due), no value at risk, and the alarm's `crank_failing` needs three consecutive failing passes, so it does not escalate. But it is a false page in a pipeline whose own rule is that false pages teach scrolling.
**Evidence if true:** a crank log line `FAIL distribute (monthly, free)` with `dist_epoch` advanced on chain at the same minute (the distribution landed). Reproducible on a validator by delaying confirmation past the timeout on a successful distribute.
**Fix:** on a timeout-class error (signature present, no program error), check `getSignatureStatuses(..., { searchTransactionHistory: true })` and treat landed-and-succeeded as done — the same predicate revenue already uses — before falling to `judgeDistributeRefusal`.

### LOW-3 — SPEC's expiry-budget count is the one stated assertion count no gate reads
**Construct:** `bank/selftest.mjs`'s stated-count gate (`RX` map) covers on-chain, detector, allocation, poster, mainnet, launch, pob, sim and swap — nine floors. SPEC's "Running the tests" parenthetical also states "4 expiry-budget", and no `RX` key matches it, so a stale expiry count in SPEC (or a moved `EXPIRY_FLOOR` without a SPEC edit) passes every gate. `run-tests.sh` holds `EXPIRY_FLOOR=4` to equality, so the suite side is safe; only the documented count can drift. This is the exact class the gate was built for (a visibly wrong documented count teaches readers the floors are decorative), present in one occurrence.
**Evidence if true:** edit SPEC's "4 expiry-budget" to "5 expiry-budget"; `node bank/selftest.mjs` stays 891/891.
**Fix:** add an `expiry` key to `RX` (`/(\d+) expiry-budget\b/g`) mapped to `EXPIRY_FLOOR`.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — WHAT AI AUDIT STRUCTURALLY CANNOT DO

1. **Run the dress rehearsal (item 22), all five named items, with signatures recorded.** Live crank passes at ~2,100 vaults, the alarm in rehearsal mode, one full revenue cycle through EACH pool with Orca forced to refuse once, one forced post-sweep failure walked through the hand recovery to a clean `--audit`, and the DAS burned-asset read. No suite, sim or fork substitutes; this needs a human at a terminal moving small real amounts on the throwaway deployment, and it must be re-run at the release commit (item 53's proof is of `d57ee3a`).
2. **Witness the initialize ceremony.** `check-launch-params.mjs` validates the JSON, not the signed transactions (item 38, round-24 A6). A human must build the four `initialize` transactions FROM `launch/mainnet-init.json`, verify the signed bytes against it field by field, and fill the two OPEN values (`charter_opens_at`, `lock_deadline` ≥ 24 h before it) before anything is signed. No gate reads the signed bytes.
3. **Make the custody decisions only Gary can make.** The PoB collection hot wallet through the 7-day charter window (limit 46: it can end the project or capture the electorate; holding it cold or in a multisig for the window closes it — a physical act). The $CBOB release wallet (limit 56: move it to Gary's wallet or a Squads and delete the box key). The swap operator's "holds nothing but the cycle's funds" rule (limit 10 D2(1): nothing on chain enforces it; a human must keep it true).
4. **Bridge build-mainnet's "NOT PROVEN".** A second, independent machine rebuilding from the release commit and confirming the five sha256s. This process runs on the box that holds the keys, the ledger, the crontab and the alarm; it cannot vouch for that box's toolchain.
5. **Build AND exercise the holder surfaces (item 50).** The redeem page, the deposit-address page, the poster's sender. AI audit can prove `judgeRedemptionCoverage` pure and correct; it cannot click a real wallet (Phantom) through the prior-transaction ATA creation, the coverage warning, the 1,209-byte redemption and the frozen-pool variant on the rehearsal deployment. The guide may not be published before this ships.
6. **Stand up an off-box witness for the alarm.** Limit 10(3) is explicit: the ledger, the crontab and the alarm belong to one user on one box, so detection does not survive that box's compromise. A second host, second RPC provider, read-only, watching the same chain state (program hashes, pool solvency, revenue sweeps, the release wallet) is something this process cannot bootstrap from inside the trust boundary it watches.
7. **Drill the human at the end of the pager.** Trigger a real page on the rehearsal (stop the crank; freeze a test account) and confirm Gary receives it and acts. Every detector in this tree terminates at an SMS; if nobody acts on it, the detection stack is decoration, and no assertion measures that.
8. **Sign off the economics as a business decision.** The governance concentration (largest holder 17.1%, top three 37.9%, the 24.2%-unclaimed key-change path), the boost's "N distributions, not months" game theory, the 2.1%/hour rush behaviour, the 150 bps swap tolerance as a monthly cost. These are measured numbers a human must accept as product risk, not code properties an audit can pass.
9. **Certify any v1 writer before one exists.** SPEC's boundary is explicit: the reader's v1 support is reader evidence, and no CBOB v1 transaction is certified. If any client is ever built on v1, a human must set its message-configuration fields and measure its execution before it touches a real vault.
10. **Decide the poster's sender.** Automated new posts on @cbobtc need Gary's explicit go-ahead and a chosen website surface (item 50); the drafting half is proven, the sending half is a policy act.