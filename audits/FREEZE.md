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

## PHASE 0 — WIRE THE CO-SIGNER  ⬜ NOT DONE

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

## PHASE 1 — WRITE DOWN THE ACCEPTED LIMITS  ⬜ NOT DONE

**This is the phase that makes the freeze possible, and its value is easy to
miss.** A limit that is written down BEFORE a round is not a finding when that
round re-reports it. A limit that is not written down resets the counter every
time a fresh model notices it. Fifteen open items, none of which will be fixed:

**`bank/cosign.mjs`**
1. ~~Not wired~~ — resolved in Phase 0.
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
| | | |
