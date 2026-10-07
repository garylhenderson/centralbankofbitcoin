# Round 33 off-chain audit: findings

I found no CRITICAL or HIGH issue in the crank, alarm, layouts, arithmetic or swap. Nothing below should reset anyone's confidence in the program pass. I did not execute anything, so every finding states the evidence that would confirm or refute it. Where my claim rests on how a third-party program behaves rather than on the bundled files, I say so.

## R0. Round 32's verdict and repairs

- **Repairs present.** `detectSweepState`, `tx_unreadable` per read and per listing, the never-evict `detectLogGaps`, the focus-exact coverage headline, the expiry-count selftest arms and the "write the LAST signature" instruction are all in the tree.
- **Rejected claims I re-derived.**
  - C02 (no compute-unit limit on the reveal): the real reveal landed in the suite without a limit.
  - C04 (partial-page drain): this is an RPC-trust boundary, not a defect.
  - C05 (exactly 2,000 new signatures pages `scan_gap`): this is fail-closed by contract.
- **C03 is under-weighted.** The verdict files "no pre-sweep executability check" under accepted limit 10. F3 below shows the consequence is more frequent than that limit states.
- **The verdict's "unrepaired half of L2" is still open.** An exception in `listVaults`, the balance reads, `readPool` or the config reads still discards every finding already computed in the pass (drift, brakes, upgrade authority). SPEC states this, and findings are only delayed because state does not advance. Treat it as disclosed, not repaired.

## R1. The crank

I found no plan the program would refuse. I checked:
- the account order of every instruction against the Anchor structs;
- the ordering of join, expire, split, distribute, post-expire, activate and claim;
- the boost arithmetic (expiry owed equals `atExpiry + w·Δacc`);
- the split rounding (`total − floor(total·1500/10000)`).

**F1 (MEDIUM). No RPC request timeout anywhere in the money, reveal or alarm path.**
- **Where.** `bank/crank.mjs` main, `bank/revenue.mjs` main, `bank/alarm.mjs` (`new Connection(...)` and the DAS `fetch` in `listVaults`), and `bank/redemption-poster.mjs` all construct a bare `Connection` or `fetch`.
- **Why it matters.** SPEC limit 25 records that round 25 A1 measured web3.js 1.98.4 waiting 300.8 s on a socket that accepts and never answers, "longer than the whole window". I found no repair in any bundled file: no `fetch` override, no `AbortSignal`, no `confirmTransactionInitialTimeout`.
- **Consequences.**
  - **Reveal lane.** The every-minute lane holds its `flock` for about 5 minutes. The next 4 runs skip silently under `flock -n` (limit 6), against a capture window of about 2 minutes. A provider stall therefore lapses captures and yields reschedules, i.e. the limit-25 re-roll, with no attacker.
  - **Revenue job.** It can hang between the sweep and the swap while holding the cycle open.
  - **Alarm.** A hung DAS call stalls the whole pass until the deadman fires after 2 h.
- **Evidence.**
  - `grep -nE "fetch:|AbortSignal|AbortController|timeout" bank/crank.mjs bank/revenue.mjs bank/alarm.mjs bank/swap.mjs` returns nothing.
  - Run `node bank/crank.mjs --reveal-only` with `HELIUS_RPC_URL` pointing at `nc -l` (accepts, never answers). It will not fail for about 300 s.
- **If I am wrong.** If the repair lives in an unbundled file, show it.
- **Fix.** Build the `Connection` with a `fetch` wrapper that aborts at 10–15 s, wrap the DAS `fetch` the same way, and add a selftest arm against a blackhole server.

**F9 (INFO). The input to the new sweep detector is not on the produced-keys list.**
- `mint.last_sweep_at` feeds `detectSweepState` but is not in `WATCHED_KEYS`. This is the round-23 I3 shape. It is bounded because layout equals Rust.
- The same detector compares chain time `last_sweep_at` with wall-clock `startedAt` inside a ±120 s window. Box skew over 2 minutes causes a false CRITICAL.
- A crash after a sweep is sent but before `sweepSig` is saved leaves an intent-only row. That row does not explain the sweep (it requires `sweepSig` or `pendingSweepSig`), so the detector pages. That is the right direction, but the detail text says "its row will show the attempt", which it will not.

## R2. The alarm

I found no fixed-forever value that reads quiet. The watch list, the production list, the five-program lock check and the third-party program watch all match the spec. I checked that the exact frozen-problem strings in `detectCrankHealth.covered` equal the planner's strings.

**F6 (LOW, cheap to fix before the lock). Nothing compares deployed bytes or launch values to the audited artifact.**
- **Program bytes.** `prog.<p>.hash` is a drift baseline. The first pass adopts whatever is deployed. Nothing compares it to `dist/SHA256SUMS`. Road step 9 ("verify the deployed bytes") is a human procedure, and the alarm cannot catch a wrong deploy that was baselined.
- **Launch values.** `guardian`, `swap_operator`, the sweep cap, the cooldown and the reserve are off the production list (item 38 says so). After `initialize`, the alarm baselines whatever was written, and nothing reads the config back against `launch/mainnet-init.json`. Road step 10 has no read-back step. A mistyped guardian is permanent.
- **Evidence.** There is no code path that reads `dist/SHA256SUMS` or compares on-chain config to `mainnet-init.json` after initialize.
- **Fix.**
  - Add a `--verify-deploy` script that dumps each program, strips ProgramData padding, hashes it and compares it to `dist/SHA256SUMS`.
  - Add a `--verify-init` script that compares every MintConfig, GovConfig, BurnConfig and SealConfig field to the JSON.
  - Run both in the witnessed ceremony, and add the program hashes to the alarm as a one-time pinned expectation.

## R3. Layouts

No divergence found. I recomputed the MintConfig and VaultRecord field order and sizes (VaultRecord 211 + 10 padding = 221, matching the Rust). The seed, version, ring and space assertions are real.

## R4. Arithmetic

`credit`, `pendingScaled`, `reweigh` and `available` match the Rust formulas line for line. Pre-expiry and post-expiry planning match `advance_epoch`. No divergence found.

## R5. Swap and revenue cycle

**(a) Oracle math.**
- The exponent handling is correct for both signs of `es − eb`, and rounding is down.
- `satsPerLamport` conversions are fine below 9e15 mantissa.
- The 150 bps floor covers the 16 bps pool fee plus the impact of a 10 SOL swap.

**(b) Pyth account.**
- The offsets are correct: Full tag at byte 40, feed id at 41, price at 73, conf at 81, expo at 89, publish time at 93.
- I could not verify, from the bundle alone, that the push oracle refuses an update whose publish time is not newer than the stored one. I believe it does. This is my knowledge of Pyth, not a bundled fact, and the fork never tests it.
- If it holds, an attacker can only push later signed updates. That bounds staleness games to the real recent price path, which is within the stated tolerance.
- **Evidence to add.** A fork arm that calls the real push oracle with an older signed update and sees it refused.

**(c) Deviation filter.**
- `orcaSpot` and `meteoraSpot` are the right quantity (sats per lamport) in the right direction.
- NaN fails closed.

**(d) Minimum out.** Orca's `other_amount_threshold` and Meteora's `min_amount_out` are the same `minSats` the judge pins. Both are in cbBTC sats.

**(e) Judge.** It does check:
- the output account (key 5), the input account, the amount, the floor, the direction byte and the price limit;
- the exact 7-instruction sequence and that no compute-unit price is set;
- both ATA creations and the exactly-one close.

Not checked: the remaining swap metas (vaults, tick or bin arrays, Meteora's optional `host_fee_in`). The venue programs validate those.

**F2 (LOW). Only the swap transaction is judged. The transactions that move the proceeds are not.**
- **What is unjudged.** The operator key also signs:
  - the sweep;
  - the cbBTC ATA creation;
  - the return `TransferChecked` to the revenue ATA;
  - the split plus the Squads ATA creation.
- **Why it matters.** The return is the leg that carries up to ~10 SOL of cbBTC. A defect in `revAta` derivation would send it to a wrong address irrecoverably. `delta < guaranteed` guards the swap leg, not the return.
- **Fix.** Add `judgeReturnInstructions` (destination equals the derived revenue ATA, amount equals the ATA balance, one signer) and `judgeSplit`, run before signing, with both-ways arms.

**F3 (LOW to MEDIUM, operational). Three post-sweep paths turn a recoverable situation into hand recovery, and hand recovery "can double swap".**

1. **No automatic resume.** Any swap failure after the sweep leaves SOL on the operator and an open cycle that only a human can close. Both venues are pinned to `minSats` set from a Pyth price up to 180 s old, and the transaction carries zero priority fee.
   - Ordinary SOL volatility of more than ~1.3% inside that window, or ordinary congestion, causes "every pinned venue refused".
   - Limit 10 describes the cause as operator crash, failure or worse. It does not state that routine volatility causes it.
2. **Single stale read after a landed swap.** The post-swap delta is one `getAccountInfo(opAta,'confirmed')` taken right after `sendAndConfirmTransaction`. A lagging RPC node reads the old balance. The code then throws "swap credited 0", with `swapSig` recorded but no return, a cycle stuck open and a swap that already succeeded.
3. **Expired-plus-null reads as refused.** `classifySendFailure` calls an expired blockhash with `status == null` "refused" from one status read.
   - If the status node lags, a landed Orca swap reads as refused and Meteora is tried.
   - The second wrap fails for want of SOL float (about 0.02 SOL), so the damage is bounded. It still produces a false "every venue refused" and a runbook that tells a human to swap by hand.
   - For the sweep, a wrongly-refused landed sweep gets caught as `unledgered_sweep` by the walk. That is loud but costs a CRITICAL.
- **Evidence.**
  - For path 2, inject a stub returning the pre-swap balance once.
  - For path 3, make `getSignatureStatuses` return null once and then confirmed.
  - For path 1, replay a −1.5% move over 120 s through `market()` and the venue loop.
- **Fix.**
  - Re-read the balance with retry up to 30 s.
  - On expiry-plus-null, poll the status at `finalized` until the blockhash is provably dead, for at least 150 blocks plus a margin, before ever returning "refused".
  - Add an automatic resume of the swap leg for a cycle that has a recorded `sweptLamports`, no `swapSig`, and a proven non-landing.

**(g) wSOL handling.**
- A pre-existing wSOL ATA, or a donation to it, just closes back to the owner as SOL.
- A pre-created ATA is fine because it is idempotent.
- No hole found.

**(i) Extraction inside the tolerance.**
- The ceiling is about 134 bps net of the Orca fee (150 minus 16). That is at most 10 SOL × 1.3% ≈ 0.13 SOL per cycle and about 0.5 SOL per day at the ruled cap, only if the attacker can hold both pools off-oracle at the landing slot.
- My estimate is that moving Orca ($10M TVL) by 1.4% costs more than the gain. Moving Meteora ($0.9M) is cheaper but still not profitable at that size.
- The realistic risk is not theft but the induced-refusal grief in F3(1).
- This is an estimate, not a measurement. A fork run moving each pool by 1.4% would settle it.

**F5 (MEDIUM, supply chain and reproducibility). The code that decides the signing key's behaviour and the immutable bytes includes unaudited, unpinned inputs.**
- **Cargo.lock.** The coverage gate explicitly excludes `*/Cargo.lock` as "generated". A `cargo update` changes the compiled bytes of immutable programs, and no auditor is ever shown it. `build-mainnet.sh` and `run-tests.sh` call `cargo-build-sbf` without `--locked`.
- **JS dependencies.** `swap.mjs` says gary-club's node_modules is shared. `scripts/probe-mainnet-facts.mjs` imports `/opt/gary-club/node_modules/@solana/web3.js/...` directly. `revenue.mjs` signs with `@solana/web3.js` and `@solana/spl-token`, and the crank deserialises assets with `@metaplex-foundation/mpl-core`. All of it resolves from a tree that another application can `npm install` into, with no hash recorded in any MANIFEST.
- **Evidence.**
  - `readlink -f /opt/cbob-vaults/node_modules`.
  - `git log -p -- Cargo.lock` shows churn with no audit linkage.
  - `scripts/audit-coverage.sh` line `grep -vE '^scripts/audit|/Cargo\.lock$'`.
- **Fix.**
  - Bundle `Cargo.lock` and `package-lock.json`.
  - Build with `--locked`.
  - Install JS dependencies with `npm ci` into a node_modules owned by this repo.
  - Record `sha256` of the lock files and of `node_modules/.package-lock.json` in the round MANIFEST and the dress-rehearsal record.

## R6. Gates

**F7 (LOW). The suite certifies the working tree, not a commit.**
- `scripts/run-tests.sh` hard-codes `ROOT=/opt/cbob-vaults` and never records `git rev-parse HEAD` or `git status --porcelain`. `build-mainnet.sh` does refuse a dirty tree.
- A "255/255 green" log on a dirty tree has no commit it can be tied to, and the validation documents cite log files, not commits, for that run.
- **Fix.** Print and store HEAD and the dirty flag, and `die` on dirty when `CBOB_SHIP_GATE=1`.

**F8 (LOW). A class of selftest arms proves a string exists in source, not that a path runs.**
- Examples:
  - `/try \{ list = await mintedAttributes\(/.test(cs)`;
  - `/plan\.split && payDecimals === null/.test(cs)`;
  - `/judgeDistributeRefusal\(lastFailure, cfg, fresh\)/.test(cs)`;
  - the I2 `nowSec: chainSec,` check;
  - the H1 `/D\.planAlarmNotices\(findings/` and `/delete env\.ALERT_URGENT/` checks.
- These run against unstripped source, so a `//`-commented or dead-branch copy keeps them green. The wiring gate in main() strips comments and checks consumption; these do not.
- **Evidence.** Comment out the `try` line in `crank.mjs` and run `node bank/selftest.mjs`. I expect no red.
- **Fix.** Strip comments, as `stripComments` already does, and prefer extraction-and-execution arms, as the R26 and R27 blocks do.

## The four questions about the accepted limits

1. **Worse than stated.**
   - Limit 10: routine volatility and RPC lag open hand-recovery cycles (F3), and no automatic resume exists.
   - Limit 25: a provider hang defeats the "every minute" control (F1).
   - Limit 7: the stated control assumes a runner finishes, but with no request timeout a hung holder is the common wedge, not a rare one.
2. **Not actually a limit.** I found none.
3. **Discharged but not discharged.** I found none. Item 54 is measured on the stated shapes.
4. **OPEN item quietly treated as accepted.**
   - Item 38. Its only gate is the JSON checker, and the road table has no post-initialize read-back (F6).
   - Item 22.5, the DAS `burnt` question, is carried in the rehearsal list. Resolve it before the lock. If DAS drops burned assets, `detectIndexShortfall`'s exact equality against `minted_total` becomes a permanent CRITICAL after the first burn, and a daily reconcile never reports complete.

## What to do before launch that an AI audit cannot do

1. **Reproducible build by two independent people.** On two separate machines, build from the tagged commit with locked dependencies and compare the five hashes by eye.
2. **A witnessed `initialize` ceremony with a machine read-back.** Run `--verify-init` and `--verify-deploy` (F6) live on screen, with someone other than the author reading the output against the ruled values.
3. **An adversarial dress-rehearsal day.**
   - A human with funds plays hostile: sandwiches the swap, floods transactions naming each program, freezes a test account, grinds the entropy.
   - Run it with the crank, the alarm and the revenue job unattended, and include the timed hand-recovery drill that item 22.4 requires.
4. **A second watcher on different infrastructure.** Use a different RPC provider and a different notification path, so the box and the provider are not one failure domain. Today the box, ledger, crontab, alarm, keys and RPC are one trust domain (limit 10 (3)).
5. **Key custody decisions only people can make.**
   - Move the $CBOB release wallet and the swap operator off an online disk.
   - Decide who holds the guardian.
   - Decide whether the hot Moments key is held cold through the 7-day charter window.
6. **Property-based fuzzing at scale.** Fuzz the accumulator, retire, boost and join invariants with Trident or proptest for days. The host tests here run 260 epochs, which is a smoke test for an immutable money program.
7. **Staged value.** Launch with small caps (one small first round, the minimum sweep cap, a low `max_supply` used as a canary window) and observe real payouts for weeks. The programs cannot be fixed afterwards, so only the launch order limits the blast radius.
8. **A bounty and an outside human review of the one place no model can run live.** The Core upgrade path is that place, and Metaplex's roadmap should be read directly.