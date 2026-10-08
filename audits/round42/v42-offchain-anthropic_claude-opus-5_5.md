# Round 42 off-chain audit: the crank, alarm, layouts, accrual, swap and revenue cycle, the gates, and the `web/test/` suite

**Audited tree:** the current bundle, which includes round 41's repairs and the pre-round-42 drift fixes A1–A3.

**Method:** read only. I ran nothing. Every finding below says what you would see on the box, the chain or a test run if it is real.

**Headline:** no defect in the money arithmetic, the crank plan, the swap builder or the judge survived my check. One MEDIUM is a trust boundary the accepted limits understate. One LOW is a liveness fault in the revenue cycle. The rest are INFO items and gate-5 obligations. Several round-41 repairs check out at every site of their shape.

---

## R0. Round 41's verdict and its repairs

| Item | My check | Result |
|---|---|---|
| **C01** (poster dropped the second redemption in a transaction) | `draftKey(web)` gives `signature:vault`, where `web.vault` is the 1-based padded number. That number is unique per vault, so two redemptions in one transaction get two keys. Truncated-log rejections still use `signature:*`, and the loop skips on either key. I looked for other dedupes of the same shape: `looked.eventSigs` keeps every event in the transaction; `correlateBurns` dedupes per asset; `seenSplits` keys by signature but `revenueOutflow` sums every outflow in it (split, mint, split in one transaction is summed correctly); `byS` sweep rows hold at most one sweep per transaction because of the cooldown; `deferredSweeps` and `splitsSince` key by signature. | **Holds.** No other site of this shape. |
| **C02** (oracle age bound unpinned) | The new arm uses literal ages (181 s refused, 180 s used) and pins the constant at 180. SW.7a in the fork is still relative to the constant, but the constant itself is now pinned. Every sibling constant is pinned by a literal: tolerance (R40), confidence (I3), future skew (T+30/31), pool deviation (L6 at 99/101 bps through `market()`), and `SWAP_CU_LIMIT` (the builder's literal and the judge's constant must agree, and L1's 1.4M arm checks it). | **Holds.** `OPERATOR_FLOOR` is the one sibling left (see I-4). |
| **C03** (crank fee-budget sentence) | The new sentence matches `budgetPlan`. The key is refused only below `planCostLamports(base)`. Reveals are then bounded by `room = lamports − base − FEE_FLOOR`. With `room ≤ 0`, zero reveals run and the base plan still runs. | **Accurate.** Both copies in SPEC were edited. |
| **C04, C06** (measured rejections) | Both pinned. C04: the level-0 redemption throws, nothing is queued, the cursor is held. C06: `10_000_000n` is now a literal. | **Hold.** |
| **R42 A1** (dust at config addresses) | I traced every `pinnedAccountData` / `readPinned` caller: the alarm's `g()` (which checks dust first), `readPool`, `readMintedTotal`, the crank and revenue (both treat `null` as "not initialised"). The poster decodes records directly. A config cannot become dust after `initialize`, so `config_vanished` is unaffected. The R42 arm runs the alarm's own `g()` against both dust and a foreign-owned account. | **Holds.** No regression found. |
| **R42 A2/A3** (dust at token-account addresses) | `readTokenAccount` returning `absent` for a System-owned, zero-data account changes these paths: `judgeReserveRead` (a never-funded reserve is now quiet where it paged HIGH every pass before), crank activation (skips), pool/revenue health (unreadable, as before), `isProvablyEmpty` (absent is still not empty, so no false split proof), and revenue's `prepare` (opBefore = 0, then an idempotent ATA create over the dust, which R34.G2 measured lands). | **Holds.** |
| **V41-1** (the programs pass's page repair) | `web/src` is not in this bundle. The tests (`ceremony.test` V41-1, `get.test` C2) drive the real `readStep`, `resolveCollection` and `readBuySnapshot`, with controls for both foreign-owned and System-owned-with-data accounts. | Consistent, as far as the tests show. |

Round 41's rejected claims C05, C08, C09, C11 and C13–C21 also hold against this tree. I re-read R33.G4's premise: a native wSOL account closes while holding a balance.

---

## R1. The crank

I matched every crank-built instruction's account list, mutability and data against MINT's account structs: reschedule, capture, reveal, retire, join/claim, expire, split, distribute and activate. All match.

The send order avoids each in-line monthly hazard:
- retire and expire do not run `monthly_inline`;
- the first join batch's `monthly_inline` sees `waiting_to_join > 0` and returns;
- distribute, then activate and claim, find the period not yet due.

The planner arithmetic matches MINT's `credit`, `owed_of`, `reweigh`, `join` and `expire_boost`:
- the pre-expired owed amount is `atExpiry + level_w·Δacc`;
- the pre-joined vault's debt is `w·acc_old`;
- the retirement-freed share is subtracted from `owed_scaled`;
- `splitToPool = total − ⌊total·1500/10000⌋`, which matches the program's floored 15%.

Two further plan checks:
- No plan pays or joins a non-live asset. `preJoins`, `joins` and `ready` all gate on `'live'`.
- Reveals are contiguous from `revealed_total` and stop at the first failure or benign refusal.

**No defect.** One residual is noted under I-5.

## R2. The alarm

I found no dangerous state read as quiet that the accepted limits do not already state. Routine states that page every pass are already accepted:
- `lock_deadline_unset` before launch (round 41 C17);
- `vault_awaiting_return`, by design;
- `unredeemable_owner` for escrow listings (the stated ambiguity).

## R3. Layouts

These are real assertions:
- struct field lists parsed strictly;
- every scraped `OFF_` constant compared, with no orphans;
- SEEDS checked both ways (D6 exists now);
- versions, `BOOST_RING` and the evaluated `*_SPACE` (1005 / 211).

One residual: `SEEDS` has no `rescue`, and the check runs layout→Rust only. No `bank/` code needs it, and `web/test/ids.test` pins it.

## R4. Accrual

`credit`, `ceilSats`, `pendingScaled` (carry added before debt) and `reweigh` are the Rust formulas line for line. **No divergence.**

## R5. Swap and revenue

| Area | Finding |
|---|---|
| **(a) Oracle floor** | `num/den` with exponent `es − eb` is correct for every sign. Integer division floors, which lowers the floor (the safe direction). `satsPerLamport` uses prices below 2^53, so no precision loss. The arithmetic is p_s/p_b/10. |
| **(b) Pyth account** | Offsets check out: Full is a 1-byte tag, then feed at 41, price 73, conf 81, expo 89, publish 93. Only the push oracle (monotonic publish time) can write the derived PDA, so derived address plus owner check is sufficient. For the Clock, see I-6. |
| **(c) Spot prices** | Orca's √P² is B per A in raw units, which is sats per lamport. Meteora's `(1+bs)^id` is lamports per sat, so its inverse is correct. Floating-point error is about 10⁻¹⁵ relative, which is immaterial. |
| **(d) Minimum out** | The same `minSats` (oracle −150 bps, in sats) goes to both venues. |
| **(e) The judge** | Complete for the operator's own accounts, the amounts and the fees. A writable-signer escalation through CPI is impossible because the instruction marks the owner read-only. |
| **(f) Accounts** | Tick arrays `s0, s0−span, s0−2span`. Bin arrays `i, i+1, i+2` for Y→X. Seeds, optional accounts as the program id, and the event authority all match the published interfaces. An uninitialised or insufficient array makes the program refuse, which falls back to Meteora. |
| **(g) wSOL** | A pre-funded ATA is fine: the close returns its contents. The native mint cannot be frozen. Nobody but the owner can set a delegate. |
| **(h) Failure paths** | Every path leaves the cycle open until a return is recorded. Note the race in L-1. |

### (i) What an adversary can extract within the tolerance

The worst case is set by the 150 bps floor minus the honest cost (0.16% fee plus negligible impact): about **134 bps per cycle, about 0.13 SOL at the 10 SOL cap**. The deviation gate adds up to about 1% when the oracle is stale relative to the true market. So the bound against the true market is about 2.5% per cycle, which is SPEC's "no hard bound" made concrete.

At the ruled ceiling (about 34 SOL a day), the theoretical monthly maximum is roughly 14 SOL at 134 bps. In practice it is far less:
- sandwiching the about $10M Orca pool costs more in fees than about $15 of edge;
- on Meteora (about $0.9M) it is marginal.

**Recommendation:** tighten `SWAP_TOLERANCE_BPS` toward 50 bps for Orca, measured on the fork.

---

## Findings

### M-1 (MEDIUM): the key-holding jobs import code owned by other projects, which widens limits 10(c), 56 and the deploy key's custody

**Construct**
- `node_modules` is a tracked symlink to `/opt/gary-club/node_modules`. Round 41's own incident record confirms it.
- `scripts/probe-mainnet-facts.mjs` imports `/opt/gary-club/node_modules/@solana/web3.js` directly.
- `launch/create-cbob-token.mjs` loads the AWS SDK via `createRequire('/opt/gary-club/package.json')`.
- The page build and tests load esbuild from `/home/ubuntu/luna-remotion/node_modules`.

**Effect**
The crank, revenue (the swap-operator key) and the alarm run as the same user that holds these keys:
- `bank/keys/swap-operator.json`;
- `cbob-release.json` (the whole $CBOB supply);
- `deploy-authority.json` (it upgrades all five ids until step 11);
- the R2 backup credentials in `/opt/gary-club/.env.local`.

So the integrity set is not only "whoever can edit `bank/swap.mjs`" (limit 10(c)). It includes every publisher in two unrelated projects' dependency trees, at `npm install` (postinstall scripts) and at import. A routine website deploy in gary-club can change the code that signs the swap and holds the deploy authority. Between steps 9 and 11, that means the ability to replace MINT.

**Evidence if true (quick for a human to confirm)**
- `readlink -f node_modules` points into gary-club.
- `stat -c %U` shows the same owner for `/opt/gary-club/node_modules`, `bank/keys/*` and the PM2 or web processes.
- `npm ls --all | wc -l` and `npm query ':attr(scripts, [postinstall])'` in gary-club show the size of that tree and its install scripts.

**Fix**
- A repo-local lockfile with integrity hashes, installed with `npm ci --ignore-scripts`.
- A vendored, pinned esbuild.
- A dedicated OS user for the crank, revenue and key files.
- Move the deploy authority and the release wallet off the box. Both are Gary's call.
- State this trust set in limit 10 and limit 56.

### L-1 (LOW): no priority fee and no automatic retry means network congestion leaves a cycle open for hand recovery

**Construct:** `judgeSwapInstructions` refuses any compute-unit price. When both venues "refuse" by expiry (`!st && expired`), `revenue.mjs` throws "every pinned venue refused… must be swapped by hand", and the next run stops at the open-cycle guard.

**Effect**
- On a congested mainnet, base-fee-only swaps drop often. Each cooldown window whose sweep lands but whose swaps expire becomes a hand recovery and a CRITICAL page. Royalty SOL waits; nothing is lost.
- The same expiry rule has a second side. Under a load-balanced RPC, a status lookup can read `null` for a transaction that landed. The sweep is then filed as refused while the swap is "re-tried". Today the operator wallet holds only the cycle's funds, which bounds the damage: the Meteora wrap fails for lack of SOL.

**Evidence if true:** a rehearsal cycle during congestion logs "block height exceeded" on both venues, then `cycle … swapFailure`.

**Fix**
- Allow one fixed, judged `setComputeUnitPrice`, capped, for example ≤ 10,000 lamports per cycle.
- When both refusals are expiries proven by the chain, mark the cycle "swap not attempted" and retry it automatically.

### I-1 (INFO, a gate gap): nothing checks that the programs at HEAD equal the commit that `dist/` and the pages pin

`ids.test` and `bundle.test` tie `dist/` to `RELEASE_COMMIT = 0b3ddb3`. `run-tests.sh` tests the HEAD localnet build. Only the sweep helper's bytes are compared across the two. If any file in `programs/` or `Cargo.lock` changed after `0b3ddb3` without a `dist/` rebuild, step 9 would deploy bytes the suite never ran.

**Check:** `git diff --stat 0b3ddb3 HEAD -- programs Cargo.toml Cargo.lock` must be empty.

**Fix:** add that diff as a gate in `build-mainnet.sh` or the selftest.

### I-2 (INFO, a documentation misstatement of operational state)

SPEC item 22 and the control table say the crank is "installed DRY-RUN". VALIDATION B7 says the live crontab is still the v5 block: a missing `distribute.mjs`, no crank and no reconcile line. The v6 alarm runs under a v5 line.

**Before step 10:** confirm whether the old revenue line carries `--live`. If it does, initialization would start live royalty sweeps before item 22.3 and 22.4 have been proven.

### I-3 (INFO): limit 25 is still true at HEAD, although its wording suggests a fix

"The crank's and revenue's [Connection] at `2b67fb1`" reads as historical. At HEAD, the crank, revenue and the alarm still build `new Connection(rpc,'confirmed')` with no fetch timeout. A single hanging socket can still outlast a capture window.

**Fix:** either say so in limit 25, or add an `AbortSignal.timeout` fetch.

### I-4 (gate-5): `OPERATOR_FLOOR` is unpinned

SPEC limit 10(2) states "0.02 SOL". No arm reads it, and `revenue.mjs` `main` runs in no gate. This is C06's class: it is loud if wrong and does not guard a holder's share. Pin the literal.

### I-5 (INFO, measure it): the crank's reveal has no compute-unit limit on the largest vault shape

Item 54 says "the crank is unaffected", based on a reveal of a plain vault (150,344 CU with inline capture). Round 40 U1 measured the largest vault's redemption at the default budget, not its reveal.

A minter controls their own vault's shape (an autograph near 10 KB plus owner plugins). If that reveal, after a lost capture race (so with inline capture), exceeds 200,000 CU, the crank's reveal lane fails at the FIFO head every minute until someone reveals manually with a higher limit. The pages `crank_failing` and `reveal_queue_stalled` would fire.

**Measure:** the R28.A1 vault's `reveal_level` at the default budget, with and without stored entropy.

**Cheap fix:** set the CU limit on reveals.

### I-6 (INFO): `MAX_ORACLE_FUTURE_SECS = 30` ties revenue liveness to Solana clock drift

If the Clock sysvar runs more than 30 s behind Pyth's wall-clock publish times, every swap is refused. A refusal at `m1` is harmless. A refusal at `m2`, after the sweep has landed, leaves the cycle open.

**Measure:** sample Clock against UTC on mainnet for a week.

---

## R6. The gates, and `web/test/`

**Floors.** I recomputed them:
- detector 940, which is round 41's 933 plus 7 new arms;
- web 671, the sum of the ten floors;
- mainnet probe 33, swap fork 16.

**Equality checks.** The equality checks and the "it can fail" controls for the round-24 arms are real. Most source-regex arms are presence-bound.

**Weak arms.** Three remain:
- `delete env.ALERT_URGENT` and I5's `applyFrozenTransitions` are presence-only. They would not catch the call being moved to the wrong place.
- R39 C01's extracted send block starts at `retireBurned`. Reschedule, capture and reveal ordering is still untested.
- `proxy.test`'s method allowlist is derived from `conn.X(` regexes. A page using another variable name escapes it, but that fails loudly at runtime.

**Web tests.**
- Non-vacuous where I could check: the C04 regex binds `|` inside its group, and the M2 ordering arm is presence-bound.
- They depend on untracked `.cache/placeholder` and the esbuild path in M-1.
- They are still not in `run-tests.sh` (C07, carried).

**Other scripts.**
- `build-mainnet.sh` proves what it claims for all five programs, given I-1.
- `cron-install.sh` arms nothing extra.
- `rehearsal-tree.sh` excludes `web/`: the pages' `PROFILES.rehearsal` is filled by hand. This is consistent with item 53's stated scope, and it means the rehearsal proof never covers the pages.

---

## The four questions about the accepted limits

1. **Is any limit worse than stated?** Yes:
   - Limits 10 and 56: M-1 widens their trust set.
   - Limit 25: still true at HEAD (I-3).
   - Discharged item 54: its "crank unaffected" claim is unmeasured for the largest vault (I-5).
2. **Is anything listed as a limit not actually a limit?** None found.
3. **Is any DISCHARGED item not actually discharged?** Item 54's crank clause should be re-scoped until I-5 is measured.
4. **Is any OPEN AND BLOCKING item being treated as accepted?**
   - Item 22 is described as "installed DRY-RUN" while the box runs v5 cron (I-2). That is open work described as done.
   - Item 53's rehearsal value set is still unbuilt.
   - Item 22.5 (one DAS read) is still unsettled.

---

## Given no human firm and immutable programs, what to do before launch that AI audit structurally cannot

1. **Isolate the key-holding runtime (M-1).**
   - Dedicated user and host for the crank, revenue and keys.
   - Lockfile with integrity hashes, `--ignore-scripts`, vendored esbuild.
   - Deploy authority on a hardware wallet.
   - The $CBOB release supply moved to a Squads (Gary's call).
2. **Independent reproducible build.** A second machine, a second person, built from the release commit, comparing `dist/` sha256 values. Then dump the deployed programs at steps 9, 10 and 11 from a machine other than this box.
3. **A human reads every `initialize` on the signing device.** Compare each field against `launch/mainnet-init.json` (item 38 A6: the checker validates the JSON, not the transaction).
4. **Run the dress rehearsal (item 22) under real load.** Include a congested window (L-1), Orca forced to refuse, and a forced post-sweep failure recovered by hand. Record time-to-guardian-stop from a real page on Gary's phone.
5. **Fix the live crontab (I-2) before step 10.** Confirm the revenue posture, install the v6 crank as dry-run, and run the deadman drill.
6. **Test the pages with real wallets on real phones.** Phantom, Solflare, Ledger, and at least one wallet that injects instructions, against a staged deployment, including a stranger dusting and flooding the vault mid-redemption.
7. **Measure what only mainnet shows.** Clock-vs-UTC drift (I-6), DAS `burnt` (22.5), and the largest vault's reveal CU (I-5).
8. **Fund a public bug bounty before the lock**, scoped to the five programs. It is the only human adversarial review this system will get, and it must come before the authority is removed.