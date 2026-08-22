# ROUND 8 — FINDINGS

## F1 — HIGH: `distributions.json` deletion re-pays the entire day; the alarm comment claims this is caught and it is not

`bank/distribute.mjs`: `const load = () => readLedger(STATE, { days: {} })` with the doc "A MISSING ledger is a first run." The per-day guard ("never pay twice"), the plan, and every `paid` row live ONLY in that file. `rm distributions.json` before the next run → `st.days = {}` → the day's plan is recomputed → **every activated vault is paid a SECOND time in full.** This is not a ledger-lie; it is a literal double distribution of customer cbBTC, needing no key, just the same uid (or an operator cleanup, or a `rm` fat-finger).

The alarm's own comment says: "one that existed and vanished is caught by the same marker that guards state.json." **False.** The `EVER` marker guards `STATE_FILE` only. For DIST the guard is `if (dist !== null || fs.existsSync(DIST))` — a merely-absent file skips `detectDistribution` entirely, silently. Even the `distribution_missed` detector is keyed off ledger content, which is now empty. Nothing anywhere observes the double-payment: no detector reconciles per-vault transfer count on-chain against the ledger.

Concrete exploit: any process running as the vault uid (or a bad cleanup script) does `rm /opt/cbob-vaults/bank/distributions.json` at 09:08 after the cron → next manual/cron run pays all ~2,100 activated vaults again.

FIX: (a) write an `EVER`-style marker for the distribution ledger (or record `dist_existed: true` inside the guarded state.json); (b) `distribute.mjs` must ABORT when the file is missing but the marker exists, the same refusal `alarm.mjs` makes for state.json; (c) make absent-after-existence a CRITICAL in `detectDistribution`, not a skip.

## F2 — MEDIUM: `audit()` is a FOURTH copy of the open-cycle predicate, and it ignores `sendRejected`

`bank/revenue.mjs`:
```js
const open = l.cycles.filter(c => (c.sweptLamports || c.intendedLamports) && BigInt(c.returnedSats ?? 0) === 0n)
```
Round 7's headline was "ONE exported `cycleIsOpen`" — yet `audit()` keeps its own copy. That copy does not honour `sendRejected`. A sweep the program REFUSED (nothing moved) is permanently reported by `--audit` as "UNRECONCILED … lamports unaccounted" with `process.exitCode = 1`, while the alarm — via `cycleIsOpen` — correctly reports the same cycle closed. Two readers of the same ledger now disagree by construction, exactly the class round 7 claimed to kill. Worse: the comment in the same file promises "distinguishes a REJECTED send from an unconfirmed one" — true for the detector, false for the audit. A false-critical that never clears teaches the operator to ignore the real one.

FIX: `const open = l.cycles.filter(cycleIsOpen)` and add a selftest pinning the divergence (audit input with `sendRejected: true` must not be open).

## F3 — MEDIUM: the post-sweep re-quote reintroduces the `?? 0` price-impact bypass

Round 7 (your own fix note): "`?? 0` made a response that OMITS the field read as 0% impact and sail past the ceiling." That fix was applied to q1. Twenty lines later:

```js
const impact2 = Math.abs(Number(q2.priceImpactPct ?? 0))
```
A Jupiter response omitting `priceImpactPct` on the re-quote passes the 1.5% ceiling unmeasured. Execution is still bounded by `slippageBps: 100`, so the blast is capped at ~1%, but the quote-quality gate is void in exactly the way round 7 said must not happen. Same class, second copy.

FIX: refuse when `q2.priceImpactPct === undefined || null`, identical to q1.

## F4 — MEDIUM: quorum-bps lowering still ratchets ratification power instantly — for every NEW proposal

Round 7 snapshotted `quorum_bps`/`threshold_bps` into the Proposal, which closes retroactive rule changes on OPEN proposals. It does not close the forward direction. `update_gov_config` lets lone admin set `quorum_bps = 1` **immediately**; every proposal created from that block on snapshots the lowered rule. With supply 2100: `need = 2100·1/10_000 = 0`; one YES vote = 10,000 bps ≥ any threshold; `cast = 1 ≥ 0`. So: admin signature → next block: any single-vault holder creates, votes YES, waits `min_voting_secs`, executes. The code's stated defence ("snapshot fixes the rule at the moment everyone can see it") is true only for proposals that already existed. The remaining barriers are the alarm (≤30 min) and the voting period (days in production). The original atomic capture is gone; the fast capture is not.

FIX: put `quorum_bps` changes behind the same arm/apply timelock as `pending_governance` (it is already admitted to be the dangerous direction), or floor `quorum_bps` at a value where one vault cannot clear a snapshot.

## F5 — LOW: alarm reads `gov.last_executed_id` at offset 93 — the bump byte, not the field

GovConfig layout: disc(0–8) version(8) admin(9–41) collection(41–73) quorum(73–75) threshold(75–77) min_voting(77–85) proposal_count(85–93) **bump(93)** last_executed_id(**94**–102). `alarm.mjs` reads `['last_executed_id',93,'u64']` — i.e. `bump ‖ id[0..7]`. Because bump is fixed at init, drift still FIRES on any execution, so the watch is not dead — but every CRITICAL detail line reports a value that is `bump + id·256`, and the one number that says "a proposal executed" is systematically wrong in the alert an operator reads. It is also exactly the "raw-offset read of an upgradeable account" the file's header claims to have pinned.

FIX: offset 94. (`proposal_count` goes unread — acceptable.)

## F6 — LOW: the reconcile pass has no deadman

The 30-minute pass is covered by the state.json mtime deadman. The DAILY `--reconcile` — the ONLY instrument over Core's un-enumerable non-ATA gap, the thing both BURN's header and the alarm's footer say is what closes the blind spot — writes no timestamped artifact and has no staleness check. If the reconcile cron line is dropped or the job starts failing before `withLock` (e.g., RPC outage at boot), nothing notices; failures are notified per-run but absence is not. The footer claims "it runs DAILY" — nothing proves it.

FIX: reconcile writes a `reconcile.lastrun` marker; deadman checks both mtimes.

## F7 — LOW: false CRITICAL for a reserve ATA created on a BURNT vault; plus a dead standing-risk check

`alarm.mjs`: `pdas` is built from live+burnt, but `atas` (the "expected" set for `detectPdaTokenAccounts`) is built from LIVE only. A canonical reserve ATA created post-burn (permissionless to create) is reported CRITICAL "NON-CANONICAL." Minor false-wolf.

Also: `detectStandingRisks` still asserts `max_sweep_lamports == 0n` as CRITICAL, but `initialize` and `update_wiring` both `require(x > 0)` — unreachable. A check that cannot fire in any state the program permits. And the mint fields tuple in `readConfigs` lists `last_sweep_at` twice; harmless but it is how offset drift starts.

## TRIED AND COULD NOT BREAK

- **Double voting / vote-by-transfer / vote-by-delegate / vote-by-burned-vault**: VoteRecord is asset-seeded; burned vault fails `read_core_asset`; delegate doesn't exist on Core assets; the owner must sign against live owner-bytes. Holds.
- **Governance evading supply**: `max_supply` is enforced in `mint_vault` against `minted_total`; `set_round` cannot touch it; cap-reset grief is bounded by `ProposalSuperseded` + the execution window. Lifetime cap holds.
- **split_revenue destination theft**: all three ATAs are derived from config-pinned wallets and the passed mint; token program pinned to classic SPL; the sums are exact with the Bank floored; a frozen or missing destination fails the whole transaction atomically. No caller-supplied destination exists.
- **sweep atomic-bypass**: signer + `amount > 0` + cooldown ≥ 1 closes the same-transaction double-sweep; the revenue-0-recreation path only kills a system-owned shell that mint payments recreate — no data lives there.
- **Royalties encoding**: `Option<authority> = [0]` for None is the correct Borsh tag; creators `u32=1` + share byte 100 + `RuleSet::None` is the plausible layout, and round 6–7 claim both opcodes decoded by real cloned Core. I cannot refute it without claiming the suite lies; I note only that its correctness still rests entirely on that suite.
- **Anchor `init` griefing on VoteRecord/Proposal**: consistent with the round-7 measurement (pre-funding does not brick).
- **run-tests.sh gates**: Core byte-identity before deploy, ELF magic on the cache, `overflow-checks` asserted, floor hardcoded, PASSED==TOTAL. A green run now proves something.
- **build-mainnet.sh**: behavioural REJECTS/ACCEPTS on all four artifacts plus source-grep; the residual (constant ≠ proven Squads key) is stated honestly and closed only by reproducible build. No lie found.
- **F1-adjacent**: the STATE (alarm) ledger IS properly marked-guarded; the revenue ledger missing → CRITICAL; torn DISTRIBUTION reads while the file exists → CRITICAL. The hole is precisely and only absent-file-for-distributions.

## THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

**Close F1.** Today, `rm` on one JSON file — no key, no signature, one uid — re-pays the day's cbBTC distribution to every activated vault in full, and the watcher explicitly claims to catch exactly this while catching nothing. Add the existence marker, abort `distribute.mjs` on missing-after-existence, and make absence-after-existence a CRITICAL finding. Until then the daily payout job's idempotency is one shell command away from a double spend of customer funds, and the pipeline that is supposed to be the honest broker has a false claim in its own comments about being covered.