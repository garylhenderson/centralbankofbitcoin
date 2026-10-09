# Round 46 — OFF‑CHAIN pass: independent audit of the current tree

**Scope actually read:** the bundled `bank/` pipeline, `web/test/` (bundle, ceremony, decode, ids, meta, mock‑rpc, plan, ref, run‑all, tx), the sweep helper, MINT, `scripts/` (rehearsal‑tree, token‑programs, audit‑coverage, cron‑install, check‑launch‑params, build‑mainnet, run-tests, probe), `sim/swap-fork.*`, `tests/expiry-budget.mjs`, `launch/*`, SPEC / DESIGN‑v6 / HOLDER‑GUIDE / RT3, and both round‑45 verdicts.

**Bottom line first.** I found **no CRITICAL, no HIGH and no MEDIUM**. Nothing in the five programs; nothing that moves value out of a vault, the pool or the revenue address or credits it wrongly; nothing that stops or wrongly refuses a crack. Round 45's six repairs all hold at every site of their shape, and I could not break any of them. Four LOW/INFO findings are below, all in the fixable layer.

I could not execute anything. Every claim below is either a reading of the bundled source (with file and function named) or a statement of what a run *would* show, so it can be checked.

---

## R0 — Round 45's verdict and its repairs

Round 45 was LAUNCH‑CLEAN with V45o‑1..V45o‑7. The tree I was given carries the `e7c192a` repairs. I verified each at every site of its shape, not only the one the verdict named.

| Finding | Repair site(s) | Verdict |
|---|---|---|
| **V45o‑1** (a null SEAL read invents "no reserve mints" at three sites) | `bank/alarm.mjs` `ataMints` (the per‑pass `pdas`/`atas`/`ataOwner` maps) and the `reconcile()` `reserveList`, both now `cfg['seal.reserve_mints'] \|\| D.carryConfigBaseline(prev?.config, cfg)['seal.reserve_mints'] \|\| D.RESERVE_MINTS`; the reconcile throws `SEAL's config is unreadable and no stored reserve list exists…` when there is nothing to carry | **HOLDS.** I re‑walked all three sites V45o‑1 named (the balance block at `:551`, the ATA maps at `:526/:531`, the reconcile at `:338`) and found no fourth unguarded read of `seal.reserve_mints`. `web/test/plan.test.mjs`'s `reserveMissing` arm and `selftest` V45o‑1 exercise the same shape. |
| **V45o‑2** (the two forced‑failure switches read after the sweep) | `bank/revenue.mjs`: `refuseStrayOverrides()`, then `const FAIL_AFTER_SWEEP = rehearsalFlag(…)` and `const FORCE_ORCA_REFUSAL = rehearsalFlag(…)` at **module load**, before `main()`; `bank/crank.mjs` and `bank/alarm.mjs` call `refuseStrayOverrides()` before reading the RPC | **HOLDS.** `rehearsalFlag` appears nowhere inside `main()`. `main()` uses the stored booleans. |
| **V45o‑3** (the frozen‑pool overdue text) | `bank/detectors.mjs` `detectDistributionOverdue` takes `poolFrozen` and emits the distinct non‑blaming text; `bank/alarm.mjs` passes `poolFrozen: !!pool?.frozen` | **HOLDS.** Selftest R45 V45o‑3 arm exists and is both‑ways. |
| **V45o‑4** (the unreadable retry count dies on a flood) | `bank/detectors.mjs` `carryUnreadPasses(prev, now, attempted)`; `bank/alarm.mjs` writes `unreadPasses: D.carryUnreadPasses(prev?.unreadPasses, looked.unreadNow, looked.attempted)` | **HOLDS at the write.** See INFO‑1 below for the one path it does not cover. |
| **V45o‑5** (the coverage selftest runs after the freeze check) | `scripts/audit-coverage.sh`: `SELFTEST=0; [ "${1:-}" = "--selftest" ] && SELFTEST=1` now precedes the `never` check | **HOLDS.** |
| **V45o‑6** (the crank's below‑floor wording) | `bank/crank.mjs` `budgetPlan`: "…ran its base plan, sent no reveals, and is below the floor." | **HOLDS.** |
| **V45o‑7** (the prompt repeats round 44's R0; the bundle split hid V45o‑2) | not in this tree's code; carried | **Not a code finding.** Its consequence is exactly what I was asked to do: read `bank/revenue.mjs` and `bank/rehearsal-env.mjs` together, which I did. |

**Disproofs I re‑checked and accept:** the fork's `SW.7`–`SW.9` (both pools usable, both swaps inside 20 bps of the oracle) settle the units claim; the bitmap extension exists and `SW.9` used it, so Fable's dust premise is false; `split_bps` is a program constant, so GLM's INFO‑2 cannot happen.

---

## R1 — The crank (`bank/crank.mjs`)

I checked each of the four things the brief asks for.

**A plan the program will refuse.** I walked every instruction the crank sends against MINT's `#[derive(Accounts)]` structs and the handler's own refusals:

- account lists and writability match for `reschedule_reveal`, `capture_entropy`, `reveal_level`, `rescue_nested`, `retire_burned`, `claim` (both the pre‑join and the delivery batch), `expire_boosts`, `split_revenue`, `distribute`, `activate`;
- the pre‑join → expire‑before → split → distribute → expire‑after → activate → claim order matches the program's gates (`JoinWaitingFirst`, `BoostsExpireFirst`, `MonthNotElapsed`);
- the join‑first weight arithmetic (`w = total_active_weight + preJoinWeight − retiringWeight − expiringWeight`) matches `retire`'s and `reweight`'s effect on `total_active_weight` exactly, including the boosted vault that is *retired* rather than expired (both take the same `unschedule_boost` path);
- the `joinedNow` / `preExpired` owed arithmetic reproduces `rejoin`'s `debt = weight × acc` and `expire_boost`'s `carry`/`debt` reset;
- `avail = available(pool.amount + splitToPool, owedAfterRetire)` reproduces `balance − ceil_sats(owed_scaled)` including the split's `holders = total − floor(total × 1500 / 10000)`.

I could not construct a plan the program refuses. The one case where the planner's `avail` can be optimistic — the split not landing — is already handled: the split failure is pushed to `failures` and pages, and a subsequent `PoolShort` is `judgeDistributeRefusal`'s "always a fault".

**A plan that pays or joins a dead vault.** No. `preJoins`, `joins`, `activate` and the delivery loop all require `assets[r.asset] === 'live'`, and a positively burned asset is retired instead. `planRescues` restricts to `nested_vault`/`vault_owns_itself` with a host that is itself, live or burned.

**A reveal sent out of order.** No. The FIFO walk stops at the first not‑ready record; `main()` breaks on `skip`/`mismatch`/`fail`/`benign`; the hash is checked before a fee is spent; `[]` is used only for a positively burned asset (`revealAttrSource`).

**Anything that moves value the program does not pin.** No. Every `programId:` literal in the file is `MINT`; there is no SPL or System transfer; the rescue destination is `cfg.bank_treasury` and MINT refuses any other (`WrongRescueDestination`); `distribute` is sent with `burn = 0`.

---

## R2 — The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

I checked that it pages on every change to a fixed‑forever value, on a pending guardian/operator, on the PoB collection's plugins and update authority, on the redemption window filling, on a frozen or insolvent pool, on a distribution overdue, and on upgrade authority past the lock date for all five programs; and that it asserts Gary's production numbers.

**All present.** `WATCH`/`WATCHED_KEYS` cover every one, `missingWatchedKeys` fails closed when the reader forgets a key, `detectStandingRisks` production list carries 21 %/51 %/3 d/7 d/30 d/the three tighten bounds/the boost ceilings/the $CBOB mint/the PoB collection, and `prog.sweep.{upgrade_authority,hash}` and `prog.core.*` are in the list.

**A dangerous state read as quiet** — I looked and did not find one that survives the program's own guarantees. Two near‑misses, both deliberate and stated: `mint.minted_total` is a status, so a *decrease* is quiet (impossible on chain; a replacement program is caught by `prog.mint.hash`), and `VaultRecord.vault_ata` is not watched (only `activate` writes it, always to the canonical ATA).

**A routine state that pages on every pass** — two, both pre‑launch only and both intended by round 22 A5: `lock_deadline_unset` (five programs deployed as the placeholder, `lock_deadline` OPEN in `launch/mainnet-init.json`) and, once `initialize` has run but road step 10 has not, `pool_unreadable` / `revenue_account_unreadable`. The alarm is armed at step 11, so this is the launch window, not steady state.

---

## R3 — The layouts (`bank/layout.mjs`)

I recomputed the offsets by hand against the Rust and they agree, including every cross‑program constant: `MintConfig` `governance` 41, `minted_total` 141, `bare_burns_retired` 454, `charter_closes_at` 442, `pool_ata` 73, `max_sweep_lamports` 266, `sweep_cooldown_secs` 274; `fixedLength('MintConfig') = 1005` = `MINT_CONFIG_SPACE − CONFIG_PADDING`; `SealConfig` `OFF_RESERVES = 41`.

**Round 24 D6.** The SEEDS comment now says the assertion exists, and it does: `bank/selftest.mjs`'s `SEED_SRC`/`judgeSeeds` scrapes `*_SEED` out of all four programs and requires all twelve to match, plus a both‑ways arm for a mistyped seed and an unmapped key. `coreExecute` (`EXECUTE_PREFIX`) is pinned separately in `web/test/ids.test.mjs`. A struct change cannot slip past the field‑list comparison, the offset comparison, or the `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` evaluation.

---

## R4 — The money arithmetic (`bank/accrual.mjs`)

Line‑for‑line against `credit`, `owed_of`, `reweigh`, `ceil_sats`, `join`, `available`: identical, including the operation *order* in `owed_of` (`weight × acc + carry − debt`). The crank's plan‑time mirrors match the program's post‑pass state. `L.ACC_SCALE === AC.ACC_SCALE` is asserted.

The crank expires every DUE boost before it distributes (`preExpires`) and every boost its own distribution makes due right after (`postExpires`), and the alarm pages `boosts_stalled`, treats `cbob_mint` and both boost bounds as fixed forever, and reports a vote change to the terms.

---

## R5 — The swap (`bank/swap.mjs`) and the revenue cycle (`bank/revenue.mjs`)

(a) **Oracle math.** `expectedSats = lamports × sol.price × 10^(e_s − e_b) / (btc.price × 10)` is the right identity for both exponent signs; the division floors; the `10n ** |e|` is bounded by the −18..0 exponent check at both `readPyth` and `oracleFloor`; `satsPerLamport` feeds only the 100 bps filter. The 150 bps floor is pinned in literals by the R40/R41 arms.

(b) **Pyth verification.** The account is derived under the push oracle, must be owned by the receiver, must be `level === 1` (Full), must carry the expected feed id, must be ≤180 s old by the **chain** Clock, must not be >30 s in the future, and must have confidence ≤30 bps. The account is a PDA of the push program, so no third party can write it; the clock is the sysvar, and an unreadable one refuses.

(c) **Deviation filter.** `orcaSpot` and `meteoraSpot` are both raw‑unit sats‑per‑lamport, in the same direction as `oracleFloor`'s ratio — I checked the Meteora inversion (`1/(1+binStep/10_000)^activeId`) against the pool's X = cbBTC / Y = wSOL orientation and it is correct. Floating point cannot pass a pool it should refuse: the comparison is `dv <= 100` with `dv = |pool − oracle|/oracle × 10_000`, and a pool pushed to the gate is used, which is the stated 100 bps.

(d) **Minimum out.** The same `m2.f.minSats` is passed to the builder and to the judge, and lands in Orca's `other_amount_threshold` (offset 16) and Meteora's `min_amount_out` (offset 16) — both u64 in the base units each program expects.

(e) **The judge.** I re‑read it against the builder. It checks programs, the single signer, the exact seven instructions, the CU limit and no CU price, both ATA creations' full key lists, the wrap's destination and exact amount, SyncNative, the venue swap's data (length, discriminator, amount, floor, and for Orca the sqrt‑price limit and the two direction bytes), the pool, the operator's own wSOL in and cbBTC out, the operator in the authority slot as a signer, and the single close. **One gap: see LOW‑1.**

(f) **Derivations.** Orca's three tick arrays (`floor(tick/span)·span`, then two below) and the oracle PDA, and Meteora's three bin arrays (`floor(activeId/70)`, then two above), the bitmap‑or‑program‑id option, `host_fee_in` as None, the event authority and the two token programs — all recomputed and correct, including the negative‑tick case.

(g) **wSOL.** Exactly `lamportsIn` is wrapped, synced, swapped and closed back. A pre‑existing wSOL balance is swept by the close (the whole account is closed), so it is returned to the operator, not left; a frozen wSOL account fails the transaction (nothing moves); a foreign creator of the ATA cannot exist (the ATA is the operator's own canonical address and the operator is the owner). Nothing is left wrapped — `SW.1a`/`SW.4a` assert it.

(h) **Failure and retry.** Orca first, Meteora only on `classifySendFailure`'s `refused` (preflight, landed‑with‑`err`, expired‑and‑absent); `landed` records the signature; anything else throws with the candidate recorded. The post‑swap delta check and the ledger's `cycleIsOpen` (split, not return) keep a cycle open until a cbBTC return is proven.

(i) **The bound.** A pool at the gate (100 bps) plus the pool fee is ≈116 bps of loss; the 150 bps floor is the backstop. 10 SOL × 1.5 % ≈ $18/cycle, four cycles a day, bounded by the guardian's stop. Stated in SPEC.

**The operator key's worst case:** the program caps the amount, the cooldown and the reserve; the operator must sign; a replacement needs half of all live vaults plus 7 days; the guardian can stop and cancel. What changed from limit 10 is stated in SPEC.

**The ledger cannot read a failed cycle as closed:** `cycleIsOpen` returns true unless a split signature or `splitByOther` is present, and `splitByOther` is only set when the revenue ATA is *provably* empty (which is not "absent").

---

## R6 — The gates

- `bank/selftest.mjs`: `FLOOR = 1032` with an **equality** check.
- `scripts/run-tests.sh`: `floor()` requires equality for every suite; `MIN_ASSERTIONS=912`; `DET_FLOOR=1032`, `ALLOC_FLOOR=39`, `POSTER_FLOOR=24`, `MAINNET_FLOOR=35`, `LAUNCH_FLOOR=68`, `POB_FLOOR=14`, `HOST_FLOOR=6`, `EXPIRY_FLOOR=4`, `SWAP_FLOOR=16`, `WEB_FLOOR=695` (and `web/test/run-all.mjs` holds each of its ten files to its own exact floor, summing to 695).
- `scripts/build-mainnet.sh` proves what it says for all five, the sweep helper included: the three token pins, the pinned Core sha256, the four `--features localnet` behavioural arms in both directions, the sweep helper's byte identity against both `$CACHE/ln` and `target/deploy`, a clean‑tree gate, and an explicit "NOT PROVEN" for the compiled constant.
- `scripts/cron-install.sh` arms nothing it should not: I re‑ran the preservation logic mentally against the ten cases the selftest executes (commented line, prose note, another project's line, `--live --reveal-only` in both flag orders, the watcher line quoting the flags, the trailing‑space case) and it behaves as the arms say.
- `scripts/audit-coverage.sh`: `--selftest` before the freeze check; the quorum headline matcher is anchored and focus‑aware.

**Vacuous checks.** I looked specifically for arms that cannot fail. The suite is unusually good at this (`web/test/ref.mjs` *extracts and runs* the suite's own builders; the R39/R43 arms extract and run `main()`'s send block and the reveal loop). I found one that is one‑way — INFO‑3 below.

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?** I could not make any of them worse.

- **Limit 10's throughput**: SPEC's "about 34 SOL a day" is right for the shipped hourly cron (the 6 h cooldown is picked up at the next hourly run, so the effective cadence is 7 h, 24/7 × 10 SOL).
- **Limit 25's re‑roll**: SPEC already says the crank "confirms each capture serially" and that one stalled RPC socket lapses windows; the crank's own every‑minute lane and the four capture‑carrying host instructions are the stated control.
- **Limit 28 / 32 / 41 / 46 / 55 / 56 / 57 / 58 / 59**: each is stated at least as widely as the code is. I checked 46's two bounds (the alarm samples state; the key cannot transfer or burn a PoB) against `claim_charter_vault`'s pass‑through and Core's authority rules and both hold.
- **Limit 44**: the narrower classic‑token sweep, the four exclusions (Token‑2022, frozen‑with‑balance, foreign close authority, unreadable mint) and the ">20 grouped into one box" rule all match `plan-redeem`'s behaviour in `web/test/plan.test.mjs`.

**2. Is anything listed as a limit not actually a limit, or closed by something the author did not notice?**

- **Limit 7's reconcile lane**: the reconcile uses `LOCK + '.reconcile'`, a *different* lock file from the main pass, so a wedged reconcile cannot stall the 30‑minute watch — that is stronger than the text implies, in the safe direction.
- **Limit 27's dead weight**: the crank's `retireBurned` runs at any level (round 23 I1) and before the joins, so the window is one pass, not "until its turn to reveal" — again stronger than stated.
- **Limit 6**: the `flock -n` lease plus the in‑process lock plus the dead‑man's switch make an aborted run *eventually* visible (`crank_silent`, `royalties_unswept`), which is more than "indistinguishable in the log" — the diagnosis gap is real, the correctness gap is not.
- I found nothing that is listed as a limit but is in fact closed.

**3. Is any DISCHARGED item not actually discharged?**

- **14 (duplicate attribute keys)**: `check_attributes` refuses `DuplicateAttribute`, and `charter` is appended *after* the check and is itself reserved. Discharged.
- **19 (the unlevelled‑vault halt)**: `activate` refuses `NotRevealed`, so no activated vault is unlevelled. Discharged.
- **12/17 (compute units)**: measured, with the legacy/v0 caveat stated. Discharged.
- **30/31/33**: discharged by stage 3b/3c; the values are `initialize` parameters now. Discharged.
- **1a–24 (the Bank family)**: gone with the Bank, the co‑signer, the deck and the distributor; I confirmed no file imports `cosign.mjs`, `deck.mjs` or `distribute.mjs` and no file reads the retired key paths.
- **51, 54**: built/measured as stated.
- **One caveat I cannot close from here:** item 14 cites "Assertion 11.4" in the on‑chain suite, and the suite file is not in this bundle. I verified the program‑side refusal; I did not verify the assertion.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

No. 22, 38, 50, 52 and 53 are named as OPEN AND BLOCKING in SPEC and in round 45's VALIDATION; 38's three OPEN values (`charter_opens_at`, `lock_deadline`, `vault_collection`) are still `null` with `"status": "OPEN"` in `launch/mainnet-init.json`; 22's ~2,100‑vault scale is explicitly *not* discharged by the five‑vault rehearsal; 22.5 (the DAS `burnt` read) is still carried; 50's pages are built and staged, and the guide is still DRAFT. Nothing has been demoted.

---

## FINDINGS

**CRITICAL: none. HIGH: none. MEDIUM: none.**

### LOW‑1 — `judgeSwapInstructions` compares account pubkeys but not the writable/signer flags on six of the seven instructions (`bank/swap.mjs`)

**Construct.** `const keysAre = (ix, want) => !!ix && ix.keys.length === want.length && want.every((w, i) => ix.keys[i].pubkey.equals(w))` compares **pubkeys only**. It is the check for instruction 1 (the operator's wSOL ATA create), 2 (the wrap), 3 (SyncNative), 4 (the cbBTC ATA create) and 6 (the close). The only flag checks in the function are the global `if (k.isSigner && !k.pubkey.equals(owner))` loop (which forbids *extra* signers) and `if (!signer?.pubkey.equals(owner) || !signer.isSigner)` on the venue swap's authority slot. So an instruction can lose `isWritable` — or lose `isSigner` on the payer/authority — and still pass.

**What an accident gains.** Nothing is stolen: the pubkeys are pinned, so no other account can be substituted. The consequence is that the judge — the stated last line before the operator key signs — is incomplete, and a builder defect that clears a required flag is caught on chain instead of before signing. The swap then refuses, the cycle stays open with the SOL on the operator key, and limit 10's hand recovery (the one procedure that can double‑swap) is what closes it. That is the loud path, not a loss, which is why this is LOW and not higher.

**Evidence if right.** Build the honest Orca swap with `swapInstructions({venue:'orca', owner, lamportsIn, minSats, w, p, bitmapExists:true})`, then set `ixs[3].keys[0].isWritable = false` and call `judgeSwapInstructions(ixs, owner, 'orca', {lamportsIn, minSats})`. I predict it returns `[]`. The same on `ixs[6].keys[0].isWritable = false` (the close's source) and on `ixs[2].keys[0].isSigner = false` (the wrap's `from`). On chain each of those makes the Token or System program refuse, so the transaction reverts and nothing moves. The round‑25 L1 tamper set changes pubkeys and data only, so none of the eight arms covers this shape.

**Fix.** Make `keysAre` compare `isSigner` and `isWritable` as well, and assert the required flags where the instruction needs them (each ATA create's payer as signer and writable; the wrap's `from` as signer; the close's authority as signer). Add two arms (a cleared writable flag on instruction 3, and a cleared signer flag on instruction 2) to the round‑25 L1 tamper set, each shown red at the current tree.

### INFO‑1 — the alarm's retry counters survive an undelivered page (`bank/alarm.mjs`)

**Construct.** In `main()`, the `if (!delivered)` block rolls back `config`, `balances`, `cursors`, `backlogs`, `sweepJudgedThrough`, `sweepCooldownSeen`, `revenueSince`, `revenueClock`, `vaults`, `deferredSweeps`, `frozen` and `paged` — because "an undelivered finding survives into the next pass whole". It does **not** roll back `unreadPasses` or `unreadSkips`.

**What an accident gains.** Nothing direct. A signature that cannot be read reaches `UNREADABLE_SKIP_PASSES` after three passes even when none of the three `tx_unreadable` pages was delivered, so it is skipped earlier in *delivered* terms than SPEC's "three passes", and the HIGH "pass N of 3" pages can be lost to a run of failed deliveries. The skip itself still pages (`tx_skipped_unreadable`, a level condition that stands until a person writes the watermark), so nothing goes silent.

**Evidence if right.** In the R43 V43o‑2 harness (`bank/selftest.mjs`, the wedge fixture), stub `NOTIFY` to throw on every pass. The signature is skipped at pass 3 with no notice delivered, and the written state shows `unreadPasses` advanced while `cursors` is unchanged.

**Fix.** Add `next.unreadPasses = prev?.unreadPasses ?? {}` and `next.unreadSkips = prev?.unreadSkips ?? []` to the `!delivered` block, or state the bound as "three passes in which the page was delivered".

### INFO‑2 — `release_gate`'s untracked‑file check cannot see an IGNORED file (`scripts/run-tests.sh`)

**Construct.** `release_gate()`: `loose=$(git -C "$root" ls-files --others -- programs Cargo.toml Cargo.lock Anchor.toml .cargo ':(glob)**/build.rs')`, then `[ -z "$loose" ] || { echo "files git does not track sit in the program build paths: …"; return 1; }`. `git ls-files --others` does not list files matched by an ignore pattern (that needs `--ignored`, plus `--exclude-standard`). The message claims to cover "files git does not track", which is wider than what it lists.

**What an accident gains.** A build‑time file in a program path that is also ignored — a `build.rs` whose name is added to `.gitignore`, or an already‑ignored extension — is invisible to both branches (`git diff --quiet` does not see it either) while Cargo still compiles and runs it. The gate exists so the certified bytes are reproducible from the release commit; this is the one shape that escapes it.

**Evidence if right.** In a scratch clone of the tree: `printf 'fn main(){}' > programs/cbob-vaults/build.rs; echo build.rs >> .gitignore; git ls-files --others -- programs ':(glob)**/build.rs'` prints nothing, while the same file without the ignore line prints it. (`git ls-files --others --ignored --exclude-standard -- programs ':(glob)**/build.rs'` prints it in the ignored case.) I could not run git in this session, so this rests on the documented behaviour of `--others`, not on a run.

**Fix.** Add a second check with `--ignored --exclude-standard`, or replace the check with `git status --porcelain --ignored -- programs Cargo.toml Cargo.lock Anchor.toml .cargo` and refuse anything outside `target/` and `.cache/`.

### INFO‑3 — the selftest arm "a finding with no asset is never acked" cannot fail when the guard it names is removed (`bank/selftest.mjs`)

**Construct.** `t('a finding with no asset is never acked', one(D.applyAcks([{ kind: 'scan_gap', severity: 'HIGH', detail: 'x' }], { 'scan_gap:undefined': 'x' })).severity, 'HIGH')`. It asserts only the severity. `applyAcks` has two paths that leave the severity untouched: the early `if (!f.asset || !f.kind) return f`, and the refusal path for a malformed ack, which returns `{ ...f, ackRefused: true, detail: … }` with the same severity. So deleting `!f.asset ||` from the guard keeps the arm green while the finding comes back carrying `ackRefused: true` and a modified detail.

**What an accident gains.** Nothing; it is a gate that reads as both‑ways and is one‑way, which is exactly the class round 37 found in the ack arms.

**Evidence if right.** Remove `!f.asset ||` from `applyAcks` in `bank/detectors.mjs` and run `node bank/selftest.mjs`: the arm still passes. With the guard intact, `applyAcks` returns the finding unchanged (`ackRefused` undefined).

**Fix.** Assert `[one(...).severity, !!one(...).ackRefused]` equals `['HIGH', false]`, and add a control: a *well‑formed* ack keyed `scan_gap:undefined` on a no‑asset finding must still not downgrade it.

---

## Anything else

**Two observations, not findings**, because I am not certain either is wrong and neither is reachable in practice.

1. `bank/lock.mjs` `confirmSole`: with `g < myGen` and `readGen(file, g) === null` (a corrupt lower‑generation record), the outer test is true and the inner `if (g > myGen || r)` is falsy, so the loop continues and the caller is told it holds the lock alone — and then sweeps every generation below its own, deleting the corrupt record. `acquireLock`'s own rule for the *highest* generation is that an unreadable record is a refusal. The intent ("a lower generation is ours to sweep only if it is the record we decided to break") arguably makes the corrupt case "garbage below me", and `place()` writes a complete record before linking, so a live claim cannot be unreadable. If you want the rule uniform, return `{ ok: false, unreadable: true }` when any generation below the one being taken is unreadable and is not the token that was judged.

2. `bank/detectors.mjs` `detectSplitClaims`'s `counts` closure does `BigInt(c?.sweptLamports ?? c?.intendedLamports ?? 0)`. A hand‑edited ledger row with a non‑numeric amount makes `cycles.filter(counts)` throw out of `main()`, so the pass fails as `run_failed` every 30 minutes until a human fixes the file. Loud, and only reachable by editing the ledger by hand — which is the box‑owner residue limit 10 already carries.

**One thing I want to name explicitly, because it is the shape this project keeps shipping.** LOW‑1 is a fix applied to one of several identical sites *inside the fix for that same class*: the round‑25 repair taught the judge to check `isSigner` on the venue swap's authority slot and to forbid extra signers, and left the other six instructions' flags unchecked. That is the fifth round running for this shape. The gate that would have caught it — a tamper arm that clears a flag rather than changing a pubkey — is one line, and it belongs beside the eight that already exist.

**One thing I verified and want on the record as *correct*, because it is easy to get wrong and it is load‑bearing:** the alarm's covered‑freeze filter matches the crank's planner strings *exactly*, including the two that carry a number (`the revenue address holds N sats and cannot be split: the community pool's cbBTC account is FROZEN`) and the one whose text changed in round 37 (`…(the free tick and joins still go through)`). A mismatch there would either suppress a real fault streak or double‑page every pass; neither happens.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Rebuild the release commit on a machine that is not this box, with the pinned toolchain (`cargo-build-sbf 4.1.0`, platform-tools v1.54), and compare all five sha256 to `dist/SHA256SUMS`.** An auditor reads `dist/MANIFEST.txt` and the source; it cannot reproduce the bytes. If the rebuild disagrees, every other result is moot.
2. **Prove the compiled `INIT_AUTHORITY` by reproducibility, not by behaviour.** `build-mainnet.sh` proves the `--features localnet` swap works and that the source names Gary's key; it says in so many words that it does not prove the constant. A second, independent rebuild whose sha256 matches is the only bridge, and it should be recorded with the commit and the toolchain.
3. **Run the dress rehearsal (road step 8) and record each of item 22's five named items with its transaction signatures** — in particular 22.3 (one full live revenue cycle through Orca, and one with Orca forced to refuse so Meteora really runs) and 22.4 (a forced post‑sweep failure walked through the hand recovery, `--audit` clean afterwards). No audit can send a transaction.
4. **Exercise the crank at ~2,100 vaults.** The ruled rehearsal has five and records "scale not exercised"; item 22 stays open. The cost, the rate limits, the paging, a transient RPC error on vault 1,900 and the every‑minute lane keeping up are the untested part.
5. **Have a second person, with no access to this box, independently derive the launch values from `launch/mainnet-init.json` plus the rulings, create the vault collection, and sign the four `initialize` transactions.** `check-launch-params.mjs` validates the JSON, not the signed transaction (item 38, round 24 A6), and the whole immutability story rests on those values. One person on one box is one point of failure.
6. **Read the deployed programs back on chain after step 9 and again after step 11** — ProgramData prefix hash equal to `dist/`'s sha256, every byte after it zero — and record the slot and signature. The audit can only read the source.
7. **Restore the nightly R2 backup into a clean directory and confirm `bank/keys/*.json` and `bank/keys/cbob-release.json` are present, complete and mode 600.** Limit 56 and the deploy‑authority custody both rest on that backup, and neither the alarm nor any test can check it.
8. **Confirm the deploy authority's custody out of band.** Losing `FZjLB4e9…` before step 11 means new program ids, which is a program change. Someone who is not the person who created it should verify the restore.
9. **Watch the alarm in production for the whole 7‑day charter window** with the PoB collection's plugins and update authority in the watch list, and have a named human who will act on `brake_pulled`, `swap_operator_armed` and `log_coverage_gap`. The alarm is a detector; the response is a person.
10. **Ask a roster that shares no model with the first for the second launch‑clean round** (gate 3). The same eight models re‑reading an unchanged tree is one round run twice.
11. **Have someone who has never read this repository try to get a vault, fill it, vote and open it using only `HOLDER-GUIDE.md` and the staged pages**, on the rehearsal tree. The guide's promises are the product, and "every sentence here must stay TRUE of the deployed programs" is a claim only a reader can test.
12. **Decide, in writing, who is allowed to say "stop" after the upgrade authority is gone.** Item 39 is the price of the ruling and there is no code answer to it.