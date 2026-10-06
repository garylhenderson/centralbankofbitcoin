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

**⚠️ TEN DEFECTS WERE FOUND IN THIS PHASE'S OWN CODE, PLUS TWO PROSE ERRORS.
The tenth is below and GARY found it, which is the one that should sting.**

**⚠️ NINE OF THEM WERE FOUND BEFORE HE DID.
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
phase adding ~26 assertions of new code produced ten defects in it, and the last one was found by the client. It is the
argument FOR the freeze rather than against it — but read the ninth before
taking too much comfort from the eight. **A gate that reads source text cannot see
behaviour, so "the gates are green" was never going to be the whole standard.**
Round 17 should assume the same ratio holds for everything this phase added.

### ⚠️ THE TENTH DEFECT — GARY FOUND IT, AND IT WAS THIS PHASE'S WORST CALL

**Gary, 2026-08-22, reading the above:** *"the co-signer is just the program that
signs the project to make it a multi-sig and keep them from doing anything with
other programs."*

He is right, and everything this phase wrote about the co-signer had a
**one-line-too-short model of it.** The write-up above, SPEC's control table,
`cosign.mjs`'s header and the note that used to sit here all said the same thing:
*PROCEDURE. Nothing forces a redemption through it, and nothing can.* Every word
of that is true **about the policy**, and read as a description of the co-signer
it says the Bank can be skipped.

**Measured, after the correction and before changing a line of prose:**

| | |
|---|---|
| `programs/cbob-vaults/src/lib.rs` | `pub bank: Signer<'info>` + `require_keys_eq!(ctx.accounts.bank.key(), ctx.accounts.config.bank, VaultError::NotTheBank)` |
| `programs/cbob-vault-burn/src/lib.rs` | `pub bank: Signer<'info>` + `require_keys_eq!(ctx.accounts.bank.key(), cfg.bank, BurnError::NotTheBank)` |

**No vault opens or burns without the Bank's signature. Ever. That is on-chain,
in two programs, and nobody can opt out of it including us.** What a human runs is
the POLICY the Bank applies to its half.

**This is the same defect class the whole project is built around, running
backwards.** Seven rounds of comments claiming controls that do not run trained
everyone here to hunt over-claiming. This under-claimed a control that does run —
and it under-claimed **the guarantee the member is buying**, which makes it the
more expensive direction. It was not caught by any of the arms added in this
phase, because every one of them checks that a claim is not too STRONG.

**The fix, and it is not only prose.** The control table's fourth column now has
**three** values — `ON-CHAIN`, `AUTOMATIC`, `PROCEDURE` — the co-signer row is
SPLIT into the 2-of-2 (on-chain) and the policy (procedure), and the gate verifies
an `ON-CHAIN` row against the RUST: the named programs must really carry both
`bank: Signer` AND the `require_keys_eq!` pin. Both halves are load-bearing — a
`Signer` with no pin accepts *any* signer as the Bank, which is a 1-of-1 wearing an
extra keypair. Proven in both directions, including against `cbob-vault-gov`,
which has no Bank at all and correctly reads as not-a-pin.

### AND THE SECOND HALF OF GARY'S SENTENCE IS AN OPEN LIMIT, NOT A CONTROL

*"...and keep them from doing anything with other programs."* That is the
**program allowlist** and the **bank-pubkey confinement** in `judgeRedemptionTx`,
and it is the pair that stops a customer spending the Bank's signature on
something that is not their redemption — the theft round 15 measured.

**Neither is on-chain.** `open_for_redemption` walks the instruction sysvar
forward only as far as its matching `burn_vault` and never enumerates the rest, so
nothing in any program bounds what else a redemption transaction contains. The two
checks that carry the most weight in Gary's description of the co-signer are
exactly the two that live in the skippable half.

**Moving them on-chain is possible** — SEAL already walks the sysvar, so requiring
every top-level instruction's program to be on an allowlist, and `config.bank` to
appear in no instruction outside the pair, is a bounded addition to a loop that
exists. **It is a `programs/` change and therefore resets the freeze counter to
zero.** Left for Gary: see the question at the end of this section. Until it is
answered it is an ACCEPTED LIMIT and is written up as one, not left implied.

**⚠️ `scripts/audit-coverage.sh` NOW EXITS 1**, naming `scripts/bank-sign.sh` as
never sent to an auditor. That is the gate working, not a regression, and it is
self-clearing: Phase 3 writes `audit17.ts`, which must bundle the new file
(`f('scripts/bank-sign.sh')`). Run coverage AFTER writing that prompt, not before
— Phase 3's command order predates this file existing.

---

## PHASE 1 — WRITE DOWN THE ACCEPTED LIMITS  ✅ DONE 2026-08-24

**This is the phase that makes the freeze possible, and its value is easy to
miss.** A limit that is written down BEFORE a round is not a finding when that
round re-reports it. A limit that is not written down resets the counter every
time a fresh model notices it. Fifteen open items, none of which will be fixed:

**`bank/cosign.mjs`**
1. ~~Not wired~~ — **superseded in Phase 0, and not by wiring.** Two residual
   limits replace it, and the FIRST is the one Phase 1 must not fudge:
   - **1a. THE PROGRAM ALLOWLIST AND THE BANK-PUBKEY CONFINEMENT ARE OFF-CHAIN.**
     Nothing in any program bounds what else a redemption transaction contains —
     `open_for_redemption` scans forward only to its matching burn. So *"the
     customer cannot make the Bank's signature authorise something else"*, which
     is half of what the co-signer is FOR, holds only for a signature produced
     through `scripts/bank-sign.sh`. This is the round-15 theft, mitigated but not
     eliminated. **Do not accept this one without reading the on-chain question at
     the end of Phase 0 first** — it is the single item on this list that a
     bounded change to existing code would actually close.
   - **1b. The Bank's POLICY is procedure.** Its signature is mandatory and
     on-chain (the 2-of-2 is real and is now its own row in the control table),
     but which transactions it agrees to sign is a tool a human runs.
   Both are buyer-facing by the same test as 2, 4 and 15.
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

**ADDED BY ROUNDS 17-18 (this list was written at `ab07526`; the tree has moved
twice since, so these are not optional extras — they are part of the same list):**

16. **The Bank-as-fee-payer gap exists on the MINT path too.** Limit 1a was
    written about redemption. `mint_vault` now has the on-chain confinement but
    the fee payer appears in no instruction's account list, and there is no
    `judgeMintTx` — `judgeRedemptionTx` is the only judge. A mint with
    `feePayer = bank` drains Bank SOL through priority fees without tripping
    anything. On-chain cannot close it; only custody policy can, and Phase 0
    established custody does not live in this repository. Buyer-facing by the
    same test as 1a.
17. **Compute units, PROMOTED from an omission to a release-blocking
    measurement.** Both Bank-signature paths now deserialize every top-level
    instruction before their real work. The 1,232-byte ceiling is measured; the
    CU ceiling is not, and it may be lower. Four round-18 auditors independently
    said this should block a release rather than sit on a list. Agreed. This is
    the one item here that is NOT "accepted, will not fix" — **it is "must be
    measured before the freeze ends"**, and it must not be quietly demoted back.
18. **The unsigned transaction is visible in `ps`.** `scripts/bank-sign.sh` ends
    `exec node bank/cosign.mjs --tx "$TX"`. Not a key leak and an unsigned
    transaction is not a secret; closing it means teaching `cosign.mjs` to read
    stdin, which is new surface in the judgement file. The false CLAIM was fixed
    in round 18; the mechanism is accepted.
19. ⚠️ **THE UNLEVELLED-VAULT HALT IS NOT MINE TO ACCEPT.** Ten of fourteen
    independent auditors across round 18's two passes call it a public payout
    DoS: anyone who funds a vault to 21,000 sats before its `levels.json` entry
    exists stops every payout until an operator edits a file. The standing
    argument — halting is recoverable, excluding is permanent overpayment — is
    sound about those two options and silent about the third that two auditors
    supplied: reserve unknown vaults at maximum weight and carry the remainder.
    **This changes who gets paid, so it is a product decision. It goes to Gary
    before Phase 1 closes, and it is the one item on this list that must not be
    written down as "accepted" by the author alone.**

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

### WHAT WAS ACTUALLY DONE — and the phase found four defects of its own

The list is now **`SPEC.md` → ACCEPTED LIMITS**, in one section, in three states:
**ACCEPTED** (will not fix, with what it costs and who it costs), **OPEN AND
BLOCKING** (must be done before anything mints, and may not be demoted), and
**DISCHARGED** (measured closed, with the measurement named). Numbering follows
this file so the two can be read side by side, which is why the list has gaps.

**Writing them down was not transcription. Four of the twenty-three had moved,
and copying the list as written would have frozen four false statements:**

- **12/17 compute units — DISCHARGED.** Measured on landed transactions: a plain
  mint 58,956 CU / 890 bytes, the widest pad the packet allows 18 instructions at
  73,657 CU, 1,326,343 CU spare of 1,400,000. The byte wall binds more than
  twenty-five times before the compute wall. ⚠️ **And SPEC still said "compute
  units are NOT measured anywhere" — in the tree, after the commit whose title is
  "limit 17 clears".**
- **14 duplicate attribute keys — CLOSED on chain.** `DuplicateAttribute`, because
  the level made a bounded nuisance load-bearing.
- **19 the unlevelled-vault halt — CLOSED BY CONSTRUCTION**, and it was the most
  reported finding in this project's history (fifteen of twenty-two auditors
  across rounds 18 and 19). `levels.json` is deleted; the level is written at mint
  and there is no activated-but-unlevelled window. **It therefore never needed the
  product decision this file reserved for Gary.** The refusal remains and is
  narrower and STRONGER than the list claimed: the Bank cannot omit a holder
  without halting everyone.
- **9 the foreign nested Core asset — NARROWER THAN WRITTEN.** `bank/cosign.mjs`
  does see it and fails closed. The limit is coverage TIMING, not capability, and
  `bank/detectors.mjs` carried a comment saying NOTHING does it — an under-claim,
  which is the direction nothing here is instrumented to catch.

**And three stale-document defects, all of one shape.** SPEC stated the allocation
count twice and the second said 63 against a real 103; THE SHIP GATE said
"thirteen rounds" and "270-assertion suite" six rounds late. The stated-count gate
in `bank/selftest.mjs` existed for exactly this and **read ONE occurrence of each
of THREE floors** — so a second copy was invisible to it, and the deck and mainnet
floors were checked by nothing at all. It now reads EVERY occurrence of all FIVE,
fails on zero occurrences, and is proven both ways by poisoning the LAST match
rather than the first.

**One new assertion, because the level is a number that decides money and nothing
said it was immutable.** Every level arm proved what happens AT mint; nothing
proved the level survives it. 11.13/11.14 measure that neither the OWNER nor the
BANK can rewrite it — Core refuses with `0x1a`, `NoApprovals`, read out of the
generated error map rather than guessed, and pinned with `because` so a future
deserialization failure cannot pass as an authority refusal. 11.15 reads the value
back. **What remains is an accepted limit and is now written as one: the level is
immutable in practice because no shipped instruction can rewrite it, and in
principle only as far as the SEAL program's upgrade authority is trustworthy.**

⚠️ **The buyer-facing subset (1a, 2, 4, 13, 15) is marked BUYER-FACING in SPEC and
is NOT yet on a purchase surface, because there is not one — nothing has minted
and nothing is for sale.** That is not a discharge. **The sale may not open until
those five are somewhere a purchaser reads**, and putting them there is a §13.8
question for Gary about how the Bank discloses a limit in its own register, not a
decision for the author.

Counts after Phase 1: **316** on-chain / **439** detector / **103** allocation /
**17** deck / **19** mainnet, all green, every floor EQUAL to its real count.

---

## PHASE 2 — FREEZE  ✅ DONE 2026-08-24 — FROZEN AT `bf18354`

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

## PHASE 3 — THE FIRST CLEAN ROUND  ⬜ IN FLIGHT — IT IS ROUND **20**, NOT 17

> ⚠️ **This heading said ROUND 17 and that number is three rounds stale.** Rounds
> 17, 18 and 19 all ran BEFORE Phase 1, against a moving tree, and none of them
> counts. Read the phase, not the round number in its title — and do not read
> three round numbers as three attempts at the gate.

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

## PHASE 4 — THE SECOND CLEAN ROUND  ⬜ NOT DONE — IT IS ROUND **21**, NOT 18

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
| 2026-10-06 | **ROUND 29: NOT CLEAN. Counter stays 0 of 2.** Audited clean `76753e8` (round-28 repairs `de3d56f`). Programs **7/8 counted** (DeepSeek cut off), four confirmed topics (1 MEDIUM / 1 LOW / 2 INFO). Off-chain **6/8 counted** (DeepSeek cut off, GLM request failed), three confirmed topics (1 MEDIUM / 1 LOW / 1 INFO). The MEDIUM and LOW are shared, so **five distinct topics: 1 MEDIUM, 1 LOW, 3 INFO**. Verdicts: `audits/round29/VERDICT-programs.md`, `VERDICT-offchain.md`. **M1:** a stranger could halt every alarm pass, the redemption poster and revenue recovery for one fee with a padded transaction whose logs the runtime truncates (measured on isolated validators). Repair: walking scanners opt in to a flagged, otherwise fully validated transaction; the alarm pages a `log_coverage_gap`, keeps it in state, still runs every instruction detector and advances; revenue reads outflow from instructions; the poster queues a REJECTED hand-draft for a top-level BURN call. **L1:** the coverage gate now enumerates every tracked system file; eight never-sent files are bundled in round 30. **INFO:** DESIGN `activate` text, permanent dilution by an activated orphaned vault, selftest scan scope. Disproved: Opus's sweep-helper CRITICAL; the Autograph FIFO halt was re-measured across ten shapes and did not occur. **Validation:** full runner exit 0, 855 on-chain, 891 detector and every other gate exact; independent repair review applied; round-28 71/71 simulation reused (no program or fixture change); build and rehearsal in `audits/round29/VALIDATION.md`. | **counter 0 of 2** |
| 2026-10-06 | **ROUND 28: NOT CLEAN; programs quorum incomplete.** Audited clean `93f8c36`. Programs **5/8 substantive, six required**: five confirmed topics (1 MEDIUM / 1 LOW / 3 INFO); MiMo and Opus 5 cut off, Kimi timed out. Off-chain **6/8**: seven confirmed topics (1 MEDIUM / 4 LOW / 2 INFO); MiniMax cut off and Kimi ended with a provider error. Runtime-log truncation and stale SPEC status are shared topics, counted once across passes. Verdicts: `audits/round28/VERDICT-programs.md`, `VERDICT-offchain.md`. Repairs refuse runtime-truncated history before cursor progress; separate chain deadlines from local clocks and migrate mixed revenue timers without consuming failed notices; retain full crank problem lists and prior confirmed redemption evidence; isolate rehearsal launch paths; correct stale promises and strengthen two state assertions. Mainnet ATA/Token2022 bytes differed from bundled validator versions; shared source pins now load and verify all three token programs in every validator runner. New gates cover a frozen split destination, a large owner autograph before reveal, and default-budget expiry of twenty distinct due boosts on synthetic genesis state. **Validation addendum INFO:** narrow the third fallback layer to monthly distribution; activation/join/delivery require explicit calls (`VALIDATION-FINDINGS.md`). Three full runs passed the large-asset reveal and then failed fixture cleanup; measured cause is Core's fixed 32 KiB heap, so Core cannot shrink that revealed vault. The boundary is pinned (R28.A2) with real-shape thaw, transfer and complete-redemption simulations (R26.P7, R28.A3/A4) and stated in SPEC 40 and the holder guide. **Validation:** full runner exit 0 with 855/855 on-chain, 888 detector, 39 allocation, 22 poster, 14 PoB, 47 launch, 6 host, 33 mainnet, 4 expiry and 16 swap-fork; fresh simulation 71/71; repairs `de3d56f`, clean post-commit build proof with all five dist hashes unchanged, and key-preserving rehearsal refresh with exact reverse proof (`VALIDATION.md`). Production comment-only rebuilds preserve all five binary hashes. Fresh disjoint rounds 29/30 are prepared before any clean round can begin. | **counter 0 of 2** |
| 2026-10-06 | **ROUND 27: NOT CLEAN. Counter stays 0 of 2.** Audited clean `1d8ec10` (round-26 repair code `8fe3120`). Programs: **6/8 counted**, four confirmed topics (1 LOW / 3 INFO); stale Laguna and failed Fugu excluded. Off-chain: **7/8 counted**, eight confirmed topics (4 LOW / 4 INFO); failed Fugu excluded, Qwen retries retained as evidence. Both meet the six-auditor quorum; the shared status-documentation topic is not counted twice. Verdicts: `audits/round27/VERDICT-programs.md`, `VERDICT-offchain.md`. Repairs correct boost-price, diagnostic, PoB-plugin, status, pool-deviation and royalty-sampling descriptions; report missing post-deadline components; retain rehearsal tolerance; suppress only independently covered freeze heartbeat duplicates; and attribute fetched race-error logs to MINT. Four new on-chain assertions exercise PDA-owner claims/votes and a non-System SOL recipient. **Validation also found V1 MEDIUM:** live transaction-v1 history stopped the installed SDK and three operational readers. A shared validated reader now handles legacy/v0/v1, with real public fixture and source-extracted consumer regressions; incomplete coverage fails closed. **V2 INFO:** legacy/v0 packet and compute claims were too broad; they are qualified, without claiming CBOB v1 execution. Independent triage and exact evidence: `VALIDATION-FINDINGS.md`, `VALIDATION.md`. Full runner passed **848 on-chain / 860 detector / 39 allocation / 22 poster / 14 PoB / 47 launch / 33 live-mainnet / 6 host / 16 swap-fork**. Unchanged simulation logic retains prior 71/71 evidence. All five rebuilt mainnet program binaries are byte-identical to certified dist; only line-preserving program comments changed. Post-commit build/rehearsal gates are recorded separately in validation. Fresh disjoint 28/29 runners are prepared; round-28 preflight passed both focuses. | **counter 0 of 2** |
| 2026-10-05 | **ROUND 26: NOT CLEAN; programs quorum incomplete. Counter stays 0 of 2.** Audited clean `93d04fe` (round-25 repair code `ba67127`). Programs: **5/8 counted, six required**, 33 reviewed topics, seven confirmed (3 LOW / 4 INFO), no confirmed on-chain defect. Grok was stale; Deepseek and Opus 5 ended with provider errors. Off-chain: **6/8 counted**, 50 reviewed groups, nine confirmed (6 LOW / 3 INFO); Grok was stale and GLM truncated. Shared documentation topics are not additional independent findings. Verdicts: `audits/round26/VERDICT-programs.md`, `VERDICT-offchain.md`. **Repairs:** programs C1 coherent supply snapshots and cap-interval equality; C2 a deterministic five-level fixture census with an explicit eligibility bound; C3 second-source refusal reason pin; D1-D4 correct minted-vault voting, five-program rehearsal counts, delayed-key apply lifetime and ATA packet claims. The pinned-Core owner-plugin conjecture was disproved by a 7/7 probe; seven suite arms now exercise it through actual CBOB reveal. Off-chain L1 retains uncertain candidate signatures for all four revenue hops and prints them in audit diagnostics; L2 uses chain return time for the `splitByOther` sibling; L3 stage-specific revenue failure/recovery streams; L4 isolated reconciliation history/labels with recoveries only after complete coverage; L5 passes every production pin to the imported launch detector and refuses unknown launch fields; L6 refuses cron installation from a rehearsal tree. D1-D3 correct comments and enforce the swap-fork SPEC floor. Independent repair review caught and fixed startup-notification loss, an overlong proposed alert prefix, incomplete-census false recovery, and a second stale ATA paragraph. No program source changed. Validation: **844 on-chain / 789 detector / 39 allocation / 22 poster / 14 PoB / 47 launch / 33 live-mainnet / 6 host / 16 swap-fork**, all passed in the full runner. The unchanged simulation retains its prior 71/71 evidence. Exact logs and limits are in `audits/round26/VALIDATION.md`; post-commit build/rehearsal gates are recorded there separately. Disjoint round-27/28 runners are prepared before the next freeze. | **counter 0 of 2** |
| 2026-10-05 | **ROUND 25: NOT CLEAN (no program defect, no theft path). Counter stays 0 of 2.** Audited `2b67fb1`. Programs: 7 counted of 8 (grok-4.3 excluded), 39 distinct claims: 6 CONFIRMED evidence gaps (4 LOW, 2 INFO), 7 accepted limits, 9 documentation findings and 17 disproved claims. Off-chain: 6 counted of 8 (grok-4.3 excluded, fugu failed), 7 LOW and 4 INFO confirmed. Verdicts: `audits/round25/VERDICT-programs.md`, `VERDICT-offchain.md`; validation: `VALIDATION.md`. **Correction to the ROUND 24 row below:** its “C1-C10” wording overclaimed completion. C7, most C8 and five of six C9 orderings had NOT landed; N2 identified those omissions. **Repairs:** N1 adds a 260-epoch host model driving the program's expiry/unscheduling functions and a wrapped early-retirement arm. N2 lands the missing supply stamps, exact-five-picks and narrow-payout checks, reason pins, ordering/bookkeeping arms and two atomic v0 redemptions. N3-N4 exercise Core's thawed-vault authority boundary and helper refusal branches, zero-pair success and exact SOL delta. N5 measures packet headroom and redemption compute. N6 compares the shipped helper with the actual tested artifact and records deployment hashes. W1/W4 gain mainnet Token-2022 ATA refusal/classic-control and freeze-authority assertions. D1-D9 correct holder promises, snapshot voting, first-payout timing, missed captures, reserve-only redemption, Core/immutability/hot-key consequences and client obligations. L1-L4/L6-L7 and I1-I4 tighten the swap instruction judge, use chain time for oracle/split timing, classify failed sends, install hourly revenue cadence, exercise spot/freshness/deviation/10 SOL fork cases, gate program-ID copies, raise third-party upgrade alerts and verify detector arguments; confidence is 30 bps per USD feed, without a hard true-price-bound claim. L5 explicitly leaves both-venue live revenue and failure recovery as required dress-rehearsal evidence, not completed evidence. **Validation corrections:** two new thawed-vault test fixtures needed rent-exempt funding; one stale I3 documentation/comment site and the N6/W1/W4 omissions were independently confirmed and repaired. All five mainnet-feature program artifacts are byte-identical to certified `dist` at `2b67fb1`; no program logic changed. Green: **829 on-chain / 740 detector / 39 allocation / 22 poster / 14 PoB / 35 launch / 5 host plus Anchor test_id / 71 sim / 16 swap-fork**. The full runner's live-mainnet probe ran 24/24; the subsequently expanded probe ran **33/33** separately. Redemption: 1,061 bytes and 168,343 CU. Both venues passed the 10 SOL floor. Fresh disjoint round-26/27 rosters prepared before this repair commit; coverage is 33/33 files. Post-commit build and rehearsal regeneration are recorded separately when complete. | **counter 0 of 2** |
| 2026-10-05 | **`build-mainnet.sh`'s new sweep check REFUSED `82d4cbc`, correctly.** The sweep helper declared an empty `localnet` feature so the workspace's `--features localnet` build would accept it. An enabled feature enters the crate's metadata hash, which renames every symbol and reorders `.text` (686 bytes differed; `.rodata` identical), so the bytes the suite and sim ran could never equal the shipped bytes. Fix: the feature is removed (Cargo resolver 2 applies a workspace `--features` only to members that declare it). Measured: a `--features localnet` workspace build now produces a sweep `.so` byte-identical to the mainnet build. Source unchanged; the suite and sim are re-run on the new bytes before round 25 is certified. | **counter 0 of 2** |
| 2026-10-05 | **ROUND 24: NOT CLEAN (no CRITICAL; no program defect). Counter stays 0 of 2.** Audited `6e521db`. Programs pass 8 counted (OpenAI refused, `audits/round24/refused/`): 41 distinct, 10 CONFIRMED, all evidence gaps (C1-C10), 0 program defects; unclean because four holder-guide sentences were false (A1 "nudge", A3 "one attempt", D2 custodial "Not Gary Club", D1 boost refusal) and limits 26/46/47 were understated. Off-chain pass 7 counted: 20 CONFIRMED (1 HIGH H1, 1 MEDIUM M1, 13 LOW, 5 INFO). Verdicts: `audits/round24/VERDICT-programs.md`, `VERDICT-offchain.md`. **Gary ruled three things:** keep the Giraffish Moments key hot and document the full consequence (A2, SPEC 46 rewritten, a HOLDER-GUIDE item added); build a sweep-at-execution helper for redemption griefing (A3); and swap royalties through Orca direct with Meteora fallback, Jupiter dropped (M1). **Fixes, each tied to a confirmed finding:** (1) NEW native program `programs/cbob-vault-sweep` (`EB2uVvsa…`), stateless, ownerless, called through Core `ExecuteV1`; it moves live balances at execution so a deposit can no longer block an opening. Suite SR.0-SR.4a (incl. the staged dust race: the old exact-amount sweep fails on the SPL close, `NonNativeHasBalance` 0xb, and the helper then opens the same vault), sim S8.0-S8.2 (a redemption through the helper after dust), alarm watches its upgrade authority and bytes (selftest A3 arms), `build-mainnet.sh` proves its mainnet bytes identical to the tested ones, backups now include `target/deploy`. No vault program changed for it. (2) `bank/swap.mjs` + `revenue.mjs`: Pyth floor (full verification, 180 s, 1% confidence), pool deviation ≤ 100 bps, minimum out enforced on chain, an instruction judge before signing; proven on a mainnet fork (`sim/swap-fork.sh`, 10/10, SWAP_FLOOR 10). (3) C1-C10: BO.30-34c (terms legs, duplicate pair, post-transfer owner, ring wrap through the program's own index), E.7/E.7a (a five-kind proposal EXECUTED), 3.1y, 10.6 tightened, S7b.1-S7b.4 (boost in the sim, real quorum). (4) H1, L1-L13, I1: arms both ways in selftest's round-24 section; H1 also changed `/opt/scripts/alert-router.py` (urgent new text breaks through an open stream). (5) Docs: HOLDER-GUIDE, SPEC, DESIGN rewritten per the verdicts; comment-only corrections at SEAL:105-107 (A6, same line count, no byte change) and MINT:163-165 (A1: one line added, so MINT's bytes DO change, because Anchor 0.31 compiles `line!()` into every `require!`/`err!` site below it; no logic changed, and the suite, sim and build-mainnet in this row all ran on the new bytes); this log's round-23 row now says 4 host (+ Anchor's test_id) (D9). **The suite found one more thing while proving these (round 25 runs 1-4; plus the sim: S7b voted with vaults an earlier stage had moved, so it now votes only with vaults each signer still owns, S7b.0):** SPEC 54 said one piggybacked capture leaves a mint "a few percent under" the default 200,000 CU; run 3 died on a paid mint carrying one capture at exactly 200,000. New arm 10.6b measures it (187,094 at 512 slot hashes, so the margin is not dependable), SPEC 54 corrected, and every crank-carrying send in the suite now sets the compute limit as item 50 requires of the pages. No program change. Two test defects in the new SR arms were also fixed (a local `U` shadowing the signer helper; SR.3 pinned to the wrong reason), and the suite's error capture now keeps the helper's `CBOB_SWEEP refused` line so SR.2 is pinned to the helper's own refusal. Counts **774 on-chain / 677 detector / 67 sim / 10 swap-fork / 35 launch**. Round 25 audits the commit carrying this row, including the sweep program and swap.mjs. | **counter 0 of 2** |
| 2026-10-04 | **ROUND 23: NOT CLEAN (no CRITICAL, no HIGH in either pass). Counter stays 0 of 2.** Audited `9048cd0`, 6 of 8 counted per pass. Programs (`audits/round23/VERDICT-programs.md`): 9 confirmed. Off chain (`VERDICT-offchain.md`): 26 confirmed (4 MEDIUM, all alarm and crank; the crank's money math matched MINT across a 60,000-history differential). **Gary's rulings:** no gifted boosts (now `BoostNotTheOwner`); boost burn-through by 100 $GARY distributions is game theory (documented); redemption keeps its full emptiness check and stranger griefing is ACCEPTED; the $CBOB supply stays in the dedicated release wallet (limit 56). **Fixed, each proven both ways:** the buyer's boost terms (`BoostTermsMoved`); GOV's five-action text; 16 boost-ordering arms; host unit tests for skipped-slot entropy and the boost ring's wrap, mutation-checked; a test-only CPI wrapper attacking the redemption path (WR.1-WR.4); reason pins naming the program that refused; a unique-assertion-id guard (a reused `W.1` had pointed a pin at another arm); every off-chain finding (revenue clock, reveal-lane race, crank heartbeat, unswept royalties, live-only payments, launch-gate pins and more); SPEC, DESIGN and the holder guide corrected wherever they overstated. Counts **748 on-chain / 560 detectors / 39 accrual / 33 launch / 4 host (+ Anchor's generated test_id) / 60 sim**. Round 24 (`scripts/audit24.ts`, round 22's roster, none of round 23's) audits this commit. | counter 0 of 2 |
| 2026-10-04 | **`scripts/build-mainnet.sh` VERIFIED end to end for the first time since stage 3c.** The init-authority probe (`tests/initauth.test.ts`) had rotted for BURN and GOV too: stage 3c gave their `initialize` a cross-check account (SEAL's config, MINT's config) it never passed, so they answered INCONCLUSIVE and the build stopped. Now all four MAINNET artifacts REJECT the test key and all four LOCALNET controls reach a later check (BadBoostSetup, BadSealConfig, BadMintConfig, NoReserveMints). Sim **60/60** on the boost programs. Test-only change. | counter 0 of 2 |
| 2026-10-04 | **$CBOB CREATED ON MAINNET** (Gary approved and funded): mint `GMm2yY2z333tMkDSHTxNGuxNzr196XgWVCgr3odSKaXc`, tx `4cFqFECC...`, one transaction. Supply exactly 2,100,000,000 (6 decimals) in release wallet `AT2qf412...`; MINT AUTHORITY NONE, FREEZE AUTHORITY NONE, verified by the script's read-back AND independently by `spl-token display`; metadata mutable, update authority Gary's wallet. Pinned as RULED in the launch file, the launch gate and the alarm's production values. Lands after round 23's snapshot (`9048cd0`); round 24 covers it. | counter 0 of 2 |
| 2026-10-04 | **GARY RULED A PROGRAM CHANGE: the $CBOB boost (SPEC 51, built).** "Yes you can upgrade by burning CBOB": a TEMPORARY boost, beyond the caps, terms by Governor vote, off at launch, $CBOB mint pinned at init. MINT `boost_vault` / `expire_boosts` / `set_boost_terms`, per-record carry, `BoostsExpireFirst`; GOV `SetBoostTerms` (5th kind, ordered). Layouts MintConfig v6, VaultRecord v4 (record size unchanged), GovConfig v4; BURN's MINT version pin moved. Also ruled: F1 ACCEPTED (limit 55); boost ceilings 12 weight / 24 distributions; swap operator key generated. Found and fixed on the way: `tests/initauth.test.ts` had not matched MINT's `initialize` since stage 3c (build-mainnet.sh would have stopped); P.12a and BO.7c assumed no prior sub-sat dust (data-dependent, rewritten to the real invariant). Counts **720 / 509 / 39 / 27 launch**. The frozen tree CHANGED, so round 23 audits this commit, not baa7d0b. | counter 0 of 2 |
| 2026-10-04 | **The rehearsal tree's own suite found one thing the reverse-proof could not.** `bank/selftest.mjs` matched an error with the ABBREVIATED id `/not .*Gsb7/`, which a full-id substitution never touches, so at throwaway ids the detector selftest went 497/498. Test fixed to build its matcher from `L.PROGRAM_IDS.mint`; `scripts/rehearsal-tree.sh` now refuses any 4+ char prefix of a mainnet id left anywhere in the code. It was the only abbreviated id in the code (measured). Test-only; no detector or program changed. | counter 0 of 2 |
| 2026-10-04 | **Round 22 D7 measured (SPEC 54), no program change.** Suite arms 10.5/10.6/10.6a, simulated: one capture 114,598 CU; a mint carrying the full crank of 4 costs 518,929, REFUSED under the default 200,000 budget. The bank's crank sends captures alone and is unaffected; holder pages must set a compute limit on any crank-carrying transaction (rule added to item 54 for item 50). Round 22 F-53 (rehearsal ids) addressed by `scripts/rehearsal-tree.sh`: a recorded five-substitution patch in a separate worktree, proven to reverse to HEAD byte for byte; the audited code is unchanged. Suite **655** (was 652). | counter 0 of 2 |
| 2026-10-04 | **ROUND 22: NOT CLEAN (no CRITICAL, no HIGH in either pass). Counter stays 0 of 2.** Programs pass 6/8 (`audits/round22/VERDICT-programs.md`): 1 LOW program edge (F1, unsplit revenue around activation: put to Gary), 1 INFO tie (F12, FIXED: a stop wins a same-second restart, MINT and GOV), suite evidence gaps FIXED (NO votes and ThresholdNotMet, the draw re-derived from the raw SlotHashes sysvar, waiting-vault retires, arms that could not fail). Off-chain pass 7/8 (`VERDICT-offchain.md`): 27 confirmed (7 MEDIUM, incl. a false CRITICAL on every honest redemption), all FIXED in `2de0d00`. Holder guide: seven overstatements corrected. SPEC limits 25, 26, 28, 43, 46 corrected; open items 51-54 added. Counts **652 / 498 / 31 / 22 poster / 14 PoB / 22 launch / 24 mainnet / 60 sim**. Round 23 (`scripts/audit23.ts`, a roster sharing no model with round 22) waits on Gary's two rulings (level-ups by $CBOB burn: build or drop; F1: accept or fix on chain). | **counter 0 of 2** |
| 2026-10-03 | **⛔ THE v6 FREEZE STARTS. FROZEN AT `baa7d0b`.** Stage 3c (`9312275`) plus the Test Vault simulation (59/59: real Core, the real cbBTC/$GARY/$GIRAFFISH mints, two real mainnet Proof of Burn assets) and the launch-values checker. From here until two consecutive clean rounds: **nothing is committed to `programs/`, `bank/`, `scripts/`, `tests/` or `sim/` except a fix for a finding that survived measurement**, and any such commit RESETS the counter to zero and is logged here with why. `audits/` and docs are free. The definition of clean does not move. Round 22 (`scripts/audit22.ts`, roster: opus-5.5, gpt-6.1-sol-pro, gpt-6-astra-pro, grok-4.7, qwen3.8-max-prime, glm-5.3-prime, deepseek-v4-pro-0813, mimo-v2.6-pro) audits the four programs WHOLE (programs pass) and `bank/` (off-chain pass). Round 23 must use a different roster. Counts **645 / 458 / 31 allocation / 20 poster / 14 PoB / 15 launch / 24 mainnet / 59 sim**. | **FROZEN, counter 0 of 2** |
| 2026-10-03 | **v6 STAGE 3c — red-team 2 and red-team 3 fixed, `./scripts/run-tests.sh` GREEN at 645 (counter stays 0).** Guardian and swap-operator changes need YES from half of ALL live vaults, never share a proposal, land after a notice (`arm_guardian`/`apply_guardian`, 7 days on mainnet); the guardian may `cancel_swap_operator`. `TightenSweep` bounded by values fixed at `initialize` (Gary ruled 1 SOL / 24 h / 0.1 SOL). Two-step activation (request, join after the next distribution) and, found by the suite, `JoinWaitingFirst`: no distribution while an eligible vault waits, which makes every join exact. Overtaken actions are logged no-ops. BURN's cap is a rolling window over a 64-slot ring (replayed from chain, RL.7). `initialize` cross-checks SEAL/MINT/BURN/GOV. The charter claim passes Oracle accounts through to Core (tested against a real Core Oracle plugin). Red-team 3 (`audits/v6-redteam/RT3-stage3c.md`): no CRITICAL/HIGH; the MEDIUM (a frozen pool locked every activated vault) fixed by forfeiting the undelivered share; six LOW fixed. SPEC.md rewritten to v6. The runner now streams the suite to `.cache/suite.log` with a 2 h bound (a validator died silently mid-run and the suite hung 3.5 h). Counts **645 / 458 / 31 allocation / 20 poster / 14 PoB / 24 mainnet**. | **counter 0 of 2** |
| 2026-10-03 | **v6 STAGE 4 — the off-chain side matches v6, and `./scripts/run-tests.sh` is GREEN END TO END again (counter stays reset).** Retired with the Bank and the distributor: `bank/cosign.mjs`, `bank/deck.mjs`, `bank/distribute.mjs`, `scripts/bank-sign.sh` (removed in `0dd1f5a`), every Bank/admin/deck/distribution detector and selftest arm. New: `bank/layout.mjs` (every v6 layout once, field lists and every cross-program pinned offset asserted against the Rust, and the suite's own OFF_ constants against it), `bank/accrual.mjs` (the program's payout arithmetic; the new allocation suite), `bank/crank.mjs` (layer one: every-minute reveal lane + hourly activate/distribute/claims; fee-only key refused above 0.25 SOL; installed dry-run), `bank/redemption-poster.mjs` (drafts only, no sender). The alarm reads through the layout and adds overdue distribution, pool health, the 2.1% bucket, brake transitions and reschedule/frozen-claim events (URGENT; attributed by invoke stack), upgrade authority past `CBOB_LOCK_DEADLINE`, and the PoB collection's plugins (RT2-1). The control table is rewritten for v6 and its ON-CHAIN column is now verified against each program's error enum. On-chain +7 (X.1-X.7: the readers against the bytes the programs wrote, incl. the crank's attribute hash on real Core). Counts **576 / 439 / 29 allocation / 20 poster / 14 PoB / 24 mainnet**, all green, every floor equal to its count. | **counter 0 of 2** |
| 2026-10-03 | **v6 STAGE 3b — a vote reaches only what may safely change; redemptions are rate-limited; a distribution is 100 $GARY burned or a month, and the month runs itself (counter stays reset).** Red-team 1 finding 1 (the FIRST charter vault carried any vote alone) closed by rule C (no proposal before `charter_closes_at`, RT1.1) plus D (YES >= 10% of live supply, D.1) and A (split, both destinations, `max_supply` fixed at `initialize`; `update_wiring` deleted). Finding 2 closed: ordering per kind (RT1.2). B: `tighten_sweep` only tightens (monotone), `arm_swap_operator` + 7-day `apply_swap_operator`. E: up to 4 actions, one per kind, atomic (E.2/E.3, 65,848 CU). `restart` refuses a vote older than the stop (3b.S1). BURN: `ceil(2.1% x live)` per window (floor 1) as a continuous token bucket (RL.*); 0 bytes for the limit, +33 for the pool account the in-line run needs: 3-mint redemption 1,153 B. `distribute(burn)`: exactly 100 $GARY SPL-burned (PG.*, 10,737 CU, 344 B) or the period; the period's distribution runs in-line in mint/charter/activate/claim/redemption, once per period (IN.1-IN.5). Period, redemption window are `initialize` values: mainnet MUST be 30 days and 3600 s. On-chain suite **569/569**, mainnet probe 24/24; `bank/` still stale until stage 4. | **counter 0 of 2** |
| 2026-10-03 | **v6 STAGE 3 — the community pool, and no level without entropy (counter stays reset).** The 85% lives in MINT's config-PDA cbBTC account; `activate`/`distribute`/batched `claim` pay activated vaults by weight 2..6 INTO their own cbBTC accounts (never creating one; a frozen one is deferred, still owed); BURN retires a redeemed vault in MINT by CPI and refuses while a sat is owed; `retire_burned` handles bare Core burns and GOV's live supply counts them. Gary: *"We can't lock everyone in the lowest level"* — a missed capture window is RESCHEDULED, four instructions crank queued vaults, and entropy is three slot hashes from three leader rotations (red-team; the last leader's influence is accepted limit 26, not closed). Stored attributes bounded at 640 bytes so a legacy reveal always fits. Measured: 3-mint redemption 1,120 B (was 1,021; ceiling 4 -> 3, still every reserve asset), 1,169 B with the claim; three-mint redemptions must open destination ATAs in a prior tx; 14 vaults per legacy claim; VaultRecord rent unchanged (2,429,040 lamports). On-chain suite **492/492**; `bank/` is stale (detector selftest 437/448) until stage 4. | **counter 0 of 2** |
| 2026-10-03 | **v6 STAGE 2 — counter stays at zero (it reset at stage 1).** The deck is gone: levels are drawn after the mint from a slot hash 16 slots ahead (`capture_entropy` any order, `reveal_level` strictly FIFO, lowest level on expiry). The charter claim CPI-burns one Proof of Burn pinned by ADDRESS (Merkle root of the 240 mainnet assets; a PoB is not its own collection and its name/uri are hot-key writable), inside a window fixed at initialize and out of the guardian's reach. Voted rounds are paid in cbBTC, floor 21,000 sats. Governance is the GOV PDA from `initialize`; no wallet ever holds it. GOV: votes only from vaults older than the proposal; quorum divisor is live supply (BURN now counts burns). Royalties: 10% installed once by `initialize` with plugin authority NONE on a collection that must arrive with no plugin; `set_collection_royalties` deleted. Suite rewritten in production order (charter vaults vote the first round): **392/392** on a fresh validator with real mainnet Core, every quota filled exactly and every captured draw replayed. Mainnet probe **23/23** (PoB set re-derived from raw accounts). Two false passes caught in my own new arms before commit (an SDK client error recorded as a Core refusal; a pad probe that measured its own loop ceiling). ⚠️ `bank/` is stale against v6 and `run-tests.sh` still dies at the detector selftest before reaching the on-chain suite. | **counter 0 of 2** |
| 2026-10-03 | **⛔ COUNTER RESET for v6 stage 1 (Gary 2026-10-03 redesign).** First `programs/` commit of v6: the Bank signer is removed from SEAL `open_for_redemption`, BURN `burn_vault` and MINT `mint_vault` (with the on-chain Bank-key confinement walks, the bank config fields and every Bank rotation); the admin role is removed from all four programs; MINT gains a guardian with two ONE-WAY stops (`emergency_stop_sales`, `emergency_stop_sweep`) that only a governance `restart` lifts, and governance alone can `set_guardian`; GOV proposals carry one of three actions (SetRound, Brakes, UpdateWiring); INIT_AUTHORITY is Gary's wallet `Hc6WGt2k…` in all four. All four config layouts moved (SEAL/MINT/GOV/BURN version 2). Not deployed anywhere. The counter is zero and stays zero until v6 is complete and frozen. | **counter 0 of 2 (RESET)** |
| 2026-10-03 | **v6 REDESIGN DECIDED BY GARY — the freeze will be lifted to build it.** The program becomes the second signer (no Bank key), the 85% lives in a program pool paid by permissionless claims into each vault, admin is Gary's wallet `Hc6WGt2k…`, the CBOBTC Squads only receives the 15%, sales pause is vote-only, and the programs go IMMUTABLE at launch. Design: `DESIGN-v6.md`. Nothing under `programs/`, `bank/` or `scripts/` has changed yet; the first such commit resets the counter, and that is correct, because v6 is the version that must earn the two clean rounds. | **counter 0 of 2 (reset pending)** |
| 2026-08-24 | **ROUND 21 — NOT CLEAN, counter stays at zero. But the INSTRUMENT finally worked.** **7 of 8 on BOTH passes**, both `rc=0`, one tree (`3897467`), `dirty=[]` — the first round in this project's history where both halves reached quorum with margin and neither needed the runner fixed before its findings could be trusted. Only loss: `xiaomi/mimo-v2.5-pro`, reasoning-only on both passes; it joins `kimi-k3` as structurally unable to audit this project. **Two of the four findings were mine from hours earlier.** (1) `bank/deck.mjs` NAMED A CONTROL THAT DID NOT EXIST — "selftest checks the relationship and the alarm watches it in production", offered as the reason `commit_deck` need not verify the root on chain; a grep returned nothing. The over-claim defect, in the same sitting as the fix for an under-claim. Built now: `detectDeckCommitment`, nine both-ways arms, wired into the alarm. (2) A SKIPPED SLOT COULD BRICK THE LAUNCH PERMANENTLY — I reasoned about an operator missing the window and wrote "fatal by design"; Solana skips slots, so the aimed slot may never exist at all. Fixed with the smallest PRODUCED slot in a bounded window, which is deterministic where "newest in the buffer" would have been grindable. (3) A burn is identified POSITIVELY now, at both sites — absent is not burned, and the overbroad test was in the payment loop first. (4) Accepted limit 24, **OPEN TO GARY**: the deck is fair, the QUEUE is not — the Bank co-signs every mint, so it chooses who reaches which index. ⚠️ **The skip branch is reasoned, not measured** — a local validator never skips, so it is unexercised; 2.0j/2.0k pin only the invariant that holds either way. Counts **332 / 448 / 103 / 17 / 19**. Verdict `audits/round21/`. | **counter 0 of 2** |
| 2026-08-24 | **⛔ COUNTER RESET TO ZERO — round 20 was NOT clean, and the reset is the system working.** The freeze held for exactly one round and caught a CRITICAL in the newest, least-read code, which is what it is for. `bank/deck.mjs` reached an auditor for the first time in twenty rounds — the one file `audit-coverage.sh` named as never sent — and **six of six programs auditors, four model families, independently found the same root cause**: `commit_deck` accepted ANY 32 bytes, so the seed scheme described in two files was enforced by nothing, and a Bank that co-signs every mint (and so controls minter ORDER) could hand-build a favourable deck. Fixed on chain with `commit_seed` + a `commit_deck` that derives and PUBLISHES the seed itself; the program picks the entropy slot so the Bank cannot even choose that. Non-revelation is now impossible rather than mitigated. Also: **my Phase-1 discharge of item 19 was wrong** (a bare burn — and in v5 redemption IS a burn — halted every payout while two loops in one file disagreed about the same event); **accepted limit 1a under-claimed**, frozen one day earlier from a stale source without measuring, in the very section built to stop that; and **11.11 was a gate that could not fail** (`7 < 8`, true by construction). ⚠️ **And the repairs carried two defects of their own, both caught by the suite** — a reject for the wrong reason from check ordering, and a probe-ceiling fix that was itself a probe ceiling (12 at three different depths). A fix is a place a defect can live, ninth round running. Packet budget measured at last: **29 / 18 / 13** attributes at depth 7 / 11 / 13 against a program ceiling of 7, so at the real census the PROGRAM binds and deck size does not squeeze provenance — refuting an auditor CRITICAL and reversing limit 23's own conclusion. Counts **330 / 439 / 103 / 17 / 19**, all green. Verdict `audits/round20/VERDICT.md`. **The off-chain pass reached only 5 of 8 (three provider-side failures) and is NOT verdict-bearing — that half is unaudited and must be re-run.** | **counter 0 of 2** |
| 2026-08-24 | **⛔ THE FREEZE STARTS. FROZEN AT `bf18354`.** The first freeze in twenty rounds; Phases 0 and 1 are done and this commit changes nothing under `programs/`, `bank/` or `scripts/`. From here until two consecutive clean rounds are in the book: **nothing is committed to `programs/`, `bank/` or `scripts/` except a fix for a finding that survived measurement**, and any such commit RESETS the counter to zero and is logged here with why it was unavoidable. No opportunistic tidying, no comment improvements, no "while I am in here". `audits/` and docs are free. **The definition of clean does not move**: a finding that survives measurement is a finding, and loosening that to protect a streak is the gate-that-flatters-its-own-margin defect applied to the process itself. Frozen state: **316** on-chain / **439** detector / **103** allocation / **17** deck / **19** mainnet, all green, every floor EQUAL to its count; coverage **28 of 28**. Nothing is deployed, nothing has minted, nothing holds real value. | **FROZEN — counter 0 of 2** |
| 2026-08-24 | **PHASE 1 DONE — the accepted limits are written down, and writing them down found four defects.** The list lives in `SPEC.md` → ACCEPTED LIMITS in three states (ACCEPTED / OPEN AND BLOCKING / DISCHARGED) and the round-20 prompt READS IT FROM THERE rather than carrying a copy — round 19's prompt had its own hand-written copy whose item 16 was a different limit from this file's item 16, in the one artifact whose purpose is to stop a limit being re-reported as new. Discharged by measurement: **12/17** compute units (byte wall binds >25x before the compute wall), **14** duplicate attribute keys, **19** the unlevelled-vault halt (closed BY CONSTRUCTION — it never needed the product decision this file reserved for Gary), and **9** narrowed from a capability gap to a timing one. ⚠️ SPEC was still asserting "compute units are NOT measured anywhere" AFTER the commit titled "limit 17 clears"; still said 63 allocation assertions against a real 103; and THE SHIP GATE still said "thirteen rounds" and "270-assertion suite". **The gate built to catch exactly this read ONE occurrence of each of THREE floors** — it reads every occurrence of all five now, proven by poisoning the LAST match. New: 11.13/11.14/11.15 assert that neither the owner nor the Bank can rewrite a minted level and that the value survives, pinned to Core's `0x1a` NoApprovals. Counts **316 / 439 / 103 / 17 / 19**, all green. **The buyer-facing subset is NOT yet on a purchase surface and the sale may not open until it is.** | **pre-freeze; counter 0** |
| 2026-08-23 | **ROUND 19 — NOT CLEAN. Sixteen findings accepted and fixed; the counter stays at zero.** Three runs were needed and the first two could not seat a quorum, for THREE separate causes, each measured and each now a pre-flight: a provider POLICY REFUSAL counted as an auditor (`claude-fable-5`, `finish_reason: content_filter`, an 800-char JSON corpse that cleared the 600-char floor — round 18's defect verbatim inside the function written to end it; `disqualify()` is a whitelist now); CONTEXT TOO SMALL (deepseek-v3.2 at 163,840 and glm-4.7 at 204,800 refused at 400 once the bundle grew); and THE OUTPUT CAP BINDING ON THE BEST AUDITOR (opus-5 truncated at exactly 64,000 on both passes — run C then let it spend 76,939 and produce a 69,258-char report). Run C seated **8/8 and 7/8** at `2816e44`. Both run-C passes still exit 1 on the post-run working-tree check ADDED THIS ROUND, because the author edited the tree while fixing run C's own findings — the gate is right and was not argued down. **No CLEAN claim rests on any run.** The money findings: `cron-install.sh` silently stripped a hand-added `--dry-run` and re-armed the live cbBTC sender (which its own header tells the operator to add), and a COMMENTED-OUT revenue line armed the trusted hop; superseding a no-pay verdict cleared two of THREE marks and then three of FOUR (`resolvedBy`), so the suppressor list is now parsed out of the detector's own predicate. **The on-chain suite was RUN, four times** — the half round 18 flagged as outstanding — and that is the only reason the floor drift was findable: 286 real against a `MIN_ASSERTIONS` of 284 and a SPEC of 284. All four floors demand EQUALITY now. SPEC also still published the dust figure round 18 retired (6,404 vs a true 2,099) and claimed "no holder ever waits longer than a month even at zero volume", false in the case it names. Verdict: `audits/round19/VERDICT.md`. Counts **286 / 436 / 95 / 19**. **Phase 1 is STILL the next action.** | **still pre-freeze; counter 0** |
| 2026-08-23 | **Rounds 17 and 18 ran BEFORE Phase 1, against a moving tree.** Between `ab07526` and here the tree took a new money path (`54d1136`, the weighted Schedule of Vaults) and two audit rounds: round 17 (12 accepted, one CRITICAL — the round-15 theft still live on `mint_vault`) and round 18 (programs: a working exploit of an accepted-but-unfixed round-17 recommendation; off-chain: 14 accepted, this verdict). **The freeze has therefore still never started, and this row exists so nobody later reads two round numbers as two clean rounds.** Round 18's off-chain pass also reported EIGHT auditors and had SIX — one fetch failure, one degenerate repetition loop — which nothing measured until the verdict; the runner now refuses to exit 0 below quorum. Counts 284 / 401 / 63 / 19. | **still pre-freeze; counter 0** |
| 2026-08-22 | **Phase 0, design A** — commits `128501d`, `e4adb99`, and the Gary correction. `scripts/bank-sign.sh` (new), the control table's fourth column, new gate arms (+26, 355 → 381), three headers corrected. The co-signer was NOT wired — it cannot be; see Phase 0 above. **Nine** defects were found in this phase's own code — eight by the new gate (five the self-match, two of those in the comments explaining the rule; one a by-name exclusion that nearly shipped; two parser bugs, one failing open and one failing closed) and a ninth, fail-open and worse than any of them, found only by RUNNING the tool: the wrapper resolved a relative path against the repo instead of the operator's shell. Plus two prose errors caught by review. **A TENTH, found by Gary and worse than any of them: the co-signer row said PROCEDURE full stop, which reads as the Bank being skippable. The 2-of-2 is ON-CHAIN in two programs. The column now has three values and the ON-CHAIN one is checked against the Rust.** | pre-freeze |
