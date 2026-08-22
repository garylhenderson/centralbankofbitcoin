# THE ROAD TO THE FREEZE

**Read this file, find the first phase not marked DONE, and execute it. Update
the phase marker in this file when you finish it.**

Working tree `/opt/cbob-vaults` (private repo `garylhenderson/centralbankofbitcoin`).
State at the time of writing: HEAD `ab07526`, coverage GREEN (26 files),
`270` on-chain · `355` detector · `17` allocation · `19` mainnet, all green.
**Nothing is deployed. Nothing has minted. Nothing holds real value.**

## THE DECISION THIS FILE EXISTS TO EXECUTE

Gary, 2026-08-22, after sixteen rounds: **stop fixing, and freeze.**

Sixteen rounds, sixteen with a real finding, and the rate is not falling — but
**every round now finds its worst defect in the PREVIOUS round's repairs.** Round
15 found a file written to end a defect class carrying four of them. Round 16
refuted a theorem round 15 had written into a header, and found that round 16's
own `flock` fix would have killed every money cron at the first reboot.

That is a treadmill, and it is arithmetic, not bad luck: **each fix is new
unaudited code, so fixing more resets the counter.** The gate is not reached by
fixing everything. It is reached by stopping.

The four on-chain programs are the evidence that stopping is safe. Since v5 the
total non-comment change across all four is **one constant** (`MAX_RESERVE_MINTS`
8 → 3, round 13), and rounds 14, 15 and 16 produced **zero** findings in their
logic. The programs are done. Everything left is off-chain tooling, ops and
process.

---

## PHASE 0 — WIRE THE CO-SIGNER  ✅ DONE (design A)

The one remaining item that is a **missing control**, not a defect. `grep -rn
cosign` outside its own file and the audit prompts returns nothing: no cron, no
service, no client calls `bank/cosign.mjs`. SPEC's control table lists it as
running. A redemption can be signed by any other tool and bypass every check in
it — which is most of what rounds 15 and 16 built.

**Two designs. Pick one, and say why in the commit.**

- **(A) MINIMAL — recommended.** Make `bank/cosign.mjs` the only sanctioned path
  and make a second one a build failure. The one-reader assertion already exists;
  add the operational half: a single documented, scripted way to produce a Bank
  signature, SPEC's control table corrected to say what is enforced versus what
  is procedure, and a gate that fails if any other file learns to sign. Small,
  and it adds almost no new surface right before a freeze.
- **(B) DURABLE — the redemption client.** `bank/redeem.mjs` BUILDS the
  transaction from the vault's on-chain state, so the Bank never signs bytes it
  did not compose. This closes items 3, 4 and 5 below by construction, because
  those instructions cannot be in a transaction we wrote. **But it is a large new
  surface that then needs two clean rounds of its own**, which is exactly the
  treadmill this file exists to leave. If you choose B, say plainly that the
  freeze is being deferred to build it.

**The bias is A.** New surface is the enemy of the thing we are trying to reach.
If you disagree after reading the code, say so and take it to Gary rather than
deciding it quietly.

---

### WHAT WAS ACTUALLY DONE — **A**, and the phase's own title was wrong

**The co-signer was NOT wired, because it cannot be.** That is the finding of this
phase and it is worth more than the code it produced. A Solana signature is
produced by whoever holds the private key. A cron calling `bank/cosign.mjs` does
not stop the key holder signing with six lines of `web3.js`; only key CUSTODY
does, and custody is a property of the machine the key ends up on, not of this
repository. "Wire the co-signer" describes a control that does not exist at this
layer, so the phase delivered the three things design A actually asked for:

1. **`scripts/bank-sign.sh`** — the one sanctioned, documented, scripted path.
   Holds no key, reads no key, contains no judgement. It refuses any argument it
   does not recognise rather than forwarding it (so a `--force` cannot be smuggled
   through the wrapper), takes the transaction from a file or stdin rather than
   argv, and rejects a non-base64 byte before Node sees it — `Buffer.from(s,
   'base64')` SILENTLY IGNORES characters outside the alphabet, so a mangled paste
   decodes to a different, shorter transaction that may still parse. That was the
   only new failure this file could introduce, so it is the one thing it checks.
   Exit-code pass-through was MEASURED, not asserted: `exec` propagates cosign's 9.
   It also resolves the operator's file argument BEFORE changing directory — see
   the seventh defect below, which is why that is written down as a property.
2. **SPEC's control table has a fourth column**, `does anything RUN it?`, and it
   is mechanically true rather than a claim — `bank/selftest.mjs` parses the rows
   and requires every AUTOMATIC row to name a file `scripts/cron-install.sh`
   installs, and every PROCEDURE row to name one it does not. Proven both ways.
   **This is the arm that matters most:** the table is the ONE place that says
   what runs, and for eight rounds nothing checked it against reality.
3. **A gate that fails if any other file learns to sign** — every arm proven in
   both directions, including the two this phase's own mistakes earned (the
   self-match arm and the read-before-`cd` arm). +26 assertions, 355 → 381. No
   count of arms written here on purpose: an enumeration is how one of them gets
   deleted by someone tidying up, which is a finding a round-16 auditor made
   against a comment in `bank/detectors.mjs`.

**Three headers were corrected too** — `cosign.mjs`'s usage block, SEAL's
`WHAT ACTUALLY COVERS IT` bullet (its "refuses in the moment, PRE-SIGNATURE" sat
between two bullets describing cron jobs and read as a third automatic control),
and SPEC's "that is an open gap" paragraph.

**⚠️ NINE DEFECTS WERE FOUND IN THIS PHASE'S OWN CODE, PLUS TWO PROSE ERRORS.
EIGHT BY THE NEW GATE. THE NINTH — THE WORST ONE — BY NEITHER A GATE NOR A
READING.** The count was written as "six" and then as "seven" in earlier drafts of
this very paragraph, both times by counting from memory instead of from the
transcript. It is nine.

* **FIVE were the *search that finds its own searcher*** — three in code, two in
  comments. Three arms search the tree for three strings and `selftest.mjs` is
  deliberately inside that tree, so spelling any of them out makes that file look
  like a second reader, a second invoker or a second signer. In order: the key
  map, a sample command in one both-ways case, a sample command in another,
  **then a comment quoting the path it was warning about**, then a comment naming
  the constructor it was explaining. The round-16 comment ten lines up already
  said the pattern must be ASSEMBLED. That was not enough, five times over, and
  twice it was not enough *in the sentence written to say it*.

  There is now an arm that names this failure directly, because the other arms
  catch it wearing the wrong face: they report *"the selftest learned to sign"*,
  which sends the next reader hunting for a signer instead of for a paragraph.
* **ONE was a by-name exclusion, and it was the dangerous one.** The first draft
  of the signer arm dodged its own self-match by excluding `selftest.mjs` from the
  scan BY NAME — which is not a fix, it is the hole, in the file the round-16
  comment says would be the last place anyone looked. Assembling the literal fixed
  it and put every file back in the set. **A gate that excludes a file to make
  itself pass is worse than no gate**, and this one nearly shipped that way. One
  by-name exclusion survives, for `cosign.mjs` in the invoker check; it is argued
  in place rather than waved through, and what covers that file instead is named.
* **TWO were bugs in the new gate's own parsers**, one in each direction, which is
  the pair worth noticing:
  - **Fail-OPEN:** `` `bank/alarm.mjs --reconcile` `` has no backtick straight
    after `.mjs`, so that row read as NO FILE NAMED — harmless on an AUTOMATIC
    row, silently self-agreeing on a PROCEDURE one. An unnamed row is now red on
    its own account.
  - **Fail-CLOSED, which is how a gate gets loosened:** the read-before-`cd`
    check anchored its pattern at column zero, and the wrapper's two reads sit
    after a `then` and inside an `else`. It failed on the CORRECT file. The
    tempting repair is to relax what the arm demands; the right one was to fix
    the anchor. **A gate that fails on a good file is one edit away from being a
    gate that passes everything.**
* **⚠️ THE NINTH WAS FOUND BY RUNNING THE TOOL, AND IT WAS THE WORST ONE.** The
  wrapper `cd`-ed to the repository root BEFORE resolving the operator's file
  argument, so a relative `tx.b64` was resolved against the REPO instead of
  against the operator's shell. **Measured:** from `/tmp`, with a stale `tx.b64`
  sitting at the repo root, it fed the co-signer the REPO's file and reported
  nothing wrong. For a tool whose entire job is to judge one specific transaction
  before the Bank signs it, silently judging a DIFFERENT one is the worst failure
  available — and it was fail-OPEN. Read first, `cd` after, and the ordering is
  now an arm of its own, proven both ways, because it was caught by nothing else.

  **Nothing in the gate could have found it**, and that is the transferable part:
  every arm here reads the tree as TEXT, so all of them are structurally blind to
  what the code DOES when it runs. Eight text defects and one behavioural one, and
  the behavioural one was the dangerous one. An earlier draft of this section said
  "every one was caught by a gate before a human read the file" — written before
  the ninth existed, and it would have been a comment claiming a control that does
  not run, in the phase whose whole subject is that defect.

**Two prose errors, both found by review rather than by any gate**, and both worth
naming because this project's most repeated defect is a sentence that is not true:
a round attribution asserted from memory in three places (the one-reader check is
round 16, not round 15 — settled with `git log -S`, and corrected in SPEC, the
selftest and this file), and an enumerated count of gate arms in SPEC that would
drift the moment one was added, which is precisely the finding a round-16 auditor
made against a comment in `bank/detectors.mjs`. Neither list carries a count now.

This is the treadmill this document was written about, observed from inside: a
phase adding ~26 assertions of new code produced nine defects in it. It is the
argument FOR the freeze rather than against it — but read the ninth before
taking too much comfort from the eight. **A gate that reads source text cannot see
behaviour, so "the gates are green" was never going to be the whole standard.**
Round 17 should assume the same ratio holds for everything this phase added.

**FOR GARY, because it changes what the word "co-signer" promises a buyer:** the
Bank's co-signature is a thing an operator chooses to do carefully, not a machine
that cannot be skipped. Everything it checks is real and is proven; nothing forces
it to run. Phase 1 should decide whether that belongs in buyer-facing copy
alongside limits 2, 4 and 15.

**⚠️ `scripts/audit-coverage.sh` NOW EXITS 1**, naming `scripts/bank-sign.sh` as
never sent to an auditor. That is the gate working, not a regression, and it is
self-clearing: Phase 3 writes `audit17.ts`, which must bundle the new file
(`f('scripts/bank-sign.sh')`). Run coverage AFTER writing that prompt, not before
— Phase 3's command order predates this file existing.

---

## PHASE 1 — WRITE DOWN THE ACCEPTED LIMITS  ⬜ NOT DONE

**This is the phase that makes the freeze possible, and its value is easy to
miss.** A limit that is written down BEFORE a round is not a finding when that
round re-reports it. A limit that is not written down resets the counter every
time a fresh model notices it. Fifteen open items, none of which will be fixed:

**`bank/cosign.mjs`**
1. ~~Not wired~~ — **superseded in Phase 0, and not by wiring.** Nothing forces a
   redemption through the co-signer and nothing can; that is now a stated design
   position in SPEC's control table, mechanically checked against cron, rather
   than an open gap. The residual limit is real and belongs in the list: **the
   Bank's co-signature is procedure, so its guarantees hold only for a signature
   produced through `scripts/bank-sign.sh`.** Write it up as such.
2. A coverage refusal has no override. The customer's answer to a dust airdrop
   is to declare it and let the burn destroy it; the `undeclarable` refusal
   blocks that too, and "a human can sign by hand" is rhetorical — there is no
   flag for it.
3. The Bank may still be named `payer` inside the pair itself. Arm 1 exempts the
   two approved instructions entirely.
4. The allowlist permits a bare Core `BurnV1` of a SECOND vault beside a real
   redemption. The owner harming their own property; `correlateBurns` is
   per-asset so B stays CRITICAL — but the Bank puts its name on it.
5. The judge never looks at where the swept money goes.

**`bank/lock.mjs`**
6. An aborted `flock` run is indistinguishable from one that never fired, in the
   log.
7. A wedged-but-alive holder is a permanent silent skip under `flock -n`.

**`bank/alarm.mjs` / `bank/detectors.mjs`**
8. **Cross-pass correlation lag** — if the signature walk reaches the burn in a
   LATER pass than the DAS diff, the CRITICAL already went out and nothing
   retracts it. ⚠️ **This item FELL OFF round 16's carry list while still
   unfixed.** A carry-list leak is the failure mode the lists exist to prevent;
   note it in the freeze log as one.
9. `detectNestedVaults` cannot see a FOREIGN Core asset nested in a vault.

**`bank/revenue.mjs`**
10. No fresh per-cycle swap operator wallet. The one trusted hop.

**`bank/distribute.mjs`**
11. Distribution reconciles against a ledger the payer wrote.

**`scripts/`**
12. Compute units are unmeasured anywhere; there may be a CU ceiling below the
    measured 1232-byte ceiling.

**MINT**
13. The dead `redemption` attribute stamp, and the Attributes plugin still
    delegated to a SEAL PDA that no longer writes attributes. Judged unreachable
    by two auditors.
14. Duplicate attribute keys are not rejected at mint.

**GOV**
15. A vault minted during an open proposal may vote.

**How to write them down — and this is the part that must not be fudged:**

- They go in **SPEC.md, in one section, named ACCEPTED LIMITS**, each with what
  it costs, who it costs, and why it is not being fixed. Not "we will fix it
  later" — either it is accepted or it is not.
- **Anything you are not willing to write "accepted, will not fix" against is not
  an accepted limit. Fix it now, in Phase 1, before the freeze starts.** Do not
  carry an item into the freeze that you secretly intend to fix.
- Buyer-facing consequences (2, 4, 15) belong in whatever a purchaser reads, not
  only in SPEC. A limit the customer cannot discover is not disclosed.

---

## PHASE 2 — FREEZE  ⬜ NOT DONE

One commit that changes nothing under `programs/`, `bank/` or `scripts/`. It
records the freeze sha and the date. **From that commit until two consecutive
clean rounds are in the book:**

- **NOTHING is committed to `programs/`, `bank/` or `scripts/` except a fix for a
  finding that survived measurement.** No opportunistic tidying. No "while I am
  in here". No comment improvements. Docs and `audits/` are free.
- **Any such commit RESETS the counter to zero, and that is correct.** Log it in
  the freeze log with why it was unavoidable.
- **The definition of clean does not move.** A finding that survives measurement
  is a finding. Loosening this to protect a streak is the "gate that flatters its
  own margin" defect, and it is the one that would cost the most.

---

## PHASE 3 — ROUND 17, THE FIRST CLEAN ROUND  ⬜ NOT DONE

```bash
cd /opt/cbob-vaults
./scripts/audit-coverage.sh      # MUST exit 0
./scripts/run-tests.sh           # 270 / 355 / 17 / 19, all green
cp scripts/audit16.ts scripts/audit17.ts   # edit the prompt, keep the framing
nohup npx tsx scripts/audit17.ts > /tmp/audit17.log 2>&1 &   # ~15 min
```

Aim it at round 16's repairs (the generation-numbered lock is the big one — the
mechanism changed and no auditor has read it), at Phase 0's wiring, and at the
ACCEPTED LIMITS section itself: **ask the auditors whether any limit is worse
than stated, or is not actually a limit.** That is the most valuable question
this round can ask, because a wrongly-accepted limit is the one thing the freeze
would lock in.

**Include the ACCEPTED LIMITS list in the prompt under "KNOWN AND OPEN — do not
re-report as new."** That is what stops a pre-declared limit resetting the
counter, and it only works if the list was written BEFORE the round.

---

## PHASE 4 — ROUND 18, THE SECOND CLEAN ROUND  ⬜ NOT DONE

Same tree, untouched. **A DIFFERENT MODEL ROSTER from round 17** — the same eight
re-reading an unchanged tree is one round run twice, and agreement with yourself
is not independence.

⚠️ **Look the model ids up; do not invent them.** Round 16's roster change
shipped two fabricated ids (`deepseek/deepseek-v4`, `mistralai/mistral-large-3`)
and OpenRouter returned `not a valid model ID` for both — two of eight auditors
silently missing from the round. `GET https://openrouter.ai/api/v1/models` is the
list. A model id is a name, and a guessed name is a fabricated one.

---

## THE DISCIPLINE THAT DOES NOT CHANGE

- **Measure before believing.** Roughly a third of sixteen rounds' CRITICALs were
  wrong on measurement. The suite runs against real mainnet Core on a validator;
  it is what has disproven every wrong claim.
- **Measure a CARRIED finding BEFORE you fix it, not after.** Round 16 fixed the
  carried "the ELF starts at 13 when the upgrade authority is absent" — accepted
  from two auditors across two rounds — and then measured it away against two
  live immutable mainnet programs. The original code was right, and shipping the
  fix would have broken the drift watch on Metaplex Core, the one program we do
  not control. A carried finding is not a verified finding.
- **A theorem in a comment is a CLAIM.** "No arrangement of rename, link and
  unlink is a compare-and-swap" justified leaving a measured double-hold open for
  a whole round; `link()` is exactly that, and an auditor refuted it in one
  sentence. When you write "it is impossible to X", write how you tried.
- **Every accepted finding gets a gate that FAILS THE BUILD, proven in BOTH
  directions.** A gate that has only ever said OK is untested.
- **Every rejected-but-measurable finding becomes an ASSERTION**, so nobody
  re-litigates it and a change that quietly makes it true turns the suite red.
- **Move every floor with the suite** — `MIN_ASSERTIONS`, `DET_FLOOR`,
  `ALLOC_FLOOR`, `MAINNET_FLOOR`, and `FLOOR` inside `bank/selftest.mjs`. SPEC's
  stated counts are asserted against them.
- **A comment claiming a control that does not run is a defect. So is one denying
  a control that does.** Point at the control table in SPEC; never restate it.
- **Do not redesign the mechanics.** The v5 pairing has held four rounds against
  eight models each.

## THE FREEZE LOG

Append one line per event: the freeze sha, each round's verdict path and verdict,
and every commit that reset the counter with the reason it was unavoidable.

| date | event | counter |
|---|---|---|
| 2026-08-22 | **Phase 0, design A.** `scripts/bank-sign.sh` (new), the control table's fourth column, new gate arms (+26, 355 → 381), three headers corrected. The co-signer was NOT wired — it cannot be; see Phase 0 above. **Nine** defects were found in this phase's own code — eight by the new gate (five the self-match, two of those in the comments explaining the rule; one a by-name exclusion that nearly shipped; two parser bugs, one failing open and one failing closed) and a ninth, fail-open and worse than any of them, found only by RUNNING the tool: the wrapper resolved a relative path against the repo instead of the operator's shell. Plus two prose errors caught by review. | pre-freeze |
