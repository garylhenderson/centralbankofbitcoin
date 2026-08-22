# Round 12 — verdict on every finding

8 auditors, **6 usable**: `kimi-k3` returned reasoning only (no final answer) and
`minimax-m3` truncated at the output limit. kimi's reasoning was read anyway — it
corroborates the round-11 repairs and raises no defect the six did not.

**Round 12 found more than round 11 did, and the two worst findings were defects
in round 11's own repairs.** Twelve rounds, twelve with findings.

---

## A1 — CRITICAL — the split anchor was purchasable for pocket change (glm)

`seenSplits` was built from any MINT transaction carrying the `split_revenue`
discriminator, **with no check of which mint was split** — and `split_revenue`
works for ANY token by design (round 8). So anyone could manufacture unlimited
"splits" for a few cents: create the revenue PDA's ATA for a junk mint
(permissionless), create the two destination ATAs, send dust, call
`split_revenue(junkMint)`. Each one is a real MINT transaction claimed by no
cycle, and it satisfied **both** closure paths — a fabricated `splitSig` and the
round-11 `splitByOther` anchor.

The exploit is the adversary the alarm was built for: a compromised operator box
sweeps 50 SOL, never swaps, writes `returnedSats = quotedSats` and a junk
`splitSig`. Every detector passes. Zero findings while the treasury drains one
cooldown at a time.

**Fixed:** the split must be a split of **cbBTC** (`mint` is account index 2 of
`SplitRevenue`). The reconciliation of the one trusted hop — the alarm's entire
reason for existing — was one line from being worthless.

## A2 — HIGH — round 11's split anchor was cardinality, not attribution (terra-pro)

It asked only whether the NUMBER of unclaimed splits was at least the number of
cycles claiming one. It bound no split to any cycle: not by amount, not by
return, **not even by ordering**. `seenSplits` is kept forever and carried no
block times, so one unclaimed split — including one that landed before the cycle
existed — could vouch for a cycle indefinitely.

**And my own round-11 selftest asserted that as correct**, passing a bare
`'orphanSig'` with no temporal relationship to anything. The test certified the
weakness.

**Fixed:** entries carry block time; each `splitByOther` cycle must match its own
anchor, a cbBTC split at or after that cycle's return, and each anchor is
consumed so one split cannot vouch for two. An entry with no block time cannot
anchor at all. Four new assertions cover before-the-return, one-for-two, the
bare-string case, and the honest case.

## A3 — HIGH — the horizon was computed from a field the operator writes (qwen)

`startedAt` is written by the same process that holds the operator key, and the
30-day upper bound was computed from it — so a compromised operator that swept
50 SOL and kept it needed only to **backdate the row**. `detectSplitClaims` then
skipped the cycle and never asked whether a split existed. The stated rationale
("the scan has moved past it") was false: `seenSplits` is deliberately never
sliced.

**Fixed:** the horizon is a **ledger position**, not a claimed timestamp. A
backdated row is still one of the most recent entries. The lower grace bound
stays on the clock, because it only ever suppresses a cycle genuinely in flight.

## A4 — HIGH — the operator-ATA guard was AFTER the sweep (opus, grok, glm, luna-pro)

Round 11 replaced `?? 0n` with `requireTokenAmount`, which **throws on absent**,
and placed it 27 lines after up to 50 SOL had already left the revenue address —
under a comment I wrote reading *"It is checked here, before anything moves."*

An absent operator cbBTC ATA is not a poisoned account: it is the **normal** state
of the first live cycle and of every cycle after an operator rotation, and
nothing in the repo creates it (Jupiter would have, and never runs). So the
repair converted a routine first-run condition into a hard fault positioned after
the money moved — SOL on the operator, an open cycle, and every later run dead at
the open-cycle guard until a human finished the swap by hand.

**The fix was worse than the defect it replaced.** Now the ATA is measured and
created idempotently **before** the intent row and the sweep; absent is zero for
a delta baseline, while foreign and malformed still refuse. The absent-is-not-
empty rule governs PROOFS, not balance reads.

## A5 — HIGH — the lock break was still not exclusive (qwen, glm)

The round-11 rewrite made the CREATE exclusive with `wx` and left the UNLINK
unguarded:

```
A reads a stale dead lock.   B reads the same stale dead lock.
A unlinks, creates -> A HOLDS and starts paying.
B unlinks (DELETING A'S FRESH LOCK), creates -> B HOLDS TOO.
```

Both runners pay every activated vault. And **the `_afterUnlink` seam I added
tests the other interleaving**, so the broken branch was the untested one.

Compounding it (opus): an **unreadable or zero-length** lock skipped both the
freshness gate (`Date.parse(undefined)` is NaN) and the liveness gate (no pid)
and was broken — reporting `broke: null`, which `withLock` prints nothing for. The
"SAY SO" promise failed on precisely the break that is unsafe. `writeFileSync`
with `wx` is open-then-write, so the file is genuinely observable at zero bytes.

**Fixed:** the lock is created by `link()` from a temp file — one atomic syscall,
never visible half-written. An unreadable or empty lock is a **refusal**, never a
break. The break re-reads and requires the same token immediately before the
unlink. A recycled pid is detected by comparing `/proc/<pid>/stat` start time, so
a crashed run whose pid got reused no longer makes the lock permanently
unbreakable. Nine new assertions, including a second seam for the interleaving
the first one missed.

A microsecond TOCTOU remains between the re-read and the unlink. The durable
answer is a lock nobody has to break — an OS lease on an open fd — recorded as
the next step rather than half-built here.

## A6 — HIGH — poisoned vault ATAs were logged, not reported (luna-pro, opus)

Round 11 stopped the one-lamport crash and sent the fault to `console.error` and
nowhere else — not the ledger, not a detector, not the notification path. The
comment said "reported"; the code logged. A vault an attacker poisoned was
quietly never paid, its share divided among the others, and the day still
recorded `finishedAt`. **A stderr line on a cron is not a report.** Now persisted
as `unreadableAtas`, raised as `distribution_vault_unreadable` (HIGH), and
closable with `resolvedBy`.

## A7 — MEDIUM — the wedge floors bound `update_wiring` and not `initialize` (glm)

Round 11 bound the sweep CEILING at init with the explicit reasoning that "the one
value that is never updated" most needs it — and did not apply the same to the
FLOOR or the cooldown ceiling. `initialize` accepted a 1-lamport cap and a 7-day
cooldown, so a launch typo wedged the pipeline exactly as round 11 legislated
against, with recovery requiring a governance rotation. **The fix's own rationale,
not applied to its sibling path.** Both now bound at init.

## A8 — MEDIUM — the watcher's thresholds were the program's own limits (opus)

`MIN_ADMIN_SWEEP_LAMPORTS` and `MAX_ADMIN_SWEEP_COOLDOWN_SECS` were also the
standing checks' thresholds, so an admin could sit **exactly** on 1 SOL / 24h and
both checks stayed quiet while the cycle moved 1 SOL a day against an expected
50. A watcher whose threshold is the legal limit can always be sat on exactly.
Moved strictly inside: 5 SOL / 12h.

## A9 — MEDIUM — an unresolvable scan cursor makes the scanner silently blind (opus)

`until` is a sentinel, and one the cluster cannot resolve returns an **empty
list**, not an error. A cursor taken at `'confirmed'` whose transaction is later
forked out or pruned leaves every future pass reading zero signatures with
`gap:false` — no findings, cursor never advances, and the report prints "no
approvals, no unexpected PDA token accounts, no burns…". That is the round-6
defect in a new shape: the scanner dead and the report reading as an all-clear.
Now: zero signatures against a set cursor triggers a `getSignatureStatuses` check,
and an unresolvable bookmark is a CRITICAL. An RPC that cannot be asked claims
nothing either way.

## A10 — MEDIUM — the config pinning landed on one of three sites (opus, qwen)

Round 11 taught the alarm to verify owner and discriminator before taking byte
offsets and left the same shape in `revenue.mjs` and `distribute.mjs` — the two
jobs that move money, each with its own copy of the offset map. Not a theft path
(the address is a PDA of MINT) but a **silence** path: a MINT upgrade that
reorders `MintConfig` makes both jobs misread quietly. One reader now,
`bank/anchor.mjs`, pinning owner, discriminator **and layout version**.

## A11 — MEDIUM — test 5.2 was vacuous, and `split_revenue` had no negative at all (opus, glm)

5.2 passed `bPda` with `isSigner:true`, and web3.js refuses to serialize a
transaction missing a required signature — **so the program was never invoked**
and the assertion would have passed identically if the owner check did not exist.
Sent with `isSigner:false` it now reaches the program and is refused with
`AccountNotSigner`.

Worse: **there was not one negative assertion on `split_revenue`'s account
pinning**, the only instruction that can move cbBTC out of the revenue PDA.
"Destinations are pinned" was a claim 8.2's own title made and the suite never
tested. Three negatives now pass an attacker's account as the holders
destination, the Bank destination, and the source — all refused with
`WrongTreasury` — plus `8.2e`, which asserts the revenue balance is untouched by
the refusals. `because()` also added to 1.1, 2.5 and 5.2.

## A12 — MEDIUM — `MIN_ASSERTIONS` was 26% below reality (grok, glm)

The runner accepted 160 against a 217-assertion suite, so deleting every
round-11 assertion — including the three that exist only because earlier passes
were false — still exited 0. **The same defeat as making the floor an env var,
just by never moving the constant.** It is 227 and moves with the suite.

## A13 — the rest

- The alarm's idle branch wrote `state.json` and not the EVER marker, so before
  launch an `rm state.json` re-baselined in silence. One writer now, and its
  failure is no longer swallowed.
- `COLLECTION_KEYS` reached `WATCHED_KEYS` but not `WATCH`, so cross-program
  disagreement was caught and a change moving all four together was not.
- `dedupeSeenSplits`: `new Set` over objects dedupes nothing, and a duplicated
  anchor list inflates exactly the count an attacker wants up.

---

## REJECTED, or accepted and NOT fixed

### "no chain-derived reconciliation of distribution OUTPUTS" (luna-pro)
**ACCEPTED AS TRUE, NOT FIXED, AND STATED.** The distributor key controls the
holders' accumulated cbBTC and the alarm reads a same-user ledger. Scanning the
distributor ATA's outgoing transfers and matching every one to a planned vault
and amount is the right answer and is a larger change than this round should make
to a live money job. It is the top of the next round's list, not a footnote.

### "use flock / an OS lease instead of a breakable lock" (terra-pro, round 11)
**STILL THE RIGHT LONG-TERM ANSWER, STILL NOT TAKEN.** Every reachable failure in
the current design is now closed; the remaining TOCTOU is microseconds wide. A
lease is a rewrite of the concurrency model for two live jobs and belongs in its
own change.

### "the Jupiter transaction is still not constrained to a swap" (multiple)
**UPHELD, NOT FIXED, STATED — fourth round running.** luna-pro sharpened it: the
operational rule "hold nothing but the cycle's own funds" is not enforceable and
the wallet necessarily holds fee SOL. A **fresh per-cycle operator wallet** is the
stronger version of that instruction and is now the recorded intent.

### "`sigwalk` never converges above 20k signatures in one pass" (glm)
**TRUE AND UNREACHABLE at charter scale** (~2,100 transactions is the realistic
maximum burst). Filed for the record.

---

## Where this leaves the loop

**Twelve rounds, twelve with findings.** The stopping condition — two consecutive
rounds where nothing survives measurement — has been met zero times.

Round 12's shape is the clearest evidence yet for why the loop is not optional:
**five of its accepted findings were defects in round 11's repairs**, one of them
(A4) strictly worse than what it replaced, and one (A2) certified as correct by a
test I wrote at the same time. The steer worked twice running — point the round
at the newest code and it finds the newest defects.

Counts: **227** on-chain assertions (was 217), **195** detector assertions (was
172), **17** allocation, **11** mainnet facts. Every floor now equals its real
count.

Still owed before this holds real Bitcoin: chain-derived reconciliation of
distribution outputs, an OS-lease lock, a fresh per-cycle swap operator wallet,
and **a human audit firm on a frozen version.**
