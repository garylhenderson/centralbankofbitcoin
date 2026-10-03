No custody break found in the open/burn pairing. The pool’s ceil(owed) math holds on the paths I could close. One permanent holder-fund loss is not in the accepted list.

## R1. Custody

No path found that lets a non-owner take value out of a sealed vault, or that lets a thawed vault survive a successful transaction.

`open_for_redemption` only treats a later top-level `burn_vault` as a match, and only if program id, discriminator, account 0 (asset) and account 2 (owner) all match. `burn_vault` requires an earlier top-level `open_for_redemption` with the same binding. A CPI open is invisible to the burn walk (`load_current_index_checked` is the outer index); a CPI burn is invisible to the thaw walk. Both failing directions revert the thaw. Emptiness checks on declared classic accounts (amount, delegate tag at 72, delegated amount at 121, close authority at 129, len == 165) are fail-closed. Undeclared non-ATA value and undeclared nested assets remain the known gap (limits 9 and 44), not a new one.

Evidence that would have shown a pairing break: one landed transaction whose logs contain `RedemptionOpened` and whose asset account is still `Key::AssetV1` afterward. I cannot construct that from this code.

## R2. Pool

Invariant “pool balance ≥ ceil(owed_scaled / 1e12)” holds for `credit`, `claim`, `retire`, and forfeit, as long as tokens leave the pool only through `claim`. `credit` assigns `floor(avail * SCALE / w) * w`, which is ≤ `avail * SCALE`. `claim` subtracts `pay * SCALE` from owed and `pay` sats from the pool; `ceil` drops by exactly `pay`. Join sets `debt = weight * acc` and does not touch owed. I did not find an ordering of `pending_count` / `pending_this_epoch` / `dist_epoch` that underflows or permanently blocks joins: a waiting vault is always joinable via `claim` (the dest account need not exist), and `retire_burned` clears a burned waiter. `JoinWaitingFirst` is liveness friction, not a lock.

**HIGH — a bricked vault can be activated, and then every later distribution destroys other holders’ cbBTC.**

Construct: `activate` / `join` (`programs/cbob-vault-mint/src/lib.rs`) and `claim`. Neither reads the asset owner. `activate` only checks the asset is a live Core asset in this collection and that its ATA holds ≥ 21,000. `claim` pays `r.vault_ata` with no owner check.

Proven impossibility 3: Core allows a transfer to the vault’s own `["mpl-core-execute", asset]` PDA, and that vault can never sign a top-level open. Limit 43 only says that owner cannot redeem, and the alarm reports `unredeemable_owner`. Neither says the vault may sit in `total_active_weight` forever.

What an attacker gains: nothing for themselves. What holders lose: that vault’s weight share of every future distribution, paid by permissionless `claim` into an ATA nobody can ever sign for. `retire_burned` does not apply (asset is live). Redemption cannot happen. Immutability makes the weight permanent. Early on, one Level V against a handful of joined vaults is a large fraction of the pool, not dust.

Evidence if this is true: transfer a funded vault to its asset-signer PDA; `activate` then `claim` after a distribution; the ATA balance rises; `total_active_weight` still includes it; no later transaction decreases that ATA. A test that expects `activate` to return `NotTheOwner` / a new error would fail today.

Fix: on `activate`, `join`, and `claim`, if the asset owner equals `find_program_address(["mpl-core-execute", asset], Core)`, refuse activation and do not pay. Add a permissionless retire for that case only: clear weight, return unpaid owed to the pool, do not require a burn. Do not try to detect every PDA with `is_on_curve` (it panics on BPF). Nested-in-another-vault is the same economic bug but the outer asset id is not in the record; at least refuse the self-PDA case, which is the permissionless one-signature grief.

Limit 28 is also worse than written, but the code should not be “fixed” by waiving emptiness. A Coinbase freeze of the vault’s own cbBTC ATA (balance ≥ 21,000 once activated) makes the whole redemption fail: the sweep of that ATA fails, and `VaultNotEmpty` refuses the burn, so $GARY and $GIRAFFISH are stuck until thaw. The pool-freeze forfeit does not cover this. Skipping a frozen non-empty reserve on burn would orphan that cbBTC under a dead PDA. Keep the refuse. The holder guide only says a frozen pool still allows opening.

## R3. Level draw

SlotHashes parse is fail-closed (sysvar id, count ≤ 512, buffer length, zero hash rejected). FIFO is `mint_index == revealed_total`. A burned head still consumes a draw and does not need the attribute hash. Window vs three group-strides fits inside 300 slots on the arithmetic in the comments. I did not find a way for the minter to grind `asset` against hashes that already exist.

**MEDIUM — limits 25 and 26 understate who can aim the grind.**

`reschedule` sets `reveal_slot = now + 16`. The caller chooses `now`. A leader who can land that transaction (or censor the crank and land their own) can place C in their own later rotation, then grind C with hA and hB already public. That is not “you must luck into being C for someone else’s vault, probability ≈ stake.” Any scheduled leader can aim a vault they mint, and can aim a lapsed vault whose reschedule they include. Limit 26 already accepts a one-slot grind; the missing part is targeting. One validator with two adjacent rotations, which you measured, gets a second try by skipping.

Evidence: on a validator with a known leader schedule, mint or reschedule in a slot chosen so C is the attacker’s leader slot; the recorded `reveal_slot` matches that aim; the draw matches `sha256(hA‖hB‖hC‖asset)` for a block the leader mutated. I cannot execute that here.

No code change removes this without a VRF. If you keep the scheme, the limit text should say leaders can aim, not merely that the last contributor can grind if they happen to be C.

## R4. Governance

No path found for a minority to move the split, either destination, `max_supply`, the royalty, or a vault. Key changes are gated on ceil(50% of snapshotted live supply) and cannot share a proposal. Overtaken rounds move `last_round_id` before the over-check. `StopIsNewer` matches the skip in `execute_proposal` (`>` vs `<=`). A vote cannot pay the pool out to a wallet: the only CPIs are `set_round`, `restart`, `arm_guardian`, `tighten_sweep`, `arm_swap_operator`.

Governance freeze if every vault is redeemed is limit 45, and it matches the code. Lost keys above 50% of live vaults make guardian replacement impossible; that is the ruling, not a new hole.

## R5. Charter claim

Merkle leaf/node tags and sorted pairs match the comment. Owner is taken from asset bytes and must sign. The PoB is burned in the same instruction before the vault is created; failure reverts both. `pob_extra` accounts are not marked signers on the CPI. The sales stop is not read (limit 48, by ruling).

Limit 46 is worse than the rejecting-hook sentence. The suite already shows the Moments update authority can add a collection plugin (`OR.1`). A hook that only rejects is the stated residue. The same authority can burn or reassign PoBs if Core lets that plugin be a burn/transfer delegate, which ends claims for good and does not need the pass-through path. I am not asserting the delegate CPI succeeds; I have not executed it.

Evidence that would confirm theft or grief beyond 46: `momentsAuth` adds `PermanentBurnDelegate` or a transfer delegate, burns or transfers a pinned PoB without its owner, then either claims the vault or shows `claim_charter_vault` failing `NotThePobOwner` / `NotAProofOfBurn` for the original holder. A second test: an executable hook on BurnV1 that transfers lamports from the payer, who is a signer on that CPI. If that lands, the pass-through mitigation is a theft path, not only a liveness one. Do not treat “hook can reject” as the full residual of a hot collection authority.

## R6. Initialize and the trusted hop

`initialize` in all four programs is `init` plus `INIT_AUTHORITY`. Wrong collection wiring is refused across SEAL → MINT → BURN → GOV. Royalty plugin authority is `PluginAuthority::None`; no later instruction writes it. I am not re-arguing the swap operator (limit 10): worst case remains cap × cooldown windows of royalty SOL until `emergency_stop_sweep`, and only if the key signs.

The redemption ring matches the comment. With `k = min(cap, 64)`, the slot checked is the k-th most recent timestamp; the k+1-st inside the window is refused. Initial zeros only let the first `k` through. State updates sit before the burn CPI, so a later failure rolls the ring back with the transaction. Cap uses live supply before this burn is counted. Above 3,047 live the cap is stricter, as stated.

On-chain, `sol_reserve_lamports == 0` is legal. That is safe only because the revenue address is a system-owned PDA: sweeping it to zero closes it, and a later transfer recreates it, still signable with the seeds. The dangerous band is `(0, rent)`, which initialize already rejects. Not a finding. Launching at 0 is still a product mistake; item 38’s checker is what must refuse it, because this program will not.

## R7. Cross-program reads

Recomputed from the struct field order (Borsh, no alignment). These match the constants in GOV and BURN:

- MintConfig: `governance` 41, `minted_total` 141, `sales_stopped` 191, `sol_reserve` 257, `max_sweep` 266, `cooldown` 274, `charter_closes_at` 442, `bare_burns_retired` 454, `sales_stopped_at` 518, `sweep_stopped_at` 526, `sweep_floor` 631, `cooldown_ceiling` 639, `reserve_ceiling` 647.
- VaultRecord: `mint_index` 41. Version byte at 8.
- BurnConfig: `burned_total` 42. SEAL: `version` 8, `collection` 9, reserve vec length 41.

No silent misread found. A mismatch would show up as `WiringDiverged` / `BadMintConfig` on a correct sibling, or as GOV snapshotting a pubkey where `minted_total` should be. The suite’s `3.1w` only checks four of those offsets against live values; the rest are source pins plus this layout walk.

## R8. Suite

`RL.1` cannot fail. `bucket()` computes `cap` with the same formula the assertion uses as `want`, then compares them. It never reads a cap the program enforced. `RL.2` is the real test. An arm that cannot fail is not evidence.

`S7.2!` in the simulation accepts either `NoActiveVaults` or `JoinWaitingFirst`. That pins a refusal, not the reason named in the title.

No arm executes a CPI wrapper around `open_for_redemption` or `burn_vault`. The pairing comments are untested in both directions. No arm activates a vault whose owner is its asset-signer PDA. No arm freezes a vault cbBTC ATA and tries to redeem $GARY beside it. Those are the claims above that the 645 did not touch. I am not treating a green count as a measurement of them.

`because('9.13', '0x0')` is the record PDA already existing, which the comment admits. It does not prove Core rejected a remint. Fact 7 is still measured elsewhere. Not a false pass if the claim is only “remint is rejected.”

## Accepted limits

1. Worse than stated: **43** (and impossibility 3) — self-PDA transfer is not only an unredeemable holder; it is a permanent black hole in the denominator once anyone activates it. **26** (with **25**) — leaders can aim C by choosing mint time or reschedule time. **28** — a freeze of the vault ATA, not only the pool, locks every other asset in that vault until thaw; the guide does not say this. **46** — hot Moments authority is not only a rejecting hook; seizure or burn of PoBs is the same key, and a signer-forwarding hook is untested.

2. Not a limit, or already closed: the open/burn CPI story is closed in the source if Solana’s instruction sysvar behaves as `load_instruction_at_checked` documents. I did not find a counterexample. I also did not find a test. Do not move it to “proven” until a CPI wrapper is executed both ways.

3. Discharged items I re-checked are still discharged: 19 (no activate without a level), 30 (no wiring write), 14 (duplicate keys refused). I am not reopening 12/17.

4. Quietly treated as done in holder-facing copy, still open in SPEC: **50**. The guide states the redeem page checks, warns, and files the payout as present behavior. **22** is still marked open; nothing in the programs pretends a live crank has run. **38** is still open; the programs will accept any in-range initialize, including a reserve of 0 and a redemption window of 10.

Holder-guide sentences the code does not make true:

- “A vault that exists is a vault that is full.” Empty and partially funded vaults mint. The true sentence is that a vault cannot be emptied and left alive.
- “Payouts arrive in your vault every month” / “at least once a month.” That is the crank plus traffic (limit 36). No clock fires `distribute`.
- “Every sale and every resale royalty (10%, fixed forever) flows into the Bank.” The plugin is immutable at 1000 bps with `RuleSet::None`. A Core transfer does not pay it. Marketplaces that ignore royalties pay nothing. The rate cannot be changed; collection of it is not enforced.
- “Opening needs your wallet’s signature and nothing else.” The rate limit, the emptiness proof, and a frozen reserve ATA can all refuse a signed open. The 2.1% sentence later does not cover the freeze case.
- Limit 41’s required caveat is missing: the cap does not stop a key thief who transfers vaults first. “Slows any mass emptying” will be read as if it does.

## What AI audit cannot do before you remove the upgrade authority

Run these on a validator and keep the transactions. Do not remove the upgrade authority on the strength of another read-through.

1. Self-PDA grief, executed: fund, transfer to the asset-signer, `activate`, `distribute`, `claim`. Record the unreachable ATA balance and `total_active_weight`. That single run confirms or kills the HIGH above. If it confirms, fix before freeze; a document edit is not a fix.

2. CPI pairing, both directions: a program that CPIs `open_for_redemption` with a later top-level burn, and a top-level open with the burn hidden in a CPI. Both must revert, and the asset must still be frozen. This repo has never executed that.

3. Freeze one reserve ATA on a vault that also holds $GARY, and attempt redemption. Publish the log. Put the result in the holder guide in the same words as the log. Do not change `VaultNotEmpty` to make the transaction succeed.

4. Moments authority, on a throwaway collection: add a burn delegate and an executable hook that tries to move the payer’s lamports during `BurnV1`. If either works, limit 46 is the wrong residual and the charter window is a hot-wallet trust, which the guide does not say.

5. Item 22 for real: crank against a cluster with ~2,100 vault records, kill the RPC at vault ~1,900, and show reveals and claims resume. The 645-assertion suite does not speak to that.

6. Have a person who will own the launch read HOLDER-GUIDE.md against the programs and strike every present-tense sentence whose subject is not built (`judgeRedemptionCoverage`, monthly arrival, enforced resale royalties). AI will keep “confirming” those sentences because they appear in the design doc.