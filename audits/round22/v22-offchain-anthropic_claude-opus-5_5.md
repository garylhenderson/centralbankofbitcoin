# CBOB v6 — Independent Audit, Round 22

**Method and its limits.** I read every file in the bundle. I ran nothing. Each finding states the observable that would exist if it is true, so it can be checked by measurement rather than taken on my word.

**Severity.** Severity is given only where the mechanism follows directly from the code shown. Where a claim depends on behaviour outside the bundle, I mark it **VERIFY** and give the measurement that settles it. These are: Helius DAS, Core's plugin authority rules, the compute-unit cost of a SlotHashes scan, and Jupiter's endpoint status.

I found **no theft path and no way for the crank to move value outside a pinned destination**. The defects are in liveness, in alarm signal quality, and in places where a document claims more than the code delivers.

---

## R1 — THE CRANK (`bank/crank.mjs`)

### R1-1 HIGH — The capture loop is serial and confirm-blocking, so any burst of mints lapses windows

**Construct.** `main()` sends each capture and each reveal as its own transaction:

```js
for (const a of plan.capture) await run(...)
for (const a of plan.reveal) await send(...)
```

Each call is `sendAndConfirmTransaction(..., 'confirmed')`, one at a time, in a single lane, under `flock -n`.

**Why it fails.** The capture window is 300 slots, about 120 s. A confirmed send takes roughly 1–2 s on mainnet.

- If more than about 60–120 vaults become ready together, the vaults late in `plan.capture` are already past `reveal_slot + 300` when their transaction lands. They are refused with `RevealWindowExpired`.
- Those vaults then need `reschedule_reveal`, which gives the minter the re-roll described in limit 25.
- While the pass runs, `flock -n` silently skips every later minute of the lane. Vaults minted during the pass also lapse.
- After the captures, the same pass reveals the whole backlog serially. That holds the lock for a further N × ~1.5 s.

The charter opening is exactly this burst: 240 eligible claimants and a published opening time.

**What a manipulator gains.** Limit 25 assumes a lapse needs a crank *outage* plus total silence. Here a merely *busy* crank produces lapses. A minter who computes a bad draw only has to mint during a burst.

**Evidence if true.** In `sim/` or on a dress-rehearsal cluster, create 240 vaults within 60 s and run the crank once. Expect:
- `FAIL capture ...` lines with `RevealWindowExpired`;
- `CBOB_REVEAL_RESCHEDULED` on the next pass;
- `reschedules > 0` on records whose owners never declined anything.

**Fix.**
- Give captures their own lane, sending no reveals.
- Batch about 15–20 `capture_entropy` instructions per transaction. MINT's own comment says many fit.
- Fire transactions without serial confirmation.
- Time-box the reveal lane. Reveals have no deadline; captures do.

### R1-2 MEDIUM — Every benign race becomes a refused transaction and an SMS page

The crank pages through `run()` → `failures` → SMS for each of these:

1. **The two lanes collide.** The hourly full pass and the every-minute reveal lane both run reschedule, capture and reveal, under *different* locks (`.crank.lock` and `.crank-reveal.lock`). At least once an hour they send the same capture or reveal concurrently. One side gets `AlreadyCaptured`, `AlreadyRevealed` or `RevealOutOfOrder`.
2. **Ordinary traffic gets there first.** Opportunistic crank riders on `mint_vault`, `claim`, `activate` and `claim_charter_vault`, and anyone else running layer two, capture or reveal between the crank's read and its send.
3. **A skipped slot.** `readySlot()` assumes no slot skips. If A, B or C was skipped, `capture_entropy` returns `RevealTooEarly`, and the reveal planned for that same record fails again. `readySlot`'s own comment says "a NotYet answer is harmless", yet the code pages on it.
4. **A reschedule race.** A record someone else rescheduled returns `RescheduleTooEarly`.

Preflight catches most of these, so fees are rarely spent. The harm is pages: during a sale round this means SMS pages at minute cadence, which trains the operator to ignore `CBOB crank:` messages.

**Evidence if true.** Run both lanes `--live` against a validator with a steady mint load. Expect a `FAIL` within an hour carrying one of the four errors above.

**Fix.**
- Classify `AlreadyCaptured`, `AlreadyRevealed`, `RevealTooEarly` and `RescheduleTooEarly` as "already done / not yet", as `runDistribute` already does for `MonthNotElapsed`.
- Drop reschedule, capture and reveal from the full pass entirely.

### R1-3 MEDIUM — One undeserialisable asset halts the reveal FIFO for every vault behind it

**Construct.** `mintedAttributes()` calls `deserializeAssetV1` from the installed `@metaplex-foundation/mpl-core`.

- If that throws, `main` throws. Every minute it pages "CRANK FAILED TO RUN".
- Because reveals are strictly FIFO, nothing behind that vault is ever revealed by the crank.
- An unrevealed vault cannot `activate` (`NotRevealed`). Every vault minted after the stuck one therefore never joins payouts until a human hand-crafts the reveal.

**How it is reachable (VERIFY).** The asset's owner can add owner-managed plugins; `PermanentFreezeExecute` gates only Execute. A Core upgrade (limit 40) that adds a plugin type the pinned JS SDK does not know would make `deserializeAssetV1` throw for any owner who adds one. The program would accept the correct attribute list, so this is a crank-only halt. But the crank is layer one, and nothing else is guaranteed to run.

**Evidence if true.** On the validator, add an owner-managed plugin of a kind unknown to the pinned SDK version (or simply corrupt the deserializer path) to the head-of-queue asset. Expect the crank to fail every pass while `revealed_total` stops advancing.

**Fix.** Read the Attributes plugin with a minimal registry walk that skips unknown plugin types, or recover the list from the `VaultMinted`/`CharterClaimed` transaction. The hash check makes any source safe. Also add the stall detector from R2-3.

### R1-4 LOW–MEDIUM — The crank activates, and then pays, permanently bricked vaults

**Construct.** `planCrank` activates any `live`, revealed vault holding ≥ 21,000 sats. Claims are then paid to it forever.

A vault transferred to its own asset-signer PDA (proven impossibility 3; the alarm reports it as `vault_owns_itself`) is live and is never burned. So:
- `retire_burned` can never remove it;
- its weight dilutes every distribution forever;
- its share accumulates behind a PDA nobody can sign for.

Limit 27 covers this harm only for *burned* vaults, and that case is self-healing through `retire_burned`. The bricked case is not self-healing and is not listed anywhere.

**Fix.**
- Have the crank skip activation, and skip claims, for any asset whose owner is its own PDA. The alarm already computes this.
- Add an accepted limit: anyone can still activate such a vault, because the program cannot refuse it.

### R1-5 LOW — The crank distributes from a frozen pool, which the in-line run deliberately refuses

**Construct.**
- `poolOk = pool.state === 'ok'` is true for a frozen pool.
- A due month therefore plans `distribute` even after recording "the pool cbBTC account is FROZEN".
- `monthly_inline` refuses to credit from a frozen pool, and gives the reason: crediting from a frozen pool "would only make every vault owed again".

Layer one does what layer three was designed not to do. The financial effect is close to neutral, because redeemers forfeit the share back to the pool. The point is that the two layers disagree.

**Fix.** Gate `distribute` on `!pool.frozen` in `planCrank`.

### R1-6 LOW — The fee ceiling is set at the size of one mint day's real spend, and is griefable

**Spend versus ceiling.**
- `reveal_level` makes the crank pay Core rent for the `level` attribute: about 14 bytes × 6,960 lamports per byte.
- At 2,100 reveals that is about 0.2 SOL in rent, plus fees.
- The ceiling is 0.25 SOL. The operator cannot pre-fund a mint day without tripping the refusal.

**Griefing.**
- Anyone can send 0.25 SOL to the crank key. The crank then refuses to run (`judgeFeePayer` throws) and pages.
- The gift is to the project, so this is a costly grief, but it reliably turns layer one off.

**Fix.** Do not refuse when over the ceiling. Run, page, and sweep the excess to the Squads, or raise the ceiling to cover measured mint-day spend.

### R1-7 LOW — The signer-set gate pins the default key path, not the key actually used

- The crank reads `process.env.CBOB_CRANK_KEY || '/opt/.../crank.json'`.
- The signer-set gate in `selftest.mjs` passes because the default path string is present.
- A cron environment can therefore point the crank at any keypair, including the swap operator's.

The instruction builders in `main()` are inline and unexported. I checked all eight account orders by hand against the Anchor structs and found them correct. **VERIFY** whether the suite's +7 stage-4 assertions actually send `main()`'s transactions; I cannot tell from the bundle.

**Fix.**
- Hardcode the key path, as `revenue.mjs` does.
- Export the instruction builders and send them from `tests/3prog.test.ts`.

---

## R2 — THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

### R2-1 HIGH — Every honest redemption raises at least one CRITICAL that `correlateBurns` cannot downgrade

**First mechanism: the inner Core burn reads as a bare burn.**
- `normalise()` flattens inner instructions into the same list as top-level ones.
- `burn_vault` CPIs Core `BurnV1` (data byte 12, `accounts[0]` = the asset).
- `detectBurns` marks the top-level BURN instruction as INFO. It then also sees the inner Core instruction, and the asset is in `assets` (live, or burnt, from DAS). It emits **`bare_core_burn` CRITICAL**: "did NOT go through burn_vault".
- `REDEMPTION_NOISE` does not include `bare_core_burn`, so the CRITICAL survives.
- The redemption transaction involves SEAL, BURN and MINT (MINT via `retire_redeemed`), so all three signature walks fetch it. The result is up to three copies per redemption.

**Second mechanism (VERIFY): DAS may omit burnt Core assets.** `getAssetsByGroup` is called without any burnt-display option. If Helius returns burnt Core assets only on request:
- the redeemed vault is in neither `live` nor `burnt`;
- `detectVaultSetChange` emits `vault_left_index`, which correlation also never downgrades, by design;
- `detectIndexShortfall` (live + burnt ≠ `minted_total`) raises CRITICAL on every pass after the first redemption.

The local validator has no DAS and the mainnet probe does not test this, so DAS's handling of burnt Core assets is unmeasured.

**Net effect.** Whichever DAS behaves, the one signal the burn detectors exist for (a genuine bare burn) is indistinguishable from the 45-per-hour honest exits.

**Evidence if true.**
- Run `normalise` + `detectBurns` over any landed redemption transaction from the suite's ledger. Expect `bare_core_burn`.
- Call `getAssetsByGroup` on a collection containing a known burnt Core asset, and check whether it is returned with `burnt: true`.

**Fix.**
- Skip a Core `BurnV1` whose parent top-level instruction (the inner-instruction group's `index`) is BURN's `burn_vault` for the same asset.
- Measure DAS burnt behaviour in `probe-mainnet-facts.mjs` and pass the needed display option.
- Add `bare_core_burn` from a scanned redemption to the correlation logic only by that parent test, never by a caller-supplied key.

### R2-2 MEDIUM — `redemptions_near_cap` pages HIGH on every pass while live supply is 47 or fewer

**Construct.** In `detectRedemptionRate`:

```js
near = max(1, floor(cap * 0.2))
if (remaining > near) return []
```

When `live ≤ 47`, `cap = 1`, `remaining = 1` and `near = 1`, so `1 > 1` is false and it fires. This happens:
- from `initialize`, with `minted_total = 0`, which may be weeks before the charter opens;
- until 48 vaults exist;
- and again at end of life.

HIGH triggers SMS. The selftest only exercises 2,100 live vaults.

**Evidence if true.** `D.detectRedemptionRate(bk(0, []), T)` returns a finding.

**Fix.** Page only when `inWindow > 0 && remaining <= near`.

### R2-3 MEDIUM — Two stalls are silent: the reveal queue, and the launch join

**The reveal queue.** `reveal_rescheduled` is raised from a `CBOB_REVEAL_RESCHEDULED` log line. That line exists only when someone *sends* `reschedule_reveal`. If the crank is dead or wedged (limit 7), windows lapse and no event ever appears. Records sit unrevealed, `revealed_total` stops advancing, and nothing pages.

**The launch join.** `detectDistributionOverdue` returns `[]` when `total_active_weight == 0`. At launch, weight is 0 while vaults are pending. If nobody sends the free tick, no vault ever joins and nothing pages. `joins_waiting` is INFO and never escalates with age.

**Evidence if true.** Stop the crank on a validator holding pending records, and advance past the window and the period. The alarm reports no CRITICAL or HIGH.

**Fix.** The alarm already reads both values it needs.
- Page when `minted_total > revealed_total` and the head record's `reveal_slot` is more than about 300 slots old.
- Page when `pending_count > 0` and `now > last_distribute_at + monthly_secs + grace`, whatever the weight.

### R2-4 MEDIUM — The Proof of Burn watch covers the collection account, not the 240 assets

**Construct.** `readConfigs` hashes the plugins and reads the update authority of the PoB **collection** only.

**What it misses (VERIFY on the validator).** The hot wallet is the update authority of every PoB **asset** through the collection. It can:
- add an authority-managed external plugin (an Oracle) to individual assets; a REJECT oracle blocks those claims;
- move an asset out of the collection; `claim_charter_vault` then refuses `NotAProofOfBurn`.

Neither is visible to the alarm. Limit 46 says "the alarm pages on ANY plugin or update-authority change on that collection"; the per-asset route is untouched.

**Evidence if true.** Using the existing oracle fixture, attach a REJECT Oracle to one PoB *asset*, not the collection. Expect the charter claim for it to fail while the alarm's collection hash is unchanged.

**Fix.** Each pass, read the 240 unclaimed PoB assets (three `getMultipleAccountsInfo` calls) and drift-watch per asset:
- the plugin-region hash;
- the update-authority bytes 33..66.

### R2-5 MEDIUM — Leaving `CBOB_LOCK_DEADLINE` unset disables the lock-date check forever

**Construct.** `detectUpgradeAuthorityAfterLock` returns `[]` when `lockDeadlineSec` is falsy, and alarm.mjs reads that value from the environment. A cron environment missing the variable means `program_not_locked` never fires, and the check reads as calm.

**Fix.**
- Hardcode the deadline in source, as was done for the Core hash; or
- fail the pass, or raise `lock_deadline_unset` at CRITICAL, when it is absent in production.

### R2-6 MEDIUM — Votes that are legal inside the ruled bounds cause HIGH pages on every pass, forever

**Construct.**
- `sweep_cooldown_wedged` fires above 12 h, but the ruled `cooldown_ceiling_secs` is 24 h.
- `sweep_cap_wedged` fires below 5 SOL, but the ruled floor is 1 SOL.

A passed vote that tightens to, say, an 18-hour cooldown, which is lawful and permanent, pages HIGH every 30 minutes forever. The kinds cannot be acked.

**Fix.** Report it once, as a transition, plus INFO thereafter. Or align the bands with the `initialize` bounds.

### R2-7 LOW — Smaller alarm defects

- **The production list is incomplete.** `max_supply` 2,100, `level_caps`, `payment_mint` = cbBTC, `bank_treasury` = Squads, `seal.reserve_mints`, `charter_closes − opens` = 7 d, and a guardian being set are not asserted. A wrong launch value there is caught only by drift, and drift never fires on a value that was wrong from day one.
- **Armed keys page on every pass.** `swap_operator_armed` and `guardian_armed` raise CRITICAL every pass for the 7-day notice: about 336 identical pages, during the exact week a human must read them. Escalate once, then repeat daily.
- **An absent account invents a zero.** `readTokenAccount` returns `{absent, 0n}` without throwing, so the "carries the last known value forward" branch in the balance loop never runs. A transient null invents a zero and a false `reserve_fell`.
- **Several program events are unparsed.** `CBOB_ACTION_SKIPPED`, `CBOB_REDEEMED_POOL_FROZEN` and `CBOB_EPOCH_TICK` are ignored. A proposal that "executed" while skipping its action is invisible.
- **The acks comment is stale.** The `ACKS` comment in alarm.mjs documents `"who, why, when"` strings; `judgeAck` refuses strings.

---

## R3 — THE LAYOUTS (`bank/layout.mjs`)

I recomputed the critical figures and all are correct:

| Item | Value |
|---|---|
| MintConfig `governance` | offset 41 |
| MintConfig `minted_total` | offset 141 |
| MintConfig `bare_burns_retired` | offset 454 |
| VaultRecord `level` | offset 57 (the fast-lane memcmp) |
| `VAULT_RECORD_SPACE` | 221 bytes |
| `MINT_CONFIG_SPACE` | consistent with the field list |

### R3-1 LOW–MEDIUM — A struct change can slip past `parseRustStruct`

**Construct.** The regex `^pub (\w+):` silently skips:
- private fields (`bump: u8,`);
- `pub(crate)` fields;
- multi-line types;
- `#[cfg]`-gated fields.

Borsh serialises all of them, so adding a private field to MintConfig moves every later offset while the layout check stays green.

**Fix.** Match `^\s*(pub(\([^)]*\))?\s+)?(\w+)\s*:` on every line in the struct body. Refuse any `#[cfg` line inside an `#[account]` struct.

### R3-2 LOW — "Every cross-program pinned offset is asserted" is a hand-written list

- `want[]` is maintained by hand. A new `OFF_*` constant in GOV or BURN that is not added to it is scraped and then never compared.
- MINT's own `OFF_COLLECTION` (into SEAL) is unchecked.

**Fix.** Assert that the set of scraped `OFF_` names equals the keys of `want`.

### R3-3 LOW — The crank's planning constants are not asserted against the Rust

None of these is checked against MINT:
- `REVEAL_WINDOW_SLOTS`, `REVEAL_LEAD_SLOTS`, `MAX_CRANK`;
- the 4-slot group and 2-group stride hardcoded in `readySlot`;
- `LEVEL_WEIGHTS`, `ACC_SCALE`, `ACTIVATION_SATS`.

The "same weights" assertion compares against literal strings, not against the program.

**Fix.** Scrape each `const` from `programs/cbob-vault-mint/src/lib.rs` the same way `OFF_*` is scraped.

---

## R4 — THE MONEY ARITHMETIC

**No divergence found.**
- `credit` matches the program: `delta = avail·1e12 / w`, `owed += delta·w`.
- `pendingSats` matches `claim`: `w·acc − debt`, floor-divided by the scale, refusing a negative.
- `ceilSats` and `available` match `distribute`'s refusals (`PoolShort`, `NothingToDistribute`).

**LOW.** The header claims `retire` and `join` are mirrored "line for line". Neither function exists in `accrual.mjs`. The selftest's "retiring returns exactly its share" uses a single-vault state in which `owed − pending = 0` by construction, so it cannot fail. `detectors.mjs` also re-types the 1e12 scale instead of importing it.

**Fix.**
- Add `retire(cfg, rec, {redeemed, forfeit})` and `join(cfg, rec)` mirrors.
- Test them on a multi-vault trace, with invariants after each step:
  - pool ≥ ceil(owed);
  - Σ weights = `total_active_weight`.

---

## R5 — THE SWAP HOP (`bank/revenue.mjs`)

### The ledger cannot misread a failed cycle as closed

I traced every failure path: rejection regex misses, confirmation timeouts, and confirmed failures whose message is `Transaction … failed ({"err":…})`. Each one leaves the row **open**, which is the safe direction. `splitByOther` requires a readable, Tokenkeg-owned revenue ATA holding zero. Only `split_revenue` can produce that state, so the close is sound.

### Worst case, bounded

- **A thief holding the operator key:** cap × elapsed cooldowns until `emergency_stop_sweep`, above `sol_reserve`. At the proposed launch values of 10 SOL per 6 hours, that is 40 SOL per day.
- **A tampered Jupiter response, without the key:** one sweep plus the operator's float and leftover cbBTC. The pre-sign inspection checks only static keys against two forbidden programs and the signer count. It does not see:
  - accounts loaded through address-table lookups;
  - a System transfer or SPL transfer inside the transaction.

  The open-cycle guard then stops any second cycle. The alarm sees it as `unreconciled_swap` or `short_swap_return`.

### LOW findings

- **The swap confirmation result is ignored.** `confirmTransaction` returns `{value: {err}}` and does not throw, so a failed swap is recorded with a `swapSig`. The later delta floor catches it.
- **The endpoint may be stale (VERIFY).** `quote-api.jup.ag/v6` is an older Jupiter endpoint. If it has been retired, every cycle throws at the first quote. That is safe, since no SOL moves, but royalties stop flowing. Check with `curl` before launch.
- **Allowlist instead of denylist.** If the bound should mean something, inspect the transaction for System and Token instructions whose source is the operator and whose destination is not the operator's wSOL or cbBTC ATA.

---

## R6 — THE GATES

1. **The round-14 output-swallowing defect remains at three sites.** In `run-tests.sh`, the poster, pob-merkle and launch selftests use `OUT=$(node …) || die`. When one fails, the build prints only "poster selftest failed", never which assertion. This is the defect the detector block's comment documents, still present at three other sites.
2. **The crank's "only permissionless instructions" assertion matches only `d('name')` calls.** A `SystemProgram.transfer(...)` added to `crank.mjs` passes it, yet the assertion's name claims "no transfer, no system move of value". Scan for `SystemProgram.`, `createTransfer` and `Instruction({ programId:` other than MINT.
3. **An ON-CHAIN control-table row passes if one named refusal is real.** A row naming seven refusals, six of them invented, is green. Require every backticked CamelCase name in the row to be a real variant.
4. **Count floors cannot detect replacement.** Swapping a meaningful assertion for `t(x, x)` keeps the count, and several existing arms are near-tautologies (`ixDisc` against the same formula; `attrsHash` against its own definition). Run mutation testing, for example Stryker, over `detectors.mjs`, `planCrank` and `accrual.mjs`. Gate on the surviving-mutant count rather than on the assertion count.
5. **Two counts in SPEC are unguarded.** The pob (14) and launch (15) counts are stated in SPEC but are not in the stated-count gate's regex set.

---

## THE ACCEPTED LIMITS

### Q1 — Limits that are worse than stated

- **Limit 7.** It claims the alarm makes a stalled crank "survivable rather than silent" through `reveal_rescheduled` and `distribution_overdue`. Both are silent in the stall cases (R2-3): no reschedule event without a cranker, and no overdue alert at zero active weight.
- **Limit 25.**
  - A lapse does not need a crank outage; a busy crank produces one (R1-1).
  - "Ordinary traffic captures" happens only if each client chooses to pass queued records as remaining accounts. Nothing makes them.
- **Limit 46.** The individual PoB assets are unwatched and can be hooked or removed from the collection (R2-4).
- **Limit 8.** Moot in practice: the redemption path itself produces a CRITICAL that cannot be downgraded (R2-1).
- **New, unlisted limit.** A bricked vault (proven impossibility 3) can be activated by anyone and draws its share forever, with no retire path (R1-4).

### Q2 — A limit that is not fully a limit

**Limit 43 / proven impossibility 5**, at mint, is closable on chain.

- `mint_vault` and `claim_charter_vault` can require `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT`, the primitive MINT already uses in `retire_redeemed`.
- A top-level instruction's signers are transaction signers, which must be ed25519 keypairs. A PDA owner becomes impossible at mint without needing `is_on_curve`.
- This does not cover secondary transfers to a DAO.
- MINT's comment calling `owner: Signer` "the best available check" is therefore wrong, and since the programs are not yet immutable, this is the time to fix it.

**Evidence.** A suite case that mints through a CPI wrapper program with a PDA owner. Today it lands; with the check, it is refused.

### Q3 — A discharged item that is not fully discharged

**Items 12/17, compute units.** The measurement is of v5's mint path against the 1.4M cap. But:
- without a `SetComputeUnitLimit` instruction, the effective budget is **200,000 CU per non-builtin instruction**;
- the crank sends none.

v6 added work that did not exist in the measured path:
- `try_capture` scans the 512-entry SlotHashes three times per capture;
- a `claim_charter_vault` can carry four cranked captures, plus a Merkle proof, a Core burn and a create;
- `claim` makes 14 SPL-transfer CPIs plus record serialisation;
- `reveal_level` does three scans plus a Core update.

**VERIFY.** Take `meta.computeUnitsConsumed` for:
- `claim_charter_vault` with four in-window crank records;
- `reveal_level` on a full 640-byte attribute list;
- `claim` with 14 paying pairs.

If any is near 200k, have the crank and the pages add a compute-limit instruction, and re-check the packet budget, because that instruction costs bytes.

### Q4 — OPEN AND BLOCKING items being softened

- **Item 50 carries an escape hatch.** It ends with "Gary may rule otherwise". Meanwhile ACCEPTED limits 9, 37, 42 and 44 each name, as their only preventive control, a surface item 50 says is unbuilt:
  - no crank when `pob_extra > 0` (limit 37);
  - destination ATAs created in a prior transaction (limit 42);
  - `claim` always included (see below).

  Demoting 50 would silently remove the mitigation from four accepted limits. Either bind them to item 50 explicitly or delete the escape hatch.

  The redeem page should always include `claim` for an active vault. If the page omits it because 0 sats were owed at build time, and a distribution lands before the transaction, the redemption fails with `ClaimBeforeBurn`.
- **The two status statements disagree.** SPEC "Where this stands" says the Test Vault results are "pending"; the road table says 59/59 done. The ship gate needs one true statement.

---

## OTHER FINDINGS

- **MEDIUM (holder-facing; VERIFY against HOLDER-GUIDE.md, which is not in the bundle) — the first free payout comes about two periods after the charter closes.**
  - The free path ticks at `charter_close + 30 d`.
  - Vaults join after that tick.
  - The first crediting free distribution is a further 30 days on.

  If the guide promises monthly payments from the close, it promises something the code does not do.
- **LOW — the redemption post understates every activated vault's redemption.** The redemption runs `claim` before the sweep, so the vault's `preTokenBalance` excludes the share claimed in the same transaction. `releasedFrom` reports `pre − post`, which is less than what the holder received. That breaks the poster's "never a number that is not real" rule. Compute the outflow from the vault ATA's net change plus the in-transaction inflows, or from the destination ATA increases.
- **LOW — the poster crashes and duplicates on unusual redemptions.**
  - A vault can be redeemed before its reveal. Its record has `level = 0`, `draftPost` throws, and the poster is stuck on that signature forever.
  - Because `appendFileSync` runs before the cursor is persisted, any crash re-drafts duplicates on the next run.
  - When there is a `gap`, the cursor jumps to the newest signature, so the "drafted next pass" comment is false: older redemptions are skipped.

---

## GIVEN NO HUMAN FIRM AND IMMUTABLE PROGRAMS — WHAT AI AUDIT STRUCTURALLY CANNOT DO, AND WHAT TO DO INSTEAD

1. **Run a full-scale mainnet dress rehearsal before deploy, under throwaway program IDs.**
   - Scale: 2,100 vaults, about 15–20 SOL in record and asset rent.
   - Charter burst: 240 claims inside 60 s.
   - A month compressed by setting `monthly_secs = 60`.
   - Payment mint: a project-controlled classic SPL mint **with a freeze authority you hold**. Set it as the rehearsal SEAL reserve so you can actually freeze the pool and a vault on mainnet, and exercise `CBOB_REDEEMED_POOL_FROZEN` and deferral end to end.
   - Measure: reschedule count, every crank `FAIL` line, alarm page volume per honest redemption, and `computeUnitsConsumed` on every instruction kind.
2. **Do stateful property fuzzing, which AI review cannot substitute for.** Use LiteSVM or bankrun with real Core. Generate random interleavings of mint, claim, activate, join, distribute (both paths), claim, bare burn, retire, redeem, freeze and thaw. After every step, assert:
   - pool ≥ ceil(owed);
   - Σ active weights = `total_active_weight`;
   - `pending_count` and `pending_this_epoch` are consistent;
   - no vault is owed more than was distributed;
   - `revealed_total ≤ minted_total`;
   - the census holds.

   Run it for hours, and keep every failing seed as a regression test.
3. **Run mutation testing on the off-chain detectors and planner,** and gate on surviving mutants. This converts "the floor equals the count" into "the assertions actually discriminate".
4. **Hold a public, funded bug bounty on the rehearsal deployment** for a fixed window before the final deploy, with real cbBTC in the rehearsal pool and payouts stated in advance. Strangers with economic motive find the things all models share blind spots about.
5. **Make the build verifiable and reproducible.**
   - Publish source.
   - Produce the build with `solana-verify` against the deployed programdata.
   - Have a second person, on a second machine, reproduce the sha256 from `scripts/build-mainnet.sh` before step 11 (removing the upgrade authority).
6. **Measure the external facts this design rests on, on mainnet, and assert them in `probe-mainnet-facts.mjs`:**
   - DAS burnt-asset behaviour for Core;
   - per-asset external-plugin authority in the Giraffish Moments collection;
   - Jupiter endpoint liveness;
   - current mainnet rent, which changes the holder-facing 2,429,040-lamport record figure.
7. **Run human drills on real keys.**
   - A guardian stop from the hardware wallet that will hold it, timed.
   - A swap-operator compromise tabletop: alarm page, human, `emergency_stop_sweep`; measure minutes.
   - A Core-upgrade response: re-run the full suite against Metaplex's new binary before it reaches mainnet. Watch their release channel, because the alarm's hash watch fires only after the fact.
8. **Have a non-developer use the actual pages with a real wallet.** The pages are the redeem page, the charter claim and activation. They should check every promise in HOLDER-GUIDE.md against what the chain does, line by line. Item 50 is the place where a holder's property is destroyed today with no preventive control, and no model can click through a page that does not exist.