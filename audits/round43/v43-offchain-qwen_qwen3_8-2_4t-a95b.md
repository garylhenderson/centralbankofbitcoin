

# Round 43 — independent confirmation audit (off-chain + bundled MINT/SWEEP + web/test)

**Verdict up front.** I independently re-derived the round-42 repairs from the current tree rather than trusting the verdict. The one confirmed round-42 defect (C01, the alarm's reserve baseline shrinking with an untrusted DAS list) is genuinely repaired for the balance baseline and its selftest arm is real and able to fail. However, **the same trusted/untrusted asymmetry C01 describes survives at three sibling sites in the same pass** — the transaction-detector input sets (`pdas`, `atas`, `assets`) and the nested-vault walk still use only the short current list when the index has just been declared untrustworthy. That is the one new finding below, rated LOW, in the fixable layer. Everything else I checked in R1–R6 held up to first-principles re-derivation; I did not find a CRITICAL/HIGH/MEDIUM, a value path, or a holder-crack blocker. I am not confirming the tree clean on that basis alone — the LOW is a real incomplete repair and must be fixed and re-verified.

I did **not** re-run the validator suite (no execution environment here); where I say "measured" I mean recomputed from the bundled source and the pinned test vectors the tree already records. Where a claim rests on source-reading alone I say so.

---

## R0 — Round 42's verdict and its repairs

### C01 (the only round-42 confirmed defect) — repair VERIFIED at the balance site, INCOMPLETE at three sibling sites

**The repaired site holds.** `bank/alarm.mjs` now builds `judged` from the stored set when the index shrank:

```js
const burntSet = new Set(burnt)
const judged = setChange.trustCurrent ? vaults
  : [...new Set([...vaults, ...(prev?.vaults || []).filter(v => !burntSet.has(v))])]
for (const v of judged) if (!pdaOf[v]) pdaOf[v] = pda([...], CORE)
const legs = []
for (const v of judged) for (const m of reserves) legs.push({...})
```

and the vault-set baseline is still preserved (`vaults: setChange.trustCurrent ? vaults : (prev?.vaults || vaults)`). The selftest arm (`R42 C01`, two assertions) extracts the *actual* balance block between unique anchors and runs it across three passes (full → shrunk → full-with-a-fall), asserting `reserve_fell` fires for an omitted vault and that a fall *during* the shrunk pass is paged in that pass. The anchor `between()` throws if the block is removed, and VALIDATION records both arms red with the old `for (const v of vaults)` restored. This is a real, failable test of the real code, not a copy. **The C01 repair at the balance site is sound.**

### NEW FINDING — LOW: C01's shape survives at the transaction-detector input sets and the nested-vault walk

**Construct.** `bank/alarm.mjs`, `main()`, the block that builds `pdas` / `atas` / `ataOwner` / `assets` (immediately after `detectVaultSetChange`, *before* the C01 `judged` block), and the `detectNestedVaults` call above it:

```js
const setChange = D.detectVaultSetChange(prev?.vaults, { live: vaults, burnt })
findings.push(...setChange.findings)
const pdas = new Set(), atas = new Set(), assets = new Set([...vaults, ...burnt])
...
for (const v of [...vaults, ...burnt]) { ... pdas.add(p.toBase58()) ... }
for (const v of vaults) { ... pdaOf[v] = p; ... atas.add(...) }
```

and earlier:

```js
findings.push(...D.detectNestedVaults(everyVault, ...))   // everyVault is the short DAS list
```

On a pass where `setChange.trustCurrent === false` (the index shrank and was just declared untrustworthy), `vaults`/`burnt`/`everyVault` are the **short** list. C01's repair makes the *balance baseline* read the stored set, but these four consumers still run against the short list only:

- `detectBurns(ixs, assets, ...)` — a bare Core `BurnV1` of an omitted vault, seen in a scanned transaction this pass, is not in `assets`, so no `bare_core_burn` route attribution.
- `detectApprovals(ixs, pdas, ataOwner)` / `detectPdaTokenAccounts(ixs, pdas, atas)` — an approve on, or a non-ATA token account created for, an omitted vault's PDA is not recognized this pass.
- `detectNestedVaults(everyVault, ...)` — an omitted vault nested in another vault is not seen this pass.

**What an attacker or an accident gains.** Nothing moves value and no crack is blocked. The gain is *detection latency*: during exactly the pass that has already paged `vault_index_shrank` CRITICAL, the secondary detectors for the omitted vaults are blind. The primary backstop (`detectVaultSetChange` itself) is what flagged the shrink, so this is a loss of the *route-naming* and *approve/nest* coverage for one pass, not a loss of the burn fact. It self-heals on the next good pass (the stored vault set is preserved, so the list is whole again).

**Why this is in scope and not a re-file of C01.** Round 42's drift-sweep instruction was to "check every other alarm baseline written next to `vaults` (`balances`, `frozen`, `cursors`) for the same trusted/untrusted asymmetry." `frozen` is derived inside the (now-repaired) balance loop, so it is covered; `cursors` are per-program and unaffected. But `pdas`/`atas`/`assets`/`everyVault` are the *other* consumers of the same short list in the same pass, and they were not switched to the stored set. This is the C01 root cause ("a shrink pass trusts the list it just declared untrustworthy") at additional sites, not the C01 finding itself.

**Evidence that would exist if I am right.** Extract the set-building block the same way the C01 arm extracts the balance block; feed it a shrunk `vaults=[V0]` with `prev.vaults=[V0..V9]`, `trustCurrent=false`, plus a normalized transaction containing a top-level Core `BurnV1` naming `V5`. With the current code `detectBurns` returns no `bare_core_burn` for `V5` (it is not in `assets`); building `assets` from the stored union would return one. Same shape for an `approve` by `V5`'s PDA and for a nested `V5`.

**Fix.** When `!setChange.trustCurrent`, build `pdas`/`atas`/`ataOwner`/`assets` and drive `detectNestedVaults` from the same stored-set union used for `judged` (i.e. `[...vaults, ...prev.vaults.filter(v => !burntSet.has(v))]` plus `burnt`), so the pass that distrusts the index distrusts it uniformly. Add a gate-5 arm in the C01 extract-and-run shape, shown red at the current commit.

**Severity rationale.** LOW, not INFO, because it is an incomplete repair of a confirmed finding's exact shape in a security monitor; LOW, not higher, because the impact is one pass of reduced *secondary* detection during an event that already pages CRITICAL, with no value path and no crack blocked. It is in the fixable layer (`bank/`), so under the 2026-10-08 gate it does not block launch but must be fixed and tested both ways before the tree is final.

### Other round-42 items re-checked

- **V42-1** (ceremony local server malformed path): `web/test/proxy.test.mjs` drives the real exported `localListener` on loopback — `/%E0` and `/%` return 404 and the server still serves a real file afterwards; controls assert escape refusal. VALIDATION records it red with the decode guard removed. Holds.
- **V42-2** (`collectionCreator` hides the real create behind an earlier transaction): now selects the oldest *successful* `CreateCollectionV2` for exactly that address, skips failed txs (both listing `err` and `meta.err`), bounds the search at 25, and returns `unverifiable` (not `other`) when no create is found in a complete history. Six new arms plus two updated arms cover failed/successful stranger transfers, strangers-only history, the bounded-search case, and end-to-end adoption. The deliberate departure (launch-key create of a *different* address → `unverifiable`, not `other`) is reasoned in VALIDATION and I agree it gives a stranger no lever. Holds.
- **Gate-5 obligations** C06 (Pyth exponent bounded `-18..0` at both `readPyth` and `oracleFloor`, with int32-extreme refusal arms), C08 (crank fee labels derived from `crank.mjs`'s own template and asserted equal to `fee_floor`/`fee_ceiling`), C09 (`OPERATOR_FLOOR` read from `revenue.mjs` source and pinned to 0.02 SOL), C10 (`run-tests.sh` refuses when program source differs from `RELEASE_COMMIT`) — all present in the bundled selftest/runner and each has a both-ways arm. I recomputed the C06 bound effect: with expo ∈ [-18,0], `e = sol.expo - btc.expo ∈ [-18,18]`, so the BigInt multiplier is at most `10^18` and the round-42 "unbounded expo hangs the job" vector is closed.

---

## R1 — the crank (`bank/crank.mjs`)

No new defect found. Things I re-derived rather than accepted:

- **Boost expiry ordering.** `preExpires` selects `dist_epoch >= boost_end_epoch` (matches MINT `expire_boosts`'s skip condition `dist_epoch < boost_end_epoch`), and `postExpires` selects `boost_end_epoch === dist_epoch + 1` only when `plan.distribute` is set — which includes the `tick` kind, correctly, because a tick also calls `advance_epoch`. `main()` sends `expire('before')` before distribute and `expire('after')` after, and the send-order arm (R39 C01) extracts the real send block. I could not construct a plan that distributes past a due boost or leaves a just-made-due boost for the next distribution.
- **Join-before-distribute.** `preJoins` (eligible, `request_epoch < dist_epoch`) are batched and sent before the distribute; `joins` (this-epoch requesters made eligible by this pass's distribution) after. A burned waiting vault is retired, never joined (red-team 3 finding 2). The frozen-pool path still sends join-only claim batches (R38 C01 arm drives planner→sender end to end). Consistent with MINT's `JoinWaitingFirst`.
- **Reveal ordering and the attribute hash.** Reveals run strictly from `revealed_total`, stop at the first not-ready, and `judgeRevealAttrs` distinguishes `send` / `revealed` (list-plus-`level` hashes to stored) / `mismatch`. The hash is Borsh `Vec<VaultAttribute>` sha256, pinned to a hand-computed vector (`ATTRS_VECTOR`), not to its own expression. `revealAttrSource` returns `empty` only for a positively burned asset and `skip` for an unreadable one, and `main()` breaks the reveal run on skip before spending a fee. I found no out-of-order or wrong-attribute send.
- **Fee budget.** `budgetPlan` runs the base plan whenever it is covered and spends reveals only down to the floor; the R30 L2 arms check at/under/whole-balance cases and assert the floor is never breached. `judgeFeePayer` checks the minimum before the ceiling (round-24 L6a). The over-ceiling case runs and warns once a day. No plan that pays/joins a dead vault, no reveal sent out of mint order.

One observation, not a finding: the crank's `split_revenue` passes `decimals` read live from the mint (`splitDecimalsByte`), while `revenue.mjs` hardcodes `8`. Both are correct for cbBTC (8 decimals, probe-pinned) and the on-chain `TransferChecked` would refuse a wrong value, so this is a stylistic divergence, not a defect.

## R2 — the alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

Beyond the R0 finding:

- The fixed-forever production list (`detectStandingRisks` with `production:true`) pins 21%/51%/3-day, 7-day notice, the three tighten bounds, 30-day month, one-hour redemption window, the level census, cbBTC/Squads/reserve mints, PoB root and collection, and the $CBOB mint + boost ceilings. I checked each against `launch/mainnet-init.json` and MINT's `initialize` bounds; they agree.
- The sweep helper is watched (`prog.sweep.upgrade_authority`, `prog.sweep.hash`) in `WATCH`, read in `readConfigs`'s program loop, and included in `detectUpgradeAuthorityAfterLock`'s five-program list. Third-party programs (Orca, Meteora, Pyth receiver/push) are watched at HIGH with `NO_PROGRAMDATA` as a value, never "absent."
- `detectSweepState` uses the smallest-ever cooldown capped at the ruled 6h (review-33 reasoning re-checked: a vote can only lengthen, so judging with the historical minimum is the sound narrow window), and an uncertain send explains a sweep only when a direct `getSignatureStatuses` lookup shows it landed. The selftest extracts the actual alarm fragment and runs it. I found no way for a thief's sweep to sit inside an honest cycle's window.
- The reader-coverage and scan-backlog boundaries (truncated logs → recorded gap, never parsed; backlog drains with positive proof before the cursor advances) match SPEC. The R29–R32 arms drive the real extracted walk against a stub cluster. I found no path that silently advances past an unread transaction or drops an unreviewed gap.

## R3 — the layouts (`bank/layout.mjs`)

- The round-24 D6 gap is closed: `SEEDS` is now asserted against each program's `*_SEED` constant by scraping the Rust (`seedOf`) and comparing all 11, with a mistype/unmapped arm. Note `bank/layout.mjs`'s `SEEDS` intentionally omits `rescue` and `coreExecute`; those live in `web/src/lib/ids.mjs`'s `SEEDS` and are asserted there against `RESCUE_SEED`/`EXECUTE_PREFIX`. Neither the crank nor the alarm derives the rescue PDA, so the omission in `bank/layout.mjs` is not a defect.
- Every cross-program pinned offset (`OFF_*` in GOV/BURN/MINT and the suite's own copies) is scraped and compared to the computed layout; the "nothing scraped goes un-compared" arm checks the key sets. Layout versions and `BOOST_RING=64` are scraped from the Rust. `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are scraped, evaluated, and compared to `fixedLength` minus padding (round-24 L13c fixed the JS-to-JS comparison). I recomputed `MintConfig` field order against the bundled `lib.rs` struct and it matches; decode refuses wrong discriminator/version/truncation/non-bool bytes.

## R4 — the money arithmetic (`bank/accrual.mjs`)

I re-derived `credit`, `pendingScaled`/`owed_of`, `reweigh`, `ceilSats`, `available`, and `debtAtActivation` against MINT's `credit`, `owed_of`, `reweigh`, `ceil_sats`, `join`. They match line-for-line, including the carry/debt restart on reweigh and the floor-direction dust handling. The selftest proves Level V = 3× Level I, dust carries, a late activator earns nothing from the prior distribution, and the boost carry. No divergence found. The crank's owed computation for the three claim branches (joined-now, pre-expired, plain) uses these functions correctly; the L4 arms pin exact sat values, not batch counts.

## R5 — the swap and revenue cycle

I recomputed rather than trusted:

- **(a) Oracle math.** `expectedSats = lamports·sol·10^(es−eb)/(btc·10)` in BigInt, floor division; `minSats = expectedSats·9850/10000` floor. The pinned hand vector (2 SOL → 280,355 expected, 276,149 floor at 150 bps) matches my independent recomputation. `satsPerLamport` is Number-only and feeds only the read-time deviation filter, never the on-chain floor; with the exponent now bounded, no overflow/underflow path reaches the value-moving computation.
- **(b) Pyth verification.** Offsets recompute: Full tag @40, feed @41–73, price @73, conf @81, expo @89, publish @93, min length 101. Ownership by the receiver + PDA derived under the push program + Full verification + feed-id match. Only the receiver program can write an account it owns, so a stranger cannot forge a fully-verified update; staleness (180 s) and future (30 s) are judged against the chain Clock sysvar, which `market()` refuses if unreadable. This sits inside limit 10's stated trust (Pyth's upgrade keys), which is accurate.
- **(c) Deviation filter.** `orcaSpot = (sqrtPrice/2^64)^2` (sats per lamport, a_to_b) and `meteoraSpot = 1/(1+binStep/10000)^activeId` (inverse of lamports-per-sat) are in the same units as the oracle's `satsPerLamport`. Floating-point error at these magnitudes is far below 100 bps; the L6 arms place a pool at 99/101 bps on both sides and both venues. A boundary float misclassification only affects the read-time venue choice, not the on-chain floor.
- **(d) Minimum out.** Both venues carry the same `minSats` in the swap instruction data at the field the pool program enforces (Orca `other_amount_threshold`, Meteora `min_amount_out`), in sats, matching the deviation filter's oracle. The fork arms SW.1/SW.4/SW.8/SW.9 land real swaps and refuse a 5%-above floor.
- **(e) The judge.** It enforces the exact seven-instruction sequence, the wrap amount, the on-chain floor bytes, Orca direction/price-limit bytes, the operator's own wSOL-in and cbBTC-out at pinned key positions, the two ATA creations for the operator's own wallet/mint, no priority fee, and exactly one close back to the operator. The eight round-25 tampers are each refused on both venues, and the arms assert the *old* (round-24) judge passed all eight — so the arms can fail. The stated residue (same-tree judge cannot catch a tampered module; post-swap delta check backstops) is limit 10(c), accurate.
- **(f) Account derivation.** Orca tick-array starts recompute (`-88733/16 → [-90112,-91520,-92928]`, boundary case included); Meteora bin arrays `[i,i+1,i+2]` for Y→X with negative-index floor. An uninitialised tick/bin array makes the venue program refuse, which routes to the fallback or leaves the cycle open and loud — the round-42 C07 disposition (liveness, not safety) holds; I did not re-measure the Orca refusal itself (source-only).
- **(g) wSOL handling.** Wrap exactly `lamportsIn`, SyncNative, swap (exact input consumes exactly `lamportsIn`), close. A pre-existing wSOL balance would make the final close revert the whole atomic transaction (no loss, loud). This is why limit 10 requires the operator wallet to hold only cycle funds — that operational instruction is accurate and load-bearing.
- **(h) Failure/retry.** `classifySendFailure` distinguishes refused (preflight, landed-with-error, expired-unlanded) from landed from unknown; the venue loop only falls through on `refused`, throws on `unknown` (never a second venue while an attempt may have landed), and records on `landed`. The ledger closes a cycle only on `returnedSats>0 && (splitSig || splitByOther)`, and the return is held to the floor via the operator-ATA delta. I could not construct a path where a confirmation timeout on a landing swap produces a double swap, a double count, or a cycle read as closed.
- **(i) Adversary extraction.** With the 100 bps venue gate and the 150 bps on-chain floor, worst honest-case slippage per cycle is bounded by the floor; a sandwich or edge-pushed pool cannot force output below the floor (the pool program enforces it). Per-cycle value is capped at the ruled 10 SOL sweep, so the extractable amount per cycle and per month is small and within limit 10's stated tolerance. The operator-key worst case is now "keep the swept SOL, bounded by cap×cooldown until the guardian stops it," since routing to a malicious pool is blocked by the pinned pools + judge + floor. This matches the re-stated limit 10.

## R6 — the gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

- Every floor uses **equality**, not a lower bound (`floor()` in run-tests.sh and `R.length !== FLOOR` in selftest), so deleting assertions fails the gate rather than satisfying it. I summed the web offline floors (41+47+16+169+57+128+7+109+25+83 = 682 = `WEB_FLOOR`) and the e2e floor is external and exact (132). The SPEC stated-count gate checks *every* occurrence of each floor phrase, with a poisoned-later-occurrence arm.
- The round-24 D6 SEEDS assertion now exists (see R3). The "wired-to-nothing" gate derives the detector list and checks each call's result is consumed outside comments, with cut-arms naming the exact detector. The signer-set, retired-file, program-id (14 copies + keypair pubkey + 4-char-prefix), and control-table gates all have both-ways arms. I spot-checked the `readySlot`, `attrsHash`, and oracle-floor vectors against independent hand computation — none is a self-comparison.
- `scripts/build-mainnet.sh` proves mainnet artifacts reject the localnet key and localnet accepts it, for all four keyed programs, and byte-compares the sweep helper's mainnet/localnet/target-deploy outputs. `scripts/cron-install.sh` preserves `--live` only from a tagged, uncommented, job-specific line and refuses a rehearsal tree. I found no armed-on-install money job and no vacuous gate in the spot checks.

---

## The four questions on the accepted limits

1. **Is any limit worse than stated?** I found none worse. Limit 10's re-statement (trust is now two pool programs + the oracle, not an HTTP reply) is accurate given the pinned-pool builder, the judge, and the on-chain Pyth floor; the operator-key worst case is genuinely bounded by cap×cooldown. Limit 27's cost-falls-on-other-holders framing matches MINT's `claim` (which checks `r.active`, not liveness) and the crank's burned-vault filter. Limit 28's frozen-pool forfeit matches `retire_redeemed` and `monthly_inline`.
2. **Is anything listed as a limit not actually a limit?** No. The "explicit `distribute` can credit from a frozen pool while the crank and `monthly_inline` do not" behavior is real but is already stated (SPEC community-pool section and RT3 finding 1 note), so it is not an undisclosed limit.
3. **Is any DISCHARGED item not actually discharged?** I re-checked the ones touching bundled code (14 duplicate attributes, 19 unlevelled halt, 30/31/33 stage-3b/3c discharges, 51 boost, 54 compute). Each is either enforced on-chain in the bundled MINT source or measured by a named suite arm. None appears falsely discharged.
4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 remain open: `launch/mainnet-init.json` still carries `charter_opens_at`, `lock_deadline`, and `vault_collection` as `"status":"OPEN"` (and `check-launch-params` refuses while any is OPEN/null), the holder pages are built-but-staged (item 50), and the dress rehearsal (item 22) has not run. Nothing in the tree treats these as closed.

---

## Anything else

- The R0 LOW is the only new finding. I also noted, as observations below reporting threshold: (a) the shrink-pass `pdas`/`atas`/`assets` gap is the same item; (b) `revenue.mjs` hardcodes split decimals `8` where the crank reads them live (both correct for cbBTC); (c) the Orca-uninitialised-tick-array fallback premise (round-42 C07) remains source-only, unmeasured — worth a one-line note in the rehearsal, not a finding.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — do these before launch; AI audit structurally cannot

1. **Run the mainnet dress rehearsal (item 22) and record signatures.** An AI round can read the crank/alarm/revenue code but cannot be the process that sends real (small) transactions against a live cluster, hits a transient RPC error on vault 1,900 of 2,100, keeps the every-minute reveal lane up, and walks one forced post-sweep failure through hand recovery. The five named pass/fail items in item 22 (including one full revenue cycle through *each* pool and one forced failure) must be executed by the operator and their signatures recorded. This is the single largest thing the audit cannot substitute for.
2. **Be the human who clears `log_coverage_gap` and writes the watermark.** The truncation-gap design deliberately requires a person to inspect each kept gap and write `bank/log-gaps-reviewed`. An AI can detect and page; it cannot be the accountable reviewer who decides a gap was benign. Same for ack files (`bank/acks.json`) — each ack needs a human `why` and `until`.
3. **Make the custody rulings AI can only flag.** The whole $CBOB supply on a hot box key (limit 56), the Giraffish Moments update authority kept hot through the 7-day charter window (limit 46), and the swap-operator key float are Gary's decisions. Move the release wallet and the PoB collection key off the box (or to a Squads) for the charter window if the ruling allows; the audit can state the exposure, not accept it.
4. **Sign the four `initialize` transactions from `launch/mainnet-init.json` and then remove the upgrade authority, with a second-machine rebuild.** After filling the three OPEN values, a human must build the initialize transactions from that file, verify the deployed bytes against `build-mainnet.sh`'s sha256 on an independent machine (reproducibility is the only bridge from "source names the key" to "the compiled constant is the key"), execute road steps 10–11, and confirm the five programs (sweep helper included) are immutable before anything mints.
5. **Publish the holder surfaces (item 50) and run an alert-delivery drill.** The redeem page's `judgeRedemptionCoverage` is the only pre-signature control for limits 9/44 until it is published; and the alarm's value depends on a page actually reaching a human. Fire a real CRITICAL through `/opt/scripts/notify-gary-sms.sh` and the router, confirm a person receives and acts, before launch — an AI cannot be the on-call.
6. **Settle item 22.5 with one real DAS read** (a collection holding a burned Core asset, confirming DAS sets `burnt`), since the whole vault-set reconcile rests on that flag and a "no" edits `bank/`.

Until the R0 LOW is fixed and re-verified, and items 1–6 are done by people, the tree is not launch-final — regardless of how many rounds read it.