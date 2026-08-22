# Round 10 — verdict on every finding

8 auditors, same full surface. **Round 10 found live defects, so the stopping
condition set for this work was not reached.**

---

## A1 — HIGH — the swap operator rotated instantly, and the comment defending it was false

opus, its single thing. Round 8 moved `swap_operator` out from behind the
governance signature to admin-only, under a comment saying "replacing the swap
operator cannot redirect anyone's money: the destination it names is where OUR
SOL goes to be swapped, and every lamport comes back to the same revenue address".

**The first half of that sentence is refuted by the second.** The operator
address is where the swept SOL GOES. One admin signature pointing it at a key
the admin holds, followed by a permissionless sweep, is the treasury — and the
round-8 reasoning read straight past it because it was thinking about the
RETURN leg.

**Fixed:** the rotation goes through the notice period like the Bank and the
admin. Nothing is lost operationally, because the immediate emergency response
was never the rotation: `set_paused` is admin-only, takes effect in the same
transaction, and stops `sweep_sol_for_swap` outright. Stop the bleeding now,
change the address in public.

## A2 — HIGH — an undelivered CRITICAL was destroyed by the pass that raised it

opus. `detectDeferredSweeps` returns `keep`, which drops anything it has just
REPORTED — correct when the report goes out, and wrong when it does not. The
delivery-failure branch carried every other baseline forward and not this one, so
an `unledgered_sweep` whose email failed was deleted along with the alert.

The loudest finding in the pipeline, erased by the bookkeeping of the pass that
found it. Round 9's own fix, one field short. **Fixed.**

## A3 — HIGH — `--dry-run` stamped the has-run marker

grok. A dry run writes no `state.json` (round 9) and still wrote
`.alarm-has-run`, so a dry run on a fresh box made the next REAL run refuse to
start. The two halves of one guard, added in the same round, disagreeing.
**Fixed.**

## A4 — HIGH — a split signature could close more than one cycle

luna-pro, terra-pro. `detectSplitClaims` asked only whether the signature had
been SEEN, so an old one pasted into a fresh row closed it for free — the same
class as the sweep row that claimed one lamport, on the other leg. **Fixed:**
reuse is checked across the whole ledger, ahead of the age horizon, so a
signature stolen from a cycle too old to verify is still caught.

## A5 — HIGH — a stranger could wedge the revenue pipeline for one transaction fee

opus. `split_revenue` is permissionless by design. A stranger front-running our
call leaves ours reverting on `NothingToSplit`, and the cycle then carries a
return with no `splitSig` — wedging every later run at the open-cycle guard, for
a split that DID happen correctly.

**Fixed by accepting the truth rather than fighting it.** Their split divided our
cbBTC by the same enforced rule to the same pinned addresses: the money is
exactly where it should be and only the bookkeeping is missing. An EMPTY revenue
ATA is the proof, so that case is recorded as `splitByOther` and the cycle
closes.

## A6 — MEDIUM — the refused/unconfirmed distinction, on the other side

glm. Round 9 taught `paymentState` to tell a program rejection from a
confirmation timeout and left `detectDistribution` reading `!r.sig`, so a REFUSED
transfer — a frozen destination ATA looks like this — read as unresolved forever
instead of as unpaid and retryable. **The fifth time in five rounds that a fix
landed on one of two identical sites.** Fixed, with its own finding kind.

## A7 — MEDIUM — the class-closing assertion did not cover everything

opus, grok. `gov.pending_admin` is branched on by `detectStandingRisks` and was
in neither `WATCH` nor `WATCHED_KEYS`, so round 9's mechanical check — the one
added precisely to stop a watched key going unread — did not cover it. **Fixed**
by asserting against everything the standing checks read, not the drift list plus
whatever was remembered.

## A8 — MEDIUM — the Core pin was defeatable by an environment variable

opus. `CBOB_CORE_SHA256` overrode the pinned hash, which is the same
defeat-by-environment already fixed for `MIN_ASSERTIONS` two rounds earlier and
left standing here. Anyone who would point the cache at a mock would set the
expected hash to match it. **Hardcoded.** Re-pinning Core is now a source edit
and a commit, which is the point: a Metaplex upgrade should be a decision.

## A9 — MEDIUM — the payout lock was shorter than the payout

grok. The stale-lock timeout was 6 hours against a run of up to ~2,100 sequential
confirmed transfers. A lock that expires while the work it guards is still
running lets a second runner break in mid-payout, which is the one thing it
exists to prevent. **20 hours**, still well inside the daily cadence.

## A10 — MEDIUM — an absent distributor ATA read as a quiet day

opus. `srcInfo ? … : 0n` made a MISSING token account indistinguishable from an
empty one, so the day was marked legitimately finished and nothing was reported.
A distributor never set up, or set up at the wrong address, would have looked
like a quiet day every day. **Fixed:** absent is a fault.

## A11 — MEDIUM/LOW — the rest

- Two money detectors had no resolution path, so an ambiguous transfer would nag
  forever with no way to answer it. `resolvedBy` closes one deliberately: a
  finding that cannot be answered is one that gets ignored rather than answered.
- The selftests had no assertion floor of their own, so a file that threw after
  two passing assertions exited 0. They have one now.

---

## REJECTED — and why

### D1 — "the money path is wired to Tokenkeg; CRITICAL if mainnet cbBTC is Token-2022" (grok, glm)
**REJECTED BY MEASUREMENT, and the measurement is now permanent.** cbBTC is owned
by `Tokenkeg`, with an 82-byte mint account and therefore no extensions — and so
are $GARY and $GIRAFFISH. Had it gone the other way it would have been the most
important finding of the night: the distributor's ATA would not exist, the split
could not execute, and no vault would ever be paid.

Both auditors were right that **it had never been asserted anywhere**, only
assumed. `scripts/probe-mainnet-facts.mjs` asserts it against mainnet now,
alongside the alarm's signature walk — the two facts this system rests on that a
local validator cannot test.

### D2 — "the Jupiter transaction is still not constrained to a swap" (luna-pro, terra-pro, opus)
**UPHELD, NOT FIXED, AND STATED — for the second round running.** The inspection
is one signer plus a forbidden list, and an address-lookup table can carry a
program it does not see. Resolving lookup tables and allowlisting a live
aggregator's routes would break on Jupiter's next release. The honest mitigation
is operational and is now written into the SPEC as an instruction rather than a
comfort: **the swap operator must hold nothing but the cycle's own funds.**

### D3 — "at charter scale one wallet clears quorum alone" (opus)
**ACCEPTED AS TRUE, REJECTED AS A DEFECT.** At 190 vaults and the 500 bps floor,
quorum is 10 votes and the largest holder has ~40. That is the concentration the
business states plainly ("one holder has ~21% and the top 3 wallets ~48%") and
accepted before a line was written. What a hostile majority can do is still
bounded by MINT: a real cap, a bounded window, and the lifetime `max_supply`.
It is a business fact, and the SPEC says so rather than the code pretending
otherwise.

### D4 — "`sol_reserve_lamports == 0` can brick low-price minting" (opus)
**NOT REPRODUCIBLE AS DESCRIBED.** A plain system transfer to a 0-data address
credits lamports without a rent check; `create_account` is what enforces the
minimum, and nothing here creates the revenue PDA. The deployed reserve is 0.05
SOL regardless, so the account never empties.

---

## Where this leaves the loop

Five rounds tonight, and **every one of them found something real** — so the
stopping condition ("two consecutive rounds where no finding survives
measurement") was not met and is not close.

What HAS changed is the location. Rounds 6 to 10 produced no surviving finding
in the vault mechanics: the seal, the 2-of-2, the burn emptiness proof, the
cross-program config pinning and the Core CPIs have been attacked by forty
auditor-passes without one landing. Every accepted finding in rounds 9 and 10 was
in the WATCHER or in the previous round's repair.

That is a real result and it is not the same as being finished. The pattern that
keeps producing findings is now nameable: **a fix is a change, and a change is a
place a defect can live** — and its most common shape here is a fix applied to
one of two identical sites, which has now happened five rounds running.
