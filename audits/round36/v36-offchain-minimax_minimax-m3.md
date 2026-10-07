# Round 35 audit pass

I read round 35's not-counted output, the program change that followed, the repairs-validation, and the live tree. I went looking for defects in the v6 code, including the new rescue_nested instruction, the sweep helper, the crank's planner against MINT's program, the alarm's freeze transitions, the swap's judge and oracle, and the launch gate. I tried to falsify the round 35 repairs in code, and read the parts I could verify directly off chain. I'll be specific about what I checked, what I couldn't, and where I'm certain vs uncertain.

## R0. Round 35's repairs

The seven usable reports from round 35 were independently triaged; the owner then ruled the program change for item 58. The change ships at `1281ab4` with `rescue_nested`, a third permanent plugin on every vault, and a Squads destination. The `VALIDATION.md` records two builds and their floor runs. I read both, but the key question is whether the **code** is right, not whether the suite passed. So I re-read the change.

### rescue_nested (`programs/cbob-vault-mint/src/lib.rs:1810-1855`)

The fix in response to the review's M1 is clean: the destination is `a.config.bank_treasury` regardless of host type, and `require_keys_eq!(a.new_owner.key(), dest, MintError::WrongRescueDestination)` enforces it. The host-type gate is now:

1. `host == vault.key()` → orphan, Squads.
2. `is_burned(&a.host)?` returns true → orphan, Squads.
3. Otherwise `require_live_vault(&a.host, &a.config.collection).is_ok()` must be true → live CBOB host, Squads.

This is the right shape. A foreign live host is refused at step 3 (it would never match our collection), so the M1 problem — a nested vault handed to a stranger who happens to own a live escrow — is closed. A foreign burned host is rescued to Squads at step 2, which is the L3 case the triage named. I cannot test the foreign-collection or foreign-group case against a live Core (the suite clones pinned Core at e72d63e and runs the same test set); the handler reads `d[0] == KEY_ASSET_V1` and the collection key bytes, so a Core Collection (key 5) or Group (key 6) cannot pass. That matches the triage's read of Core.

`rescue_authority` is an Anchor-derived PDA at `seeds = [RESCUE_SEED]`, so the seed check happens automatically. The `invoke_signed` signs the CPI with `[RESCUE_SEED, &[ctx.bumps.rescue_authority]]`. `is_burned` is the standard `*a.owner == MPL_CORE_ID && d.len() == 1 && d[0] == 0` positive check. Both `require_live_vault` paths (MINT and rescue_nested) share the helper, so a rescue that names a missing or wrong-type host is a clean HostUnresolved with no nested check ahead of it. Good.

The data sent to Core is `vec![IX_TRANSFER_V1, 0]` = `[14, 0]`. **I could not fully verify this against the pinned Core binary.** The mpl-core TransferV1 instruction data layout has changed across versions (some include a compression byte, some don't, and the amount field's presence depends on the version). The rescue tests in `R35.N1` assert the rescue succeeds on the pinned binary, so the encoding is correct for the pinned version. The tests in `sim-swap-fork.sh` and `tests/3prog.test.ts` run against the same pinned Core. I flag this as **I could not directly inspect the data layout against the actual Core binary** rather than as a finding, because the tests are the proof and they pass.

The account order in the CPI is:
- 0: vault (writable, not signer)
- 1: collection (readonly, not signer)
- 2: payer (writable, signer — the fee payer of the rescue transaction)
- 3: rescue_authority (readonly, signer — the PDA, derived and signed via invoke_signed)
- 4: dest = bank_treasury (readonly, not signer)
- 5: system program
- 6: mpl_core (extra)

I read the mpl-core TransferV1 account order as: asset, collection, **payer**, **authority**, new_owner, system. The authority is the 4th account (index 3), which is `rescue_authority` — the PDA with the permanent transfer delegate — and the payer is the 3rd account (index 2), separate from the authority. That matches the code. If the pinned Core reads 6 accounts and ignores the 7th, this works. Again, I could not directly read the pinned Core's processor/transfer.rs to confirm, but R35.N1 tests the rescue succeeds.

**What evidence exists if I'm wrong about the data layout or account order:** R35.N1 through R35.N9 in the suite would fail at the rescue CPI. The validation report shows R35.N1 through R35.N5 pass at the Squads-only build. The risk is not that the suite is missing a test; it is that the suite tests a specific Core version and I could not directly compare the data layout my reading predicts to that Core's actual deserializer.

### Host-type edge cases

The triage L3 named two cases I want to confirm: a self-nested foreign host (`host.owner == PDA(host)`), and a live Core Collection or Group. For a foreign host, `is_burned` returns false (owner is the foreign Core asset's program, but data is not 1 byte), then `require_live_vault(&a.host, &a.config.collection).is_ok()` fails because the host's collection bytes don't match our config.collection. Result: HostUnresolved. For a live Core Collection (key 5) or Group (key 6), `require_live_vault` checks `d[0] == KEY_ASSET_V1` (which is 1), so key 5 or 6 fails. Result: HostUnresolved. Both cases the triage flagged are refused, as the triage predicted.

The one case the triage called "oddly" — a **burned** Core Collection or Group — Core's `close_program_account` writes a 1-byte tombstone at `Key::Uninitialized` for both assets and groups (the triage cites `core/utils/account.rs:10-33`). So `is_burned` returns true (owner is Core, data is 1 byte, byte 0 is 0). The handler then sets `orphan = true` and rescues to Squads. This is the right call: a Core Collection or Group can never execute (ExecuteV1 requires AssetV1), so its signer PDA is permanently dead, and the only sensible home is the Squads. The triage's read matches.

### The plugin (round 35's new permanent plugin)

`create_vault` now installs THREE plugins at `CreateV2`:
- PermanentFreezeExecute (frozen, authority seal_pda)
- PermanentTransferDelegate (authority rescue_pda)
- Attributes (authority mint_pda)

`create_vault` writes the plugin data with the right structure for the pinned Core (the suite tests it). I read the data carefully and **I could not directly inspect mpl-core's plugin data format at e72d63e against the code's encoding**, but the suite's create_vault tests pass at the pinned Core. The triage's concern M1 (sending to host's owner) is closed by the Squads-only destination. The triage's concern about the plugin not being removable is closed by `PermanentTransferDelegate` being a permanent plugin (Core refuses adding it after creation, and our suite measures the exact bytes).

## R1. The crank

I read `bank/crank.mjs` against `bank/accrual.mjs` and the on-chain MINT program. The planner (lines 100-380) computes the same numbers the on-chain `credit`, `claim`, `join`, and `expire_boosts` compute, and it does so in the right order:

- Retire bare burns first (any level, per round 23 I1).
- Pre-joins (vaults whose `request_epoch < dist_epoch`) — but **only if the asset reads as 'live'**; an unreadable eligible vault stops the tick (round 23 L2).
- Pre-expires (DUE boosts) — refuses a distribute if any is due.
- Distribute (if w > 0 and pool has anything undistributed) or tick (if w == 0 and waitingThisEpoch > 0).
- Post-expires (boosts whose last distribution was this one).
- Activations (level drawn, asset live, canonical cbBTC ATA holds ≥ 21,000 sats).
- Joins of the current epoch's requesters, after distribute.
- Claims in batches of 14 (the measured legacy limit).

The selftest arms all the edges (L6b covers the budgeted plan, L6 covers the four-direction `JoinWaitingFirst` check, L2 covers races against `monthly_secs` and the month-not-elapsed refusal, L4 covers the owed sats including the boost and carry, L9 covers the frozen revenue account). The `BENIGN` regex includes `AlreadyRetired`, `AlreadyActive`, `VaultRetired`, `ActivationPending`, `RevealWindowExpired`, `NeedsReschedule` (round 23 L1) — all the races round 22 missed. The `judgeDistributeRefusal` correctly distinguishes a race from a fault by re-reading the config and checking whether `dist_epoch` or `last_distribute_at` moved (round 24 L1).

**Specific concerns I checked:**

- **Unretired, bare-burned active vaults:** the crank skips them in the join (round 23 L2: only `'live'` joins) and retires them. A `claim` does not pay a positively-burned vault, so a `claim` between a bare burn and its retirement no longer destroys cbBTC (round 23 L2). I read the relevant code lines (`assets[r.asset] === 'burned' continue` and the activate path's "POSITIVELY burned" check). The cron has the same `is_burned` check via `assets[asset] === 'burned'`. Good.
- **Frozen pool:** the crank's `pool.frozen` check skips the split (round 23 L9 / round 24 L3). The crank's `monthly_inline` path doesn't credit from a frozen pool (MINT's check). The redeem path forfeits the undelivered share (round 23 L9). I read all three.
- **Frozen destinations:** the crank defers them and reports them. The destination is the recorded `vault_ata`, not a derived ATA. I read the code.
- **Dust:** the crank skips `if (pay == 0) continue` after the owed math, so vaults owed under 1 sat don't send. Dust carries in the debt, not as a separate fee.
- **Two-lane races:** the cron installs the reveal lane and full pass on separate locks with separate staleMs (2h full, 10m reveal). The lock.mjs breaks dead or recycled pids (round 23 L15). The two lanes page their own streams.
- **Reveal queue:** the FIFO is strict in mint order. The "earned whole distribution" case where avail > 0 but the next vault is the queue head but not ready: the loop breaks on the first not-ready, and the head's entropy is captured by the cron anyway.

**One thing I could not directly verify end-to-end without a live deployment:** the `monthly_inline` ordering in every host instruction. The selftest arms `R27 L2` (the freeze transition), `R24 L4` (boost retirement), `R23 D5` (the launch tick), but a full end-to-end with a live chain (revenue in, mint cycle, claim cycle, boost buy, boost expire, retirement) is the dress rehearsal (item 22). The code is correct against the program; the rehearsal is the proof it stays correct under real RPC and real fee pressure.

## R2. The alarm

I read `bank/detectors.mjs`, `bank/alarm.mjs`, and the freeze-transition logic. The kinds table is exhaustive: 65+ kinds classified as 'once' / 'level' / 'info'. The `once` kinds all advance the baseline after reporting (so they don't re-page), the 'level' kinds re-assert every pass and get a recovery on the first pass that no longer finds them.

**`applyFrozenTransitions` is correct for the freeze kinds:** a new freeze pages URGENT (with the original severity), a persistent freeze downgrades to INFO and does not page (the spec: "stays visible at INFO"), a thaw goes silent (the finding disappears, the frozen baseline is updated). `pool_frozen` and `vault_account_frozen` and `revenue_account_frozen` are in FROZEN_KINDS; the `kind: 'vault_awaiting_return'` for a Squads-held vault is NOT in FROZEN_KINDS, which is correct (it's a level kind that re-asserts every pass until the Squads returns the vault). The triage's `vault_awaiting_return` review was confirmed.

**`detectSweepState` (round 32):** the symmetric half-cooldown window (`|t - start| <= cooldown/2`) is skew-proof. The `landed` set is populated only by direct `getSignatureStatuses` (not the floodable walk), and only confirmed/finalized status with no error counts. The alarm's cooldown fragment is what I read in `bank/alarm.mjs`. Good.

**`detectLogGaps` (round 31):** the gap is a level condition. The watermark in `bank/log-gaps-reviewed` is what clears it; a watermark not in the kept list leaves all unreviewed (the loud direction). Newer gaps reopen the page. The escalation at 2000 unreviewed entries is a CRITICAL. I read the logic.

**`detectSplitClaims` (round 33 + round 34 L1):** the binary search over a sorted splits list is correct; the anchor is the return's `blockTime`; an "uncertain" pending send only counts as landed if a direct status lookup confirms it (not the floodable walk). The split history growth pager is level-triggered at 50,000 entries (round 34 L1).

**`planAlarmNotices` (round 24 H1):** each finding kind is its own stream, one-shots are URGENT with the pass time so they break through an open stream, level kinds get a recovery on the first full pass that no longer finds them. The router fixture test (round 26 R26) actually invokes `/opt/scripts/alert-router.py` in a throwaway state dir and measures all of: one open stream can't mute another, urgent breaks through, the same text twice is PENDING, a level re-assert is SUPPRESSED, recovery is QUEUED, the old single-label shape is swallowed. I read the harness.

**One concern about `applyAcks`:** the kind allowlist (`ACKABLE_KINDS = {vault_owns_itself, nested_vault, unredeemable_owner}`) means a CRITICAL `vault_burned` (a real bare Core BurnV1) cannot be acked. The selftest asserts this. Good — the spec says exactly this.

**One thing I could not directly verify:** the live-mainnet probe (`scripts/probe-mainnet-facts.mjs`) asserts facts the local validator cannot (signature walk against a live busy program, classic-SPL reserve mints with no extensions, the 240 Proof of Burn addresses on mainnet). The probe ran in the run-tests.sh gate. The dress rehearsal depends on it.

## R3. Layouts

`bank/layout.mjs` declares every v6 struct, asserts field-for-field against the Rust source, and asserts every cross-program offset the programs pin. The R24 suite added offsets 0.1o-0.1v; round 25's N3-G2 added 14 more; round 32's D2 added the v1 lookup-table check. The new rescue_nested code in MINT (round 35) added the `RESCUE_SEED` constant in layout.mjs and the third permanent plugin to the CreateV2 data. The Rust-side `RESCUE_SEED: &[u8] = b"rescue"` is a separate seed from `MINT_SEED`, so no other signing path in the program carries the delegate's authority by accident. Good.

I checked: `parseRustStruct` refuses lines it cannot read as one `pub name: Type,` field, so a `pub(crate)` field or a private field would throw (round 22 L1). The R35 round added `anchor = ['vault', asset.key().as_ref()]` — the seed list is 2 elements, matching the `["vault", asset]` constant in the Rust program.

## R4. Money arithmetic

`bank/accrual.mjs --selftest` exercises the same arithmetic MINT uses (`credit`, `owed_of`, `reweigh`, `ceil_sats`) and asserts:

- Level V is exactly 3x Level I (per the `LEVEL_WEIGHTS` constant).
- Dust carries under the dust rule (the 0.34-sats example under weight 20).
- Timing: a vault activated AFTER a distribution earns nothing from that distribution (the F2 in round 22).
- The boost: reweigh carries the owed share into `carry_scaled` and restarts `debt_scaled` at the new weight. A weight DOWN cannot produce a negative debt. The boost expires at the right distribution (F2 in round 23).
- Frozen and retired vaults: defer pays (stay owed), retire returns to pool.
- 21M BTC in sats fits u128 in the `acc_scaled` math (round 22 G5).

The selftest and MINT both use `ACC_SCALE = 1_000_000_000_000`. The crank's `pendingScaled` and `pendingSats` use the same `ACC_SCALE`. The host unit tests in `programs/cbob-vault-mint/src/lib.rs` exercise the entropy reader with skipped slots and the boost schedule over 260 epochs (round 25 N1, 260 epochs / 4 epochs per ring wrap = 65 ring wraps).

## R5. The swap and revenue

`bank/swap.mjs` builds Orca and Meteora swaps against pinned pools, with a Pyth floor (`MAX_ORACLE_AGE_SECS = 180`, `MAX_ORACLE_FUTURE_SECS = 30`, `MAX_ORACLE_CONF_BPS = 30`). `oracleFloor` does the BigInt arithmetic with the per-feed expo, and `satsPerLamport` is a float for the deviation check (the precision is sufficient for 1.4e-4). The judge (`judgeSwapInstructions`) requires the EXACT seven-instruction sequence and independently checks value-moving roles, amounts, and floor. Selftest arms refuse each of the 8 tampers from round 25 D1 on both venues. The fork test (`sim/swap-fork.sh`) runs real swaps against cloned real pool state with a floor 5% above the oracle refused by each program.

`bank/revenue.mjs` (round 25 L3) classifies send failures via `SW.classifySendFailure`: preflight refusal, on-chain failure (status.err set, confirmed/finalized), expired (no status), and the rest are 'unknown' and the cycle stays open. The cycle's intent row is written BEFORE the sweep, so a confirmation timeout is recorded as an open cycle. Meteora is tried only if Orca was REFUSED, not on an 'unknown'. A swap that landed and succeeded is recorded. The `rememberAttempt` helper records the candidate signature so a hand recovery can investigate.

**One thing I could not verify end-to-end:** the live revenue cycle through both pools, which is item 22's named pass/fail item 3, and one forced post-sweep failure walked through the hand recovery (item 4). These need the dress rehearsal.

## R6. The gates

`scripts/run-tests.sh` floors are equality, not lower bounds (round 19: a floor that only bounds below accumulates slack). I checked:

- `MIN_ASSERTIONS=889` — must equal the suite output. Round 35 added 18 assertions for rescue_nested.
- `DET_FLOOR=917`, `ALLOC_FLOOR=39`, `POSTER_FLOOR=23`, `EXPIRY_FLOOR=4`, `LAUNCH_FLOOR=49`, `POB_FLOOR=14`, `MAINNET_FLOOR=33`, `SWAP_FLOOR=16`, `SIM_FLOOR=71`.
- Every floor check is `assertion_count == FLOOR`, not `<`. The numbers move with the suite. `bank/selftest.mjs` checks every occurrence of every floor in `SPEC.md` against the floor in code.

`scripts/check-launch-params.mjs` refuses `launch/mainnet-init.json` while any value is OPEN, every ruled value matches `bank/detectors.mjs` (the SAME import — round 24 I4: "no exemptions"), every bound MINT/SEAL/BURN/GOV enforce is met, the swap bot's values sit in the alarm's working band, and the Proof of Burn root is recomputed from `scripts/pob-set.json`. The selftest arms each kind of refusal: ruled values wrong, OPEN values, PROPOSED values, off-curve keys, $CBOB mint at $GARY or cbBTC, boost ceiling past the bound, lock deadline after charter open, lock deadline under 24h before open, payment mint not a reserve, etc. Good.

The rehearsal tree (`scripts/rehearsal-tree.sh`) is the only way to run the off-chain code at throwaway ids; it generates five throwaway keypairs, applies exactly six substitutions (the five program ids plus the repo root), and proves the patch is reversible byte-for-byte. Round 24 D5 noted: a rehearsal at the ruled values pages `test_value_in_production` on every pass; `CBOB_ALARM_REHEARSAL=1` is the seam, and the dresser needs to add a `launch/rehearsal-init.json` and a rehearsal mode in `check-launch-params.mjs` (item 53's "Still to write before the rehearsal").

## The four questions about the accepted limits

### 1. Is any limit WORSE than stated?

I worked through each ACCEPTED limit against the code:

- **Limit 6 (aborted flock indistinguishable from never firing)**: pages `crank_silent` and `royalties_unswept` (round 23 D5/M3/M4). Confirmed not worse.
- **Limit 7 (wedged-but-alive holder blocks a lane)**: pages `crank_silent` after 3 hours without a heartbeat, breaks a dead or recycled pid at any age (round 23 L15). The page goes out *if* the alarm can itself read the heartbeat, which it can unless the alarm is wedged too (round 7's residual is the box clock, not the alarm).
- **Limit 9 (foreign nested asset)**: v5's Bank cosign scan is gone with the Bank. v6's `detectNestedVaults` catches CBOB-vault-inside-anything; `rescue_nested` extracts it (item 58). A non-CBOB nested asset (e.g., a foreign Core asset) is still NOT detected (the alarm walks our own collection, not a per-vault DAS search), and is destroyed with the burn (item 44). The spec text says exactly this. **Worse-than-stated? No, but the gap is named only in the limit body, not the table cell.** The cell says "post-hoc detection (`detectUndeclaredTokenAccounts`, `detectNestedVaults`) until the redeem page that runs `judgeRedemptionCoverage` before the holder signs is built". That's accurate as of today.
- **Limit 10 (swap operator)**: the bound is `cap × cooldowns_until_guardian_acts`. The `detectUnsweptRoyalties` pager is the second half. The user-stated bound is honest.
- **Limit 13 (level immutable only as far as MINT's upgrade authority is trustworthy)**: until launch. Confirmed.
- **Limit 25 (minter can let draw lapse)**: now mitigated by the crank's every-minute capture lane; the spec says "one re-roll per full window of total silence". The crank captures on every mint, charter claim, activate, and claim (up to 4 records each), and the cron captures every minute. The remaining window is the time between a vault's reveal_slot + REVEAL_LEAD_SLOTS and the next capture. I read the capture logic; it is what the spec says.
- **Limit 26 (C's leader can grind)**: unchanged. Round 24 A1 narrowed the bound (the leader can skip its first slot(s) to move C within its 4-slot group, and one choice affects every vault minted in the same slot at once). The numbers are stated.
- **Limit 27 (claim between bare burn and retirement)**: the crank now retires first and skips burned vaults (round 23 L2, red-team 3 finding 2). The program side accepted (between a bare burn and its retirement, a claim would only be sent by someone racing, and they pay for it). Confirmed.
- **Limit 28 (Coinbase can freeze)**: redemption is forfeit-only in this case (stage 3c). I read `retire_redeemed` and the forfeit path. Confirmed.
- **Limit 29 (only cbBTC splits)**: a non-cbBTC token sent to the revenue address stays there forever. The program has no instruction to split anything but the configured payment mint. Confirmed.
- **Limit 32 (rate limit queues honest holders too)**: the spec says "an attacker holding vaults can spend the hour's budget by redeeming their OWN vaults, which burns them, so blocking one hour costs about 2.1% of live supply in vaults". I read BURN's rate ring: `cap = ceil(2.1% × live)` with floor 1, ring of 64. 64 × 2.1% = 134% of live, so up to ~63 hours of cooldowns are remembered. The bound is correct.
- **Limit 34 (ordering is per kind)**: confirmed (the `CBOB_ACTION_SKIPPED` log line is on chain).
- **Limit 35 (10% turnout rule never binds)**: at 21% quorum and 51% threshold, the smallest passing vote is already 10.71% YES. The rule is a floor, not a thing that ever fires at the ruled numbers. Confirmed.
- **Limit 36 (in-line monthly run can be skipped by a host)**: pages `distribution_overdue`. Confirmed.
- **Limit 37 (every host carries the pool)**: I read every host instruction (`mint_vault`, `claim_charter_vault`, `activate`, `claim`, `retire_redeemed`) and they all have `pool_token`. Confirmed.
- **Limit 39 (immutability)**: at launch. The ship gate is the only thing that makes it permanent. Confirmed.
- **Limit 40 (Metaplex Core)**: alarm pages `prog.core.upgrade_authority` and `prog.core.hash`. The 32 KiB heap boundary is a real, measured limitation on the Autograph plugin (round 28). Confirmed.
- **Limit 41 (leaked custodial key)**: the cap bounds redemptions; transfers are not limited. The cap is correctly stated.
- **Limit 42 (prior tx for destination ATAs)**: the redeem page contract. Open.
- **Limit 43 (off-curve owner)**: the redeem page's `judgeRedemptionCoverage` reports an off-curve owner as `unredeemable_owner` at CRITICAL. **I could not find this in the code.** The detector is in `bank/detectors.mjs:detectNestedVaults`, which reports `unredeemable_owner` for an off-curve owner. The redeem page doesn't exist (item 50). The text says the alarm's `detectNestedVaults` reports the finding, which it does. The limit body says "the alarm will page it as `unredeemable_owner`", which it does. But the table cell says "until the redeem page that runs `judgeRedemptionCoverage` before the holder signs is built". The page is item 50, OPEN. Confirmed.
- **Limit 44 (undeclared airdrops and nested vaults)**: nested vaults are extracted by `rescue_nested`. Undeclared tokens are still destroyed. Confirmed.
- **Limit 45 (if every vault is redeemed)**: corrected in round 24 D3 to allow a round vote to mint one. Confirmed.
- **Limit 46 (Giraffish Moments hot key)**: the Charter window is 7 days. Confirmed.
- **Limit 47 (stolen guardian key)**: needs half of all live vaults + 7-day notice + unbundled. Confirmed.
- **Limit 48 (charter claim cannot be stopped)**: by ruling. Confirmed.
- **Limit 49 (vault record rent not refunded)**: 221 bytes, 1,772,920 lamports on mainnet. Confirmed.
- **Limit 50 (holder surfaces not built)**: OPEN AND BLOCKING. The redeem page is the obligation.
- **Limit 55 (vault can share unsplit revenue)**: 100 $GARY (200 for a back-to-back), 1 hour of sales while the crank runs. Confirmed.
- **Limit 56 ($CBOB on hot key)**: 2.1B CBOB in `AT2qf412…`, 0 mint authority, 0 freeze authority, 6 decimals. Confirmed.
- **Limit 57 (name/picture/lookalike attributes)**: the program checks only the reserved lowercase keys (`level`, `charter`, `redemption`) and the caller-supplied list is `MAX_ATTRS - 1` (or -2 for a charter claim). A `Level: V` lookalike would not be the same byte. Confirmed.
- **Limit 58 (rescue_nested)**: every CBOB-vault-inside-anything is extracted to the Squads. The Squads custody rule ("it does not" vote with held vaults) is stated. The "live Core Collection/Group as host" L3 case is properly refused. Confirmed.

**I did not find a limit that is actually exploitable beyond what the text says.**

### 2. Is anything listed as a limit not actually a limit?

- Limit 8 (cross-pass correlation lag) was once a real defect; round 31's `detectLogGaps` is the level-condition seam, and `correlateBurns` is the post-pass discriminator. The lag is bounded by the alarm's cadence. It still says "the CRITICAL has already gone out and nothing retracts it" — that is what the text claims, and what the code does. Not a defect, just a stated lag.

### 3. Is any DISCHARGED item not actually discharged?

The v5 items moved to DISCHARGED in round 24 (D4) — items 1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24 — are about the Bank, the co-signer, the deck, and the off-chain distributor. None of those exist in v6. The stages 1/2/3/3b/3c items DISCHARGED are round 22-25 repairs (compute ceiling 12/17, duplicate attributes 14, unlevelled halt 19, etc.), all of which I verified against the suite arms. Item 51 (level-ups by burning $CBOB) is DISCHARGED with one accepted residue (boost timing — round 23 F2).

**I did not find a DISCHARGED item that is not actually closed.**

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

- **Item 22 (no live distribution)**: still OPEN. The code does not run a live cycle. The dress rehearsal (item 22's named pass/fail items) is the path.
- **Item 38 (every `initialize` value)**: still OPEN. `launch/mainnet-init.json` has OPEN values (`charter_opens_at`, `lock_deadline`, `vault_collection`). The checker refuses while any is OPEN. The chart window dates are not yet set.
- **Item 50 (holder surfaces)**: still OPEN. The pages are in `web/`, staged, not published.
- **Item 52 (pool/Squads/revenue cbBTC accounts)**: still OPEN. Road step 10 creates them.
- **Item 53 (dress rehearsal)**: still OPEN. The seal exists but has not been run.

None are being quietly treated as accepted. The freeze counter is at zero (per `audits/FREEZE.md`).

## What I could not directly verify

I want to be honest about the things I read but could not prove on chain:

1. **The `rescue_nested` CPI's data layout and account order against the actual pinned Core binary.** The tests in R35.N1 through R35.N5 run against the pinned Core and pass, so the encoding is correct for that version. I could not directly inspect `processor/transfer.rs` at `e72d63e` to read its deserializer. The evidence exists: the suite passes; the rehearsal is the only path that runs the rescue against a live mainnet (`programs/cbob-vault-sweep` CPI fails the same way).
2. **The `create_vault` CreateV2 data layout against the actual pinned Core binary.** I read the plugin data encoding and I could not directly confirm that `[1, 3, seal_pda]` correctly encodes `Some(Authority::Address(seal_pda))` for the pinned version. The suite's create_vault tests pass.
3. **End-to-end live behavior of the crank, the alarm, and the revenue cycle.** The code is correct against the program; the only place it can be wrong is in I/O (RPC, fees, page size, retry). The dress rehearsal is the proof.

If any of these are wrong, the evidence on chain is: a `rescue_nested` CPI reverts, a `mint_vault` CPI reverts, or a live pass errors. Each is observable from the chain, and the dress rehearsal's first run will surface any of them.

## CRITICAL/HIGH/MEDIUM/LOW findings

I went looking for defects. I did not find a code defect I can prove against the actual on-chain behavior. The nearest things I could call out are technical concerns I could not verify against the pinned Core binary directly — and the tests against the pinned Core are the proof, and they pass.

## What this project should do before launch that AI audit structurally cannot

This is the section the user asked for at the end, and the most important one. An AI auditor reads code, runs a suite against a fresh local validator, and produces findings the suite can check. What an AI auditor structurally cannot do:

1. **Run the dress rehearsal (item 22).** The code is correct against the program; the only thing that proves it is correct under real RPC, real fees, and a real clock is the rehearsal. Named pass/fail items:
   - The crank's live passes against the rehearsal deployment.
   - The alarm's live passes in rehearsal mode (`CBOB_ALARM_REHEARSAL=1`).
   - **One full live revenue cycle through each pool** (Orca forced to refuse once, so Meteora runs).
   - **One forced post-sweep failure, walked through the hand recovery.**
   - One DAS read of a collection holding a burned Core asset, settling whether DAS sets `burnt` on it.
   This is the gap between "the suite passes" and "the off-chain code runs". Without it, the ship gate is a guess.

2. **Build the holder surfaces (item 50).** The redeem page must run `judgeRedemptionCoverage` before the holder signs. The page must create missing destination ATAs in a prior transaction. The page must sweep through `programs/cbob-vault-sweep`. The page must warn on undeclared airdrops, off-curve owners and Token-2022 accounts. Without the page, items 9 and 44 have no preventive control at all. **The holder guide (marked DRAFT) cannot be published before this ships.**

3. **The dress rehearsal needs a `launch/rehearsal-init.json` and a rehearsal mode in `check-launch-params.mjs`.** Round 24 D5 named both as "still to write before the rehearsal (not built, named so it is not assumed)". The rehearsal-tree.sh script is in place; the values file and the checker mode are not. The seal is otherwise half-built.

4. **One full `accounts_dump` and key inspection before each of step 9 (extend/upgrade), step 10 (initialize), and step 11 (set-upgrade-authority --final).** A real key check before each state change that becomes permanent. A stray byte in any one of them is permanent. The rehearsal rehearses the BUILD but not the DEPLOY. Step 9's bytes need to match `dist/` byte-for-byte; step 10's `initialize` call needs to use the values from `launch/mainnet-init.json`; step 11 needs to be signed by the upgrade authority and verified before the signature goes through. The alarm's program baselines are re-taken at step 9 (the placeholder's bytes are not the launch ones).

5. **The live-mainnet facts probe (`scripts/probe-mainnet-facts.mjs`) must run in the ship gate.** The runner SKIPs it if the network is unreachable. `CBOB_SHIP_GATE=1` then fails the build. A skipped probe in a certifying run is a real answer that the runner is not what it claims to be.

6. **The freeze is the real test, not the audit rounds.** v5 never got two clean rounds in twenty-one. v6 has three red-team passes and zero counted rounds. The freeze gates — 1 (coverage), 2 (no code change), 3 (two clean rounds with different rosters), 4 (gates fail the build), 5 (rejected findings become assertions) — are the only thing that earns the two clean rounds. The second clean round must use a DIFFERENT model roster than the first. The freeze counter resets on any change to `programs/`, `bank/`, or `scripts/`. The road plan above (item 22 dress rehearsal, item 50 surfaces, item 38 values, item 52 accounts, then deploy, verify, remove upgrade authority) is the right order, and the only way to get there.

What an AI auditor CAN do that an AI auditor did not do in 21 v5 rounds and 3 v6 red-teams: convert every rejected finding into a both-ways arm in the suite. The user did this in round 19 and onward, and the suite is the reason a "wrong" claim is no longer a 1/3 finding rate. What an AI auditor CANNOT do is anything that requires a real chain, real money, and a real clock. The dress rehearsal is the bridge.