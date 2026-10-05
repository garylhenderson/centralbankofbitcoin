# Round 26 off-chain audit — findings

Scope note: I read the whole bundled tree (off-chain pipeline, the sweep helper, MINT, the fork/sim, the gates, the docs, and the round-25 verdict). SEAL, BURN, GOV source was **not** in this bundle, so claims about those three programs' internals are taken from the suite floors and the prior rounds; I flag where that matters. Everything below is ordered by target.

---

## R0 — Round 25's repairs

I re-checked each repair against the current code rather than re-filing the verdict. Result: **L1, L2, L3, L4, L6, L7, I1, I2, I3, I4 all hold as described; L5 is a process item and is correctly reflected in SPEC item 22.** I found no regression in the repaired functions themselves. Two surviving/new observations sit adjacent to them:

### F-1 (LOW) — `bank/revenue.mjs`, swap venue loop: an `unknown` send outcome throws away the recovered signature
The catch block does:
```js
if (verdict.outcome !== 'refused') throw e     // unknown: the cycle stays open
```
For the `landed` branch it records `cycle.swapSig = verdict.sig`; for `unknown` it does not, even though `classifySendFailure` returns a `sig` whenever the error carried one. If a swap confirmation times out, the chain cannot settle it yet, and it **later lands**, the open ledger row has no `swapSig`. The hand-recovery runbook in accepted limit 10 ("look up the recorded `swapSig`") then has nothing to look up; the operator must reconstruct the landed swap from the operator's history. Nothing is lost and the cycle stays open and loud (`unreconciled_swap` pages), so this is an operational wound, not a theft path.
- **Evidence if I'm right:** force a swap confirmation timeout (black-hole the RPC after send) where the error object carries a signature; the resulting ledger row has `sweptLamports` but no `swapSig`/candidate field.
- **Fix:** in the `unknown` branch, before `throw e`, persist the candidate without asserting it landed, e.g. `if (verdict.sig) { cycle.candidateSwapSig = verdict.sig; save(led) }`. Keep it out of `swapSig` so `cycleIsOpen` and the alarm semantics are unchanged.

### F-2 (INFO) — `bank/swap.mjs` `judgeSwapInstructions`: the venue's liquidity accounts are not pinned by the judge
The judge verifies the seven-instruction shape, the wrap amount, the floor bytes, the direction, the input/output token accounts, the CU limit and both ATA creations. It does **not** re-derive the Orca tick arrays/vaults/oracle (keys 4,6,7,8,9,10) or the Meteora reserves/mints/bin-arrays/event-authority (keys 2,3,6,7,8,13,15+). This is not a live routing gap: both pool programs validate vaults/reserves against the pool and the tick/bin arrays as pool PDAs, so a builder defect there is a loud on-chain refusal, and the on-chain floor bounds the price regardless. But the judge's own comment ("the EXACT seven-instruction sequence") overstates coverage for those accounts, and the round-25 D1 text in SPEC limit 10 inherits that overstatement.
- **Evidence if I'm right:** mutate one tick-array PDA in a built Orca transaction; `judgeSwapInstructions` returns `[]`, and the Whirlpool program then refuses the swap. Same for a Meteora bin array.
- **Fix (optional, defence-in-depth):** re-derive the three tick arrays from `w.tickCurrent`/`w.tickSpacing` and the three bin arrays from `p.activeId` inside the judge and compare, and check `vaultA/vaultB`/`reserveX/reserveY` against the pool account read in `market()`. Low priority because the programs already enforce it.

---

## R1 — The crank (`bank/crank.mjs`)

I looked for a plan the program refuses, a plan that pays/joins a dead vault, an out-of-order reveal, and any value movement the program doesn't pin.

- Reveal ordering is enforced from `revealed_total` and stops at the first not-ready record; the attribute list is hash-checked (`judgeRevealAttrs`) before any fee is spent, with the `revealed`/`mismatch` trichotomy correct (a tampered list that also carries `level` still reads `mismatch`).
- Dead vaults are excluded from joins and claims at plan time (`assets[r.asset] === 'burned'` skipped, `'other'` reported and skipped), and bare burns are retired before joins/distribute/claims. The residual race (burn between plan and send) is accepted limit 27, and the crank's mitigation (retire first each pass) is present.
- The distribute/tick planning correctly accounts for this-pass retires (`retiringThisEpoch`) and for the `JoinWaitingFirst`/`BoostsExpireFirst` gates; activations are sent after the distribution per red-team 3 finding 6.
- The crank emits only the nine permissionless MINT instructions and no token/system value transfer of its own; the fee payer signs only as fee payer.

**No defect found.** One observation, not a finding: `budgetPlan` drops reveals from the tail of the mint-order list when the key is short, which is the correct order to keep the FIFO unblocked, and the dropped reveals are paged — so a under-funded key degrades loudly, not silently.

## R2 — The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

I checked each mandated page and looked for a dangerous-quiet and a routine-loud.

- Fixed-forever drift, pending guardian/operator, PoB collection plugins + update authority, redemption-rate-near-cap, pool frozen/insolvent/unreadable, distribution overdue (including `joins_stalled`, `boosts_stalled`, `launch_tick_overdue`), and upgrade-authority-past-lock for **all five** programs (`seal, mint, burn, gov, sweep`) are all present and wired.
- `detectUpgradeAuthorityAfterLock` iterates the five-program list including `sweep`; the sweep helper's bytes and authority are in `WATCH` and read in `readConfigs`.
- Production value assertions match Gary's numbers (21/51/3-day, 7-day notice, tighten bounds, 30-day month, 1-hour window, boost ceilings 12/24, `cbob_mint`, `pob_collection`).
- `detectUnsweptRoyalties` correctly follows the on-chain cooldown (round-25 L4) and resets on any balance fall, so a capped-but-working sweep never pages (accepted limit 10/A2), and a dead one does.

**No dangerous-quiet or routine-loud found.** I specifically checked the frozen-pool case: `detectDistributionOverdue` can page `distribution_overdue` while the pool is frozen (because `poolAvail` is computed from the balance even when frozen). This is redundant with `pool_frozen` but not a false positive — the distribution is genuinely overdue; the freeze is the cause and is separately paged CRITICAL/urgent. Not a finding.

## R3 — Layouts (`bank/layout.mjs`, `bank/selftest.mjs`)

- `MintConfig` field list matches the bundled MINT Rust struct field-for-field (I diffed them by hand; they agree through `boost_expiring: [u32; BOOST_RING]`).
- The round-24 D6 gap is closed: `SEEDS` is now asserted against each program's `pub const *_SEED` in selftest (`judgeSeeds`), with a both-ways arm (a mistyped seed and an unmapped seed are each caught). I verified the four MINT seeds against the bundled MINT source (`mint-config`, `mint`, `vault`, `revenue`) — they match.
- Cross-program `OFF_*` constants are scraped from the program sources and compared to computed offsets; the MINT-side ones I could check (`OFF_VERSION=8`, `OFF_COLLECTION=9`, `OFF_RESERVES=41` into SEAL's config) match `offsets('SealConfig')`.
- A struct edit cannot slip past: `parseRustStruct` throws on any line it cannot read as `pub name: Type,`, and the selftest asserts layout==Rust and mutates the Rust both by adding a field and by retyping one.

**No defect found.** (SEAL/BURN/GOV structs could not be independently re-derived here because their sources are not in this bundle; the selftest reads them from disk at run time.)

## R4 — Money arithmetic (`bank/accrual.mjs`)

I compared each mirror against the bundled MINT source:
- `owed_of` = `weight*acc + carry - debt` with `weight = LEVEL_WEIGHTS[level-1] + boost_weight` — matches `pendingScaled`.
- `credit` = `delta = avail*ACC_SCALE/w; acc+=delta; owed+=delta*w` — matches.
- `ceil_sats` — matches.
- `join` sets `debt = level_weight*acc`, `carry=0` — matches `debtAtActivation` (join uses level weight only; a pending vault cannot carry a boost, which the program enforces).
- `reweigh` moves owed to `carry`, restarts `debt` at the new weight — matches.

The crank expires due boosts before a distribution (`preExpires`, `dist_epoch >= boost_end_epoch`) and the boosts a distribution makes due right after (`postExpires`, `boost_end_epoch === dist_epoch + 1`); the alarm pages `boosts_stalled` and watches `cbob_mint`/`max_boost_weight`/`max_boost_epochs` as fixed-forever. **No divergence found.**

## R5 — The swap and the revenue cycle

I worked through (a)–(i):

- **(a) Oracle math** — `oracleFloor` computes `sats = lamports * sol.price * 10^(es-eb) / (btc.price * 10)`; with both exponents −8 this is correct. Integer division rounds **down** (expected, then the 150 bps floor also down), which is the safe direction (never rejects an honest fill). `satsPerLamport` is a float, but at live magnitudes its error is ~1e-11 bps, far inside the 100 bps gate — it cannot flip the deviation decision.
- **(b) Pyth** — I recomputed the `PriceUpdateV2` offsets: disc(8)+write_authority(32)=40, Full tag at 40, feed_id 41..73, price 73, conf 81, expo 89, publish_time 93; the min-length 101 and the code agree. Ownership by the receiver + PDA derivation is sufficient: only the receiver program can write that account, and staleness (180 s) + future (30 s) bound any replayed-old update. Age is judged against the chain Clock sysvar, which is the correct trustworthy clock.
- **(c) Deviation** — `orcaSpot = (sqrtPrice/2^64)^2` is sats-per-lamport (B/A = cbBTC/wSOL), `meteoraSpot = 1/(1+binStep/1e4)^activeId` is sats-per-lamport (inverse of X-in-Y); both are the right quantity in the right direction. Float error cannot pass a pool it should refuse (error ≪ 100 bps).
- **(d) Minimum out** — the same `minSats` rides in Orca `other_amount_threshold` and Meteora `min_amount_out`, both at data offset 16, in cbBTC base units; the judge checks it.
- **(e) Judge** — see F-2. It does check output account, min-out bytes, direction, amount, no priority fee, and both ATA creations. A tampered builder cannot route value past the judge+program combination: vaults/reserves are program-enforced and the floor bounds price; the residue is the box-owner trust already in limit 10.
- **(f) Derivation** — Orca a_to_b uses current+two-below tick arrays; Meteora Y→X uses current+two-above bin arrays; bitmap/host_fee/event-authority/token-programs handled. At a boundary or uninitialised array the swap refuses loudly.
- **(g) wSOL** — wrap exact amount, SyncNative, swap, close-to-owner. A pre-existing balance survives (exact-input swap) and is returned on close; wSOL cannot be frozen; no delegate can act inside the atomic transaction; nothing is left wrapped.
- **(h) Failure/retry** — Meteora is tried only on a real refusal; a confirmation timeout that later lands is classified `landed` (recorded, no fallback) or `unknown` (cycle stays open, no second swap). No path closes a cycle without a proven return + split (`cycleIsOpen`).
- **(i) Extraction bound** — worst fill is the 150 bps floor; on a 10 SOL cap that is ≤ ~18 SOL-cents… concretely ≤ ~$18 per cycle / ~$2.1k per month absolute-worst (every swap at the floor), and a sandwich cannot push below the floor. Not material at this cycle size. Operator-key worst case is unchanged (cap × cooldown windows); the ledger cannot read a failed cycle as closed.

**One finding raised above (F-1); otherwise no defect.**

## R6 — The gates

- The selftest floor is an **equality** (`R.length !== FLOOR` fails), so it cannot be satisfied by deleting work and accumulates no slack; `run-tests.sh` `floor()` also enforces equality per suite.
- The round-25 arms are genuinely both-ways where claimed: I traced the L1 judge arms (honest build → `[]`, each of the eight tampers → a named refusal, both venues), the L2 clock arms (fresh/stale/future), the L3 classifier arms (preflight/on-chain-failed/expired/landed/unknown), the L4 cron-period arm, and the L6 deviation arms (99 bps used / 101 bps refused, both sides, both venues). I did not find an arm that cannot fail.
- `build-mainnet.sh` proves all **five** artifacts: behavioural key check for the four initializing programs and byte-identity (mainnet == localnet == `target/deploy`) for the sweep helper, and refuses a dirty tree.
- `cron-install.sh` arms money only from an uncommented, tagged `--live` line (the `ours()` matcher is anchored to the job tag and end-of-line), installs the six jobs, and the revenue line is hourly per L4.

**No vacuous gate found.**

---

## The four accepted-limit questions

1. **Any limit worse than stated?** No. Limit 10's operator bound is unchanged by the direct swap (the operator can still keep the SOL; the swap path adds a floor, it doesn't widen the key). Limit 25's RPC-stall measurement and limit 46's charter-window exposure read as stated.
2. **Any listed limit not actually a limit / quietly closed?** No. Limit 27 (claim between bare burn and retirement) is still real between plan and send even though the crank retires first; it is correctly not claimed closed.
3. **Any DISCHARGED item not actually discharged?** I could not verify the on-chain discharge of items 33/51/54 from this bundle (their proofs live in the suite and in SEAL/BURN/GOV not bundled here), but nothing in the bundled off-chain code contradicts their discharge, and the boost machinery (item 51) is present in MINT and mirrored off-chain.
4. **Any OPEN-AND-BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are all still marked open and are referenced as prerequisites (ship gate, road steps). Item 50's "holder guide may not be published before this ships" is the correct control for the guide's present-tense surface language.

---

## Anything else

### F-3 (INFO) — `HOLDER-GUIDE.md` names a deposit-address page in the present tense that does not exist
"The Bank's pages show it; it is not the NFT's own address" (item 2 of "The four things you ever do"). The deposit-address surface is listed in item 50 as not built. This is already tracked by item 50 and the guide is marked DRAFT with a publication block, so it is not a new defect — but it is the one sentence whose falsity would be live the moment the guide is published, and it should be re-checked against the built surface in the same commit that ships item 50.

---

## Given that no human firm will ever see this and the programs will be immutable, what should this project do before launch that AI audit structurally cannot?

AI rounds reason over the bundle; they cannot execute the not-yet-written, cannot hold a key under real conditions, and cannot observe the system over wall-clock time. Concretely, before the upgrade authority is removed:

1. **Run the named dress-rehearsal items live and record signatures** (item 22 / road step 8), especially the two things no AI round can do: one full revenue cycle through **each** pool with Orca genuinely forced to refuse, and one forced post-sweep failure walked through hand recovery. Treat a skipped mainnet probe or swap-fork as a non-pass.
2. **Exercise the crank against a live ~2,100-vault deployment** for at least one full distribution and one reveal-lapse/reschedule, since every AI round so far has only proven the planner, not the I/O at scale (rate limits, a transient RPC error mid-batch, the every-minute lane keeping up).
3. **Do a human key-handling review of the box**: the swap-operator key, the crank key, the `$CBOB` release wallet, and the Gary-Club inventory hot wallet (limit 46) all live on one host. An AI audit cannot inspect who has shell access, what the backup path exposes, or whether the guardian wallet is actually reachable in an emergency; a human with physical/access control must attest this.
4. **Verify the four `initialize` transactions are built from `launch/mainnet-init.json` and read back from chain** before the lock, since the checker validates the JSON, not the signed bytes (accepted limit 38 / round-24 A6). A human should confirm the on-chain values against the file after `initialize`, not before.
5. **Hold the PoB collection key cold or in a multisig through the 7-day charter window** (limit 46). This is a custody decision only Gary can make and it is the single largest pre-launch centralisation; an AI round can only document it.
6. **Build and ship the redeem page (item 50) before the guide is published and before the lock**, because it is the only pre-signature control for undeclared holdings (limits 9/44) once the Bank co-signer is gone. Until it exists, nothing prevents a holder destroying an undeclared asset.
7. **Get a second, different-roster clean round** (ship gate 3) — and treat this round as one input, not the certification, precisely because a same-roster re-read is one round run twice.