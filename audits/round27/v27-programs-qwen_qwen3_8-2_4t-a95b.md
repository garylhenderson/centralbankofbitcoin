

## Audit stance and summary

I read the bundled tree as delivered and treated the prior round as evidence, not authority. I did **not** independently execute the full 844-assertion validator suite in this pass; where I rely on suite behavior I say what observable test/on-chain evidence would confirm or refute it. I did manually recompute the cross-program layouts and offsets from the Rust structs.

I did **not** identify a surviving **CRITICAL** or **HIGH** on-chain theft/unseal defect in the five programs from this read. That is a negative result from this pass, not a certification. I did identify one **HIGH process** problem: the prior round cannot be counted as clean and its quorum was not met. I also identified several **LOW** code/evidence/documentation defects that should be repaired before the freeze is claimed clean.

---

# R0. Round 26 verdict and repairs

## F-R0-1 — HIGH (process): Round 26 is neither clean nor quorate; it cannot count toward the two-clean-round gate

**Construct:** `audits/round26/VERDICT-programs.md`, `audits/round26/VALIDATION.md`.

**What is wrong:** The programs pass verdict explicitly states counted auditors were **5 of 8**, required quorum **6**, and that Grok, DeepSeek, and Claude Opus 5 were excluded. It also states: “Repaired findings do not retroactively make this round clean.” The validation file repeats that repairing does not clear the round. Therefore the consecutive-clean-round counter must remain **0/2**.

**Gain/accident:** If this round is treated as one clean round, the ship gate can be advanced on a non-quorate, non-clean audit. With immutable programs, that is how a surviving bug becomes permanent.

**Evidence if true:** The verdict files themselves say it. Any freeze log or road-map claim counting round 26 as clean would contradict them.

**Fix:** Run the required next rounds against the repaired frozen tree with a counted quorum and different rosters. Do not remove upgrade authority until two consecutive clean, quorate rounds exist against the exact frozen commit.

## Repair verification from round 26

I checked the current tree for the seven confirmed round-26 topics. I found the repairs present in source:

1. **C1 cap-stamp coherence** — `tests/3prog.test.ts` now uses `getMultipleAccountsInfo([MINT_CFG, BURN_CFG])` for snapshots and `stampCaps()` enforces monotonic counter bounds, ambiguity refusal, and conflicting-stamp refusal. `RL.7` uses only stamped caps.  
   *If repair were absent:* `RL.7` could replay with an overstated cap and still pass.

2. **C2 five-level fixture bound** — local census is now `[21,21,21,21,21]`, total 105, and `P.2a` asserts excluded fixtures ≤ 20 and minimum quota > excluded.  
   *If repair were absent:* `P.11a` could fail on a valid random draw.

3. **C3 duplicate-source reason specificity** — `SR.12b` asserts the duplicate-source refusal did **not** hit the first-pair source-owner message.  
   *If repair were absent:* `SR.12a` could pass for the wrong pair.

4. **D1 holder-guide “sold during vote” wording** — current guide says “vaults minted during the vote cannot vote on it,” which matches GOV’s `index_snapshot` rule.  
   *If repair were absent:* guide would still imply secondary-sale exclusion.

5. **D2 script count comments** — `scripts/rehearsal-tree.sh` now says five IDs plus root = six substitutions; `scripts/run-tests.sh` header names four vault programs and the sweep helper.  
   *If repair were absent:* comments would still say four/five incorrectly.

6. **D3 pending replacement has no apply-by deadline** — SPEC now explicitly says an armed replacement has no apply-by deadline and describes supersession/cancellation.  
   *If repair were absent:* SPEC would still understate the pending window.

7. **D4 limit 42 ATA-create byte claim** — the accepted limit now records the 1,219-byte narrow helper shape with three creates and says the old categorical claim was false.  
   *If repair were absent:* SPEC would still claim only two creates can ever fit.

I did not find a surviving instance of those seven topics in the current source.

---

# R1. Custody / seal-burn pairing

No new CRITICAL/HIGH custody defect found. I specifically re-checked:

- SEAL only thaws when a later top-level `burn_vault` for the same asset and owner exists.
- BURN only burns when an earlier top-level `open_for_redemption` for the same asset and owner exists.
- Both bind asset and owner by account index 0 and 2.
- `load_instruction_at_checked` is top-level only; CPI wrapper attacks are refused by stack-height and top-level pairing.
- A failed burn after open reverts the whole transaction, so no thawed vault can survive.
- Two redemptions in one transaction cannot borrow each other’s open/burn because both halves bind asset and owner.
- BURN’s emptiness proof requires `asset_signer.lamports() == 0`, declared reserve ATAs, no delegate/close authority, no Token-2022 extensions on declared token accounts, and no declared live Core asset.

One observation, not a theft path: BURN’s delegate/close-authority checks test the COption tag bytes, not every pubkey byte. That is sufficient because a nonzero tag is caught. No finding.

---

# R1s. Sweep helper

## F-SWEEP-1 — LOW: helper does not validate that the lamport destination can receive a System transfer

**Construct:** `programs/cbob-vault-sweep/src/lib.rs`, final lamport sweep:

```rust
invoke(&system_instruction::transfer(signer.key, dest.key, lamports), ...)
```

**What is wrong:** The program checks `signer.key != dest.key`, but it does not check that `dest` is a System-owned, data-empty account. `system_instruction::transfer` will fail if the destination is not a valid System recipient. A redemption client that names a token account, program account, or other non-System destination wallet can make the lamport sweep fail and revert the whole redemption.

This is not a non-owner theft path: Core `ExecuteV1` still requires the asset owner. It is a liveness/self-footgun defect, relevant because the helper is permanent and the redeem page is not built yet.

**Gain/accident:** A bad page or manual client can block a redemption by choosing a destination wallet that cannot receive System lamports. If the destination is another vault’s asset-signer PDA, lamports may be moved into that vault, where they become subject to that vault’s seal.

**Evidence if true:** A local-validator arm with a zero-pair or normal sweep where `dest` is an initialized SPL token account owned by the redeemer would fail in the System program, not in the helper’s own checks. The vault would remain sealed and funded. No current arm exercises this branch.

**Fix:** In the helper, require:

```rust
if *dest.owner != system_program::ID || !dest.data_is_empty() { return Err(ProgramError::InvalidAccountData); }
```

Optionally require the destination to be rent-exempt or already existent. Add suite arms for:
- destination is a token account;
- destination is a program-owned PDA;
- destination is another vault asset-signer PDA;
- destination below rent exemption with zero pairs.

---

# R2. Community pool money

## F-MINT-1 — LOW: `activate` ignores token-account freeze state, allowing a frozen vault account to join and dilute the schedule

**Construct:** `programs/cbob-vault-mint/src/lib.rs`, `activate`:

```rust
let (amount, _) = read_token(&ctx.accounts.vault_token, &payment_mint, &signer)?;
require!(amount >= ACTIVATION_SATS, MintError::BelowActivation);
```

The second tuple element is the token-account state, and it is discarded.

**What is wrong:** cbBTC has a live freeze authority. If a vault’s cbBTC ATA is frozen **before** activation, `activate` still accepts the balance and lets the vault request/join the payout schedule. Once joined, the vault’s weight enters `total_active_weight`, distributions credit it, `claim` defers payment while frozen, and redemption is blocked while the reserve account is frozen. If the freeze is long-lived or permanent, this creates dilutive weight and owed balances that cannot be delivered or redeemed.

This is incremental to accepted limit 28. Limit 28 states a frozen vault account defers claims and blocks redemption; it does not state that a frozen, unactivated account can be permissionlessly activated and made permanently dilutive.

**Gain/accident:** No direct theft. A stranger can activate a frozen vault without the owner’s consent. Other holders receive a smaller share of future distributions while the frozen vault remains on the schedule. If Coinbase freezes an account permanently, that weight and its owed share may remain forever.

**Evidence if true:** On a local validator with a freeze-authority mint standing in for cbBTC:
1. Fund a vault ATA with ≥ 21,000 units.
2. Freeze that ATA.
3. Send `activate`.

Current code should emit `ActivationRequested` and increment `pending_count`. There is no suite arm that freezes before activation; `P.18` freezes an already-active vault.

**Fix:** In `activate`, require:

```rust
let (amount, state) = read_token(...)?;
require!(state == TOKEN_STATE_INITIALIZED, MintError::VaultAccountMissing);
```

Add suite arms:
- frozen ATA before first activation is refused;
- thawed ATA then activates;
- frozen ATA after activation remains accepted limit 28, but should be explicitly documented.

---

# R2b. $CBOB boost

I did not find a surviving boost-accounting defect. I re-read the ring, `advance_epoch`, `unschedule_boost`, `reweigh`, `expire_boost`, `retire`, and claim normalization. The invariants that matter appear to hold:

- A boost is scheduled at `end_epoch = dist_epoch + epochs`.
- `advance_epoch` moves scheduled expiries into `boosts_due` and zeroes that ring slot.
- `BoostsExpireFirst` blocks distributions while `boosts_due > 0`.
- `expire_boost` and `claim` only expire when `dist_epoch >= boost_end_epoch`.
- `retire` unschedules boosts from either `boosts_due` or the future ring slot depending on due state.
- `reweigh` moves the vault’s existing owed share into `carry_scaled` and resets `debt_scaled`, preserving the pool’s owed total across weight changes.
- The host test and suite BO arms cover wrapped ring indices, early retirement, due retirement, frozen-destination expiry deferral, and terms movement.

One design observation, not a code defect: `set_boost_terms` has **no upper bound on price** except `price > 0`. Weight and epochs are bounded by `max_boost_weight` and `max_boost_epochs`; price is not. This is consistent with the ruling that a vote may set any positive price, but holder-facing copy should not imply a fixed launch bound on price. See accepted-limits section.

---

# R3. Level draw

No new defect beyond accepted limits 25 and 26.

I checked:

- `blockhash_in_window` parses the SlotHashes sysvar defensively, bounds count to 512, rejects truncated data, rejects all-zero hashes, and selects the smallest produced slot in `[want, want + 64]`.
- `try_capture` requires three hashes A/B/C with B and C two leader groups after the previous group.
- Capture is idempotent and refuses after capture.
- Reschedule is only allowed after the window has passed and moves to a future slot.
- Reveal is strictly FIFO by `mint_index == revealed_total`.
- Burned vaults still take a draw so the FIFO cannot stop at a burned head.
- Attribute re-supply is hash-checked for live assets.

Minor observation, not worth a formal finding: an all-zero slot hash in the qualifying window causes `BadSlotHashes` rather than being skipped. If such a hash ever occurred, capture would fail until the window lapsed and reschedule became possible. This is fail-closed and practically impossible.

---

# R4. Governance

No minority-carry or money-reach defect found beyond the documented concentration facts.

I checked:

- Proposal creation snapshots `quorum_supply = minted_total - burned_total - bare_burns_retired` and `index_snapshot = minted_total`.
- `VaultTooNew` prevents vaults minted after proposal creation from voting.
- Quorum, threshold, 10% YES turnout, and 50% YES key-change checks use the snapshot divisor with ceiling division and nonzero requirements.
- Guardian change and swap-operator arm cannot share a proposal.
- Key-change detection includes `Brakes { set_guardian: true }` and `ArmSwapOperator`.
- Overtaken actions are skipped and logged, not reverted.
- `last_round_id` moves even when the newer round is already over, preventing an older round from reviving.
- Restart skip in GOV matches MINT’s `StopIsNewer` tie rule.
- Tighten proposals are checked at creation for strict tightening and fixed bounds, and MINT re-applies monotone max/min at execution.

One documentation point: because `SetBoostTerms` has no price ceiling, holder copy should be precise that the fixed launch bounds apply to extra weight and number of payouts, not to price.

---

# R5. Charter claim

No new defect found. The claim:

- verifies PoB ownership from raw Core asset bytes;
- verifies PoB collection;
- verifies Merkle membership against `pob_root` with leaf/node domain separation and sorted pairs;
- burns the PoB by CPI in the same instruction;
- passes up to 8 extra accounts to Core burn, never as signers;
- is gated only by the immutable charter window, not by the guardian stop.

The hot-wallet exposure of the Moments collection is already stated in accepted limit 46. I did not find an additional capability for that key in the pinned Core behavior described by the suite. The alarm-sampling gap and individual-asset-plugin gap remain as stated.

---

# R6. One-time configuration and trusted hop

No new on-chain defect beyond the already-open initialization item 38 and accepted trusted-hop limit 10.

Specifically:

- MINT initialize checks the init authority, boost mint owner/length/initialized, boost bounds, treasury non-default, notice bounds, tighten bounds, sweep bounds, level caps, charter window, PoB root, monthly period, collection cleanliness/ownership/unminted state, SEAL wiring, and payment-mint reserve membership.
- It does **not** check all semantic facts a launch checker must pin, e.g. payment-mint decimals, cbBTC freeze authority, CBOB mint authority absence, reserve distinctness, or off-curve role suitability. That gap is explicitly item 38: the checker validates JSON, not the signed transaction. This remains OPEN AND BLOCKING.

The redemption cap ring is correctly a rolling window over 64 timestamps:

- `k = max(1, min(cap, 64))`;
- it checks the k-th most recent timestamp is at least `redeem_window_secs` old;
- it then writes current time and advances head modulo 64.

No off-by-one found.

---

# R7. Cross-program raw reads

I recomputed the layouts from the Rust structs and found the pinned offsets consistent.

Key MintConfig offsets:

- disc 0..8
- version 8
- collection 9..41
- governance 41..73
- pool_ata 73..105
- round_id 105..109
- price 125..133
- minted_total 141..149
- max_supply 149..157
- bank_treasury 157..189
- split_bps 189..191
- sales_stopped 191
- sweep_stopped 192
- guardian 193..225
- swap_operator 225..257
- sol_reserve_lamports 257..265
- max_sweep_lamports 266..274
- sweep_cooldown_secs 274..282
- charter_closes_at 442..450
- bare_burns_retired 454..462
- total_active_weight 462..470
- active_count 470..478
- acc_scaled 478..494
- owed_scaled 494..510
- last_distribute_at 510..518
- sales_stopped_at 518..526
- sweep_stopped_at 526..534
- pending_swap_operator 534..566
- pending_swap_operator_at 566..574
- monthly_secs 574..582
- pending_guardian 582..614
- pending_guardian_set 614
- pending_guardian_at 615..623
- notice_secs 623..631
- sweep_floor_lamports 631..639
- cooldown_ceiling_secs 639..647
- reserve_ceiling_lamports 647..655
- dist_epoch 655..663
- pending_count 663..671
- pending_this_epoch 671..679
- cbob_mint 679..711
- max_boost_weight 711
- max_boost_epochs 712..714
- boost_price 714..722
- boost_weight 722
- boost_epochs 723..725
- boosts_active 725..729
- boosts_due 729..733
- boost_weight_total 733..741
- cbob_burned_total 741..749
- boost_expiring 749..1005

VaultRecord offsets:

- version 8
- asset 9..41
- mint_index 41..49
- reveal_slot 49..57
- level 57
- charter 58
- entropy_set 59
- entropy 60..92
- attrs_hash 92..124
- bump 124
- active 125
- retired 126
- reschedules 127..129
- vault_ata 129..161
- debt_scaled 161..177
- pending 177
- request_epoch 178..186
- boost_weight 186
- boost_end_epoch 187..195
- carry_scaled 195..211

BurnConfig offsets:

- version 8
- collection 9..41
- bump 41
- burned_total 42..50
- redeem_window_secs 50..58
- rate_head 58
- rate_ring 59..573

SealConfig offsets:

- version 8
- collection 9..41
- reserve_mints Vec length 41..45
- reserve keys 45 onward

Sweep helper token offsets are also correct for classic SPL accounts: mint 0..32, owner 32..64, amount 64..72, length 165.

No offset mismatch finding.

---

# R8. Suite, simulation, build evidence

## F-R8-1 — LOW: unexercised branches relevant to new findings

**Construct:** `tests/3prog.test.ts`, `sim/test-vault.ts`.

**Missing arms:**

1. **Activate with a frozen vault ATA before activation** — needed for F-MINT-1. Current `P.18` freezes after activation; no arm freezes before `activate`.
2. **Sweep helper with a non-System destination wallet** — needed for F-SWEEP-1. Current arms use owner EOA destinations.
3. **Sweep helper duplicate destination** — duplicate sources are tested; duplicate destinations are not.
4. **Sweep helper native wSOL source** — accepted limit 44 says classic stray tokens can be rescued, but wSOL behavior is not exercised.

**Gain/accident:** A branch can remain untested and later be assumed covered. With immutable programs, that is how evidence gaps become permanent.

**Evidence if true:** Adding the arms would either pass and pin the behavior, or expose the defects above. The current suite has no rec IDs for these shapes.

**Fix:** Add arms and move assertion floors in the same commit. For each negative, pin the rejecting program and reason.

## F-SCRIPT-1 — LOW: mainnet probe imports web3.js from an absolute path outside the repo

**Construct:** `scripts/probe-mainnet-facts.mjs`:

```js
import { PublicKey, Connection, ... } from '/opt/gary-club/node_modules/@solana/web3.js/lib/index.cjs.js'
```

**What is wrong:** The probe is part of the ship gate, but this import bypasses the repo’s dependency resolution and lockfile. A version drift or replacement in `/opt/gary-club/node_modules` can change probe behavior without changing the audited tree.

**Gain/accident:** Accidental version mismatch or malicious replacement could make mainnet-fact assertions false-pass or fail for wrong reasons.

**Evidence if true:** Run the probe with instrumentation or `node --require` hooks to print the resolved web3.js path/version. Compare with the repo lockfile. If the path is outside the repo, the gate is not tied to the repo’s pinned dependency.

**Fix:** Import `@solana/web3.js` through normal package resolution from the repo, pin the version in `package.json`/lockfile, and make the runner fail if the resolved path is outside the repo. Alternatively vendor the dependency with a committed hash.

---

# Accepted limits: the four required attacks

## 1. Is any accepted limit worse than stated?

### Limit 28 — Coinbase freeze: incrementally worse than stated

Accepted limit 28 covers frozen vault accounts deferring claims and blocking redemption, and frozen pools causing forfeiture. It does **not** cover F-MINT-1: a frozen, unactivated vault ATA can still be activated, adding weight and owed balances that may remain permanently undeliverable. This is not theft, but it is a worse dilution/liveness consequence than the limit states.

### Limit 42 — prior ATA creation: not worse after repair

The old categorical “only two fit” claim was false after the helper reduced bytes. The current limit correctly records the narrow 1,219-byte shape and still requires prior preparation for the fully padded page shape. No worse-than-stated issue found.

### Limit 40 — Core upgradeability: not worse from this tree

The code’s dependence on Core’s `ExecuteV1`, tombstone format, and `UpdatePluginV1` is as stated. The source-versus-pinned-binary gap remains as stated. I did not find an additional unlisted Core dependency.

### Limit 46 — PoB hot wallet: not worse than stated

The root-by-address defense, oracle pass-through, and positive bounds on transfer/burn are as stated. The alarm sampling gap and individual-asset plugin gap remain as stated.

### Limit 47 — stolen guardian: not worse than stated

The guardian cannot cancel its own replacement, cannot install anyone, and can re-stop after restarts. Permanent stop at insufficient turnout is as stated.

## 2. Is anything listed as a limit not actually a limit, or already closed?

### Limit 44 — undeclared airdrops: narrower than the broad wording for classic tokens

The helper can rescue **named classic SPL token accounts** owned by the vault PDA, ATA or not, if the destination account exists. The limit remains real for Token-2022 accounts, frozen accounts, nested Core assets, and unnamed classic accounts. It should not be read as “all classic airdrops are always destroyed”; they can be swept if the client names them.

### Limit 42 — old “only two fit” claim was not actually a limit

Round 26 D4 corrected this. The page-preparation obligation remains, but the categorical impossibility of three creates in the narrow shape was false.

### Discharged item 33 — replacement notice exercised

The notice period is an initialize parameter and the suite exercises successful apply and early refusal. I found no reason it is not discharged.

## 3. Is any discharged item not actually discharged?

I found none.

Specifically:

- **Item 51 ($CBOB boost)**: the exact-N-distribution invariant, ring wrap, carry preservation, and due/early unscheduling are covered by host tests and suite arms. I did not find a counterexample in code.
- **Item 54 / 12 / 17 (compute)**: measured CU and packet behavior are recorded and pinned. The holder-page compute-budget obligation remains open under item 50, but the discharged measurement itself holds.
- **Item 14 (duplicate attributes)**: enforced by `DuplicateAttribute`.
- **Item 19 (unlevelled halt)**: closed by `NotRevealed`; there is no activated-but-unlevelled state.

## 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

### Item 50 — holder surfaces

The redeem page, deposit-address page, coverage warning, and public posting sender are still absent. The holder guide remains marked DRAFT but uses present-tense language for surfaces that do not exist. This must not be published. F-DOC-1 below is a small instance of the wording risk.

### Item 22 — live dress rehearsal

Bundled validation is local/fork evidence. It does not replace the named live rehearsal items: crank against live cluster, alarm in rehearsal mode, full revenue cycles through both pools, and forced post-sweep hand recovery.

### Item 38 — initialize values

The programs still check less than the launch checker. The signed initialize transactions must be built from `launch/mainnet-init.json` and verified on-chain, not merely validated as JSON.

### Item 52 — pool/Squads/revenue accounts

Code still requires these accounts to exist before splits/mints. Nothing in the programs creates them.

### Item 53 — rehearsal proof

The rehearsal script is present and its reverse-map proof is strong, but the final release-commit rehearsal and live rehearsal remain open.

---

# Additional documentation finding

## F-DOC-1 — LOW: HOLDER-GUIDE activation wording does not match the two-step code

**Construct:** `HOLDER-GUIDE.md`, “The four things you ever do”:

> Once it holds at least 21,000 sats of cbBTC, it is activated: it joins the payouts at the next distribution and earns from every one after that.

**What is wrong:** Code requires a request, then a distribution epoch must pass, then the vault joins, and it earns from distributions after joining. A vault that requests in epoch `e` does not earn from the distribution that advances epoch `e` to `e+1`; it joins after that and earns from the next one.

**Evidence:** `activate` first call sets `pending = true`, `request_epoch = dist_epoch`. Join requires `dist_epoch > request_epoch`. `join()` sets `debt_scaled = weight * acc_scaled`, so nothing from the intervening distribution is owed.

**Fix:** Rewrite to: “Once it holds at least 21,000 sats, activation is requested. It joins after the next payout runs, and earns from payouts after that.”

---

# What should be done before launch that AI audit structurally cannot do?

Given no human firm will see this and the programs will be immutable, the following are not optional polish. They are the controls AI audit cannot substitute.

1. **Do not count round 26 as clean.** Run two consecutive quorate clean rounds with different model rosters against the exact frozen commit after repairing the findings above. Publish the quorum evidence and exclusions.

2. **Run the full live dress rehearsal, not just local validation.** It must include:
   - crank live passes against a rehearsal deployment;
   - alarm live passes in rehearsal mode;
   - one full revenue cycle through Orca;
   - one forced Orca refusal and Meteora fallback;
   - one forced post-sweep failure and hand recovery;
   - DAS burnt-asset behavior check.

3. **Build and ship the holder surfaces before publishing the holder guide.** Item 50 is blocking. The redeem page must:
   - create missing destination and reserve ATAs in a prior transaction;
   - run `judgeRedemptionCoverage` pre-signature;
   - sweep through the helper, not pre-read amounts;
   - omit `claim` while the pool is frozen;
   - set compute-unit limits for any crank-carrying transaction or send no crank;
   - validate the lamport destination is a normal wallet/System account.

4. **Make initialize transactions verifiable, not just JSON.** The launch checker validates `launch/mainnet-init.json`, but the signed transactions are what write permanent state. Before signing:
   - generate the four initialize transactions from the checked JSON;
   - simulate them;
   - after landing, read the on-chain configs and compare every ruled value;
   - record the transaction signatures and config dumps.

5. **Fix dependency provenance for ship-gate scripts.** Remove the absolute `/opt/gary-club/node_modules` import from the mainnet probe. Pin all probe dependencies inside the repo and make the runner fail if resolution escapes the tree.

6. **Add the missing test arms and move floors in the same commit.** At minimum:
   - frozen-before-activation refusal;
   - helper non-System destination refusal;
   - helper duplicate destination;
   - helper wSOL source behavior;
   - explicit reason pins for each.

7. **Treat key custody as a launch-blocking ceremony, not an audit item.** AI audit cannot secure:
   - Gary’s guardian/init wallet;
   - swap operator key;
   - CBOB release wallet;
   - Moments collection hot wallet;
   - upgrade authority keys before removal.
   Use hardware/multisig where possible, even where rulings currently allow hot keys. At minimum, the Moments hot wallet should be cold or multisig through the charter window; the code cannot fix that exposure.

8. **Perform an independent-machine reproducible build.** `build-mainnet.sh` proves behavioral rejection of the localnet key and byte equality for the helper, but it cannot prove the compiled constant is Gary’s key. Rebuild the exact commit on a second machine and compare all five artifact hashes before deployment.

9. **Verify deployed bytes on-chain against the final manifest.** After deployment, dump each program and compare to `dist/SHA256SUMS`. Then remove upgrade authority for all five programs only after every precondition is met.

10. **Keep the alarm’s production/rehearsal separation strict.** Rehearsal alerts must never mute production streams. The `CBOB_ALARM_REHEARSAL=1` rule must be tested both ways before the rehearsal.