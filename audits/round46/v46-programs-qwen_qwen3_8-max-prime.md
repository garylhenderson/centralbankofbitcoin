# Round 46 — independent confirmation pass (read-only)

## Method, stated first so every claim below is weighted correctly

I had **source only**. I ran nothing: no validator, no suite, no detectors, no sim, no e2e, no driver, no live RPC. Everything below is inspection and cross-derivation against the bundled source at the audited head. Where round 45's evidence is a *measurement* (the 912-assertion suite, the 1032-detector selftest, the sim, the fork, the driver's local proof), I am **confirming the code matches what those measurements describe**, not re-measuring. That is a strictly weaker guarantee than a measuring round, and I say so rather than papering it.

Files I could **not** inspect because they are not in this pass's bundle: `bank/crank.mjs`, `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/revenue.mjs`, `bank/swap.mjs`, `bank/layout.mjs`, `bank/selftest.mjs`, `bank/lock.mjs`, `bank/spl.mjs`, `bank/accrual.mjs`, `bank/redemption-poster.mjs`. This matters for verifying the round-45 **off-chain** repairs (see OBS-1).

---

## R0 — Round 45's confirmed findings: repair verification

I re-read each repair site. All eleven driver repairs are present in the bundled source:

| R45 finding | Repair present? | Where (file:construct) |
|---|---|---|
| **V45-1** item-22 predicates | **Yes** | `rehearsal-steps.mjs` `revenue-forced-alarm` waits `ALARM_GRACE_MS + 60_000` then requires `judgeForcedFailureAlarm` = `[unreconciled_swap]`; `das-read` uses `judgeDas` (boolean-only PASS); `alarm-pass-N` uses `judgeAlarmPass` (FAIL on exit 2/3 or unexplained CRITICAL). `rehearsal-run.mjs` defines all three judges. |
| **V45-2** RPC key in argv | **Yes** | `solanaCli` builds via `solanaArgv(ctx.cliConfig, argv)` = `['--config', configPath, …]`; the 600 config file carries `json_rpc_url`; `judgeArgv` refuses any http(s) secret in argv; config deleted on `process.on('exit')`. I searched for other `solana` invocations carrying a URL: none in the driver. `token-programs.sh` uses a public no-key URL only. |
| **V45-3** deploy key tied to judged id | **Yes** | each `deploy-N` calls `judgeDeployKey({keypairPubkey, programs, deployer, funding})` before sending; refuses mainnet id, mismatch vs `ctx.programs[k]`, deployer==funding, deployer==`DEPLOY_WALLET`. Buffer close is per-recorded-buffer via `bufferCloseArgv`, not `--buffers`. |
| **V45-4** rescue resume | **Yes** | `rescue` step is `{resumable:true}`, re-reads `assetOf(vault-3)` and sends only the missing leg; both Core transfers go through `send()` (signature recorded). |
| **V45-5** cycle venue order | **Yes** | `revenueCycle.done` = `closedCycles().length >= n`; `judgeRevenueCycles` requires one closed Orca **and** one closed Meteora cycle regardless of order. |
| **V45-6** init window / verify gate | **Yes** | prep steps (`keys`…`fill-values`) precede `deploy-*`; `requiresVerified` blocks any step after `verify-configs` until `st.configsVerified`. |
| **V45-7** `'box'` DAS URL + sweep-back scope | **Yes** | `profile()` uses `ctx.A.rpcResolved`; `sweep-back` title states what stays behind and iterates all roles incl. `cbob-release`. |
| **V45-8** 22.1 scale | **Yes** | `crank-full` records `'PASS at 5 vaults (scale not exercised)'`. |
| **V45-9** SPEC 53 alarm text | **Yes** (in the SPEC excerpt bundled) | item 53 now names `CBOB_REHEARSAL_NOTIFY`. |
| **V45-10** hand-recovery sigs | **Yes** | `rehearsal-recover.mjs` `sendRecorded` writes `c[field]=sig; save()` **before** `sendRawTransaction`. |
| **V45-11** collection create check | **Yes** | `ceremony-collection` uses `checkNewAddress` and swaps to a fresh key on `taken`. |

I re-checked the claims round 45 **disproved** and found no basis to revive them: MiMo's BURN close-authority offset (129 is the tag; 121–129 is checked separately at `burn/src/lib.rs`), Muse's 0.1-SOL-per-step funding (web3.js passes `accounts` through the third `simulateTransaction` arg), and the "rehearsal notice leaks into production streams" worry (every alarm notice routes through `NOTIFY`, which the driver points at `.rehearsal-run/notify.sh`).

**OBS-1 — INFO (verification gap, not a defect).** The round-45 **off-chain** repairs V45o-1…V45o-6 live in `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/crank.mjs`, `bank/revenue.mjs`, none of which are in this pass's bundle. I verified only `bank/rehearsal-env.mjs`: `refuseStrayOverrides`/`rehearsalOnly` throw when a rehearsal override is set outside a recorded tree, and `REHEARSAL_OVERRIDES` enumerates all four knobs. I could **not** inspect the jobs' call sites. I rely on `VALIDATION.md`'s mutation-revert statement. *Evidence that would confirm it:* grep each job for a `refuseStrayOverrides(...)` (or equivalent) call at module load before any RPC read/send. Recommend that grep be recorded before deploy.

---

## Targets R1–R8 — what I re-derived from source

**R1 (custody / pairing).** Re-read SEAL `open_for_redemption` and BURN `burn_vault`. Both walk the instructions sysvar top-level-only, bind **asset and owner** positionally (SEAL `BURN_IX_ASSET_IDX=0`/`OWNER_IDX=2`; BURN `SEAL_IX_*` mirror), and fail closed on drift. `retire_redeemed` enforces `get_stack_height()==TRANSACTION_LEVEL_STACK_HEIGHT+1` plus a top-level `burn_vault` disc+asset match, so a CPI'd retire is refused (suite WR.1). I ran an adversarial pass: no path unseals without a real burn in the same tx; no path burns a vault the signer doesn't own; no path redirects a claim (dest is pinned to `record.vault_ata`). **No new defect.**

**R1s (sweep helper).** Re-read `cbob-vault-sweep`. Access control rests on Core `ExecuteV1` (owner-only) — established by round 25 and the SR.5 arms. Duplicate source is rejected (second `read_token` on a closed account → `IllegalOwner`, SR.12a/b). `signer==dest` refused. Destination need not equal the asset owner, which is safe *because* only the owner can invoke. Reserve ATAs closed by the sweep pass BURN's proof via the `owner`/`len` `continue` branches; SPL `CloseAccount` requires zero balance, so a not-fully-transferred account cannot close. Reserve ATAs cannot carry a stranger-held close authority (only the owner PDA can set it post-create), so the C5 close-revert problem is confined to **non-reserve** strays, exactly as documented. **No new defect.**

**R2 / R2b (pool, boost).** Re-derived `reweigh`/`owed_of`/`expire_boost`/`credit`/`join`. Boost preserves owed via `carry`, resets `debt = new_weight*acc`; `owed_of = weight*acc + carry − debt`. `BoostsExpireFirst` and `JoinWaitingFirst` gates hold. This is the most heavily tested code in the tree (suite BO, P, 3c; host_tests ring-wrap). **No new defect found by inspection.**

**R3 (draw).** Three slot-hash construction, FIFO reveal, reschedule-not-default — consistent with SPEC 25/26 and suite L/RL. The C-leader grinding residual is accepted limit 26, correctly stated. **No new defect.**

**R4 (governance).** Snapshot-at-creation (`index_snapshot`, `quorum_supply`), one-vote-per-asset PDA, key-change ≥50% of snapshotted live supply, guardian/operator never bundled, per-kind ordering with logged skips. Low-turnout permanent guardian-stop is accepted limit 47, correctly stated. **No new defect.**

**R5 (charter claim).** Merkle leaf/node domain separation (0x00/0x01, sorted) matches between `pob-merkle.mjs` and `merkle_leaf`/`merkle_root_from`; window enforced by clock only; PoB burned by CPI; `pob_extra` pass-through bounded. Hot-update-authority exposure is accepted limit 46, correctly stated. **No new defect.**

**R6 (one-time config).** I checked every `launch/mainnet-init.json` value against the `initialize` bounds in all four programs (sweep floor/cap/cooldown/reserve/ceiling relations, level caps sum ≤ max_supply with none zero, charter/monthly/notice/voting ranges, quorum/threshold, boost ceilings). **All pass.** The checker-vs-program gap (SEAL reads only owners; off-curve keys accepted; `redeem_window` 10s–24h) is documented in SPEC 38 A6 and is a pre-signing-check responsibility, not a program defect.

**R7 (raw offsets).** I recomputed the MintConfig field offsets from the struct: `minted_total=141`, `bare_burns_retired=454`, `sales_stopped_at=518`, `sweep_floor=631`, `cooldown_ceiling=639`, `reserve_ceiling=647`, `max_boost_weight=711`, `max_boost_epochs=712`, `governance=41`, `charter_closes_at=442`. **All match** the constants in GOV/BURN. This agrees with round 45's R7 table.

**R8 (suite/sim/build as evidence).** I read `tests/3prog.test.ts`, `sim/test-vault.ts`, `scripts/build-mainnet.sh`, `tests/initauth.test.ts`. The floors equal the stated counts (912, 1032, 695, 68, 24, 39, 71, 132, 35, 4). The `because()` reason-pinning and wrong-reason guards are present. I could not **run** them (see OBS-2).

---

## Findings

**No CRITICAL, HIGH, MEDIUM, or LOW confirmed in the five programs, the web pages, or the in-bundle rehearsal driver.** Nothing I found moves value out of a vault/pool/revenue address, miscredits value, or stops/wrongly-refuses a crack.

INFO observations (none blocking; all in the fixable/tooling layer):

- **OBS-1** (above): off-chain V45o repairs not verifiable from this bundle.
- **OBS-2 — INFO (epistemic).** This is a read-only confirmation. The positive assurance that the tree still passes comes from the canonical green logs cited in `VALIDATION.md` (`e7c192a-suite.log` 912/912, `e7c192a-web-e2e.log` 132/132, `e7c192a-sim.log` 71/71, detectors 1032/1032), not from anything I executed. A confirming read is not a substitute for a measuring round; treat my pass as corroborating, not as fresh measurement.
- **OBS-3 — INFO (gate-5 carry).** Round 45's repair list obligates persistent suite/selftest **arms** for the item-22 predicates (22.2/22.4/22.5), the deploy-key guard, the buffer-close scope, the rescue resume, the venue-count judge, the hand-recovery sig ordering, and the collection taken-address check. `bank/selftest.mjs` is not in this bundle, so I could not confirm those arms are committed (as opposed to the mutation-revert evidence VALIDATION cites). Recommend recording, before deploy, that each arm exists and fails when its guard is removed.

---

## Accepted limits — the four questions

1. **Any limit worse than stated?** I found none I can support. Limits 26 (C-leader draw choice), 40 (Core upgradeability), 41 (transfer-not-capped), 46 (PoB hot wallet), 47 (low-turnout permanent guardian stop) are stated at their true strength, and the quantifications (round 24 A1 for 26; round 25 D1/D8 for 46/47) match what the code does. I cannot rule out an unstated Core-upgrade consequence beyond limit 40's three, but that is inherent to not controlling Core, not a misstatement.

2. **Any listed limit not actually a limit?** No. Limits 9 and 44 (undeclared/nested value) remain genuinely unclosed **on-chain**; the redeem page mitigates but is staged, and the on-chain programs still destroy undeclared holdings. Limit 29 (only cbBTC splits) still holds. Nothing listed as open is secretly closed.

3. **Any DISCHARGED item not actually discharged?** I spot-checked 51 ($CBOB boost — code present and tested), 54 (compute — measured arms present), 14 (duplicate attributes — `check_attributes` rejects, suite 11.4/R42.C8), 19 (unlevelled halt — `activate` requires `level` drawn; closed by construction), 33 (operator notice — `apply_swap_operator` exercised). All hold in source. None appears falsely discharged.

4. **Any OPEN-AND-BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 all still have genuinely-open components: `charter_opens_at`, `lock_deadline`, and `vault_collection` remain `OPEN`/`null` in `launch/mainnet-init.json`; the pages are staged not published; the pool/Squads ATAs and the dress rehearsal are not yet run. None is being counted as done.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — do these before launch; AI structurally cannot

1. **Execute the mainnet dress rehearsal (item 22) for real.** I can read `rehearsal-run.mjs`; I cannot run it against live mainnet, the real Orca/Meteora pools, a live Pyth price, or DAS. Specifically, complete items 22.3 (one full revenue cycle through **each** venue), 22.4 (forced post-sweep failure walked through the hand recovery to `--audit` clean), and 22.5 (a real DAS `getAsset` of a burned Core asset). The local proof marks these NOT-RUN-HERE; they are the single largest unverified surface.

2. **Have a human physically attest the upgrade-authority removal (road step 11) and the deploy-wallet custody.** AI can verify the *code* that would remove authority; it cannot witness that `solana program set-upgrade-authority <id> --final` was actually run for all five programs, nor that `FZjLB4…`'s key material is controlled. This is a custody act, not a code property.

3. **Do a build-provenance check on a separate machine/toolchain.** Every AI pass, including mine, read the *same* source and the same `dist/` hashes. Rebuild the five `.so` from `RELEASE_COMMIT` on an independent machine and compare sha256 against `dist/SHA256SUMS`, to catch a supply-chain divergence no amount of source-reading sees.

4. **Run a human usability pass on the holder pages once published.** I can verify the pages build byte-identical transactions; I cannot tell whether a real holder understands the "this is lost when the vault is opened" tick-boxes, the forfeit warning, or the deposit-address-vs-NFT-address distinction. The cost of a misunderstood warning is borne by holders, and it is a human-factors question.

5. **Decide the PoB hot-wallet custody for the charter window (limit 46) as an explicit operational act.** Whether that key is held cold or in a multisig through the 7-day window is a human decision the code cannot make; the code only bounds the blast radius after the window closes.

6. **Confirm the off-chain repair call-sites (OBS-1) and the gate-5 arms (OBS-3) by grep/test on the full tree**, so the things I could not see from this bundle are recorded as checked rather than assumed.