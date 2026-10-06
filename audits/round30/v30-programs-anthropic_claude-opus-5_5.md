# Round 30 Independent Audit: CBOB v6 (five programs and the bundled pipeline)

**Scope of what I could verify.** I read every file in the bundle against itself, against SPEC/DESIGN/HOLDER-GUIDE, and against the round-29 verdict. I executed nothing. Every claim below names the measurement that would confirm or refute it.

**What the bundle omits.** The bundle does not contain `bank/alarm.mjs`, `bank/revenue.mjs`, `bank/redemption-poster.mjs`, `bank/detectors.mjs`, `bank/selftest.mjs`, `bank/sigwalk.mjs` or `bank/crank.mjs`. Those files hold round 29's M1 repair. I cannot certify that repair, and I say so wherever it matters.

**Bottom line.**
- I found no on-chain path by which anyone other than the owner extracts value from a sealed vault.
- I found no path by which an emptied vault survives.
- I found no break of the invariant `pool ≥ ceil(owed)`.
- The findings concentrate in three places:
  - the evidence chain (which bytes were tested, which code was audited);
  - one cheap off-chain blinding class that generalises M1;
  - several accepted limits that are **closable before the lock**, which immutability makes the cheapest moment there will ever be.

---

## R0. Round 29's verdict, re-checked

| Round-29 item | My disposition |
|---|---|
| W1 (Opus CRITICAL, sweep destination not bound to owner) | **Agree: refuted.** BURN/SEAL never require the helper. The same owner-authorised `ExecuteV1` can call SPL Token directly. A key holder can simply transfer the vault (limit 41). A `dest == owner` check would control nothing. |
| M1 (truncated logs halt scanners) | **Real.** The reader side is visible and correct: `txread.mjs` refuses by default and flags on opt-in. **The consumer side (alarm, revenue, poster) is not in this bundle**, so the repair at all three sites is unverified by this round. See finding OC-1, which generalises it, and P-1 on why the gate cannot see this. |
| L1 (coverage gate scope) | **Partially repaired.** The script now enumerates `git ls-files` under the system directories, with named exclusions. The residual defect class is still open (P-1). |
| D1 (DESIGN `activate` text) | **Repaired.** DESIGN §3 now says "REQUESTS activation", and weight enters at the join. |
| D2 (orphaned activated vault dilutes forever) | **Text repaired.** The claim "nothing on chain can undo it" is false as a design statement. It is closable before the lock (Q2-c). It may also be avoidable for nested-in-live-host vaults (R1-H1). |
| A1 (Autograph FIFO halt) | Agree it is a measured bounded observation. I recommend the decoupling anyway, because the consequence class is permanent (Q2-a). |

I re-derived every raw offset and every space constant independently from the struct definitions (see R7). All match. There are no surviving offset defects.

---

## R1. Custody

**Pairing.**
- SEAL `open_for_redemption` scans top-level instructions after the current index for BURN `burn_vault`, with `accounts[0]==asset && accounts[2]==owner`.
- BURN scans `0..current` for SEAL `open` with the same binding.
- MINT `retire_redeemed` requires stack height 2 and a top-level `burn_vault` for this asset.

I tried the following shapes:
- a wrapper at either half (WR.1–WR.3 are measured);
- two vaults interleaved (each binds its own asset and owner);
- a transfer of the vault between open and burn (burn then fails `NotTheOwner`);
- a burn after a failed open (the transaction reverts).

None leaves a thawed vault unburned. A CPI'd `open` inside the host's `Execute` targeting a nested vault still needs a top-level `burn_vault` signed by a PDA, which is impossible.

**Emptiness.** I checked the delegate and close-authority offsets: 72..76 is the delegate tag, 121..129 is `delegated_amount`, and 129..133 is the close-authority tag (classic layout). They are correct. The Token-2022 ATA for a classic mint cannot be created; the probe measured `IncorrectProgramId` for all three mints. A pre-funded system account at a reserve ATA address is skipped for the right reason, and the ATA program still creates over it.

**R1-H1 (INFO, possibly positive; needs one measurement). Nested Core assets may be rescuable during the host's thaw.**

- **Construct.** During `open(HOST) … burn(HOST)`, the owner can `ExecuteV1(HOST){ Core TransferV1(INNER → owner) }`. INNER's owner is HOST's asset-signer, and Core's `Execute` signs as exactly that PDA. A vault's `PermanentFreezeExecute` gates `Execute`, not transfer.
- **Runtime question.** Core→Core is *direct* self-recursion, which the runtime permits.
- **Open question.** Does Core's `ExecuteV1` refuse an inner instruction whose program is Core itself?
- **If it lands:**
  - Items 9 and 44 and impossibility 3 overstate "destroyed / orphaned forever" for anything nested in a vault that has not yet been burned.
  - The redeem page should offer the rescue, as it does for stray classic tokens.
  - D2's dilution applies only after the host is burned.
  - The same thaw also lets the host owner cast one vote with each nested vault. That is harmless, since votes are bound to the asset.
- **Evidence.** In section 9, send `[open OUTER, Execute(OUTER){TransferV1(INNER→alice)}, sweep, burn OUTER]` and read INNER's owner afterwards. Either outcome should become a pinned assertion.
- **Fix.** Whichever result appears, record it and update SPEC 9/44 and impossibility 3.

**Answer to "any account a stranger can create that neither sweep nor BURN handles."** None.
- Classic reserve ATAs are created in the prior transaction, and nothing can remove them afterwards.
- Token-2022 reserve ATAs cannot exist.
- Non-ATA token accounts and Core assets are undeclared by construction. That is accepted limit 44.

---

## R1s. The sweep helper

**(a)** Only the owner can reach the helper while thawed. This is measured: SR.5, SR.5a and SR.5c show `NoApprovals`. While the vault is frozen, `Execute` is refused (3.7). The helper has no other entry with authority.

**(b)** Pair-list edge cases:

| Case | Behaviour |
|---|---|
| Duplicate source | First pass closes it, second refuses `IllegalOwner` (SR.12a/12b). |
| Duplicate destination | Fine. |
| Source used as destination | Impossible: `to_owner == dest != signer == src_owner`. |
| wSOL source | Amount transferred, then close returns the rest. |
| Close authority set | Only the vault itself could have set it, during a thaw. |
| Frozen account | Reverts (SR.14). |
| Odd account list | Refused (SR.7). |
| Zero pairs | Lamports-only sweep (SR.13). |
| Destination is another vault's asset-signer | Allowed. Funds move into a sealed vault the redeemer chose. Self-directed, not an attack. |

**(c)** Lamports sent to a non-System destination land (R27.S1). A lamport credit to a not-yet-existing destination below rent is refused, and the canonical destination (the owner) always exists.

**(d)** Closes credit the destination wallet, not the signer. `signer.lamports()` is read after all closes. No instruction inside the redemption the owner builds can add lamports. BURN's check sees exactly what the sweep left.

**(e)** See R1.

**(f) Packet.** S8.0 is 1,061 bytes, plus 52 bytes for compute budget and 96 for a separate payer, giving roughly 1,209 and leaving **23 bytes**. Two consequences that SPEC does not state:

- **R1s-I1 (INFO). Stray-token rescue does not fit the widest legacy shape.** Each extra pair adds at least 2×32 key bytes plus indices. So "offer to rescue stray CLASSIC tokens" (item 50) fits only if the page drops compute budget or the separate payer, or uses v0 with a lookup table. State this in item 50.
- **R1s-I2 (INFO). Wallet-injected instructions.** Some wallets append guard or assertion instructions, or rewrite compute budget. With 23 bytes spare, one injected instruction breaks the widest shape.
  - **Evidence.** Sign the S8 shape through Phantom, Ledger and the Gary Club custodial signer, and diff the signed message size.
  - **Fix.** Make the page detect an over-limit transaction and fall back to v0 with a lookup table (S9b proves v0 works).
- **R1s-I3 (INFO). Who receives the asset's burn refund.** With a separate fee payer, Core `BurnV1` refunds the asset's rent to `payer`, not to the owner. SR.4a's accounting holds only when owner == payer. The page contract should say who receives the asset's rent.

**(g)** SR.0–SR.14 and S8 are pinned to their reasons, except **S6.2**. S6.2 pins only "Core failed". It should pin `0x9` and assert the seal decodes frozen, as 3.7 does.

---

## R2 / R2b. Pool and boost

I recomputed the invariant symbolically.
- **`credit`.** `delta = ⌊avail·S/w⌋`, so `owed' ≤ owed + avail·S` and `⌈owed'⌉ ≤ ⌈owed⌉ + avail = bal`.
- **`claim`.** Subtracts exactly `pay·S` from `owed` and `pay` from the balance.
- **`retire`.** Removes exactly `pending`.
- **`join`.** Starts at zero owed.
- **`reweigh`.** Moves `owed` to `carry` and leaves the global total unchanged.

**The invariant holds.** No instruction other than `claim` moves tokens out of the pool, and cbBTC has no permanent delegate.

**Counters.**
- `pending_this_epoch` is decremented only for a current-epoch retire.
- `join` requires `dist_epoch > request_epoch`, so it never touches `pending_this_epoch`.
- Ring slot `(e+N) mod 64` is first reached at exactly epoch `e+N`, for any `N ≤ 63`.
- `unschedule_boost` picks the due branch or the ring branch correctly.

**Boost exactness.** The boost carries weight into credits e+1..e+N and becomes due at e+N. That is exactly N distributions. The in-line runs inside `boost_vault` and `claim` do not shift this (BO.21 and BO.35 cover both orders).

**Liveness.**
- `JoinWaitingFirst` is always clearable, because `claim` joins with only a key match, no read.
- `BoostsExpireFirst` is always clearable by `expire_boosts`, using records only.

**Minor gaps.**
- `MAX_EXPIRE_BATCH = 30`, but only 20 is measured (`tests/expiry-budget.mjs`).
- `expiry-budget` checks the counters but not that each record's `carry` equals its pre-expiry owed. Add `carry == 140·S` per record.

---

## R3. The draw

**Correctness.**
- `blockhash_in_window` returns the smallest ancestor in `[want, want+64]` and is final once found.
- The worst-case C lands at about reveal + 208, which is inside the 300-slot window and the 512-slot buffer.
- FIFO is enforced.
- A burned vault at the head of the queue still draws.

**Is SPEC 26 worse than stated?** Marginally. C's leader can also skip all four of its slots, passing C to the next leader's first slot. That adds a fifth option, but the leader cannot compute its result in advance. The numbers stated (best-of-4 gives 18.6%; 64 tries give 96%) are arithmetically right: 1−0.95⁴ and 1−0.95⁶⁴. The holder guide states it truthfully.

See Q2-a for the reveal's Core dependency.

---

## R4. Governance

These all check out:
- Snapshots: `index_snapshot` and `quorum_supply`.
- The ceiling-quorum arithmetic.
- The half-of-snapshot rule for key changes.
- Unbundling of guardian and operator changes.
- Per-kind marks, including the round-already-over case.
- Restart tie-breaking (`>=` in GOV mirrors `<` in MINT).
- CPI data encodings for all five actions, matched against the MINT signatures.

**No way for a minority to carry what it should not, beyond the stated concentration figures.**

**Limit 47 bounds.** Limit 47 is exactly as bad as stated. A captured guardian can also cancel every armed operator indefinitely, and with the sweep stopped royalty SOL accumulates without bound. It is stuck, not lost. That is already stated.

---

## R5. Charter

**R5-I1 (INFO, a SPEC 46 omission). More than eight approving hooks brick the claim.**
- **Construct.** `MAX_POB_EXTRA = 8`.
- **Effect.** If the Moments update authority adds nine or more *approving* Oracle adapters with burn checks, every claim bricks. "A benign or approving hook cannot brick the claim" is true only up to 8 hooks, and in the widest legacy shape only up to 4.
- **Fix.** State the 8 / 4 bounds in item 46 as part of the brick class, and alarm on any adapter count at or above 4.
- **Test gap.** No arm exercises `pob_extra` greater than 2. Add a measured claim at 8.

---

## R6. One-time configuration

**R6-I1 (LOW, process). Wrong `initialize` values can be fixed only until the lock.**
- **Problem.** Every wrong-but-accepted value is permanent *after the lock*, but steps 10 and 11 are separate. Between them the only remedy is a program upgrade, which means unaudited code, or new program IDs, which means a full rebuild.
- **Fix.** Make an explicit gate between road steps 10 and 11: read every config account byte-for-byte back against `launch/mainnet-init.json`, for all four configs, before removing the authority.
- **Reason.** `check-launch-params.mjs` judges the JSON, not the chain (item 38, A6).

**Swap operator worst case.** As stated in limit 10: cap × windows, at most the revenue balance above the reserve.

**Royalties.** Plugin authority `None`. R.8 refuses an owner-added asset-level override. MINT has no instruction that could touch the collection's plugins. Confirmed.

**Rate ring.** This is exactly a rolling window. For the window ending at insertion, count ≤ k, where k is the cap at that insertion.
- The 64-entry wrap at k = 45 is never exercised.
- Add a host unit test of the ring index `(head+64−k)%64` across several wraps at k ∈ {1, 2, 45, 64}.

---

## R7. Raw reads: recomputed

- **MintConfig.** governance 41, minted_total 141, sales_stopped 191/192, sol_reserve 257, max_sweep 266, cooldown 274, charter_closes 442, bare_retired 454, stopped_at 518/526, sweep_floor 631, cooldown_ceil 639, reserve_ceil 647, dist_epoch 655, cbob_mint 679, max_boost_w 711, max_boost_e 712..714, ring 749..1005. Space is 1005 + 256.
- **VaultRecord.** index 41, … carry 195..211. Space is 211 + 10 = 221.
- **BurnConfig.** burned_total 42.
- **GovConfig.** proposal_count 53.
- **SEAL.** collection 9, reserves 41.
- **Helper.** mint 0, owner 32, amount 64, length 165.

**All match.**

---

## R8. Evidence chain

**P-1 (LOW, but it is this project's most repeated defect class). The coverage gate measures "ever bundled", not "bundled at current content".**
- **Construct.** `scripts/audit-coverage.sh` diffs file *paths* against every `TARGETS` and `f()` entry in any `scripts/audit*.ts`. That includes prepared rounds that never ran.
- **Effect.** A file audited in round N and rewritten in round N+3 counts as covered.
- **Instance.** Round 29's M1 repair (`88acce2`) changed `alarm.mjs`, `revenue.mjs` and `redemption-poster.mjs`. None of the three is in this bundle, and the gate passes. This is the round-12 shape exactly: "the fix for a defect class had never itself been audited".
- **Evidence.** `git log --format=%h -1 -- bank/alarm.mjs` is newer than the last runner that bundled it, and the gate still exits 0.
- **Fix.**
  - Record a sha256 of each bundled file per runner, actually emitted when the prompt is rendered.
  - Require every file's current hash to appear in a round that *completed with quorum*.
  - Stop counting prepared runners.

**P-2 (LOW). Nothing proves the suite ran this commit's MINT, SEAL, BURN and GOV.**
- **Construct.** `scripts/build-mainnet.sh` `cmp`s only the sweep helper against `target/deploy`. For the other four, it prints the `target/deploy` hashes but never compares them with its own `$CACHE/ln` rebuild from `$COMMIT`.
- **Effect.** A stale `target/deploy`, for example from a `run-tests.sh` run on an earlier commit or a dirty tree, passes silently. `run-tests.sh` also never checks that the tree is clean.
- **Fix.** `cmp "$LN_DIR/$f.so" "$ROOT/target/deploy/$f.so"` for all five programs, and record the commit at which `run-tests.sh` built.

**P-3 (LOW, recommended). Run the suite against the shipped binaries.**
- The four shipped binaries are never executed beyond the init-authority probe.
- **Fix.** Use the technique `tests/expiry-budget.mjs` already uses: write valid initialized configs into genesis with `--account`. Then run the post-init paths (mint, charter, reveal, activate, claim, redemption, vote, execute) against the actual `dist/*.so`.
- This makes "the tested bytes are the shipped bytes" true for all five programs, not only the helper.

**P-4 (INFO). Lock the `localnet` feature to its two known sites.** `build-mainnet.sh` checks that the non-localnet `INIT_AUTHORITY` block exists. It does not check that `feature = "localnet"` appears *only* there. Assert exactly 2 `cfg(...localnet...)` sites per program, so a future localnet-only constant cannot ride into untested mainnet bytes.

---

## The four questions about accepted limits

**Q1. Worse than stated?**
- Limit 9 / item 44 / D2: possibly *better* than stated (R1-H1).
- Item 46: see R5-I1 (the 8/4-hook brick).
- No other limit is worse than written.

**Q2. Listed as limits but closable before the lock** (cheap now, impossible after):

- **(a) LOW. One Core byte-format dependency, in our own code, causes two permanent failures.**
  - **Construct.** `retire_redeemed` requires `is_burned` (Core-owned, 1 byte, key 0).
  - **First failure.** If Core changes its tombstone, every redemption reverts and all Bitcoin is sealed forever (item 40).
  - **Why the check is redundant here.** `retire_redeemed` is reachable only as a direct CPI from BURN's `burn_vault` for this asset, which calls it only after Core `BurnV1` returned Ok.
  - **Second failure.** In `reveal_level`, a non-tombstone burned asset fails `WrongAsset` and halts the FIFO forever.
  - **Fix.** In both places, accept "not a live `AssetV1` of this key" (owner ≠ Core, or empty data, or key ≠ 1) as burned. Keep positive identification only in permissionless `retire_burned`.
  - **Residual.** Core *interface* changes to BurnV1, ExecuteV1 or UpdatePluginV1 still break everything. This removes one avoidable mode, not all of them.
  - **Additional recommendation (owner decision).** Separate "record the level" (FIFO, which payouts read from the record) from "write the attribute onto the asset" (a retryable instruction outside the FIFO). A Core heap or interface failure would then cost cosmetics, not every later vault's activation.

- **(b) INFO. Off-curve owners (item 43) can be refused at mint.** Item 43 already names the top-level stack-height check. It is an owner decision.

- **(c) LOW. D2 orphans can be retired.** "Can never be redeemed nor retired" describes the current program, not a limit. The orphan condition is provable on chain:
  - for a self-owned vault, `owner == PDA("mpl-core-execute", asset)`;
  - for a nested vault, `owner == PDA("mpl-core-execute", host)` and `host` is burned.

  A permissionless `retire_orphaned` would remove the permanent dilution of every other vault.

**Q3. DISCHARGED items not actually discharged.** None found.
- Item 54's crank conclusion depends on `bank/crank.mjs` sending captures alone. That file is unbundled, so I take it on the record.

**Q4. OPEN AND BLOCKING items treated as accepted.**
- **Item 53's rehearsal proof** is stale. It was refreshed at `88acce2` for the patch, but the *full suite inside the rehearsal tree* was last proven at `d57ee3a`.
- **Item 22 (no live distribution or revenue cycle)** is correctly open.
- **The M1 repair** is effectively being treated as done without any auditor having read its consumers (P-1).

---

## Off-chain (from the bundled reader only)

**OC-1 (MEDIUM, conditional; confirm in the unbundled alarm, sigwalk and revenue). A stranger can still blind the scanners by volume.**
- **Mechanism.** M1 fixed the *truncated* variant. The general shape remains: anyone can name MINT or the revenue address as an unused account in a successful 5,000-lamport transaction, and it enters every signature walk. Each one costs a `getTransaction`.
- **Exposure one: page limit.** If `sigwalk` reports `gap` past `maxPages` (the probe uses 20 pages, about 20,000 signatures, roughly 0.1 SOL per pass), and the alarm treats a gap or an unfinished pass as "keep every cursor", then about 5 SOL a day blinds every detector.
- **Exposure two: unbounded growth.** A truncated flood grows `logGaps` without bound and emits one HIGH page each.
- **Evidence.**
  - On a local validator, send 25,000 such transactions naming MINT.
  - Run the extracted alarm walk.
  - Measure: completion within the cron and flock interval, cursor progress, state size, and the number of notifications sent.
- **Fix.**
  - Advance the cursor per processed signature, not all-or-nothing.
  - Cap and aggregate gap pages per pass.
  - Bound `logGaps`.
  - Page a distinct `walk_flooded` once.
  - Prefer account-state diffs for money detectors.

**OC-2 (INFO). `txread.mjs` detects truncation by matching an exact log string.**
- **Construct.** Truncation is detected only by `logMessages.includes('Log truncated')`. If Agave changes that marker, truncated logs are accepted as complete. That fails *open*.
- **Fix.** Add a structural check: every top-level `invoke [1]` of one of our programs must have its matching `success` or `failed` line. Otherwise treat the transaction as truncated.

---

## Documentation errors (measurable arithmetic)

- **Record rent figure (INFO).** VaultRecord rent "2,429,040 lamports" (SPEC 49, DESIGN §3) is the *test-validator* rate: (221+128)·6,960. At the mainnet rate SPEC itself uses, (165+128)·5,080 = 1,488,440 for a token account, a record costs (349)·5,080 = **1,772,920**.
- **Drain time (INFO).** DESIGN §8: "45/hour, ~47h to drain". The cap shrinks as live supply falls, so the decay is geometric. It takes about 180 h to fall from 2,100 to 47 live vaults, then about 47 h more at a cap of 1. That is **about 9.5 days**, not 47 h. The real figure is safer than stated, but the stated figure is wrong.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run the shipped bytes.** Execute the post-init suite against `dist/*.so` with genesis-written configs (P-3), and link `target/deploy` to the commit (P-2). Today no assertion has ever executed the four mainnet binaries.
2. **Hash-pin the audit record (P-1).** Refuse the freeze unless every current file's sha256 was read in a completed, quorum-met round.
3. **Make one live, adversarial measurement of each external assumption, on mainnet with small funds, at the rehearsal IDs:**
   - Core `ExecuteV1`→Core transfer (R1-H1);
   - wallet-injected bytes on the real redeem transaction, signed by the real target wallets (R1s-I2);
   - DAS `burnt` (item 22.5);
   - a signature-walk flood against the real RPC provider's rate limits (OC-1).
4. **Run a key ceremony with a second human, and a written transcript.** INIT_AUTHORITY, the guardian and Gary's Phantom are one hot wallet. The Moments update authority is hot through the charter window, and that window can end the project (46). Move both to hardware or a multisig for the window. That is a ruling to revisit, not a code change.
5. **Read back on chain between initialize and lock (R6-I1),** byte-for-byte against `mainnet-init.json`, signed off by someone who did not build the transactions.
6. **Run a bounded pre-lock bug bounty on the rehearsal deployment** with real stakes (for example, a funded vault anyone may try to drain). AI rounds reason over a bundle. A bounty hunter executes against a live cluster, and that is the only test of the "no key can unseal" claim that is not authored by this project.
7. **Decide the closable limits now:** the tombstone relaxation (Q2-a), decoupling the reveal from Core, `retire_orphaned` (Q2-c), and the top-level mint check (item 43). After the lock, each of these becomes a permanent accepted limit by default rather than by decision.

**Result.**
- On-chain: 0 CRITICAL, 0 HIGH. 3 LOW (Q2-a, Q2-c, R6-I1), plus INFO items.
- Evidence chain: 3 LOW (P-1, P-2, P-3).
- Off-chain: 1 MEDIUM, conditional and unconfirmable from this bundle (OC-1).
- **Not clean.** P-1 alone means round 29's repair has no audit on record.