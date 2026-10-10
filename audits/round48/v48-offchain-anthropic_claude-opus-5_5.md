# Round 48, OFF-CHAIN pass: independent audit of the final tree

## Verdict

**LAUNCH-CLEAN, but changes are required.** I confirm nothing in classes (a) to (d):

- nothing in the five programs;
- no path that moves value wrongly or credits it wrongly;
- nothing that stops or wrongly refuses a crack;
- nothing at HIGH or MEDIUM.

I file **two LOW and four INFO findings**. All six are in tooling written or changed in round 47: the Core watch, its installer line, the diagnostic runner, and the build provenance check. Each one changes code, so none qualifies under the 2026-10-07 documentation exception.

**This is not the no-change round Gary's rule requires.**

What I did and did not do:

- I read the bundle and ran nothing. Every finding below says what measurement would confirm or refute it.
- Where a claim turns on a file I was not given, I say so: `web/src/*`, `rpc-proxy.mjs`, `e2e-localnet.sh`, the rehearsal driver steps, and the router at `/opt/scripts/alert-router.py`.

---

## R0. Round 47's verdict and its repairs

| Repair | Holds? | What I checked |
|---|---|---|
| V47-1 / V47o-4: tracked rounds only | **Holds** | `auditFacts` derives every number from `git ls-files audits/`. The scratch-worktree arm drives the real generator. Residual: `read(f)` reads the **working-tree** copy of a tracked verdict, so an uncommitted edit to a committed verdict changes the README. INFO only, fail-closed through `--check`. |
| V47-2 / V47o-5: NONE reads "none" | **Holds** | `(?!NONE\b)`. All five shapes are driven, including a validated round. |
| V47-6: README program table | **Holds** | Text arm plus negative arms. |
| V47o-1: result written as JSON | **Holds for the newline case** | `res()` uses `node -e … JSON.stringify`. With `node -e`, `process.argv.slice(1)` is the correct slice. A raw-newline file reads as `unreadable` and is never restarted. See **N1** for the case it still misses. |
| V47o-2: one validator at a time | **Holds for top-level runners**; residuals in N2 and N4 | The flock is taken before the EXIT trap in all five runners (source-order arm). The validator is booted with `9>&-`. A kill test runs on a real flock. A runner started by the holder inherits fd 9, which shares the open file description, so the re-lock succeeds. That is correct. |
| V47o-6: Core watch in the installer, plus deadman | **Holds as text; introduces N2** | The repair is in place, but the flock it added creates the problem described in N2. |
| V47o-7: an earlier build's result is still sent | **Holds** | `decide()` walks `obs.prior`; the selftest drives it. |
| V47o-8: mock serves `getTokenAccountsByOwner` | **Holds** | Plan arm asserts no `unlisted` box. The adversary hook moved to the classic listing. |
| V47o-9: named missing `dist/` | **Holds** | The guard sits after [3/7] and before the web tests. |
| C19: probe floor read from `MAINNET_FLOOR` | **Holds** | |

Round 47's rejected claims re-test the same:

- C10 (Meteora key 9) remains limit 10(c).
- C12 (reveal run `break`) remains by design. MINT's FIFO would refuse anything after it.
- C14 (`NoActiveVaults`) remains unreachable on the stated path.

---

## Findings

### N1. LOW: a killed diagnostic leaves a stale `running-$H` marker and a non-terminal result file, so no suite ever runs again for that Core build

**Construct.** `scripts/core-watch-suite.sh` and `scripts/core-watch.mjs` `decide()`.

- The script creates `running-$H` (noclobber) and writes `{"status":"waiting"}` **before** `trap restore EXIT` exists.
- After the lock, it writes `running`.
- A SIGKILL, OOM or reboot at any point leaves:
  - `suite-$H.json` reading `waiting`, `running` or `queued`, a status that `finished()` rejects;
  - `running-$H` on disk.
- `decide()` emits `{kind:'suite'}` only when `suiteStatus` returns `undefined`, meaning no file. It never re-queues a non-terminal status.
- So from that tick on, the watch only re-asserts "still not the pinned build … Suite: running", non-urgent, for ever.
- A manual restart is refused too: the script exits "already running" on the stale marker.

**Cost.** The URGENT "change" email still went out, and the alarm's `prog.core.hash` CRITICAL still fires. But the promised PASS/FAIL result never arrives, and nothing says the run died. HOLDER-GUIDE says "Each time a new Core goes live, our whole test suite runs again." For this build, it does not. This is the same class as V47o-1 (a monitor that cannot report its own result), surviving its repair through a different exit.

**Evidence if true.**
1. During a diagnostic, `kill -9` the `bash core-watch-suite.sh` process, or reboot.
2. On following ticks, `watch.log` shows `actions: email` with `Suite: running` and never `suite`.
3. `ls .cache/core-watch/` shows `running-<H>` and `suite-<H>.json` with `"status":"running"`.

**Fix.**
- Write the script's pid and boot id into the result file.
- In `suiteStatus`, treat `queued`, `waiting` or `running` whose pid is dead (or whose boot id differs) as **unreadable/finished-unknown**. That yields one URGENT "unknown, treat as failed" email.
- Have the script break a `running-$H` whose pid is dead.
- Gate-5: a selftest arm feeding `{status:'running', pid:<dead>}` must yield the URGENT unknown email and no restart. Show it red at HEAD.

### N2. LOW: the Core watch's new cron flock is probably inherited by the multi-hour detached diagnostic, so every later tick is skipped and the deadman pages falsely

**Construct.** The `scripts/cron-install.sh` line `$FLOCK $LOCKDIR/core-watch.flock /usr/bin/node scripts/core-watch.mjs`, together with `core-watch.mjs`, which runs `spawn('setsid', ['bash', 'core-watch-suite.sh', …], { detached: true, stdio: 'ignore' })`.

**The mechanism.**
- util-linux `flock` without `-o` leaves the lock fd open in the command it runs.
- Node and libuv do not close inherited non-CLOEXEC fds in children.
- `setsid` detaches the session, not the fds.
- So the diagnostic, and everything it starts (npx, the suite), would hold `core-watch.flock` for its whole run, which is hours.

**Consequences while it runs.**
- Every `*/10` tick fails `flock -n` and writes nothing.
- After 60 minutes the new `core-watch-deadman` pages "nothing is checking Metaplex Core on mainnet". That is false while the diagnostic is healthy, and it repeats hourly.
- A further Core change during that window goes unseen by the watch. The alarm's drift detector still sees it.

This was introduced by round 47's V47o-6 repair: the earlier hand-added line had no flock.

**Evidence if true.** During a diagnostic:
- `lsof /opt/cbob-vaults/bank/locks/core-watch.flock` lists the `bash core-watch-suite.sh` tree;
- `core-watch.log` stops advancing;
- the router log shows `cbob-core-watch:deadman` about 60 to 70 minutes into the run.

If `lsof` shows only the short-lived tick, this finding is refuted.

**Fix.** Either change the cron line to `flock -n -o …`, which closes the fd before the command runs while flock itself keeps the lease, or close all fds above 2 at the top of `core-watch-suite.sh` before taking fd 9. Gate-5: an arm asserting the installer's core-watch line carries `-o`, or a shell test that a child of the tick does not hold the lock.

### N3. INFO: `scripts/build-mainnet.sh` calls an untracked file "dirty", the same class as V47-1

**Construct.** `DIRTY=$(git status --porcelain)` covers the whole tree, untracked files included.

**Effect.** During any audit, untracked `audits/roundN/` output exists. `build-mainnet.sh` then refuses without `CBOB_ALLOW_DIRTY=1`. With the override, it stamps `dirty yes` into `MANIFEST.txt`, and `web/build.mjs` and `ids.test` refuse that `dist/`. That collides with V47o-9's new bootstrap ("run build-mainnet.sh at the release commit"), and the bytes are unaffected. It fails closed.

**Fix.** `git status --porcelain --untracked-files=no -- programs Cargo.toml Cargo.lock Anchor.toml .cargo`, plus the untracked-in-program-paths check that `release_gate` already uses.

### N4. INFO: "a killed run frees the lock" holds only if every child dies

**The gap.** Validators are booted with `9>&-`, but other children inherit fd 9: `timeout 7200 npx tsx …`, `node bank/selftest.mjs`, and the swap fork. A SIGKILL to `run-tests.sh` alone leaves `timeout` and the suite running for up to 2 hours, still holding the validator lease. Every other runner and the Core diagnostic are refused, or wait, meanwhile. This fails safe, but `validator-lock.sh`'s comment overstates the guarantee.

**Fix.** Either correct the comment, or run long children with `9>&-` and rely on the parent's lease.

### N5. INFO: the diagnostic's failure summary may count a stale `suite.log`

`FAILS=$(grep -c '^  XX' "$C/suite.log")` reads the shared `.cache/suite.log`. If the generated runner dies before [7/7], that file belongs to a previous run, so the emailed "N failing assertions" can be someone else's. RC is still correct.

**Fix.** Read `$LOGF`, or delete `$C/suite.log` before starting.

### N6. INFO: the installer leaves untagged hand-written CBOB lines running beside the tagged ones

`grep -v "$TAG"` keeps every untagged line. Round 47's own measurement found these on the box's crontab:

- an untagged, unflocked `*/10 … core-watch.mjs`;
- an unflocked `bank/alarm.mjs`;
- a `bank/distribute.mjs` line for a deleted file.

After the V47o-6 install, two Core watchers run, one of them unflocked on the `*/10` tick the header says to avoid.

**Fix.** Have the installer warn on, or refuse, any untagged line invoking `bank/*.mjs` or `scripts/core-watch*.mjs`, and print the count. Ops: remove those lines.

---

## R1. The crank

I matched every instruction's account list against MINT's `#[derive(Accounts)]`. All of them match in order and mutability:

- `reschedule`, `capture`, `reveal_level`;
- `rescue_nested` (config, vault W, collection, host, new_owner, payer S+W, rescue PDA, Core, System);
- `retire_burned`, the claim and join batches, `expire_boosts`, `split_revenue`, `distribute(0)`, `activate`.

**Join and pay logic.**

- **Joins go to the right account.** Joins send `(record, vault_ata)`, and MINT requires `dest == r.vault_ata` for a pending record. For a pre-joined vault, the crank checks `tokens[asset]` at the canonical ATA, which is exactly what `activate` recorded. They agree.
- **Races cannot be refused.** A pending vault joined by someone else between plan and send becomes an active claim with zero owed, which MINT does not refuse.
- **A failed distribute is harmless to the following batches.** If the distribute fails, the post-distribution join pairs become no-ops inside MINT's `claim` (`dist_epoch > request_epoch` is false). The paid amounts are simply smaller, so nothing is refused.
- **The planned owed amount is exact.** The pre-expired path computes owed as `pendingScaled at the old acc + level weight × Δacc`, which equals MINT's expire-then-credit sequence.
- **Nothing dead is paid or joined.**
  - Burned and `other` assets are never paid or joined.
  - Burned vaults are retired first.
  - A pending burned vault is not joined.
  - `retiringThisEpoch` prevents a tick that MINT would refuse with `NoActiveVaults`.

Out-of-order reveal: none. The loop walks `revealed_total` upward and `break`s on skip, mismatch, benign or fail.

Value routing: the crank pins no destination of its own. Its only signature is as payer, and every destination is MINT-pinned (`WrongRescueDestination`, recorded `vault_ata`, `pool_ata`). The selftest also forbids any transfer construct in its source.

**One residual, INFO and not filed.** `rescue_nested` refused with `NotALiveVault` (the nested vault was burned after the plan) is not in `BENIGN`, so it pages one action failure. It is rare and self-clearing.

## R2. The alarm

I found no dangerous on-chain state that reads quiet beyond what SPEC already states, and no routine state that pages every pass.

- `test_value_in_production` covers Gary's values: 21% / 51% / 3 days, the 7-day notice, the tighten bounds, the 30-day month and the one-hour window.
- `program_not_locked` and `lock_deadline_unset` cover all five programs, the sweep helper included.
- `THIRD_PARTY_PROGRAMS` (Orca, Meteora, Pyth receiver and push oracle) are watched at HIGH.

## R3. Layouts

- SEEDS is now asserted against each program's `*_SEED` constant, closing round 24 D6.
- `parseRustStruct` throws on any line it cannot read.
- Every scraped `OFF_` constant is compared.
- Versions, `BOOST_RING` and the `*_SPACE` constants are evaluated from the Rust.

A struct edit cannot slip past.

## R4. Arithmetic

`accrual.mjs` matches MINT's `credit`, `owed_of` (carry added before debt), `reweigh`, `ceil_sats` and the join debt. The alarm's `poolAvailable` uses the same ceiling.

## R5. Swap and revenue

**(a) Oracle math.** The exponent handling is right for both signs. `num/den` floors, and `minSats` floors again, so rounding always goes against the swap. The expo is bounded to −18..0, which prevents BigInt blow-up. `satsPerLamport` is a float used only for the deviation gate.

**(b) Pyth account checks.** The offsets are recomputed correctly: level at 40, feed at 41, price at 73, expo at 89, publish time at 93.

- Owner plus derived address is sufficient against forgery: only the push oracle writes it, through a verified update.
- **Inside the existing limit 10(a):** anyone may post any Wormhole-signed update newer than the stored one. Within the 180 s window an adversary can therefore choose the most favourable signed Pythnet price.
- The clock is trusted, as stated in 10(b).

**(c) Spot prices.** Directions are correct. `orcaSpot` is (√P)² in sats per lamport for A = wSOL. `meteoraSpot` is 1/(1+bs)^id because DLMM prices Y per X. Floating-point error is about 1e-12 against a 100 bps gate.

**(d) Minimum out.** It is the same `minSats` as the floor, at offset 16 in both programs. It is in sats of the output mint, which is the unit both programs expect.

**(e) The judge.** It is complete for value roles. Not pinned: Orca's tick arrays, oracle and vaults, and Meteora's reserves, oracle, bin arrays and key 9. The pool programs validate those, apart from key 9, which is limit 10(c).

**(f) Account derivation.** Correct. An uninitialized array or a boundary crossing means a refusal, which falls back to Meteora, and Meteora failing too means a loud open cycle.

**(g) wSOL handling.** A pre-existing balance is swept back by the close. Native mint cannot be frozen. A delegate on the ATA could only have been set by the operator.

**(h) Retry.** An unconfirmed send never tries another venue (`rememberAttempt` then throw). The ledger stays open until the return and split are proven.

**(i) Extraction bound.** Within the gates, a sandwich or a pushed pool can take at most about 150 bps minus the 16 bps fee minus natural impact, so about 1.2% per cycle.

- At the ruled cap that is about 0.12 SOL per 10 SOL cycle, about 0.48 SOL a day at the hourly cadence (24/7 × 10 SOL), and about 14 SOL a month **only if royalties run at the cap**.
- On top of that sits up to 30 bps of confidence on each feed. This is a bias against the true price, not against the oracle price.
- The swap is material only at royalty volumes near the cap. The holder guide's "up to 1.5% below Pyth, and further if Pyth's own price is off" is accurate.

**Operator key, worst case.** Unchanged: the per-sweep cap times the cooldown windows until the guardian stops the sweep.

## R6. Gates

- The selftest floor is 1081 and the runner's floors are equal-to, not at-least.
- Round 47's new arms each have a mutation shown.
- Gaps: the N1 and N2 paths have no arm.
- `build-mainnet.sh` proves what it says for all five programs: reject/accept behaviour for the four keyed programs, and byte identity of the sweep helper with `target/deploy`. N3 is the one exception.

---

## The accepted limits

**1. Worse than stated?** No.

- Limit 10 matches my R5(i) bound, with the push-oracle choice-of-price nuance already inside 10(a).
- Limit 7's claim that "a killed run frees it" is weaker than its text says, but that is tooling, not this limit (N4).

**2. Not actually a limit, or already closed?** None found.

**3. A discharged item not actually discharged?** None. Item 54 still binds the pages; item 12/17 stands as measured.

**4. Open-and-blocking items quietly treated as accepted?**

- **Item 22.2** is explicitly ruled accepted (Gary, 2026-10-10). That is not quiet, but it is a waiver of a named pass criterion, a quiet second pass that was never obtained. It is recorded as such.
- **Item 53:** the last in-tree full run was at `e7c192a`. Every later repair commit needs the run again, including round 47's `bba189a`, the strip commit `d2ae5fc`, and any round-48 repair. Its absence keeps 53 OPEN. It must not be read as satisfied.
- **Item 50:** pages staged, not published. Still open.
- **Item 38:** three values are still OPEN. Still open.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run the 2,100-vault scale test on a mainnet fork, end to end** (item 22's only open part). Measure cost, RPC rate limits, the reveal lane keeping up during a sell-out minute, and the crank surviving an RPC fault at vault 1,900. Record every number. No reader can produce these numbers.
2. **Second-machine reproducible build.** Someone other than this box rebuilds `RELEASE_COMMIT` in the verifiable container and checks the hashes against `web/src/config.js` before step 9's upload. OtterSec must show *verified* before `--final`.
3. **Fault-inject the monitors, not just the money paths.** Kill -9 the diagnostic, reboot mid-run, and fill the disk. That would have found N1 and N2, and only execution finds this class.
4. **Hold the Giraffish Moments update authority cold, or in a multisig, for the 7-day window.** This is Gary's call under RT2-1. It is the single largest residual that no code here closes.
5. **Delete the box copy of the `$CBOB` release key and the deploy authority right after step 11**, and test the backup restore path once before step 9.
6. **A public bounty on the deployed, initialized, but not yet final programs, with real but tiny value.** Run it between steps 10 and 11, for long enough that someone other than the authors has tried to break the crack and the pool. It is the only adversary with skin in the game that you can buy before immutability.
7. **Fix N1, N2, N3 and N6, show each red without its fix, then audit again.** A round that requires no changes is still owed.