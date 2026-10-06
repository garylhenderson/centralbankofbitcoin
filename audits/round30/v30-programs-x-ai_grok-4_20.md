**Round 29 verdict: NOT CLEAN. Quorum met (7/8 counted, 6 required). Counter 0/2.**

**32 deduplicated claim groups: 4 confirmed topics (0 CRITICAL, 0 HIGH, 1 MEDIUM, 1 LOW, 2 INFO) and 28 other dispositions (11 accepted/bounded, 17 refuted).** The MEDIUM reader gap and LOW coverage-gate gap overlap the off-chain pass; count each once in the combined round. All seven counted reports were read in full. DeepSeek's partial (length-exceeded, reasoning-only loop) was scanned for leads and contributed none that survived.

### Confirmed findings (repairs required)

**M1 (Sonnet F2, shared with off-chain Sonnet F2) — MEDIUM**  
A stranger can halt the entire alarm (and redemption-poster, revenue recovery) with one ordinary 496-byte legacy transaction that produces the runtime's standalone `Log truncated` marker. It costs a 5,000-lamport fee, needs no deployed program, names one of our programs as a read-only extra account, pads with 62 one-byte Memo instructions, lands with `err: null`, and appears in `getSignaturesForAddress(MINT)`. The shipped `readParsedTransaction` throws `unreadable parsed transaction: logs truncated by runtime`. In `bank/alarm.mjs:583` that call has no per-transaction handling; the throw aborts `main()`, the top-level catch pages `run_failed`, and the pass's other findings and cursors are discarded. Every later pass re-reads the same signature and fails again. The same throw stops the poster and revenue scan. SPEC's "Reader coverage boundary" describes a failed pass but not a repeatable, stranger-triggerable halt of all detection.  

**Repair (must be done):** Keep the reader's refusal. In each consumer catch the truncated case per signature, record a durable per-signature coverage gap, page it at HIGH (`log_coverage_gap`), do not parse its event lines, still run every instruction- and token-movement detector, and advance the cursor. The alarm keeps every cursor when a page is not delivered. Add a selftest that drives a truncated transaction through the extracted walk and requires the pass's other findings to still be reported. Update SPEC's boundary text. No program change.  

**L1 (GLM M2, Qwen-max R8-1/F-2, Sonnet F4, shared with off-chain Sonnet F3) — LOW**  
The coverage gate does not cover the files SPEC says it covers. SPEC claims it diffs every audit prompt against the file tree and fails if anything has never been read; the script calls its `have` list "Every file that is part of the system." In fact `have` is only `programs/*/src/lib.rs bank/*.mjs scripts/*.sh scripts/*.mjs tests/*.ts tests/*.mjs SPEC.md Cargo.toml Anchor.toml`. It reports "every file has been in at least one audit prompt (36 files)" and exits 0. Never-bundled tracked files include `sim/fixtures.mjs` (the 71-assertion simulation runs on it), the four non-helper `programs/*/Cargo.toml`, `tests/cpi-wrapper/Cargo.toml`, `launch/cbob-token.mainnet.json`, `scripts/pob-set.json`, and `Cargo.lock`. No program or deployed behavior is affected.  

**Repair (must be done):** Derive `have` from `git ls-files` minus a short, commented exclusion list (historical audit reports/runners, lockfiles, the `node_modules` link). Bundle every newly reported file, at least `sim/fixtures.mjs`. Make the SPEC sentence match.  

**D1 (Qwen-max R8-6) — INFO**  
`DESIGN-v6.md` misdescribes `activate` (lines 145-148 still say it adds the level weight and creates the stake record with `debt = weight * acc`). That is the pre-stage-3c behavior. The bullet at 158-161 states the two-step request-then-join correctly.  

**Repair:** Rewrite 145-148 as "request, then join after the next distribution, via `activate` again or `claim`."  

**D2 (GLM L4) — INFO**  
A permanently orphaned activated vault (nested in a burned host or its own asset-signer PDA) keeps its level weight (and any unexpired boost) in `total_active_weight` forever. It can never be redeemed (`retire_redeemed` needs a BURN redemption its PDA owner cannot sign) nor retired (`retire_burned` needs Core's burn tombstone). Activation is permissionless once its account holds 21,000 sats. Items 9 and 44 put the cost only on "the holder, to their own property." Item 27 states the denominator cost of retirable bare-burn dead weight. Here the cost is permanent and falls on every other vault. Detected by `detectNestedVaults`; nothing on chain can undo it.  

**Repair:** State the permanent denominator cost beside impossibility 3 and in items 9 and 44. A program change is optional and is an owner decision before the lock.

### Accepted limits, measured/bounded coverage, optional work

All other concrete claims were either already-accepted limits, bounded observations (e.g. the Autograph heap boundary, round 28 A1-A4 and the 10,150-byte + 5-owner-plugin grid), or refuted by measurement/source. The round-28 repairs (M1, L1, D2, D3) are present and verified. The 855/891/39/22/14/47/6/33/4/16/71 floors are unchanged and still equal their counts. The swap-fork and expiry-budget gates pass. No new CRITICAL or HIGH.

### Remaining requirements before launch

- Implement M1 and L1 repairs (per-signature gap handling, coverage-gate enumeration, selftests).
- Rerun affected selftests/gates and record fresh build/rehearsal proofs.
- Complete holder surfaces (item 50), live rehearsal with named pass/fail items (item 22, including one full live revenue cycle through both pools and one forced post-sweep hand recovery), initialization with all ruled values, and the lock ceremony (remove upgrade authority from all five programs).

Because M1 and L1 touch `bank/` and `scripts/`, the freeze resets. Rounds 30 and 31 must each be clean.

**Result: QUORUM MET (7/8 counted; 6 required) and NOT CLEAN (0 CRITICAL, 0 HIGH, 1 MEDIUM, 1 LOW, 2 INFO). Counter 0/2.**