# Independent audit — CBOB v6, five programs + the pipeline beside them

Scope read: all five programs whole, `tests/3prog.test.ts`, `sim/test-vault.ts`, `sim/fixtures.mjs`, `sim/clone-pob.mjs`, `sim/run-sim.sh`, `tests/expiry-budget.mjs`, `tests/initauth.test.ts`, `tests/cpi-wrapper`, `tests/probe-round5*.ts`, `bank/txread.mjs`, `bank/sigwalk.mjs`, `scripts/run-tests.sh`, `build-mainnet.sh`, `audit-coverage.sh`, `rehearsal-tree.sh`, `token-programs.sh`, `probe-mainnet-facts.mjs`, `pob-merkle.mjs`, `launch/mainnet-init.json`, SPEC, DESIGN-v6, HOLDER-GUIDE, round 33's verdict and VALIDATION, RT3.

**Result: 1 MEDIUM, 3 LOW, 4 INFO. No CRITICAL, no HIGH. I could not break custody, the pool invariant, the boost ring, the rate limit, the pairing, or any cross-program offset.** The MEDIUM is an evidence gap on the single most load-bearing custody property, not a demonstrated defect. Everything I verified by recomputation is listed as positive evidence so you can check my arithmetic rather than my adjectives.

---

## R0. Round 33's verdict, and whether its repairs hold

I read the verdict as evidence, not authority, and re-checked each item at its site in this tree.

| R33 item | My independent check |
|---|---|
| **L1** pre-funded program id | Present in SPEC road step 9, with the measured recovery (Allocate(36)+Assign+write-buffer+`DeployWithMaxDataLen`). I verified the arithmetic independently: `UpgradeableLoaderState::Program` is 4+32 = 36 bytes, rent-exempt = (36+128)×6960 = **1,141,440** ✓. The step also correctly says a stranger can only *send lamports* (Allocate/Assign need the program keypair), so the id itself can never be captured. Confirmed repaired. |
| **D1** SPEC REDEEMING step 1 | The categorical "3 assets + creates does not fit" sentence is gone; step 1 now states limit 42's two measured numbers (1,367 padded / 1,219 narrow) and names "missing reserve accounts" as a separate reason. Repaired. |
| **D2** DESIGN `MIN_ROUND_PRICE_SATS` | Now reads "a constant compiled into the program (no `initialize` argument sets it)". Matches `lib.rs:477`/`969`. Repaired. |
| **D3** vacuous arm 2.1 | Now `rec('2.1',…,'ALLOW',vMint.ok?'ALLOW':'REJECT',vMint.err)` with the mint wrapped in `att()`. The arm can now fail. Repaired. |
| **Gate-5 obligations 1–3** | All three are now suite arms: **R33.G1** (640-byte attribute budget + 10,198-byte autograph revealed by MINT in FIFO at the default budget), **R33.G2a/G2b** (many-signer autograph grown to Core's heap refusal, then revealed with every kept signature), **R33.G3** (None-authority royalty re-delegation refused 0x1b, with the UpdateAuthority control). Plus **R33.G4** (pre-filled wSOL close). I checked G1/G2b are not vacuous: `worstShape`/`crowdShape` stay `null` if the setup fails, and the arms then record `'no vault'` against `'true,10198'` → red. |
| Floors moved together | `MIN_ASSERTIONS=866`, `DET_FLOOR=909`, SPEC's stated counts 866/909 — all consistent, all equality-gated. No slack reintroduced. |
| Regression risk from the new arms | The two new autograph vaults are Alice-owned and empty, so they *add* to section P's candidate pool rather than excluding candidates; `P.2a`'s "≤20 excluded" guard is unaffected. The suite passed 866/866 per VALIDATION. |

**Where I differ from round 33's dispositions:** only on emphasis. Its **A1** (owner-added `FreezeDelegate` with a foreign authority holds the vault hostage: owner's thaw 0x1a, transfer and burn 0x9) was dispositioned as an optional doc sentence. That is a holder-funds-hostage phishing outcome, and the guide's "Some cannot be undone" does not convey "a delegate you approve can lock your Bitcoin until they release it". I would put one sentence in the guide's add-ons paragraph. Not re-filed as a finding.

**What R0 does not cover and should:** gate 5's discipline ("every rejected finding becomes an assertion") has been applied rigorously to *rejected* findings and not at all to *assumed* properties. The largest assumed property is F1 below.

---

## R1. Custody — can anyone but the owner get value out, or an emptied vault survive?

**I could not break either. The positive results, with what I actually checked:**

*Pairing.* `open_for_redemption` walks `current+1..` for a top-level `burn_vault` binding account 0 (asset) and account 2 (owner); `burn_vault` walks `0..current` for a top-level `open_for_redemption` binding the same two. I attacked:
- **CPI wrapper both ways** — `load_current_index_checked` reports the *outer* top-level index, so a wrapped half can never satisfy the other half's top-level requirement (WR.1–WR.4 measure it, and `retire_redeemed`'s `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1` is a second, independent wall).
- **Two vaults in one transaction** — asset+owner binding on both halves; borrowing is impossible (3.9/3.10/4.10/9.0).
- **Mid-transaction transfer** — `[open A as O, transfer A to O2, burn A as O2]` fails at SEAL (no burn naming O); `[…, burn A as O]` fails at BURN (`asset_owner != owner`). I walked every ordering I could construct.
- **Thawed-and-not-burned** — impossible by atomicity: SEAL only requires the burn *instruction to exist*, and if it fails the thaw reverts with it. There is no re-seal and no close.
- **Double open** — two opens plus one burn both pair; the asset is still burned.

*Emptiness proof.* The reserve loop derives both ATA programs' addresses, requires each **declared**, skips any account no token program owns (so a swept-and-closed account passes because it is System-owned with 0 data — the right reason), and for live ones requires PDA ownership, `delegate == None` (bytes 72..76), `delegated_amount == 0` (121..129), `close_authority == None` (129..133), `len == 165` and `amount == 0`. The second loop applies the identical six checks to any declared PDA-owned token account and refuses any declared live `AssetV1`.

*Accounts a stranger can create that neither the sweep can name nor BURN will skip:* **none that I could find.**
- A Token-2022 ATA for a classic mint cannot be created (refused `IncorrectProgramId`; asserted against the three **real mainnet reserve mints** by `probe-mainnet-facts.mjs`, which is inside `MAINNET_FLOOR=33`). So that derivation is always System-owned → skipped.
- Lamports sent to either ATA-derived address leave a System-owned, 0-data account → skipped by both loops.
- No one but the ATA program can sign for an ATA address, and the ATA program always allocates 165 bytes with the correct mint and owner — so the *address pins mint and owner*, which is what makes `claim`'s "dest must equal `r.vault_ata`" sufficient without re-reading the mint/owner fields.
- A **non-ATA** token account for a reserve mint owned by the vault PDA *can* be created by a stranger; it is never declared, so it never blocks, and it is destroyed (limit 44) or rescued by naming it to the helper (limit 44, round 25 D7).
- A delegate or close authority on a reserve ATA would block the burn or the close — but both require the PDA's signature, so only the owner can do it to themselves.

*Lamports.* `asset_signer.lamports() == 0` is checked **before** the Core burn; Core's `BurnV1` refunds the asset's rent to the payer, not to the signer PDA, so nothing refills it afterwards.

### MEDIUM — F1. The seal's resistance to owner-driven plugin-authority operations is asserted nowhere

**Construct.** The whole custody claim is "no key can unseal a vault", and it reduces to exactly one Core fact: on a live vault, **the owner cannot remove, re-delegate or revoke the `PermanentFreezeExecute` plugin whose authority is SEAL's `["seal"]` PDA.** Nothing in this tree measures that.

What *is* measured, and what is not:
- measured: owner cannot add an asset-level Royalties plugin (R.8, 0x1a); owner cannot add an Oracle or AgentIdentity external adapter (R24.1/R24.1a); owner cannot rewrite a drawn level (11.13/11.14, 0x1a); a bare owner `ExecuteV1` on a frozen vault is refused (3.7, with the signer proven to BE the owner and the seal proven frozen); a stranger and an owner-added transfer delegate cannot Execute on a genuinely thawed vault (SR.5/SR.5a); the collection's update authority is MINT's off-curve PDA (SR.5b).
- **not measured anywhere:** owner-signed `RemovePluginV1(PermanentFreezeExecute)`, `ApprovePluginAuthorityV1(PermanentFreezeExecute → attacker)`, `RevokePluginAuthorityV1(PermanentFreezeExecute)`. The suite imports `removePlugin` and uses it only on a `TransferDelegate` cleanup; it imports `approveCollectionPluginAuthority` and uses it only on a *collection* royalty (R33.G3). There is no asset-level approve/revoke arm at all. R28's `RemovePlugin` observation was a **heap** refusal on an 11 KB asset, not an authority refusal on an ordinary vault.

**What an attacker gains if Core permits any of the three.** Re-delegation to an attacker, or revocation to the update authority: the attacker (or nobody) controls the seal. If an attacker gets it, they thaw at will and empty every vault without a burn — the vault survives, still sellable as "sealed". If it falls to MINT's PDA (which has no thaw instruction), every affected vault is permanently unredeemable. Either outcome is the worst case in the system.

**I am not claiming Core permits them.** My reading of Core's model says permanent plugins are update-authority-managed and create-only, and that approve/revoke require the current plugin authority, which SEAL never signs for. Round 25 N3's source read of `state/asset.rs` points the same way. **The finding is that the property is assumed, in an immutable system, against an upgradeable dependency, while every adjacent property is pinned.** Ship gate 5 exists for exactly this shape.

**Evidence that would exist if I am wrong.** A suite arm, in any round, that sends one of those three instructions on a CBOB vault and records a refusal with a pinned reason. I searched `tests/3prog.test.ts` and `sim/test-vault.ts` for `removePlugin`, `approvePluginAuthority`, `revokePluginAuthority`, `PermanentFreezeExecute` and found none.

**Fix (no program change, ~30 lines of suite).** On a live sealed vault, owner-signed, all three must be REJECTED, each with `because()` pinning Core's own code; then re-assert `permanentFreezeExecute.frozen === true` with `authority.address === SEAL`, and that a bare Execute is still refused. Add the R24.1b-shaped control on the keypair-authority control collection (`ctrlX`/`CA`) so the arms are provably able to fail: on the control asset, its plugin authority **can** re-delegate and thaw. Also pin that `BurnV1` does not credit the asset-signer PDA (measured fact 4), which today exists only in `tests/probe-round5b.test.ts`, a file `run-tests.sh` never invokes.

---

## R1s. The sweep helper

**(b) pair list, (c) destination, (d) lamports, (e) BURN interaction: I found no defect.** Details I verified beyond the existing arms:
- Same source twice → second `read_token` sees a System-owned closed account → `IllegalOwner` *without* the source-owner log line, which SR.12a/SR.12b distinguish correctly. Good craftsmanship.
- A source cannot also be a destination (owner field is single; `signer != dest` enforced).
- **wSOL source works** and is not a hazard: SPL `CloseAccount` skips the `NonNativeHasBalance` check for native accounts, and the transfer of a native balance moves lamports with it. No arm exercises it (round 33 A10 already lists it).
- **Frozen source, zero balance:** `CloseAccount` has no frozen check, so it closes. Frozen with a balance reverts the whole redemption (SR.14). Matches limit 44.
- Destination need not be an ATA (only mint+owner are checked) and may be another vault's asset-signer PDA — both are the owner's own signed choice, and SPEC 50's client contract already says a page naming a non-canonical destination must check it.
- A System transfer below rent exemption to a non-existent account is refused by the runtime; SPEC item 50 already states this and names the fee-paying owner as the canonical destination.
- `signer.lamports()` read at execution, and `require!(asset_signer.lamports() == 0)` runs before Core's burn, which does not refill it. Nothing inside the transaction can land between the sweep and the check except an instruction the owner put there.
- **(f) It fits.** S8.0's budget is `1232 − 52 (two compute-budget ixs) − 96 (separate payer key + signature) = 1084`, measured 1,061 → 23 bytes spare. There is no fourth reserve (the list is written once, max 3). The in-line monthly run's pool account is already inside that 1,061. Each extra rescue pair costs ~2 account indices plus the keys, so the "mind the packet" clause in item 50 is the right statement.
- **(g)** The helper deployed in the suite is the same bytes `build-mainnet.sh` proves: it has no `localnet` feature (deliberately, round 25), and `build-mainnet.sh` `cmp`s `dist/` against both its own `--features localnet` rebuild **and** `target/deploy/cbob_vault_sweep.so`, the file `run-tests.sh` and `run-sim.sh` deploy, refusing a dirty tree. This is the only one of the five programs for which shipped == tested is *proved* rather than argued.

### LOW — F2. The helper is a universal "drain any signer" primitive; its access control is a signature on `accounts[0]`, not "the asset's owner"

**Construct.** `programs/cbob-vault-sweep/src/lib.rs::process`. `accounts[0]` is required only to be `is_signer`. Nothing binds it to `["mpl-core-execute", asset]` under Core, or to anything at all. Everything else follows from it: sources must be owned by `accounts[0]`, and the final `system_instruction::transfer(signer.key, dest.key, signer.lamports())` empties `accounts[0]` to zero.

**So the honest answer to R1s(a) is not "only the asset's owner".** It is: *anyone who can obtain a signature from `accounts[0]`*. For a CBOB vault that is the owner via Core (measured SR.5/5a/5c, plus `0x1a` pins), which is why the redemption is safe. But `accounts[0]` can equally be an ordinary wallet, and then the instruction is: "given one signature and one byte of data, move every named token balance to `dest`, close those accounts to `dest`, and send every lamport to `dest`."

**What an attacker gains.** A permanent, immutable, keyless, CBOB-branded drainer building block usable against any Solana user who signs the wrong transaction. The marginal uplift over the attacker writing their own transfers is real but modest: (i) the amount is implicit, so the instruction is constant-size and shows nothing in a non-simulating signer (hardware blind-signing, CLI, a program that forwards caller-supplied instructions); (ii) with a **durable nonce** a signed transaction can be held and submitted later to take *whatever is there then* — a plain System transfer must fix the amount at signing. No CBOB holder loses anything through this path, and a simulating wallet shows the full delta. This is reputational/ecosystem, not custody.

**Evidence that would exist if I am right.** A single top-level transaction on a local validator: `[payerKeypair(signer, writable), attacker(writable), Token, System]`, `data=[0]`, no pairs → the payer's balance goes to 0 and the attacker's rises by it. The suite's SR.1 proves the *converse only* (no signature → refused); nothing proves the signer must be a Core asset signer.

**Fix (one `require`, ~1 byte of packet).** The asset account is already in every redemption's message (SEAL's open and BURN both name it), so add it to the helper's fixed accounts and require
`find_program_address(&[b"mpl-core-execute", asset.key().as_ref()], &MPL_CORE_ID).0 == *signer.key`
— or carry the 32-byte asset address in instruction data instead of an account. Either closes the generic case entirely while leaving every CBOB and control-asset arm (including SR.5c/5d) unchanged. I note this is a program change inside the freeze and therefore the owner's call on cost; it is cheap and permanent either way.

---

## R2. The community pool's money — the invariant holds

**I proved "the pool always holds at least ceil(owed)" rather than taking P.32's single observation.** Writing `S = ACC_SCALE`:

- `credit`: `delta = ⌊avail·S / w⌋`, so `delta·w ≤ avail·S`, so `⌈(owed+delta·w)/S⌉ ≤ ⌈owed/S⌉ + avail`. Since `avail = balance − ⌈owed/S⌉`, the right side is exactly `balance`. Invariant preserved, with the dust left in the pool.
- `claim`: balance and `owed_scaled` both fall by exactly `pay` sats (`owed_scaled −= pay·S`), so `⌈owed/S⌉` falls by exactly `pay`. Preserved.
- `retire` / forfeit: `owed_scaled` falls, balance unchanged. Preserved (strictly improves).
- `split_revenue`: balance rises. Preserved.
- No other instruction can move pool tokens: the config PDA is the only authority and only `claim` CPIs a transfer.

**And the stronger property `owed_scaled == Σ owed_of(r)` over active records holds exactly**, which is what makes every `checked_sub` safe rather than merely lucky:
`credit` adds `delta·w` globally and `weightᵢ·delta` per vault, and `w` is read in the same instruction with no intervening reentrancy (the only CPIs are SPL Token and Core, neither of which calls back; measured fact 12). `join` enters at `debt = w·acc, carry = 0` → owed 0. `reweigh` sets `carry = owed_before, debt = after·acc` → owed unchanged. `claim` settles `pay·S` and carries the remainder. No path can make a vault's owed negative: `acc` is monotonic and `debt` is reset to `weight·acc` at every settlement, so `owed_of = weight·(acc_new − acc_old) + carry ≥ 0`.

**Counters, under every ordering I could construct.** `pending_this_epoch` is zeroed at each `advance_epoch` and incremented at each request; a pending vault with `request_epoch == dist_epoch` cannot `join` (join requires `>`), so it can only leave via `retire`, which decrements both — therefore `pending_this_epoch ≤ pending_count` always and `waiting_to_join`'s `checked_sub` cannot underflow. F21.1/F21.2 exercise the two retire branches; I checked the third ordering (request in E, advance to E+1, new request in E+1, retire the E one) by hand and it is correct.

**Liveness.** Every gate on `distribute` is clearable by anyone, free:
- `JoinWaitingFirst` → any `claim` naming the record and its (publicly derivable) recorded ATA joins it; note correctly that the pending branch does **not** require a live asset, which is limit 27's dead-weight cost and is what prevents a bare-burned pending vault from becoming a permanent block.
- `BoostsExpireFirst` → `expire_boosts` needs **only** the records, no token account. This is the right design and I verified it is the reason a due boost on a vault with no reachable ATA cannot wedge distributions.
- `NoActiveVaults` / `pending_this_epoch > 0` → clears as soon as anyone requests.

**SPEC's weaker W11 rule is the true one.** A vault is never credited by a distribution that ran before it joined; revenue already *in the pool* when it joins is shared at the next distribution by everyone then joined. The only residue is unsplit revenue in the revenue address (limit 55), whose cost I confirm: as little as 100 $GARY at the monthly boundary, because the first of the two distributions can be the free path or a host's in-line run.

No finding.

---

## R2b. The $CBOB boost — exact, and the ring is sound past epoch 64

I verified the ring's non-collision argument from first principles rather than from the host test:

- `MAX_BOOST_EPOCHS_BOUND = BOOST_RING − 1 = 63`, and `BoostsExpireFirst` prevents the epoch from advancing while anything is due. Therefore at epoch `E`, every live not-due boost has `end ∈ [E+1, E+63]` — 63 values, 63 distinct residues mod 64, none equal to `E mod 64` (which `advance_epoch` has just zeroed). A purchase at `E` lands at `(E+n) mod 64` for `n ∈ [1,63]`, which can only coincide with another live boost if two live `end`s differ by a multiple of 64 — impossible in a 63-wide range. **No two live boosts ever share a ring slot.**
- `ring + due == boosts_active` is preserved by all four mutators (purchase, advance, due-unschedule, early-unschedule), so `boosts_due` never exceeds the number of expirable records → due boosts are always clearable.
- An early (not-due) `unschedule_boost` cannot underflow its slot: the slot is zeroed only at the advance where `dist_epoch ≡ end (mod 64)`, which within `(purchase, end)` requires a non-zero multiple of 64 — impossible.
- **Exactly N distributions, never N+1:** because the epoch cannot advance past a due boost, every due boost satisfies `end == dist_epoch` exactly at expiry, so `unschedule_boost` always takes the due branch and `reweigh` happens at precisely the accumulator its last distribution left. BO.21/BO.35 pin both orderings ([boost, distribute] counts the ride-along; [distribute, boost] does not).
- **Nothing earned is lost or gained** on any weight change: `reweigh` moves owed into `carry` and resets `debt = after·acc`; global `owed_scaled` is untouched. I verified this against `owed_of`'s `carry`-before-`debt` ordering, which is what prevents a lower weight from needing a negative debt.
- `total_active_weight`, `boost_weight_total`, `boosts_active`, `boosts_due` and the ring agree: `retire` subtracts the full `weight_of` (base+boost) from `total_active_weight` and `unschedule_boost` deliberately does **not** touch it again. BO.38 covers the wrapped early-retire branch on chain.
- A vault whose token account is gone cannot block: `expire_boosts` takes records only; `claim` on a frozen destination still expires then defers (BO.37).

No finding. One documented consequence worth keeping visible: `set_boost_terms` has **no price ceiling** and is an *ordinary* action (10.71% YES), so a vote can set the price to 1 base unit. SPEC says so ("any price above zero"); the holder guide says so. Correct as ruled.

---

## R3. The level draw

Verified: the SlotHashes parse pins the sysvar key, bounds `n ≤ 512`, checks the buffer holds `8 + 40n`, refuses an all-zero hash, and takes the **smallest produced slot in `[want, want+64]`** so the value is independent of *when* capture is called. I computed the deadline independently: `A ≤ reveal+64`, `B ≤ reveal+136`, `C ≤ reveal+208`, all inside `REVEAL_WINDOW_SLOTS = 300`, and at most 236 produced slots separate `A` from the window's end against a 512-entry buffer — so **a capture inside the window can never fail to find A**. FIFO is enforced against `revealed_total`; a burned head still draws (L.11) so the queue cannot stall; the attribute re-supply is hash-pinned (`AttributesMismatch`); `crank` skips non-records without failing its host (K.3) and cannot be made to error by a crafted account.

### INFO — F3. Limit 26's *mechanism* is weaker than stated (its *outcome* bound is not)

`ENTROPY_GROUP_STRIDE = 2` guarantees three distinct 4-slot **groups**, not three distinct **leaders**. A validator holding ≥3 consecutive rotations (12–16 slots — reachable for a large staker, and the leader schedule is public an epoch ahead) is the leader of A, B **and** C. It then does not need to grind block contents at all: it has a free choice over the skip pattern of all three groups (up to 4³ combinations), deterministically, and can schedule a mint or a reschedule into that window. Limit 26 attributes the residual to "C's leader … 64 tries reach 96%", which already concedes free selection, so the *outcome* is not worse than stated — but "That removes every other leader's influence" is the mitigation's intent, not a property of the stride. HOLDER-GUIDE's "the validator producing the last of those blocks" should read "a validator producing one or more of those blocks".

### INFO — F4. Limit 25 is wider than stated: a reschedule re-rolls every undrawn vault behind it

Each `reveal_level` draws from `level_caps − level_minted` *at its turn*, so vault K's outcome determines the census every later vault sees. Rescheduling K therefore permutes the levels of **all** vaults behind it in the FIFO, not just K's — even those whose entropy is already captured and fixed. This is not exploitable (a later holder cannot reschedule, an earlier holder cannot force a lapse, and nobody had a right to an undrawn level), and the quotas still hold exactly, but limit 25's cost line ("a re-rolled Level V is a Level V someone else did not draw") understates the blast radius by a lot. One clause fixes it.

---

## R4. Governance

**No minority-carry path found.** I recomputed the tally: at quorum 2100 / threshold 5100, the minimum passing vote is `cast = ⌈0.21·qs⌉` with `yes = ⌈0.51·cast⌉`, i.e. ~10.71% of the snapshot — above the 10% turnout floor, which is why limit 35 is correct that the floor never binds at the ruled numbers. Key changes require `⌈0.5·qs⌉` and can never share a proposal with the other key.

**No frozen-forever path found, and I checked the one that matters most:** *every proposal that passes creation can execute.* I compared GOV's creation checks against MINT's execution checks field by field, including the two GOV omits — `max_sweep ≤ MAX_SWEEP_LAMPORTS` (implied, since GOV requires `x < live ≤ 50 SOL`) and `cooldown ≥ MIN_SWEEP_COOLDOWN_SECS` (implied, since GOV requires `x > live ≥ 1`). So no ratified bundle can be bricked by a CPI refusal, which is what makes the "skip, don't revert" design actually safe. The guardian can never touch governance; `execute_proposal` is permissionless; `arm_*`/`apply_*` need no signer at all.

### LOW — F5. A YES vote survives the voter's own redemption; the snapshot's *downward* blind spot is unstated

`quorum_supply` and `index_snapshot` are frozen at creation, and `execute_proposal` re-reads neither the electorate nor the voters' continued existence. Round 25 D1 and limit 47 document the *upward* blind spot (vaults minted during the vote cannot vote or raise the bar). The downward one is not documented: **a coalition can cast `⌈qs/2⌉` YES, then redeem those very vaults — recovering their deposited cbBTC in full — and the key change still executes** up to 3+7 days later, landing after a further 7-day notice. Redemption is rate-limited to ~2.1%/hour, so 120 redemptions take ~3 hours, well inside the window.

What this changes: the cost of capturing the guardian and the swap operator is not "hold half the live vaults until the change lands", it is "hold half the live vaults for the three-day vote", with the capital recoverable immediately afterwards. The remaining cost is the secondary-market premium over contents plus a three-day exposure.

I checked the obvious cheaper variant and it does **not** work: self-redemption cannot shrink the bar, because each of the attacker's redemptions reduces `L` and `X` by one, and `L − r ≤ 2(X − r)` requires `r ≤ 2X − L`, which is negative whenever `X < L/2`.

**Evidence if I am right.** In the suite: create a key-change proposal, vote it with exactly `needKey` vaults, redeem all of them (`burned_total` rises by that many, `bare_burns_retired` unchanged), then execute — and it lands. Nothing in the suite does this; `3c.K2` only tests the *insufficient* case.

**Fix.** There is no cheap on-chain fix that is clearly better: re-reading live supply at execute is `max(snapshot, live)`, which GOV deliberately rejected because new mints could then block a legitimate guardian replacement. So the honest repair is **documentary**: add the downward direction to limit 47 and to round 25 D1's note, and say plainly in the holder guide's honest list that the vaults backing a key change need not still exist when it lands.

---

## R5. The charter claim and SPEC 46

`claim_charter_vault` is correct as described: identity by **address** against the root (a same-collection, same-name lookalike minted by the hot authority is refused, C.8); the PoB must be a live `AssetV1` in the pinned collection, owned by the signer, and is CPI-burned in the same instruction; the window is two clock comparisons with no flag; `pob_extra` accounts are passed to Core **never as signers** and are split off `remaining_accounts` before the crank, so a miscount fails loudly at `BadSlotHashes` rather than silently. A spent leaf cannot be replayed (the burned address cannot be re-minted; 9.12/9.13, S9.1/S9.2).

**Is SPEC 46 complete?** I tried to find a capability it omits and could not:
- minting a new "Proof of Burn #241" is defeated by address identity ✓ (C.8);
- rewriting a PoB's name/uri is irrelevant for the same reason ✓;
- gating by an Oracle on the collection, on an **individual** asset (unalarmed), or by flipping the oracle between transactions ✓ all stated;
- moving a PoB out of the collection ✓ stated as the same brick class;
- a holder adding an owner-managed `FreezeDelegate` to their own PoB and then selling it ✓ stated;
- the positive bound (that key cannot transfer or burn a PoB) ✓ stated with Core line references;
- the alarm samples state every 30 minutes, so an add-then-remove between passes is invisible ✓ stated;
- the packet bound (at most four distinct extras in the widest claim shape) ✓ stated.

The one thing I would add is a *control* note, not a capability: since the claim is the only way a vault can exist without a vote, and a single live vault makes `need_key = ⌈0.5·1⌉ = 1`, the capture outcome in SPEC 46(2) is not merely "their vaults would be the whole electorate" — **one admitted claim is a one-vault electorate that carries every action, including both key changes, alone.** SPEC says this in substance; saying it in that arithmetic form would make the ruling's cost unmistakable.

---

## R6. One-time configuration and the trusted hop

I re-derived every `initialize` bound. All are present and correct: `max_sweep ∈ [1, 50] SOL`; `cooldown ∈ [1 s, 24 h]`; `cooldown_ceiling ∈ [cooldown, 7 d]`; `sweep_floor ∈ [0.1 SOL, max_sweep]`; `reserve ∈ {0} ∪ [RENT_EXEMPT, reserve_ceiling]`; `reserve_ceiling ∈ [max(reserve, RENT_EXEMPT), 10 SOL]`; `notice ∈ [60 s, 30 d]`; `monthly ∈ [60 s, 30 d]`; `redeem_window ∈ [10 s, 24 h]`; quorum `∈ [500, 10000]`, threshold `∈ (5000, 7500]`, voting `∈ [60 s, 30 d]`; caps all non-zero and summing `≤ max_supply`; charter window non-empty, `≤ 90 d`, not already over; `pob_root ≠ 0`; `bank_treasury`, `swap_operator`, `payment_mint ≠ default`; `payment_mint ∈ SEAL.reserves`; `cbob_mint` a live classic SPL mint that is neither cbBTC nor $GARY; boost ceilings `∈ [1,12]` and `[1,63]`; the collection clean, unminted, update authority = MINT's PDA; `last_distribute_at = max(now, charter_closes_at)`.

**Royalty: confirmed immutable.** Our programs' only Core CPIs after `initialize` are the Attributes update (asset-level, hardcoded plugin type), SEAL's `PermanentFreezeExecute` toggle, `CreateV2`, and the two burns. Nothing ever touches collection royalties again, `initialize` runs once, an asset-level override needs the update authority (R.8, 0x1a), the plugin authority is `None` so Core refuses update (R.6), removal (R.6a) and **re-delegation** (R33.G3, 0x1b) — the last now pinned with a control that lands.

**Swap operator worst case, bounded:** `min(revenue_balance − reserve, cap) × (windows elapsed before the guardian stops)`, royalty SOL only, never cbBTC, the pool, a vault or sale proceeds; replacement needs half of all live vaults plus 7 days; the guardian can stop instantly and cancel a pending replacement. That is limit 10, confirmed.

**Redemption cap: confirmed to be exactly a rolling window.** `k = min(max(cap,1), 64)`; the k-th most recent entry is at `(head − k) mod 64`; a redemption lands only if that entry is a full window old, and then writes `now` at `head`. Therefore no window of `redeem_window_secs`, starting anywhere, contains more than the cap in force when its last member landed. The ring makes it stricter above 3,047 live, never looser, and `checked_sub` on a backwards clock fails closed.

### LOW — F6. There is no read-back-and-verify step between `initialize` and removing the upgrade authority — and that is the only window in which a wrong one-time value is fixable

**Construct.** SPEC road step 10 initializes the four programs; step 11 removes the upgrade authority from all five. Neither step requires dumping the four configs from chain, decoding them, and diffing them against `launch/mainnet-init.json`. Item 38 already notes that `check-launch-params.mjs` "validates the JSON, not the signed transaction", and that the **guardian, swap operator, sweep cap, cooldown and SOL reserve are not on the alarm's production list** — so for their *exact ruled values* the pre-signing check is the only gate, and after writing the alarm judges only bounds on two of them.

**What this costs.** `initialize` is once-only: a wrong value cannot be corrected by re-initializing. It can *only* be corrected while the upgrade authority still exists (by shipping a corrective instruction). Removing the authority is therefore the irreversibility event for the *values*, not just for the code — and nothing in the road places a verification between them. A transposed swap-operator key, a 1-second cooldown, or a 50 SOL cap would be permanent and (for three of those five) never paged against its ruled value.

**Evidence if I am right.** No step, script or gate reads the four configs back and compares them to `launch/mainnet-init.json`. I looked: `check-launch-params.mjs` reads the JSON; the alarm's `test_value_in_production` covers the listed values only; `config_drift` fires on later *changes*, not on a wrong initial write of the five.

**Fix (procedure, no code under the freeze).** Insert step 10b: dump all four config accounts, decode them with a reader written **from SPEC's offset table rather than from `bank/layout.mjs`** (so a layout bug cannot hide a config bug), diff every field against `launch/mainnet-init.json`, publish the four `initialize` signatures and the diff, and make a clean diff a precondition of step 11. Round 33's A10 lists "initialize read-back" as open launch work; what is missing is the **ordering constraint** and the independent decoder.

---

## R7. Cross-program raw reads — every offset recomputed, all correct

I rebuilt each layout from the struct definitions byte by byte. No discrepancy.

`MintConfig` (data ends at **1005**, space `1005 + 256 = 1261` ✓ matches the `MINT_CONFIG_SPACE` expression summed term by term): version 8, collection 9, **governance 41**, **pool_ata 73**, round_id 105, price 125, **minted_total 141**, bank_treasury 157, split_bps 189, **sales_stopped 191 / sweep_stopped 192**, guardian 193, swap_operator 225, **sol_reserve 257**, bump 265, **max_sweep 266**, **cooldown 274**, last_sweep 282, level_caps 290, level_minted 310, revealed_total 330, payment_mint 338, pob_collection 370, pob_root 402, charter_opens 434, **charter_closes 442**, charter_claimed 450, **bare_burns_retired 454**, total_weight 462, active_count 470, acc 478, owed 494, last_distribute 510, **sales_stopped_at 518 / sweep_stopped_at 526**, pending_op 534, pending_op_at 566, monthly 574, pending_guardian 582, pending_guardian_set 614, pending_guardian_at 615, notice 623, **sweep_floor 631 / cooldown_ceiling 639 / reserve_ceiling 647**, dist_epoch 655, pending_count 663, pending_this_epoch 671, cbob_mint 679, **max_boost_weight 711 / max_boost_epochs 712**, boost terms 714–725, boosts_active 725, boosts_due 729, boost_weight_total 733, cbob_burned 741, ring 749–1005.

Every constant in GOV (`OFF_MINT_*`), BURN (`OFF_MINT_MINTED_TOTAL`, `OFF_MINT_BARE_RETIRED`) and the suite matches. GOV's length guard `≥ OFF_MINT_MAX_BOOST_EPOCHS + 2 = 714` and BURN's `≥ 462` are both satisfied.

`VaultRecord` 221 = disc 8 … carry_scaled 195..211 + 10 padding ✓, with `mint_index 41` as GOV reads it. `BurnConfig` 827 with `burned_total 42` and `rate_ring 59..571` ✓. `SealConfig` 398 with `collection 9`, reserve `Vec` length at **41** ✓. `GovConfig` 350 with `proposal_count 53` ✓. `Proposal` 259 = exactly the declared space, and `ACTION_MAX_BYTES = 37` is the true maximum (`Brakes` = 1+3+33).

Sweep helper's raw read (mint 0, owner 32, amount 64, len 165) is correct for classic SPL, and I confirmed the uninitialized case fails safely (zero owner ≠ signer).

Every one of these reads is additionally pinned by discriminator **and** a first-field `version` byte, and all four versions are asserted in-suite against the live accounts (3.1u–3.1w, 3.1v). This is the strongest part of the tree.

---

## R8. The suite, the simulation, the build

**Arms that cannot fail:** I found no *new* vacuous arm. The class round 33 dispositioned as A7 (`C.2`, `S2.*` and friends, where a failure throws out of `main` into `FATAL`/exit 2) is still present; it produces no false pass and I am not re-filing it. The `because()` coverage is genuinely dense — I checked ~90 negatives and found every one pinned, including two I expected to be wrong and are not (`6.23e → TightenOutOfBounds`, which is right because GOV's `Loosening` check passes for `x=0`; and `SR.12a/SR.12b`, which together distinguish the duplicate-source refusal from the source-owner guard).

**Claims in this prompt that no arm exercises** (all are already on round 33's A10 list except where noted): wSOL as a source; a non-ATA destination pair; a destination wallet that is another vault's asset-signer; `pob_extra = 8`; a 30-record `expire_boosts` (`MAX_EXPIRE_BATCH` is 30; the only CU measurement is at 20 and the only packet arm `BO.18a` is at 20); and — not on that list — **the three seal plugin-authority operations of F1**.

**Dead test files.** `tests/probe-round5.test.ts` and `probe-round5b.test.ts` are tracked, bundled and never invoked by `run-tests.sh`; the first calls `initialize` with v5 argument lists and would fail if run. They contain the *only* in-tree assertions for measured fact 4 (Core's `BurnV1` does not sweep the signer PDA) and for the Token-2022 ATA lengths — though the latter is now independently gated against the real mints by `probe-mainnet-facts.mjs`. Recommendation: port D4.2/D4.3 into the gated suite and delete or clearly quarantine the rest, so no future reader mistakes them for live evidence. **INFO.**

**Bytes that are not proven to be the bytes the suite ran.** Confirmed as honestly disclosed: for SEAL/MINT/BURN/GOV, `build-mainnet.sh` proves only that the mainnet artifacts **reject** the localnet test key for the `NotTheInitAuthority` reason specifically and that the localnet ones accept it, plus a source grep for Gary's key; its own banner says "NOT PROVEN that the compiled constant IS that key". The sweep helper is the one program with a byte-identity proof, three ways (`dist/` ≡ `$CACHE/ln` ≡ `target/deploy/`, the last being the file the suite and sim actually deployed), with a clean-tree gate. The bridge for the other four is reproducibility, which only an independent rebuild by a second party closes.

### LOW — F7. `txread.mjs` is fail-closed with no recoverable path, and round 29's repair was applied to one trigger rather than to the class

**Construct.** `validateParsedTransaction` refuses, permanently and unconditionally, on a list of *structural* conditions: duplicate account keys (`keys.size === accountKeys.length`), `innerInstructions` not an array, `logMessages` not an array, a v1 message carrying a lookup-table-sourced key, `parsed.info` not an object for any instruction of the four money programs. Per SPEC's reader boundary, such a transaction is reported as `tx_unreadable` and **the scanners keep their cursors**. A refusal that is permanent therefore stalls that program's cursor forever: every later CBOB event line (a `CBOB_REVEALED`/reschedule, a `CBOB_CLAIM_DEFERRED_FROZEN`, a `CBOB_REDEEMED`, a sweep) is never read, while the alarm pages HIGH every 30 minutes with nothing a human can do but patch the reader.

Round 29 M1 found exactly this shape for log truncation — "anyone can cause it for one fee" — and repaired **that trigger** with an opt-in flagged delivery, a recorded gap, and a cursor advance. It did not make the refusal *class* recoverable.

**What I could not establish, stated plainly.** I could not demonstrate a stranger-constructible permanent trigger. My strongest candidate is **duplicate resolved account keys**: I believe message sanitization does not dedupe (neither legacy, nor a v0 message that resolves a key from a lookup table which is also a static key), which would make it a one-fee permanent halt of the transaction scan for the named program. I am not confident enough in that runtime detail to grade this higher, and I am explicitly flagging it as the premise to measure rather than asserting it. The same applies to `innerInstructions: null`, which is plausible only on an RPC backend that did not record them.

**Evidence that would settle it.** Two measurements, both cheap: (1) build a raw legacy transaction with the same pubkey twice in `account_keys`, naming one of our programs as an unused account, send it to the local validator, and `getTransaction(…, jsonParsed, maxSupportedTransactionVersion: 1)` it — if the accountKeys come back with a duplicate, `validateParsedTransaction` throws; (2) run two alarm passes across that signature and observe whether the program's cursor advances. If (1) fails to land or (2) advances, this drops to INFO.

**Fix, independent of the premise.** Make the class recoverable rather than enumerating triggers: give every walking scanner the same opt-in it already has for truncation — deliver the transaction flagged `structurallyUnreadable`, run the instruction- and token-movement detectors on whatever validated (the account keys and program ids are the fields the detectors need, and they are validated before the strict checks), record the signature in `logGaps` under the existing human-reviewed-watermark discipline, page once, and advance the cursor past it. That keeps "unknown coverage is never silently passed" while removing "one stranger can blind the scanner permanently", which is the exact trade round 29 already made once.

---

## The four questions about the accepted limits

**1. Is any limit worse than stated?**

- **Limit 26** — yes, in mechanism, not outcome: see **F3**. Three distinct *groups* is not three distinct *leaders*, and a validator holding three consecutive rotations gets a free deterministic choice over all three hashes, with no block-content grinding and a schedule published an epoch ahead.
- **Limit 25** — yes, in width: see **F4**. A reschedule re-rolls every undrawn vault behind it in the FIFO, because the census is shared.
- **Limit 47 / round 25 D1** — yes, in one unstated direction: see **F5**. The snapshot's blind spot is documented upward (new mints) and not downward (voters redeeming after voting and before the change lands).
- **Limit 38** — not worse, but incompletely controlled: see **F6**. The missing piece is the ordering constraint (read-back *before* the authority is removed) and an independent decoder.
- **Limit 40** — not worse than stated, but the statement rests on one unmeasured leg: see **F1/MEDIUM**. Round 25 N3 reasons about `ExecuteV1`'s authority rule from Core source; nothing reasons about or measures Core's refusal of plugin-authority operations on the seal itself, which is the other half of the same dependency.
- **Limits 9, 27, 28, 29, 32, 34, 35, 36, 39, 41, 42, 43, 44, 45, 46, 48, 49, 55, 56** — I checked each against the code and found them accurate, including the sharper corrections (round 24 D4's "a paying claim reverts whole at a frozen pool"; round 24 D8's "live counts an unretired bare burn"; round 25 D7's narrowing of 44 for classic tokens; round 26 D4's correction of 42).

**2. Is anything listed as a limit not actually a limit, or already closed?**

- **Limit 36** is mildly over-inclusive: it lists a "DUE $CBOB boost" among the things that skip the in-line monthly run, implying a dependency on a vault's token account. `expire_boosts` needs **only** the records, so the gate is always clearable with no token account, no balance and no fee beyond the transaction. The limit is real (the run *is* skipped) but it cannot become a stall; the parenthetical should say so.
- **Limit 32**'s bound "the ring bounds the cap at 64, which covers live supply up to 3,047" is correct but the direction is worth stating once more in the text: above 3,047 the limit is **stricter**, which is the safe direction, and at the ruled 2,100 the ring is never the binding constraint.
- Nothing else on the ACCEPTED list is closed by something the author did not notice, as far as I can tell.

**3. Is any DISCHARGED item not actually discharged?**

- **Item 51 (the $CBOB boost)** — genuinely discharged on the arithmetic (R2b above) and on evidence (BO.*, the two host tests, the ring proof). Its residue is accurately disclosed.
- **Item 54 (compute at the widest host shapes)** — discharged, and I verified the one place it binds is still honest: `10.6a` pins the default-budget refusal to the measured cost rather than asserting a threshold, and `10.6b` re-measures the single-capture case with the SlotHashes length it walked, which is exactly the trap that bit round 25.
- **Items 12/17, 14, 19, 30, 31, 33** — discharged as stated; 19 in particular is closed *by construction* (`activate` refuses `NotRevealed`, so there is no activated-but-unlevelled state), which I confirmed in code rather than taking from the note.
- **The v5 family (1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24)** — the constructs they were about genuinely do not exist in this tree (no `bank: Signer`, no deck, no distributor, no `update_wiring`, no `handover_governance`), and `0.4*` pins their absence by `InstructionFallbackNotFound` rather than by a constraint error, which is the right discriminator.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?**

No. I checked each: **22** (no live distribution or revenue cycle — the road's step 8 still names its five pass/fail items), **38** (values; `charter_opens_at` and `lock_deadline` are still `null` in `launch/mainnet-init.json`, and `check-launch-params.mjs` refuses while anything is OPEN), **50** (surfaces unbuilt; the guide still carries its DRAFT publication bar), **52** (three cbBTC accounts and revenue rent), **53** (the rehearsal proof is stale at `d57ee3a` and the rehearsal value set is still unwritten). None has drifted into the accepted list, and SPEC still says so in each place. The two reader/scan boundaries are stated as boundaries with their costs, not as accepted defects.

---

## Anything else

- **HOLDER-GUIDE vs the code:** I checked every promise. I found no sentence the code does not keep. The 