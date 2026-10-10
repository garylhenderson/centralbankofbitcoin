

# Round 47 independent audit report

## Method and measurement limits

This pass was a source read only. I did not run `scripts/run-tests.sh`, the simulation, the e2e, the mainnet probe, the rehearsal driver, or any validator. Where I say a repair "is present", that means the construct exists in the bundled source and has the intended shape; it is not an execution result. Where a claim would require execution, I state the evidence that would have to exist.

I did not audit, and do not infer the contents of, the ten files named by the prompt as not carried. Several important properties therefore remain unverified in this pass, including:

- `scripts/check-launch-params.mjs`: the mainnet `judgeLaunch` and rehearsal judge used by the ceremony page.
- `bank/layout.mjs`: the off-chain account decoder used by pages, tests, metadata generator.
- `bank/detectors.mjs`: `judgeRedemptionCoverage`, `classifyPdaTokenAccount`, alarm detectors.
- `bank/crank.mjs`, `bank/swap.mjs`, `bank/spl.mjs`, `bank/lock.mjs`.
- `web/test/ref.mjs`: the harness used by several web offline tests.
- `web/src/generated/errors.json`, `web/src/generated/pob-set.json`.

Findings that would turn on those files are explicitly conditional or omitted.

I also cannot independently recount round 46's quorum from this bundle: only the round 46 verdict and validation are present, not the eight seat reports. The verdict says 6 of 8 counted, no margin. That is a record, not independently verified evidence.

---

# R0. Round 46 verdict, repairs, and post-round-46 code

## Repair verification, source read only

| Round 46 item | Present in this tree? | Notes |
|---|---:|---|
| V46-1 multi-send rehearsal steps resumable; collection done reads chain | Yes, in source | `scripts/rehearsal-run.mjs` `nextAction` plus `scripts/rehearsal-steps.mjs` `SINGLE_SEND_STEPS`; `ceremony-collection` done uses `findCollection` and `readStep`, not just local state. |
| V46-2 values re-filled and re-judged before road step 10 | Yes, in source | `ceremony-values` is a `recheck` step; `judgeValuesFresh` re-fills charter date and init key while MINT is uninitialized. |
| V46-3 rescue records nest found at nest PDA or treasury | Yes, in source | `rescue` step sets `nestedSent` when vault-3 is already at the nest PDA or treasury. |
| V46-4 hand recovery completes after landed swap; hand-closed cycle reads done | Yes, in source | `scripts/rehearsal-recover.mjs` handles `landedSwap` and `handClosed`. |
| V46-5 mainnet and mainnet-local refuse overrides | Yes, in source | `web/src/config.js` `takesOverrides` keys on `launchJudge === 'mainnet'`; `web/build.mjs` refuses overrides for those profiles; `ceremony-local.mjs` refuses extra origins for mainnet-local. |
| V46-6 refused launch values end preflight as NOT READY | Yes, in source | `web/src/pages/ceremony.mjs` `preflight` returns null after value failures, before mint reads. |
| V46-7 SPEC 53 records e7c192a re-proof | Present in bundled SPEC text | The SPEC excerpt in this prompt records the re-proof and what remains open. |
| V46-8 mainnet rehearsal init key and page mode | Yes, in source | `initKeyFor`, `judgeInitAccount`, `judgeCeremonyMode`, page-mode waits, helper stand-in for local proof. |
| V46o-1 asset-less ack arm | Not verifiable here | Depends on detector/selftest files not carried. |
| V46o-2 undelivered alarm pass rollback | Not verifiable here | Depends on alarm/detector files not carried. |
| V46o-3 load-time refusal pages through production notifier | Present in carried file | `bank/rehearsal-env.mjs` `refuseStrayOverridesAtLoad` uses literal `PRODUCTION_NOTIFIER`. |
| V46o-4 placeholder tracked fixture | Partially present | Source, manifest, Cargo.toml, README, SHA256SUMS are present; the binary and Cargo.lock are not in this textual pass, so the pinned hash cannot be recomputed here. |
| V46o-5 instrument computes bundle | Not verifiable here | The audit instrument itself is not carried. |

## R0 findings

### R0-1 LOW: Ceremony page does not bound a wallet-added compute-unit limit

Construct:
- `web/src/pages/ceremony.mjs`, step dry-run and sign path: uses `buildTx` and `simulate`, then `signExact(wallet, tx, extra)` with no `{ minUnits }`.
- `web/src/lib/tx.mjs`, `judgeWalletEdits`: a wallet-added compute-unit limit is only rejected when it is below `opts.minUnits`. If `opts.minUnits` is absent, there is no lower bound.

What an accident gains:
- If Phantom or another wallet inserts a compute-budget limit that is too low for a ceremony instruction, the page will accept the edited transaction and send it. The cluster then fails the transaction for compute exhaustion. No value moves and no immutable state is written, but road step 10 can fail in a confusing way at the worst moment.

Why this is not the same as the holder pages:
- Holder pages use `buildForWallet`, which measures simulation CU and passes `minUnits` to `signExact`.
- The ceremony page does not.

Evidence that would exist if this is true:
- Take any ceremony step, for example MINT initialize, simulate it to get `unitsConsumed`, then wrap it as `[ComputeBudget setComputeUnitLimit(1), page instructions]` and call `signExact` without `minUnits`. `judgeWalletEdits` should return no error, and the wrapped transaction should fail on-chain or in simulation with compute exceeded.
- An offline test arm that expects a low wallet limit to be refused for ceremony steps would currently fail.

Fix:
- Use `buildForWallet` for ceremony steps, or pass `{ minUnits: pageUnits(sim.unitsConsumed) }` to `signExact`.
- Add a web test arm: a ceremony transaction with a wallet-added limit below measured CU is refused before send.

### R0-2 LOW: Rehearsal ceremony preflight can display bytes as checked when no byte table is configured

Construct:
- `web/src/pages/ceremony.mjs`, `preflight`, program byte check:
  - `const unchecked = !P.programBytes?.[k]`
  - For non-mainnet profiles, an unchecked program still produces an OK line: `line(unchecked || bytes.length === 0, ...)`.

What an accident gains:
- A rehearsal or local ceremony page built without `--rehearsal-bytes` will show "the deployed bytes are the audited build" even though no hash was checked. An operator could sign road step 10 against unrehearsed or wrong throwaway programs.
- Mainnet is protected because mainnet fails when `programBytes` is missing. Rehearsal is not.

Evidence:
- Build the rehearsal profile without `--rehearsal-bytes`, serve it, and inspect the preflight. The byte lines will pass with no configured hash.
- A test arm that builds rehearsal without bytes and expects the preflight to say "not checked" or to refuse would fail.

Fix:
- For the rehearsal profile in page mode, require `programBytes` and fail preflight if absent.
- If a non-page local profile is allowed to skip byte checks, label the line "bytes NOT checked" rather than OK.

### R0-3 LOW: `rehearsal-refresh.mjs` says it snapshots ignored paths, but the git command does not ask for ignored files

Construct:
- `scripts/rehearsal-refresh.mjs`, `untracked()`:
  - `git ls-files --others -z`
- The file comment says it snapshots "EVERY untracked and ignored path" outside build caches.

What an accident gains:
- If a kept path is git-ignored, for example a key file under `bank/keys/` or another ignored state file, it may not appear in the preservation snapshot. The refresh may still not delete it, but the byte-for-byte preservation proof does not cover it.
- If a future commit tracks that path, or if a cleanup step is added later, loss could go undetected.

Evidence:
- In a rehearsal tree, create an ignored file under `.rehearsal-keys/` or `bank/keys/`, add a matching `.gitignore` rule, then run refresh with logging of the snapshot keys. The ignored file will not be listed by `git ls-files --others` without `--ignored`.
- Compare with `git ls-files --others --ignored --exclude-standard`.

Fix:
- Use `git ls-files --others --ignored --exclude-standard -z`, then rely on the existing `keepPath` filters.
- Or remove the claim that ignored paths are snapshotted and prove that no kept path is ever ignored.

### R0-4 LOW: `CBOB_ALARM_REHEARSAL` is not among the rehearsal-only overrides refused outside a rehearsal tree

Construct:
- `bank/rehearsal-env.mjs`:
  - `REHEARSAL_OVERRIDES = ['CBOB_REHEARSAL_RPC', 'CBOB_REHEARSAL_NOTIFY', 'CBOB_REHEARSAL_FAIL_AFTER_SWEEP', 'CBOB_REHEARSAL_FORCE_ORCA_REFUSAL']`
- SPEC item 53 says the alarm's rehearsal mode is controlled by `CBOB_ALARM_REHEARSAL=1`, and that any other value, or none, is production.

What an accident gains:
- If `bank/alarm.mjs` honors `CBOB_ALARM_REHEARSAL` without independently requiring a rehearsal tree, a stray environment variable on the production box could disable production-value checks, including `test_value_in_production` and lock-deadline checks.
- I cannot confirm the alarm's behavior because `bank/alarm.mjs` is not carried. The gap is that the carried override guard does not cover this variable.

Evidence that would exist if the alarm side is vulnerable:
- On a non-rehearsal tree, run `CBOB_ALARM_REHEARSAL=1 node bank/alarm.mjs`. If the report says REHEARSAL and suppresses production-value findings, the gap is real.
- In this pass, `refuseStrayOverridesAtLoad({ env: { CBOB_ALARM_REHEARSAL: '1' }, inTree: false })` does not throw for that variable.

Fix:
- Add `CBOB_ALARM_REHEARSAL` to `REHEARSAL_OVERRIDES`.
- Better: make the alarm require both the exact value and the presence of `REHEARSAL-RECORD.txt` before entering rehearsal mode.
- Add selftest arms: set variable outside rehearsal tree, expect refusal; set inside tree, expect rehearsal mode.

### R0-5 INFO: Rehearsal item 22.2 is recorded FAIL and is not closed by this bundle

Construct:
- `audits/rehearsal-2026-10-09/RECORD.md`: item 22.2 verdict is FAIL.
- SPEC item 22 requires the alarm's live passes in rehearsal mode as named pass/fail items.

What this means:
- The FAIL was caused by a true detection: Metaplex Core changed between alarm passes. That is the alarm working.
- But item 22.2, as written, asks for live alarm passes. A FAIL verdict means the item has not been satisfied unless the owner explicitly rules that this FAIL is the required evidence, or a post-repin clean rehearsal alarm pass is run.

Evidence:
- The record itself says: "What it does not prove: a pass 2 with nothing to report, which no live pass after this Core change could have produced without re-baselining."
- A closing artifact would be either a new rehearsal alarm pass after the Core re-pin with no unexplained CRITICAL, or a dated ruling accepting the FAIL as sufficient.

Fix:
- Run one rehearsal alarm pass after the Core re-pin and record it, or record an explicit owner ruling that the mid-rehearsal Core-drift FAIL satisfies item 22.2.
- Update SPEC item 22 and the rehearsal record accordingly.

### R0-6 INFO: Rehearsal driver leaves a provider-URL CLI config on disk after SIGKILL and `--max-sol` can be masked by external top-ups

Construct:
- `scripts/rehearsal-run.mjs`:
  - writes `.rehearsal-run/solana-cli.yml` containing `json_rpc_url`
  - removes it on `process.on('exit')`
  - `capAllows` computes spend as `startLamports - nowLamports`

What an accident gains:
- If the driver is killed with SIGKILL, the CLI config containing the provider URL may remain in `.rehearsal-run/`. It is mode 600, but it is a secret on disk longer than intended.
- If someone externally tops up the funding wallet during a run, drawdown-based `--max-sol` can understate total spend.

Evidence:
- `kill -9` the driver mid-run and inspect `.rehearsal-run/solana-cli.yml`.
- Start with 1 SOL, spend 0.5, add 2 externally, observe `capAllows` sees drawdown negative or reduced.

Fix:
- Create the CLI config in a `mktemp -d` directory and remove the directory in traps that cover termination where possible.
- Track cumulative recorded step costs for the cap, or require no external top-up during a run and detect balance increases.

---

# R1. Custody: sealed vaults, open/burn pairing, emptiness proof

I did not identify a surviving program defect in this target from the bundled source.

Relevant properties I checked by reading the programs:

- SEAL `open_for_redemption` only thaws if a later top-level BURN `burn_vault` for the same asset and same owner exists in the same transaction.
- BURN `burn_vault` only runs if an earlier top-level SEAL open for the same asset and owner exists.
- Both walks use the instructions sysvar and bind account indexes 0 and 2.
- A failed burn reverts the thaw because the transaction is atomic.
- BURN requires `asset_signer.lamports() == 0` before Core burn.
- BURN requires every reserve mint's ATA under both token programs to be declared.
- Declared reserve token accounts must be PDA-owned, undelegated, without close authority, extension-free, and zero-balance.
- Declared live Core assets are refused.
- The reserve list is read from SEAL config, not duplicated in BURN.

The known completeness gap remains: BURN can only inspect declared accounts. Undeclared token accounts and nested assets are destroyed unless the page handles or warns about them. That is already carried as accepted limits 9 and 44, and rescue for nested CBOB vaults is item 58. I did not find a way to widen that gap from the five programs.

## R1s. Sweep helper

I did not identify a surviving defect in `programs/cbob-vault-sweep/src/lib.rs` from source read.

Answers to the specific prompts:

- Direct call requires `signer.is_signer`. The vault asset-signer PDA cannot sign except through Core `ExecuteV1`.
- Through Core, current pinned Core approves Execute only for the asset owner. The suite pins refusals for stranger and transfer delegate. The collection update authority path is measured on a control asset.
- The helper can only run while the vault is thawed. A frozen vault refuses Core Execute. Thaw only occurs inside a transaction that also contains the matching burn.
- Pair list:
  - Odd pair count refused.
  - Zero pairs allowed; only lamports are swept.
  - Duplicate source: first pair closes it, second pair fails because the account is no longer a Token-program-owned 165-byte account.
  - Duplicate destination is allowed and harmless.
  - Source equal to destination is impossible unless signer equals destination wallet, which is refused.
  - Native wSOL classic account is treated like any other classic token account.
  - Delegate does not stop an owner transfer; close authority held by a stranger makes close fail, reverting the helper. The page handles this as C5 transfer strays.
  - Frozen source makes Token transfer or close fail, reverting the helper.
  - Destination need not be an ATA; it must be a classic token account owned by the destination wallet with the same mint.
  - Destination wallet may be another vault's asset-signer PDA. That is owner choice and does not break BURN, because the source vault's PDA is still emptied.
- Destination wallet is not compared to asset owner. Given Core Execute authority is owner-only, this is safe. A malicious client can only move the signing owner's vault contents where the owner signed.
- Lamport sweep reads `signer.lamports()` at execution and transfers all. A later instruction in the same transaction could re-fund the PDA, but then BURN's `lamports == 0` fails and the whole transaction reverts.
- Closed reserve accounts pass BURN because BURN skips declared accounts not owned by a token program. That is the right reason after a successful close.
- If a reserve ATA does not exist when the page builds the transaction, the page creates it in a prior transaction. If a stranger creates it before the redemption lands, the helper still names the address and sweeps the live balance.

### R1s-1 INFO: Page does not give a clear refusal for a frozen zero-balance reserve account

Construct:
- `web/src/lib/plan-redeem.mjs`, reserve account checks: refuses only `state === TOKEN_FROZEN && amount > 0n`.
- `programs/cbob-vault-sweep/src/lib.rs` always closes each named source.
- SPL Token close behavior on a frozen account is not bypassed by zero balance.

What an accident gains:
- If Coinbase freezes a vault's reserve ATA while it has zero balance, the page may not refuse with a clear reason. The helper will try to close the frozen account and the opening will fail in dry run or on chain.
- This does not create theft. It is a clarity gap inside the already accepted limit that a frozen reserve account blocks redemption.

Evidence:
- Freeze a zero-balance reserve ATA in a local test, run `planRedemption`. It should not list a reserve refusal, and the simulated sweep close should fail.
- A page test expecting a named refusal or ack for frozen-zero reserve would fail.

Fix:
- Treat any frozen reserve account as a refusal with the Coinbase-freeze explanation, regardless of balance, or require an explicit ack.

---

# R2. Community pool money

I did not identify an arithmetic or liveness defect in the pool from source read.

Invariant: the pool always holds at least `ceil(owed_scaled / ACC_SCALE)`.

Reasoning checked:

- `distribute` computes `avail = pool_balance - ceil(owed_scaled)` and refuses if `avail == 0` or pool short.
- `credit` adds `delta = floor(avail * ACC_SCALE / total_active_weight)` to `acc_scaled`, and adds `delta * total_active_weight` to `owed_scaled`. Because `delta * weight <= avail * ACC_SCALE`, the ceiling of owed cannot increase by more than `avail` whole sats.
- `claim` pays whole sats only, reduces `owed_scaled` by `pay * ACC_SCALE`, and reduces pool balance by `pay`. The ceiling invariant is preserved.
- `retire_redeemed` without forfeit requires pending `< ACC_SCALE`, then removes pending from owed. Pool balance unchanged, invariant preserved.
- `retire_redeemed` with frozen-pool forfeit removes pending from owed without moving pool balance. Invariant preserved.
- `retire_burned` removes pending from owed without moving pool balance. Invariant preserved.
- `join` sets `debt_scaled = weight * acc_scaled`, `carry_scaled = 0`, so the vault is owed nothing at join.
- `reweigh` moves existing owed into `carry_scaled` and resets debt at the new weight. Total owed unchanged.
- Two-step activation and `JoinWaitingFirst` prevent an activate-plus-distribute transaction from capturing a backlog for a vault that was not joined.

I also checked the counters under the documented orderings:

- `pending_count` increments on request, decrements on join or retire.
- `pending_this_epoch` increments on request, resets on epoch advance, decrements on same-epoch retire.
- `waiting_to_join = pending_count - pending_this_epoch`, checked-subtract.
- `active_count` and `total_active_weight` increment on join, decrement on retire.
- `dist_epoch` advances on every credit or empty tick.

Liveness:

- A due boost blocks distribution until expired, but `expire_boosts` is permissionless and needs only records.
- A waiting vault blocks distribution until joined, but joining is permissionless via `activate` or `claim`.
- A frozen pool blocks claim delivery, but redemption can proceed by forfeit. A frozen vault account can block that vault's redemption, already accepted limit 28.

I did not find a way for a stranger to make distributions or redemptions permanently impossible for others using only the program state.

---

# R2b. CBOB boost

I did not identify a defect in boost accounting from source read.

Properties checked:

- A boost earns exactly N distributions:
  - Bought at epoch `e`, end epoch `e + N`.
  - The distribution that advances epoch to `e + N` makes it due.
  - `BoostsExpireFirst` blocks further distributions until due boosts are expired.
  - If boost and distribution are in one transaction, the boost is active during that distribution and the epoch advance makes it due if N=1.
  - If distribution precedes boost in one transaction, the boost starts in the new epoch and earns the next N distributions.
- Nothing earned is lost or gained on weight change:
  - `reweigh` moves current pending into `carry_scaled` and resets `debt_scaled` to `new_weight * acc_scaled`.
  - `expire_boost` reweighs to zero, preserving pending.
  - `claim` normalizes carry after paying whole sats.
- Counters:
  - `boosts_active`, `boost_weight_total`, `boosts_due`, and `boost_expiring` are updated together in `boost_vault`, `unschedule_boost`, `expire_boost`, and `advance_epoch`.
  - Ring size 64 with max epochs 63 prevents a live boost from colliding with its own next use of the same slot.
  - Due boosts are cleared before epoch advance can continue, so a due boost cannot be double-counted by a later advance.
- Early retirement:
  - `retire` calls `unschedule_boost`, which decrements either the future ring slot or `boosts_due`, depending on whether the boost is due.
- Token account absence:
  - `expire_boosts` does not need the vault's cbBTC account.
  - `claim` can expire a due boost even when the destination is frozen; payment is deferred but boost state is corrected.

The host unit test and expiry-budget test are designed to cover ring wrap and default CU budget. I did not execute them in this pass.

---

# R3. Level draw

I did not identify a program defect in the draw from source read.

Checked:

- `SlotHashes` parse:
  - account key pinned to sysvar id
  - count bounded to 512
  - buffer length checked
  - all-zero hash refused
- Skipped slots:
  - smallest produced slot in `[want, want + 64]`
  - deterministic once produced slots are known
  - if none produced yet, `NotYet`
  - if window passed, `Expired` and reschedule
- FIFO:
  - `reveal_level` requires `mint_index == revealed_total`
  - burned vaults still draw, so the queue does not stop at a burned head
- Attribute re-supply:
  - stored `attrs_hash` is Borsh hash of the mint-time attribute list
  - reveal checks the caller-supplied list against that hash before writing Core attributes
- Influence:
  - minter cannot know A, B, C at mint time
  - last leader residual is accepted limit 26
  - lapse re-roll is accepted limit 25

One mathematical nuance, not filed as a defect: the draw uses `u64 entropy mod total_remaining`. This introduces a tiny modulo bias because `total_remaining` is not a divisor of 2^64. The bias is far below any practical relevance at a census of at most 2,100. The holder guide says "drawn at random", which is fair in the ordinary sense, but if exact uniformity is ever claimed, this would be false by an immeasurably small amount.

---

# R4. Governance

I did not identify a governance bypass in the programs from source read.

Checked:

- Electorate fixed at proposal creation:
  - `index_snapshot = minted_total`
  - `quorum_supply = minted_total - burned_total - bare_burns_retired`
  - vote requires record index below snapshot
- Vote binding:
  - VoteRecord PDA seeded by proposal and asset, so transfer does not allow a second vote
- Quorum, threshold, turnout:
  - quorum uses ceiling of snapshot times quorum bps
  - threshold is YES share of votes cast
  - YES turnout floor is 10% of snapshot
  - key changes require YES from half of snapshot live supply
- Action reach:
  - only SetRound, Brakes, TightenSweep, ArmSwapOperator, SetBoostTerms
  - no split, destinations, max_supply, royalty, reserve list, seal, burn, or vault state
- Ordering and skips:
  - per-kind marks for round, guardian, operator arm, boost terms
  - overtaken actions log `CBOB_ACTION_SKIPPED` and do not revert the bundle
  - restart halves are skipped if the stop is newer
- Guardian:
  - can only stop sales, stop sweep, cancel pending swap operator
  - cannot restart, cannot cancel its own replacement, cannot cancel pending guardian
- Apply:
  - permissionless after notice
  - no apply-by deadline, as SPEC states

A consequence that is worth stating plainly but is not a code defect: if very few charter vaults are claimed, "half of all live vaults" can be a very small absolute number. If only one vault is live, one vault can carry a guardian or operator change. This follows directly from the ruled supermajority definition and is not worse than the wording in SPEC, but it is an extreme case the documents do not spell out.

---

# R5. Charter claim

I did not identify a program defect in `claim_charter_vault` from source read.

Checked:

- Window enforced by clock only.
- PoB identified by address through Merkle root.
- Leaf and node domain separation match `scripts/pob-merkle.mjs`.
- Sorted-pair Merkle verification matches JS implementation.
- PoB asset must be Core AssetV1, owned by signer, in configured PoB collection.
- Program burns the PoB as owner in the same instruction.
- `pob_extra` accounts are passed through to Core burn, never as signers.
- Charter attribute is written by the program, not caller.
- Reserved attribute keys are refused.
- Sales stop does not gate charter claim.

The hot PoB collection update authority remains a ruled and accepted risk, SPEC 46. I did not find an additional on-chain capability for that key inside the claim program itself.

## R5-1 LOW: Claim page frozen-PoB check omits FreezeExecute plugin types

Construct:
- `web/src/lib/plan-get.mjs`, `planClaim`:
  - frozen check only looks at `FreezeDelegate` and `PermanentFreezeDelegate`.

What an accident gains:
- A Proof of Burn carrying a frozen `FreezeExecute` or `PermanentFreezeExecute` plugin, or another parsed plugin with a frozen flag, would be shown as claimable. The Core burn would then fail. No value is taken; the holder wastes a fee and sees a confusing failure.

Evidence:
- Create a control Core asset in the PoB collection shape with `FreezeExecute` frozen. `planClaim` should return ok, while a simulated Core burn should fail for freeze.
- A page test that expects refusal for all frozen plugin variants would fail.

Fix:
- Check every parsed plugin body with `frozen === true` that can block burn, or explicitly enumerate all four freeze plugin types.

---

# R6. One-time configuration and trusted hop

I did not identify a program defect in the initialize handlers beyond the known one-time configuration risk already carried as OPEN item 38.

Observations:

- MINT initialize enforces many bounds, but not all semantic launch requirements:
  - `payment_mint` must be a SEAL reserve, but SEAL only checks reserve account owner is classic SPL Token. It does not prove the account is an initialized mint. The launch checker must pin the real cbBTC.
  - `bank_treasury`, `swap_operator`, `guardian` are only checked non-default. Off-curve or unusable keys can be accepted by the program. The launch checker and ceremony judge must catch them.
  - `charter_opens_at` may be far in the future as long as `charter_closes_at` is later and within 90 days. The launch checker must pin the ruled date.
- BURN initialize enforces window bounds but not the mainnet value 3600.
- GOV initialize enforces quorum/threshold/voting bounds but not the ruled mainnet values.
- SEAL initialize enforces reserve count and classic SPL owner, but not duplicates or mint initialization.

These are not new findings against the programs; they are exactly why item 38 is open and blocking. The ceremony page and launch checker are the only gates for the semantic values. Because `scripts/check-launch-params.mjs` is not carried in this pass, I cannot verify the mainnet judge here.

The swap operator remains the one trusted hop. On-chain bounds are:
- operator signature required
- destination pinned to configured operator
- amount > 0 and <= cap
- cooldown enforced by chain clock
- reserve enforced
- guardian stop and cancel pending operator

The worst case remains the ruled cap times cooldown windows until guardian stop, already accepted limit 10.

The 10% royalty plugin is installed with `PluginAuthority::None`. The programs contain no instruction that updates or removes it. Core behavior around that is accepted limit 40.

The redemption cap is a rolling 64-slot timestamp ring. I checked the head, kth-newest index, initial zeros, cap floor 1, and ring bound. I did not find a loosening path. One minor robustness note: if `Clock.unix_timestamp` ever moves backwards relative to a stored redemption timestamp, `checked_sub` returns overflow and the redemption fails. This is fail-closed and does not release value.

---

# R7. Cross-program raw reads

I recomputed the offsets used by GOV, BURN, MINT, and the sweep helper against the Rust structs. I did not find a mismatch.

MintConfig, after 8-byte discriminator:
- version: 8
- collection: 9
- governance: 41
- pool_ata: 73
- round_id: 105
- opens_at: 109
- closes_at: 117
- price: 125
- cap: 133
- minted_this_round: 137
- minted_total: 141
- max_supply: 149
- bank_treasury: 157
- split_bps: 189
- sales_stopped: 191
- sweep_stopped: 192
- guardian: 193
- swap_operator: 225
- sol_reserve_lamports: 257
- bump: 265
- max_sweep_lamports: 266
- sweep_cooldown_secs: 274
- last_sweep_at: 282
- level_caps: 290
- level_minted: 310
- revealed_total: 330
- payment_mint: 338
- pob_collection: 370
- pob_root: 402
- charter_opens_at: 434
- charter_closes_at: 442
- charter_claimed: 450
- bare_burns_retired: 454
- total_active_weight: 462
- active_count: 470
- acc_scaled: 478
- owed_scaled: 494
- last_distribute_at: 510
- sales_stopped_at: 518
- sweep_stopped_at: 526
- pending_swap_operator: 534
- pending_swap_operator_at: 566
- monthly_secs: 574
- pending_guardian: 582
- pending_guardian_set: 614
- pending_guardian_at: 615
- notice_secs: 623
- sweep_floor_lamports: 631
- cooldown_ceiling_secs: 639
- reserve_ceiling_lamports: 647
- dist_epoch: 655
- pending_count: 663
- pending_this_epoch: 671
- cbob_mint: 679
- max_boost_weight: 711
- max_boost_epochs: 712
- boost_price: 714
- boost_weight: 722
- boost_epochs: 723
- boosts_active: 725
- boosts_due: 729
- boost_weight_total: 733
- cbob_burned_total: 741
- boost_expiring: 749

GOV reads:
- governance at 41
- minted_total at 141
- charter_closes_at at 442
- bare_burns_retired at 454
- sales_stopped at 191, sweep_stopped at 192
- sales_stopped_at at 518, sweep_stopped_at at 526
- sol_reserve at 257, max_sweep at 266, cooldown at 274
- sweep_floor at 631, cooldown_ceiling at 639, reserve_ceiling at 647
- max_boost_weight at 711, max_boost_epochs at 712

BURN reads:
- minted_total at 141
- bare_burns_retired at 454

VaultRecord, after 8-byte discriminator:
- version: 8
- asset: 9
- mint_index: 41
- reveal_slot: 49
- level: 57
- charter: 58
- entropy_set: 59
- entropy: 60
- attrs_hash: 92
- bump: 124
- active: 125
- retired: 126
- reschedules: 127
- vault_ata: 129
- debt_scaled: 161
- pending: 177
- request_epoch: 178
- boost_weight: 186
- boost_end_epoch: 187
- carry_scaled: 195

The web proxy's `mint-boosts` slice offset 125 length 70 matches active through boost_end_epoch. The due-boost reader's slice indexes are consistent with that layout.

BurnConfig:
- version: 8
- collection: 9
- bump: 41
- burned_total: 42
- redeem_window_secs: 50
- rate_head: 58
- rate_ring: 59

SealConfig:
- version: 8
- collection: 9
- reserve_mints Vec length: 41

Sweep helper classic token account offsets:
- mint: 0
- owner: 32
- amount: 64
- length: 165

BURN delegate and close authority checks:
- delegate option: 72..76
- delegated amount: 121..129
- close authority option: 129..133

I found no silent offset mismatch in the carried Rust and web readers.

---

# R8. Suite, simulation, build, and evidence

I did not execute the suite, simulation, or build in this pass. From source read:

- The on-chain suite uses exact assertion floors and reason pins.
- The runner refuses a cached Core that does not match the pinned hash.
- The runner deploys stripped bytes.
- `build-mainnet.sh` proves mainnet artifacts reject the localnet key and localnet artifacts accept it, and proves the sweep helper bytes are identical between mainnet and tested localnet builds.
- The verifiable build workflow compares container build, solana-verify rebuild, and audited hashes.

I did not find an obviously vacuous arm in the carried test code itself, but several web test arms depend on `web/test/ref.mjs`, which is not carried. Their non-vacuity cannot be verified in this pass.

## R8-1 INFO: `judgeWalletEdits` does not cap wallet compute-unit limits above the transaction maximum or reject duplicate compute-budget instructions

Construct:
- `web/src/lib/tx.mjs`, `judgeWalletEdits`.

What an accident gains:
- If a wallet adds a compute-unit limit above 1,400,000, or duplicate limit/price instructions, the judge may accept it. The cluster may reject or apply the instruction in an unexpected way, causing a holder transaction to fail. No value movement.

Evidence:
- Call `judgeWalletEdits` with a wallet-added limit of 10,000,000 and price 0. It currently returns no bad item unless the fee cap is exceeded.
- Add two limit instructions and two price instructions; the loop overwrites values rather than rejecting duplicates.

Fix:
- Reject any wallet-added limit above 1,400,000.
- Reject more than one limit or more than one price instruction.
- Add offline arms for both refusals.

## R8-2 INFO: `pageUnits` falls back to a 20,000 CU budget if simulation returns success without `unitsConsumed`

Construct:
- `web/src/lib/tx.mjs`, `pageUnits` and `buildForWallet`.

What an accident gains:
- If an RPC returns success but omits `unitsConsumed`, the page may add a 20,000 CU limit. Many real transactions need more. The transaction then fails after signing. No value movement.

Evidence:
- Mock `simulate` to return `{ err: null, unitsConsumed: null }`. `buildForWallet` will compute `minUnits = pageUnits(null)`, which is 20,000 plus allowance.
- A test expecting no budget or a conservative budget when units are unknown would fail.

Fix:
- If `unitsConsumed` is null, either omit the page compute budget and rely on default per-instruction budget, or use a conservative measured ceiling. Do not use 0 as the measured base.

## R8-3 INFO: `signaturesSince` cannot distinguish "no new signatures" from an unknown or pruned `until` cursor

Construct:
- `bank/sigwalk.mjs`, `signaturesSince`.
- If `batch.length < limit`, it returns `{ gap: false }`, including the case where the first batch is empty.

What an accident gains:
- If a cursor is foreign, pruned, or otherwise unknown to the address history, the RPC may return an empty page. The helper then reports no gap. A consumer that does not separately prove cursor reachability could silently stop scanning.
- I cannot verify consumer behavior because `bank/alarm.mjs` and the poster are not carried. SPEC describes cursor and backlog controls, but this helper alone does not fail closed on an unresolved `until`.

Evidence:
- Call `signaturesSince` with a valid-format signature that is not in the address history. If it returns empty and `gap: false`, the helper cannot distinguish the cases.
- A test arm expecting `gap: true` or a distinct `cursorUnresolved` for an unknown `until` would fail.

Fix:
- When `until` is supplied and the first page is empty, return a distinct error state or `gap: true`.
- Alternatively, document that callers must always prove the cursor is reachable, and add selftest arms for that proof.

---

# Accepted limits: the four required attacks

## 1. Is any accepted limit worse than stated?

I did not find an accepted limit that is materially worse than stated in the bundled source.

Specific checks:

- Limit 10, swap operator: the on-chain cap, cooldown, reserve, operator signature, guardian stop, and cancel pending operator are present. The residual trusted hop is as stated.
- Limit 25 and 26, draw influence: the code matches the three-hash, stride-two-groups design. The last-leader residual and lapse re-roll are as stated.
- Limit 28, cbBTC freeze: frozen pool forfeit on redemption and frozen destination deferral on claim are present. A frozen reserve account can still block redemption, as stated.
- Limit 32, redemption cap: the rolling ring is stricter past 64 entries, not looser.
- Limit 40, Core upgrade: the programs still depend on Core tombstone, Execute authority, UpdatePluginV1, and BurnV1 behavior. No new hidden dependency found.
- Limit 46, PoB hot key: the claim program's pass-through accounts and address-based root are present. The hot key's stated powers are not expanded by the claim program.
- Limit 47, stolen guardian: guardian can only stop and cancel pending operator. Replacement still requires half of snapshot live supply plus notice.
- Limit 58, rescue: rescue only moves to `bank_treasury`, only for self, burned host, or live CBOB host. The live-host owner race is stated.

One nuance, not a worse limit: under extremely low charter participation, "half of all live vaults" can be one or a few vaults. That is arithmetic from the ruled definition, not a code deviation.

## 2. Is anything listed as a limit not actually a limit?

I did not find an accepted limit that has already been closed but remains listed as a limit.

- Limit 42, prior destination ATAs, remains true for the required page shape. The narrow exception is stated and does not change the page contract.
- Limit 35, 10% turnout never binds at ruled numbers, remains true: 21% quorum and 51% threshold imply at least 10.71% YES.
- Limit 59, pre-funding create addresses, remains a grief limit for Core creates. The pages' fresh-address handling does not remove the grief, it avoids reuse.

## 3. Is any discharged item not actually discharged?

From source read, I did not find a discharged item that is obviously false.

Two qualifications:

- Discharged item 54 binds holder pages to set compute budget on crank-carrying transactions. The holder pages do this through `buildForWallet`. The ceremony page is not a holder page, but R0-1 shows it does not use the same bounded-wallet judge. If the ceremony is considered inside item 54's "holder pages" language, then item 54 is not fully discharged for the ceremony. If it is outside that language, R0-1 remains a LOW finding.
- Discharged item 51, boost timing and exact N distributions, matches the program logic I read. I did not execute the 260-epoch host test, but the source accounting is consistent.

## 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

Two items need explicit attention:

1. Item 22, dress rehearsal. The rehearsal record shows item 22.2 as FAIL. It is not quiet, but it is not closed as written. It needs either a post-repin clean alarm pass or an explicit owner ruling that the true Core-drift FAIL satisfies the requirement.

2. Item 38, initialize values. `launch/mainnet-init.json` still has `vault_collection`, `charter_opens_at`, and `lock_deadline` OPEN. The ceremony page and launch checker are the only gates. Because `check-launch-params.mjs` is not carried, this pass cannot independently verify the mainnet judge. These values must not be treated as accepted.

Items 50, 52, and 53 appear actively tracked, not quietly accepted. Item 53's current open reason is the need to re-prove after repair commits and complete the rehearsal, which is consistent with the record.

---

# Anything else

## Documentation and holder-facing accuracy

### DOC-1 INFO: README program table misstates what SEAL and BURN do

Construct:
- `README.md`, five programs table:
  - SEAL: "holds each vault's reserves"
  - BURN: "opening a vault: pays out its reserves to the owner and burns it"

What a reader gains:
- A mistaken mental model. SEAL does not hold reserves. It holds the seal authority and enforces the open/burn pairing. BURN does not pay reserves. It proves emptiness, burns the Core asset, and retires the vault. Token movement is done by Core Execute into the sweep helper before BURN.

Evidence:
- `programs/cbob-vaults/src/lib.rs` contains no SPL Token CPI.
- `programs/cbob-vault-burn/src/lib.rs` contains no SPL Token transfer CPI.
- `programs/cbob-vault-sweep/src/lib.rs` performs token transfers and closes.

Fix:
- Reword the table:
  - SEAL: holds the freeze authority and requires an open to end in a burn.
  - BURN: verifies the vault is empty, burns it, and retires it from the pool.
  - SWEEP: moves balances out during an owner-signed opening.

## Placeholder fixture

The placeholder source is trivial and refuses every instruction. The binary and Cargo.lock are not in this textual pass, so the SHA256SUMS entries cannot be recomputed here. This does not affect the five launch programs, but if the placeholder fixture is used by web tests, those tests should be read in a pass that carries the binary hash and Cargo.lock.

## Web test harness

`web/test/ref.mjs` is imported by `web/test/get.test.mjs`, `web/test/proxy.test.mjs`, `web/test/ix.test.mjs`, and `web/test/e2e-localnet.mjs`, but is in neither pass according to the prompt. Any claim that those web tests are non-vacuous depends partly on a file I was not given. This is a coverage gap, not a code finding.

---

# Given that no human firm will ever see this and the programs will be immutable, what should this project do before launch that AI audit structurally cannot?

1. Close item 22.2 with a human decision or a new run.
   - Either run one rehearsal alarm pass after the Core re-pin and record a PASS, or record Gary's explicit ruling that the mid-rehearsal Core-drift FAIL is accepted as the live alarm evidence. AI can point out the gap; only the owner can decide what satisfies the open blocking item.

2. Perform a real key-custody review, not a code review.
   - Gary's wallet is INIT_AUTHORITY, guardian, and the mainnet rehearsal signer. Confirm it is usable for the ceremony, preferably with a hardware wallet path if Phantom supports it, and verify the address out-of-band before signing.
   - The deploy authority key, swap operator key, and CBOB release wallet key are hot. Confirm file permissions, backups, and access control on the box by a person with physical access.
   - The Squads multisig participants must confirm they can return rescued vaults and receive pages. AI cannot test people.

3. Verify deployed bytes from more than one viewpoint.
   - After road step 9, dump each program from at least two independent RPC providers and compare the prefix hash and zero tail against `dist/SHA256SUMS`.
   - Confirm remote solana-verify shows each program verified after the on-chain parameter upload.
   - Do not rely on a single provider or a single AI report for this step.

4. Run a live Phantom rehearsal of the ceremony and at least one holder opening.
   - The e2e uses a Phantom-like signer, but a real Phantom on a real browser can behave differently, especially for the widest openings that fit no compute-budget instruction.
   - Have Gary complete the ceremony page flow in the environment he will use on launch day, including basic auth, tunnel or hosted path, and wallet refusal paths.

5. Test the human-facing failure paths.
   - What does the holder see when Coinbase freezes a reserve account?
   - What does the holder see when the RPC proxy is down?
   - What does the holder see when a stray token cannot be listed?
   - What does Gary see if a ceremony step is already broken on chain?
   AI can inspect copy; it cannot judge whether an ordinary holder will understand the warning before signing.

6. Establish an incident drill before value exists.
   - Guardian stop sales drill.
   - Guardian stop sweep drill.
   - Cancel pending swap operator drill.
   - Core upgrade detection drill, including the decision path for re-pinning Core and re-running the suite.
   - PoB collection hot-key compromise drill during the charter window.
   - Squads rescue-return drill.

7. Decide the publication gate for holder pages.
   - Item 50 remains open until the pages are published and the holder guide can be published. A person should confirm the live site, RPC proxy, metadata generator, and monitoring are installed before step 11.

8. Keep a human accountable for post-launch monitoring.
   - The alarm can page, but someone must receive pages, have the guardian key, and be able to act. AI audit cannot be on call.

9. Consider a public bug bounty or disclosure channel after launch.
   - The README has a private vulnerability reporting path. Decide who monitors it and under what authority a bounty would be paid. This is a policy decision, not a code decision.

10. Do not remove upgrade authorities until every open blocking item is explicitly closed.
   - Items 22, 38, 50, 52, and 53 must be closed by artifacts or rulings. Once step 11 runs, no AI round and no human firm can patch the programs.

---

## Summary of findings by severity

No CRITICAL, HIGH, or MEDIUM findings are confirmed in this pass.

No finding is in the five programs.

LOW:
- R0-1 ceremony page lacks lower bound on wallet-added compute-unit limit.
- R0-2 rehearsal ceremony preflight can show byte check as passed when unconfigured.
- R0-3 rehearsal-refresh ignored-file snapshot claim does not match git command.
- R0-4 `CBOB_ALARM_REHEARSAL` missing from rehearsal-only override refusals.
- R1s-1 frozen zero-balance reserve account lacks clear page refusal. This is inside accepted freeze limit, but the page can be made honest.
- R5-1 claim page frozen check omits FreezeExecute plugin types.

INFO:
- R0-5 rehearsal item 22.2 FAIL remains unresolved as written.
- R0-6 rehearsal driver CLI config persistence and max-sol drawdown weakness.
- R8-1 wallet compute-budget judge lacks upper bound and duplicate rejection.
- R8-2 page budget falls back to 20,000 CU when simulation units are null.
- R8-3 signature walk helper cannot distinguish empty result from unresolved cursor.
- DOC-1 README misstates SEAL and BURN roles.
- Coverage gap: `web/test/ref.mjs`, `check-launch-params.mjs`, `bank/layout.mjs`, `bank/detectors.mjs`, and other imported files are not in this pass, so several test and page properties remain unverified here.