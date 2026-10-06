# ROUND 28 AUDIT — OFF-CHAIN PIPELINE, WHOLE TREE

**Verdict: one surviving INFO defect (round 27's D2 was confirmed but not repaired in this tree). No new CRITICAL, HIGH, or MEDIUM found. Round 27's other seven findings and its two validation findings are verified repaired, and the repairs hold under re-measurement from first principles.**

I read round 27's verdict as evidence, not authority, and re-derived each of its confirmed findings against the current source before checking its repair. I then audited the full tree independently. Below: the surviving defect, then the target-by-target verification with the reasoning that would let a reader check me, then the four accepted-limit questions, then the closing section.

---

## R0 — ROUND 27'S VERDICT AND ITS REPAIRS

### FINDING 1 (INFO, surviving): SPEC.md still claims v6 has had "not yet a multi-model round"

**Construct:** `SPEC.md`, the "NOTHING IS DEPLOYED…" header paragraph: *"v6 is a redesign and has had three independent red-team passes (`audits/v6-redteam/`), not yet a multi-model round."*

**What it contradicts:** the same file's "Where this stands, honestly" section: *"Rounds 22-26 completed; none was clean. Round 26's programs pass also lacked quorum (5/8, six required)."* Rounds 22–27 are the multi-model rounds; round 27's own verdict records a 7/8 substantive quorum. The two passages cannot both be true.

**Evidence if I'm right:** the two quoted strings both exist in the bundled `SPEC.md` (they do — quoted above). Round 27's verdict confirmed this as D2 (INFO) and its VALIDATION records a repair commit `e109b31`; the sentence is still present in this tree, so either the repair did not land or the bundle is current and the repair missed this site. This is checkable in one `grep`.

**Gain:** none to an attacker; it is a false statement about the audit process in the document handed to auditors, which is the class this project treats as load-bearing (a documented count visibly wrong teaches readers the floors beside it are decorative).

**Fix:** delete or correct the "not yet a multi-model round" clause in the header paragraph.

### Round 27's other findings — independently re-derived, repairs verified

- **L1 (missing own components quiet):** real at the time. `detectMissingComponents` now exists, checks all nine `_missing` flags (four configs + five programs), is wired into `alarm.mjs` with the shared `lockGate`, requires production + elapsed deadline, and is armed both ways in the selftest (R27 L1 block, including the actual alarm-wiring extraction). Holds.
- **L2 (freeze-only planner problems re-paging via `crank_problem`):** real at the time. `detectCrankHealth`'s `coveredFreezes` now prunes exactly the three complete freeze strings the planner emits (I verified each against `planCrank`'s actual `problems.push` strings, including the apostrophe and the single-blocker regex), preserves mixed Squads/absent blockers and failed actions, and prunes stale streaks on duplicate heartbeats. The selftest drives the real planner output through three heartbeats. Holds.
- **L3 (benign race after successful preflight read as failure):** real at the time — web3.js 1.98's `SendTransactionError` from a failed confirmation carries no logs. `mintFailureCode` now retrieves logs with a 5 s bound, attributes the AnchorError to MINT via the invoke stack, refuses foreign same-named codes and unbalanced stacks, and fails closed on unavailable logs. The selftest drives the installed SDK's real error shape. Holds.
- **L4 (rehearsal mode still paging `program_not_locked`):** real at the time. `detectUpgradeAuthorityAfterLock` now returns `[]` before either branch when `!production`, and `detectMissingComponents` gates on the same flag. Armed both ways, including the actual alarm wiring. Holds.
- **D1 (SPEC's "pool over 1% never used" overclaim):** repaired — limit 10 now reads "This read-time filter does not bind the price at execution; the transaction enforces the separate 150 bps output floor." Present.
- **D3 (four-vs-five program counts):** repaired at the sites it named — `detectUpgradeAuthorityAfterLock` covers `sweep`, the alarm reads `prog.sweep.*`, `launch/mainnet-init.json`'s `lock_deadline.source` says five, SPEC says "five in all". The four-`declare_id!` and four-initializer descriptions correctly left alone. Holds.
- **D4 (SPEC's "a working capped sweep never pages"):** repaired — limit 10 now says the alarm "observes net balance changes" and that "incoming royalties can hide a successful sweep"; the detector's text says "no observed net balance decrease" and names the masking. Holds.
- **V1 (v1 transactions stopped every reader):** repaired by `bank/txread.mjs`. I audited the validator line by line (see R2/R6 below) and the consumer integration arms; the repair is real.
- **V2 (format-boundary overclaims):** the "Transaction-format boundary (validation, 2026-10-06)" paragraph is present in SPEC and correctly scopes the legacy/v0 figures. Holds.

---

## R1 — THE CRANK (`bank/crank.mjs`)

I traced every planned action against the program's refusals, looking for a plan the program will refuse, a pay/join of a dead vault, an out-of-order reveal, and any value movement the program does not pin. Findings: none.

Specific checks and why they hold:

- **Send order vs. MINT's gates.** The sends go reschedule → capture → reveal → retire → preJoins → preExpires → split → distribute → postExpires → activate → claims. The one ordering that looked wrong on first read — preJoin `claim` batches running *before* the explicit `distribute`, each carrying `monthly_inline` — is safe for a non-obvious reason: `monthly_inline` returns early while `waiting_to_join() > 0`, and each preJoin batch's own joiners still count as waiting when its `monthly_inline` runs (it runs before the pair loop). So no in-line distribution can fire before the explicit one, the joiners join at the pre-distribution accumulator, and the explicit distribute credits them exactly as planned. The selftest's F5 arms (joined vault delivered its share in the same pass, at `debt = weight × old acc`) match the program's `join` + `credit` + `owed_of` arithmetic.
- **The tick.** `waitingThisEpoch` subtracts this-epoch pending records this pass retires; the program's `retire` decrements `pending_this_epoch` only when `request_epoch == dist_epoch`, which is the same predicate. A tick with no this-epoch requester left is not planned (it would fail `NoActiveVaults`, which is deliberately *not* in `BENIGN` — a planning bug pages).
- **Dead vaults.** `retireBurned` takes any positively burned record at any level (including pending and unrevealed); joins and claims require a positively *live* asset (`'other'`/null reads are excluded and reported, and an unreadable eligible vault suppresses the distribution entirely, matching `JoinWaitingFirst`). A burned vault is never joined or paid.
- **Reveal order.** Strict FIFO from `revealed_total`, breaking at the first not-ready, skipped, mismatched, or failed record; the attribute list is hash-checked against `attrs_hash` before a fee is spent, a list already carrying `level` is read as done-elsewhere, and `[]` is sent only for a positively burned asset. `attrsBorsh`/`attrsHash` match the Rust `hashv(&[attributes.try_to_vec()])` byte for byte (pinned vector in the selftest).
- **The distribute refusal judge.** `PoolShort` is always a fault (correct: a claim moves pool and owed by the same amount, so `avail` is claim-invariant); the three race codes are benign only when `dist_epoch`/`last_distribute_at` moved since the plan. I verified the crank's own earlier sends cannot move those fields (preJoin claims' `monthly_inline` no-ops as above; `expire_boosts` and `split_revenue` don't touch them), so "moved" attributes to external traffic correctly.
- **Fee budget.** `planCostLamports` matches the actual send count transaction-for-transaction (I enumerated both); `budgetPlan` drops reveals in mint order when the key is short and pages the drops; the minimum is checked before the ceiling (L6a holds).
- **Account orders and discriminators.** I checked every instruction's key list against its `#[derive(Accounts)]` (reveal, claim/join, expire, split, distribute, activate, retire, capture, reschedule) — all match, including `split_revenue`'s config being read-only and the operator-as-fee-payer satisfying MINT's `Signer` check on the sweep (standard: the fee payer is always a transaction signer).
- **Compute.** Each send is one instruction; the heaviest (reveal with inline capture, 150,344 CU; capture, 114,756) sits under the 200,000 default. No ComputeBudget instruction is needed or sent.

**Observation, not a finding:** in the claim loop, `t.address !== r.vault_ata` is production-vacuous — `tokens[r.asset].address` is `tokenAddr(r)`, which returns `r.vault_ata` for active records by construction. It can only fire in the selftest's injected fixture. It is harmless defense-in-depth, but it is not the live check; the live check is `t.state !== 'ok'`. Noted so a future reader doesn't mistake it for a control.

---

## R2 — THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

I looked for a dangerous state read as quiet and a routine state paged every pass. Findings: none.

- **Fixed-forever values, pending keys, PoB collection, rate window, pool, overdue distribution, five programs' upgrade authority, Gary's production values:** all present in `WATCH`/`detectStandingRisks`/`detectUpgradeAuthorityAfterLock`, all armed both ways. `missingWatchedKeys` makes a reader that drops a key fail the whole pass (loud, not calm).
- **The ledger-vs-chain checks** (`detectUnledgeredSweeps`, `detectUnreconciledRevenue`, `detectSplitClaims`, `closesCycle`, `cycleStartMs`) hold the operator-written ledger to chain evidence: sweeps read amounts out of the instruction bytes, refused-rows carrying sweeps are CRITICAL in both directions, split anchors require chain time ≥ the return's block time and total ≥ the return, the verification window follows chain-seen sweeps rather than ledger position, and future-stamped rows are ungraced. I re-derived the `closesCycle` "first split after the return covers it" invariant: any split takes the whole revenue ATA balance, so the first split at/after the return carries ≥ the return; skipping smaller later splits and taking the earliest ≥ need is sound. The two-returns-one-split case pages for one cycle, but it requires two simultaneously open cycles, which the open-cycle guard prevents outside hand recovery (where a human is already looking). Not a finding.
- **One-shot vs. level kinds** are classified, per-kind labels fit the router's 40-char fold, one-shots carry the pass time and `ALERT_URGENT`, level kinds get recoveries only on full passes, and the router arms run the real router in a throwaway state dir. The undelivered-findings path holds every baseline that feeds a one-shot (config, balances, cursors, vault set, frozen set, deferred sweeps) while letting observation-only state (seenSweeps/seenSplits, crank streaks) advance — one-shots re-fire, level kinds re-assert. Correct.
- **`txread.mjs` (the V1 repair), audited as new code:** the validator requires version ∈ {legacy, 0, 1}, signature identity, unique valid keys with a signer+writable fee payer, v1 `transactionConfig` and no lookup-sourced keys, per-instruction shape (parsed payloads typed; money instructions carry source/destination/amount; ATA creates carry account+wallet; raw instructions carry in-set accounts and bs58 data), balances matching key count, string logs, bounded inner-instruction group indices, and typed token balances. A throw (not a skip) on malformed input aborts the pass into `run_failed` — deliberate fail-closed, since advancing past unexamined instructions is the failure this pipeline exists to refuse. The 22 mutation arms and the ten source-extracted consumer integrations (real alarm walk, real `splitsSince`, real poster loop) are genuine integration, not source greps.
- **Routine-state paging:** the standing INFO kinds (brakes on, guardian retired, joins waiting, wedged sweep bounds) don't page; freezes page once then stand at INFO; the freeze-covered crank problems are pruned only when the corresponding account-freeze finding is present this pass. I found no routine state that pages every pass.

---

## R3 — THE LAYOUTS (`bank/layout.mjs`)

- **D6 (the SEEDS assertion that didn't exist):** it exists now. The selftest scrapes each program's `pub const *_SEED: &[u8] = b"…"` and compares all eleven to `L.SEEDS`, requires the count to be 11 (an empty map fails), and arms a mistyped seed and an unmapped seed. Real.
- **Struct drift cannot slip:** `parseRustStruct` throws on any line it can't read as one `pub name: Type,` field (private and `pub(crate)` fields throw — armed), the field list is compared name-and-type against the Rust (added field and retyped field arms), every cross-program `OFF_` constant is scraped and compared with a none-scraped-and-ignored arm, layout versions are scraped from all four programs and compared, and `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are scraped, evaluated, and held to `fixedLength` minus padding. A struct edit that isn't mirrored here turns the build red.
- I verified the `MintConfig`/`VaultRecord`/`BurnConfig`/`GovConfig`/`SealConfig` field lists against the bundled Rust field for field, and the u128/i64/bool/Vec decode paths (bool refuses non-0/1, truncated and incredible-Vec reads throw).

---

## R4 — THE MONEY ARITHMETIC (`bank/accrual.mjs`)

Line-for-line against the bundled MINT source: `credit` (delta = avail×1e12/w, owed += delta×w), `owed_of`/`pendingScaled` ((weight+boost)×acc + carry − debt, negative refused), `ceilSats`, `reweigh` (owed→carry, debt restarts at new weight), `debtAtActivation` — all match. The crank's pre-expiry owed reconstruction (atExpiry at the old acc + level weight × the acc delta) matches the program's expire-then-claim sequence; the retiring vault's freed share uses the same `owed_of` the program's `retire` uses, boost included. The crank expires due boosts before the distribution and the ones its own distribution makes due right after (`boost_end_epoch === dist_epoch + 1`), matching `advance_epoch`'s ring move. The alarm pages `boosts_stalled` and watches `cbob_mint` and both boost bounds as fixed-forever CRITICAL drift. No divergence found.

---

## R5 — THE SWAP (`bank/swap.mjs`) AND THE REVENUE CYCLE (`bank/revenue.mjs`)

(a) **Oracle math.** `sats = lamports × sol.price × 10^(e_sol − e_btc) / (btc.price × 10)` — the exponent split by sign is correct both ways (I checked e>0, e<0, e=0 against the closed form), both divisions floor (conservative), BigInt throughout the floor path, and `satsPerLamport`'s `Number` conversions feed only the float spot comparison, never the floor. Holds.

(b) **Pyth verification.** The account is derived (shard-0 PDA under the push-oracle program), fetched by derived address, required to be receiver-owned, fully verified (tag 1 at offset 40), and feed-id-exact; offsets (feed 41, price 73, conf 81, expo 89, publish 93) match the `PriceUpdateV2` layout and the fixture. Ownership + derivation + full verification is sufficient: only the receiver program writes that account, and it writes only after Wormhole verification; a forged fully-verified update is not something an outsider can plant. Age is judged against the chain Clock (owner-checked), future-dating past 30 s refused. This is the accepted oracle trust, bounded as disclosed.

(c) **Deviation filter.** `orcaSpot` = (sqrt/2⁶⁴)² in raw units = sats per lamport (A=wSOL 9dp, B=cbBTC 8dp — raw units give sats/lamport directly). `meteoraSpot` = 1/(1+bin_step/10⁴)^active_id, the correct inverse for X=cbBTC priced in Y=wSOL. The selftest's 99/101 bps arms drive the real `market()`; double precision (~1e-16 relative) cannot flip a 100 bps gate.

(d) **Minimum out.** Same `minSats` (oracle expectation − 150 bps, floored) rides Orca's `other_amount_threshold` (offset 16, u64 sats) and Meteora's `min_amount_out` (offset 16, u64 sats); both are the output token's base units. Same floor the filter assumed.

(e) **The judge.** Requires the exact seven-instruction sequence: CU limit 400,000 and no CU price anywhere; both ATA creates pinned to operator/mint/payer; the wrap's program/discriminator/keys/amount exact; SyncNative of the operator's own wSOL; the swap's discriminator, data length (42/24), amount, floor, Orca direction+price-limit bytes, pinned pool, operator's wSOL in (key 3/4), operator's cbBTC out (key 5), operator signing in the authority slot; one close of the operator's wSOL back to the operator, last. What it does *not* pin — tick/bin arrays, oracles, vaults — is validated on chain by the venue programs against the pinned pool, so a tamper there fails the swap rather than misrouting it; output, amount, and floor are pinned, and `revenue.mjs`'s post-swap delta check (`delta < guaranteed` throws, cycle stays open) catches a value-moving miss after signing. The eight round-25 tampers are each armed by name on both venues against the real builder, and the round-24 judge is shown passing all eight (the arms can fail). Holds.

(f) **Derivations.** Orca tick arrays use the string-form start seed (current + two below for a_to_b), oracle PDA `["oracle", pool]`, vaults read from the pool; Meteora bin arrays use i64-LE index seeds (active + two above for Y→X), bitmap extension present-or-program-id, `host_fee_in` as None, event authority `["__event_authority"]`, two classic token programs. Boundary and negative-index cases are armed. An uninitialized array fails on chain → refused → fallback or open cycle (loud; round 27 C15's unverified sparse-array hypotheticals remain unproven either way and are not findings).

(g) **wSOL.** Wrap exactly `lamportsIn`, sync, exact-input swap, close back to the operator. A pre-existing balance in the operator's own wSOL ATA returns to the operator on close (its own account; only its key signs). A frozen wSOL account fails the swap (loud); a delegate requires the operator's own key (already the trusted boundary). Exact input means nothing is left wrapped but dust-free residue, which the close returns.

(h) **Failure and retry.** Meteora runs only on an Orca *refusal* (preflight, landed-with-err, or expired-never-landed, all read off the chain via `getSignatureStatuses` with history); an unconfirmed/unknown send throws with the candidate signature preserved (`pendingSwapSig`/`pendingSwapVenue`) and never retries a second venue. A timeout on a swap that later lands is classified `landed` and recorded — no second swap, no double count. Every path leaves the cycle open (`cycleIsOpen`: moved > 0 and (no return or no split)) until a return is proven; a returned-but-unsplit cycle self-heals when the crank's next split empties the revenue ATA (closesCycle finds it: whole-balance split ≥ the return, at/after it).

(i) **What an adversary can extract within the tolerance.** The read-time gate (100 bps) bounds pre-positioning; the on-chain floor (150 bps under the oracle) bounds execution. Worst case per cycle: a pool at the gate's edge plus movement to the floor ≈ **150 bps of the oracle-expected output**. At the ruled 10 SOL cap (~$1,200 at $120 SOL) that is ≈ **$18 per cycle, ≈ $72/day at four cooldowns, ≈ $2,200/month** — about 1.5% of the ~40 SOL/day throughput ceiling. A stale-but-accepted oracle (≤180 s) with an honest pool is caught by the gate (a real 1% move puts the pool >100 bps from the stale price); a manipulated Meteora pool (10× thinner) is cheaper to push *within* the gate but hits the same 150 bps execution floor. This matches limit 10's disclosed bound; it is not a new finding, and the cycle size keeps it small relative to the revenue moved. **Operator-key worst case (limit 10 re-check):** unchanged — the on-chain cap × cooldowns until the guardian's instant stop, with `unreconciled_swap` paging after a 60-minute grace; what the key trusts is now the two pool programs and the oracle (all four upgrade keys watched at HIGH), not an HTTP reply. The ledger still cannot read a failed cycle as closed (`sendRejected` closes only provably-unmoved rows, and a refused row carrying a sweep is itself CRITICAL).

---

## R6 — THE GATES

- **Floors are equality, everywhere:** `MIN_ASSERTIONS=848`, `DET_FLOOR=860` (and `selftest.mjs`'s own `FLOOR=860`, with a self-check that the two agree), `ALLOC_FLOOR=39`, `POSTER_FLOOR=22`, `POB_FLOOR=14`, `LAUNCH_FLOOR=47`, `MAINNET_FLOOR=33`, `HOST_FLOOR=6`, `SWAP_FLOOR=16`. Deleting work fails the equality; a missing count line fails the parse. The SPEC-stated counts are checked at *every* occurrence with a nonempty requirement. The probe/fork skips are loud and barred under `CBOB_SHIP_GATE=1`.
- **The round-24/25/26/27 repair arms are real:** each names its defect and is driven both ways (the router arms execute the actual router; the L7 id gate mutates each of 14 copies; the I4 pin extracts real detector calls and catches argument swaps; the R27 arms drive the real planner, the real SDK error shape, and the real alarm wiring). I did not find a repair armed in only one direction.
- **`build-mainnet.sh`** proves the four key-carrying programs behaviorally (mainnet rejects / localnet accepts the test key, each), proves the sweep helper's mainnet bytes identical to both the localnet rebuild and the `target/deploy` bytes the suite deployed, pins the Core hash, and refuses a dirty tree. Its own "NOT PROVEN" note (the compiled constant could be a third key) is honest and is a ceremony item, below.
- **`cron-install.sh`** arms `--live` only from its own tagged, uncommented, end-anchored lines (the selftest executes the real extracted shell), installs exactly the six v6 jobs under `flock -n`, and refuses a rehearsal tree before touching the host.

---

## THE ACCEPTED LIMITS — THE FOUR QUESTIONS

1. **Is any limit worse than stated?** None found. I re-measured the ones with numbers: limit 32's ring (cap 45 at 2,100 live; the 64 clamp binds only above 3,047, unreachable at `max_supply` 2,100 — stricter, never looser, as stated); limit 10's bound (cap × cooldowns, with the judge and delta check now bounding builder defects — the statement's "what a judge can and cannot catch" paragraph is accurate about the same-tree residue); limit 25/26's draw windows against MINT's `try_capture`/`blockhash_in_window` (the crank's `readySlot` is a correct lower bound); limit 55's unsplit-revenue edge (bounded to ~an hour of sales only while the crank runs, as stated).
2. **Anything listed as a limit that is actually closed?** No. Limits 6/7 (flock/wedged holder), 8 (correlation lag), 9 (foreign nested asset, no pre-signature check while item 50 is open) all remain real.
3. **Any DISCHARGED item not actually discharged?** No. 51 (boost: built, owner-only, buyer's terms, ring measured through four wraps), 54 and 12/17 (compute measured), 14 (DuplicateAttribute on chain), 19 (closed by construction), 30/31/33 (initialize-fixed) all verified against the bundled source and the armed gates.
4. **Any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22 (dress rehearsal, with the named revenue-cycle and forced-failure items), 38 (charter date and lock deadline still literally `OPEN` in `launch/mainnet-init.json`), 50 (holder surfaces), 52 (three accounts + revenue rent), 53 (rehearsal proof stale at `d57ee3a`, rehearsal value set unwritten) are all still marked OPEN AND BLOCKING in the tree and none is narrated as accepted.

---

## ANYTHING ELSE

Nothing beyond the D2 survivor and the R1 observation (production-vacuous `t.address !== r.vault_ata` clause, noted above, not a defect).

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — WHAT AI AUDIT STRUCTURALLY CANNOT DO

This pass, like the 27 before it, *reads* and *recomputes*. The following must happen before the lock because no reading of this tree substitutes for them:

1. **Execute the dress rehearsal (item 22) with its named pass/fail items, on the record.** The crank's I/O at ~2,100 vaults (paging, rate limits, a transient RPC error on vault 1,900, the every-minute lane under a sale burst), the alarm's live passes in rehearsal mode, **one full live revenue cycle through each pool** (Orca forced to refuse once so Meteora really runs), and **one forced post-sweep failure walked through the hand recovery** with `--audit` clean after — each recorded with signatures. The revenue cycle's live path runs in no suite, sim, or fork; this audit verified its failure *handling* by reading, which is exactly the class round 24's Jupiter finding belonged to (measured gone, not reasoned gone).
2. **A chaos soak on the box itself.** Kill the crank mid-pass, truncate the ledger, drop the RPC socket mid-swap (round 25 A1 measured a 300 s hang from one socket), reboot the host, and watch whether the alarm pages and the ledger refuses to lie. AI audit reads `lock.mjs`'s race arms; it cannot pull the plug that proves them.
3. **An independent reproducible build from a clean machine.** `build-mainnet.sh` itself states it has NOT proven the compiled `INIT_AUTHORITY` constant is Gary's key — a third key rejects the test key identically. The bridge is a second, independent environment rebuilding from the release commit and matching the five sha256 values, then the signing ceremony verifying the four `initialize` transactions were built *from* `launch/mainnet-init.json` (round 24 A6: the checker validates the JSON, not the signed bytes). No AI pass attends a ceremony.
4. **Off-box monitoring of the one residue no in-tree check can cover** (limit 10 D2(3)): the ledger, crontab, and alarm are one user on one box. A second watcher on another host, reading only public chain state (pool solvency, `owed_scaled`, sweep/split signatures, program hashes) and the alarm's own outputs, is the structural answer to "who watches this box". AI audit of the code cannot detect a compromised host running honest-looking code.
5. **A real holder, a real wallet, item 50's surfaces, before the lock.** The redeem page's coverage warning, the prior-transaction ATA preparation, the sweep through the helper, and the 1,209-byte widest shape must be exercised by a human clicking "sign" in an actual wallet — including the frozen-pool no-claim path and the lamports-only sweep's existing-destination rule. AI audit can read `judgeRedemptionCoverage`; it cannot discover that a warning is incomprehensible to the person it exists to protect.
6. **A shadow prover for the first live distributions.** A small, independent reimplementation of the accumulator arithmetic (not `bank/accrual.mjs` — a *second* one) reading raw chain data after each of the first distributions and claims, screaming on any divergence between the program's `acc_scaled`/`owed_scaled` and recomputed entitlements. The suite proves the mirror equals itself; only a live shadow proves the mirror equals the chain.
7. **The two OPEN launch values are a human decision, not an audit item:** the charter opening date and the lock deadline that follows from it are Gary's to set, and item 38's whole point is that no process — AI or otherwise — can correct them after `initialize`.

The tree is in the best measured state this project has recorded: round 27's repairs are real, the gates are equality-floored and armed both ways, and the one surviving defect is a sentence, not a mechanism. That is precisely when immutability makes the seven items above the whole remaining game — every one of them is a thing this process cannot see, and items 22, 38, 50, 52, and 53 are already named OPEN AND BLOCKING in the project's own list. Do them before the lock, not after.