# Round 39, off-chain pass: audit report

I found no CRITICAL, HIGH or MEDIUM defect. I confirm six smaller findings (LOW and INFO). Four of them are in gates and one is a monitoring gap. None misstates holder money, so none fits the documentation exception. Nothing was executed; every claim below is from reading the bundle. Where I say "I did not run it", the finding names the evidence that would settle it.

## R0. Round 38's verdict and its repairs

- **C01 repair, read at source.** The new branch in `planCrank` is `else if (poolOk && pool.frozen && plan.joins.length)`. It batches `plan.joins` into `plan.claims` at `CLAIM_BATCH`, and `main()` sends `plan.claims`. In MINT's `claim`, a pending vault takes the `r.pending` branch (join, then `continue`). That branch never touches the pool, so a frozen pool cannot refuse the batch.
  - `monthly_inline` runs first in that call. With `waiting_to_join > 0` it returns early, so it does not interfere.
  - The `selftest.mjs` arm "R38 C01" asserts `p.claims.length === 1`, the batch contents, and an empty `owed`. That is the right property, but see F1.
- **C02, C03, C04 text repairs.** The `detectSweepState` comment, the SPEC oracle-filter wording and the limit 7 reconcile entry all read as the verdict says. I did not independently re-verify them against the drift sweep, whose output file I do not have.
- **Disproved claims, re-tested from source.**
  - C06 (poster wedge): MINT's `reveal_level` does draw for a burned asset, so the wedge is transient.
  - C07 (pre-created wSOL ATA): only the Associated Token program can initialise that PDA, so a stranger cannot set a close authority on it.
  - C15 (Core plugins in a separate account): the SDK deserializer reads them from the same buffer.
  - C09, C10 and C14: the verdict's reasoning holds.
  - I re-file none of these.
- **Not verifiable here.** V38-1 to V38-5 are page changes whose sources are not in this bundle. I can speak only to their tests (see "Web tests" below).

## R1. The crank

I found no plan the program would refuse. I checked:
- the account order of every instruction `main()` builds against MINT's `#[derive(Accounts)]` structs (`reveal_level`, `split_revenue`, `claim`, `activate`, `expire_boosts`, `retire_burned`, `distribute`);
- the pre- and post-distribution weight arithmetic: `retiringWeight`, `expiringWeight` and `preJoinWeight` against `retire`, `reweigh` and `join`;
- the retire-before-credit ordering, and join-before-distribute.

The only gap is structural, and it is F1.

### F1. LOW. Nothing ties planner fields to sender consumption (round 38 C01's own shape)
- **Where:** `bank/selftest.mjs` crank block, and `bank/crank.mjs` `planCrank` against `main()`.
- **What:** Round 38's verdict, gate-5 obligation 1, asked for "a source arm that `main()` consumes whichever field carries the joins, so the planner and the sender cannot drift apart again." The arm I can see asserts only the planner output (`p.claims`). I find no arm that `main()` reads `plan.claims`, `plan.preJoins`, `plan.preExpires` or `plan.postExpires`. `plan.joins` is never read by `main()` directly; it reaches the chain only through `claims`, which is exactly how C01 happened.
- **Evidence it is missing:** search `selftest.mjs` for `plan.claims.entries`, `plan.preJoins` or `plan.postExpires`. The only crank source arms are the instruction-name list, "no token or SOL transfer", "distribute burn = 0" and "DRY-RUN unless --live". If I am wrong, an arm matching those strings exists.
- **Effect:** the next field added to the plan (or renamed) and not sent passes all 926 assertions, as C01 did.
- **Fix:** one generic arm. Every key `planCrank` initialises in `plan`, other than the report-only keys (`problems`, `owed`, `deferredFrozen`, `joins`), must appear as `plan.<key>` in `main()` outside comments. Show it red by deleting the `plan.claims` loop.

## R2. The alarm

### F2. LOW. The vault collection is the one fixed-forever wiring value the alarm never pins
- **Where:** `bank/detectors.mjs` `detectStandingRisks`, the `want` list.
- **What:** `want` pins `pob_collection`, `payment_mint`, `bank_treasury`, the reserves and the census, but not `mint.collection`. `collections_disagree` only checks that the four programs agree with each other. Anyone can create a collection naming MINT's PDA as update authority (the round 37 V2 decoy shows this). A wrong collection wired consistently into all four programs would read as quiet.
- **Why it is not already covered:** the ceremony page checks it at step 10, but nothing independent re-checks it afterwards. The alarm already reads `launch/mainnet-init.json` (for `lock_deadline`), so it could read `vault_collection` the same way.
- **Evidence if I am right:** run `detectStandingRisks` in production mode with a `mint.collection` of any key shared by all four programs; it returns `[]`.
- **Fix:** add `['mint.collection', <launch vault_collection>]` to the production check, and skip it while the file's value is null.

### F6. LOW, conditional. `unredeemable_owner` is a routine state at CRITICAL, and acks are per vault only
- **Where:** `detectors.mjs` `detectNestedVaults`, `ACKABLE_KINDS` and `applyAcks`.
- **What:** any vault owned off-curve pages CRITICAL on every pass. The code and SPEC both say it is unknown whether Core marketplaces escrow; an escrowed vault is then recoverable and routine. The only mute is an ack keyed `unredeemable_owner:<asset>` with an expiry. An escrow program holding N listed vaults needs N dated entries, and the text changes whenever the listing set changes.
- **Evidence:** list a vault on a marketplace that escrows Core assets, then run one alarm pass.
- **Fix:** let an ack name an owner address (`unredeemable_owner@<owner>`) with the same `why` and `until` rules, or lower the finding to HIGH when the owner is a known program id. Do not make acks permanent.

### Dangerous states I checked that read as noisy or loud, not quiet
- A stop followed by a restart within one pass cannot happen: `restart` needs a proposal created after the stop, and votes last 3 days.
- `sales_stopped_at` and `sweep_stopped_at` are not watched, and need not be.

## R3. The layouts

- **MintConfig and VaultRecord field lists.** They match the Rust structs I can read. The record is 211 fixed bytes plus 10 padding, i.e. 221. The mainnet rent figures in SPEC (1,772,920 and 1,488,440 lamports) recompute at 5,080 lamports per byte.
- **The round 24 D6 seed assertion now exists** and is real.
- **One of the lists is checked in only one direction.** F4 below covers the gap.

### F4. INFO. The SEEDS and `OFF_` gates are one-directional
- **What:** the seed gate iterates `L.SEEDS`, so a seed constant a program declares but `layout.mjs` omits is never compared. `RESCUE_SEED` (round 35) is such a case; it exists only in `web/src/lib/ids.mjs`. The `OFF_` gate scrapes `^const OFF_(\w+): usize = (\d+);`, so a pinned offset declared under another name or written inline is outside it. The "nothing scraped goes uncompared" arm is circular for the same reason.
- **Fix:** scrape every `pub const \w*_SEED` and every `const .*OFF.*: usize` in `programs/*` and require each one to be classified as in the layout or deliberately excluded.

## R4. The money arithmetic

I compared `accrual.mjs` with MINT line by line: `credit`, `owed_of` / `pendingScaled`, `reweigh`, `ceil_sats`, and `retire`'s freed share (which the crank mirrors in `retiringOwed`). The expiry order also matches the program's gates:
- pre-expiry is `dist_epoch >= boost_end_epoch`;
- post-expiry is `boost_end_epoch == dist_epoch + 1`;
- `join` weight is the level weight alone;
- `postExpires` is empty unless a distribution is planned.

I found no divergence. `boosts_stalled` is wired; `cbob_mint` and the boost bounds are in `WATCH` at CRITICAL.

## R5. The swap and revenue cycle

- **(a) Oracle math.** `sats = lamports × sol.price × 10^(es−eb) / (btc.price × 10)` is dimensionally correct for either exponent sign, and it rounds down. `satsPerLamport` is only used for the deviation test, where float error (about 1e-15) cannot change a 100-basis-point decision.
- **(b) Pyth account.** I recomputed the offsets: discriminator 8, write authority 32, a one-byte `Full` tag at 40, feed id at 41, price at 73, confidence at 81, exponent at 89, `publish_time` at 93. They match. The sponsored account is a push-oracle PDA owned by the receiver; only the push program can write it, and only with a Wormhole-verified update newer than the stored one. A holder of any recent signed message can choose a price from the last 180 seconds, and that is covered by (i). The 30-second future bound and the Clock sysvar owner check are sound.
- **(c) Deviation filter.**
  - Orca's `(sqrtPrice / 2^64)²` is raw B per A, which is sats per lamport. Meteora's inverse `(1 + binStep/10000)^activeId` gives lamports per sat inverted, i.e. also sats per lamport. Both are in the right direction.
  - The measured values (activeId 5920, binStep 15) give about 7,100 lamports per sat, consistent with the BTC/SOL ratio.
  - Float precision is not a concern at this scale.
  - The filter is applied at the second read only (SPEC now says so).
- **(d) Minimum out.** The same `guaranteed` (`m2.f.minSats`) goes into the instruction data and the judge. For Orca the argument order is amount, threshold, price limit, exact-in, a_to_b, 42 bytes, which matches the judge's length check. For Meteora it is `min_amount_out` at offset 16.
- **(e) Judge.** It pins the exact seven-instruction sequence, program ids, venue, pool, input and output accounts, signer slot, amount, floor, direction and price limit, and rejects compute-unit price and any Token instruction other than SyncNative and Close. Two gaps, both small:
  - It does not pin Meteora's `host_fee_in`, so a tampered builder could redirect the venue's host share of the protocol fee.
  - It does not check `isWritable` or `isSigner` flags on the ATA, wrap or close instructions. Those cannot add authority, because only the operator signs.
- **(f) Account derivation.** I checked the LbPair and Whirlpool field offsets against the published layouts, and the Orca tick-array order and Meteora bin-array order for the swap directions. They are correct. An uninitialised array makes the program refuse, which leads to the fallback venue. The fork test exercises both venues against real accounts.
- **(g) wSOL.** A pre-existing wSOL balance is swept back as SOL when the account is closed. A stranger can donate wSOL to the account, but it comes back to the operator at the close. A partial fill is not reachable: Orca returns `PartialFillError` and Meteora errors on insufficient liquidity.
- **(h) Failure and retry.** `TransactionExpiredTimeoutError` carries `.signature`, so an unconfirmed send classifies as "unknown", throws, and leaves the cycle open. Only a preflight refusal, an on-chain failure with status, or an expired blockhash with no status lets Meteora run. One case is theoretical: a status RPC that answers null for a landed signature (the same single-RPC trust as limit 10(b)). A second swap is then bounded by the operator's float, and the cbBTC from it returns to the revenue address.
- **(i) Extraction bound.**
  - The floor allows 150 basis points under the oracle, plus whatever the oracle lags by.
  - At the ruled cap of 10 SOL per roughly 7 hours (about 34 SOL a day), that is at most about 0.5 SOL a day of slack, and it cannot be taken profitably.
  - A sandwich must move the pool price, and the attacker pays the 16 basis points of pool fee on both legs plus the price impact. On Orca (about $10M) a 1% move needs tens of thousands of dollars of notional against a gain of roughly $12 per cycle.
  - On Meteora (about $0.9M) the margin is thinner but still negligible.
  - The operator key's worst case is unchanged from limit 10: cap × cooldown windows of royalty SOL until the guardian stops the sweep. It now trusts two pool programs and Pyth, not an HTTP reply.

## R6. The gates

### F3. LOW. `build-mainnet.sh` proves less than its closing banner and SPEC imply
- **What:** the four initialising programs are proven by behaviour to reject the test key and accept it in the localnet build. Nothing proves the two builds differ only in `INIT_AUTHORITY`. The comment in `lib.rs` says so, and the mint source I can see has no other `cfg(feature = "localnet")` block, but the script never greps for it. The sweep helper is the only program compared byte for byte.
- **Reproducibility is stated as "the bridge", but it is path-dependent:**
  - Anchor and Rust embed source paths and dependency registry paths in panic and log strings.
  - The script sets no path remapping and no pinned container.
  - A verifier on another machine or path may get different bytes from the same commit.
  - I did not run a rebuild.
- **Evidence that would settle it:** build the same commit under a different directory name and user, and compare the sha256 of all five `.so` files.
- **Fix:** add a check that `feature = "localnet"` appears exactly twice per program (the `cfg` and its `not`), and publish a pinned-container or `solana-verify` build with its hashes. Reproducibility from the container is what step 9's "dump and compare" actually needs.

### F5. LOW (INFO if the log is trusted). The pages' end-to-end proof is outside every gate
- **What:** `web/test/e2e-localnet.mjs` is the only test that sends the pages' transactions to a real validator with real Core (opening with a claim-first, rescue, the boost expiry, a flood of parked accounts). `run-all.mjs` excludes it by design, and `scripts/run-tests.sh` never calls it. It has no assertion floor: it exits on `r.ok === r.total`. Its result (113/113) exists only as a log named in `VALIDATION.md`.
- **Why it matters:** item 50 (the pages) is OPEN AND BLOCKING and a precondition of step 11, and this is its strongest evidence. A change that returns early would still exit 0.
- **Fix:** give it an `E2E_FLOOR` that must equal its count and run it from the ship-gate path, or list it in SPEC as a ship-gate precondition with its count.

### Other gate checks
- All floors I could recompute match their stated values: 926 detector, 24 poster, 39 allocation, 49 launch, 33 mainnet, 16 swap fork, 4 expiry, 6 host. The web floors sum to the 618 `VALIDATION.md` states.
- `cron-install.sh` arms nothing from comments, other projects' lines, or the reveal lane, and the arms run the real shell.
- `rehearsal-tree.sh`'s reverse proof is sound for the five ids and the root. It excludes `web/` (and web tests carry the ids), which is fine because nothing there runs in the rehearsal.

## Web tests: can each fail when its property breaks?

I read all of them. The comparison tests (`ix`, `ids`, `ceremony`) extract the suite's own builders and diff them, so they fail on drift. `bundle.test` mutates the manifest and asserts the build's named refusal. `proxy.test` feeds the shapes web3 actually sends and a list of refused variants. I found no arm that cannot fail. Two soft spots:
- A few arms assert page behaviour by regex on source text (for example "the ceremony page stops on a conflict"). They fail on a rewrite of the text but not on a behavioural regression with the same text.
- `ids.test` hard-codes the release commit `0b3ddb3` for `dist/`. It will fail the day the programs are rebuilt, which is intended.

## The four questions about the accepted limits

1. **Worse than stated.** None. The nearest is limit 10's extraction, which I bounded in R5(i); it is smaller than the limit's own wording suggests.
2. **Not actually a limit or already closed.** The `unreconciled` half of limit 7's reconcile entry is correct as of round 38. Limit 27's "a sliver of every other vault's share" is bounded by the crank's hourly retire and by `retire_burned` returning the unpaid share, so its worst case is smaller than the text reads.
3. **Discharged but not discharged.** None. Item 19's "no state where a vault is activated but unlevelled" holds: `activate` requires level 1..5.
4. **OPEN AND BLOCKING treated as accepted.** None. Items 22 (including 22.5, the DAS `burnt` question), 38, 50, 52 and 53 are all stated open. Item 22.5 has a live consequence worth saying plainly: if DAS omits burned Core assets instead of flagging them, `detectIndexShortfall` pages CRITICAL after the first redemption and keeps paging. The item is correctly open, but it should be settled before the first mainnet redemption, not left to be discovered.

## What I found no evidence against
- The round 37/38 claims I could re-derive from source hold: tick and join behaviour from a frozen pool, the ack arms (as the verdict measured), the SPEC counts, and the rent figures.
- I did not re-run anything, and I cannot see the web page sources or the SEAL, BURN and GOV programs, so I make no claim about them.

## What this project should do before launch that AI audit structurally cannot

1. **Make the build independently verifiable.** Produce the five binaries in a pinned container (`solana-verify` or an equivalent), publish the hashes and the recipe, and have a second person rebuild on a different machine and path and match every sha256. Do this before step 9 and again before step 11. Without it, "verify the deployed bytes" is only a comparison against your own box.
2. **Have a human who has shipped Solana programs read the four `initialize` transactions byte by byte** as built from `launch/mainnet-init.json`, and the step 9 to 11 sequence. Use a second signer or witness for steps 9, 10 and 11. Step 11 (removing the upgrade authority) is the only irreversible action; the dump-and-hash before and after it should be run by someone who did not write the script.
3. **Run an adversarial test with real money before the lock.** An AI never has capital at stake. Run a time-boxed bounty or contest on throwaway ids with the ruled parameters, and include the two things an AI cannot probe: validator-level grinding of the last entropy slot (limit 26), and a Core upgrade scenario.
4. **Run a full real-time rehearsal at the ruled values.** The current rehearsal uses shortened periods. At least once, run a smaller deployment through a whole real month (charter, tick, the 30-day monthly distribution, a boost's full lifecycle, a redemption at the cap), because the 30-day and 7-day branches have never executed at their mainnet values.
5. **Prove alert delivery works end to end, from a different path.** The deadman, the alarm and the revenue notices all use one notifier and one router. Run a drill: kill the alarm, freeze a test pool, expire the oracle, and confirm a human is reached. Add one dead-man's switch hosted somewhere else (external uptime monitoring), because a dead box silences everything on it.
6. **Fix key custody before value arrives.** Today the guardian is a Phantom wallet, the swap operator key and the whole $CBOB supply sit on this box, the deploy authority is a file on the box and in its backup, and the Giraffish Moments update authority is a hot wallet. Put the guardian, the deploy authority and the $CBOB release wallet behind a hardware wallet or Squads with a written signer list. Moving the Moments authority behind a multisig for the 7-day window closes the documented "end the project before it starts" exposure at almost no cost.
7. **Get a lawyer's review of the product, not the code.** Revenue sharing paid to NFT holders, a $CBOB token whose burn buys payout weight, a 15% treasury, and a public vote are the kind of structure regulators look at. An immutable program cannot adapt to a ruling, so this review has to happen first.
8. **Fuzz and model-check the money invariants.** The allocation tests and the 260-epoch simulation are good targeted evidence, but a fuzzer (Trident or honggfuzz on the programs, plus a random-sequence differential test against `accrual.mjs`) run for days would search the interleavings of join, expire, retire, claim and distribute that a reader cannot enumerate. The invariant to assert: pool balance ≥ `ceil(owed_scaled / 1e12)`, and total paid ≤ total distributed.
9. **Write and rehearse the incident runbook.** Name who can pull the guardian stop, how fast they can sign, what to do when Coinbase freezes the pool, when Core changes, and when Pyth or Orca stop answering. Once the programs are immutable, the runbook is the only thing that can change.