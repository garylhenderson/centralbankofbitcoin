# Independent audit — v6 off-chain pipeline, MINT/SWEEP agreement, `web/test/`, round‑41 repairs

**Scope of what I actually did.** I read the tree as delivered. **I executed nothing** — no validator, no suite, no sim, no fork, no alarm pass, no RPC call. Every statement below is a reading of source, and for each claim I name the measurement that would settle it, so a wrong reading is cheap to refute. Where a claim is settled by a run I was *given* (round 41's `VALIDATION.md`, the canonical suite log, the fork log), I say so and treat it as evidence rather than authority.

**What I did not verify, and therefore do not assert:** the enum byte values inside the Orca/Meteora swap data (my reading of Whirlpool's IDL disagrees with `Buffer.from([1,1])`, and the fork's SW.1/SW.4 — real 2 SOL and 10 SOL swaps landing through the real Orca program with `got >= minSats` — is the measurement that decides it; **the measurement wins and I am not filing this**); the real owner of the sponsored Pyth accounts (the fork's `market()` reads them through the real Clock and real accounts, so the ownership check is measured); `web/src/**` (not in this bundle) and `web/test/e2e-localnet.mjs` (moved to the programs pass).

---

## R0 — Round 41's verdict, its repairs, and its disproved claims

**Every repair named in `VALIDATION.md` is present at its site, and at the sites of its shape.**

| Round 41 item | Verified in this tree |
|---|---|
| **C01** (poster drops the 2nd redemption in a tx) | `bank/redemption-poster.mjs`: `draftKey(w) => \`${w.signature}:${w.vault ?? '*'}\``, `queued` rebuilt from `JSON.parse(l).web` via `draftKey`, and the loop's guard `if (queued.has(key) \|\| queued.has(\`${s.signature}:*\`)) continue`. The key is per‑redemption (`web.vault` = the padded 1‑based number, distinct per mint index). Fix holds. |
| **C02** (oracle age unpinned between 100–399 s) | `bank/selftest.mjs` now has `R41 C02`: 181 s refused / 180 s accepted **in literals**, plus `SW.MAX_ORACLE_AGE_SECS === 180`. The older relative arm is still there beside it. Fix holds. |
| **C03** (SPEC's crank fee sentence) | `SPEC.md` control table and `bank/crank.mjs` now both say: refused only below the plan **without its reveals**, then runs that plan plus as many reveals as keep the key **at or above** 0.005 SOL. Matches `budgetPlan` line for line. |
| **C04 / C06** (measured rejections pinned) | `R41 C04` drives the extracted poster loop and requires a level‑0 redemption to **throw**; `R41 C06` pins `MIN_SWEEP_LAMPORTS === 10_000_000n` in a literal and the 1‑lamport‑under boundary. Both present. |
| **A1–A3** (dust in `bank/`) | `bank/anchor.mjs` `isSystemDust` + `pinnedAccountData` returning `null`; `bank/spl.mjs` `readTokenAccount` reading System+0‑bytes as `absent`; `bank/alarm.mjs`'s extracted `g()` marking a dusted config `_missing`. All three present, with `R42 A1/A2/A3` arms driving the real `g()`. |

**Its disproved claims re-tested from first principles.** C05 (a pre‑filled operator wSOL account halting the swap) — I read the helper path: `closeAccount(ownWsol, owner, owner)` on a *native* account returns the wrapped lamports rather than refusing on a non‑zero balance, and the round‑33 R33.G4 arm builds exactly that case; I accept the rejection. C08 (`rescue` seed ungated) — `web/test/ids.test.mjs` compares `SEEDS.rescue` against MINT's `RESCUE_SEED`; rejected. C11 (the `\|` binding) — the alternation is inside the group; rejected. C09/C12/C13/C16/C17 — I reached the same dispositions from source. **I did not re-run the suite or the fork; those verdicts stand on the logs I was given, not on my own execution.**

**Surviving gaps the verdict itself names, still open in this tree:** `web/test/run-all.mjs` is in no automated gate, and `web/test/e2e-localnet.sh` ends with `CBOB_E2E_RPC="$RPC" node .../e2e-localnet.mjs` and **no assertion‑count check** — every other suite in this tree has a floor that must *equal* the count. Round 41 named both as obligations; both are still open. Not a new finding, but a surviving one.

---

## R1 — The crank (`bank/crank.mjs`)

I traced every instruction the crank builds against MINT's account lists and every plan branch against the program's gates. **I found no plan the program refuses, no plan that pays or joins a dead vault, no out‑of‑order reveal, and no value path the program does not already pin.**

What I checked, and why each holds:

* **Send order** — reschedule, capture, reveal, retire, pre‑join, pre‑expire, split, distribute, post‑expire, activate, claim. This is red‑team 3 finding 6's order; `R39 C01` drives the extracted send block and asserts it, including the frozen‑pool join‑only claim batch. Pre‑joins run *before* the distribution (MINT refuses `JoinWaitingFirst` otherwise) and the pre‑join `claim` carries the pool, so `monthly_inline` sees `waiting_to_join > 0` and does nothing — the planned `distribute` is the run that credits. That chain is correct.
* **Reveal ordering** — strictly from `cfg.revealed_total`, stopping at the first not‑ready record; the hash is checked *before* a fee is spent; a benign refusal (`AlreadyRevealed`, `RevealOutOfOrder`) breaks the run rather than skipping (safe).
* **Dead vaults** — `retireBurned` covers any burned asset at any level; `preJoins`, `joins` and `ready` all require `assets[r.asset] === 'live'`; an unreadable asset is reported and left out.
* **Value** — the only `programId` in the file is MINT; the only `distribute` it sends is `burn = 0`; the selftest asserts both. The reveal payer is the crank key (Core attribute rent), which `REVEAL_RENT_LAMPORTS = 16 × 6,960` *over*-estimates on mainnet (5,080/byte) — conservative, never looser.
* **Fee budget** — `budgetPlan` runs the base plan whenever it is covered and trims reveals so the key never drops below the floor; `planCostLamports` counts one signature per transaction plus one reveal rent per reveal. I re-derived `splitToPool = total − floor(total×1500/10000)` against MINT's `bank_cut = floor(total×(10000−split_bps)/10000)`, `holders = total − bank_cut` — **exact**, including the rounding direction (and `split_bps` is hardcoded 8500 at `initialize`, so the crank's constant 1500 cannot drift from it).
* **Clock** — the plan uses the chain Clock (`chainSec`), the heartbeat uses the box clock and the alarm compares it to `wallSec`; both pairs are internally consistent.

---

## R2 — The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

I checked each named detection against the state it reads: config drift with the L11 absent‑program skip and the L5 carried baseline; the brakes as transitions plus INFO standing status; `swap_operator_armed`/`guardian_armed`; the PoB collection's plugins **and** update authority; `redemptions_near_cap` (with the round‑22 A3 idle‑window guard); `pool_frozen`/`pool_insolvent`; `distribution_overdue` + `joins_stalled`/`boosts_stalled`/`launch_tick_overdue`; `royalties_unswept` with the cooldown‑aware grace; `sweep_unledgered_state`; `crank_silent`/`crank_failing`/`crank_problem`; upgrade authority past the lock date for **all five** of ours plus Core and the four third‑party programs; and the production value list. Each has a both‑ways arm. **I found no dangerous state read as quiet.**

Two things I did find, both about *what is stored* rather than what is read.

### 1. LOW — the alarm replaces its per‑vault balance baseline from a vault list it has just declared untrustworthy

**Construct.** `bank/alarm.mjs`, `main()`, the `next` object:

```js
vaults: setChange.trustCurrent ? vaults : (prev?.vaults || vaults)
```

protects the vault set against a shrunken DAS page (the comment above it says exactly why), and `balances` is stored unconditionally from the same pass's short `legs` list. The rollback block only restores `prev.balances` when the *page was not delivered*.

**What an accident gains.** After a `vault_index_shrank` pass, the stored `balances` map holds only the vaults the short list named. The next pass's `detectBalanceDrops(prev?.balances, balances)` iterates `Object.entries(prevBalances)` and `continue`s on `after === undefined` — so every omitted vault is skipped for that pass, and `judgeReserveRead(prev?.balances?.[l.key], r)` has no prior value to carry forward.

**Evidence that would exist if this is right.** Observable in `state.json` with no live chain: hand the extracted balance‑write loop a `prev.balances` of two keys and a one‑key `balances` (as `R39 C02` already does for the carry‑forward arms), then assert `next.balances` still has both keys when `setChange.trustCurrent === false`. Today the assertion fails.

**Honest impact.** I could not construct a loss of holder value from it: a live vault's reserve cannot fall except by a redemption, which removes the vault from the set, so the one‑pass silence is theoretical. It is a real asymmetry with the protection sitting three lines above it, and one line fixes it — **when `setChange.trustCurrent` is false, keep/merge `prev.balances` the same way `vaults` is kept.**

### 2. INFO — the reconcile's `undeclared_token_account` CRITICAL fires on a state the redeem page deliberately treats as ignorable

**Construct.** `bank/detectors.mjs` `detectUndeclaredTokenAccounts` raises CRITICAL for **every** non‑canonical account, including an empty 165‑byte Token‑2022 account, with the text *"…this balance is destroyed with the vault unless someone declares it"* — a sentence that is false for a zero balance. `bank/alarm.mjs` `reconcile()` feeds it `D.reconcileAmount(TOKEN22_ID, …)`, which labels the base field rather than filtering. The redeem page's W10 rule (`web/test/plan.test.mjs`: *"an empty 165‑byte Token‑2022 stray gets NO box, and the vault opens"*) treats the same state as harmless.

**What a stranger gains.** One ATA create (~0.002 SOL rent) makes the daily reconcile report a CRITICAL for a chosen vault, forever, until it is redeemed — a stream the operator cannot close and the holder cannot act on (the page will not offer to move it).

**Evidence.** A unit call of `detectUndeclaredTokenAccounts('A', [], [{ address:'x', amount: D.reconcileAmount(TOKEN22_ID, Buffer.alloc(165)) }])` returns one CRITICAL today; the two controls disagree on the same input. **Fix:** have the detector skip (or downgrade to INFO) a 165‑byte account whose stated quantity is `0`, matching W10, and correct the sentence for the zero case.

---

## R3 — The layouts (`bank/layout.mjs`, `bank/selftest.mjs`)

* `STRUCTS.MintConfig` is field‑for‑field equal to `pub struct MintConfig` in `programs/cbob-vault-mint/src/lib.rs`: I counted 64 fields in the same order, ending `cbob_burned_total` / `boost_expiring: [u32; BOOST_RING]`.
* `parseRustStruct` **throws** on any line it cannot read as `pub name: Type,` (round 22 L1) — a private or multi‑line field cannot slip past.
* The cross‑program pinned offsets are scraped and compared, and round 22 L2's arm asserts *every* `OFF_*` constant any program pins is compared (nothing scraped and ignored).
* `offsets()` stops at the first variable‑length field but **sets** that field's offset before breaking, which is why `offsets('SealConfig').reserve_mints === 41` is usable for BURN's `OFF_RESERVES` / MINT's `OFF_RESERVES`. I verified the break placement by hand.
* **Round 24 D6 is closed:** `SEEDS` is now asserted (11 of 11) against each program's `*_SEED`, with a both‑ways arm for a mistyped seed and for a seed no program declares.
* `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are scraped, evaluated and compared less padding against `fixedLength` (1005 / 211), with an arm that adds one byte to the Rust and goes red.

**A struct change cannot slip past** the field list, the versions, the seeds, the spaces or the scraped offsets — each has its own red arm.

---

## R4 — The money arithmetic (`bank/accrual.mjs` vs MINT)

Line‑by‑line against `credit`, `owed_of`, `join`, `reweigh`, `ceil_sats`, `debtAtActivation`:

* `credit`: `delta = avail·1e12 / w; acc += delta; owed += delta·w` — identical, including integer division.
* `pendingScaled`: `(weight + boost)·acc + carry − debt`, refusing a negative — identical to `owed_of` (carry added before the debt is taken).
* `join`: `debt = weight·acc` (level weight only, no boost) — identical.
* `reweigh`: owed moves to `carry`, debt restarts at the new weight, `owed_scaled` untouched — identical.
* `ceilSats`: `(scaled + 1e12 − 1)/1e12` — identical to `ceil_sats`, and used identically by the crank's `available()` and the alarm's `poolAvailable`/`detectPoolHealth`.

The crank's pre‑expiry / post‑expiry / pre‑join weight and owed projections match MINT's `expire_boosts`, `advance_epoch` and `join` exactly, including the `preExpired` special formula (`atExpiry + levelWeight·(acc_new − acc_old)`). `EXPIRE_BATCH = 20 ≤ MAX_EXPIRE_BATCH = 30`; `CLAIM_BATCH = 14` is the measured legacy limit. **No divergence found.**

I also checked the ring invariant the header claims (live end epochs ∈ `(epoch, epoch+63]`, so 63 distinct values mod 64 never collide) and MINT's host test that drives it through the program's own free functions across 260 epochs — the model and the code agree.

---

## R5 — The swap and the revenue cycle

**(a) Oracle math.** `expectedSats = lamports·sol.price·10^(es−eb) / (btc.price·10)`, with the exponent pushed to numerator or denominator by sign. I recomputed the pinned vector by hand: 2 SOL at 12045355552e‑8 / 8592910904675e‑8 → **280,355** expected, **276,149** floor at 150 bps — matching `R40 C02`'s literal tuple. `satsPerLamport` is the same quantity in float (1.40e‑4), used only for the deviation comparison. No overflow path (prices are ~1e11, `Number()` is exact to 2⁵³).

**(b) Pyth.** Offsets re‑derived: `8 disc + 32 write_authority + 1 Full tag + 32 feed + 8 price + 8 conf + 4 expo + 8 publish_time = 101` minimum, with `price@73 conf@81 expo@89 publish_time@93` — matching the code, the selftest's synthetic builder, and the fork's `writeBigInt64LE(chainNow − age, 93)`. The account is a **derived** PDA under the push oracle, must be owned by the receiver, must be **Full**, must carry the expected feed id, and the age is judged against the **chain** Clock (with a 30 s future bound). A chosen or stale price cannot be written into that address by anyone but the oracle program; the age/confidence/pool‑agreement checks bound the rest, and the residual (the oracle's own error, the one RPC endpoint) is stated in limit 10.

**(c) Deviation filter.** `orcaSpot = (sqrtPrice/2⁶⁴)²` (raw B per raw A = sats per lamport, cbBTC having 8 decimals); `meteoraSpot = 1/(1+binStep/1e4)^activeId` (the inverse, Y per X reversed). Both readers refuse the wrong token order. The selftest places the oracle 99 and 101 bps either side of each pool **through `market()`** and asserts use/skip.

**(d) Minimum out.** One floor, `m2.f.minSats`, rides in Orca's `other_amount_threshold` (offset 16) and Meteora's `min_amount_out` (offset 16) — the same number the judge is told, in the units each program expects (output base units = sats on both).

**(e) The judge.** I re‑derived the seven slots and agree it is complete for *our* defects: exact programs, exact instruction count, one signer, exact ATA creations for our own wallet and mint, one System transfer of exactly `lamportsIn` into our own wSOL, SyncNative, the venue swap at pinned key positions with `amount`/`threshold`/Orca direction and price limit, and one close of our own wSOL to us last; no Token instruction but SyncNative and that close; no priority fee; the amount and floor are mandatory arguments (`R25 L1` refuses all eight tampers on both venues, and the round‑24 judge is shown passing all eight). The venue‑internal accounts it does not pin (Orca's vaults/ticks/oracle, Meteora's reserves/bins/oracle/event authority) are validated by the venue programs themselves, and this is already dispositioned as round‑25 C10. It cannot stop a tamper with write access to `bank/swap.mjs` — the accepted box‑owner residue.

**(f) Derivation.** Orca: `[s0, s0−span, s0−2·span]` for a_to_b, `tick_array` PDA under the pool with the start as a string; Meteora: `[i, i+1, i+2]` for Y→X, `bin_array` PDA with the index as `i64`. Both recomputed by hand against the selftest's `-88733/16 → [-90112,-91520,-92928]` and `5920 → [84,85,86]`, and both exercised against the real programs on the fork. At a boundary the selftest pins the containing array as `s0`; an uninitialised array is the pool program's refusal, not ours.

**(g) wSOL.** Wrap exactly `lamportsIn` into the operator's own wSOL ATA (idempotent create, so a pre‑existing balance is fine — the wrap adds to it), sync, swap, close back to the operator. A leftover wrapped balance cannot remain: the close returns it. A frozen/delegated/foreign wSOL ATA is the token program's refusal and the cycle stops open and loud.

**(h) Failure and retry.** Orca first, Meteora only on `refused` from `classifySendFailure` (preflight refusal, landed‑with‑err, or expired‑and‑absent). A `landed` outcome is recorded; `unknown` stops the cycle open. The ledger row is written *before* the send, and every uncertain send leaves a `pending<Hop>Sig`. `--audit` and the alarm hold the ledger to the chain (sweep amount, rejected‑row contradiction, split anchoring by the return's chain time). **I could not find a path by which a timed‑out swap is retried or a cycle is read as closed without a proven cbBTC return.**

**(i) What an adversary can extract, bounded.** The read‑time 100 bps pool gate does not bind execution; the **on‑chain floor is the real bound**: the pool program refuses any output below `oracle_expected × 0.985`. So a sandwich, a pool pushed to the edge of the gate, or a stale‑but‑accepted oracle can take at most **150 bps of each cycle's oracle‑expected output** — 0.15 SOL on a 10 SOL cycle. At the ruled cadence (cap 10 SOL, cooldown 6 h, a thief timing it exactly) that is ≤ 4 cycles/day × 0.15 = **0.6 SOL/day** extracted within tolerance, against 40 SOL/day of principal at risk if the key itself is hostile — which is the accepted limit. A manipulated Meteora pool (thinner) is bounded by the same 150 bps floor, not by its own price. The cycle size (10 SOL) makes the tolerance material only in aggregate; it is not a per‑cycle theft.

---

## R6 — The gates

* **`bank/selftest.mjs`** — `FLOOR = 940` with `R.length !== FLOOR` fatal, and the SPEC‑count gate compares every occurrence of nine floor phrasings (`on-chain`, `detector`, `allocation`, `poster`, `mainnet`, `launch`, `pob`, `sim`, `swap`, `expiry`), requiring at least one occurrence, with a both‑ways arm on a *later* occurrence. I re‑summed the numbers against `run-tests.sh`'s floors and SPEC: 899 / 940 / 39 / 24 / 4 / 14 / 49 / 33 / 71 / 16 — **all equal**. The web floors sum to 671, matching the validation record.
* **`scripts/run-tests.sh`** — every sub‑suite captured, printed, then held to an **equality** floor; `CBOB_TEST_FILE` and `CBOB_CACHE` refuse; the Core sha256 is hardcoded and not overridable; `overflow-checks = true` is grepped; the CPI wrapper is built into `.cache` and never into `dist/`.
* **`scripts/cron-install.sh`** — `flock -n` on every money job, `ours <job>` anchored to end‑of‑line (L12), commented lines ignored (C03), a rehearsal marker refused before any write, and the money posture printed from the crontab actually written.
* **`sim/swap-fork.sh`** — `SWAP_FLOOR = 16` with equality.
* **`scripts/build-mainnet.sh`** — five programs in `dist/`, exit status as the build gate, both target dirs wiped first, the sweep helper's mainnet bytes compared against **both** the localnet rebuild and `target/deploy`, and all four keyed programs asked on a validator in both directions.

**Assertions that cannot fail / floors satisfiable by deleting work:** I found none in `bank/selftest.mjs` or `scripts/run-tests.sh` — the round‑19 equality rule plus the derived‑list arms (round 24 L13a/b) close the class. **One gap survives:** `web/test/e2e-localnet.sh` runs `e2e-localnet.mjs` with no count check, so a run that stopped early after passing what it reached would exit 0. Round 41 named this as an obligation; it is still open.

---

## `web/test/` — can each test fail when its property is broken?

I read every file in the bundle for the round‑37 shape (an arm that cannot go red). I found **no arm that cannot fail**, and several that are explicitly proven able to fail (`ix.test.mjs`'s `diffIx` control; `bundle.test.mjs`'s `mArr`; `ceremony.test.mjs`'s presence‑bound `indexOf` ordering arms after round 40 C01; `ids.test.mjs`'s `pinDiff` control; `proxy.test.mjs`'s refusals; `meta.test.mjs`'s per‑vault "keeps its previous file" arms with a mock whose behaviour is toggled). `run-all.mjs` requires `m[1] === m[2]` **and** `Number(m[2]) === floor`, so a partial pass is not a pass.

Two structural notes, both already on the record: the offline suite is in no automated gate (round 36 A8 / round 41 C07), and the end‑to‑end shell has no floor.

---

## The four questions about the accepted limits

**1. Is any limit worse than stated?**

* **Limit 10 (the trusted hop).** The limit's own formulation — *cap × the number of cooldown windows that elapse before the guardian pulls `emergency_stop_sweep`* — is correct and unbounded by the day. The separate throughput sentence, *"royalty SOL beyond about 34 SOL a day waits"*, describes the **honest** job (an hourly run that finds the cooldown a few seconds short and sweeps seven hours on). A **thief** timing each sweep exactly gets `24/6 × 10 = 40 SOL/day`, ~18% more. The limit is not worse than stated (the cap × windows formulation is the binding one), but the throughput figure should say which job it describes. **INFO.**
* **Limit 9 (a foreign nested Core asset)** — still exactly as stated: `detectNestedVaults` walks *our* collection, `--reconcile` uses `getTokenAccountsByOwner` (blind to Core assets), and the only pre‑signature control is the staged redeem page. **Not worse; correct.**
* **Limits 41, 46, 47, 56** — the honest lists name the whole exposure (transfers unlimited; the hot Moments key through the window; a stolen guardian holding the brake for good below half turnout; the whole $CBOB supply on a box key). I found nothing wider.

**2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?**

* **Limit 27** is narrower than its "dead weight" phrasing suggests: `retire_burned` runs on every crank pass and the crank never pays or joins a burned vault, so the cost falls only during a crank stall — which the limit already says.
* **Limit 7's reconcile clause** ("its stall is silent") is **correct**, and for a reason the text does not give: the cron wraps the job in `flock -n`, so a wedged holder makes the *outer* flock fail and node never starts — the in‑process `withLock` catch (which does notify) is unreachable on that path. Not a defect; worth one clause so nobody "fixes" it by removing the flock.
* **Limit 44's C5/T22 clauses** match the helper (`read_token` demands exactly 165 bytes; the close is unconditional) and the page's W10 rule. No drift found.

**3. Is any DISCHARGED item not actually discharged?** No. I spot‑checked 12/17 (measured, with the CU ceilings), 14 (`DuplicateAttribute` present in `check_attributes`), 19 (`levels.json` gone; `activate` refuses `NotRevealed`), 30 (`update_wiring` gone; `split_bps` hardcoded 8500), 31/33 (period and notice are `initialize` values, exercised), 51 (boost built, mirrored in `accrual.mjs`, crank, alarm), 54 (measured), 15 (`VaultTooNew`), and the Bank‑era family (the four files are absent and the selftest asserts they are deleted and unimported).

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. **22** (nothing has run a distribution against a live chain, plus round 25 L5's revenue cycle), **38** (three values still `OPEN` in `launch/mainnet-init.json`, and `judgeLaunch` refuses while any is OPEN), **50** (pages built and staged, not published; the holder guide is marked DRAFT and may not be published first), **52** (road step 10), **53** (rehearsal tree built, **rehearsal value set and rehearsal mode in `check-launch-params.mjs` still not built**) are all still tracked as open, and the ship gate's road table still shows steps 8–11 not started.

---

## Anything else

* **`bank/selftest.mjs` runs as a top‑level module with no entry guard.** `node bank/selftest.mjs` executes the whole file, and `bank/alarm.mjs --selftest` executes it too (via a dynamic import). That is deliberate and both paths work, but it means any future file that *imports* `selftest.mjs` for a helper runs 940 assertions as a side effect. Worth a comment at the top.
* **`web/test/bundle.test.mjs` requires `/home/ubuntu/luna-remotion/node_modules/esbuild`** by absolute path. A box without that path fails the offline suite before its first assertion; that is loud, but it is an undeclared build dependency of a test that is in no automated gate.
* **`bank/txread.mjs` accepts a Token‑2022 `transferCheckedWithFee`** without an amount check (round 39 W1, pinned). It carries `tokenAmount`, so the detectors that read `tokenAmount.amount` still work; the gap is that the *amount* validation does not cover that one type. Already dispositioned; recorded here so it is not re-litigated.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

The AI process cannot execute against reality, cannot read a page as a person, and cannot be held to a promise it made to a customer. Nine things follow, each concrete and each impossible for another audit round to supply:

1. **Run the dress rehearsal (item 22) and record every signature.** Especially: one full live revenue cycle through **each** pool with Orca forced to refuse so Meteora really runs, and one forced post‑sweep failure walked through the hand recovery to `--audit` clean. `bank/revenue.mjs`'s sweep → swap → return → split → ledger → recovery runs in **no suite, sim or fork**; this is the only thing that executes it.
2. **Run `bank/alarm.mjs --reconcile` once against a real cluster** with a vault holding a non‑canonical token account and once with a vault holding nothing, and paste the JSON into the record. It is the only I/O in the pipeline with no test at all, and the one place the author's assumption about the RPC's account encoding is load‑bearing.
3. **Run the alarm live in rehearsal mode for a week and have a human read every page.** The pipeline's product is a page somebody acts on. No round can check that a page is actionable, or that the person who receives it does the right thing.
4. **Point the alarm at a second, independent RPC endpoint.** The whole design says "a read that fails is an alarm"; a single provider is the single point where that failure is silent.
5. **Move custody before the lock:** the $CBOB release wallet (limit 56) and the five program ids' deploy authority off the box key (road step 9's own note says a lost deploy key means new ids). Both are Gary's call and both are one transaction.
6. **Have a human read the four `initialize` transactions byte‑for‑byte against `launch/mainnet-init.json` before signing.** The checker validates the JSON, not the signed transaction (round 24 A6); the programs check less than the checker.
7. **Build the rehearsal value set and the rehearsal mode in `check-launch-params.mjs`** (item 53 says both are "not built"). Without them the dress rehearsal cannot initialize with shortened periods, and the alarm's production checks make it unreadable.
8. **Do one real‑wallet redemption end to end through the published page** on the rehearsal deployment, with a stray token, a C5 account and a nested vault present. The page is the only pre‑signature control for items 9 and 44, and it has never been used by a person.
9. **Settle item 22.5 — one DAS read of a collection holding a burned Core asset.** It decides whether `detectVaultSetChange`'s `burnt` classification works at all; a "no" edits `bank/`, and `bank/` is frozen.

Then, and only then, the ship gate's four conditions: coverage (strict), frozen, **two consecutive clean rounds with different rosters**, every accepted finding gated both ways, every measurable rejection asserted.