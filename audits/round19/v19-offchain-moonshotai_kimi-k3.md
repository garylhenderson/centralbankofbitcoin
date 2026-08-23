[reasoning only]
Let me work through this carefully. I'm auditing a diff that contains round-18 repairs and a self-audit of those repairs. The prompt itself is the audit19.ts prompt, and the diff under audit is ec7d17e..HEAD (though the header says 2c8cd9b..HEAD in one place — that's itself a discrepancy worth noting).

Let me go through the targets systematically.

**R1. The self-audit's own repairs.**

1. **Template literal / escaping defects.** The claim: `${FLOORS.onchain}` shipped as literal text because of a backslash-escaped `\${`. Let me look at audit19.ts for similar issues.

In audit19.ts, the PROMPT is a template literal. Let me scan for `\${` sequences:

- In R1 bullet: `\${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT in the audit prompt: a backslash-escaped \${ renders as the placeholder...`

Wait — this is in the PROMPT template literal in audit19.ts. The text says `\${FLOORS.onchain}`. In a template literal, `\${` is an escaped `${`, so it renders literally as `${FLOORS.onchain}`. That's INTENTIONAL here — the prompt is describing the defect to the auditor, so it wants the literal text. Let me check the prompt I received... Yes, in the prompt I received, R1 says: "${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT in the audit prompt". So the escaping worked as intended there.

But wait — are there OTHER places where interpolation was intended but escaped? Let me scan audit19.ts's PROMPT for `\$`:

- `the ten per-\$1,000 figures` — escaped `\$1,000`. In a template literal, `\$` renders as `$`. That's fine — it's just escaping a dollar sign, which doesn't need escaping but renders correctly as `$1,000`.
- `the \$CBOB upgrade cost ladder` — same, renders as `$CBOB`. Fine.
- `\`judgeRedemptionTx\`` — escaped backticks render as backticks. Fine.
- `\`bank: Signer\`` — fine.

Now the critical check: in the prompt I actually received, does the FLOORS interpolation work? The prompt says "All four programs pass a 284-assertion suite... plus 403 off-chain detector assertions proven in both directions, 63 allocation, and 19 against live mainnet." So `${FLOORS.onchain}` etc. DID interpolate — 284, 403, 63, 19. Good.

But wait — the R1 bullet in the received prompt says "${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT". Hmm, that's the escaped version rendering literally. That's intended — it's describing the historical defect. OK.

Now, is there a REAL escaping defect in audit19.ts? Let me look at the DIFF section header:

```
THE DIFF UNDER AUDIT (2c8cd9b..HEAD) — every repair round 17 made, in one place
```

But audit19.ts computes `DIFF=execSync(`cd ${R} && git diff ec7d17e..HEAD -- ...`)`. So the HEADER in the prompt says "2c8cd9b..HEAD — every repair round 17 made" but the actual diff is ec7d17e..HEAD. **The header text is stale — copied from audit18.ts and never updated.** The prompt I received indeed says "THE DIFF UNDER AUDIT (2c8cd9b..HEAD) — every repair round 17 made, in one place" while the actual subject is ec7d17e..HEAD (three commits: 982e5ef, 6368a11, 7f2f5a7). This is a real defect: the prompt's own description of the diff range is wrong. An auditor trusting the header would believe they're looking at round 17's repairs from 2c8cd9b, when the diff is actually from ec7d17e. Also "THE AUTHOR'S OWN VERDICT ON ROUND 15 — attack it" is stale (should be round 17 or 18). And "(round 17's verdict is being written; its findings are summarised above)" — stale copy from audit18.

Also in audit19.ts header comment: "The SHIP GATE only requires the SECOND of two clean rounds to change roster, so this one repeats round 16's; round 18 must differ." — that's stale text from audit18.ts, sitting ABOVE the new roster comment that says none of these eight was used in round 18. Two adjacent comments contradicting each other. The first block says "SAME ROSTER AS ROUND 16... this one repeats round 16's; round 18 must differ" and then the second says "NONE OF THESE EIGHT WAS USED IN ROUND 18". The stale comment block was left in. That's a documentation defect in the certification instrument — the roster rationale is self-contradictory.

Let me also check: audit19.ts says "IF ROUND 20 IS THE SECOND CLEAN ROUND IT MUST DIFFER FROM THIS LIST." OK.

2. **isTableRow hoisted predicate.** 

```js
const isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)
```

Is this a sound definition of a control-table row? It requires:
- Line starts with `| ` 
- Followed by anything, then `| **ON-CHAIN.**` or `**AUTOMATIC.**` or `**PROCEDURE.**`

What does it miss?
- A row whose verdict cell is `**ON-CHAIN**` without the trailing period. The pattern requires `\.\*\*` — period before closing bold. If SPEC ever writes `**ON-CHAIN**` (no period), the row vanishes from the gate. The gate would then fail the "every BankKeyOutside* is NAMED in the control table" check... actually no — if the row vanishes, `tableSrc.includes(n)` fails and the test goes red. That's fail-closed for the naming arm. But for the arm that counts "two of which are ON-CHAIN and both verified against the Rust" — `rows.filter(r => r.endsWith('claims ON-CHAIN, source says ON-CHAIN')).length, 2` — if a row is missed, count drops, test goes red. Fail-closed again. Hmm.
- What about a row with a leading space before the first `|`? `^\| ` requires the pipe at column 0. Markdown tables usually are at column 0. OK.
- What about `.*` being greedy across multiple `| **...` cells? A row like `| foo | **ON-CHAIN.** bar | **PROCEDURE.** baz |` would match at the first. Fine.
- The `.*` can also match across a cell containing `|` characters... it's a line regex, fine.

But here's a subtler issue: the predicate is used in three places now (tableRows, tableLines, and the "moved" assertion). Is it used EVERYWHERE it should be? The diff shows `tableRows` uses it, `tableLines` uses it. Are there other places in selftest.mjs that parse the control table with their own row predicate? I can't see the whole file. The diff shows the C5 arm uses `tableRows(src)`. I can't verify all sites from the diff alone. I should note this as unverifiable but flag the specific weaknesses of the predicate:

- Requires the verdict to be the SECOND cell (`^\| .*\| \*\*`). If the table is reordered so the verdict is the third column, `.*` still matches across the second cell... actually `^\| .*\| \*\*(ON-CHAIN...` — `.*` is greedy but can backtrack, so it matches if ANY cell after the first starts with `**ON-CHAIN.**` etc. Wait, `\| \*\*` requires pipe-space-`**`. If the verdict cell is `| **ON-CHAIN.** ... |`, then yes any cell position works as long as it's formatted `| **ON-CHAIN.**`. So column position is flexible. Good.
- What it misses: a verdict written as `**ON-CHAIN**` (no period), `**ON-CHAIN.**` with different spacing (`|**ON-CHAIN.**` no space after pipe), or a new verdict word (e.g. `**OFF-CHAIN.**` or `**PARTIAL.**`) — a new verdict category would silently drop rows from every arm that uses isTableRow. If SPEC adds a row with verdict `**PROCEDURE**` (no period), the naming arm goes red (fail closed) but the "would catch" assertions still pass. Actually wait — would it go red? The naming arm checks bankErrs are in tableSrc. If the BankKeyOutside rows still use the period form, they stay. A NEW row with a different format just isn't counted. The arms that count rows (`rows.filter(...).length, 2`) would go red if one of the two ON-CHAIN rows changed format. So mostly fail-closed. 

The more dangerous direction: `isTableRow` matching something that ISN'T a control-table row. Any line anywhere in SPEC that starts with `| ` and contains `| **PROCEDURE.**` — e.g., an example table in prose, a historical table, a quoted row in a comment. Then `tableSrc.includes('BankKeyOutsideMint')` could be satisfied by a row in the WRONG table. The arm's title says "NAMED in the control table" but the predicate is "anywhere in SPEC there's a line shaped like a table row containing the name". If SPEC has two tables (e.g., a changelog table quoting old rows), a deleted control row that survives in a quoted example still passes. That's the same "cardinality where attribution was needed" class, one level down. MEDIUM at most. Evidence: grep SPEC for all lines matching isTableRow and check they're all in THE SHIP GATE's table.

3. **distribute.mjs clearing both refused and nothingToDo.**

The repair: when a plan proceeds (`!plan.skip && !DRY`), it clears both `refused` and `nothingToDo`, recording `supersededAt`/`supersededWas`.

Orderings to check:

a) **Quiet then pay (same day):** Morning run: pool too small → `plan.skip = 'holding: ...'` → writes `nothingToDo`, `finishedAt`. Afternoon: revenue arrives, rerun → plan proceeds → clears `nothingToDo`, sets plan, pays. Good. But wait — the morning run also set `finishedAt`. The afternoon run proceeds and... does it clear `finishedAt`? Looking at the code: the supersede block clears `refused` and `nothingToDo` but NOT `finishedAt`. Then the payment loop runs. At the end: `if (!failed.length && !ambiguous.length) st.days[day].finishedAt = ...` — it re-sets finishedAt only if nothing failed. But if some transfers FAIL or are ambiguous, `finishedAt` is NOT re-set... **but it was already set by the morning quiet run and never cleared!** So a day that went quiet-then-paid-with-failures has `finishedAt` set from the morning, and `distribution_unfinished`... wait, what does distribution_unfinished check? From the selftest: `{ startedAt: 'x', paid: { v1: {sig}, v2: {sig: null} } }` with no finishedAt raises distribution_unfinished. And the stale-nothingToDo arm shows nothingToDo suppresses it. What about finishedAt? Presumably finishedAt also suppresses it (a finished day isn't unfinished). So: morning quiet run sets finishedAt + nothingToDo; afternoon run pays, 2 of 5 transfers ambiguous → finishedAt NOT overwritten