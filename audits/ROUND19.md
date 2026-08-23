# ROUND 19 — RUN IT, THEN JUDGE IT. Execute this file top to bottom.

You are picking up the CBOB vault audit programme cold. Everything you need is
here or is named here. **Do not improvise a different plan.**

Working tree: `/opt/cbob-vaults` (private repo `garylhenderson/centralbankofbitcoin`).
**Nothing is deployed. Nothing has minted. Nothing holds real value.** These four
Solana programs and the off-chain pipeline beside them are intended to hold and
move real Bitcoin (cbBTC) belonging to real customers.

---

## 0. READ THESE FIRST, FRESH. Do not work from memory.

```
~/.claude/rules/lessons-from-mistakes.md      # the symptom index
/opt/cbob-vaults/audits/FREEZE.md             # the plan this round serves
/opt/cbob-vaults/audits/round18/VERDICT.md    # what the last round found and rejected
/opt/cbob-vaults/SPEC.md                      # the system, and THE SHIP GATE
```

Two facts that change how you work:

1. **THERE IS NO HUMAN AUDIT FIRM.** Gary ruled 2026-08-22: *"We will NOT use a
   human audit firm. We MUST audit ourselves with AI."* This process IS the
   certification. A finding nobody writes is a finding nobody catches.
2. **THE FREEZE HAS NEVER STARTED.** `FREEZE.md` Phases 1-4 are all unstarted and
   the log reads `pre-freeze, counter 0`. Rounds 17 and 18 audited a MOVING tree,
   so **neither counts toward the two clean rounds.** Do not read round numbers
   as progress.

---

## 1. WHAT THIS ROUND IS ABOUT

Three commits, none of which any auditor has ever seen:

| commit | what |
|---|---|
| `982e5ef` | round 18 programs — the `mint_vault` payer-slot CRITICAL's fix |
| `6368a11` | round 18 off-chain — fourteen repairs |
| `7f2f5a7` | **the builder's SELF-AUDIT of those repairs** — four more defects, two of them the exact class the repairs were written to close |

**Eight rounds running have found their worst defect in the previous round's
repairs.** The self-audit already found four inside this code, one of which
(`${FLOORS.onchain}` shipping as literal text) was invisible to `tsc` and was
caught only by rendering the artifact. A source auditing itself is the weakest
arrangement available — **you are the independent pass.**

---

## 2. PRE-FLIGHT — all four must pass before you spend anything

```bash
cd /opt/cbob-vaults
git status --porcelain -- programs bank scripts tests   # MUST be empty
node bank/selftest.mjs          | tail -2               # want 403/403, 0 failures
node bank/distribute.mjs --selftest | tail -1           # want 63/63
./scripts/audit-coverage.sh                             # every file has been read by some round
```

**If the tree is dirty, STOP.** A round against a moving tree is what invalidated
17 and 18. Commit or stash first, and record which you did.

Optional but cheap, and it is the on-chain half nobody has re-run since the
`#[msg]` change — run it if a validator is available:

```bash
./scripts/run-tests.sh          # 284 on-chain assertions against real cloned Core
```

---

## 3. RUN THE ROUND — both passes, same tree

Eight frontier models, **none used in round 18**, every id verified against the
live OpenRouter list at launch (a guessed model id is a fabricated one, and
round 18's first roster silently ran two auditors short that way).

```bash
cd /opt/cbob-vaults
FOCUS=programs npx tsx scripts/audit19.ts   # ~233k chars
FOCUS=offchain npx tsx scripts/audit19.ts   # ~190k chars
```

Each pass takes up to 45 minutes (per-model deadline) and writes reports plus
`audits/round19/MANIFEST-<focus>.json` as each model lands.

**Expect roughly $15-40 total across both passes.** If either command exits
non-zero, the round did not get the readers it claims — read the message, fix
the cause, re-run that pass. **Do not write a verdict from a failed run.**

---

## 4. VERIFY THE ROUND BEFORE YOU BELIEVE IT

```bash
cat audits/round19/MANIFEST-programs.json
cat audits/round19/MANIFEST-offchain.json
```

Check, by artifact and not by assumption:

- `auditors` vs `requested` — **round 18 reported eight and had six.** One model
  returned a 41-byte fetch error and one degenerated into a repetition loop
  (4,149 lines, 163 unique, zero findings), and both were written to disk as
  reports while the runner exited 0.
- `dirty` — must be empty. If it is not, the tree moved under the round and the
  round is not about a fixed target. Say so in the verdict.
- `head` — must be the SAME commit in both manifests. Two passes at two different
  HEADs are two rounds being reported as one.
- Any model listed with `disqualified` **is not an auditor** and must not be
  counted in any sentence about how many read this.

---

## 5. ADJUDICATE — and this is the part that matters

**Measure every finding before you accept it. Roughly a third of "CRITICAL"
findings in this programme have been WRONG on measurement**, including three in
round 18 that re-reported a fix present in the bundle they were quoting.

For each finding:

1. **Reproduce it.** Run the code, build the fixture, decode the string, render
   the prompt, query the chain. A finding you only reasoned about is not verified.
2. **Ask what evidence would exist if it were true**, then go and look for that
   evidence specifically.
3. **Check the bundle actually lacked the fix** before accepting "X is still
   broken". Round 18 lost three CRITICALs to exactly this.
4. **Check your own instrument before believing an alarming answer.** During the
   self-audit, the first attempt to measure a runner's exit code read `tail`'s
   status through a pipe and reported a false success. When a validation hands
   you a surprising result, suspect the measurement first.
5. **Reject by measurement, never by argument** — and turn every rejected but
   measurable claim into an assertion, so it is never re-litigated and a change
   that quietly makes it true goes red.

Then fix what survives, and **prove every gate in BOTH directions**: it fires on
the bad input AND stays quiet on the good one. A gate that has only ever produced
one verdict is untested. Raise the floors (`bank/selftest.mjs`,
`bank/distribute.mjs`, `scripts/run-tests.sh`) and keep `SPEC.md`'s stated counts
in step — a suite assertion enforces that and will go red if you forget.

**Watch for the house defect while you fix:** *one fix applied to one of N
identical sites.* It is this project's single most repeated failure and it
recurred inside the fix for a one-of-N-sites round. Before writing "fixed",
`grep` for the shape you just repaired.

---

## 6. WRITE THE VERDICT

`audits/round19/VERDICT.md`, following `audits/round18/VERDICT.md`'s shape:

- the receipt (requested vs real auditors, named, with why each was disqualified)
- accepted and fixed, with the measurement that established each
- carried, with why it is not being fixed
- **rejected by measurement, with the measurement** — this section is as
  important as the accepted one
- what the round cost you, honestly, including defects you introduced

Commit the reports, the manifests, the verdict and the fixes together.

---

## 7. THE GATE — what "clean" means, and do not move it

From `SPEC.md`. All five at once:

1. `scripts/audit-coverage.sh` clean — no file has escaped every round
2. the tree is FROZEN
3. **two consecutive clean rounds, the second on a DIFFERENT model roster**
4. every accepted finding has a build-failing gate, proven both ways
5. every rejected-but-measurable finding has become an assertion

**Any commit to `programs/`, `bank/` or `scripts/` resets the counter, and that
is correct.** So: if this round finds nothing, say so plainly and it is the
first clean round. If it finds something, fixing it resets the counter to zero
and round 20 starts over. **Do not loosen the definition of clean to protect a
streak** — that is the "gate that flatters its own margin" defect, and it is the
one that would cost the most here.

If round 20 is meant to be the second clean round, **its roster must differ from
round 19's** (listed at the top of `scripts/audit19.ts`).

---

## 8. DO NOT

- **Do not fix anything opportunistically.** No tidying, no "while I am in here",
  no comment improvements. Every line of new code is new unaudited code, which is
  the treadmill `FREEZE.md` exists to leave.
- **Do not accept a finding you did not measure**, however confident it sounds.
- **Do not resolve the unlevelled-vault halt yourself.** Ten of fourteen auditors
  across round 18 call it a public payout DoS; the builder's counter-argument is
  in the round-18 verdict. It changes who gets paid, so **it is Gary's decision.**
  If this round raises it again, carry it and say the count.
- **Do not quote a gate's pass as proof the system is clean** without stating
  what that gate is structurally incapable of seeing.

---

## 9. WHEN YOU ARE DONE

Report to Gary in plain language: how many models actually read it, what was
accepted, what was rejected and why, what needs his decision, and — plainly —
whether this was a clean round and what that means for the gate. Then update
`~/.claude/projects/-home-ubuntu/memory/project_cbob_vault_programs.md` and the
freeze log in `audits/FREEZE.md` with the outcome.
