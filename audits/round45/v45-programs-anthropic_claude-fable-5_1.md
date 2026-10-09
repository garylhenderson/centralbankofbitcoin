# Round 45 — PROGRAMS + web/ + rehearsal driver: independent audit

**Headline.** I found no defect in the five programs. Every custody rule, offset, counter and the pool invariant I re-derived from source holds; every round-44 repair I could check against this tree is in place. What survives is in the fixable layer: three LOW and several INFO items, almost all in the new dress-rehearsal driver and the build chain behind the holder pages. None is in (a)–(d) of the launch gate. I say below, per claim, what evidence would exist if I were wrong.

---

## R0. Round 44's verdict, its repairs, and the rehearsal driver

### Repairs verified at every site I can see
- **V44-1** — `config.js` rehearsal profile now carries `initAuthority: GmaDrpp…`, `squads: null`, `launchJudge: 'rehearsal-file'`; `judgeFor` routes it to `check-launch-params --rehearsal`; `judgeRehearsal` skips `REHEARSAL-NA`; both stale comments are gone. `squadsFor(P, v)` falls back to the value file's treasury. Consistent.
- **V44-2** — `release_gate`'s rehearsal branch now requires the left side of the map to equal `web/src/config.js MAINNET_PROGRAMS` (a file the substitution never touches) plus the assembled release root, the right side five distinct 32-byte keys none of which is a mainnet id, and `git ls-files --others -- programs Cargo.toml Cargo.lock Anchor.toml .cargo '**/build.rs'` empty in both branches. With `o` pinned, the only freedom left is a bijective id rename, so a forged edit cannot survive the reverse-map comparison. (Note `--others` without `--exclude-standard` also refuses *ignored* files under `programs/`, which is stricter, not looser.)
- **V44-3** — regex `(?:NOT )?(?:LAUNCH-)?CLEAN; QUORUM MET` with both-ways selftest cases, including the three negative launch-vocabulary shapes.
- **V44-4..7** — `_comment` legend includes RULED; SPEC says "redeploy at NEW throwaway ids"; limit 59 cites 650,240; HOLDER-GUIDE names the bare burn as a second exception; `stepVerdict` returns `absent` and the ceremony renders "THE PIN IS WRONG".
- **Rejected claims re-tested:** C9 (`?.body.frozen` in `plan-get.mjs`, `r.body.basisPoints` in `plan-ceremony.mjs`) is still unguarded; it is unreachable at the pinned Core for the reasons round 42 gave and fails closed through the page's try/catch, so I do not re-file it. C18 (payout button after a pool freeze) remains a residual the forfeit acknowledgement covers.

The off-chain repairs (V44o-1..5) touch files not in this bundle; I cannot confirm them.

### The rehearsal driver (`scripts/rehearsal-run.mjs`, `rehearsal-steps.mjs`, `rehearsal-recover.mjs`, `bank/rehearsal-env.mjs`)

Guards that hold as written: recorded-tree + release-gate refusal; mainnet-id refusal from `.rehearsal-map` against `config.js`; mainnet-only key/root refusal including `init_authority == GmaDrpp…`; genesis-vs-flag agreement; Core pin read from `run-tests.sh` and hashed from ProgramData[45..]; freshness refusal before start and warning-only after; `--max-sol` as drawdown + estimate; signatures recorded *before* send; `nextAction` never re-sends a `done` step, re-reads an unknown one, and `stop`s when a recorded signature landed but the read-back disagrees; `verify-configs` before any token moves; programs closed, never finalised. `rehearsal-env` returns the fallback when unset (production unchanged) and throws when set outside a recorded tree (fail closed).

**F-1 (LOW, fixable layer, outside a–d) — the mainnet rehearsal is forced to spend from, and sign with, the irreplaceable deploy-authority key, and each deploy retry closes every buffer that key owns.**
`rehearsal-run.mjs judgeNoMainnetKeys`: `network === 'mainnet' && funding !== DEPLOY_WALLET → refuse`. `rehearsal-steps.mjs deploy-N run`: `solana program close --buffers --buffer-authority <funding> --keypair <funding> --bypass-warning` before every deploy. `FZjLB4…` is the only key that can upgrade the five placeholder ids (SPEC road step 9: if lost, launch needs new ids, a program change). The driver loads it into a multi-hour node process, hands it to child `solana` invocations, and makes it the rehearsal programs' upgrade authority. If step-9 buffers were ever pre-staged under that key, a deploy retry destroys them. *Evidence if wrong:* a ruling that the deploy wallet is the intended funder; otherwise none. *Fix:* a dedicated rehearsal funding key (refuse the deploy wallet instead of requiring it); close only buffers the driver itself recorded (`solana program show --buffers` filtered by the step's record), or none.

**F-2 (LOW, fixable layer) — the alarm steps may route rehearsal pages into production streams; the record calls them PASS regardless of what they found.**
`alarmStep` runs `job('alarm.mjs', [], {})` with `CBOB_ALARM_REHEARSAL=1` and `CBOB_REHEARSAL_NOTIFY=<script>`, with no `--dry-run` and no `ALERT_STATE_DIR`/`ALERT_LOG`. SPEC item 53 still says the alarm's rehearsal notices "go to the same alert router under the same `cbob-vault-alarm:<kind>` labels, so run it either `--dry-run`, or with … `ALERT_STATE_DIR` and `ALERT_LOG` pointed at a rehearsal directory". Whether `bank/alarm.mjs` and the router honour `CBOB_REHEARSAL_NOTIFY` is not shown in this bundle. Separately, `writeRecord` marks item 22.2 PASS whenever two alarm passes exited 0 and printed REHEARSAL, whatever findings they raised. *Evidence if wrong:* `grep -n CBOB_REHEARSAL_NOTIFY bank/alarm.mjs scripts/notify*` showing the alarm's own notice path reads it. *Fix:* pass `--dry-run` or the rehearsal state/log dirs explicitly from the driver; record the findings list in the item-22.2 verdict and fail on `run_failed`/unexpected CRITICAL.

**F-3 (INFO) — item 22.1 is recorded PASS by a five-vault rehearsal.** Item 22 scopes the crank's live I/O to "~2,100 vaults (cost, rate limits, paging, a transient RPC error on vault 1,900 of 2,100, the every-minute reveal lane keeping up)". `crank-full` passes once vault-1 is active and two epochs have advanced. The record will say PASS for a scale that was not exercised. *Fix:* name the scale in the record, and either seed ~2,000 synthetic records on the local proof (as `expiry-budget.mjs` does) or mark 22.1 "PASS at 5 vaults; scale untested".

**F-4 (INFO) — small driver defects.** (i) `profile()` sets `rpc: ctx.A.rpc`, the unresolved literal `'box'` when `--rpc box` is used, so `coreAssetsOwnedBy`'s DAS leg always throws and the crack exercises only the "could not look for compressed NFTs" branch; use `ctx.A.rpcResolved`. (ii) `revenueCycle(1).done` requires `closedCycles()[0].swapVenue === 'orca'`; if Orca naturally refuses once, the step can never read done and will loop/refuse on resume. (iii) `sweep-back` ignores `pob-authority` and `cbob-release` and the holder's rehearsal-$CBOB ATA rent (pennies, but the step's title claims "every token and lamport"). (iv) `fill-values` re-reads the unfilled template on a re-run; `launchWithCollection` repairs `vault_collection` from `st.collection`, so it is harmless today but fragile.

**F-5 (INFO) — a stray marker relabels production.** The crank and revenue job "need no flag": a `REHEARSAL-RECORD.txt` at the production root makes every notice they send carry `…-rehearsal:*` and say REHEARSAL, with no detector for the contradiction (rehearsal marker + mainnet program ids). An operator reading REHEARSAL ignores a real CRITICAL. *Fix:* the alarm pages `rehearsal_marker_in_production` when `inRehearsalTree()` and `PROGRAM_IDS` equal the mainnet ids.

Noted, not a finding: the rehearsal's `INIT` key is a public seed and sits in `rehearsal-init.json`; a front-runner can initialise the rehearsal programs first with hostile values. The design handles it (`broken()` stops before any token moves; new ids). The window is deploy→initialize, seconds.

---

## R1. Custody

Re-derived, not assumed:
- SEAL walks `current+1..` forward and requires a top-level `burn_vault` with `accounts[0] == asset && accounts[2] == owner`; BURN walks `0..current` backward for a top-level `open_for_redemption` with the same two positions. `BurnVault` is (vault_asset, collection, owner, …) and `OpenForRedemption` is (vault_asset, collection, owner, …): indices 0 and 2 are right in both directions. `load_instruction_at_checked` reports the outer index for a CPI, so wrappers fail both ways (WR.2/WR.3 measured).
- Two vaults in one transaction pair by (asset, owner) each; the mid-transaction transfer attack (open by A, transfer to B, burn) reverts because BURN re-reads the owner bytes at burn time and requires the signer to equal them.
- The thaw cannot survive: there is no instruction that returns from `open_for_redemption` without the `found` requirement, and nothing after the burn can act on a 1-byte tombstone.
- BURN's emptiness proof: both ATA derivations of each reserve mint must be *declared*; a declared address that no token program owns is skipped (correct, because the ATA address is a PDA of the ATA program and R34.G2 shows nobody else can place an account there; F4.2 shows a Token-2022 ATA for a classic mint cannot be created). Delegate, delegated_amount and close-authority bytes are checked in both loops. Undeclared non-ATA accounts are destroyed, as limit 44 says.
- `retire_redeemed`: stack height 2 + instructions-sysvar check that the current top-level instruction is BURN `burn_vault` whose `accounts[0]` is this asset. `WR.1` and `P.23` measure the two refusals.

No defect.

## R1s. The sweep helper

- **(a)** Called directly it needs the asset-signer's signature (SR.1). Through Core, SR.5/SR.5a/SR.5c pin `NoApprovals` for a stranger, an owner-added TransferDelegate and a collection update authority on a thawed vault; the AgentIdentity adapter cannot be added by anyone but the registry PDA (R24.1a/1c). A frozen vault cannot reach it at all (3.7, 0x9). So: only the owner, only inside a genuine open. Correct.
- **(b)** `signer == dest` refused; source twice → second close fails `Provided owner is not allowed` (SR.12a); source == destination impossible (`to_owner` would be the signer, not `dest`); (A,B)+(B,A) impossible by the same ownership contradiction; frozen source reverts (SR.14); kept close authority reverts (R36.C5); odd count refused (SR.7). A native wSOL source is a 165-byte classic account and would behave like any other; not measured (round 43 carry).
- **(c)** Only the owner can build the Execute, so the destination is the owner's choice. A non-System destination is credited fine (R27.S1); a sub-rent credit to a non-existent address is refused by the runtime (R41.C8a), which is why the canonical destination is the fee-paying owner.
- **(d)** The helper reads `signer.lamports()` after its closes (so closed-account rent that went to `dest`, not `signer`, cannot be left behind), transfers all of it, and BURN re-reads `asset_signer.lamports()` at burn time. SR.4a/SR.13 pin the whole-balance log and a 0 read. Nothing but the owner's own later instruction could re-fund the PDA inside the transaction.
- **(e)** The prior-transaction rule is sufficient: a stranger can only create the *classic ATA*, which the page always names (idempotent create first); a Token-2022 ATA for a classic mint cannot exist; a non-ATA token account or nested Core asset is undeclared, which BURN ignores rather than refuses — destroyed or acknowledged, never a block. The only blockers that remain are a Coinbase freeze and the rate limit, both stated.
- **(f)** S8.0 asserts `B ≤ 1232−52−96`; measured 1,061 with the owner paying and no compute-budget instructions. The widest page shape (1,209) leaves 23 bytes; a fourth reserve is impossible by program (`MAX_RESERVE_MINTS = 3`); the in-line monthly run inside `retire_redeemed` adds no accounts beyond the pool BURN already passes. One extra C5 transfer (another ExecuteV1 of ~230 bytes) does not fit the padded shape, which `planRedemption` handles by `left`.
- **(g)** `because()` pins name the helper's own `ProgramError` texts measured on this binary; `SR.12b` checks the duplicate refusal came from the second source. `build-mainnet.sh` `cmp`s `dist/`, the localnet rebuild and `target/deploy` for the sweep.

No defect.

## R2 / R2b. The pool and the boost

**Invariant "pool ≥ ceil(owed)" — a proof, not a reading.** `credit`: `delta = ⌊avail·S/w⌋`, `owed += delta·w ≤ avail·S` with `avail = balance − ceil(owed)`, so `owed'/S ≤ owed/S + balance − ceil(owed) ≤ balance`. `claim`: balance falls by `pay` and owed by `pay·S`. `join`/`reweigh`: owed unchanged (`debt = w·acc`, `carry = previous owed`). `retire`: owed falls by exactly the vault's `owed_of` (returned to the pool, or forfeited). `monthly_inline` uses `saturating_sub` and returns on 0; `distribute` refuses `PoolShort`. The host test N1 asserts `owed_scaled == Σ owed_of` across 260 epochs through the program's own functions. Nothing moves pool tokens except `claim` with the config PDA's seeds.

Counters: `pending_count`/`pending_this_epoch` move in `activate`, `advance_epoch`, `join`, `retire` (with the same-epoch branch), and nowhere else; `waiting_to_join` cannot underflow. Boost: ring slot `(e+N) % 64` with `N ≤ 63` is never the slot `advance_epoch` just zeroed; `unschedule_boost` chooses due-vs-ring correctly; `expire_boost` reweighs at the accumulator its last distribution left because `BoostsExpireFirst` and the inline run's early return forbid any credit past a due boost; `BO.21/BO.35` fix the off-by-one in both orders. `expire_boosts` needs only writable records, so no token account can make expiry (hence distribution) impossible.

Liveness: `JoinWaitingFirst` and `BoostsExpireFirst` are both clearable by anyone for a fee with nothing but records (and the recorded `vault_ata` *key*, whose account need not exist — `join` never reads `dest`). Round 24 W11's "weaker rule" is the one the code enforces: a vault never earns from a distribution before it joined; it does share whatever is undistributed when it joins (3c.A6a shows the backlog case) and unsplit revenue (limit 55).

No defect. Known residues (27, 28, 36, 55) are as stated.

## R3. The draw

`blockhash_in_window` pins the sysvar id, bounds `n ≤ 512`, bounds the buffer, refuses an all-zero hash, and takes the smallest produced slot in `[want, want+64]`; `try_capture` returns `NotYet` while any of A/B/C is unproduced and `Expired` past 300; C ≤ reveal+216 < 300 and A is never older than `now−512`, so a capture inside the window always finds all three. Reschedule targets `now+16`, a slot that cannot yet have a hash. FIFO: `reveal_level` requires `index == revealed_total`; a burned head still draws (L.11). Attribute re-supply is hash-pinned over the Borsh `Vec` both at mint and at reveal, and the Attributes plugin authority is MINT's PDA (11.13/11.14). What a minter (lapse-for-reroll), a crank operator (withhold capture) and C's leader (choose among draws) can do is as limits 25/26 state; I find it no worse. HOLDER-GUIDE's "can pick among several results, by skipping a block or changing what goes into it … affects every vault created in that moment" is true of the code.

## R4. Governance

`KeyChangeNeedsHalf` is ⌈50%⌉ of `quorum_supply` at creation; `KeyChangesBundled`; notice via permissionless apply with no apply-by deadline (SPEC says so); `cancel_swap_operator` touches only a pending operator; per-kind ordering marks move before the "already over" skip (3c.R1); `StopIsNewer` is mirrored exactly (`>=` in GOV, `<` in MINT). Offsets GOV reads (41, 141, 191, 192, 257, 266, 274, 442, 454, 518, 526, 631, 639, 647, 711, 712) all recompute from the struct (my full map is in R7). No way for a minority to carry a key change below half; no action reaches the split, destinations, supply, royalty or a vault. Limit 47's "permanent at low turnout" is the worst case I can construct, with one unstated compound noted under the limits.

## R5. The charter claim

Address identity via a domain-separated, sorted Merkle tree; promotion of an odd last node in `pob-merkle.mjs` is consistent with a verifier that never checks depth and is not forgeable without a preimage; `MAX_POB_PROOF = 16` covers depth 8. Owner-bytes check, collection check, CPI burn as owner with `pob_extra` never signers, window by clock, no guardian gate. SPEC 46 covers rejection, selective admission (collection, per-asset, oracle flipping), moving a PoB out of the collection, the sampling blind spot, and the positive bound (no transfer/burn by the UA, measured R32.A22a). I could add nothing that wallet can do beyond those.

## R6. One-time configuration, the trusted hop, the royalty, the cap

`initialize` refuses the launch-wedging values the checker also refuses; what it does *not* refuse (off-curve guardian/operator, duplicate or non-mint reserve "mints" in SEAL, a 1-second cooldown, a 10-second window) is pinned by `check-launch-params.mjs`, and SPEC 38 says so. The royalty plugin is installed with `PluginAuthority::None`; R.6/R.6a/R33.G3 measure that update, removal and re-delegation are refused and R.8 that an owner cannot add an asset-level override. The rate limit is a true rolling window: `k = min(cap,64)`, `kth = ring[(head+64−k)%64]`, admit iff `now − kth ≥ window`; initial zeros read as "long ago"; a backwards clock can only refuse. Operator worst case: cap × cooldown windows above the reserve until the guardian stops, or until a 10.71% `TightenSweep` vote (3 days + execute) brings it to 1 SOL/24 h.

## R7. Raw reads

Recomputed every field: MintConfig is 1,005 bytes before padding, with `minted_total` 141, `sales_stopped` 191, `sweep_stopped` 192, `sol_reserve` 257, `max_sweep` 266, `cooldown` 274, `charter_closes_at` 442, `bare_burns_retired` 454, `sales_stopped_at` 518, `sweep_stopped_at` 526, floor/ceilings 631/639/647, `cbob_mint` 679, `max_boost_weight` 711, `max_boost_epochs` 712, ring 749..1005; the `MINT_CONFIG_SPACE` expression sums to the same. VaultRecord 211 (+10): `mint_index` 41, `pending` 177, `request_epoch` 178, `boost_weight` 186, `boost_end_epoch` 187, `carry` 195 — so the proxy's 125..195 slice reads active(0), retired(1), boost_weight(61), boost_end_epoch(62..70) correctly. BurnConfig `burned_total` 42, window 50, head 58, ring 59..571. SEAL `collection` 9, `reserve_mints` 41. GovConfig `proposal_count` 53. Helper: mint 0, owner 32, amount 64, len 165. All agree with the suite's constants and `layout.mjs`'s X.* checks.

## R8. Suite, simulation, build

- Arms that cannot fail: `G.9`'s second leg (`eff ≤ needMinted`) is tautological given `quorum_supply ≤ minted`, but the first leg can fail; `X.7` is honestly relabelled; `RL.1a`, `P.2a`, `3c.K2p`, `IN.0p/1p` are preconditions and say so. I found no arm whose negative is pinned to a reason other than the one named; the `because()` texts for SR.*, R24.*, R36.* name the program that failed.
- Claims in this prompt with no arm: a native-wSOL source and a destination that is another vault's signer (round 43 carry); `split_revenue` into a frozen pool (0x11 expected); `distribute(burn)` with the pool frozen (credits, by reading). All three are measurable and should become arms.
- The suite deploys `target/deploy/cbob_vault_sweep.so`; `build-mainnet.sh` `cmp`s it to `dist/`. Proven.
- Residual: the full suite inside the rehearsal tree last passed at `2e8c979`, before `a3cfd79`/`0d58d4e`; VALIDATION says it is re-run on the final commit. It must be, since `scripts/` and `bank/` changed.

## web/

Every builder I checked matches its program account list and data layout (`openForRedemption`, `burnVault`, `poolClaim`, `coreExecute` against mpl-core's `execute`, `sweepHelper`, `activate`, `rescueNested`, `distribute`, both mints, the four initializes, `coreCreateCollection`, the draw trio). `signExact` refuses a wallet that alters the message and signs page-made keys *after* the wallet. `planRedemption` follows item 50: prior creates; `claim` only when active and the pool is not frozen; all three reserves named; strays routed helper/transfer/left/lost with the C5 and freezable rules; the late-arrival consent and `prepareOpening`'s two-dry-run bound; the coverage cross-check as a refusal only for the unnamed. `rateLimit` mirrors BURN exactly. The proxy's eight `getProgramAccounts` shapes are checked value-for-value and `txRefusal` relays nothing that calls no CBOB program except the three ceremony/setup shapes.

**F-6 (LOW, fixable layer) — the holder bundles are built by a toolchain this repository does not pin.** `web/build.mjs` loads esbuild from `/home/ubuntu/luna-remotion/node_modules/esbuild`, an unrelated project's tree, and the README's hash table and `bundle` test are produced by that same binary, so they cannot detect a tampered bundler. Together with the tracked `node_modules` symlink to `/opt/gary-club/node_modules` and no lockfile in this repo (round 34 recorded the symlink; the esbuild path is new), every transaction a holder signs is assembled by dependencies whose versions and hashes nothing here records. SRI protects transit, not the build. *Evidence if wrong:* a committed lockfile/hash for esbuild and the runtime deps. *Fix:* vendor or lock esbuild and the web deps in-repo with integrity hashes; make `bundle.test` compare against a build on a second machine from the lockfile (reproducibility) before publishing.

---

## The accepted limits: the four questions

**1. Worse than stated?**
- **Limit 10 / 47, compound (INFO).** Each bounds one key by the other: the operator "until the guardian stops it", the guardian "until half of all vaults replace it". Neither states the case where both are hostile or the guardian is unreachable: the thief-guardian cancels every operator arm and never stops the sweep, so royalty SOL leaks at cap×cooldown until an ordinary `TightenSweep` vote (10.71%, 3 days + execution) slows it to 1 SOL/24 h, and fully until a guardian replacement (half of all, +7 days) followed by an operator replacement (half of all, +7 days). The tighten vote is the real fast brake and HOLDER-GUIDE does not name it. Doc only.
- **Limit 32 (INFO).** "blocking one hour costs about 2.1% of live supply in vaults" is true; the dollar figure is not stated: with an open round, 45 empty vaults at the 21,000-sat floor ≈ 0.0095 BTC per blocked hour, and no round means buying on market. Worth a sentence, because it is the cheapest denial a custodial panic would face.
- Everything else I attacked (25, 26, 27, 28, 44, 46, 58, 59) is as stated or narrower.

**2. Not actually a limit / already closed?** Limit 9's "nothing refuses the redemption" is now narrower (the page refuses what the coverage check finds unnamed; it still cannot refuse what it cannot see). Limit 44's "a frozen stray account holding a balance (its transfer reverts)" describes the helper, not the page, which never names a frozen stray; both sentences are true of their subjects. Nothing is listed as a limit that is closed.

**3. DISCHARGED not discharged?** 14 (R42.C8 covers the claim path), 19, 30, 31, 33, 51, 54 and 12/17 are discharged by arms I can point to. None reopens.

**4. OPEN AND BLOCKING quietly accepted?** No. The driver's `NOT-RUN-HERE` for 22.3–22.5 is explicit. Two things must not be quietly waved past: item 53's "re-run at the release commit" has not happened since the driver landed; and F-3 would record item 22.1 as PASS at a scale item 22 does not accept.

---

## Findings, consolidated

| ID | Sev | Where | Class | Fix |
|---|---|---|---|---|
| F-1 | LOW | `rehearsal-run.mjs judgeNoMainnetKeys`, `rehearsal-steps.mjs deploy-N` | none | Dedicated rehearsal funding key; never `close --buffers` wholesale |
| F-2 | LOW | `rehearsal-steps.mjs alarmStep`, SPEC 53 | none | `--dry-run` or rehearsal `ALERT_STATE_DIR`/`ALERT_LOG`; judge findings in 22.2 |
| F-6 | LOW | `web/build.mjs` esbuild path; unpinned deps | none | Lock + hash the bundler and deps in-repo; second-machine reproducible build |
| F-3 | INFO | item 22.1 verdict at 5 vaults | none | Name the scale; synthetic 2,000-record local proof |
| F-4 | INFO | `profile().rpc`, cycle-1 `done`, sweep-back scope, `fill-values` re-read | none | As listed |
| F-5 | INFO | `rehearsal-env.inRehearsalTree` in production | none | Alarm detector for marker+mainnet ids |
| L-10/47 | INFO | SPEC/HOLDER-GUIDE | none | State the compound bound and the tighten vote |
| L-32 | INFO | SPEC 32 | none | State the floor-price cost of spending the cap |

Programs: **0** findings at any severity. Nothing moves or miscredits value; nothing stops or wrongly refuses a crack; nothing HIGH or MEDIUM anywhere. Under SPEC gate 3 this pass is launch-clean on what I can measure, with the caveats in R8 (the rehearsal-tree proof is stale by two commits) and R0 (round 44's quorum rested on one narrowly-counted seat, which is a process fact the next roster should not repeat).

Gate-5 obligations from this pass: arms for `split_revenue` into a frozen pool, `distribute(burn)` with a frozen pool, a native-wSOL source and an other-vault-signer destination in the helper; a selftest that the alarm honours whatever rehearsal notice route F-2 settles on; a test that `web/build.mjs` refuses an esbuild not matching a recorded hash.

---

## What this project should do before launch that AI audit structurally cannot

1. **Decide immutability by stages, not by a switch.** Every round of this process has found something real, and three Core upgrades landed during it. Deploy under an upgrade authority held by a multisig behind a public timelock (14–30 days), run real value at small scale for a full monthly cycle and at least one Core release, *then* remove the authority. Nothing in the holder promise ("crack your vault and take it") depends on day-one immutability; a timelocked authority cannot touch a vault any faster than a vote can. This is the one decision that converts a permanent bug into a repairable one, and no model can take it for you.
2. **Rehearse at scale on mainnet, with adversaries.** Run the driver with ~2,000 synthetic vault records (the expiry-budget pattern) so the crank's paging, the proxy's bounded reads and the alarm's 2,000-read backlog are exercised against a real RPC, and pay a few people to grief the rehearsal deposit addresses and pages while it runs.
3. **Reproduce the bytes on a second machine owned by a second person.** `build-mainnet.sh` proves which key a binary rejects; only an independent rebuild from the release commit proves the deployed `.so` is this source. Do the same for the web bundles (F-6).
4. **Rehearse the humans.** Walk the hand-recovery runbook, the guardian stop, the Squads return of a rescued vault and a Coinbase-freeze day as drills with the people who will do them, timed, with the wrong RPC and a dead crank injected. Give five non-technical holders HOLDER-GUIDE and the redeem page on a 375 px phone and watch where they get it wrong.
5. **Reduce what the box holds.** The swap-operator key, the $CBOB release wallet, the deploy authority, the alarm, the ledger and the cron all live under one user. Move the release wallet and the deploy authority off the box before launch, and keep a cold copy of the deploy authority until step 11.
6. **Fuzz the money paths in SBF.** The host tests cover the ring and the entropy reader; a property-based run of `credit/claim/join/reweigh/retire` over random sequences with the invariant `pool ≥ ceil(owed) ∧ owed == Σ owed_of` executed in the real runtime (Trident or a plain `solana-program-test` loop) would close the one class of defect that reading cannot: arithmetic that is right in every case anyone thought to write down.