# Round 44 — OFF-CHAIN pass: audit of the whole tree

I ran nothing. Every statement below is read off the tree as delivered (plus the bundled round‑43 verdicts and `VALIDATION`), and every finding says what to run to confirm or kill it. Where I could not decide a question from the bundle, I say so and name the measurement instead of guessing.

---

## R0 — Round 43's verdict and its repairs

**Verdict read independently: both passes, `MANIFEST`, `git` statements, and the three confirmed LOWs (V43o‑1/2/3).** I re‑derived each from source, not from the verdict's prose.

**V43o‑1 (runner could not pass in the rehearsal tree) — repaired, and the repair is closed at both sites.**
- `scripts/run-tests.sh` now has `release_gate()`, called as `GATE_MSG=$(release_gate "$ROOT") || die "$GATE_MSG"`, *before* the web gate. Outside a rehearsal it is unchanged (`git -C "$root" diff --quiet "$rel" -- programs Cargo.toml Cargo.lock`).
- Inside (`[ -e "$root/REHEARSAL-RECORD.txt" ]`) it requires: a 6‑pair map named `burn/gov/mint/root/seal/sweep`, no unchanged id, the recorded `patch sha256` present in the record, `.rehearsal-files` re‑hashing to that sha, every differing `programs/*`/`Cargo.toml`/`Cargo.lock` file *in* the recorded set, the four keyed programs patched, and each differing file byte‑equal to `RELEASE_COMMIT` under the reverse map. I traced the hash reproduction against `rehearsal-tree.sh`'s own accumulation order (`h.update(f); h.update(out)` over the same `changed` list) — they match, so the check is a real recomputation, not a re‑read.
- The second site the verdict admits it only *read* (the web offline gate, whose `ids.test.mjs` cross‑checks the patched `bank/layout.mjs` against `web/`'s mainnet ids) is now explicitly skipped **only** where the marker stands, with the reason printed. Everywhere else it stays mandatory.
- The seven selftest arms run the *extracted* `release_gate` against a disposable git fixture built by `rehearsal-tree.sh`'s own substitution engine, and include the two forgeries that matter: an unrecorded program edit with the marker present, and an edit whose `sha` was forged to match (caught by the reverse map). I did not re‑run them.

**V43o‑2 (a permanently unreadable signature froze a scan) — repaired at the alarm and poster, and the third walking scanner does not have the defect.**
- Alarm: `UNREADABLE_SKIP_PASSES = 3`; `unreadPasses`/`unreadSkips` in state; the retry path keeps `unread++` (so `if (!unread)` holds the cursor/backlog), the third pass pushes to `looked.unreadSkips` and `continue`s **without** incrementing `unread`, so the cursor and backlog advance. `detectUnreadSkips` reuses `detectLogGaps`' keeping rule (unreviewed never dropped, watermark `bank/unreadable-reviewed`, >2 000 escalates to CRITICAL), and `tx_skipped_unreadable` is a level kind with signature‑free text — so a re‑emission is not a new email.
- Poster: `st.unread = { [sig]: n }` for n<3 (throws, cursor held), then a REJECTED hand‑draft keyed `sig:*` and `st.cursor = sig` — the same shape, with the queue as the durable record.
- Revenue: `splitsSince` walks the revenue ATA with no cursor and `if (!tx) continue` — there is nothing to freeze, so the third site is not a site.
- One regression check: the rollback block does **not** restore `unreadPasses`/`unreadSkips`/`logGaps`. That is the safe direction — both are level conditions that re‑assert from `prev` on the next pass — so an undelivered page does not lose the skip.

**V43o‑3 (the reveal‑skip arm could not fail) — repaired by extraction, and I checked the boundary it needed.** `revealBlock` is `between(crank, '  for (const a of plan.reveal) {', '\n  // Round 43 (V43-1): every nested vault')`; the run drives the real loop with stubs and asserts **nothing is sent** for an `'other'` asset and for an unread asset, and that a **burned** asset is sent with `[]` and the run continues. The end anchor is the new rescue block, so the extraction is still exact.

**Round‑43 addendum (Core re‑pin) — verified as a set.**
- `CORE_SHA256_EXPECTED=30dce56b…` in `scripts/run-tests.sh`; the selftest scrapes four copies (`run-tests.sh`, `web/test/e2e-localnet.sh`, `sim/run-sim.sh`, `build-mainnet.sh`'s `local want=`) and asserts one value plus a drifted copy caught. `scripts/probe-mainnet-facts.mjs` reads the pin from the runner and compares it with the **deployed** Core's `ProgramData[45:]`, and asserts it is not the August pin. That is the gate that would have caught the two Metaplex upgrades; it is now the thing that will.
- **Not verifiable in this bundle:** `web/test/e2e-localnet.sh` (one of the four copies) rides in the programs pass. The gate is right; I cannot see one of its inputs here.

**Round‑43 addendum (rehearsal value set) — verified, with one gap (F‑2 below).** `judgeRehearsal` checks: every mainnet key present, no extra key, every status in the allowed set, `MAINNET` equals the mainnet value, `REHEARSAL-OPEN` with no value reported as `OPEN:`, `init_authority` in `REHEARSAL_INIT_AUTHORITIES`, seven never‑mainnet keys (PoB root/collection, guardian, treasury, operator, `$CBOB`, release wallet), `lock_deadline` REHEARSAL‑NA, the real payment/reserve mints, and every `initialize` bound (census ≤ supply, sweep 1–50 SOL, floor ≤ cap, cooldown ≤ ceiling, reserve ≥ rent, notice/month/vote/redeem bounds, boost ceilings). The mainnet path refuses the file by name. The committed file judges to exactly the nine REHEARSAL‑OPEN lines and nothing else.

---

## R1 — The crank (`bank/crank.mjs`)

**No new defect found.** What I checked, because each is a place a plan could be refused or a false page raised:

- **Order.** `main()` sends reschedule → capture → reveal (mint order, stop at the first not‑ready) → rescue → retire → pre‑joins → `expire(before)` → split → distribute → `expire(after)` → activate → claims. That is RT3‑6's order with the expires and the rescue added. The reveal loop breaks on the first failure and on a benign refusal, and (V43o‑3) on an unreadable asset, before any fee is spent.
- **Joins before a distribution.** The planner joins exactly the pending, live, earlier‑epoch vaults, and plans **no** distribution while any eligible one is unreadable (`joinable`). A vault that merely requests in the current epoch does **not** set `waiting_to_join` (`pending_count − pending_this_epoch`), so a stranger's `activate` between plan and send cannot make the crank's distribute fail `JoinWaitingFirst`; and if the epoch moved for any other reason, `judgeDistributeRefusal` reads a fresh config and calls it benign. `PoolShort` never is.
- **Boost timing (R4).** `preExpires` takes every live boosted vault with `dist_epoch ≥ boost_end_epoch` (sent before the split/distribute); `postExpires` takes exactly `boost_end_epoch == dist_epoch + 1` and is sent right after the distribution that makes it due. The `owed` prediction for a pre‑expired vault is `owed_at_expiry + level_weight × (acc − acc_old)`, which is algebraically the program's `reweigh` + `owed_of`; the pre‑joined vault's is `weight × (acc − acc_old)`, which is `join`'s `debt = weight × acc_at_join`. I re‑derived both against `programs/cbob-vault-mint/src/lib.rs`.
- **The weight the plan divides by** is `total_active_weight + preJoinWeight − retiringWeight − expiringWeight`, which is the state the program will be in when `distribute` runs (retire and pre‑join and pre‑expire all land first).
- **Nothing it sends is refused for shape.** Every instruction's account list matches the corresponding MINT `Accounts` struct field‑for‑field, including the writability differences that matter (`pool_token` is `mut` in `Claim`, read‑only in `Distribute`; `config` is read‑only in `SplitRevenue`; `collection` writable on `reveal_level`). A claim batch excludes any vault whose recorded account is missing, not `'ok'`, or not the recorded address, so a batch cannot be refused whole; a frozen destination is deferred and reported; a burned asset is retired, never paid or joined.
- **Destination pinning.** The only programs named are MINT and the Core/System/Token ids Core's CPI needs; there is no `SystemProgram.transfer`, no SPL transfer, and `distribute` is always the free path (`Buffer.from([0])`). `rescue_nested`'s only destination is `cfg.bank_treasury`, which MINT re‑derives and requires.
- **The fee floor is spent in the right order (round 30 L2).** `budgetPlan` runs the base plan whenever the key covers it, then adds reveals only while keeping `FEE_FLOOR_LAMPORTS`; the floor warning has its own marker (`-floor`) so a ceiling warning cannot mute it for a day.

**Residual I agree with, and it is stated:** the reveal lane's `attrs_hash` check is against a hash read a moment earlier, so a race with the other lane is `'revealed'` (done elsewhere) rather than a fault; a genuine mismatch is a page.

---

## R2 — The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

**No new HIGH/MEDIUM.** The pages‑on‑every‑fixed‑forever value list, the production value list (21 % / 51 % / 3 d / 7 d notice / the three tighten bounds / 30 d month / 1 h window / 12 & 24 boost ceilings / `$CBOB` mint / PoB collection), the frozen and pending states, the redemption window, the pool, the revenue account and the clock, the crank's posture and heartbeat, the five programs' upgrade authority **and** bytes, the PoB collection's plugins and update authority, and the third‑party programs are all present and both‑ways armed. Two things worth recording:

**F‑1 (INFO, detection): the wedge V43o‑2 closed is closed for a bad *signature* but not for a program whose *listing* persistently fails, and the updated SPEC sentence now reads as if the class is closed.**
- *Construct:* `bank/alarm.mjs`, the per‑program walk — a `walkSigs` throw is caught, pushed as `tx_unreadable` HIGH, and `continue`d with `cursors`/`backlogs` untouched. Every later pass repeats it. The cursor never moves, so that program's approvals, PDA‑token‑account creations, burns and event lines are never examined again. The poster's walk throws out of `main()` (loud, cursor held). The revenue walk has no cursor and is unaffected.
- *Why this is not V43o‑2 re‑filed:* it is a different site with a different remedy (you cannot "skip past" a window you cannot list), and the behaviour is deliberate and asserted (`selftest.mjs`: "a throwing read and a throwing listing each become tx_unreadable, the cursor holds, and all four programs are still visited"). The gap is that SPEC's "Reader coverage boundary" now says the permanent‑fault case "is skipped" without distinguishing the listing site.
- *Who gains:* nobody directly; the cost is one program's transaction scan frozen behind a persistent provider fault, with a HIGH page every pass and no automated way out.
- *Evidence if I am right:* stub `walkSigs` to throw for `MINT` for six consecutive passes in the R32 L2 harness — the cursor stays `old` on every pass and no state records the fault for a human; today no arm bounds the number of passes.
- *Fix:* one clause in SPEC's reader boundary ("a listing that fails is retried indefinitely; only a person can clear it by pointing the job at another RPC or re‑scanning by hand"), and optionally an `unreadPasses`‑style counter that escalates the listing finding after N passes. `bank/`, fixable layer.

**F‑2 (INFO, docs + one unchecked status): the rehearsal value set's `RULED` status is neither in the file's own `_comment` nor in SPEC, and `judgeRehearsal` accepts it with no check at all.**
- *Construct:* `scripts/check-launch-params.mjs` `judgeRehearsal`'s `STATUSES = ['MAINNET','PROPOSED','REHEARSAL-OPEN','REHEARSAL-NA','RULED']`. `launch/rehearsal-init.json` uses `RULED` for twelve values (the rehearsal timings, census, swap‑bot values). Its `_comment` and SPEC item 53's paragraph list only the other four. `MAINNET` is checked against the mainnet value; `REHEARSAL‑OPEN` must be empty; `RULED` is checked for nothing.
- *Gains:* a reader cannot tell what `RULED` means in a rehearsal file, and a rehearsal timing edited later with its status left `RULED` is accepted silently — the one status in the file that is a pure assertion of provenance is the one with no shape check.
- *Evidence if I am right:* `grep -c RULED launch/rehearsal-init.json` = 12; the phrase `RULED` does not appear in item 53's paragraph; `node scripts/check-launch-params.mjs --rehearsal` prints nothing about it.
- *Fix:* add `RULED` to both descriptions, and assert that a `RULED` rehearsal entry carries a dated `source` (one line in `judgeRehearsal`, one arm).

**C04 (round 43, shrunk index pass) — I re‑checked it independently and agree it is a one‑pass gap, not a defect.** The walk sets (`pdas`, `atas`, `assets`) are built from the short list, but the primaries are state‑based: a bare burn is caught by `detectVaultSetChange` on the next trusted pass (`prev.vaults` is deliberately kept), non‑canonical token accounts by the daily `reconcile`, and nested vaults by `detectNestedVaults(everyVault, …)` which uses the full DAS page. The one thing lost is the `bare_core_burn` route name for one pass that already pages `vault_index_shrank` CRITICAL. Gate‑5 item 4 still stands (pin whichever behaviour is kept).

---

## R3 — The layouts (`bank/layout.mjs`)

- The D6 claim now has its assertion: twelve seeds are scraped from the declaring program (`CONFIG_SEED`, `SEAL_SEED`, `MINT_SEED`, `VAULT_SEED`, `REVENUE_SEED`, `RESCUE_SEED`, `GOV_SEED`, `PROPOSAL_SEED`, `VOTE_SEED`, …) and compared, both ways (a mistyped seed and a seed no program declares each fail).
- Every `pub struct` is compared field‑for‑field, and `parseRustStruct` **throws** on a line it cannot read (private, `pub(crate)`, multi‑line), so a field cannot be dropped out of the comparison.
- Cross‑program pinned offsets: every `OFF_*`/`const … usize` a program declares is scraped and compared, and a separate arm requires that **nothing scraped goes unchecked** (round 22 L2). I spot‑verified the ones the off‑chain code depends on: `OFF_COLLECTION`/`OFF_RESERVES` (SEAL), `OFF_MINT_MINTED_TOTAL`, `OFF_MINT_BARE_RETIRED`, `OFF_MINT_LAST_SWEEP`, the four `*_VERSION`s, and `BOOST_RING`.
- `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are scraped, evaluated with the named constants, reduced by the padding, and held to `fixedLength` — so a struct change that does not move the allocation fails.
- `offsets('VaultRecord').level` is 57 and the crank's fast‑lane filter uses exactly that offset with a one‑byte `memcmp` (`bs58.encode(Buffer.from([0]))` = `"1"`), which I checked is the correct encoding.

**No finding.** The only remaining latitude is a deliberate, matched change to both the Rust and the layout, which is what the gates are for.

---

## R4 — The money arithmetic (`bank/accrual.mjs`)

Line‑by‑line against `programs/cbob-vault-mint/src/lib.rs`:

| accrual | Rust | verdict |
|---|---|---|
| `credit` `delta = avail×1e12/w`, `owed += delta×w` | `credit` | identical |
| `pendingScaled` `(w+boost)×acc + carry − debt`, negative refused | `owed_of` | identical |
| `reweigh` `carry = owed`, `debt = (w+boost)×acc` | `reweigh` | identical (the Rust also moves `total_active_weight`; the JS does not need to) |
| `debtAtActivation` `w×acc` | `join` | identical |
| `ceilSats`, `available` | `ceil_sats`, `distribute`'s `avail` | identical |
| crank's `joinedNow` / `preExpired` owed | `join` then `credit` then `owed_of` | identical |

The crank expires every DUE boost before it distributes and every boost its own distribution makes due right after (verified in R1). The alarm pages `boosts_stalled`, and `mint.cbob_mint`, `max_boost_weight`, `max_boost_epochs` are watched as fixed forever. **No divergence found.**

---

## R5 — The swap (`bank/swap.mjs`) and the revenue cycle (`bank/revenue.mjs`)

**(a) Oracle math.** `sats = lamports × sol.price × 10^(es−eb) / (btc.price × 10)`; the code moves the decade to numerator or denominator by the sign of `e = es − eb`, integer‑divides, then floors the 150 bps tolerance. `satsPerLamport = sol/btc/10` as a double, used only for the deviation filter. Exponent range is refused at the read and at the floor (`PYTH_EXPO_MIN/MAX`). The round‑40 hand‑pinned vector (280 355 expected, 276 149 minimum) and the round‑41 literals (180 s) are in the selftest. The floor is *below* an honest fill after Orca's 0.16 % fee and a royalty‑sized impact only when the pool is near the oracle — which is what the 100 bps gate enforces at read time; the 150 bps on‑chain floor is the binding number at execution. That gap is disclosed in limit 10 and I have nothing to add to the bound except the arithmetic: 150 bps of the ruled 10 SOL is 0.15 SOL per cycle, ~5 SOL a month at the 34 SOL/day ceiling.

**(b) Pyth verification.** Offsets recomputed: disc 0–8, `write_authority` 8–40, tag 40, feed id 41–73, price 73, conf 81, expo 89, `publish_time` 93, minimum 101 — matches. Owner is checked against the receiver, the account is the **derived** sponsored PDA (shard 0) under the push program, verification level must be `Full` (tag 1), the feed id must match, and the age is judged against the **Clock sysvar**, which is read from its own address and whose owner is checked. I could not construct a way for a stranger to write a fully‑verified update with a chosen price or an old `publish_time` into that PDA: only the push program can write there, and it writes only what the guardians signed. The reader does not check the `PriceUpdateV2` discriminator — defensible here because the address is a program‑derived PDA that only that program writes, and worth one comment rather than a finding.

**(c) Deviation filter.** `orcaSpot` = `(sqrt_price/2^64)²` in raw units = sats per lamport; `meteoraSpot` = `(1 + bin_step/10⁴)^(−active_id)` = the inverse of the DLMM's lamports‑per‑sat, i.e. also sats per lamport, reversed as the comment says. Both compared to `satsPerLamport` with a symmetric `|a−b|/b` in bps, and the selftest drives both venues at 99 bps (used) and 101 bps (skipped) through the real `market()`. Floating point cannot pass a pool it should refuse: the comparison is `dv <= 100` on a double whose relative error is ~1e‑16 against a 1e‑4 granularity.

**(d) Minimum out.** Orca's `other_amount_threshold` and Meteora's `min_amount_out` both carry `m2.f.minSats`, which is the same `oracleFloor` output the deviation filter used for `m2` (the builder passes `guaranteed` into both the builder and the judge), in the units both programs expect (sats of cbBTC). The re‑price check (`MAX_REQUOTE_DRIFT_BPS` against the pre‑sweep quote) sits on top.

**(e) The judge.** It checks programs, signers, one venue instruction naming the pinned pool, the exact seven‑instruction sequence, the CU limit of 400 000 with no CU price, both ATA creations (payer/account/owner/mint), the System transfer of exactly `lamportsIn` into the operator's own wSOL account, `SyncNative` of that account, the swap's input/output accounts at their pinned positions, its amount, its threshold, Orca's direction and price limit, the operator's signature slot, and exactly one close of the wSOL account back to the operator. The eight tampers the round‑25 verdict measured are refused on both venues. What it still does not pin: Meteora key 9 (`host_fee_in`) and the `bitmapExists` flag. Neither can lower the output below `min_amount_out`, which the pool program enforces — so both are loud if wrong, and both are already in limit 10(c)/round‑42 C07's open recommendations.

**(f) Derivation.** Orca tick arrays: `s0`, `s0−span`, `s0−2·span` for a_to_b, with `span = 88 × tick_spacing`, derived under the pool — matches the published interface and the fork. Meteora bin arrays: `i`, `i+1`, `i+2` with `i = floor(active_id/70)` for a Y→X swap — matches. Both readers refuse the wrong token order and the wrong owner, and the fork test re‑proves each against the cloned real pools. At a boundary the `floor` is correct on both; an uninitialised array is refused by the pool program (loud).

**(g) wSOL.** Exactly `lamportsIn` is wrapped, synced, sold, and the account closed back to the operator — so a pre‑existing wrapped balance, a stranger's earlier gift, and any unused input all return to the operator. A frozen or delegate‑bearing wSOL account is the operator's own ATA (only the ATA program can create it), so it cannot be a stranger's.

**(h) Failure and retry.** Orca first, Meteora only on `outcome === 'refused'` (a preflight refusal, a landed‑and‑failed signature, or an expired‑and‑absent one). `unknown` throws with the cycle open; `landed` is recorded. Every path leaves the ledger open until a split is proven, and `cycleIsOpen` closes only on `sendRejected`, zero moved, or a recorded/anchor‑proven split. No path can double‑swap, and the next run is refused at the open‑cycle guard.

**(i) What an adversary can extract.** Within the tolerance: at most 150 bps of a cycle (0.15 SOL at the ruled cap) plus the pool's own fee, and only while the pool is inside the 100 bps read‑time gate. A manipulated Meteora pool is capped by the same on‑chain floor — a worse fill simply refuses. The operator key's worst case is unchanged from limit 10 except that what it trusts is now two pool programs and the oracle rather than an HTTP reply, and the guardian's stop plus the cooldown bound the total. The ledger cannot read a failed cycle as closed (verified: `sendRejected` rows carry `refusedSig`, never `sweepSig`; a row carrying both pages `rejected_row_has_sweep`).

**No new defect found in the swap or the revenue cycle.** The residual I would keep visible: `revenue.mjs`'s recovery block writes the ledger on a **dry run** (`save(led)` before the `!LIVE` return). It only ever closes a cycle on chain evidence (`closesCycle` / `isProvablyEmpty`), so it moves nothing and records nothing false — this is round‑43 C13's disposition and I agree with it; the SPEC wording ("a dry run consumes nothing") is the thing to fix, not the code.

---

## R6 — The gates

**Checked:** every floor in `scripts/run-tests.sh` equals the count the selftest's own gate derives from SPEC (`on-chain 912`, `detector 968`, `allocation 39`, `poster 24`, `launch 68`, `pob 14`, `mainnet 35`, `sim 71`, `swap 16`, `expiry 4`), and `bank/selftest.mjs`'s `FLOOR` equals `DET_FLOOR`; `web/test/run-all.mjs`'s per‑file floors sum to `WEB_FLOOR` 682; the ship‑gate flags force the mainnet probe and the fork to run rather than skip; `judgeCronTemplate` refuses a waiting `flock` and a commented‑out `-n`; the control table's fourth column is parsed and mechanically checked; the installer's arm‑on‑re‑run logic runs the real shell.

**Two arms that cannot fail for the half of their name that matters, and one floor I cannot verify from this bundle.**

**F‑3 (INFO, tests): `web/test/bundle.test.mjs`'s first `judgeLaunch` arm compares two computed values, so its "refuses today" half is untested here.**
- *Construct:* `H.eq('bundled judgeLaunch == node judgeLaunch on the committed file (refuses today)', B.judgeLaunch(launch, …), judgeLaunch(launch, …))`. If the committed `launch/mainnet-init.json` were complete (nothing OPEN), both sides would be `[]` and the arm would pass while its name is false. The property *is* asserted in `web/test/ceremony.test.mjs` ("TODAY: judgeLaunch refuses the committed … (charter date OPEN)"), and the next arm in the same file asserts the literal `[]` for the filled set — so the practical risk is nil.
- *Evidence if I am right:* fill the two OPEN values in `launch/mainnet-init.json` and run `node web/test/bundle.test.mjs`: this arm stays green while ceremony's TODAY arm goes red.
- *Fix:* assert the expected refusal kind (`H.t(..., B.judgeLaunch(...).some(x => /charter_opens_at is OPEN/.test(x)))`), as `ceremony.test.mjs` does.

**F‑4 (LOW, tooling): the web offline gate reads two untracked artifacts that `run-tests.sh` does not build, so the certifying run can die for a reason unrelated to the code under audit.**
- *Construct:* `web/test/ceremony.test.mjs` reads `${ROOT}/.cache/placeholder/out/cbob_placeholder.so`; `web/test/bundle.test.mjs` reads `${ROOT}/dist/*.so` and `${ROOT}/dist/MANIFEST.txt`; `web/test/ids.test.mjs` reads `${ROOT}/dist/SHA256SUMS` and `MANIFEST.txt`. `dist/` comes from `scripts/build-mainnet.sh` and the placeholder from the road‑step‑9 build; neither is produced by `scripts/run-tests.sh`, which runs the web gate.
- *Gains:* on a box without them the canonical run fails at the web gate with `ENOENT` — a red gate that is not about the audited code, which is how a real red gets scrolled past. It is **not** a silent pass: `ids.test.mjs` pins `dist/MANIFEST.txt`'s commit to `RELEASE_COMMIT` and the sums to `web/src/config.js`'s pins, so a stale `dist/` fails loudly.
- *Evidence if I am right:* `mv .cache/placeholder .cache/placeholder.off && node web/test/run-all.mjs` → `ceremony.test.mjs` dies reading the placeholder; `mv dist dist.off` → `bundle.test.mjs`/`ids.test.mjs` die.
- *Fix:* have `run-tests.sh` build the placeholder (or make that arm count itself as skipped with a printed reason) and either run `build-mainnet.sh` before the web gate or point the two `dist/` reads at `target/deploy/*.so`, which the runner itself produces. `web/`, fixable layer.

**F‑5 (INFO, coverage of this pass): `WEB_FLOOR = 682` includes two files this bundle does not carry.**
- `web/test/run-all.mjs`'s `FLOORS` names `ix.test.mjs` (47) and `proxy.test.mjs` (109) — 156 of the 682 — which the brief assigns to the programs pass. The floor is therefore unverifiable from this pass, and so are the two files' own arms. Not a defect; recorded so the next reader does not read a green 682 as "every page test was read this round".

**The round‑24 section's both‑directions claim:** I re‑read every arm in it. The wiring claims that were *only* source regexes in round 24 (the reserve‑read judgement, the vault‑set baseline, the reveal‑skip) now have extract‑and‑run arms added by rounds 39 and 43 (`R39 C02` runs the balance write, `R39 C01` runs the send order, `V43o‑3` runs the reveal loop). The remaining presence‑only arms (`/budgetPlan\(plan, /`, `/judgeDistributeRefusal\(lastFailure, cfg, fresh\)/`, the `if (!LIVE) {` ordering) can each fail if the line is removed or reordered, so they are weak but not dead. I did not find a further arm that cannot fail at all beyond F‑3.

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?**
Not that I can substantiate. The one place I looked hardest is limit 10, because it changed shape this round: the operator key's worst case is `cap × cooldown windows` bounded by the revenue PDA's balance above the reserve, with a throughput of ~34 SOL/day (round 37 C05) and an on‑chain stop the guardian can pull. The swap no longer signs bytes a third party built, and the output floor is enforced by the pool program. I found no path by which the operator key reaches a vault, the pool or sale cbBTC, and no path by which it can push the ledger into reading a failed cycle as closed. The one thing a reader should keep in view is that the *read‑time* 100 bps gate does not bind execution: the number that bounds a sandwich is 150 bps, which is disclosed but is not the same number as the filter's.

**2. Is anything listed as a limit not actually a limit?**
Two candidates, both already handled by the code and both worth the wording pass:
- Limit 9/44 say nothing refuses a redemption that destroys a foreign nested asset. Since item 58, an **inner CBOB vault** is rescued (before, in an optional set‑up step, or after), and the redeem page names everything else. That is already written in item 58's text; the residue that is *really* still open is only the foreign asset and the non‑reserve token — which is what limit 44 says.
- Limit 25's control ("capture is permissionless and rides on mint/claim/activate/claim") is true, but the *cost* is now bounded differently than the text implies: the crank's reveal lane runs every minute and each reveal carries an inline capture, so a lapse needs the whole lane plus every host to be silent for ~300 slots. That is what round 25 A1 measured and the text says.

**3. Is any DISCHARGED item not actually discharged?**
I checked the ones that touch this pass: 14 (duplicate keys — `DuplicateAttribute` is in `check_attributes`), 19 (unlevelled vault — `activate` refuses `NotRevealed`), 30 (`split_bps` written once), 31/33 (the cadence and the notice are `initialize` values, exercised), 15 (`VaultTooNew`), and the Bank/deck/distributor family (the files are gone; the selftest asserts no import of `cosign.mjs`/`deck.mjs`/`distribute.mjs` and no reader of the retired key paths). All stand.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**
**Yes, one, and it is the one with no execution evidence anywhere: the `--reconcile` path.** Item 22's rehearsal list names five things and a reconcile run is not among them; SPEC's "Known limits" says the I/O is untested and "that is why it is said here"; and the selftest's own harness for the reconcile stubs `listVaults` to `{live: [], burnt: [], all: []}`, so even the offline arm never executes the per‑vault loop (`getTokenAccountsByOwner` → `account.owner.toBase58()` → `reconcileAmount(account.data)`). That loop is the only control for the undeclared‑token‑account class (impossibility 2, limit 44) outside the staged redeem page. It is disclosed, but disclosure is not an execution plan, and item 22 is the place to put one.
- *Evidence if I am right:* run `node bank/alarm.mjs --reconcile` against a cluster holding one vault with a non‑canonical classic token account: if the per‑account detail prints a number, the I/O shape is right; if it prints `unreadable` for every account, `account.data` is arriving as the raw `[base64,"base64"]` pair; if it throws, `account.owner` is arriving as a string. Either of the latter two is a real defect in a control, not a nuance — the first is a cosmetic loss of the amount, the second is the whole report failing daily.
- *Fix:* add it to item 22 as a sixth named item ("one `--reconcile` against the rehearsal deployment with a vault that owns a non‑canonical account, and the report's per‑account line recorded"), and make the selftest's reconcile arm pass one live vault so the loop runs at least once offline.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Concretely, before the lock, and in the order that costs least:

1. **Run the four things no reading can replace, and record their outputs as artifacts, not prose.** (i) `node bank/alarm.mjs --reconcile` against a live cluster with one vault that owns a non‑canonical token account (answers question 4 above). (ii) `node bank/revenue.mjs --audit` after one hand‑forced post‑sweep failure (item 22.4) — the recovery path has never executed. (iii) `scripts/run-tests.sh` inside the rehearsal tree at the release commit, with the probe's floor line printed (not `SKIPPED`) and the fork's — that is item 53's proof and it is the only evidence that the shipped off‑chain code runs at all. (iv) one `--probe` and one dry‑run pass of `bank/crank.mjs` and `bank/revenue.mjs` against the rehearsal deployment with `CBOB_ALARM_REHEARSAL=1`, so the operator sees the real plan text and the real notices before they matter.

2. **Have someone who did not write it run the alarm for a week and *act* on every page.** The detectors are proven both ways; the *router, the human and the runbook* are not. A page nobody answers is indistinguishable from a page nobody sends, and this round's whole notify design (per‑kind streams, urgent one‑shots, level recoveries) is only as good as the person reading it.

3. **Re‑derive, by hand, the three numbers the launch gate depends on, from mainnet, on the day of the lock**: the deployed Core's hash against the four pins, `MINT`'s `charter_opens_at` against `launch/mainnet-init.json`'s `lock_deadline` (the earlier of the two is the deadline the alarm enforces), and the PoB root recomputed from `scripts/pob-set.json`. Two of those three are automated; the third is a person confirming that the file's OPEN values were filled with the values they ruled.

4. **Put the box's own custody on a schedule that does not depend on this box.** Limit 56 (`bank/keys/cbob-release.json`), limit 10's operator key and the deploy authority are all on one host with the alarm and the ledger. A single compromised user reads them all and can also silence the alarm. Nothing in code fixes this; a decision about cold storage, a multisig, or at least a different host for the ledger, is the only thing that does, and it must be made before the lock because after it the key can never be replaced except by the holders' vote.

5. **Decide, in writing, who is allowed to write the two watermark files (`bank/log-gaps-reviewed`, `bank/unreadable-reviewed`) and what "reviewed" means.** They are the only hand step in a pipeline whose stated rule is "a read that fails is an alarm"; a watermark written carelessly is a permanent mute on exactly the events the alarm could not parse.

6. **Do the one thing AI audit structurally cannot: exercise the failure paths against the real chain, and keep the transaction signatures.** Every finding in this project's history that mattered was found by a measurement, and every wrong one was a plausible argument. The list in item 22 is the whole of what remains; run it, record the signatures, and treat a missing signature as a failed rehearsal rather than a passed one.