# Round 27 programs audit: independent read of the whole v6 tree

**Method and limits.** I read the source, specs and tests only. I ran no validator, build, suite, simulation or fork, so every "verified" below means recomputed by reading, not measured. Where a claim needs a measurement, I name the evidence that would exist.

**Result.** I found no CRITICAL or HIGH defect in the five programs. Findings F1 and F2 are MEDIUM and LOW-MEDIUM: both are documentation understating what the code allows, not code defects. The remaining findings are LOW or INFO and concern documentation or evidence gaps. The most serious is F1, where an accepted limit is worse than stated.

---

## R0. Round 26's verdict against this tree

- **Quorum.** The verdict counted 5 of 8 and required 6, so the round was incomplete as well as not clean. The exclusions it gives (a stale Grok report, two provider-error reports) are consistent with the files: SR.12b, BO.38, S9b and S8.1a all exist in this tree. I accept the 0/2 clean counter.
- **Repairs present.**
  - C1: `stampCaps` with coherent two-account snapshots, plus RL.S1–S6.
  - C2: `LEVEL_CAPS=[21,21,21,21,21]` plus the P.2a bound.
  - C3: SR.12b checks that the duplicate-source refusal does not carry `CBOB_SWEEP refused: source`.
  - D1: the guide now says "minted during the vote".
  - D2: `rehearsal-tree.sh` now says six substitutions.
  - D3: SPEC states that an armed replacement has no apply-by deadline.
  - D4: item 42 is corrected.
  - W1: the owner-plugin reveal is exercised by R26.P1–P7.
- **Not repeated here.** I did not re-file any round-26 rejected claim.
- **Repair regressions.** None found by reading. C2's quota change is local to the test and does not touch production census values.

## R1. Custody

- **Pairing.**
  - SEAL scans forward from `current+1` for a burn matching asset and owner; BURN scans `0..current` for the open.
  - `retire_redeemed` requires stack height 2 and a top-level `burn_vault` whose account 0 is the burned asset.
  - A wrapper-CPI open fails at BURN (`NoPrecedingOpen`), because the top-level instruction is the wrapper's. WR.1–WR.4 cover the wrapper shapes.
  - I found no shape in which a thaw survives the transaction. `burn_vault` either burns through Core or reverts.
- **Emptiness proof.**
  - A closed classic token account is reassigned to System, so BURN's `owner != token program → continue` skip is correct for the right reason.
  - A Token-2022 ATA for a classic mint cannot be created. The probe measures `IncorrectProgramId`.
  - A stranger can create non-ATA token accounts for the vault, but BURN does not see them, so they are destroyed and cannot block a redemption.
  - Every reserve ATA must exist before the redemption lands (SPEC step 1). With the page's prior transaction, nothing a stranger can create blocks the burn.
- **R1s(a)–(g), the sweep helper.**
  - The helper's authority is entirely Core's `ExecuteV1` owner rule.
  - SR.5/5a/5c/5d plus R24.1/1a/1b/1c measure this.
  - A source owned by the signer and a destination owned by the single destination wallet with the same mint, together with `signer != dest`, rule out source-equals-destination aliasing.
  - A delegate on a source does not obstruct the owner's transfer or close.
  - A native wSOL source transfers and closes correctly by SPL semantics. No arm exercises it.
  - `lamports()` is read at execution, so BURN's `lamports == 0` check sees exactly what the sweep left.
  - The deployment-byte comparison in `build-mainnet.sh` (`dist` against the localnet rebuild and against `target/deploy`) is sound as written.
- **Packet (see also F6).** Both the base 1,061-byte shape and the widest 1,209-byte shape leave only about 23 bytes spare. A fourth reserve is impossible (`MAX_RESERVE_MINTS = 3`). The in-line monthly run adds no accounts, because the pool is already carried.

## R2, R2b. Pool and boost

- **Cross-program invariant, recomputed by reading.**
  - `credit` adds `delta·w ≤ avail·1e12` to `owed`, and `ceil(owed + b) ≤ ceil(owed) + avail`, so the pool stays at least `ceil(owed)`.
  - `claim` and `retire` keep it: a claim lowers the pool by `pay` and owed by `pay·1e12`, and a retire lowers owed by `pending`.
  - Per-vault owed is exactly `weight·acc + carry − debt`, and the suite's `ledger()` asserts that sum equals `owed_scaled`.
- **Counters under every host ordering.**
  - `pending_count` and `pending_this_epoch` are decremented consistently in `join` and `retire`. A request is made after the `monthly_inline` tick, so its epoch is read after the tick.
  - Every caller of `advance_epoch` (`credit`, `tick`) is gated by `boosts_due == 0`, so a ring slot is never shared by two live end epochs (`N ≤ 63`).
  - `unschedule_boost` takes the right branch for due and not-yet-due boosts.
  - Past epoch 64 the ring is exercised by the four-wrap host test and by BO.34/BO.38.
- **Liveness.**
  - Waiting vaults are joined by any `claim` that names them. The join path checks only `dest == vault_ata` and never reads the destination's existence or state.
  - Due boosts are cleared by `expire_boosts`, which needs only records.
  - I found no way to make distribution or redemption impossible for others beyond the already-accepted rate-limit spend and issuer freezes.
- **Coverage gap.** The pending-branch wrong-destination check in `claim` (`WrongVaultAccount`) has no negative arm. P.19 targets the active branch only.

## R3. Level draw

- **SlotHashes parse.** The parse is defensive: count bound, length check, key pin, zero-hash refusal. The smallest produced slot at or after `want` is final once found. The window arithmetic holds: C is at most about `reveal+208`, inside the 300-slot window and the 512-entry buffer.
- **FIFO and burned vaults.** FIFO is enforced by `index == revealed_total`. A burned head still draws, and the Core write is skipped.
- **Attribute hash.** The Borsh encodings of the stored and re-supplied lists agree.
- **Not worse than SPEC 25/26.** The leader of C chooses among many draws. Engineering a crank overload so that unwanted draws lapse (many vaults minted in one burst) is the "slow crank" case SPEC 25 already states. The minter additionally captures only the good draws, which is the same re-roll class.
- **HOLDER-GUIDE.** It states the validator choice and the lapse re-roll truthfully.

## R4. Governance

- **Execution and tally.**
  - The tally uses the snapshotted `quorum_supply`.
  - The key-change bar is ceil(50 %) of that snapshot.
  - Restart skips (`>=` in GOV, `<` in MINT) are consistent.
  - The `Proposal` space matches its fields.
- **Frozen forever.** F1 and F3 below describe how guardian replacement and operator replacement can become unreachable.

## R5. Charter claim

- **Verification checks.** I checked the Merkle domain separation and sorted pairs against `pob-merkle.mjs`, the owner and collection checks, extras passed as non-signers, and the "burn then create" order. All are sound.
- **SPEC 46 omissions (F5).** The PoB-side custody cases (marketplace escrow, frozen or delegated listings) are not listed.

## R6. One-time configuration

- **`launch/mainnet-init.json` against the `initialize` bounds.**
  - `sol_reserve ≥ RENT`
  - `reserve_ceiling ≥ sol_reserve`
  - `cooldown_ceiling ≥ cooldown`
  - `floor ≤ max_sweep`
  - `notice` and `monthly` in range
  - Caps sum to 2,100
- **Redemption cap.** The 64-slot ring is exactly a k-th-most-recent rolling window. When live supply grows, `k` grows and an older entry is used, which is the "cap in force at the last landing" rule SPEC states.
- **Royalty.** I found nothing in our programs that can touch the royalty plugin (authority None); Core refuses updates, as R.5–R.6c measure.

## R7. Raw offsets

Recomputed from the struct definitions:

| Structure | Offsets confirmed |
|---|---|
| MintConfig v6 | minted_total 141, bare 454, closes 442, stops 191/192/518/526, bounds 631/639/647, boost 711/712, config space 1,005 |
| VaultRecord v4 | asset 9, index 41, active 125, pending 177, boost 186/187, carry 195, space 221 |
| BurnConfig | burned_total 42, ring 59 |
| GovConfig | proposal_count 53 |
| SealConfig | collection 9, reserves 41 |
| Token account | 0 / 32 / 64 / 108 |

All agree with the Rust. I found no misread.

## R8. Evidence

- **Arms that cannot fail.** I found none.
- **Claims with no arm.**
  - The pending-branch `claim` wrong-destination check.
  - The helper with a wSOL source, a duplicate destination, or a stray whose destination is another vault's PDA. Safe by construction; only the reasoning is documented.
  - MINT's own `BoostTermsOutOfBounds` branch. GOV pre-checks, so MINT's copy is unreachable except by a direct call that fails on the signer instead.
- **`because()` pins.** Truncation of the recorded error to 260/600 characters can cause a false red but not a false green.

---

## Findings

### F1 (MEDIUM, accepted limit 47 is worse than stated). A stolen guardian key can strand all royalty SOL for good.

SPEC 47 says "no funds are lost". That holds for vaults and the pool, but not for royalty SOL.

- **Construct.** `sweep_sol_for_swap` is the only SOL exit from the `["revenue"]` PDA, and it is gated by `!sweep_stopped`. `emergency_stop_sweep` is idempotent and the guardian can re-pull it at will. A restart needs a 3-day vote at 21 % quorum.
- **Re-stop.** GOV skips a passed restart if the stop is not older than the proposal (3b.S1). A guardian that re-stops after each restart executes forces a new 3-day vote every cycle. Voters see the restart coming for days, and the operator's hourly cron cannot beat an adversary watching the chain.
- **Replacement.** Replacing the guardian needs YES from half of all live vaults at creation (`KeyChangeNeedsHalf`). That bar is unlikely to be met while some vaults are held by DAOs, in escrow, or lost.
- **Effect.** With the key stolen and turnout below 50 %, the 10 % royalty stream (8.5 % to holders) accumulates in the revenue PDA and never leaves. The sales stop likewise ends all new mint revenue.
- **Guardian key.** The guardian is the INIT wallet, "Gary's wallet / Phantom", a hot key (DESIGN ruling 4).
- **Guide.** HOLDER-GUIDE lists no guardian-key-theft entry. Its "who can do what" row says the guardian cannot "move any money" and "block its own replacement". Both are technically true and practically misleading.
- **Evidence that would exist.** On a validator: guardian stops the sweep; a restart proposal executes; the guardian stops again in the next transaction; the operator's sweep is refused. The suite has each component (6c.6, 6c.18, 3b.S1, 3b.S2), but not this sequence.
- **Fix.**
  1. Rewrite SPEC 47 and add a BUYER-FACING guide entry that says the royalty stream can be stranded indefinitely.
  2. Custody practice before init: the guardian should be a dedicated hardware or multisig-controlled key, not the day-to-day Phantom wallet. This is custody practice, not a change to the ruling "guardian can only stop".
  3. A code mitigation such as a stop that expires after N days would alter ruling 7. It is not recommended without Gary's decision, and it would have to be decided before the lock.

### F2 (LOW-MEDIUM, availability not in limit 10). Loss of the swap operator key also needs "half of all live vaults".

- **Construct.** Replacing the operator needs `ArmSwapOperator` plus YES from ceil(50 %) of the live snapshot, plus 7 days' notice. The guardian cannot install a key.
- **Effect.** If `bank/keys/swap-operator.json` is lost, royalty SOL stays stranded until half of all live vaults vote. Off-curve owners, escrow and lost keys count in the denominator but cannot vote (F3).
- **Evidence.** 3c.K2 shows a quorum-plus-turnout vote refused for lack of half. This is the same sequence applied to a lost operator rather than a malicious one.
- **Fix.** Add a "key loss" line to limit 10. Backing up the operator key, like the release wallet's nightly backup, is an operational control.

### F3 (LOW, not listed). Permanently unvoteable vaults inflate every governance bar.

- **Construct.** `quorum_supply = minted − burned − retired bare burns`. A vault with an off-curve owner (DAO, escrow, program) or a lost key can neither vote nor redeem, and no on-chain action retires it. Limit 43 covers redemption only.
- **Effect.** The 21 % quorum and 50 % key-change bars keep rising in relative terms as such vaults accumulate. No admin exists to lower them. The SPEC 47 / F1 permanence worsens accordingly.
- **Fix.** Document it next to limits 43 and 47. Nothing can be changed on chain.

### F4 (LOW, runtime-feature dependency, not in limit 40)

- **Construct.** All five programs are SBPFv3, and `run-tests.sh` deactivates SIMD-0500 and SIMD-0161 so v0 Core loads locally. The suite validator enables features mainnet may not have, and a mainnet that later disables v0 execution (SIMD-0161) would stop Core itself. All vaults would stay sealed until Metaplex redeploys.
- **Evidence.** The dress rehearsal must deploy the exact `.so` bytes to mainnet and run the full life there. A fork with all features on does not show it.
- **Fix.** Add this to limit 40 and to the guide's Core item. Make "SBPFv3 deployed and executed on mainnet" an explicit item-22 pass criterion.

### F5 (LOW, SPEC 46 incomplete)

SPEC 46 covers what the hot wallet and the plugins can do. It omits cases where no hostile party is involved and a holder still loses the claim:

- A Proof of Burn held in marketplace escrow or by an off-curve owner cannot be claimed (`owner == signer` fails).
- A listed PoB frozen by a marketplace delegate cannot be burned until delisted.

Both holders then keep only a "collectible" when the window closes (ruling). The holder guide warns about DAOs and multisigs for vaults but not for PoBs before the window.

### F6 (INFO, SPEC item 50)

- **Strays cannot be rescued before the thaw.** A prior transaction cannot sweep strays, because the vault is sealed until `open_for_redemption`. Any stray rescue must sit inside the redemption transaction, which has about 23 bytes spare in the widest padded legacy shape. In practice rescue means a v0 transaction with a lookup table (S9b proves two three-reserve redemptions that way) or giving up the padded shape. The wording "can be swept rather than destroyed" should say this.
- **No wallet-injection measurement.** No wallet or Lighthouse-style injection was measured.

### F7 (INFO, evidence gaps)

The R8 list above (pending-branch wrong destination; wSOL, duplicate-destination and other-vault-destination helper cases; MINT's boost-bounds branch). Each is correct by reading; no arm pins it.

---

## The four questions on the accepted limits

1. **Worse than stated.** Limit 47 (F1). Limit 10 as to availability (F2). Limit 44 and item 50 as to rescue needing v0 (F6). Limit 40 omits the runtime-feature dependency (F4).
2. **Listed but not a limit.** Limit 32's ring bound at live supply above 3,047 is unreachable, because supply is fixed at 2,100. Limit 28's sentence that anyone could provoke a freeze by sending tainted cbBTC is speculative.
3. **Discharged but not discharged.**
   - Item 54 is correctly discharged for the crank but still binds the pages (item 50).
   - Item 12/17's "byte wall binds first" is conditional on the padded-mint path and is stated as such.
   - I found nothing wrongly discharged.
4. **OPEN AND BLOCKING quietly accepted.** Items 22, 38, 50, 52 and 53 remain open in the road map, as does the rehearsal value set. None is quietly demoted. The guide's present-tense promises (deposit address, redeem-page check, announcements) still depend on item 50.

---

## What this project should do before launch that AI audit structurally cannot

1. **Mainnet reality gate.** Deploy the exact release bytes at throwaway IDs on mainnet and run the whole life with real Core, real pools and a real wallet. That checks v3 execution (F4), packet limits under actual wallet injection, and the lamports/rent behaviour mainnet differs on.
2. **Reproducible build by someone else.** Rebuild on a second machine from the release commit using the official verifiable-build container. Compare sha256 values with `dist/`. The current proof (one box, fixed path) shows that this box's two builds agree, not that anyone else's would.
3. **Property and model testing of the money code.** Random operation sequences against an independent accounting model, driven through the real programs: join, boost, expire, claim, retire (bare and redeemed), tick, with every host ordering. The invariants are `Σ owed == owed_scaled`, pool ≥ `ceil(owed)`, `ring + due == active`, `Σ weight == total_active_weight`. The suite checks them at fixed points, not over random orders. Add mutation testing of the programs and the test arms.
4. **A paid human adversary window.** A time-boxed, bounty-backed public review on the rehearsal deployment, with real Core and capped real value, ended before the lock. This is the only substitute for the human firm.
5. **Guardian and operator custody ceremony.** Move the guardian off the Phantom hot wallet to hardware or a multisig before `initialize` (F1). Back up the operator key (F2). Re-run `check-launch-params` against the signed transactions, not only the JSON.
6. **Core and cbBTC contingency.** Fix the decision rule now for the case that Core or the SIMD-0161 runtime change lands after the lock. State in plain text to buyers that nothing can be done afterwards, and keep the alarm's Core hash watch paged.
7. **Real-wallet redeem rehearsal.** Execute redemptions with the actual page code (v0 + lookup table) from Phantom and a hardware wallet, including a stray-token rescue and a frozen-pool case, before item 50 is accepted.