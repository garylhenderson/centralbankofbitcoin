# Round 41, OFF-CHAIN pass — independent audit of the whole current tree

Scope read: `bank/*` (crank, detectors, alarm, layout, accrual, swap, revenue, poster, txread, sigwalk, lock, spl, anchor, selftest), `scripts/*` (run-tests, build-mainnet, cron-install, check-launch-params, rehearsal-tree, token-programs, probe-mainnet-facts, audit-coverage), `sim/swap-fork.*`, `tests/expiry-budget.mjs`, the fixture, `launch/*`, `web/test/*`, MINT and the sweep helper as the programs the pipeline must agree with, SPEC / HOLDER-GUIDE / DESIGN / RT3, and round 40's verdict and validation.

Headline: **no CRITICAL, no HIGH, no MEDIUM. Two LOW defects in the redemption poster (a PROCEDURE tool that drafts and never sends), one LOW documentation inaccuracy in an OPEN item, and INFO notes.** Everything I could check by recomputation (layout offsets, oracle arithmetic, Pyth offsets, pool layouts, instruction account orders, the accrual mirror) agrees with the programs and the published interfaces. Each claim below says what evidence would exist if it is true, so it can be checked.

---

## R0. Round 40's verdict and repairs

**C01 (ceremony M2 arm).** Repaired correctly: `(at => at >= 0 && at < pageSrc.indexOf("const signed = …"))(pageSrc.indexOf("remember(ctx.newCollection…")))`. Both `indexOf` results are now load-bearing: a missing `remember` call gives `at = -1` → false; a missing `signExact` gives `at < -1` → false. Holds.

**C02 (pinned swap floor).** Independently recomputed from the fixture: 2 SOL × 12045355552 / (8592910904675 × 10) = 280,355.65… → `expectedSats` 280,355; × 9,850 / 10,000 = 276,149.67 → `minSats` 276,149. The arm pins both literals and `SWAP_TOLERANCE_BPS === 150`, so a 9,000 bps tolerance now fails. Holds. (The fork half of C02 remains source-only, as the verdict said: SW.1/4/8/9 assert `got >= minSats`, which a looser floor makes easier. A pinned fork arm would need a stable price, which a fork of live state cannot give; the selftest pin is the right place.)

**C10 (crank attribute reader) and W1/W2 gate-5 arms.** Present and non-vacuous (the C10 arm hand-builds Core bytes with unknown plugin types 77/40 and a 20-signature autograph, and compares the parsed list to a literal).

**Rejected claims re-tested.** C05 (ComputeBudget tags): `setComputeUnitLimit` is tag 2, `setComputeUnitPrice` tag 3; the judge is right. C06 (`detectRevealStall`): the predicate `r0 < m0 && r1 < m1 && r1 === r0` fires whenever vaults wait and the head did not move, whether or not minting continues; the verdict's refutation holds. C14 (off-curve guardian/operator): correct that paging would mis-page a multisig guardian; the ruled keys are on-curve and pinned by the launch checker. All agree.

**Recommendations round 40 made that remain open (not findings, still true):**
- C04: the R39 C01 send-block extraction starts at `plan.retireBurned`, so the reveal lane's three send loops are unarmed, and although the split send **is** inside the extracted block, no fixture sets `split: true`, so a sender that dropped the split would pass (the verdict's mSplit measurement).
- C03 residue: the C04 regex still allows `newCollection]` anywhere, not only inside `signExact(…[ctx.newCollection]…)`.
- Item 22.5 (one DAS read of a burnt asset) still unsettled; `selftest.mjs` pins that a seen burn never quiets `vault_left_index`, so a "no" edits `bank/`.

---

## R1. The crank (`bank/crank.mjs`)

I re-derived every instruction the crank sends against MINT's account structs and arguments: `reschedule_reveal [record]`, `capture_entropy [record, SlotHashes]`, `reveal_level [config, record, asset, collection, payer, mint_auth, SlotHashes, Core, System] + Borsh Vec<VaultAttribute>`, `retire_burned [config, record, asset]`, `claim(0) [config, pool, Token, pairs…]`, `expire_boosts [config, records…]`, `split_revenue(decimals) [config, revenue, mint, revATA, pool, bankATA, Token]`, `distribute(false) [config, pool]`, `activate [config, record, asset, vault_token, pool]`. All orders and mutability flags match. `attrsBorsh` equals the program's `try_to_vec()` (u32 count, u32-prefixed key and value), so the hash check before send is the program's. Discriminators are computed.

The planner's arithmetic agrees with the program at every step I could pair:
- `w = total_active_weight + preJoinWeight − retiringWeight (level + boost) − expiringWeight` is exactly what the program's `join`, `retire`, `reweigh(…, 0)` leave before `credit`.
- `owedAfterRetire` subtracts `owed_of` of a retiring active vault (`pendingScaled` with boost and carry) as `retire` does.
- The pre-expired vault's owed is `owed_of at old acc + level_w × Δacc`, which is what `reweigh` (carry = owed, debt = level_w × acc) followed by `credit` yields.
- `readySlot` (two strides of `(⌊s/4⌋+2)·4`) matches `try_capture`'s B and C targets; the `slot > readySlot` condition is the first slot whose SlotHashes contains C.
- Reschedule `slot > reveal_slot + 300` matches `now > reveal_slot + REVEAL_WINDOW_SLOTS`.

Questions the brief asked, answered:
- **A plan the program refuses.** None found beyond the benign races already enumerated. The pre-join claim batches cannot credit the month early (their `monthly_inline` sees `waiting_to_join > 0` and returns before the pairs loop); the tick from a frozen pool is accepted because `distribute` reads the amount through `read_token`, which ignores the state byte; a frozen-pool join-only batch moves no tokens.
- **A plan that pays or joins a dead vault.** None: `'burned'` is excluded from pre-joins, after-joins and claims and is retired first; `'other'` is never joined or paid and blocks the distribution (correct, since `JoinWaitingFirst` would refuse it).
- **A reveal out of order.** None: reveals are planned from `revealed_total` ascending and the send loop breaks at the first fail/benign/skip.
- **Value movement.** Only MINT instructions; the selftest arm pins the instruction-name list and that no transfer is built. Confirmed.

INFO (crank):
- `splitToPool = total − total·1500/10000` hardcodes the 15% instead of reading `cfg.split_bps`. Harmless (fixed at 8,500 forever; `split_not_85_15` pages otherwise), but the projection would silently mis-plan `avail` on a rehearsal that initialised another split (impossible: `initialize` hardcodes `DEFAULT_SPLIT_BPS`). Note only.
- Captures are sent one per transaction with serial `confirmed` waits and no compute-unit limit. One capture is ~115k CU, so only one fits the default budget; with an explicit limit up to ~12 would fit one transaction. In a mint burst this is the "up but slow" lapse of limit 25. Not a defect (stated), but the cheapest lever for item 22's rehearsal if lapses are observed.
- `judgeDistributeRefusal('')` returns `'fail'` when the distribute error carried no Anchor code (expired blockhash) even if the fresh config shows the epoch moved (R40 C12). Loud direction.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

Production assertions present and exact: `monthly_secs 2592000`, `redeem_window_secs 3600`, `notice_secs 604800`, `quorum 2100`, `threshold 5100`, `min_voting 259200`, the three tighten bounds, supply/census/mints/root/collection, `charter_secs 604800` (derived), `cbob_mint` and the two boost ceilings. Fixed-forever keys drift CRITICAL, including `cbob_mint`, `max_boost_*`, all five `prog.*` upgrade authorities and hashes (sweep included), both collection plugin hashes and the PoB update authority. `boosts_stalled`, `pending_*` arms, pool frozen/insolvent, redemptions near cap, distribution overdue: all present and wired (the I4 pinned-argument gate and the derived wiring gate prevent silent unwiring).

**Dangerous state read as quiet.** I could not construct one within the alarm's declared coverage. The candidates I tried and why they are covered: a vault-collection update-authority change (excluded from `collection.plugins_hash`, but only MINT's PDA can sign it and MINT never calls `UpdateCollection`); a delegate on the pool's token account (only the config PDA could approve, and MINT signs only `Transfer`); a cancelled pending operator (drifts CRITICAL, see INFO below).

**Routine state paged every pass.** Nothing new beyond what SPEC already states (`scan_gap` during a drain, `index_disagrees_with_chain` on DAS lag, `vault_awaiting_return`, `swap_operator_armed` for the notice week).

INFO (alarm):
- `config_drift` on `mint.pending_swap_operator` uses the WATCH text "A SWAP-OPERATOR REPLACEMENT IS ARMED" for **both** directions. A guardian `cancel_swap_operator` (pending → default) therefore pages CRITICAL with text saying a replacement is armed. The `swap_operator_armed` level finding clears correctly; only the drift line's prose is wrong for the cancel direction. Documentation-class text in code.
- `detectDistributionOverdue` advises "anyone can run it free now: `distribute(false)`" while the pool is frozen past the due date, when the crank deliberately abstains. I checked whether running it would harm anyone: a share credited and then forfeited by a redeemer during the freeze returns to the pool, which is where undistributed revenue would have stayed anyway, so the outcome is the same for everyone. Not a defect; the advice is merely redundant with the crank's restraint.

---

## R3. Layouts (`bank/layout.mjs`)

Recomputed by hand from the field list: `minted_total` at 141 (GOV/BURN pin), `last_sweep_at` at 282, `bare_burns_retired` at 454 (BURN/GOV pin), fixed length 1,005 = `MINT_CONFIG_SPACE − CONFIG_PADDING`; VaultRecord `level` at 57 (the reveal-lane memcmp offset), fixed length 211. The selftest asserts the Rust struct field-for-field (strict parser that throws on any non-`pub` line), every `OFF_*` any program pins against the computed offset with an "every scraped constant is compared" gate, the suite's own `OFF_*` copies, every layout version constant in every program copy, `BOOST_RING`, and (round 24 D6) **the SEEDS are now asserted**: `judgeSeeds` scrapes each `pub const *_SEED: &[u8] = b"…"` from the declaring program, requires all 11 to match, and is shown to catch a mistyped or unmapped seed. The D6 comment is true now. A struct change cannot slip: the Rust-vs-list equality fails on an added field or a changed type (both arms measured both ways).

---

## R4. Money arithmetic (`bank/accrual.mjs`)

`credit` (floor `avail·1e12/w`, `owed += delta·w`), `pendingScaled` (`(level_w + boost)·acc + carry − debt`), `reweigh` (carry = owed, debt = new_w·acc), `ceilSats`, `available`, `debtAtActivation` are line-for-line the Rust. The crank's expire-before/expire-after plan matches `expire_boosts`' predicate (`dist_epoch >= boost_end_epoch`) and `advance_epoch`'s due-marking (`end == dist_epoch + 1` before the distribution). The alarm's `boosts_stalled` and the fixed-forever boost keys are present. No divergence.

---

## R5. The swap and the revenue cycle

**(a) Oracle math.** sats = lamports·sol·10^(e_s−e_b) / (10·btc) is the correct reduction of lamports/1e9 · SOL_USD / BTC_USD · 1e8; both exponent signs are handled by scaling numerator or denominator; division floors, so the floor is conservative by at most one sat. `satsPerLamport` converts two BigInts ~1e10 and ~8.6e12 to Number, both far inside 2^53. The 150 bps floor covers Orca's 16 bps fee plus the impact of 10 SOL on ~$10M by a wide margin; the fork recorded both venues at the ruled 10 SOL holding the floor.

**(b) Pyth.** `PriceUpdateV2` offsets recomputed: 8 disc + 32 write_authority = 40; `VerificationLevel` tag at 40 (Full = 1, one byte); feed id 41..73; price i64 73; conf u64 81; expo i32 89; publish_time i64 93. The code and the fork's `stamped()` rewrite (offset 93) agree. The account is derived (`[u16 LE 0, feed_id]` under the push program) and owner-checked against the receiver. Can anyone write an old or chosen price there? The push oracle's update refuses an update whose `publish_time` is not strictly newer than the stored one and only accepts Wormhole-verified Pyth messages, so neither an old nor a chosen price can be installed; staleness (nobody posting) is caught by the 180 s age check against the Clock sysvar, read in the same `getMultipleAccountsInfo` as the prices and owner-checked. The residual is the single RPC endpoint, already named as trusted (b).

**(c) Deviation filter.** `orcaSpot = (sqrt_price/2^64)^2` is token B per token A in raw units = sats per lamport (A = wSOL, B = cbBTC, order checked). `meteoraSpot = (1+bin_step/1e4)^(−active_id)` is the inverse of DLMM's Y-per-X raw price (X = cbBTC, Y = wSOL, order checked). Both are the right quantity in the right direction; the fixture's `MSPOT` at bin 5920/step 15 is ~1.4e-4 sats/lamport, consistent with ~$120 SOL / ~$86k BTC. Floating point: the 100 bps boundary is judged on doubles with ~1e-13 relative error, 10 orders of magnitude below the gate; it cannot pass a pool it should refuse.

**(d) Minimum out.** Orca `other_amount_threshold` with exact-input a_to_b is min B out in raw B units (sats); Meteora `min_amount_out` is raw out-token units (sats). Both carry the same `guaranteed = m2.f.minSats`, from the same `market()` read the venue list came from.

**(e) The judge.** All seven slots are pinned by position and content (CU limit 400,000 with no other ComputeBudget instruction; two ATA creations with payer/account/owner/mint = operator/own ATA/operator/mint; one System transfer of exactly `lamportsIn` into the own wSOL ATA; SyncNative of it; the venue swap with input key 3/4 and output key 5 = own ATAs, amount and floor bytes, Orca direction/exact-input/min-sqrt-price; one CloseAccount back to the operator, last). Token instructions other than SyncNative/CloseAccount are refused, so an `Approve` cannot ride. The accounts the judge does not pin (Orca vaults A/B, tick arrays, oracle; Meteora reserves, bin arrays, oracle, event authority) are all `has_one`/PDA-constrained by the venue programs, so a tampered one makes the venue refuse rather than misroute. What a tampered **builder** can still route past it: nothing that moves value; what a tampered **judge** can pass: anything (the box-owner residue limit 10 states).

**(f) Derivation.** Orca `[“tick_array”, pool, start.toString()]`, start = ⌊tick/(88·spacing)⌋·span with `Math.floor` correct for negative ticks; a_to_b crosses downward so [s0, s0−span, s0−2span] is right; a tick exactly on a boundary starts that array (arm present). Oracle `[“oracle”, pool]`. Meteora Y→X moves the active bin up, so [i, i+1, i+2] is right; bin array seed `[“bin_array”, pool, i64 LE]`; bitmap `[“bitmap”, pool]` or program id as `None`; `host_fee_in` None; event authority `[“__event_authority”]`; two token programs. An uninitialised array (or a boundary crossing into one) makes the venue refuse → the loop tries the next venue → if both refuse, "every pinned venue refused", SOL stays on the operator, the cycle stays open and pages. No value loss.

**(g) wSOL.** Exactly `lamportsIn` is wrapped and synced; the close returns the whole wSOL balance (any pre-existing balance included) to the operator; wSOL has no freeze authority; a delegate does not block an owner-signed swap; who created the ATA is irrelevant (owner is the operator by derivation). Nothing is left wrapped; the fork asserts the wSOL account is gone after each swap.

**(h) Failure and retry.** Meteora is tried only on `'refused'` (preflight, landed-with-error, or expired-and-absent). The one path to a second swap after a swap that lands: the confirmation throws blockheight-exceeded while the RPC's status index has not yet seen the landed transaction, so `statusOf` returns null and the verdict is `'refused'`. The second swap then fails at its System transfer because the operator holds only the float (and `sweptLamports` is already on the first swap), so the cycle stays open and loud. If the operator wallet held extra SOL (against the stated rule), a second swap would convert the operator's own SOL and the return would send it all to revenue; the ledger would record `returnedSats = delta` (both swaps) against one `quotedSats` — over-return, not a loss. Every return path (`returnSig` confirm, `returnedSats`, `returnBlockTime`) is written only after on-chain confirmation; the split is required for closure. The ledger cannot read a failed cycle as closed.

**(i) Adversarial bound.** The on-chain floor allows execution up to 150 bps below the oracle's expected output, and each feed's confidence may be up to 30 bps, so the worst honest-or-hostile shortfall per cycle is ~1.5–2.1% of the swapped SOL: ≤0.21 SOL per 10 SOL cycle, ≤~0.7 SOL/day at the ~3.4 cycles/day cadence, ≤~21 SOL/month at full royalty throughput. A sandwich extracting that on the Orca pool must move a ~$10M concentrated pool 1.5% and pay the 0.16% fee both ways on the capital it moves, which exceeds the ≤$25 available from one cycle; the thinner Meteora pool is reached only when Orca refused. Not material at the ruled cap. The operator key's worst case is unchanged (cap × cooldown windows until the guardian stops; never the pool or vault cbBTC), now trusting two pool programs and the oracle rather than an HTTP reply.

INFO (revenue): `MAX_PER_CYCLE_LAMPORTS = 50 SOL` under a comment reading "Set this at or below the on-chain cap" (10 SOL). Harmless (`sweepAmount` takes the minimum) but the comment misstates the constant. A crash between `save(led)` of the intent row and the sweep send (not a send failure) leaves an intent-only row the next run refuses and the alarm pages `unreconciled_swap` for SOL that never moved; the hand runbook resolves it. Loud direction; stated well enough by limit 10's runbook.

---

## R6. The gates

Floors are equalities everywhere (`run-tests.sh floor()`, `selftest FLOOR`, `expiry-budget assert.equal`, `swap-fork SWAP_FLOOR`, `web/test/run-all.mjs FLOORS`), so deleting work turns the build red unless the floor is moved in the same commit, which the SPEC-count gate (every occurrence) then catches. Checked counts: detector 933 = `FLOOR` = `DET_FLOOR` = SPEC; mainnet probe 33 recounted from its assertions (5 walk + 15 reserve + 8 ProgramData + 5 PoB/decimals); swap fork 16 recounted (SW.0, 1, 1a, 1b, 4, 4a, 4b, 6, 6a, 6b, 6c, 7, 7a, 7b, 8, 9).

Vacuity hunt in the round-24 section: every arm I traced has a failing direction. The weakest shapes are source-regex arms (e.g. `nowSec: chainSec,`, `readTokenAccount(bankInfo)`), which fail on deletion but not on an equivalent rewrite; and two `indexOf(a) < indexOf(b)` arms (M3 "only AFTER the dry-run return"; L11 "before the provably-empty proof") where a missing first anchor yields `−1 < n` true — each is paired with a second anchor or a sibling regex that fails on the deletion, so neither is vacuous today. Nothing in that section is one-directional.

`scripts/build-mainnet.sh`: four behavioural key proofs (reject/accept), the sweep helper byte-identical to the localnet build **and** to `target/deploy` (the bytes the suite deployed), exactly five `.so` in `dist/`, exit-status-gated builds, pinned Core sha256, token-program pins verified on the validator. It proves what it says and says what it does not prove.

`scripts/cron-install.sh`: installs six tagged jobs, both money jobs dry unless a tagged uncommented `--live` already exists (the preserve logic is executed by the selftest, both ways), refuses a rehearsal tree, asserts `flock -n`. Arms nothing it should not.

`web/test/*`: each file's assertions have a failing direction for the property named, with the known weakness that several (`ceremony.test` B4/V38-3, `plan.test` V39-2 "page never stops on a failed optional rescue") are source-regex arms over `web/src/pages/*.mjs` and would pass an equivalent rewrite that broke the logic. The property-driven arms (`refusedC/refusedB`, `diffIx` controls, the bundled-vs-node byte comparison with `n.v.length > 200`, the mock-RPC dust runs, proxy refusals with controls) can fail. Round 40's C01-class defect (an `indexOf` compared without a presence check) does not recur elsewhere in `web/test` that I could find.

---

## Findings

### F1 — LOW — `bank/redemption-poster.mjs`: the second redemption in a two-redemption transaction is never drafted
**Construct.** `main()`'s event loop:
```js
for (const e of parseCbobLogs(...).events.filter(e => e.type === 'REDEEMED')) {
  … const p = draftPost(…)
  if (queued.has(s.signature)) continue
  fs.appendFileSync(QUEUE, …); queued.add(s.signature)
```
The dedupe is keyed by **signature**, and `queued` is rebuilt from the queue file by `web.signature`. A transaction carrying two redemptions (suite S9b proves a v0 transaction with two three-reserve redemptions lands) prints two `CBOB_REDEEMED` lines; the first is drafted, the second hits `queued.has(sig)` and is skipped forever. The holder guide (DRAFT) says "Every opening is public."
**Gain/accident.** Any client that opens two vaults in one transaction (not the Bank's page) has one opening never announced.
**Evidence if true.** Feed the selftest's `postRun` harness a parsed transaction whose logs are `invoke BURN / CBOB_REDEEMED A / success / invoke BURN / CBOB_REDEEMED B / success` with records for A and B: `drafted` is 1 and the queue has one line.
**Fix.** Key the dedupe by `${signature}:${asset}`, write `web.asset`, rebuild `queued` from it; add the two-event arm to the poster selftest.

### F2 — LOW — `bank/redemption-poster.mjs`: a redemption of an undrawn vault crashes the run and holds every later draft until the FIFO catches up
**Construct.** `draftPost` throws for `level` outside 1..5 (asserted deliberately: "an undrawn level is refused"), but `main()` calls it unguarded before the dedupe, and the only catch is the top-level `main().catch(… exit 3)`. A vault can be redeemed before its level is drawn (MINT `reveal_level`'s own comment: "a bare Core burn, or a redemption before its reveal"), so `rec.level` is 0 until the FIFO reaches the burned record. Every poster run meanwhile exits 3 at that signature, the cursor is not saved, and nothing newer is drafted. It self-heals once `reveal_level` writes the burned vault's level, but each intervening run pages "POSTER FAILED".
**Evidence if true.** `postRun` with a record `level: 0` and a `CBOB_REDEEMED` line rejects with "level 0 is not I..V"; `writeLedger` is never called.
**Fix.** Treat it as the truncated-logs case: queue a REJECTED hand-draft entry naming the signature and asset, advance, and let a later pass (after the reveal) draft it. Same for a null record read (R40 C17).

### F3 — LOW (documentation, OPEN item 53) — `web/` is outside the rehearsal patch and the "ids are the whole patch" statement predates it
**Construct.** `scripts/rehearsal-tree.sh` substitutes under `programs bank scripts tests sim launch Anchor.toml` only. Since round 35 `web/src/config.js` carries all five program ids (`PROFILES.mainnet.programs`, asserted equal to `layout.mjs PROGRAM_IDS` by `web/test/ids.test.mjs`) and `web/test/ref.mjs` hardcodes `ROOT = '/opt/cbob-vaults'`. Inside a rehearsal tree the web tests would read **production** sources and `ids.test.mjs` would fail (patched `layout.mjs` vs unpatched config). SPEC 53 still says "exactly six substitutions… the ids are the whole patch… measured 2026-10-04" (before web existed) and does not say how the pages reach a rehearsal (the `rehearsal` profile with unset ids exists, per `ids.test.mjs`).
**Evidence if true.** `grep -n web scripts/rehearsal-tree.sh` → none; `grep -n "/opt/cbob-vaults" web/test/ref.mjs` → the `ROOT` line.
**Fix.** State in SPEC 53 that the pages are rehearsed through `PROFILES.rehearsal` (filled with the throwaway ids), not through the patch, and that web tests are not run inside the rehearsal tree; or add `web` to the substitution list and its `/opt/cbob-vaults` to the reverse-proof. Documentation-only if the former; qualifies for gate 3's exception (changes no code, misstates nothing about holder money).

### INFO
- I1 (`detectors.mjs` WATCH): `mint.pending_swap_operator` drift text says "ARMED" on a cancel (see R2).
- I2 (`bank/revenue.mjs`): `MAX_PER_CYCLE_LAMPORTS` comment "at or below the on-chain cap" is false of the 50 SOL constant (harmless).
- I3 (`bank/crank.mjs`): hardcoded 1500 bps in the split projection.
- I4 (`bank/selftest.mjs` signer gate): scans `bank/`, `scripts/`, `tests/`; `web/test/mock-rpc.mjs` holds a test signer (`Keypair.fromSeed`, `ed25519.sign` with `OWNER.secretKey`) and `web/src/pages` sign through wallet adapters. The arm's claim is correctly scoped to the three trees; the SPEC sentence "exactly two signers exist" should say "in bank/, scripts/ and tests/".
- I5 (item 54 residue): the crank's actual batch shapes (14 claims; 14 join-only claims) are still extrapolated, not measured; a synthetic-genesis gate like `tests/expiry-budget.mjs` could pin them under the default budget in minutes.
- I6 (`sim/swap-fork.sh` as a ship gate): SW.0 asserts both live pools within 100 bps of the oracle; the gate therefore depends on live market state and can go red for a market reason on certification day. State it, or make SW.0's venue requirement "at least one".

---

## The four questions about the accepted limits

1. **Worse than stated?** None found. Limit 10's 150 bps + 30 bps-per-feed bound, throughput ceiling, and trust list match the code. Limit 25's "up but slow" lapse is as stated; the one-capture-per-transaction shape makes it likelier in bursts than the text implies, but the text already names serial confirmation. Limit 27's cost attribution (round 38) is right. Limit 7's reconcile-lane silence is stated.
2. **Not actually a limit / already closed?** Limit 8 is narrower since round 28: `rememberRedemptions` persists `burn_via_program` across passes, so a DAS diff that **follows** the walk is correlated; only the walk-follows-diff order still produces an unretracted CRITICAL. The text could say so. Limit 9: the redeem page now runs `judgeRedemptionCoverage` (built, staged), as stated.
3. **Discharged items not discharged?** 51 and 54 are built/measured as claimed; 54 keeps its own honest "extrapolated, not measured at 14" (I5). 14, 15, 30, 31, 33 hold.
4. **OPEN AND BLOCKING quietly accepted?** No. 22, 38, 50, 52, 53 remain open; `launch/mainnet-init.json` keeps `charter_opens_at`, `lock_deadline`, `vault_collection` OPEN and the checker refuses it (49/49 includes the refusal). HOLDER-GUIDE remains DRAFT and gated on 50. The holder guide's promises I checked against code (hourly cap figure, frozen-cbBTC blocks the whole opening, 10 SOL / 6 h operator bound, 1.5% swap floor, boost rules, first-payout timing, "anyone can still trigger one" during a freeze) are true of MINT and the pipeline.

---

## Transaction history (`bank/txread.mjs`) and its consumers

Schema re-read: version ∈ {legacy, 0, 1}, signature[0] equality, every account key valid and unique, fee payer signer+writable, v1 requires `transactionConfig` and no lookup-table keys, every instruction's program in the key set, money-program parsed payloads must carry structured `info` with validated accounts and amounts (transferCheckedWithFee passes, R39 W1), raw instruction data base58, metadata required (`err`, `fee`, balances of the right length, logs all strings, inner groups with valid parent indices, token balances well-formed), and the runtime `Log truncated` marker refused unless `'flag'`. I could not find a path that loses a CBOB event silently: the alarm never parses a truncated transaction's logs, records it as a gap only when one of ours ran, holds the cursor on any unread transaction, and the poster/revenue scans refuse rather than skip. `s.err` transactions are skipped before decode (the load-bearing guard, asserted). The one coverage choice worth naming: a `getTransaction` that returns `logMessages: null` (some providers for old slots) is `tx_unreadable` every pass until pruned from history, by design.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run item 22's rehearsal as written, with a stopwatch and a phone.** Measure, not read: the reveal lane's capture latency during a 50-mint-per-minute burst (how many windows lapse); one full revenue cycle through each pool; one forced post-sweep failure walked through the hand runbook by a person who did not write it; the alarm's CRITICAL arriving on a human's device and the guardian stop landing within a timed interval. Record signatures and timings in the validation file.
2. **Rebuild `dist/` on a second machine from the release commit** and compare the five sha256 values; the key proof in `build-mainnet.sh` cannot distinguish Gary's key from a third wrong key, and only reproducibility bridges that.
3. **Have a person read the four signed `initialize` transactions byte-by-byte against `launch/mainnet-init.json`** at the ceremony (the checker validates the JSON, not the signed bytes), and the collection's three post-step checks.
4. **Settle item 22.5 with one DAS read** before the freeze is declared, since a "no" edits `bank/` and the pinned arm.
5. **Custody drills:** the deploy authority (`FZjLB4…`), the swap operator, the $CBOB release wallet and the Moments hot wallet each have a named holder, a tested restore from the encrypted backup, and a written "who calls whom" for the charter week.
6. **A real-wallet opening on the published page** with a hardware wallet and a vault holding all three reserves plus one stray, by someone outside the project, watched end to end, including the X/website announcement path once a sender exists.
7. **Subscribe a human to Metaplex, Orca, Meteora and Pyth upgrade channels.** The alarm detects a byte change after the fact; only a person can read a changelog before it lands.