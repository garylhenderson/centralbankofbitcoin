# ROUND 9 AUDIT — FINDINGS

## 1. CRITICAL — The grace window in `detectUnledgeredSweeps` plus cursor advancement = a sweep is never examined twice

**`bank/alarm.mjs` (scan loop) + `bank/detectors.mjs` (`detectUnledgeredSweeps`).**

Round 8 added a grace window so the detector "does not race the writer": `const stale = !opts.blockTime || !opts.now || (opts.now - opts.blockTime) > graceSecs` (900s), and `if (!stale) continue`. But the scan is **incremental**: after the pass, `cursors[id] = sigs[0].signature` advances past every signature seen, and `signaturesSince` only ever returns signatures *newer* than the cursor. A grace-skipped sweep is therefore examined **exactly once, within its grace window, and never again.**

**Exploit:** anyone holding the swap-operator key (a hot key on the box) calls `sweep_sol_for_swap` directly — operator signs, amount = `max_sweep_lamports` — at :50. The :53 pass scans it at age 3 min < 900s → skipped. Cursor advances. No ledger row is ever written, so `detectUnreconciledRevenue` has nothing to iterate and `detectSplitClaims` has nothing to check. **Nothing fires, ever.** Repeat every `sweep_cooldown_secs`: 50 SOL per window, silent. Even untimed, a sweep has a 50% chance its first pass falls inside 15 minutes. And the *legitimate* cron (sweep ~:41, alarm :53 → ~12 min) is always inside the grace window, so even a genuine sweep whose row is lost is never flagged. This kills the round-7 headline control ("the alarm now reads SWEEPS OFF THE CHAIN") for exactly the case it exists for.

**Fix:** persist grace-skipped sweeps in alarm state (`pendingSweeps: [{sig, blockTime, amount}]`); each pass, drop any that gained a matching ledger row and raise CRITICAL on any that are stale with none. Do not rely on the cursor for re-examination.

## 2. HIGH — `mint.pending_bank` is in the watch lists but `readConfigs` never reads it

**`bank/alarm.mjs` `readConfigs` vs `bank/detectors.mjs` (`detectConfigDrift`, `detectStandingRisks`).**

The drift watch has `['mint.pending_bank', S.CRITICAL, 'A BANK ROTATION IS ARMED']` and the standing-risk rotation loop includes `mint.pending_bank`. The selftest proves both fire when fed. But the `readConfigs` mint field list stops at `pending_admin`(369)/`pending_admin_at`(401) — **`pending_bank` @409 and `pending_bank_at` @441 are never read.** `cur['mint.pending_bank']` is `undefined` on every pass: drift compares null→null, the standing check skips on falsy. An armed rotation of the Bank that co-signs every mint produces **no finding for the entire notice period**; the first alert is `mint.bank` drift *after* `apply_pending_bank` lands. This is the round-6 `collection.hash` class exactly ("in the watch list and NOTHING EVER WROTE THE KEY"), and round 8's own summary claims "every pending-rotation slot" is watched. The selftest passes throughout — detector proven, wiring dead.

**Fix:** add `['pending_bank',409,'pk'],['pending_bank_at',441,'i64']` to the mint `readConfigs` call.

## 3. HIGH — A cycle that returns cbBTC but is never SPLIT is invisible to the alarm

**`bank/detectors.mjs` `detectUnreconciledRevenue` / `detectSplitClaims`; `bank/selftest.mjs`.**

Round 8 changed `cycleIsOpen` so a cycle is finished only when split. But `detectUnreconciledRevenue` has no branch for `returnedSats > 0 && !splitSig`: an open cycle past grace with a full return falls through the `returned === 0n` branch and passes the quote check → **no finding**. `detectSplitClaims` skips cycles with no `splitSig` (`if (!c.splitSig) continue`). So a cycle whose return landed but whose split failed (frozen holders ATA, treasury rotated mid-run) or whose split *landed but threw on confirmation* (splitSig never written) is quiet in the independent watcher. The selftest **enshrines** this: `t('QUIET once the cbBTC has returned', … returnedSats: '9' … ).length, 0)` — that cycle has no `splitSig`, is open by the canonical predicate, and the suite asserts silence. The script's own open-cycle guard mitigates (it throws), but the script is the audited party; the alarm is the check on it, and it is blind.

**Fix:** in `detectUnreconciledRevenue`, flag open cycles with `returned > 0n && !c.splitSig` past grace as CRITICAL (`unsplit_return`); change the selftest case to expect it.

## 4. MEDIUM — `seenSplits` eviction keeps the OLDEST 200 and drops the NEWEST

**`bank/alarm.mjs`:** `seenSplits: [...new Set([...seenSplits, ...(prev?.seenSplits || [])])].slice(-200)`. This pass's splits are front-loaded; `slice(-200)` keeps the tail. Once 200 splits accumulate (~7 weeks of daily cycles), the persisted set freezes at the first 200 forever and each new split is dropped from state the same pass it is seen. The next pass, that cycle (now past the 60-min grace) is checked against a set without its splitSig → false `split_not_on_chain` CRITICAL, every cycle, forever — a wolf-cry that masks real ones. **Fix:** `slice(0, 200)` (or append `prev` first).

## 5. MEDIUM — Two permanent distribution false positives

**`bank/detectors.mjs` `detectDistribution` + `bank/distribute.mjs`.** (a) A vault skipped as burned-mid-run is recorded `{sig: null, skipped: '…'}`; the detector's unresolved filter is `!r.sig`, so every such row is a CRITICAL "transfer has no signature" **on every pass, forever**. (b) A legitimate skip day ("no cbBTC to distribute") writes `startedAt` with no `finishedAt` → `distribution_unfinished` HIGH the next day — daily, until first revenue. Both train operators to scroll past the distribution detector. **Fix:** treat `skipped` rows as resolved; stamp `finishedAt` (or a day-level `skipped` marker the detector honours) on a clean skip.

## 6. MEDIUM — GOV: the round-8 quorum comment claims the opposite of the truth

**`programs/cbob-vault-gov/src/lib.rs` (`execute_proposal` comment).** "A mint can only make a proposal HARDER to pass" is false when the minter *votes*: `need = ceil(divisor·bps/10000)`, so minting K vaults and voting adds K to `cast` and K·bps/10000 to `need` — net helpful for any bps < 10000. And minting after voting closes but before execute raises the divisor while `cast` is fixed, which can push a *passed* proposal below quorum (grief). Both vectors are gated by the Bank's co-signature on every mint and by the round price — but the Bank's documented duties say nothing about refusing governance-dilution mints during an open proposal, and the comment asserts the safe direction that does not exist. **Fix:** correct the comment; write the Bank's mint-refusal duty during open proposals down explicitly.

## 7. LOW — `treasury`/`bank_treasury` rotations lack the default-pubkey refusal `swap_operator` has

**`programs/cbob-vault-mint/src/lib.rs` `update_wiring`.** `swap_operator` gets `require_keys_neq!(x, Pubkey::default())`; `treasury` and `bank_treasury` do not. A governance-signed rotation to `111…` locks the 85% (or 15%) in an ATA nobody can sign for, forever. Gated by governance + alarm, but inconsistent. Also: the comment "replacing the swap operator cannot redirect anyone's money" is false for one cooldown's worth — admin can rotate the operator to itself and sweep `max_sweep_lamports`. The emergency-response trade-off is documented; the overclaim should not be.

## 8. LOW — Stale error string

**MINT `MintError::BadSplit`:** "…so the royalty plugin can express it" — the comment directly above `split_bps` now says that justification "named a mechanism that does not exist". The error message still asserts it.

## Question, not a finding
`run-tests.sh` enforces `MIN_ASSERTIONS=160`; the brief describes an "82-assertion suite". If the suite really emits 82, the runner can never go green. Verify which is stale.

## Unreviewable
`bank/lock.mjs` is imported by every job (`withLock`, `readLedger`, `writeLedger`, marker semantics) but was not provided. Every money-safety property attributed to it rests on an unseen file.

---

## WHAT I TRIED AND COULD NOT BREAK

- **GOV vote integrity:** double-vote (asset-seeded VoteRecord `init` fails), vote-then-transfer (record persists, buyer inherits a spoken vault), vote by burned vault (account read fails), vote by delegate (owner signature required), foreign vault (collection pinned). All hold.
- **GOV lifecycle:** execute twice (`executed`), after expiry (`ProposalExpired`), stale round (`RoundAlreadyOver`), out-of-order (`ProposalSuperseded`), retroactive rule change (bps snapshotted into the Proposal). All hold. Quorum arithmetic (ceiling, `need > 0`, `max(snapshot, live)`) is internally correct — the defect is the comment, not the math.
- **`set_round` reach:** a ratified proposal cannot exceed `max_supply`, cannot express cap 0 or an unbounded window, cannot install a closed round. The lifetime cap is the real outer bound and holds.
- **`split_revenue`:** destinations pinned by config + ATA derivation, token program pinned to classic SPL, Bank floored / holders remainder, transfers sum exactly to the balance, `total > 0`. Fake mint/ATA → SPL rejects. Holds.
- **`sweep_sol_for_swap`:** operator is a required signer pinned to config, cap + cooldown + reserve all on-chain; the 1s floor closes the same-transaction bypass. Holds.
- **SEAL open/close pairing:** the forward scan binds asset AND owner; the transfer-between-open-and-close case reverts via `NoTerminalClose`. Holds.
- **BURN:** declared-account emptiness, nested-vault refusal, the `lamports == 0` check (R4 measured necessary). Holds for declared accounts; the undeclared-account gap is the acknowledged off-chain duty.
- **`build-mainnet.sh` / `run-tests.sh`:** the behavioural init-authority proof, pipefail, assertion floor, pinned Core hash — sound for what they claim.

## THE SINGLE THING

Fix **Finding 1** before this holds real money. The swap operator is the one trusted hop; the chain-derived sweep watch is the only independent check on its OUT leg; and the round-8 grace window, combined with incremental cursors, makes it reliably dead for any sweep timed near an alarm pass — which the cron layout makes the default. Persist grace-skipped sweeps in state and re-examine them until stale, or a compromised operator key drains 50 SOL per cooldown with no alarm ever raised.