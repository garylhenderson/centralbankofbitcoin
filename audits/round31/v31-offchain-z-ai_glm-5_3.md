# Round 31, off-chain pass — verdict

**NOT CLEAN.** One HIGH, one LOW, two INFO. Round 30's six repairs all hold at their sites with real both-ways arms; no regression from them. The HIGH is in the swap builder, in the exact place R5(g) of this round's brief asks about, and no prior round or gate covers it.

---

## R0. Round 30's verdict and its repairs — independently verified

I read the verdict as NOT CLEAN (6/8 quorum, one MEDIUM, three LOW, two INFO) and re-audited every repair against this tree rather than trusting its text.

**M1 (scan backlog) — repair holds, no regression.** `bank/sigwalk.mjs` `signaturesSince` takes `startBefore` and pages downward from it toward `until`; `bank/alarm.mjs` keeps `backlogs[id] = { head, before }`, resumes from `before`, moves the cursor to `head` only when a pass reaches the old cursor, and requires positive proof (the signature immediately below `before` IS the cursor, or `before` resolves with nothing below it) before declaring a drain — otherwise `scan_backlog_unproven` CRITICAL. The poster (`bank/redemption-poster.mjs` `st.backlog`) applies the same rule and the same proof. I traced the interleavings: a gapped resumed pass keeps the old head and moves `before` down; a completed drain moves the cursor to the head only after the whole window has been examined across passes; transactions newer than the head are deferred to the post-drain pass (the disclosed bound); an unresolvable cursor under a backlog drains to the history floor and nothing readable is skipped. The selftest's R30 M1 arms drive the real `signaturesSince` and the source-extracted walk through a 25,000-signature stub flood in both directions, including the ghost-resume case. The repair is real.

**L1 (truncation paging) — repair holds; one residual (filed below as LOW-1).** `bank/alarm.mjs` now splits on whether one of our five programs appears as an *instruction programId* (i.e., was actually invoked, top level or inner) versus merely named as an unused account. Invoked → `log_coverage_gap` HIGH urgent, recorded in `logGaps`; named-only → `log_truncated_foreign` INFO, unpaged, kept out of the bounded `logGaps`. The selftest arms (R29 M1 / R30 L1) drive both shapes through the extracted walk. Correct and narrower than round 29.

**L2 (fee floor) — repair holds.** `budgetPlan` runs the base plan whenever the key covers it (floor 0 for the base), budgets reveals only from `lamports − baseCost − floor`, so the post-pass balance never goes below the floor through reveals, and a below-floor key still sends every capture with its own warning stream and marker. The R30 L2 arms verify at, under and one-lamport-over the floor.

**L3 (dust) — repair holds.** `SW.sweepAmount` returns `0n` below `MIN_SWEEP_LAMPORTS` above the reserve, after both caps; `revenue.mjs` uses it and prints "nothing worth sweeping". Arms cover dust, the minimum, and the caps.

**D1/D2 — hold.** Rehearsal RECOVERED / FAILED-TO-RUN / RECONCILE-FAILED notices carry the tag (R30 D1 arms); SPEC item 44 now says "a frozen stray account holding a balance", matching the measured close-frozen-zero behaviour.

I also spot-checked the load-bearing rejected claims (C03: the reader's `includes` compares whole array elements, so a program's own `Program log: Log truncated` text cannot impersonate the runtime marker; C04: the pool/revenue/Squads accounts are ATAs, PDAs of the ATA program, unsquattable; C09: the crank's bare reveal Transaction at 150,344 CU is under the legacy default and the autograph-head reveal landed at R28.A1). They hold.

---

## R1. The crank (`bank/crank.mjs`)

I looked for a plan the program refuses, a dead-vault pay or join, an out-of-order reveal, and unpinned value movement. **None found.**

- **Ordering**: reschedule → capture → reveal (strictly from `revealed_total`, stopping at the first not-ready/benign/failure) → retire → pre-join → pre-expire → split → distribute → post-expire → activate → claims. Matches the program's gates (`JoinWaitingFirst`, `BoostsExpireFirst`, red-team 3 finding 6).
- **Races**: `BENIGN` plus `judgeDistributeRefusal` (epoch/`last_distribute_at` movement, `PoolShort` never benign) covers the plan-vs-send window; `mintFailureCode` attributes Anchor errors to MINT only when MINT is on top of the invoke stack, so a same-named CPI error from another program cannot be laundered as a race (R27 L3 arms).
- **Dead vaults**: burned assets are retired first, never joined, never paid; the only window is a burn landing between the retire and the claim send, which is accepted limit 27's stated window.
- **Value movement**: every instruction is a permissionless MINT instruction with pinned destinations; the key signs only as fee payer plus the reveal's Core attribute rent. The selftest's source assertions (`crank.mjs` builds no transfer, calls no program but MINT, sends the free `distribute`) are backed by behavioural arms.
- **Arithmetic**: the owed math for pre-joined, pre-expired and carried boosts reproduces the program's post-`reweigh` `owed_of` exactly (I recomputed the carry algebra; it matches).
- Cosmetic only: `budgetPlan`'s below-floor warning says it "kept the floor for later passes" while the key is *below* the floor — the behaviour is right, the sentence is off. Not filed.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

**No dangerous on-chain state I can find is read as quiet, and nothing routine pages every pass.** The production value list is complete against the ruled numbers (21%/51%/3 days, 7-day notice, the three tighten bounds, 30-day month, one-hour window, the census, the wiring, the $CBOB mint and boost ceilings, the PoB collection). The five programs' upgrade authorities and hashes are watched past the lock date; Core and the four third-party programs are watched at HIGH with `NO_PROGRAMDATA` as a value. The pool read is atomic with the config's `owed_scaled` (round 22 A2 holds). The backlog drain (R0 above) is sound, including the `tx_unreadable` stall behaviour (a permanently unreadable transaction in a backlog window blocks the drain and pages HIGH every pass — loud, matching the disclosed unknown-coverage rule).

The one residual is filed as **LOW-1** below.

---

## R3. The layouts (`bank/layout.mjs`)

I compared `STRUCTS.MintConfig` and `STRUCTS.VaultRecord` field-for-field and in order against the bundled Rust structs: **identical**, including the boost fields and `[u32; BOOST_RING]`. The SEEDS assertion round 24 D6 promised now exists and scrapes each program's `pub const *_SEED` (11 of 11, with a both-ways arm). The cross-program `OFF_*` constants are scraped and compared with none ignored (L2), the layout versions and the ring are scraped from the Rust (L6), the space constants are evaluated and held to the layout minus padding (L13c), and `parseRustStruct` throws on any line it cannot read as one `pub name: Type,` field, so a private or retyped field cannot slip past. **No defect.**

---

## R4. The money arithmetic (`bank/accrual.mjs`)

`credit`, `pendingScaled`/`owed_of`, `reweigh`, `ceilSats`, `join`'s debt, and `available` are line-for-line the Rust (integer division floors in both; `PoolShort` is the program's refusal and `available`'s 0 is the planner's quiet, with the alarm paging insolvency). The crank expires every DUE boost before distributing and every boost its own distribution makes due right after; the alarm pages `boosts_stalled` and pins `mint.cbob_mint`, `max_boost_weight` and `max_boost_epochs` as CRITICAL drift. **No divergence.**

---

## R5. The swap and the revenue cycle

**(a) Oracle math** — verified. `oracleFloor`'s exponent handling is correct for every sign of `sol.expo − btc.expo` (both −8 today, so `e = 0`); both divisions floor; `satsPerLamport`'s BigInt→Number conversions are exact at Pyth's magnitudes and its ~1e-16 relative float error cannot move a 1% gate. The 150 bps floor covers Orca's 16 bps fee plus a 10-SOL impact plus the 30 bps confidence bound with room.

**(b) Pyth** — the offsets (disc 8, write authority 32, verification level 1, feed 32, price 64, conf 64, expo 32, publish time 64) are consistent with the reader, the selftest builder, and — decisively — the fork test driving the real `market()` against cloned real Pyth accounts. Ownership by the receiver plus derivation under the push program means only the Pyth receiver can write the account; a chosen price or old `publish_time` from that side is the disclosed trusted-third-party residue, bounded by the age, confidence and pool-agreement checks. The clock is the chain's own Clock sysvar, refused when unreadable or when the account is foreign-owned.

**(c) Deviation filter** — the quantities are in the same units on both venues. `orcaSpot` is (sqrt_price/2^64)^2 = raw cbBTC per lamport = sats per lamport; `meteoraSpot` is the inverse of (1+bin_step/10⁴)^active_id, which for this pair is sats per lamport (the fork test's SW.0 against real mainnet pool state and real Pyth prices is the measurement that settles it). Floating point cannot pass a pool that should be refused.

**(d) Minimum out** — the same `oracleFloor` read, in sats (1 raw cbBTC = 1 sat), at the same byte offsets the judge pins, for both venues.

**(e) The judge** — complete within its stated scope: exact seven-instruction sequence, pinned amount and floor in the instruction data, direction and price limit for Orca, output account, signer slot, ATA creations for the operator's own wallet and mints, no priority fee, Token instructions limited to SyncNative and the one close. The keys it does not check (Orca's vaults/tick arrays/oracle, Meteora's reserves/bin arrays/bitmap) are validated by the venue programs themselves against the pool state. A tampered *module* remains past it — that is the disclosed limit 10 box-owner residue.

**(f) Account derivation** — Orca's three tick arrays (current, then the two below) match a_to_b; the boundary case starts that array (armed against mainnet values). Meteora's bin arrays (active, then the two above) match Y→X. See **INFO-1** for the negative-id convention.

**(g) wSOL handling — this is where the round's real finding lives.**

> ### HIGH-1 — a pre-existing balance in the operator's wSOL account fails every swap's close, permanently halting the royalty conversion for the cost of dust
>
> **Construct:** `bank/swap.mjs` `swapInstructions` (instructions 1–3 and 6) and `bank/revenue.mjs`'s prepare stage. The cycle wraps exactly `lamportsIn` into the operator's wSOL ATA (`createAtaIdempotent`, then `SystemProgram.transfer`, then `SyncNative`), the swap sells exactly `lamportsIn`, and instruction 6 is `CloseAccount` of that account back to the operator. SPL Token's `CloseAccount` requires the account's token balance to be zero — the invariant every wSOL flow relies on when it unwraps fully before closing.
>
> **What an attacker or an accident gains:** the operator's wSOL ATA address is public (ATA of wSOL and the configured operator key). Anyone can create it — paying its rent — and transfer 1 raw wSOL into it, at any time before a cycle, for about 0.002 SOL. From then on: instruction 1 is a no-op, instruction 3 syncs the balance to `B + lamportsIn`, instruction 5 sells `lamportsIn` leaving `B`, and instruction 6 is refused by SPL Token (non-zero balance). The whole transaction reverts atomically, nothing moves, both venues fail identically, `revenue.mjs` throws "every pinned venue refused", the cycle stays open with swept SOL on the operator key, the open-cycle guard refuses every later run, and the alarm raises `unreconciled_swap` CRITICAL and `royalties_unswept`. The automatic royalty path is dead until a human unwraps the dust *and* hand-recovers the open cycle — and nothing in the code names the cause; the diagnosis is an on-chain SPL error inside a venue-refusal string. The same shape halts identically if a hand recovery ever leaves wSOL on the operator, and if Coinbase freezes the operator's cbBTC ATA (the prepare stage already reads that account for `opBefore` but does not check its freeze byte) — that variant is the accepted limit 28 class, but it is currently diagnosable only from the on-chain refusal, after the SOL has moved.
>
> **Evidence if I am right:** on the fork (or the rehearsal), pre-create the operator's wSOL ATA with 1 raw wSOL and run one cycle. The swap transaction fails at instruction 6 with SPL Token's non-zero-balance error, nothing moves, on both venues, and the cycle stays open. Without the dust, the same cycle succeeds (SW.1/SW.4 already prove that half). No suite, sim, fork or selftest arm covers the pre-existing-balance path — the fork's operator is always a fresh keypair.
>
> **Fix:** in the prepare stage, read the operator's wSOL ATA (the cbBTC ATA is already read there) and refuse *before any SOL moves*, by name, if it exists with a non-zero balance ("the operator's wSOL account holds a pre-existing balance; unwrap or sweep it by hand before the next cycle") — or include it by selling the whole post-sync balance and returning the excess with the close (the judge's amount check and the oracle floor would move with it). While there, check the cbBTC ATA's freeze byte in the same place. Add a both-ways selftest arm and a fork arm with a pre-funded wSOL ATA.

**(h) Failure and retry** — verified. Orca first, Meteora only on a refusal (preflight, landed-and-failed, or expired-unlanded — all read off the signature's status); an unconfirmed send stops the cycle open and loud; a landed-but-unconfirmed send is recorded, never retried; `pending*Sig` candidates are evidence, never permission. `cycleIsOpen` cannot read a failed or refused cycle as closed (a refused row is closed only because nothing moved, and a row carrying both `sendRejected` and a sweep is itself a CRITICAL). Every path leaves the ledger open until a cbBTC return is proven on chain.

**(i) Extraction within the tolerance** — the bound is 150 bps of the cycle size (10 SOL per 6 h ≈ 0.15 SOL ≈ $18 per cycle, ~$2,200/month at the theoretical maximum of 4 cycles/day). Arranging it costs more than it extracts: pushing the ~$10M Orca pool 1% needs ~$100k of notional and the round-trip through it exceeds the extraction; pushing the ~$0.9M Meteora pool to the gate's edge needs ~$9k and the round-trip cost (~1% of $9k) exceeds the ~$18 gained. A stale-but-accepted oracle (≤180 s) moves the SOL/BTC ratio by bps, inside the 150 bps floor. Not material. The operator key's worst case is unchanged from limit 10 (cap × windows until the guardian stops it, bounded by the revenue PDA's balance above the reserve), and the ledger cannot read a failed cycle as closed.

---

## R6. The gates

- **Floors equal counts** everywhere I checked: `FLOOR = 898` in `bank/selftest.mjs` and `DET_FLOOR=898` in `scripts/run-tests.sh` and SPEC's stated 898, all three cross-checked by the stated-count gate that reads *every* occurrence; `MIN_ASSERTIONS=855`, `SWAP_FLOOR=16`, `EXPIRY_FLOOR=4`, `ALLOC_FLOOR=39`, `POSTER_FLOOR=22`, `POB_FLOOR=14`, `LAUNCH_FLOOR=47`, `HOST_FLOOR=6`, `MAINNET_FLOOR=33` — each behind an equality floor.
- **The round-30 repairs' arms can fail**: the flood arms drive the real walk and assert specific cursor/backlog states; the truncation arms drive both shapes through the extracted alarm loop; the budget arms assert the remaining balance at and under the floor; the dust arms assert 0n and the minimum. I looked for a vacuous one and did not find it.
- **`scripts/build-mainnet.sh`** proves what it says for all five: the four initializing programs are behaviourally asked (mainnet rejects the test key, localnet accepts), the sweep helper's bytes are proven identical across the mainnet build, the localnet build and `target/deploy` (the build the suite and sim deployed), the tree must be clean, and the Core cache is hash-pinned.
- **`scripts/cron-install.sh`** installs exactly the six v6 jobs, preserves `--live` only from tagged, uncommented, job-anchored lines (both flag orders armed-tested), and the rehearsal marker refuses installation. Nothing extra is armed.
- **`scripts/audit-coverage.sh`**'s content check is real (per-round bundles read from the script *at the audited commit*, verdicts checked for a met quorum, `--prepared` credited only for preflight); strict mode correctly fails until round 31 completes — the designed state, not a defect.
- **`scripts/check-launch-params.mjs`** refuses every kind of wrong value with 47 both-ways arms, imports the alarm's own production list, and recomputes the PoB root.

---

## The four questions about the accepted limits

1. **Is any limit WORSE than stated?** Yes, one: limit 10's "Throughput has a permanent ceiling" sentence assumes the swap path *works* up to the cap. HIGH-1 makes the throughput zero, not capped — a stranger can halt the royalty conversion entirely for dust, which no limit discloses. That is the one thing immutability would lock in if it shipped.
2. **Is anything listed as a a limit not actually a limit?** No. 9, 25–29, 41, 44, 46–48, 55, 56 all still describe real, open properties of the code.
3. **Is any DISCHARGED item not actually discharged?** No. 51 (the boost) is built, suite-measured and host-model-measured across four ring wraps; 54's compute figures are re-read at the current build; 19 holds by construction (`activate` refuses `NotRevealed`); 14 is on chain; the v5 items went with the Bank.
4. **Is any OPEN AND BLOCKING item quietly treated as accepted?** No. 22, 38, 50, 52 and 53 are all stated open with their concrete unfinished work named (the live rehearsal items, the two dates, the unbuilt pages, the stale rehearsal proof, the rehearsal value set). The holder guide is DRAFT and unpublished, and its present-tense surfaces are item 50's obligation, not a quiet acceptance.

---

## Other findings

> ### LOW-1 — a stranger can still manufacture an urgent `log_coverage_gap` page every pass, by invoking a permissionless instruction
>
> **Construct:** `bank/alarm.mjs`'s truncation branch. Round 30's L1 repair narrowed the page to transactions in which one of our five programs *ran* — but every MINT instruction the crank sends is permissionless, so a stranger can build a transaction that successfully invokes one (a `capture_entropy` on any ripe vault record, all public), pad it with memo instructions until the runtime truncates the logs, and land it. `ran.length > 0`, so it pages `log_coverage_gap` HIGH, one-shot, URGENT, with the pass stamp — new text each pass, so each breaks through an open stream. That is the same 48-urgent-pages-a-day shape round 30's L1 was filed against, minus the naming-only case, for one fee per page.
>
> The page is *true* — our program ran with truncated logs, so a CBOB line may genuinely be lost — so this is a disclosure gap rather than a wrong behaviour: SPEC says "a stranger's padded transaction that merely names one cannot have lost a CBOB line", but does not say a stranger can make one run. **Fix:** disclose the manufacture in SPEC's reader coverage boundary, and bound it — for example, only the first gap per pass carries URGENT and the rest are level, so a manufactured stream cannot exceed one urgent page per pass while a real gap still breaks through. Add an arm.

> ### INFO-1 — Meteora's negative-bin-array index convention is asserted, not verified
>
> `bank/swap.mjs` `meteoraBinArrayIndexes` floors a negative id into array −1 (`Math.floor(-1/70) = -1`), and the selftest arm pins that as the expected value — but the fork test only ever exercised the pinned pool at active_id 5920 (positive), so the convention has never been checked against Meteora's actual division semantics for negative ids (Rust's `/` truncates toward zero; `div_euclid` floors). It is unreachable for the pinned pool (the swap moves the active bin *up* from 5920; reaching 0 would need a ~7000× price inversion), so this is a latent, dead path — but it is a place where the off-chain code asserts its own model rather than the program's. **Fix:** one look at Meteora's `bin_array_index` in the published crate to confirm floor vs truncation, and either align or comment the unreachability.

No other findings. The poster's backlog drain, the reader's validation, the lock's generation scheme, the launch gate, the rehearsal proof engine, and the expiry-budget gate all held up under adversarial reading, and their selftest arms are real in both directions.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Actually run the stranger attacks against the rehearsal.** HIGH-1, LOW-1, the scan flood, the truncation padding, the exact-amount race — each is a one-transaction attack. An AI can reason them; only a human running them against the rehearsal deployment and watching the crank, revenue job and alarm *respond* proves the halt, the page and the recovery end to end. Add the wSOL dust to item 22's named rehearsal items: pre-fund the operator's wSOL ATA, watch the cycle fail, walk the hand recovery, unwrap, and confirm the automatic path resumes.
2. **Re-verify the third-party interfaces against the published artifacts, once, by hand.** The Orca/Meteora/Pyth layouts in `bank/swap.mjs` are from IDLs that are not in this bundle. The fork test proving the real programs accept the built instructions is the strongest evidence there is, but a human should diff the hand-built account lists and data layouts against the SDK builders once at the release commit, and read Meteora's `bin_array_index` for the negative-id convention (INFO-1). That is an hour of work that closes a class.
3. **Rebuild from a second machine and compare sha256s.** Every AI round, including this one, read a tree on this box. `dist/MANIFEST.txt`'s reproducibility claim is the bridge for the one thing build-mainnet admits it cannot prove (that the compiled INIT_AUTHORITY *is* Gary's key) — but it has never been exercised from anywhere but here.
4. **Stand up a second, off-box alarm witness on a different RPC provider.** Limit 10(b) puts every price, pool account, floor and signature walk through one Helius endpoint, and limit 10(3) concedes the detection half does not survive a compromise of this box. A second provider — even a dumb cron that re-reads the pool balance, the revenue PDA's lamports and the program hashes from a different RPC and diffs them against this box's state file — is a witness this box cannot forge. Nothing in the AI process can supply it.
5. **Test the holder surfaces with real wallets and real humans.** Item 50's redeem page must be driven by Phantom and Ledger, with the wallets' own added instructions, against the measured packet shapes, before the guide's present tense becomes true. An AI cannot click a wallet, and every byte measurement in SPEC is a *shape* measurement, not a landed wallet transaction.
6. **Execute the custody decisions and witness the ceremony.** The $CBOB release wallet (limit 56) and the PoB hot key through the charter window (limit 46) are Gary's calls; moving them is not something an audit should do or verify from here. And the four `initialize` transactions should be **decoded and read against `launch/mainnet-init.json` by a second human, field by field, before signing** — round 24 A6 already concedes the checker validates the JSON, not the transaction. The upgrade-authority removal for all five programs should then be verified on chain by that second human, by id, after it happens.
7. **Run the hand-recovery drill with a stopwatch.** Item 22.4's forced post-sweep failure is a named rehearsal item; run it as a timed drill with a human reading limit 10's runbook, not as a checklist. The runbook's quality is itself unauditable until someone has followed it under pressure once.
8. **Re-run the full suite inside the rehearsal tree at the release commit.** Item 53's proof is of `d57ee3a` and is stale by its own text; the rehearsal value set (`launch/rehearsal-init.json` and the checker's rehearsal mode) is still to write. Both are named, neither is done, and no AI round can discharge them because they are runs, not readings.
9. **Keep a canary window between the dress rehearsal and the charter.** The programs become immutable at the lock; the charter window is the first time real value flows under them. A defined period where the deployment holds a small real balance with the alarm live and a human watching — before the window opens — is the last chance to find the bug that survives every reading.

The honest summary of this round: the round-30 repairs are real, the pipeline's detection and liveness machinery held up under a hostile re-read, and the one thing that broke was in the newest, least-exercised corner of the money path — the operator's own token accounts, which no gate reads and no test funds. That is exactly the shape this project's own history predicts: the fix is a change, and the change is a place a defect can live. Repair HIGH-1 before anything mints; it is a stranger's 0.002 SOL against the holders' entire royalty stream.