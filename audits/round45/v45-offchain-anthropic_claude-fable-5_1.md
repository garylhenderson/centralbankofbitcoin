# Round 45, OFF-CHAIN pass: independent audit of the whole current tree

**Bottom line first.** I find no CRITICAL, HIGH or MEDIUM. I find no path that moves or miscredits value, no plan the crank sends that the program would refuse for a reason the crank does not already treat as a race, and no money-arithmetic divergence between `bank/accrual.mjs`, `bank/crank.mjs` and MINT. I confirm every round-44 repair at its site and at the sibling sites of its shape. What survives is one LOW in the fixable layer (an attacker-reachable availability hole in the Meteora fallback that round 43's gate-5 item 5 already carries as a "premise to pin", but which the verdicts never stated as reachable for dust), and a set of INFO items: misleading pages, an understated bound, process and tooling coupling, and one measurement that should be done now rather than at the rehearsal. Under SPEC gate 3 the pass is LAUNCH-CLEAN on what I can read. Under the older clean-round rule it is not (the LOW changes code).

I say what I could not read: `bank/rehearsal-env.mjs`, `scripts/rehearsal-run.mjs`, `scripts/rehearsal-steps.mjs`, `web/src/**`, `web/build.mjs`, `web/test/ix.test.mjs`, `web/test/proxy.test.mjs`, `/opt/scripts/alert-router.py` and the `.gitignore` are not in this bundle. The crank, alarm and revenue job now import `rehearsal-env.mjs` for the RPC endpoint and for two forced-failure flags, so a security-relevant module sits outside what I audited; I rely on the selftest's R44 RE arms for its contract.

---

## R0. Round 44's verdict and its repairs

**Verdict re-read.** The five confirmed items and their classifications hold against this tree. The 26 disproved/not-defect dispositions I re-derived from first principles; I agree with all of them, with two qualifications below (C01, C20).

**Repairs verified at their sites and at sibling sites of the same shape.**

| Repair | Site | Verified | Siblings of the shape |
|---|---|---|---|
| V44o-1 poster per-signature unreadable count | `redemption-poster.mjs` `n = (st.unread?.[s.signature] ?? 0) + 1`; readable path deletes only `st.unread[s.signature]`; the count is written before the throw, the backlog deliberately not | Yes. Selftest R44 V44o-1 drives the real extracted loop in both the draining and the gapped case | The alarm keyed `unreadPasses` per signature already; `splitsSince` collects rather than counts. No other site |
| V44o-2 revenue split scan | `splitsSince` catches per signature, collects into `out.refused`; recovery fails the `recovery` stage naming the signature only if a returned cycle is still unsplit | Yes. R44 V44o-2 arms run the real `splitsSince` and the real recovery block | The poster and the alarm wrap `readParsedTransaction` in try; `probe-mainnet-facts.mjs` does not, so a refused read aborts the probe (fail-closed, acceptable for a hand probe) |
| V44o-3 SEAL-null baselines | `reserves` from `cfg` or the carried baseline; unbuilt stored legs carried and paged | Yes; the R44 V44o-3 arms run the whole balance block over three passes | The MINT-null case already returns early with state not advanced; nothing else builds legs |
| V44o-4 runner exit | both skip branches use `if … then die` | Yes (V44o-4 arm) | none |
| V44o-5 rehearsal notices | `rehearsalNotice` at the three crank sites and the one revenue site; `REHEARSAL_MARKER` is the root-mapped path | Yes (V44o-5 arms count the sites) | The alarm already tags; the poster has no notifier |

**Claims the verdict disproved, re-tested.**

- **C01 (tick/bin arrays never checked to exist).** I agree the Orca premise is false at today's program: the Whirlpool "sparse swap" accepts an uninitialised tick array at its derived address. This is SDK/IDL evidence, not a read of the deployed binary, which is why the gate-5 fork arm (clone only the active array) is still the right obligation. The Meteora half is unmeasured and would be a refused fallback, loud. I add one thing the verdict did not: see **LOW-1** under R5(f). The "premise" of C20 item 5 (the bitmap owner) is not merely unpinned; it is attacker-reachable for dust.
- **C09 (pre-funded wSOL ATA wedges the close).** Correctly disproved. Classic SPL refuses a close with a balance only for a non-native account; a native close returns everything to the destination. The operator wallet simply ends up holding the stranger's lamports, which limit 10 (1) already tells the operator to move.
- **C10 (`logMessages: []` accepted).** Mechanism accurate, correctly graded: an RPC returning a well-formed empty list for a transaction that ran is the trusted-RPC class.
- **C08 (`paged` on an undelivered pass).** Correctly judged: today the person receives a RECOVERED line for a stream that may be open; the alternative sends nothing.

**One verdict claim I would tighten.** C21 says the poster's VaultRecord read "needs a persistent RPC fault" to return null. True, but the poster's `main()` also reads `HELIUS_RPC_URL` from `/opt/gary-club/.env.local` directly rather than through `jobRpc()`, so inside a rehearsal tree the hand-run poster drafts from mainnet BURN history, not the rehearsal's (**INFO-8**). Harmless (it has no sender), inconsistent with V44o-5's intent.

---

## R1. The crank (`bank/crank.mjs`)

I re-derived every instruction's account list and writability against MINT's `#[derive(Accounts)]` structs: `reschedule_reveal`, `capture_entropy`, `reveal_level` (config W, record W, asset W, collection W, payer signer W, mint_authority, SlotHashes, Core, System), `rescue_nested` (config, vault W, collection, host, new_owner, payer signer W, rescue PDA, Core, System), `retire_burned`, `claim` (config W, pool W, Token, pairs), `expire_boosts`, `split_revenue` (config, revenue W, mint, revenue ATA W, pool W, Squads ATA W, Token), `distribute` (config W, pool), `activate` (config W, record W, asset, vault_token, pool). All match. Data encodings match Anchor's Borsh (`claim` crank_n = 0, `distribute` burn = false, `split_revenue` decimals byte, `reveal_level` Vec<VaultAttribute>).

**The planner against the program, rule by rule.**

- Reveal order: strictly consecutive from `revealed_total`, stops at the first record that is not `entropy_set` and not captured this pass. A race is `AlreadyRevealed`/`RevealTooEarly`/`RevealOutOfOrder`, all benign. Out-of-order is not possible from this planner.
- `readySlot` reproduces `try_capture`'s A→B→C stride exactly (1000→1016, 1003→1016, 1004→1020); the selftest L3 arm pins the Rust constants.
- Pre-joins before the distribution (`JoinWaitingFirst`); due boosts expired before (`BoostsExpireFirst`); post-expires computed as `boost_end_epoch === dist_epoch + 1`, which is exactly what `advance_epoch` makes due. A second distribution landing between plan and send leaves a due boost unexpired until the next pass, bounded by `boosts_stalled` (6 h grace).
- The frozen-pool tick and join-only batches (R37 C02, R38 C01): MINT's `distribute` with `w == 0` reads the pool but does not check frozen; `claim`'s pending branch moves no tokens. Both land. The R39 C01 extracted-send arm proves the joins leave `main()`.
- The weight the credit is planned against (`total_active_weight + preJoinWeight - retiringWeight - expiringWeight`) and `owedAfterRetire` match what `join`, `retire`, `expire_boost`/`reweigh` do to `total_active_weight` and `owed_scaled`. The planned per-vault `owed` for a pre-expired vault (`carry + w_level × Δacc`) equals MINT's `owed_of` after `reweigh` resets `debt` to `w_new × acc_old` and moves the old owed into `carry`.
- Nothing pays or joins a vault not positively `live`; a positively burned vault is retired first. A vault burned between the asset read and the send is limit 27, accepted.
- Value: the key signs as fee payer and as `payer` in `reveal_level` (Core rent, bounded) and `rescue_nested` (Core transfer payer, normally zero). No transfer, no program but MINT (selftest pins both).

**Plans the program would refuse, found: none new.** `expire_boosts` after a distribute that failed as a fault would skip not-due records rather than refuse (one wasted fee). `activate` for a canonical ATA with ≥ 21,000 sats: MINT's `read_token` requires the account's mint and owner to match, which the canonical derivation guarantees.

**INFO-7 (operational, carries limit 25 A1).** `new Connection(rpc, 'confirmed')` in the crank, the alarm, the revenue job and the poster has no request timeout. Round 25 A1 measured a socket that accepts and never answers holding web3.js for 300.8 s, longer than the whole 300-slot capture window, and the next minutes' `flock -n` runs skip silently. SPEC's limit 25 text says "the crank's and revenue's at `2b67fb1`", which reads as if it changed; it has not. *Evidence:* no `fetch`, `httpAgent` or `confirmTransactionInitialTimeout` option at any `new Connection(` in `bank/`; a `nc -l` that accepts and never writes reproduces the stall. *Fix:* pass a `fetch` with an `AbortSignal.timeout(10_000)` (or a short `httpAgent` timeout) to every `Connection`. One line per file, fixable layer, no program change.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

**Production values asserted:** `monthly_secs` 2,592,000; `redeem_window_secs` 3,600; `notice_secs` 604,800; floor 1 SOL / ceiling 24 h / 0.1 SOL; quorum 2,100; threshold 5,100; voting 259,200; supply, census, payment mint, treasury, reserves, PoB root and collection, charter length, $CBOB mint and the two boost ceilings. All present in `want`, each with a both-ways arm. The guardian, swap operator and the three sweep values are not on the list, as SPEC 38 states; their changes page as `config_drift`.

**Fixed-forever drift at CRITICAL:** every `initialize`-only field is in `WATCH` at CRITICAL (the FOREVER arm covers 15 of them; I checked the rest by eye: `pool_ata`, `governance`, `collection ×4`, `payment_mint`, `pob_collection`, `charter_opens_at`, `cbob_mint`, boost bounds). Pending guardian/operator: level CRITICAL every pass. PoB collection plugins hash and update authority: CRITICAL. All five programs' upgrade authority and bytes: CRITICAL; `program_not_locked` for `seal, mint, burn, gov, sweep`. Redemption window near full, frozen or insolvent pool, overdue distribution: present.

**Layout offsets the alarm depends on:** I recomputed MintConfig by hand: `governance` 41, `pool_ata` 73, `minted_total` 141, `sol_reserve_lamports` 257, `max_sweep_lamports` 266, `sweep_cooldown_secs` 274, `charter_closes_at` 442, `bare_burns_retired` 454; fixed part 1,005 bytes; VaultRecord 211 + 10 padding = 221. All agree with GOV's and BURN's `OFF_*` and with `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE`.

**A dangerous on-chain state read as quiet: none found that a stated limit does not already name.** I specifically tried: a sweep followed by no return (paged at 60 min); a sweep the ledger does not know (walk, plus the flood-proof `last_sweep_at` state check, whose half-cooldown window I confirm cannot be straddled by an honest row and a thief's sweep in either order, because `revenue.mjs` writes a row only after the on-chain cooldown has passed); an armed key change; the Core and third-party program bytes; a boost term vote; a round at the floor with cap 2,100 (HIGH drift on `mint.cap`/`mint.price`); the pool below what it owes (CRITICAL, read atomically with `owed_scaled`). One small blind spot, stated: the vault collection's own `update_authority` is not watched (only its plugins hash). It can only change through Core's `UpdateCollectionV1` signed by MINT's PDA, which MINT never calls, and a change would make every mint fail loudly, so INFO.

**A routine state paged every pass.**

**INFO-3.** During a Coinbase freeze of the pool longer than `monthly_secs + 6 h`, `detectDistributionOverdue` pages `distribution_overdue` CRITICAL (level, so once plus the router's reminders) with the text "The crank, the in-line monthly run and the free public call all failed to happen". The crank withholds from a frozen pool *by design* (`planCrank`: `joinable && poolOk && !pool.frozen`), and `monthly_inline` returns early on a frozen pool. The statement is literally true (anyone *could* call `distribute(false)`; MINT does not refuse it frozen) but attributes a design choice to a failure. *Evidence:* `poolAvail` is computed from `pool.state === 'ok'`, which `readTokenAccount` reports for a frozen account; nothing in `detectDistributionOverdue` reads `tok.frozen`. *Fix:* pass `frozen` and emit a distinct INFO (`distribution_withheld_frozen`), or amend the text. Fixable layer.

**INFO-4.** SPEC says a permanently unreadable signature "delays the drain by at most three passes". The alarm persists only *this pass's* counts (`unreadPasses: looked.unreadNow || {}`), so a signature attempted in pass N but not reached in pass N+1 (it fell beyond the newest-2,000 window when a flood arrived) restarts at "1 of 3" when the backlog resume reaches it again. The walk still converges (the backlog's `before` pins the window, so the next passes are consecutive), but the bound is up to five passes, not three; a stranger cannot prevent the skip, only buy two more passes. *Evidence:* two consecutive alarm logs showing "pass 1 of 3" for the same signature with an intervening pass that did not mention it. *Fix:* carry `unreadPasses` entries for signatures not attempted this pass, or state the bound as five. Documentation-grade.

**Also INFO (pre-launch, expected):** with the inert placeholders deployed under an upgrade authority and `lock_deadline` null, a production alarm pass today pages `lock_deadline_unset` CRITICAL every pass. Round 24 D5 designed that; I note it so nobody reads the stream as noise when launch day's real deploy lands under it.

---

## R3. The layouts (`bank/layout.mjs`, `bank/selftest.mjs`)

The field lists equal the Rust structs name-for-name and type-for-type (I compared MintConfig's 64 fields and VaultRecord's 20 against the bundled `lib.rs`). `parseRustStruct` is strict (a private, `pub(crate)` or unparseable line throws; the L1 arms show both). Order is compared (`JSON.stringify` of ordered pairs), so a reorder with the same names is caught. Types outside `FIXED` end the fixed region, so a retyped array would fail the equality arm first. Versions are scraped from every program's `*_VERSION` copy (L6), `BOOST_RING` from the Rust, `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` evaluated from the source (L13c), every `OFF_*` constant any program pins compared and nothing scraped left uncompared (L2). **Round 24 D6:** the SEEDS assertion now exists (12 of 12, both ways) — closed.

`decode` refuses a wrong discriminator, a wrong version byte, a truncated account and a bool outside {0,1}; `readPinned` refuses a wrong owner. A struct change cannot slip through: at build time the equality arm goes red; at runtime the version byte refuses.

---

## R4. The money arithmetic (`bank/accrual.mjs`)

`credit` (`delta = avail × 1e12 / w`, `owed += delta × w`), `pendingScaled` (`(w + boost) × acc + carry − debt`, refusing negative as MINT's `checked_sub` does), `reweigh` (owed → carry, debt → `w_new × acc`), `ceilSats`, `available`, `debtAtActivation` (= `join`'s `debt = w × acc`, carry 0) all equal MINT's `credit`, `owed_of`, `reweigh`, `ceil_sats`, `distribute`'s `avail`, and `join`. `retire` is not mirrored as a function and the header says so; the crank computes the retiring share with `pendingScaled`, which is MINT's `pending` in `retire`. No divergence.

The crank expires every DUE boost before it distributes and every boost its distribution makes due after; the alarm pages `boosts_stalled`; `cbob_mint`, `max_boost_weight`, `max_boost_epochs` drift CRITICAL and are pinned in production. Confirmed.

---

## R5. The swap and the revenue cycle

**(a) Oracle math.** `sats = lamports × sol.price × 10^(es−eb) / (btc.price × 10)` is exactly `lamports/1e9 × SOL_USD / BTC_USD × 1e8`; the negative-exponent branch multiplies the denominator; integer floor; the floor `× 9850 / 10000` floored again; both directions pinned by hand (280,355 / 276,149). `satsPerLamport` converts `price` (≤ ~8.6e12) to Number exactly. The exponent band −18..0 bounds the powers. The floor is 150 bps under the oracle, which is below Orca's 0.16% fee plus the measured impact of 10 SOL (SW.8/SW.9 record the executed price under the oracle).

**(b) Pyth.** Offsets recomputed: disc 8, write_authority 32, verification tag at 40 (Full = 1 and nothing follows; Partial = 0 + u8), feed id 41..73, price 73, conf 81, expo 89, publish_time 93. Correct. Ownership by the receiver plus the push-oracle-derived address is sufficient: the push oracle's `update_price_feed` only writes a Wormhole-verified `PriceUpdateV2` and refuses a non-monotonic `publish_time`, so nobody writes an old time or a chosen price without Pyth/Wormhole itself; the account cannot be closed by a third party. The clock is the chain's `Clock` sysvar read through the one RPC (limit 10(b)).

**INFO-2 (availability, fail-closed).** `MAX_ORACLE_FUTURE_SECS = 30` compares Pythnet's `publish_time` (≈ wall time) with Solana's stake-weighted `unix_timestamp`. When the cluster clock lags wall time by more than 30 s, which Solana has done in past congestion episodes, every price reads "stamped in the FUTURE" and every cycle is refused at the market stage until the clock catches up. Nothing moves; `royalties_unswept` pages after a day. *Evidence:* the revenue log line "is stamped Ns in the FUTURE of the chain clock" repeating hourly while `Clock.unix_timestamp` trails wall time. *Fix:* widen to 60–120 s (the 180 s age bound still bounds staleness), or state the dependency in limit 10.

**(c) Deviation filter.** `orcaSpot = (sqrt_price / 2^64)²` is B-per-A in raw units = sats per lamport. `meteoraSpot = (1 + bin_step/10⁴)^−active_id` is the inverse of DLMM's Y-per-X (lamports per sat). Sanity: bin 5,920 at step 15 ⇒ 7,140 lamports/sat ⇒ 1 SOL ≈ 140k sats ≈ $120 at $85.9k, consistent with the pinned fixture. Both are the right quantities in the right direction, compared to the same oracle ratio. Float error at the 100 bps boundary is ~1e-13 relative; the L6 arms sit at 99/101 bps on both sides.

**(d) Minimum out.** Orca `other_amount_threshold` (u64 at data[16]) and Meteora `min_amount_out` (u64 at data[16]) both carry `guaranteed = m2.f.minSats`, the same floor the post-swap `delta < guaranteed` check uses, in sats (cbBTC base units) on both venues. The rehearsal flag raises the Orca floor to `2 × guaranteed` only inside a recorded tree.

**(e) The judge.** It requires exactly seven instructions in the fixed order and checks: `SetComputeUnitLimit(400,000)` with no `SetComputeUnitPrice` anywhere; both ATA creations for the operator's own wallet and mint (payer, account, owner, mint); the wrap of exactly `lamportsIn` to the operator's own wSOL ATA; `SyncNative` of that account; the venue swap's pool key, input account (3 / 4), output account (5), signer slot (1 / 10), amount, floor, and for Orca exact-input, a_to_b and the minimum sqrt-price limit; one `CloseAccount` of the own wSOL back to the operator, last; no other Token instruction; no second signer. Everything value-bearing the venue does not itself bind is pinned. What a tampered *builder* could still route past it: Meteora's `host_fee_in` (a share of the pool's fee, never our output; round 43 C14) and nothing else; a tampered *tree* can edit the judge (limit 10(c)).

**(f) Account derivation.** Orca tick arrays `["tick_array", pool, String(start)]`, three for a_to_b (`s0, s0−span, s0−2·span`, `Math.floor` correct for negative ticks); oracle `["oracle", pool]`; vaults from the pool. Meteora bin arrays `["bin_array", pool, i64 LE]` for `floor(id/70)` and the two above for Y→X; bitmap `["bitmap", pool]`; `host_fee_in` as the program id; `["__event_authority"]`; both token programs. Account order matches the published DLMM `swap` interface (15 fixed, then bin arrays). Boundary: a tick exactly on an array start is that array.

**LOW-1 — the Meteora fallback can be disabled by anyone for about 0.00065 SOL.** `market()` sets `bitmapExists: !!bm`, and `meteoraSwapIx` passes the derived `["bitmap", pool]` address as a *present, writable* account whenever `bm` is non-null. The pinned pool has no bitmap extension today (the fork's existing-only clone list holds 22 of its 23 wanted accounts, and the bin arrays around the active bin all exist, so the absent one is the bitmap). A stranger who sends mainnet's 0-byte rent floor (650,240 lamports) to that PDA makes `getMultipleAccountsInfo` return a System-owned, data-less account; from then on `bitmapExists` is true, the swap names it, and DLMM's `Option<AccountLoader<BinArrayBitmapExtension>>` refuses it (`AccountOwnedByWrongProgram`) on every attempt. Nobody can remove the dust (the PDA is Meteora's), so the fallback stays dead until the pool's own liquidity grows far enough for someone to initialise the real extension. *What is gained:* denial of the fallback venue; whenever Orca is skipped (>100 bps from the oracle) or refuses, no sweep happens and royalty SOL waits, loud (`royalties_unswept`). No value leaves. *Why not MEDIUM:* availability of a fallback only, fail-closed, repair is one line off chain. *Class:* none of (a)–(d). *Evidence if I am right:* `solana account <meteoraBitmap()>` shows a System-owned 0-byte account after the transfer; `node bank/revenue.mjs --probe` then lists Meteora usable while a built Meteora swap fails preflight with Anchor error 3007. *Fix:* `bitmapExists = !!bm && bm.owner.equals(METEORA.program)`, and the fork arm round 43's gate-5 item 5 already asks for. I also recommend checking the same dust rule for Orca's two lower tick arrays (sparse swap treats a System-owned empty account as zeroed; lamports should not matter, but the fork arm with a dusted array settles it).

**INFO-6.** `readLbPair` reads `status` and `readWhirlpool` reads `liquidity`; neither is used. A DLMM pool with `status = 1` (disabled) is counted usable and refused on chain; an Orca pool with no liquidity in range would error. Both are loud. Skipping them in `market()` saves a failed attempt and a page.

**(g) wSOL.** Wrap exactly `lamportsIn`, sync, swap, close. A pre-existing balance, or lamports someone else sent to the ATA, joins the wrapped amount after `SyncNative`, is not sold (exact input), and comes back to the operator as SOL on the close. wSOL has no freeze authority; a delegate can only be approved by the operator. A partial fill against the minimum sqrt-price limit is a Whirlpool `PartialFillError`, so leftovers from a half-executed swap cannot occur; a Meteora shortfall fails the floor. Nothing stays wrapped (SW.1a/SW.4a).

**(h) Failure and retry.** Orca first; Meteora only after a `refused` verdict (preflight refusal, landed-with-error, or expired-and-absent). An `unknown` verdict records `pendingSwapSig` and throws, leaving the cycle open; the next run refuses at the guard. A swap that lands after a confirmation timeout is caught by the status lookup and recorded. The one residual: a swap judged "expired and never landed" because the RPC had not yet indexed a transaction that landed in its last valid block would let Meteora be tried too; the second swap's wrap needs `amount` lamports the operator no longer has (the float is 0.02 SOL), so it fails for any real cycle size, and if it somehow landed the whole operator ATA balance still returns to the revenue address. Bounded by the float. The ledger closes only on `splitSig`/`splitByOther`; `--audit` counts a refused intent as nothing swept (R37 C04).

**(i) What an adversary extracts.** With the floor at 150 bps under a 180 s-old oracle: a sandwich that pushes Orca to the floor captures at most 1.5% of the cycle minus its own two legs of 0.16% and impact in a ~$10M pool, about $14 on a 10 SOL cycle at $120; the cap and the 7 h effective cadence bound it to ~3.4 cycles/day, so ≤ ~$60/day and ≤ ~1.5% of royalties however large they get. Forcing Orca off the oracle by >100 bps at the read to reach Meteora costs the attacker a push in a $10M pool and buys the same 150 bps bound in the thinner pool. A stale oracle adds the SOL/BTC move inside 180 s, rarely >1% even in a crash. Material only as a permanent ≤1.5% tax ceiling on royalty SOL; SPEC's "does not establish a hard bound" is the honest statement. The operator key's worst case is unchanged: cap × cooldown windows until `emergency_stop_sweep`, never more than the revenue PDA holds above the reserve.

**INFO-9 (recommendation).** The hourly job and MINT's `last_sweep_at` make the honest cadence 7 h (SPEC round 37 C05). A second cron minute (`41,46 * * * *`) makes it 6 h 5 min: 3.9 sweeps/day instead of 3.4, no code change.

---

## R6. The gates

- Every floor is an equality (`-eq`); `floor()` dies on a missing count; `OUT=$(…) || RC=$?` prints before judging. The selftest's own `FLOOR = 1004` is equality. `SPEC` counts are checked at every occurrence with a non-empty requirement.
- `everywhere()` refuses zero occurrences; `.some`/`.filter(...)` arms cannot pass vacuously on empty input. The control-table parser requires ≥ 5 rows and classifies every row.
- Textual gates (regexes over source) remain in the tree (e.g. `crank.mjs is DRY-RUN unless --live`, `L2: refuses the split when it is not`, the V44o-5 site counts). They fail when the text changes, not when behaviour changes; the project's pattern of extract-and-run arms (R39 C01, V43o-3, R42 C01, V44o-2/3, the release gate) covers the money-moving sites. I found no round-24 arm that is one-directional: each repair arm I checked has a red counterpart.
- `scripts/build-mainnet.sh` proves the four keyed artifacts reject/accept the test key by behaviour and the sweep helper's bytes equal both the localnet rebuild and `target/deploy`; it checks `dist/` holds exactly five. **INFO-5:** it dies on any untracked file (`git status --porcelain` includes `??`). The round-44 verdict saw `?? .cache` and `?? cache-keypairs-backup-20261008.tar.gz` in this tree, yet `dist/MANIFEST.txt` reads `dirty no` and `web/test/ids.test.mjs` requires it. Either `.cache` was ignored when `dist/` was built and is not now, or `dist/` was built elsewhere. *Evidence:* `git status --porcelain` and `dist/MANIFEST.txt` side by side. *Fix:* ignore `.cache` and move the key archive out of the tree before launch day; do not use `CBOB_ALLOW_DIRTY=1` (the pages' build refuses a `dirty yes` manifest).
- `scripts/cron-install.sh` arms only from our tagged, uncommented full-pass and revenue lines, refuses a rehearsal tree, and the real preservation block is executed by the selftest. It arms nothing it should not.
- **INFO-10.** `web/test/ref.mjs` and `bundle.test.mjs` load esbuild from `/home/ubuntu/luna-remotion/node_modules`, and `probe-mainnet-facts.mjs` imports web3.js from `/opt/gary-club/node_modules`. The certifying run therefore depends on two other projects' unpinned installs; a removal or bump there turns `run-tests.sh` red (fail-closed) or, for esbuild, changes the bundle under test. Pin them in this repo.

**`web/test/` (the holder pages' offline tests).** Each file I read can fail when its named property breaks: `decode.test` compares against mpl-core's and spl-token's own deserialisers; `plan.test` compares whole legacy messages against the sim's S8 builders and drives every refusal and consent rule both ways (its `opens()` predicate requires a built burn that fits); `get.test` drives every claim/buy refusal and the real `readBuySnapshot`; `ceremony.test` round-trips every struct through the Bank's encoder and names every field unchecked by `compare`; `meta.test` checks byte-identical kept files; `tx.test` exercises a wallet that adds an instruction and one that forges a signature; `ids.test` checks the pins against `dist/SHA256SUMS`; `bundle.test` imports the browser-settings bundle and runs it. The hand-coded byte offsets in `ceremony.test` (261 for `charter_closes_at`) and `get.test` (`8+4+10+4+uri`) are correct for the Anchor argument order. Two arms compare computed-to-computed (`bundled judgeLaunch == node judgeLaunch`), which round 44 C13 already notes. The `mock-rpc.mjs` fixture is a fixture, not a test.

---

## The four questions about the accepted limits

**1. Worse than stated?**
- **Limit 10:** the Meteora fallback is less available than "only if Orca refuses" implies: anyone can disable it for dust (LOW-1). The money bound is unchanged.
- **Limit 25 / A1:** as stated and still unrepaired (INFO-7); the limit's wording implies the Connection changed since `2b67fb1`. It did not.
- **Limit 28:** not worse, but the alarm's `distribution_overdue` during a freeze (INFO-3) is a cost the limit does not mention.
- **Limit 7:** "survivable rather than silent" holds for the crank (heartbeat) and revenue above 1 SOL; a dead revenue job with under 1 SOL of royalties above the reserve is still silent indefinitely. SPEC states the 1 SOL threshold; I note the value at stake is under 1 SOL.

**2. Listed as a limit but not one, or already closed?**
- **Limit 8** is narrower than written: `rememberRedemptions` now correlates a DAS burn seen in a *later* pass than the walk (R28 arm). Only the stated direction (walk later than DAS) remains. Fine as written, could be tightened.
- **Round 24 D6** (SEEDS unasserted) is closed: 12 of 12 seeds asserted both ways.

**3. Discharged but not discharged?** None. Item 54's page obligation holds: the claim and buy pages send no crank (13 / 15 accounts, `get.test`). Item 51 is built and mirrored. Item 12/17 is measured.

**4. OPEN AND BLOCKING treated as accepted?** None. 22 is driven on a local chain only; 22.3–22.5 still need mainnet. 53's full-suite proof is at `2e8c979`, not the final commit. 50 is staged, not published; the holder guide is marked DRAFT. **INFO-13:** item 22.5 (does DAS set `burnt` on a burned Core asset) decides whether every honest redemption pages `vault_left_index` CRITICAL and whether `detectIndexShortfall` pages every pass after the first redemption (round 44 C24). It does not need our collection: any burned Core asset on mainnet (the two cloned Proof of Burns are live, but burned Core assets exist in abundance) answers it with one DAS call today. Measure it now, not at the rehearsal.

---

## Other observations

- **INFO-11.** In the rehearsal, `bank_treasury` is an on-curve throwaway while `detectors.mjs` hardcodes the real `CBOBTC_SQUADS` for `vault_awaiting_return`, so a rehearsal rescue lands quietly and that detector is never exercised live. State it in item 22.2, or accept.
- **INFO-12.** `bank/rehearsal-env.mjs` decides the production RPC endpoint and whether `CBOB_REHEARSAL_FAIL_AFTER_SWEEP` / `CBOB_REHEARSAL_FORCE_ORCA_REFUSAL` are honoured. The selftest's R44 RE arms say an override set outside a recorded tree is refused and a flag is true only for exactly `"1"` inside one; I could not read the module. Bundle it in the programs pass or the next off-chain pass; it is money-adjacent.
- The alarm and the splits scan trust one RPC; `revenue.mjs`'s recovery walk reads at most 10,000 signatures newer than the return, so a stranger can push a split beyond it for ~0.05 SOL, but only after a crash between return and split, and the provably-empty path and hand recovery remain. Round 44 C27 covers it.
- HOLDER-GUIDE.md: every sentence I checked is true of this code (first payout timing, the frozen-pool exceptions, the swap bot's bound and the 1.5% floor, the hourly rescue, the 2.1% cap wording, "only you can open it" with the custodial caveat). It says the redeem page is "built, and published before launch" while item 50 is OPEN; the DRAFT marker covers it.
- DESIGN-v6.md's build order still names `set_guardian`; the instruction is `arm_guardian`/`apply_guardian`. Documentation nit.

---

## Severity summary

| ID | Severity | Layer | Class (a)–(d) |
|---|---|---|---|
| LOW-1 Meteora bitmap PDA dust disables the fallback (`swap.mjs` `market()` `bitmapExists: !!bm`) | LOW | revenue job | none |
| INFO-2 `MAX_ORACLE_FUTURE_SECS = 30` vs cluster clock lag (fail-closed) | INFO | revenue job | none |
| INFO-3 `distribution_overdue` during a pool freeze misattributes | INFO | alarm | none |
| INFO-4 unreadable-skip bound is up to five passes, not three | INFO | docs/alarm | none |
| INFO-5 `build-mainnet.sh` dirty-tree refusal vs untracked `.cache`; `dist/` provenance | INFO | process | none |
| INFO-6 LbPair `status` / Whirlpool `liquidity` read, unused | INFO | revenue job | none |
| INFO-7 no RPC timeout on any `Connection` (limit 25 A1 unrepaired) | INFO | crank/alarm/revenue | none |
| INFO-8 poster reads the mainnet RPC directly, not `jobRpc()` | INFO | poster | none |
| INFO-9 hourly cron gives a 7 h cadence; `41,46` gives 6 h 5 min | INFO | cron | none |
| INFO-10 esbuild/web3 loaded from other projects' `node_modules` | INFO | tests | none |
| INFO-11 rehearsal cannot exercise `vault_awaiting_return` | INFO | rehearsal | none |
| INFO-12 `rehearsal-env.mjs` not bundled | INFO | coverage | none |
| INFO-13 item 22.5 measurable today | INFO | process | none |

None is in the five programs, none moves or miscredits value, none stops or wrongly refuses a crack, none is HIGH or MEDIUM. Gate-5 obligations I add: a fork arm with the bitmap PDA dusted (LOW-1, both ways: dusted refuses today's `market()`, the owner check restores the fallback), and a dusted Orca tick array in the same arm.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run the dress rehearsal on mainnet, with real adversaries present.** Forty-five rounds have read code; none has watched a live MEV bot touch a real 0.1 SOL swap, a real Helius node answer 2,000 `getTransaction` calls in one pass, or the hourly revenue job meet a real `last_sweep_at`. Items 22.1–22.5 are the only evidence of the kind this report cannot produce. Record every signature; have the alarm page a phone that someone answers.
2. **Measure two things with one RPC call each, today:** DAS's `burnt` on any burned Core asset (22.5), and `getAccountInfo` on `meteoraBitmap()` and the two lower Orca tick arrays after a dust transfer on the fork (LOW-1). Both are facts about third parties; no amount of reading settles them.
3. **Put a human on the recovery runbook before the first live cycle.** Limit 10's hand recovery is the one procedure that can double-swap. Have the person who will do it walk a forced post-sweep failure (22.4) once, with the ledger open, before any real royalties flow.
4. **Custody decisions only a person can take:** move the `$CBOB` release key and the swap-operator key off the box or into hardware for the hours they are not needed (limits 56 and 10(3) both rest on "this box"); hold the Giraffish Moments update authority cold for the seven charter days, or sign a dated statement accepting limit 46 as written.
5. **Reproduce the artifacts on a second machine.** `build-mainnet.sh` says, honestly, "the bridge is reproducibility". Nobody has rebuilt `dist/` from `0b3ddb3` on a machine that is not this box and compared `SHA256SUMS`. Do it with a clean tree (INFO-5), and keep the second machine's output.
6. **Pin the toolchain this repository actually certifies with** (INFO-10): the esbuild and web3.js the tests import, platform-tools v1.54, Agave's version, and the Metaplex Core pin's provenance, in this repository, so the certifying run is repeatable after `luna-remotion` or `gary-club` change.
7. **Decide the dates.** `charter_opens_at`, `lock_deadline` and `vault_collection` are the only OPEN launch values; every pre-signing check exists and is proven, and none of it runs until a human writes three numbers.