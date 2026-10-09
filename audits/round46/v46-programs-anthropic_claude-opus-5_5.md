# Round 46 audit: the full tree at `63a92b2`

## Verdict

- **Programs:** no confirmed defect in the five programs.
- **Value and cracks:** no path that moves or miscredits value, and nothing that stops or wrongly refuses a crack.
- **Severity:** nothing at HIGH or MEDIUM.
- **What I did confirm:** two LOW findings and four INFO findings, all in the rehearsal driver or in documentation. All sit outside the launch gate's (a)–(d).
  - The main one is that round 45's V45-4 repair, "a stopped step has a safe resume", was applied to two steps. It was not applied to every step of that shape.
  - V45-6's reordering also introduced a new wedge.

I have not run anything. Every claim below names the read-back or run that would settle it.

---

## R0. Round 45's verdict and its repairs

**The round-45 confirmed findings, and whether each repair holds:**

| Finding | Repair | Holds? |
|---|---|---|
| V45-1 | `judgeForcedFailureAlarm` now needs the `[unreconciled_swap]` *kind*. `revenue-forced-alarm` waits `startedAt + ALARM_GRACE_MS + 60 s`. `judgeDas` needs a boolean `burnt`. `judgeAlarmPass` fails on exit 2/3 or on an unexplained CRITICAL. | **Yes.** Caveat: 22.2's explained list is only `revenue_ledger_unreadable`. Whether alarm pass 2 (after the rescue, the forced failure and the hand recovery) emits another CRITICAL by design is not visible from the bundle (`alarm.mjs` is not in it). If it does, 22.2 records FAIL, which is the safe direction. |
| V45-2 | `solanaArgv` with `--config`; `judgeArgv`; `judgeRpcArg` requires `box` on mainnet. | **Yes.** The config file is mode 600 and removed on `exit` (not on SIGKILL; still 600). |
| V45-3 | `judgeDeployKey` runs before each deploy. The throwaway `deployer` is the payer and upgrade authority. Only the recorded `--buffer` is closed. | **Yes.** |
| V45-4 | `rescue` and `revenue-forced-failure` are marked `resumable`, and `--resume` re-enters a step whose signature landed. | **Partial.** See finding **F46-1**: the repair covers 2 of 7 sites of the shape. See **F46-3** for a residue in `rescue` itself. |
| V45-5 | The done check counts closed cycles; `judgeRevenueCycles` judges by venue regardless of order. | **Yes.** |
| V45-6 | Preparation now runs before the deploys; `requiresVerified` gates the steps after `verify-configs`. | **The gate holds. The reorder introduced F46-2.** |
| V45-7 | `profile().rpc = rpcResolved`; the sweep-back title states what stays behind. | **Yes.** |
| V45-8 | 22.1 is recorded as "PASS at 5 vaults (scale not exercised)". | **Yes.** See the item-22 note under accepted-limits question 4. |
| V45-9 | SPEC 53 names `CBOB_REHEARSAL_NOTIFY`; the `rehearsal-tree.sh` echo is corrected. | **Yes.** |
| V45-10 | `sendRecorded` writes `pending*Sig` before sending. | **Yes.** See **F46-4** for the remaining manual edge. |
| V45-11 | `checkNewAddress` (fresh, landed or taken) with fresh-key rotation. | **Yes.** |

**The off-chain repairs V45o-1 to V45o-6** live mostly in files that are not in this bundle, so I cannot check them line by line. One part I could check: `refuseStrayOverrides` covers all four `REHEARSAL_OVERRIDES` names.

**Claims round 45 disproved, re-tested:**

- **MiMo's BURN `[129..133]` claim.** Disproved again. In the SPL Account layout, `close_authority`'s COption tag sits at byte 129. BURN checks `delegated_amount` separately, at 121–128.
- **Muse's 0.1-SOL funding claim.** Disproved again. web3.js turns the third `simulateTransaction` argument into `accounts.addresses`, so funding uses the simulated amount.
- **Qwen's MINT items.** Disproved again:
  - `waiting_to_join` is pure.
  - `crank_n` is bounded and `TooManyCranked` names `MAX_CRANK`.
  - `revenue_ata` is pinned to the ATA address.

**Round 41–45 classifications.** I re-read the 24 earlier findings' mechanisms. All are outside (a)–(d).

### F46-1 (LOW): V45-4's "safe resume" repair covers 2 of 7 sites of its shape

**Construct.** In `scripts/rehearsal-run.mjs`, `nextAction` returns `'stop'` for any step whose recorded signature *landed* while `done()` is false. It returns `'run'` only under `--resume`, and only for steps marked `resumable`. Only `rescue` and `revenue-forced-failure` carry `{ resumable: true }`.

The same shape exists at five more steps in `rehearsal-steps.mjs`: each sends through `send()` (which records the signature first) and decides `done()` from something the step finishes later.

| Step | Transactions | `done()` depends on | Is the run body idempotent on read-back? |
|---|---|---|---|
| `ceremony-collection` | 1 | `st.collection`, written *after* `sendWithInit` returns | yes (`checkNewAddress` returns `landed`) |
| `sale-round` | up to 5 (create, 3 votes, execute) | `round_id ≥ 1` | yes (checks the proposal and vote PDAs) |
| `deposit-activate` | 2 | the record is pending or active | yes (tops up only to the target) |
| `crack` | prior + redemption | the vault is burned | yes (re-plans) |
| `sweep-back` | about 9 | `st.sweptBack`, written last | yes (reads balances) |
| `revenue-cycle-n` | top-up, then the job | n closed cycles | mostly |

**What goes wrong.** If any of these has a landed transaction whose confirmation was lost (common on mainnet), every later run stops with "Never edit the state file by hand". There is no `--resume` route.

`ceremony-collection` is the worst case. The chain shows the collection exists, but `done()` reads driver state, so even the `mark` path never fires. Meanwhile SEAL is still uninitialised under the public seed-0x07 key. The read-back contains that exposure (a stranger's init means new ids), but the cost is a full redeploy.

**What an attacker or accident gains.** Nothing in value. On mainnet, though, the run wedges after value has moved:
- at `sweep-back`, SOL is stranded on throwaway keys;
- at `crack` or `deposit-activate`, tokens are in a vault.

That invites exactly the hand edit the driver forbids.

**Evidence if I am right.**
1. On the local proof, make `confirmTransaction` throw once after `sendRawTransaction` inside `send()` (a test seam) for the first `sale-round` send.
2. Rerun. Expect `STOPPED at sale-round: a recorded signature LANDED…` with no `--resume` hint.
3. `--resume sale-round` is then refused, because it is "no RESUMABLE step".

**Fix.**
- Mark every step whose run is idempotent on read-back as `resumable`.
- Make `ceremony-collection`'s `done()` chain-based: if `st.collectionKey`'s address is Core-owned and passes `readStep`, record it.
- Add a selftest arm that enumerates steps with more than one send, or with a state-written-after-send `done()`, and requires `resumable`.

### F46-2 (LOW, new, introduced by V45-6): the charter clock now starts before the five deploys, and nothing in the driver can restart it

**Construct.** `fill-values` sets `charter_opens_at = chainNow + 1800`, with `charter_secs = 1800`. It now runs before `fund-deployer` and `deploy-1..5`. Once it is `done`, `nextAction` returns `'skip'` without consulting `done()`, so it is never re-filled.

MINT `initialize` requires `charter_closes_at > Clock` (`require!(charter_closes_at > Clock::get()?…, BadCharterWindow)`). `claim_charter_vault` requires `now < charter_closes_at`. That leaves a hard budget of about 3,600 s, measured from `fill-values`, for:
- all five mainnet deploys (including a CLI retry after a failed buffer write, or an operator pause to investigate);
- the ceremony;
- three claims.

**What goes wrong.**
- **Deadline passed before `ceremony-mint`.** Its `sendWithInit` simulation throws `BadCharterWindow` before any signature is recorded. Status goes to `unknown`, `judgeSigs` returns `none-landed`, the step runs again and throws again, forever.
- **Charter window closes before `claim-3`.** The claim page refuses with "closed".

Neither path moves value, but the only recoveries are a hand state edit or a new rehearsal tree and redeploy. The local proof could not show this, because local deploys take seconds.

**Evidence if I am right.** In the local proof, insert a 3,700 s chain-clock wait between `deploy-5` and `ceremony-collection`. Every rerun reports `simulation refused: … BadCharterWindow` at `ceremony-mint`.

**Fix.** Fill every key before the deploys, but set the date in a separate step placed immediately before `ceremony-collection`. Alternatively, have `fill-values`' `done()` return false while MINT's config is absent and `charter_opens_at < now + 240`, and let the runner consult `done()` for that step. Add a selftest arm.

### F46-3 (INFO): `rescue`'s read-back misses one case, so it repeats a cycle

`st.nestedSent` is set only on the branch that sends the nesting transfer. If that transfer lands and its confirmation is lost:
1. `--resume rescue` sees owner = the nest PDA, skips the branch, lets the crank rescue it, returns it, and sets `st.rescued`.
2. `done()` requires `nestedSent`, so it fails and the runner throws.
3. A second `--resume` nests vault-3 again and repeats the whole rescue.

It is not a brick, but it is a wasted cycle and confusing evidence.

**Fix.** Set `nestedSent` whenever vault-3's owner is the nest PDA or the treasury.

### F46-4 (INFO): the scripted hand recovery cannot finish after a landed but unconfirmed hand swap

`handRecover` correctly refuses to swap again when `pendingSwapSig` has landed. It then throws "finish the return by hand". The `revenue-hand-recovery` step has no `rec.sigs`, so it re-runs and throws again. Item 22.4 can then only end with a fully manual return and split that the driver cannot record as PASS.

**Fix.** When `pendingSwapSig` has landed and `returnSig` is absent, read the operator's cbBTC delta against `operatorSatsBefore`, then continue with the return and split.

---

## R1. Custody

I found no path out of a sealed vault and no surviving emptied vault.

**Pairing.** SEAL walks forward and BURN walks backward, over top-level instructions only, binding account 0 (asset) and account 2 (owner) in both directions.
- Transferring the thawed vault to a new owner mid-transaction makes BURN's `asset_owner == owner` disagree with SEAL's owner binding, so the transaction reverts.
- Transferring it away and back is harmless.

**Emptiness proof.**
- A classic reserve ATA's owner *can* be changed with `SetAuthority`, but only by the PDA, so only during the thaw. BURN then refuses `ReserveNotOurs`.
- Dust at a T22 reserve address is System-owned and skipped correctly; a T22 ATA for a classic mint cannot exist (F4.2).
- An undeclared account never blocks. It is destroyed, which is stated limit 44.

**Lamports.** Only the owner composes the transaction, so nothing a stranger does can re-fund the PDA between the sweep and `burn_vault`.

## R1s. The sweep helper

- **(a) Who can call it.** It is reachable only through Core `ExecuteV1` by the owner, on a thawed vault (SR.5–5e). While sealed, Core refuses with 0x9 (3.7).
- **(b) Pair handling.**
  - A duplicate source: the second read sees owner = zeros, so `IllegalOwner` (SR.12a/12b).
  - A source that is also the destination: refused, because the destination owner must be `dest`, which is not the signer.
  - wSOL: transfer plus close works.
  - Odd account count: `NotEnoughAccountKeys` (SR.7). Zero pairs: lamports only (SR.13).
  - Another vault's PDA as destination is allowed. That only hurts the owner, who chose it.
- **(c) Destination checks.** The owner is the canonical destination and always exists. The rent rule is measured (R41.C8) and a non-System destination is fine (R27.S1).
- **(d) Lamports.** It moves exactly `signer.lamports()` read at execution.
- **(e) Interaction with BURN.** A closed account is skipped for the right reason. A missing reserve ATA is the stated item-42/50 obligation. I found no account a stranger can create that both blocks the burn and is unnameable.
- **(f) Packet fit.** S8.0 asserts 1,061 + 148 ≤ 1,232. The page adds strays only while they fit, then drops them. The in-line monthly run adds no accounts.
- **(g) Bytes.** The sweep's mainnet bytes are compared with `target/deploy`.

## R2 and R2b. The pool and the boost

**The invariant holds.** `credit` adds `delta·w ≤ avail·S`, so `ceil(owed′) ≤ ceil(owed) + avail = balance`. A claim reduces both owed and the balance by `pay` (in units of S). `retire` reduces owed only. `reweigh`, `join` and claim normalisation leave each vault's `owed_of` intact.

**Counters.**
- `pending_this_epoch ≤ pending_count` is preserved by `retire`'s epoch branch.
- Joins and expiries are free and need only record keys. A pending join needs no live token account.

So no one can make distributions or redemptions impossible. **A boost gets exactly N distributions** (consistent with BO.21 and BO.35). The ring cannot collide because the live end epoch is at most current + 63.

## R3. The level draw

- A–C lie within reveal + 208 < 300 < 512, so they are always still in SlotHashes when captured.
- FIFO order holds.
- A vault burned before its draw still takes it.
- The attribute hash is checked on reveal.

What a leader can influence is stated in limits 25 and 26. HOLDER-GUIDE says it truthfully.

## R4. Governance

I found nothing beyond limits 34, 35 and 47.

## R5. The charter claim

SPEC 46 is complete as far as I can find.

## R6. One-time configuration

Values that are wrong but accepted are guarded only by the launch checker (stated in A6). The royalty is immutable, as R.6, R.6a and R33.G3 show.

The rate limit is exactly a rolling window: the k-th most recent entry is `ring[head − k]`.

## R7. Cross-program raw reads

I recomputed every pinned offset in MintConfig (41, 141, 191–192, 257, 266, 274, 442, 454, 518, 526, 631, 639, 647, 711, 712), BurnConfig (42) and VaultRecord (41, 177, 186, 187). All are correct.

## R8. The suite, the simulation and the build

**Vacuous arms.** None found beyond X.7, which already says what it shows.

**Shipped bytes.** The four keyed programs' mainnet bytes are by design not the suite's bytes (fact 8).

---

## The accepted limits: four questions

1. **Is any limit worse than stated?** None.
2. **Is anything listed as a limit already closed?** None.
3. **Is any DISCHARGED item not actually discharged?** None.
4. **Is anything OPEN AND BLOCKING being quietly treated as accepted?**
   - **(INFO) Item 22's 2,100-vault scale has no exit.** The road has no step that runs the crank at scale before step 11, and the rehearsal record will read "PASS". Either add a synthetic-record scale run (the `tests/expiry-budget.mjs` pattern, 2,100 records, one injected RPC fault), or record a ruling.
   - **(INFO) SPEC item 53 is stale.** It still says the in-tree proof is "of `d57ee3a` and is STALE … why this item stays OPEN". Round 45's VALIDATION records it as re-proven at `e7c192a`. Update the item's text, and state what still keeps it open.

---

## What to do before launch that AI audit structurally cannot

1. **Sign one real redemption with Phantom on mainnet, with a $1 vault, before step 11.**
   - Phantom can append Lighthouse "guard" instructions to transactions it signs.
   - `signExact` refuses any message change. That is correct, but if Phantom alters messages, every opening on the page fails closed.
   - Only a real wallet run answers this.
2. **Get an independent verified build of all five programs from `0b3ddb3`**, for example through solana-verify or OtterSec's registry, rebuilt by someone other than this box. Then compare the on-chain hash after step 9 and again after step 11.
3. **Run the crank at scale on a local validator or devnet** before it pays anyone: 2,100 vault records, real RPC rate limits, and a fault injected at record 1,900.
4. **Treat the rehearsal as the only end-to-end proof of the revenue cycle** (items 22.3 and 22.4). Do not lock until both venues and the hand recovery show PASS with signatures.
5. **Hold keys cold where the rulings allow it.** Move the PoB update-authority wallet to cold storage or a multisig for the 7-day charter window (closes SPEC 46). Move the $CBOB release supply off the box (closes 56). Both are Gary's call, and both are cheap.
6. **Put real money behind outside review.** Fund a public bug bounty, escrowed, after step 10 and before announcing. Cap total value at launch with a small first round cap set by vote.
7. **Read the holder guide with someone who is not an engineer**, and change every sentence they misread.
8. **Set up a second, independent watcher** of the program hashes, Core's upgrade authority and the PoB collection, on a different box with different credentials. Same-box monitoring cannot see a box compromise (limit 10(3)).