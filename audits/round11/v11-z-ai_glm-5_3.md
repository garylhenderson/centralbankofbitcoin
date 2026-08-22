# ROUND 11 — FINDINGS

## 1. MEDIUM-HIGH — `bank/lock.mjs`: the stale-lock break is not atomic, release is unconditional, and the promised "SAY SO" never happens

This file is the mutual exclusion under **both** money jobs and has never been audited. Three defects compound:

**(a) The stale break is a plain overwrite, not an atomic claim.** `acquireLock`'s stale path is `fs.writeFileSync(file, payload)` — no `'wx'`. Two runners that both read a stale lock in the same instant both write and both return `{ok:true}`. The lock's entire guarantee is `O_EXCL`; the one path that most needs it doesn't use it.

**(b) `releaseLock` deletes whatever is there.** `withLock`'s `finally` calls `fs.unlinkSync(file)` with no ownership check. Concrete sequence: distribute run A starts 09:07 and stalls — no request timeout is configured on the `Connection`, so one hung HTTPS call freezes it indefinitely. At 05:07 next day the lock is stale; cron run B breaks in at 09:07 and begins paying. A wakes, pays one more vault, and its `finally` **deletes B's lock**. A manual run C now acquires while B still runs. Two writers, each holding a whole-file in-memory ledger, each `save()` erasing the other's rows — the next run re-pays every vault whose row vanished. This is the exact double-payment the file's own header says it exists to prevent.

**(c) The break is silent.** The comment says "Break it, but SAY SO — a silently broken lock is how you get two runners anyway, on the day the first one was merely slow." `withLock` receives `l.broke` and discards it; no caller prints it. The property the comment claims is not implemented — class E (comment claims what code doesn't do).

Note the margins: distribute gets 20h against a ~2–6h run (fine), but **revenue gets 2h against a 6h cron with unbounded RPC waits**. The on-chain cooldown happens to bound a second *sweep*, but the ledger clobbering is unbounded.

**Fix:** write a per-holder token in the lock; on release, unlink only if the token matches; make the break atomic (temp file + `link`, or unlink-then-`'wx'` with retry); log `broke` loudly; set fetch timeouts; for the money jobs consider requiring a human to clear a stale lock rather than breaking it blind.

## 2. MEDIUM — `detectors.mjs`: the round-10 "class-closing" assertion does NOT cover everything the standing checks read — the four `*.collection` keys are absent from `WATCHED_KEYS`

The repair's claim was "It now asserts against everything the standing checks read." `detectStandingRisks` reads:

```js
const colls = ['seal.collection', 'mint.collection', 'burn.collection', 'gov.collection']
```

None of these four keys is in `WATCH` or in the extra `WATCHED_KEYS` list. `readConfigs` produces them today, so the check works now — but the mechanical guard exists precisely so that a future edit cannot silently unwire a standing check, and it does not guard these. The failure mode is the exact `mint.pending_bank` shape: drop `['collection',41,'pk']` from one program's field list, `.filter(([, v]) => v)` drops the undefined, `colls.length > 1` goes false, and **`collections_disagree` — the check that catches vaults minted into a collection the seal program will never service — never fires again, reading as calm.** The round-10 selftest proves `missingWatchedKeys` checks its input list; it cannot catch a key missing *from* the list.

**Fix:** add the four keys to `WATCHED_KEYS` — or better, derive the list from what the detectors read (export a `KEYS_READ` from `detectors.mjs` and assert `WATCHED_KEYS ⊇ KEYS_READ` in the selftest, closing the meta-gap).

## 3. MEDIUM — `detectDistribution`: `resolvedBy` landed on one of three sites — `distribution_refused` and `distribution_unfinished` have no resolution path

```js
const unresolved = rows.filter(([, r]) => !r.sig && !r.skipped && !r.rejected && !r.resolvedBy)
const refused    = rows.filter(([, r]) => r.rejected)
```

`refused` ignores `resolvedBy` and `skipped` entirely. The codebase's own comment in `distribute.mjs` says cbBTC has a **live freeze authority**; a vault whose destination ATA is frozen is refused on every retry, forever, and `distribution_refused` fires a HIGH **every 30 minutes forever** with no way to answer it. This is the fifth round running of the one-of-two-sites class — here one of *three* — and it recreates the exact condition the round-10 repair was written to remove: "a finding with no way to be answered is one that will eventually be ignored rather than answered." An ignored refused-row channel is where a real payment failure will later hide. `distribution_unfinished` for a dead day has the same shape.

**Fix:** extend the `resolvedBy` escape to `refused` and `unfinished` rows.

## 4. MEDIUM — `distribute.mjs --selftest` has no assertion floor; the floor landed on one of two sites

`selftest.mjs` got `FLOOR = 135` last night. Its twin ends:

```js
process.exit(R.every(Boolean) ? 0 : 1)
```

No floor. A truncated-but-clean file with two passing assertions exits 0 and `run-tests.sh` step 6 passes. This selftest guards `allocate` and `paymentState` — the arithmetic that decides who gets paid how much. **Fix:** add a floor (15 today) and grep the count in `run-tests.sh`.

## 5. LOW-MEDIUM — the suite never separates `admin` from `bank`, so no assertion can distinguish a check against `config.admin` from one against `config.bank`

Every program is initialized with `bank` as **both** admin and bank, and no admin/bank rotation is ever *applied*. If a future edit to `mint_vault` checked the co-signer against `cfg.admin` instead of `cfg.bank`, the entire 200-assertion suite stays green, and in production the enumeration duty silently moves from the Bank to the Squads multisig — the 2-of-2 mint control degraded with a green run certifying nothing. Same blindness for SEAL/BURN/GOV. **Fix:** initialize one program with admin ≠ bank and assert the wrong-role signer is refused *for the right reason*.

## 6. LOW — suite gaps in the newest paths

- **Five apply-pending paths are never executed**: MINT admin, MINT bank, SEAL both, BURN both, GOV admin. Only arm/refuse/cancel are tested; the "same three lines in both programs" claim is an assumption. I read all five handlers — each clears only its own field, so the round-9 `apply_pending_admin`-clears-`pending_bank` bug did **not** relocate — but nothing would catch it if it did, and that bug class lived in exactly these lines.
- **`SupplyCapReached` is never reached.** No test sets `max_supply = minted_total` (legal) and then mints. 6.8/6.9 test the *ratchet*, not the gate; delete the `minted_total < max_supply` check and the suite stays green.
- Negatives 3.1, 3.3, 4.1, 4.4, 5.1, 8.12 record REJECT with no `because()` reason check. 3.3 — the delegate-during-thaw rejection, the load-bearing 2-of-2 property — can fail, but cannot prove *why* it failed.

## 7. LOW — `scripts/probe-mainnet-facts.mjs` is wired into nothing

Not in `run-tests.sh`, not in cron. The cbBTC-is-classic-SPL fact is immutable (a mint's owning program is fixed at creation), so the fact survives — but the signature-paging half validates live-RPC behavior that *can* drift, and nothing re-runs it. One line in `run-tests.sh` (skipped when offline) would make "permanent" mean permanent.

---

# WHAT I TRIED AND COULD NOT BREAK

- **The `splitByOther` empty-ATA proof is sound.** The only instruction that can move tokens out of the revenue ATA is `split_revenue` signed by the revenue PDA; its destinations are derived from `config.treasury`/`config.bank_treasury`, both governance-gated; the split always moves the *entire* balance. So "our split reverted `NothingToSplit` AND the ATA reads zero" ⟹ a correct 85/15 split happened. An attacker cannot manufacture emptiness (no delegate, no close, no other signer for the PDA), cannot split to their own address, and front-running for one transaction fee only closes our cycle correctly.
- **The operator notice period plus `set_paused` covers the emergency.** Pause stops sweeps in the same transaction; arming is admin-only; apply is clock-gated and permissionless; cancel is current-admin. The cost (sale paused for the notice period) is stated, not hidden.
- **The deferred-sweep failure carry is correct**: the union carried on failed delivery is a superset of `keep`; resolved entries re-check silently; reported-but-undelivered entries re-report.
- **The dry-run marker fix is real** — `EVER` and `writeState` are both `!DRY`-gated; a dry run on a fresh box leaves no trace.
- **Split-signature reuse** is checked across the whole ledger before any horizon filtering; `splitByOther` cycles are excluded from the claimed set, which is safe because no code path writes both fields.
- **Refused-vs-unconfirmed** is now right on both sites (`paymentState`, `detectDistribution`) and in `revenue.mjs`'s `sendRejected`.
- **The hardcoded Core sha** holds in both scripts; `CBOB_CACHE` substitution fails the pin.
- **Absent-ATA-is-a-fault** throws before any ledger write and notifies; the sibling `?? 0n` reads in `revenue.mjs`/alarm are correct (absent genuinely is zero there).
- **`resolvedBy` is not attacker-reachable** without host write access, which is already the accepted boundary (and `detectUnledgeredSweeps` reads the chain precisely to bound it).
- **The burn loops now agree** (reserve and non-reserve carry the same delegate/close/extension checks); **GOV's vote binding** is asset-seeded and tested through transfer; **the royalty CPI** is fetch-back-asserted against real Core at both opcodes.

---

# THE SINGLE THING

**Fix `bank/lock.mjs` before this holds real money.** It is the only never-audited component standing between the system and silent double-payment, its failure mode is exactly the catastrophe the whole ledger apparatus exists to prevent, its margins are thinnest on the revenue job (2h stale against unbounded RPC waits on a 6h cron), and its own header claims a property — "SAY SO" on a stale break — that the code does not implement. Ownership-checked release, an atomic break, and a logged `broke` are twenty lines. The `WATCHED_KEYS` one-liner (finding 2) should ride along in the same commit, because the newest repair's central claim is currently false and this repo's own history is the proof that the unwired-check class is its most frequent defect.