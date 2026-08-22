# Round 7 — verdict on every finding

8 auditors on the same full surface as round 6: `gpt-5.6-terra-pro`,
`gpt-5.6-luna-pro`, `grok-4.6`, `claude-opus-5`, `kimi-k3`, `glm-5.3`,
`qwen3.8-2.4t-a95b`, `minimax-m3`.

**The most useful thing about this round is that most of it was aimed at round
6's fixes, and most of that landed.** Five of the eight accepted findings below
are defects introduced or left behind by the previous round's repairs. A fix is
a change, and a change is a place a defect can live.

---

## A1 — CRITICAL — the tally RULE was read after the votes were cast

opus (its single thing), grok, qwen, kimi.

Round 6 snapshotted `quorum_supply` into the Proposal and left `quorum_bps` and
`threshold_bps` being read LIVE from config at `execute_proposal` — while, in the
same round, making `quorum_bps` the one parameter admin could LOWER, immediately
and with no notice period.

Together those are one signature and one vault away from ratifying anything:
create a proposal, vote your own vault YES, and lower quorum to 1 in the same
block as the execute. `need = supply × 1 / 10000 = 0`, `yes_bps = 10000`, and the
CPI installs `price = 0, cap = the rest of the supply`.

**The defence I wrote for the lowerable quorum was wrong in the dimension that
decides it.** It said an admin hostile enough to do this "can already arm a
governance rotation and BE governance in seven days" — but that rotation is slow,
published on-chain and alarmed, and this was atomic and reported up to thirty
minutes later, after the free mint. The two are not comparable powers.

**Fixed:** `quorum_bps` and `threshold_bps` are snapshotted into the Proposal
beside `quorum_supply`, and `execute_proposal` reads no config value for the
tally at all. A rule applied retroactively to votes already cast under a
different rule is not a rule. Test 7.13b opens a proposal at 100% quorum, votes
once, lowers quorum to 1%, and requires the execute to still fail.

## A2 — CRITICAL — round 6's cooldown became a grief handle

grok (its single thing), qwen, kimi.

`sweep_sol_for_swap` was permissionless with no minimum amount, and round 6 gave
it a cooldown. Anyone could therefore call `sweep_sol_for_swap(0)` once per
window — moving nothing, stamping `last_sweep_at`, and starving the legitimate
cycle indefinitely for the price of a transaction fee. Nothing watched sweeps, so
it would have been silent. The comment saying a stranger calling this "is doing
us a favour" stopped being true the moment there was a rate limit to consume.

**Fixed three ways:** the swap operator is now a REQUIRED SIGNER (the cron holds
that key, so nothing about the automation changes, and a stranger can no longer
burn the window); `amount > 0`; and `sweep_cooldown_secs` has an on-chain floor
of 1, because two sweeps in one transaction share a timestamp — so 1 closes the
atomic bypass absolutely while remaining testable. Zero was accepted before,
which is the exact state `detectStandingRisks` calls CRITICAL: the program
permitted the configuration its own watcher condemns.

## A3 — HIGH — every bound was behind a signature that cannot exist

opus. Round 6 made `swap_operator` rotatable and put it, along with every sweep
bound, behind the governance co-signature. In the production wiring
`config.governance` is the GOV program's PDA, whose only CPI is `set_round` — so
all of them FREEZE at handover, including the emergency response to a compromised
operator key. The only route back was a seven-day governance rotation during
which governance itself is a signing key and no round can be voted, while the
attacker keeps taking `max_sweep_lamports` every cooldown.

**Fixed by splitting the gate on DIRECTION rather than on field.** Rotating the
operator and TIGHTENING a bound are admin-only and available the same hour:
neither can redirect anyone's money, because the SOL comes back to the same
revenue address and is divided by the same enforced rule. LOOSENING a bound, and
anything that changes who gets paid, still needs the holders. Tests 6.20a-d.

## A4 — HIGH — admin rotated instantly, and admin holds the cancel

kimi, unique. The round-6 timelock covered `governance` and left `admin`
instantaneous — while `cancel_pending_governance` is `has_one = admin`. So one
admin rotation lets an attacker take away the very remedy the timelock relies on,
then arm a governance rotation the honest side cannot cancel.

**Fixed:** `pending_admin` / `pending_admin_at`, applied by
`apply_pending_admin` after the same notice period, cancellable by the CURRENT
admin. The alarm reports an armed admin rotation as CRITICAL on its face.

## A5 — HIGH — the ledger was the audited key's own testimony

opus, glm, kimi, qwen, grok — five of eight, independently.

`detectUnreconciledRevenue` and `--audit` reconciled `sweptLamports` against
`returnedSats`, both written by `revenue.mjs`, which runs as the same user, on
the same box, as `keys/swap-operator.json`. Anyone holding that key could call
`sweep_sol_for_swap` directly, write no row at all, and every detector stayed
quiet forever. The MINT comment even says the event exists "so the Bank alarm can
reconcile SOL-out against cbBTC-returned" — the alarm was already fetching and
normalising every MINT transaction and simply never looked for one.

**Fixed:** `detectUnledgeredSweeps` runs over the existing MINT signature scan
and demands a ledger row for every sweep it finds. A sweep with no row is
CRITICAL whoever made it.

## A6 — HIGH — nothing watched the daily distribution at all

opus, gpt-5.6. `distributions.json` was read by no detector, so: a vault whose
transfer failed was recorded and skipped for the rest of the day in silence, the
SOL-floor abort returned with exit code 0 (a day where nobody was paid exited
green), and a day that never ran left no trace anywhere.

**Fixed:** `detectDistribution` covers a missed day, a run that started and never
finished, an unreadable ledger, and any transfer with no signature. The SOL-floor
abort exits non-zero, and `finishedAt` is only stamped when nothing is unresolved
— a day marked finished with an ambiguous transfer in it reads as done to every
later run and to the watcher.

## A7 — HIGH — nothing watched the output of the governance system

opus, glm. `mint.round_id`, `price_lamports`, `cap`, `opens_at`, `closes_at` and
`minted_total` were not in the drift watch list. The price strangers pay could
change with no finding, and minting 1,911 vaults produced nothing but a different
number on the `looked at:` line, because the vault reconcile only reports
DISAPPEARANCES. **Fixed**, along with `gov.admin` (kimi: read but never watched)
and `gov.last_executed_id`.

## A8 — HIGH — the alarm did not assert the thing the program says it asserts

opus, gpt-5.6, glm, kimi, grok — five, independently, and correctly.

MINT's own comment reads "⚠️ THE DEPLOYED VALUE MUST BE DAYS. The Bank alarm
asserts the live value" about `governance_timelock_secs`. `readConfigs` stopped
at offset 353 and the field sits at 361. It was in no watch and no standing
check. A production deployment at the 60-second floor would have been silent, and
a rotation could start and finish entirely between two alarm passes.

**Fixed.** This is the second time in two rounds that a comment naming its own
compensating control turned out to describe one that did not exist. The rule
that falls out of it: **when a comment names a control, go and read the control.**

## A9 — MEDIUM — a MISSING state file re-baselined the whole watcher

opus. Round 6 made a CORRUPT state file abort and left an ABSENT one reading as
day one — so `rm state.json`, on the same host and as the same user as the
signing keys, made the next pass adopt whatever it found as canonical, print "no
config drift" and exit 0. The deadman cron could not see it either: `find` on a
path that does not exist prints nothing, so it never fired.

**Fixed both.** A separate `.alarm-has-run` marker means an absent state file is
a refusal unless `--first-run` is passed deliberately, and the deadman now tests
for absence as well as staleness.

## A10 — HIGH — cursors advanced even when the alert did not go out

qwen. Round 6 kept the config, activation and balance baselines when delivery
failed, and still banked the scan cursors — so a CRITICAL approve or burn whose
email failed was scanned past and never re-reported. Only config drift survived.
**Fixed:** an undelivered finding keeps every baseline, cursors included.

## A11 — MEDIUM — one unreadable balance erased that vault's baseline forever

opus. Round 6 carried `activation` forward on a read failure and dropped
`balances` — and `detectBalanceDrops` iterates the PREVIOUS balances, so the
vault vanished from the comparison permanently. A vault drained from 1 BTC to
0.5 across that pass produced no finding: exactly the case the detector was
written for. **Fixed:** both are carried forward.

## A12 — MEDIUM — the third copy of the truthy-`'0'` predicate

opus, gpt-5.6, qwen, kimi. Round 6 said "all three fixed" and then wrote a fourth
site — the open-cycle guard in `revenue.mjs` — with the original bug in it:
`!'0'` is false, so a cycle that returned NOTHING read as closed and a fresh
sweep could stack on top of it.

**Fixed by deleting the copies.** One exported `cycleIsOpen`, imported by the
detector, by `--audit`, and by the runner. A predicate worth getting right is
worth having once.

## A13 — MEDIUM — `revenue.mjs` ignored the bounds it must obey, and a refused sweep wedged everything

opus, glm, kimi. It read five config offsets and never `max_sweep_lamports`,
`sweep_cooldown_secs` or `last_sweep_at`, so it swept its own hardcoded 50 SOL.
Worse, the intent row was written BEFORE the send: a rejection — and the `41 */6`
cron produces `SweepTooSoon` by construction against any cooldown longer than six
hours — left a row with no `sweptLamports`, which then (a) made every later run
throw at the open-cycle guard, and (b) raised a CRITICAL saying SOL had left the
revenue address when nothing had moved. A false CRITICAL is how you teach an
operator to ignore the alarm.

**Fixed:** the three fields are read and obeyed, the cooldown is waited out
rather than crashed into, and a REJECTED send (a program error) is distinguished
from an unconfirmed one and closes the row.

## A14 — HIGH — the completeness check accepted duplicate ids

gpt-5.6, unique and sharp. `live.length + burnt.length >= minted_total` passes if
a page repeats ids while omitting real vaults — and `distribute.mjs` keys
balances by asset id, so duplicates COLLAPSE. A response of 2,100 copies of one
vault would satisfy the count and then pay the entire day's cbBTC to that single
recipient.

**Fixed:** unique ids, no overlap between live and burnt, and EXACT agreement
with `minted_total`. Only `mint_vault` can add to this collection, so more is as
wrong as fewer.

## A15 — MEDIUM — the ops scripts, again

- The assertion floor was itself an env var, defeated by the very mechanism it
  guards; the suite file could be swapped; and a partial pass counted, because
  `sed | tail -1` read the denominator. All three closed: the floor is hardcoded,
  `CBOB_TEST_FILE` is refused outright, and numerator must equal denominator.
- `build-mainnet.sh` had NEITHER the port wait NOR the Core byte-identity gate
  that `run-tests.sh` spends a paragraph explaining — the script whose entire
  purpose is proof could certify bytes on answers from a validator it did not
  boot. Both added.
- Logs moved out of world-writable `/tmp`, and `detectBurns` no longer calls
  `initialize` a burn.

## A16 — MEDIUM — build-mainnet claimed more than it proved

gpt-5.6. Rejecting the localnet test key does not identify the mainnet constant:
a third, wrong key would answer identically, and the Squads vault is off-curve so
its acceptance cannot be demonstrated locally at all. **Fixed by narrowing the
claim to what is true** and adding the part that is checkable: the script asserts
the SOURCE names the Squads key in all four programs, records the commit, refuses
a dirty tree, and states plainly that the bridge from source to bytes is
reproducibility, not the behavioural test.

---

## REJECTED — and why

### D1 — "a griefer pre-funds the next Proposal PDA and Anchor `init` fails forever" (qwen)
**REJECTED BY MEASUREMENT.** 2,000,000 lamports were sent to the next proposal
PDA on a validator and `create_proposal` succeeded — modern Anchor `init`
transfers, allocates and assigns rather than requiring a zero-lamport account.
It is now a permanent test (7.12d) rather than an argument.

### D2 — "require `minted_now == quorum_supply` at execute" (glm)
**REJECTED ON LIVENESS.** It fails closed, which is the right instinct, and it
would make governance unusable: during an open public round mints are continuous,
so no proposal could ever execute without pausing the sale first. The divisor is
snapshotted, minting requires the Bank's co-signature, and the correct response
is to make that co-signature an explicit written duty rather than to add a rule
that stops the system working.

### D3 — "reject votes from assets minted after the proposal opened" (kimi, restated)
**REJECTED ON MECHANISM, ACCEPTED IN SUBSTANCE**, for the second round running.
A Core `AssetV1` carries no creation slot. kimi's variant — stamp a mint index
into the Attributes and check it at vote time — is buildable, and it would put a
governance-critical check on a plugin blob that SEAL rewrites on every redemption
and that a future Core version may re-encode. The header claim has been corrected
instead: the snapshot fixes the DIVISOR, and new vaults can vote.

### D4 — "the assertion floor of 120 contradicts the advertised 82-assertion suite" (opus, kimi)
**NOT A DEFECT.** The 82 is from the round-6 prompt describing the suite as it
stood before that round's tests were added. The floor is now 160 against 178.

---

## The process note

**Five of the fifteen accepted findings were defects in round 6's repairs**, and
two of those were regressions of bugs round 6 had just fixed elsewhere — the
truthy `'0'` predicate written a fourth time, and a rate limit whose own floor
recreated the unbounded state its watcher condemns. A round that only reviews the
original code will not find these. Feeding each round the previous round's fixes,
and asking explicitly whether each is real or merely relocated, is what surfaced
them.
