# ROUND 25 — INDEPENDENT SECURITY AUDIT, FINAL REPORT
## CBOB Vaults v6: SEAL, MINT, BURN, GOV + the sweep helper

---

## 0. EVIDENCE POSTURE — READ THIS BEFORE ANY FINDING

**I did not execute anything this round.** No validator, no `scripts/run-tests.sh`, no `tests/3prog.test.ts`, no `sim/test-vault.ts`, no `scripts/build-mainnet.sh`, no `cargo test`. No environment was available to me, and none was available to the two agents whose work precedes mine. I will not write "green" against a run that did not happen; that is the exact failure mode this project has spent twenty-four rounds building floors against.

**Consequence, stated as a finding in its own right (see E0 below): this round cannot be counted toward ship gate 3.** Gate 3 requires two consecutive rounds in which no finding survives *measurement*. A round that measures nothing cannot clear it, however clean it reads.

What this report *is*: a complete source-level audit in which every structural claim was re-derived from the bundled source rather than inherited. Specifically, I independently recomputed:

- **every byte offset of `MintConfig`** field by field from the struct declaration, against all eighteen constants GOV pins, all three BURN pins, and all thirty-odd the suite pins — **all correct** (table in R7);
- **`MINT_CONFIG_SPACE` (1,261 = 1,005 + 256)**, **`VAULT_RECORD_SPACE` (221 = 211 + 10)**, BurnConfig (827 = 571 + 256), SEAL config, GovConfig (350 = 94 + 256) and `Proposal` (259, with `ACTION_MAX_BYTES = 37` being genuinely the largest variant, `Brakes` = 1 + 3 + 33) — **all correct**;
- the **pool solvency proof**, mutation by mutation, rather than reading `P.32`;
- the **boost ring exclusivity argument** past epoch 64, including the case nobody states: that a boost may be bought *while another is due*;
- the **maximum CPI count of a five-kind proposal** (it is five, not six — derivation in R4);
- **what blocks at launch** (R2-M1, new this round).

Every finding below carries the evidence that would exist on chain or in a test run if I am right. Where I am reasoning rather than measuring, I say so.

**Headline: no CRITICAL, no HIGH.** I could not break custody, the open↔burn pairing, the emptiness proof, the pool's solvency invariant, the boost accounting, the ring, the rate limit, or any cross-program raw read. What I have is ten MEDIUM and nine LOW, concentrated in three places: the never-audited sweep helper, holder-facing sentences that are still not true of the code, and round 24's own repairs.

---

# R0. ROUND 24'S REPAIRS, CHECKED AT EVERY SITE OF THEIR SHAPE

Round 24 confirmed ten evidence gaps (C1–C10) and a set of document corrections (A1–A6, D1–D9). I checked each against the bundled tree.

| item | prescribed | state in this tree |
|---|---|---|
| **C1** weight/epochs legs, favourable move, duplicate pair, post-transfer owner | 4 arms | **DONE.** BO.30 (weight leg, pinned `BoostTermsMoved`), BO.30a (favourable price lands *at the new terms*), BO.31 (epochs leg), BO.32 (duplicate pair pays once and `owed` falls once), BO.33/33a (old owner refused, new owner allowed). |
| **C2** ring wrap through the program's own index | host test + on-chain arm | **SUBSTANTIALLY DONE, one branch residual.** BO.34–34c drive `boost_vault`'s inline `end % BOOST_RING`, `advance_epoch` and `expire_boost` across a genuine wrap. The host test still writes `boost_expiring[i] += 1` by hand (`host_tests`, MINT `#[cfg(test)]`), so it still only exercises `advance_epoch`. **The one branch never driven past a wrap is `unschedule_boost`'s `else { boost_expiring[i] -= 1 }` arm** — reached only by retiring a boosted vault *before* its boost is due. BO.16 drives it, at a low epoch where `end % 64 == end`; the later BO.34 sequence never retires early. See L2. |
| **C3** five-kind execute; the "six CPIs" comment | arm + comment | **HALF.** E.7/E.7a execute a genuine five-kind proposal and measure CU. **The comment is still false** (see R4-L1). |
| **C5** sim boosts; the stale `$CBOB` comment | both | **HALF.** S7b.0–S7b.4 boost the Test Vault under a real 21% quorum. The sim's comment still reads *"$CBOB does not exist on mainnet yet"*; it does (`GMm2yY2z…`, created 2026-10-04, pinned in `launch/mainnet-init.json`). |
| **C6** prove the four captures ran | assert the cost | **DONE.** `wide.cu >= base.cu + 4*100_000`; the vacuous `unset` clause is gone. |
| **C7** RL.7 bounds by the largest live supply | stamp live supply per ring write | **NOT DONE**, but the arm text now discloses it honestly. INFO. |
| **C8** 3.1y + six weak arms | 7 items | **ONE OF SEVEN.** 3.1y (`acctDisc('Config')` pinned in BURN) is present. P.11a is still vacuous; S7.4 still accepts any `0 < paid <= avail`; 5.2's and 10.2's titles still outrun their pins; 3.7 is still pinned to bare `0x9`, shared with R.6. |
| **C9** six correct-but-unexercised orderings | one arm each | **ONE OF SIX.** Only BO.32. Still absent: a record in both the crank list and the pair list of one `claim`; a boost expiring in the same `claim` that defers a frozen destination; **two paired redemptions landing successfully** at cap ≥ 2 (4.9/4.10a run at cap 1 and are refused `RateLimited`, so only the *failure* shape exists); an older `TightenSweep` executed after a newer one; `books()` outside section BO. |
| **C10** `CBOB_CACHE` | refuse a moved cache | **DONE.** `run-tests.sh` dies unless `CACHE = $ROOT/.cache`. |
| **A1, A2, A4, A6, D1, D2, D4, D8** doc rewrites | — | **Done at the sites I can check.** SPEC 26, SPEC 46, SPEC 47, SPEC 28/REDEEMING, item 50's three new client obligations, item 52's empty-tick dependency, DESIGN §10's top-three arithmetic, and MINT's level-draw comment ("a choice among many draws, not a bias") are all present and correct. Exceptions in R4-M1 and the HOLDER-GUIDE section. |

### R0-M1 (MEDIUM, evidence) — round 24's evidence repairs are partial, so ship gate 4 is not met

**Construct.** `programs/cbob-vault-mint/src/lib.rs` `unschedule_boost`; `programs/cbob-vault-gov/src/lib.rs` `MAX_ACTIONS` doc; `tests/3prog.test.ts` P.11a, S7.4, 3.7, 5.2, 10.2, the five absent C9 arms; `sim/test-vault.ts` line 127.

**What an accident gains.** Ship gate 4 says *"every ACCEPTED finding has a gate that FAILS THE BUILD, proven in BOTH directions."* Five of round 24's ten confirmed items do not have one. These are the places a future change — and there will be more rounds before the lock — can silently un-fix something that was fixed.

**Evidence that would exist if I am right.** Each of these mutations should leave the suite green:
1. Replace `unschedule_boost`'s `else` branch with a no-op; run past epoch 64 with an early retirement.
2. Set `picks = []` in section P: P.11a compares `''` to `''` and passes having asserted nothing about 1 : 1.5 : 2 : 2.5 : 3.
3. Pay the Test Vault any small positive amount in S7.4.
4. Break the crank/pair overlap path in `claim`, or execute an older `TightenSweep` after a newer one.

**Fix (test-only; batch them, because each one resets the freeze).**
(1) A host test that buys *and unschedules-before-due* across a wrap at N = 63 over 200+ epochs against an independent model, with no hand-written ring writes.
(2) `P.11a` fails loudly unless `picks.length === 5`.
(3) `S7.4` asserts `paid ∈ {avail-1, avail}` with only the Test Vault joined.
(4) The five absent C9 arms.
(5) Correct the GOV comment (R4-L1) and the sim's `$CBOB` comment.

### R0-INFO — the MINT byte change (A1) is fully absorbed

Round 24's A1 added a line to MINT, which Anchor 0.31 turns into a byte change at every `require!`/`err!` site below it. I checked every place that could have been keyed to the old bytes or line numbers:

- `scripts/build-mainnet.sh` pins only **Core's** sha256 (hardcoded, non-overridable) and writes our five hashes fresh into `dist/SHA256SUMS` each run. No stored baseline for our programs.
- The suite's source-reading helpers (`pinned()`, `constU8()`, `idx()`, `structBody()`, the `RENT_EXEMPT_0_BYTES` mirror check) key on **names**, never offsets or line numbers.
- Every `because()` pin keys on an error **variant name**, which `line!()` does not touch. Arm `ID.1` guards id uniqueness, so a pin cannot silently read another arm.

**No finding.** The one thing not in this bundle is `bank/alarm.mjs`'s `prog.*.hash` baselines; a changed baseline pages once, by design. Flag for the off-chain pass.

---

# R1. CUSTODY — I could not break it

Recording what I attacked, so a later reader does not repeat it.

**CPI wrappers.** Both halves use `load_instruction_at_checked`, which sees top-level instructions only. A wrapped `open` makes the wrapper the top-level program, so BURN's backward walk never matches `SEAL_PROGRAM_ID`; a wrapped `burn` likewise fails SEAL's forward walk. `retire_redeemed` adds `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1` **and** requires the instruction at `load_current_index_checked` to be BURN's `burn_vault` with `accounts[0] == asset`. Since exactly one program runs at depth 1 per top-level instruction, that caller *is* `burn_vault`. WR.1–WR.4 measure all three with a real deployed forwarder.

**Two vaults in one transaction.** Both halves bind asset **and** owner at fixed positions (`BURN_IX_ASSET_IDX=0`/`OWNER_IDX=2`, mirrored by `SEAL_IX_*`), so a thaw cannot borrow another vault's burn. 3.9, 3.10, 4.10, 9.0 cover it.

**Transfer between open and burn.** Core's `PermanentFreezeExecute` gates `ExecuteV1`, not `TransferV1`, so a thawed vault is transferable mid-transaction. The attack fails anyway: `burn_vault` re-reads the asset's owner bytes and requires `asset_owner == ctx.accounts.owner.key()`, and SEAL already matched that same owner. Transfer to Bob then burn-as-Bob breaks SEAL's forward match; burn-as-Alice breaks `NotTheOwner`. **No arm exercises this shape** — it is the shape that makes the owner re-read load-bearing. See R8-L2.

**Leaving a thawed vault alive.** Impossible: the thaw and the burn are in one transaction; if the burn reverts, the thaw reverts with it. There is no re-seal and no close.

**The emptiness proof.** Offsets recomputed from the SPL layout and **all correct**: delegate option `72..76`, delegated amount `121..129`, close authority `129..133`, amount `64..72`, length `== 165`. A closed account is skipped on the *owner* check in loop 1 and the *lamports* check in loop 2 — the right reason in both. The second loop now applies the same three delegate/close checks as the first, so the two loops agree. A nested live Core asset is refused when declared. Lamports are checked at zero on the correct PDA (`seeds = [EXECUTE_PREFIX, asset], seeds::program = MPL_CORE_ID`).

**Declared-but-foreign accounts.** An account owned by a token program whose `owner` field is not the PDA is ignored; an account owned by Core that is not `AssetV1` passes. Both correct.

**An account a stranger can create that neither the sweep can name nor BURN will skip.** I could not construct one for the reserve mints, *provided SPEC REDEEMING step 1 runs*: once all three canonical classic ATAs exist, the page names them and the helper empties them live; the Token-2022 derivations can never be initialized (Token-2022's `InitializeAccount3` rejects a mint owned by classic SPL Token, so the ATA program's CPI fails). Undeclared non-ATA accounts and nested foreign assets are *destroyed*, not blocking — accepted limits 9 and 44, unchanged.

**The one residual, stated precisely.** If the page skips step 1 for a reserve mint whose ATA does not yet exist, a stranger can create it permissionlessly with one base unit between the prior transaction and the redemption, and `burn_vault` then refuses `VaultNotEmpty` for as long as the griefer pays. SPEC states this twice (item 50's first bullet; the round-23 F1 entry in "Known limits"), but item 50's bullet gives the instruction without the consequence. **Fix:** one clause — *"otherwise a stranger can create the missing account with dust and the burn refuses indefinitely."*

---

# R1s. THE SWEEP HELPER (`programs/cbob-vault-sweep/src/lib.rs`) — never audited

This is a value-moving program with no key, no config and no upgrade path after launch. It gets the most attention in this report.

## (a) Who can make it move value

Called directly, the asset-signer PDA is not a signer, so `MissingRequiredSignature`; nobody holds its key and only Core can sign for it. Through Core, the whole gate is Core's `ExecuteV1` authority rule.

### R1s-M1 (MEDIUM, evidence + external dependency) — the helper's entire access control is an unverified property of a program we do not control, and no arm attacks it on a *thawed* vault

**Construct.** The helper's header, SPEC and DESIGN all rest on "only the asset's owner can `ExecuteV1`". The suite's only Execute-authority evidence is **3.7**, which refuses a bare owner Execute on a **frozen** vault (Core `0x9`). That proves the seal, not the authority rule.

**What is unproven.** Nothing anywhere proves that an **update authority, a plugin authority (SEAL's `["seal"]` PDA, MINT's `["mint"]` PDA), a Core transfer delegate, or the collection authority** cannot `ExecuteV1` on a **thawed** vault — which is the only state in which it matters and the only state that is constructible in a test (`open` → non-owner Execute into the helper → `burn`).

**Why this is MEDIUM and not HIGH.** Even if Core approved a plugin authority, neither SEAL nor MINT has any instruction that makes its PDA sign an `ExecuteV1`, so there is no code path to it; and a thawed vault only exists inside a redemption the owner signed. The exposure is a future Core release (accepted limit 40) with nothing watching for *this* consequence.

**Evidence that would exist if I am right.** New arm `SR.5`: during a genuine `open_for_redemption` for Alice's vault, Bob sends the Core `ExecuteV1` with `authority = bob`. It must be refused by **Core** (`NoApprovals`), not by our program, and the vault must still hold everything. Repeat with the collection update authority and with a `TransferDelegate` the owner added.

**Fix.** Add the arms. Add the consequence to accepted limit 40: *"a Core change to Execute's authority rule makes the sweep helper reachable by a non-owner on a thawed vault."* Keep the asset binding in R1s-M2 even if Core behaves as expected today.

## (b) The pair list — every shape in the brief, traced

| shape | behaviour | verdict |
|---|---|---|
| same source twice | after the first close the account is system-owned and zero-length → `read_token` → `IllegalOwner`/`InvalidAccountData` → whole tx reverts | fails closed |
| destination twice | two sources of the same mint into one destination; balances accumulate | fine |
| source also a destination | structurally excluded: `src_owner == signer`, `to_owner == dest`, `signer != dest` | fine |
| native wSOL source | `read_token` accepts it (165 bytes); transfer then close sends its lamports to `dest`; `CloseAccount` permits a non-zero native balance | harmless |
| source with a delegate | no check; the transfer succeeds as the owner; the close removes the account, which is exactly why 3.3a passes | fine |
| source with a third-party close authority | `CloseAccount`'s authority is `close_authority.unwrap_or(owner)`, so the close fails and the redemption reverts. **Unreachable**: setting one needs the PDA's signature, i.e. a thawed vault, i.e. an owner-signed redemption | self-inflicted only |
| frozen source or destination | transfer fails `AccountFrozen` → the redemption reverts. Accepted limit 28 reached through a new path. Note the helper does not *skip* a frozen zero-balance source; it still tries to close it, which spl-token permits | consistent with 28 |
| destination not an ATA | permitted — only `to_owner == dest` and `to_mint == src_mint` are required | by design |
| `dest == signer` | explicitly refused (`InvalidArgument`) | ✓ |
| `dest` = another vault's asset-signer | **permitted.** Value and rent move into vault B, whose own redemption must then sweep them out | owner-only; see below |
| odd pair count | `NotEnoughAccountKeys` | ✓ |
| **zero pairs** | **legal** — performs the lamport sweep alone. This is the mis-mint path BURN's header relies on | fine, unarmed |

**None of these twelve shapes has an arm.** See R1s-M4.

## (c) The destination is never compared with the asset's owner

### R1s-M2 (MEDIUM) — the helper will send a vault's entire contents, plus every lamport, to any wallet the transaction builder names; it is about to become immutable and the check costs one account

**Construct.** `programs/cbob-vault-sweep/src/lib.rs`, `process()`. The only destination constraints are `to_owner == *dest.key`, `to_mint == src_mint`, and `signer.key != dest.key`. **Nothing relates `dest` to the asset's owner.**

**What an attacker or an accident gains.** A malicious or compromised redeem page (a swapped bookmark, a hijacked CDN — item 50's page is not built and is the only sanctioned client, and HOLDER-GUIDE tells holders to use it *and nothing else*) builds `claim → open → ExecuteV1(sweep, dest = attacker) → burn`. The holder signs **one** transaction and loses the whole vault. This is a strictly worse presentation than every earlier design: previously the sweep was a list of explicit SPL transfers inside Core Execute, where wallet simulation shows a recognisable "transfer to X"; now it is a single opaque instruction into a program the holder cannot read, with the destination as one account index among twelve, two CPI levels deep.

**Why this is not already covered.** Accepted limit 5 ("the judge never looked at where swept money goes… the destination was always the holder's to choose") was written about a *co-signer that no longer exists*, in a design where the destination appeared as plain transfers. HOLDER-GUIDE now promises *"whatever … is in it right then **comes out to you**"*, which the code does not enforce.

**Evidence that would exist if I am right.** Build the sweep with `dest = bob` and `to` = Bob's ATAs on Alice's live, thawed vault, with Alice as the only signer. It lands, Bob receives everything including the lamports, and the burn succeeds. **Arm SR.2 does not cover this**: it names Bob's ATA while keeping `dest = alice`, so it is refused by the `to_owner != dest` *pair-consistency* check, not by any owner binding. Its title ("names ANOTHER wallet's account as the destination → REJECT") therefore **overstates what it proves**, which is itself a round-25 finding (R8-L1).

**Sub-finding, and the reason this is cheap to fix.** Because the only authorization is `signer.is_signer`, the helper is also a **general-purpose drainer for any signer**: pass a user's own wallet as `accounts[0]`, name any of their token accounts as sources, and the final `system_instruction::transfer(signer, dest, signer.lamports())` moves *their entire SOL balance, read at execution time*, to a chosen wallet. A plain `SystemProgram.transfer` cannot do that — it needs the amount at build time. This project is about to publish an immutable, permissionless "take everything the signer has, whatever it is when this runs" primitive. It grants no capability a malicious dApp lacks, and wallet simulation still shows the outflow, so it is not a vault risk; but it is a gratuitous one, and the same fix removes it.

**Fix (one account, ~3,000 CU, permanent if not taken now).** Pass the **asset** as a fifth fixed account and bind all three facts:

```rust
// accounts[4] = the Core asset; data = [0, bump]
let asset = &accounts[4];
if *asset.owner != MPL_CORE_ID { return Err(ProgramError::IllegalOwner); }
let d = asset.try_borrow_data()?;
if d.len() < 33 || d[0] != KEY_ASSET_V1 { return Err(ProgramError::InvalidAccountData); }
let expect = Pubkey::create_program_address(
    &[b"mpl-core-execute", asset.key.as_ref(), &[bump]], &MPL_CORE_ID)
    .map_err(|_| ProgramError::InvalidSeeds)?;
if expect != *signer.key { return Err(ProgramError::InvalidSeeds); }
let owner = Pubkey::new_from_array(d[1..33].try_into().unwrap());
if owner != *dest.key { return Err(ProgramError::IllegalOwner); }
```

That makes *"comes out to you"* a property of the chain rather than of a web page, and it closes the generic-drainer shape in the same three lines. It costs the redeem page one more account in a packet whose margin is unrecorded — **so this finding and R1s-M3 must be decided together.**

**If the owner rules the other way** (holders may redeem to a chosen wallet), then HOLDER-GUIDE's "comes out to you" must change and the page must display the destination to the signer. Either answer is defensible; silence is not, because the program is immutable.

### R1s-L1 (LOW) — a destination below rent exemption turns the lamport sweep into an opaque failure

`system_instruction::transfer(signer, dest, lamports)` moves whatever the vault wallet holds. If `dest` is a fresh or near-empty system account and the transfer leaves it below the rent-exempt minimum with non-zero lamports, the runtime's rent-state check rejects the transaction (`InsufficientFundsForRent`) with an error naming neither the vault nor the cause. In practice the preceding `CloseAccount`s credit ~1.49M lamports per reserve account to `dest` first, so this only bites a **zero-pair** redemption (every reserve account already closed or never created) into a destination with no SOL — exactly the "mis-mint, never funded" shape BURN's header relies on. **Fix:** document it in item 50 ("the destination wallet must already exist and hold rent"); documentation is sufficient.

## (d) The lamport sweep

Correct and correctly ordered: all closes (which credit `dest`) happen before `signer.lamports()` is read, so the sweep sees the final figure, and BURN's `asset_signer.lamports() == 0` then sees exactly what the sweep left. Nothing inside the same transaction can refill it except an instruction the owner themselves placed between the sweep and the burn; Core's `BurnV1` does not touch the PDA (measured fact 4). A stranger cannot refill it, because the transaction is atomic. **No finding.**

## (e) Interaction with the emptiness proof

Covered in R1. The closed account passes for the right reason (system owner / zero lamports, not a stale zero amount). **No finding.**

## (f) Does it fit?

### R1s-M3 (MEDIUM, unmeasured margin) — the canonical mainnet redemption's byte headroom is nowhere recorded, and item 50 binds the only sanctioned client to that exact shape

**Construct.** `sim/test-vault.ts` arm **S8.0** records `String(B <= 1232)` — a boolean — with `B` printed only in the free-text note. No document states the number. 9.14a states 1,153 bytes for a three-mint worst case built from the **owner's own Core Execute instructions**, without the `claim`; 9.14c asserts only that the claim version "fits". The helper version replaces six inner SPL instructions with one but adds the sweep program id to the key table, so I cannot derive the figure by reading.

**Why it matters, concretely.** A legacy transaction at or near 1,232 bytes cannot carry a `SetComputeUnitPrice` (~44 bytes once the ComputeBudget program id is in the key table), nor a `SetComputeUnitLimit` (~37 more), nor a fee payer distinct from the owner (+32 key, +64 signature), nor the owner-binding account from R1s-M2 (+32). Dropping the `claim` recovers only ~17 bytes. On mainnet under congestion, a transaction that cannot bid a priority fee may simply not land, and a holder reads that as *"my vault will not open."*

**What else can be added, bounded.** A fourth reserve mint cannot exist (`MAX_RESERVE_MINTS = 3`, pinned in SEAL and BURN and tied to the measurement by 9.15/9.15a/9.16). The in-line monthly run adds **no** accounts — every host already carries the pool, and BURN hands it through. So compute-budget instructions, a separate payer, and the R1s-M2 account are the entire list.

**Evidence that would exist if I am right.** Re-run S8.0 printing `B`; run it again with both compute-budget instructions prepended; run it again with a distinct fee payer; run it again with the owner-bound helper.

**Fix.** Change S8.0 to assert explicit numeric headroom (`B <= 1232 - 81` leaves room for both compute-budget instructions) and state the number in SPEC. **Or** make the canonical page shape a **v0 transaction with an address lookup table**, which the suite already demonstrates it can construct (L.12a/L.12b) and which the pairing survives — the instructions sysvar is built from the *resolved* keys of a sanitized v0 message, so the pubkeys compared are the real ones (reasoned, not measured; arm it). This is client-side, so it does not touch the freeze, but it is a precondition of road step 11.

### R1s-L2 (LOW) — nobody has measured the redemption's compute units

The default budget is `200,000 × instruction_count`, so a four-instruction redemption gets ~800,000 and I expect ~150,000 actual (BURN does ~8 `find_program_address` calls plus two CPIs). The suite's `cuOf()` measures mints, reveals, claims and executes — never a redemption. One `cuOf()` on the S8 signature closes it.

## (g) Evidence

### R1s-M4 (MEDIUM, evidence) — a value-moving, never-audited, soon-immutable program has five arms, and one is refused for a reason other than the one its title names

Present: SR.0 (deployed), SR.1 (direct call, no PDA signature), SR.2 (**see R1s-M2: refused by pair-consistency, not by any owner binding; the title overstates**), SR.3 (the old defect, pinned to `0xb NonNativeHasBalance`, i.e. the close, not `VaultNotEmpty`), SR.4/SR.4a (happy path with a staged race, one pair). The sim's S8 adds the three-pair happy path.

**Not exercised anywhere:** `data != [0]`; a wrong token or system program in slots 2/3; `signer == dest`; odd pair count; **zero pairs** (the lamport-only sweep); the same source twice; a frozen source; a source with a close authority; a destination that is not an ATA; `dest` = another vault's asset-signer; a non-owner `ExecuteV1` on a thawed vault (R1s-M1); a destination below rent exemption (R1s-L1); a destination wallet that is not the owner (R1s-M2). **Thirteen shapes, one `rec()` line each, against the program that moves every vault's contents.** Several can only fail closed — that is the point: an arm that can only pass is still worth having, because it proves the refusal is real.

### R1s-L3 (LOW, evidence chain) — "the helper that ships is literally the one tested" is proven about a rebuild, not about the artifact the suite deployed

`scripts/build-mainnet.sh` does `cmp -s "$OUT/cbob_vault_sweep.so" "$LN_DIR/cbob_vault_sweep.so"`, where `$OUT` is a fresh build in `$CACHE/mn` and `$LN_DIR` a fresh build in `$CACHE/ln`. That genuinely proves the absent `localnet` feature is inert for this crate (a real property, and the right reason to have dropped the feature in `2b67fb1`). It does **not** link either artifact to `$ROOT/target/deploy/cbob_vault_sweep.so`, which is what `run-tests.sh` deploys and what SR.* and S8 actually ran, built under a different `CARGO_TARGET_DIR`. `build-mainnet.sh` also never deploys or exercises the helper at all — unlike the other four, it has no behavioural arm there (there is no key to ask about).

**Fix (two lines).** Have `run-tests.sh` record `sha256sum` of each deployed `.so` into the suite log, and have `build-mainnet.sh` additionally `cmp "$OUT/cbob_vault_sweep.so" "$ROOT/target/deploy/cbob_vault_sweep.so"`, dying if it is absent or differs. That converts "should be identical" into "is".

---

# R2. THE COMMUNITY POOL

## The invariant holds — proven, not quoted

Define `O = Σ owed_of(r)` over active records. Every mutation preserves `owed_scaled == O`:

- **`credit`**: `acc += δ` with `δ = ⌊avail·S / w⌋`; each active vault's owed rises by `w_i·δ`; `owed_scaled += δ·w`, and `Σ w_i = w = total_active_weight` by the weight invariant below. ✓
- **`claim`**: pays `pay = ⌊pending/S⌋`, sets `carry = pending − pay·S`, `debt = weight·acc`; the vault's owed falls by exactly `pay·S` and `owed_scaled` by the same. ✓
- **`join`**: `debt = w·acc`, `carry = 0` → owed 0; `owed_scaled` untouched. ✓
- **`reweigh`**: `carry := owed_before`, `debt := after·acc` → owed unchanged; `total_active_weight += after − before`. ✓
- **`retire`**: `owed_scaled -= pending`, `total_active_weight -= weight_of(r)` — level **plus** boost, and `unschedule_boost` is called while `r.boost_weight` still holds the old value, so `boost_weight_total` decrements by the right amount. ✓

`total_active_weight == Σ weight_of(r)` holds because a pending record can never carry a boost (`boost_vault` requires `active && !pending`) and an active record only leaves via `retire`, which sets `retired` permanently.

Given that, `distribute` computes `avail = balance − ceil(owed)` with `checked_sub` (`PoolShort`), and `ceil(owed + δ·w) ≤ ceil(owed) + avail = balance`. `monthly_inline` uses `saturating_sub` on the same quantities. The pool's balance cannot fall by any other route: only `claim` moves tokens out, and only the config PDA can sign. **`owed_of` cannot underflow**: `acc_scaled` only increases, and every write of `debt_scaled` sets it to `weight·acc` at the then-current `acc` with the then-current weight. **Invariant proven.**

## Counters under every ordering

`pending_this_epoch ≤ pending_count` holds: both rise together on a request; `advance_epoch` zeroes only `pending_this_epoch`; `join` (which requires `dist_epoch > request_epoch`, so not a this-epoch request) decrements only `pending_count`; `retire` decrements both when `request_epoch == dist_epoch`. F21.1/F21.2 measure both retire flavours. `waiting_to_join` cannot underflow.

## Liveness — no permanent block found

`JoinWaitingFirst` can stall every distribution, but a waiting vault is joinable by anyone, free, through `claim` — and `claim`'s pending branch reads nothing from the destination account, only compares its key with `r.vault_ata`, so even a non-existent destination works and a bare-burned waiting vault is still clearable. `BoostsExpireFirst` is clearable by `expire_boosts`, which reads no token account at all. **No permanent block path exists.**

### R2-M1 (MEDIUM, holder-facing + disclosure) — **no payout can happen for a full month after the charter window closes, and burning 100 $GARY cannot buy one**

**Construct.** `initialize` sets `last_distribute_at = max(now, charter_closes_at)`, `dist_epoch = 0`, `total_active_weight = 0`. During and after the charter window, funded vaults call `activate` → `pending`, `request_epoch = 0`.

Trace every path to a distribution at that moment:

- `distribute(burn = true)`: `w == 0` → enters the `w == 0` branch → `require!(!burn && pending_this_epoch > 0)` → **`NoActiveVaults`**. The 100 $GARY path is *structurally unavailable*.
- `distribute(burn = false)`: reaches `require!(now >= last_distribute_at + monthly_secs)` → **`MonthNotElapsed`** until `charter_closes_at + 30 days`.
- `monthly_inline` in any host: `due` is false. Returns silently.

So `dist_epoch` cannot leave 0, no vault can join, and nothing can be distributed, **until 30 days after the charter window closes** — whatever anyone is willing to pay. Only then does the first free tick land (crediting nothing, by design), vaults join, and a $GARY burn can finally distribute.

**What this costs.** A charter member who funds on day 1 of the window waits ~37 days for their first payout, and up to ~67 if nobody burns. Whoever is *joined at that first tick* then shares the **entire pre-tick backlog** (secondary royalties on charter vaults, plus any paid round inside the first month) at the following distribution — potentially one vault, if only one member funded. The crank activates hourly, so in practice the set is "everyone who funded in time", which is the intent; but funding late forfeits the launch backlog, and nothing says so.

**Evidence that would exist if I am right.** In the sim: after `charter_closes_at`, with one funded and activated vault and cbBTC in the pool, `distribute(burn = true)` is refused `NoActiveVaults` and `distribute(false)` is refused `MonthNotElapsed`; the first success is the empty tick at `charter_closes_at + monthly_secs`, which credits nothing. (The sim already shows the shape at S7.2/S7.3 with `MONTHLY = 120 s`; nothing scales it to the ruled 30 days or states the consequence.)

**Fix (documentation).** HOLDER-GUIDE: *"The first payout cannot happen until a month after the charter window closes — not even by burning $GARY, because no vault has joined yet. Fill your vault before then: everything the Bank earns in the meantime is shared at that first payout by the vaults that are in it."* SPEC's pool section and DESIGN §3 should state the same in one sentence each. **This is the single most consequential undisclosed launch behaviour I found.**

### R2-L1 (LOW, undocumented load-bearing asymmetry) — `claim`'s join branch deliberately does not require a live asset

`activate`'s join branch calls `require_live_vault`; `claim`'s does not. That asymmetry is the only reason a bare-burned-while-waiting vault cannot wedge `JoinWaitingFirst` forever (`retire_burned` is the other exit). It is nowhere written down, and a future reader "tidying" `claim` to check liveness would create a permanent, owner-triggerable distribution block. **Fix:** one comment at `claim`'s pending branch. It costs nothing and the programs are about to be frozen.

## SPEC's weaker rule, attacked

SPEC's rule ("a vault is never credited by a distribution that ran before it joined; revenue already in the pool when it joins is shared at the next distribution by everyone joined then, the new vault included") survives every ordering I tried. Activate-then-distribute in one transaction is refused in the strong direction by 3c.A6's mechanism: the request's epoch is the *current* epoch, so `waiting_to_join` is still 0 and the distribution excludes the requester; only afterwards do they become eligible. Limit 55's unsplit-revenue edge is real, priced as stated (100 $GARY at the monthly boundary), and not worse. **No finding.**

---

# R2b. THE $CBOB BOOST — exact, including past epoch 64

**A boost earns exactly N distributions.** `end = dist_epoch + epochs` at purchase; `advance_epoch` increments `dist_epoch` by exactly 1 per distribution (empty ticks included) and moves `boost_expiring[dist_epoch % 64]` into `boosts_due`; no distribution may run while `boosts_due > 0` (`distribute` checks it **before** the `w == 0` branch and before any $GARY is burned; `monthly_inline` returns early and logs). So the vault is boosted for distributions `e+1 … e+N` and no more, and the accumulator at expiry is exactly where its last distribution left it. **Not one more, not one fewer.**

**Ring exclusivity past 64 — proven, including the case nobody states.** `MAX_BOOST_EPOCHS_BOUND = BOOST_RING − 1 = 63`. Any live (not-yet-due) end satisfies `dist_epoch < end ≤ dist_epoch + 63`, because `dist_epoch` cannot advance past the smallest live end (the gate freezes it there, and expiry clears it from `boosts_due`, not from the ring). A half-open window of width 63 contains no two integers congruent mod 64. **Note the case I checked that the comments do not:** `boost_vault` does *not* refuse while `boosts_due > 0`, so a boost can be bought while another is due — but `dist_epoch` is then frozen at the due epoch, the new end is still in `(dist_epoch, dist_epoch + 63]`, and the due boosts live in `boosts_due`, not the ring. **Exclusivity holds at every epoch and every wrap.**

**Nothing earned is lost or gained** across boost, expiry, claim normalisation or retire — `reweigh`'s carry/debt rewrite is owed-preserving (R2), and `expire_boost` calls `unschedule_boost` *before* `reweigh(c, r, 0)`, so `boost_weight_total` decrements by the old value.

**Totals agree.** `Σ boost_expiring + boosts_due == boosts_active`; `boost_weight_total == Σ` boost weights over active records; `total_active_weight` includes them. `books()` asserts all five — but only in section BO (C9).

**No record can be expired twice, early, or never.** `expire_boost` requires `boost_weight > 0 && dist_epoch >= end` and zeroes both. `expire_boosts` skips retired/inactive/unboosted/not-due. `retire` unschedules from whichever side is correct. "Never" is impossible while anyone is willing to send a free, permissionless `expire_boosts`, which reads no token account — that is precisely why it exists beside `claim`.

**Findings:** only the C2 residue (L2 below) and the holder-guide item HG-L1.

### R2b-L1 (LOW, evidence) — `unschedule_boost`'s early-removal branch is never driven past a ring wrap

**Construct.** `unschedule_boost`'s `else { boost_expiring[i] = boost_expiring[i].checked_sub(1)? }`, reached by `retire`/`retire_burned` of a vault whose boost is not yet due. BO.16 drives it at a low epoch; the BO.34 wrap sequence never retires early, and the boost terms are switched off immediately after. A sign error or off-by-one in that index past the wrap would not be caught.

**Fix.** Extend the host test (it already builds a `blank_config()` and calls `advance_epoch` directly): buy *and* early-unschedule across a wrap at N = 63 over 200+ epochs against an independent model, and stop writing `boost_expiring` by hand.

---

# R3. THE LEVEL DRAW

- **SlotHashes parse.** Key pinned to the sysvar id; `n ≤ 512`; `data.len() >= 8 + n·40`; all-zero hash refused; the smallest qualifying slot wins. Host tests cover a full buffer, over-declaration, truncation, a forged key and a zero hash.
- **Skipped slots.** `[want, want + 64]` inclusive; the host test pins both ends.
- **Determinism against buffer age — checked, and it holds.** `blockhash_in_window` would silently pick a *later* slot if the true smallest had aged out of the 512-entry buffer, which would make the draw depend on *when* it was captured. It cannot happen: capture requires `now ≤ reveal_slot + 300`, A lies in `[reveal_slot, reveal_slot + 64]`, B's target ≤ A+11 and C's ≤ B+11, so every window searched lies within 300 slots of `now` against a 512-slot buffer — 211 slots of margin.
- **FIFO.** `index == revealed_total`, strict. A burned vault at the head still takes its draw and skips the Core write (L.11), so the queue cannot stall at it.
- **Attribute re-supply hash.** Both sides Borsh-serialize `Vec<VaultAttribute>`; identical. For a burned vault the hash check is skipped along with the write — harmless, since nothing is written.
- **What a minter, crank or leader can influence.** Exactly limits 25 and 26, no more: capture is permissionless (so no party can withhold another's capture), reschedule requires a *lapsed* window (so no party can force a re-roll), and the reschedule target is `now + 16`, unknown when it lands.

**Is SPEC 26 worse than stated?** No. The round-24 arithmetic (best-of-4 → P(V) 5.0% → 18.6%; E[weight] 3.05 → 4.38; 64 tries → 96%) is the right model, and SPEC now says "choose among many draws" and names the cohort effect. **HOLDER-GUIDE now says it truly** at both sites. A1 is discharged at all four sites (guide ×2, SPEC 26, DESIGN §1, MINT comment).

**One holder-facing residual: see HG-M3** — the guide's "Nobody else can" sits alongside a complete absence of accepted limit 25 (the minter's lapse re-roll), which is tagged BUYER-FACING.

---

# R4. GOVERNANCE

### R4-M1 (MEDIUM, ruling conformance + holder-facing claim) — "half of ALL live vaults" is false whenever supply grows during a proposal

**Construct.** `programs/cbob-vault-gov/src/lib.rs`, `execute_proposal`:
```rust
let need_key = divisor.checked_mul(KEY_CHANGE_YES_BPS)?.checked_add(9_999)? / 10_000u128;
```
where `divisor = p.quorum_supply`, **snapshotted at `create_proposal`**. A proposal may run up to `MAX_VOTING_SECS` (30 days) and stay executable for `EXECUTION_WINDOW_SECS` (7 days) — a snapshot up to **37 days stale**.

**What this gains.** With a sale round open, up to 1,860 vaults can be minted between creation and execution. They cannot vote (`VaultTooNew` — correct and deliberate) **and they do not raise the bar**. A guardian replacement or a swap-operator arm then lands with YES from `ceil(50% of the old supply)`: e.g. **120 YES out of 2,100 live vaults, 5.7%**.

**Why this is a ruling-conformance finding and not just a doc nit.** DESIGN §11 RT2-2 reads: *"YES from at least **50% of ALL live vaults** (not of votes cast)."* In the growth case the code does not implement that ruling. The brief asks specifically for "where the code fails a ruling", and this is one.

**Round 24 ruled the related observation DOC-ONLY and prescribed a documentation fix. That fix landed only for the first-proposals case** (SPEC §4 "Where this stands" and DESIGN §10 now carry the top-three/24.2% arithmetic, correctly qualified by "no paid vault can exist before a round vote executes"). The general statement is still wrong in three places a holder or auditor reads as normative:

1. SPEC, GOV section: *"YES >= ceil(50% of the snapshot), **i.e. half of ALL live vaults** (`KeyChangeNeedsHalf`)"*;
2. SPEC accepted limit 47: *"YES from half of ALL live vaults"*;
3. **HOLDER-GUIDE, "Who can do what"**: *"replace the guardian or the swap bot's key (**only with yes from half of all vaults**…)"* — holder-facing.

**Evidence that would exist if I am right.** Create a key-change proposal at 240 live vaults with 120 YES; mint until 2,100 are live; execute inside the window. It passes. Round 24's own correction is the proof that no document anticipated the post-charter form.

**Fix, in order of preference.**
1. **Documentation**, all three places: *"half of the live supply **snapshotted when the proposal opened**, which during an open sale round can be a small fraction of the supply at execution; a key-change proposal should be executed promptly or re-voted."* State in the same paragraph that ordinary quorum has the same staleness.
2. **Optional, NOT recommended under the freeze:** use `max(snapshot, live_at_execute)` *for the key-change bar only*. Raising the bar is the safe direction for a key change, and the round-8 objection (`max` lets anyone block a proposal by minting) applies to *ordinary* proposals, where blocking is the harmful direction. But this is a program change during the freeze and the counters reset. **Recommend (1); flag (2) for the owner, not for the auditor.**

### R4-L1 (LOW) — GOV's "six CPIs" comment is contradicted by the project's own measurement

The doc on `pub const MAX_ACTIONS: usize = 5` reads *"Measured in the suite: an every-kind execute is **six** CPIs."* Six is unreachable, and I derived it rather than asserting it: `Brakes` is the only action that can emit two CPIs (`arm_guardian` + `restart`), and `set_guardian: true` can never share a proposal with `ArmSwapOperator` (`KeyChangesBundled`). So the maximum is `set_round` + `arm_guardian` + `restart` + `tighten_sweep` + `set_boost_terms` = **five**, which is exactly what E.7 now measures. Correct the comment to "five CPIs, measured by E.7" — bundled with some other program edit, since a comment-only change rewrites MINT-style bytes for nothing.

## Everything else in GOV, attacked and intact

- **A minority carrying what it should not:** quorum, threshold (>5,000 and ≤7,500), the 10% YES turnout floor (never binds at the ruled 21/51, which yields 10.71% — limit 35 confirmed) and the 50% key-change bar are all computed against the same snapshot with ceiling division and `need > 0` guards; `cast > 0` is required. The CPI account list is exactly `[mint_config (w), gov_pda (signer)]`, matching MINT's `Governed { config (has_one = governance), governance: Signer }` — there is no third account to smuggle.
- **A vote reaching money it should not:** the action enum is closed; `split_bps`, both destinations and `max_supply` have no setter anywhere (P.0e/P.0f prove the struct has no field for them, and 0.4i proves `update_wiring` is *deleted*, not gated). `tighten_sweep` is monotone (`max`/`min`) and double-bounded at creation and execution, with the rent-exemption floor mirrored in both programs (3c.M1).
- **Frozen forever:** limit 47 is correctly restated in SPEC. It is **not** worse: the guardian cannot touch redemption, activation, distribution, claims or any vault, and cannot cancel its own replacement — there is no instruction that writes `pending_guardian` except `arm_guardian`/`apply_guardian`, and `apply_guardian` is permissionless so nobody can sit on the notice.
- **Overtaken actions:** per-kind marks are written **before** the over-check for `SetRound` (red-team 3 finding 4's fix, correct), so a newer-but-expired round still supersedes; skips log and never revert.
- `p.executed = true` and the config marks are written before the CPIs; any CPI failure reverts them all. ✓

---

# R5. THE CHARTER CLAIM

- **Identity by address.** Leaf = `sha256(0x00 ‖ key)` (33 bytes), node = `sha256(0x01 ‖ a ‖ b)` (65 bytes), pairs sorted. Domain separation **and** differing preimage lengths: a second-preimage substitution of an internal node for a leaf is excluded twice over. Proof length ≤ 16 bounds compute and bytes. A zero-length proof would require `pob_root` to equal a leaf hash, which a 240-leaf root is not, and `pob_root != [0;32]` is enforced at `initialize`.
- **Spend-once without a bitmap** rests on measured fact 7 (a burned Core address cannot be re-minted) plus the in-instruction CPI burn. Sound.
- **`pob_extra`** is bounded at 8, bounded again by `remaining_accounts.len()`, split off before the crank accounts, and every pass-through meta is built non-signer regardless of how it arrived. Core's `BurnV1` meta/info list uses `MPL_CORE_ID` as the "None" placeholder for the two optional trailing accounts — the standard mpl-core convention, and `invoke` matches infos by pubkey so one `mpl_core` info serves both metas. OR.1–OR.6 exercise an approving and a rejecting real Core Oracle.
- **Not gated by the guardian** — by ruling, and C.13 measures it.
- **The window can never reopen:** two `i64`s and a clock, no setter, no governance action that reaches them.

### R5-L1 (LOW, completeness of an accepted limit) — SPEC 46 is now strong but omits two bounds a reader will ask for

Limit 46 is the biggest doc improvement in the round: it names both consequences (end the project; capture governance) and the mechanism (no vault ⇒ no proposal ⇒ no round, ever). Two things it still omits, neither widening the exposure:

1. **The alarm's "any plugin or update-authority change on the collection" detector is a *post-hoc state* signal with a ≤30-minute cadence.** A key holder who adds a hook, claims, and removes it inside one pass leaves no diff. SPEC 46 already says the key can "flip the oracle between transactions"; it does not say the detector cannot see that.
2. **The positive bound is missing.** That key *cannot* transfer or burn an individual Proof of Burn: Core gives a collection update authority no transfer or burn approval, and round 23 verified that permanent delegates cannot be added after creation. Its absence is why the limit reads as unbounded. State it.

A PoB holder can do exactly one thing — claim one vault per PoB, and transfer the PoB freely (the claim reads the *current* owner). A third party can do nothing. **No new exposure.**

---

# R6. ONE-TIME CONFIGURATION AND THE TRUSTED HOP

All four `initialize` calls match the documented bounds, with the known gaps already in item 38/A6: SEAL reads only the account **owner** (never that it is a mint, never duplicates, never a collection key); off-curve keys are accepted everywhere; `charter_opens_at` may be in the past; `redeem_window_secs` 10 s–24 h; `monthly_secs` 60 s–30 d; `notice_secs` 60 s–30 d. All of these are pinned by `scripts/check-launch-params.mjs` against `launch/mainnet-init.json`, which is the ruled control, and a wrong collection is refused by MINT and BURN (`WiringDiverged`) before anything mints.

### R6-L1 (LOW) — `sol_reserve_lamports = 0` is accepted, and a zero reserve lets small royalty payments *bounce*

`initialize` accepts `sol_reserve_lamports == 0 || >= RENT_EXEMPT_0_BYTES`. At zero, `sweep_sol_for_swap` may take the revenue PDA to exactly 0 lamports. A subsequent marketplace royalty payment smaller than the rent-exempt minimum for a 0-byte account (650,240 lamports on mainnet) into a 0-lamport system account is a rent-state transition the runtime **rejects**, so the marketplace's whole sale transaction fails and royalties on small sales silently stop arriving.

The ruled value is 0.05 SOL (above the floor) and `sweep_sol_for_swap`'s `bal >= keep + amount` preserves it, so this is launch-value hygiene, not a live defect — but item 52 says "fund it above rent at launch" without saying that a zero reserve lets the sweep undo that. **Fix:** name the mechanism in item 38's `sol_reserve_lamports` line. (Raising the `initialize` floor to `RENT_EXEMPT_0_BYTES` unconditionally would be a program change — not under the freeze, and unnecessary given the ruled value.)

## The swap operator's worst case, bounded

`max_sweep_lamports` per `sweep_cooldown_secs`, never below `sol_reserve_lamports`, never more than the revenue PDA holds, until the guardian pulls `emergency_stop_sweep` (instant, one-way). At the ruled 10 SOL / 6 h that is 40 SOL/day of **royalty SOL only** — mint prices are cbBTC and never touch it. A vote can only tighten, inside 1 SOL / 24 h / 0.1 SOL. Correct as documented (limit 10), and understated to holders (HG-M2).

## The royalty

Installed once with `Some(PluginAuthority::None)`. R.5/R.6/R.6a/R.6b/R.6c prove, on a control collection with a signable update authority, that `None` makes Core refuse both update and removal while `UpdateAuthority` permits both — the right control pair, with the removal arm proven to reach Core rather than failing client-side. R.8 proves an owner cannot add an asset-level override. **No instruction in any of our five programs issues `AddPluginV1`, `UpdatePluginV1` on Royalties, or `RemoveCollectionPluginV1`.** Nothing in our code, and nothing in Core at the pinned build, can change it.

## The redemption cap is exactly a rolling window

`k = min(max(cap,1), 64)`; `kth = rate_ring[(head + 64 − k) % 64]`; refuse unless `now − kth >= window`; then write at `head` and advance. `head` is the *next* write slot, so `head − k` is the k-th most recent; at `k = 64` it reads the slot about to be overwritten, i.e. the 64th most recent. ✓ Zero-initialised ring ⇒ the first `cap` land. A shrinking live supply shrinks `k`, which reads a **more recent** entry — stricter, never looser. A backwards clock makes `now − kth` negative and the redemption is refused: **fails closed**. `rate_head` can never exceed 63.

---

# R7. CROSS-PROGRAM RAW READS — recomputed field by field, all correct

`MintConfig`, Borsh, after the 8-byte discriminator:

`version 8 · collection 9 · governance 41 · pool_ata 73 · round_id 105 · opens_at 109 · closes_at 117 · price 125 · cap 133 · minted_this_round 137 · minted_total 141 · max_supply 149 · bank_treasury 157 · split_bps 189 · sales_stopped 191 · sweep_stopped 192 · guardian 193 · swap_operator 225 · sol_reserve 257 · bump 265 · max_sweep 266 · sweep_cooldown 274 · last_sweep 282 · level_caps 290 · level_minted 310 · revealed_total 330 · payment_mint 338 · pob_collection 370 · pob_root 402 · charter_opens 434 · charter_closes 442 · charter_claimed 450 · bare_burns_retired 454 · total_active_weight 462 · active_count 470 · acc_scaled 478 · owed_scaled 494 · last_distribute_at 510 · sales_stopped_at 518 · sweep_stopped_at 526 · pending_swap_operator 534 · pending_swap_operator_at 566 · monthly_secs 574 · pending_guardian 582 · pending_guardian_set 614 · pending_guardian_at 615 · notice_secs 623 · sweep_floor 631 · cooldown_ceiling 639 · reserve_ceiling 647 · dist_epoch 655 · pending_count 663 · pending_this_epoch 671 · cbob_mint 679 · max_boost_weight 711 · max_boost_epochs 712 · boost_price 714 · boost_weight 722 · boost_epochs 723 · boosts_active 725 · boosts_due 729 · boost_weight_total 733 · cbob_burned_total 741 · boost_expiring 749..1005`

- **GOV's eighteen constants: all correct**, including the three stage-3c bounds (631/639/647) and the two boost bounds (711/712). Its `require!(d.len() >= 714)` covers the widest read.
- **BURN's three: correct** (8 / 141 / 454), with `require!(d.len() >= 462)`.
- **MINT's reads of SEAL: correct** (8 / 9 / 41), `n <= 3` bounded, buffer length checked before indexing.
- **BURN's read of SEAL: correct**, same offsets, `n > 0 && n <= 3`.
- **GOV's `VaultRecord` read: correct** (8 / 9 / 41), with the PDA derivation, owner, discriminator, version **and** the asset written inside all checked.
- **Account spaces all correct:** `MINT_CONFIG_SPACE` = 1,005 + 256 = 1,261; `VAULT_RECORD_SPACE` = 211 + 10 = **221** (matching SPEC's 221 and the quoted rent); `BurnConfig` = 571 + 256 = 827; SEAL = 8+1+32+4+96+1+256; `GovConfig` = 94 + 256 = 350; `Proposal` = 259, with `ACTION_MAX_BYTES = 37` genuinely the largest variant (`Brakes` = 1 + 3 + 33; `SetRound` 29, `ArmSwapOperator` 33, `TightenSweep` 28, `SetBoostTerms` 12).
- **The sweep helper's raw reads** (mint 0, owner 32, amount 64, len **exactly** 165): correct, and `==` not `>=`, so a Token-2022 account can never be read as classic.
- **The suite's own offset constants match the structs**, so the arms read what they claim.

**No finding.** This is the one area where a silent misread would be invisible to the type system, and it is clean.

---

# R8. THE SUITE, THE SIMULATION AND THE BUILD AS EVIDENCE

Beyond R0-M1, R1s-M4 and R1s-L3:

### R8-L1 (LOW) — arms that cannot fail, or are refused for a reason other than the one named

- **P.11a** — vacuous when `picks.length === 0`: both sides are the empty string. The round-24 fix was prescribed and not applied.
- **SR.2** — the title claims a destination-wallet restriction; the code has none (R1s-M2). It is refused by the `to_owner != dest` pair-consistency check.
- **S7.4** — `paid > 0n && paid <= avail` admits almost any arithmetic.
- **3.7** — pinned to bare `0x9`, shared with R.6; it does not distinguish "frozen plugin rejected" from "wrong authority", which is exactly the distinction R1s-M1 needs.
- **5.2** — the title claims a PDA owner cannot mint; the pin is `AccountNotSigner`, a different property (and the real property is unenforceable on BPF, measured fact 5).
- **10.2** — "fits the COMPUTE ceiling" is a measurement, not a refusal.
- **X.7** — honestly relabelled in round 22; the planner's ordering is proven only in `bank/selftest.mjs`.
- **RL.7** — bounds by the largest live supply ever, disclosed in its own text.

### R8-L2 (LOW) — claims in this brief that no arm exercises

Beyond the thirteen sweep shapes (R1s-M4): a **transfer of the asset between open and burn** (the shape that makes the owner re-read load-bearing); a **two-redemption transaction landing successfully** at cap ≥ 2 (only the refused form exists); the **`claim`-during-pool-freeze revert inside a redemption** (3c.F2 builds the *correct* client shape, not the incorrect one, so "a claim that pays reverts the whole redemption" is reasoned, not measured); **the redemption's compute units**; and a **Token-2022 ATA for a classic mint being uninitializable**, which the whole reserve-coverage argument depends on.

### R8-INFO — which bytes actually ran

`run-tests.sh` deploys from `$ROOT/target/deploy`; `build-mainnet.sh` proves hashes for rebuilds in `$CACHE/{mn,ln}`. Nothing records the sha256 of what the suite deployed (R1s-L3). The hard gates around Core (pinned hash, hardcoded and non-overridable, plus the on-chain `cmp`) are genuinely strong and I found no way around them short of editing the source — which is the stated design.

### E0 (MEDIUM, process) — this round executed nothing, so it cannot count toward the ship gate

**Construct.** Ship gate 3: *"Two consecutive clean rounds against that frozen tree, where 'clean' means no finding survived measurement."* No finding in this report survived measurement, because no measurement occurred. `scripts/run-tests.sh` was not run; `sim/run-sim.sh` was not run; `scripts/build-mainnet.sh` was not run; `cargo test -p cbob-vault-mint` was not run; `sim/swap-fork.sh` was not run; the live-mainnet probe was not run (and the ship gate explicitly requires it to have **RUN**, not SKIPPED).

**What an accident gains.** A reader who files this report as "round 25: no CRITICAL, no HIGH" and advances the counter would be counting a reading pass as a measuring pass. That is the precise failure the floors in `run-tests.sh` exist to prevent, committed one level up.

**Fix.** Before anything in this report is acted on, run, on the release commit, in this order: `cargo test -p cbob-vault-mint --features localnet --lib`; `scripts/run-tests.sh` with `CBOB_SHIP_GATE=1` (so the mainnet probe and the swap fork cannot be skipped); `sim/run-sim.sh`; `scripts/build-mainnet.sh`. Record every floor line. Then re-read this report against the output: if any number here disagrees with a measured one, the measured one wins.

---

# HOLDER-GUIDE: sentences that are still not true of the code

I read every sentence against the source. Most are now accurate — D1, D2, A1 and the limit-46 paragraph all landed. These remain.

### HG-M1 (MEDIUM) — "Every opening is public. It is announced on X and on the Bank's website."

**Construct.** "Things to know before you open." **Reality:** `bank/redemption-poster.mjs` drafts and has no sender; the website surface is not chosen (item 50, OPEN AND BLOCKING; the control table marks it **PROCEDURE — run by hand; drafts only**). The chain emits `CBOB_REDEEMED <asset>` and the `VaultBurned` event, so openings are *discoverable*, not *announced*. **Fix:** build the sender before launch (item 50 already requires it) or write "Every opening is recorded on chain, and we publish them" with the honest caveat.

### HG-M2 (MEDIUM) — the swap sentence describes the floor and omits the trust

**Construct.** *"Royalties arrive in SOL, so a swap bot (a key, not the programs) turns that SOL into cbBTC before it is split. It trades only through fixed pools … and refuses any price below a floor taken from Pyth's price feed."* **Reality:** true of the swap *transaction*, false as a description of the *hop*. The operator key **receives the SOL on chain** (`sweep_sol_for_swap`) and nothing on chain obliges it to return anything; the bound is cap × cooldown windows until the guardian stops it (limit 10 — the only trusted key left in the system, and not tagged BUYER-FACING). Round 24's D3 asked for "one line on the swap operator"; the line added makes the hop sound *safer*. **Fix:** add — *"That bot holds a key. If it were stolen, up to 10 SOL of royalty income every 6 hours could be taken until the guardian stops it. It can never touch a vault, the pool, or cbBTC."*

### HG-M3 (MEDIUM) — three BUYER-FACING accepted limits are absent or stripped of their consequence

I checked every limit tagged **BUYER-FACING** in SPEC against the guide. Limits 26, 28, 41, 43, 44 and 46 are all present and accurate. Three are not:

- **Limit 25** (a minter who dislikes their draw can let the window lapse for a re-roll): **entirely absent.** The guide's level-draw bullet ends *"Nobody else can,"* which a reader takes as "and the minter certainly cannot." The minter cannot *pick* among results — but they can decline one and get a fresh roll if nobody captures for the whole ~2-minute window, and both the crank operator and the minter's own client can withhold a capture.
- **Limit 39** (immutability makes every surviving bug permanent): the guide presents immutability **only** as a benefit — *"The rules cannot change. … Nobody holds a key that can rewrite them, including us."* The other half, that a bug in redemption, the pool, governance or the charter claim **cannot even be stopped**, is the single largest risk a buyer takes, and it is not there.
- **Limit 40** (Metaplex Core is upgradeable): present as *"Metaplex controls the NFT standard (Core) the vaults are built on"* with **no consequence**. Round 24's A5 named two: a Core change to the burn tombstone makes every redemption refuse `NotBurned`, and a Core change to `UpdatePluginV1` halts the level queue so no later vault can be revealed or activated.

**Fix.** Three bullets in the honest list, in the guide's own register.

### HG-M4 (MEDIUM) — "comes out to you" is a promise the code does not keep

See R1s-M2. *"whatever cbBTC, $GARY, $GIRAFFISH or SOL is in it right then comes out to you"* is true only if the page names the owner as the destination. Either bind it on chain or soften the sentence.

### HG-M5 (MEDIUM) — "yes from half of all vaults"

See R4-M1. It is half of the supply snapshotted when the proposal opened.

### HG-M6 (MEDIUM) — the first month

See R2-M1. *"A payout is due every month"* and *"Anyone can speed one up by burning 100 $GARY"* are both false for the first `monthly_secs` after the charter window closes.

### HG-L1 (LOW) — smaller inaccuracies

- *"then it goes back to its level's share by itself"* (boosts). It does not: `expire_boosts` or a `claim` must be called, and **until it is, no payout can run for anyone**. Economically the boost can never earn an extra distribution, so the outcome is as promised; but a boost ending *pauses payouts protocol-wide until anyone (free) ends it*, which is a holder-visible event.
- *"Your level is drawn for you a few seconds after you get your vault."* The earliest possible is ~15 s (reveal slot + two leader-group strides), and reveal is FIFO behind every earlier vault — at a 240-vault charter cohort that is minutes to hours for the tail. "Within a few minutes" is honest; "a few seconds" is the best case.
- *"Opening is limited to 2.1% of the vaults still sealed in any hour (about 45 an hour at 2,100 vaults)"* — the parenthetical is the end state. At the charter cohort (≤240) the cap is **6 an hour**, and launch is when a rush is most likely. Add "early on, with fewer vaults, that is a handful an hour."
- *"The community vote … can"* omits tightening the swap bot's limits. The table reads as exhaustive.
- Present tense about an unbuilt page: *"On the redeem page that cannot block the opening"* and *"The redeem page offers this and does the steps for you."* "Things to know" gets this right ("the redeem page (being built)"); the honest list and the payout section do not.
- **Limit 56** (all 2,100,000,000 $CBOB on a hot key on this box) is not tagged BUYER-FACING but its stated victims include *"every vault holder, through boost-weighted payouts"*. If that key leaks, the thief can boost vaults they own by +12 for 24 distributions each, diluting every other holder. One line in the honest list.

---

# THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

## 1. Is any limit WORSE than stated?

- **Limit 47 (stolen guardian key)** — not worse than SPEC's current text, but its **holder-facing form is**: the guide's "only with yes from half of all vaults" is both the wrong bar (R4-M1) and silent on the permanent-stop case.
- **Limit 10 (the trusted hop)** — not worse on chain, but **worse in the holder guide** (HG-M2): the new sentence describes the Orca/Meteora/Pyth machinery and reads as trustless, omitting that the operator need not swap at all.
- **Limit 46** — complete enough after A2; two omissions noted in R5-L1, neither widening the exposure.
- **Limits 26, 32, 55** — accurately restated, including the ring's bound at 64 covering live supply to 3,047 and being stricter above, and the 100 $GARY monthly-boundary correction. **Not worse.**
- **Limit 25** — accurate in SPEC; **absent from the guide**, which is where it matters (HG-M3).

## 2. Is anything listed as a limit not actually a limit, or closed by something the author did not notice?

**Yes, one, and nobody has noticed it.** **Limit 44's redemption half is now narrower than stated for an entire class of stray holdings.** It says "an owner who redeems by any other client destroys the nested asset", and `judgeRedemptionCoverage` is described as a *warning*. True for nested Core assets and for tokens held in non-standard ways — but the sweep helper, used as item 50 requires, **now rescues any classic SPL token account owned by the vault PDA that the page names, including non-ATA accounts and non-reserve mints.** The helper imposes no ATA derivation and no mint allowlist on sources. So for stray *classic token accounts*, `judgeRedemptionCoverage`'s output is not merely a warning any more: it is an actionable **sweep list**, and the loss in limit 44 is avoidable for that whole class. No document says this and no client does it. **Fix:** say so in limit 44 and in item 50's redeem-page requirements — it is free value for holders and costs one loop in the page.

**Also:** the CPI-wrapper half of **limit 43** is fully discharged by WR.1–WR.4 and can be read as measured, not reasoned.

## 3. Is any DISCHARGED item not actually discharged?

- **Item 54 (compute at the widest host shapes)** — discharged for the crank and for mint/reveal, but its own text now binds the **holder pages**, and the redemption, the one holder transaction that must land, has **never had its compute units measured** and its **byte headroom is unrecorded** (R1s-M3, R1s-L2). Item 54's discharge note says "what it requires of the holder pages is a requirement of item 50, which stays OPEN" — correct bookkeeping, but the measurement item 50 needs does not exist.
- **Item 51 (the $CBOB boost)** — discharged, and the mechanism is sound (R2b). Its disclosure list is complete except that it never says **one unexpired due boost halts every distribution protocol-wide** until somebody calls `expire_boosts`. That is the gate that makes "exactly N" true, and it is a liveness dependency on a permissionless caller.
- **Items 33, 12/17** — genuinely discharged (3c.K5/3c.G2 for the notice; the padded-mint path for compute, correctly re-qualified by item 54).

## 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**Yes: item 50, and HOLDER-GUIDE is already writing in a voice that treats parts of it as done.** The guide says, in the present tense, *"On the redeem page that cannot block the opening"*, *"The redeem page offers this and does the steps for you"*, and *"Every opening is public. It is announced on X and on the Bank's website."* The page does not exist and the poster has no sender. A reader of the guide alone would conclude item 50 is closed. Items 22, 38, 52 and 53 are correctly kept OPEN; item 53's `d57ee3a` proof is correctly marked stale.

---

# ANYTHING ELSE

**X-1 (INFO).** `distribute`'s `read_token` before the `w == 0` branch — already captured as round 24 D8 / item 52 ("until the pool's cbBTC account exists every `distribute` refuses, even the free launch tick"), and `monthly_inline` degrades gracefully. Confirmed by reading; road step 10 is the control and it is correctly ordered. **Note this compounds R2-M1**: if the pool account is somehow missing at `charter_closes_at + monthly_secs`, the explicit launch tick fails and only an in-line host run can open the door.

**X-2 (INFO).** `claim`'s `crank_n` and the pair list cannot corrupt each other. The crank writes only level-0 records; `claim`'s pair loop re-reads each record from the account after the crank and skips anything neither `pending` nor `active`, which a level-0 record cannot be. `activate`'s crank-then-Anchor-overwrite hazard is closed for the same reason: a level-0 record always errors `NotRevealed` and reverts. Round 24's W14 is right. An arm is still worth having (C9).

**X-3 (INFO).** `join` indexes `LEVEL_WEIGHTS[(r.level - 1) as usize]` without a range check. With `overflow-checks = true` a level-0 record would abort rather than read out of bounds — and it cannot happen, because `activate` requires `(1..=5).contains(&r.level)` before setting `pending`. Safe, but it is the one place in the pool code where the guard is three functions away from the use. A one-line `require!` or a comment would make it local.

---

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Concrete things this process structurally cannot do, with what to do instead. None re-litigates a ruling.

**1. Run this round's gates before acting on this round.** See E0. This is first because everything else here is conditional on it.

**2. Buy adversarial attention with money, not with prompts.** Deploy the five programs to a public devnet or a mainnet fork at the release commit, publish the IDLs, SPEC and holder guide, and run a time-boxed bounty (4–6 weeks) with a published, escrowed pot and a crisp scope: a working exploit transaction against custody, the pool invariant, the rate limit, or the sweep helper. AI rounds re-read the same tree; an incentivised stranger brings *a wallet and a grudge*, which this process cannot synthesise. **The sweep helper and the first paid round are the two things most worth paying for.**

**3. Run a real, small, adversarial charter window before the lock.** Road step 8 is a dress rehearsal with throwaway ids; make it a **public** one. Ten outside holders, real Proofs of Burn on a throwaway collection, real (tiny) cbBTC, and an instruction to try to break each other's redemptions. Humans find the shapes a test author does not imagine — a stranger creating a reserve ATA at the wrong moment, a wallet that reorders instructions, a marketplace escrow that looks off-curve.

**4. Close the one key that can end the project, for seven days only.** Limit 46 is now documented in full, which is what the ruling required. The *operational* answer costs nothing and is not a design change: move the Giraffish Moments update authority into a 2-of-3 Squads (or an air-gapped key) **for the duration of the charter window only**, then move it back. No code change, no re-litigation of "keep it hot", and it removes the only single key that can prevent the project existing. Put it to the owner as a dated, reversible operational choice, not as a finding.

**5. Measure the two things that decide whether a holder can actually get out.** (a) Land a real three-asset redemption with a priority fee on mainnet (throwaway ids, tiny value) during a busy hour; if the legacy packet cannot carry one, ship and measure the v0 + address-lookup-table form. (b) Run the crank at 2,100 vaults against a live RPC (item 22). A local validator cannot produce rate limits, dropped transactions, or a leader that skips.

**6. Have a second party reproduce the build.** `build-mainnet.sh` proves the mainnet binaries reject the test key and that the source names Gary's wallet; it explicitly does **not** prove the compiled constant *is* that key. The stated bridge is reproducibility, and nobody has ever exercised it. One person outside this box, the release commit, the pinned toolchain, matching sha256s published **before** deploy. Thirty minutes of human work converts an honest "NOT PROVEN" into a proof.

**7. Sequence the lock behind real value, not behind a test.** The ruling is immutability at launch; the ruling does not say *which* launch. Make road step 11 explicitly after (a) the charter window has closed with real claims, (b) one real distribution has been credited and claimed, and (c) one real redemption has completed end to end on mainnet through the final page and helper — with the upgrade authority held by a cold multisig and a public, dated commitment to burn it. That is an ordering decision, not a change to the ruling, and it is the only thing that converts "every surviving bug is permanent" from a stated risk into a bounded one.

**8. Write the thing no model will write: the incident runbook.** Who holds the guardian key, where, how fast can they reach it, what are the two exact commands, and who decides. The guardian stop is the only lever that exists after the lock, and its value is entirely a function of a human's response time. There is no file in this bundle that tells that human what to do.

---

# UNCERTAINTIES, FLAGGED EXPLICITLY

- **Core's `ExecuteV1` authority rule** (R1s-M1). I believe only the asset owner is approved at the pinned build; I could not verify it this turn, and no arm tests it on a thawed vault. **If that belief is wrong, R1s-M1 becomes CRITICAL and R1s-M2 becomes moot in the worst way. This is the single most load-bearing unverified claim in the bundle and should be settled with an arm before anything else on this list.**
- **S8.0's measured byte count** (R1s-M3). The brief's "(1,232 bytes)" may be the measured value or a gloss on the packet limit. The finding is written to be useful either way; it needs one `console.log`.
- **`spl-token`'s `CloseAccount` and the frozen state.** I am confident it does not check `is_frozen`, which is why a frozen *empty* source still closes. If it does check, a frozen zero-balance reserve account would block a redemption the sweep would otherwise complete. One arm settles it.
- **Token-2022's rejection of a classic mint in `InitializeAccount3`.** I am confident, and the whole reserve-coverage argument depends on it. It is unarmed. One ATA-program arm settles it.
- **`cargo-build-sbf` target-directory determinism** (R1s-L3). I expect the artifacts to be identical; I am filing the gap in the evidence chain, not asserting they differ.
- **No build, no test run, no on-chain measurement this round.** Every claim above is at the reading level. Treat the measured facts in the brief and in the bundled verdicts as measured; treat everything I add as a hypothesis with a stated test.

---

## SUMMARY OF FINDINGS

**CRITICAL: 0. HIGH: 0.**

**MEDIUM (10):** R0-M1 (round 24's evidence repairs partial) · R1s-M1 (Core Execute authority unverified on a thawed vault) · R1s-M2 (helper destination not bound to the owner; generic drainer) · R1s-M3 (redemption packet headroom unrecorded) · R1s-M4 (helper has 13 unexercised shapes; SR.2 overstates) · R2-M1 (no payout possible for a month after charter close; undisclosed) · R4-M1 ("half of all live vaults" is half of a stale snapshot — fails the ruling as written) · HG-M1/M2/M3 (announcements, the swap hop, three absent BUYER-FACING limits) · E0 (this round measured nothing).

**LOW (9):** R1s-L1 (rent-exempt destination) · R1s-L2 (redemption CU unmeasured) · R1s-L3 (deployed bytes not linked to certified bytes) · R2-L1 (`claim`'s liveness asymmetry uncommented) · R2b-L1 (early unschedule never driven past a wrap) · R4-L1 (the "six CPIs" comment) · R5-L1 (limit 46's two omissions) · R6-L1 (`sol_reserve = 0` accepted) · R8-L1/L2 and HG-L1 (weak arms, unexercised claims, smaller holder inaccuracies).

**Verdict: NOT CLEAN**, for three independent reasons — holder-facing sentences that are still not true of the code (HG-M1 through HG-M6), the sweep helper's unbound destination and absent evidence (R1s-M2, R1s-M4), and the fact that this round executed nothing (E0). The two-round counter stays at **0 of 2**.