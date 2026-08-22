# ROUND 10 AUDIT — FINDINGS FIRST

---

**FINDING 1 — HIGH: The RETURN half of the trusted hop is still the operator's own testimony. The on-chain proof is already fetched and never read.**

`bank/detectors.mjs: detectSplitClaims` and `bank/alarm.mjs`. Round 7 closed "the ledger is written by the key it audits" for the SWEEP side — `detectUnledgeredSweeps` decodes the amount from instruction data. The RETURN side — the cbBTC the holders actually get — was never given the same treatment. `detectSplitClaims` verifies only that `splitSig` EXISTS in the scan; its own comment admits it is "BLIND TO: the AMOUNT".

Concrete exploit, needing only the hot swap-operator key:
1. Operator calls `sweep_sol_for_swap` directly for `max_sweep_lamports` (valid on-chain: operator signs, cap and cooldown pass).
2. Operator swaps SOL→cbBTC privately.
3. Operator returns **1 sat** to the revenue ATA — a plain SPL transfer touching only the Token program, so it is in NO signature scan the alarm runs (SEAL/MINT/BURN/GOV only).
4. Operator calls `split_revenue` (permissionless). It splits the actual balance: 1 sat. This tx touches MINT, so `splitSig` is genuinely seen.
5. Operator writes the ledger row: `sweptLamports` = 50 SOL (must match chain — it does), `quotedSats` = 1,000,000, `returnedSats` = 1,000,000, `splitSig` = real.

Every detector passes: sweep amount matches chain; `cycleIsOpen` is false; returned == quoted (both operator-written); split seen on chain. The next distribution finds ~nothing and — per the round-9 fix — records `nothingToDo`, which is deliberately QUIET. Total signal: zero. The holders lose the cycle's entire return, bounded only by cap × cooldown.

The truth is in data the alarm ALREADY fetches: `getParsedTransaction` returns `meta.preTokenBalances`/`postTokenBalances` (revenue ATA delta across the split) and `meta.logMessages` (the `RevenueSplit` event: disc + mint(32) + total(8) + holders(8) + bank(8) + split_bps(2) — fixed layout, trivially parsed). `normalise()` discards both.

FIX: for each scanned tx containing `split_revenue`, read the revenue ATA's pre/post token balances (or parse the event) and require the on-chain split total ≥ the cycle's claimed `returnedSats`. CRITICAL on shortfall. This is the round-7 class, one hop later.

---

**FINDING 2 — MEDIUM: `detectDistribution` counts a REJECTED row as unresolved — forever.**

`bank/detectors.mjs: detectDistribution` — `const unresolved = rows.filter(([, r]) => !r.sig && !r.skipped)`. Round 9 made a program-rejected transfer `unpaid`/retryable in `paymentState`, but the detector was not updated to match. A rejected row (`{sig: null, rejected: true}`) lives in day N's `paid` map; day N+1 gets a fresh map and re-pays the vault under a new row — but day N's row is never touched again and fires `distribution_unresolved` CRITICAL on every pass, permanently. The code's own example is a frozen destination ATA (cbBTC has a live freeze authority), i.e. a vault that fails EVERY day — one such vault = permanent CRITICAL. This is the exact alarm-fatigue class round 9 closed twice ("a detector on its way to permanent noise"), one site over.

FIX: exclude `r.rejected` from `unresolved` (it means provably-not-landed), and add a per-vault "rejected for N consecutive days" escalation so a persistently frozen vault is still surfaced once.

---

**FINDING 3 — MEDIUM: `swap_operator` rotation is instant and admin-only — and it names the sweep destination.**

`programs/cbob-vault-mint: update_wiring`. `swap_operator` is deliberately outside `needs_governance` (round 8, emergency response). But the operator RECEIVES the swept SOL: admin alone sets `swap_operator = K`, `K` signs `sweep_sol_for_swap`, and `K` holds up to `max_sweep_lamports` per cooldown. The comment's defense — "every lamport comes back to the same revenue address" — IS the trusted-hop assumption; it holds only if the operator is honest. The emergency this optimizes for (operator key compromised) is already covered instantly by `set_paused`, which blocks `sweep_sol_for_swap`. So the instant rotation is a choice, not a necessity — and the comment justifying it is wrong in the dimension that matters.

FIX: timelock the operator rotation like `pending_bank`. If sale liveness during the notice matters, split `sweep_paused` from `paused` so minting continues while sweeps are frozen. Bounded and alarmed-after-the-fact today; the admin is a multisig — but this is the largest single-key fund-flow in the system and it moved from governance-gated to instant on a justification that does not survive contact with the threat model.

---

**FINDING 4 — MEDIUM: "governance_timelock_secs can be RAISED after the fact" is false in the production wiring.**

`programs/cbob-vault-mint: update_wiring`. `needs_governance` includes `governance_timelock_secs.is_some()`. In production `config.governance` is the GOV PDA, whose only CPI is `set_round` — it can never sign `update_wiring`. The field ratchets up only, so requiring governance for the strictly-tightening direction is pure friction, and the comment's claim that a launch value set too low "is fixable rather than permanent" is wrong where it matters. Consequence: deploy with the 60-second floor and EVERY MINT rotation (bank, admin, governance) has a 60-second notice, permanently — while the alarm passes every 30 minutes, so a rotation arms and lands between passes and is seen only as drift aftermath. The escape hatch (rotate governance to a key, raise it, rotate back) works, but only by exercising the exact instant-rotation power the timelock exists to prevent.

FIX: raising `governance_timelock_secs` should be admin-only. The ratchet already forbids the dangerous direction.

---

**FINDING 5 — MEDIUM: revenue.mjs signs the Jupiter swap with no instruction-level inspection.**

`bank/revenue.mjs`. The three checks — exactly one signer, no BPFLoader/MINT in the account keys, ≤4 LUTs — all pass for a tampered `swapTransaction` containing an extra `SystemProgram.transfer(operator → attacker, full balance)`. The operator holds the swept SOL in flight at that moment; the check bounds WHO signs, not WHAT happens to the SOL. The comment says "a bound, not a proof" — but the bound does not bind the thing at risk.

FIX: before broadcasting, `simulateTransaction` the signed tx and assert (a) operator SOL decrease ≤ amount + fees, (b) operator cbBTC ATA increase ≥ `minOut`. Or decode instructions and reject any transfer whose source authority is the operator and whose destination is not the operator's own ATA. Requires a tampered Jupiter response/TLS compromise — but this is the one blind signature in the system.

---

**FINDING 6 — LOW: revenue.mjs can wedge on the rent-exempt remainder — through the CAP, not the reserve.**

`amount = min(balance − reserve, MAX_PER_CYCLE, chainCap)`. With `reserve = 0` and `balance − chainCap ∈ (0, 890_880)`, the runtime rejects the transfer ("insufficient funds for rent") — the precise wedge MINT's own comment describes, reachable via the cap. The script marks it `sendRejected` and recomputes the identical amount every 6 hours. Loud (exit 3 + notify), self-resolving as the balance grows, but wedged until then. FIX: if `0 < balance − amount < RENT_EXEMPT_0_BYTES`, set `amount = balance − RENT_EXEMPT_0_BYTES` (or sweep all when under cap).

---

**FINDING 7 — LOW: `treasury`/`bank_treasury` have no non-default check.** `update_wiring` rejects `Pubkey::default()` for swap_operator/bank/governance/admin but not for the two payout addresses; `initialize` checks none of the six. A fat-fingered `treasury` strands the 85% at the system program's ATA. Two `require_keys_neq!` per site.

**FINDING 8 — LOW: the `max_supply` ratchet is instant, admin-only, and irreversible.** Admin alone can set `max_supply = minted_total` and end the sale forever in one transaction; the alarm sees it only as aftermath. Consider a notice period or governance co-sign on an irreversible act.

**FINDING 9 — LOW: run-tests.sh floor vs the stated suite size.** `MIN_ASSERTIONS=160`; the brief describes an 82-assertion suite. If 82 is accurate, the runner cannot pass as shipped — fail-closed, but then nothing is certified. Reconcile the number. Also `tests/3prog.test.ts` names three programs for four: confirm GOV is actually exercised by the suite this runner certifies.

**FINDING 10 — LOW: distribute.mjs pays vaults redeemed (not burned) between plan and transfer.** The mid-run re-check verifies only that the asset is still a live AssetV1. A vault redeemed after the plan was fixed is still live and still paid, though it no longer holds 21,000 sats. The cbBTC lands in the vault's ATA (sealed, recoverable) — not lost, but paid to a non-qualifying vault. Re-check the balance at transfer time, or document.

**FINDING 11 — LOW: `bank/lock.mjs` was not provided.** `withLock`/`readLedger`/`writeLedger` carry the double-pay and corrupt-ledger guarantees. The selftest exercises them, but I could not review the implementation — specifically whether `writeLedger` is tmp-file-then-rename (a partial write on crash is the exact failure the ledgers exist to survive) and how stale-lock breaking is bounded.

**FINDING 12 — LOW: distribute.mjs and revenue.mjs read the MINT config at raw offsets with no discriminator/version check.** The payout reads are indirectly pinned (the treasury/operator equality checks throw on a layout shift), but `minted_total` and the sweep bounds are not. Two lines match the discipline every other reader applies.

**Also noted, not filed separately:** `detectBalanceDrops`/`detectDeactivations` fire HIGH on every legitimate redemption — the `RedemptionClosed` events that would suppress them are already in the SEAL scan and never cross-referenced (rare events, but two HIGHs each). GOV: a proposal with `closes_at <= voting_ends_at` can never execute (`RoundAlreadyOver`) — `create_proposal` could refuse it. GOV: lowering `quorum_bps` is atomic and admin-only while the MINT-side remedy (governance rotation) takes `governance_timelock_secs`; when `min_voting_secs < governance_timelock_secs`, a hostile GOV admin holding 5% of vaults outruns the remedy. Each piece is documented; the interaction is not.

---

## TRIED AND COULD NOT BREAK

- **Double voting, every route I could construct:** transfer-then-vote (VoteRecord is seeded by asset), delegate (owner bytes must sign), the collection (wrong key byte), a burned vault (account gone), a fake asset (only `mint_vault` can add to the collection; owner/collection/key-byte all checked), re-init (no close instruction), two votes in one tx (second `init` fails). A vault minted mid-proposal CAN vote — documented, bounded by `max(snapshot, live)` and the Bank co-sign duty; I found no angle past that.
- **execute_proposal:** twice (executed flag), out of order (monotonic `last_executed_id`), stale (execution window + `RoundAlreadyOver`), with a faked mint_config (PDA + owner + disc + version pinned). The CPI can only ever be `set_round`; MINT's own bounds (cap > 0, window ≤ 1y, lifetime cap, slippage guard) hold independently of anything GOV does.
- **split_revenue:** destinations are derived ATAs of config values, token program pinned to classic SPL, decimals enforced by TransferChecked, Bank floored / holders remainder / sums exact, 0 and 1 handled, permissionless caller can choose nothing.
- **sweep_sol_for_swap:** amount > 0, cap, cooldown (the 1s floor does close the same-transaction bypass), reserve, operator signature. The rent wedge through the RESERVE is closed; through the CAP it is not (Finding 6).
- **SEAL open/close pairing:** forward scan bound to asset AND owner, backward scan for the open, Bank on both halves. I could not unseal without a terminal close, nor stamp `opened` without an open, nor find an owner-swap between the halves that the Bank's whole-tx signature does not see.
- **The royalty CPI encoding:** suite-proven against pinned mainnet Core (rounds 6/9). Not re-raised.
- **Offsets:** I checked every `readConfigs` offset against all four program layouts byte by byte, and every `space =` against its struct. They match — including the post-Vec SEAL pending fields and `gov.last_executed_id` at 94.
- Nothing I found contradicts "all four programs pass against real Core on a validator." Findings 1–5 live in the off-chain pipeline and operational gates, not the on-chain happy paths.

---

## THE SINGLE THING

**Close the return side of the trusted hop with chain data.** The sweep side is reconciled against the chain (instruction-decoded amounts); the return side — the cbBTC the holders actually receive — is reconciled only against a file written by the key being audited, and the round-9 `nothingToDo` fix means the theft does not even surface as a missed distribution. The split transaction the alarm already fetches contains the truth in `meta.preTokenBalances`/`postTokenBalances` (or the `RevenueSplit` event in the logs). Compare the on-chain split total to the ledger's `returnedSats` and scream on a shortfall. Until then, one hot key can take 50 SOL per cooldown and every detector stays green.