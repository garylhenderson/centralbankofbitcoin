**M1 (MEDIUM, confirmed).** The runtime's `Log truncated` marker (anyone can cause it for one fee by padding a transaction naming one of our programs) is refused by default in `bank/txread.mjs` (round-28 M1 repair). However, every consumer (`bank/alarm.mjs` line ~583, `splitsSince` in `bank/revenue.mjs`, `bank/redemption-poster.mjs`) throws out of the whole job on it with no per-signature catch. In the alarm this reaches `main()` (line ~805): no findings from earlier in the pass are reported, no other program's walk runs, state is not written, and the only output is the generic `run_failed` page. The revenue scan and poster also throw. Measured on an isolated validator (`.cache/triage29o/truncation-grief.mjs` and `.log`, 17/17): a 60-instruction legacy transaction with unreferenced read-only keys for MINT/BURN and a revenue ATA succeeded, paid 5,000 lamports, and produced the marker. The actual `sigwalk.mjs` returned it for MINT/BURN/ATA; the actual reader refused it; the extracted alarm walk threw on three consecutive passes with the MINT cursor unchanged; with cursors past the attack the walk completed. The actual poster and revenue scan also threw and saved nothing. SPEC's reader coverage boundary states the gap but not that one transaction blinds every detector (insolvency, drift, unledgered sweep, burns, freezes, upgrade authority) until a human edits the cursor (which also gives cover to operator-key misuse). No program invariant or value path is affected, and the failure is loud. **Repair:** isolate refusals per signature in all three consumers. Record a durable, paged gap finding naming the signature and reason, persist the gap until acknowledged, still run instruction-derived detectors where only logs are incomplete, never treat events as read, and continue remaining walks and detectors so the pass reports and saves state. `splitsSince` must treat refusal as "no evidence" (cycle stays open and loud). Add selftest arms using this stranger shape proving the pass completes, other findings deliver, and the gap pages. Update SPEC paragraph. (Evidence: the measured validator run, extracted alarm walk, and selftest arms in `.cache/triage29o/`.)

**L1 (LOW, confirmed).** `scripts/audit-coverage.sh` enumerates only `programs/*/src/lib.rs bank/*.mjs scripts/*.{sh,mjs} tests/*.{ts,mjs} SPEC.md Cargo.toml Anchor.toml`, so `sim/` and `launch/` are never checked. Measured: the gate exits 0 ("36 files"), yet tracked `sim/fixtures.mjs` (executed by `sim/run-sim.sh` step 2 of the 71-assertion Test Vault simulation, a certifying gate that copies real cbBTC/$GARY/$GIRAFFISH mints and patches their mint authority) appears in no `scripts/audit*.ts` target or retained prompt (grep count 0 across all runners and `/tmp/v2*-prompt-*.txt`). This triage read it and found it local-only with a byte-scope check on its patch. That is not a round's audit, and the gate's claim is false. **Repair:** enumerate every tracked file under `sim/` and `launch/` (the runner's `NAMED_FILE` already treats both as deliverable), bundle `sim/fixtures.mjs` in the next round, and add counterfactuals proving the gate fails on an unsent file in each directory. (Evidence: the gate's enumeration and grep of every retained prompt; `sim/fixtures.mjs` in the 71-assertion simulation.)

**INFO (Sonnet F3, coverage half).** The selftest's source-scan labels overstate their scope. `srcFiles` reads only `tests/*.ts`, yet its assertions say "the whole test suite are in it, none skipped" and "exactly TWO signers exist in bank/, scripts/ and tests/". Round 28 added `tests/expiry-budget.mjs`, a `run-tests.sh` gate (EXPIRY_FLOOR 4) that falls outside the "no file reads a retired key path" and signer scans. No current signer or retired-key reader is missed (grep finds neither the secret-key constructor nor a retired key path in `tests/*.mjs`), and the selftest passes 888/888 at HEAD. **Repair:** include `tests/*.mjs` in `srcFiles`, or narrow the labels to what is scanned. (Evidence: the selftest's `srcFiles` and assertions; grep of every `scripts/audit*.ts` and retained prompt.)

**C01 (Sonnet F1).** The claimed ~32 KB, ~30-signer Autograph is not a measured route. Round 28's programs triage (W6) found that Core Autograph updates carry the complete signature vector, so one instruction's data bounds each write. Sequential appends failed inside Core's heap at the 57th signature (a 2,841-byte asset), and that asset still revealed. Writes up to a 10,150-byte message revealed, and R28.A1 reveals the 10,150-byte message on the real FIFO-head vault beside all five owner plugins (855/855). SPEC item 40's round-28 paragraph already states these are bounded observations, not a proof for every shape. Sonnet itself conditions the finding on an unmade measurement. No new evidence supports a FIFO-skip repair. Sonnet's quoted phrase "no third-party route to stall" appears in neither SPEC nor the round-28 records. **Accepted as bounded observation in SPEC 40; no repair.**

**C02 (Longcat CRITICAL).** `orcaSpot`/`meteoraSpot` use raw token units. For a 9-decimal SOL / 8-decimal cbBTC pool, raw cbBTC per raw SOL **is** sats per lamport, the unit of `satsPerLamport`. The report's own numbers mix units: 0.001396 is cbBTC per SOL in display units. Fork assertion SW.7 runs the actual `market()` on cloned real pool state and reports **both venues usable** (within 100 bps), and SW.8/SW.9 swap within 31.6/32.9 bps of the oracle (`.cache/r28e-full-pass-855.log`). A 90,000-bps mismatch would refuse both. **Disproved by measurement; no repair.**

**C03 (Longcat HIGH).** `reweigh` moves the whole difference, boost included, into `total_active_weight` (`programs/cbob-vault-mint/src/lib.rs` 1889-1898). Retirement subtracts the full `weight_of` and then unschedules the boost (1814-1825). Additions and subtractions match. **Disproved by source; no repair.**

**C04 (Longcat MEDIUM).** `judgeSwapInstructions` pins the swap's input slot to the operator's own wSOL ATA (`bank/swap.mjs` 366). That ATA is deterministic, so a second operator wSOL ATA does not exist. The wrap, SyncNative and close are pinned to the same account (343-352). **Disproved by source; no repair.**

**C05 (Longcat MEDIUM).** `revenue.mjs` 451-467 sends the whole operator balance but records only this cycle's delta, by design and with a comment, keeping `sweptAtaTotal` separately. `closesCycle` accepts the first split with total **at least** `returnedSats` (`detectors.mjs` 692), so a split that includes leftovers still closes the cycle. No reader uses `sweptAtaTotal` as an anchor: it is written once at line 467 and read nowhere. **Disproved / deliberate; no repair.**

**C06 (Longcat LOW, DeepSeek lead).** `/\b\d+\b/` replaces only standalone digit tokens, and base58 addresses are not standalone digit tokens. Two real crank problem strings for different vaults keep distinct keys (`.cache/triage29o/problemkey.log`). The selftest arm "R28 heartbeat: every persistent problem reaches its third-pass alarm" asserts 150 distinct findings. **Disproved by measurement; no repair.**

**C07 (Longcat LOW).** `create-cbob-token.mjs` roots `KEYS` (non-mainnet) and `RECORD` at `/opt/cbob-vaults`, which the rehearsal substitution now rewrites (`rehearsal-tree.sh` 74 includes `launch`; the R28 rehearsal arm and its omission counterfactual pass). `--upload` writes fixed, content-addressed, immutable icon/JSON objects, the same bytes from any tree. It does not overwrite a production record. **Already repaired (R28 L3); no new repair.**

**C08 (Longcat INFO; Qwen max R0).** SPEC's opening no longer says "not yet a multi-model round" (grep: no match). HOLDER-GUIDE line 21 says "the draw job checks every minute, and busy queues can take longer". **Disproved (repaired at HEAD); no repair.**

**C09 (Opus 4.8).** Limit 40 states that any Core upgrade changing `ExecuteV1`, `BurnV1` or the plugin rules "reaches every vault, and our immutable programs cannot adapt". Its enumerated consequences are named examples. A Core change to the asset-signer PDA's ownership or data is the same class. Enumerating it is optional. **Accepted as covered by the general clause in SPEC 40; no repair.**

**C10 (Opus 4.8).** `CBOB_SHIP_GATE` is a human setting. Limit 50 requires the certifying run to show the probe ran. Defaulting a release run to ship-gate mode is optional process hardening. **Existing certification condition (R28 C23); no repair.**

**C11 (Sonnet F4).** No RPC timeout; limit 25 wording. Limit 25 records the 300.8-s measurement "at `2b67fb1`" without claiming a repair. The unchanged default `Connection` and the alarm's DAS `fetch` are the same disclosed behaviour. Lower transport timeouts are optional. **Existing accepted limit (R28 C33); no repair.**

**C12 (Sonnet F5).** Choosing an older Pyth update. SPEC "What remains trusted (a)": "a stale or manipulated oracle is bounded by the age, confidence and pool-agreement checks, not removed", with the 180-s age on the chain clock (fork SW.7a/b) and the 150-bps on-chain floor. No CBOB-side defect is shown. Whether the push oracle refuses an older update was not measured. **Accepted trust boundary, unmeasured; no repair.**

**C13 (Sonnet F6).** Venue arrays not checked for existence. A missing tick/bin array makes the venue refuse. The cycle stays open and loud, needing the documented hand recovery. The report itself says this is loud, not lossy. Round 28's Opus 5.5 raised the same cheap hardening. **Optional hardening; no repair.**

**C14 (Sonnet F7).** HOLDER-GUIDE Autograph wording. "it" consistently refers to the autograph book. R28.A2 measured that Core cannot clear it, and the same bullet states that a full opening passed simulation. **Accurate text; no repair.**

**C15 (Sonnet F7).** Dormant revenue job writes the ledger. The recovery block writes only when an open cycle already carries a returned amount, which only a `--live` run creates. The dry run's stated contract is "Re-run with --live to move funds", which holds. **No false statement; no repair.**

**C16 (Sonnet F7).** Judge leaves venue-owned accounts and `host_fee_in` unpinned. SPEC states the judge catches our builder defects, while the venue program validates its own accounts. The on-chain floor and the post-swap delta check (`revenue.mjs` 446) bound value. A tampered module is accepted residue (3). **Documented scope / optional; no repair.**

**C17 (Sonnet).** 20,000-transaction spam fills `signaturesSince`. `scan_gap` HIGH fires and the cursor is held (`alarm.mjs` 561-564). This is the round-11 design, and loud. M1 is the cheaper and total version of this blinding. **Existing paged bound; no repair.**

**C18 (Qwen 2.4t LOW).** `_rpcRequest` is private. Removal fails loudly (`txread.mjs`: "transaction RPC transport unavailable"), and the installed transport is exercised by the selftest and the 33-assertion mainnet probe. **Optional SDK hardening (R28 C01); no repair.**

**C19 (Qwen 2.4t INFO; Qwen max).** Expiry-budget scope. The test header and VALIDATION state synthetic genesis scope. 103,976 CU at the default budget is the figure in `.cache/r28e-full-pass-855.log`. **Accurate; no repair.**

**C20 (Qwen max R6-LOW).** `cbob_release_wallet` not on-curve checked. `check-launch-params.mjs` pins it by equality to `CBOB_RELEASE_WALLET` (36, 73), and that key is on curve (measured `PublicKey.isOnCurve` true). An off-curve value fails the pin. Adding it to the on-curve list is optional. **Not a defect; no repair.**

**C21 (Qwen max).** Persisted `seenSplits`/`seenSweeps` grow. They are deduplicated and grow by hourly splits and four-a-day sweeps. Verification work is bounded by `verifyLastN`. No correctness effect is shown. **Optional housekeeping; no repair.**

**C22 (Muse).** `readPyth` address pin; `idGate` file subset. Production `market()` requests the exact derived accounts. Full rehearsal-scope coverage comes from the reverse proof and the abbreviated-prefix refusal, as the report itself says. **Optional (R28 C19); no repair.**

**C23 (Opus 4.8).** `satsPerLamport` float precision. The report's own disposition holds: the feed ids are pinned, and current mantissas are far below 2^53. **Not a defect with pinned feeds; no repair.**

**C24 (DeepSeek partial leads).** Self-withdrawn / covered. The in-line monthly run cannot pre-empt the pre-joins, because `monthly_inline` returns early while `waiting_to_join > 0`. The remaining leads map to C06 or were closed by the partial itself. **Self-withdrawn / covered; no repair.**

**C25 (Opus 4.8, Muse, both Qwen).** "M1 repair holds, no regression". The marker check is correct and its arms hold. The refusal's whole-job scope is the attacker-reachable defect M1. **Partly contradicted; no repair.**

The reports' launch recommendations (live dress rehearsal, independent reproducible builds, custody and ceremony witnesses, an off-box alarm witness, holder-surface usability, adversarial economics) do not establish further undisclosed defects. Those obligations remain open.

## Independent measurements and limits

- **Truncation griefing** (`.cache/triage29o/truncation-grief.mjs`, `truncation-grief.log`, `truncation-grief.json`): 17/17 as predicted. An isolated `solana-test-validator` 4.2.1 ran on 8999/9900 under `.cache/VALIDATOR.lock` (acquired atomically after the programs triage released it). Its ledger was in `.cache/triage29o/`, and it was stopped afterward; both ports were free and the lock was removed. A 70-instruction draft was refused at sanitization (instruction-count bound), so 60 instructions were used. Imports: only `sigwalk.mjs`, `txread.mjs`, `layout.mjs` and `detectors.mjs`. The alarm walk, `splitsSince` and the poster loop were source-extracted with the same technique as `bank/selftest.mjs`, using a real local `Connection` and real `walkSigs`. No entrypoint was imported and nothing was sent off the local validator. **Limits:** no mainnet transaction was sent. The 10,000-byte collector cap and exact marker are the round-28-cited Agave behaviour reproduced here on 4.2.1. That a mainnet RPC indexes unreferenced read-only keys in `getSignaturesForAddress` is standard behaviour shown on the validator, not on Helius.
- **Detector selftest at HEAD:** `node bank/selftest.mjs` gave **891/891**, exit 0 (`.cache/triage29o/selftest-891.log`).
- **`problemKey`:** `.cache/triage29o/problemkey.log`.
- **Coverage:** `scripts/audit-coverage.sh` exits 0 with 36 enumerated files. A grep of every `scripts/audit*.ts` and every retained `/tmp/v2*-prompt-*.txt` (including the re-rendered `/tmp/v29-prompt-offchain.txt`) finds `sim/fixtures.mjs` zero times.
- **Reused, not re-executed here:** the canonical full runner `.cache/r28e-full-pass-855.log` gave 855 on-chain, 891 detector, 39 allocation, 22 poster, 14 PoB, 47 launch, 6 host, 33 live mainnet probe, 4 expiry budget and 16 swap-fork assertions (SW.7 both venues usable; Orca 1,400,902 and Meteora 1,400,725 sats against 1,405,348 expected and a 1,384,267 floor). `.cache/r28-sim.log` gave 71/71. Both ran on the repair tree committed as `de3d56f` (`audits/round28/VALIDATION.md`); HEAD changes no code. The swap results are fork transactions, not live money.

The **71/71** Test Vault simulation from round 28 (`.cache/r28-sim.log`) is
reused explicitly: round 29 changes no program, no test-vault code, no token
or Core pin and no simulation fixture, only off-chain readers, the coverage
gate and documentation.

## Post-commit build and rehearsal

Repairs were committed and pushed as `88acce2`. The clean-tree post-commit
`build-mainnet.sh` passed (`.cache/r29-build-mainnet.log`, `dirty no`), and
`sha256sum -c .cache/r29-dist-before.sha256` passed all five artifacts. The
rehearsal worktree was refreshed at `88acce2` with the key-preserving script
(`.cache/r29-rehearsal.log`): 53 patched files (the prepared round-31 script
also names the program IDs), exact reverse proof to HEAD, all five keys equal.
Nothing was built, deployed or sent at the throwaway IDs.

Live launch dates, holder surfaces, the Phantom ceremony, the both-venue revenue
cycle and forced post-sweep recovery remain open launch obligations. Round 29
stays NOT CLEAN; rounds 30 and 31 must each be clean.