# Round 29, PROGRAMS pass: NOT CLEAN; QUORUM MET

**Final verdict against frozen HEAD `76753e83e83fe56dbf8a64796c7420014769d957` (round-28 repair code `de3d56f`). Seven substantive completed auditors were counted out of eight requests; six are required, so quorum is met. Independently confirmed surviving findings make this tree NOT CLEAN.**

The clean-round counter remains **0/2**.

**32 deduplicated claim groups: four confirmed topics (0 CRITICAL, 0 HIGH, one MEDIUM, one LOW, two INFO) and 28 other dispositions (11 accepted or bounded, 17 refuted).** The MEDIUM reader topic overlaps the off-chain pass (its Sonnet F2 states the same attack). The LOW coverage-gate topic overlaps off-chain Sonnet F3. Count each only once in the combined round.

## Auditor dispositions

`MANIFEST-programs.json` records the frozen HEAD, an empty dirty-path list, eight requests, seven auditors and a six-auditor requirement. Every counted report was read in full. Each was checked for substance and for whether it describes the current tree.

| Auditor | Disposition |
|---|---|
| anthropic/claude-opus-4.8 | Counted. Completed (`stop`), 21,950 characters. Current-tree review of the sweep helper, pool, draw and offsets, plus round-28 repair checks. Its CRITICAL is disproved below. |
| meta/muse-spark-1.3 | Counted. Completed, 16,852 characters. Current reader, pairing, emptiness, helper and offsets. Its claim that round-28 D2 survives quotes the pre-repair arms and is false. The rest of the report is current. |
| qwen/qwen3.8-2.4t-a95b | Counted. Completed, 28,859 characters. Current-tree review with full offset recomputation. |
| meituan/longcat-2.0 | Counted. Completed, 22,775 characters. It wrongly calls round-28 M1 a "false positive" because it reads the repaired code as the original premise, and its summary table re-lists repaired round-28 topics. The body still analyzes the current pairing, emptiness, helper, pool, draw and offsets. Wrong conclusions alone do not exclude a report (round-28 precedent). |
| anthropic/claude-sonnet-5.5 | Counted. Completed, 14,215 characters. Current-tree review with concrete measurement proposals. |
| qwen/qwen3.8-max-0902 | Counted. Completed, 29,675 characters. Current-tree review with full offset tables. |
| z-ai/glm-5.3 | Counted. Completed, 34,345 characters. Current repair verification and source-specific findings. |
| deepseek/deepseek-v4.1-flash | **Excluded:** `finish_reason:length`, 128,000 output tokens, 302,340 characters. The output is reasoning only (`[reasoning only]`, line 3) and walks functions one by one. It ends in a degenerate loop: "Hmm, so 64 terms. But I expected 66" repeats roughly 90 times (lines 1514-3054+) while it recounts `MINT_CONFIG_SPACE`. It reaches no verdict. Its one concrete lead was checked anyway and is disproved (W16). |

## Method and evidence

All seven counted reports were read in full, and the DeepSeek partial was scanned for leads. Claims were checked against source at `76753e8`, the round-28 verdict, the validation records, retained logs and two bounded new measurements. The audit prompt was not re-rendered: `tsx` is not in the shared `node_modules`, and `npx` would have installed it. Bundle membership was checked against the `TARGETS` arrays in `scripts/audit*.ts`, which is the same source the coverage gate reads.

No tracked file was changed except this verdict. No live entrypoint was imported, and no crank, revenue, notification, mainnet send, deploy or lock was run. `bank/txread.mjs` and `bank/layout.mjs` were imported only into a local-validator probe.

One isolated validator window was used, under `.cache/VALIDATOR.lock`. The lock was created atomically after confirming no lock existed and that ports 8999 and 9900 were free. After the run the validator process had exited, both ports were free, and the lock and the 221 MB scratch ledger were removed.

Round-28 repairs were verified present:
- **M1:** `txread.mjs:76` refuses the standalone `Log truncated` marker.
- **L1:** `scripts/token-programs.sh` pins the three mainnet hashes and compares the bytes the validator actually loaded.
- **D2:** C.13 now asserts the stopped flag and charter count +1 (`3prog.test.ts:840`), and 7.6 asserts the exact YES/NO delta (1224).
- **D3:** the misplaced operator block is now a plain `//` comment naming `arm_swap_operator`, with line positions preserved.

The measured gates quoted in the prompt (855 / 888 / 39 / 22 / 14 / 47 / 6 / 33 / 4 / 16 / 71) come from `.cache/r28e-full-pass-855.log` and `.cache/r28-sim.log`. This triage did not rerun them.

## Confirmed findings

| ID | Severity | Independent disposition and minimal repair |
|---|---|---|
| **M1**: Sonnet F2 (shared with off-chain Sonnet F2) | **MEDIUM** | **A stranger can halt the whole alarm with one ordinary transaction.** Measured on a local validator (Part B below): a successful 496-byte legacy transaction from a fresh keypair produced the runtime's standalone `Log truncated` marker. It contained a 1-lamport self-transfer naming MINT's program id as a read-only extra account, plus 62 one-byte Memo instructions. It cost a 5,000-lamport fee and needed no deployed program. It appears in `getSignaturesForAddress(MINT)` with `err: null`, and the shipped `readParsedTransaction` throws `unreadable parsed transaction: logs truncated by runtime`. In `bank/alarm.mjs:583` that call has no per-transaction handling (the `!tx` branch covers only `null`). The throw leaves `main()`, the top-level catch (805-818) pages `run_failed`, and the pass's other findings and cursors are discarded. Every later pass re-reads the same signature and fails again, so every alarm detector stays dark until a human moves the cursor by hand, and the attacker can repeat the attack for another fee. The same throw stops `bank/redemption-poster.mjs:212`, which walks BURN; `revenue.mjs:543` is a sibling for the off-chain pass. SPEC's "Reader coverage boundary" describes a failed pass but not a stranger-triggerable, repeatable halt of all detection. **Repair:** keep the reader's refusal. In each consumer, catch it per signature and record a durable per-signature coverage gap paged at HIGH. Still run the instruction-derived detectors, which do not depend on logs, and advance the cursor past a gap that has been recorded. Add a selftest that drives a truncated transaction through the extracted walk and requires the pass's other findings to still be reported. Correct the SPEC boundary text. No program change. |
| **L1**: GLM M2, Qwen-max R8-1/F-2, Sonnet F4 (shared with off-chain Sonnet F3) | **LOW** | **The coverage gate does not cover the files SPEC says it covers.** SPEC's ship-gate table says `audit-coverage.sh` "diffs every audit prompt ever sent against the file tree and fails if anything has never been read", and the script calls its `have` list "Every file that is part of the system". In fact `have` is `programs/*/src/lib.rs bank/*.mjs scripts/*.sh scripts/*.mjs tests/*.ts tests/*.mjs SPEC.md Cargo.toml Anchor.toml`. Running it now prints "every file has been in at least one audit prompt (36 files)" and exits 0. Outside that set, these tracked files have never appeared in any round's `TARGETS` or legacy `f()` list: **`sim/fixtures.mjs`**, `tests/cpi-wrapper/Cargo.toml`, `launch/cbob-token.mainnet.json`, `scripts/pob-set.json`, `Cargo.lock`, and the four non-helper `programs/*/Cargo.toml`. `sim/fixtures.mjs` copies the real mainnet mint accounts and patches their mint authority for the 71-assertion simulation (`sim/run-sim.sh:39`), so certification evidence depends on a file no auditor has read. Other out-of-gate files (most of `sim/`, `launch/mainnet-init.json`, `tests/fixtures/`, `DESIGN-v6.md`, `HOLDER-GUIDE.md`, the sweep `Cargo.toml`) are bundled today by choice, not by guarantee. No program or deployed behavior is affected. **Repair:** derive `have` from `git ls-files` minus a short, commented exclusion list (historical audit reports and runners, lockfiles and the `node_modules` link). Bundle every file that is newly reported, at least `sim/fixtures.mjs`. Make the SPEC sentence match. |
| **D1**: Qwen-max R8-6 | **INFO** | **`DESIGN-v6.md` misdescribes `activate`.** Lines 145-148 still say `activate` "adds the level weight ... to `total_active_weight` and creates the vault's stake record with `debt = weight * acc`". That is the pre-stage-3c behavior. In the deployed code the first call only requests; weight enters the denominator only at a join after a later distribution. The bullet at 158-161 states this correctly, so the first bullet contradicts both the code and its own document. **Repair:** rewrite 145-148 as "request, then join after the next distribution, via `activate` again or `claim`". |
| **D2**: GLM L4 | **INFO** | **A permanently orphaned activated vault keeps diluting payouts, and SPEC does not say so.** Proven impossibility 3 (a vault in its own asset-signer PDA, or in the PDA of a host that was later burned, line 164 "inner orphaned forever") leaves a vault that is live and unredeemable for good. If it was activated, its weight stays in `total_active_weight` permanently. `retire_redeemed` needs a BURN redemption the PDA owner cannot sign, and `retire_burned` needs Core's burn tombstone. Activation is permissionless once its account holds 21,000 sats. Items 9 and 44 put the cost only on "the holder, to their own property" ("Costs: the asset"). Item 27, by contrast, states the denominator cost of retirable bare-burn dead weight. Here that cost is permanent and falls on every other vault: one level weight (at most 6, plus a boost until it expires) out of the 6,405-weight census, for each orphaned vault. Detected by `detectNestedVaults`; it cannot be undone on chain. **Repair:** state the permanent denominator cost beside impossibility 3 and in items 9 and 44. A program change is optional and is an owner decision before the lock. |

## Accepted limits, measured or bounded coverage, optional work

| ID / reports | Disposition |
|---|---|
| A1: Sonnet F1, Qwen-max R3-1/F-1 (HIGH), GLM M1, Opus R0-N1 | **The Autograph halt of the level FIFO was measured and did not occur.** The claim: an owner-writable Autograph state might make the reveal's Core `UpdatePluginV1` exhaust its heap, and the FIFO has no skip. Part A below grew real Autographs on the pinned Core across ten shapes (0 to 4,000-byte messages, the other four owner plugins added before or after growth). In every shape **Core's own heap refused the next signature first**. The four owner plugins still added afterwards. The actual MINT reveal (`0590a074…`) then simulated under the default heap and landed, at 50,372 to 59,128 CU. Together with R28.A1 (one 10,150-byte message plus all five owner plugins, landed) and the round-28 56-signature probe, this converts GLM's inference into bounded evidence. It is not a proof over every non-uniform mix of message sizes, so item 40's "bounded observations, not a proof for every plugin shape" stays correct. Item 40 already names the halt that follows if `UpdatePluginV1` breaks. Optional: record this grid in item 40, and add one durable arm at the largest measured multi-signature shape. A decoupled reveal is not supported by any measurement. |
| A2: Sonnet F3, Qwen-max R6-1 | SEAL accepts any Token-owned account as a reserve, without duplicate or mint-shape checks. This is round 24 A6 and item 38. `check-launch-params.mjs` requires exactly the ruled three reserve mints (100-101) and on-curve init authority, guardian and swap operator (98-99). The alarm pages on launch values that are not the ruled ones. The `current_size` gap is disproved: Core increments `current_size` only alongside `num_minted`, so `num_minted == 0` (MINT 629) implies it. |
| A3: Qwen-max R2b-1, F-3 | The `$CBOB` mint's absent authorities are not enforced on chain. This is round 28 A9: the ruled mint has neither authority, and the checker pins the address. |
| A4: Qwen-max R6-2 | The redemption window range 10..86400 is item 38. The checker requires `redeem_window_secs = 3600` (line 57). |
| A5: Qwen-max R2-1 | Activating a vault whose cbBTC account is frozen is item 28: claims defer and stay owed (P.18), and redemption is blocked while frozen. |
| A6: Qwen-max R5-1 | A charter claim by a program-owned PoB is item 43, measured by R27.C1/C2. |
| A7: Sonnet F5, Qwen-max R8-3 | Token-program bytes are fetched from mainnet when not cached, and fail loudly if mainnet has moved. SPEC 2205 says pins describe a captured version, not upgrade protection, and Core uses the same pattern. Archiving the three `.so` files, or adding an alarm watch on their hashes, is optional reproducibility hardening. |
| A8: Sonnet F6, Qwen-max R1s-1, R8-7, Opus R1s-M1 | Further arms would be useful: rate-ring `k > 2` and head wrap, more helper shapes (wSOL, delegate, non-ATA, two sources into one destination, a non-System `CloseAccount` destination), a landed redemption at the heap boundary, a stateful pool fuzz, and validating all pairs before transfers. The ring index `(head + 64 - k) % 64` reads correctly, and RL.7 replays every remembered window. SPL `CloseAccount` credits any writable account. The helper is atomic within the transaction. No incorrect result was shown. |
| A9: Opus R3-M1 | C's target follows B's produced slot, so a validator holding both the B and C rotations has extra choice. This is within item 26, which already says "three different leaders is likely, not guaranteed" and that C's leader chooses among many draws. Earlier leaders who withhold blocks cannot see the final result, so they gain no bias. |
| A10: Sonnet R4/limit 47, item 41 notes | The guardian being Gary's main wallet, and custodial keys, are existing rulings and limits (47, 41). |
| A11: all reports, launch section | Live rehearsal, holder pages, ceremonies, independent rebuilds, bug bounty and fuzzing remain open ship-gate work (items 22, 38, 50, 52, 53). They are not new defects. |

## Refuted or unsupported concrete premises

| ID / reports | Independent disposition |
|---|---|
| W1: Opus R1s-C1 (**CRITICAL**), Qwen-2.4t F1 (LOW) | **Disproved.** The claim is that the sweep helper's destination is not bound to the owner. A `dest == owner` check in the helper would control nothing. BURN and SEAL never require the helper; BURN checks only emptiness. The same owner-authorized `ExecuteV1` can call SPL Token directly from the asset-signer to any account. A custodial or phished key can simply TRANSFER the vault, which item 41 discloses ("a thief holding the keys can instead TRANSFER every vault"), and for a custodial vault the custodian IS the owner. This is round 28 W10. Six of the seven counted reports reached the same conclusion. |
| W2: Muse R0.3, Qwen-2.4t F3 (C.2) | D2 is repaired (see Method). C.2 follows an awaited claim that throws on failure; this is round 28 W7. |
| W3: GLM L3 | D3 is repaired. The block is a non-doc `//` comment that names its target, so it no longer attaches to `set_boost_terms`. `arm_swap_operator` has its own doc line (816). Line positions were preserved by design (VALIDATION.md:25). |
| W4: Longcat R0 "M1 false positive" | Misreads the repaired code as the original premise. Round 28 measured the pre-repair acceptance. |
| W5: Opus R0 point 3 | "The suite ships different bytes than mainnet" is false. The pins are the measured mainnet hashes, and `token_programs_verify` compares the bytes each validator actually loaded. |
| W6: Qwen-max R8-2 | **Wording accurate.** Item 32 describes ONE unretired bare burn reading one higher. N such burns raise live supply by N, but the cap by only `ceil(0.021 N)`: at most +1 below 48 simultaneous unretired bare burns, each of which destroys a vault. `retire_burned` is permissionless and the crank retires every pass. |
| W7: Qwen-2.4t F2 | A mint earlier in the same transaction raises the cap because it raises true live supply. Correct behavior. |
| W8: Qwen-max R4-1 | `set_round` checks exactly what SPEC 312 says it checks (price floor, cap > 0, window of at most a year). A past `opens_at` is a ratified, public choice, not a defect. |
| W9: Sonnet R5 omission | SPEC 46(2) already states selective admission ("admits only Proofs of Burn they hold ... on individual assets"). |
| W10: Sonnet F7 | No sentence in the guide is false. Items 45 and 47 and the section-10 concentration are not marked BUYER-FACING, and the guide does not claim to list everything. Adding them is optional. |
| W11: Muse R1.1 | Lamports parked at a reserve-ATA address before it exists strand only the sender's own SOL. The ATA program still creates over a funded System account, and a System-owned account holds no tokens. |
| W12: Qwen-max R8-4/R8-5 | The private `_rpcRequest` transport fails loudly when absent. v1 `transactionConfig` validation matches round 28 W1 and the SPEC format boundary. |
| W13: Longcat R1s(b) | "A PDA destination would fail the system transfer" is wrong (R27.S1 credits a non-System account), but it asserts no defect. |
| W14: Opus R1s-D1 | SPEC 1741-1745 correctly attributes the below-rent refusal to the System transfer. |
| W15: Qwen-2.4t R0 C1 fixture note | C1 keeps its boundary shape on purpose (R28.A2 pins it). No defect was claimed. |
| W16: DeepSeek lead (`MINT_CONFIG_SPACE`) | Recomputed from the struct: 64 fields, the struct ends at byte 1,005, and the space is 1,005 + 256 padding, matching the constant (`lib.rs:2475-2480`). The GOV/BURN offsets 41/141/454/679/711/712/749 agree with all five auditors who recomputed them. |
| W17: Opus R2-H1/R2-M1, R7-L1 | Withdrawn by the report itself as non-findings, and independently consistent with the arithmetic. |

## Measurements

Pinned Core `f03e7537…` and MINT `0590a074…` (equal to `.cache/ln/…/cbob_vault_mint.so`) ran on one fresh local validator. Genesis held a synthetic valid MintConfig v6 and ten VaultRecord v4 records, with a 600-byte attribute list. Assets were created through real Core with `Attributes` and `PermanentFreezeExecute` under MINT's PDA, and the collection authority was handed to that PDA. A scratch test-only CPI writer added one PDA autograph per step (`.cache/triage29p/writer/src/lib.rs`, `SIGM` mode, `.so` sha256 `c2323cce…`). Growth stopped at the first refused addition. The actual `reveal_level` was then simulated with a 400k CU limit and no heap request, and with 1.4M CU and a 256 KiB heap, and landed in FIFO order.

**Part A: Autograph growth vs reveal.**

| Message bytes per signature | Owner plugins | Max signatures | Next add | Asset bytes | Reveal CU (default heap) | Landed |
|---:|---|---:|---|---:|---:|---|
| 0 | before | 56 | OOM | 2,887 | 55,144 | yes |
| 16 | after (4/4 ok) | 40 | OOM | 2,951 | 58,866 | yes |
| 64 | after (4/4 ok) | 24 | OOM | 3,271 | 55,150 | yes |
| 150 | after (4/4 ok) | 15 | OOM | 3,661 | 54,125 | yes |
| 150 | before | 15 | OOM | 3,661 | 54,155 | yes |
| 300 | after (4/4 ok) | 10 | OOM | 4,231 | 53,289 | yes |
| 600 | after (4/4 ok) | 6 | OOM | 4,687 | 51,925 | yes |
| 600 | before | 6 | OOM | 4,687 | 51,955 | yes |
| 1,500 | after (4/4 ok) | 2 | OOM | 3,943 | 50,372 | yes |
| 4,000 | after (4/4 ok) | 1 | OOM | 4,907 | 50,494 | yes |

Every `level` read back as 1. This is a bounded grid with uniform message sizes, not a complete mint lifecycle.

**Part B: stranger log truncation.** The transaction was 496 bytes, cost a 5,000-lamport fee and landed successfully. It produced 167 log lines, 9,993 bytes, ending in the standalone `Log truncated`. It appears in MINT's signature list with `err: null`, and the reader threw `logs truncated by runtime`.

Evidence: `.cache/triage29p/probe.mjs`, `.cache/triage29p/probe.log`, `.cache/triage29p/run/results.json`, and `.cache/triage29p/run/reveal-*.json` (both simulations for each shape).

## Remaining requirements

- Repair M1 in every consumer of the reader, with a selftest that proves the pass survives a truncated transaction.
- Repair L1's enumeration, and bundle `sim/fixtures.mjs` and the other never-sent files in the next round.
- Correct D1 and D2.
- Rerun the affected selftests and gates, and record fresh build and rehearsal proofs before another frozen round.

Because M1 and L1 touch `bank/` and `scripts/`, the freeze resets.

Holder surfaces, the live rehearsal, initialization and the lock ceremony remain separate open ship gates.

**Result: QUORUM MET (7/8 counted; six required) and NOT CLEAN (0 CRITICAL, 0 HIGH, 1 MEDIUM, 1 LOW, 2 INFO). Counter 0/2.**
