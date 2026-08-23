[reasoning only]
Let me work through this carefully. This is round 19 of an AI audit process. The diff under audit is ec7d17e..HEAD, which contains:

1. Round 18's programs fix (MINT's Bank-key confinement narrowed to positional identity — MINT_IX_BANK_IDX)
2. Round 18's fourteen off-chain fixes (bank/distribute.mjs changes: census/denominator Object.hasOwn, dust bound comment, settledAsPayout, realDay, supersede logic clearing refused/nothingToDo, refusal NOTIFY + exitCode)
3. The self-audit's repairs (isTableRow hoisted, codeOnly comment stripping, MINT_IX_BANK_IDX struct parse arm, BankKeyOutside* arm now checks table rows, FLOOR bumps, manifest not trimming porcelain, audit19.ts verifyRoster)
4. scripts/bank-sign.sh canonical base64 round trip
5. scripts/cron-install.sh header fix
6. tests/3prog.test.ts payer changes (bank -> alice as payer in mints, new 9d.4 test)
7. scripts/audit18.ts and scripts/audit19.ts (new files)

Let me attack each target in order.

**R1. THE SELF-AUDIT'S OWN REPAIRS**

1. Template literal escaping: In audit19.ts, the prompt contains `\${FLOORS.onchain}` — wait, let me look. In audit19.ts's PROMPT:

```
**R1. THE SELF-AUDIT'S OWN REPAIRS. NEWEST CODE, LEAST READ, HIGHEST PRIOR.**
The builder audited its own round-18 repairs and found four defects. Every fix for those four is unaudited, and a source auditing itself is the weakest review arrangement that exists.
  - \${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT in the audit prompt: a backslash-escaped \${ renders as the placeholder, not the value, and tsc passes because it is valid TypeScript.
```

So in audit19.ts, the text `\${FLOORS.onchain}` is INTENTIONALLY escaped — it's describing the defect, so it should render as literal `${FLOORS.onchain}` in the output. That's correct: `\${` in a template literal renders as `${`. So the rendered prompt will say "${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT" — which is the intended description. OK.

But wait — are there other escaping defects? Let me scan audit19.ts's PROMPT for `${` usages:
- `${FLOORS.onchain}` (unescaped, in the "All four programs pass a ${FLOORS.onchain}-assertion suite" line) — correct, renders the value.
- `\${FLOORS.onchain}` in R1 — intentional literal. Correct.
- `${DIFF}` — correct.
- `${FOCUS === 'programs' ? ...}` — correct.
- `${f('...')}` — correct.
- `\`judgeRedemptionTx\`` etc — escaped backticks, fine.
- `\$CBOB` — in a template literal, `\$` renders as `$`. Fine.
- `per-\$1,000` — fine.

Now, in audit19.ts there's a subtle one: the header comment of the prompt says "THE DIFF UNDER AUDIT (2c8cd9b..HEAD) — every repair round 17 made, in one place". But the actual DIFF is `git diff ec7d17e..HEAD`. The prompt's R1-R7 text says "The complete diff ec7d17e..HEAD is at the end and IS the subject of this round" but the section header at the bottom still says "THE DIFF UNDER AUDIT (2c8cd9b..HEAD) — every repair round 17 made, in one place". That's a stale copy-paste from audit18.ts! Let me verify: in audit19.ts:

```
=====================================================================
THE DIFF UNDER AUDIT (2c8cd9b..HEAD) — every repair round 17 made, in one place
=====================================================================
${DIFF}
```

And DIFF = `git diff ec7d17e..HEAD`. So the header says 2c8cd9b..HEAD but the diff is ec7d17e..HEAD. The prompt body (R1) says "The complete diff ec7d17e..HEAD is at the end". So the section header contradicts both the actual diff range and the prompt's own description. This is a real defect — an auditor told the diff is "every repair round 17 made" when it's actually round 18's + self-audit. Also "THE AUTHOR'S OWN VERDICT ON ROUND 15 — attack it" with "(round 17's verdict is being written...)" — stale from audit18. These are copy-paste drift in the new file. Severity: MEDIUM (it mislabels the subject of the audit for the auditors; could cause confusion but the diff itself is correct).

Also in audit19.ts header comment: "IF ROUND 20 IS THE SECOND CLEAN ROUND IT MUST DIFFER FROM THIS LIST." Fine.

Another: audit19.ts's roster comment says "NONE OF THESE EIGHT WAS USED IN ROUND 18 — the ship gate requires the second of two clean rounds to change roster. Round 18 used grok-4.20, sonnet-5, gpt-5.6-sol-pro, gpt-5.5-pro, deepseek-v4-flash-0731, qwen3-max, mistral-large-2512 and command-a." And the roster is opus-5, fable-5, luna-pro, terra-pro, gemini-3.1-pro-preview, kimi-k3, glm-5.3, grok-4.6. OK consistent.

But wait — there's a leftover stale comment block in audit19.ts: the comment above the roster says "⚠️ SAME ROSTER AS ROUND 16, AND EVERY ID WAS RE-VERIFIED... The SHIP GATE only requires the SECOND of two clean rounds to change roster, so this one repeats round 16's; round 18 must differ." Then a SECOND comment block says "EVERY ID VERIFIED AGAINST GET /api/v1/models (422 models) ON 2026-08-23... NONE OF THESE EIGHT WAS USED IN ROUND 18". The first comment block is stale — it says "SAME ROSTER AS ROUND 16" and "this one repeats round 16's" but the roster is NOT round 16's; it's a new roster. The first block was copied from audit18.ts and contradicts the second block and the actual MODELS list. Two adjacent comments saying opposite things about the same roster. That's exactly the drift class. MEDIUM/LOW. It's in a comment, not code, but this repository treats comment drift as a first-class defect. And it's in the instrument that certifies.

Also: "qwen died mid-stream last round and minimax returned reasoning rather than a report, so both are dropped; deepseek-v4-pro and gemini-3.1-pro come in" — stale, describes round 16->17 roster changes, and neither deepseek-v4-pro nor gemini-3.1-pro is in this roster (gemini-3.1-pro-preview is). Stale comment.

2. isTableRow hoisted: `const isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)`

Is the predicate correct? A control-table row looks like: `| something | **ON-CHAIN.** ... |`. The regex requires: start with `| `, then anything, then `| **(ON-CHAIN