# Round 22, PROGRAMS pass: NOT CLEAN (no CRITICAL, no HIGH)

Frozen tree `baa7d0b` (HEAD `fa417ce`). 6 of 8 auditors counted (quorum 6):
gpt-6.1-sol-pro, gpt-6-astra-pro, grok-4.7, glm-5.3-prime, deepseek-v4-pro-0813,
mimo-v2.6-pro. Not counted: qwen3.8-max-prime (request failed), claude-opus-5.5
(provider `content_filter` partway, ~50k chars of real findings, verified but not
counted). Triage: an independent read-only agent verified every distinct finding
against the code; offsets, spaces, discriminators and the rate-limit arithmetic
re-measured in node; Core behaviour read from source.

**31 distinct findings: 7 CONFIRMED (1 program LOW, 1 INFO, 5 evidence gaps up to
MEDIUM), 5 ACCEPTED-LIMIT (25 and 26 worse than stated), 11 DOC-ONLY, 8 WRONG.**
Both HIGHs (grok: a self-owned vault earns as dead weight; deepseek: initialize
accepts a self-pointing treasury) refuted or already limit 38. Every offset and
discriminator correct; the pool's solvency invariant and the pending counters
hold by induction; no permanent block found.

| id | finding | verdict | done |
|---|---|---|---|
| F1 | Unsplit revenue in the revenue address escapes two-step activation: request, eligibility distribution, join, split, distribute in one tx shares it. Costs 200 $GARY + a funded vault; bounded to about an hour of sales by the crank's per-pass split | CONFIRMED, LOW | put to Gary (accept as a limit, or split in-line on chain); SPEC states it |
| F12 | A restart proposal created in the SAME second as a stop could lift it (`>` vs `<=`) | CONFIRMED, INFO | FIXED in MINT and GOV: the stop wins ties |
| F18 | No arm ever cast a NO vote or reached `ThresholdNotMet` | CONFIRMED, evidence gap | FIXED: F18.0-F18.2 (50% refused, exactly 60% passes) |
| F19 | Draw replay started from stored entropy, never re-derived from slot hashes | CONFIRMED, evidence gap | FIXED: L.3c re-derives sha256(hA‖hB‖hC‖asset) from the raw sysvar |
| F20 | Arms that cannot fail or prove less than claimed (X.7 empty plan, RL.1 tautology, 6.17 refused too soon, OR.5/S9.2 unpinned) | CONFIRMED | FIXED: X.7 relabelled honestly, RL.1 dropped, 6.17 waits the cooldown, reasons pinned |
| F21 | Retiring a vault still waiting to join never tested | CONFIRMED | FIXED: F21.1-F21.2 (redeemed and bare-burned, both counters) |
| F9 | A zero-token reserve account with SOL in it survives the burn | CONFIRMED (client) | redeem page closes every account (item 50); not on chain (a frozen empty account cannot be closed) |
| F3 / F4 | Limits 26 / 25 worse than stated (a skip keeps C with the same leader; C's leader can be chosen; same-slot cohorts share hashes; traffic captures only named records) | ACCEPTED, doc corrected | SPEC 25, 26 |
| F5, F23, F24 | Frozen vault account blocks the whole redemption; seven holder-guide overstatements; redeem page in present tense | DOC-ONLY | HOLDER-GUIDE and SPEC 28 corrected |
| F2, F10, F11, F13, F15, F22, F25, F26, F30 | doc and runbook items | DOC-ONLY | SPEC corrected or added as items 52-54 |

Recommended and not done: a CPI-wrapper program test of the stack-height check in
`retire_redeemed` (needs a fourth, test-only program; noted for the dress
rehearsal).

**Verdict: NOT CLEAN.** Counter stays 0 of 2.
