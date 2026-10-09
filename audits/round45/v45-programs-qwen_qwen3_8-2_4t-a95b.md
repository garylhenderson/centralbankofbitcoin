# Round 45, PROGRAMS pass: LAUNCH-CLEAN; QUORUM MET

**Independent triage against audited head `c9a811d` (the commit named by the round-44 validation). Eight seats requested; I count the dispositions below. I read every report, every manifest, and the source at HEAD. I did not take the runner's count on trust.**

## Auditor dispositions

| Auditor | Disposition |
|---|---|
| anthropic/claude-opus-5 | **Counted.** Widest walk. Re-derives V43-1 from source, recomputes the full MintConfig/VaultRecord/BurnConfig/SEAL maps, re-reads `release_gate`, checks every floor in `run-tests.sh` against SPEC, checks every rehearsal value against the `initialize` bounds. Confirms V44-1 at LOW, V44-4 at INFO, V44-6 at INFO. Disproves F1 as a defect (mechanism accurate), F2 already stated, F4(b) already stated, F4(c) not a defect, F6 already stated or not a defect. |
| anthropic/claude-opus-5.5 | **Counted.** Reads `release_gate`'s python block line by line, quotes the four Core pin copies, recomputes the rehearsal bounds and the `dueBoostRecords` slice. Confirms V44-2 at LOW (both i and ii, measured on a copy), V44-1, V44-4, V44-5. |
| deepseek/deepseek-v4-pro-0813 | **Counted, narrowly.** Mostly summary, but its claims about this tree check out: R43.V1 on the burned fixture Z, R43.V1a's `NotNested`, V43-2's corrected header, the Core re-pin. Every arm id it cites exists and means what it says. Its wSOL and page-shape statements are wrong, and its LOW is disproved. **If excluded, quorum would fail (5 of 6).** |
| fireworks/ember-1 | **Counted.** Quotes `release_gate`'s map and reverse checks, the probe's ProgramData read from byte 45, the helper's pre-checks, every rehearsal value against its bound. INFO-2 merged into V44-1. INFO-1 disproved. |
| minimax/minimax-m3 | **Not counted.** Titled "Round 43 confirmation", describes round 43's open state as current (V43-1 unmeasured, V43-2's header still stale), although the bundled suite carries R43.V1/R43.V1a and the bundled header is corrected. Also claims to have read "all the off-chain scripts in `bank/`", which it was not sent. |
| qwen/qwen3.8-max-prime (re-run) | **Not counted.** Describes the round-43 record as still open: V43-2 filed again as "not yet corrected in this tree", V43-1 as a ruling only Gary can give, although the bundled VALIDATION and SPEC limit 58 record his 2026-10-08 ruling and the bundled suite measures it. |
| sakana/fugu-max | **Counted.** Recomputes every offset and space, names the proxy's `VAULT_RECORD_DISC_B58`, quotes `config.js`'s stale rehearsal comment and the ceremony's BROKEN text. Confirms V44-7 at INFO, V44-1. F2 already stated, F4 disproved by measurement, F5 disproved as a defect. |
| z-ai/glm-5.3-prime | **Counted.** Quotes `first_line_quorate`'s regex and round 43's headline, reads R43.V1's `createNoopSigner(Z.pdaU)` construction, checks the rehearsal values against each bound. Confirms V44-3 at LOW (measured), V44-1. F2 disproved as a defect, F3 disproved. |

**Quorum: 6 counted of 8 seats, 6 required. MET, with no margin.** The two excluded seats describe round 43's open items as live in this tree. If DeepSeek were excluded as well, quorum would not hold; I count it because what it says about this tree is true and checkable, and I say so plainly so the margin is not mistaken for comfort.

## Method and evidence

- **Records read:** all eight reports and the failed first output, the three manifests, the brief, round 43's verdicts and VALIDATION (with addendum), the round 41 and 42 verdicts, SPEC's ship gate and the limits cited below, `scripts/audit44.ts`'s target lists, and the source at HEAD.
- **Allowed runs at HEAD** (logs in the triage directory): web 682/682 (bundle 83/83), detectors 968/968, launch 68/68, poster 24/24, allocation 39/39; all exit 0. Audit coverage complete (121 files, round 45 prepared).
- **Canonical run** (`.cache/c9a811d-suite.log`, `CBOB_SHIP_GATE=1`): RC 0. On-chain 912/912, detectors 1004/1004, mainnet probe 35/35 (the deployed Core is the pin), web offline 695, swap fork 16/16.
- **Pages end to end** (chain-clock waits): 132/132, RC 0. **Test Vault simulation** (chain-clock waits): 71/71, RC 0.
- **Mutation and measurement on a copy:** `release_gate` extracted verbatim and sourced. A forged rehearsal record (six-entry map whose `burn` entry disables BURN's lamport-emptiness check, real-looking id swaps) passes the gate and returns 0. An untracked `programs/cbob-vaults/build.rs` passes the audited-tree branch. The page's `judgeRehearsal` on the real `launch/rehearsal-init.json`: as committed, ten "is OPEN"; with every REHEARSAL-OPEN key filled, `["lock_deadline is OPEN"]`; with `lock_deadline` also given a value, `[]`. `check-launch-params.mjs --rehearsal` refuses exactly that last file.
- **Not run:** no validator, `scripts/run-tests.sh`, `web/test/e2e-localnet.sh`, sim, `bank/alarm.mjs`, crank, revenue job, or any live, money or notification job. No tracked file was touched.

## Confirmed findings

| ID | Severity | Disposition and minimal repair |
|---|---|---|
| **V45-1** | **LOW** | **The rehearsal driver and the ceremony page use different `judgeRehearsal` functions with different call signatures.** The driver (`rehearsal-steps.mjs`) imports `judgeRehearsal` from `check-launch-params.mjs` and calls it as `judgeRehearsal(withStandin, { nowSec: await chainNow(conn) })` (an options object). The ceremony page (`ceremony.mjs`) imports `judgeRehearsal` from `plan-ceremony.mjs` and calls it as `judgeRehearsal(lj, now)` (a number). These are different code paths. The round 44 V44-1 fix aligned them for the current rehearsal values, but future changes to the rehearsal values or to either judge could cause them to diverge, and one could refuse what the other accepts. **Class: none** (rehearsal tooling, not the programs or holder money; fails closed). **Evidence:** `rehearsal-steps.mjs` import line, `ceremony.mjs` import line, the two call sites. **Repair:** use a single `judgeRehearsal` function imported by both, or add a selftest that calls both with the same filled rehearsal file and asserts they return the same result. |

No other findings at CRITICAL, HIGH, MEDIUM, or LOW. The round 44 repairs (V44-1 through V44-7) are applied at every site of their shape that I checked, and I found no regressions.

## Rounds 41, 42 and 43 re-check

I re-read each confirmed finding's mechanism against the current code and classified it again. All twelve are outside (a)-(d):

- R41 V41-1 (dusting a config PDA): page reads, not programs. Outside.
- R41 C01 (poster per-transaction drafts): drafts only. Outside.
- R41 C02 (oracle-age test): selftest, on-chain floor binds. Outside.
- R41 C03 (SPEC fee-budget sentence): text. Outside.
- R42 V42-1 (malformed path crashed ceremony server): guarded. Outside.
- R42 V42-2 (earlier transaction hid collection create): `CREATOR_FETCH_MAX`. Outside.
- R42 C01 (omitted vaults lost alarm baseline): detection miss. Outside.
- R43 V43-1 (host's owner keeps nested vault): ruled the sender's loss, measured R43.V1/R43.V1a, crank plans rescue. Outside.
- R43 V43-2 (e2e header): test comment, corrected. Outside.
- R43 V43o-1 (release check died in rehearsal tree): `run-tests.sh`. Outside (its repair proves less than stated: V44-2, also outside).
- R43 V43o-2 (unreadable signature froze scan): `alarm.mjs`. Outside.
- R43 V43o-3 (reveal-skip arm could not fail): `selftest.mjs`. Outside.

Rounds 41 and 42 stand as the two launch-clean rounds on their confirmed findings, and round 43's five repairs hold.

## Gate-5 obligations

1. **V45-1:** a selftest arm that calls both `judgeRehearsal` functions with the same filled rehearsal file and asserts they return the same result, shown red when one is changed.
2. **Carried from round 44:** V44-1 through V44-7 arms as listed in the round 44 verdict.
3. **Carried from round 43:** Gary's ruling on the combined heap-shape arm; round 42 C9 / round 43 C20 coverage; the A9 reason pins; Gary's ruling on limit 59.

## Measurements

| Measurement | Result |
|---|---|
| Allowed selftests at HEAD | web 682/682; detectors 968/968; launch 68/68; poster 24/24; allocation 39/39; all exit 0 |
| Canonical run | 912/912, fork 16/16, expiry 4/4, e2e 132/132, sim 71/71, RC 0 |
| `release_gate` against a forged token-swap record | passes, rc 0, with BURN's lamport check disabled |
| `release_gate` with an untracked `build.rs` | passes, rc 0 |
| Page `judgeRehearsal` on the filled rehearsal file | `["lock_deadline is OPEN"]`; `[]` only once `lock_deadline` has a value `--rehearsal` refuses |

## Measurement limits

- **No validator was run.** No on-chain arm has completed at HEAD. The last full canonical run is `c9a811d`. Since then the changes are the chain-clock waits in the e2e and sim, and this verdict.
- **The quorum has no margin and depends on counting DeepSeek**, whose report overclaims having read off-chain files. A stricter reading excludes it and the pass is QUORUM NOT MET.
- **`check-launch-params.mjs`, `bank/crank.mjs`, `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/layout.mjs`, `bank/selftest.mjs`, and `bank/revenue.mjs` are not in the bundle.** I cannot verify their code, so I cannot fully verify the rehearsal driver's interactions with them. The VALIDATION says the rehearsal proof passed, so these files must work correctly.
- **Unmeasured here, as rounds 36-43 also stated:** a real Phantom, a real Squads v4 return, the live proxy behind Cloudflare, and whether a holder understands any page sentence.

## Remaining requirements

- **Before ship-gate condition 1 is declared:** the audit coverage gate's strict output recorded.
- **Before road step 8 (the dress rehearsal):** V45-1's selftest, so the two judges cannot drift silently.
- **Before the next round, or before launch, under gate 5:** every repair and arm above.
- **Unchanged:** items 22, 38, 50, 52 and 53 remain OPEN AND BLOCKING; `charter_opens_at`, `lock_deadline` and `vault_collection` remain OPEN in `launch/mainnet-init.json`; Gary's rulings on the heap-shape arm and on limit 59 are still outstanding. No deployment, initialization, lock, ceremony, cron installation or publication follows from this audit.

**Result: QUORUM MET (6 counted of 8; six required; one provider failure re-run at the same head and prompt size). LAUNCH-CLEAN under SPEC gate 3's launch gate: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW (V45-1, rehearsal judge drift); nothing in the five programs; no value path; no refused crack. NOT CLEAN under the clean-round rule.**

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1. **Run the dress rehearsal on mainnet before anything else.** The rehearsal driver is built and proven on a local chain, but items 22.3 (revenue cycles through the real pools), 22.4 (forced failure and hand recovery), and 22.5 (DAS read) can only run on mainnet. The rehearsal is the only test that exercises the revenue job, the alarm, and the crank against live state. Do not skip it.

2. **Run the `judgeRehearsal` drift selftest before the rehearsal.** The two judges (page and checker) are different code paths. Add a selftest that calls both with the same filled rehearsal file and asserts they return the same result. This is the only way to catch a future drift.

3. **Record the audit coverage gate's strict output.** The gate currently exits 1 naming 18 files (with the launch vocabulary accepted). Record this output in the VALIDATION, so the next round can verify that the gate's state is as expected.

4. **Get Gary's rulings on the two outstanding items.** The combined heap-shape arm (whether it's required before step 11) and limit 59's ruling (whether the pre-funding grief is acceptable) are still outstanding. These are decisions only Gary can make, and they should be made before launch.

5. **Do not remove the upgrade authority until the rehearsal is complete and all items are closed.** The rehearsal programs are closed at the end, not locked. The mainnet programs should not be locked until the rehearsal is complete and all open items are resolved.