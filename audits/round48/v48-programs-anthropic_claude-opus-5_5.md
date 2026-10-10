# Round 48 — Programs pass: independent audit report

**Verdict: LAUNCH-CLEAN on my reading, with five confirmed findings and one finding that sits next to gate class (c).**

- **No finding in the five programs.** I re-read SEAL, MINT, BURN, GOV and the sweep helper whole and recomputed every raw offset.
- **One finding comes close to class (c).** F-1 can make a holder's crack refuse once. It recovers on retry, and nothing is lost. I grade it LOW, but its fix is a two-line client change and I recommend making it before publication.
- **Four further findings sit outside (a)-(d).** Two are LOW, two are INFO.
- **This is not a no-change round.** Every finding below needs a change.

I ran nothing. Every claim says what would be observed if it is true.

---

## R0. Round 47's verdict and its repairs

| Repair | Holds at the site shown? | Notes |
|---|---|---|
| V47-3 (R.4 raw registry + R.4b control) | Yes | The control can fail, which is what was asked. |
| V47-4 (ceremony compute floor) | Partly | See F-5. |
| V47-5 (judge refuses a removed signer or writable) | Yes | Both directions now compared in `roles()`. |
| V47-6, V47-7, V47-8 (README and SPEC text) | Yes, in README and SPEC | `web/README.md` was not swept (F-4). |
| V47-9 (proxy header) | Yes | Same shape survives in `web/README.md` (F-4). |
| V47o-2 (one validator at a time) | **Not at every site** | See F-2 and F-3. |

- The round-47 claims I re-tested still stand on this tree:
  - Muse's HIGH (C10) remains disproved, by SEAL `assert_classic_spl` and the ATA program's `IncorrectProgramId` for a Token-2022 ATA of a classic mint.
  - MiMo's two MEDIUMs remain fail-closed designed behaviour.
  - The ignored-files claim (C11) remains disproved.
- The README and SPEC repairs are correct where they were made.

---

## R1 and R1s. Custody and the sweep helper

I found no break. What I checked:

**Pairing (SEAL and BURN)**
- Both directions bind asset (account 0) and owner (account 2).
- Both read only top-level instructions.
- The CPI-wrapper arms WR.1–WR.4 cover the wrapper shapes.
- A mid-transaction transfer of the asset makes `burn_vault`'s owner check fail, so the whole transaction reverts.

**Emptiness proof (BURN)**
- The token-account offsets are right: delegate tag at 72, delegated_amount at 121..129, close-authority tag at 129.
- The length is checked after the delegate checks.
- A closed account (System-owned, 0 lamports) is skipped for the right reason. It holds nothing and nothing can sign for it.

**Sweep helper, (a) to (f)**
- (a) Access control: only the owner can drive it through Core ExecuteV1. SR.5 to SR.5e cover the alternatives.
- (b) Pair list:
  - A source can never be a destination, because `signer != dest` and owners are checked.
  - A duplicate source fails at the second read (SR.12a/b).
  - A wSOL source closes, with its rent going to `dest`.
- (c) A lamports-only sweep to a non-existent destination below rent is refused (R41.C8a–c).
- (d) Nothing between the sweep and the burn credits the asset-signer.
- (e) A Token-2022 ATA for a classic reserve mint cannot exist (measured, probe C10). A non-ATA classic cbBTC account is undeclared; the page names it or moves it. A nested Core asset is accepted limit 9/44.
- (f) The S8.0 measurement includes claim, open, helper and burn. The page's additional bytes (compute budget, separate payer) are accounted for in SPEC item 50.

## R2. The community pool

The invariant "pool ≥ ceil(owed)" holds by induction:

| Event | Effect on the invariant |
|---|---|
| `credit` | Adds at most `avail × SCALE`. |
| A claim | Pays the floor of the pending amount and subtracts exactly the settled amount. |
| `reweigh` | Preserves what each vault is owed (carry = owed; debt = after × acc). |
| `retire` | Lowers owed. |

- Only the config PDA can debit the pool.
- The counters stay consistent under the orderings I traced: join inside claim after `monthly_inline`, retire of a waiting vault in the same epoch versus an earlier one, and the boost due/unschedule branches.
- No permanent block exists. Every gate (`JoinWaitingFirst`, `BoostsExpireFirst`) is cleared by permissionless calls that need no token account.

## R2b. The boost

The model in host test N1 and suite BO.21/BO.35/BO.38 matches my reading:
- A boost gets exactly N distributions and no more.
- A ring slot is freed exactly once.
- Records are skipped after retirement.

## R3. The level draw

- The SlotHashes parse is bounded and fails closed.
- FIFO order and reschedule behave as described.
- SPEC 26's "C's leader chooses among many draws" is accurate.
- I found nothing worse than stated. The asset address in the hash is fixed before any of the three slots exist, so it cannot be ground.

## R4. Governance

- I found no minority path.
- A restart skip mirrors MINT `StopIsNewer`.
- The key-change bar uses the snapshot, as SPEC 47/D1 says.

## R5. The charter claim

- SPEC 46 is complete as far as I can see.

## R6. One-time configuration

- Bounds read as SPEC 38 states.
- The rate ring is exactly a rolling window: the k-th most recent entry is at `head − k`, with `head` the next write.

## R7. Cross-program raw reads

I recomputed every MintConfig field from the struct:
- `bare_burns_retired` at 454.
- `sweep_floor_lamports` at 631.
- `max_boost_weight` and `max_boost_epochs` at 711 and 712.
- The ring at 749..1005.
- VaultRecord at 221 bytes.
- BurnConfig `burned_total` at 42.

All match the pins in GOV, BURN and the suite.

## R8. Suite, simulation and build

- There is no new arm that cannot fail.
- See F-2: a runner path contradicts a claim the repair commit makes.

---

## Findings

### F-1 — LOW (adjacent to class (c)): an opening of a vault waiting to join can be refused by a join-and-distribute race

**Construct:** `web/src/lib/plan-redeem.mjs`, `planRedemption`.
- It includes `claim` only when `record.active && !poolFrozen`.
- For a **pending** record (requested activation, not yet joined) the opening carries no claim.

**What breaks:** if two things land between the page's final dry run and the opening, MINT `retire_redeemed` refuses with `ClaimBeforeBurn`:
1. The vault is joined. Anyone's `claim` does this, and the crank does it every hour.
2. A distribution then credits it at least one sat. This can be a 100 $GARY burn, or the crank's own distribute in the same pass.

**How wide the window is:** it includes the holder's Phantom approval time, which can be a minute or more. That makes it reachable:
- **honestly**, through the crank's "join, then distribute, then claim" order;
- **deliberately**, for about 100 $GARY.

**Cost:** one refused opening and its fee. On re-plan the vault is active, so the claim is included and the retry lands. Nothing is lost.

**Why it matters:** it contradicts the promise that "a stranger … cannot block an opening" for exactly one transition.

**Evidence that would exist:**
- In the e2e harness, plan a redemption for a pending, eligible vault.
- Then, in separate transactions, run `claim([vault])` and `distribute(burn)`.
- Then send the planned opening. It fails with MINT error `ClaimBeforeBurn` in `retire_redeemed`.

**Fix:**
- Include `claim` whenever the record is pending or active and the pool is not frozen.
- For a pending vault, MINT's claim joins it at the current accumulator and owes nothing.
- If it was already joined and credited in between, the claim pays it, and the helper sweeps the payment out.
- The packet cost is negligible: every account is already in the transaction.
- Add an e2e arm for exactly the race above.

### F-2 — LOW: `tests/expiry-budget.mjs` boots a validator that inherits the runner's lock

**Construct:** V47o-2's claim that "the validator never holds the runner's lock."
- `run-tests.sh` holds fd 9 (the flock) and runs `node tests/expiry-budget.mjs` through `sub_selftest`.
- That script `spawn`s `solana-test-validator` with `stdio: ['ignore', log, log]`.
- Node and libuv do not close inherited fds that lack the close-on-exec flag. fd 9 was opened by bash with `exec 9>>`, so it has no close-on-exec flag.
- The validator therefore holds the lease.

**Consequence:** if the runner is SIGKILLed in that phase, the orphan validator holds the lock. Every later runner then refuses "another run holds the test validator" until a human kills it. This fails closed and is not a false pass. It is the exact orphan case the repair was written to remove.

**Evidence:** during the expiry-budget phase,
```
ls -l /proc/$(pgrep -x solana-test-val)/fd | grep VALIDATOR.flock
```
shows the lock file.

**Fix:** pass `stdio: ['ignore', log, log, ..., 'ignore']` so that index 9 is replaced, or spawn through `bash -c 'exec 9>&- solana-test-validator "$@"'`. Add a selftest arm that greps every validator spawn for one of the two forms. `sim/swap-fork.sh` is not in my bundle and should be checked for the same shape.

### F-3 — LOW: `sim/rehearsal-local.sh` takes no validator lock

**Construct:** `sim/rehearsal-local.sh` boots a validator on 8999/9900 for an hours-long local dress rehearsal but never calls `validator_lock`.

**Consequence:**
- A `scripts/run-tests.sh` started afterwards takes the free lock.
- Its `cleanup` at [4/7] then `pkill`s `solana-test-val` and `fuser -k`s the ports.
- That destroys the local rehearsal's ledger mid-run.

This is local only and moves no value. It is the V47o-2 shape at a sixth runner.

**Evidence:** start `rehearsal-local.sh`, then start `run-tests.sh`. The rehearsal driver fails with RPC connection errors at its next read.

**Fix:** source `validator-lock.sh` and take the lock before the trap; boot the validator with `9>&-`; list the script in `validator-lock.sh`'s header.

### F-4 — INFO: `web/README.md` still carries two stale facts (V47-9's shape, not swept)

1. **"Build, test, stage, publish"** says "801 offline assertions in 11 files". The floor is 805 (`run-tests.sh` `WEB_FLOOR`, and the README facts).
2. **"A stranger cannot block an opening"** says the other token accounts "are listed … (`getProgramAccounts` with an owner filter …)". Since round 46 they are listed with one `getTokenAccountsByOwner` per program (`reads.mjs vaultWalletAccounts`, `rpc-proxy tokenListingShape`). The proxy section of the same file is already correct.

**Fix:** update both sentences. Consider having `readme-facts` generate the web count too.

### F-5 — INFO: the ceremony's compute floor (V47-4 repair) leaves no room for the wallet's own additions

**Construct:** `ceremony.mjs` passes `minUnits: sim.unitsConsumed`, the bare dry-run consumption.
- Phantom then adds Lighthouse checks, which cost up to about 12,800 CU (`LIGHTHOUSE_CU_ALLOWANCE` in `tx.mjs`).
- A wallet limit between the bare consumption and bare consumption plus Lighthouse cost therefore passes the judge and then fails the RPC preflight.
- The holder pages use `pageUnits()` (×1.1 + 20,000).
- The comment's reason ("Phantom's fixed 200,000 still passes") is a property of today's step sizes, not a rule.

**Consequence:** nothing lands and nothing is lost. This is a weaker guard than the judge's documented contract.

**Fix:** use `sim.unitsConsumed + LIGHTHOUSE_CU_ALLOWANCE`. This still admits 200,000 for every step measured in the rehearsal.

---

## The accepted limits: the four questions

1. **Is any limit worse than stated?** None found beyond F-1, which is a client gap, not a limit.
2. **Is anything listed as a limit already closed?** No.
3. **Is any discharged item not actually discharged?** No.
4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** Yes, item 22.2, recorded openly. **INFO.**
   - The section's own rule says an OPEN AND BLOCKING item "left by being measured, which is the only exit."
   - 22.2 exited by ruling ("accepted as passed").
   - The ruling is Gary's to make. What it leaves unmeasured should be stated beside it: the alarm has never been observed to produce a pass with no unexplained CRITICAL after a re-baseline on mainnet.
   - That is the steady-state false-positive property 22.2 existed to show.
   - Recommendation: one quiet production-mode pass after road step 10, recorded, before road step 11.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run a capped live canary before road step 11.**
   - Deploy the real build.
   - Run the charter window and a first small sale with real holders while the upgrade authority still exists, under the alarm.
   - Lock only after a defined quiet period with real traffic: at least one full monthly distribution, several real redemptions through the published page, and one boost cycle.
   - This is the order of operations the immutability ruling already requires; it does not reopen the ruling.

2. **Fund a public bug bounty before the lock.**
   - Escrow the reward on chain, sized to the value expected in the first month.
   - Leave it open for a fixed window before road step 11.
   - Humans with adversarial incentives find what reading misses.

3. **Fuzz the accounting against its mirror.**
   - Run randomized instruction sequences (mint, activate, join, distribute, claim, boost, expire, retire, redeem) on a validator.
   - After every step, assert the pool invariant and the counter identities against `bank/accrual.mjs`, for millions of steps.
   - The host test drives 260 epochs of free functions; a sequence fuzzer drives the handlers' account plumbing.

4. **Test every real wallet.**
   - Phantom, Solflare, Backpack and a Ledger through Phantom, on every holder flow.
   - Include the two widest openings and a page-budgeted opening (SPEC item 50).
   - Record each wallet's actual edits. AI cannot press "Approve" in a real extension.

5. **Have an independent person reproduce the build and the hashes.**
   - From a clean clone on their own machine.
   - Then compare against `solana program dump` after road step 9, before `--final`.

6. **Hold the Moments collection key cold, or in a multisig, for the seven-day charter window.**
   - SPEC 46 shows this one operational act removes the largest stated pre-launch risk. It costs nothing and needs no code.

7. **Write and rehearse a Core-change runbook.**
   - The decision is pause sales versus not, and who announces what, if a Metaplex upgrade breaks redemptions after the lock.
   - No program change can answer it; only people and communication can.