[reasoning only]
Let me work through this carefully. I'm being asked to audit a diff (ec7d17e..HEAD) containing round 18's programs fix, fourteen off-chain fixes, and a self-audit. The prompt is extremely detailed with specific targets R1-R7. Let me go through each systematically.

First, let me understand the code I have:

**R1. The self-audit's own repairs.**

1. `${FLOORS.onchain}` shipped as literal text — the escaped `\${FLOORS.onchain}` in audit19.ts. Let me look at audit19.ts's PROMPT template literal. In the diff for audit19.ts, I see:

```
+**R1. THE SELF-AUDIT'S OWN REPAIRS. NEWEST CODE, LEAST READ, HIGHEST PRIOR.**
...
+  - \${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT in the audit prompt: a backslash-escaped \${ renders as the placeholder, not the value, and tsc passes because it is valid TypeScript. It was caught only by RENDERING the prompt and reading the output. **Are there other template-literal or escaping defects in this diff that reading the source cannot see? Render it, do not read it.**
```

Wait — this is interesting. In audit19.ts, the line about the defect is written as `\${FLOORS.onchain}` — escaped, so it renders as literal `${FLOORS.onchain}` in the prompt. That's intentional here because they're *describing* the placeholder. But wait — the actual usage in the prompt body:

```
+All four programs pass a ${FLOORS.onchain}-assertion suite on a local validator...
```

That's unescaped, so it interpolates. Good.

But hold on — the prompt I was given (the one I'm reading now) says "All four programs pass a 284-assertion suite" — so the interpolation worked in the prompt I received. OK.

Now the question: are there OTHER template-literal or escaping defects in this diff? Let me scan audit19.ts and audit18.ts for escapes.

In audit18.ts:
```
+**R1. THE CRITICAL'S FIX — \`mint_vault\`'s BANK-KEY CONFINEMENT, WRITTEN HOURS AGO.**
```
Backslash-escaped backticks — those render as literal backticks. Fine.

```
+Round 17's CRITICAL: the round-15 theft (\`[<anything the Bank must sign>, SystemProgram.transfer(from=BANK)]\`...
```
Fine.

Hmm, what about `\`judgeRedemptionTx\`` etc. All escaped backticks render as backticks. Fine.

What about `${FLOORS.onchain}` in audit18.ts — unescaped, interpolates. Fine.

Now in audit19.ts, there's a subtle one. Look at this section:

```
+  - \${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT in the audit prompt: a backslash-escaped \${ renders as the placeholder, not the value...
```

This is intentional — describing the defect. But wait, is it? The self-audit found that `${FLOORS.onchain}` had shipped as literal text. Where? In audit18.ts presumably — the round-18 prompt. Let me check audit18.ts's prompt for an escaped `${`:

Looking at audit18.ts's PROMPT... I see `${FLOORS.onchain}`, `${FLOORS.detector}`, `${FLOORS.alloc}`, `${FLOORS.mainnet}` — all unescaped in the "All four programs pass" paragraph. And `${DIFF}`, `${FOCUS === 'programs' ? ... }`, `${f('...')}` — unescaped.

Hmm wait, but the self-audit says the defect was in the round-18 prompt (audit18.ts) and it was fixed. The diff shows audit18.ts as a NEW file in this diff (2c8cd9b..HEAD includes round 18's stuff). Actually wait — the diff under audit is ec7d17e..HEAD per the header, but the diff shown says "THE DIFF UNDER AUDIT (2c8cd9b..HEAD)". Hmm, there's an inconsistency: the prompt header says "The complete diff ec7d17e..HEAD is at the end and IS the subject of this round" but the diff itself is labeled 2c8cd9b..HEAD. And audit19.ts's DIFF is `git diff ec7d17e..HEAD`. So the diff I'm given (labeled 2c8cd9b..HEAD) is... the round-18 diff? And ec7d17e..HEAD would include audit19.ts itself? Actually the diff shown includes audit18.ts AND audit19.ts as new files. Confusing, but let me not go down that rabbit hole too far. Actually wait — this matters for one specific check: the diff shown to me includes scripts/audit19.ts, which contains the prompt I'm currently reading. The prompt I'm reading says "The complete diff ec7d17e..HEAD is at the end" but the diff is labeled 2c8cd9b..HEAD. That's a discrepancy worth noting — the round claims to audit ec7d17e..HEAD (three commits: 982e5ef, 6368a11, 7f2f5a7) but the DIFF embedded is 2c8cd9b..HEAD. Hmm, actually if 2c8cd9b is an ancestor of ec7d17e, then 2c8cd9b..HEAD ⊇ ec7d17e..HEAD. The round-18 diff was 2c8cd9b..HEAD (round 17 ran against 2c8cd9b). So the diff shown includes round 17's repairs AND round 18's. That's consistent with "It carries round 18's programs fix, round 18's fourteen off-chain fixes, and the builder's SELF-AUDIT of those fixes" — plus round 17's repairs. OK.

Now — the escaping defect hunt. The key instruction: "Render it, do not read it." Let me carefully render the template literals in audit19.ts.

In audit19.ts PROMPT, I notice:

```
+  - \${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT in the audit prompt...
```

Renders as `${FLOORS.onchain}` literal — intended, since it's describing the defect.

But here's a thing — in the R2 section of audit19.ts's prompt:

```
+  - settledAsPayout() was added because holdDays accepted ONE of paymentState's five answers...
```

No escapes. Fine.

What about this line in audit19.ts:

```
+**R3. scripts/bank-sign.sh — THE CANONICAL BASE64 ROUND TRIP.**
```

Fine.

Hmm, let me look for actual escaping bugs. In audit18.ts:

```
+const PROMPT=`You are an independent security auditor...
```

Inside, there's:

```
+Round 17 ran against commit 2c8cd9b, found a live CRITICAL and eleven more, and fixed twelve.
```

Fine.

What about the `${FOCUS === 'programs' ? ...}` conditional — in audit18.ts and audit19.ts both. Fine.

Wait — here's something. In audit19.ts, look at the roster comment:

```
+/** ⚠️ SAME ROSTER AS ROUND 16, AND EVERY ID WAS RE-VERIFIED AGAINST
+ *  `GET /api/v1/models` BEFORE THIS RAN — all eight are present in the live list
+ *  of 421. The SHIP GATE only requires the SECOND of two clean rounds to change
+ *  roster, so this one repeats round 16's; round 18 must differ.
+ *
+ *  Kept from round 16's note because it cost two auditors: qwen died mid-stream last round and minimax
+ *  returned reasoning rather than a report, so both are dropped; deepseek-v4-pro
+ *  and gemini-3.1-pro come in. ...
```

This comment block is copied verbatim from audit18.ts into audit19.ts — but it's FALSE in audit19.ts's context. The comment says "SAME ROSTER AS ROUND 16... this one repeats round 16's; round 18 must differ." But audit19.ts's actual roster is DIFFERENT: claude-opus-5, claude-fable-5, gpt-5.6-luna-pro, gpt-5.6-terra-pro, gemini-3.1-pro-preview, kimi-k3, glm-5.3, grok-4.6. And the very next comment block in audit19.ts says "NONE OF THESE EIGHT WAS USED IN ROUND 18... Round 18 used grok-4.20, sonnet-5, gpt-5.6-sol-pro, gpt-5.5-pro, deepseek-v4-flash-0731, qwen3-max, mistral-large-2512 and command-a."

So audit19.ts contains a stale copied comment that directly contradicts the code beside it. The comment says "SAME ROSTER AS ROUND 16" while the roster is entirely different and the adjacent comment says so. This is exactly the documentation-drift defect class this repository keeps committing — a comment that describes a different roster. It's not a template-literal defect but it IS a defect of the shape "reading the source" — actually it's visible reading the source. Hmm, but the R1 instruction asks about template-literal/escaping defects specifically, then isTableRow, then the refused/nothingToDo clearing, then the manifest.

Wait, actually — hold on. Let me re-read: audit18.ts's roster is grok-4.20, claude-sonnet-5, gpt-5.6-sol-pro, gpt-5.5-pro, deepseek-v4-flash-0731, qwen3-max, mistral-large-2512, command-a. And audit18.ts's comment says "SAME ROSTER AS ROUND 16... qwen died mid-stream last round and minimax returned reasoning... so both are dropped; deepseek-v4-pro and gemini-3.1-pro come in."

But wait — audit18.ts's roster INCLUDES qwen3-max! The comment says "qwen died mid-stream last round and minimax returned reasoning rather than a report, so both are dropped" — but qwen3-max is IN the roster. And "deepseek-v4-pro and gemini-3.1-pro come in" — but the roster has deepseek-v4-flash-0731 (not -pro) and NO gemini at all! So the comment in audit18.ts contradicts its own roster: it says qwen was dropped, but qwen3-max is present; it says gemini-3.1-pro comes in, but no gemini is in the list.

Hmm wait, let me re-read audit18.ts's roster:

```
const MODELS=(process.env.MODELS||[
  'x-ai/grok-4.20',
  'anthropic/claude-sonnet-5',
  'openai/gpt-5.6-sol-pro',
  'openai/gpt-5.5-pro',
  'deepseek/deepseek-v4-flash-0731',
  'qwen/qwen3-max',
  'mistralai/mistral-large-2512',
  'cohere/command-a',
].join(',')).split(',')
```

And the comment above it:

```
/** ⚠️ SAME ROSTER AS ROUND 16, AND EVERY ID WAS RE-VERIFIED AGAINST
 *  `GET /api/v1/models` BEFORE THIS RAN — all eight are present in the live list
 *  of 421. The SHIP GATE only requires the SECOND of two clean rounds to change
 *  roster, so this one repeats round 16's; round 18 must differ.
 *
 *  Kept from round 16's note because it cost two auditors: qwen died mid-stream last round and minimax
 *  returned reasoning rather than a report, so both are dropped; deepseek-v4-pro
 *  and gemini-3.1-pro come in. The SHIP GATE requires the second of two clean
 *  rounds to use a different roster, and there is no reason to wait for that to
 *  start varying who reads — eight models re-reading their own repairs is the
 *  weaker arrangement of the two.
 *
 *  ⚠️ AND THE IDS ARE REAL ONES, LOOKED UP. The first attempt at this roster
 *  invented `deepseek/deepseek-v4` and `mistralai/mistral-large-3`; OpenRouter
 *  returned `not a valid model ID` for both and two of eight auditors were
 *  silently missing from the round. ...
```

So within audit18.ts: the comment claims "SAME ROSTER AS ROUND 16" and describes dropping qwen and minimax and adding deepseek-v4-pro and gemini-3.1-pro. The actual roster contains qwen3-max (not dropped), deepseek-v4-flash-0731 (not -pro), mistral-large-2512 (present, though comment says minimax dropped — minimax isn't mistral... hmm, "minimax" is a different vendor; mistral-large-2512 is Mistral. So maybe minimax was dropped and mistral is different). But qwen3-max being present while the comment says "qwen died mid-stream last round... so both are dropped" is a direct contradiction. And "gemini-3.1-pro come in" — no gemini in the roster. And "deepseek-v4-pro" vs "deepseek-v4-flash-0731".

Also "all eight are present in the live list of 421" — but then audit19.ts says the live list has 422 models on 2026-08-23 and that round 18's first roster invented ids. Hmm, and audit19.ts's copied comment says "all eight are present in the live list of 421" while its own verification comment says 422. Minor.

But the bigger issue: audit19.ts copies the "SAME ROSTER AS ROUND 16" comment verbatim even though its roster is completely different and the adjacent comment says "NONE OF THESE EIGHT WAS USED IN ROUND 18". So audit19.ts contains a self-contradictory pair of comments: one says "SAME ROSTER AS ROUND 16... this one repeats round 16's" and the other says "NONE OF THESE EIGHT WAS USED IN ROUND 18". Both can't be true. Actually wait — could both be true? If round 16's roster = round 19's roster, and round 18's roster differed... The comment says "this one repeats round 16's; round 18 must differ" — in audit19.ts, "this one" would be round 19. Round 19's roster: opus-5, fable-5, luna-pro, terra-pro, gemini-3.1-pro-preview, kimi-k3, glm-5.3, grok-4.6. Round 18's roster: grok-4.20, sonnet-5, sol-pro, 5.5-pro, deepseek-flash, qwen3-max, mistral, command-a. Was round 16's roster the same as round 19's? The audit19 comment says "the other seven last read it at round 17" — so seven of round 19's eight audited at round 17. And "claude-fable-5 has never audited this project at all". Hmm, if round 16 = round 17 rosters (the ship gate requires the second of two clean rounds to change roster, so 16 and 17 might share), then round 19 repeating round 16's roster would mean round 19 = round 16 = round 17's roster. But then "NONE OF THESE EIGHT WAS USED IN ROUND 18" — consistent. But the copied comment also says "qwen died mid-stream last round and minimax returned reasoning rather than a report, so both are dropped; deepseek-v4-pro and gemini-3.1-pro come in" — qwen3-max and minimax are not in round 19's roster, and gemini-3.1-pro-preview IS in round 19's roster. Hmm, so for round 19 the "qwen dropped, gemini comes in" part could actually be... wait no. The comment says "Kept from round 16's note" — it's describing round 16's roster changes relative to round 15. In audit19.ts this is stale prose describing a roster decision from three rounds ago, presented as if current. The first line "SAME ROSTER AS ROUND 16... so this one repeats round 16's; round 18 must differ" — in audit19.ts, "round 18 must differ" is now in the past tense and wrong (round 18 DID differ). And "this one repeats round 16's" — does round 19 repeat round 16? If round 16's roster was opus-5, fable-5, luna, terra, gemini, kimi, glm, grok-4.6 — plausible. But then the note "qwen died mid-stream last round... deepseek-v4-pro and gemini-3.1-pro come in" describes round 16's construction. It's confusing but not necessarily false... except "SAME ROSTER AS ROUND 16" + "NONE OF THESE EIGHT WAS USED IN ROUND 18" + round 18's comment ALSO saying "SAME ROSTER AS ROUND 16" — round 18's roster is NOT round 16's roster (they're completely different lists). So at most one of audit18.ts's "SAME ROSTER AS ROUND 16" and audit19.ts's "SAME ROSTER AS ROUND 16" can be true. One of them is false. Given audit19 says round 18 used grok-4.20/sonnet-5/etc. and claims round 19's list is the round-16/17 one ("the other seven last read it at round 17"), audit18.ts's claim "SAME ROSTER AS ROUND 16" is FALSE — round 18's roster (grok-4.20, sonnet-5, sol-pro, 5.5-pro, deepseek-flash, qwen3-max, mistral, command-a) is not round 16's roster (opus-5, fable-5, luna, terra, gemini, kimi, glm, grok-4.6). Hmm wait, but I don't have round 16's actual roster. Let me think about what's verifiable from the diff alone:

- audit18.ts claims its roster is "SAME ROSTER AS ROUND 16".
- audit19.ts claims round 18 used [grok-4.20, sonnet-5, gpt-5.6-sol-pro, gpt-5.5-pro, deepseek-v4-flash-0731, qwen3-max, mistral-large-2512, command-a] — which matches audit18.ts's actual roster. Good.
- audit19.ts claims its own roster was NOT used in round 18, seven of eight last read at round 17, and (via the copied comment) is "the same roster as round 16".

If audit19's roster = round 16's roster, and audit18's roster ≠ audit19's roster, then audit18's "SAME ROSTER AS ROUND 16" is false. Also within audit18.ts itself: the comment says qwen was dropped but qwen3-max is in the roster; says gemini-3.1-pro comes in but no gemini is in the roster; says deepseek-v4-pro comes in but the roster has deepseek-v4-flash-0731. These are internal contradictions visible in a single file. That's a real finding — the roster documentation in audit18.ts is wrong in at least three particulars, and the copied comment in audit19.ts is stale. Severity: LOW/MEDIUM — it's documentation of the audit process, not money code, but this process IS the certification, and a future reader trying to reconstruct which models audited which round will be misled. The manifest records actual models used, so the receipt exists. I'd call it LOW-to-MEDIUM. Given "this process is the certification," misdocumentation of who audited what is worth MEDIUM? Hmm. The manifest JSON records the models, so the ground truth is recoverable. I'll file it as LOW/MEDIUM — let me decide later. Actually, given the project's own standards (comments that deny reality are defects), and this is the certification instrument, I'll say MEDIUM for audit18.ts's internally-contradictory roster note (it says qwen dropped while qwen is present — that's a comment contradicting the code beside it, the exact class round 15 flagged), and note audit19.ts's stale copy.

Wait, actually — I need to double-check the qwen thing. "qwen died mid-stream last round and minimax returned reasoning rather than a report, so both are dropped" — "last round" from round 16's perspective would be round 15. So the note describes round 16's roster construction: drop qwen and minimax (from round 15's roster), add deepseek-v4-pro and gemini-3.1-pro. But audit18.ts's roster HAS qwen3-max. So if the note is "kept from round 16's note," then round 18's roster including qwen3-max contradicts the note's claim that qwen was dropped. Unless round 18 re-added qwen. Either way the comment as it stands in audit18.ts misdescribes the roster below it. And "deepseek-v4-pro" ≠ "deepseek-v4-flash-0731", "gemini-3.1-pro" not present. So the comment is wrong on at least three particulars relative to its own file's roster. And the headline claim "SAME ROSTER AS ROUND 16" is contradicted by audit19.ts's statement that round 18's roster differs from round 16/17's. OK, solid finding.

Now, the template-literal rendering question. Let me actually render audit19.ts's PROMPT carefully, looking for escapes that produce wrong output.

In audit19.ts PROMPT:

1. `\`mint_vault\`` etc. — escaped backticks render as backticks. Fine.
2. `\${FLOORS.onchain}` in the R1 bullet — renders literally as "${FLOORS.onchain}". INTENDED (describing the defect).
3. `${FLOORS.onchain}` in the "All four programs pass" paragraph — interpolates. Fine.

Hmm wait — actually, let me look at the R1 bullet again very carefully:

```
+  - \${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT in the audit prompt: a backslash-escaped \${ renders as the placeholder, not the value, and tsc passes because it is valid TypeScript.
```

Renders as: "- ${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT in the audit prompt: a backslash-escaped ${ renders as the placeholder, not the value..." — that's the intent. Fine.

4. What about `\$CBOB` — in the KNOWN AND OPEN section: "the \$CBOB upgrade cost ladder" — renders as "$CBOB". Fine.

5. In audit18.ts: "describing the payout as \"daily equal\"" — wait, let me check. In audit18.ts: `describing the payout as "daily equal" months after` — inside a template literal, double quotes are fine. Fine.

Hmm, what about the DIFF variable itself? `const DIFF=execSync(...)` — the diff contains backticks and `${` sequences? The diff is inserted via `${DIFF}` — since DIFF is a runtime string value, its contents are NOT re-parsed as template. Fine.

But WAIT. Here's a subtle one: the diff embedded in the prompt includes the text of bank-sign.sh and other files with `${LIVE[@]+"${LIVE[@]}"}` etc. — but again, runtime interpolation of a variable is safe.

What about the selftest.mjs regex strings inside the diff: `/^\s*exec .*cosign\.mjs --tx "\$TX" \$\{LIVE\[@\]\+"\$\{LIVE\[@\]\}"\}\s*$/m` — inside the DIFF string, fine.

OK here's another angle: the prompt I received (this actual prompt) — does it show any rendering defects? Let me check the prompt text I was given:

"All four programs pass a 284-assertion suite" — interpolated correctly (assuming MIN_ASSERTIONS=284).

Hmm wait, actually — the prompt says 284, and run-tests.sh in the diff shows DET_FLOOR=403, ALLOC_FLOOR=63, MAINNET_FLOOR=19. And the prompt says "403 off-chain detector assertions... 63 allocation, and 19 against live mainnet". Consistent with the diff. And FLOORS.onchain=284 — not shown in the diff's run-tests.sh hunk (the hunk only shows DET_FLOOR and ALLOC_FLOOR changes), so I can't verify 284 from the diff, but the prompt renders a number, so the interpolation worked.

Now — is there a rendering defect in the prompt I can detect? Let me look at the R5 bullet in my prompt:

"Two new arms assert that a stale nothingToDo suppresses distribution_unfinished."

Fine. What about... hmm, let me look at the section in my prompt:

"**R2. THE ROUND-18 OFF-CHAIN REPAIRS (bank/distribute.mjs).**"

Fine.

OK here's one thing I notice in the prompt I received — in the R1 section: "  - ${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT in the audit prompt" — wait, in MY prompt, it reads "${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT" — with the literal placeholder! Let me re-read the prompt I was given:

"  - ${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT in the audit prompt: a backslash-escaped ${ renders as the placeholder, not the value, and tsc passes because it is valid TypeScript."

Yes! In MY prompt, it shows the literal `${FLOORS.onchain}` — which is the INTENDED rendering (describing the round-18 defect). OK so that's fine and intended.

Hmm, but wait — there's something else. Let me scan my prompt for any OTHER literal `${...}` that shouldn't be there... 

"Every one of those numbers sits behind a FLOOR" — fine.

Looking at the diff section headers... "THE DIFF UNDER AUDIT (2c8cd9b..HEAD)" — hmm, my prompt's header says "The complete diff ec7d17e..HEAD is at the end and IS the subject of this round" but the diff is titled "THE DIFF UNDER AUDIT (2c8cd9b..HEAD) — every repair round 17 made, in one place". So the prompt claims the subject is ec7d17e..HEAD (three commits: 982e5ef round-18 programs, 6368a11 round-18 off-chain, 7f2f5a7 self-audit) but embeds a diff labeled 2c8cd9b..HEAD described as "every repair round 17 made". The label inside the prompt template is hardcoded: `THE DIFF UNDER AUDIT (2c8cd9b..HEAD) — every repair round 17 made, in one place` — while the DIFF variable is `git diff ec7d17e..HEAD`. So the prompt's description of its own diff is WRONG in two ways: (a) the commit range stated (2c8cd9b..HEAD) is not the range actually embedded (ec7d17e..HEAD), and (b) "every repair round 17 made" describes round 17's repairs, not round 18's + self-audit. This is a copy-paste from audit18.ts's prompt where the diff WAS 2c8cd9b..HEAD and WAS round 17's repairs. In audit19.ts, the DIFF was changed to ec7d17e..HEAD but the header text around it was not updated. That's a real defect in the certification instrument: the round tells auditors they're attacking "every repair round 17 made" when they're actually being handed round 18's repairs + self-audit. An auditor reading the header would mis-attribute the diff's contents. Also the trailing section "THE AUTHOR'S OWN VERDICT ON ROUND 15 — attack it / (round 17's verdict is being written; its findings are summarised above)" — still says round 15/round 17 in audit19.ts! That's stale: round 19's prompt should reference round 18's verdict, not round 17's. Let me verify in audit19.ts:

```
+=====================================================================
+THE AUTHOR'S OWN VERDICT ON ROUND 15 — attack it
+=====================================================================
+(round 17's verdict is being written; its findings are summarised above)
```

Yes — in audit19.ts, this section still says "ROUND 15" and "round 17's verdict is being written". Stale copy-paste from audit18.ts. In a round whose subject is round 18's repairs and the self-audit, telling auditors "the author's own verdict on round 15 — attack it" and "round 17's verdict is being written" is wrong on both counts. This is exactly the "one-of-N-sites" / stale-prose defect class, committed inside the newest file in the diff. And notably, MY prompt (the one I'm responding to) contains these same stale sections — I can see "THE AUTHOR'S OWN VERDICT ON ROUND 15 — attack it" and "(round 17's verdict is being written; its findings are summarised above)" at the end. So this defect is LIVE in the very prompt I'm reading. That's strong evidence — I can point to it in my own prompt.

Also: "THE FILES THIS ROUND IS ABOUT — AND WHY THIS BUNDLE IS SHORT ON PURPOSE" section in audit19.ts still contains the round-18-era correction text about round 17's 909k-char bundle — that's arguably still relevant context, fine.

But the diff header mismatch is the sharpest one: audit19.ts line `THE DIFF UNDER AUDIT (2c8cd9b..HEAD) — every repair round 17 made, in one place` vs `const DIFF=execSync(...git diff ec7d17e..HEAD...)`. The rendered prompt tells the auditor the wrong range AND the wrong provenance. Evidence: my own prompt contains "THE DIFF UNDER AUDIT (2c8cd9b..HEAD) — every repair round 17 made" while the round's R1 says "The complete diff ec7d17e..HEAD is at the end and IS the subject of this round." Both statements appear in the same rendered prompt and contradict each other. That's checkable by anyone rendering the prompt. 

Severity: this misdirects eight auditors about what they're auditing. It doesn't move money. But the certification IS the product here. I'd rate MEDIUM. Actually — hmm. Consider: an auditor told "every repair round 17 made" might spend attention on round-17 repairs (which were already audited in round 18) rather than the three unseen commits. The R1-R7 bullets do correctly describe round 18 + self-audit. So the misdirection is partial. MEDIUM seems right, maybe LOW-MEDIUM. I'll file MEDIUM given the project treats prompt-accuracy as load-bearing (they read floors from files precisely so the prompt can't drift).

Also — one more template-literal check in audit19.ts. The FOCUS conditional:

```
+${FOCUS === 'programs' ? `
+=== SEAL: programs/cbob-vaults/src/lib.rs — the confinement and its seen_self guard ===
+${f('programs/cbob-vaults/src/lib.rs')}
...
```

Fine.

And in the bundle note: "\`scripts/audit-coverage.sh\` gates that and passes at 27 of 27 files" — fine.

What about audit18.ts's prompt — it has the same structure. In audit18.ts the diff header says 2c8cd9b..HEAD and DIFF is 2c8cd9b..HEAD — consistent there. The verdict section says round 15/round 17 — for round 18's prompt, "THE AUTHOR'S OWN VERDICT ON ROUND 15" — hmm, round 18's prompt auditing round 17's repairs should say "the author's own verdict on round 17". It says round 15. Also stale? Round 17's prompt presumably said round 15 (auditing round 15's repairs? no wait). Ugh, the round numbering: round 17 audited round 15's repairs? The audit18.ts header says "Round 18 — ROUND 17'S REPAIRS" and "Round 17 found a live CRITICAL (the round-15 theft...)". And "THE AUTHOR'S OWN VERDICT ON ROUND 15 — attack it / (round 17's verdict is being written...)". Hmm, if round 17 audited round 15's repairs, then round 18's prompt saying "verdict on round 15" is stale — should be round 17. And round 19's prompt saying "verdict on round 15 / round 17's verdict is being written" is doubly stale — should be round 18's verdict. Either way, in audit19.ts it's wrong. I'll report it as part of the same finding.

Now — isTableRow. The hoisted predicate:

```js
const isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)
```

Question: is this a sound definition of a control-table row? What table shape does it miss?

The regex requires: line starts with `| ` (pipe space), then anything, then `| **ON-CHAIN.**` or `| **AUTOMATIC.**` or `| **PROCEDURE.**` — i.e., the fourth column must be exactly one of the three tags followed by a period and double asterisk.

What it misses:
- A row whose control column uses a different tag (e.g., if a new tag like **POLICY.** or **MITIGATION.** were added) — silently not a row. Fail-open for the "every BankKeyOutside* error must be NAMED in the table" check: if the table's format changed, bankErrs.filter(n => !tableSrc.includes(n)) would go red (names not found) — actually that fails CLOSED for the naming check. But for the C5 check ("THE CONTROL TABLE'S FOURTH COLUMN IS MECHANICALLY TRUE"), rows that don't match isTableRow are invisible — a row that claims something in a new format wouldn't be verified. Hmm.
- A row where the tag is not followed by a period, or has trailing text after `**` before the next pipe? The regex doesn't require the `**` to be immediately followed by `|` — `.*` after? No wait: the regex is `/^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/` — it ends after `\*\*`. So a line like `| x | y | z | **ON-CHAIN.** but actually procedure` would still match (the regex doesn't anchor the end). So a row that says "**ON-CHAIN.** (well, mostly)" matches. Is that a defect? The C5 arm then parses the row further — I don't have the full C5 code, just the filter and map. The map extracts something with a pattern (the comment mentions "NO CLOSING BACKTICK IN THE PATTERN. The reconcile row names its file inside a longer command"). I can't fully evaluate C5 without the rest.
- More important: can a REAL control row fail to match? If a row's fourth column is `**ON-CHAIN.**` — matches. What if the table ever gains a row where the fourth column is `**ON-CHAIN.**` but the line begins with `|` without a space (`|x | ...`)? The regex requires `^\| ` — pipe followed by space. Markdown tables usually have `| ` after trimming. A row starting `|**ON-CHAIN.**`... unlikely.
- What about a row that wraps? If a control row's description is long and the author wraps the line, the second half of the wrapped row is not a table row by this regex, and the first half might not contain the tag. Missed row → the BankKeyOutside naming check would catch missing names only if the NAME is on the non-matching part. Hmm.

The sharper question the prompt asks: "Is one definition now genuinely used everywhere it should be?" — In the diff, `tableRows` uses isTableRow, and the new `tableLines` uses isTableRow. But are there OTHER places in selftest.mjs that identify table rows with a different/inline regex? The diff shows the old code had the inline regex in `tableRows` only (changed to use isTableRow). But C5's arm — "rows.filter(r => r.endsWith('claims ON-CHAIN, source says ON-CHAIN'))" — `rows` comes from tableRows presumably. I can't see whether there are other row-detection sites elsewhere in selftest.mjs (the file is 1700+ lines; I only see fragments). I should flag: unverifiable from the diff whether isTableRow is used at every site that identifies control-table rows; the diff only shows two sites converted. The claim "one definition now genuinely used everywhere" cannot be confirmed from the diff — and the round's own history (one-of-N-sites) demands the check. I can note that the diff itself contains evidence: the diff shows only `tableRows` being changed to use isTableRow plus the new `tableLines`. If any other arm in the 1700-line file scrapes the table with its own predicate, it's still drifted. I can't prove it either way — I should say what evidence would exist: `grep -n "ON-CHAIN|AUTOMATIC|PROCEDURE" bank/selftest.mjs` should show exactly one regex site. That's checkable.

Also — is the predicate itself correct? One more subtlety: `isTableRow` matches lines in ANY markdown table in SPEC.md, not just THE control table. If SPEC.md contains another table whose fourth column happens to carry **PROCEDURE.** (e.g., a "policy table" elsewhere), those rows would be included in tableLines, and a BankKeyOutside name appearing in THAT table's prose would count as "named in the control table." The old whole-file check was too loose; the new one is tighter but still not pinned to the specific table (no header anchor like "## THE SHIP GATE" or the table header row). Is that exploitable? It requires another table with the same tag format — speculative. Worth a LOW note: the predicate defines "a line that looks like a control row" not "a row of THE control table"; pinning to the section header would be sounder. Evidence: if SPEC.md gains a second table using the same tags, `tableLines(specSrc)` includes it — checkable by counting rows vs the actual table.

Now the refused/nothingToDo clearing. The new code in distribute.mjs:

```js
if (!plan.skip && !DRY) {
  const priorVerdict = st.days[day].refused || st.days[day].nothingToDo
  if (priorVerdict) {
    st.days[day].supersededAt = new Date().toISOString()
    st.days[day].supersededWas = priorVerdict
    const wasRefusal = Boolean(st.days[day].refused)
    delete st.days[day].refused
    delete st.days[day].nothingToDo
    console.log(...)
  }
  st.days[day].plan = {...}
  ...
```

Wait — I need to see the surrounding context. The diff hunk starts at `if (!plan.skip && !DRY) {`. Hmm, wait — actually let me re-read. The hunk:

```
@@ -476,6 +541,35 @@ async function main() {
       if (!d.pay) plan = { ...plan, skip: `holding: ${d.reason}` }
     }
     if (!plan.skip && !DRY) {
+      // ... comments ...
+      const priorVerdict = st.days[day].refused || st.days[day].nothingToDo
+      if (priorVerdict) {
+        st.days[day].supersededAt = new Date().toISOString()
+        st.days[day].supersededWas = priorVerdict
+        const wasRefusal = Boolean(st.days[day].refused)
+        delete st.days[day].refused
+        delete st.days[day].nothingToDo
+        console.log(`  a ${wasRefusal ? 'REFUSAL' : 'no-pay verdict'} earlier today is SUPERSEDED by this plan: ${priorVerdict}`)
+      }
       st.days[day].plan = { activated: plan.activated, ... }
```

And later:

```
       if (plan.refusal) st.days[day].refused = plan.skip
       st.days[day].finishedAt = new Date().toISOString(); save(st)
     }
+    // refusal pages
+    if (plan.refusal) {
+      const msg = `CBOB DISTRIBUTION REFUSED and paid nobody: ${plan.skip}`
+      console.error(msg)
+      if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} }
+      process.exitCode = 1
+    }
     return
   }
```

Hmm wait, I need to reconstruct the control flow. There's `if (!plan.skip && !DRY) { ... }` — the plan proceeds (writes plan, pays, writes finishedAt). Then after that block, `if (plan.refusal) { ... }` — pages. But wait, if `!plan.skip`, can `plan.refusal` be true? The refusal path sets `plan.skip` presumably (the refusal branch: "if (plan.refusal) st.days[day].refused = plan.skip" — that's inside some other block). Let me reconstruct:

From the visible fragments:
- `if (!d.pay) plan = { ...plan, skip: 'holding: ...' }` — holding path sets skip.
- `if (!plan.skip && !DRY) { ...pay... }` — proceeds to pay.
- Somewhere: `if (plan.refusal) st.days[day].refused = plan.skip` — inside the pay block? The diff shows:

```
       if (plan.refusal) st.days[day].refused = plan.skip
       st.days[day].finishedAt = new Date().toISOString(); save(st)
     }
```

The `}` closes the `if (!plan.skip && !DRY)` block? But then `if (plan.refusal)` inside would never fire since plan.skip is falsy... unless plan.refusal is set without skip. Hmm. Actually wait — looking at the structure: the refusal case is when allocateWeighted returns a skip with refusal:true (e.g., unlevelled vault). In that case plan.skip is set, so `!plan.skip` is false, so the pay block doesn't run. Then where does `st.days[day].refused = plan.skip` get written? It must be in an else branch not fully shown. The diff context lines show:

```
       if (plan.refusal) st.days[day].refused = plan.skip
       st.days[day].finishedAt = new Date().toISOString(); save(st)
     }
```

followed by the new refusal-paging block and `return`. Hmm, so maybe the structure is:

```js
if (!plan.skip && !DRY) {
  // supersede prior verdicts
  // write plan
  // pay everyone
  // if (plan.refusal) st.days[day].refused = plan.skip   <- ???
  // st.days[day].finishedAt = ...; save(st)
}
if (plan.refusal) { page; exitCode=1 }
return
```

That doesn't quite work either. Alternatively there's an `else` clause: `else { if (plan.refusal) st.days[day].refused = plan.skip; ... }`. The diff hunk at @@ -500,6 +594,19 @@ shows:

```
       if (plan.refusal) st.days[day].refused = plan.skip
       st.days[day].finishedAt = new Date().toISOString(); save(st)
     }
+    if (plan.refusal) { ...page... }
     return
   }
```

The context `}` before `return` and the `}` after `save(st)` — there's a block closing. I think the structure is something like:

```js
if (plan) {
  ...
  if (!plan.skip && !DRY) {
    // supersede
    // write plan
    // send payments
    // write paid rows
    // if (plan.refusal) refused = skip   // hmm
    // finishedAt; save
  } else if (!DRY) {
    // record skip/refusal
    if (plan.refusal) st.days[day].refused = plan.skip
    st.days[day].finishedAt = ...; save(st)
  }
  if (plan.refusal) { page }
  return
}
```

Actually the exact structure doesn't matter enormously. The key questions from the prompt:

**Is clearing both correct in EVERY ordering — quiet then pay, refuse then pay, pay then crash then resume, two runs in one day, a --dry-run in between? Can a day now lose a flag it needed?**

Let me think about the orderings:

1. **Quiet then pay**: morning run writes nothingToDo (quiet morning, no payment due — e.g., holding period). Afternoon run: volume arrived, plan proceeds. Clearing both: the nothingToDo is superseded. Correct — the day now has a plan and payments. But WAIT: what if the afternoon run pays only PART of the vaults and crashes (finishedAt unset)? Then: nothingToDo cleared, plan written, some paid rows, no finishedAt. detectDistribution's distribution_unfinished arm: does it fire? The new selftest arm says a half-finished day (startedAt set, paid has sig + null, no finishedAt... wait the test has no finishedAt and no nothingToDo) raises the alarm. With nothingToDo cleared, the alarm fires. Good — that's the fix working.

2. **Refuse then pay**: morning refuses (unlevelled vault), operator fixes levels.json, afternoon run pays. refused cleared, supersededAt/supersededWas recorded. detectDistribution's distribution_refused arm — does it read `refused`? If the flag is cleared, the HIGH refusal finding disappears for that day. Is that right? The day DID pay everybody after repair. The refusal was superseded. The comment says the old behavior raised "the distribution REFUSED and paid nobody" forever on a day whose paid rows carry real signatures. Clearing is correct for that. But is there information loss? supersededWas preserves the record. OK.

3. **Pay then crash then resume**: first run proceeds (no prior verdict to clear), pays some, crashes before finishedAt. Resume run same day: plan proceeds again — priorVerdict is undefined (no refused/nothingToDo written), so no clearing. Fine. But wait — does the resume run re-pay vaults already paid? That's the paymentState/resolved logic (a row with sig is 'paid', never re-sent). Presumably handled elsewhere. Not this fix's concern.

4. **Two runs in one day, both pay**: second run's priorVerdict — after the first run finished, is refused/nothingToDo set? If the first run completed, finishedAt set, no flags. Second run: nothing to clear. Fine.

5. **--dry-run in between**: DRY run doesn't write anything (the clearing is inside `if (!plan.skip && !DRY)`). So a dry run between doesn't clear flags. Fine — dry runs don't mutate the ledger.

Now — **can a day now lose a flag it needed?** Here's the case to hunt: **quiet morning writes nothingToDo; afternoon run has a plan that proceeds; but the plan pays only SOME vaults and the run crashes mid-payment (finishedAt unset)**. Before the fix: nothingToDo present → suppresses distribution_unfinished → silent half-finished day (the fail-open the fix addresses). After the fix: nothingToDo cleared when the plan proceeds → alarm fires. Good.

Reverse case: **afternoon run proceeds, pays everybody, finishedAt set — but then a THIRD run later the same day refuses** (e.g., a new unlevelled vault activated between run 2 and run 3). Run 3: plan.skip set (refusal), so the clearing block doesn't run (it's inside `!plan.skip`), and the refusal branch writes `st.days[day].refused = plan.skip`. Now the day has: paid rows from run 2, finishedAt from run 2, AND refused from run 3. detectDistribution: distribution_refused fires ("REFUSED and paid nobody") — but the day DID pay everybody in run 2! This is the mirror of the original defect: a stale refusal written AFTER a successful payment makes the detector claim nobody was paid. Hmm wait — is that new? Before this diff, the same sequence would write refused on run 3 too. So it's pre-existing, not introduced. But the fix addressed "refusal superseded by payment" and not "payment superseded by refusal." The ordering refuse→pay is handled; pay→refuse is not. Is pay→refuse realistic? Run at 09:07 pays; a stranger activates an unlevelled vault at 10:00; a manual afternoon run (operator reruns for some reason) refuses and overwrites... wait, would a second run even reach the refusal? If the day already has finishedAt and paid rows, does distribute re-plan? The `paid` rows exist; a re-run would... hmm, I don't have enough of main() to know whether a completed day is re-planned. The `holdDays` anchor logic suggests days accumulate. If a second run on a finished day re-plans and refuses, it writes refused on a day that paid. The detector then says "REFUSED and paid nobody — every activated vault is unpaid" (per the comment describing the old defect's text). That would be a false HIGH on a day that paid. But again — pre-existing shape, and the fix's clearing only runs when a plan PROCEEDS. A refusal after a payment is not cleared by anything (the next proceeding plan would clear it, but the day is done). Worth flagging as a residual ordering the fix doesn't cover: the supersede logic is one-directional (verdict → payment), and the reverse (payment → verdict) still leaves a misleading flag. Severity LOW/MEDIUM — it's a false-alarm shape, not money loss. Actually wait — could it be worse? If refused is set on a day that paid, and the NEXT day's run reads... does anything gate money on `refused`? The clearing code reads it; holdDays reads paid rows via settledAsPayout. distribution_refused is a detector finding (HIGH, pages via alarm?). False alarm → operator time. LOW.

Hmm, but actually there's a subtler one. Look at the clearing condition: `const priorVerdict = st.days[day].refused || st.days[day].nothingToDo`. If BOTH are set (refused in the morning, then... can nothingToDo be set after refused? A quiet run after a refusal — would a quiet run write nothingToDo? If the morning refused and a midday run was quiet (nothing to do), does the quiet path write nothingToDo unconditionally or only when no other verdict? If it writes nothingToDo alongside refused, then priorVerdict = refused (the || takes refused first), supersededWas = refused only — the nothingToDo value is LOST from the record (supersededWas records only the first). Minor record-keeping imperfection: `supersededWas` captures only one of possibly two flags. Evidence: if both flags were set, the ledger after superseding shows supersededWas=<refused reason> and no trace of the nothingToDo reason. LOW.

Another ordering: **--dry-run refusal between**: dry run refuses → pages? The paging block: `if (plan.refusal) { console.error; if (!DRY) {try NOTIFY}; process.exitCode = 1 }` — under DRY, no notify but exitCode=1 still set. The prompt explicitly notes "The exit code is NOT suppressed under --dry-run." Is that a defect? A dry run is a rehearsal; setting exit 1 means cron/CI wrappers see failure. But dry runs are manual (no cron installs them with --dry-run... actually the header says distribute is installed WITHOUT --dry-run; a dry run is an operator rehearsal). Exit 1 on a dry-run refusal is arguably correct (the rehearsal found a refusal — you WANT nonzero). Hmm, but the prompt asks: "A halt any stranger can trigger now pages a human on every daily run. Is that right, or has a griefing surface become a paging surface?"

Let me think about this properly. The unlevelled-vault halt: anyone can mint a vault (mint is permissionless once a round is open? mint_vault requires bank co-sign! So NOT anyone can mint a vault — the Bank co-signs every mint). Wait — "a HALT that any stranger can trigger by activating a vault we have no level for" — activating = funding with ≥21,000 sats. Minting requires the Bank's co-signature, but ACTIVATION (funding the vault's asset-signer PDA with cbBTC) is permissionless — anyone can transfer cbBTC to any vault PDA. So a stranger can take an existing minted-but-unactivated vault (or any vault) and fund it... wait, no — activation presumably requires the vault to be in levels.json? Let me think. The distribution reads `levels` (levels.json) mapping vault→level, and `allocateWeighted` refuses if an ACTIVATED vault (≥21,000 sats) has no level. Who decides levels? The level register is off-chain (known limit 16). A stranger can fund ANY minted vault with 21,000 sats, making it "activated," and if that vault has no level in levels.json, the whole distribution refuses. Since levels.json is maintained by the operator (levels assigned at... mint? charter?), a vault minted but not yet levelled, funded by a stranger, halts everything. So yes — griefing surface: cost to attacker ≈ 21,000 sats of cbBTC (which they still own! it's in the vault... wait, can they get it back? The vault is owned by whoever; if the stranger funds SOMEONE ELSE's vault, the stranger's 21,000 sats are gone (gift to the vault owner) — cheap DoS at ~$21 at current prices? 21,000 sats ≈ 0.00021 BTC ≈ $20. So for ~$20 (or less if they fund their own vault and later redeem... their own vault they could redeem via burn — getting the sats back! So the DoS could be nearly FREE: mint your own vault (needs Bank co-sign — the Bank might refuse to co-sign a mint for a known griefer? but at charter, mints are the product), fund it with 21,000 sats, never take a level... wait, would the operator assign levels to all minted vaults? If levels are assigned at mint by the Bank, then every minted vault HAS a level, and the unlevelled case only arises for... hmm, known limit 16 says level assignment is the Bank's word. If the Bank assigns levels at mint, a stranger can't create an unlevelled activated vault — unless they fund a vault BETWEEN mint and level-assignment, or the level register lags. The comment says "activating a vault we have no level for" — so the window exists.)

So: the griefing surface (halt) existed before; this round added PAGING on it. Now every daily run during a griefing attack pages a human. Is that wrong? The prompt frames it: "A halt any stranger can trigger now pages a human on every daily run. Is that right, or has a griefing surface become a paging surface?" My analysis: paging on a genuine halt is CORRECT — a halt means holders stop being paid, which is exactly what a human must know about. The alternative (silent halt, alarm.mjs only) was the defect being fixed. The griefing cost: an attacker who can halt distribution can now also page the operator once per day. But the attacker could already halt distribution — the paging is proportional (one page per daily run, not per attack transaction). NOTIFY is called once per run. An attacker can't amplify paging frequency beyond the cron schedule (09:07 daily). So the paging surface is bounded by cron cadence — one page/day max from this path. That seems right, not a defect. BUT — one wrinkle: `process.exitCode = 1` on refusal. Does anything downstream treat exit 1 specially — e.g., does cron mail output, does a wrapper retry, does flock interact? With `flock -n`, a failed run doesn't block the next. Exit 1 is fine. And under --dry-run, exitCode=1 without notify — a rehearsal refusal marks the shell failed; acceptable, arguably desirable. I'll answer: the direction is right; paging is bounded by the daily cadence; no amplification. But I should note the one real question: NOTIFY failure is swallowed (`catch {}`) — if the notify binary is missing/misconfigured, the refusal pages nobody and still exits 1, and nothing records that the notify FAILED. The catch{} means a broken NOTIFY path is silent. Evidence: run with NOTIFY pointing at a nonexistent file — the refusal logs to console.error but no page, no error about the notify failure. Is that a defect? The old SOL-floor failure path (fifteen lines below) — does it also swallow? Probably same shape. A paging path whose failure is invisible is a gate that flatters its own margin — the exact defect class this project organizes around. The manifest/console log records the refusal message but not the notify outcome. MEDIUM? The refusal still exits 1 and console.errors, so a human watching logs sees it; only the PAGE is best-effort. I'd file LOW-MEDIUM: "the new page is fire-and-forget; a failing NOTIFY is indistinguishable from a successful one in the record." Fix: log the notify outcome (sent/failed) into the day's ledger row or at least stderr.

Hmm wait, actually — let me reconsider. `execFileSync(NOTIFY, [msg, 'cbob-distribute'])` inside try/catch — if NOTIFY throws (nonzero exit, missing file), catch{} swallows. The operator learns of the refusal only via exit code/logs. For a HALT that pays nobody, the page is the whole point of the fix ("a REFUSAL pages"). If the page can silently fail, the fix's guarantee is best-effort with no receipt. Given this repo's obsession with receipts (the manifest!), a page with no receipt is off-brand. I'll file it as MEDIUM — the fix's own claim ("a REFUSAL pages") is not verified by anything, and its failure mode is silent. Evidence: `NOTIFY=/nonexistent node bank/distribute.mjs --dry-run` (well, dry doesn't notify)... `NOTIFY=/nonexistent` with a real refusal — console shows the refusal, exit 1, no page, no record that the page failed. Checkable.

Now the manifest / git porcelain. The change: `const dirty=execSync('cd '+R+' && git status --porcelain -- programs bank scripts tests').toString()` — NOT trimmed, and the comment explains why (trimming eats the first line's leading space). Then `dirty:dirty.split('\n').filter(Boolean)` in the manifest, and `if(dirty)` for the warning — wait: `if (dirty) console.log('  ⚠️ programs/bank/scripts/tests are DIRTY...')`. `dirty` is the raw string. If the tree is CLEAN, `git status --porcelain` outputs EMPTY string → dirty = '' → falsy → no warning. Good. If dirty, non-empty → warning. And `${dirty?'  ⚠️ DIRTY TREE':''}` in the summary line. OK.

Is the record well-formed? `dirty.split('\n').filter(Boolean)` — porcelain output lines like ` M bank/distribute.mjs` — split/filter gives array of status lines with leading space preserved. JSON-serializable. Fine. One subtlety: `git status --porcelain` can emit renames `R  old -> new` and untracked with `??` — all fine as strings. What about the `if(dirty)` check — could porcelain output be non-empty while the tree is clean? No. Could it be empty while dirty? Only if the paths filter excludes the dirty files — the filter is `-- programs bank scripts tests`, so a dirty file OUTSIDE those dirs (e.g., SPEC.md, audits/) yields empty porcelain → "clean tree" claim while the tree is dirty. Hmm! The manifest records `head` and `dirty` for only four directories. If SPEC.md is modified (uncommitted), the round audits a SPEC that isn't committed, and the manifest says clean. Is that a defect? The prompt's concern was "the tree must not move under the round" — the diff is built from `git diff ec7d17e..HEAD` (committed states), so uncommitted changes to SPEC.md wouldn't even be IN the diff... but the FOCUS bundle includes `f('programs/...')` — read from the WORKING TREE, not from HEAD! So if the working tree has uncommitted changes to programs/bank/scripts/tests, the porcelain check catches it. But if SPEC.md (or any other file read into the prompt — wait, what's read? `f('programs/cbob-vaults/src/lib.rs')` etc. — all under programs/. And RT = f('scripts/run-tests.sh') — under scripts/. So all files read into the prompt ARE under the four watched dirs. Hmm, except... the DIFF is from git (committed), the bundle files are from the working tree (watched dirs). So the dirty check covers everything read. OK — but wait, one more: the dirty check runs BEFORE the models are asked (in main(), `const dirty=execSync(...)` before `await Promise.all(...)`). The tree could move DURING the round (45-minute window) — the manifest records dirty at launch, not at completion. A file modified mid-round (while models are reading) wouldn't be flagged. The comment says "THE TREE MUST NOT MOVE UNDER THE ROUND" — but the check only proves it didn't move BEFORE the round. Evidence: modify bank/distribute.mjs 10 minutes into the round; the manifest still says dirty:[] and the round reports a fixed tree. Is this worth filing? It's a TOCTOU on the certification's own fixed-tree claim. The fix: re-run porcelain after the round and record both, fail if changed. I'd file LOW/MEDIUM — the claim "this round did not audit a fixed tree" is only checked at T0, and the manifest's `head` is also T0's HEAD (a commit mid-round would change HEAD). Given the round takes up to 45 minutes and the builder works on the tree (the self-audit commits happened DURING round 18's two passes — "Round 18's two passes were built from git diffs taken at two different HEADs" — that's exactly how the last round's tree-movement defect happened!), the mid-round movement is not hypothetical: it HAPPENED in round 18. The check as written would not have caught round 18's defect if the movement happened after launch. MEDIUM. Actually — round 18's defect was two passes at different HEADs, i.e., the diff was taken at different times — the new check takes head+dirty once per pass, so each pass's manifest records its own head — that fixes cross-pass comparison. But within-pass movement is still unchecked. I'll file it LOW-MEDIUM with the concrete evidence path.

Hmm, also: `execSync('cd '+R+' && git rev-parse HEAD')` — fine.

One more manifest item: `fs.writeFileSync(`${OUT}/${process.env.TAG||('v19-'+FOCUS)}-${o.model.replace(/[\/.]/g,'_')}.md`,o.text)` — model ids contain `/` and `.` — replaced. Fine. What about `:` or other chars in ids? OpenRouter ids are vendor/model — fine.

And `MIN_AUDITORS=Number(process.env.MIN_AUDITORS||Math.ceil(MODELS.length*0.75))` — 8 models → 6. If MODELS env has 1 model, MIN=1 — a round of one model passes quorum. Eh, operator-controlled.

Now — the `land()` function: `o.disqualified=disqualify(o)` — disqualify checks `if(!o.ok) return 'request failed'`. But look at ask(): on fetch error it returns `{model, ok:false, text:'FETCH FAILED ...'}`. And on `j.error` returns ok:false with text `ERROR ...`. disqualify catches both ('request failed' for !ok; also the ERROR/FETCH FAILED regex for safety). Fine.

But here's one: **disqualify's degenerate-loop check requires lines.length>=200**. deepseek's loop was 4,149 lines. But a repetition loop of 150 lines (<200) with 4% unique passes as a report. The threshold is arbitrary; a degenerate 150-line loop is counted as an auditor. Minor — the check is heuristic, acknowledged. Not worth much.

Bigger: **`if(o.finish==='length') return 'output cut off mid-report'`** — good. But what about finish_reason 'content_filter' or 'error'? A content-filtered report (short, truncated by policy) with >600 chars and <200 lines passes as an auditor. Eh.

What about **the same model returning a VALID-LOOKING but hallucinated report**? Not detectable mechanically. Fine.

Now — **verifyRoster()** in audit19.ts: fetches the model list, checks `live.size<50` → refuse. Checks bad ids → throw. Good. But: `if(!r.ok) throw` — if the models endpoint is down, the round refuses to run. Fine (fail closed).

Hmm — wait, one real bug candidate in verifyRoster: it's called in main() BEFORE... let me check: `async function main(){ fs.mkdirSync(OUT,{recursive:true}); await verifyRoster(); ... }`. Fine.

OK now R2 — the round-18 off-chain repairs in distribute.mjs.

**settledAsPayout direction verification.** The claim: "A bare resolvedBy with no stated result still does NOT reset the clock. Not resetting makes holdDays LARGER, which fires the ceiling EARLIER and pays sooner."

I need to trace: what does holdDays feed into? `decideEmission` and the 31-day ceiling (MAX_HOLD_DAYS = 31). The architecture: "daily payout... whether a given day PAYS is volume-driven" and there's a hold mechanism — `if (!d.pay) plan = { ...plan, skip: 'holding: ...' }`. So decideEmission presumably decides whether to pay based on available amount vs EMISSION_MIN_PER_VAULT, and there's a holdDays-based ceiling: if holdDays >= MAX_HOLD_DAYS (31), the day MUST pay (force payout even if volume is low) — "the 31-day ceiling fires." Let me reconstruct from the fragments:

- `MAX_HOLD_DAYS = 31` — exported const.
- `holdDays(st, day)` returns days since last payout.
- Something like: `const d = decideEmission(...); if (!d.pay) plan = {...plan, skip: 'holding: ' + d.reason}` — so decideEmission returns {pay: bool, reason}. And presumably decideEmission pays when available >= EMISSION_MIN_PER_VAULT * vaults OR holdDays >= MAX_HOLD_DAYS (the ceiling forces a payment).

So: LARGER holdDays → reaches 31 SOONER → the forced-payment ceiling fires SOONER → pays EARLIER. Not resetting the clock on a bare resolvedBy → the anchor stays at the older real payout → holdDays is larger → ceiling fires sooner → pays sooner. The builder's direction: "Not resetting makes holdDays LARGER, which fires the ceiling EARLIER and pays sooner." That matches my trace — IF the ceiling forces payment. Let me double-check the alternative: if the ceiling instead BLOCKED payment (e.g., "you may only hold payouts up to 31 days, after which... " no — the ceiling exists to guarantee holders get paid at least every 31 days; "the 31-day ceiling fires on a schedule" — fires = forces a payout). From the round-17 comment: "an all-failed day reset the clock from 52 days to 2, so the 31-day ceiling never fired" — the defect was that the ceiling NEVER fired, meaning holders went unpaid. So the ceiling firing = a payment happening. Larger holdDays → fires sooner → pays sooner. The builder's direction is CORRECT.

But wait — I should double check the other direction of the default. settledAsPayout returns true only for paymentState==='paid' or (resolved && resolvedAs==='paid'). A bare resolvedBy (no resolvedAs) → false → that day does NOT count as a payout day → the anchor skips it → holdDays measured from the last REAL payout → larger → ceiling sooner → pays sooner. Yes. And if the default were 'paid' (bare resolvedBy counts), holdDays would be smaller → ceiling later → pays later. So the chosen default pays sooner. Direction verified. 

Hmm — but hold on. Is there a counter-direction through decideEmission? If decideEmission uses holdDays in some other way — e.g., "don't pay more often than X" (a minimum hold)? The name "holdDays" and "holding: reason" suggests the mechanism is: the Bank HOLDS payouts until either volume suffices or 31 days pass. If there were also a MINIMUM hold (e.g., pay at most every N days), larger holdDays could... no, a minimum hold would be satisfied sooner by larger holdDays too (pay sooner). Either way larger holdDays → pay sooner or same. Unless decideEmission pays only when holdDays is SMALL (nonsense). I'm fairly confident: direction correct. But I can't see decideEmission's code — I should state the evidence that would confirm: read decideEmission; if it contains `holdDays(...) >= MAX_HOLD_DAYS` as a pay trigger, the direction holds. I'll say: verified as far as the diff shows; the one thing I cannot see is decideEmission's body, and if it used holdDays as anything other than a "force pay at 31" trigger the argument would need re-derivation. Actually — the prompt says "Trace what a LARGER holdDays does through decideEmission and the 31-day ceiling" — I don't have decideEmission's source in the diff. I'll trace what's visible and state the assumption + the check.

Wait, actually, I realize I should double-check one more subtlety: `holdDays` anchors at the LAST payout day: `const anchor = paid.length ? paid[paid.length-1] : (days.sort()[0] ?? day)`. With settledAsPayout, a hand-paid day (resolvedAs:'paid') now counts → anchor moves FORWARD → holdDays SMALLER. So recognizing hand-paid days makes holdDays smaller → ceiling later → pays later?! Wait — that's the FIX (recognizing hand-paid days), and it makes holders wait LONGER after a hand payment. Is that right? Yes — if a holder was actually paid 2 days ago, the 31-day guarantee clock SHOULD reset; they shouldn't be force-paid again immediately. The 52-vs-2 measurement: "an old real payout 52 days back plus a hand-paid day two days ago returned 52" — the defect was holdDays=52 (ignoring the hand payment), the fix returns 2. So the fix makes the clock SMALLER (2), ceiling LATER. And the DEFAULT question is about bare resolvedBy (no resolvedAs): not counting it keeps the clock LARGER (52-ish), ceiling SOONER, pays SOONER. So: the fix (counting annotated hand-pays) delays; the default (not counting bare resolutions) hastens. The builder's claim is specifically about the default's direction: "not resetting pays people SOONER." Correct. And the fix's direction (annotated hand-pay resets) is correct because it reflects reality (they WERE paid). OK. Direction verified. Good — I can also point out the interesting asymmetry to demonstrate I actually traced it: recognizing a hand payment DELAYS the next forced payout (from the holder's perspective the guarantee clock restarts), which is the correct semantics, and the builder's "pays sooner" argument applies only to the ambiguous default. Fine.

**paymentState deliberately left unchanged — is a resolved row never re-sent, for every caller, now that a second function reads the same rows?**

settledAsPayout READS rows but doesn't write. The re-send decision is wherever paymentState is used to skip rows. settledAsPayout is used only in holdDays (per the diff). Does holdDays's use of settledAsPayout cause any re-send? No — holdDays computes cadence. So resolved rows: paymentState says 'resolved' → not re-sent (the send loop presumably skips non-'paid'... wait, actually the send loop WRITES rows and skips rows already paid/resolved). The question: is there any caller that, seeing settledAsPayout(row)===false for a resolved row, would re-send? settledAsPayout's only caller is holdDays (a filter over days). No re-send path. But the self-audit's claim (R7): "settledAsPayout is the ONLY site asking the cadence question and no other paymentState caller conflates the same thing." I can't fully verify without the whole file, but from the diff: holdDays previously used `paymentState(r) === 'paid'` — now uses settledAsPayout. Are there other cadence-adjacent sites? The `paid` filter in holdDays is the cadence question. decideEmission — does it ask paymentState? Unknown. If decideEmission or the detector (detectDistribution in detectors.mjs) asks "was this day a payout day" using paymentState==='paid' only, the same conflation exists there. Hmm — detectDistribution: the selftest arms show `paid: { v1: { sig: 'abc' }, v2: { sig: null } }` — the unfinished arm counts... I don't see detectDistribution's body. The distribution_unfinished arm: "a run started and never finished" — checks startedAt/finishedAt and maybe paid rows. If detectDistribution decides "did yesterday pay" via paymentState==='paid' only, a hand-paid day might read as unpaid → distribution_missed false alarm. That's the one-of-N-sites risk: the cadence question may be asked in detectors.mjs too. Evidence to check: grep detectors.mjs for paymentState usage. I'll flag it as a verification demand rather than a confirmed defect — but frame it sharply: the self-audit's sweep claim is unverifiable from the diff, and the detectors are exactly where the same question gets asked (distribution_missed: "yesterday has no record at all" — what about "yesterday has a record but every row is resolved-unpaid"?).

Hmm wait — actually, there IS a visible second reader in the diff: the selftest arms for detectDistribution use `paid: { v1: { sig: 'abc' } }` — sig present = paid. And the new arms: `paid: { v1: { sig: 'abc' }, v2: { sig: null } }` for half-finished. These test the DETECTOR's reading of paid rows. If the detector's "did the day pay anybody" logic uses paymentState or just sig presence... can't tell. Flag for verification.

**census() serialization.** New census: `const c = Object.create(null); ...; return { ...c }`. The spread of a null-prototype object produces a NORMAL object (Object.prototype prototype) with the own enumerable props. So the RETURNED value has a normal prototype — consumers needing normal prototype are fine. JSON.stringify works on null-proto objects too. The ledger round-trip: census written to `st.days[day].plan.census` → JSON → read back as normal object → denominator(c) uses Object.hasOwn(c ?? {}, l) — works for both. And `Object.hasOwn(c, v)` inside census — c is null-proto, hasOwn works. Fine.

But wait — one subtlety: `return { ...c }` — spread only copies OWN ENUMERABLE props. All LEVELS keys were set as own props. Fine. And the ORDER of keys: insertion order = LEVELS order. Fine.

Is there a consumer that needed... the plan.census is written to the ledger; detectors read it? denominator(plan.census) — hasOwn-guarded. OK. What about a consumer doing `plan.census.I` directly? Works. `c[l] || 0` in old denominator was prototype-reachable ('constructor' etc.) — new one guarded. Fine. I think census is sound. One more: `Object.hasOwn(c ?? {}, l)` — if c is null/undefined → {} → hasOwn false → 0. Fine.

Hmm — but actually, wait: does anything call denominator with a census that came from JSON where a level key could be inherited? JSON.parse produces normal-proto objects; hasOwn guards. Fine.

**The dust bound re-derivation.** Claim: dust < activated.length ALWAYS. allocateWeighted: `vault_share = drop * vault_weight / denominator` (integer division), dust = drop - sum(shares). Each vault's fractional loss is (drop*w_v mod denominator)/denominator < 1 sat. Sum of losses = dust < number of paid vaults. But — "PAID vaults": the claim says dust < activated.length. Is every activated vault PAID? Cases:
- available smaller than needed: if drop is small, some shares could be 0 — still "paid" (share 0)? A vault with share 0 loses its full fractional part... wait, if drop*w/denominator = 0 (integer), the fractional part is drop*w/denominator < 1 — the loss per vault is still < 1 sat. Sum over N vaults < N. Even zero-share vaults contribute < 1 each. So dust < activated.length holds regardless.
- Skipped vaults: if some vaults are SKIPPED (not in the allocation), are they in activated.length? The test uses `r.activated.length` — the allocator's own activated list. If skipped vaults are excluded from activated, then dust < activated.length still holds (each activated vault contributes < 1). If a vault is skipped AFTER computing its share... The bound: dust = sum over paid vaults of fractional parts, each < 1 → dust < count of vaults that received an allocation. If activated.length counts exactly those, bound holds. Edge: EMISSION_MIN_PER_VAULT — "daily payout... to vaults holding at least 21,000 sats" and EMISSION_MIN_PER_VAULT=21 sats provisional — if the drop is below min-per-vault, maybe NOTHING is paid and the whole drop carries (dust = drop, which could exceed activated.length!). Hmm — "whether a given day PAYS is volume-driven" — decideEmission decides pay/no-pay BEFORE allocateWeighted. If it doesn't pay, is allocateWeighted even called? If called with the full available and it returns dust=available (all shares 0 because available < denominator... no wait, shares are available*w/denominator; if available=7 and denominator=6405*... shares are 0 for all, dust=7. activated.length=2100. 7 < 2100. Fine.) What if available is HUGE but... dust < activated always since each vault's fraction < 1. The only way dust ≥ activated.length is if some vault contributes ≥ 1 sat of fractional loss — impossible with floor division per vault... UNLESS the allocator does something like largest-remainder or per-level grouping. The comment says same level always same number — the allocator computes per-LEVEL share then divides? "vault_share = drop * vault_weight / denominator, integer satoshis" — per vault. Hmm, but "same level always means the same number" — if it computed per-level total then divided by count, the dust bound would be < number of LEVELS (5), not < activated. The test asserts dust < activated.length with real allocateWeighted — and the 2,100-vault sweep test checks worst < 2100. The tests pass (per the prompt's claim). Mathematically: per-vault floor division → dust = Σ frac_v where frac_v ∈ [0,1) → dust < N_paid ≤ activated.length IF every activated vault gets an allocation. When available is smaller than vault count: shares 0, frac_v = available*w_v/denominator < 1 each (since available*w_v < denominator when shares are 0... wait if share=0 then available*w_v < denominator so frac < 1 — yes). If some vaults get share ≥ 1, frac still < 1. So dust < N always, where N = vaults in the allocation. The bound holds. BUT the comment says "under one sat per paid vault (2,099 max)" at 2,100 vaults — 2,099 max = activated.length - 1 = 2099. dust < 2100 means dust ≤ 2099. Correct.

Edge case to challenge: **skipped vaults**. "when some vaults are skipped" — if a vault is in `activated` but skipped from payment (e.g., its transfer failed), does the allocator's dust include its share? The dust is computed at ALLOCATION time (before sends). r.dust is allocation dust. Sends happen after; failed sends don't change r.dust. So the bound is about allocation. If "activated" in allocateWeighted's return includes only vaults in the allocation, bound holds. The prompt asks "including when available is smaller than the vault count, and when some vaults are skipped" — my derivation: holds, PROVIDED activated.length counts exactly the vaults the allocator divided among. If activated includes skipped vaults (in the list but excluded from division), the bound is still ≤ (looser, still true). So the bound is safe in both cases. One caveat: if the allocator ever pays per-LEVEL (grouping), the bound would be < 5 not < N — the comment's bound would still be TRUE (loose). So no defect. I'll present the re-derivation and confirm, noting the one assumption (per-vault floor division, which the visible comment states).

Hmm wait, actually — let me reconsider. Is it per-vault? "vault_share = drop * vault_weight / denominator, integer satoshis" — yes, per vault. And "same level always means the same number" — same weight → same share. Consistent. OK, bound confirmed.

But hold on — one more: the OLD comment said "up to (denominator - 1) sats — at 2,100 vaults that is up to 6,404." New comment says the old bound was "a real upper bound but a loose one, and it overstated what a settlement retains by about threefold." Is dust < denominator actually a valid bound? dust < N_paid and N_paid ≤ activated. Is activated ≤ denominator? denominator = Σ weights = Σ (2..6 per vault) ≥ 2*N → N ≤ denominator/2 < denominator. So dust < N < denominator — yes, old bound valid but loose. New bound tighter. The correction is right. And "worst observed 2,099" — can dust actually reach 2099? Needs every vault's fractional part ≈ 1 — possible in principle. Fine.

**R3. bank-sign.sh base64 round trip.**

New code:

```sh
CANON=$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null) || true
if [ "$CANON" != "$TX" ]; then
  echo "..." >&2
  exit 2
fi
```

Under `set -euo pipefail` (the file has it — the prompt says "what set -euo pipefail does to a failing pipeline inside a command substitution"). Let me think hard about this.

The command substitution `$(printf '%s' "$TX" | base64 -d 2>/dev/null | base64 -w0 2>/dev/null)`:
- Pipeline: printf | base64 -d | base64 -w0.
- With pipefail, if base64 -d fails (invalid input), the pipeline's exit status is nonzero. Inside command substitution with `|| true` appended — wait, the `|| true` is OUTSIDE the substitution? Let me parse: `CANON=$(...) || true` — the `|| true` applies to the ASSIGNMENT (whose exit status is the substitution's exit status). So a failing pipeline doesn't kill the script (set -e would otherwise exit). CANON gets the output produced before failure. Then the comparison `[ "$CANON" != "$TX" ]` — if decoding failed partway, CANON is partial/garbage → != TX → exit 2. Fail closed. Good.

Now — find an input it ACCEPTS that decodes to something other than what was pasted.

Candidate 1: **embedded whitespace/newlines**. `printf '%s' "$TX"` — TX comes from a file or stdin. If TX contains newlines (a wrapped paste — the very scenario the script worries about: "a paste that a terminal wrapped"), then: the earlier checks — alphabet check (does it reject whitespace? The alphabet check presumably uses a case/grep — I don't see the earlier checks' code, but the round-17 checks were "alphabet + padding + length"). If the alphabet check allows or the length check... hmm. Actually GNU base64 -d IGNORES newlines by default (and with -i it doesn't). So TX with newlines: base64 -d decodes ignoring newlines → bytes → base64 -w0 re-encodes WITHOUT newlines → CANON ≠ TX (TX has newlines) → REJECTED. So wrapped pastes are now rejected (previously maybe accepted?). Does it reject anything LEGITIMATE? A base64 file with trailing newline! If the operator does `bank-sign.sh tx.txt` where tx.txt ends with `\n` (every text editor adds one), TX includes the trailing newline. Then: alphabet check — does the alphabet check reject `\n`? If the alphabet check is strict (only A-Za-z0-9+/=), a trailing newline FAILS the alphabet check already (before this change). Hmm — but the script has been in use; presumably it strips. I can't see the reading code. The prompt says "It comes from a file (or stdin)". If the file read strips whitespace, fine. If not, the round-trip now rejects trailing newlines where before... the old checks: length ≡ 0 mod 4 — a trailing newline makes length 1645 for a 1644-char tx → rejected by length check too. So no change. OK.

Candidate 2: **base64 -w0 availability**. `base64 -w0` is GNU coreutils. On macOS, base64 is BSD — `-w` doesn't exist! `base64 -w0` on macOS fails with "invalid option". Then the pipeline: base64 -d succeeds (BSD base64 -d exists with -D on old macOS! BSD base64 uses `-D` for decode, GNU uses `-d`... actually modern macOS base64 supports both -d and -D? macOS's base64 (from libressl?) — hmm. macOS ships /usr/bin/base64 which is OpenSSL-based? No — macOS has `base64` from... Let me think. On macOS, `base64 -d` works (it accepts -d and -D). But `-w0` — macOS base64 has NO -w option; it wraps at 0 by default? Actually macOS base64 doesn't wrap by default at all I think. If `-w0` fails: `base64 -w0 2>/dev/null` prints usage error to stderr (suppressed), outputs NOTHING, exits nonzero. Pipeline output = empty. CANON="". `[ "" != "$TX" ]` → true → exit 2. So on macOS, EVERY transaction is rejected — the script bricked on a whole platform. Is that a defect? The repo runs on Linux (cron, /opt paths — clearly Linux). The prompt explicitly says "consider ... base64 -w0 availability". So: on any system without GNU coreutils base64 (macOS, BusyBox base64 which also lacks -w? BusyBox base64 has -w in some builds), the script rejects EVERYTHING — fail closed, but a total outage of the signing path. Fail-closed DoS of the sanctioned signing tool. Severity: depends on deployment — /opt/cbob-vaults, cron, flock → Linux server. If the operator ever runs from a laptop (bank-sign.sh is the HUMAN-run tool! "the one sanctioned path to a Bank signature" — a human runs it, possibly from their workstation!). The header says paths resolve "in the operator's own shell". If the operator's workstation is a Mac — every signing attempt fails. Fail-closed, so no security hole, but the money path (redemptions need the Bank's signature!) halts. Actually wait — is it fail-closed? `base64 -w0 2>/dev/null` fails → empty output → CANON="" → mismatch → exit 2. Yes, closed. But also: what if `base64 -d` succeeds and outputs bytes, and `base64 -w0` fails — the pipeline exit code with pipefail is nonzero → `|| true` catches → CANON="" → reject. Closed. OK so: platform-dependent total rejection. MEDIUM (operational, fail-closed). Hmm, or LOW. The evidence: run `printf AAAA | base64 -w0` on macOS → "base64: invalid option -- w" and no output. I'll file it LOW-MEDIUM. Given "the one sanctioned path to a Bank signature" — if this is the only way to sign, and it's platform-brittle, and a redemption halt means holders can't exit — I'd say MEDIUM. Actually, let me reconsider: the deployment is a Linux server (cron at 09:07, /opt paths). bank-sign.sh execs `node bank/cosign.mjs` with repo-relative paths — "from here on the working directory is the repository" — so it's run ON the server. Platform risk is low in practice. LOW then, but worth stating. Hmm, the prompt explicitly told me to consider it, so they want the analysis. I'll file LOW with the note that it's fail-closed.

Candidate 3: **an input that PASSES the round trip but decodes differently than pasted**. The round trip: decode(TX) then encode → must equal TX. If encode(decode(TX)) == TX, then decode(TX) is exactly the bytes whose canonical encoding is TX. Node then does Buffer.from(TX, 'base64') — does Node decode TX the same way GNU base64 -d does? THIS is the crux! The script validates with coreutils; Node decodes with its own parser. If Node's base64 decoder differs from GNU's on some input that passes the coreutils round trip, the script accepts TX but Node judges different bytes.

Does Node's Buffer.from(s,'base64') differ from GNU base64 -d? Node's base64 decoder is lenient: it ignores invalid characters (as the script's own comment says: "Buffer.from(s, 'base64') SILENTLY IGNORES characters outside the alphabet"). GNU base64 -d by default: rejects invalid input ("invalid input") — with what exit code? GNU base64 -d exits 1 on invalid input but still outputs what it decoded so far? Actually GNU base64 -d stops at the first invalid character and reports an error (exit 1), outputting the bytes decoded so far. Hmm — so for TX containing an invalid char in the middle: GNU decodes prefix, errors; pipeline fails; || true; CANON = encode(prefix) ≠ TX (since TX has the invalid char) → rejected. Good.

But what about characters GNU base64 -d ACCEPTS that change the parse? GNU base64 -d accepts NEWLINES always. Any other whitespace? GNU base64 -d: "Decode input, ignoring newlines" — actually GNU base64 -d ignores ONLY newlines by default? Let me recall: GNU coreutils base64 -d ignores newlines; other whitespace (spaces, tabs) → "invalid input". With --ignore-garbage (-i), it ignores all non-alphabet chars — not used here. So GNU accepts: alphabet + '=' + newlines.

Node's decoder: ignores ALL characters outside the alphabet INCLUDING spaces, tabs, and... does Node treat '=' mid-string? Node stops at the first '=' I believe? Or handles padding loosely.

So the divergence hunt: find TX such that (a) earlier checks pass (alphabet, padding, length — do the earlier checks reject newlines? If the alphabet check rejects newlines, then TX can't contain newlines by the time we reach the round trip. Hmm — I don't have the earlier checks' code! The diff only shows the new block. The round-17 checks: "It now demands length ≡ 0 mod 4 and padding only at the end" plus an alphabet test. If the alphabet test is `case "$TX" in *[!A-Za-z0-9+/=]*) reject;; esac` — newlines rejected there. So by the round-trip stage, TX is pure alphabet+padding, length%4==0, padding only at end.

Given TX ∈ [A-Za-z0-9+/=]*, length%4==0, padding only at end (0-2 '='), does GNU-decode→encode round trip equality guarantee Node decodes the same? 

Non-canonical trailing bits: 'AB==' — GNU base64 -d decodes 'AB==' to 1 byte (0x00)? 'AB==' : A=0,B=1 → first quantum 'AB==' → 12 bits → 1 byte (0x00), trailing 4 bits (0x1... wait A=0(000000), B=1(000001) → bits 000000 000001 → byte0 = 00000000, leftover 0001 (nonzero trailing bits). GNU base64 -d: does it CHECK trailing bits? GNU coreutils base64 does NOT reject non-zero trailing bits by default? Hmm — actually I believe GNU base64 -d silently ignores trailing bits (decodes to the byte). Then encode(0x00) = 'AA==' ≠ 'AB==' → rejected by round trip. Good — that's the case the fix handles.

What about Node vs GNU on PADDING placement? 'AAB=' → GNU decodes 2 bytes; encode → 'AAA=' ≠ 'AAB=' → rejected. Good.

So for pure-alphabet inputs, round-trip equality means TX is the canonical encoding of its decode. Node decoding a canonical base64 string = the same bytes. I think for the constrained input space, the round trip is sound.

BUT — here's a candidate: **the empty string**. TX="" — length 0, %4==0, alphabet check passes (vacuously), padding check passes. Round trip: printf '' | base64 -d → empty | base64 -w0 → empty. CANON="" == TX → PASSES. Then the script proceeds with an EMPTY transaction to cosign.mjs! Is there an earlier check requiring non-empty/minimum length? The old checks shown: length%4. A 1644-char check? "A real 1232-byte transaction is 1644 base64 characters" — is there a length FLOOR? Not shown in the diff. If TX="" passes everything, cosign.mjs gets --tx "" — Node Buffer.from('','base64') = empty buffer — cosign presumably fails to parse a transaction. Fail closed downstream probably. But the script's own guarantees ("reject a non-base64 byte BEFORE Node sees it") — empty is valid base64. Not a real defect unless cosign mishandles empty. LOW/skip. Hmm — but wait, what about a SHORT valid base64 like "AAAA" (3 bytes)? Passes round trip. cosign fails to deserialize. Fine — downstream handles.

Candidate 4: **very long inputs**. base64 -w0 handles arbitrary length on one line. Command substitution strips trailing newlines — base64 -w0 outputs no trailing newline anyway (that's the point of -w0). Wait — does `base64 -w0` output a trailing newline? GNU base64 -w0: no wrapping, but does it append a final newline? Hmm! GNU base64 ENCODE always outputs a trailing newline UNLESS... let me think. `printf AAAA | base64 -w0` → outputs "QUFBQQ==" followed by a newline? I believe GNU base64 outputs a trailing newline even with -w0. Hmm, no wait. Let me think carefully. GNU coreutils base64: "wrap lines after COLS character (default 76, 0 to disable)". With -w0, no wrapping. Does it still emit a final newline? Testing from memory: `echo -n hi | base64 -w0` → I believe outputs `aGk=` with NO trailing newline? Hmm, actually I recall that GNU base64 -w0 does NOT add a trailing newline. Let me think... `base64 /dev/null` → outputs nothing (no newline). `printf x | base64 -w0` → "eA==" — with or without newline? I'm fairly sure GNU base64 emits a newline after the encoded output ONLY as part of line wrapping; with -w0 there are no lines, so no newline. Hmm, but actually I have a memory that `base64 -w0` still appends a newline... Let me reason from coreutils source behavior: base64 writes wrapped lines; when wrap_column is 0, it never writes newlines. I'm fairly confident -w0 produces no trailing newline. And even if it DID: command substitution `$(...)` strips trailing newlines — so CANON would equal TX anyway. So trailing-newline behavior is neutralized by $() stripping. Fine either way.

Candidate 5: **locale**. base64 is locale-independent for the alphabet. Fine.

Candidate 6: **`set -euo pipefail` + command substitution failure modes**. `CANON=$(...) || true` — with set -e, the || true protects. But what about `set -o pipefail` interacting with... the substitution runs in a subshell; pipefail applies inside it. If printf fails (can't — TX is a string). If base64 -d exits 1 (invalid input) but base64 -w0 (reading the partial output) exits 0 — pipeline status = rightmost nonzero = 1 → || true. CANON = partial. Mismatch → reject. Good.

Hmm — WAIT. Here's a real one. What if `base64 -d` SUCCEEDS but produces output, and `base64 -w0` gets SIGPIPE? No — base64 -w0 reads all input. Fine.

What about **`$TX` containing a NUL or starting with `-`**? printf '%s' "$TX" — if TX starts with '-', printf '%s' handles it (the format is '%s', the arg is data). Fine. NUL can't be in a shell variable.

What about TX containing `=` in the MIDDLE — padding check ("padding only at the end") rejects. Already covered by round trip anyway.

Hmm, what about **GNU base64 -d accepting `=` as a data character in some position**? E.g., 'A=A=' — padding-only-at-end check rejects. Round trip: GNU decodes 'A=A='? Probably error. Rejected.

OK here's another angle — **does it reject anything LEGITIMATE?** A real 1232-byte tx = 1644 chars, no padding (1232 = 4*308, so 1644 chars, no '='). Round trip fine. What about a tx of 1231 bytes → 1644 chars with one '='? 1231 bytes = 1641.33 → 1644 chars with 1 '='. Fine. Legit inputs pass. What about an operator pasting with a trailing newline into stdin — depends on the read code (not in diff). If the read preserves the newline: alphabet check rejects (newline not in alphabet) — was that already true before? Yes (round-17 checks). So no NEW rejection of legitimate input... except the macOS/-w0 case above.

Hmm, wait — one more: **`base64 -d` on input with NO trailing newline** — fine, GNU handles.

And: **what if TX is valid canonical base64 but `base64 -d` outputs bytes and `base64 -w0` re-encodes with a DIFFERENT alphabet**? No, same tool.

What about **the `-d` vs `-D` flag on some systems** — covered under platform.

OK — so my R3 answer: I cannot find an input in the constrained space (pure alphabet, len%4==0, padding-at-end) that passes the coreutils round trip yet decodes differently in Node, because round-trip equality forces canonical form and Node decodes canonical form identically. The residual risks: (a) platform dependence of -w0 (fail-closed outage), (b) the empty string passes (downstream must refuse), (c) the divergence between the VALIDATOR (coreutils) and the CONSUMER (Node) is structural — the script validates with one decoder and Node parses with another; today they agree on the constrained space, but the guarantee rests on that agreement rather than on Node itself decoding what was checked. A stronger fix: have cosign.mjs re-verify (decode with Buffer, re-encode, compare) — but that's "new surface inside the judgement file" which they explicitly declined. I'll note it.

Hmm, wait — actually, let me reconsider (b) and one more: **inputs where GNU base64 -d and Node DISAGREE on canonical strings**. Node's Buffer.from(s, 'base64') — for a canonical string, decodes standard. Yes agree.

One more exotic: **very long inputs and base64 -w0's line-length** — -w0 means unlimited. Fine. **ARG_MAX** — TX is in a variable, printf is a builtin. Fine.

And the corrected comment: "THE TRANSACTION IS NEVER AN ARGV BLOB *OF THIS SCRIPT*... It IS in `ps` — the last line of this file is `exec node bank/cosign.mjs --tx "$TX"`". Is the corrected comment now true? The comment says the transaction IS in ps because the exec line passes "$TX" as an argument. Is that accurate? `exec node bank/cosign.mjs --tx "$TX"` — yes, TX becomes argv of the node process, visible in ps for the process's lifetime. The comment now says: not in THIS script's shell history (true — it's read from file/stdin, not typed), IS in ps via cosign's argv (true). And "An unsigned transaction is not a secret" — mostly true (an unsigned tx leaks the redemption structure but no keys). The comment is now accurate. One nit: "not in THIS command's shell history" — shell history records commands typed; the script's own commands aren't in history anyway. Eh — the original claim "not in shell history" referred to the operator not pasting the tx as an argument. Still true. OK — comment verified true. Also — hmm, is the tx ACTUALLY in ps? `exec node ... --tx "$TX"` — yes, /proc/PID/cmdline shows it. True. Good.

Wait, one more thing on bank-sign.sh: the CANON check happens BEFORE the `cd` to the repository ("ONLY NOW. Everything above resolves paths in the operator's own shell; from here on the working directory is the repository"). Fine.

And — does the round-trip check run BEFORE or AFTER the length check? After (the diff shows it added after the length check). Fine.

Hmm, actually — hold on, let me reconsider the whitespace question once more, because the prompt says "Consider embedded whitespace". Where could embedded whitespace survive to the round trip? If the earlier alphabet check uses a glob like `*[!A-Za-z0-9+/=]*` — a space fails it. But what if the earlier check is a regex with grep and the locale... or what if the earlier check uses `tr -d` somewhere... I can't see it. BUT — here's the thing: if the earlier checks DON'T reject whitespace (say they only check length%4 and padding-at-end), then: TX = "AAAA AAAA" (9 chars, 9%4≠0 → length check rejects). TX = "AAAA AAAA " hmm. TX = "AAAA\nAAAA" (9 chars) → length rejects. TX with whitespace that keeps length%4==0: "AA AA" is 5. "AAAA AAAA" 9. To have whitespace AND length%4==0: e.g., "AAAA AAAA " (10, no). "AA A" (4 chars: A,A,space,A) — length 4 ✓. Padding-at-end ✓ (no =). Alphabet check — if it exists and rejects space, done. If NOT: round trip: printf 'AA A' | base64 -d → GNU base64 -d on "AA A": space is invalid input → error, partial output (decodes "AA" → 1 byte? GNU decodes until the invalid char: "AA" is 2 chars — not enough for a quantum, so 0 bytes output, error). CANON = encode("") = "" ≠ "AA A" → rejected. Good — the round trip itself rejects whitespace (because GNU -d rejects it, producing mismatched output). What about NEWLINE specifically: GNU -d ACCEPTS newlines. TX = "AAAA\nAAAA" (9 chars — length check rejects if length%4... 9%4=1 → rejected). TX = "AAAA\nAAA=" (9) rejected. To pass length%4==0 with a newline: 1644 chars + 1 newline = 1645 → rejected. So newlines can't sneak through the length check. UNLESS the length check counts... it's ${#TX} — counts the newline. OK. So embedded whitespace is dead via length+roundtrip. 

What about a CARRIAGE RETURN? Same — counted in length, rejected by alphabet/roundtrip.

So R3: the round trip is sound on the constrained space; findings are the -w0 platform dependence (fail-closed) and the structural validator/consumer split. And the empty-string acceptance (trivial). Let me also double check: does the script have any check that TX is non-empty? Not shown. `printf '%s' "" | base64 -d` → empty → `base64 -w0` → empty → CANON="" == "" → pass. Then exec node cosign.mjs --tx "" — cosign must handle. Buffer.from("", 'base64') = empty buffer; transaction deserialization of empty → error. Fail closed downstream. I'll mention as a nit.

**R4. cron-install.sh — the money claim.**

The new header says: revenue.mjs opt-IN (--live), installed WITHOUT it → dormant. distribute.mjs opt-OUT (--dry-run), installed WITHOUT it → LIVE from next 09:07. "Is the new header true, completely? Enumerate every job the script installs and say for each whether it can move money as installed."

I only have the diff hunks of cron-install.sh, not the whole file. The diff shows the header change and an echo change. The prompt says "Read the crontab lines; do not take the header's word for it" — but the crontab lines aren't in the diff! The visible echo lines mention: distribute, revenue, reconcile. The header mentions two money jobs (revenue, distribute). What about OTHER jobs? The echo block shows "reconcile STATE, not history" — reconcile is read-only presumably (alarm). Are there other jobs — alarm.mjs (detector runs), maybe a levels sync? The original header said "These sit on odd minutes, off the */5, */10 and */30 ticks" — implying MULTIPLE jobs at various cadences. The de-dupe filter note mentions 'cbob-vaults/bank' lines. I cannot enumerate the crontab from the diff — the diff doesn't include the cron lines themselves. So my finding: **the header's claim is unverifiable from the diff, and the round's own instruction ("read the crontab lines") cannot be satisfied by an auditor given only this diff** — the bundle for FOCUS=offchain includes scripts/cron-install.sh in full (it's in the file list!), so round-19 offchain auditors COULD read it. But I can't. I should state: from what's visible, the header names two money jobs; the echo block names three jobs (distribute, revenue, reconcile); if the crontab installs anything else that moves money (e.g., a sweep job, an alarm that... no, alarms don't move money), the header is incomplete. Also — one specific thing I CAN check: the header says "revenue.mjs is opt-IN (--live) ... installed WITHOUT it, so the trusted hop does not start running unattended. Safe." and "distribute.mjs opt-OUT... the installed line does NOT carry it." Is there a THIRD money-mover? What about `split_revenue` — is it called by revenue.mjs or by a separate cron? split_revenue is permissionless on-chain; some job must call it. If revenue.mjs calls it under --live, fine. If a separate job calls split_revenue... it moves cbBTC (85/15 split) — but between project-controlled addresses (revenue PDA → treasury ATAs), destination pinned. "Moves money" yes, but not customer-facing risk. The header says "revenue sweep -> swap -> return -> split. DORMANT" — so split is part of revenue.mjs. OK.

Hmm — but here's a sharper angle on R4: the header now says distribute is LIVE from the next 09:07. Is THAT claim completely true? distribute.mjs as installed — does it have any OTHER gate? The flock, the ledger, decideEmission (volume-driven: pays only if available ≥ EMISSION_MIN_PER_VAULT per vault or 31-day ceiling). So "arms a live cbBTC sender" — true, it loads the distributor key and can send. The header is honest. But — "From the next 09:07 this job loads the distributor key and sends cbBTC to holders for real." True. And the fix suggestion "add --dry-run to the distribute line yourself" — fine.

One more check: the header says "NOTHING HERE MOVES MONEY UNTIL --live" was false — and the new header states both jobs separately. Is the new header true COMPLETELY? The one thing I can test from the diff: the echo block at the end — "⚠️ distribute is LIVE FROM THE NEXT 09:07... revenue is the only job this script leaves dormant." — "the only job this script leaves dormant" — is that true of ALL jobs? If the crontab has, say, an alarm job that's also "dormant" until some flag... can't verify. And is 09:07 the actual distribute cron time? The echo says "Runs daily" and the header says "from the next 09:07" — consistent with each other; the actual cron line not visible. I'll report: cannot falsify from the diff; the claim structure is now honest for the two jobs named; the residual risk is any job NOT named. And I'll note the meta-point: this round's prompt instructs "Read the crontab lines; do not take the header's word for it" — but the DIFF doesn't carry the crontab lines, so an auditor working from the diff alone (as I am) cannot comply; the offchain FOCUS bundle does include the full file, so round 19's off-chain pass can. For MY report: state the limitation explicitly and demand the file.

Hmm, wait — actually, I realize I should double-check one thing in the header: "revenue.mjs is opt-IN. Gated by `--live`; installed WITHOUT it, so the trusted hop does not start running unattended. Safe." — is revenue.mjs WITHOUT --live actually safe? It presumably runs in dry mode — does a dry revenue run do the SWAP? No — dry means no sweep. But does revenue.mjs without --live still do anything on-chain? Reconcile-only. Presumably safe. Can't verify. OK.

**R5. The gates in selftest.mjs.**

(a) isTableRow — covered above.

(b) The MintVault struct regex:

```js
const mintVaultFields = src => {
  const body = (src.match(/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/) || [])[1] || ''
  return [...body.matchAll(/^\s*pub (\w+):/gm)].map(m => m[1])
}
```

The regex: `pub struct MintVault<'info>\s*\{` then lazy `([\s\S]*?)` then `\n\}` — a newline followed by `}`. Non-greedy to the FIRST `\n}`. What inside an Anchor account struct could terminate it early? A `\n}` sequence — i.e., a line consisting of exactly `}` at the start... wait, `\n\}` = newline then `}` — the `}` must be the FIRST char of a line. Inside MintVault's struct body, is there any line starting with `}`? The struct body contains field declarations and comments. A comment line like `// }` — starts with `//`, not `}`. A doc comment containing a code block:

```rust
/// ```
/// }
/// ```
```

A line starting with `}` inside a doc comment would terminate the match early! Does MintVault's struct have such? Looking at the actual MintVault struct in the diff — the doc comments on `owner` are long prose with ⚠️ markers, no lines starting with `}`. Currently no early termination. But the question: "What inside an Anchor account struct could terminate it early, and would that fail closed or open?"

If terminated early: body = text up to the premature `\n}`. Then matchAll finds `pub (\w+):` in the truncated body — fields AFTER the premature terminator are MISSING from the parsed list. Then `mintVaultFields(mintSrc).indexOf('bank')` — if `bank` comes after the terminator, indexOf = -1. declaredBankIdx = 4. -1 !== 4 → assertion FAILS (red). Fail CLOSED (the gate goes red, not green). If instead a field BEFORE the terminator... the parsed list is a prefix of the real one; indexOf('bank') could still be correct if bank is before the terminator. Hmm — when would it fail OPEN? If the premature `\n}` occurs BEFORE `bank`, indexOf('bank') = -1 ≠ 4 → red. If AFTER bank, the prefix includes bank at the right index → green, and the assertion still proves what it claims (bank's position among the fields before it — wait, does it? indexOf counts `pub x:` matches in the body. If the body is truncated after bank, the fields before bank are all present, so indexOf('bank') is still the true index. The assertion "MINT_IX_BANK_IDX is the REAL position of bank" still holds. The payer assertion: indexOf('payer') — payer is AFTER bank (index 5). If truncation happens between bank and payer, indexOf('payer') = -1, and the assertion `indexOf('payer') !== declaredBankIdx` → -1 !== 4 → TRUE → passes vacuously! The assertion "payer is a DIFFERENT index" passes when payer isn't found at all. That's a weak assertion — it proves payer ≠ 4, but -1 ≠ 4 is trivially true. So a truncation between bank and payer: first assertion green (bank still at 4), second green (vacuous), third assertion `mintVaultFields(mintSrc).slice(0, 6)` equals `['config','asset','collection','owner','bank','payer']` — if truncated before payer, slice(0,6) has fewer than 6 elements → RED. So the third assertion catches truncation. Good — the third arm is the canary: it pins the first six field names exactly. So premature termination fails RED via the third arm, unless the premature `\n}` is after `payer` (index 5) — in which case the first six fields are intact and all three assertions still prove exactly what they claim (the struct's first six fields and bank's index). Truncation after payer is harmless to the claims. So: the regex is fragile but fails closed thanks to the slice(0,6) canary. 

What could terminate early in practice: a doc comment line beginning with `}` (e.g., a rustdoc code block closing brace — rustdoc code fences are usually indented or use ``` markers; a line `/// }` starts with `/` not `}`). For the regex to terminate early, the LINE must start with `}` — in the struct body, that only happens at the struct's actual close... or in a comment like `//}`? No — `//}` starts with `/`. So a line starting with `}` inside the body would have to be actual code — there is none in an Accounts struct (no nested blocks... unless a field has an inline `#[account(...)]` with... no). Actually — what about `pub struct MintVault<'info> {` appearing TWICE (a second struct with the same name elsewhere)? match takes the first. Fine.

Hmm — wait, one more: the regex `pub struct MintVault<'info>\s*\{` — in the actual source, the struct is `pub struct MintVault<'info> {`. Match ✓. And the body capture `([\s\S]*?)\n\}` — the struct closes with `}` at column 0 preceded by newline ✓.

But here's a REAL issue with the arm: **it reads `/opt/cbob-vaults/programs/cbob-vault-mint/src/lib.rs` — an ABSOLUTE path**. `fsx.readFileSync('/opt/cbob-vaults/programs/cbob-vault-mint/src/lib.rs', 'utf8')`. Other arms in selftest.mjs — how do they read files? The visible code uses `signSh` (read earlier — from where?) and `specSrc`. If the rest of selftest resolves paths relative to the repo (e.g., via import.meta.url or a ROOT constant), then this new arm hardcodes /opt/cbob-vaults — breaking portability (running the suite from a different checkout path fails). But more importantly for a GATE: if the suite is ever run from a different directory/clone (CI, another machine), this arm throws (ENOENT) — does the suite fail closed or does the throw kill the whole selftest before the floor check? An uncaught throw in selftest.mjs → process exits nonzero → run-tests.sh treats as failure → fail closed. OK. But ALSO: the hardcoded path means the gate reads THE DEPLOYMENT's source, not the suite's own tree — if the suite runs from a different checkout than /opt/cbob-vaults, the gate could verify a DIFFERENT file than the one under test. That's a subtle integrity issue: the gate's subject should be the tree under test. Evidence: run the suite from a second clone at /home/x/cbob-vaults — the arm still reads /opt/cbob-vaults/.../lib.rs. If the two trees differ, the gate certifies the wrong one. MEDIUM? It's a test-infrastructure defect; the repo clearly lives at /opt/cbob-vaults (audit scripts hardcode R='/opt/cbob-vaults' too). Consistent with repo convention. I'll file LOW: hardcoded absolute path makes the gate certify whatever tree is at /opt, not the tree under test; fine while there's exactly one tree, silent wrong-subject if there's ever two. Hmm — actually wait, is it plausible other arms do the same? `signSh` — probably read via a similar path or relative. Can't tell. I'll note it conditionally: if other arms use repo-relative resolution, this one is the odd one out (one-of-N-sites again).

(c) codeOnly for shell:

```js
const codeOnly = src => src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
```

Strips lines whose first non-whitespace char is `#`. "Is codeOnly correct for shell? What is a # that is not a comment?" In shell, `#` starts a comment ONLY when it begins a word — at the start of a line or after whitespace. A `#` INSIDE a word (e.g., `echo foo#bar`, or `${var#prefix}`, or `${LIVE[@]+...}`... wait — parameter expansion `${VAR#pattern}` strips a prefix! And `${VAR##pattern}`. And array expansion... The exec line itself: `exec node bank/cosign.mjs --tx "$TX" "${LIVE[@]+"${LIVE[@]}"}"` — no `#`. But a line like `X=${TX#*:}` — starts with `X`, not `#` — not stripped. A line where `#` is mid-word: `echo a#b` — not stripped (doesn't start with #). So codeOnly only strips lines STARTING with #. What shell line legitimately starts with `#` but is NOT a comment? Hmm: inside a heredoc! A heredoc body line starting with `#` is DATA, not a comment:

```sh
cat <<EOF | something
# this is data, not a comment
EOF
```

If bank-sign.sh contained a heredoc whose body line starts with #, codeOnly would strip DATA. Does bank-sign.sh use heredocs? Not visible. Also: `#!/bin/sh` shebang — starts with # — stripped as "comment" — harmless (it's not the exec line). Also inside a quoted string spanning lines? A multi-line string with a line starting with # — stripped. Edge cases, currently harmless. The sharper question: does stripping comments break the TAMPER TEST's semantics? The test: take codeOnly(signSh), replace the exec line, assert the strict regex no longer matches. Stripping comments first means the replace can only land on the REAL exec line (comments quoting it are gone). ✓. And the new arm asserts the real exec line still matches after codeOnly — ✓ (the exec line doesn't start with #). Sound for its purpose. The residual: a `#` that is not a comment — heredoc bodies and multi-line quoted strings — would be stripped; if the exec line ever lived inside such a construct (it doesn't), the gate would go blind. Fail direction: if the exec line were inside a heredoc (absurd), codeOnly might strip it → the "real exec line is still there" arm goes RED → fail closed. OK — codeOnly fails closed. Fine. I'll report: sound for current file; heredoc/quoted-string `#` is the theoretical miss; fails closed.

(d) The two new nothingToDo arms:

```js
t('a half-finished day raises the alarm...',
  D.detectDistribution({ days: { '2026-08-20': { startedAt: 'x',
    paid: { v1: { sig: 'abc' }, v2: { sig: null } } } } }, { today: '2026-08-21' })
    .some(f => f.kind === 'distribution_unfinished'), true)
t('...and a STALE nothingToDo would silence it — which is why the writer clears it',
  D.detectDistribution({ days: { '2026-08-20': { startedAt: 'x', nothingToDo: 'holding: quiet morning',
    paid: { v1: { sig: 'abc' }, v2: { sig: null } } } } }, { today: '2026-08-21' })
    .some(f => f.kind === 'distribution_unfinished'), false)
```

"Do they prove what they claim?" The claim: a stale nothingToDo suppresses distribution_unfinished on a half-finished day. The two arms: (1) without the flag → alarm fires; (2) with the flag → alarm doesn't fire. Together: the flag suppresses the alarm on this shape. That proves the DETECTOR behavior. Does it prove "which is why the writer clears it"? It proves the suppression exists; the writer-side fix (clearing both flags) is in distribute.mjs — is THERE a test for the clearing? The distribute.mjs selftest additions shown in the diff — I see settledAsPayout tests, realDay tests, dust tests — I do NOT see a test for the supersede logic (priorVerdict clearing)! The diff's distribute.mjs selftest section adds: dust bound tests, date tests, settledAsPayout tests. NO test that a proceeding plan clears refused/nothingToDo. So the WRITER side of the fix — the actual money-path behavior change — has no assertion. The selftest arms prove the detector would punish a stale flag, but nothing proves the writer clears it in every ordering (the R1 question!). The orderings (quiet-then-pay, refuse-then-pay, crash-resume) are untested. That's a real gap: the fix's core claim ("a plan that proceeds supersedes both flags") is untested; only its motivation is tested. Evidence: grep the diff for a test invoking the supersede path — none. The distribute.mjs selftest can't easily test main() (it's monolithic), but that's the project's own recurring excuse. MEDIUM. The fix: extract the supersede decision into a pure function (like settledAsPayout) and test the orderings, or add a ledger-fixture test.

Also — do the two arms prove what they claim about the DETECTOR? Arm 2 asserts `.some(...unfinished...) === false` — the alarm doesn't fire. But maybe it doesn't fire for a DIFFERENT reason (e.g., the detector requires finishedAt absent AND something else). Arm 1 vs arm 2 differ ONLY by nothingToDo — good experimental design (single variable). So yes, they prove the flag suppresses. ✓. But one more: arm 2's fixture has `nothingToDo: 'holding: quiet morning'` — a truthy string. What if nothingToDo were set but FALSY (empty string)? `delete st.days[day].nothingToDo` vs a writer that wrote `nothingToDo: ''`... the detector's suppression check — if it's `if (day.nothingToDo) suppress` — empty string is falsy → no suppression. And distribute's clearing: `priorVerdict = refused || nothingToDo` — '' is falsy → not cleared, but also doesn't suppress. Consistent. Fine.

Hmm — wait, actually there's something else about the detector arms. The FIRST new arm: half-finished day = startedAt set, no finishedAt, paid has one sig + one null. The PRE-EXISTING arm above it: `{ startedAt: 'x', paid: { v1: { sig: 'abc' } } }` → alarm fires. So the pre-existing arm already covers "started, never finished." The new arm adds a vault with sig:null — testing that a partially-paid day still counts as unfinished. OK fine.

(e) The BankKeyOutside arm — covered in isTableRow discussion. One more check on the new "moved out of table" arm:

```js
t('...and a name that lives ONLY in prose no longer counts as a table row',
  (() => {
    const moved = specSrc.split('\n').map(l =>
      isTableRow(l) ? l.replaceAll('BankKeyOutsideMint', 'SomeOtherRefusal') : l).join('\n')
    return [bankErrs.filter(n => !moved.includes(n)).length,                 // old check: blind
            bankErrs.filter(n => !tableLines(moved).includes(n))]            // new check: catches it
  })(), [0, ['BankKeyOutsideMint']])
```

This rewrites table rows replacing BankKeyOutsideMint→SomeOtherRefusal, leaving prose untouched. Old check (whole-file includes): BankKeyOutsideMint still in prose → 0 missing → blind ✓. New check: table rows no longer contain it → ['BankKeyOutsideMint'] ✓. This arm is sound and proves the fix. ✓. Note: `replaceAll` — Node 15+; the repo uses modern Node (execFileSync, Object.hasOwn — Node 16.9+). Fine.

But — the arm depends on BankKeyOutsideMint appearing in SPEC PROSE somewhere (outside the table). If it appears ONLY in the table, then after the rewrite `moved.includes('BankKeyOutsideMint')` is false → old check returns 1 missing, not 0 → the assertion `[0, [...]]` FAILS. So this arm asserts a fact about SPEC's current content: BankKeyOutsideMint appears in prose. If someone later cleans the prose mention, this test goes red — a content-coupling that could confuse (the test would fail even though the GATE is fine). Minor brittleness; fail-closed. Not worth much. Actually hmm, it's worth a sentence.

**R6. The counts and arithmetic.**

Floors: run-tests.sh diff shows DET_FLOOR=395→403, ALLOC_FLOOR=54→63, MAINNET_FLOOR=19 (unchanged, visible in context). MIN_ASSERTIONS — not in the diff; the prompt says 284. The selftest.mjs FLOOR: 395→403. distribute.mjs FLOOR: 54→63. Consistent: DET_FLOOR=403 matches selftest's 403; ALLOC_FLOOR=63 matches distribute's 63. ✓ (as far as the diff shows).

Now — are the floors CORRECT relative to the assertions added? distribute.mjs selftest: the diff adds... let me count the new t() calls in distribute.mjs's selftest:
- dust bound: 2 new (replacing 1) → net +1
- date tests: replaced 1 with 1, plus 2 new ('every real date still round-trips', 'while the impossible ones do not') → net +2
- settledAsPayout: 6 new
- the holdDays reset test: 1 new ('the whole point...')
Total new: 1+2+6+1 = 10. Old floor 54 + 10 = 64? But the floor is 63! Hmm — wait, let me recount. The diff in distribute.mjs selftest:

1. Removed: `t('...and the dust never exceeds the denominator', ...)` — 1 removed.
2. Added: `t('...and the dust is under ONE SAT PER PAID VAULT...')` — 1 added.
3. Added: `t('...and that tighter bound holds across a full 2,100-vault census', ...)` — 1 added.
Net so far: +1.

4. Removed: `t('...and a shaped-but-impossible date does not produce a confident wrong answer', ...)` — 1 removed.
5. Added: `t('...and a shaped-but-impossible date is REFUSED, not rolled over', ...)` — 1 added.
6. Added: `t('...and every real date still round-trips', ...)` — 1 added.
7. Added: `t('...while the impossible ones do not', ...)` — 1 added.
Net: +2 more (total +3).

8. Added settledAsPayout block: 
- 'a real signature is a payout day' — 1
- 'a hand payment SAYING SO is a payout day' — 1
- '...but a bare resolvedBy is NOT...' — 1
- '...and a resolution that says nothing landed is NOT...' — 1
- 'an unpaid row is not a payout day' — 1
- 'the whole point: a hand-paid day RESETS...' — 1
Net: +6 (total +9).

So 54 + 9 = 63. ✓ FLOOR=63 matches. 

selftest.mjs: FLOOR 395→403 = +8. New t() calls in selftest.mjs diff:
1. 'a half-finished day raises the alarm...' — 1
2. '...and a STALE nothingToDo would silence it...' — 1
3. '...and a pass-through of "$@" would be caught' — REPLACED (was 1, still 1) — net 0
4. '...and the real, untampered exec line is still there to be caught (both ways)' — 1
5. 'MINT_IX_BANK_IDX is the REAL position...' — 1
6. '...and payer — the slot the round-18 theft used — is a DIFFERENT index' — 1
7. '...and the parser read a real struct, not an empty match' — 1
8. '...and a reordering that moves bank off that index is CAUGHT' — 1
9. '...and a name that lives ONLY in prose no longer counts as a table row' — 1

Count: 2 + 1 + 1 + 4 + 1 = 9? Let me recount: items 1,2 (2) + item 4 (1) = 3 + items 5-8 (4) = 7 + item 9 (1) = 8. ✓ 395+8=403. 

And DET_FLOOR in run-tests.sh = 403 ✓ matches selftest FLOOR. ALLOC_FLOOR=63 ✓ matches distribute FLOOR. Consistent. And the prompt's FLOORS read from run-tests.sh: onchain=284 (MIN_ASSERTIONS — not visible in diff, can't verify; the prompt renders 284 so the grab worked), detector=403 ✓, alloc=63 ✓, mainnet=19 ✓ (visible in diff context: MAINNET_FLOOR=19).

Hmm wait — one important check: does run-tests.sh's DET_FLOOR actually gate selftest.mjs's count, and ALLOC_FLOOR gate distribute's? Presumably (floor() function). The floors now agree with the in-file FLOORs — but they're DUPLICATED (run-tests.sh DET_FLOOR=403 AND selftest.mjs FLOOR=403). The audit scripts read from run-tests.sh; the files enforce their own. If they drift... the in-file floor is the real gate; run-tests' floor is a second copy. A number duplicated into a second place is a number that drifts — their own words! The FLOORS-grab fix addressed the PROMPT's copy but left run-tests.sh's copy as a duplicate of the in-file floors. Minor — but exactly their defect class. LOW. Evidence: run-tests.sh:160 has DET_FLOOR=403; selftest.mjs:1726 has FLOOR=403 — two sites, one fact. If an assertion is added to selftest.mjs and only the in-file floor is bumped, run-tests' floor goes stale (harmless — it's a floor, stale-low passes) — actually stale-low is fail-open-ish for the "suite stopped early" protection at the runner level, but the in-file floor still protects. Eh. LOW.

Now the arithmetic: census 108/60/36/24/12 → 732. Weights 2/3/4/5/6 for I/II/III/IV/V. 108*2 + 60*3 + 36*4 + 24*5 + 12*6 = 216 + 180 + 144 + 120 + 72 = 732. ✓

945/525/315/210/105 → 945*2 + 525*3 + 315*4 + 210*5 + 105*6 = 1890 + 1575 + 1260 + 1050 + 630 = 6405. ✓ (The prompt says 6,405 ✓.)

Also check the census sums: 108+60+36+24+12 = 240 ✓ (charter scale). 945+525+315+210+105 = 2100 ✓. And the ratios: 108:60:36:24:12 = 9:5:3:2:1 (108/12=9, 60/12=5, 36/12=3, 24/12=2, 12/12=1) ✓. 945:525:315:210:105 = 9:5:3:2:1 (945/105=9, 525/105=5, 315/105=3, 210/105=2) ✓. Consistent shape.

"the ten per-1,000-dollar figures; five shares summing to 100.0%" — I don't have the schedule document. Per-$1,000 figures: with weights, a level's share of a drop = (count*weight)/denominator. For the 240-vault census: level I share = 216/732 = 29.508...%; II = 180/732 = 24.590%; III = 144/732 = 19.672%; IV = 120/732 = 16.393%; V = 72/732 = 9.836%. Sum: 29.508+24.590+19.672+16.393+9.836 = 99.999 ≈ 100.0 ✓. Per-vault within a level: level I vault gets (1000 * 2/732)... I can't verify the ten per-$1,000 figures without the card. I'll state: the two census→denominator figures verify; the per-$1,000 and shares figures are not in the diff and cannot be independently re-derived here — flag that the round's own R6 asks for it but the bundle (programs focus) doesn't include the schedule file. Hmm — actually the prompt asks ME to re-derive them. I can derive the five shares for both censuses:

240-vault: I 29.51%, II 24.59%, III 19.67%, IV 16.39%, V 9.84% — sums to 100.00% (29.5082+24.5902+19.6721+16.3934+9.8361 = 100.0000). ✓
2100-vault: I 1890/6405=29.508%, II 1575/6405=24.590%, III 1260/6405=19.672%, IV 1050/6405=16.393%, V 630/6405=9.836% — IDENTICAL percentages (same 9:5:3:2:1 ratio). Interesting — the shares are scale-invariant. So "five shares summing to 100.0%" ✓ by construction.

Per-$1,000: level I vault at 240-scale: 1000*2/732 = $2.732; II: 1000*3/732=$4.098; III: $5.464; IV: $6.831; V: $8.197. At 2100-scale: 1000*2/6405=$0.312; II: $0.468; III: $0.625; IV: $0.781; V: $0.937. Ten figures = five per scale. I can present these as the derived values and note the card must match. Since the ratio structure is fixed, any card showing different percentages is wrong. I'll present the derivation.

**R7. What the self-audit missed — one-of-N-sites sweep.**

For every fix in this diff, was it applied to all sites of its shape?

1. **The mint payer-slot fix (MINT_IX_BANK_IDX)**: applied to mint_vault's confinement. Sites of its shape: SEAL's open_for_redemption confinement — does SEAL exempt the open/burn pair ENTIRELY (known limit 3: "The Bank may still be named payer INSIDE the pair itself; the confinement exempts both approved instructions entirely")! So the SAME defect class the round-18 CRITICAL fixed in MINT — Bank named as payer inside an exempt instruction — REMAINS in SEAL/BURN: a redemption transaction could name the Bank as `payer` of the `open_for_redemption` or `burn_vault` instruction. What does payer do in those? In SEAL's OpenForRedemption, `payer: Signer<'info>` is passed to set_frozen → Core's UpdatePluginV1 CPI as the fee payer (AccountMeta::new(payer.key(), true)) — the payer pays for the plugin update (account rent/fees?). In BURN's BurnVault, `payer: Signer` is passed to BurnV1 CPI — Core's BurnV1... does it transfer lamports to the payer? Core's BurnV1 — when burning an asset, the asset account's lamports go to... the payer? Hmm. In Metaplex Core BurnV1, the asset account is closed and rent refunded — to the payer? If Core refunds the asset account's rent (~0.0015 SOL, or 5,000,000 lamports per the measured fact — the asset-signer PDA holds 5M lamports but the ASSET account itself has its own rent) to the instruction's payer... If the Bank is named payer of the burn, the Bank pays the transaction's... no wait, the payer in the CPI pays for account closures' rent refunds go TO the payer typically. Actually in Core's BurnV1, closing the asset account refunds lamports to the payer. So naming the Bank as payer of burn_vault → the Bank RECEIVES the refund (harmless) or PAYS? Hmm. Actually the more direct issue: known limit 3 already covers this ("The Bank may still be named payer INSIDE the pair"). It's LISTED as accepted. But — the round-18 CRITICAL was exactly this shape in MINT, and the fix narrowed MINT only. The known-limits list says the pair exemption is accepted. Is it WORSE than stated now? The limit says "The Bank may still be named payer INSIDE the pair itself" — in MINT, the Bank-as-payer BOUGHT A VAULT (money leaves the Bank). In SEAL/BURN, what does payer do? SEAL's payer: pays for the UpdatePluginV1 CPI — Core charges nothing beyond transaction fees (the payer is the fee payer of the CPI's inner instructions — but fees are charged to the TRANSACTION fee payer, not per-CPI). Actually the `payer` in UpdatePluginV1 is used for rent if the plugin authority account needs creation — PermanentFreezeExecute plugin authority is an ADDRESS (no account creation). So SEAL's payer is inert? BURN's payer in BurnV1: Core's BurnV1 closes the asset account and the lamports go to the payer! So `burn_vault(payer = bank)` → the Bank RECEIVES the asset account's rent lamports. That's money INTO the Bank — harmless. Hmm, wait — actually does BurnV1 refund to payer? I believe Core's BurnV1 transfers the asset account lamports to the payer. So Bank-as-payer of burn = Bank receives ~rent. Not a theft. And the asset-signer PDA's 5M lamports are NOT swept by BurnV1 (measured fact 4). So the pair exemption's payer risk is: negligible? The known limit stands as stated, not worse. BUT — one more: in the pair, could the Bank be named in a slot that DOES matter? open_for_redemption accounts: vault_asset, collection, owner, bank, payer, config, seal, mpl_core, instructions, system_program. The Bank pinned to config.bank for the `bank` slot. Other slots: vault_asset (must be a Core asset in collection — the Bank's key isn't a Core asset → fails read_core_asset), collection (must match asset's collection), owner (Signer — the Bank COULD be the owner if the Bank owns a vault! Then the Bank is both owner and co-signer — a 1-of-1 for that vault. But the Bank owning a vault is the Bank's own business). config (PDA-pinned), seal (PDA), mpl_core (address-pinned), instructions (address-pinned), system_program. So within the pair, the Bank's key in a harmful slot: payer (inert-ish). OK — the known limit is accurate, not worse. I should SAY that (the prompt says the most valuable thing is telling them if a limit is worse — here I checked and it's NOT worse, with the reasoning).

Hmm wait — actually, hold on. Let me reconsider the MINT fix itself for completeness. The confinement in mint_vault:

```rust
if is_mint {
    for (n, a) in ix.accounts.iter().enumerate() {
        require!(a.pubkey != bank || n == MINT_IX_BANK_IDX, MintError::BankKeyOutsideMint);
    }
} else {
    require!(!ix.accounts.iter().any(|a| a.pubkey == bank), MintError::BankKeyOutsideMint);
}
```

For a mint instruction, the Bank may appear ONLY at index 4. But WAIT — what about the CURRENT instruction itself? The current instruction IS a mint (is_mint true when i==current), and its accounts are checked positionally — bank must be at index 4. The actual MintVault struct: config(0), asset(1), collection(2), owner(3), bank(4), payer(5), revenue(6), instructions(7), seal_config(8), mint_authority(9), mpl_core(10), system_program(11). ✓ bank at 4, payer at 5. The test 9d.4 passes bank at index 5 (payer) → rejected ✓.

Now — is there a way to wear the mint shape and still spend the Bank? The exemption requires program_id == MINT && data starts with IX_MINT_VAULT_DISC. A mint instruction with the Bank at index 4 — the handler then runs and pins bank to config.bank (require_keys_eq bank == cfg.bank). So the Bank at index 4 in ANY mint instruction is the co-signer — fine. The Bank at any other index of a mint → rejected. Non-mint instructions → no Bank anywhere. The FEE PAYER — not in account lists — remains policy (stated). What about the Bank as a WRITER (is_writable) at index 4? The bank account in a mint is Signer, not mut — but the CONFINEMENT only checks pubkey and index, not writability. A mint instruction passing bank at index 4 with is_writable=true — Anchor's constraint would... the struct declares `pub bank: Signer<'info>` — Signer accounts: Anchor doesn't refuse writable signers? If the transaction marks bank as writable and it's a signer — the runtime allows it; the program never writes to it (no mut reference). Harmless. OK.

What about a mint instruction to MINT with the discriminator but a SHORTER account list — ix.accounts.get(4) — the loop enumerates actual accounts; if the list has only 3 accounts, the Bank can't be at 4, and if the Bank is at 0-2 → rejected. And the handler would fail on missing accounts (Anchor deserialization). Fine.

What about CPI'd mints? load_instruction_at_checked sees top-level only — a mint reached BY CPI: the top-level instruction containing it is NOT a mint (different program) → the Bank's key in the top-level instruction's accounts → rejected (unless absent). But the CPI'd mint needs the Bank's signature — the Bank signs the TRANSACTION, and a CPI signer... for the CPI'd mint_vault to see bank: Signer, the calling program must pass the Bank as a CPI signer — which requires the Bank to have signed the transaction, and the Bank's key would appear in the top-level instruction's account list (as a signer for the calling program) → the confinement on the top-level instruction rejects it. Unless the calling program passes the Bank WITHOUT it appearing top-level — impossible; CPI signers must be transaction signers and... hmm, actually a PDA of another program can't sign AS the Bank. The Bank is an ed25519 key; for it to be a CPI signer it must be a transaction signer, and the runtime requires... the top-level instruction's account metas include the Bank (the calling program received it). So the confinement catches it. ✓ Sound.

2. **The BankKeyOutsideMint error message fix** — applied to the message. Sites: the message now describes all three emit sites. ✓ (checked — the walk-not-reached site also emits it; message covers "somewhere this instruction does not authorise" — the seen_self failure isn't really "the Bank's key appears somewhere"... the message for seen_self failure says the Bank's key appears somewhere unauthorized — but in the seen_self case, the walk didn't reach us; the Bank's key may appear NOWHERE. The message is then misleading in the third case! "the Bank's key appears somewhere this instruction does not authorise" — for a seen_self failure (walk stopped early — can that even happen? load_instruction_at_checked errors only if index out of range or parse fails; the walk from 0 increments — it reaches current by definition unless the sysvar read fails mid-way... Actually if load_instruction_at_checked(i) errors for i < current, the loop stops, seen_self false → error. When would it error for a valid index? Instruction too large? The sysvar has a size limit — instructions sysvar holds limited data; load_instruction_at_checked can fail with InvalidArgument on huge instructions. So a transaction with a malformed/huge instruction BEFORE the mint could stop the walk → BankKeyOutsideMint with the "key appears somewhere" message — misleading but fail-closed. Minor message inaccuracy for the third site — the comment says the message now covers "when the walk did not reach our own index" — does it? The message: "the Bank's key appears somewhere this instruction does not authorise: either outside the bank slot of a mint_vault, or in an instruction that is not a mint_vault at all." The walk-didn't-reach case is NEITHER of those. The comment CLAIMS the message covers three sites; the message text covers two. Tiny doc-vs-message drift inside the fix for a doc drift. LOW, worth one line — it's exactly their class.)

3. **The test payer migration (bank→alice)**: the diff shows FOUR sites changed (lines ~170, ~440, ~528, ~1298, ~1544 — that's five hunks) plus the new 9d.4 test which deliberately uses bank as payer. The self-audit note says a blanket replace broke 5.2's signer list and it was fixed by adding alice to signers. Are all mint sites migrated? The diff shows hunks at 170, 440, 528, 1298, 1544 — five sites. Is there a sixth mint site still passing bank as payer? Can't tell from the diff (only changed lines shown). If a mint site still passes bank as payer, that test now FAILS (the confinement rejects it) — the suite would go red, so the suite passing at 284 implies all sites migrated. Actually — that's a nice property: the on-chain fix makes stale test sites FAIL rather than silently pass. So completeness is enforced by the suite itself. ✓ Good — I can note that the fix is self-enforcing for test sites.

4. **realDay / ISO_DAY**: holdDays now uses realDay for both filters. Sites of its shape: anywhere else day keys are validated? dayDiff? The bad-key check in holdDays covers the ledger. Other readers of day keys: detectDistribution (detectors.mjs) reads days — does IT validate day keys? If the detector iterates st.days with date arithmetic, a 2026-02-30 key could confuse it too. One-of-N-sites risk: realDay fixed in holdDays only. Evidence to check: grep detectors.mjs for date parsing. Can't verify from diff — flag it.

5. **Object.hasOwn / null-proto**: census + denominator fixed. Sites: allocateWeighted's validation (fixed in round 17). Other object-key lookups on ledger data: `st.days[day]` — day is computed, fine. `plan.per` — fromEntries, fine. LEVEL_WEIGHTS lookups — guarded in round 17. What about `Object.values(levels)` in census — levels is the input; if levels has prototype-reachable... census counts only hasOwn(c, v) — a level string like 'constructor' → hasOwn(c,'constructor') false → not counted ✓. What about a level 'toString'? Same ✓. OK.

6. **The supersede fix**: one site (the pay path). The reverse ordering (payment then refusal) not covered — noted above.

7. **The refusal paging**: one site. The SOL-floor failure "fifteen lines below" already had NOTIFY — so both halt paths now page. Other halt paths in distribute.mjs: holdDays THROWS on a bad ledger (round-17 fix) — a throw in main() → unhandled rejection? Does distribute.mjs have a top-level catch that pages? If holdDays throws (bad day key), the job dies — does it page? The throw path: "A money job that throws is a money job that does not run" — if the throw propagates, exit code nonzero, cron mails stderr (if MAILTO configured) — but NOTIFY? Probably not. So: refusal pages, SOL-floor pages, but a thrown ledger error (arguably the most severe — the ledger is corrupt) does NOT page. One-of-N-sites on the paging fix! Evidence: the diff adds NOTIFY only to the plan.refusal branch; the throw sites (holdDays' two throws, allocateWeighted's refusal is plan.refusal so covered) — holdDays throws are NOT wrapped in anything that pages (not visible in diff; main() might have a catch — can't see). Flag as verification demand / likely gap: MEDIUM. Actually — the round-17 prompt asked "A money job that throws is a money job that does not run... has a griefing surface been created" — and the answer then was presumably "throwing is right." But PAGING on throw was never added. The refusal-pages fix covers one halt flavor; the throw halt flavors (bad ledger day key, non-finite dayDiff) page nobody. If the ledger gets a bad key (how? the payer writes it — limit 11), the job throws daily, silently (until someone reads logs). Hmm — cron does email output by default to the local mailbox if MAILTO set... The repo has alarm.mjs as "the only path to a human" per the old comment. So: the paging fix is one-of-N-sites over halt flavors. I'll file MEDIUM with the caveat that main() might catch — evidence: run with a ledger containing '2026-02-30' → observe whether NOTIFY fires.

8. **audit19.ts's own new checks** — verifyRoster added (good). The MIN_AUDITORS quorum. Sites: audit18.ts does NOT have verifyRoster (it's new in audit19). audit18.ts is in the diff as a new file — it has the quorum/disqualify fixes but NOT roster verification. If audit18.ts is ever re-run (it's committed!), it can silently run short. One-of-N-sites: the roster-verification fix applied to audit19 only, not backported to audit18. LOW (audit18 is superseded) — but the repo keeps every round's script; anyone re-running round 18's script gets the unverified-roster behavior. Meh, LOW.

Now — **the third target: under-claims (safer/stronger than documented)**.

Let me hunt for places the system is STRONGER than documented:

1. The MINT confinement now also protects... hmm. The control table presumably has a row for the Bank-key confinement. Does the table now UNDERSTATE the mint confinement? The round-18 fix narrowed the mint exemption to positional identity — the table (not in the diff) may still describe it as "the Bank's key may not appear outside a mint_vault" (the round-17 wording) — which UNDERSTATES the new guarantee (it may not appear outside the bank SLOT of a mint_vault). If the table wasn't updated, it's both an under-claim AND drift. The diff doesn't show SPEC.md changes! The diff covers programs, bank, scripts, tests — NO SPEC.md. The control table's row for the MINT confinement — was it updated to describe the narrowed exemption? The selftest C5 arm checks table rows against source ("claims ON-CHAIN, source says ON-CHAIN") — the arm checks the TAG matches, not the prose accuracy. If SPEC's row still says "exempt: any mint_vault" while the code now says "only the bank slot," the table UNDERSTATES the guarantee — exactly the owner's defect shape. Evidence: read SPEC.md's control table row for BankKeyOutsideMint; compare its description of the exemption to the positional check. I can't read SPEC.md (not in bundle) — FLAG IT as the highest-priority under-claim candidate: the strongest new guarantee in this diff (positional confinement) was added WITHOUT any visible SPEC.md update in the diff, and no gate checks prose accuracy of the table's description column. This is a strong finding — the diff contains ZERO SPEC.md changes while changing what the confinement guarantees. If the table was updated in an earlier commit within ec7d17e..HEAD... the diff I have IS ec7d17e..HEAD (labeled 2c8cd9b..HEAD, ugh) and shows no SPEC.md hunk. So either SPEC was already accurate (unlikely — the positional narrowing is NEW in this diff) or the table now understates. Wait — hmm, actually: does the diff include SPEC.md changes? Scanning the diff: bank/distribute.mjs, bank/selftest.mjs, programs/cbob-vault-mint/src/lib.rs, scripts/audit18.ts, scripts/audit19.ts, scripts/bank-sign.sh, scripts/cron-install.sh, scripts/run-tests.sh, tests/3prog.test.ts. NO SPEC.md. The MINT confinement was narrowed (a STRONGER guarantee) and the error message changed, and the control table — which the selftest checks for BankKeyOutside* NAMES — the name didn't change, so the naming gate stays green. But the table's DESCRIPTION of what the confinement does — if it says "the Bank's key may appear only in mint_vault instructions" — now understates. HIGH-value finding (in their terms): the round strengthened the on-chain guarantee and did not touch the one document the customer reads. Actually — I should be careful: maybe the table's row was already written as "the Bank's key may appear only in the bank slot" in a prior commit anticipating... no, the positional check is NEW in this diff (the round-18 fix). Before this diff, the exemption was whole-instruction. So any SPEC prose describing the round-17 behavior now understates the round-18 guarantee. Unless SPEC never described the exemption's breadth. Either way: unverifiable-from-diff + no gate = the exact shape. File as HIGH? It's a documentation under-claim, not money. In this project's economy, the owner's worst-defect-round was exactly this shape. I'll file it HIGH with the honest caveat that SPEC.md isn't in my bundle and the check is one read away.

Hmm wait — but also the reverse: the table might OVER-claim now if it described... no, the code got stronger; prose describing the old behavior under-claims. Right.

2. Another under-claim candidate: the corrected bank-sign.sh comment — now accurate (verified above). The cron header — now accurate for the two named jobs. The audit19 runner — now fails closed on quorum... but does its DOCUMENTATION under-claim? The header says "this round REFUSES to exit 0 below quorum" — true (process.exitCode=1). ✓.

3. SEAL's header: "the co-signer is a MITIGATION and never a proof: its scan is one slot old and the airdrop race does not close" — accurate.

4. What about the MINT confinement's coverage of the FEE PAYER — documented as policy. Accurate.

5. Under-claim in the other direction — the test suite: "the confinement either refuses every honest mint or exempts the wrong slot, and the suite stays green either way" — that was the motivation for the new gate; the gate now exists. ✓.

6. Hmm — one more under-claim: the distribute refusal now pages AND exits 1 — is that documented anywhere as a control ("a refusal reaches a human")? If SPEC's table has a row for distribution refusal detection saying "alarm.mjs only" — understates the new paging. Same class as #1: off-chain controls strengthened without visible SPEC update. The diff has no SPEC.md — so ANY behavioral strengthening in this diff (positional confinement, refusal paging, supersede logic, canonical base64) is absent from the control table unless it was never tabulated. The BankKeyOutside naming gate only checks NAMES exist in the table, not that the table's descriptions match current behavior. So: one finding covering "this diff strengthens at least four controls and contains zero SPEC.md changes; the table's descriptions cannot have been updated; every strengthened control is now under-documented." That's the owner's shape, systematically. I'll make this a HIGH finding (or one HIGH with sub-items).

Wait — I should double check: is SPEC.md even in the diff paths? `git diff ec7d17e..HEAD -- programs bank scripts tests` — THE DIFF IS FILTERED to programs/bank/scripts/tests! The audit19.ts DIFF command excludes SPEC.md, docs, etc. So SPEC.md changes might EXIST in the commits but be excluded from the diff I was given! Hmm — that changes things. The diff shown to me is filtered; SPEC.md could have been updated in 7f2f5a7 and I can't see it. So my finding becomes: the round's diff filter (`-- programs bank scripts tests`) HIDES documentation changes from the auditors — an auditor cannot verify whether the control table was updated to match the strengthened controls, and the round's own R1-R7 never mentions SPEC. The bundle note says "Everything omitted has been in at least one prompt across rounds 1-17; audit-coverage.sh gates that and passes at 27 of 27 files" — so SPEC.md was in SOME earlier prompt, but the CURRENT state of SPEC relative to THIS diff's changes is not auditable from this bundle. For the offchain focus, the bundle includes distribute/cosign/bank-sign/cron-install — NOT SPEC.md. So neither focus pass can check the table against the new behaviors. That's a real structural gap in THIS round: the diff filter excludes the document whose accuracy the owner's worst-defect-shape is about. MEDIUM-HIGH. And the concrete check: `git diff ec7d17e..HEAD -- SPEC.md` — if empty, the under-claims are real; if not, read the rows. I'll frame it exactly that way — falsifiable in one command.

7. One more under-claim hunt in code comments: MINT's header comment on the confinement says "EXEMPTION: only a `mint_vault` to THIS program." — written in round 17, still present in the file I was given (the full lib.rs shows: "EXEMPTION: only a `mint_vault` to THIS program. Several mints may share a transaction and each names the Bank exactly as this one does."). WAIT — this is IN THE CURRENT FILE (the bundle includes the full current lib.rs). The comment says the exemption is "only a mint_vault to THIS program" — but the CODE now exempts only the bank SLOT of a mint_vault. The comment UNDERSTATES the guarantee (and misdescribes the check) — it's the round-17 description sitting above the round-18 narrowed check. Let me verify from the bundle text: in the MINT lib.rs provided, inside mint_vault:

```
// EXEMPTION: only a `mint_vault` to THIS program. Several mints may share a
// transaction and each names the Bank exactly as this one does. The FEE
// PAYER is still invisible here — it appears in no instruction's account
// list — and stays a policy matter; see SPEC's control table.
```

Yes! This comment survives in the current file, directly above the narrowed check, and describes the OLD (wider) exemption. The new comment block ("EXEMPT DOES NOT MEAN UNCHECKED...") is inside the `if is_mint` branch, but the older "EXEMPTION: only a mint_vault to THIS program" paragraph was NOT updated. So the file contains BOTH the old description ("exempt: any mint_vault") and the new one ("only the bank slot") — the old one is now FALSE as a description of the check (it's true that only mint_vaults are exempted from the any-account ban, but read as the extent of the exemption it says a mint wearing the discriminator is waved through — which round 18 measured as a theft and fixed). An operator reading the EXEMPTION paragraph would believe naming the Bank as payer of a mint is fine. This is a live, in-file under-claim/over-claim hybrid — the comment asserts a weaker control than the code enforces (under-claim about the guarantee; over-claim about what's permitted). It's the owner's exact shape, INSIDE the diff, and the self-audit missed it. This is a solid HIGH... well, it's a comment. In this project's economy, comments are first-class defects (nine rounds of comment findings). The comment says something FALSE about a money control. I'd file HIGH given their calibration — actually, let me think about severity honestly: the comment could mislead a future maintainer into "re-widening" or into believing the payer slot is exempt. The project treats this class as its top defect. HIGH.

Let me also check SEAL's equivalent comment: "WHAT IS EXEMPT, AND WHY THAT IS NOT A HOLE. Only instructions to THIS program carrying the open discriminator, or to BURN carrying the burn discriminator." — for SEAL this is ACCURATE (the pair exemption is still whole-instruction there, per known limit 3). ✓ no drift in SEAL.

8. Another under-claim: tests — "because('9d.4','BankKeyOutsideMint')" added ✓.

9. What about the cron header's "revenue is the only job this script leaves dormant" — if there are other jobs (alarm, reconcile) that are neither money-movers nor dormant, the sentence is about dormancy of money jobs — fine-ish.

10. Under-claim in distribute: the new supersede logic — documented in comments ✓.

11. Hmm, what about the "284-assertion suite" claim vs the added 9d.4 test? MIN_ASSERTIONS=284 — the diff adds test 9d.4 (one rec()) — was MIN_ASSERTIONS bumped from 283→284? Not visible (run-tests.sh hunk only shows DET_FLOOR/ALLOC_FLOOR). If the on-chain suite gained an assertion (9d.4) and MIN_ASSERTIONS stayed at its old value, the floor is stale-low — fail-open for early-stop at the runner level, but the suite's own floor... does 3prog.test.ts have an in-file floor? Unknown. The prompt says floors are read from run-tests.sh — MIN_ASSERTIONS=284 presumably includes 9d.4. Can't verify — note it: if 9d.4 is net-new, MIN_ASSERTIONS must have been 283 before; the diff doesn't show that bump, meaning either it was already 284 with slack, or the bump happened outside the shown hunks. Actually the run-tests.sh diff hunk shows ONLY the DET_FLOOR/ALLOC_FLOOR lines changed — so MIN_ASSERTIONS was NOT changed in this diff. If 9d.4 is a new assertion and MIN_ASSERTIONS was already 284 pre-diff, then pre-diff the suite had 283 assertions against a floor of 284 — it would have FAILED. Contradiction → either MIN_ASSERTIONS was bumped in a hunk I can't see (the hunk context shows lines 160-168ish; MIN_ASSERTIONS could be elsewhere in the file and changed in another hunk not shown — but the diff shows only ONE hunk for run-tests.sh)... Hmm, the diff for run-tests.sh shows exactly one hunk (@@ -160,8 +160,8 @@) changing DET_FLOOR and ALLOC_FLOOR. So MIN_ASSERTIONS unchanged in this diff. But this diff spans 2c8cd9b..HEAD which includes round 17's repairs too — 9d.4 is round-18. If round 17's diff added assertions and bumped MIN_ASSERTIONS to 284, and round 18 added 9d.4 without bumping — then the suite now has 285 assertions (or 284 if something was removed) against floor 284. The floor is a MINIMUM — 285 ≥ 284 passes. Stale-low floor = weaker early-stop protection but not a failure. The in-suite count claim "284-assertion suite" in the prompt would then be an UNDERCOUNT (the suite is bigger) — trivial. OR the suite is exactly 284. Can't resolve; note as unverifiable, low priority. Actually — hmm, wait: the prompt says "All four programs pass a 284-assertion suite" — if the real count is 285, the claim understates. Whatever — LOW, mention in passing under R6.

Now let me also stress-test the **MINT confinement walk** once more for a real hole, since it's the money fix:

```rust
let mut i = 0usize;
let mut seen_self = false;
while let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
    let is_mint = ix.program_id == crate::ID && ix.data.len() >= 8 && ix.data[..8] == IX_MINT_VAULT_DISC;
    if i == current { seen_self = true; }
    if is_mint {
        for (n, a) in ix.accounts.iter().enumerate() {
            require!(a.pubkey != bank || n == MINT_IX_BANK_IDX, ...);
        }
    } else {
        require!(!ix.accounts.iter().any(|a| a.pubkey == bank), ...);
    }
    i += 1;
}
require!(seen_self, ...);
```

Hole hunt: the walk checks every instruction 0..∞ until Err. seen_self requires reaching current. Instructions AFTER current are also walked (loop continues past current until Err at current+1... wait — load_instruction_at_checked(current+1) errors when index == number of instructions → loop ends. So ALL instructions including those after current are checked ✓ (unlike SEAL's job-1 which only needed after, but job-2 checks all ✓).

The Bank's key in a LATER instruction: checked ✓. In an EARLIER instruction: checked ✓. As fee payer: not visible (documented) ✗ policy.

What about the Bank's key inside a CPI (nested)? Top-level account lists only — a CPI instruction's accounts are inside the outer program's data, invisible. Could an attacker CPI to SystemProgram.transfer from the Bank? A CPI requires the calling program to pass the Bank as a signer — the Bank must have signed the TRANSACTION, and for the runtime to mark it signer in the CPI, the Bank's key must be in the top-level instruction's account list (the calling program's accounts) — which the confinement rejects. Actually — subtle: the Bank signs the transaction; a top-level instruction to program X includes the Bank's key as a signer meta; X CPIs transfer(from=Bank). The top-level instruction to X has the Bank in its accounts → confinement rejects (X's instruction is not a mint). ✓ closed. And if X's instruction does NOT include the Bank but X somehow CPIs with the Bank as signer — impossible (CPI signer requires the account be a signer in the outer frame... actually PDA-signed CPIs work for PDAs; for an ed25519 key like the Bank, the runtime requires the key to have signed the transaction AND be passed as signer through the chain — the top-level meta must have is_signer=true for the Bank, meaning the key IS in the top-level account list). ✓ closed.

What about instructions with the Bank's key in the top-level list but the instruction is a mint to MINT with the disc — the Bank at index 4 only. But what if the attacker crafts a mint instruction with the Bank at index 4 AND ALSO at index 7 (duplicate account)? Index 7 ≠ 4 → rejected ✓. Bank at 4 twice? Only index 4 allowed; a second occurrence at any other index rejected ✓.

Edge: `MINT_IX_BANK_IDX = 4` — verified against the struct by the new gate ✓ and by the suite (9d.4 rejects bank-at-5) ✓.

What about the discriminator check `ix.data[..8] == IX_MINT_VAULT_DISC` — is [29,76,246,26,123,202,230,234] really sha256("global:mint_vault")[..8]? The prompt says it's pinned by suite assertion 3.1b3 and was verified by computing. I can't recompute sha256 here... let me try? sha256("global:mint_vault") — I can't compute SHA-256 mentally. The suite asserts it (claimed). The prompt's measured facts say the first draft was fabricated and the real one is this — computed. I'll trust the suite pin and note I can't independently recompute in this medium — actually, I CAN note the check: `echo -n "global:mint_vault" | sha256sum` should start 1d4cf61a7bcae6ea. That's the falsifiable evidence. Good.

Similarly IX_BURN_VAULT_DISC [150,115,145,83,24,135,83,99] = sha256("global:burn_vault")[..8] → 9673915318875363 hex. And IX_OPEN_FOR_REDEMPTION_DISC [244,178,130,11,158,107,45,95] → f4b2820b9e6b2d5f. State as checks.

Hmm — wait, one more on the MINT walk: `load_current_index_checked` — returns the CURRENT instruction index. For a mint reached by CPI, current = the OUTER instruction's index (documented in SEAL). If mint_vault is CPI'd from program X at top-level index 3: current=3, and the walk checks instruction 3 (X's instruction — not a mint → the Bank must not appear in X's accounts — but the Bank DID sign and must be in X's accounts for the CPI signer... so CPI'd mints with the Bank are rejected ✓ fail-closed, maybe over-strict but safe).

OK — now, is there anything about **compute units** (limit 12: "COMPUTE UNITS are unmeasured anywhere. This one got worse this round — see R1")? The prompt says it got WORSE this round. The MINT confinement walk iterates ALL instructions with load_instruction_at_checked — each call parses the sysvar. For a transaction with many instructions, the walk is O(N) with parsing cost. MINT's walk now runs on EVERY mint (the busiest instruction). A transaction with many mints: each mint's handler walks all instructions → O(N²). With N mints in one tx (the comment says "Several mints may share a transaction"), each mint walks N instructions → N² parses. Plus the walk itself: load_instruction_at_checked re-parses the sysvar each call (it reads from the sysvar data each time — each call is O(size of instruction i)). The total: for a tx with K instructions, each mint handler does K load calls. If a builder stuffs 50 mints in one tx (cap permitting), 50×50=2500 loads. Each load_instruction_at_checked is not free (borrows sysvar, parses). Could a mint transaction now exceed the default 200k CU budget and fail? The suite passes (284 assertions, mints work) — but the suite presumably tests small transactions. A legitimate bulk-mint transaction (the charter round: 240 vaults — minted in shared transactions?) could now hit CU limits. THAT's how limit 12 "got worse": the round added an unbounded per-instruction walk to the hottest path without measuring CU. Evidence: build a transaction with K mints, measure compute units consumed vs budget, find the K where it fails. The fix: measure CU in the suite for worst-case mint transactions (e.g., assert consumed CU < budget for a 20-mint tx), or cap the walk. I should file this as the "limit 12 got worse" confirmation — the prompt explicitly says "DO tell us if any is worse than stated." This is worse than stated: previously unmeasured; now there's a new O(N) sysvar-parsing loop on every mint with N = total instructions, quadratic in shared-mint transactions, and the byte-ceiling measurement (831/975/1119) was about PACKET size, not CU. MEDIUM-HIGH? It's a potential halt of bulk minting (fail-closed, no theft). The charter round mints 240 vaults — if those go in shared transactions, CU could bite at launch. I'd file MEDIUM with a concrete measurement demand. Hmm — actually, also SEAL's walk: open_for_redemption walks all instructions too — redemption transactions are bounded (≤1232 bytes → few instructions), fine. MINT transactions: also packet-bounded (1232 bytes) → max instructions in a tx is bounded by packet size! Each instruction ≥ ~50 bytes overhead → max ~20-ish instructions per tx. So N ≤ ~20, N² ≤ 400 loads. Each load maybe ~1-2µs of CU... 400 × (parse cost) — probably fine within 200k CU. Hmm, but each load_instruction_at_checked reads the ENTIRE sysvar region? The instructions sysvar is the whole transaction's instruction data — parsing instruction i requires scanning? The implementation: load_instruction_at_checked reads the sysvar account data and iterates to index i — O(total instruction bytes) per call! So K calls × O(total bytes) = quadratic in bytes. Total instruction bytes ≤ ~1100 → 20 calls × 1100 bytes = 22k byte-reads — each byte read is CU. Could be ~50-100k CU for the walk alone in a stuffed transaction. Plus Anchor overhead, the Core CPI (CreateV2 is CU-heavy — plugin parsing). A realistic worst case might approach 200k. Unmeasured = the point. I'll file it as: limit 12 is worse — quantify with the measurement demand. MEDIUM.

Also — the walk in MINT runs BEFORE the round/price checks (the confinement block is early in mint_vault — actually it's after name/uri/attr checks and the bank pin, before collection check). Order doesn't matter for CU.

Now let me look for anything else in the diff I haven't covered:

**tests/3prog.test.ts 9d.4**: the payer-theft test constructs a mint with bank at index 4 (signer) and bank at index 5 (payer, signer, writable) and signers [bank, a, alice]. Wait — the keys list: MINT_CFG, a.publicKey (asset, signer), COLL, alice (owner, signer), bank (bank slot, signer), bank (payer slot, signer, writable), REVENUE, SYSVAR_INSTRUCTIONS, SEAL_CFG, MINT_AUTH, CORE, System. The confinement: for the CURRENT instruction (a mint), Bank at index 5 ≠ 4 → BankKeyOutsideMint ✓. The test expects REJECT with BankKeyOutsideMint ✓ and `because('9d.4','BankKeyOutsideMint')` ✓. Good test.

Hmm — but wait: does the test verify the rejection happens at the CONFINEMENT and not earlier? The instruction would also fail... bank pinned to config ✓ (bank at index 4 is the real bank). owner=alice signs ✓. The first failure the handler hits: name/uri/attr checks pass; bank pin passes; then the confinement loop — instruction 0 (itself): is_mint ✓ → enumerate accounts → index 5 is bank → require fails → BankKeyOutsideMint ✓. But hold on — the walk starts at i=0; at i=0, is_mint is true (it IS the current instruction, index 0 if it's the only instruction). The test's transaction: is the mint the only instruction? `att(()=>send([new TransactionInstruction({...})],[bank,a,alice]))` — one instruction ✓. So the rejection is at the confinement ✓.

**The 5.2 fix** (brick test): payer moved bank→alice, signers [bank, brickAsset, alice] ✓ — the comment explains the blanket-replace breakage. Fine.

**distribute.mjs — the `t()` for the 2,100-vault census**: builds levels with keys 'v0'..'v2099', bals all '21000'. allocateWeighted(bals, levels, avail) for avail in [1000000, 1000001, 999999, 123456789, 51239, 1, 7]. Checks dust < activated.length each time, worst < 2100. Wait — `if (r.dust >= BigInt(r.activated.length)) return 'BOUND BROKEN at ' + avail` — returns a string → t() compares to true → fails ✓. And worst < 2100n — hmm, worst < 2100 means dust ≤ 2099 ✓ matches the comment's "2,099 max". But is worst < 2100n actually PROVEN by the test, or just observed for those 7 avail values? Just observed — the bound proof is mathematical (my derivation above). The test samples 7 values. Fine as a canary. Note: the comment says "Measured across the 2,100-vault census: worst observed 2,099" — the test's 7 samples produce SOME worst; the comment claims 2,099 observed. Whatever. ✓.

**The realDay tests**: ['2026-02-28','2024-02-29','2026-12-31','2026-01-01'].every(realDay) — 2024-02-29 is a real leap day ✓ (2024 is a leap year). ['2026-02-30','2026-13-01','2026-00-10','2023-02-29'].some(realDay) === false — 2023-02-29: 2023 not leap → Feb 29 rolls to Mar 1 → round-trip fails ✓. '2026-00-10': month 00 — Date.parse('2026-00-10T00:00:00Z') — month 0 is January in JS Date?! Date.parse with month 00 — ISO strings with month 00: the spec says month is 01-12; '2026-00-10' — is it invalid? Hmm: `new Date('2026-00-10T00:00:00Z')` — V8: I believe month 00 is REJECTED as invalid (ISO parser requires 01-12)? Or accepted as January? Let me think — the ISO 8601 parser in V8 validates ranges: month must be 01-12, day 01-31. '2026-00-10' → invalid → NaN → Number.isFinite false → realDay false ✓. Even if some engine accepted month 0 as January, the round-trip check ('2026-01-10' !== '2026-00-10') catches it ✓. Good — the round-trip design is robust to parser leniency. ✓.

'2026-13-01' → month 13 → invalid or rolls to next Jan → round-trip fails ✓.

**The holdDays '2026-02-30' test**: holdDays with days {'2026-02-30': ...} → bad keys → throw → 'REFUSED' ✓. And the anchor fallback: days.sort()[0] — hmm, `days` is filtered by realDay now, so '2026-02-30' is in `bad`, thrown before use ✓.

**settledAsPayout tests** ✓ — including the '2,52' cadence test: mk builds days {'2026-07-01': paid a sig 'old', '2026-08-20': paid a <row>}. holdDays(mk(resolvedAs paid), '2026-08-22'): paid days = ['2026-07-01','2026-08-20'] (both settledAsPayout) → anchor 2026-08-20 → n=2 ✓. holdDays(mk(bare resolvedBy)): '2026-08-20' row is resolved-without-paid → settledAsPayout false → paid=['2026-07-01'] → anchor → 52 ✓ (Jul 1 → Aug 22 = 52 days: July has 31 days, Jul 1 + 52 = Aug 22 ✓ (30 remaining in July + 22 = 52) ✓).

**The distribute FLOOR comment**: "Its twin in selftest.mjs got one last night and this one did not, which is the same one-of-two-sites shape for the sixth round running" — fine.

Now — **the audit18/audit19 PROMPT content itself**. One more scan for template defects in audit19.ts's prompt... 

Looking at audit19.ts PROMPT R2: "census() returns a spread of a null-prototype object and denominator() uses Object.hasOwn." ✓ matches code.

R5: "The exec-scraping arm now strips comment lines first" ✓.

Hmm — what about the audit19 prompt's KNOWN AND OPEN item 12: "COMPUTE UNITS are unmeasured anywhere. **This one got worse this round — see R1.**" — but audit19's R1 is about the self-audit's repairs (template literals, isTableRow, refused/nothingToDo, manifest) — NOTHING about compute units! The pointer "see R1" dangles — R1 in THIS prompt says nothing about compute units. Where did "see R1" come from? In audit18's prompt, R1 was the mint confinement (where the new sysvar walk lives — compute units relevant!). The known-limits list was copied from audit18's prompt with its "see R1" pointer intact, but R1 changed meaning between rounds. So the rendered round-19 prompt tells auditors "COMPUTE UNITS got worse this round — see R1" and R1 is about template literals. A dangling cross-reference — minor, but it's in MY prompt too (I can see it: "12. COMPUTE UNITS are unmeasured anywhere. **This one got worse this round — see R1.**"). Evidence: read R1 — no compute units. Another stale-copy defect in the certification instrument. LOW. But it DID direct me to check whether compute units got worse — and my analysis above says YES, the MINT walk adds CU cost to every mint. So the pointer is stale but the claim is true. Funny. I'll report both.

Also in the known-limits: item 8 "Cross-pass correlation lag: a CRITICAL that already went out is never retracted" — fine.

**One more R1 item: "The manifest stopped trimming git porcelain output. Check the record it writes is well-formed."** — covered above: dirty.split('\n').filter(Boolean) — well-formed. One nit: `dirty` in the manifest is the ARRAY; the console warning uses the raw string. And `if(dirty)` — raw string truthiness ✓. And `${dirty?'  ⚠️ DIRTY TREE':''}` ✓. Well-formed. But — hmm, one thing: `git status --porcelain -- programs bank scripts tests` — porcelain output for UNTRACKED files in those dirs shows `?? bank/foo.mjs` — included ✓. For a file modified in programs but the change is STAGED: `M  programs/...` (staged) vs ` M` (unstaged) — both shown ✓. OK well-formed.

Wait — one more manifest issue: `head` is captured BEFORE the models run; if the operator commits DURING the 45-minute round (they did exactly this in round 18 — the self-audit commit landed between passes!), the manifest's head is stale and the reports were generated against a different tree. Covered in my TOCTOU finding above. Also — the DIFF was computed at script START (execSync at module load) — so the prompt content is fixed at launch; the bundle FILES (f(...)) are also read at launch. So within one pass, the prompt is consistent. Cross-pass: each pass re-runs the script → new head/diff. The manifest per pass records its head ✓. The remaining hole is mid-pass commits (affects nothing already-read — the prompt is built at launch; models read the PROMPT, not the tree!). Actually — the models receive the PROMPT (built at launch). Mid-round tree movement doesn't change what models already received. So the TOCTOU is: the manifest claims "head=X, clean" but the tree at head-X... the prompt was built from the working tree files (f() reads working tree) and the diff (git). If the tree is clean at launch, prompt = committed state ✓. Mid-round commits don't affect the already-built prompt. So the fixed-tree guarantee is actually SOUND within a pass (prompt built atomically at launch, models get a copy). The only residual: `dirty` check covers programs/bank/scripts/tests — the prompt also embeds... only those dirs ✓. OK so the TOCTOU concern is mostly moot — downgrade to a nit: the manifest records launch-time state, which IS what the models saw. Fine. Actually wait — one gap: the dirty check covers the dirs, but what about `git diff ec7d17e..HEAD` — if HEAD moved between the diff computation and... no, all at launch, sequential. Fine. I'll drop the TOCTOU to a LOW nit or drop it. Hmm — but the round-18 defect ("two passes built from diffs taken at two different HEADs") — the new manifest records head per pass, making the discrepancy VISIBLE ✓. Good fix. I'll say the manifest is well-formed and the per-pass head closes the round-18 hole; remaining nit: nothing verifies the two passes of one round share a head — a post-round check could compare MANIFEST-programs.head vs MANIFEST-offchain.head. That's a concrete improvement. LOW.

Now let me think about whether there are any REAL money-path CRITICALs I'm missing. The prompt warns a third of CRITICALs were wrong; I should be careful. Let me re-scan the MINT confinement for the one thing that would be a real hole...

The `is_mint` check: `ix.program_id == crate::ID && ix.data[..8] == IX_MINT_VAULT_DISC`. `crate::ID` — the program's own ID. An instruction to MINT with the mint discriminator — could an attacker craft an instruction with the discriminator but FEWER accounts, where the Bank is at index 4 of a 5-account list, and the handler... the handler deserializes MintVault context — Anchor requires all 12 accounts → fails. But the CONFINEMENT runs before Anchor? No — Anchor deserializes the context BEFORE the handler runs. So a malformed mint never reaches the confinement. The confinement only sees instructions; for the CURRENT instruction, Anchor already validated it's a well-formed mint_vault. For OTHER mint instructions in the tx (siblings), they're validated when THEY execute. A sibling mint instruction that never executes (e.g., after a failing instruction? no — all instructions in a tx execute sequentially; if one fails the tx aborts). Every instruction in the transaction executes. So every sibling mint is also Anchor-validated. ✓.

What about an instruction to MINT with the mint discriminator where the Bank is at index 4 — that's a legit co-signed mint ✓. And index 4 in the CONFINEMENT's view = the `bank` field ✓ (gate-verified).

Hmm — what about `remaining_accounts`? MintVault has no remaining_accounts. ✓.

What about the Bank's key appearing in a sibling mint at index 4 AND the sibling mint being for a DIFFERENT config? config is PDA-seeded — only one config. ✓.

OK — the MINT fix looks sound. The residual: fee payer (documented), and the SEAL/BURN pair exemption (documented, analyzed above as not-worse).

Let me also double-check the **9d.4 test's account list against the real struct order**: keys: MINT_CFG(0), a(1 asset), COLL(2), alice(3 owner), bank(4), bank(5 payer), REVENUE(6), SYSVAR_INSTRUCTIONS(7), SEAL_CFG(8), MINT_AUTH(9), CORE(10), System(11). Struct: config, asset, collection, owner, bank, payer, revenue, instructions, seal_config, mint_authority, mpl_core, system_program ✓ matches. And the gate's parsed list ['config','asset','collection','owner','bank','payer'] ✓ matches the first six. ✓ consistent.

Now — **the selftest gate reading `/opt/cbob-vaults/programs/...` — wait, actually, let me look again**: `const mintSrc = fsx.readFileSync('/opt/cbob-vaults/programs/cbob-vault-mint/src/lib.rs', 'utf8')`. Hmm, and `signSh` — where's it from? Not shown. And `specSrc` — not shown. If specSrc is also an absolute /opt path, then the whole selftest is /opt-pinned and the new arm is consistent with convention. The repo IS at /opt/cbob-vaults (audit scripts use R='/opt/cbob-vaults'). So probably consistent. I'll soften: IF sibling arms use relative resolution, this is the odd one; either way, /opt-pinning means the suite cannot run against a second checkout — LOW nit, mention briefly. Actually the more interesting angle: the gate parses the SOURCE of the program — but the suite tests the BUILT BINARY. Source-vs-binary drift: if someone edits lib.rs and doesn't rebuild, the gate certifies the source while the suite runs the old binary. The discriminator assertion (3.1b3) presumably checks the built artifact? Unknown. The struct-index gate reads source — the binary's account order is what matters at runtime. A source edit without rebuild → gate green on new source, suite runs old binary — but the suite's 9d.4 tests the BINARY's behavior, so behavioral drift is caught by 9d.4 ✓. The gate is belt-and-suspenders. Fine.

**Now the "what should this project do that AI audit structurally cannot" section.** They want concrete, non-repeated answers. SPEC.md's SHIP GATE already has answers I shouldn't repeat — I don't know exactly what's in it, but likely candidates already there: bug bounty, monitoring, upgrade-authority multisig, canary, formal verification? I should propose things structurally outside AI text-audit:

1. **Adversarial execution, not reading**: a standing exploit harness — mutation testing on the actual binaries: inject known-bad mutations (reorder accounts, flip a require, widen an exemption) into the source, rebuild, and assert the SUITE goes red. This measures the suite's detection power (mutation score) rather than asserting it. AI reading can't measure whether gates detect; only execution can. Concretely: a script that applies N curated mutations (they already have the shapes: one-of-N-sites, fail-open loop, stale floor) and requires 100% suite kill rate. This directly addresses "a gate that certifies a bug is worse than no gate" — the 173-assertion defect would have been caught by mutating the date and seeing the suite stay green.

2. **Differential/prod shadow runs**: run the real pipeline (distribute, revenue) against a mainnet-fork simulator with replayed adversarial ledgers — property-based ledger fuzzing: generate random ledger states (including hostile ones: bad day keys, prototype-reachable levels, half-finished days, superseded verdicts in every ordering) and assert invariants (no re-send, dust bound, alarm fires). The orderings questions in R1 are exactly what property tests answer and what reading cannot.

3. **A human-designed red team exercise with money on a testnet with real cbBTC-like tokens and a paid attacker** — hmm, "no human firm will ever see this" — but the OWNER is human. The owner reading found the worst defect. Institutionalize the owner's reading: a weekly 30-minute owner read of ONE artifact rendered (the prompt, the table, one header) with a checklist for under-claims. Concretely: render-and-read sessions — the ${FLOORS} defect was caught by RENDERING; make rendering a routine (every prompt, every table, every customer card rendered to PDF and read by the owner).

4. **Invariant monitors on mainnet from day one with a kill-switch budget**: an independent watcher (separate key, separate codebase — even a simple one) that checks on-chain invariants (Bank key appearances in confirmed transactions involving the four programs — solvable by indexing) and can trigger the pause. AI audit is pre-deployment; runtime detection is the only thing that covers the unknown-unknowns. Concretely: index every transaction that names the Bank's pubkey; alert on any where the Bank signs and money moves outside the sanctioned shapes — this is mechanically checkable post-hoc on-chain (signatures are public).

5. **Cap the blast radius structurally**: hot-wallet limits — the Bank key's SOL float and the distributor key's per-day cbBTC ceiling enforced by a second program or by operational splitting (the distributor key holds only one day's float). AI audit can't reduce the cost of being wrong; treasury architecture can. Concretely: fund the distributor daily with only that day's max payout; keep the rest in the revenue PDA (already enforced 85/15 on-chain) — the off-chain hop's worst case becomes one day.

6. **Provenance/commitment for the level register** (limit 16's proposed fix) — actually that's in SPEC presumably.

7. **Time-boxed canary with real small money before scale**: run the whole system with real but tiny amounts (charter round is free — but the revenue cycle and a real distribution with 21 sats) for 31+ days before the first real drop, with the alarm treating silence as failure. The 31-day ceiling has never fired in production; the first time it fires will be with customer money.

I'll pick the strongest 3-4, concrete.

Also the verdict-challenge section: "THE AUTHOR'S OWN VERDICT ON ROUND 15 — attack it / (round 17's verdict is being written...)" — stale, covered.

Let me also reconsider **R2's "paymentState deliberately left unchanged"** once more for a subtle issue: settledAsPayout(row) calls paymentState(row) TWICE (once for 'paid', once for 'resolved'). paymentState's order-dependent logic ("a resolved REFUSAL is SETTLED, never re-sent (order matters here)") — calling it twice is fine (pure). ✓.

And — is there a row where paymentState returns 'paid' but settledAsPayout should be false? E.g., a row with sig AND rejected? paymentState({sig:'x', rejected:true}) — order matters; if rejected is checked first → 'rejected'? The test says "a resolved REFUSAL is SETTLED" — paymentState({amount, sig:null, rejected:true, resolvedBy}) = 'resolved'. What about {sig:'x', rejected:true}? Unknown ordering. If paymentState returns 'paid' for it, settledAsPayout says payout-day — but the payment was rejected?? A row with both sig and rejected is contradictory data; edge case. Not visible. Skip.

**One more R2 check — "Is that still true for every caller now that a second function reads the same rows?"** — the re-send question: the send loop writes rows and skips rows whose paymentState is settled. settledAsPayout doesn't affect sending. ✓. But — hmm, what about the RESUME path: after a crash, the rerun reads existing rows; a row with resolvedAs:'paid' (hand-paid) — paymentState = 'resolved' → not re-sent ✓. Good.

**Now the census serialization question** — "Does the census still serialise into the ledger and back?" — plan.census = plan.census (the spread object) → JSON.stringify → parse → plain object ✓. "Is there a consumer that needed a normal prototype?" — the RETURNED object is normal-proto (spread creates normal object) ✓. Only the INTERNAL c is null-proto. ✓ sound. One nit: `return { ...c }` — if LEVELS ever contained a key like '__proto__'... LEVELS is ['I','II','III','IV','V'] — fixed. ✓.

OK — now let me also verify the **dust comment's "2,099 max"** claim once more: "at 2,100 vaults at most 2,099 sats" — dust < activated.length = 2100 → dust ≤ 2099 ✓. And "Measured across the 2,100-vault census: worst observed 2,099" — plausible. ✓.

And the **"under one sat per paid vault"** phrasing: dust < N_paid where each paid vault contributes < 1 sat ✓. But careful: is dust < activated.length or < PAID count? If some activated vaults are skipped (not paid), dust < paid_count ≤ activated.length — the comment says "one fractional part per PAID VAULT... the true bound is dust < activated count" — hmm, it says "dust < activated count" — if skipped vaults exist, the tighter truth is dust < paid count, and dust < activated is the LOOSER-but-true bound. The comment conflates slightly but the asserted bound (dust < activated.length) is TRUE either way (since paid ≤ activated). The test asserts dust < activated.length ✓. The prompt asks: "Is dust < activated.length ALWAYS true, including when available is smaller than the vault count, and when some vaults are skipped?" — my answer: YES — because dust = Σ_{v∈allocated} frac_v < |allocated| ≤ |activated|, and when available is tiny, shares are 0 but each frac < 1 still (frac = avail·w_v/denominator < 1 whenever share = 0; when share ≥ 1, frac < 1 by definition of floor). Wait — one more edge: is frac < 1 ALWAYS? frac_v = (drop·w_v mod denominator)/denominator ∈ [0, 1) ✓ always, regardless of drop size. So dust = Σ frac_v < N_allocated ✓ ALWAYS. The only assumption: every allocated vault's share is computed by floor(drop·w/denominator) — per the doc comment ✓. And skipped vaults: if the allocator EXCLUDES a vault from allocation entirely (e.g., below 21,000 sats — not activated), it's not in activated either. If a vault is in activated but its send FAILS, the allocation still counted it — dust unchanged ✓. Confirmed: the bound is always true. Good — I'll present this derivation and confirm the fix, noting the one unverifiable assumption (per-vault floor division) is stated in the allocator's own doc comment and exercised by the 2,100-vault test.

Hmm — wait, actually, one more subtlety on the dust bound: what if denominator is 0 (no activated vaults)? allocateWeighted with empty activated — division by zero? BigInt division by 0n throws. But an empty plan wouldn't reach allocation (nothingToDo). Edge — skip.

Now let me also sanity-check **the "quiet then pay" ordering for a REAL problem**: quiet morning writes nothingToDo. Afternoon run proceeds — the clearing block runs INSIDE `if (!plan.skip && !DRY)`. But WAIT — when is nothingToDo written? Presumably in the skip path: `st.days[day].nothingToDo = plan.skip` somewhere (not shown, but the selftest fixture shows nothingToDo: 'holding: quiet morning' — the skip reason string). So the quiet run wrote nothingToDo = 'holding: quiet morning'. Afternoon: plan proceeds → clears both → writes plan → pays. ✓. But — what if the afternoon run is ALSO quiet (still holding)? Then plan.skip set → the clearing block skipped → nothingToDo already set (rewritten?) ✓ stays. ✓.

What about: morning REFUSES (unlevelled vault). Operator fixes levels. Afternoon run proceeds → clears refused ✓ pays ✓. But — the morning refusal PAGED (exit 1, NOTIFY). The afternoon success — does anything record the recovery? supersededAt/supersededWas ✓. And the detector: distribution_refused reads `refused` — cleared → no finding ✓. But what about the morning's exit-1 page saying "REFUSED and paid nobody" — the operator already got paged; the afternoon run's success is visible in logs. Fine.

**Two runs in one day where the FIRST pays and the SECOND is quiet**: first run pays, finishedAt set. Second run: plan.skip (nothing new) → writes nothingToDo?? On a day that PAID? If the quiet path writes nothingToDo unconditionally on skip, a second same-day quiet run would write nothingToDo on a day with paid rows and finishedAt — then the detector: distribution_unfinished suppressed by nothingToDo — but the day FINISHED (finishedAt set) so unfinished doesn't fire anyway; and distribution_refused — not refused. Does nothingToDo on a finished day cause any wrong suppression? The detector's nothingToDo reader suppresses distribution_unfinished — a finished day doesn't raise it. Harmless. But the LEDGER now says nothingToDo on a paid day — confusing record. Does the quiet path check for existing paid rows before writing nothingToDo? Not visible. Minor. Hmm — actually wait, would a second run even reach the plan? If the day has finishedAt, maybe main() short-circuits ("already ran today")? Unknown. Skip — too speculative.

OK, let me also examine **the R1 manifest question "Check the record it writes is well-formed"** once more — one real nit: `dirty.split('\n').filter(Boolean)` — if porcelain output uses CRLF (git config core.autocrlf on Windows — irrelevant, Linux). Fine. And JSON.stringify with null,2 ✓. And `models:RESULTS.map(...)` includes disqualified with reasons ✓. Well-formed ✓. I'll answer: yes, well-formed, with the per-pass-head improvement noted.

Now — **severity calibration and the final report structure**. Order: R1-R6 (R7 folded in), carry-over list (known limits — worse-or-not verdicts), verdict challenges, anything else, then the final section.

Let me also decide the top findings by severity:

CRITICAL: none that I can defend on measurement. I should be honest about that — the prompt heavily warns against invented CRITICALs. The MINT fix looks sound; the off-chain fixes look mostly sound.

HIGH candidates:
1. **The stale "EXEMPTION: only a mint_vault to THIS program" comment in MINT's mint_vault** — live in the current file, describes the round-17 wide exemption that round 18 measured as a theft and narrowed; the file now contains two contradictory descriptions of the same check, and the surviving one is the FALSE (weaker) one. This is the owner's under-claim shape, in the diff, missed by the self-audit. Evidence: the bundle's own lib.rs text contains both paragraphs. Fix: rewrite the EXEMPTION paragraph to "only the `bank` slot of a mint_vault" and delete/merge the duplicated round-18 comment. — HIGH (in their economy; it's a false statement about a money control adjacent to the code that enforces the truth).

2. **The audit19 prompt's diff header and verdict section are stale** ("2c8cd9b..HEAD — every repair round 17 made", "VERDICT ON ROUND 15", "round 17's verdict is being written") while the embedded diff is ec7d17e..HEAD — the certification round misdescribes its own subject to all eight auditors; plus the dangling "see R1" compute-units pointer; plus the roster comments contradicting the rosters in both audit18.ts and audit19.ts. Bundle as one HIGH? These are defects in the certification instrument — the thing that IS the certification. Given "this process is the certification," a prompt that tells auditors the wrong provenance is a real defect. I'd say HIGH for the bundle (multiple independent stale-prose defects in the newest, least-read file — the exact class the round was supposed to be curing), or MEDIUM-HIGH. Let me settle: the diff-header mismatch is the sharpest (it misstates WHAT IS BEING AUDITED). HIGH.

Hmm, wait — actually, let me double-check the diff-header claim once more. In audit19.ts:

```
const DIFF=execSync(`cd ${R} && git diff ec7d17e..HEAD -- programs bank scripts tests`, ...)
```

and in the PROMPT:

```
=====================================================================
THE DIFF UNDER AUDIT (2c8cd9b..HEAD) — every repair round 17 made, in one place
=====================================================================
${DIFF}
```

Yes — the header says 2c8cd9b..HEAD / round 17's repairs; the variable is ec7d17e..HEAD. And MY prompt (rendered from audit19.ts) contains exactly this contradiction: the R1 bullet says "The complete diff ec7d17e..HEAD is at the end" and the diff section header says "(2c8cd9b..HEAD) — every repair round 17 made". Confirmed — the evidence is in the prompt itself. Also note: since 2c8cd9b..HEAD ⊇ ec7d17e..HEAD, the embedded diff (if it really is ec7d17e..HEAD) contains ONLY the three new commits — but the diff I was shown contains round-17 changes too (the mint confinement's first version, the base64 length checks, etc.)... wait, does it? The diff shown includes the mint confinement comments referencing "ROUND 17, CRITICAL" as pre-existing context (the @@ hunks show the confinement block being MODIFIED — the `if !is_mint` → `if is_mint` change means the confinement existed before this diff). So the diff I received includes changes ON TOP of round-17's repairs — consistent with ec7d17e..HEAD where ec7d17e is round-17's repair commit... but then why does the diff include the full text of audit18.ts as a NEW file? audit18.ts would be new in 982e5ef (round 18 programs commit) ✓ — that's within ec7d17e..HEAD ✓. And tests/3prog.test.ts hunks show the payer migration (round 18) ✓. And bank-sign.sh's round-18 canonical check ✓. OK so the embedded diff IS ec7d17e..HEAD (round 18 + self-audit), and the header labeling it "2c8cd9b..HEAD — every repair round 17 made" is doubly wrong (wrong range, wrong provenance). Confirmed HIGH... well, MEDIUM-HIGH. It misleads but the R1-R7 bullets carry the true framing. I'll go HIGH on the bundle because the certification's accuracy is the product, and this is the fourth+ stale-prose defect in the file whose job is accuracy. Hmm, let me reconsider — the project's own severity history: comment/documentation defects have been "the worst defect" rounds. The owner's worst was an under-claim in the table. A prompt that misdescribes the diff's provenance to every auditor... I'll rate it MEDIUM, honestly — it doesn't change what the auditors receive (the diff itself), only the label; the R-sections correctly describe the subject. But the roster-comment contradictions (audit18.ts says qwen dropped while qwen3-max is in the roster; says gemini comes in while no gemini is present) are worse — they misrecord WHO audited. The manifest records the truth though. Ugh. Let me split: 
- MEDIUM: audit19.ts stale diff-header + verdict section + dangling "see R1" (misdescribes the round's subject and verdict target to all auditors).
- MEDIUM: audit18.ts roster comment contradicts its own roster on three particulars (qwen "dropped" but present; "deepseek-v4-pro" vs deepseek-v4-flash-0731; "gemini-3.1-pro comes in" but absent) — and the same stale comment is copied into audit19.ts where it contradicts the adjacent "NONE OF THESE EIGHT WAS USED IN ROUND 18" note. The record of who audited what is the certification's provenance; the manifest is the receipt, but the prose will be read.

3. **No SPEC.md changes in the diff while four controls were strengthened** — the under-claim sweep. But the diff is FILTERED (programs bank scripts tests) — SPEC changes could exist outside the filter. So the finding is: the round's diff filter excludes SPEC.md, so neither the auditors nor I can verify the control table describes the NEW behaviors (positional confinement, refusal paging, supersede logic, canonical base64); the naming gate only checks names, not descriptions; and the owner's worst-defect shape (table understating a guarantee) is exactly what an un-updated table now does for the mint confinement. Evidence: `git diff ec7d17e..HEAD --stat -- SPEC.md` — empty ⇒ the table still describes the round-17 exemption ⇒ understates. HIGH (it's the owner's named shape, applied to the round's headline fix).

Hmm — wait. Is it fair to call this HIGH when I can't see SPEC.md? The finding is conditional but the check is one command. The project's own gates can't see it either (no gate checks description accuracy). I'll file it as HIGH with the explicit falsification path. Actually — let me reconsider once more. The control table's row for the MINT confinement: what would it say? Round 17 added the confinement and presumably a row ("Bank-key confinement in mint_vault — ON-CHAIN"). The row's description column — if it says "the Bank's key may appear in no instruction except mint_vault" — now understates. If it says just "Bank-key confinement" — no drift. The C5 gate checks the fourth column tag against source. The risk is real but content-dependent. I'll file MEDIUM-HIGH... let me just call it HIGH with the conditional clearly stated, since the prompt explicitly elevates this shape ("An under-claim is as much a defect as an over-claim"). Hmm, but the prompt also warns about wrong CRITICALs — a HIGH that turns out empty (SPEC was updated outside the filter, or the row never described breadth) costs a read. The finding's honest form: "unverifiable from this bundle + no gate + the diff filter excludes the document = the exact blind spot; here is the one-command check." I'll rate it MEDIUM and be loud about the check. Hmm... The owner's worst defect was this shape and NO GATE could see it. My job: surface candidates with evidence paths. MEDIUM is defensible; HIGH is defensible. I'll go HIGH for the in-file comment (finding 1 — that one is CONFIRMED in the bundle text) and MEDIUM for the SPEC question (unconfirmed, one command to resolve). That's calibrated: confirmed in-bundle evidence gets HIGH; conditional gets MEDIUM.

4. **The supersede fix has no test and an uncovered ordering (payment→refusal same day leaves a false "refused and paid nobody" flag)** — MEDIUM.

5. **The refusal page is fire-and-forget (catch {}) — a page that fails is indistinguishable from one that sent; and the throw-halt flavors (bad ledger key) page nobody** — MEDIUM (one-of-N-sites on the paging fix).

6. **Compute units: limit 12 is worse — the MINT walk adds an O(instructions) sysvar parse to every mint, quadratic in multi-mint transactions, unmeasured** — MEDIUM (fail-closed halt risk on bulk mints; measurement demand).

7. **bank-sign.sh -w0 platform dependence** — LOW (fail-closed outage on non-GNU base64; the sanctioned signing path refuses everything on macOS/BusyBox).

8. **isTableRow not pinned to THE control table; heredoc-# blindness in codeOnly (fails closed); the prose-coupling brittleness of the moved-name arm** — LOW bundle.

9. **The MintVault struct regex fragility — fails closed via the slice(0,6) canary; the vacuous payer assertion when truncated** — LOW (with the note that the canary saves it).

10. **Floors duplicated between run-tests.sh and in-file FLOORs** — LOW.

11. **MIN_ASSERTIONS not visibly bumped for 9d.4** — LOW/unverifiable.

12. **The empty-string base64 acceptance** — LOW nit.

13. **audit18.ts lacks verifyRoster (not backported)** — LOW.

14. **The manifest per-pass head — add a cross-pass equality check** — LOW improvement.

Carry-over list verdicts:
- Limit 3 (Bank as payer inside the pair): checked — NOT worse; payer in open/burn is inert-to-favorable (SEAL's payer pays nothing beyond CPI framing; BURN's payer RECEIVES the asset-account rent refund if Core refunds to payer; the asset-signer PDA's 5M lamports are untouched by BurnV1 per measured fact 4). Actually hold on — let me double-check BURN's payer direction once more. Core BurnV1 accounts: asset, collection, payer(signer, mut?), owner, mpl_core... In Metaplex Core's BurnV1, the payer receives the closed asset account's lamports? I believe BurnV1 closes the asset account and refunds lamports to the payer... or to the owner? Hmm. If to the PAYER, then Bank-as-payer of burn_vault → Bank RECEIVES ~rent (0.0015 SOL) — money INTO the bank, harmless. If Core requires the payer to fund something — no. Either way not a theft of the Bank. And SEAL's open payer: UpdatePluginV1's payer — used if the plugin authority account needs creating (it's an address authority — no account) — inert. So limit 3 stands as stated, not worse. But — one more: could the Bank be named payer of the open instruction AND Core's UpdatePluginV1 charge the payer for... no. OK: not worse. State it.
- Limit 12 (compute units): WORSE — filed above.
- Limit 11 (distribution reconciles against a ledger the payer wrote): the supersede logic now MUTATES that ledger's verdict flags (delete refused/nothingToDo, add supersededAt/supersededWas) — the payer self-editing its own ledger got a new shape: the day's history is rewritten (with a record). Not worse in kind (it was always payer-writable), but the detector's trust in `refused`/`nothingToDo` now depends on the payer having cleared them correctly. Eh — same trust model. Mention briefly.
- Limit 6/7 (flock): unchanged.
- Limit 16 (level register): the refusal-paging change makes the unlevelled-vault halt LOUDER (pages daily) — the griefing surface is unchanged but now has a paging cost; bounded by cron cadence. Not worse in exploitability; note the paging-bounded analysis.
- Limit 1a/1b: unchanged. The MINT confinement narrowing doesn't affect them.
- Limit 4 (bare BurnV1 of a second vault beside a redemption): unchanged by this diff (SEAL's pair exemption still whole-instruction — and the second BurnV1 is a CORE instruction, not burn_vault; SEAL's walk exempts only open/burn_vault instructions; a bare Core BurnV1 naming the Bank? The Bank's key wouldn't be in it. Unchanged).
- Limit 17 (EMISSION_MIN_PER_VAULT provisional): unchanged.
- Limit 18: does the code accidentally assume one? The level weights are hardcoded (2/3/4/5/6) — the randomness source for assignment is absent (fine, off-chain); no accidental assumption visible in this diff.

Verdict challenges: the author's verdict section is literally stale ("round 17's verdict is being written") — challenge that the round-19 prompt still ships round-17's verdict placeholder. Also challenge the self-audit's "settledAsPayout is the ONLY site asking the cadence question" — unverifiable from the diff; detectors.mjs's distribution_missed/unfinished arms read paid rows and may ask the same question with the old answer; demand the grep. Also the self-audit's four-defect list missed: the stale EXEMPTION comment (finding 1), the stale prompt sections (finding 2), the missing supersede test, the paging one-of-N-sites — i.e., the self-audit found four and there are at least four more of the same classes.

Also — one more thing I should check: **the R1 question "Are there other template-literal or escaping defects in this diff that reading the source cannot see? Render it, do not read it."** — I did render mentally. Findings: the stale diff header IS visible in the render (it's plain text in the template, no escaping needed — visible in source too, actually). Are there any TRUE escaping defects (where source looks right but render is wrong)? Let me scan once more for `\${` in audit19.ts where interpolation was INTENDED... The FLOORS paragraph: `${FLOORS.onchain}` unescaped ✓ renders 284 (my prompt confirms). `${FLOORS.detector}` → 403 ✓ (my prompt says 403). `${FLOORS.alloc}` → 63 ✓. `${FLOORS.mainnet}` → 19 ✓. `${DIFF}` ✓. `${FOCUS === ...}` ✓. Any OTHER `${` in the template that renders as literal unintentionally? Scanning my received prompt for stray "${": the R1 bullet has the intentional one. I don't see others. What about escaped backticks rendering wrong? My prompt shows `mint_vault` with backticks ✓. OK — no NEW escaping defects found; the render-check passes for interpolation. The defects I found in the prompt are stale PROSE, not escaping. I should say that clearly: I rendered what I could (the prompt I received IS the render) — interpolation is now correct; the residual defects are stale prose, which rendering ALSO reveals (the diff-header contradiction is visible in the render). Good.

Wait — one more escaping check in audit18.ts's prompt: it contains `\`judgeRedemptionTx\` knows only the open/burn pair` ✓. And in the R2 of audit18: "\`holdDays\` now asks \`paymentState(row) === 'paid'\`" ✓. Fine.

And — hmm, one more possible template defect: audit19.ts's `const K=(fs.readFileSync('/opt/gary-club/.env.local','utf8').match(/^OPENROUTER_API_KEY=(.*)$/m)||[])[1]` — if the env line has trailing \r (CRLF file), K includes \r → Authorization header with \r → fetch may reject or the key fails. Pre-existing shape (same in audit18). Eh — LOW nit, pre-existing, skip or one line.

Also `MODELS.join(',')).split(',')` — if a model id contained a comma (none do). Fine.

Now — one more look at **disqualify()** for a hole: `if(t.length<600) return 'report too short'` — a model returning a 600+ char EMPTY-ish report ("I found no issues, the code is correct." padded) counts as an auditor. The quorum counts READERS, not quality. A sycophantic 700-char "all clear" passes. That's the structural weakness of the receipt: it certifies delivery, not diligence. Worth one line in the final section (the runner can count readers; it cannot count reading). Actually that's a good line for the closing section.

And **MIN_AUDITORS default = ceil(8*0.75)=6** — round 18 had exactly 6 real → passed. If 3 of 8 fail, 5 < 6 → round fails ✓.

One more: **`land()` writes the report file BEFORE checking disqualification** — disqualified reports still land on disk with a marker in the manifest ✓ good (receipts preserved).

**RESULTS.push(o) inside land() under Promise.all** — single-threaded JS, no race ✓.

OK — now, let me reconsider whether there's anything CRITICAL-worthy I've missed. Let me re-scan the MINT diff hunk once more...

```rust
if is_mint {
    for (n, a) in ix.accounts.iter().enumerate() {
        require!(a.pubkey != bank || n == MINT_IX_BANK_IDX, MintError::BankKeyOutsideMint);
    }
} else {
    require!(!ix.accounts.iter().any(|a| a.pubkey == bank), MintError::BankKeyOutsideMint);
}
```

Wait — `bank` here is `cfg.bank` (let bank = cfg.bank). And the CURRENT instruction's bank account is pinned to cfg.bank by the struct constraint. For SIBLING mints, the Bank at their index 4 — but is the sibling's index-4 account actually ITS bank field? Yes if it's a well-formed mint (Anchor validates when it executes). But the confinement checks the sibling's accounts BEFORE the sibling executes — positionally. A sibling mint with the Bank at index 4 is allowed by the confinement; when the sibling executes, Anchor pins its bank field to cfg.bank ✓. So the Bank co-signs every sibling mint — which is the documented multi-mint case ✓.

Hmm — what about a sibling instruction to MINT with the mint discriminator but the Bank at index 4 where index 4 is NOT the bank field — i.e., a MALFORMED sibling that Anchor will reject when it executes? The confinement allows it (Bank at 4); the sibling then fails Anchor deserialization → whole tx reverts. Fail-closed ✓.

What about an instruction to MINT with data starting with the mint disc but the program is... `ix.program_id == crate::ID` ✓ pinned.

OK the fix is sound. What about **SEAL's walk** — unchanged this round except... the SEAL file in the bundle shows the round-17 state (confinement with pair exemption). No round-18 changes to SEAL. ✓.

**BURN** — unchanged. ✓.

Let me also double check the **error message change** doesn't break the `because()` assertions: `because('9d.1','BankKeyOutsideMint')` — the because check matches the error NAME presumably (program log "AnchorError ... Error Code: BankKeyOutsideMint" — the msg change doesn't affect the code) ✓. And 4.7/4.10 BankKeyOutsidePair ✓.

And the **selftest's bankErrs scrape**: `errNames` matches `#[msg("...")] Name,` — the NEW BankKeyOutsideMint msg contains... let me check the regex: `/#\[msg\("[^"]*"\)\]\s*(\w+),/g` — the new msg: "the Bank's key appears somewhere this instruction does not authorise: either outside the `bank` slot of a mint_vault, or in an instruction that is not a mint_vault at all. A Solana signature covers the whole transaction and the Bank does not sign for anything else" — contains NO double quotes ✓ (backticks, not quotes) — the regex `[^"]*` matches ✓. Good — if the msg had contained a `"` the scrape would break (fail-closed: name missing → bankErrs missing → the "looking at something real" assertion `bankErrs.sort() === ['BankKeyOutsideMint','BankKeyOutsidePair']` would go red ✓). OK.

Hmm — wait, actually: does the msg contain a `"`? Reading it: "...authorise: either outside the `bank` slot..." — backticks only ✓.

Now — the **`because('9d.4','BankKeyOutsideMint')`** and the rec: `rec('9d.4','the BANK named as PAYER of a mint — it would buy the vault','REJECT', pt.ok?'ALLOW':'REJECT', pt.err)` ✓.

One more test-integrity check on 9d.4: the signers [bank, a, alice] — a is the asset keypair (asset: Signer) ✓, alice is owner ✓, bank signs ✓. The payer slot (index 5) is bank with isSigner:true — the bank signature covers it ✓ serializes ✓ reaches the program ✓ rejected at the confinement ✓. 

And — the earlier hunks changed payer from bank to alice at ~170 (a test whose signers presumably already included alice — the hunk at 170 shows only the keys line changed, signers not shown → they already had alice? The hunk at 170: `-[...bank as payer...]+[...alice as payer...]` with no signer-list change shown → the signer list already included alice (it was `[bank, asset, alice]`?). Hmm — if the original test had payer=bank, the signers must have included bank (for the payer Signer) — after the change payer=alice needs alice in signers — if alice wasn't already there, serialization fails. The 5.2 case showed exactly this failure mode and was fixed. The other hunks (528, 1298, 1544) show signer lists in context: 528 `[bank,slipAsset,alice]` ✓ alice present; 1298 `[bank,Z.kp,alice]` ✓; 1544 context shows keys only but the surrounding has alice as owner (owner: Signer → alice must sign anyway) ✓. And 170: context doesn't show signers but owner=alice.publicKey at index 3 → alice signs as owner → payer=alice covered by the same signature ✓. So all sites fine — and the suite passing at 284 confirms. ✓.

Alright — I also want to double-check the **"9d.4 rejects for the RIGHT reason"**: `because('9d.4','BankKeyOutsideMint')` — the because() mechanism presumably checks pt.err contains the code. The confinement fires BEFORE the price transfer — wait, actually where in the handler is the confinement? After the bank pin (require_keys_eq bank == cfg.bank) — the bank slot (index 4) IS the real bank ✓ passes the pin — then the walk → index 5 is bank → BankKeyOutsideMint ✓. But hold on — could an EARLIER check fire first? name/uri/attrs ✓ pass; paused? The test's config — paused false presumably ✓; round open? The test mints at LAMPORTS_PER_SOL price with a live round (other mints in the suite work) ✓. So the first failure is the confinement ✓. But actually — hmm, wait: the walk checks instruction 0 = itself. is_mint ✓ → enumerate: index 4 = bank ✓ allowed; index 5 = bank ✗ → require fails ✓ BankKeyOutsideMint ✓. 

Now let me think about **what else the self-audit missed** per R7 — the "applied to all sites of its own shape" sweep, systematically:

Fix → sites of its shape:
1. Positional confinement (MINT) → SEAL/BURN pair exemption: NOT applied (accepted limit 3, analyzed not-worse). Documented.
2. Canonical base64 round trip (bank-sign.sh) → other base64 decoders in the repo? cosign.mjs decodes the tx with Buffer.from — the round trip is enforced upstream in the wrapper; cosign itself (if invoked directly, e.g., by a future tool) has no canonical check. Known limit 1a-adjacent (other tools get neither check). Not new.
3. realDay (holdDays) → other day-key readers (detectors.mjs detectDistribution iterates days; dayDiff callers) — UNVERIFIED, flag.
4. Object.hasOwn/null-proto (census/denominator) → other key lookups: `st.days[day]` (computed key ✓), LEVEL_WEIGHTS (fixed r17), plan.per (fromEntries ✓). What about `Object.keys(st?.days || {})` in holdDays — keys of a JSON-parsed object ✓ fine. OK.
5. Supersede both flags (distribute) → reverse ordering uncovered; no test.
6. Refusal paging (distribute) → throw-halt paths unpaged; SOL-floor path already paged. One-of-N.
7. isTableRow hoist (selftest) → other row-scraping sites in selftest — unverifiable from diff; the diff shows tableRows + tableLines converted; if C5's `rows` comes from tableRows ✓. Any OTHER place filtering table lines? The diff's C5 context shows `rows.filter(...)` — rows from tableRows ✓. Probably complete, but the claim needs the grep.
8. codeOnly (selftest) → other source-scraping arms that could be fooled by comments — e.g., the C4b struct parser reads mintSrc RAW (comments could fool IT: a comment line `// pub fake: Signer` inside the struct body would be parsed as a FIELD by `/^\s*pub (\w+):/gm` — matchAll on the body INCLUDING comments! A doc comment on a field like `/// pub thing: ...` — starts with `/` so `^\s*pub` doesn't match `/// pub`... wait: `^\s*pub` — the line `    /// pub x: Signer` starts with spaces then `/` — `\s*` matches spaces, then needs `pub` but finds `/` → no match ✓. But a comment line like `// pub x: y` — starts with `//` → no match ✓. What about a comment that starts with `pub`? `pub // comment`? A line `    pub owner: Signer<'info>, // the owner` — matches owner ✓ (comment is trailing, after the capture). A line inside a doc comment written as `///    pub fake: X` — starts with `/` → no match. So the struct parser is comment-safe EXCEPT for a line that begins (after whitespace) with `pub` inside... you can't have a raw `pub` line inside a comment unless the comment is a block comment `/* pub fake: X */` on its own line starting with... `/*` → no match. OK the struct parser is safe from comments. ✓. But the DISCRIMINATOR scrape `mintSrc.match(/const MINT_IX_BANK_IDX: usize = (\d+);/)` — a comment `// const MINT_IX_BANK_IDX: usize = 9;` would match FIRST? .match finds the FIRST occurrence — if a comment above the real const quoted it with a different number... the real const has a doc comment above it that doesn't quote the declaration ✓ currently. Fragile but currently sound; a comment quoting the declaration with a wrong number would silently pin the wrong index — wait, would it? match takes the first `const MINT_IX_BANK_IDX: usize = N;` in the file — a comment line `// const MINT_IX_BANK_IDX: usize = 9;` contains that substring → match finds it → declaredBankIdx=9 → the assertion indexOf('bank')===9 fails → RED (fail-closed) ✓. Unless the comment's number coincided... fine, fails closed. OK.
9. The floors-read-from-file (audit scripts) → run-tests.sh still holds duplicate copies (noted).
10. The manifest un-trim (audit19) → audit18 has the same fix? audit18.ts in the diff shows the SAME manifest code with the NOT-.trim() comment ✓ both fixed. ✓ (both files show identical dirty code — yes, audit18.ts has it too).

Good sweep. The strongest R7 items: realDay one-of-N (detectors), paging one-of-N (throws), supersede untested + reverse ordering, and the stale EXEMPTION comment (the self-audit read the new comment block and missed the old one two screens up — literally the one-of-N-sites defect in prose form).

Now — the **"anything else"** bucket:
- The `catch {}` on NOTIFY (covered).
- The `process.exitCode = 1` under --dry-run: I'll defend it (a rehearsal that refuses should fail the rehearsal) but note the asymmetry: under DRY the refusal doesn't page but does exit 1 — a cron-installed dry run (none exists) would trip monitoring. Fine as-is.
- The distribute FLOOR comment says "for the sixth round running" — prose, fine.
- One more: **the new selftest arm "…and the real, untampered exec line is still there to be caught (both ways)"** — asserts the strict regex matches codeOnly(signSh) — this pins the exec line's exact shape including `${LIVE[@]+"${LIVE[@]}"}`. If the exec line legitimately changes (e.g., adding a flag), the arm goes red — fail-closed brittleness ✓ intended.
- **The `mintVaultFields` regex and `#[derive(Accounts)]`** — the struct in source is `pub struct MintVault<'info> {` ✓ matched.
- **`fsx`** — the selftest uses `fsx.readFileSync` — presumably a wrapper (fs-extra?) defined earlier in the file. Fine.

Let me also reconsider the **R4 header truthfulness** once more with what I CAN see: the echo block says "distribute is LIVE FROM THE NEXT 09:07... revenue is the only job this script leaves dormant." — "the only job this script leaves dormant" — if the crontab installs, say, FOUR jobs (distribute, revenue, reconcile, alarm) — alarm and reconcile aren't "dormant" (they run) — the sentence means "the only money job left dormant" — reads fine. But is 09:07 the distribute time? The header says "from the next 09:07" — and the original header said jobs "sit on odd minutes, off the */5, */10 and */30 ticks" — 09:07 is an odd minute ✓ consistent. Can't verify the actual line. State the limitation.

Hmm — one more R4 angle: the header says "revenue.mjs opt-IN. Gated by `--live`; installed WITHOUT it, so the trusted hop does not start running unattended. Safe." — is revenue-without-live actually inert? If revenue.mjs --dry (or no flag) still SWEEPS but doesn't swap... no — the flag gates the sweep presumably. Can't verify (revenue.mjs not in bundle for programs focus; it IS in... no — the offchain bundle has distribute, cosign, bank-sign, cron-install — NOT revenue.mjs!). So neither bundle includes revenue.mjs, and the header's "Safe" claim about revenue-without-live is UNVERIFIABLE from either focus bundle. That's a bundle gap: the money claim about revenue.mjs's gating can't be checked by any round-19 auditor. Worth a line: the round asks "Is the new header true, completely?" while the bundle omits revenue.mjs — the one file needed to answer. MEDIUM-LOW. Actually that's a nice catch — the prompt demands verification the bundle cannot support. I'll file it LOW-MEDIUM (bundle completeness).

Similarly R3 asks about bank-sign.sh — bank-sign.sh IS in the offchain bundle ✓ and in the diff ✓. R5's selftest.mjs — is selftest.mjs in either bundle? Programs bundle: SEAL, MINT, BURN lib.rs. Offchain bundle: distribute, cosign, bank-sign, cron-install. **bank/selftest.mjs is in NEITHER bundle** — yet R5 asks five detailed questions about arms in selftest.mjs! The auditors get the DIFF (which contains the selftest hunks ✓) but not the surrounding file — e.g., "Is isTableRow a sound definition... is one definition now genuinely used everywhere" requires the WHOLE file. The diff-only view can't answer "everywhere." Same for detectors.mjs (not in any bundle, referenced by R5's arms and R2's paymentState question). So round 19 structurally cannot answer its own R5/R7 questions completely. That's a real bundle-design defect: the questions outrun the evidence shipped. MEDIUM. Evidence: list the four files per focus vs the questions asked. This is the kind of structural finding the closing section wants too.

OK — I think I have a comprehensive picture. Let me also prepare the **arithmetic section** properly:

- 108·2+60·3+36·4+24·5+12·6 = 216+180+144+120+72 = 732 ✓
- 945·2+525·3+315·4+210·5+105·6 = 1890+1575+1260+1050+630 = 6405 ✓
- Counts: 240 ✓ / 2100 ✓; ratios 9:5:3:2:1 both ✓ (so the level shares are scale-invariant: I=29.508%, II=24.590%, III=19.672%, IV=16.393%, V=9.836%; sum exactly 100.000% since 732·(9·2+5·3+3·4+2·5+1·6)/... let me verify: shares = 216/732, 180/732, 144/732, 120/732, 72/732 — sum = 732/732 = 1 exactly ✓. So "five shares summing to 100.0%" is exact by construction ✓.)
- Per-$1,000 (240 census): I $2.732, II $4.098, III $5.464, IV $6.831, V $8.197 (per vault: 1000·w/732). Sum check: 108·2.732+60·4.098+36·5.464+24·6.831+12·8.197 ≈ 295.1+245.9+196.7+163.9+98.4 = 1000.0 ✓.
- Per-$1,000 (2100 census): I $0.312, II $0.468, III $0.625, IV $0.781, V $0.937 (1000·w/6405). ✓
- The ten figures = these two sets of five. If the card shows anything else, it's wrong. I'll present these as the re-derived values with the note that the card itself isn't in my bundle.

Floors: DET_FLOOR 403 = selftest FLOOR 403 ✓ (+8 arms, counted); ALLOC_FLOOR 63 = distribute FLOOR 63 ✓ (+9 assertions, counted); MAINNET_FLOOR 19 (context, unchanged) ✓; MIN_ASSERTIONS 284 — not in the diff; note the 9d.4 addition implies either pre-existing slack or a bump outside the shown hunk; one command to check (`grep MIN_ASSERTIONS scripts/run-tests.sh` and count rec() calls).

Wait, I should double-check my count of +8 for selftest once more, carefully, from the diff:

selftest.mjs diff hunks:
Hunk 1 (@@ -327,6 +327,21 @@): adds two t() calls:
- 'a half-finished day raises the alarm...'
- '...and a STALE nothingToDo would silence it — which is why the writer clears it'
(+2)

Hunk 2 (@@ -965,8 +980,46 @@): 
- modifies the pass-through arm (1→1, net 0)
- adds '...and the real, untampered exec line is still there to be caught (both ways)' (+1)
- adds the C4b block: 'MINT_IX_BANK_IDX is the REAL position...' (+1), '...and payer — the slot the round-18 theft used — is a DIFFERENT index' (+1), '...and the parser read a real struct, not an empty match' (+1), '...and a reordering that moves bank off that index is CAUGHT' (+1)
(+5)

Hunk 3 (@@ -1003,8 +1056,14 @@):
- modifies the BankKeyOutside arm (1→1, net 0)
- modifies '...and it would catch a refusal the table forgot' (1→1, net 0)
- adds '...and a name that lives ONLY in prose no longer counts as a table row' (+1)
(+1)

Hunk 4 (@@ -1044,11 +1103,31 @@): the errNames context — no new t() visible in this hunk? The hunk shows the bankErrs lines and the tableLines/tableSrc additions — the t() calls modified but count unchanged. (0)

Hunk 5 (@@ -1644,7 +1723,7 @@): FLOOR 395→403.

Total new: 2+5+1 = 8 ✓. 395+8 = 403 ✓. 

And distribute.mjs: +9 (1 dust + 2 date + 6 settledAsPayout) — wait let me recount from the diff:
- Hunk A (@@ -683,8 +790,26 @@): removes 1 ('dust never exceeds the denominator'), adds 2 ('under ONE SAT PER PAID VAULT', 'tighter bound holds across a full 2,100-vault census') → +1
- Hunk B (@@ -740,8 +865,15 @@): removes 1 ('does not produce a confident wrong answer'), adds 1 ('is REFUSED, not rolled over') + 2 ('every real date still round-trips', 'while the impossible ones do not') → +2
- Hunk C (@@ -758,13 +890,33 @@): adds 6 settledAsPayout/holdDays arms → +6
Total +9 ✓. 54+9=63 ✓. 

Both floors verified against the diff. And run-tests.sh DET_FLOOR/ALLOC_FLOOR match ✓.

Now — the **closing section** ("what should this project do that sixteen rounds of AI audit structurally cannot"). Concrete, not repeating SPEC's SHIP GATE (which I haven't read, but likely includes: bug bounty, monitoring, pause authority, upgrade delay, roster rotation, floors, manifests). My candidates, most concrete:

1. **Mutation-test the gates themselves.** Build a harness that applies a curated list of single-line mutations to the source (reorder MintVault's accounts; change MINT_IX_BANK_IDX to 5; delete one `delete st.days[day].nothingToDo`; set FLOOR back to 54; re-widen the mint exemption; make realDay return true always; change a test's expected value to the wrong answer à la 173), rebuilds, and requires the FULL suite to go red on every mutation. Any mutation that survives = a gate that certifies a bug. This is executable, mechanical, and directly measures the only thing this process claims: that the gates detect. Sixteen rounds of reading cannot produce a mutation score; one script can. The 173-assertion defect (a test pinning the wrong answer) is precisely a surviving mutation of the code that the suite blessed.

2. **Property-based ledger fuzzing for distribute.mjs.** Extract the pure core (allocateWeighted, holdDays, settledAsPayout, paymentState, the supersede decision) and run a generator over hostile ledger states — every ordering from R1 (quiet→pay, refuse→pay, pay→crash→resume, pay→refuse, two-runs, dry-run-interleaved), prototype-poisoned keys, impossible dates, half-paid days — asserting invariants: no resolved row re-sent, dust < activated, alarm fires iff unfinished, no flag lost that a reader needs. The orderings questions this round asks by hand are decidable by a fuzzer in minutes and stay decided after every future edit.

3. **Runtime on-chain watcher with its own key and its own code path**: index every confirmed transaction that names the Bank pubkey or the four program ids; alert on (a) the Bank's signature appearing in any transaction whose money flows fall outside the sanctioned shapes, (b) any config-field drift, (c) distribution days that end with unpaid activated vaults. All of this is public data; none of it requires trusting the payer's ledger (breaks limit 11's trust). AI audit is a pre-deployment artifact; the unknown-unknowns after deployment can only be caught by something that watches post-deployment. Fund it with a small dedicated wallet and give it a page path independent of alarm.mjs.

4. **Blast-radius architecture: make the distributor key worth one day.** The off-chain hop's key is the largest single-key exposure in the system. Operationally cap it: fund the distributor wallet each morning with only that day's ceiling (EMISSION_MIN_PER_VAULT × vaults + margin), sweep the remainder back nightly. Then a fully compromised distributor key costs one day's payout, whatever any audit missed. No amount of reading achieves this; treasury plumbing does. (Similarly: the Bank key's SOL float — keep it at co-signing fees + buffer, not the treasury.)

5. **Render-and-read ritual for the owner**: the two worst defects of the last two rounds (the ${FLOORS} literal, the table under-claim) were both caught by a human READING a rendered artifact, not source. Institutionalize it: every round ends with the owner reading three rendered outputs — the rendered prompt, the control table, and the customer card — with a two-question checklist per item ("does this understate anything the code enforces? does anything here contradict something else in this document?"). 30 minutes. The under-claim direction is structurally invisible to every gate in the repo; the owner's eyes are the only instrument that has ever caught it.

6. Maybe: **a standing adversarial "second builder"**: have a DIFFERENT model (not on the audit roster) independently re-implement one critical pure function (allocateWeighted, holdDays) from the spec prose alone, then differential-test the two implementations over the fuzz corpus. Divergence = either the prose or the code is wrong. This catches spec-code drift in both directions — the under-claim direction included — without anyone reading anything.

I'll pick 4-5 of these, concretely.

Also — the prompt asks me to end with that section, and to order findings R1-R6, carry-over, verdict challenges, anything else. Let me now also decide the final severity list:

**HIGH:**
- H1 (R7/under-claim): MINT's surviving "EXEMPTION: only a mint_vault to THIS program" comment describes the round-17 wide exemption that this very diff narrowed after measuring a theft through it; the file now carries two contradictory descriptions and the false one is the more readable one. Confirmed in the bundle text.
- H2 (R1): audit19.ts's rendered prompt misdescribes its own subject: diff header says "2c8cd9b..HEAD — every repair round 17 made" while the embedded diff is ec7d17e..HEAD; the verdict section still says "ROUND 15 / round 17's verdict is being written"; known-limit 12 says "see R1" but R1 is about template literals. The certification instrument ships stale prose to all eight auditors. Confirmed in the render (my own prompt).

Hmm — is H2 really HIGH? Let me think about impact: an auditor reading "every repair round 17 made" might mis-scope. But the R1-R7 bullets are correct and detailed. The defect is real and of the repo's signature class, in the newest code, missed by a self-audit that was specifically hunting this class. I'll keep HIGH but acknowledge the mitigations. Actually — you know, let me reconsider. The project's severity ladder: CRITICAL = money loss; HIGH = ...? Their history: "five live documents denying a control" was a round's second-worst finding (so HIGH-ish). A prompt mislabeling its diff is comparable class, smaller blast. I'll make H2 HIGH and H1 HIGH, and be explicit that neither moves money directly — calibration honesty.

**MEDIUM:**
- M1 (R7): The supersede fix is untested and one-directional; payment→refuse same-day leaves a false "refused and paid nobody" flag on a day that paid (mirror of the defect the fix addressed); no assertion anywhere covers the writer side.
- M2 (R7): Paging fix is one-of-N-sites: refusal pages, SOL-floor pages, but the throw-halts (bad ledger day key, non-finite dayDiff) page nobody, and the page itself is fire-and-forget (catch {}) with no receipt — a failing NOTIFY is indistinguishable from a delivered one.
- M3 (carry-over 12): Compute units got worse: the MINT walk adds a per-instruction sysvar parse to every mint_vault, O(N) per handler and O(N²) across a multi-mint transaction, on the busiest instruction, unmeasured; the 831/975/1119 figures bound PACKET bytes, not CU. Measurement demand included.
- M4 (R1/R5): isTableRow defines "a line shaped like a control row," not "a row of THE control table" — no anchor to the table's section/header; a second table in SPEC using the same tags would silently widen the "table." Plus the unverifiable "used everywhere" claim (grep demand).
- M5 (R1): audit18.ts's roster comment contradicts its own roster on three particulars (qwen "dropped" but present; "deepseek-v4-pro" vs deepseek-v4-flash-0731; "gemini-3.1-pro comes in" but absent), and the same stale comment is copied into audit19.ts beside a note that contradicts it. The prose record of who audited round 18 is wrong; the manifest is the only accurate record.
- M6 (bundle): Round 19's questions outrun its evidence: R5 asks five questions about bank/selftest.mjs and R2/R7 about detectors.mjs, but neither file is in either focus bundle (only diff hunks); R4's "read the crontab lines" cannot be done from the diff (cron lines not in it), and revenue.mjs — needed to verify "dormant until --live" — is in no bundle at all. The round cannot answer its own questions.
- M7 (under-claim, conditional): No SPEC.md changes are visible in the diff while the diff strengthens at least four controls (positional confinement, refusal paging, supersede logic, canonical base64); the diff filter (`-- programs bank scripts tests`) excludes SPEC.md, so the control table's descriptions cannot be verified against the new behavior by any round-19 auditor; the naming gate checks names only. One command resolves it: `git diff ec7d17e..HEAD -- SPEC.md`.

**LOW:**
- L1 (R3): `base64 -w0` is GNU-specific; on BSD/macOS or minimal BusyBox the canonical check rejects EVERY transaction (fail-closed outage of the one sanctioned signing path). Also the empty string passes all checks including the round trip (downstream must refuse).
- L2 (R5): The MintVault struct regex terminates at the first line-initial `}` — premature termination fails RED via the slice(0,6) canary (good), but the payer assertion is vacuously true when payer isn't parsed (indexOf −1 ≠ 4); the canary is the only thing holding it shut.
- L3 (R5): codeOnly strips any line starting with `#` — a `#` inside a heredoc body or multi-line string is data, not a comment; currently harmless and fails closed, but the gate is one heredoc away from blindness.
- L4 (R6): The floors are now duplicated (run-tests.sh DET_FLOOR/ALLOC_FLOOR vs in-file FLOORs) — the prompt reads one copy, the files enforce another; a number in two places is a number that drifts (their own rule). MIN_ASSERTIONS not visibly bumped for the new 9d.4 assertion — check for slack.
- L5 (R1): The manifest is well-formed (verified: untrimmed porcelain, split/filter, per-pass head) — remaining gap: nothing compares MANIFEST-programs.head with MANIFEST-offchain.head, which is exactly how round 18's two-pass drift happened; one diff of two JSON fields closes it.
- L6 (R7): audit18.ts lacks verifyRoster (the fix landed only in audit19.ts) — re-running the round-18 script today can still silently run short.
- L7: The moved-name arm couples to BankKeyOutsideMint appearing in SPEC prose; cleaning that prose turns the test red for no gate defect (brittle, fail-closed).
- L8: The BankKeyOutsideMint message's third emit site (seen_self failure) is still not described by the message text ("the Bank's key appears somewhere…" — in the walk-stopped case it may appear nowhere); the comment claims three sites covered, the message covers two.

Also the R2 direction verification (settledAsPayout) — I'll report VERIFIED with the trace, including the subtlety that recognizing an annotated hand-pay DELAYS the next forced payout (correct semantics) while the bare-resolvedBy default hastens it — the builder's direction claim is right, and I'll show the arithmetic (Jul 1 → Aug 22 = 52 ✓, hand-paid Aug 20 → 2 ✓).

And R2 census serialization — verified sound (spread returns normal-proto; JSON round-trips; hasOwn guards).

And R2 dust — re-derived, bound holds always (Σ frac < N_allocated ≤ N_activated; frac ∈ [0,1) unconditionally), with the per-vault-floor-division assumption stated.

And R3 — no accepted-but-different input found in the constrained space; the round trip forces canonical form and Node agrees with coreutils on canonical form; residuals: -w0 platform, empty string, and the structural point that the validator (coreutils) and the consumer (Node) are different parsers whose agreement is assumed, not enforced.

And R4 — header honest for the two named jobs as far as visible; cannot enumerate the crontab from the diff; revenue.mjs unverifiable; the "09:07" and "only dormant job" claims need the file.

And R5's two nothingToDo arms — they prove the detector-side suppression (single-variable design ✓) but prove nothing about the writer-side clearing, which is the actual fix and has no test (M1).

And R6 — floors verified (+8/+9 counted); arithmetic verified (732, 6405, shares exact by construction, per-$1,000 tables derived); the card itself not in bundle.

Carry-over verdicts:
- 3: NOT worse (payer in the pair is inert in SEAL; in BURN the payer at most RECEIVES the asset-account rent refund; the 5M lamports in the asset-signer PDA are untouched by BurnV1 — measured fact 4). The MINT fix did not extend here and didn't need to for theft; the residual is the documented one.
- 12: WORSE (M3).
- 11: marginally wider surface — the supersede logic now rewrites verdict flags in the payer-written ledger (with supersededAt/supersededWas receipts); same trust model, note it.
- 16/17: the refusal-paging change makes the unlevelled-vault grief LOUDER (daily page) but not more exploitable; paging bounded by cron cadence — one page per run, no amplification. The griefing→paging question answered: correct as built.
- 1a/1b/2/4/5/6/7/8/9/10/13/14/15/18: unchanged by this diff; 18's "code accidentally assumed one" — no new assumption visible (weights hardcoded as designed; no randomness/upgrade-ladder assumptions added).

Verdict challenges:
- The verdict section in the round-19 prompt is literally round 17's placeholder — the round asks auditors to attack a verdict that isn't there (H2).
- The self-audit's "settledAsPayout is the ONLY site asking the cadence question" — unverifiable from the shipped evidence; detectors.mjs's distribution_missed/unfinished arms read paid rows and are the obvious second site; demand the grep (`grep -n "paymentState\|sig" bank/detectors.mjs`).
- The self-audit's four defects were all in the newest code; the same sweep missed at least four more of the same classes in the same files (H1, H2, M1, M2) — the self-audit's stopping point was premature, which is the expected property of a source auditing itself.

One more consideration — am I missing anything on the **"render it, do not read it"** instruction? The one thing rendering reveals that reading can't: I received the RENDER (this prompt). Defects visible in the render: (a) the diff-header contradiction, (b) the stale verdict section, (c) the dangling "see R1", (d) interpolation working (284/403/63/19 all rendered as numbers). Also — hmm, let me look for one more: in the render, "THE DIFF UNDER AUDIT (2c8cd9b..HEAD)" — and the R1 bullet says "The complete diff ec7d17e..HEAD is at the end" — both in my prompt ✓ contradiction confirmed. Also the bundle note says "Everything omitted has been in at least one prompt across rounds 1-17" — for round 19, "omitted" now includes selftest.mjs and detectors.mjs which R5 needs — covered in M6.

Also — one more render-check: does my prompt contain any OTHER literal `${`? Searching my memory of the prompt text... "  - ${FLOORS.onchain} HAD SHIPPED AS LITERAL TEXT" — that's the only one, and it's intentional. ✓.

Now — one thing I want to double-check before writing: the claim in H1 that the old EXEMPTION comment is still present. Let me re-read the MINT lib.rs from the bundle... In mint_vault, after the CRITICAL comment block:

```
        // ---- CONFINE THE BANK'S KEY TO THIS INSTRUCTION ----
        //
        // ⚠️ ROUND 17, CRITICAL, ... [long block] ...
        //
        // EXEMPTION: only a `mint_vault` to THIS program. Several mints may share a
        // transaction and each names the Bank exactly as this one does. The FEE
        // PAYER is still invisible here — it appears in no instruction's account
        // list — and stays a policy matter; see SPEC's control table.
        {
            let sysvar = ...
```

Yes — the "EXEMPTION: only a mint_vault to THIS program" paragraph is immediately above the walk, and the walk's `if is_mint` branch contains the new "The Bank's key may appear in a mint ONLY in the `bank` slot" comment. So the file says, ten lines apart: "EXEMPTION: only a mint_vault to THIS program" (round 17, now false as a description of the exemption's breadth — a mint_vault is NOT wholly exempt) and "The Bank's key may appear in a mint ONLY in the bank slot" (round 18, true). The round-17 sentence, read as the definition of what's exempt, says any mint_vault instruction is waved through — the exact behavior that let the Bank buy a stranger a vault. CONFIRMED. This is my strongest finding. Is it HIGH or MEDIUM? It's a comment. But: (a) it's the repo's own top defect class, (b) it misdescribes a money control in the direction of claiming LESS protection than exists (under-claim) AND permitting more than is permitted (an operator reading it would think Bank-as-payer is fine), (c) the self-audit explicitly swept for this class and missed it. Given their calibration (round 17's second-worst finding was five stale comments), HIGH.

Hmm — one could argue the round-17 comment is still literally true: "EXEMPTION: only a mint_vault to THIS program" — i.e., the set of exempt instructions = {mint_vaults to this program}. That IS literally what the code does (is_mint → different check; not is_mint → ban). The exemption from the ANY-ACCOUNT BAN is granted only to mint_vaults... and then within mint_vaults there's a positional check. So the sentence is technically true but incomplete — it describes the exemption without the positional narrowing, and a reader would reasonably conclude a mint_vault is fully exempt. The adjacent round-18 comment supplies the missing half. So: not FALSE, but UNDER-COMPLETE in the direction of understating the guarantee — which is precisely the owner's shape (the table said "PROCEDURE" about a control that was on-chain). I'll present it exactly that way: literally true, materially incomplete, and the incompleteness is the under-claim direction. Still HIGH in their economy? The owner's worst-defect was this exact shape. Yes, HIGH — with the honest framing.

Let me also double check H2's "see R1" claim: my prompt's known-limits item 12: "COMPUTE UNITS are unmeasured anywhere. **This one got worse this round — see R1.**" — and R1 in my prompt is "THE SELF-AUDIT'S OWN REPAIRS" (template literals, isTableRow, refused/nothingToDo, manifest). No compute units in R1. ✓ dangling. (In audit18's prompt, R1 was the mint confinement — where a CU note would belong. Copied forward.) ✓.

And one more possible finding — **the audit19 roster comment says "NONE OF THESE EIGHT WAS USED IN ROUND 18... the other seven last read it at round 17"** — seven of eight last read at round 17, one (claude-fable-5) never. But the copied comment above says "SAME ROSTER AS ROUND 16... this one repeats round 16's" — if it repeats round 16's roster and seven of eight last read at round 17, then rounds 16 and 17 shared the roster (consistent with the ship gate's two-clean-rounds rule). OK so the copied comment's headline ("SAME ROSTER AS ROUND 16") might actually be TRUE for round 19 — the falsehood is in audit18.ts's copy (round 18's roster was NOT round 16's). Let me re-verify: audit18.ts says "SAME ROSTER AS ROUND 16... this one repeats round 16's; round 18 must differ." If round 18's roster were round 16's, then round 19's roster (different from round 18's) would NOT be round 16's — but audit19's copied comment says round 19 repeats round 16's. Both can't be true. And audit19's own note says round 18 used [grok-4.20, sonnet-5, sol-pro, 5.5-pro, deepseek-flash, qwen3-max, mistral, command-a] — if THAT was "round 16's roster" per audit18's claim, then round 19's roster (opus, fable, luna, terra, gemini, kimi, glm, grok-4.6) is NOT round 16's — contradicting audit19's copied "SAME ROSTER AS ROUND 16." Alternatively audit18's claim is false (round 18's roster was NOT round 16's) and audit19's is true. Either way, ONE of the two files' roster comments is false, and both files' "qwen dropped / deepseek-v4-pro / gemini-3.1-pro come in" particulars contradict audit18's actual roster (qwen3-max present, deepseek-v4-flash-0731, no gemini). So: audit18.ts's roster note is internally contradictory on at least three particulars regardless of round 16's actual roster. Solid. M5 stands.

Alright — also, should I mention the **`--features localnet` binary gap** or anything about the shipped-vs-tested binary? Unchanged this round. Skip.

One more scan of the diff for anything unexamined... 

- `scripts/run-tests.sh` floor comment "The numbers move with the suites." ✓.
- `tests/3prog.test.ts` hunk at 1544: the mintTheft helper — payer changed to alice ✓ and the signers for that path (context shows `[bank, a, alice]`? The hunk at 1544 shows keys only; the mintTheft function's send signers — line 1561 context shows `])],[bank,brickAsset,alice]))` for the BRICK test... the 1544 hunk (THEFT) shows the keys change; signers presumably already included alice (owner). The suite passes → fine.
- The 9d.4 comment "because('5.2','AccountNotSigner') check is the only reason it surfaced" — fine.

OK. One more deep think on whether the **supersede logic can lose a flag a day NEEDED**: the flags' readers: (a) detectDistribution's nothingToDo suppresses distribution_unfinished; (b) refused → distribution_refused HIGH. After superseding: both deleted, supersededWas records ONE of them (the || picks refused if both). Scenario where a day NEEDS a flag after clearing: the afternoon plan proceeds but pays only PART and crashes → no finishedAt → unfinished alarm fires (needs NO flag — correct, alarm fires). Scenario: afternoon plan proceeds, pays all, finishedAt set → day complete, no flags needed ✓. Scenario: afternoon plan proceeds but decideEmission... wait, if plan.skip is set the clearing doesn't happen. So clearing only on a proceeding plan. The one flag-loss scenario: BOTH refused and nothingToDo set (morning refused, midday quiet-run overwrote/added nothingToDo?) — supersededWas keeps only `refused`'s value; the nothingToDo reason is lost from the record (though its existence is implied). Cosmetic. And: morning quiet (nothingToDo), afternoon REFUSES — the refusal path writes refused (does it DELETE nothingToDo? Not shown!). So the day ends with BOTH nothingToDo (stale, from morning) AND refused (current). The detector: nothingToDo suppresses distribution_unfinished — the day refused, paid nobody, finishedAt... does the refusal path set finishedAt? The visible code: `if (plan.refusal) st.days[day].refused = plan.skip; st.days[day].finishedAt = ...; save(st)` — appears the skip path also sets finishedAt. If finishedAt is set, unfinished doesn't fire regardless. And distribution_refused fires ✓ correct. The stale nothingToDo is harmless there. OK — no flag-loss scenario with teeth. M1 stays focused on the untested writer + the reverse ordering.

Hmm, wait — actually one more: **the reverse ordering (pay→refuse) — does the refusal path OVERWRITE the day's plan?** If the afternoon refusal writes `refused` on a day whose morning paid everybody, and the detector's distribution_refused arm checks `refused` WITHOUT checking paid rows — false "paid nobody" HIGH. But would a second run on a paid day even produce a plan? If the morning paid all activated vaults, the afternoon run's plan would have... the same activated vaults, already paid → paymentState resolved → skipped → maybe nothingToDo ("holding: already paid")? Or does the rerun re-plan and refuse on a NEW unlevelled vault activated at noon? The new vault is activated (funded) but unlevelled → allocateWeighted refuses → plan.refusal → writes refused on a day that PAID. Detector: distribution_refused fires "REFUSED and paid nobody" — FALSE (the day paid). This is exactly the mirror the fix didn't cover. Realistic? A stranger funds an unlevelled vault at 10:00; the operator reruns at 14:00 for some reason (or cron retries?) — cron runs once daily; a manual rerun is plausible. The false HIGH pages (refusal pages now!) — "CBOB DISTRIBUTION REFUSED and paid nobody" while the ledger shows paid rows with signatures. An operator paged with a false "paid nobody" on a day that paid — confusing but fail-loud, not fail-silent. MEDIUM-LOW. I'll fold into M1.

Also — hmm, one more thought on the refusal paging under griefing: the attacker funds an unlevelled vault → every daily run refuses → pages EVERY DAY until the operator assigns a level or the vault is dealt with. Persistent daily paging = alarm fatigue → the operator mutes NOTIFY → a REAL refusal someday goes unseen. That's the griefing→paging cost: not amplification, but fatigue. Worth one line in M2 or the R2 answer: the paging is correct per-event; the fatigue risk is operational; mitigation = page with the vault's pubkey so the operator can act once (assign level or ignore), and rate-limit identical refusal messages. I'll include that.

Now let me also make sure I answer **"Is the corrected comment now true?"** (bank-sign.sh ps comment) — YES, verified: the exec line passes "$TX" as argv to cosign.mjs, so the base64 IS in ps for the cosign process's lifetime; the comment now says exactly that and correctly scopes the old claims (not in THIS script's argv/history). One residual nit: the comment says "not in THIS command's shell history" — shell history captures typed commands; the tx never was one ✓ true.

And **"Does it reject anything LEGITIMATE?"** — a 1644-char canonical tx passes ✓ (no padding, pure alphabet). A tx whose base64 has standard padding passes ✓. Legitimate rejections: none found beyond the platform case (L1). State that.

Alright — I also want to give the **evidence** for each finding as the prompt demands ("the evidence that would exist if you are right"). Let me make sure each finding has a checkable evidence path:

- H1: the bundle's own MINT lib.rs contains both paragraphs — evidence is the file text itself (quote both). Check: `grep -n "EXEMPTION: only a" programs/cbob-vault-mint/src/lib.rs` returns a line above the walk whose description omits the positional narrowing.
- H2: the rendered round-19 prompt (this document) contains "THE DIFF UNDER AUDIT (2c8cd9b..HEAD) — every repair round 17 made" while R1 says ec7d17e..HEAD; and "THE AUTHOR'S OWN VERDICT ON ROUND 15" with "(round 17's verdict is being written...)"; and known-limit 12's "see R1" pointing at a template-literal section. Check: render audit19.ts's PROMPT (node -e print) and grep for "2c8cd9b" and "ROUND 15".
- M1: no t() in the diff invokes the supersede path; grep the suite for 'superseded' — zero hits. And the reverse ordering: simulate pay-then-refuse in a ledger fixture and run detectDistribution — distribution_refused fires on a day with paid rows.
- M2: run distribute with a ledger containing '2026-02-30' — observe no NOTIFY invocation (only a stack trace / nonzero exit); and set NOTIFY=/nonexistent with a real refusal — observe no record of the page failure.
- M3: build a K-mint transaction (K=1,2,5,10,20), send to the local validator, read `compute units consumed` from the tx meta; plot vs K; compare against the 200k default and whatever the suite sets. Evidence if I'm right: consumed CU grows superlinearly and crosses the budget at some K the charter round might use.
- M4: add a second markdown table to SPEC.md using **PROCEDURE.** in the fourth column with a BankKeyOutside name in prose — the naming gate stays green (the name counts from the wrong table). Check: the gate's tableLines includes any line matching the shape anywhere in the file.
- M5: read audit18.ts's MODELS array beside its comment — qwen3-max present under "qwen... dropped"; no gemini under "gemini-3.1-pro come in"; deepseek-v4-flash-0731 under "deepseek-v4-pro come in".
- M6: list the four files in each FOCUS branch of audit19.ts; neither contains bank/selftest.mjs, bank/detectors.mjs, or bank/revenue.mjs.
- M7: `git diff ec7d17e..HEAD --stat` — if SPEC.md absent, the table wasn't updated in the audited range; then read the confinement row and compare its description to the positional check.
- L1: `printf AAAA | base64 -w0` on macOS → "invalid option" and empty output → every tx rejected.
- L5: `jq -r .head audits/round19/MANIFEST-programs.json` vs `.../MANIFEST-offchain.json` — nothing compares them today.

Good. Now — the R2 direction answer needs to be crisp since they explicitly asked to VERIFY and said "If the builder had the direction backwards, the default is backwards." My verdict: the direction is CORRECT. Trace: holdDays = days since the last settledAsPayout day; the 31-day ceiling (MAX_HOLD_DAYS) forces a payment when holdDays ≥ 31 (the round-17 measurement "the 31-day ceiling never fired" on a schedule that ignored real payouts = holders unpaid longer — so firing = paying). Not counting a bare resolvedBy → anchor stays older → holdDays larger → ceiling fires sooner → payment sooner. Assuming 'paid' would shrink holdDays → later payment. So the default pays sooner ✓. Caveat stated: this rests on decideEmission using holdDays only as a force-pay-at-31 trigger; if it also used it as a minimum-spacing (pay at most every N days), larger holdDays still pays sooner-or-equal; there is no reading where larger holdDays delays. Actually — wait, is that airtight? Could decideEmission pay only when holdDays ≤ some window ("don't pay twice within X days")? A minimum spacing would use holdDays ≥ spacing as a REQUIREMENT to pay — larger holdDays satisfies it sooner → pays sooner ✓. A maximum spacing ("must pay within X") — larger holdDays triggers sooner ✓. Both directions favor "larger = sooner." The only inversion: "pay only if holdDays < X" (nonsense — pay only recently-paid holders?). So the direction is robust to any sane decideEmission. Good — I can state that strongly.

Also the R2 sub-question "paymentState deliberately left unchanged... still true for every caller now that a second function reads the same rows?" — answered: settledAsPayout only READS; the re-send decision lives in the send loop keyed on paymentState; no writer changed. The residual risk is the detectors (M6/grep demand).

Now — length and format. The prompt wants: order by target R1-R6, then carry-over, then verdict challenges, then anything else, findings with construct/gain/evidence/fix, then the closing section. This will be long. Let me draft it efficiently but completely. I should be direct, no praise, calibrated. I'll use headers per target and per finding with severity tags.

Let me also decide: do I have any CRITICAL? No. I should say so explicitly and why (the MINT fix survives my attacks; the off-chain fixes are sound where I could trace them; my findings are of the repo's own signature classes — stale prose, one-of-N-sites, untested repairs — which is where eight-plus rounds say the real risk lives).

One more sanity check on H1's fix suggestion: rewrite the EXEMPTION paragraph to name the positional rule and delete the duplicated round-18 block or merge them; and add a gate? Could a gate catch comment-vs-code drift? The C5 gate checks table tags vs source; a comment gate would be new surface. Simplest: one paragraph, one truth, and the existing suite (9d.4) pins the behavior.

Also for H2's fix: derive the diff header from the same variable (`THE DIFF UNDER AUDIT (${'ec7d17e'}..HEAD) — round 18's repairs and the self-audit`) — or better, template it: `THE DIFF UNDER AUDIT (ec7d17e..HEAD)` written once next to the DIFF constant and interpolated, so it cannot drift; same for the verdict section (parameterize the round number). And delete the copied roster note or regenerate it per round.

For M7's fix: include SPEC.md in the diff filter (or add a second diff `-- SPEC.md`), and add a gate: the control-table row describing the Bank-key confinement must contain the substring "bank slot" (or whatever the canonical phrase is) — a prose-pin gate, brittle but better than nothing; better: the C5 arm already parses rows — extend it to assert the confinement row's description mentions the positional rule whenever MINT_IX_BANK_IDX exists.

OK — also the closing section, "do not repeat the answers already in SPEC.md's THE SHIP GATE" — I don't know what's there; I'll pick things that are structurally executional (mutation testing, fuzzing, runtime watcher, blast-radius funding, owner render-ritual, differential reimplementation) and note I'm avoiding the obvious ones (bounty, monitoring-as-generic, roster rotation) that a ship gate would already contain. I'll flag the assumption.

Let me also reconsider M3's honesty: is the MINT walk really O(N²)? Each mint_vault invocation walks all N instructions; a tx with M mints + other instructions = N total; each of the M handlers walks N instructions → M·N load calls. With packet-bound N ≤ ~20 and M ≤ ~15, that's ≤ 300 load_instruction_at_checked calls, each parsing the sysvar up to instruction i. load_instruction_at_checked's cost: it reads the sysvar data and iterates the instruction list to index i — so call i costs O(bytes of instructions 0..i). Total per handler: O(N²·avg_size). For N=20, ~20·20·~100B = 40k byte-ops → maybe 20-40k CU. Per handler. Times M=15 handlers → 300-600k CU — OVER the 200k default! Hmm wait, no — each handler's walk is its own cost; total tx CU = sum over handlers. If each walk costs ~30k CU and there are 15 mints, that's 450k CU just for walks — exceeding the default 200k budget unless the tx requests more (compute budget instructions — which themselves add instructions to the walk!). So a multi-mint transaction with ~10+ mints could genuinely fail on CU. Does the suite test multi-mint transactions? "Several mints may share a transaction" is documented as supported. If the suite's multi-mint test uses 2-3 mints, it passes; 15 would fail. The charter round: 240 vaults — if minted in batches of, say, 10 per tx to save fees... plausible. So M3 is a REAL risk with a number. But I must be careful: I don't know the actual CU cost of load_instruction_at_checked — my estimate is rough. The finding's honest form: "unmeasured, plausibly over budget for multi-mint transactions at charter scale; here's the measurement." That's exactly limit-12-worse. Keep MEDIUM, maybe MEDIUM-HIGH. I'll say MEDIUM with the measurement demand and the arithmetic sketch labeled as an estimate.

Hmm — also note: the walk runs on EVERY mint_vault call INCLUDING single-mint txs (N=1-2) — trivial cost there. The risk is only multi-mint. And the fix if measured bad: cap instructions-per-transaction operationally, or start the walk at 0 but skip re-parsing (can't — sysvar API), or accept and document a max-mints-per-tx bound with a suite assertion. Fine.

One more thing — the prompt says "COMPUTE UNITS are unmeasured anywhere. This one got worse this round — see R1." — the "see R1" was written for ROUND 18's prompt where R1 was the mint confinement (the walk). So the builder KNEW it got worse (the walk) and said so in round 18's prompt. So my M3 is confirming what the builder already flagged — I should frame it as: the builder flagged it in round 18's prompt, the known-limits list carries it forward, but NO MEASUREMENT was added in the three commits — the flag is prose, not a gate. That's the finding: a known-worse limit with no measurement demand attached, three commits later. Good framing.

Now, writing the report. Structure:

- Preamble: scope, what I could and couldn't verify (bundle limits), no CRITICAL and why.
- R1 findings (template/escaping render-check result; roster comments; isTableRow; supersede orderings; manifest).
- R2 (settledAsPayout direction VERIFIED with trace; paymentState callers; paging/griefing answer; census; dust re-derivation).
- R3 (round-trip analysis; -w0; empty; comment verified true).
- R4 (header assessment + unverifiability + revenue.mjs gap).
- R5 (isTableRow; struct regex; codeOnly; nothingToDo arms).
- R6 (floors verified with counts; arithmetic).
- R7 (one-of-N sweep results: H1 comment, paging, realDay, supersede test, verifyRoster backport).
- Under-claim section (H1, M7, plus the verified-accurate ones: bank-sign comment now true, SEAL's exemption comment accurate, cron header honest-for-named-jobs).
- Carry-over list verdicts (3 not worse with reasoning; 12 worse; 11 marginally; others unchanged).
- Verdict challenges.
- Anything else (L-items).
- Closing section.

Severity assignments final:
- HIGH: H1 (stale EXEMPTION under-claim in MINT), H2 (audit19 prompt misdescribes its own diff/verdict — stale prose shipped to all auditors).
- MEDIUM: M1 (supersede untested + reverse ordering false-flag), M2 (paging one-of-N + fire-and-forget), M3 (CU worse, unmeasured, multi-mint risk), M4 (isTableRow not pinned to THE table + everywhere-claim unverifiable), M5 (roster comments contradict rosters), M6 (bundle cannot answer the round's own questions), M7 (SPEC.md excluded from diff; strengthened controls possibly under-documented).
- LOW: L1 (-w0 platform + empty string), L2 (struct regex fragility/vacuous payer arm), L3 (codeOnly heredoc), L4 (floor duplication + MIN_ASSERTIONS), L5 (manifest cross-pass head check), L6 (verifyRoster not backported), L7 (prose-coupled arm brittleness), L8 (error message's third site).

That's 2 HIGH, 7 MEDIUM, 8 LOW — plus verified-correct items. Reasonable and calibrated.

Wait — I should double check M4's "second table" exploitability once more. tableLines(specSrc) = all lines matching the shape ANYWHERE in SPEC.md. The naming gate: bankErrs must be included in tableLines. If SPEC has another table (say, a "policy decisions" table) with fourth column **PROCEDURE.**, and someone mentions BankKeyOutsideMint in THAT table's prose row, the gate passes while the CONTROL table lacks the name. Is there such a table? SPEC has "THE SHIP GATE" control table; other tables unknown. The attack requires an editor to place the name in the wrong table — an accident, not an attack. The gate's purpose is stopping drift; a name in the wrong table IS drift it can't see. Fair MEDIUM-LOW... I'll keep MEDIUM but lead with the weaker part honestly: the predicate is shape-based, not identity-based; pin it to the section (e.g., only lines after the "## THE SHIP GATE" heading and before the next heading of equal level). Actually — hmm, one more consideration: the C5 arm ("FOURTH COLUMN IS MECHANICALLY TRUE") uses tableRows → rows — if a second same-shape table existed, C5 would verify ITS rows too (harmless, stricter). The naming arm is the one that can be satisfied from the wrong table. OK.

Also — one more check on the isTableRow regex: `/^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/` — requires `| ` at start (pipe+space). A control row in a markdown table typically starts `| control | file | what | **ON-CHAIN.** |` — starts with `| ` ✓. But what if a row starts with `|` immediately followed by the first cell without space, like `|Bank-key confinement|...`? Then `^\| ` fails → row invisible → the naming gate would go RED for names only in that row (fail-closed for naming) but C5 would skip verifying it (fail-open for the fourth-column check!). So a formatting change (dropping the space) makes rows invisible to C5 — the mechanically-true check silently stops checking those rows. Fail-open direction for C5. That's the sharpest form of M4: C5's protection is fail-open under a one-character formatting change, and no canary counts the rows (is there a row-count assertion? The diff shows `rows.filter(r => r.endsWith('claims ON-CHAIN, source says ON-CHAIN')).length, 2` — that asserts exactly 2 ON-CHAIN rows are VERIFIED — if rows became invisible, this count drops below 2 → RED ✓ fail-closed!). Hmm — the "two of which are ON-CHAIN and both verified" arm pins the count at 2. If a formatting change hid rows, the verified-count changes → red. So C5 has a canary too. OK — M4 softens: the canaries (count=2, bankErrs list) catch most invisibility; the residual is the wrong-table satisfaction and the unverifiable "everywhere" claim. Keep MEDIUM but present the canaries honestly. Maybe downgrade to LOW-MEDIUM... I'll keep MEDIUM for the wrong-table shape + the everywhere-claim, since the round explicitly asks and the honest answer is "cannot confirm from the diff; here's the grep."

Hmm, let me reconsider M6's severity — "the round cannot answer its own questions" — that's a structural defect in the certification design for THIS round. The offchain pass gets distribute.mjs (full) ✓, cosign ✓, bank-sign ✓, cron-install ✓ — but R5 is about selftest.mjs (not bundled) and R2's paymentState/detector questions need detectors.mjs (not bundled). The programs pass gets the three lib.rs files ✓ but R5 again needs selftest.mjs. So BOTH passes are missing the file R5 interrogates. The diff hunks give partial visibility. MEDIUM stands — it's the "focused bundle" tradeoff biting the round's own question list.

One more: should the stale "THE AUTHOR'S OWN VERDICT ON ROUND 15" be part of H2 or separate? Part of H2 (same file, same class, one fix).

Also — I realize I should double-check the claim in H2 that the diff embedded is REALLY ec7d17e..HEAD and not 2c8cd9b..HEAD. Evidence from the diff content: it contains audit19.ts as a NEW file — audit19.ts was created in 7f2f5a7 (the self-audit commit, within ec7d17e..HEAD). If the diff were 2c8cd9b..HEAD it would ALSO contain audit19.ts (since 2c8cd9b is older). Hmm — so content alone can't distinguish. But the DIFF constant in audit19.ts says ec7d17e..HEAD — the script embeds what it computes. The header says 2c8cd9b. One of them mislabels. Either way the prompt contradicts itself — the finding stands regardless of which is right. Also: does the diff contain round-17-only changes (which ec7d17e..HEAD would exclude if ec7d17e is round-17's final commit)? The diff's MINT hunk modifies the confinement that round 17 added — the `-` lines show `if !is_mint {` (round 17's version) — so the diff's BASE includes round 17's repairs — consistent with ec7d17e = round-17's repair commit and the diff being ec7d17e..HEAD ✓. If the diff were 2c