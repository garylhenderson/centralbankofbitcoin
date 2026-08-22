# Round 8 — verdict on every finding

8 auditors on the same full surface: `gpt-5.6-terra-pro`, `gpt-5.6-luna-pro`,
`grok-4.6`, `claude-opus-5`, `kimi-k3` (did not return in time), `glm-5.3`,
`qwen3.8-2.4t-a95b`, `minimax-m3`.

**Two of this round's findings were live defects in round 7's own repairs, and
one of them would have made the alarm cry wolf every thirty minutes forever.**

---

## A1 — CRITICAL — the completeness check was dead, and screaming

opus, grok, qwen. Round 7 changed `detectIndexShortfall` to take ARRAYS of asset
ids and updated `distribute.mjs`, which implements the same check inline. **Both
alarm call sites still passed `.length`.** `Array.isArray(number)` is false, so
the coercion produced empty sets, `seen` was always 0, and from the first mint
onward every pass would have emitted `index_disagrees_with_chain … returned 0
UNIQUE vaults but the chain says N` — a CRITICAL email every thirty minutes,
forever, while the check it was supposed to be doing did nothing.

**The selftest passed throughout**, because it calls the detector directly with
arrays. Detectors proven in both directions, wiring untested. `distribute.mjs`
got it right, which is why nothing else noticed.

**Fixed** at both call sites, and the function now **throws** on the wrong shape
rather than coercing it — a silent coercion makes a mis-wired call look exactly
like a real finding, which is the worse of the two failures.

## A2 — CRITICAL — the quorum snapshot froze the wrong direction

opus, glm, kimi, qwen. Round 6 froze `quorum_supply` so that minting could not
LOWER the bar mid-vote. A voting window may be 30 days and the execution window
adds 7, so a proposal opened the day after the ~190-vault charter round carries a
divisor of 190 and can be executed a month later against 2,100 live vaults: the
21% holder alone clears `need = 38` with their own vaults. Forwards, a vault
minted during the window added a whole vote and ZERO bar — the snapshot made
buying votes strictly cheaper than the live read it replaced.

**Fixed:** the divisor is `max(snapshot, live supply)`. The bar only ever rises
with supply that really exists, the PERCENTAGE is still the one the proposal
opened under, and a mint can now only make a proposal HARDER to pass — the safe
direction to fail in. It also makes `minted_now` load-bearing; it was read and
used for nothing but an event field, which is the assigned-and-never-read shape
this project has been burned by twice.

## A3 — CRITICAL — deleting a money ledger paid everyone twice

glm (its single thing), terra-pro, opus. Round 7 made a MISSING `state.json` a
refusal and left both MONEY ledgers reading absence as day one. `rm
distributions.json` — operator error, a partial restore, a disk cleanup, all as
the same uid as the signing keys — made every activated vault read as unpaid, and
the next run that day would have paid them all a second time. The lock does not
help: it stops two writers, not one fresh process holding an empty ledger.

The asymmetry is what makes it dangerous: a CORRUPT file already raised CRITICAL,
and only DELETION was quiet — and deletion is the easier accident. The alarm made
it worse by deliberately skipping its distribution detector when the file was
absent, so the one case that mattered was the one case it could not see.

**Fixed:** `readLedger` takes a marker, `writeLedger` stamps it, and a missing
file with the marker present is a refusal in all three ledgers. The alarm runs
the detector when the file OR its marker exists.

## A4 — HIGH — the post-sweep quote had the bug the pre-sweep one had fixed

luna-pro, terra-pro, grok, qwen — four, independently. Round 7 rejected a missing
`priceImpactPct` on the first quote and left `?? 0` on the second, which is the
one that matters: by then the SOL has already left the revenue address.

**This is the third round running in which a fix landed on one of two identical
sites.** Fixed, and the second quote is now also held to an output FLOOR against
the first — price impact measures a route's own depth, not whether the price
moved, so a shallow-impact route at a terrible rate passed it happily.

## A5 — HIGH — the ledger row was taken at its word about the amount

grok, qwen. `detectUnledgeredSweeps` matched a sweep to a ledger row **by
signature alone**. So whoever holds the operator key could sweep the cap, write
`{sweepSig, sweptLamports: '1', quotedSats: '1', returnedSats: '1'}`, and satisfy
every detector at once. Round 7's own rationale — the ledger is the audited key's
own testimony — applied to the check built to escape it.

**Fixed:** the amount is in the instruction data. It is decoded and compared, and
a mismatch is CRITICAL. A grace window was added at the same time so the alarm
does not raise a false CRITICAL on a sweep it scanned before `revenue.mjs` had
saved the row.

## A6 — HIGH — rotations waited in one program out of four

opus, grok. Round 7 timelocked MINT's `admin` and `governance` and stopped there,
on the reasoning that a hostile Bank can only refuse. That was wrong: **the Bank's
refusal is what stops a seller planting a delegate on a reserve ATA during a thaw
and then selling the vault**, so a Bank the attacker controls is a theft vector
against secondary buyers, not merely a denial. And SEAL is the program whose whole
claim is TRUE 2-of-2: one admin signature set `config.bank` in a single
transaction, with drift detection up to thirty minutes later as the only control.

**Fixed:** SEAL, BURN and GOV have the same arm/apply/cancel notice period, and
MINT's `bank` joined it. Every armed rotation in every program is now CRITICAL on
its face on **every** pass, because a finding that fires once fires while
everyone is asleep.

## A7 — HIGH — the return leg was still self-attested

opus, glm, qwen. Round 7 made the SWEEP chain-derived and left the RETURN resting
on `returnedSats`. **Fixed in two steps:** a cycle is not finished when the cbBTC
comes back but when it has been SPLIT — unsplit money in the revenue ATA is money
the holders have not been paid — and a claimed `splitSig` must appear in the
transaction scan. What is NOT closed is the AMOUNT, which lives in an Anchor
event log; that is stated in the detector rather than implied away.

## A8 — HIGH — `readConfigs` could not read a u32

qwen, unique. There was no `u32` case, so `mint.round_id` and `mint.cap` — added
in round 7 — fell through to `d[off]` and were read as a **single byte**. A
round_id of 256 would have read as 0 and drifted backwards. **Fixed**, and an
unknown width is now a throw rather than a one-byte read.

## A9 — MEDIUM — the fourth copy of the open-cycle predicate

glm, qwen. Round 7 exported `cycleIsOpen` to end the copies and left `audit()`'s
own filter, which had already drifted: it did not know about a sweep the program
REFUSED, so `--audit` would report a cycle as open that never moved a lamport.
**Fixed by deleting it.**

## A10 — MEDIUM — the Core byte-identity gate was a tautology

opus. The validator is booted with `--bpf-program CORE <cache file>`, then Core is
dumped off that validator and compared **to the same file**. It could not fail for
the reason it claimed to guard, and the only real validation was four bytes of ELF
magic — in a cache that defaulted into world-writable `/tmp`. A mock planted there
produced a green run under a banner reading "verified byte-identical to mainnet".

**Fixed:** the mainnet sha256 is pinned (`f03e7537…`, verified against two
independent `solana program dump` runs), the caches moved to
`/opt/cbob-vaults/.cache`, and an unpinned run says plainly that the comparison
below it proves nothing.

## A11 — MEDIUM — a legal reserve wedged every sweep, and the operator had no float

opus, glm. `sol_reserve_lamports` strictly between zero and rent exemption makes
the sweep leave a rent-paying account, which the runtime refuses — every six
hours, forever. And the operator pays for four transactions out of its own
balance, which nothing checked or funded: a fresh operator's first cycle would
sweep the SOL, buy the cbBTC, and fail to send it back for want of a few thousand
lamports. **Both fixed.**

## A12 — MEDIUM — the rest

- A vault burned between the plan being fixed and its turn in the payout loop was
  still paid, into a PDA nobody can redeem from (luna-pro).
- The deadman cron watched a hardcoded path while the alarm honours
  `CBOB_ALARM_STATE` — a watchdog on the wrong door (luna-pro).
- The four programs' `collection` fields were never compared (glm).
- `mint.bank`, `gov.proposal_count` and every pending-rotation slot were unwatched
  (grok, opus).
- Quorum could floor to ZERO, and `threshold_bps` could ratchet to unanimity,
  which ends governance permanently on one irreversible signature (luna-pro, opus).
- Comment drift: `split_bps` still justified by a royalty mechanism that does not
  exist, and the quorum comment still carried the argument round 7 broke.

---

## REJECTED — and why

### D1 — "distribution is wired to an impossible treasury" (luna-pro, its single thing)
**REJECTED — the premise is wrong.** `config.treasury` is the DISTRIBUTOR wallet.
The account that `mint_vault` pinned to the revenue PDA merely SHARED the name.
Two different things, one word — and the auditor read them as the same field and
concluded distributions could never work. They were wrong, and **the name was
wrong enough to make them wrong**, so the account is renamed `revenue`. A finding
that is incorrect can still be evidence.

### D2 — "constrain the mint in `split_revenue` to an allowlist" (minimax, its single thing)
**REJECTED ON DESIGN.** Working for any token is deliberate: a future income
source in something else needs no new code. The token program is pinned to
classic SPL, so no Token-2022 transfer hook can ride in, and the worst a griefer
achieves is paying, out of their own SOL, to create an ATA holding a worthless
token at an address that already exists.

### D3 — "`create_proposal` permits `opens_at` in the past" (minimax)
**NOT A DEFECT.** A round that opens immediately is the ordinary case. What it may
NOT do is install a round that has already CLOSED, and that is checked.

### D4 — "the assertion floor of 160 contradicts the 82-assertion suite" (opus)
**NOT A DEFECT**, for the second round running. The 82 is text in an earlier
round's prompt describing the suite before that round's tests existed. The floor
is 160 against 195.

---

## The process note

**Round 8 found two live defects in round 7's fixes, and one of them was a
detector that would have emailed a CRITICAL every thirty minutes.** Neither was
findable by reviewing the original design. The selftest suite is now 120
assertions and every detector is proven in both directions — and A1 is the
standing reminder that **a detector proven in both directions can still be wired
to nothing.** The only guard against that class is to make the wrong shape fail
loudly instead of quietly, which is what the fix does.
