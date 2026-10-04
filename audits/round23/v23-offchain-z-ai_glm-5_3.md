# Round 23 — off-chain audit of the whole v6 tree

**Verdict up front: NOT CLEAN.** No CRITICAL, no HIGH. Three MEDIUM (two in the alarm's coverage, one in the launch ceremony for $CBOB), ten LOW, and a repairs audit of round 22 that found two repairs incomplete (F2's BENIGN list, G1/G5's gate-and-doc follow-through) and one repair whose documentation half was never done (F8). R3 and R4 came back clean, and I state below exactly what I checked so it can be re-checked. Where I considered a finding and measured it away against the bundle's own green runs, I say so rather than leaving the next round to re-derive it.

---

## R1 — THE CRANK (`bank/crank.mjs`)

### What I verified sound (so the next round does not re-derive it)

- `readySlot` is a true lower bound on the program's A/B/C targets (hand-computed: no-skip case gives exactly 1016 for `reveal_slot` 1000; skips only push C later, and `RevealTooEarly` is benign).
- The reveal plan is strictly in mint order from `cfg.revealed_total`, breaks on benign and on fail, and cannot send out of order; the attribute hash is checked before any fee and the Borsh shape (`u32` count, `u32`-prefixed strings) matches `hashv(&[&attributes.try_to_vec()?])`.
- The F5 repair's weight algebra is exact: `w = total_active_weight + preJoinWeight − retiringWeight − expiringWeight` matches what the program's `join`/`retire`/`expire_boost` will have done to `total_active_weight`, including boosts on retired vaults; the preExpired owed formula (`atExpiry + level_weight × (acc − acc_old)`) equals the program's expiry-at-`acc_old` semantics, and the default branch happens to be exact for postExpires because expiry at `acc_new` preserves owed. Misestimates in either direction degrade to no-ops (the program skips `pay == 0`).
- The tick branch can only be planned when `waiting_to_join == 0` (preJoins non-empty forces `w > 0`), so the program's `JoinWaitingFirst` cannot refuse it.
- Instruction account lists match every `#[derive(Accounts)]` context I checked (reveal, capture, reschedule, retire, activate, claim, split, distribute, expire).
- The crank moves value only where the program pins it; the selftest's instruction-name and programId gates are real and can fail.

### R1-1 (LOW) — the BENIGN list covers the reveal lane's races but not the other lanes' "already done" refusals

**Construct:** `const BENIGN = /RevealTooEarly|AlreadyCaptured|AlreadyRevealed|RevealOutOfOrder|RescheduleTooEarly|MonthNotElapsed/` in `main()`, and the comment above it: "Each of these refusals means 'already done' or 'not yet'."

**What is gained:** false `FAIL` pages and `process.exitCode = 1` during ordinary concurrent traffic. Missing codes the crank's own hourly lanes can hit:
- `AlreadyActive` / `VaultRetired` on `activate` — a holder's own client (or any stranger: activate is permissionless and the product tells holders they never have to learn the word) activates between the plan read and the send.
- `AlreadyRetired` on `retire_burned` — any stranger retiring first (permissionless).
- `RevealWindowExpired` on `capture_entropy` and `NeedsReschedule` on `reveal_level` — a full pass at 2,100 vaults easily runs longer than the ~2-minute capture window, so a pass that straddles a window edge sends a capture the program answers "lapsed; reschedule" — which is exactly the next pass's plan, not a failure.

**Evidence:** run the crank live during a funded rush with concurrent holder traffic; the log shows `FAIL activate <asset>: … AlreadyActive` for vaults activated seconds earlier, and the next pass plans nothing for them. For the window straddle: a `--live` full pass whose start slot is within ~300 slots of a queued vault's `reveal_slot + 300` shows `FAIL capture … RevealWindowExpired`.

**Fix:** extend the regex with `AlreadyActive|AlreadyRetired|VaultRetired|RevealWindowExpired|NeedsReschedule`. Each is "done by other traffic, or not yet" by the list's own definition.

### R1-2 (LOW) — the burned filters are `=== 'burned'`, so a burned vault that reads as anything else is paid and joined

**Construct:** `planCrank`'s claims loop (`if (assets[r.asset] === 'burned') continue`), the preJoins loop, and the joins-after loop. The `assets` map classifies a null RPC answer as `'other'`.

**What is gained:** the crank's own header and accepted limit 27 claim "The crank never pays or joins a positively burned vault." A burned vault whose asset read returns null (transient RPC degradation in `getMultipleAccountsInfo`) classifies as `'other'`, passes all three filters, and is paid into its cbBTC account behind the burned asset — the exact unrecoverable cost limit 27 exists to avoid — and, if pending, is joined as dead weight. It is also never retired (`retireBurned` requires `=== 'burned'`).

**Evidence:** the classification code is three lines above the filters; a unit arm feeding `assets: {[asset]: 'other'}` for an active owed vault produces a claim batch containing it (the program's `claim` does not check liveness — limit 27 says so).

**Fix:** in the claims/preJoins/joins filters, require `assets[r.asset] === 'live'` (skip anything not positively live), matching the round-21 positive-identification discipline the program already uses. A transient misread then costs one delayed payment, not a payment into a dead account.

### R1-3 (LOW) — the fee floor is smaller than one full pass, and the refusal message claims otherwise

**Construct:** `FEE_FLOOR_LAMPORTS = 5_000_000n` and `judgeFeePayer`'s message "below the ${floor} it needs for a pass."

**What is gained:** a launch-scale burst pass costs more than the floor: 2,100 activations + 150 claim batches + a reveal/capture backlog is 10.5M + 0.75M + up to ~21M lamports ≈ 0.03 SOL, six times the floor. The check runs once at pass start, so a burst pass drains the key mid-pass and pages with `insufficient funds` failures.

**Evidence:** plan length × 5,000 lamports per signature vs the floor; arithmetic above.

**Fix:** size the floor against the plan (`(plan.activate.length + claims + reveals + …) × 5,000 + margin`), or raise the floor to ~0.05 SOL and fix the message.

### R1-4 (LOW, doc) — the F8 repair changed the behavior and left four doc sites describing the old refusal

**Construct:** `judgeFeePayer` now runs and warns above the ceiling (round 22, F8 — the repair is correct). Still claiming the old behavior: `crank.mjs`'s own header ("the crank REFUSES to run if it holds more than a small ceiling"), SPEC.md's control-table row ("is refused above 0.25 SOL"), `scripts/cron-install.sh`'s posture print ("which it refuses above 0.25 SOL"), and the round-23 audit brief itself.

**Gain:** an operator reading the docs believes a honeypot guard exists that does not; the actual control is the SMS page, which the docs do not mention.

**Evidence:** diff the four quoted strings against `judgeFeePayer`'s `ok: true` above-ceiling branch (asserted by the selftest).

**Fix:** update the four sites; the selftest arm is already correct.

---

## R2 — THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

### What I verified sound

Every R2 charter item is present and both-ways tested: pending guardian/swap operator (standing CRITICAL), PoB collection plugins and update authority (in WATCH, produced, drift-compared), redemption window near-full (A3's idle-window fix is real), frozen/insolvent/unreadable pool, distribution overdue plus the three stalls, lock date (A5's repair reads `mainnet-init.json`), and the full production `want` list including 21%/51%/3 days/7-day notice/tighten bounds/30-day month/3600 window/2,100 supply/census/wiring/PoB root/charter length/boost bounds. A1's inner-burn fix is correct and the laundering route stays closed (top-level burn of the same asset stays CRITICAL; a burn of a *different* asset under a real `burn_vault` stays CRITICAL). A2, A6, A8, A9 repairs verified. The deadman cron line is correct for both the missing-file and stale-file cases.

### R2-1 (MEDIUM) — `revenue_ledger_unreadable` CRITICAL fires on every pass from the first pass after install, and nothing in the launch ever creates the file

**Construct:** `alarm.mjs` `main()`: `try { led = JSON.parse(fs.readFileSync(LEDGER, 'utf8')) } catch { led = null }` → `D.detectUnreconciledRevenue(led)` → for `null`, a CRITICAL. `bank/revenue.mjs` only writes the ledger inside a live cycle (`save()` after the first confirmed sweep); a dry run never writes it; `--audit` calls `load()` which reads but never writes. No road step creates it.

**What is gained:** from the first alarm pass after cron install until the first *live* revenue cycle — plausibly weeks, since royalties require secondary sales which require vaults — the pipeline pages CRITICAL every 30 minutes about a file whose absence is the normal pre-revenue state. This is the exact cry-wolf cost this project names as its own worst detector failure, aimed at the channel that must carry a real missing-ledger event (the file deleted by whoever holds the operator key — the one attack this detector exists for).

**Evidence:** run `node bank/alarm.mjs --dry-run` on a fresh checkout/deploy with no `revenue-ledger.json`: the report's CRITICAL section contains `revenue_ledger_unreadable`. Grep the road table and `revenue.mjs` for any writer before the first cycle: there is none.

**Fix:** apply the marker discipline `lock.mjs` already implements and `alarm.mjs` already uses for its own state: read the ledger with `readLedger(LEDGER, {cycles:[]}, LEDGER + '.has-run')` semantics — missing with no marker is a first run (quiet or INFO), missing with the marker is the CRITICAL it should be. Or create `{"cycles":[]}` in the launch road next to step 10's ATA creation.

### R2-2 (MEDIUM) — nothing watches the revenue PDA's SOL: an unswept royalty pipeline is silent in both directions

**Construct:** the only reader of the revenue PDA's lamports anywhere in `bank/` is `revenue.mjs` itself (`conn.getBalance(REVENUE)`), the actor whose absence is the failure. `alarm.mjs` reads the revenue *ATA* (cbBTC, for `detectUnsplitRevenue`) but never the PDA's SOL. The deadman watches the alarm's state; the cron `flock -n` fails silently if the revenue process hangs; the installed default posture is DORMANT.

**What is gained:** if the revenue cron is never armed, is stopped, or dies before the sweep (all pre-cycle, so no ledger row exists and no `unreconciled_swap` can fire), royalty SOL accumulates in the revenue PDA indefinitely and the holders' 85% of it never reaches the pool. The pool drains, distributions pay nothing, and `distribution_overdue` stays quiet because it only pages when `poolAvail > 0`. The alarm's charter is "NOTICE ABSENCE"; this is the one money pipeline whose absence is invisible.

**Evidence:** grep `alarm.mjs` and `crank.mjs` for `getBalance` — only the crank's fee payer. A dress rehearsal with the revenue job deliberately left dormant and a test royalty sent to the revenue PDA produces zero findings across arbitrarily many passes.

**Fix:** read the revenue PDA's lamports each pass and page (HIGH, grace ~24h) when it exceeds a threshold — e.g. `sol_reserve_lamports` or the sweep cap — mirroring `detectUnsplitRevenue`'s shape. This also gives a free watch on the rent floor item 52 depends on.

### R2-3 (LOW) — the first pass after each `initialize` reports every fixed-forever value as a CRITICAL drift from null

**Construct:** `alarm.mjs`'s idle branch writes state with `mint._missing: true` (or the busy path with `gov._missing`/`burn._missing`); the next pass's `detectConfigDrift` compares `null → value` for every watched key of the newly initialized program.

**Gain:** a one-time flood of ~10–60 CRITICALs with misleading texts ("a vote replaced it") at a known ceremony moment; the SMS carries only the first one, but the report teaches the reader that mass CRITICAL is normal.

**Evidence:** deploy order is SEAL→MINT→BURN→GOV (road step 10); any alarm pass between MINT's initialize and GOV's produces `gov.*` drift CRITICALs on the following pass.

**Fix:** treat `_missing → present` as adoption (skip drift for keys whose program was `_missing` in `prev`).

### R2-4 (LOW) — `detectRevealStall`'s inputs are outside the produce-check

**Construct:** `detectRevealStall` reads `mint.revealed_total`, which is not in `WATCHED_KEYS`; `missingWatchedKeys` therefore does not guard it. It is produced today (flatten covers the whole struct), so this is a gate gap, not a live bug — same class as R6-1.

**Fix:** add `mint.revealed_total` (and `mint.active_count`, used in the overdue detail) to `WATCHED_KEYS`.

---

## R3 — THE LAYOUTS (`bank/layout.mjs`)

**No findings.** What I checked, so it can be re-checked:

- The `MintConfig` and `VaultRecord` field lists match the bundled Rust structs name-for-name and type-for-type, in order (I compared them by hand, all 65 + 20 fields).
- I recomputed the offsets by hand: `minted_total` 141, `bare_burns_retired` 454, `governance` 41, `charter_closes_at` 442, `sales_stopped` 191, `sweep_stopped` 192, `sales_stopped_at` 518, `sweep_stopped_at` 526, `sweep_floor_lamports` 631, `cooldown_ceiling_secs` 639, `reserve_ceiling_lamports` 647, `max_boost_weight` 711, `max_boost_epochs` 712, `collection` 9, `version` 8 — every one equals the offset the programs pin and the layout computes, and the fixed length (1005 + 256 padding; VaultRecord 211 + 10) matches the Rust space expressions.
- The gates are real: the strict parser throws on what it cannot read (L1), the L2 check compares every scraped `OFF_` constant (none scraped-and-ignored), L3 reads the Rust constants rather than typed literals, and a struct edit in either direction fails the equality. A struct change cannot slip past these.
- **Do not re-litigate the collection layout:** bytes 1..33 as the update authority looks wrong if one assumes Borsh `Option<Pubkey>` tagging, but the 720-assertion suite and the 59/59 sim both initialize against real cloned mainnet Core through exactly this parse (`CollectionNotOurs` would refuse on a wrong offset), and `probe-mainnet-facts.mjs` asserts against live mainnet. Per this project's own rule, that is a claim about my reasoning, not about the code.

---

## R4 — THE MONEY ARITHMETIC (`bank/accrual.mjs` vs MINT)

**No divergence found.** `credit`, `ceilSats`, `available`, `pendingScaled` (= `owed_of`, including the add-carry-before-subtract order), `reweigh`, and `debtAtActivation` are the Rust formulas exactly (BigInt trunc division = Rust integer division in all cases here). The crank's `splitToPool = total − total*1500/10000` equals the program's floored-bank-cut/holders-take-remainder. The preExpired/postExpired claim algebra matches the program's expiry semantics to the scaled unit (including the case where the crank's `expire_boosts` send fails and the claim's in-line expiry is the backstop). The alarm's `poolAvailable` and `owedCeil` match `ceil_sats`.

**R4-1 (LOW, doc — a round-22 repair not applied):** G5 said the `accrual.mjs` header overclaims `retire`. The header still reads "the Rust formulas, line for line (`credit`, `claim`, `retire`, `ceil_sats`)" and there is no retire mirror — only a property assertion. Fix the header or add the mirror.

---

## R4b — THE BOOST OFF CHAIN AND `launch/create-cbob-token.mjs`

**Verified:** the crank expires due boosts before its distribution and its own-distribution dues right after (and the program's `BoostsExpireFirst` plus claim-side expiry backstop both directions); the owed math carries `boost_weight` and `carry_scaled` exactly as `owed_of`; the alarm pages `boosts_stalled` and watches `cbob_mint` and both bounds as CRITICAL-fixed-forever. `EXPIRE_BATCH` (20) ≤ `MAX_EXPIRE_BATCH` (30), gated.

**The mint-creation asks are satisfied:** the creation is one atomic transaction (create mint, initialize with freeze authority `null`, create ATA, mint the full supply, write metadata, revoke mint authority), so no partial state can survive; every fact is read back (supply, decimals, both authorities, release balance, name/uri/update authority/mutability) and a wrong read exits 1 with `verified: false` in the record.

### R4b-1 (MEDIUM) — the entire $CBOB supply is held by a single key generated on the box, with no custody decision recorded anywhere

**Construct:** `loadOrMake(RELEASE_KEY)` in `create-cbob-token.mjs` — `Keypair.generate()` written to `/opt/cbob-vaults/bank/keys/cbob-release.json` (0600, beside the swap-operator key) — while the *same script* deliberately routes the far less valuable metadata authority to Gary's wallet because "a box key would let a box compromise repoint the icon at a scam."

**What is gained:** a thief of that one file holds 100% of a fixed-supply token and can dump it on any pool that ever forms; a lost file strands the supply permanently and kills the boost feature (burners can never buy). The "it cannot print" property the token exists to demonstrate is matched by an unaudited, unbacked, single-file custody of everything that can ever be sold. No ruling, road step, or doc names this key's custody.

**Evidence:** the script is the only writer; `launch/mainnet-init.json` and the road table mention the swap operator's and crank's keys but not the release wallet's.

**Fix:** before `--execute` on mainnet, generate the release wallet offline (the script already loads a pre-existing key file, so an offline-generated key at that path works), record the custody/backup ruling in `mainnet-init.json` alongside `swap_operator`, and consider Gary's wallet or a multisig as the holder.

### R4b-2 (LOW) — MINT's `BadBoostSetup` does not refuse a non-payment reserve mint as `cbob_mint`

**Construct:** MINT `initialize` refuses `cbob_mint == payment_mint` and `== GARY_MINT` only; `check-launch-params.mjs` additionally refuses all three reserves. So $GIRAFFISH as `cbob_mint` is refused only by the off-chain gate, and the on-chain refusal the control-table style would cite does not exist for that case.

**Gain:** none today (the gate runs before `initialize` and `cbob_mint` is written once), but the enforcement is procedural where the program could have refused it, and the gate is stricter than the program without a comment saying so.

**Fix:** none required pre-lock; add the reserve check to MINT only if another build happens, otherwise note the divergence in `check-launch-params` so nobody "fixes" the gate to match the program.

---

## R5 — THE SWAP HOP (`bank/revenue.mjs`)

**Verified:** the worst case is as SPEC states it — per-sweep cap (10 SOL ruled) × cooldown windows (4/day at 6 h) until the guardian stops it, never more than the revenue PDA holds above the 0.05 SOL reserve; a vote can only tighten inside the initialize bounds. The ledger cannot read a failed cycle as closed: `cycleIsOpen` is the one imported predicate; a rejected send (nothing moved) closes, a confirmed-but-unreturned sweep stays open, a returned-but-unsplit cycle stays open, and the S6 recovery (empty revenue ATA proves a split) is sound in both the one-cycle and two-cycle cases and fails closed on an absent ATA. Nothing in the file sends value anywhere unpinned except the ruled trusted hop, and the Jupiter transaction is inspected (exactly one signer, no loader/MINT, ≤4 ATLs) before signing. The S4 floor fix (hold the result to `otherAmountThreshold`, refuse before signing if the guaranteed minimum is under the drift floor) is correct.

**Note (ties to R2-2):** the pre-sweep failure modes — dormant cron, crash before the sweep, `--live` never armed — produce no ledger row and therefore no detector output. The in-flight and post-sweep failure modes are well covered; the on-ramp is not. The `fetch` calls carry no explicit timeout (undici's defaults bound a hang, and a throw pages), so the realistic silent case is the job simply not running.

---

## R6 — THE GATES (`bank/selftest.mjs`, `scripts/run-tests.sh`)

**Verified:** the floors demand equality (no slack); the `everywhere` gate fails on zero occurrences; the DAS-reader discovery is not a hardcoded list and asserts the alarm is still found; the cron-preservation gate executes the real shell logic both ways; the lock gates cover the F3/F4 interleavings; the control-table gate's string surgery actually discriminates all three classifications; the floors cannot be satisfied by deleting assertions (the count drops below an equality floor) or deleting files (a referenced file's absence crashes the suite red).

### R6-1 (MEDIUM) — the v6 wiring gate was not extended when round 22 added three detectors

**Construct:** `V6_WIRED` in `selftest.mjs` is an 11-name list ending at stage 4. Round 22 added `detectUnsplitRevenue`, `detectFrozenVaultAccount`, and `detectRevealStall` — all called in `alarm.mjs` today, none in the gate. This is the wired-to-nothing gate whose entire purpose is to catch a future edit dropping a detector's call, and the round that added three detectors did not add them to it. (Round 22's G1 was "gate assertions claim more than they check"; this is that repair left incomplete.)

**Evidence:** the literal list vs `alarm.mjs`'s call sites; stub `D.detectUnsplitRevenue` out of `alarm.mjs` and the suite stays green — that is the demonstration.

**Fix:** add the three names (and see R2-4 for the WATCHED_KEYS half).

### R6-2 (LOW) — the poster's no-sender gate excludes its own blind spot

**Construct:** the sender scan filters out lines matching `/new RegExp|SENDER/` before testing. A future posting client whose variable is named `SENDER…` on one line is invisible to the gate that exists to catch it.

**Fix:** exclude only the gate's own construction lines (by line number or a narrower literal), not any line containing "SENDER".

### R6-3 (LOW) — the poster has no unresolvable-cursor check

**Construct:** `redemption-poster.mjs` `main()` uses `signaturesSince` with a persisted cursor; an unresolvable `until` returns an empty list (measured, round 6), so a corrupted `poster-state.json` cursor silently blinds the poster forever. The alarm's `scan_cursor_unresolvable` covers only the alarm's own cursors. Drafts-only job, hence LOW.

**Fix:** copy the alarm's resolvability check, or page on `sigs.length === 0 && st.cursor`.

### R6-4 (note — a round-22 item not applied) — G2: the mainnet probe skip is still not a ship-gate condition

A green `run-tests.sh` on a box with no DNS still certifies without the 24 live-mainnet facts, and the ship gate's five conditions do not require a probe-inclusive run. Add "at least one gate run with the probe executed" to the ship gate or the road.

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

**1. Is any limit WORSE than stated?**
- **Limit 27's control is overstated.** "The crank never pays or joins a positively burned vault" is implemented as `=== 'burned'`, not `!== 'live'` — R1-2. The *cost* is stated correctly; the *control* is not.
- **Limit 28's "(joins still go through)" under a frozen pool** is true only for pure-join claims; a mixed claim batch reverts entirely on the first pool transfer. The crank avoids mixed batches when the pool is frozen (it plans no claims), so this is a stranger's-client footnote, not a material worsening.
- **Limit 32's cap is computed on a live count that includes unretired bare burns** (live = minted − redeemed − *retired* bare burns), so the redemption cap is slightly looser than 2.1% of true live supply for up to the crank's one-pass window. This is inside limit 27's dead-weight cost and bounded by the hourly retire pass; noting it so the next reader does not file it as new.
- Everything else I re-derived (25, 26, 29, 34, 35, 36, 37, 41, 42, 46, 47, 49, 55) matches its stated shape and cost.

**2. Is anything listed as a limit not actually a limit?** No. I specifically checked the newly claimed controls: limit 25's `reveal_queue_stalled` and limit 28's per-pass reserve-state reads are real code, both-ways tested. Limit 43 remains honestly unbuilt.

**3. Is any DISCHARGED item not actually discharged?** No. I verified 19 (no activated-but-unlevelled state can exist: `activate` requires level 1..5), 14 (`DuplicateAttribute` on both mint paths), 30/31/33 (the values are `initialize` parameters exercised by the suite), 15 (`VaultTooNew`), 20 (`ClaimDeferred` on chain, `claim_deferred_frozen` in the alarm), and the Bank-family deletions are real (the selftest gates the retired files, keys, and importers, and can fail).

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No demotions found: item 22 is still road step 8, item 50 is still open with the poster still senderless, item 51's `cbob_mint` is still OPEN and the gate still refuses it. **But the documentation of item 38/51 is stale in the safe direction:** `mainnet-init.json` now marks `swap_operator` and the three sweep values RULED, while SPEC item 38, item 51, and road step 6 still call the swap operator key OPEN and the sweep values PROPOSED. Also the road's sim row says "59/59" against the runner's 60-assertion sim floor — a phrasing the `everywhere` gate does not read, which is precisely the stale-number shape that gate exists for. Fix the three sites (LOW, doc).

---

## ANYTHING ELSE

- **The bundle omits:** SEAL/BURN/GOV `lib.rs`, `tests/3prog.test.ts`, `sim/`, `HOLDER-GUIDE.md`, `DESIGN-v6.md`, `probe-mainnet-facts.mjs`, `rehearsal-tree.sh`, `pob-merkle.mjs`, `FREEZE.md`. I could not read them. The control-table gate parses the three programs' error enums at runtime on the box — a real check I cannot run — and BURN's rate-ring arithmetic is mirrored here only from SPEC and the layout. Item 50's classification rests on a holder guide this round never saw.
- **A17 is still the single unverified fact the burn-detector layer rests on**, and it cuts both ways: if Helius `getAssetsByGroup` omits burnt Core assets, `detectIndexShortfall` pages CRITICAL from the first redemption forever; if it returns them without the `burnt` flag, `vault_burned` never fires and redemptions surface only as `reserve_fell`/`vault_left_index`. Round 22 marked it UNVERIFIED; nothing since has measured it. This must be a named dress-rehearsal pass/fail item.
- **A vote can arm an off-curve guardian or swap operator** (GOV cannot check on-curve; `is_on_curve` panics on BPF). An off-curve guardian is a silently disarmed brake that looks armed; an off-curve operator permanently kills the sweep. Both are recoverable by another vote+notice and both fail safe, but the launch gate can and should refuse off-curve values for both keys (`PublicKey.isOnCurve`; `isKey` currently only checks 32 decodable bytes) — LOW, pre-lock only.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

What AI audit structurally cannot do, and what should therefore be done before the authority is removed — each concrete, each a checkbox:

1. **Measure A17 against live mainnet before the dress rehearsal pays anyone.** One script against a real Core collection containing burnt assets: assert `getAssetsByGroup` returns them *and* populates `burnt`. Both failure modes are named above; either degrades a CRITICAL detector on day one of redemptions. No amount of reading `detectors.mjs` can answer this.
2. **Exercise the launch-day state machine exactly once, for real.** The alarm's first-pass baseline adoption, the initialize drift flood (R2-3), the missing-ledger page (R2-1), the `.has-run` markers, the acks file — these are one-shot behaviors against a live chain that no local suite creates and that cannot be re-observed without redeploying. Make the rehearsal initialize with the *ruled* values so the production checks are exercised rather than paged.
3. **Have a second person derive the launch values independently.** `check-launch-params.mjs` pins values the same author typed into `detectors.mjs` and the PINS table; the gate cannot detect a pin that is wrong at the source. Someone who did not write the file derives each value from the ruling documents and diffs against `mainnet-init.json` before anything is signed.
4. **Randomized differential testing of the pool arithmetic.** Run the on-validator Rust against `accrual.mjs` over millions of randomized distribution/claim/boost/expire/retire sequences, asserting the one invariant that must never break — pool balance ≥ `ceil(owed_scaled)` — and exact agreement per vault. The suite samples this arithmetic; it does not prove it, and it is the money code that becomes permanent. AI reads; only a fuzzer runs.
5. **A key-custody ceremony for the three hot keys, in writing, before they exist.** The swap operator, the crank fee payer, and — most of all — the $CBOB release wallet (R4b-1), which the current script generates on the box in the same breath as it refuses a box key for the icon. Generate offline, record backup and custody in `mainnet-init.json` next to `swap_operator`.
6. **Write the Metaplex-Core-upgrade runbook.** The alarm detects a Core hash change; the doc says "it detects, it cannot prevent." Decide now what a human does in the first hour — guardian stop, holder communication, marketplace liaison — because after the lock those are the only levers, and a runbook cannot be written by an auditor that only reads.
7. **A buyer-perspective read of HOLDER-GUIDE.md** by someone who did not write it, against the BUYER-FACING limits (9, 25, 26, 28, 41, 44, 46) and item 50's promises. The guide is the foundation of item 50's OPEN classification and was not in this bundle; the audit cannot check promises it cannot read.
8. **Turn item 22's chaos list into named pass/fail scenarios:** kill the crank mid-pass (the F3 lock), straddle a capture window in a live pass (R1-1), inject an RPC 500 at vault 1,900 of 2,100, run the alarm with the ledger absent, and run the poster with a corrupted cursor. Each of those has a finding above or a round-22 number attached; none of them is currently a gate.