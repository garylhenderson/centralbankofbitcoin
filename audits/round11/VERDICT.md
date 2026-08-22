# Round 11 — verdict on every finding

8 auditors, 7 returned (minimax/minimax-m3 died on a malformed response after
967s). **Round 11 found live defects, so the stopping condition set for this work
was not reached — eleven rounds running.**

The round was aimed at ROUND 10'S OWN REPAIRS, and at three files no auditor had
ever been shown: `tests/3prog.test.ts`, `bank/lock.mjs`, and the mainnet probe.
**Both of the most serious findings came out of those three files.** The steer was
the whole round.

---

## A1 — HIGH — `bank/lock.mjs` was not a lock. All seven auditors, six as their single thing

Three defects composed into exactly the double-payment the file's own header says
it exists to prevent, and a fourth made it silent:

- **The stale break was a plain overwrite.** `writeFileSync` with no `wx`, so two
  runners meeting one stale lock both wrote it and both returned ok. The single
  path that most needed `O_EXCL` was the one path without it.
- **Release was unconditional.** `unlinkSync` with no ownership test, from
  `finally`, so a slow-but-alive runner deleted its REPLACEMENT's lock on the way
  out and a third runner walked in.
- **Age was treated as death.** Nothing asked whether the holder was still
  running. Round 10 moved the timeout 6h -> 20h, which lowers the probability and
  establishes no exclusion.
- **`broke` was returned and never printed.** The comment promised *"Break it,
  but SAY SO"*; the only consumer in the repo was the selftest asserting the
  return value. **A property can be tested and still not be delivered.**

**Fixed:** break only when the holder is stale AND gone (`kill(pid, 0)`), unlink
then re-create with `wx` so exactly one of two racers wins, release by random
token, and say so loudly. A live holder is never stolen from — for a money job an
outage that pages is the right trade against a payment made twice.

The lost-race branch cannot be produced from one process, so there is a test seam
and it is asserted in both directions. **A branch that has only ever said one
thing is untested.**

## A2 — HIGH — a stranger could halt every distribution for one lamport (qwen, new)

`alarm.mjs` guarded its token reads with `data.length >= 72` in two places.
`distribute.mjs` and `revenue.mjs` guarded **none of their five**. `if (!info)`
separates ABSENT from PRESENT and never PRESENT from VALID, so a 1-lamport
transfer to any vault's derived cbBTC ATA makes `readBigUInt64LE(64)` throw a
RangeError and abort the whole daily payout, indefinitely, for a transaction fee.

**Fixed:** one reader, `bank/spl.mjs`, and the caller decides what each state
means — a poisoned vault ATA is a per-vault fault that the run reports and pays
around; a poisoned distributor or operator ATA is a refusal *before* anything
moves. The one-of-two-sites shape again, with the guard sitting in the sibling
file the whole time.

## A3 — HIGH — `splitByOther` read the wrong field, so round 10's repair would not have fired (opus)

It required the Anchor error NAME `NothingToSplit` in `e.message`. The name is
emitted in program LOGS; `.message` carries the RPC string. **The sibling
rejection test 120 lines up in the same file already knows this** and matches the
generic shape. The one site that leaned on the name was the one site reading the
wrong field — so the wedge it was written to prevent would have happened anyway.

**Fixed by deleting the text test.** The emptiness proof was already sound and
already there: `split_revenue` is the only instruction that can move tokens out
of the revenue ATA, it pins both destinations from config, and it always moves
the entire balance. A readable, Tokenkeg-owned, zero-balance revenue ATA is
proof, whoever paid for it. **And absent is not empty** — `rev ? … : 0n` would
have proven a split with an ATA that never existed, which is the same
absent-vs-empty confusion round 10 fixed one file over.

## A4 — MEDIUM — a `splitByOther` cycle closed on the ledger's own word (kimi, grok)

`detectSplitClaims` skipped those rows entirely, so a genuine front-run split sat
in `seenSplits` unclaimed and a later cycle could adopt it by asserting
`splitByOther: true`. Round 10 closed "two rows, one signature" and opened its
mirror. **Fixed:** N cycles claiming someone else split for them require at least
N splits on chain that no cycle claims by signature. No event parsing needed.

## A5 — MEDIUM — `WATCHED_KEYS` omitted all four `*.collection` keys (opus, kimi, glm, grok)

Round 10's claim — *"it now asserts against everything the standing checks
read"* — was false, in the mechanism built to close that exact class. Drop one
program's `collection` read and `collections_disagree` silently compares three
values and reads as calm, which is the `mint.pending_bank` shape exactly.

**Fixed with a shared array rather than an assertion.** `COLLECTION_KEYS` is now
the list the check reads AND the list the watcher watches, so they cannot drift.

## A6 — MEDIUM — `resolvedBy` landed on one of three sites (opus, kimi, glm)

`distribution_refused` and `distribution_unfinished` had no resolution path, and
cbBTC has a live freeze authority, so a frozen destination ATA nags a HIGH every
30 minutes forever. **The sixth round running of the one-of-two-sites class — and
the comment directly above the offending line narrates that class.** Fixed on all
three branches, and `paymentState` was taught the field too.

**A defect I introduced while fixing it, caught by writing the assertion out:**
`resolvedBy` first went BELOW the `rejected` test, so a refusal a human had
settled by hand read as unpaid and would have been sent a second time. The
resolution field turned into a double-payment. It is now above, and the payment
loop was taught the new state in the same edit — adding a state and updating one
of its two consumers is the very shape this commit exists to remove.

## A7 — MEDIUM — the 200-assertion suite never asserted the seal (opus)

2.3 read the freeze plugin's AUTHORITY and nothing read its STATE.
`NoTerminalClose` was never exercised. **No test ever asked the simplest question
of the whole product: can the owner just move the contents with no open at all?**
Flip `data.push(1) // frozen` to `0` in `mint_vault` and every assertion still
passed. The property a customer's Bitcoin rests on was the one a green run did
not test.

**Fixed:** `2.3a` asserts the plugin decodes `frozen: true`; `3.6` proves an open
with no terminal close is refused (`NoTerminalClose`); `3.7` proves a bare owner
Execute is refused by Core (`custom program error: 0x9`).

**And `3.7` was a FALSE PASS on its first run.** Sent with `[alice]` alone it
rejected for *"Missing signature for public key <bank>"* — the fee payer — and
never reached Core. `because()` caught it immediately, in the very test written
to close the false-pass class. Both new negatives also reuse an existing vault:
minting two fresh ones moved `minted_total`, which the governance section
measures quorum against, and six of section 7's assertions failed. **A test that
mints has a side effect on every later test that counts.**

## A8 — MEDIUM — seven negative assertions never checked WHY they rejected (opus, glm)

`because()` covered everything from §6 onward and nothing before it — so 3.1,
3.3, 4.1, 4.4, 5.1 and 8.12, which are the 2-of-2 and the emptiness proof, each
passed on ANY rejection. All are now checked by reason. `because()` also prints
the ACTUAL rejection when it fails, because a failing reason-check that does not
say what the reason was is a dead end.

**`because('8.12')` was placed in the early block, which runs before section 8
exists**, so `R.find` returned undefined and it failed on a test that had not
happened yet. Moved.

## A9 — MEDIUM — the bound on the bound, from both directions (opus, luna-pro)

- Admin ALONE could raise the cooldown to 7 days and drop the cap to 1 lamport.
  Recovery needs governance, and a hostile admin holds the cancel. **A wedge is
  not a theft and it is still the pipeline stopped.** Admin may now tighten only
  as far as a working pipeline (24h / 1 SOL); past that the holders are involved.
- The 50 SOL per-cycle bound existed only in `bank/revenue.mjs` and the docs; the
  program required `> 0`, **and the suite proved the point by running the whole
  system at a 100 SOL cap.** An off-chain constant cannot bound a caller.
  `MAX_SWEEP_LAMPORTS` is enforced at init and on update; the tests run at the
  real number and assert 51 SOL is refused even with the governance signature.
- The alarm watched only the loosening direction. `sweep_cooldown_wedged` and
  `sweep_cap_wedged` watch the other.

## A10 — MEDIUM — no migration path (opus)

Fields were appended to these configs in rounds 6, 8 and 10, `Initialize`
allocates exactly the current size, and there is no `realloc` in any of the four
programs. The next appended field breaks every `Account<Config>` deserialize —
in MINT that is `mint_vault`, `sweep_sol_for_swap` and **`split_revenue`, the
only instruction that can move cbBTC out of the revenue PDA.** 256 bytes of
`CONFIG_PADDING` in all four. It is not a migration path; it is the room to write
one in.

## A11 — the rest

- The alarm's idle branch wrote state BEFORE reporting and ignored `--dry-run` —
  the round-7 defect surviving in its idle twin. Reports first, advances only on
  delivery, writes nothing on a dry run.
- `readConfigs` verified neither owner nor discriminator before taking raw
  offsets, weaker than the on-chain siblings which pin both. Both are checked now,
  as preconditions rather than drift.
- `cycle_unsplit` had **no age gate at all**, so an alarm pass landing between
  step 3 and step 4 of a live cycle raised a HIGH about money being split as it
  read. Graced from a new `returnedAt`.
- The fee floor counted `!done[v]` while the loop sent on `paymentState() ===
  'unpaid'`. A day where every transfer was refused budgeted zero SOL and then
  attempted 2,100 transfers.
- `distribute.mjs --selftest` had no assertion floor while its twin got one last
  night. It has one.
- `signaturesSince` existed in two copies under a comment reading *"VERBATIM …
  If they drift, this proves nothing"* — and they had already drifted. Extracted
  to `bank/sigwalk.mjs`; the probe now asserts the function the alarm runs.
- The mainnet probe was wired into nothing, so "asserted permanently" meant
  asserted once by hand. It runs in `run-tests.sh`, skipping loudly with no
  network and fatal if it runs and fails.
- `splitSig` was stamped with the literal string `'split-by-another-caller'`.

---

## REJECTED — and why

### "the Jupiter transaction is still not constrained to a swap" (multiple)
**UPHELD, NOT FIXED, AND STATED — for the third round running.** The honest
mitigation is operational: the swap operator must hold nothing but the cycle's
own funds. Written in the SPEC as an instruction.

### "require a human to clear a stale lock rather than breaking it blind" (glm)
**PARTIALLY TAKEN.** A live holder is now never broken, which is the dangerous
half. A lock whose holder is provably gone is still broken automatically: a lock
that can only be cleared by hand is an outage waiting for the first crash, and
the crash is the case the break exists for.

### "use flock / an OS lease" (terra-pro)
**NOTED, NOT TAKEN.** Correct in principle and a larger change than this round
should make to two live money jobs. Token ownership plus a liveness test closes
the reachable failures; kernel-backed locking is the better long-term answer and
is recorded as such rather than half-built.

---

## Where this leaves the loop

**Eleven rounds, eleven with findings.** The stopping condition — two consecutive
rounds where no finding survives measurement — has been met zero times.

What changed this round is that the two files never shown to an auditor produced
the two most serious findings in it, which says the exposure was always in the
*unread* code rather than the much-read code. Rounds 6 to 11 have still produced
no surviving finding in the vault mechanics.

Three things happened during the FIXING that belong in the record, because they
are the same lesson at three sizes:

1. A `resolvedBy` test placed below `rejected` would have turned the resolution
   field into a double-payment.
2. The new bare-Execute test passed for the wrong reason on its first run.
3. Two new test vaults broke six governance assertions by moving `minted_total`.

**Every one was caught by an assertion written at the same time as the change,
and none by reading the diff.**

Counts: **217** on-chain assertions (was 200), **172** detector assertions (was
137), **17** allocation assertions (was 15), **11** mainnet facts. Floor raised
on every suite that has one.

A human audit firm on a frozen version is still owed before this holds real
Bitcoin.
