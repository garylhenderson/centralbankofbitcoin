# INDEPENDENT AUDIT — v6, five programs, frozen tree with round‑31 repairs (`4ae79d6`/`dee953e`)

**Scope actually read:** all five programs in full, both Cargo manifests sets, `tests/3prog.test.ts`, `sim/test-vault.ts`, `sim/fixtures.mjs`, `sim/clone-pob.mjs`, `sim/run-sim.sh`, `tests/expiry-budget.mjs`, `tests/initauth.test.ts`, `tests/cpi-wrapper`, `tests/probe-round5*.ts`, `scripts/run-tests.sh`, `build-mainnet.sh`, `audit-coverage.sh`, `token-programs.sh`, `validate-core-gate.sh`, `rehearsal-tree.sh`, `pob-merkle.mjs`, `probe-mainnet-facts.mjs`, `bank/txread.mjs`, `bank/sigwalk.mjs`, SPEC, DESIGN-v6, HOLDER-GUIDE, RT3, round‑31 VERDICT and VALIDATION, `launch/mainnet-init.json`, `Cargo.toml`, `Anchor.toml`.

**Not read (so not claimed about):** `bank/detectors.mjs`, `alarm.mjs`, `selftest.mjs`, `crank.mjs`, `layout.mjs`, `accrual.mjs`, `revenue.mjs`, `swap.mjs`, `lock.mjs`, `redemption-poster.mjs`, `check-launch-params.mjs`, `cron-install.sh`. Where a conclusion depends on one of those I say so explicitly.

**Headline:** I could not break custody, the pairing, the pool invariant, the boost ring, the rate limit, or any cross-program raw read. I recomputed every offset and every account space from the struct definitions by hand and they are all correct. What I did find is one **MEDIUM** in the certification process (a launch gate the tree does not currently satisfy), seven **LOW**, and six **INFO**. One LOW is buyer-facing. Nothing here is a confirmed theft, unseal, or permanent-halt path.

---

## R0. Round 31's verdict and its repairs

I treated the bundled verdict as evidence. Result: **its three confirmed findings are repaired, with one surviving residue, and one of its own recommendations was only partially taken.**

| Round‑31 item | State at this tree |
|---|---|
| **L1** coverage gate credits a round whose verdict lacks three exact phrases | **Repaired** by `first_line_quorate()` in `scripts/audit-coverage.sh`, plus eight both-ways selftest cases. Residue below (F5). |
| **D1** prompt names the wrong prior round | **Repaired.** This round's prompt says "ROUND 31 READ THIS TREE BEFORE YOU" and bundles round 31's verdict. |
| **D2** `probe-mainnet-facts.mjs` usage line names a deleted file | **Repaired.** The bundled docstring now reads `node scripts/probe-mainnet-facts.mjs`. |
| Round‑30 **M1/L1/D1/D2/T1** | All present. `sigwalk.startBefore` exists; SPEC 672/item 49/DESIGN‑v6 191‑194 carry 1,772,920 mainnet / 2,429,040 validator (I re-derived both: 128×5080=650,240 and (221+128)×5080=1,772,920; 128×6960=890,880 and 349×6960=2,429,040 — correct); DESIGN‑v6 380 says 209 h / 8.7 days; `build-mainnet.sh:191-196` attaches "by reaching a check below" to the localnet arm. |

I also verified round 31's two most load-bearing refutations by reasoning, and both look right: **W1** (no reachable owner shape can starve Core's heap on the FIFO-head reveal) is consistent with the 10,240-byte CPI data ceiling and with `tests/cpi-wrapper`'s own `len > 10_240` guard; **W2** (Anchor `init` and the ATA program both survive a pre-funded address) is consistent with `generate_create_account`'s top-up/allocate/assign sequence and is pinned in the suite for one `init` site (7.12d).

**But both refutations live only in `.cache/triage31p/` — untracked scratch — and neither is a suite assertion.** That is F1 below, and it is a direct violation of a stated launch gate.

**Round 31's own L1 repair recommendation was taken as the fallback, not the primary.** It asked for "a structured quorum record (for example `audits/roundN/QUORUM-<focus>.json`) … Failing that, require a positive `QUORUM MET` on line 1". The fallback shipped. That leaves the gate's entire quorum evidence as one self-written line, and leaves the two holes in F5.

---

## F1 — MEDIUM. Ship-gate condition 5 is not satisfied: the measurement that refuted the highest-severity claim of round 31 is not in the suite

**Construct:** SPEC "THE SHIP GATE", condition 5: *"Every REJECTED finding that could be measured is an ASSERTION in the suite … we do not win the argument and move on, we convert it into a permanent test."* All five gates "must hold at once."

Round 31 refuted a HIGH (two independent auditors: an owner-shaped vault starving Core's heap so MINT's reveal can never land, halting the FIFO for every later vault, permanently, on an immutable program) by building a calibrated Core shape and measuring the 10,198-byte autograph maximum and a landing reveal at 41–48k CU. It then wrote: *"Optional: pin this shape as a suite arm."* The same for W2 (pre-funded config PDAs and ATAs).

**What an attacker or an accident gains:** nothing directly. What is lost is the gate's purpose. The largest permanent-halt question in the tree is currently answered by a file that is not in the repository, cannot be re-run by `run-tests.sh`, and will not turn red if a future change (or a Core upgrade re-pin) makes the claim true again. The suite's largest autograph arm is **10,150** bytes (R28.A1), 48 bytes short of the measured maximum, in a region where round 28's own text says *"the asset's shape decides the outcome."*

**Evidence that would exist if I am right:**
- `grep -rn "10198\|10,198" tests/ sim/ programs/` → no match. The only large-autograph constant in the suite is `const length = 10150`.
- `.cache/` is not tracked (it is the suite's scratch directory used by `run-tests.sh`), so `triage31p/heap.mjs` and `squat.mjs` are absent from any commit.
- No arm anywhere pre-funds a *config* PDA, a *vault record* PDA, or an *ATA* before creating it; 7.12d covers only `Proposal`.
- SPEC's own gate-5 text, quoted above, with "All five must hold at once."

**Fix:** three arms, each cheap, before the freeze is declared:
1. `R31.W1`: the maximal shape (640-byte stored attribute list, 64/200 name/uri, five owner-managed plugins, a 10,198-byte autograph on the FIFO-head vault) reveals and writes the level; and 10,199 is refused by the runtime, not by Core.
2. `R31.W2a/b/c`: a stranger dusts SEAL's config PDA / a vault-record PDA / a reserve ATA address, and `initialize` / `mint_vault` / `createAssociatedTokenAccount` each still land.
3. Add a line to each future VERDICT mapping every refuted-by-measurement claim to the arm id that now pins it, so gate 5 is mechanically checkable rather than remembered.

---

## R1. Custody: can anyone but the owner get value out, or an emptied vault survive?

I attacked the pairing from every direction the prompt names and could not break it. Recording the reasoning so it can be checked:

**The pairing.** `open_for_redemption` walks `current+1 …` for a top-level `cbob_vault_burn::burn_vault` matching `accounts[0] == asset` **and** `accounts[2] == owner`; `burn_vault` walks `0 … current` for a top-level `open_for_redemption` matching the same two. Both use `load_instruction_at_checked`, which sees top-level instructions only and reports the *outer* index for a CPI'd caller. The four wrapper shapes:

| shape | outcome | why |
|---|---|---|
| CPI'd open + real top-level burn | **reverts** | SEAL thaws (its `current` is the wrapper's index, and a real burn follows), then BURN's backward walk sees the *wrapper's* program id at that index, not SEAL → `NoPrecedingOpen`. Whole transaction reverts, thaw included. (WR.3) |
| real open + CPI'd burn | **reverts** | SEAL finds no top-level BURN → `NoTerminalBurn`. (WR.2) |
| both CPI'd | **reverts** | same as above. |
| `retire_redeemed` through a wrapper | **reverts** | `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1` plus "the top-level instruction at `current` must be BURN's `burn_vault` for this asset" ⇒ the only program executing at height 1 is BURN. (WR.1) |

**Two vaults in one transaction** (open A, open B, sweep A, sweep B, burn A, burn B) is permitted and correct: each open binds its own asset+owner and each burn binds its own open. Nothing can be borrowed across the pair (3.9, 3.10, 9.0, S9b).

**Transfer-inside-the-thaw** fails closed: SEAL requires the *burn instruction's* `accounts[2]` to equal the signer who opened, and BURN re-reads the asset's live owner bytes. So `open(alice) → transfer to bob → burn(bob)` cannot satisfy SEAL, and `open(alice) → transfer to bob → burn(alice)` dies in BURN with `NotTheOwner`.

**Emptiness proof.** The reserve loop requires both ATA derivations of every SEAL reserve mint to be declared, then for any token-program-owned declared account whose `owner` field is the asset signer: exactly 165 bytes (`ReserveHasExtensions`), delegate COption zero, `delegated_amount` zero, close-authority COption zero, `amount == 0`. The second loop re-applies the same six checks to *every* declared token account owned by the signer, and refuses any declared live Core asset. `lamports() == 0` on the asset signer is checked first. `declared` must equal `remaining_accounts.len()`.

**The two structural gaps are exactly the ones SPEC names and no wider:** a non-ATA token account, a Token-2022 account that is not at a required address, and a nested Core asset are *not read* unless the redeemer declares them, so they are destroyed (limits 9, 44), not a block. I confirmed a stranger cannot turn them into a block: `continue` on a non-token-owned declared account also means a lamport-only squat at an ATA address is skipped, and the three ways to *reach* a required address are all closed (the ATA PDA can be created only by the ATA program; a Token-2022 ATA for a classic mint is refused, probe F4.2; a classic ATA is always 165 bytes).

**Nothing leaves a thawed vault alive.** `set_frozen(true)` is never called anywhere — `core_plugin_cpi` has exactly one caller and it passes `false`. So there is no re-seal path, and a thaw that does not end in `BurnV1` reverts with the whole transaction.

**Verdict on R1: holds.**

---

## R1s. The sweep helper

### (a) Who can make it move value

Called directly it needs `signer.is_signer`, and every source must have `owner == *signer.key`. The asset-signer PDA is off-curve and derived under Core, so only Core can sign for it (SR.1, pinned to *missing required signature*). Through Core, the gate is Core's `ExecuteV1` authority rule, which round 25 measured on the pinned binary: owner only (SR.5 stranger `0x1a`, SR.5a owner-added transfer delegate `0x1a`, SR.5c collection update authority `0x1a` on a control asset, SR.5d the control owner succeeds). The CBOB collection's update authority is MINT's off-curve PDA (SR.5b), and MINT has no `ExecuteV1` CPI at all (its only Core CPIs are `CreateV2`, `AddCollectionPluginV1`, `UpdatePluginV1`, `BurnV1`), so even a Core change that approved the collection authority would have no key to use it. **Reachable while frozen: no** — Core refuses any `ExecuteV1` on a frozen `PermanentFreezeExecute` (3.7 pins `0x9` with the signer *proved to be the owner* and the seal *proved frozen*; S6.2 pins it to Core).

### (b) The pair list — every case the prompt names

| case | behaviour | pinned? |
|---|---|---|
| same source twice | pair 2 reads a closed (system-owned) account → `IllegalOwner` | SR.12a, and SR.12b proves it fired at the *second* source, not the first guard |
| destination twice | allowed, both credit the same account, same mint required | no arm |
| source is also a destination | impossible: pair 1 needs `to_owner == dest`, pair 2 needs `src_owner == signer`, and `signer != dest` | by construction |
| native wSOL source | works: `amount` moved as wSOL, then `CloseAccount` unwraps the remaining lamports to `dest`; nothing lost even if `SyncNative` was never called | **no arm** |
| source with a delegate | irrelevant: the authority used is the owner, not the delegate | — |
| source with a close authority | `CloseAccount` fails → reverts. Unreachable by a stranger (`SetAuthority` needs the PDA's signature, which needs a thaw, which needs a burn) | — |
| frozen source with a balance | transfer refused → reverts | SR.14 (`0x11`) |
| frozen source at zero | closed successfully (spl-token's `CloseAccount` has no frozen check) | round 30 off-chain measurement |
| destination not an ATA | accepted; only mint + owner + 165 bytes are checked | **no arm** |
| destination wallet = this asset's signer | refused (`InvalidArgument`) | SR.10 |
| destination wallet = **another vault's** asset signer | **accepted.** The sweep would move everything into another vault, where that vault's owner can redeem it. Only the owner can do it; it is a gift, not a theft | **no arm** |
| zero pairs | lamports-only sweep, works | SR.13 |
| odd account count | `NotEnoughAccountKeys` | SR.7 |

### (c) Destination checks — see **F2** below

### (d) The lamport sweep

`signer.lamports()` is read **after** every `CloseAccount`, and the closes credit `dest`, not the signer, so nothing re-funds the account mid-instruction. Inside one atomic transaction no later top-level instruction can be inserted by anyone but the transaction's own author. Core itself leaving lamports behind is excluded by measurement (SR.4 and S8.3 both read the PDA at exactly 0 and BURN's `lamports() == 0` then passes). SR.4a is the strongest arm in the suite: it reconciles the owner's exact SOL delta against the stranger's gift + the wallet's prior balance + the closed account's rent + the asset's rent refund − the fee, and cross-checks the helper's own `CBOB_SWEEP lamports=` line.

### (e) Interaction with the emptiness proof

A swept-and-closed reserve ATA passes BURN's reserve loop through the `acc.owner` branch (`continue` for a non-token-owned account). That is the right outcome but technically the *wrong branch* — it passes because the account no longer exists, not because `amount == 0`. Harmless, because non-existence is strictly stronger.

**The stranger-squat question:** if a reserve ATA does not exist when the page builds the transaction, the helper cannot name it (`read_token` refuses a non-token account), and anyone can then create that classic ATA permissionlessly and deposit one base unit. BURN requires it *declared* and would then see `amount == 1` → `VaultNotEmpty`. SPEC's prior-transaction step (create all three vault reserve accounts first) **is sufficient**, and even without it a single retry closes it, because once the ATA exists the helper reads its live balance. I looked for an account a stranger can create that neither the sweep can name nor BURN will skip and found **none**: the Token-2022 derivation for a classic mint cannot be created (probe F4.2), a non-ATA token account is never a required address, and a nested Core asset is only refused when declared.

### (f) Does it fit?

S8.0 measures `claim + open + Core ExecuteV1(helper, 3 pairs) + burn` at **1,061** bytes and asserts `B ≤ 1232 − 52 − 96`. I re-derived the two allowances: a separate fee payer is 32 (key) + 64 (signature) = 96; `setComputeUnitLimit` + `setComputeUnitPrice` is 32 (the ComputeBudget key) + 8 + 12 = 52. So the widest page shape is ~1,209 with **23 bytes spare**. What that means concretely, and is worth stating in the page contract:

- **A fourth reserve is impossible** (`MAX_RESERVE_MINTS = 3` in both SEAL and BURN, 9.15/9.16), so that term is not a risk.
- **The in-line monthly run's accounts are already in the measurement** (`POOLK` rides in both `ixPoolClaim` and `ixBurn`).
- **Zero extra token pairs fit the widest shape.** Each stray-token pair costs two fresh account keys (64 bytes) against 23 bytes of headroom. So item 50's "offer to rescue stray CLASSIC tokens" and limit 44's sweep-list reading are achievable **only in the narrow owner-payer shape without compute-budget instructions** (1,061 + ~64 per pair). That is consistent with round 31 A13 but the page contract in item 50 reads as though both are simultaneously available; it should say which shape buys which capability.

### (g) Evidence quality

SR.0–SR.14, SR.5a–5e and S8.0–S8.3 are genuinely adversarial and every negative is pinned to the exact runtime or program error measured on the pinned Core binary. I found no arm that cannot fail and no negative pinned to the wrong reason. `build-mainnet.sh` proves the helper's mainnet bytes are byte-identical to both the fresh localnet build and `target/deploy/cbob_vault_sweep.so` (the file the suite and the sim actually deployed), and the crate deliberately declares no `localnet` feature so the metadata hash matches. **That chain is complete for the helper and incomplete for the other four — see F4.**

---

## F2 — LOW. The sweep helper binds neither its signer nor its destination; `dest.is_signer` would bind both at zero packet cost

**Construct:** `programs/cbob-vault-sweep/src/lib.rs`, `process()`. The only checks on the two control accounts are `signer.is_signer` and `signer.key != dest.key`. There is no check that `signer` is a Core asset-signer PDA, and no check that `dest` is the asset's owner or even a signer of the transaction.

**Two consequences, both hardening rather than capability:**

1. **The redeem page is fully trusted with the destination of every redemption.** A compromised or malicious client can route the entire contents of a vault plus every lamport of its wallet to an attacker, in one instruction with no amounts in its data (`data = [0]`), and the holder's signature is the only thing required. The holder guide tells holders to use only the Bank's page, so this is the project's own supply chain. It adds no capability — the same client could emit three `Transfer`s and a `SystemProgram::transfer` — but it makes the malicious instruction small, amount-free, and indistinguishable from the honest one.
2. **It is a general "drain the signer" primitive for anyone, immutably.** Any wallet that signs it with an attacker's `dest` has every named token account emptied and closed and its **entire SOL balance** moved to zero. Again, not a new capability (wallet simulation still shows the deltas), but a permanent, convenient one.

**Evidence that would exist if I am right:** a transaction in which `accounts[0]` is an ordinary funded keypair (not a Core asset signer), `accounts[1]` is an unrelated address, and the pairs name that keypair's ATAs, lands and leaves the keypair at 0 lamports. Nothing in the program refuses it; the suite has no arm either way.

**Fix, and its cost, honestly:**
- **`if !dest.is_signer { return Err(MissingRequiredSignature) }`** — **zero extra bytes.** In the intended flow the destination is the owner, who already signs the transaction (Core requires it for `ExecuteV1`), so its `AccountInfo.is_signer` is already true. This confines the destination to a signer of the transaction, which kills both consequences for any destination the holder did not sign for, and it matches SPEC's own canonical rule ("the canonical destination is the owner, who pays the fee and so exists").
- Pinning `signer` to `find_program_address(["mpl-core-execute", asset], CORE)` is the stronger fix but needs the asset account in the inner instruction; depending on how Core encodes `ExecuteV1`'s inner accounts that is up to 32 bytes against 23 bytes of headroom in the widest page shape, i.e. it would force the narrow shape. Measure before choosing.
- Both are only possible before the lock. If neither is taken, say in SPEC that the redemption client is a trusted component for the *destination* of every redemption, which no current sentence does.

---

## R2. The community pool's money

I attempted to break the invariant and the counters by hand. Both hold.

**Invariant `balance ≥ ceil(owed_scaled / ACC_SCALE)`.** The only ways the two sides move:

- `credit(avail, w)`: `delta = floor(avail·S/w)`, `owed += delta·w ≤ avail·S`. Since `avail = balance − ceil(owed)`, the new `ceil(owed) ≤ ceil(owed) + avail = balance`. Holds.
- `claim`: pays `pay` sats and subtracts exactly `pay·S`, so `ceil(owed)` falls by exactly `pay` as the balance falls by `pay`. Holds with zero slack change.
- `retire` (all three flavours, including the frozen-pool forfeit): subtracts the vault's `pending` from `owed` and moves nothing. Slack grows.
- Deposits and `split_revenue`: balance up only.
- **Nothing else can move cbBTC out of the pool.** The pool's authority is MINT's config PDA, which signs exactly one CPI in the whole program (the `Transfer` in `claim`). There is no `CloseAccount` on the pool anywhere.

**`owed_scaled` equals the sum of live owed, exactly.** `credit` adds `delta·weight_i` to each live vault and `delta·W` to the total; `claim` subtracts `pay·S` from both sides; `join` adds a vault at `debt = w·acc` so its `owed_of = 0` and the total is untouched; `reweigh` moves the owed share into `carry` and resets `debt = after·acc`, so `owed_of` is preserved to the scaled unit and the total is untouched; `retire` subtracts exactly `pending`. The `carry` is added *before* the debt is subtracted in `owed_of`, which is what makes a weight *decrease* safe without a negative debt. The suite's `ledger()` recomputes this from every record after every money operation (BK.IN / BK.3c / BK.P), and `credit`/`join`/`retire`/`reweigh`/`expire_boost`/`tick`/`advance_epoch` are driven through the program's own free functions for 260 epochs in the host test with the model rebuilt from records only. That is the strongest evidence in the repository and I accept it.

**Counters, under every ordering I could construct.** `pending_this_epoch` is reset to 0 by `advance_epoch` and decremented in `retire` only when `request_epoch == dist_epoch`. Because epochs are monotone, `request_epoch == dist_epoch` implies the request was made in the current epoch and therefore contributed to the current `pending_this_epoch`; so the conditional decrement is sound and `pending_this_epoch ≤ pending_count` always, which means `waiting_to_join`'s `checked_sub` cannot underflow. I walked four interleavings (request/advance/request/retire in each order) and all four stay consistent. F21.1/F21.2 pin the two retire-while-waiting cases.

**Liveness: nobody can make distributions or redemptions impossible for others.**

- `JoinWaitingFirst` can never deadlock: `waiting_to_join` only becomes non-zero *after* an epoch advance, at which point `dist_epoch > request_epoch` so every waiting vault is joinable, and joining is free, permissionless, and needs only the record plus the recorded ATA **address** (the account is never read on the join path). `join`'s `LEVEL_WEIGHTS[r.level-1]` cannot underflow because `activate` refused `level == 0` before setting `pending`.
- `BoostsExpireFirst` can never deadlock: every unit of `boosts_due` corresponds to a live boost on an active, non-retired record, and `expire_boosts` needs **only the records** — no token account, no pool, no asset. A bare-burned-but-unretired vault is still expirable.
- A griefer *can* permissionlessly `activate` other people's funded, revealed vaults, which creates waiting vaults. But because the request lands in the current epoch, `waiting_to_join` stays 0 for the current distribution, and the cost is one join per vault — which is what the protocol wants anyway. Not a vector.
- `claim` reverts whole if a named destination is not a live 165-byte classic token account at `r.vault_ata`, but a third party cannot make that true: the recorded address is canonical, can only be created by the ATA program, and can only be closed by an `ExecuteV1` that also burns the vault.
- Redemptions: the rate limit is self-costing (each slot consumed burns one of the attacker's own vaults, and the check runs only *after* `NoPrecedingOpen`, so no one can consume budget without a valid owner-signed open); lamport squats are handled live by the helper; the ATA squat needs at most one retry.

**On round 24 W11 (SPEC's weaker rule).** SPEC's statement is the accurate one: a vault is never credited by a distribution that ran before it joined, but revenue already sitting in the pool when it joins is shared at the next distribution, the new vault included. I attacked SPEC's version: the best play is to fund 21,000 sats, join before a large backlog is distributed, collect `w/W` of it, and redeem. That is precisely the launch design (the first cohort shares the charter-window backlog) and the join gate forces the buyer to miss one distribution first. Limit 55 bounds the one remaining edge (unsplit revenue) at 100–200 $GARY plus crank-pass-sized exposure. **Not worse than stated.**

---

## R2b. The $CBOB boost

Every property the prompt asks for holds, and I can state why rather than cite a test:

- **Exactly N distributions, not one more.** `end = dist_epoch + epochs` with `epochs ≥ 1`. The boost's weight is in `W` for the distributions at epochs `e+1 … e+N`. `advance_epoch` at `dist_epoch == end` drains that ring slot into `boosts_due`, and `distribute` / `monthly_inline` both refuse to credit while `boosts_due > 0`, so no (N+1)-th distribution can occur before expiry. Measured on both sides: BO.21 (`[boost, distribute]` counts the one it rode in on, ending at `e+N`) and BO.35 (`[distribute, boost]` ends at `e+1+N`). Both are correct.
- **Nothing lost or gained on a weight change.** `reweigh` is `carry := owed_of(acc)`, `debt := after·acc`, `W += after − before`; `owed_of` is invariant and `owed_scaled` is untouched. Claim normalisation uses the same algebra (`carry := pending − pay·S`, `debt := weight·acc`). Retirement sets `debt := w·acc`, `carry := 0` on a record that is never read again.
- **The ring cannot collide, including past epoch 64.** Because no distribution may pass a due boost, at any instant every live boost has `end ∈ (dist_epoch, dist_epoch + 63]` — a window of 63 distinct values, so no two live ends share `end mod 64`. `MAX_BOOST_EPOCHS_BOUND = BOOST_RING − 1 = 63` is exactly what makes this true, and `initialize` plus `set_boost_terms` both clamp to it. The 1000-epoch and 260-epoch host tests, with per-slot assertions against a model built from the records, are the right evidence.
- **No record expired twice, early, or never.** `expire_boost` requires `boost_weight > 0 && dist_epoch ≥ end`; `reweigh(0)` zeroes the weight so a second attempt is skipped (batch) or `BoostNotDue` (never re-decrements); `unschedule_boost` branches on due-vs-not so each boost leaves exactly one counter. `boosts_due` cannot strand because the gate forces expiry before any further distribution and `expire_boosts` needs no token account.
- **Totals agree.** `ring_sum + boosts_due == boosts_active`, `boost_weight_total == Σ boost_weight`, `W == Σ weight_of` — all three are asserted per ring slot in the host test and per money operation in the suite.
- **Nobody can block distributions by boosting or by a dead token account.** Covered above. `expire_boosts`'s 30-record batch, `tests/expiry-budget.mjs`'s twenty distinct due boosts under the default budget (`49,xxx` CU, 21 keys, under 1,232 bytes) and the honest scoping of that gate ("synthetic genesis, not twenty lifecycles") are all sound; I re-derived its fixture arithmetic (`W = 20×14 = 280 → 40`, `owed = 20×140·S`) and it is internally coherent.

---

## R3. The level draw

**SlotHashes parse:** key pinned to the sysvar id, count bounded at 512, buffer length checked against the declared count, all-zero hash refused rather than fed into a draw. Correct and defensive.

**Skipped slots and the deadline.** A = smallest produced slot in `[reveal_slot, +64]`; `want_B = (A/4 + 2)·4`; B = smallest produced in `[want_B, +64]`; same for C. Worst case `C ≤ reveal_slot + 214`, inside the 300-slot window, and A is at most 300 slots old when the window closes, inside the 512-entry buffer. The deadline is set by the *earliest* hash and it is always satisfiable. The host tests exercise skips placed exactly on A, on B's group start, on C's, and on all three, against an independent model — which a validator can never produce.

**FIFO.** `require!(index == revealed_total)` plus the fact that each draw mutates the census means the *sequence* of draws is fully determined once all entropies are captured; nobody gets two outcomes to choose from, and nobody behind a stalled vault can be drawn first (L.16a). A burned vault at the head still draws and skips the Core write, so the queue never stops at it (L.11, and `is_burned` is positive: Core-owned, one byte, `Key::Uninitialized`).

**Attribute re-supply.** The caller supplies the list, hashed against `attrs_hash` stored at mint; the Core write is skipped entirely for a burned asset, so the hash check is bypassed only where nothing is written. The 640-byte budget (`MAX_ATTR_BYTES`) is enforced at mint and L.12/L.12a/L.12b prove a vault at exactly the budget reveals in a legacy transaction while one byte more is refused at mint. Round 31's W1 measurement closes the remaining "can an owner make the reveal impossible" question; F1 is that it is not pinned.

**Who can influence what.** A minter: one re-roll per window of total silence (limit 25), and only if nobody who names the record sends a capture. A crank operator: can withhold a capture, which is the same lever. A slot leader: limit 26.

**Is C worse than SPEC 26 says?** SPEC says C's leader "can CHOOSE AMONG MANY DRAWS" and that "three different leaders is likely, not guaranteed" because one validator was seen holding two adjacent rotations. **The mechanism is broader than that sentence.** The leader schedule is public for a whole epoch, and with `ENTROPY_GROUP_STRIDE = 2` the three groups are `g`, `≥ g+2`, `≥ g+4`. A validator can scan the published schedule for a window in which it holds `g`, `g+2` and `g+4` and time a mint (or a reschedule, which it can also trigger) into it — at which point it produces all three blocks and can grind A, then B knowing A, then C knowing both. For a 3 %-stake validator the expected number of such triples per epoch is on the order of a few, so this is findable rather than lucky. **In outcome it is not materially worse**, because round 24 already measured C-alone at 96 % for a chosen level with 64 content tries. So: the *bound* in limit 26 is right; the *mechanism* sentence understates it. I would add one clause to limit 26 rather than change anything on chain (a VRF is the only real answer and is not ours).

**Does HOLDER-GUIDE say it truly? No — see F3.**

---

## F3 — LOW (buyer-facing). HOLDER-GUIDE under-discloses the measured magnitude of limit 26

**Construct:** HOLDER-GUIDE "The honest list": *"The level draw is fair, not perfect … the validator producing the last of those blocks can pick among several results, by skipping a block or changing what goes into it. That can be enough to choose the level of a vault created in the same moment (from the levels still left)."*

**What the measurement says** (SPEC limit 26, round 24 A1): skipping alone is best-of-4 and takes P(Level V) from **5.0 % to 18.6 %**, expected weight from **3.05 to 4.38**; adding content grinding, **64 tries reach 96 %**. SPEC calls this "selection within the levels still left, not a nudge" and marks the item BUYER-FACING.

**The gap:** "can pick among several results" and "can be enough to choose" read as a bounded nudge. 96 % is effective choice. A buyer deciding whether the Schedule of Vaults is a lottery or a selectable outcome needs the number, and the guide is the surface where that decision is made. The guide gives precise numbers elsewhere (10 SOL / 6 hours for the swap bot, 2.1 % / 45 an hour, the 1×–3× table), so the omission is asymmetric.

**Evidence that would exist if I am right:** the guide contains no percentage anywhere in the draw paragraph; SPEC limit 26 contains 5.0 %, 18.6 %, 3.05, 4.38 and 96 %.

**Fix:** one sentence in the honest list: *"Measured: a validator that is the leader for the last of those blocks can reach the level it wants about 96 % of the time for a vault created in that moment, and about 19 % for Level V by skipping alone against a 5 % baseline. Only a VRF would remove this, and no VRF we control exists."*

---

## R4. Governance

**What a vote can reach is structurally tiny and I could not widen it.** `execute_proposal` builds its CPI with exactly two accounts (`mint_config` writable, `gov_pda` signer) and `data` drawn only from the five action variants with hardcoded discriminators. There is no arbitrary-data path, and every governed handler uses `Governed { config(mut, seeds, has_one = governance), governance: Signer }`, so a governed instruction cannot touch a token account, a vault, or anything but the config. The gov PDA signs only inside `execute_proposal`. The split, both destinations, `max_supply`, the census, the royalty and the reserve list have no writer at all.

**Minority carry.** Ordinary actions need `max(ceil(21 % · snapshot), ceil(10 % · snapshot))` cast with ≥ 51 % YES, i.e. 10.71 % YES minimum (D.1 confirms the turnout rule is the binding one at other parameters). Key changes need `ceil(50 % · snapshot)` YES, never of votes cast, and may not be bundled (3c.K1, 3c.K2, 3c.K2p). The divisor is the creation snapshot, so vaults minted mid-vote neither vote (`VaultTooNew`) nor raise the bar — round 25 D1 already states this, including the 240→120 / 5.71 % arithmetic. I confirmed `quorum_supply` cannot underflow (a vault can be retired only once, `AlreadyRetired`, so `burned_total` and `bare_burns_retired` are disjoint) and that a zero snapshot fails closed (`need > 0`).

**Per-kind ordering and the skip.** `last_round_id` / `last_guardian_id` / `last_arm_id` / `last_boost_id` are set before any CPI and revert with it; a round already over still advances its mark (red-team 3 #4, 3c.R1); GOV's restart skip (`stops.*_at >= p.created_at`) is the exact boundary complement of MINT's `require!(stopped_at < proposal_created_at)`, so a GOV-executed restart can never hit `StopIsNewer`. `restart` deliberately leaves `*_stopped_at` in place and only re-stamps on a false→true transition (3b.S2), which is what stops a hostile guardian out-dating every restart vote.

**Can governance be frozen forever?** The three paths and their accuracy:
1. All vaults redeemed → no proposer. Round 24 D3's correction is right: a round still open under its cap with sales running can mint one, because `mint_vault` needs no live vault.
2. Stolen guardian key at low turnout → permanent stop of sales and the sweep (limit 47). Accurate as stated. The guardian cannot cancel a pending *guardian*, and `arm_guardian` has no apply-by deadline, so an armed replacement is applicable by anyone forever until another half-of-live vote supersedes it. SPEC states both facts.
3. Nothing else. SEAL and BURN have no governance; redemption, activation, distribution and claims read neither stop.

**Two things worth writing down, both LOW:**

### F4a — LOW. Limit 10's bound understates a hostile ordinary majority re-opening the sweep in parallel

SPEC limit 10 bounds the swap operator at *"per-sweep cap × cooldown windows until the guardian pulls `emergency_stop_sweep`."* That framing assumes the guardian wins the race. **`restart` is an ordinary action (10.71 % YES), not a key change**, and proposals are independent accounts with independent ids. A hostile minority can create *N* restart proposals simultaneously, carry all *N* in one 3-day window, and then execute them one at a time inside the 7-day execution window — each execution re-opens the sweep for exactly one cooldown before the guardian can re-stop. With the ruled values that is **10 SOL per executed restart proposal**, up to ~`N` × 10 SOL in a week, where the only limits are proposal rent (~0.0026 SOL each) and 10.71 % YES. `AlreadyExecuted` prevents re-using one proposal, but not stockpiling many.

*Evidence that would exist if I am right:* GOV has no per-kind limit on how many `Brakes{restart_sweep}` proposals may be open or passed at once, and no rate limit on `create_proposal`; `restart` is absent from the `key_change` predicate in `execute_proposal`.

*Fix (documentation, not code):* amend limit 10 to *"cap × (cooldown windows the guardian does not cover + restart proposals a 10.71 % vote passes)"*, and note in limit 47 that the guardian's sweep stop is a brake against the operator, not against the electorate. A code fix (making `restart_sweep` a key change) would need a ruling and would make the sweep harder to recover honestly; I do not recommend it.

### F4b — LOW/INFO. Governance has no proposal-creation limit and no cancel

One live vault plus ~0.0026 SOL of rent creates a permanent `Proposal` account that is never closed. A thousand plausible-looking `SetRound`-at-the-floor proposals cost ~2.6 SOL, persist forever, and must be triaged by voters on a surface that does not exist yet (item 50). It also lets a bot win the `[PROPOSAL_SEED, count+1]` race against an honest proposer repeatedly (the loser's `init` fails "already in use" and must retry). Neither is a safety hole — quorum still gates execution and higher ids always supersede — but the voting surface must be built assuming adversarial proposal volume, and that requirement is not written anywhere.

---

## R5. The charter claim, and whether SPEC 46 is complete

The claim itself is tight. Identity by address against a domain-separated, sorted-pair Merkle root; `MAX_POB_PROOF = 16` where depth 8 suffices for 240 (the shared `pob-merkle.mjs` asserts ≤ 8 and that a leaf hash can never be replayed as a node); the PoB must be a live `AssetV1` in `pob_collection`, owned by the signer, and is CPI-burned in the same instruction; the window is two numbers and a clock with no flag and no setter; `charter` is a reserved attribute key; `check_supply` applies. `pob_extra` accounts are appended to Core's burn never as signers and bounded at 8 (`BadPobExtra` for an over-claim). A spent leaf cannot be re-spent because a burned Core address can never be re-minted (9.12/9.13, measured). One PoB in, one vault out, never one without the other.

**Is SPEC 46 complete?** I enumerated what the hot update-authority wallet can do and found nothing it omits. For the record, the things I checked and found already covered: adding a rejecting or admitting external adapter on the collection or on individual assets (the alarm's per-asset blind spot is named); flipping an oracle between transactions; minting a lookalike #241; rewriting name and uri (cosmetic, since identity is by address); moving a PoB out of the collection (named as the same brick class); the positive bound that it cannot transfer or burn a PoB (Core's asset approves transfer/burn only for the owner, and permanent delegates reject their own post-creation add); the 30-minute sampling blind spot; and that the exposure genuinely **ends** when the window closes, because `claim_charter_vault` then refuses by clock alone and the Moments collection has no other role in any of the five programs. The governance-capture case correctly presumes the key holder also *owns* PoBs (it cannot take anyone else's), which is consistent with the measured concentration (largest wallet 41 of 240).

**One thing I would add, because it is set by a value nobody on chain checks:** the length and the *start* of that exposure window are entirely a one-time `initialize` argument, and the program places almost no bound on it. See **F5**.

Third parties: a PoB holder can sell it (the buyer claims), bare-burn it (loses the claim), or add an owner-managed `FreezeDelegate` and freeze it (self-brick, and they can thaw again — unless they have also pushed the asset past round 28's heap boundary, in which case they cannot remove the plugin but can still thaw it). All self-inflicted and within the stated limits.

---

## R6. One-time configuration, and the trusted hop

### F5 — LOW. `initialize` leaves two cheap, decisive checks on the table, and one of them can freeze the whole protocol forever

**Construct:** `cbob_vault_mint::initialize`. What it actually enforces about the charter window is only:

```
charter_closes_at > charter_opens_at
charter_closes_at - charter_opens_at <= 90 days
charter_closes_at > now
```

**There is no bound on `charter_opens_at` relative to `now`.** Two permanent, uncorrectable outcomes:

1. **`charter_opens_at` in the past** (anywhere up to ~90 days back): the window is already open at `initialize`, so the ruled 7 days silently becomes `charter_closes_at − now`, possibly minutes. Charter members lose the window; the exposure window of SPEC 46 shrinks with it (the benign direction), but so does every holder's chance to claim.
2. **`charter_opens_at` far in the future**: no charter claim is possible until that date, therefore no vault exists, therefore no proposal (`create_proposal` needs a live vault), therefore no round (`mint_vault` needs `round_id > 0`), therefore no paid mint. `last_distribute_at = max(now, charter_closes_at)` is also set to that far-future value, so no distribution can ever run before then. **The entire protocol is frozen until the date, permanently, with no admin and no upgrade authority.** The 90-day span check does *not* catch this: a plausible units mistake — `charter_opens_at` in milliseconds with `charter_closes_at = opens + 604800` — passes every check and lands in roughly the year 58,000.

**Second missing check, same instruction:** `cap_total = Σ level_caps` is required only to be `> 0` and `≤ max_supply`, and `check_supply` then makes `cap_total` the real lifetime ceiling. A typo in the census (`[1,1,1,1,1]`) permanently caps the project at five vaults while `max_supply` reads 2,100.

**Why the off-chain checker is not a sufficient answer:** round 24 A6 already records that `check-launch-params.mjs` validates the JSON, not the signed transaction, so whoever assembles the four `initialize` transactions is the last gate. These two checks are the only ones in this class that the program can make for free.

**Evidence that would exist if I am right:** `initialize` with `charter_opens_at = now + 10·365·86400` and `charter_closes_at = opens + 604800` succeeds; nothing can then mint, propose, or distribute, and no instruction exists to change it.

**Fix (pre-lock only):**
```rust
require!(charter_opens_at >= Clock::get()?.unix_timestamp, MintError::BadCharterWindow);
require!(charter_opens_at <= Clock::get()?.unix_timestamp + MAX_CHARTER_LEAD, ...); // e.g. 180 days
require!(cap_total == max_supply, MintError::BadLevelCaps);
```
If the owner declines the code change, then item 38 must add an explicit, witnessed **read-back step**: after `initialize` and before the charter window opens, a person other than the signer reads all four configs off chain and compares every field to `launch/mainnet-init.json`. The other values in this class — `pob_collection` (never even read as an account), `pob_root` (checked only against zero), `bank_treasury` (checked only against the default key), `payment_mint` (checked only to be a SEAL reserve, not to have 8 decimals), `guardian` and `swap_operator` (off-curve keys accepted) — are each permanently total failures on a typo and the read-back is their only remaining gate.

### The swap operator's worst case, bounded

Per-sweep ≤ `max_sweep_lamports` (10 SOL ruled), at most one per `sweep_cooldown_secs` (6 h ruled), never below `sol_reserve_lamports` (0.05 SOL), only ever into the pinned operator key, which must **sign** (6.17a), with zero sweeps refused (6.17b) and three-in-one-transaction refused (6.17). The guardian's stop is instant and one-way. A vote can only tighten and only to `sweep_floor` / `cooldown_ceiling` / `reserve_ceiling` (1 SOL, 24 h, 0.1 SOL), which I verified against both `tighten_sweep`'s `max`/`min` application and GOV's creation-time refusal, so the hostile-vote floor on throughput is 1 SOL/day. Replacement needs half of live plus 7 days, and the guardian can cancel a pending one (3c.K4) but not a pending guardian. **Worst case = 10 SOL per uncovered cooldown, plus F4a's restart amplification, never more than the revenue PDA holds above 0.05 SOL, and never a vault, the pool, or sale cbBTC.**

### The royalty is confirmed immutable

`initialize` installs `Royalties` at 1,000 bps, revenue PDA sole creator at 100 %, `init_authority = Some(PluginAuthority::None)`. I traced every Core CPI in all five programs: `CreateV2`, `AddCollectionPluginV1` (once, inside the one-time `initialize`), `UpdatePluginV1(Attributes)` (only `reveal_level`, once per vault), `UpdatePluginV1(PermanentFreezeExecute → false)` (only SEAL's open), `BurnV1` (MINT's charter PoB burn, BURN's vault burn). **There is no `UpdateCollectionPluginV1`, no `RemoveCollectionPluginV1`, no `UpdateCollectionV1`, and no `UpdateV1` anywhere.** So the collection's update authority is permanently MINT's PDA and that PDA has no instruction that could change the plugin, the authority, or the collection itself. Core's side is measured both ways on a control collection with a keypair authority (R.5 accepted with `UpdateAuthority`, R.6/R.6a/R.6b refused with `None`, R.6c proving the call is well formed). Asset-level override is refused to the owner (R.8, `0x1a`) and `create_vault` hardcodes the two-plugin set. **Confirmed.**

### The redemption cap is exactly a rolling window

`k = min(max(cap,1), 64)`; `kth = ring[(head + 64 − k) mod 64]`; allow iff `now − kth ≥ window`; then write `ring[head] = now` and advance. `head` is the next write slot, so `(head − k) mod 64` is the k-th most recent. Zero-initialised slots read as "long ago", so the first `cap` redemptions land against an empty window. `cap` is recomputed per redemption from `minted_total − burned_total − bare_burns_retired` *before* this burn is counted, so the vault being redeemed counts as live (round 24 D8's note about an unretired bare burn reading the cap one high is accurate). A falling live supply tightens `k`; a rising one is clamped to 64, i.e. stricter, never looser. A backwards clock fails closed (negative difference). The whole check is before the Core burn and reverts with it. **It is exactly a rolling window, and RL.7's replay-against-each-redemption's-own-certified-cap is the right way to prove it.**

---

## R7. Cross-program raw reads — recomputed from the structs, all correct

I derived every offset from field order and Borsh sizes independently of the comments.

**`MintConfig`** (disc 0‑8): version 8, collection 9‑41, governance **41**, pool_ata 73, round_id 105, opens_at 109, closes_at 117, price 125, cap 133, minted_this_round 137, minted_total **141**, max_supply 149, bank_treasury 157, split_bps 189, sales_stopped **191**, sweep_stopped **192**, guardian 193, swap_operator 225, sol_reserve **257**, bump 265, max_sweep **266**, sweep_cooldown **274**, last_sweep 282, level_caps 290, level_minted 310, revealed_total 330, payment_mint 338, pob_collection 370, pob_root 402, charter_opens 434, charter_closes **442**, charter_claimed 450, bare_burns_retired **454**, total_active_weight 462, active_count 470, acc_scaled 478, owed_scaled 494, last_distribute 510, sales_stopped_at **518**, sweep_stopped_at **526**, pending_swap_operator 534, pending_swap_operator_at 566, monthly_secs 574, pending_guardian 582, pending_guardian_set 614, pending_guardian_at 615, notice_secs 623, sweep_floor **631**, cooldown_ceiling **639**, reserve_ceiling **647**, dist_epoch 655, pending_count 663, pending_this_epoch 671, cbob_mint 679, max_boost_weight **711**, max_boost_epochs **712**, boost_price 714, boost_weight 722, boost_epochs 723, boosts_active 725, boosts_due 729, boost_weight_total 733, cbob_burned_total 741, boost_expiring 749‑1005. **Total 1,005 + 256 padding = 1,261**, which equals `MINT_CONFIG_SPACE` summed term by term. Every bolded value matches the constant in GOV and/or BURN. (Note: round 31's W9 correctly rejected two auditors' "1253"; 1,261 is right.)

**`VaultRecord`**: version 8, asset **9**, mint_index **41**, reveal_slot 49, level 57, charter 58, entropy_set 59, entropy 60, attrs_hash 92, bump 124, active 125, retired 126, reschedules 127, vault_ata 129, debt_scaled 161, pending 177, request_epoch 178, boost_weight 186, boost_end_epoch 187, carry_scaled 195‑211. **211 + 10 padding = 221**, equals `VAULT_RECORD_SPACE`. GOV's 8/9/41 match.

**`BurnConfig`**: version 8, collection 9, bump 41, burned_total **42**, redeem_window 50, rate_head 58, rate_ring 59‑571. **571 + 256 = 827**, equals the space expression. GOV's 42 matches, and the `assert!(RATE_RING == 64)` const guard keeps the declared `[i64; 64]` honest.

**SEAL `Config`**: version 8, collection **9**, reserve Vec length **41** then keys at 45. **142 used, 398 allocated.** MINT's and BURN's `OFF_COLLECTION = 9` / `OFF_RESERVES = 41` match, and both bound the count (`n <= 3`) and re-check the buffer before slicing.

**`GovConfig`**: version 8, collection 9, quorum 41, threshold 43, min_voting 45, proposal_count **53**, bump 61, last_round_id 62, last_guardian_id 70, last_arm_id 78, last_boost_id 86. **94 + 256 = 350**, equals the space expression; the suite's `readBigUInt64LE(53)` is right.

**`Proposal`**: max action encoding is `Brakes` at 37 bytes (1 + 3 + 33), five actions at one per kind sum to 139, `ACTIONS_SPACE = 189`, total 259 allocated. Sufficient with margin. **`VoteRecord`** 74.

**Sweep helper**: mint 0, owner 32, amount 64, length exactly 165 — correct for classic SPL, and the exact-length requirement is what keeps Token-2022 (170-byte ATAs, confidential balances reading zero in `amount`) out of the helper entirely.

**Every pinned discriminator** is derived in the suite from `sha256("global:<name>")` / `sha256("account:<name>")` and compared to the Rust constant (3.1a–3.1y, BO.29). Every reader additionally pins address, owner, discriminator **and** a `version` byte declared as the first field. **I found no offset error and no space error.**

---

## R8. The suite, the simulation and the build as evidence

### F6 — LOW. `build-mainnet.sh` leaves one link of its own chain unverified

The script's whole claim is "the bytes the suite tested and the bytes that ship differ only by the `localnet` feature." It proves that for the **sweep helper** with three `cmp`s (dist vs fresh localnet build vs `target/deploy`). For the four keyed programs it:

- deploys `$LN_DIR` (a **fresh** localnet rebuild into `$CACHE/ln`) for the acceptance control,
- *prints* the sha256 of `target/deploy/*.so` (the bytes `run-tests.sh` and `run-sim.sh` actually deployed),
- and **never compares the two**, and never checks that `target/deploy` is current at all — it only requires the files to exist.

So if `target/deploy` were stale, or if the build were not reproducible, the chain "the suite tested X; X's mainnet sibling rejects the test key" would be silently broken while the script printed a confident banner.

*Evidence:* `grep -n cmp scripts/build-mainnet.sh` → three hits, all `cbob_vault_sweep`.

*Fix (four lines):* after the localnet build, `cmp -s "$LN_DIR/$f.so" "$ROOT/target/deploy/$f.so" || die` for each of `cbob_vaults cbob_vault_mint cbob_vault_burn cbob_vault_gov`. This also turns the script into a reproducible-build check for the four keyed programs, which is worth having on its own.

### F7 — LOW. `scripts/audit-coverage.sh`'s repaired quorum check still over-credits in two ways

Both are in the round-31 L1 repair.

1. **A combined `VERDICT.md` credits both foci from one pass's headline.** `first_line_quorate(..., combined=True)` accepts `(?:PROGRAMS|OFF-CHAIN)` *regardless of the focus being credited*, and the loop falls back to `VERDICT.md` when `VERDICT-<focus>.md` is absent. So a round that writes one `audits/roundN/VERDICT.md` headlined `# Round N, PROGRAMS pass: CLEAN; QUORUM MET`, with an `MANIFEST-offchain.json` whose runner count is met, credits **every off-chain-bundled file** on the strength of a programs-pass headline. The selftest has eight cases and none exercises `combined=True` with a mismatched label.
2. **`bundles()` parses a sibling script's source with a format-specific regex and fails open.** It splits the two foci on the literal `'] : ['` and terminates on `'\n]\n'`. If a future `auditN.ts` writes `]: [`, the split silently fails, `both` becomes the union, and **both foci are credited for every path in either bundle.** By contrast, renaming `const TARGETS` fails closed (empty bundles). A gate whose failure direction depends on which formatting detail changes is not a gate.
3. Related, and already named by round 31 itself: after a rerun the counted manifest is the rerun's (`required: 3`, `auditors: 3`), so `auditors >= required` is automatically true and the verdict's first line is the *only* quorum evidence. Round 31 recommended a structured `QUORUM-<focus>.json`; only the fallback shipped.

*Evidence:* run the gate in a scratch clone with a single `VERDICT.md` headlined for PROGRAMS and both manifests present; off-chain-only files are credited and strict mode exits 0.

*Fix:* drop the `combined` leniency and require the label to match the focus; parse the bundle by importing the script with `RENDER_ONLY=1 FOCUS=<focus>` and reading the delivered path list rather than regexing its source; implement the structured quorum record round 31 asked for.

### F8 — LOW. `bank/txread.mjs` refuses v1 transactions that carry lookup-table keys, on an assumption I cannot verify from this bundle

```js
if (tx.version === 1) {
  need(object(m.transactionConfig), 'v1 transactionConfig')
  need(m.accountKeys.every(k => k.source !== 'lookupTable'), 'v1 lookup-table key')
}
```

Rejecting a `source: 'lookupTable'` key on a v1 message is a claim about a **live mainnet format**, supported in this tree only by the single captured fixture (which has 36 inline keys and no table keys) and by SPEC's "64 inline accounts" phrasing. If v1 retains address lookup tables, then the first v1 transaction that uses one and touches a watched program makes `readParsedTransaction` throw, which per SPEC makes **every alarm pass fail and every cursor stall** until a human patches the file. That is loud and fail-closed, and the off-chain code is not immutable, so it is LOW — but it is a scheduled outage waiting on a third party's rollout, sitting in the one component that is supposed to watch everything else.

*Evidence that would settle it:* one mainnet v1 transaction whose `jsonParsed` `accountKeys` contain `source: "lookupTable"`, and `addressTableLookups` in its message. If such a transaction exists, replay it through `validateParsedTransaction` and it throws `unreadable parsed transaction: v1 lookup-table key`.

*Fix:* either prove the exclusion against mainnet and add a fixture for it, or accept resolved lookup-table keys on v1 as they are already accepted on v0 (the decoder consumes resolved string keys for all three formats anyway) and keep the `transactionConfig` requirement.

### INFO — evidence gaps I would close, listed so they are not assumed

Each of these is a property the prompt names and that no arm exercises:

- **Sweep helper:** a native wSOL source; a destination that is not an ATA; a destination wallet that is *another vault's* asset signer; a destination wallet that is not the asset's owner but is a legitimate third party (the success case for F2); `pob_extra = 8` with eight distinct accounts; a 30-record `expire_boosts` batch at the bound. Round 31 A5 lists the empty pre-created reserve ATA and the non-ATA stray; the above are additional.
- **Core ExecuteV1 → sweep helper on a frozen vault.** Covered by construction (3.7 proves Core refuses *any* Execute on a frozen seal regardless of the inner instruction), but never sent through the helper specifically.
- **Reveal at the measured maximum autograph** — F1.
- **Pre-funded `initialize` config PDA / vault record / reserve ATA** — F1 (7.12d covers only `Proposal`).

### INFO — three accepted boundaries are filed inside OPEN AND BLOCKING

SPEC's own rule is *"Three states, and an item is in exactly one of them … OPEN AND BLOCKING … must not be quietly demoted to accepted."* The **Reader coverage boundary**, the **Scan backlog boundary** and the **Transaction-format boundary** paragraphs sit physically between items 50 and 52, inside the OPEN AND BLOCKING section, and all three are descriptions of residual *accepted* boundaries, not of work that blocks minting. A reader counting the blocking list, or a future round checking that nothing was demoted, will mis-file them in one direction or the other. Move them to ACCEPTED with numbers, or to the "Known limits" list. (This answers question 4 below.)

### INFO — `scripts/validate-core-gate.sh` has no concurrency guard, unlike its two siblings

`tests/expiry-budget.mjs` refuses to start if 8999/9900 are held; `sim/run-sim.sh` refuses if `run-tests.sh` is running. `validate-core-gate.sh` calls `kill_v` unconditionally, which `fuser -k`s whatever holds those ports — so running it while the suite is mid-run kills the suite's validator and produces a confusing red. One `pgrep -f "scripts/run-tests.sh"` guard, copied from `run-sim.sh`, removes the footgun. (Also worth noting: it is the script whose entire purpose is to prove the Core gate fires both ways, and round 14 already found it broken in two ways; it is exactly the file that should be hardest to run wrong.)

---

# THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

## 1. Is any limit WORSE than stated?

| limit | verdict |
|---|---|
| **10** (the swap hop) | **Slightly worse.** The bound "cap × cooldown windows until the guardian stops it" omits that `restart` is an ordinary 10.71 % action, that restart proposals are independent accounts, and that a minority can therefore stockpile and serially execute several, each buying the operator one more window. See **F4a**. |
| **26** (the last leader grinds) | **Mechanism broader, outcome not.** A validator can scan the public leader schedule for a window in which it holds groups `g`, `g+2` and `g+4` and time a mint there, controlling all three hashes rather than only C. Since round 24 already measured C-alone at 96 % selection, the practical bound is unchanged; the sentence "three different leaders is likely" should say that the stride can be bridged by one validator holding alternating rotations. See R3. |
| **38** (every `initialize` value is permanent) | **Worse in one specific:** the statement "the programs themselves check less than the checker does" does not name the two gaps that are cheap to close and total in consequence — no bound on `charter_opens_at` relative to `now`, and `cap_total` not required to equal `max_supply`. See **F5**. |
| **44 / item 50** (stray classic tokens can be swept) | **Not worse, but conditionally unavailable.** With 23 bytes of headroom in the widest page shape, zero extra token pairs fit; the rescue is available only in the narrow owner-payer shape. SPEC says "mind the packet"; the page contract should say which shape buys which capability. |
| **9, 27, 28, 29, 32, 34, 35, 36, 37, 39, 40, 41, 42, 43, 45, 46, 47, 48, 49, 55, 56** | **Accurate as written.** I attacked each against the code; several (27, 28, 32, 41, 46, 47, 49, 55) are stated more conservatively than the code requires. Limit 49's lamport figures are arithmetically correct (1,772,920 mainnet, 2,429,040 validator, both re-derived). |

## 2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?

**No limit on the ACCEPTED list is already closed.** I specifically re-tested the ones most likely to have drifted:

- **29** ("anything other than cbBTC sent to the revenue address stays there for ever") — still true: `split_revenue` requires `mint == payment_mint`, and no other instruction moves a token out of the revenue PDA. SOL leaves only via `sweep_sol_for_swap`.
- **27** (`claim` does not check the asset is alive) — still true; neither the pay path nor the join path reads the asset.
- **35** (the 10 % turnout never binds at the ruled numbers) — arithmetically true: `ceil(0.21·N)` cast at ≥ 51 % YES is ≥ 10.71 % of N.
- **9** ("nothing refuses the redemption either") — still true; the only pre-signature check is in a page that does not exist.
- **42** — already corrected in round 26; the current text is accurate and correctly labels the narrow 1,219-byte variant as an offline measurement rather than the contract.

**One thing is closed by something the documents do not claim:** the *stranger-squats-a-missing-reserve-ATA* case is closed harder than item 50's prior-transaction step suggests — even without that step a single retry succeeds, because once the ATA exists the helper reads its live balance. Worth saying, because it means the prior transaction is a convenience for the widest page shape, not the sole barrier against that griefer.

## 3. Is any DISCHARGED item not actually discharged?

All are discharged as properties. **One is discharged on stale evidence:**

- **12 / 17 (compute units).** The text that discharges it quotes v5 numbers measured on the v5 artifact (58,956 CU, 890 bytes, 18 padding instructions, 816.7 CU each, 1,228 bytes, "twenty-five times"). The v6 figures are different (a plain mint is 75,898 per item 54), and the v6 property is re-established by arms 10.1 / 10.2 / 10.2a / 10.3, which the entry also cites. So the conclusion stands but the recorded measurement is of a binary that no longer exists. Replace the quoted numbers with the v6 ones from `.cache/suite.log`, or label them explicitly as v5 history.

Checked and sound: **19** (closed by construction; `activate` refuses `NotRevealed`, so no state exists in which a vault is activated but unlevelled, and the residual Core-failure halt is limit 40, with round 31's W1 covering the owner-shape variant); **14** (`DuplicateAttribute`); **30** (no writer for `split_bps`, either destination, or `max_supply`; P.0e/P.0f prove the only vote-carried struct has no such field in either program); **31**, **33** (both now exercised at `initialize`-parameter values); **51**, **54**; and the whole 1a–24 family, which genuinely went with the Bank, the deck and the distributor.

## 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**No item is demoted, and the tree is honest about all five.** Specifically:

- **22** — road step 8 not started; the named five sub-items (crank live, alarm live, one full cycle through each pool, one forced post-sweep recovery, the DAS burnt read) are intact and VALIDATION explicitly lists them as still open.
- **38** — still OPEN on `charter_opens_at` and `lock_deadline`; `launch/mainnet-init.json` still carries `null` for both with `"status": "OPEN"`, and the checker refuses while anything is OPEN.
- **50** — still OPEN; HOLDER-GUIDE is still marked **DRAFT** at the top, which is the publication ban's own condition.
- **52** — still OPEN.
- **53** — still OPEN and correctly so: round 31's VALIDATION refreshed the rehearsal worktree at `4ae79d6` with the byte-exact reverse proof, and says plainly *"Nothing was built, deployed or sent at the throwaway IDs."* The item's requirement is the full `run-tests.sh` inside the rehearsal tree at the release commit, and that has not been re-run since `d57ee3a`. Not demoted.

**The one structural problem is filing, not demotion:** three accepted boundaries are physically inside the section whose rule forbids writing "accepted" against anything in it (the INFO above). That is how an item gets demoted *by accident* in a later round, so it is worth fixing now.

---

# WHAT THIS PROJECT MUST DO BEFORE LAUNCH THAT AI AUDIT STRUCTURALLY CANNOT

I reason; I do not execute. The suite executes, but only what somebody already thought to write. These are the specific things no round of this process can produce, in the order I would do them.

1. **Commit the scratch.** Round 31 refuted a permanent-halt HIGH in `.cache/triage31p/heap.mjs` and an "unfixable address squat" CRITICAL in `squat.mjs`, and both files are untracked. Move every measurement that killed a finding into `tests/` behind a floor, at the **maximum** rather than a convenient value (10,198, not 10,150). This is F1 and it is the single cheapest thing on this list.

2. **Have a different person, on different hardware, from a clean clone of the release commit, reproduce `dist/SHA256SUMS` and sign the result.** `build-mainnet.sh`'s own closing banner says the compiled constant being Gary's key is **NOT PROVEN** and that "the bridge is reproducibility." Today that bridge has exactly one end. A second independent rebuild is a human act and converts the one unprovable link into a two-party attestation. Add F6's four `cmp` lines while you are there.

3. **Run a money-at-risk adversarial exercise that is not an audit.** Deploy the five programs to mainnet at throwaway ids with real cbBTC, publish the addresses, and pay a bounty for anything extracted. Twenty-one rounds of reading produced its best findings in the newest code; a paid adversary with a keyboard produces a different distribution of findings than a reader with a prompt. Budget it against the 1 BTC-scale value these vaults are meant to hold.

4. **Make somebody other than the author build the redemption transaction.** F2's whole risk is that the client chooses where a vault's contents go. Hand the published interface to an outside engineer with the holder guide and nothing else, and see whether what they build (a) empties the vault at execution, (b) closes what it empties, (c) names the owner as the destination, (d) omits the claim when the pool is frozen, and (e) fits the packet. If it does not, either the documentation or the on-chain binding is wrong, and `dest.is_signer` becomes cheap insurance rather than theory.

5. **Walk item 22's five sub-items on a live cluster and record the signatures** — including the two nobody has ever done: one full revenue cycle through each pool, and one forced post-sweep failure recovered by hand. A model cannot tell you that an RPC answers in 300 seconds instead of erroring (round 25 A1 found that by measurement, not by reading), and `bank/revenue.mjs` has never executed under any gate.

6. **Run the `initialize` ceremony as a two-person read-back, with a script that reads the four configs off chain and diffs every field against `launch/mainnet-init.json`, before the charter window opens.** F5 is the reason: several one-time values are permanently and totally destructive on a typo and the program checks almost none of them. The checker validates JSON; nothing validates the signed transaction. This is the only control that can.

7. **Decide and rehearse the key-loss cases that have no on-chain answer.** If the guardian key is lost after `arm_guardian` and before `apply_guardian`, anyone can apply a replacement years later at the worst moment, and only another half-of-live vote supersedes it. If the `INIT_AUTHORITY` key is lost between SEAL's and BURN's `initialize`, every vault minted in between is unredeemable until a key that no longer exists signs. Write the runbook, then actually destroy a test key and follow it.

8. **Before the lock, decide the three things that are only decidable before the lock**, with the measurement in hand rather than the argument: (a) `dest.is_signer` in the sweep helper (F2), (b) `charter_opens_at` and `cap_total` bounds in `initialize` (F5), (c) a `retire_orphaned` for an activated vault nested in a burned host (SPEC "What got worse", round 29 D2 — the only permanent, unfixable dilution of *every other holder* that a single holder can create by accident). Each is a ruling, not a finding, and after the lock each is permanent.

9. **Publish the holder guide only after item 50 ships, and fix F3 first.** The guide currently promises four surfaces that do not exist and under-states the one measured number a buyer would most want (96 %). A human has to own that sentence; no round can.

**Residual risk I would name to the owner in one line:** the programs are in good shape and I could not break them; the remaining exposure is concentrated in (i) the hot Giraffish Moments key through the 7-day charter window, which can end the project outright and is kept hot by ruling, (ii) the one-time `initialize` values, which no on-chain check defends, and (iii) the unbuilt redeem page, which is simultaneously the only pre-signature control and the sole chooser of where every redemption's value goes.