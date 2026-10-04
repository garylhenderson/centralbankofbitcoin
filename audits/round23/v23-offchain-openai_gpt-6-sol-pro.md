## R1 — Crank

**MEDIUM — An unreadable asset can still be joined or paid.** In `bank/crank.mjs`, `planCrank` excludes an asset from `preJoins`, `joins`, and `claims` only when `assets[r.asset] === 'burned'`. The I/O reader assigns `'other'` when the asset account is absent or has an unexpected owner or shape. Thus a failed or inconsistent asset read is not proof of life, but the planner may still send a join or claim. Unlike `activate`, `claim` does not check whether the asset is live.

- **What it costs:** If that unknown asset is burned, a join adds dead payout weight or a claim sends its share behind a burned asset. The accepted limit describes this risk for third-party claims; the crank is supposed to avoid it.
- **Checkable evidence:** Feed `planCrank` an eligible pending record with `assets[asset] = 'other'`: it appears in `preJoins`. Feed it an owed active record with the same asset status and a readable destination: it appears in `claims`. Confirm separately how a null or malformed asset RPC result is classified.
- **Fix:** Require *positively live* assets for joins and claims. Report unknown assets as a read failure and retry; retire only positively burned assets.

**LOW — Unrevealed bare burns are left unretired.** `planCrank` adds a positively burned record to `retireBurned` only if `r.level !== 0`. MINT’s `retire_burned` can retire an inactive, unlevelled record: `retire` needs a level only when `r.active`, which an unlevelled vault cannot be.

- **What it costs:** A burned vault continues to count in live supply for governance until its FIFO reveal succeeds, even though retirement need not wait.
- **Checkable evidence:** A record with `level: 0`, `retired: false`, and asset status `'burned'` produces no `retireBurned` action; a direct `retire_burned` test on that state should succeed.
- **Fix:** Remove the level condition. Keep the later reveal of the burned asset for census/FIFO purposes.

## R2 — Alarm

**MEDIUM — Delivered payouts can stop indefinitely without a payout-stall page.** Round 22 identified “owed sits undelivered,” but `detectDistributionOverdue` watches **undistributed** pool balance, not credited-but-unclaimed `mint.owed_scaled`. `detectPoolHealth` calls a solvent pool healthy. If distributions continue, or the pool consists entirely of already-owed cbBTC, a stopped claim lane can leave holders unpaid while these detectors stay quiet. `mint.owed_scaled` is read into the snapshot but has no claim-liveness detector.

- **What it costs:** A wedged or unarmed hourly claim job can leave payable cbBTC in the pool indefinitely without the promised operational backstop. A frozen destination has a separate alert; this case needs no freeze.
- **Checkable evidence:** Use a solvent, unfrozen pool with `amount === ceil(owed_scaled / ACC_SCALE)`, whole sats owed to a live vault, and no claims across successive alarm passes. `poolAvailable` is zero, `detectPoolHealth` is quiet, and `detectDistributionOverdue` returns no payout finding.
- **Fix:** Persist and check claim progress separately from distribution progress. Page when whole-sat obligations remain undelivered beyond a stated grace period; distinguish persistent frozen destinations from an idle claim lane.

**LOW — A failed revenue-ATA read resets the unsplit-revenue clock silently.** In `bank/alarm.mjs` `main`, the revenue read invokes `detectUnsplitRevenue` only for `state === 'ok'` and a positive amount. An absent, foreign, or malformed response produces no read-failure finding and sets `revenueSince` to `null` in the next state. A later good read starts a fresh six-hour grace period.

- **What it costs:** An RPC or account-read failure can hide an already-overdue split and make that pass’s report look quiet on this check.
- **Checkable evidence:** Run the read logic with a prior `revenueSince`, then a null account response, then the original positive balance. The middle pass has no revenue finding; the last pass uses the new time, not the original one.
- **Fix:** Page on an unreadable revenue account after initialization, and preserve the prior `revenueSince` until a reliable zero balance or completed split is observed.

## R3 — Layouts

**LOW — Changing Rust’s `BOOST_RING` size escapes the claimed layout assertion.** `bank/layout.mjs` parses the field’s Rust type as the unchanged text `[u32; BOOST_RING]`, but hard-codes that type to **256 bytes and 64 elements** in `FIXED`, `readField`, and `encode`. `bank/selftest.mjs` compares field names and type text; its constant checks do not compare Rust’s `BOOST_RING` value with 64.

- **What it costs:** A source change to the ring length can leave an apparently passing field-for-field layout gate while the decoder silently reads only part of `MintConfig.boost_expiring`.
- **Checkable evidence:** In a disposable tree, change only `const BOOST_RING: usize = 64` to `128`, leaving the field declaration intact. The struct-text comparison still agrees, while an encoded Rust config has 512 ring bytes and the JS reader consumes 256.
- **Fix:** Assert the Rust constant against the decoder’s element count, or derive the array reader and size from an asserted constant. Add this one-line mutation as a negative gate test.

## R4/R4b — Money arithmetic and boost

I found no demonstrated divergence in the supplied `credit`, `ceil`, `owed_of`/`pendingScaled`, `reweigh`, or pre-expiry formulas. That is **not** a validation of every boost-planner test: the selftest arm named “both are then paid at weight 2 (40 sats … 20 each)” asserts only `p.claims.length === 1`. An incorrect denominator that still makes both vaults claimable passes that arm. Before treating it as an arithmetic gate, assert the predicted **per-vault sat amounts** at a threshold where the correct and incorrect denominators produce different claim plans.

`create-cbob-token.mjs` puts mint creation, full minting, and mint-authority revocation in one transaction, with no freeze authority specified; a transaction failure cannot leave a partial on-chain supply from that transaction. Its readback checks those properties. The remaining launch obligation is to prove that the **address passed to MINT `initialize`** is this verified mint: MINT checks that `cbob_mint` is an initialized classic SPL mint, not its supply or authorities, and `judgeLaunch` checks the address’s shape and distinctness, not its correspondence to `cbob-token.mainnet.json`. This is part of open item **51**, not a reason to mark it discharged.

## R5 — Swap hop

I found no established route in the supplied on-chain split or sweep that redirects value away from their pinned destinations. The Jupiter `/swap` transaction remains within the expressly accepted trusted hop; the script’s static-key checks are not a proof that an arbitrary returned swap transaction is safe. Do not describe them as one. The dress rehearsal must exercise a failed, expired, and confirmed swap and its ledger recovery before relying on the hop.

## R6 — Gates and stated behavior

**LOW — A named boost arithmetic assertion cannot test its claim.** The `bank/selftest.mjs` arm identified above checks the number of claim *batches*, not the asserted 20/20 split. This matters because it is cited as evidence for the new boost repair.

**LOW — The fee ceiling is no longer a refusal, despite operational copy saying it is.** `judgeFeePayer` deliberately returns `{ok: true, warn: ...}` above 0.25 SOL to prevent anyone disabling the crank by depositing SOL. That repair resolves a real denial of service, but `bank/crank.mjs`’s header, `SPEC.md`’s control table/off-chain descriptions, and the cron installer’s posture print still say the key **refuses** above 0.25 SOL.

- **Checkable evidence:** `judgeFeePayer(250_000_001n).ok === true` is already asserted by the selftest.
- **Fix:** Correct every promise to “runs and warns”; retain the repair rather than restoring the deposit-triggered outage.

## Accepted limits: four requested checks

1. **Worse than stated:** Limit 7’s operational backstop is weaker for *claims* than the text suggests: `distribution_overdue` cannot see credited funds that nobody delivers. The positively burned-vault protection in limit 27 also does not extend to an asset the crank could not positively classify.
2. **Not actually a limit:** The 0.25-SOL *refusal* described in the docs is no longer a limit; it is a warning by design. I did not establish that the accepted on-chain limitations on bare burns, Core, Coinbase, or owner transfers have disappeared.
3. **Discharged items:** I found no basis here to reopen the measured burned-address, rent, or immutable-ProgramData conclusions. The newer claim that **every** layout-changing struct edit is gated needs the `BOOST_RING` exception above closed.
4. **Open and blocking:** Items **22, 38, 50, 51, and 52** must not be converted into accepted limitations. In particular, the current mint-creation readback is not a launch-time check that MINT was initialized with *that* mint, and the supplied redeem-page function is not a built pre-signature page. Item 53’s recorded test-tree patch does not itself complete the live dress rehearsal.

## Before an irreversible launch, without a human audit firm

Do not remove any upgrade authority on the strength of another AI verdict. First complete the blocking holder surfaces and launch values; run the **shipped off-chain jobs** in a live-cluster, throwaway-ID rehearsal with real small-value transactions, including RPC nulls, a job crash after each send, 2,100-record pagination, and an expired swap. Independently read back all four initialized accounts, the verified $CBOB mint and its authorities, pool/Squads ATAs, and deployed binary hashes from chain. Have the people who will operate it perform a timed incident drill: stop a compromised swap key, recover an open ledger cycle, diagnose a stuck reveal and claim lane, and redeem a three-reserve vault with its destination accounts pre-created. Preserve the transactions, logs, account snapshots, and exact binaries as the release evidence. If any of those exercises cannot be completed, postpone the irreversible lock.