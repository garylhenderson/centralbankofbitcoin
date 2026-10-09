# Round 46 — independent audit of the v6 tree (whole, as bundled)

**Scope actually read.** All five programs whole; `tests/3prog.test.ts`; `sim/test-vault.ts`; `tests/expiry-budget.mjs`; `tests/initauth.test.ts`; `tests/cpi-wrapper/src/lib.rs`; `bank/txread.mjs`; `bank/sigwalk.mjs`; `bank/rehearsal-env.mjs`; `scripts/rehearsal-run.mjs`; `scripts/rehearsal-steps.mjs`; `scripts/rehearsal-recover.mjs`; `sim/rehearsal-local.sh`; `sim/das-shim.mjs`; `sim/fixtures.mjs`; `sim/clone-pob.mjs`; `sim/run-sim.sh`; `scripts/run-tests.sh`; `scripts/build-mainnet.sh`; `scripts/token-programs.sh`; `scripts/rehearsal-tree.sh`; `scripts/pob-merkle.mjs`; `scripts/pob-set.json`; `scripts/probe-mainnet-facts.mjs`; `scripts/validate-core-gate.sh`; `scripts/audit-coverage.sh`; `launch/mainnet-init.json`; `launch/rehearsal-init.json`; the whole of `web/` that was bundled; `SPEC.md`; `DESIGN-v6.md`; `HOLDER-GUIDE.md`; `audits/v6-redteam/RT3-stage3c.md`; `audits/round45/VERDICT-programs.md`; `audits/round45/VALIDATION.md`.

**Not in this bundle, so not independently verifiable by me:** `bank/layout.mjs`, `bank/detectors.mjs`, `bank/alarm.mjs`, `bank/crank.mjs`, `bank/revenue.mjs`, `bank/swap.mjs`, `bank/lock.mjs`, `bank/spl.mjs`, `bank/accrual.mjs`, `bank/selftest.mjs`, `bank/redemption-poster.mjs`, `scripts/check-launch-params.mjs`, `scripts/cron-install.sh`, `web/test/ref.mjs`, `web/test/run-all.mjs`, and the web tests other than `get`/`proxy`/`ix`/`e2e-localnet`. Every statement below that depends on one of those is labelled as a reading of the claim, not a verification of it. That gap is named again in the last section.

---

## R0 — Round 45's verdict and its repairs

I re-read the eleven confirmed items and checked each repair **at the site**, in the files as bundled.

| item | repair claimed | present? | where |
|---|---|---|---|
| V45-1 22.4 | waits out the alarm's grace, requires `unreconciled_swap` | **yes** | `rehearsal-run.mjs` `ALARM_GRACE_MS = 60*60_000`, `alarmCriticalKinds`, `judgeForcedFailureAlarm`; `rehearsal-steps.mjs` `revenue-forced-alarm` `while (Date.now() < started + ALARM_GRACE_MS + 60_000)` |
| V45-1 22.5 | PASS only on a boolean `burnt` | **yes** | `judgeDas = a => typeof a?.burnt === 'boolean' ? 'PASS' : 'FAIL'` |
| V45-1 22.2 | FAIL on an unexplained CRITICAL | **yes** | `judgeAlarmPass` + the `explained` list in `alarmStep` |
| V45-2 | no provider URL in `solana` argv | **yes** | `solanaArgv(cliConfig, argv)`, `ctx.cliConfig` written 0600 and deleted on exit; `judgeArgv` refuses a secret in argv |
| V45-3 | deploy key tied to the judged id; only recorded buffers closed | **yes** | `judgeDeployKey` called before each deploy; `bufferCloseArgv` uses `st.buffers[k]` |
| V45-4 | rescue idempotent on read-back, transfers through `send()` | **yes** | `rescue` re-reads `x.owner` and sends only what is missing; `coreTransferIxs` → `send(rec, …)` |
| V45-5 | cycles counted per venue, judged at n=2 | **yes** | `closedCycles().length >= n`; `judgeRevenueCycles` |
| V45-6 | preparation before the deploys | **yes** | step order in `makeSteps`: `keys, build, fund-roles, pob-set, cbob-mint, fill-values, fund-deployer, deploy-1..5, ceremony-*` |
| V45-7 | `das()` URL; sweep-back scope | **yes** | `profile()` uses `rpc: ctx.A.rpcResolved`; `sweep-back` iterates `['holder','treasury','crank','swap-operator','stranger','guardian','pob-authority','cbob-release']` plus the INIT dust |
| V45-8 | 22.1 recorded as five vaults | **yes** | `item(1, 'PASS at 5 vaults (scale not exercised)', …)` |
| V45-10 | signature recorded before the send | **yes** | `sendRecorded` writes `c[field]` and saves before `sendRawTransaction` |
| V45-11 | collection create uses the taken-address check | **yes** | `checkNewAddress(conn, pre, newKey(name), …)` with a fresh key on `taken` |

**Two claims round 45 disproved, re-tested against what is bundled:**

- **MiMo's BURN close-authority offset.** Disproof confirmed from the SPL Token `Account` layout: mint 0–32, owner 32–64, amount 64–72, delegate `COption` 72–108, state 108, is_native `COption` 109–121, **delegated_amount 121–129**, **close_authority `COption` 129–165**. `burn/src/lib.rs` checks `d[121..129]` and `d[129..133]` as two separate fields, which is exactly right. `decode.mjs`'s `readUInt32LE(129)` agrees. MiMo's own table puts the tag at 130 and the key at 133, which overlap; that is a layout error, not a program defect.
- **Muse's "0.1 SOL per ceremony step".** I cannot run web3.js here, so I do not certify the disproof; I only note the code is consistent with it: `sendWithInit` funds `used − pre`, not the probe amount, and the local proof's recorded ceremony deltas (1.8 M–10.2 M lamports, quoted by round 45) are far below 0.1 SOL.

**One thing round 45's verdict did not file, which I do below:** the build-override guard is keyed on the profile *name* `mainnet`, so `mainnet-local` accepts overrides (F1). And the ceremony page can throw before it reports NOT READY (F2).

**On the verdict's own measurement limits:** the two "counted narrowly" seats (Qwen max-0902, MiMo re-run) carry the quorum with no margin. That is the verdict's statement about its own process; I do not re-adjudicate it, but it means the round-45 pass is one seat from NOT MET, and nothing I can read changes that.

---

## R1 — Custody

**What I checked in `cbob-vaults` and `cbob-vault-burn`, and the result.**

- The pairing binds **asset (account 0) and owner (account 2) in both directions**, and `load_instruction_at_checked` sees only top-level instructions. SEAL walks *forward* from `current + 1`; BURN walks *backward* from `0..current`. Both use `load_current_index_checked`, so a CPI-reached open reports the *outer* index and BURN's backward walk cannot see it. This is the WR.1–WR.3 shape and it is structurally correct.
- `open_for_redemption` refuses `NotTheOwner`, `ForeignVault` (asset's collection ≠ config), `WrongCollectionAccount`, and `NoTerminalBurn`. `burn_vault` refuses `NoPrecedingOpen`, `NotTheOwner`, `ForeignVault`, `WrongCollectionAccount`.
- The emptiness proof: `lamports() == 0`; every reserve mint's ATA under **both** token-program derivations must be **present in `remaining_accounts`** (`ReserveNotDeclared`); an account owned by neither token program is skipped; an account shorter than 165 bytes is skipped; otherwise the owner field must be the PDA, delegate tag, delegated amount and close tag must be zero, length must be exactly 165, amount must be zero. The second loop covers declared accounts owned by the PDA (empty, undelegated, 165 bytes) and declared Core assets (`d.is_empty() || d[0] != KEY_ASSET_V1`).
- `retire_redeemed` is gated by stack height **and** by the instructions sysvar naming BURN's `burn_vault` for this asset, and it requires the asset to be positively burned. Its `pool_token` is passed to `monthly_inline`, which requires the exact `pool_ata`.

**Attack shapes I could not break:**

- two vaults in one transaction: each half binds its own asset+owner; a crossed pair refuses `NoTerminalBurn`/`NoPrecedingOpen` (arms 3.9, 3.10, 4.10).
- a thawed vault leaving unburned: `burn_vault` either lands or the whole transaction reverts, and the thaw is in the same transaction.
- a partial sweep: `VaultNotEmpty` (3.11).
- account-index binding: SEAL binds index 0 and 2 of BURN's instruction; BURN binds 0 and 2 of SEAL's. Both constants are asserted against the Anchor derivation in the suite (3.1a–3.1f).
- an emptied vault surviving: `is_burned` is a positive Core tombstone; there is no close-and-re-seal path in v6.

**Residual I cannot close from here:** whether a stranger can make a vault's *emptiness* unsatisfiable. The three ways are (i) a T22 account at a reserve ATA address — closed by the ATA program's refusal for a classic mint (`probe-round5b.test.ts` F4.2, bundled); (ii) a classic account with a kept close authority — the helper refuses it and the page routes it around (`R36.C5`, bundled); (iii) a T22 account the PDA owns holding a balance — the helper cannot read it and BURN refuses it if declared; the page leaves it undeclared and names it (`H1`). (iii) depends on `bank/detectors.mjs`, which is **not bundled**. I state it as a reading of round 36's measurement, not as my own.

---

## R1s — the sweep helper

I read `programs/cbob-vault-sweep/src/lib.rs` line by line.

**(a) Who can make it move value.** Called directly it needs `signer.is_signer`, and `read_token` requires `src_owner == signer.key`. A vault's accounts are owned by the asset-signer PDA, which only Core can sign for. Through Core's `ExecuteV1`, Core approves only `authority == owner`. The one plugin route that can approve another authority (AgentIdentity) cannot be added by an owner (R24.1a) or even by a collection update authority without the agent registry's PDA (R24.1c). So the helper is reachable only inside an owner-authorized `ExecuteV1`. **I found no hole in this.**

**(b) The pair list.** Odd or zero-pair lists: `(accounts.len() - 4) % 2 != 0` → `NotEnoughAccountKeys`; `accounts.len() < 4` → same; data ≠ `[0]` → `InvalidInstructionData`. A duplicate source: the first pair closes it, the second pair's `read_token` sees a non-token owner and refuses — the whole call reverts, which is fail-closed (SR.12a). A source that is also a destination: same. `signer.key == dest.key` → `InvalidArgument`. `token.key != SPL_TOKEN_ID` or `system.key != system_program::ID` → `IncorrectProgramId`. A frozen source: the SPL transfer refuses (SR.14). A destination that is not the named wallet's account for that mint: refused by the `to_owner`/`to_mint` check (SR.12). A native wSOL source: the transfer moves the wrapped amount, then the close returns the rent to `dest`; the helper transfers first, so the close does not hit `NonNativeHasBalance`.

**(c) Destination checks.** The program does not compare `dest` with the asset's owner, and that is safe **because the owner must sign the `ExecuteV1` that reaches it**. A destination below rent exemption: a System credit to a not-yet-existing account below the floor is refused by the runtime, which would revert the opening — but the vault wallet's balance is either 0 or ≥ the rent floor (R41.C8c), so a credit of its whole balance lands. A non-System destination (a token account) is allowed and moves only lamports (R27.S1). The page names the owner as `dest`.

**(d) The lamport sweep.** `signer.lamports()` is read at execution and moved in full. Inside one atomic transaction nothing can land between it and `burn_vault`; the page's instructions between the helper and the burn are SPL transfers that move no lamports. BURN then reads `lamports() == 0` on the same account.

**(e) Interaction with BURN's emptiness proof.** The helper closes every account it empties, and a closed account is not token-owned, so BURN skips it for the right reason. A missing reserve ATA: the page creates it in the prior transaction; a stranger creating it first is harmless because the ATA program's create is idempotent. A Token-2022 ATA at a classic mint's derivation cannot exist (F4.2). A non-ATA classic account the PDA owns is nameable by the helper as a stray pair. A nested Core asset is not nameable and is destroyed unless declared — item 58's rescue covers our own vaults.

**(f) Does it fit?** S8.0 measures `claim + open + helper + burn` at 1,061 bytes and asserts ≤ 1,232 − 52 − 96. A fourth reserve mint is impossible (`MAX_RESERVE_MINTS = 3`, refused at `initialize`). The in-line monthly run's accounts are already in the shape (`pool_token` rides through BURN). The page drops strays to fit and never exceeds 1,232 (`buildTx` throws above it).

**(g) Evidence.** SR.0–SR.14 are in the suite as bundled; the arms that could not fail are discussed under R8. The helper's mainnet bytes are `cmp`-compared against `target/deploy` and the localnet build in `scripts/build-mainnet.sh`; the suite deploys `target/deploy/cbob_vault_sweep.so`. So yes, the same bytes.

---

## R2 — the community pool

**The invariant `pool_balance ≥ ceil(owed_scaled)` — I re-derived it and it holds.**

- `credit`: `delta = floor(avail·S/w)`, `avail = balance − ceil(owed)`. New owed = old + delta·w ≤ old + avail·S, so `ceil(new owed/S) ≤ ceil(old/S) + avail = balance`. Balance unchanged. ✓
- `claim`: balance −= pay, owed −= pay·S, so `ceil` falls by exactly `pay`. ✓
- `retire` (forfeit or not): owed −= pending, balance unchanged. ✓
- `join`: owed unchanged (the new vault's `owed_of` is 0 by construction: `debt = w·acc`, `carry = 0`). ✓
- `reweigh`: `owed_of` is preserved exactly (owed moves to `carry`, debt restarts at `after·acc`). ✓
- `retire_redeemed` with forfeit subtracts the *whole* pending including carry, and the pool keeps the money. ✓

**Counters.** `pending_this_epoch` is zeroed in `advance_epoch` and incremented only alongside `pending_count`; `retire` decrements `pending_this_epoch` only when `request_epoch == dist_epoch`, which is exactly when it is still counted there. So `pending_this_epoch ≤ pending_count` at every ordering I could construct, and `waiting_to_join`'s `checked_sub` cannot underflow. The suite's `ledger()` recomputes `total_active_weight`, `boost_weight_total`, `boosts_active` and the ring from the records after every money operation.

**Liveness.** Distributions can be blocked by `JoinWaitingFirst` and by `BoostsExpireFirst`; both are removable by anyone — `expire_boosts` needs only records, and a waiting vault can be joined by a `claim` that names it (the record's `vault_ata` is only compared by key, so a closed account still joins) or removed by `retire_burned`. Redemptions can be blocked only by the rate limit (bounded, self-refilling) or by a frozen account (the issuer's).

## R2b — the $CBOB boost

**"Exactly N distributions."** A boost bought in epoch `e` sets `end = e + N` and adds weight immediately. The distribution that advances `dist_epoch` to `e+k` credits with the boosted weight, for `k = 1..N` — that is exactly N. At `advance_epoch` to `e+N`, the ring slot for `e+N` makes it due and `BoostsExpireFirst` blocks every later distribution until it is expired; `expire_boost` calls `reweigh(0)`, which moves what it earned into `carry`. `BO.21` and `BO.35` pin the two same-transaction orderings and both match this arithmetic.

**The ring.** Every live end epoch lies in `(dist_epoch, dist_epoch+63]`, a window of 63 values, so no two live boosts share a slot modulo 64; `unschedule_boost` decrements the ring slot when the boost is not yet due and `boosts_due` when it is, which is the same predicate `advance_epoch` uses. `BO.34`–`BO.38` exercise the wrap and both branches. I found no way to expire a record twice (`expire_boost` requires `boost_weight > 0`, and it is set to 0) or to make one never expire (`dist_epoch` is monotone and `expire_boosts` is permissionless and needs no pool).

---

## R3 — the level draw

`blockhash_in_window` pins the sysvar id, bounds the declared count at 512, checks the buffer holds what the count claims, refuses an all-zero hash, and takes the **smallest produced slot in `[want, want+64]` inclusive**. `try_capture` walks A → B → C with `want = (slot/4 + 2)·4` each time, returns `NotYet` if any is missing, and refuses a zero hash. Worst-case span is `reveal_slot + 208 < 300`, so a capture inside the window always finds all three.

`reveal_level` requires `index == revealed_total`, so the FIFO is exact; a burned asset still takes its draw (the Core write is skipped) so the queue never stops; `check_supply` guarantees a level is available. The draw is `u64le(entropy[0..8]) mod sum(remaining)` walked over I..V. `L.10`, `L.11`, `L.17d` and `L.23` re-derive every draw from the raw sysvar and from the stored entropy.

**Is it worse than SPEC 26 says?** SPEC 26 says C's leader chooses among many draws, that skipping alone is best-of-4 (P(V) 5.0% → 18.6%), and that it is per-cohort. The code matches that exactly: `blockhash_in_window` takes the smallest produced slot in a 64-slot window, so a leader who skips its own first slot(s) moves C inside its own 4-slot group, and every vault minted in the same slot shares `reveal_slot`. **Not worse than stated.** The holder guide's paragraph ("can pick among several results, by skipping a block or changing what goes into it … one choice affects every vault created in that moment at once") says the same.

---

## R4 — governance

`create_proposal` snapshots `index_snapshot = minted_total` and `quorum_supply = minted_total − burned_total − bare_burns_retired` at creation, copies `quorum_bps`/`threshold_bps` into the proposal, refuses before `charter_closes_at`, enforces ≤ 5 actions with one of each kind, refuses `KeyChangesBundled`, and pre-checks every action against MINT's own bounds. `execute_proposal` uses the snapshot as the divisor (never `max(snapshot, live)`), requires `cast ≥ ceil(snapshot·quorum)`, `yes·10000/cast ≥ threshold`, `yes ≥ ceil(snapshot·10%)`, and `yes ≥ ceil(snapshot·50%)` for a guardian change or an operator arm.

- **Minority carrying what it should not:** the smallest passing YES is `0.51 · 0.21 = 10.71%` of the snapshot, above the 10% turnout floor, so limit 35 holds. A key change needs half. Nothing in the action set reaches the split, the destinations, `max_supply`, the royalty or a vault.
- **A vote reaching money:** every action is a CPI into MINT signed by the `["gov"]` PDA, and MINT re-checks everything; `tighten_sweep` is monotone (`max`/`min`) so execution order cannot loosen it.
- **Frozen forever:** all vaults redeemed (limit 45, with the round-24 correction that a still-open round can mint one), or a stolen guardian key at low turnout (limit 47). Both are stated. I found no third path.

---

## R5 — the charter claim

Identity is by address against a domain-separated, sorted-pair Merkle root; the leaf/node tags differ so a leaf cannot be replayed as a node; `pob_extra` accounts are appended to Core's burn **never as signers** (`AccountMeta::new/new_readonly(a.key(), false)`); the window is two `initialize` values compared against `Clock`; the PoB is CPI-burned as its owner in the same instruction; the address can never be re-minted (Core tombstone), so no bitmap is needed.

**Is SPEC 46 complete?** It now states the two live consequences (end the project before it starts; capture governance) and the two bounds round 25 added (the alarm samples state; the key cannot transfer or burn an individual PoB). **What it still omits, and I flag it as an omission rather than a new hole:** the alarm watches the *collection* account, so a plugin added to an individual Proof of Burn is unpaged (round 22 said so; SPEC 46 still carries it), and the claim page refuses a PoB or collection with an external plugin outright, so a hook added during the window stops page claims until the page is rebuilt. Both are in the text. I found nothing a PoB holder or a third party can do that SPEC 46 omits.

---

## R6 — the one-time configuration and the trusted hop

I recomputed every account space from the struct definitions:

- `MINT_CONFIG_SPACE` = **1,261** (disc 8 + 1,253 fields, of which `boost_expiring[64]` is 256 and the padding is 256). The sum in the source is correct term by term.
- `VAULT_RECORD_SPACE` = **221** (matches SPEC's "221 bytes").
- `BurnConfig` space = **827** (571 + 256).
- `GovConfig` space = **350** (`proposal_count` at 53, as the suite reads).
- `SEAL` `Config` space = **398** (`collection` at 9, `reserve_mints` length at 41).

**Wrong-but-accepted values that would lock in forever.** Every one I found is already stated in item 38: SEAL reads only the *owner* of each reserve mint (not that it is a mint, not duplicates, not the collection key); `pob_collection` is only required non-default; `charter_opens_at` is not required to be in the future; `redeem_window_secs` may be anything from 10 s to 24 h. None of these is reachable by an attacker (only `INIT_AUTHORITY` calls `initialize`), and the pre-signing checker is the gate. **I found no new one.**

**The trusted hop.** `sweep_sol_for_swap` requires the operator's signature, `amount > 0`, `amount ≤ max_sweep`, `now ≥ last_sweep_at + cooldown`, `bal ≥ reserve + amount`, and the pinned revenue PDA. A vote can only tighten (`max`/`min`) and only inside `sweep_floor` / `cooldown_ceiling` / `reserve_ceiling`. Worst case is cap × windows until the guardian stops it — limit 10.

**The 10% royalty.** Installed once at `initialize` with `PluginAuthority::None` (`data.push(1); data.push(PLUGIN_AUTHORITY_NONE)`). MINT's only Core CPIs are `CreateV2`, `AddCollectionPluginV1` (at initialize), `UpdatePluginV1` on an **asset** (`reveal_level`), `BurnV1` and `TransferV1`. Nothing in our programs targets the collection's plugin registry after `initialize`, and the suite pins Core's refusal of update, removal and re-delegation on a `None`-authority plugin (R.6, R.6a, R.33.G3).

**The redemption cap.** `rate_head` is a `u8` advanced modulo 64, written once per redemption; the check is `now − ring[(head + 64 − k) % 64] ≥ redeem_window_secs` with `k = min(max(1, ceil(live·210/10000)), 64)`. That is exactly a rolling window over a 64-entry ring, and the first `k` redemptions against a zeroed ring land.

---

## R7 — cross-program raw reads

I recomputed every offset from the struct definitions and every one matches the pinned constant:

- **MINT `MintConfig`**: `minted_total` 141, `bare_burns_retired` 454, `governance` 41, `collection` 9, `charter_closes_at` 442, `sol_reserve` 257, `max_sweep` 266, `cooldown` 274, `sales_stopped` 191, `sweep_stopped` 192, `sales_stopped_at` 518, `sweep_stopped_at` 526, `sweep_floor` 631, `cooldown_ceiling` 639, `reserve_ceiling` 647, `max_boost_weight` 711, `max_boost_epochs` 712. GOV's length guard is `≥ 714`; BURN's is `≥ 462`. ✓
- **`VaultRecord`**: `mint_index` 41, `asset` 9, `active` 125, `retired` 126, `boost_weight` 186, `boost_end_epoch` 187, `pending` 177, `request_epoch` 178. The proxy's `mint-boosts` slice `{offset:125, length:70}` maps `d[61]`→186 and `readBigUInt64LE(62)`→187, and `dueBoostRecords` reads exactly those. ✓
- **`BurnConfig`**: `burned_total` 42, `redeem_window_secs` 50, `rate_head` 58, `rate_ring` 59. ✓
- **SEAL `Config`**: `collection` 9, `reserve_mints` length at 41. ✓
- **The sweep helper**: mint 0, owner 32, amount 64, length 165. ✓
- **The pool's `monthly_inline`**: mint 0..32, owner 32..64, state 108, amount 64..72. ✓
- **SPL mint**: decimals 44, is_initialized 45. ✓

No wrong offset.

---

## R8 — the suite, the simulation and the build as evidence

**Arms I judged non-vacuous:** the reason pins (`because`) all demand a substring of the arm's own recorded error, and `ID.1` proves every assertion id is unique so a pin cannot read another arm. `P.11a`'s expected string is now fixed at all five levels rather than built from the picks. `P.2a` argues per-level eligibility by pigeonhole rather than assuming it. `9.13a` pins the measurement's own foundation. `R42.C12a`'s census loop fills regardless of the prefund outcome. The `diffIx` control at the end of `ix.test.mjs` proves the comparison can fail on a cleared flag, a changed byte and a changed account.

**Arms I would call weak, not wrong:**

- `because('0.1i', 'Program 1111…0x0 | Program MINT…')` and the four other two-part pins require two log lines to be *adjacent* in `l.join(' | ')`. A reordering of log lines in a future SDK would make the pin fail while the arm is still correct. Diagnostic, not a false pass today.
- `rec('SR.12b', …)` asserts `false` for "the duplicate-source refusal reached the second, closed source" — it is deliberately asserting that the refusal came from the *first* guard. Fine, but it means the duplicate-source arm does not prove the close path.
- `L.12`'s `revBytes` is computed with a `Keypair.generate()` asset, so it measures the *shape*, not a real vault. Stated in the comment.

**Claims in the prompt that no bundled arm exercises:** the ~2,100-vault crank scale; anything in `bank/detectors.mjs`; the RPC proxy behind Cloudflare with a real provider; a real Phantom; the Squads' hand return. All are named as measurement limits by the prompt or by round 45.

**Build as evidence.** `scripts/build-mainnet.sh` refuses a dirty tree, removes both target directories before building, gates on exit status rather than on grep output, checks the source names `Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb` in all four programs, deploys **both** builds and asks each whether it trusts the test key, and `cmp`s the sweep helper against `target/deploy` and the localnet build. It does **not** prove the four keyed mainnet binaries are byte-identical to the tested ones apart from the 32-byte constant — its own banner says so. That is the honest statement.

**One operational blocker I confirm from the bundled files:** `build-mainnet.sh` refuses a tree where `git status --porcelain` is non-empty, and round 45 records `?? .cache` (a symlink) and `?? cache-keypairs-backup-20261008.tar.gz` in the repository root. `.cache` is not in the ignore list as bundled. So step 9's build will refuse until both are gone or ignored. That is a fixable-layer item, not a program finding, but it blocks the launch sequence as the tree stands.

---

## The four questions about the accepted limits

**(1) Is any limit worse than stated?**
I looked specifically at the ones that would be catastrophic if understated. Limit 9 (foreign nested Core asset) — the redeem page *does* list Core assets the deposit address owns and names them; the limit says the pre-signature control is only `judgeRedemptionCoverage` and that an owner using another client destroys the asset. That is accurate. Limit 28 (freeze) — the code matches: a frozen reserve account cannot be emptied and BURN requires empty, so the whole redemption is blocked, and the forfeit path is exactly as described. Limit 40 (Core upgradeable) — the three named consequences are the three I can see (tombstone, `UpdatePluginV1`, `ExecuteV1` authority); a fourth of the same class exists (a Core change to the `AssetV1`/`CollectionV1` byte layout would make `read_core_asset` and `parseCoreAsset` fail, halting every redemption and every page read), but it is the same "a Core change can halt everything" statement and I would not call it worse than stated. Limit 41, 46, 47, 55, 56, 57, 59 — each is at least as strong as the code. **I found none worse.**

**(2) Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?**
- Limit 2's discharge claim ("nothing a stranger can do makes a redemption refuse off chain") is *qualified in the same paragraph* by the page's own refusal list, and one member of that list — "what the coverage cross-check finds that the page did not name" — is the one I cannot bound, because `judgeRedemptionCoverage` and `classifyPdaTokenAccount` are not bundled. If the cross-check can ever find something the page named differently, a stranger could in principle reach a refusal. I cannot test it here; I name it as a limit that is discharged only as far as the page's naming is provably a superset.
- Limit 27 (a claim between a bare burn and its retirement) is still live: `claim` does not read the asset. Not closed.
- Limit 32 (the cap can read one higher than true live supply) is still live and stated.
- Limit 13 is closed by step 11, as stated.
- Limit 54's requirement on the holder pages is vacuous for the pages as built: the redemption, the claim, the buy and the draw each send either no crank or a single instruction, so no page needs a compute-budget instruction. Discharged for the current pages.

**(3) Is any DISCHARGED item not actually discharged?**
I re-checked the ones the code can show. 14 (`DuplicateAttribute` at mint *and* claim) — present in `check_attributes` and pinned by 11.4 and R42.C8. 19 (no activated-but-unlevelled state) — `activate` requires `1..=5`. 30 (no vote reaches the split, the destinations or `max_supply`) — there is no `update_wiring` and `SweepTighten` has no such field. 31, 33 (period and notice are `initialize` values) — present. 15 (`VaultTooNew`) — present. 4 (BurnV1 does not sweep the PDA) — `lamports() == 0` is kept. 51 (the boost) — built, with the carry, the ring and the gate. 12/17 (compute) — the v6 arms 10.1–10.6 exist. **None of the discharged items is secretly live.** One wording nit: item 11's "v6 has no payer and no ledger" reads oddly beside `bank/revenue-ledger.json`, but the item was about the *distribution* ledger and the revenue ledger's trust is limit 10. Not a defect.

**(4) Is any OPEN AND BLOCKING item being quietly treated as accepted?**
No. Items 22, 38, 50, 52, 53 are each still enforced by something: `check-launch-params.mjs` refuses a file with any OPEN value (and the ceremony substitutes only `vault_collection`, explicitly); the ceremony has `atas` and `fund` steps; the rehearsal driver exists and reports `NOT-RUN-HERE` for 22.3–22.5 rather than PASS; the pages are built and staged but not published, and the holder guide is marked DRAFT. The one thing I would call *de facto* accepted is that items 22.3, 22.4 and 22.5 have never run anywhere and cannot run anywhere except mainnet — the driver makes that explicit, so it is not quiet.

---

## Findings

### F1 — LOW (fixable layer, tooling). The build refuses overrides by profile *name*, so `mainnet-local` accepts them.

**Construct.** `web/build.mjs`:

```js
if (profileName === 'mainnet' && Object.keys(overrides).length)
  die('the mainnet build takes every value from web/src/config.js; overrides are for local tests only')
```

and `web/src/config.js`:

```js
export const ACTIVE_PROFILE = typeof __CBOB_PROFILE__ !== 'undefined' ? __CBOB_PROFILE__ : 'mainnet'
export function activeProfile() {
  const p = { ...profile(ACTIVE_PROFILE) }
  if (ACTIVE_PROFILE !== 'mainnet' && typeof __CBOB_OVERRIDES__ !== 'undefined') Object.assign(p, __CBOB_OVERRIDES__)
  return p
}
```

`PROFILES['mainnet-local']` is `{ ...PROFILES.mainnet, name: 'mainnet-local', label: …, rpc: 'same-origin:/rpc' }`. Both guards compare against the literal string `'mainnet'`, so `mainnet-local` — which `web/README.md` describes as "the mainnet profile, byte for byte, except that the page talks to the server that served it" — accepts `--rpc`, `--collection` and `--launch-json`, and `activeProfile()` applies them at run time.

**What an accident gains.** A `mainnet-local` bundle built with `--rpc <url>` reads all chain state, all simulation results and all read-backs from that URL. The ceremony's `preflight` checks the genesis hash *from that URL*, the program bytes *from that URL*, and `readStep` verifies each step *through that URL*. The transactions themselves are built from locally-derived PDAs and the local value file, so the attacker cannot change what is signed — but it can make a step that never landed read as `done, verified on chain`, and let the ceremony walk to the end. `--collection` and `--launch-json` are contained by `readConfigs`' and the judge's own cross-checks. The value of the "local ceremony mode" is that the page trusts only the server that served it; this removes that.

**Evidence that would exist if I am right.** `node web/build.mjs --profile mainnet-local --rpc https://example.invalid` exits 0 and writes `web/dist-mainnet-local/BUILD.txt` with `profile mainnet-local + overrides ["rpc"]` and `rpc https://example.invalid`, while `node web/build.mjs --profile mainnet --rpc https://example.invalid` exits 1 with `build refused: the mainnet build takes every value from web/src/config.js; overrides are for local tests only`. That is a one-command check.

**Fix.** Refuse overrides for any profile that is not a test profile — i.e. gate on a `published: true` flag on the profile rather than on the name, or extend the two comparisons to include `mainnet-local`. (`mainnet-local`'s whole purpose is that its RPC is the server that served it, so it must not take `--rpc`.)

**Why LOW, not higher.** It needs the operator to type the flag while building; the published bundle is `dist/` (mainnet), which refuses overrides; and no holder value is reachable through the flag. It is in the fixable layer, so under the launch gate it does not break launch-clean.

---

### F2 — INFO (fixable layer, page). The ceremony page throws instead of reporting NOT READY when a judged-OPEN value is null and is then turned into a `PublicKey`.

**Construct.** `web/src/pages/ceremony.mjs` `preflight()`:

```js
for (const [label, now] of [['this computer\'s clock', nowLocal], ['the cluster\'s clock', nowChain]]) {
  const bad = judgeValues(lj, now)
  line(bad.length === 0, …)          // pushes into fails, does NOT return
}
const v = valuesFrom(lj)
…
for (const m of [...v.reserveMints, v.cbobMint]) {
  const a = await account(conn, m, 'a mint')   // new PublicKey(null) throws
```

`line(false, …)` records a failure and continues. If `v.cbobMint` (or any entry of `v.reserveMints`) is `null`, `account()` → `new PublicKey(null)` throws a `TypeError` that `wrap` rethrows as `ReadError`, out of `preflight`, out of `run`, and the page shows a raw error instead of the list of OPEN values.

**What an accident gains.** Nothing; it is a diagnostics defect in the ceremony tool. The operator sees "Could not read …" rather than which value is unfilled. It cannot sign anything.

**Evidence that would exist if I am right.** `node web/build.mjs --profile rehearsal --rpc http://127.0.0.1:8999 --launch-json launch/rehearsal-init.json`, serve it, connect the localnet init key and press connect: the page shows a `ReadError` from `new PublicKey(null)` rather than the list of `REHEARSAL-OPEN` keys. (The mainnet profile does not hit it: `cbob_mint` and `reserve_mints` are RULED in `launch/mainnet-init.json`. `vault_collection`, `charter_opens_at` and `lock_deadline` are null but are not in that loop.)

**Fix.** `if (fails.length) return null` immediately after the value checks, or guard the mint loop with `if (m)`.

**Why INFO.** It needs an unfilled value file plus an explicit `--rpc`; the documented rehearsal build passes a filled file; and it is a message, not a signature.

---

### Nothing else

I filed no CRITICAL, HIGH or MEDIUM. Every target in R1–R7 that I could compute or read in the bundled files holds; the two items above are in the fixable layer. I want to be explicit that this is not a certificate: the sections that would carry a HIGH if they were wrong — the alarm's detectors, `judgeRedemptionCoverage`, the crank's send path, the revenue job's judge and recovery, the launch checker — are **not in this bundle**, and my pass over them is a reading of round 45's and earlier rounds' measurements, not my own.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Concrete things this process structurally cannot do, in the order they matter:

1. **Run the ceremony once against the real cluster with Gary's Phantom, and then verify the result with a different tool.** The ceremony verifies its own steps with the same code path it used to build them. Before step 11, decode the four `initialize` transactions that were actually signed, with a script that does not import `web/src/`, and compare every field against `launch/mainnet-init.json` byte for byte. If they differ anywhere, do not proceed.
2. **Prove the shipped binaries are the tested ones.** `scripts/build-mainnet.sh` says plainly that it does not prove the compiled `INIT_AUTHORITY` is Gary's key. Close that with reproducibility, not argument: have a second party (or a second machine with no access to this box) rebuild `0b3ddb3` from a clean clone and compare `dist/SHA256SUMS`, then decode the four `initialize` arguments out of the deployed programs' compiled constants if any tool can — and if it cannot, say so in the launch record rather than asserting the bridge.
3. **Exercise the three mainnet-only rehearsal items for real.** One full revenue cycle through Orca, one with Orca forced to refuse so Meteora runs, one forced post-sweep failure walked through the hand recovery with `--audit` clean, and one DAS read of a burned Core asset. These have never run anywhere. They need real pools, a live Pyth price and a real DAS, so no amount of local validation substitutes.
4. **Run the crank at ~2,100 vaults.** Five vaults prove the I/O; they do not prove cost, rate limits, paging, or the behaviour of a transient RPC error at vault 1,900. If a full-scale run is not possible before launch, seed synthetic vault records the way `tests/expiry-budget.mjs` seeds its twenty and run the plan against them, and write down that scale is unproven.
5. **Sign with a real wallet over the real pages.** Nothing in this tree has been exercised with a real Phantom: a wallet that adds a guard instruction, reorders, or returns a transaction whose message differs. `signExact` refuses a changed message; that refusal has never been observed against a real wallet. Do it once, on mainnet, with a vault holding a trivial amount, before any holder does.
6. **Put the RPC proxy in front of Cloudflare with the real provider and read the real response sizes.** Every bounded-read claim in the pages is measured against a synthetic response or an 8 MB cap, not against the provider that will serve it. The `getProgramAccounts` slices and the cap have to be re-measured with the real upstream.
7. **Clean the tree before step 9.** `?? .cache` and `cache-keypairs-backup-20261008.tar.gz` in the repository root make `build-mainnet.sh` refuse. Delete or ignore them deliberately, and say which.
8. **Custody, as a decision rather than a paragraph.** The $CBOB release wallet's secret and the swap operator's key are on this box and in the nightly backup. Limit 56 says so. Decide, in writing, whether that is acceptable, and if not, move them before the lock — after the lock, a holder can do nothing about it.
9. **Have a person read the holder guide against the deployed behaviour, sentence by sentence.** It is DRAFT and it speaks in the present tense about pages that are staged, not published, and about openings being announced on X when the poster has no sender. No model can tell you whether a holder will understand "the Bank's pool is frozen" or "one choice affects every vault created in that moment at once". Publish it only after item 50 ships, and read it aloud with someone who is not an engineer.
10. **Decide what the vault is, legally, before it holds bitcoin.** A bearer instrument, a collectible with a payout, a security — that is a question for a lawyer, and it changes the disclosure, not the code. Nothing in this repository can answer it, and immutability means the answer cannot be fixed afterwards.