# Round 6 — verdict on every finding

8 auditors, and for the first time they saw ALL FOUR programs plus the off-chain
`bank/` pipeline and the ops scripts: `gpt-5.6-terra-pro`, `grok-4.6`,
`claude-opus-5`, `kimi-k3`, `glm-5.3`, `qwen3.8-2.4t-a95b`, `deepseek-v4-pro`,
`gemini-3.7-flash`.

Rounds 1-5 audited at most three programs. Governance had had one round; the
revenue path had had one; the alarm, the distribution engine, the revenue
cycle, the crons and the build script had had **none**. That is where almost
everything below was found, and it is why this round was the largest yet.

**The headline finding was found by measurement, before any auditor replied.**
Six of the eight then reported the same thing independently.

---

## A1 — CRITICAL — the alarm's transaction scanner was dead, and said nothing

Found first by probing mainnet, then independently by gpt-5.6, opus, kimi, glm,
grok and qwen.

`bank/alarm.mjs` kept ONE `lastSignature` and passed it as `until` to FIVE
addresses. Three separate defects in six lines:

| | measured |
|---|---|
| a signature foreign to an address | the RPC returns an **EMPTY LIST**, not "everything since" |
| 200 signatures of mainnet Metaplex Core | **117 SECONDS** of activity, against a 30-minute pass |
| `if (!newest && sigs.length)` | `newest` is only ever set when there is no previous state, so the watermark **never advanced after the first run** |

So from the second pass onward, `detectApprovals`, `detectPdaTokenAccounts` and
`detectBurns` were fed SEAL's transactions and nothing else — no mints, no
burns, no governance — re-reading the same stale 200 forever, with no paging.

The measurement is in `bank/detectors.mjs` and reproducible in three RPC calls.

**Fixed:** cursors per address; advanced only over a window read end to end;
paged until the sentinel; a window that cannot be closed is a `scan_gap`
FINDING rather than a silent truncation; a transaction that fails to fetch is a
`tx_unreadable` finding and the cursor stays put. Core is **out of the scan
entirely** — 200 signatures can never contain one of our vaults — and burns are
detected instead by reconciling the whole collection against the previous pass
(`detectVaultSetChange`), which is complete by construction because DAS indexes
every asset and flags the burnt ones. A mass disappearance is reported as ONE
finding about the index and does not become the new baseline.

## A2 — CRITICAL — a completed bare burn was invisible to the burn detector

kimi, unique.

`listVaults` filtered `!i.burnt`, so `assets` held only LIVE vaults. The moment
a bare Core `BurnV1` **succeeded**, its asset dropped out of DAS, `assetSet.has`
went false, and `detectBurns` could never name it. The detector over the one
attack the design admits it cannot prevent was blind precisely when the attack
had worked — and it passed its own selftest, because the selftest fed it an
asset the real pipeline removes.

**Fixed:** `assets` includes the burnt ones, and A1's reconcile catches the burn
independently.

## A3 — HIGH — `sweep_sol_for_swap` had no on-chain cap and no rate limit

All eight. `bank/revenue.mjs` held `MAX_PER_CYCLE_LAMPORTS = 50 SOL` beside a
comment claiming a compromised operator key "is capped at one cycle's worth
rather than the whole treasury". The instruction is **permissionless**, so a
constant in a script that need not be the caller bound nobody: anyone could push
the entire balance above the reserve to the operator key in one transaction.

**Fixed:** `max_sweep_lamports` AND `sweep_cooldown_secs` in config, both
enforced in the program. Both, because a cap without a cooldown is a step size —
the suite proves that directly: three sweeps in ONE transaction succeed with the
cooldown at zero (6.17) and the identical transaction is refused once it is set
(6.19).

## A4 — HIGH — admin alone could become governance

qwen (its single thing to fix), opus, and found independently here.

`update_wiring` gated `treasury | bank_treasury | split_bps` behind the
governance signature and then wrote `c.governance = x` on admin's signature
alone. Two transactions and admin held both roles: set the round, the price, the
cap, and rotate the treasury. Round 5's fix A6 was **relocated, not real**.

The same instruction had the opposite defect in the intended wiring: once
`governance` IS the GOV program's PDA it can never sign an `update_wiring`
(GOV's only CPI is `set_round`), so treasury, bank_treasury and split_bps become
unrotatable. The requirement was either trivially satisfiable or unsatisfiable,
and never in between.

**Fixed with a timelock, not a lock.** A rotation is ARMED by admin, published
on-chain as `pending_governance` + `pending_governance_at`, and applied by a
permissionless `apply_pending_governance` only after the notice period.
Cancellable by admin. The escape hatch stays — a bug in GOV must not freeze the
round forever — but nobody gets a silent swap, and the alarm treats a pending
value as CRITICAL on its face for the whole window rather than once.

`governance_timelock_secs` is a config value with a 60-second floor **for the
same reason `gov.min_voting_secs` is**: an apply path that has never run is not
one to trust with the largest fund-flow control in the system. Unlike that one it
RATCHETS UP, so a launch value set too low is fixable. ⚠️ The deployed value must
be days; the alarm asserts it.

The unrotatable half is now an assertion too (test 7.18), not a discovery.

## A5 — HIGH — the swap operator and the SOL reserve could not be rotated at all

grok, glm, kimi. Both were set in `initialize` and appeared in no update path. A
compromised operator key could never be replaced; the only response was
`set_paused`, which also stops the sale and does nothing about SOL already
moved. `sol_reserve_lamports` set too high would have stranded the revenue
address's SOL permanently, since sweeps are the only way out.

And `detectConfigDrift` watched `mint.swap_operator` as CRITICAL — a detector on
a value that could not change, i.e. one that could never fire.

**Fixed:** both rotatable under admin + governance, the same gate as the treasury.

## A6 — HIGH — the distribution engine could pay twice, and could pay unequally

All eight in some form; glm made it its single thing.

- **No lock.** Two runners (the cron at 09:07 plus a manual run) each loaded the
  ledger, each held their own copy, and each `save()` wrote the WHOLE object, so
  the second erased the first's record of every transfer it had made. The header
  claimed it "refuses to pay twice"; it refused in sequence, never in parallel.
- **A corrupt ledger read as empty.** `try { ... } catch { return { days: {} } }`
  cannot tell "no file yet" from "truncated file", so a crashed write meant
  "nothing has ever been paid" and the next run paid everyone again.
- **The plan was recomputed on resume** from the REMAINING balance while the
  divisor stayed the full activated set. gpt-5.6's worked example: two vaults,
  100 sats, A gets 50, crash, the resume pays B twenty-five. Equal-per-vault is
  the whole rule.
- **One bad vault denied all the others.** No per-vault try/catch, and cbBTC has
  a live freeze authority, so one frozen destination ATA threw out of the loop
  and left every remaining vault unpaid for the day with nothing to retry.
- **The SOL floor funded under half a run** (flat 5,000,000 lamports against
  ~2,100 transfers at 5,000 each).

**Fixed:** `bank/lock.mjs` — an exclusive lock with a loud stale-break, atomic
temp-and-rename writes, and a reader where MISSING is a fresh start and
UNPARSEABLE is an abort. The day's plan is written before any transfer and
reused verbatim on resume. An intent row is written before each send. Failures
are recorded and the run continues, then reports. The SOL check scales with the
number of vaults outstanding.

## A7 — HIGH — the reconciliation of the trusted hop had four ways to go quiet

opus enumerated all four; gpt-5.6, qwen and glm each found some.

1. **`String(0n)` is `'0'`, which is TRUTHY.** `if (c.returnedSats) continue`
   marked a cycle that returned NOTHING as reconciled.
2. **No value check.** Return one satoshi against fifty SOL and both `--audit`
   and the detector read clean. `quotedSats` was recorded and never compared.
3. **`sweptLamports` was written only after confirmation.** A confirmation
   timeout on a transaction that actually landed left a row with no amount,
   which the detector explicitly skipped. SOL gone, watcher silent.
4. **A missing ledger was swallowed** — `catch { /* no ledger yet is not a
   finding */ }` — in a file whose header says a read that fails is an alarm.

**Fixed:** compare the number, not the string; hold the return to the quote
within a tolerance; write the sweep INTENT before sending and treat an
intent-without-return as the worst case rather than an exempt one; an unreadable
ledger is CRITICAL. `revenue.mjs` also now refuses to start a new cycle while an
old one is open (grok: after a successful sweep whose swap failed, the next run
printed "nothing to sweep" and returned), and RE-QUOTES after the sweep instead
of submitting a quote taken before the SOL moved.

## A8 — HIGH — GOV quorum was read at execute, from a divisor that never falls

kimi, grok, opus, qwen. Two distinct problems in one line.

`minted_total` is read live at `execute_proposal`. It only ever grows, so
minting during an open proposal bought quorum (each new vault is a whole vote and
only a fraction of a vote's worth of bar), and minting after voting closed but
before execution could push a proposal that had already won back below the line.
Separately, `minted_total` never decrements, so every burned vault keeps counting
toward the bar while its vote is gone — enough burns and governance freezes for
good. The header said "LIVE SUPPLY"; it was cumulative issuance.

**Fixed:** the divisor is SNAPSHOTTED into the Proposal at creation, so it cannot
move under an open vote in either direction. And `quorum_bps` is the one
parameter `update_gov_config` may LOWER — the only remedy for a divisor that
never falls while the electorate shrinks. The header now says what the code does.

## A9 — HIGH — a passed proposal was a bearer instrument with no expiry

opus, grok, glm. `execute_proposal` was callable forever after `voting_ends_at`,
with no cancel, and `set_round` accepts any window with `closes_at > opens_at`.
So a ratified proposal could be banked and fired months later to overwrite a live
round, reset `minted_this_round`, and reinstate a stale price.

**Fixed:** `EXECUTION_WINDOW_SECS` (7 days), and a proposal may not install a
round that has already closed. The second is tested end to end (7.12a/7.13a);
**the 7-day expiry is NOT exercised by the suite, for the obvious reason,** and
that is stated rather than implied.

## A10 — MEDIUM/HIGH — governance parameters were frozen at genesis

opus, kimi, grok. `GovConfig.admin` was assigned and never read — the same shape
as round 5's `minted_total` — and nothing could change `quorum_bps`,
`threshold_bps` or `min_voting_secs`. A config initialised at the 60-second
testing floor would have been permanently capturable, with `detectStandingRisks`
emitting `weak_voting_period` HIGH forever on an unfixable condition.

**Fixed:** `update_gov_config`, admin-gated. `min_voting_secs` and
`threshold_bps` RATCHET UP ONLY, so a hostile admin key cannot use it to lower
the bar on a vote it wants. `quorum_bps` is the documented exception (see A8).

## A11 — MEDIUM — no detector saw a partial drain, a program upgrade, or the collection

opus, qwen. `detectDeactivations` fired only below 21,000 sats, so a vault
holding a whole bitcoin drained to 21,001 was silent — 99.98% of a customer's
Bitcoin, in the one place a resale buyer's entire basis is "this vault still
contains its reserve". Balances were not even persisted, so the check could not
be written. And nothing watched the four programs' upgrade authorities or bytes:
an upgraded MINT that repoints revenue left `detectConfigDrift` quiet, in a
system whose SPEC says the upgrade authority is what stands between "no key can
unseal a vault" and a false statement.

**Fixed:** balances are persisted and ANY fall is a HIGH finding (a legitimate
redemption looks the same — it is "somebody's reserve moved", to be read against
the open/close stamp). Each program's ProgramData upgrade authority and a hash of
its bytes are in the drift snapshot, as is a hash of the collection account, so a
royalty or plugin change announces itself without needing a parser. BURN's config
is watched at all now — the co-signer on the one irreversible path.

## A12 — MEDIUM — a failed read looked like a quiet pass, in four places

glm, grok, kimi.

- `catch { bal = '0' }` on a balance read turned one RPC hiccup into a false
  `deactivated` AND wrote the vault down as inactive, after which a REAL drain on
  the next pass was skipped as "it was already inactive". Now `getAccountInfo`
  splits "no account" (a genuine zero) from a throw, an unreadable vault is its
  own HIGH finding, and the last known activation is carried forward.
- `if (!tx) continue` CONSUMED a signature whose instructions were never
  examined. Now it is a finding and the cursor stays put.
- A null config read printed "not initialised" and exited 0. Now, if a previous
  pass read that account, its absence is CRITICAL — a config account cannot
  un-exist.
- `writeState` ran BEFORE `report()`, so a CRITICAL drift whose email failed
  became the new baseline and was never mentioned again. Now the report runs
  first and the config baseline is only advanced if delivery succeeded.
  (`process.exitCode = 2` for a failed delivery was also immediately overwritten
  by `= urgent ? 1 : 0`.)

## A13 — MEDIUM — the completeness reconcile BURN's header promised did not exist

glm, opus, kimi. `programs/cbob-vault-burn/src/lib.rs` says the non-ATA gap is
covered by "the off-chain scanner, which uses `getTokenAccountsByOwner`". **No
shipped file called it.** And it could not have been covered by the tail either:
creating a token account owned by a vault PDA needs no signature from the PDA and
touches none of our four programs, so such a transaction never appears in any
signature scan we run. `detectPdaTokenAccounts` could only ever see one nested
inside a transaction that also touched us — which is not how anyone would plant
one. Enumeration is impossible ON-CHAIN; it was never impossible from a script.

**Fixed:** `node bank/alarm.mjs --reconcile`, daily, one call per vault per token
program. The judgement is a pure detector proven both ways; only the I/O is
untested, and that is stated.

## A14 — MEDIUM — the index was trusted against nothing

kimi, qwen. Both `listVaults` and `distribute.mjs` stopped when a page returned
fewer than 1000 items, which is indistinguishable from a truncated page — and
`distribute.mjs` divides the day's cbBTC by the vaults it can SEE, so a short
page does not fail, it OVERPAYS everyone visible and omits the rest.
`mint.minted_total` was read nowhere in the pipeline.

**Fixed:** `live + burnt` must reach `minted_total`, on-chain and never
decremented. Below it, both jobs refuse.

## A15 — MEDIUM — `build-mainnet.sh` could certify bytes it never proved

gpt-5.6, opus, kimi, qwen, glm. Two defects:

- `cargo-build-sbf … | grep -E "^error" -A5 && die` only fires on a failure that
  prints a line starting with `error`. `/tmp/cbob-mn` was never cleaned, so a
  build killed by the OOM killer or a linker fault left the PREVIOUS run's `.so`
  to be copied into `dist/` and its sha256 printed under "Deploy these bytes and
  nothing else".
- `ask()` deployed `cbob_vault_mint.so` and nothing else, while the banner
  asserted the Squads key for all four artifacts. SEAL, BURN and GOV each carry
  an independent `#[cfg]` block.

**Fixed:** exit status is the gate, both target dirs are removed first, all four
artifacts are asked in both builds, and the run records the git commit and
refuses a dirty tree unless overridden. SEAL's `INIT_AUTHORITY` check also moved
to the TOP of its `initialize` — below `assert_classic_spl` it would bounce the
probe first and make the property untestable, which is round 5's false-pass
lesson one layer down.

## A16 — MEDIUM — `cron-install.sh` installed duplicate jobs on every re-run

opus, glm. The de-dupe filter was `grep -v 'cbob-vaults/bank'` and the line it
writes is `cd /opt/cbob-vaults && /usr/bin/node bank/alarm.mjs` — that substring
appears **nowhere**. Verified by piping the exact line through the exact filter:
zero matches. So a second install put a second `distribute.mjs` on the same
09:07 tick, which with A6 is a double payment. It also silently reverted an
operator's `--live` on the revenue line.

**Fixed:** an explicit tag on every line, filtered on that; `--live` preserved;
plus two new jobs — the daily reconcile (A13) and a **dead-man's switch** that is
plain `find(1)` on the state file's mtime and needs neither node nor our code,
because a watchdog cannot report its own death.

## A17 — LOW/MEDIUM — comments the code contradicted

- `split_revenue`: "integer division can never round in the Bank's favour" while
  computing the holders' share first and handing the Bank the remainder, i.e. the
  Bank collected every rounding remainder, and at a balance of 1 it collected all
  of it. **Fixed:** the Bank's share is floored, the holders take the remainder,
  and the suite proves it on an amount that does not divide (8.6a-d).
- `split_bps % 100 == 0` was justified as "so the royalty plugin can express it",
  but `set_collection_royalties` writes one creator at 100% and never reads
  `split_bps`. The constraint is kept for the reason that actually holds; the
  justification is corrected.
- "One number, both revenue paths" — `basis_points` is a royalty RATE and
  `split_bps` is a division; they were never the same number. What is shared is
  the ADDRESS. Corrected.
- GOV's map of MINT's config said `bump[221]`; `bump` is at 296 and 221 is
  `bank_treasury`. Nothing read it — a wrong map beside a correct constant is how
  the next reader gets it wrong.
- `MintError::OwnerWouldBrick` was dead. Removed.

## A18 — MEDIUM — royalties could be set to 100%, and had never touched real Core

opus, kimi, grok, qwen, glm. `basis_points <= 10_000` bounded the byte and
nothing that mattered: a 100% royalty is legal in the plugin and fatal to the
product, whose entire thesis is that a vault is RESOLD. And this was the only
Core opcode pair in the codebase never executed against real Core.

**Fixed:** bounded to 1000 bps. And **tested against real cloned mainnet Core for
the first time** — `AddCollectionPluginV1` (3) then `UpdateCollectionPluginV1`
(7), with Core decoding back exactly what was written: 500 bps, then 750, sole
creator the revenue PDA at 100% (6.26-6.30). No auditor found a wrong byte and
none was there; it was untested, which is a different thing and no longer true.

---

## REJECTED — and why

### D1 — "detectApprovals keys on `parsed.info.owner`, which may not be in the real parse" (glm)
**REJECTED BY MEASUREMENT.** A real `approve` was submitted on a validator and
the transaction re-fetched with `getParsedTransaction`: `info.owner` is present.
It is now a permanent assertion (6.32), because the whole detector hangs off that
field. A fallback resolving the owner from the token ACCOUNT was added anyway —
the finding's mechanism was sound even though its premise was wrong.

### D2 — "`closes_at - opens_at` can overflow and bypass the one-year bound" (qwen, kimi)
**REJECTED BY MEASUREMENT.** The workspace sets `overflow-checks = true`, so it
aborts. But the safety rested on a profile setting nothing asserted, and a future
`Cargo.toml` edit could have dropped it silently — so there is now a test that
passes `opens_at = -1, closes_at = i64::MAX` and asserts the rejection is an
overflow abort (6.31). The finding was wrong and it made the codebase better.

### D3 — "bound price 0 to the charter phase, e.g. `minted_total + cap <= 190`" (opus)
**REJECTED ON THE BUSINESS, for the second round running.** `price = 0` is a
requirement, not a defect. And 190 is not a number the program should know: it
would hard-code the size of one round into a contract that outlives it and break
the first time the charter is re-run or resized. The underlying finding — admin
capturing governance — is real and is A4.

### D4 — "reject votes from assets minted after the proposal opened" (opus, grok, qwen)
**REJECTED ON MECHANISM, ACCEPTED IN SUBSTANCE.** A Core `AssetV1` does not carry
a creation slot, so there is nothing to read; the proposed check cannot be
written. The substance — that minting moves the goalposts — is fixed at the
divisor instead (A8), which closes the quorum game in both directions. New vaults
can still vote, and that is now stated rather than accidental.

### D5 — "`update_wiring` permits `split_bps = 0`" (qwen)
**ACCEPTED AS A FINDING, LEFT AS IT IS.** It requires the governance
co-signature, and `detectStandingRisks` already raises CRITICAL on any value
other than 8500. A governance decision to change the split is a governance
decision; the alarm's job is to make it loud, not to make it impossible.

### D6 — "votes are atomically rentable: transfer, vote, transfer back in one tx" (kimi)
**UPHELD AND NOT FIXED.** The mechanism is real. Fixing it requires a snapshot of
holders, which this design deliberately rejects (a snapshot needs someone to
compute it and everyone else to trust them). It is now a stated limit in the SPEC
rather than a claim of a binding stronger than the property.

---

## Two process notes

**The headline came from a probe, not from a review.** Three RPC calls against
mainnet settled in seconds what could have been argued about for an hour: a
foreign `until` returns nothing, and 200 Core signatures is 117 seconds. Six
auditors reached the same conclusion by reading. The measurement is what made it
safe to delete the Core scan rather than tune it.

**A gate that has only ever said OK is untested, and so is a REJECT for the
wrong reason.** Raising the suite's error-capture limit from 110 to 220
characters turned two apparently-failing checks into passing ones —
`GovernanceTimelockActi` had simply been cut in half. Every negative in the suite
still asserts WHY it rejected, and the count is 144 with a floor enforced by the
runner, because an exit code alone cannot tell "everything passed" from "the
suite stopped early".
