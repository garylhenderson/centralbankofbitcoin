# Round 43, OFF-CHAIN pass: independent confirmation audit

**Verdict up front: NOT CLEAN. 0 CRITICAL, 1 HIGH-or-MEDIUM-class finding (filed MEDIUM), 1 LOW, several INFO.** The MEDIUM is a stranger-triggerable permanent wedge of the alarm's transaction-scan cursor through a legal transaction format the reader refuses by rule; it sits in `bank/txread.mjs` + `bank/alarm.mjs`, it is in the fixable layer, and under the 2026-10-08 launch gate it breaks launch-clean via clause (d) until repaired and re-confirmed. Everything else I attempted to break held. Round 42's repairs all hold in this tree.

Nothing was executed in this round. Every claim below is source-derived from the bundle; where I assert a behaviour, I name the test that would confirm or refute it on a run.

---

## R0. Round 42's verdict, repairs, and rejected claims — independently verified

**C01 (the shrunk-index reserve baseline).** The repair is present and correct: `alarm.mjs` now builds `judged` as the current list plus, when `trustCurrent` is false, every stored vault not in the DAS burnt list, and reads and judges reserves for all of them; `next.vaults` keeps the trusted set. The selftest's two R42 C01 arms extract the real balance block and run it as written across three passes, including the fall-during-the-shrunk-pass case. I traced the repair for regressions: the extra reads cost the same as a normal pass; a redeemed vault whose DAS entry lags pages `balance_unreadable` once (the pre-existing limit-8 shape, downgraded by `correlateBurns` once the walk sees the redemption); the non-delivered rollback restores `balances` and `vaults` consistently. **Repair holds.**

The verdict's own follow-up instruction — check every baseline written beside `vaults` for the same asymmetry — I did: `balances` (repaired), `frozen` (the freeze detectors now run inside the `judged` loop, so an omitted vault's freeze is detected on a shrunk pass; the one residue is that a freeze that *ends* during a shrunk pass drops from the `frozen` set and re-pages as new once — one spurious urgent page, loud direction, note only), `cursors` (not vault-scoped). No further asymmetry.

**V42-1 / V42-2 (programs-pass repairs, bundled for context).** The local-ceremony malformed-path arms and the six `collectionCreator` arms are present and drive the real exported listener and the real reader; the controls (escapes refused, a stranger's decoy still `other`, no-create `unverifiable` never adopted) are non-vacuous. `web/src/lib/ceremony-reads.mjs` itself is not in this bundle, so I verified the repair through its tests only; the programs pass read the source.

**Gate-5 obligations.** C06 (exponent bound −18..0, refused by name at read and floor, int32 extremes pinned), C08 (fee labels derived from `crank.mjs`'s own template and checked distinct under the router's `stream_key`), C09 (`OPERATOR_FLOOR` read from source and pinned at 0.02 SOL), C10 (`run-tests.sh` refuses when the program source differs from `RELEASE_COMMIT`), C26 (`WEB_FLOOR=682` exact-total gate; `E2E_FLOOR=132` in `e2e-localnet.sh`) — all present in the tree. VALIDATION's stated counts (945/682/909/132/16/4/49/39/24/14/33) all equal the floors in the tree, and the selftest's every-occurrence check enforces SPEC's stated numbers against them.

**Rejected claims re-tested.** C15 (config-PDA squatting with data): holds — System `create_account`/`allocate`/`assign` require the new account's signature, and a PDA/ATA address has no key; the suite's R34.G2/R31.W2a measurements are consistent. C17: the M1 arm carries the `- 1`; the boundary literals are pinned. C18: confirmed no `hashv` exists in `bank/`; the attribute hash is `attrsHash`, a single `update`. C19: confirmed `distribute` checks `JoinWaitingFirst` before any $GARY burns and before credit, on both the burn and free paths and the tick path. C21's mechanism (the below-floor message text) is accurate but the rewording recommendation remains unapplied — see INFO items.

---

## R1. The crank — no new defect found

I looked for each named failure and did not find one:

- **A plan the program will refuse.** The reschedule boundary (`slot > reveal_slot + window`, strictly greater, matching the program), the capture lower bound (`readySlot`, optimistic only in the harmless direction — an early send refuses `RevealTooEarly`, which is in `BENIGN`), the join/expire/distribute ordering (retire → join → expire-before → split → distribute → expire-after → activate → claim, matching red-team 3 finding 6 and pinned by the R39 C01 extraction), and the owed arithmetic (below) all match the program. The only refusal race I could construct is a stranger's claim between plan and send moving `avail` from exactly 1 sat to 0 (`NothingToDistribute`, epoch unmoved → pages once, self-heals next pass) — not worth filing.
- **A plan that pays or joins a dead vault.** Every join/pay path requires `assets[r.asset] === 'live'` positively; burned vaults are retired first; unreadable ones are reported and excluded, and `joinable` suppresses the distribution while an eligible one is unreadable.
- **A reveal out of order.** The reveal loop runs strictly from `revealed_total` and breaks at the first record that is missing, already revealed, or not captured; the send loop breaks on the first non-'ok'.
- **Value movement.** Only the nine permissionless MINT instructions (asserted), all pinning their own destinations; the key signs as fee payer only; the budget rule keeps the floor on every branch.

The weight arithmetic (`preJoinWeight` at level-only, `retiringWeight`/`expiringWeight` including boosts, the pre-expiry owed-at-old-acc plus level-weight-delta, the joined-now debt at the old accumulator) matches MINT's `join`/`retire`/`reweigh`/`expire_boost` exactly. The split's 85% mirrors the program's floored bank cut. `splitDecimalsByte` refuses a null mint read.

---

## R2. The alarm — **the round's finding**

### MEDIUM — one stranger transaction permanently wedges a program's scan cursor, and the stated recovery never engages

**Construct.** `bank/txread.mjs`, `validateParsedTransaction`:

```js
if (tx.version === 1) {
  need(object(m.transactionConfig), 'v1 transactionConfig')
  need(m.accountKeys.every(k => k.source !== 'lookupTable'), 'v1 lookup-table key')
}
```

and `bank/alarm.mjs`'s walk loop:

```js
try { tx = await readParsedTransaction(conn, s.signature, { truncatedLogs: 'flag' }) }
catch (e) { unread++; findings.push({ kind: 'tx_unreadable', ... }); continue }
...
if (!unread) { if (gap) backlogs[id] = ...; else if (sigs.length) { cursors[id] = ...; delete backlogs[id] } ... }
```

**The defect.** The reader refuses any v1 transaction that used an address lookup table — a fully legal format — while accepting the *identical* key shape under v0 (the selftest's own v0 control sets `source: 'lookupTable'` and passes; the v1 mutation is pinned as a refusal). There is no principled asymmetry: `normaliseTx` and every consumer are source-agnostic (`(k.pubkey || k).toString()`), which the v0 control proves. Meanwhile the cursor-hold design (round 32 L2) assumes an unreadable transaction is a *transient* RPC error to be retried. A v1+LUT transaction is permanently unreadable by this reader. The consequence composes:

1. Any stranger can, for one fee plus lookup-table rent, send a **successful** v1+LUT transaction that calls a permissionless instruction (a `claim` naming one owed-nothing vault record, or an `expire_boosts` naming one non-boosted record — both succeed as no-ops) and thereby lands in one of the four walked programs' signature lists.
2. Every pass re-reads it, throws, increments `unread`, and pages `tx_unreadable` (HIGH, level) with the text *"The cursor stays where it was so the next pass tries again"* — a retry that can never succeed.
3. The cursor never advances, and because the backlog update is gated on `!unread`, **the stated backlog-drain mechanism never engages**. The "Scan backlog boundary" in SPEC says a gap "drains"; this one cannot. On a full-history RPC (Helius is the configured endpoint) the transaction never leaves the window.
4. The same refusal wedges the hand-run paths: the poster's loop throws on it (`could not read ... not advancing past it`), and `revenue.mjs`'s `splitsSince` throws when its walk reaches it, failing the open-cycle recovery.

**What an attacker gains.** No value. What the system loses: one program's transaction-walk coverage degrades permanently to "re-read the newest 2,000 every pass" with a repeating page, the operator must hand-edit `state.json` to clear the cursor past the signature (the `tx_unreadable` text gives no runbook; only `scan_cursor_unresolvable` does), and combined with a flood the buried window is never examined because the drain never starts. The account-state detectors (pool, balances, config, `sweep_unledgered_state`) are unaffected — this is an operability attack on the alarm, not a value path.

**Why MEDIUM.** This is the same one-fee-halt shape as round 29 M1 (runtime-truncated logs), which this project rated MEDIUM and fixed by flagging-and-advancing rather than refusing. The v1+LUT rule reintroduces that shape permanently, and the SPEC's reader-coverage and backlog boundaries do not state it.

**Evidence that would exist if I am right.** Extract the alarm's walk loop (as the selftest already does for other blocks) and feed it a stubbed `readParsedTransaction` that throws on one signature: the cursor does not advance across three passes and `backlogs` never gains an entry — that is the defect, demonstrated. On a live cluster: send one successful v1+LUT `claim` naming MINT and watch `tx_unreadable` repeat with a frozen cursor.

**Fix (small, fixable layer).** Either or both: (1) drop the v1 lookup-table-key refusal — the consumers are source-agnostic and the v0 control already exercises the shape; add a v1+LUT fixture arm; (2) bound the retry: after the *same* signature has been reported unreadable for k consecutive passes, record it in state (as `logGaps` records truncation gaps) and advance the cursor past it, paging once — this also closes any future permanently-unreadable shape. Both need both-ways arms under gate 5.

**Checked and cleared, for the record.** The rollback-on-undelivered block: `royaltySince` and `crankArmedSince` are not restored, but I traced both — the royalty clock only advances when the balance actually fell (a factually correct restart whose only loss is a page about an already-resolved condition, the capped-sweep case already accepted in limit 10), and `crankArmedSince` only advances on first arming (the generous direction for `crank_silent`). `seenSplits`/`seenSweeps` are unions (safe). The `detectSweepState` half-cooldown window, the `cooldownSeen` minimum, the fee-label derivation, the freeze-transition coverage matching, and the `missingWatchedKeys`/`_missing` exemptions were each traced and hold. No routine state pages every pass that I could find: the standing INFO items (`joins_waiting`, `sales_stopped`, `sweep_cooldown_wedged`) are by design non-paging.

---

## R3. The layouts — hold

The assertion chain is real and closed: `parseRustStruct` throws on any line it cannot read as one `pub name: Type,` field, so a Rust edit that is not mirrored fails the field-for-field equality; offsets are computed from the list, so a mirrored edit recomputes them; every `OFF_` constant any program pins is compared (the L2 "none scraped and ignored" arm), including the seven round-22 strays; the suite's own `OFF_` copies are compared; seeds (round 24 D6 — the assertion now exists, 11 of 11), layout versions, `BOOST_RING`, and the evaluated `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are all held to the layout. A struct change cannot slip past without simultaneously editing the Rust, the JS list, every pinned offset in three programs, the suite's copies, and the space constants — and the discriminator/version/owner pinning at read time refuses a wrong account loudly. No finding.

## R4. The money arithmetic — hold, no divergence

`credit`, `pendingScaled` (carry before debt), `reweigh`, `ceilSats`, `available`, and `debtAtActivation` are line-for-line the Rust. The crank's three owed branches (plain, pre-expired at the old accumulator plus level-weight delta, joined-now at the old accumulator) each reproduce the program's post-instruction state exactly; the expiry scheduling (due-before, made-due-by-this-distribution after, `boosts_stalled` for traffic-run distributions) matches `advance_epoch`'s ring arithmetic. The alarm's `poolAvailable`/`owedCeil` match. The split mirror (`total - total*1500/10000`) equals the program's floored bank cut exactly. No divergence found.

## R5. The swap and the revenue cycle — hold

- **(a)** The oracle math is correct for every exponent sign in the bounded range (the Q-formula reduces to `L·P_s·10^(es−eb)/(10·P_b)`; both divisions floor, so the floor is at or below truth; BigInt throughout, no overflow at the bounds; `satsPerLamport` is float but feeds only the 100 bps filter at ~1e-16 relative error).
- **(b)** The `PriceUpdateV2` offsets (Full tag 40, feed 41, price 73, conf 81, expo 89, publish 93, minimum 101) are internally consistent across `readPyth`, the selftest builder, and the fork's re-stamper. Ownership-by-receiver plus derivation-under-push plus feed-id-in-data plus the age/confidence/future bounds on the chain clock is the stated trust (limit 10(a)/(d)); no additional check is available off chain.
- **(c)** `orcaSpot` and `meteoraSpot` are the right quantities in the right direction (both sats-per-lamport); float cannot move a 101 bps deviation under a 100 bps gate.
- **(d)** The minimum out is the same oracle read's expectation less 150 bps, in sats, at the byte offset each program expects (Orca `other_amount_threshold` @16, Meteora `min_amount_out` @16) — consistent with the filter's oracle.
- **(e)** The judge requires the exact seven-instruction sequence with the amount, floor, direction, price limit, both ATA creations, the wrap amount, SyncNative, and the close; a priority fee is refused twice over (explicit `d[0]===3` and the sequence check); the output account is the operator's own cbBTC ATA at the pinned key position. What can still pass is what the venue programs themselves validate (tick/bin array derivations, the oracle PDA) — a wrong array is a program refusal, not a leak. The same-tree tamper residue is limit 10(c), stated.
- **(f)** The tick-array starts (current, then two below for a_to_b) and bin-array indexes (active, then two above for Y→X) match the published interfaces and the pinned vectors; a boundary tick starts its own array; an uninitialised array is a program refusal feeding the fallback.
- **(g)** A pre-existing wSOL balance is swept into by SyncNative, unconsumed by the exact-input swap, and returned by the close; a frozen/delegated/foreign-created ATA fails closed into refusal or fallback; nothing is left wrapped (the close is judged).
- **(h)** Orca-first, Meteora only on a measured refusal; an unconfirmed send stops the cycle open with the candidate signature recorded; a timeout-that-landed is read off the chain and recorded; no path closes a cycle without a proven return or a proven split (`cycleIsOpen`, `closesCycle`, the provably-empty proof).
- **(i)** The tolerance bound: at most ~150 bps below oracle per cycle — about 0.15 SOL on a full 10 SOL cycle, ~18 SOL/month at full ruled throughput if an adversary actively sandwiched every cycle against arbitrage — strictly dominated by the accepted operator trust (who could take 100% of the same money) and disclosed in the holder guide. The operator key's worst case is unchanged from limit 10 (cap × windows until the guardian stops it); the newly trusted pool programs and Pyth can each reach at most one cycle's funds plus float, since the operator wallet holds nothing else.

The ledger cannot read a failed cycle as closed: a refused sweep is closed only on a chain-verified refusal, and a wrong refusal judgement is backstopped by `unledgered_sweep` (armed in the selftest).

## R6. The gates — one arm that cannot fail

**LOW — the round-24 L2 wiring arm is presence-only; deleting the repair leaves it green.** The arm (`bank/selftest.mjs`, round-24 block) asserts `cs.indexOf("if (how === 'skip')") > 0 && cs.indexOf(...) < cs.indexOf("const ok = await send(\`reveal #")`. It verifies that the `if` exists and precedes the send; it never verifies the `break` inside it. Delete the `break` from `crank.mjs` and the arm stays green — and the round-24 L2 defect returns in full: a null RPC read on a live asset sends a reveal with `[]`, which the program refuses `AttributesMismatch`, breaking the lane and paging. No other arm covers it: the R39 C01 send-block extraction starts at `retireBurned`, after the reveal loop, and the e2e's mock always returns readable assets. This is the answer to this round's challenge ("find one [round-24 repair] not armed in both directions"): the *mapping* (`revealAttrSource`) is armed both ways; the *send-path wiring* is not armed at all. **Fix:** extract the reveal send block as R39 C01 does for the rest and assert it sends nothing when the source is `'skip'`, or at minimum require the `break` token inside the `if`. Severity LOW: the reintroduced bug pages immediately in operation; the residual risk is a silent test-robustness hole.

**Also checked:** `run-tests.sh`'s floors all equal their counts (909/945/39/24/14/49/33/4/16/682), the equality-not-bound rule is enforced everywhere including the web total and the e2e floor, `build-mainnet.sh` proves all five programs (behavioural key check for the four, byte identity plus `target/deploy` equality for the sweep helper), `cron-install.sh` arms nothing beyond the six tagged jobs and the preservation logic is executed from the real file in the selftest, and the audit-coverage gate's selftest passes its own 14 cases with the fail-closed `bundles()` shape. The web/test files (below) are non-vacuous.

**INFO — `sim/swap-fork.sh` and `web/test/e2e-localnet.sh` are mutually blind.** The fork's `pgrep` guard covers `run-tests.sh` and `run-sim.sh` but not the e2e, and the fork's `cleanup` kills whatever holds 8999/9900 — so running the fork while the e2e runs kills the e2e's validator mid-test (the e2e itself refuses when the ports are held, so only the fork→e2e direction is destructive). One line in the pgrep pattern closes it.

## web/test/ — judgement

Each file's arms can fail when the property it names is broken: `tx` (the signing guard refuses an added instruction and a forged signature; `errors.json` is compared to a fresh generation), `decode` (against the official mpl-core/spl deserializers on hand-built bytes, including truncated and unknown-plugin shapes), `ids` (derivations against the suite, mpl-core and spl-token, plus the program-bytes pins and the RELEASE_COMMIT check), `ix` (byte-for-byte against the suite's and sim's extracted builders, with a control proving `diffIx` catches a flag, a byte and an account), `plan` (whole-message equality against the sim's S8 shape, and every refusal/ack/consent rule driven both ways, including the H1 stranger vectors, the V38-2 standing consent, the V39-1 press re-reads and the A2 press-stop causes), `get` (claim/buy/draw against the suite's builders, the dust arms through the page's own reader, the C12 new-address states and call sites), `ceremony` (the steps against the suite's initializes, the post-step field checks, the decoy/unverifiable/pin matrix, the V42-2 creator cases), `proxy` (the allowlist equals the derived call set, the gpa shapes, the HTTP and rate-limit behaviours, the V1/NFT floods, the V42-1 malformed path), `meta` (fail-closed per vault, never-backwards, the V40-3 dust arms), `bundle` (the browser bundle equals node byte-for-byte on six snapshots, the static dist checks, the L4 build-refusal arms with a control, the README hash table against fresh builds), `run-all` (per-file exact floors). The one weak arm in the bundle is the presence-only ceremony-page regex pair (M2/C04), which can still fail and so is not vacuous. `e2e-localnet.mjs` is not in the bundle; its floor (132) is externally enforced but its arms were not re-judged this round.

---

## The four questions on the accepted limits

**1. Is any limit worse than stated?** I hunted and found none. The candidates I ran down: limit 10's "about 34 SOL a day" is internally consistent (34.3 = the honest job's 7-hour effective spacing from round 37 C05; the thief's ~40 is stated separately); limit 59's scope is accurate (Core's creates only — Anchor `init` addresses are measured immune, R31.W2a); limit 28's "cannot open at all" is conservative for a frozen *zero-balance* cbBTC account (round 30 measured a frozen-zero account can be closed, so that edge could actually open — the guide errs safe); limit 46's positive bound (the hot key cannot take a PoB) holds in Core's rules. One sharpening, not a worsening: **item 22.5's stake is higher than the item states** — if DAS drops burned assets from `getAssetsByGroup` without setting `burnt`, then once redemptions begin `detectIndexShortfall` fires `index_disagrees_with_chain` CRITICAL on *every pass, permanently* (seen = live + burnt < minted_total forever). Two of the three DAS outcomes are handled; the third is a permanent false-CRITICAL generator. That makes settling 22.5 with one mainnet read more urgent than "carried".

**2. Is anything listed as a limit not actually a limit?** No. I re-checked 6, 8, 25, 26, 27, 32, 34, 35, 36, 41, 42, 43, 47, 55, 57 against the current tree; each is still true as stated (including 25's 300 s RPC-hang residue — the crank's `Connection` still carries no timeout — and 42's prior-transaction contract, which the page honours).

**3. Is any DISCHARGED item not actually discharged?** No. 12/17, 14, 19, 30, 31, 33, 51, 54 and the v5 family all hold against the current source; 54's honest "extrapolated, not measured at 14" caveat and its dependence on open item 50 are stated.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. 22, 38, 50, 52 and 53 remain road steps; `launch/mainnet-init.json` still carries the three OPEN values (`charter_opens_at`, `lock_deadline`, `vault_collection`); the holder guide is DRAFT and blocked from publication by item 50; the control table still honestly marks `judgeRedemptionCoverage` PROCEDURE.

---

## Other findings (INFO, none blocking)

- **Round 42's unapplied recommendations remain unapplied:** the crank's below-floor message still says "kept the floor for later passes" when no reveals ran (C21); an attribute-read failure still ends the reveal run with no `failures` entry in the heartbeat (C23); the `undeclared_token_account` detail still tells a holder a *zero*-balance stray "is lost" (C24). Each was recommended, none confirmed.
- **The holder guide's "Every opening is public. It is announced on X and on the Bank's website."** has no mechanism today (the poster has no sender). Item 50 tracks it and blocks the guide's publication; the sentence must not survive into a published guide without the sender.
- **Round 42 C05's recommendation** (keep `tx.signature` as a candidate on a no-signature transport failure) also remains unapplied; the open row plus `sweep_unledgered_state`'s text covers the loud direction.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Run the mainnet dress rehearsal (item 22) with a human at the terminal, and record the signatures.** The crank against ~2,100 vaults, the alarm in rehearsal mode, one full revenue cycle through *each* pool with Orca forced to refuse once, and one forced post-sweep failure walked through the hand recovery to a clean `--audit`. No AI round has ever executed `bank/revenue.mjs` live; its recovery path has never been walked by anyone.
2. **A human reads the four decoded `initialize` transactions against `launch/mainnet-init.json` before signing.** The checker validates the JSON, not the signed transaction (round 24 A6's own note), and every value is permanent.
3. **Settle item 22.5 with one DAS query** — and treat it as urgent, because one of the three possible answers is a permanent every-pass CRITICAL generator (above).
4. **Key-custody acts only Gary can perform:** move the $CBOB release wallet off the box (limit 56), decide the PoB hot wallet through the charter window (limit 46), fund the operator above its float and the crank key, and decide the deploy-authority key's handling between steps 9 and 11.
5. **An alert drill:** trigger a real page through the router to a human's phone, and verify a human sees and can act on it. The alarm's delivery to a person has never been tested; the log-gap review runbook (a human writing watermarks to `bank/log-gaps-reviewed`) has never been exercised by a human either.
6. **A restore drill:** restore the box (or a second machine) from the nightly backup and verify the keys, ledgers and alarm state actually come back. The detection half rests on files that have never been restore-tested.
7. **A second-machine reproducible build:** rebuild the five `.so` files from the release commit on a clean machine and compare the sha256s. "These bytes are the audited bytes" currently rests on one box's toolchain and one box's `node_modules` symlink.
8. **One real-wallet opening** through the published redeem page with a small amount, before the upgrade authority is removed — the page's full journey (prior transaction, boxes, press, sweep helper, burn) has only ever run against mocks and a local validator.
9. **A human reads HOLDER-GUIDE.md against the final tree once more for sense, not syntax** — the drift sweep is mechanical; the judgement that a sentence is *understandable and not misleading to a non-technical holder* is not.
10. **Decide the publication surfaces** (the X sender, the website record) and the charter date, and re-run `scripts/cron-install.sh` as the go-live act it is (VALIDATION B7).

**Bottom line.** Round 42's repairs all hold; the tree is otherwise in the best shape any round has found it. The one defect that should stop launch this week is the v1+LUT cursor wedge — a small fix in the fixable layer (`bank/txread.mjs` and/or a bounded retry in `bank/alarm.mjs`), after which this needs its confirmation round on the changed tree. The LOW (the L2 arm) and the INFO items should ride along in the same repair commit.