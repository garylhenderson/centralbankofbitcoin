# Round 9 — verdict on every finding

8 auditors on the same full surface: `gpt-5.6-terra-pro`, `gpt-5.6-luna-pro`,
`grok-4.6`, `claude-opus-5`, `kimi-k3`, `glm-5.3`, `qwen3.8-2.4t-a95b`,
`minimax-m3`.

**For the fourth round running, most of what was found were defects in the
previous round's fixes.** Two of them were controls that did not run at all.

---

## A1 — HIGH — the Bank's notice period did not run

opus, grok, kimi, glm — four, independently. `mint.pending_bank` was added to
`detectConfigDrift`'s watch list AND to `detectStandingRisks`' rotation loop in
round 8, and **never added to `readConfigs`**. `cur['mint.pending_bank']` was
always `undefined`, so the standing check never fired and the drift comparison
was `undefined → undefined`.

The consequence is the whole point of round 8's work: admin arms a Bank rotation,
the notice period runs its course in total silence, anyone lands the permissionless
`apply_pending_bank`, and the co-signer on every mint is the attacker's — with
`mint.bank` drift, thirty minutes later, as the first anyone hears of it. The
timelock's compensating control was the alarm; the alarm was not looking.

**This is the third distinct instance of the same class in three rounds**
(`collection.hash` watched and never written, `detectIndexShortfall` wired with
counts, and now this), so it is closed mechanically rather than by another fix:
`readConfigs` now ASSERTS it produces every key the watchers reference and throws
otherwise. That assertion is a pure function, `missingWatchedKeys`, tested in
both directions — because the class is precisely "the detector was tested and the
wiring was not".

## A2 — HIGH — `apply_pending_admin` deleted a waiting Bank rotation

grok, unique. The two-line clear of `pending_bank` was pattern-matched into that
handler as well as into `initialize`, so a **permissionless** admin apply silently
cancelled a Bank rotation waiting out the same notice period. Combined with A1,
neither the arming nor the deletion would have been visible.

**Fixed.** Each rotation lands or is cancelled on its own.

## A3 — CRITICAL — the grace window was a hole, not a delay

kimi, unique and sharp. Round 8 gave `detectUnledgeredSweeps` a 15-minute grace so
it would not race `revenue.mjs` writing its row. **The scan cursor only moves
forward**, so a sweep skipped for being fresh is never fetched again: a sweep
timed a few minutes before a pass escaped examination entirely, and the
legitimate cron — sweep at `:41`, alarm at `:53` — is **always** inside the
window, so even an honest sweep whose row was lost would never be flagged.

That is round 7's headline control ("the alarm now reads sweeps off the chain")
defeated for exactly the case it exists for.

**Fixed:** `detectDeferredSweeps`. Sweeps too fresh to judge are carried in the
alarm's own state, re-checked every pass, resolved when a matching row appears
(with the amount compared) and raised as CRITICAL when they go stale without one.

## A4 — HIGH — a cycle that returned and never split was silent

kimi, glm. `cycleIsOpen` calls unsplit cbBTC "money the holders have not been
paid", and then nothing said so: `detectUnreconciledRevenue`'s only checks were
"returned nothing" and "returned less than quoted". A single failed split left
the ledger with a return, no `splitSig`, and no finding — with `revenue.mjs`'s own
guard throwing on its next run as the only signal, which makes the actor the sole
watcher of its own failure. That is the exact shape round 7 removed from the
sweep side and left standing here. **Fixed:** `cycle_unsplit`, HIGH.

## A5 — HIGH — `--dry-run` consumed findings

opus. `report()` returns "delivered" when it did not try to send, so a dry run
advanced every baseline and the CRITICAL it had just printed was never mentioned
again. **Fixed:** a dry run writes no state.

## A6 — MEDIUM/HIGH — three detectors on their way to permanent noise

kimi, glm. Each would have fired forever, and an alarm guaranteed to become noise
is an alarm nobody reads — by which point a real finding is indistinguishable
from the wolf-crying:

- `seenSplits.slice(-200)` kept the **oldest** and dropped the newest, because
  this pass's splits are prepended. From the 201st cycle on, every completed
  cycle would have raised a false `split_not_on_chain` on every pass. The slice
  is gone and the check is bounded by age, so a cycle too old to verify is not
  re-asked.
- A vault deliberately skipped as burned-mid-run has no signature, and the
  unresolved filter was `!r.sig` — so it read as an unresolved transfer forever.
- A day with no cbBTC to distribute left `startedAt` with no `finishedAt`, so
  `distribution_unfinished` fired every day until the first revenue arrived.

## A7 — HIGH — a refused transfer was treated as an unknown one

opus. `paymentState` returned `ambiguous` for any row without a signature. cbBTC
has a live freeze authority, so a frozen destination ATA is a **definite**
refusal: nothing landed, and the honest state is unpaid and retryable. Treating
it as ambiguous meant that vault was never paid again by any later run, on any
day. `revenue.mjs` learned to tell a program rejection from a confirmation
timeout in round 7 and this did not — the same fix landing on one of two sites,
for the fourth time in four rounds. **Fixed.**

## A8 — MEDIUM — the claim about the quorum divisor

opus. Round 8's comment said `max(snapshot, live)` means "a mint can only make a
proposal HARDER to pass". That is true for someone who does not vote the new
vaults and false for someone who does: N mints raise the bar by
`N * quorum_bps / 10_000` and add N whole votes, so it is net positive at any
quorum below 100%. **The claim is corrected rather than the code**, because the
alternatives were both rejected on their merits in earlier rounds: requiring
`minted_now == quorum_supply` kills liveness during any open round, and checking
a vault's creation slot is impossible because a Core asset does not carry one.
What `max` genuinely does is close the stale-snapshot attack completely and make
minting strictly less profitable than the live read it replaced. The control on
minting is the Bank co-signature, which is a written duty.

## A9 — LOW — BURN's non-reserve loop

minimax. It did not carry the three delegate/close-authority checks its sibling
loop does. Harmless today — once the asset is burned its signer PDA is
unreachable — but a difference between two loops that should agree is where the
next reader, or the next Core release, finds the gap. Six comparisons. **Fixed.**

---

## REJECTED — and why

### D1 — "`set_collection_royalties` may be missing a `Data` variant byte, and nothing asserts Core decoded it" (minimax)
**REJECTED BY MEASUREMENT — the assertion has existed since round 6.** Tests
6.26-6.30 add the plugin through the real CPI, fetch the collection back through
the Core SDK, and assert `basis_points` reads 500 and then 750 with the revenue
PDA as sole creator at 100%, against the pinned mainnet Core. minimax was given
the four programs and `bank/` but not the test file, and said so honestly ("what
I cannot prove from the materials in front of me"). The finding is wrong; the
caution behind it was right, and the test it asks for is the one that already
runs.

### D2 — "the Jupiter transaction validation does not constrain loaded programs or value flows" (luna-pro, terra-pro)
**UPHELD, NOT FIXED, AND STATED.** The check is one signer plus a small forbidden
list, and an address-lookup table can carry a program it does not see. Resolving
lookup tables and enforcing an allowlist against a live aggregator's routes is a
real piece of work that would break on Jupiter's next release, and the honest
mitigation is operational: **the swap operator must hold nothing but the cycle's
own funds.** That is now the standing instruction rather than a code change
pretending to be a bound. The blast radius is one capped, cooled-down sweep.

### D3 — "a vault can be burned between the `stillThere` check and the transfer" (terra-pro)
**UPHELD, INHERENT, STATED.** A bare Core burn cannot be prevented (proven
impossibility 1), so the check narrows a millisecond window and cannot close it.
The alternative — not paying — is worse.

---

## The process note

Round 9 found **two controls that did not run at all** and **three detectors
that would have become permanent noise**. Neither category is findable by reading
the design; both are only visible by asking what the previous round's repair
actually does when it runs.

The pattern across four rounds is now explicit enough to name: **a fix is a
change, and a change is a place a defect can live.** Two of this round's
findings — A1 and A7 — were the same mistake as an earlier round's, made again in
a neighbouring file. That is why A1's fix is a mechanical assertion rather than
another patch: the class has now recurred three times, and the third time is when
you stop fixing instances.
