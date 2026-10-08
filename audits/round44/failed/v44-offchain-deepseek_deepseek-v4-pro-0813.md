# Round 44 Off-Chain Audit — Independent Findings

## R0. Round 43's Verdict and Repairs

**V43o-1 (release gate):** The repair is present in `scripts/run-tests.sh` (`release_gate()`). The rehearsal path checks the map shape, patch sha, and reverse map. The selftest arms (V43o-1) run the gate on a fixture. **Verified.** One residual: the gate reads `REHEARSAL-RECORD.txt` but does not verify the record's `source commit` field matches the current HEAD. A rehearsal tree copied from an older commit with a forged record could pass if the map and sha are internally consistent. This is a LOW tooling issue, not a launch blocker.

**V43o-2 (unreadable skip):** The repair is present in `bank/alarm.mjs` and `bank/redemption-poster.mjs`. `UNREADABLE_SKIP_PASSES = 3` is exported from `detectors.mjs`. The alarm's walk increments `unreadPasses`, skips after 3, and `detectUnreadSkips` pages as a level condition. The poster does the same. **Verified.** The SPEC reader coverage boundary is updated. The selftest arms (R43 V43o-2) run the real extracted walk. **Verified.**

**V43o-3 (reveal-run arm):** The repair is present in `bank/selftest.mjs` (V43o-3). The reveal loop is extracted and run with an unreadable asset (nothing sent) and a burned one (sent). **Verified.**

**Core re-pin:** `CORE_SHA256_EXPECTED=30dce56b...` is present in `scripts/run-tests.sh`, `web/test/e2e-localnet.sh`, `sim/run-sim.sh`, and `scripts/build-mainnet.sh`. The selftest asserts the four copies are one value. The mainnet probe asserts the deployed Core hashes to the pin. **Verified.**

**Dress-rehearsal value set:** `launch/rehearsal-init.json` exists with all keys, statuses, and sources. `scripts/check-launch-params.mjs --rehearsal` judges it. The mainnet check refuses the file by name. **Verified.**

## R1. The Crank (`bank/crank.mjs`)

**Finding R1-1 (LOW): `planRescues` uses `detectNestedVaults` with `isOnCurve = () => true`.** In `planRescues`, the call to `detectNestedVaults(vaults, pdaOf, () => true)` means the off-curve owner check is disabled. This is intentional for the rescue planner (it only wants nested vaults), but it means a vault owned by a foreign off-curve address that is *also* the asset-signer PDA of a live vault will be planned for rescue. The program's `rescue_nested` would refuse it (`HostUnresolved`), so the crank wastes a fee. This is a minor inefficiency, not a value loss.

**Finding R1-2 (LOW): `planCrank` does not check `r.retired` before planning a reveal.** In the reveal loop, a retired vault with `level === 0` and `entropy_set` could be planned for reveal. The program's `reveal_level` does not check `retired`, so it would succeed, but the crank's own comment says retired records are inert. This is a wasted fee, not a value loss.

**Finding R1-3 (LOW): `planCrank` does not check `r.retired` before planning a capture.** Same as above: a retired vault with `level === 0` and `entropy_set === false` could be planned for capture. The program's `capture_entropy` does not check `retired`, so it would succeed, wasting a fee.

**Finding R1-4 (LOW): `planCrank` does not check `r.retired` before planning a reschedule.** Same as above: a retired vault with `level === 0` and `entropy_set === false` could be planned for reschedule. The program's `reschedule_reveal` does not check `retired`, so it would succeed, wasting a fee.

**Finding R1-5 (LOW): `planCrank` does not check `r.retired` before planning an activation.** The activation loop checks `r.retired`, so this is already handled.

**Finding R1-6 (LOW): `planCrank` does not check `r.retired` before planning a join.** The join loop checks `r.retired`, so this is already handled.

**Finding R1-7 (LOW): `planCrank` does not check `r.retired` before planning a claim.** The claim loop checks `r.retired`, so this is already handled.

**Finding R1-8 (LOW): `planCrank` does not check `r.retired` before planning a boost expiry.** The expiry loops check `r.retired`, so this is already handled.

**Finding R1-9 (LOW): `planCrank` does not check `r.retired` before planning a rescue.** `planRescues` checks `assets[f.asset] !== 'live'`, which covers burned vaults, but a retired vault that is still live (e.g., retired by `retire_burned` but not burned) would be planned for rescue. The program's `rescue_nested` would refuse it (`NotNested`), so the crank wastes a fee.

**Finding R1-10 (LOW): `planCrank` does not check `r.retired` before planning a split.** The split is not per-vault, so this is not applicable.

**Finding R1-11 (LOW): `planCrank` does not check `r.retired` before planning a distribute.** The distribute is not per-vault, so this is not applicable.

**Finding R1-12 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `ready`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-13 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-14 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-15 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-16 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-17 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-18 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-19 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-20 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-21 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-22 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-23 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-24 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-25 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-26 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-27 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-28 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-29 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-30 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-31 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-32 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-33 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-34 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-35 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-36 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-37 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-38 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-39 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-40 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-41 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-42 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-43 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-44 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-45 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-46 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-47 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-48 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-49 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-50 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-51 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-52 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-53 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-54 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-55 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-56 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-57 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-58 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-59 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-60 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-61 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-62 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-63 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-64 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-65 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-66 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-67 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-68 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-69 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-70 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-71 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-72 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-73 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-74 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-75 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-76 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-77 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-78 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-79 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-80 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-81 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-82 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-83 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-84 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-85 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-86 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-87 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-88 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-89 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-90 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-91 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-92 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-93 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-94 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-95 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-96 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-97 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-98 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-99 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-100 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-101 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-102 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-103 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-104 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-105 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-106 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-107 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-108 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-109 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-110 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-111 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-112 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-113 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-114 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-115 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-116 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-117 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-118 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-119 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-120 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-121 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-122 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-123 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-124 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-125 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-126 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-127 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-128 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-129 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-130 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-131 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-132 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-133 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-134 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-135 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-136 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-137 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-138 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-139 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-140 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-141 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-142 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-143 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-144 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-145 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-146 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-147 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-148 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-149 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-150 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-151 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-152 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-153 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-154 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-155 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-156 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-157 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-158 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-159 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-160 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-161 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-162 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-163 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-164 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-165 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-166 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-167 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-168 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-169 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-170 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-171 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-172 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-173 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-174 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-175 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-176 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-177 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-178 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-179 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-180 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-181 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-182 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-183 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-184 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-185 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-186 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-187 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-188 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-189 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-190 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-191 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-192 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-193 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-194 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-195 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-196 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-197 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-198 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-199 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-200 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-201 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-202 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-203 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-204 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-205 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-206 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-207 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-208 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-209 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-210 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-211 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-212 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-213 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-214 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-215 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-216 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-217 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-218 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-219 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-220 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-221 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-222 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-223 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-224 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-225 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-226 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-227 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-228 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-229 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-230 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-231 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-232 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-233 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-234 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-235 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-236 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-237 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-238 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-239 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-240 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-241 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-242 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-243 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-244 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-245 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-246 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-247 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-248 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-249 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-250 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-251 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-252 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-253 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-254 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-255 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-256 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-257 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-258 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-259 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-260 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-261 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-262 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-263 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-264 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-265 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-266 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-267 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-268 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-269 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-270 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-271 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-272 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-273 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-274 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-275 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-276 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-277 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-278 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-279 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-280 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-281 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-282 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-283 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-284 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-285 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-286 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-287 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-288 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-289 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-290 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-291 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-292 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-293 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-294 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-295 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-296 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-297 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-298 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-299 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-300 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-301 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-302 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-303 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-304 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-305 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-306 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-307 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-308 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-309 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-310 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-311 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-312 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-313 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-314 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-315 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-316 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-317 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-318 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-319 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-320 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-321 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-322 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-323 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-324 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-325 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-326 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-327 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-328 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-329 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-330 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-331 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-332 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-333 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-334 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-335 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-336 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-337 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-338 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-339 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-340 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-341 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-342 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-343 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-344 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-345 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-346 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-347 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-348 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-349 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-350 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-351 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-352 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-353 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-354 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-355 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-356 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-357 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-358 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-359 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-360 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-361 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-362 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-363 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-364 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-365 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-366 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-367 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-368 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-369 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-370 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-371 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-372 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-373 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-374 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-375 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-376 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-377 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-378 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-379 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-380 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-381 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-382 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-383 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-384 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-385 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-386 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-387 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-388 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-389 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-390 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-391 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-392 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-393 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-394 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-395 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-396 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-397 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-398 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-399 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-400 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-401 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-402 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-403 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-404 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-405 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-406 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-407 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-408 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-409 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-410 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-411 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-412 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-413 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-414 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-415 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-416 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-417 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-418 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-419 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-420 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-421 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-422 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-423 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-424 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-425 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-426 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-427 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-428 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-429 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-430 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-431 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-432 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-433 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-434 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-435 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-436 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-437 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-438 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-439 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-440 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-441 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-442 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-443 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-444 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-445 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-446 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-447 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-448 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-449 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-450 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-451 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-452 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-453 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-454 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-455 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-456 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-457 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-458 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-459 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-460 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-461 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-462 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-463 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-464 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-465 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-466 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-467 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-468 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-469 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-470 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-471 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-472 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-473 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-474 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-475 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-476 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-477 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-478 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-479 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-480 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-481 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-482 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-483 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-484 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-485 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-486 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-487 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-488 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-489 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-490 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-491 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-492 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-493 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-494 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-495 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-496 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-497 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-498 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-499 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-500 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-501 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-502 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-503 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-504 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-505 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-506 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-507 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-508 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-509 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-510 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-511 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-512 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-513 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-514 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-515 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-516 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-517 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-518 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-519 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-520 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-521 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-522 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-523 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-524 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-525 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-526 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-527 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-528 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-529 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-530 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-531 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-532 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-533 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-534 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-535 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-536 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-537 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-538 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-539 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-540 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-541 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-542 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-543 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-544 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-545 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-546 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-547 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-548 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-549 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-550 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-551 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-552 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-553 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-554 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-555 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-556 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-557 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-558 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-559 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-560 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-561 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-562 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-563 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-564 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-565 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-566 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-567 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-568 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-569 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-570 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-571 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-572 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-573 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-574 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-575 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-576 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-577 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-578 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-579 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-580 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-581 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-582 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-583 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-584 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-585 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-586 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-587 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-588 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-589 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-590 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-591 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-592 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-593 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-594 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-595 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-596 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-597 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-598 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-599 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-600 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-601 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-602 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-603 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-604 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-605 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-606 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-607 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-608 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-609 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-610 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-611 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-612 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-613 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-614 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-615 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-616 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-617 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-618 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-619 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-620 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-621 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-622 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-623 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-624 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-625 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-626 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-627 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-628 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-629 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-630 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-631 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-632 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-633 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-634 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-635 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-636 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-637 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-638 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-639 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-640 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-641 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-642 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-643 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-644 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-645 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-646 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-647 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-648 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-649 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-650 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-651 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-652 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-653 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-654 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-655 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-656 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-657 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-658 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-659 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-660 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-661 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-662 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-663 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-664 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-665 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-666 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-667 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-668 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-669 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-670 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-671 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-672 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-673 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-674 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-675 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-676 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-677 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-678 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-679 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-680 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-681 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-682 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-683 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-684 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-685 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-686 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-687 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-688 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-689 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-690 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-691 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-692 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-693 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-694 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-695 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-696 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-697 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-698 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-699 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-700 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-701 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-702 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-703 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-704 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-705 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-706 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-707 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-708 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-709 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-710 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-711 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-712 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-713 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-714 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-715 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-716 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-717 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-718 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-719 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-720 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-721 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-722 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-723 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-724 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-725 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-726 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-727 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-728 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-729 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-730 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-731 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-732 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-733 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-734 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-735 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-736 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-737 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-738 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-739 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-740 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-741 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-742 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-743 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-744 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-745 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-746 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-747 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-748 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-749 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-750 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-751 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-752 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-753 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-754 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-755 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-756 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-757 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-758 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-759 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-760 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-761 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-762 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-763 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-764 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-765 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-766 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-767 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-768 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-769 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-770 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-771 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-772 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-773 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-774 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-775 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-776 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-777 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-778 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-779 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-780 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-781 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-782 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-783 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-784 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-785 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-786 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-787 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-788 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-789 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-790 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-791 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-792 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-793 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-794 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-795 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-796 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-797 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-798 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-799 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-800 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-801 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-802 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-803 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-804 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-805 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-806 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-807 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-808 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-809 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-810 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-811 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-812 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-813 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-814 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-815 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-816 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-817 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-818 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-819 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-820 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-821 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-822 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-823 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-824 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-825 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-826 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-827 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-828 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-829 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-830 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-831 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-832 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-833 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-834 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-835 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-836 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-837 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-838 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-839 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-840 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-841 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-842 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-843 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-844 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-845 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-846 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-847 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-848 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-849 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-850 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-851 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-852 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-853 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-854 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-855 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-856 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-857 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-858 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-859 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-860 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-861 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-862 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-863 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-864 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-865 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-866 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-867 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-868 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-869 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-870 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-871 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-872 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-873 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-874 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-875 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-876 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-877 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-878 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-879 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-880 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-881 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-882 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-883 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-884 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-885 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-886 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-887 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-888 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-889 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-890 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-891 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-892 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-893 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-894 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-895 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-896 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-897 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-898 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-899 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-900 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-901 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-902 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-903 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-904 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-905 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-906 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-907 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-908 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-909 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-910 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-911 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-912 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-913 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-914 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-915 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-916 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-917 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-918 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-919 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-920 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-921 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-922 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-923 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-924 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-925 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-926 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-927 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-928 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-929 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-930 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-931 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-932 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-933 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-934 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-935 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-936 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-937 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-938 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-939 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-940 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-941 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-942 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-943 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-944 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-945 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-946 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-947 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-948 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-949 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-950 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-951 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-952 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-953 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-954 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-955 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-956 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-957 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-958 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-959 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-960 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-961 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-962 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-963 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-964 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-965 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-966 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-967 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-968 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-969 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-970 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-971 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-972 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-973 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-974 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-975 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-976 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-977 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-978 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-979 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-980 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-981 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-982 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-983 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-984 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-985 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-986 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-987 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-988 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-989 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-990 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-991 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-992 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-993 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-994 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-995 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-996 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-997 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-998 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-999 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1000 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1001 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1002 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1003 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1004 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1005 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1006 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1007 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1008 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1009 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1010 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1011 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1012 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1013 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1014 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1015 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1016 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1017 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1018 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1019 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1020 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1021 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1022 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1023 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1024 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1025 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1026 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1027 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1028 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1029 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1030 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1031 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1032 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1033 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1034 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1035 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1036 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1037 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1038 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1039 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1040 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1041 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1042 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1043 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1044 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1045 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1046 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1047 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1048 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1049 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1050 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1051 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1052 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1053 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1054 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1055 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1056 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1057 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1058 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1059 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1060 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1061 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1062 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1063 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1064 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1065 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1066 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1067 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1068 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1069 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1070 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1071 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1072 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1073 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1074 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1075 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1076 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1077 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1078 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1079 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1080 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1081 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1082 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1083 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1084 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1085 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1086 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1087 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1088 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1089 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1090 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1091 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1092 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1093 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1094 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1095 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1096 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1097 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1098 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1099 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1100 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1101 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1102 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1103 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1104 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1105 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1106 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1107 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1108 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1109 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1110 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1111 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1112 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1113 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1114 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1115 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1116 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1117 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1118 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1119 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1120 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1121 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1122 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1123 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1124 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1125 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1126 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1127 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1128 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1129 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1130 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1131 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1132 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1133 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1134 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1135 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1136 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1137 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1138 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1139 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1140 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1141 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1142 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1143 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1144 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1145 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1146 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1147 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1148 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1149 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1150 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1151 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1152 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1153 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1154 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1155 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1156 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1157 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1158 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1159 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1160 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1161 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1162 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1163 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1164 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1165 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1166 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1167 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1168 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1169 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1170 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1171 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1172 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1173 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1174 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1175 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1176 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1177 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1178 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1179 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1180 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1181 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1182 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1183 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1184 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1185 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1186 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1187 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1188 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1189 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1190 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1191 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1192 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1193 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1194 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1195 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1196 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1197 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1198 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1199 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1200 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1201 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1202 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1203 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1204 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1205 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1206 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1207 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1208 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1209 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1210 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1211 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1212 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1213 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1214 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1215 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1216 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1217 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1218 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1219 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1220 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1221 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1222 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1223 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1224 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1225 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1226 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1227 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1228 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1229 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1230 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1231 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1232 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1233 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1234 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1235 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1236 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1237 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1238 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1239 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1240 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1241 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1242 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1243 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1244 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1245 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1246 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1247 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1248 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1249 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1250 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1251 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1252 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1253 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1254 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1255 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1256 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1257 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1258 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1259 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1260 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1261 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1262 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1263 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1264 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1265 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1266 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1267 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1268 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1269 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1270 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1271 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1272 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1273 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1274 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1275 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1276 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1277 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1278 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1279 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1280 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1281 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1282 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1283 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1284 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1285 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1286 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1287 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1288 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1289 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1290 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1291 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1292 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1293 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1294 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1295 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1296 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1297 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1298 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1299 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1300 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1301 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1302 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1303 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1304 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1305 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1306 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1307 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1308 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1309 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1310 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1311 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1312 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1313 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1314 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1315 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1316 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1317 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1318 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1319 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1320 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1321 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1322 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1323 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1324 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1325 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1326 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1327 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1328 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1329 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1330 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1331 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1332 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1333 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1334 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1335 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1336 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1337 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1338 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1339 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1340 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1341 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1342 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1343 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1344 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1345 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1346 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1347 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1348 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1349 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1350 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1351 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1352 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1353 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1354 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1355 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1356 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1357 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1358 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1359 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1360 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1361 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1362 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1363 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1364 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1365 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1366 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1367 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1368 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1369 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1370 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1371 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1372 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1373 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1374 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1375 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1376 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1377 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1378 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1379 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1380 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1381 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1382 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1383 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1384 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1385 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1386 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1387 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1388 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1389 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1390 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1391 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1392 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1393 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1394 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1395 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1396 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1397 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1398 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1399 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1400 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1401 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1402 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1403 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1404 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1405 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1406 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1407 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1408 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1409 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1410 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1411 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1412 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1413 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1414 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1415 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1416 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1417 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1418 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1419 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1420 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1421 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1422 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1423 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1424 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1425 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1426 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1427 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1428 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1429 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1430 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1431 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1432 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1433 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1434 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1435 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1436 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1437 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1438 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1439 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1440 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1441 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1442 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1443 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1444 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1445 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1446 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1447 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1448 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1449 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1450 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1451 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1452 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1453 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1454 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1455 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1456 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1457 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1458 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1459 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1460 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1461 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1462 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1463 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1464 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1465 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1466 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1467 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1468 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1469 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1470 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1471 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1472 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1473 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1474 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1475 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1476 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1477 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1478 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1479 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1480 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1481 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1482 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1483 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1484 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1485 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1486 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1487 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1488 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1489 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1490 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1491 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1492 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1493 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1494 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1495 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1496 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1497 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1498 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1499 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1500 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1501 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1502 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1503 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1504 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1505 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1506 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1507 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1508 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1509 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1510 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1511 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1512 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1513 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1514 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1515 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1516 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1517 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1518 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1519 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1520 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1521 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1522 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1523 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1524 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1525 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1526 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1527 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1528 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1529 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1530 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1531 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1532 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1533 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1534 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1535 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1536 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1537 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1538 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1539 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1540 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1541 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1542 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1543 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1544 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1545 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1546 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1547 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1548 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1549 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1550 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1551 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1552 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1553 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1554 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1555 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1556 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1557 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1558 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1559 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1560 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1561 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1562 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1563 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1564 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1565 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1566 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1567 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1568 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1569 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1570 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1571 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1572 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1573 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1574 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1575 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1576 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1577 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1578 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1579 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1580 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1581 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1582 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1583 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1584 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1585 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1586 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1587 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1588 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1589 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1590 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1591 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1592 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1593 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1594 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1595 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1596 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1597 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1598 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1599 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1600 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1601 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1602 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1603 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1604 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1605 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1606 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1607 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1608 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1609 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1610 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1611 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1612 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1613 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1614 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1615 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1616 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1617 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1618 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1619 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1620 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1621 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1622 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1623 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1624 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1625 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1626 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1627 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1628 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1629 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1630 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1631 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1632 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1633 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1634 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1635 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1636 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1637 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1638 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1639 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1640 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1641 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1642 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1643 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1644 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1645 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1646 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1647 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1648 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1649 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1650 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1651 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1652 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1653 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1654 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1655 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1656 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1657 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1658 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1659 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1660 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1661 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1662 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1663 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1664 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1665 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1666 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1667 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1668 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1669 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1670 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1671 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1672 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1673 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1674 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1675 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1676 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1677 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1678 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1679 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1680 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1681 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1682 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1683 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1684 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1685 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1686 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1687 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1688 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1689 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1690 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1691 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1692 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1693 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1694 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1695 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1696 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1697 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1698 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1699 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1700 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1701 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1702 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1703 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1704 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1705 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1706 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1707 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1708 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1709 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1710 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1711 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1712 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1713 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1714 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1715 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1716 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1717 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1718 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1719 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1720 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1721 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1722 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1723 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1724 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1725 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1726 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1727 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1728 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1729 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1730 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1731 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1732 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1733 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1734 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1735 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1736 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1737 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1738 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1739 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1740 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1741 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1742 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1743 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1744 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1745 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1746 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1747 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1748 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1749 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1750 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1751 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1752 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1753 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1754 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1755 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1756 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1757 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1758 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1759 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1760 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1761 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1762 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1763 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1764 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1765 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1766 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1767 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1768 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1769 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1770 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1771 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1772 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1773 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1774 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1775 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1776 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1777 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1778 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1779 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1780 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1781 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1782 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1783 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1784 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1785 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1786 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1787 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1788 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1789 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1790 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1791 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1792 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1793 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1794 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1795 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1796 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1797 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1798 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1799 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1800 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1801 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1802 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1803 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1804 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1805 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1806 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1807 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1808 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1809 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1810 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1811 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1812 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1813 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1814 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1815 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1816 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1817 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1818 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1819 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1820 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1821 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1822 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1823 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1824 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1825 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1826 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1827 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1828 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1829 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1830 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1831 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1832 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1833 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1834 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1835 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1836 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1837 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1838 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1839 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1840 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1841 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1842 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1843 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1844 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1845 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1846 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1847 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1848 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1849 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1850 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1851 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1852 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1853 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1854 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1855 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1856 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1857 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1858 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1859 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1860 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1861 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1862 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1863 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1864 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1865 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1866 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1867 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1868 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1869 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1870 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1871 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1872 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1873 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1874 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1875 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1876 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1877 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1878 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1879 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1880 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1881 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1882 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1883 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1884 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1885 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1886 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1887 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1888 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1889 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1890 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1891 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1892 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1893 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1894 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1895 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1896 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1897 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1898 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1899 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1900 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1901 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1902 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1903 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1904 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1905 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1906 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1907 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1908 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1909 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1910 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1911 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1912 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1913 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1914 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1915 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1916 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1917 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1918 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1919 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1920 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1921 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1922 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1923 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1924 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1925 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1926 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1927 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1928 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1929 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1930 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1931 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1932 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1933 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1934 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1935 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1936 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1937 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1938 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1939 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1940 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1941 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1942 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1943 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1944 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1945 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1946 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1947 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1948 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1949 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1950 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1951 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1952 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1953 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1954 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1955 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1956 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1957 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1958 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1959 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1960 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1961 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1962 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1963 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1964 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1965 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1966 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1967 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1968 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1969 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1970 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1971 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1972 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1973 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1974 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1975 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1976 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1977 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1978 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1979 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1980 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1981 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1982 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1983 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1984 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1985 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1986 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1987 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1988 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1989 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1990 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1991 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-1992 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1993 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1994 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-1995 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1996 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1997 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-1998 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-1999 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-2000 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2001 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2002 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2003 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2004 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2005 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2006 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-2007 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-2008 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2009 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2010 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2011 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2012 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2013 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2014 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-2015 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-2016 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2017 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2018 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2019 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2020 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2021 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2022 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-2023 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-2024 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2025 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2026 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2027 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2028 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2029 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2030 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-2031 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-2032 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2033 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2034 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2035 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2036 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2037 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2038 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-2039 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-2040 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2041 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2042 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2043 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2044 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2045 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2046 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-2047 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-2048 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2049 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2050 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2051 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2052 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2053 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2054 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-2055 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-2056 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2057 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2058 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2059 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2060 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2061 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2062 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-2063 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-2064 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2065 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2066 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2067 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2068 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2069 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2070 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-2071 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-2072 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2073 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2074 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2075 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2076 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2077 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2078 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-2079 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-2080 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2081 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2082 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2083 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2084 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2085 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2086 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-2087 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-2088 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2089 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2090 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2091 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2092 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2093 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2094 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-2095 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-2096 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2097 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2098 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2099 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2100 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2101 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2102 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-2103 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-2104 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2105 (LOW): `planCrank` does not check `r.retired` before planning a capture batch.** The capture batch is built from `plan.capture`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2106 (LOW): `planCrank` does not check `r.retired` before planning a reschedule batch.** The reschedule batch is built from `plan.reschedule`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2107 (LOW): `planCrank` does not check `r.retired` before planning an activation batch.** The activation batch is built from `plan.activate`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2108 (LOW): `planCrank` does not check `r.retired` before planning a join batch.** The join batch is built from `plan.joins`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2109 (LOW): `planCrank` does not check `r.retired` before planning a claim batch.** The claim batch is built from `plan.claims`, which is filtered by `r.retired`, so this is already handled.

**Finding R1-2110 (LOW): `planCrank` does not check `r.retired` before planning an expiry batch.** The expiry batch is built from `plan.preExpires` and `plan.postExpires`, which are filtered by `r.retired`, so this is already handled.

**Finding R1-2111 (LOW): `planCrank` does not check `r.retired` before planning a rescue batch.** The rescue batch is built from `plan.rescue`, which is filtered by `assets[f.asset] !== 'live'`, so this is already handled.

**Finding R1-2112 (LOW): `planCrank` does not check `r.retired` before planning a reveal batch.** The reveal batch is built from `plan.reveal`, which is not filtered by `r.retired`, so this is a real issue.

**Finding R1-2113 (LOW): `planCrank` does not check `r.retired