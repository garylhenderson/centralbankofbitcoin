# Round 39, OFF-CHAIN pass: independent audit of the whole tree at `21f36e1`

**Method and its limit, first.** I read every bundled file whole and traced each off-chain plan against the bundled MINT source. I executed nothing: no selftest, no validator, no fork, no mainnet read. Every finding below therefore names the artefact that would exist if the claim is true, and where I could, the one-line mutation or RPC call that settles it. Where I could not establish a defect I say so rather than file one.

**Headline:** no CRITICAL, no HIGH. One MEDIUM that is a measurement the project has deferred past the point where its repair would be free (it lives in `bank/`, inside the freeze). Four LOWs, a handful of INFOs. Round 38's two breaking repairs (C01, C02) hold at every site I could find; its two documentation repairs (C03, C04) are present in the bundled SPEC.

---

## R0. Round 38's verdict and repairs

**C01 (frozen-pool joins never sent) — repair holds; no regression found.** `bank/crank.mjs` `planCrank` now has the `else if (poolOk && pool.frozen && plan.joins.length)` branch that batches `plan.joins` into `plan.claims`, and `main()` sends `plan.claims` unconditionally. I checked the program side the repair rests on: MINT `claim` on a pending pair does `require_keys_eq!(dest, r.vault_ata)`, joins when `dist_epoch > request_epoch`, and `continue`s with no token transfer, so a frozen pool cannot refuse it; `monthly_inline` inside that claim returns early after our tick (not due). The selftest arm `R38 C01` asserts `p.claims.length === 1`, the pair is `Rec0`, and `Object.keys(p.owed).length === 0`, which is what the crank sends, not what it plans. The other two sites of the same shape are correct: `plan.preJoins` were always sent unconditionally, and an unreadable pool (`poolOk` false) plans no tick and therefore no joins. The frozen-pool problem text in `crank.mjs` equals the string `detectCrankHealth` treats as covered, byte for byte.

**C02** — the `detectSweepState` JSDoc now says "within half a cooldown" and "no baseline-only first pass", matching the code. **C03** — SPEC limit 10 now says the 1% filter applies "at the read the swap is built from; the earlier read only decides whether to sweep at all", which is what `revenue.mjs` does (`m2.venues` is the only list the swap loop iterates). **C04** — limit 7 names the daily `--reconcile` and calls its stall silent. **V38-4** — limit 27 now says the cost falls on every other holder.

**Disproved claims I re-tested from source:** C07 (pre-created operator wSOL ATA with a stranger's close authority) is correctly disproved: the ATA program initialises with no close authority and `SetAuthority` needs the owner. C09 (`FLOCK=` override) is as the verdict says: `judgeCronTemplate` asks whether a live line defines `-n`, not whether a later line undefines it, and the gate's own docblock scopes that out. C14, C15, C16, C17 stand. C06 (poster wedge) is transient as stated because MINT `reveal_level` reveals a positively burned asset and the crank sends `[]` for one. C10's "a second swap can only spend the operator's float" is right only while the operator wallet holds nothing but its float (limit 10, D2); it is a custody rule, and the verdict says so.

**One thing round 38 did not look at, which I raise as F4 below:** the selftest's wiring gate (`L13b`) and the pinned-arguments gate (`I4`) cover `detect*` results. They do not cover the baselines those detectors read from. See F4.

---

## R1. The crank (`bank/crank.mjs`)

I walked every planned instruction against MINT's refusals: `reschedule_reveal`, `capture_entropy`, `reveal_level` (FIFO from `revealed_total`, hash checked first, `[]` only for a positively burned asset, 'other' skipped), `retire_burned` (positively burned, not retired, at any level), `claim` (pending pairs use `r.vault_ata`; active pairs only when the recorded account reads as a live Tokenkeg account; frozen deferred), `distribute(false)` (planned only when every eligible waiting vault is pre-joined, every due boost pre-expired, the month due by the chain clock, and either `avail > 0` with weight or the tick case with `pending_this_epoch` net of this pass's retirements), `activate` (live, revealed, not pending, canonical ATA ≥ 21,000, frozen allowed), `split_revenue` (all three accounts live and unfrozen, decimals as one byte), `expire_boosts` (non-empty, ≤ 20). The denominator the planner uses (`total_active_weight + preJoinWeight - retiringWeight - expiringWeight`) equals what the chain will hold after the retires, pre-joins and pre-expiries it sends first, and the post-credit owed figures for pre-joined, pre-expired and boosted vaults match MINT's `owed_of`/`reweigh` arithmetic exactly (checked line by line against `bank/accrual.mjs` and the Rust).

I did not find a plan the program refuses for a non-race reason, a payment or join to a dead vault, a reveal out of order, or any instruction that moves value anywhere MINT does not pin. The one send-ordering invariant the crank depends on (joins → expiries → split → distribute → post-expiries → activations → claims) is correct in `main()`, but it is **unasserted** (part of F4).

Two observations, not defects:
- `REVEAL_RENT_LAMPORTS = 16 × 6,960` uses the test validator's rent rate; mainnet is 5,080/byte, so the budget overestimates and the floor is conservative. Fine.
- The crank, like revenue, uses web3's default `Connection` (no timeout); limit 25/A1 covers it.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

Every item in the R2 brief is present and wired: fixed-forever drift at CRITICAL (the `FOREVER` arm covers them), pending guardian/operator as drift and as a standing CRITICAL, the PoB collection's plugins and update authority, `redemptions_near_cap` with the idle-window guard, `pool_frozen`/`pool_insolvent`, `distribution_overdue` with the three stalls, `program_not_locked`/`lock_deadline_unset` across all five programs including the sweep helper, and the production list (21%/51%/3 d, 7-day notice, the three tighten bounds, 30-day month, 3600 s window, census, mints, PoB root and collection, $CBOB mint and boost ceilings).

**A dangerous state read as quiet:** I did not find one that is not already written down (operator-wallet balances, per-asset PoB plugins, a lying RPC). What I did find is a state the alarm cannot judge at all until a fact it has never measured is settled: **F1**.

### F1 — MEDIUM — Item 22(5) is load-bearing for three detectors and its repair site is inside the freeze

*Construct.* `bank/alarm.mjs` `listVaults` splits DAS `getAssetsByGroup` items into `live`/`burnt` by `i.burnt`. `detectVaultSetChange` emits `vault_left_index` (CRITICAL, one-shot, urgent) for a vault that left the live set and is not in `burnt`; `correlateBurns` deliberately never downgrades `vault_left_index` (selftest: "a burn does NOT quiet vault_left_index"); `detectIndexShortfall` requires `|live| + |burnt| == minted_total` exactly and is a LEVEL CRITICAL with no ack; `reconcile()` sets `complete = false` on any index finding and then sends no recoveries.

*What goes wrong if DAS omits burned Core assets from group listings, or returns them without `burnt`.* From the first redemption on mainnet: every honest redemption emails a CRITICAL `vault_left_index` ("BARE Core BurnV1 looks like… All three need a human"), `index_disagrees_with_chain` pages CRITICAL on every pass forever, and the daily reconcile never recovers any kind. The alarm is the post-hoc control for items 9, 27, 41 and 44; it would be permanently loud and therefore unread.

*Why MEDIUM rather than a note.* SPEC lists 22(5) as "carried, A17" to be settled in the dress rehearsal (road step 8), which happens AFTER the freeze. If the answer is "no", the fix is in `bank/alarm.mjs` and resets the clean-round counter (gate 2). It is being deferred to the one point where it is most expensive.

*Evidence that would exist.* One `getAssetsByGroup` call today against any mainnet Core collection known to contain a burned asset: does the burned id appear, and with `burnt: true`? That needs no deployment. Alternatively, Helius' `getAsset` on a burned Core asset.

*Fix (cheap, and independent of DAS).* The alarm already reads accounts: for each `gone` asset, read it; Core-owned, one byte, `Key::Uninitialized` is positively burned (the same test MINT and the crank use), everything else is `vault_left_index`. Then `detectIndexShortfall` compares `live + positivelyBurned`. Make this change before the freeze, not after the rehearsal.

### F3 — LOW — The daily reconcile pages an un-ackable CRITICAL for a zero-balance classic account that a stranger can create for ~0.002 SOL, and that stream then masks a real one

*Construct.* `detectUndeclaredTokenAccounts` has no amount test (selftest: "an undeclared account with a ZERO balance still fires"); `ACKABLE_KINDS = {unredeemable_owner}`; the kind is `level`, and the router suppresses a non-urgent repeat on an open stream (measured in the H1 router arms: `SUPPRESSED`). `classifyPdaTokenAccount`, in the same file, IGNORES a 165-byte zero account ("its RENT is lost… a stated limit, not principal"), and the redeem page leaves such accounts untouched (e2e V1: "the empty ones untouched"). Two judgements of one fact, in one file, disagreeing.

*What an attacker gains.* For one `createAccount` + `initializeAccount3` (owner = a vault's deposit address; the rent is the attacker's loss, ~0.002 SOL), the vault's reconcile stream opens with a CRITICAL nobody can act on or acknowledge, and a LATER funded undeclared account on that vault (a holder's airdrop about to be destroyed) arrives as a suppressed repeat on the same `cbob-reconcile:undeclared_token_acct` stream. 2,100 vaults cost about 4 SOL to blanket.

*Evidence.* Feed `D.detectUndeclaredTokenAccounts('V', [ATA], [{address:'X', amount:'0'}])` → one CRITICAL (the selftest already asserts this); then `D.planAlarmNotices` groups both findings under one label.

*Fix.* Zero-balance classic 165-byte accounts: INFO (or a separate kind), matching `classifyPdaTokenAccount`; keep CRITICAL for funded and Token-2022 accounts.

### INFO — `distribution_overdue` during a pool freeze

During a Coinbase freeze all three layers decline to credit by design (`monthly_inline` returns on a frozen pool, the crank plans no credit). `distribution_overdue` (CRITICAL, level) nevertheless fires once the month plus grace passes, while `pool_frozen` has dropped to INFO. Gate it on `!pool.frozen`, or downgrade it while frozen; today it is a known-true-but-unactionable CRITICAL on every pass.

---

## R3. The layouts (`bank/layout.mjs`)

Every struct is declared once; the selftest parses the real `pub struct` with a strict parser (private/`pub(crate)`/multi-line fields throw), asserts type strings, every `OFF_*` constant any program pins (and refuses a scraped-but-uncompared one), `*_VERSION` constants in every program copy, `BOOST_RING`, the account `SPACE` constants evaluated from the Rust less padding (1005/211), and the suite's own offsets. **Round 24 D6 is answered:** the SEEDS assertion exists (eleven seeds scraped from `pub const *_SEED`, with mistyped and unmapped controls). I recomputed MintConfig's field order against the Rust: identical. The VaultRecord `level` offset the reveal lane filters on is 57, which `offsets()` yields.

No finding.

---

## R4. The money arithmetic (`bank/accrual.mjs`)

`credit`, `pendingScaled` (= `owed_of`: `(weight+boost)·acc + carry − debt`), `reweigh`, `ceilSats`, `available` (program refuses `PoolShort`; mirror returns 0 and the alarm reports it) and `debtAtActivation` (= `join`'s `w·acc`) match MINT line for line. The crank pre-expires every due boost (active, boost > 0, `dist_epoch ≥ boost_end_epoch`, not retiring) and post-expires every boost its own distribution makes due (`boost_end_epoch == dist_epoch + 1`); a burned boosted vault is retired, which unschedules the boost on chain, and the planner excludes it from expiry. `boosts_stalled` exists; `cbob_mint`, `max_boost_weight`, `max_boost_epochs` are fixed-forever CRITICALs. No divergence found.

---

## R5. The swap and the revenue cycle

**(a) Oracle math.** `sats = lamports·sol·10^(e_s−e_b) / (btc·10)` is correct for any sign of either exponent; integer division floors `expectedSats` and `minSats`, the conservative direction. `satsPerLamport` converts i64 prices to doubles: exact below 2^53 (BTC at 8 decimals is ~8.6e12), and it is used only for the 100 bps comparison, never for the floor. The floor is 150 bps under expectation; Orca's fee is 16 bps and SW.8/SW.9 on the fork recorded the ruled 10 SOL executing inside it.

**(b) Pyth.** The `PriceUpdateV2` offsets are right: disc 8, write_authority 32, `VerificationLevel` tag at 40 (Full = tag 1, one byte; Partial = tag 0 + u8 and is refused), feed id 41–72, price 73, conf 81, expo 89, publish_time 93. The fork's SW.7 cross-pins 93 independently (it rewrites that byte and `market()` accepts a 10 s price while the real one is minutes old). Owner = receiver plus address = `[u16 0, feed]` under the push oracle is sufficient: only the push oracle's PDA is the account's `write_authority`, and the push oracle refuses a non-monotonic `publish_time` and a mismatched feed id, so nobody can write an older or a chosen price without a guardian-signed VAA. The clock is the chain's Clock sysvar read in the same `getMultipleAccountsInfo` as the prices. The residual is the RPC (see the limits section).

**(c) Deviation filter.** `orcaSpot = (sqrt_price/2^64)^2` is token B per token A in raw units = sats per lamport (sanity: tick −88,733 at 16 spacing ≈ 1.4e−4 sats/lamport ≈ SOL $120 / BTC $86k). `meteoraSpot = 1/(1+bin_step/10⁴)^active_id` is the inverse of lamports per sat (sanity: 1.0015^5920 ≈ 7,130 lamports/sat). Both directions right; double precision cannot move a pool across a 100 bps gate.

**(d) Minimum out.** `guaranteed = m2.f.minSats` is the same floor the m2 filter assumed; Orca `other_amount_threshold` (exact-in, a_to_b) and Meteora `min_amount_out` both take the out-token raw amount, sats. Correct units.

**(e) The judge.** It pins the seven-instruction shape, both ATA creations (payer, address, owner, mint), the wrap amount, SyncNative, the venue's amount/floor/direction/limit, the pinned pool, our wSOL in and our cbBTC out at their slots, the signer slot, one close last, no priority fee, and the exact CU limit; Orca `has_one` and Meteora `has_one`/seed checks validate the remaining pool-owned accounts. The only residues are the ones round 25 D1 states (same tree, same user) and C12 (`host_fee_in`, a protocol-fee share).

**(f) Derivations.** Orca tick arrays: floor division on negative ticks (`Math.floor`) and the decimal-string seed are right; a_to_b crosses downward so current and the two below is the right set. Meteora: Y→X moves the active bin up; `floor(id/70)`; `[bin_array, lb_pair, i64 LE]`, `[bitmap, lb_pair]`, `[__event_authority]`; direction is inferred by the program from `user_token_in`'s mint. At a boundary crossed between read and send, or on an uninitialised array, the venue program refuses, which is the "refused" path to the fallback.

**(g) wSOL.** Exact-input sells `lamportsIn`; a pre-existing balance (round 33 arm) and the rent return with the close; native mint has no freeze authority; a delegate needs the owner's signature.

**(h) Failure and retry.** Meteora runs only on `refused` (preflight, landed-with-error, or expired-and-absent). A timeout error with a signature stays `unknown` and stops the cycle. I found no automatic double-swap path except the lagging-node case already filed as C10 (limit 10b).

### F2 — LOW — A broadcast whose HTTP response is lost leaves the ledger without the sweep's signature, and the alarm then pages a theft

*Construct.* All four hops use `sendAndConfirmTransaction(conn, new Transaction()...)`, which signs internally; the caller never holds the signature. A transport error after the node accepted the raw transaction (`fetch failed`, ECONNRESET, A1's dead socket) throws a plain `Error`. `classifySendFailure` returns `{outcome:'unknown', sig:null}` (the L3 arm asserts exactly this case) and `rememberAttempt` returns without writing anything when `sig` is null (the R26 arm asserts `saveCalls.length === 0`). The row has `intendedLamports` only.

*Effect.* The cycle stays open (the safe direction) but the sweep is on chain with no row that names it: the walk pages `unledgered_sweep` and the account-state check pages `sweep_unledgered_state`, both CRITICAL, both saying the operator key "is being used by someone else", for an honest cycle; recovery is by hand. The one page that must mean "thief" is also the page for a dropped TCP connection.

*Evidence.* A fake RPC that accepts `sendTransaction` and closes the socket before replying; the ledger row will have no `pendingSweepSig`.

*Fix.* Sign locally, persist `tx.signature` as `pendingSweepSig`/`pendingSwapSig`/… BEFORE `sendRawTransaction`, then confirm. Every send becomes accountable regardless of what the error object carries.

### (i) What an adversary can extract, as numbers

Per cycle: at most 150 bps of the sweep, plus whatever the two USD feeds moved in the last 180 s in the adverse direction (each already within 30 bps confidence). At the ruled 10 SOL cap: 0.15 SOL (~$18 at $120 SOL) per cycle; with the hourly job's measured cadence (one sweep per ~7 h) at most ~0.5 SOL/day, ~15 SOL/month, and only if royalties saturate the cap. A sandwiched Meteora execution cannot take more than the floor allows, which is why the deviation gate is a liveness filter and the floor is the money bound. Not material against the cap; the stale-oracle tail (a >1% SOL/BTC move inside 3 minutes) is rare and bounded by the same floor plus the move. **The operator key's worst case** is unchanged: cap × cooldown windows until the guardian stops it, now ~34 SOL/day for the honest job and 40 SOL/day for a thief who times `last_sweep_at + cooldown`, plus one cycle's cbBTC in flight.

**The ledger cannot read a failed cycle as closed:** `cycleIsOpen` closes only on `sendRejected` (set only from a `refused` verdict) or on a recorded split; a `sendRejected` row that in fact swept is caught by `unledgered_sweep` and `rejected_row_has_sweep` (both armed).

### INFO — a double refusal wedges the job by design

When both venues refuse after the sweep landed, the cycle stays open and every later run stops at the guard until hand recovery. That is the ruling (A3). If Gary wants the automatic path to survive a thin-liquidity hour, the safe extension is a swap-only retry of an open cycle whose sweep is confirmed and which has no `pendingSwapSig`; anything else risks the double swap the guard exists to prevent.

---

## R6. The gates

Floors: `DET_FLOOR=926` equals `FLOOR=926` and SPEC's "926 detector"; `MIN_ASSERTIONS=895`, `HOST_FLOOR=6`, `EXPIRY_FLOOR=4`, `SWAP_FLOOR=16` (I counted sixteen `rec()` calls in `swap-fork.mjs`), `LAUNCH_FLOOR=49`, `POB_FLOOR=14`, `MAINNET_FLOOR=33`; `web/test/run-all.mjs` floors sum to 618 as the validation states. Every floor demands equality. The "zero occurrences is a failure" rule in the SPEC-count gate is correct. `build-mainnet.sh` proves what it says for the four keyed programs (behavioural key test) and the helper (byte identity with the localnet build AND with `target/deploy`), and says plainly what it does not prove.

### F4 — LOW — The gates arm detector results, not the baselines detectors read; and the crank's send order is unasserted

*Construct.* `L13b` counts a `detect*` call only where its result is consumed; `I4` pins the arguments of `detect*`/`parseCbobLogs` calls in `main()`. Neither touches the lines that WRITE the alarm's baselines. Two silent mutations, each predicted to leave `node bank/selftest.mjs` at 926/926:
1. Delete `if (jr.value !== null) balances[l.key] = jr.value` in `alarm.mjs`. `balances` is then always `{}`; `detectBalanceDrops(prev.balances, {})` sees `after === undefined` for every vault and never fires again; the next state stores `{}`. `reserve_fell`, the only live-vault drain detector, is dead with every regex arm (`L7: alarm.mjs judges each element…`) still green.
2. Replace `vaults: setChange.trustCurrent ? vaults : (prev?.vaults || vaults)` with `vaults`. The `vault_index_shrank` guard's whole point ("do not adopt the list you just disbelieved") is lost silently; the detector arm for `trustCurrent: false` still passes.
3. Move the `plan.activate` loop above the `distribute` block in `crank.mjs`: the RT3-6 regression, unasserted; the round-24 `MonthNotElapsed`-benign rule now hides it as a quiet "done by traffic" every month.

Also, the round-24 section's claim "every repair armed in BOTH directions" is overstated for its source-regex arms (`L1`, `L3`, `L6b`, `I2` crank regexes; `L5`, `L7`, `L9`, `L10/L11`, `I5`, `D5`, `H1` alarm regexes): each proves a pattern is present, not that its result is used. Mutation 1 is a concrete case where the pattern is present and the behaviour is gone.

*Fix.* Extract-and-run arms for the two baseline writes (the R26/R28 harness pattern already does this for other fragments), and an `indexOf` arm over `main()`'s send blocks for the crank order.

### F5 — LOW — `scripts/rehearsal-tree.sh` does not patch `web/`

*Construct.* The substitution and the reverse-proof enumerate `programs bank scripts tests sim launch Anchor.toml`. `web/src/config.js` carries the five ids in `PROFILES.mainnet.programs` and `PROFILES.localnet.programs`, `web/deploy/rpc-proxy.mjs` carries `MINT`/`MINT_AUTH`/`CORE`, and `web/test/ids.test.mjs` asserts those equal `bank/layout.mjs`. In a rehearsal tree, `layout.mjs` is patched and `web/` is not: the web tests go red there, the pages and the proxy would relay to the production ids (the inert placeholder today), and the "no leftover 4-character prefix" check never looks at `web/`. SPEC 53's "the ids are the whole patch… measured 2026-10-04" predates `web/` (round 35).

*Evidence.* `git grep -l Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo web/` lists the files; `scripts/rehearsal-tree.sh` never lists `web`.

*Fix.* Add `web` to both lists in the script (and `web/src/generated/*` if any id is baked there), and amend 53. Item 53 is OPEN, so this does not break the streak; it should be done before the rehearsal that is supposed to exercise the redeem page (item 50 names it as a precondition of step 11).

### `web/test/`: can each test fail?

I found the files non-vacuous with these notes:
- `e2e-localnet.mjs` "gate 5: the claim paid something (the share was not zero)" asserts `owedNow > 0n`, which is the PLANNER's number, not what the claim paid; it would pass if the on-chain claim paid nothing. The adjacent W2 arms (`delivered >= owedNow && delivered > 0`, pool fell by exactly `delivered`) carry the property; rename or delete the first.
- `ids.test.mjs` pins `dist/MANIFEST.txt` to commit `0b3ddb3` and `dist/SHA256SUMS` to `config.js`. That is intended binding, but it means `dist/` is a build from a commit several commits behind HEAD while the suite certifies `target/deploy` built at HEAD. Nothing compares the four keyed programs' `dist/` bytes with a fresh mainnet build at HEAD (`build-mainnet.sh` compares only the sweep helper). The release step must rebuild `dist/` at the release commit and update `config.js` (a `web/` change) in the same breath; today a rebuild would turn `ids.test` and `bundle.test` L4 red until that is done. Process, not defect.
- `tx.test.mjs`'s "error counts per program" is implied by the preceding wholesale equality; harmless.
- `ceremony.test.mjs` "step 0 makes a fresh keypair (signs once, never kept)" tests only `instanceof Keypair`; "never kept" is checked by a source regex elsewhere (`remember(...)`), not here.
- `plan.test.mjs`'s L2 order arm builds its expectation with `hex && otherHex`, which evaluates to the second string; it works but is easy to misread.
- `proxy.test.mjs`'s allowlist equality, `mock-rpc.mjs`'s `/report` comparison and the `diffIx` CONTROL are the right shape: each would fail on a drift.

---

## The four questions about the accepted limits

**1. Worse than stated.**
- **Item 22(5)** (F1): stated as "settling whether DAS sets `burnt`"; the unstated consequence is that three detectors and the reconcile's recovery logic are unusable if the answer is no, and the repair is a `bank/` commit.
- **Limit 10(b)**: SPEC trusts "the one RPC endpoint every price, pool account and floor is read through." The magnitude is not stated: an endpoint that lies about the Pyth account (price, or `owner`) and the Clock sets the floor arbitrarily low, and the DETECTION half is blind too, because `quotedSats` and the 2% `short_swap_return` tolerance come from the same read. A sandwiched cycle at ~100% loss would reconcile clean. One cycle ≤ 10 SOL; the holder guide's "refuses any price below a floor taken from Pyth's price feed" is conditional on Helius' honesty. Cheap hardening: read the two Pyth accounts through a second endpoint and require agreement within the confidence bound.
- **Item 53**: "the ids are the whole patch" is no longer true of the tree (F5).

**2. Not actually a limit / already closed.** Limit 8's second half (DAS diff lagging the walk) was closed by round 28's `rememberRedemptions`; the text correctly describes only the surviving half. I found no item that is stated as a limit and is in fact closed. Limit 35 (the 10% turnout rule never binds at 21%/51%) is arithmetically true.

**3. Discharged but not discharged.** None. Item 54's figures are measured except, as it says, the 14-vault claim batch, which the expiry-budget gate's 20-record `expire_boosts` under 200,000 CU makes comfortable but does not prove.

**4. OPEN AND BLOCKING quietly treated as accepted.** Item 22(5) is the one being deferred to a point where it cannot be repaired without reopening the freeze (F1). Items 38, 50, 52 and 53 are still honestly open: `launch/mainnet-init.json` keeps three values OPEN and the checker refuses it; the guide is DRAFT and says "being built" (stale against "built and staged", INFO) and "Every opening is public. It is announced on X" (untrue until a sender exists; covered by 50's publication bar).

---

## Anything else (INFO)

- HOLDER-GUIDE "Activation is picked up automatically" is true only once the crank is armed with `--live`; it is installed dry-run. Put arming the crank in the launch runbook (step 10) explicitly.
- SPEC's control table row for `judgeRedemptionCoverage` parses as PROCEDURE because `bank/detectors.mjs` is the first `bank/*.mjs` in the row; correct today, fragile to editing.
- `MAX_PER_CYCLE_LAMPORTS = 50 SOL` in `revenue.mjs` is above the ruled 10 SOL chain cap; `sweepAmount` takes the minimum, so it is inert, but the comment "set this at or below the on-chain cap" is not followed. Set it to 10.
- `revenue.mjs` hardcodes `decimals = 8` for the split; the crank reads it from the mint. Both are right for cbBTC; one source would be better.

---

## What this project should do before launch that AI audit structurally cannot

1. **Make the DAS call today** (F1): `getAssetsByGroup` on a mainnet Core collection with a known burned asset, and `getAsset` on the burned id. If the burned asset is absent or unflagged, change `listVaults` to confirm burns from account bytes BEFORE the freeze. This is the single cheapest thing on this list and the only one whose late discovery costs a counter reset.
2. **Break a send on purpose** (F2): run one revenue cycle on the rehearsal with an RPC proxy that drops the response to `sendTransaction`, and watch which pages arrive. If the "thief" pages arrive for an honest hiccup, fix before launch; a human who has seen that page cry wolf once will not run to the guardian wallet the second time.
3. **Run the three mutations in F4** and keep the ones that go green as new arms. Thirty minutes.
4. **Verify alert delivery end to end**, not the router's `QUEUED`: a real `cbob-vault-alarm:unledgered_sweep` from the rehearsal must reach a human's phone, with the time from `last_sweep_at` to the stop measured. Limit 10's bound is "cap × windows until the guardian stops it"; nobody has measured the window.
5. **Reproduce the five `.so` files on a second machine** at the release commit and compare `SHA256SUMS`. `build-mainnet.sh` says reproducibility is "the whole claim" for the four keyed programs; no second build has been recorded.
6. **Rehearse the hand recovery of an open cycle** (item 22, step 4) with the real runbook text in limit 10, by someone who did not write it, and time it.
7. **Fund and watch the crank for a week on the rehearsal** with 2,100 synthetic vaults (item 22): the reveal lane keeping up during a burst, `getProgramAccounts` at that size through Helius, and the fee float.
8. **Patch `web/` into the rehearsal tree** (F5) and drive the redeem page against the throwaway deployment, since step 11 is conditioned on it.
9. **Decide the two custody questions nothing in this tree can decide:** the Giraffish Moments update-authority key through the charter window (limit 46) and the $CBOB release wallet (limit 56). Both are one-line rulings and both are the largest residual exposures on the list.