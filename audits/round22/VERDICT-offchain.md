# Round 22, OFF-CHAIN pass: NOT CLEAN

Frozen tree `baa7d0b` (HEAD `fa417ce`). 7 of 8 auditors counted (quorum 6):
gpt-6.1-sol-pro, gpt-6-astra-pro, grok-4.7, deepseek-v4-pro-0813, claude-opus-5.5,
qwen3.8-max-prime, glm-5.3-prime. xiaomi/mimo-v2.6-pro disqualified (provider
`error`). Triage: an independent read-only agent read all seven in full and
verified every distinct finding against the code, MEASURING most by calling the
real `bank/*.mjs` functions in node.

**60 distinct findings: 27 CONFIRMED (0 CRITICAL, 0 HIGH, 7 MEDIUM, 19 LOW, 1
INFO), 5 ACCEPTED-LIMIT, 14 DOC-ONLY, 12 WRONG, 2 UNVERIFIED.** No theft path, no
value sent anywhere the programs do not pin. The two CRITICALs (glm, deepseek: a
pre-funded ATA "bricks" a vault) are WRONG: the ATA program tops up and assigns a
pre-funded system-owned address.

## CONFIRMED, MEDIUM

| id | finding | evidence |
|---|---|---|
| A1 | Every honest redemption raised `bare_core_burn` CRITICAL: the alarm flattens inner instructions and BURN's own Core BurnV1 CPI matched the bare-burn detector. Measured with the real `normalise`. | `alarm.mjs:162-173`, `detectors.mjs:158-165, 857-862` |
| A4 | Liveness backstops silent: no page when nobody can join after launch (weight 0), when the reveal queue head lapses with nobody calling reschedule, or when owed sits undelivered. Limit 7's "pages when a window lapses" was false. | `detectors.mjs:1517-1519, 407-409` |
| A5 | The lock-date check never ran: nothing sets `CBOB_LOCK_DEADLINE`. | `alarm.mjs:364`, `detectors.mjs:1622` |
| A7 | Launch gates did not pin `max_supply`, `level_caps`, `payment_mint`, `bank_treasury`, charter length, guardian, reserves: measured `judgeLaunch` accepting each changed. | `detectors.mjs:442-460`, `check-launch-params.mjs:44-71` |
| S1 | Mint-price cbBTC was split only at the end of a SOL cycle; nothing split it otherwise and nothing alarmed on it. | `revenue.mjs:117,136,177,362`; crank sends no split |
| F6 | A frozen VAULT cbBTC account was skipped by the crank and never paged. | `crank.mjs:217`, `alarm.mjs:432-440` |
| A3 | `redemptions_near_cap` paged on an idle window whenever live supply is 47 or less. | `detectors.mjs:1590-1598` |

## CONFIRMED, LOW / INFO

F1 `readySlot` is a lower bound (RevealTooEarly pages, stops the reveal run) ·
F2 benign races between lanes and ordinary traffic page as failures · F3 a crashed
holder's fresh lock blocks the reveal lane 2 h · F4 lock generation reuse after
release (needs a manual run outside cron's flock) · F5 the planner ignores its own
retirements and pre-joins · F7 the crank distributes from a frozen pool · F8
anyone can stop the crank by sending its key 0.25 SOL · A2 config and pool read at
different times (transient false insolvency) · A6 `missingWatchedKeys` exempts all
`prog.*` keys · A8 $GARY/$GIRAFFISH reserves never balance-watched · A9 sweep
"wedged" bands narrower than the initialize bounds · L1 `parseRustStruct` drops
private / multi-line fields · L2 the OFF_* cross-check is a hand list (7 scraped
constants never compared) · L3 weights / ACC_SCALE / reveal constants not checked
against the Rust · G1 several gate assertions claim more than they check · G3
three runner sites swallow output on failure · S4 swap return floor rejects swaps
inside both tolerances · S6 a crash between split and ledger save wedges cycles ·
P1 poster: released amount, duplicate drafts on crash, cursor past a gap · L4
`encode` has no `[i64; 64]` writer (INFO).

## ACCEPTED-LIMIT (not new)
F9 (item 22) · F10 (limit 40) · F15 (limit 27) · S2 (limit 10; SPEC should name the
`/swap` response as part of the trusted hop) · S3 (limit 10).

## DOC-ONLY
D1 limit 25's "a lapse needs a crank outage AND no traffic" is false · D2 limit 26:
same-slot mints share all three hashes, so C's leader biases the cohort · D3 a
frozen VAULT account blocks that vault's whole redemption (BURN needs amount 0) ·
D4 limit 43: a stack-height check COULD refuse off-curve owners at mint (owner
decision, pre-deploy only) · D5 level-up by burning $CBOB cannot be added after
the lock: build before or strike · D6 SPEC said sim results pending · D7 compute
of host instructions with full cranks / 14-pair claims unmeasured against 200k ·
D8 the off-chain bundle omitted `bank/sigwalk.mjs`, `scripts/cron-install.sh`,
`scripts/check-launch-params.mjs` · A10 per-asset PoB plugins not watched · A16
`ACKS` comment wrong · G2 the mainnet probe skipping on no DNS must be run once for
the ship gate · G4 SPEC said 732/6,405 unasserted · G5 `accrual.mjs` header
overclaims `retire` · S5 nothing creates the pool ATA (add to road step 10) ·
(from disqualified xiaomi, verified) the off-chain code hard-codes program IDs, so
a throwaway-ID dress rehearsal cannot run it unchanged.

## WRONG (12)
A12 pre-funded ATA bricking (both CRITICALs) · A13 · A14 · A15 · A11 · F11 · F12 ·
F13 · F14 · S7 · holder-guide first payout · item 50 demotion.

## UNVERIFIED
A17 whether Helius `getAssetsByGroup` returns burnt Core assets · S8 whether
`quote-api.jup.ag/v6` is still live.

**Verdict: NOT CLEAN.** Every CONFIRMED finding is fixed before round 23; the
counter stays at 0 of 2.
