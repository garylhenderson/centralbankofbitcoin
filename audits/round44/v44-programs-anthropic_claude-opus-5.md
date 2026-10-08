# Independent audit, round 44 — five programs, the web surfaces, the suite and the launch tooling

Audited tree as bundled. I read all five programs line by line, recomputed every cross‑program offset and every account space from the struct definitions, re‑derived the Merkle scheme, the rate‑limit ring, the boost ring and the pool accumulator by hand, and read all of `web/src`, `web/deploy`, `web/meta`, the bundled tests, the runners and the new `launch/rehearsal-init.json`. I ran nothing (no validator, no job, no network).

**Verdict on round 43 first, because it is the stated first target.** I re‑derived both of round 43's confirmed findings and both repairs and I agree with its grading, including the one place where it refused to inflate. I found **no new defect in the five programs** and **no path that moves or miscredits value**. The six findings below are all LOW/INFO in the fixable layer (pages, tooling, docs, one suite arm). None is in (a)–(d) of SPEC gate 3, and I say why for each. That is not a pass on the system: section 9 says plainly what I could not measure and what nobody has measured.

---

## R0. Round 43's verdict, and its repairs

**V43‑1 (host owner keeps a nested vault during his own crack) — confirmed by the current tree, and the repair is the right shape.** I re‑derived the mechanism from source: SEAL's walk (`programs/cbob-vaults/src/lib.rs:225‑248`) only requires a *later* top‑level `burn_vault` for the same asset and owner and places no restriction on the instructions between; BURN refuses only a **declared** live `AssetV1` (`burn/src/lib.rs:350‑354`); `PermanentFreezeExecute` gates only Execute (`permanent_freeze_execute.rs:43‑52` at Core `e72d63e`), so a sealed vault remains transferable by its owner. The arm `R43.V1` in `tests/3prog.test.ts` now *measures* it, on the burned fixture `Z` with an empty nested vault `NZ`, and asserts the exact post‑state (`ALLOW`, `NZ.owner == alice`, `Z` gone); `R43.V1a` then pins the rescue's refusal to `NotNested` through `because()`. The arm cannot pass vacuously: all three measured values would move if Core refused. Placing it on `Z` rather than on two fresh vaults is correct — the first attempt broke `P.2a`'s census arithmetic, and `P.2a` is itself the arm that keeps the level‑draw section honest.

**I verified the repair at every site of its shape.** The holder guide now carries the race (`HOLDER-GUIDE.md`, honest list: "Until it runs, a vault sent into someone else's vault can be kept by that vault's owner, who can take it out while opening their own vault"); SPEC's section‑9 table, proven impossibility 3 and limit 58 all carry it; limit 58 records Gary's 2026‑10‑08 ruling. The crank repair I **cannot verify**: `bank/crank.mjs` and `bank/detectors.mjs` are in the other pass, so `planRescues` is outside my measurement (section 9).

**V43o‑1, V43o‑2, V43o‑3.** `release_gate` in `scripts/run-tests.sh` is present and I read it closely. Outside a rehearsal tree it is the unchanged `git diff --quiet $rel -- programs Cargo.toml Cargo.lock`, which compares the **working tree** (so an uncommitted program edit is caught). Inside a rehearsal tree it proves (i) the map is exactly the five ids plus the root, (ii) no id is unchanged, (iii) the recorded files still hash to `.rehearsal-sha`, (iv) all four keyed programs are patched, (v) every differing program file is a recorded one, and (vi) each differing file reverses to `RELEASE_COMMIT` byte for byte. That is a real proof of "the difference is exactly the recorded substitution". Two limits worth stating rather than filing: the gate reads its own evidence (`.rehearsal-map`, `.rehearsal-sha`, `REHEARSAL-RECORD.txt`) from the tree it is judging, so it catches drift, not a forged record; and in the rehearsal tree the **web offline gate (682 assertions) is skipped by design**, so item 53's required re‑run at the release commit will certify less than a full run does. SPEC says both.

**Claims round 43 disproved, re‑tested from first principles.**
- `MINT_CONFIG_SPACE`: I summed it independently → `193 + 261 + 64 + 64 + 97 + 582 = 1261`, of which 1005 is data. MiMo's "97 bytes short" is wrong; line `mint/src/lib.rs:2550` *is* the 97‑byte stage‑3c block. Disproved.
- `CompressV1`: at `e72d63e` `compress` returns `NotAvailable` unconditionally, and the pinned binary carries that string. No `HashedAssetV1` can exist. Disproved at the pin; the *upgrade* case is limit 40's class (and note the extra consequence below, under limit 40).
- GLM's LOW‑1 (a promised stray dropped silently at the press): I traced `canReceive` → `noAccount` and confirmed it is always `true` in the first plan (`plan-redeem.mjs:184`), so the `left:` box cannot exist there; at the press `aboutKnown` keeps it un‑consented (`:264‑267`) and `prepareOpening` stops on `ack` (`:335‑336`). Disproved.
- GLM's LOW‑2 (ceremony re‑uses a funded step‑0 key forever): `STEPS`' `build` generates a fresh `Keypair` on **every** call (`plan-ceremony.mjs:203`) and the "taken" branch re‑renders (`ceremony.mjs:206‑212`). Disproved.

**Web surfaces re‑audited independently (round 36–43's conclusions tested, not inherited).** I re‑derived the whole redemption plan, the press loop, the grouping rule and the consent model and found them internally consistent, including the two places a reader expects a bug: `drop()` removes from the list that holds the item (V38‑1), and at the press every promised account is re‑read **by address** (`reads.mjs vaultWalletAccounts`, `promised`), so neither a failed listing nor the 200‑account cap can hide one. I confirmed the refusal set is exactly what the programs refuse plus what would cost the holder's own reserves — nothing a stranger can cause. One real robustness gap remains (F1).

---

## R1. Custody: can anyone but the owner get value out, or an emptied vault survive?

**No, on both counts, and I can state the argument that closes it rather than the tests that suggest it.**

- **No surviving thawed vault.** If the transaction commits, SEAL's walk found a top‑level `burn_vault` for this asset *and* owner later in it, and that instruction either executed Core `BurnV1` or the whole transaction reverted with the thaw. Every escape I constructed fails closed: a second `open` of the same asset after the burn dies at `read_core_asset` (1‑byte tombstone → `NotACoreAsset`); a duplicate `burn_vault` dies the same way, taking the transaction with it; a transfer of the asset between open and burn makes `burn_vault` fail `NotTheOwner`. The account‑index binding (SEAL 0/2 ↔ BURN 0/2) is pinned by constants in both sources *and* fails closed if the structs ever drift: a reorder breaks the forward match, which kills the happy path (4.2) before it could permit anything.
- **CPI wrappers.** `load_instruction_at_checked` sees top level only, and both halves bind asset and owner; `retire_redeemed` additionally requires `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1` **and** that the top‑level instruction is BURN's `burn_vault` with this asset at account 0, so only a *direct* CPI from a top‑level BURN reaches it. WR.1–WR.4 measure all three shapes.
- **Emptiness proof.** `asset_signer.lamports() == 0` precedes everything; the reserve loop requires every reserve ATA under both token programs to be present, PDA‑owned, undelegated (all three COption/u64 slots), extension‑free (`len == 165`) and zero; loop 2 repeats those checks for any declared account the PDA owns and refuses a declared live `AssetV1`. **The closed‑account case passes for the right reason, and the reason is not BURN's**: after the helper's `CloseAccount` the account is System‑owned with zero data, so BURN's `acc.owner != SPL && != T22 → continue` skips it — the emptiness guarantee comes from SPL Token itself, which refuses to close a non‑native account holding a balance (measured as `0xb NonNativeHasBalance` in SR.3). Worth writing down, because a future reader could mistake the `continue` for a hole.
- **Token‑2022 extensions, delegates, close authorities, lamports, nested assets, declared‑but‑foreign accounts**: each has a named refusal and a `because()` pin. The declared T22 ATA for a classic mint can never exist (F4.2).

**Completeness is the gap, and it is stated.** The page declares exactly the six reserve ATAs and nothing else, so BURN only ever inspects those six — which is simultaneously why no stranger can force a refusal (round 40 V40‑4) and why anything undeclared dies (limit 44). I could not construct an account a stranger can create that BURN refuses.

## R1s. The sweep helper

**(a) Access control.** Called directly the helper moves only the *caller's* holdings (`src_owner != *signer.key → IllegalOwner`), and a vault's holdings sit behind Core's asset‑signer PDA, for which only Core signs. Through Core, the gate is Core's `ExecuteV1` authority rule on a thawed vault. I re‑read that rule at `e72d63e`: the asset approves Execute only for `authority == owner`, the collection abstains, and the one approving route is the AgentIdentity external adapter, which an owner cannot add (R24.1a measured) and which our Core CPIs never add. SR.5/5a/5c/5d/5e measure a stranger, an owner‑added transfer delegate and a collection update authority, each refused `0x1a`, with balances, owner and seal preserved. **It cannot be reached while frozen**: Core refuses Execute on a frozen `PermanentFreezeExecute` (measured as Core `0x9`, arm 3.7), and outside a redemption there is no thaw.

**(b) The pair list.** I worked the table out by hand rather than from the arms. Same source twice: the first iteration closes it, the second fails `read_token`'s owner check — and SR.12b *proves the reason is the second, closed source rather than the source‑owner guard*, which is the right way to pin an error that two paths share. Source also a destination is arithmetically impossible (`to_owner == dest`, `src_owner == signer`, `signer != dest`). A destination twice simply accumulates. A native wSOL source works: `amount` moves, then the close hands the remaining lamports to the destination wallet; **no arm exercises it** (carried as round 42 C9 / round 43 C20). A delegate on a source is irrelevant (the owner signs); a kept close authority reverts the whole call (R36.C5, round 35 C5); frozen reverts (SR.14, pinned `0x11`). A non‑ATA destination is fine as long as its `owner` field is the named wallet. Odd list → `NotEnoughAccountKeys` (SR.7); zero pairs → lamports‑only sweep (SR.13, which checks the exact `CBOB_SWEEP lamports=` figure).

**(c) Destination checks.** The helper never compares the destination with the asset's owner, and **it cannot**: the asset is not in its account list and is not recoverable from the signer PDA. Given (a) that is safe against third parties — but it means the destination of a redemption is 100 % the client's choice, with no on‑chain check anywhere. That is the substance of F4(c) below. A credit below rent exemption to a non‑existent destination is refused by the runtime (R41.C8a–c), which the lamports‑only shape must mind; the canonical destination (the owner, who pays the fee) always exists.

**(d) The lamport sweep.** It reads `signer.lamports()` at execution and empties a data‑less system account to zero; nothing between it and the burn can re‑credit it in the page's shape, and the shape is one atomic transaction. BURN's `lamports == 0` therefore sees exactly what the sweep left. SR.4a is the arm I would have asked for: it reconciles every lamport (the stranger's gift, the wallet's prior balance, the closed account's rent, the asset's released rent, minus the fee) and cross‑checks the helper's own log line.

**(f) Fit.** S8.0 measures 1,061 bytes for claim + open + helper(3 reserves) + burn with the owner paying, and asserts headroom for a compute‑budget pair (52) and a separate payer (96) → 1,084 of 1,232. The page uses neither (R40.U1 measures the same shape landing under the default budget with **no** compute‑budget instruction), a fourth reserve is impossible, and the in‑line monthly run adds no account (the pool is already in both claim and burn). Strays are dropped by `planRedemption`'s packet loop until it fits. It fits.

**(g) Evidence.** SR.6–SR.12a and SR.14 pin every refusal branch to the exact `ProgramError` through `attP`, which keeps the "Program … failed:" lines a bare `ProgramError` would otherwise lose. The helper's bytes are proven identical in `dist/`, the localnet rebuild **and** `target/deploy` — the last of these being the build the suite and the sim actually deployed (round 25 N6). That is the only one of the five programs whose shipped bytes are the tested bytes, and it is proven three ways.

## R2 / R2b. The pool and the boost

**The invariant holds.** I proved `pool ≥ ceil(owed)` by hand over every writer:
- `credit`: `delta = ⌊avail·S/w⌋`, so `owed += delta·w ≤ avail·S`, and `ceil(owed+δ) ≤ ceil(owed) + avail = balance`.
- `claim`: each payment moves exactly `pay` sats and reduces `owed` by exactly `pay·S`, so `ceil(owed)` falls by exactly the same amount as the balance.
- `reweigh`: `carry' = owed_before`, `debt' = w_after·acc` ⇒ `owed_of` is unchanged, and `owed_scaled` is untouched — nothing earned is lost or gained by a weight change, in either direction.
- `retire`: `owed -= pending` exactly.

`P.32` asserts the invariant and `ledger()`/`BK.*` assert the stronger property that `owed_scaled` equals the sum of `weight·acc + carry − debt` over **every** live record, recomputed from the records after each money operation. `VAULTS` is complete (every vault in the suite is created through `mkV`), so that is a real conservation check, not a sample.

**Counters, under every ordering I could construct.** `pending_this_epoch ≤ pending_count` always: `activate` raises both, `advance_epoch` zeroes the second, `join` lowers only the first (and only when `dist_epoch > request_epoch`, i.e. after a zeroing), and `retire` lowers the second only when `request_epoch == dist_epoch`. No underflow is reachable. `total_active_weight` and `active_count` move only in `join`, `retire` and `reweigh`, and the expiry‑budget gate independently reconstructs the base weight (280 → 40 across twenty distinct records).

**Liveness.** `waiting_to_join > 0` is, by construction, a count of pending vaults with `request_epoch < dist_epoch` — every one of which satisfies `join`'s precondition, and joining is free and permissionless through either `activate`'s second call or `claim`. So `JoinWaitingFirst` can never be a deadlock. `BoostsExpireFirst` is the same shape: `expire_boosts` needs nothing but the records, which is precisely why it exists separately from `claim` (which would need the vault's token account). I could not construct a state where distributions or redemptions become impossible for others; the only blocks a stranger can cause (activating someone else's vault; bare‑burning before retirement) are self‑healing within one crank pass.

**The boost ring is exact past epoch 64, and I checked the bound rather than trusting it.** `MAX_BOOST_EPOCHS_BOUND = BOOST_RING − 1 = 63`, so a new end lands in `(e, e+63]` — 63 values, all distinct mod 64, and the slot `e mod 64` is never written by a purchase and is always cleared by `advance_epoch` before the epoch becomes current. So two live end epochs can never share a slot. "Exactly N distributions, not one more" follows from `BoostsExpireFirst` plus `unschedule_boost`'s two branches, and `BO.35` pins the `[distribute, boost]` ordering that is the easy place to be off by one. The host test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` drives the program's *own* free functions for 260 epochs with coverage floors (`buys > 500`, `early_wrapped63 > 3`, …) so it cannot pass by never reaching the wrapped branch. I re‑derived its invariants and they are the right ones.

**Double‑expiry and double‑payment.** Passing the same record twice in one `expire_boosts` or `claim` is safe for a non‑obvious reason worth stating: `store_record` writes the raw account immediately, so the second iteration re‑loads the *written* state and skips. That is sound, but it rests on the records being raw `AccountInfo` rather than Anchor accounts; BO.32/BO.36 measure both batches.

## R3. The level draw

**Deterministic, in order, never defaulted, and the capture deadline is actually sound.** I re‑derived the bound: A ≤ reveal+64; B ≤ A+75; C ≤ B+75 ≤ reveal+214 < the 300‑slot window; and at capture time A is at most 300 slots old, well inside SlotHashes' 512. `blockhash_in_window` pins the sysvar id, bounds the declared count, checks the buffer holds what the count claims and refuses an all‑zero hash. "A is the smallest produced slot ≥ want" cannot change with *when* it is read, because slots are produced in order. The FIFO (`index == revealed_total`) removes the ordering choice; a burned head still takes its draw so the queue never stops at it (L.11); `L.23` replays **every** draw in mint order against the census at its turn and `L.23a` asserts no vault was ever drawn without entropy. `L.3c` re‑derives one stored entropy value from the raw sysvar rather than from what the program stored, which is the right direction.

**Is it worse than SPEC 26 says?** No. C's leader has four slot choices within its own 4‑aligned group plus content variation; skipping all four hands C to the next leader (a blind re‑roll, not a choice). Timing a mint or a reschedule into one's own rotation is stated. The cohort‑joint selection is stated. SPEC's "64 tries reach 96 %" is a figure, not an upper bound, and it says so. **HOLDER-GUIDE now says it truly**: "the validator producing the last of those blocks can pick among several results, by skipping a block or changing what goes into it. That can be enough to choose the level of a vault created in the same moment (from the levels still left), and one choice affects every vault created in that moment at once." That is accurate.

## R4. Governance

**No ratified proposal can be refused by MINT.** I checked every action's creation bound against MINT's execution bound and they are tight in the right direction: `sol_reserve` (`> live`, `≥ rent`, `≤ ceiling`) vs MINT's (`≥ rent`, `≤ ceiling`); `max_sweep` (`< live`, `≥ floor`) vs MINT's (`≥ floor`, `≤ 50 SOL`, and `< live ≤ 50 SOL`); `cooldown` (`> live ≥ 1`, `≤ ceiling`) vs MINT's (`≥ 1`, `≤ ceiling`). Boost terms, round bounds and the operator key likewise. So an overtaken action is the *only* way a passed proposal does nothing, and that is a logged skip rather than a revert.

**The 10 % turnout rule provably never binds at the ruled numbers**, and I checked it beyond the asymptotics: for S = 1, 10, 20, 30, 50, 100, 200, 2100 the minimum passing YES (quorum × threshold, with both ceilings) is always ≥ `ceil(0.10·S)`. Limit 35 is correct.

**Freezing.** `quorum_supply` cannot underflow (each vault is counted in at most one of `burned_total` / `bare_burns_retired`, and `minted_total` dominates); it cannot be zero while the proposer holds a live vault; `need > 0` is required. Per‑kind ordering marks only ever block *older* ids, never future ones. The one permanent freeze is the stolen‑guardian case, and limit 47 states it, including that the bar is half of the **snapshotted** live supply. I confirmed the two arms that make the key‑change rule non‑vacuous: `3c.K2` fails at `KeyChangeNeedsHalf` and `3c.K2p` independently proves the proposal carried everything the weaker rules asked for.

## R5. The charter claim

Identity by address against a domain‑separated, sorted‑pair Merkle root; one implementation (`scripts/pob-merkle.mjs`) cross‑checked by the program accepting its proofs; 240 leaves → depth 8 ≤ `MAX_POB_PROOF` 16; a short proof or an outsider needs a sha256 preimage. The PoB is CPI‑burned as its owner in the same instruction; `pob_extra` accounts are passed **never as signers** and the writable flag is the caller's, which gains them nothing because only Core reads them. The window refuses by clock alone with no flag to flip and no setter. `R42.C12b` measures the pre‑funded‑address grief with the PoB *not* burned.

**Is SPEC 46 complete?** It is now unusually complete: it names (1) ending the project before it starts, (2) capturing the whole electorate, (3) the per‑asset blind spot (the alarm watches the collection, not the 240 assets), (4) the 30‑minute sampling window (a hook added and removed between passes is never paged), and (5) the positive bound (that key cannot transfer or burn an individual PoB). I re‑derived (5) at `e72d63e` and agree. Two things it still does not say, both small: the *claim page* refuses any PoB or collection carrying an external plugin, so the hot wallet can brick **page** claims with a *benign* hook as well as a rejecting one (the program would accept it, with pass‑through accounts, but the page will not guess them); and an owner‑managed `FreezeDelegate` on a single PoB is named, but the page's handling of it is what F1 is about.

## R6. One‑time configuration and the trusted hop

I checked every `initialize` bound against the ruled file and the new rehearsal file; all 20 MINT arguments, SEAL's reserve list, BURN's window and GOV's three numbers are inside their bounds in both files, and I verified the arithmetic for `sweep_floor ≤ max_sweep`, `cooldown ≤ cooldown_ceiling`, `sol_reserve ≤ reserve_ceiling`, `Σ level_caps ≤ max_supply` and `max_boost_epochs ≤ 63` by hand. `initauth.test.ts`'s argument list matches MINT's signature argument for argument (I counted them), and its `REACHED_PAST` list is correct for all four programs because each puts the authority check first — I confirmed that in all four sources, including GOV's, which is the one the comment does not call out.

**The royalty.** `initialize` installs it once with `PluginAuthority::None`; no instruction anywhere takes basis points or creators; R.5/R.6/R.6a/R.6c measure Core refusing update and removal with authority `None` while the `UpdateAuthority` control succeeds, and R33.G3 adds the re‑delegation refusal (`0x1b`). Nothing in our programs or in Core at the pin can change it.

**The redemption cap is exactly a rolling window.** The `k`‑th most recent entry is at `(head − k) mod 64`; `head` is the next write; a zeroed ring admits the first `cap`; two redemptions in one transaction share `now`, so at cap 1 the second is refused. A growing live supply loosens `k` and a shrinking one tightens it, both by design, and above 3,047 live the ring makes it stricter, never looser (I checked: `ceil(3047·0.021) = 64`, `3048 → 65`). `RL.7` replays every remembered redemption against the cap certified for *that* redemption's snapshot interval and refuses to certify an ambiguous interval — that is the right way to do it, and `RL.S1`–`S6` prove the stamping helper itself can fail.

**The operator's worst case** is cap × cooldown windows above the reserve until the guardian stops it, bounded by what the revenue PDA holds — not "one sweep". SPEC says so in those words. The swap operator is the only trusted key; the sweep destination, cap, cooldown and reserve are all on chain and the guardian's stop is instant and one‑way.

## R7. Cross‑program raw reads

I recomputed **every** offset from the struct definitions, field by field, and they are all correct:

`MintConfig` — version 8, collection 9, governance 41, pool_ata 73, round_id 105, price 125, minted_total 141, max_supply 149, bank_treasury 157, split_bps 189, sales_stopped 191, sweep_stopped 192, guardian 193, swap_operator 225, sol_reserve 257, bump 265, max_sweep 266, cooldown 274, last_sweep 282, level_caps 290, level_minted 310, revealed_total 330, payment_mint 338, pob_collection 370, pob_root 402, charter_opens 434, charter_closes 442, charter_claimed 450, bare_burns_retired 454, total_active_weight 462, active_count 470, acc 478, owed 494, last_distribute 510, sales_stopped_at 518, sweep_stopped_at 526, pending_op 534, pending_op_at 566, monthly 574, pending_guardian 582, pending_guardian_set 614, pending_guardian_at 615, notice 623, sweep_floor 631, cooldown_ceiling 639, reserve_ceiling 647, dist_epoch 655, pending_count 663, pending_this_epoch 671, cbob_mint 679, max_boost_weight 711, max_boost_epochs 712, boost_price 714, boost_weight 722, boost_epochs 723, boosts_active 725, boosts_due 729, boost_weight_total 733, cbob_burned 741, boost_expiring 749 → **1005 data bytes**; `MINT_CONFIG_SPACE` = 1005 + 256 = **1261**. Every constant in GOV (14 offsets), BURN (3) and the suite (40+) matches.

`VaultRecord` — pending 177, request_epoch 178, boost_weight 186, boost_end_epoch 187, carry 195 → **211 data bytes**, space 221. The RPC proxy's `mint-boosts` slice `(125, 70)` therefore lands active@0, retired@1, boost_weight@61, boost_end_epoch@62, which is exactly what `dueBoostRecords` reads.

`BurnConfig` — burned_total 42, redeem_window 50, rate_head 58, rate_ring 59 (+512). `SealConfig` — version 8, collection 9, reserves 41 (u32 count then keys, `n ≤ 3`, length‑checked). GOV's `Proposal` space = 259 bytes and `ACTION_MAX_BYTES` 37 is the true maximum (`Brakes` = 1+3+33).

**The sweep helper's classic reads** (mint 0, owner 32, amount 64, `len == 165`) are correct, and the `len != 165` refusal is what keeps Token‑2022 out of it.

## R8. The suite, the simulation and the build as evidence

**The floors are internally consistent.** `MIN_ASSERTIONS=912`, `DET=968`, `ALLOC=39`, `POSTER=24`, `MAINNET=35`, `POB=14`, `LAUNCH=68`, `HOST=6`, `EXPIRY=4`, `WEB=682`, `SIM=71`, e2e `132`, fork `16` — all match SPEC's "Running the tests" block and this prompt's header, and `LAUNCH 49 + 19 = 68` reconciles round 43's measured 49 with the repair. `HOST_FLOOR=6` is five written tests plus Anchor's `test_id`; I counted them. `POB_FLOOR=14` is 6 sizes × 2 + 2; I counted those too. Every floor is `-eq`, not `-ge`.

**The expiry‑budget gate is not synthetic in the way that matters.** I reconstructed its fixture arithmetic: 20 records at level I with +12 boosts give `280` total weight and `2800·S` owed, and the owed sum over records equals the config's `owed_scaled` exactly — a coherent state, not a stub — and the arm asserts 20 distinct `CBOB_BOOST_EXPIRED` log lines plus `total_active_weight == 40`. It would fail if expiry double‑counted, skipped, or mis‑reweighed.

**Arms that cannot fail, or are weaker than their names suggest** (see F6): `X.7` is a tautology given `L.19`, and the suite says so in its own comment. `P.31` asserts only a 400,000‑CU ceiling on a batch whose size varies run to run, so the "about 4,000 CU per vault" figure quoted in limit 54 is pinned by no arm.

**Bytes.** The sweep helper's mainnet bytes are proven identical to the deployed tested bytes, three ways. The four keyed programs' mainnet bytes are **by construction not** the bytes the suite ran; the proof is behavioural (each mainnet artifact rejects the localnet key *for the `NotTheInitAuthority` reason specifically*, each localnet artifact accepts it or reaches a later named check) plus a source grep plus reproducibility. `build-mainnet.sh` says exactly that and says what it does **not** prove. I checked the one thing that could make the probe vacuous — a stale argument list — and it is current.

---

## Findings

Severity, then class against SPEC gate 3 (a) programs, (b) value moved or miscredited, (c) a holder's crack stopped or wrongly refused, (d) HIGH/MEDIUM.

### F1 — LOW — `planClaim` (and the ceremony's royalty check) read a Core plugin body without the guard round 42 added to `planDraw`. Fixable layer (pages). Outside (a)–(d).

**Construct.** `web/src/lib/decode.mjs` `plugins()` deliberately degrades a body it cannot parse to `body: null` while leaving `pluginsUnreadable` **false** (`let body = null; try { body = pluginBody(...) } catch { body = null }`). Round 42's C7 repair added the matching guard at exactly one site:

```js
// plan-get.mjs planDraw  (guarded, round 42 C7)
const attrPlugin = assetInfo && !assetInfo.burned ? assetInfo.plugin('Attributes') : null
if (attrPlugin && !attrPlugin.body) return { state: 'unknown', ... }
```

Two sites have the same shape and no guard:

```js
// plan-get.mjs planClaim
const frozen = ['FreezeDelegate', 'PermanentFreezeDelegate'].some(t => pick.info.plugin(t)?.body.frozen)
```
```js
// plan-ceremony.mjs checkCollectionAfterMint
const r = coll.plugin('Royalties')
... else { if (r.authority.type !== 'None') ...; if (r.body.basisPoints !== 1000) ... }
```

The `?.` binds to `plugin(t)`, not to `.body`, so a non‑null plugin with a null body throws `TypeError: Cannot read properties of null`.

**What it gains.** In `planClaim` the throw escapes to `go()`'s catch, so the claim page renders *nothing* — not "that Proof of Burn is frozen", but a generic failure. Because `pick` defaults to `mine[0]`, one unparseable plugin on the holder's **first** Proof of Burn denies them the page for **all** of theirs, inside a 7‑day window that can never reopen. In the ceremony it turns a "BROKEN ON CHAIN: STOP, here is the field" report into an opaque stack trace at the step that installs the permanent royalty.

**Why LOW, not higher.** The trigger needs a plugin body Core wrote in a shape `pluginBody` rejects, and Core at the pin does not do that — only the *owner* of a Proof of Burn can add an owner‑managed plugin at all (limit 46's positive bound), so it is self‑inflicted today. Its value is as a Core‑upgrade and reader‑drift hazard, which is exactly the argument round 42 accepted for `planDraw`. No value moves; no crack is refused (the claim page is not redemption).

**Evidence if I am right.** Call `planClaim` with a snapshot whose chosen PoB has `plugins = [{ type:'FreezeDelegate', typeId:1, authority:{type:'Owner'}, offset:0, body:null }]` and `pluginsUnreadable:false`: it throws `TypeError` instead of returning `{ ok:false, refuse:['… is frozen …'] }`. Same for `checkCollectionAfterMint` with a `Royalties` entry whose `body` is null.

**Fix.** `plugin(t)?.body?.frozen === true` in `planClaim`, plus an explicit `pick.info.plugins.some(p => ['FreezeDelegate','PermanentFreezeDelegate','Royalties'].includes(p.type) && !p.body)` → refuse "this page could not read a rule on that Proof of Burn"; in `checkCollectionAfterMint`, `if (!r.body) bad.push("the collection's royalty could not be read")` before the field checks. Gate‑5 arm: one `get.test.mjs` case and one `ceremony.test.mjs` case with a null body, each shown red by removing the guard.

### F2 — LOW — the coverage gate's root‑file list omits the JavaScript dependency pins, so the files that decide what the suite and the pages actually run are outside the gate SPEC ship gate 1 rests on. Fixable layer (tooling). Outside (a)–(d).

**Construct.** `scripts/audit-coverage.sh`:

```bash
listed=$(git ls-files 'programs/*' 'bank/*' 'scripts/*' 'sim/*' 'launch/*' 'tests/*' 'web/*' \
      SPEC.md DESIGN-v6.md HOLDER-GUIDE.md Cargo.toml Anchor.toml)
```

Round 29 L1 replaced the hand‑picked *directory* globs with a full enumeration, but the **root files are still a hand‑picked list of five**. Anything else at the repository root is invisible to both halves of the gate (never‑sent and content‑stale). That omits, at minimum, `package.json` and whatever lockfile exists, and `tsconfig.json`.

**Why it matters here specifically.** `Cargo.lock` is tracked and bound to `RELEASE_COMMIT` by `release_gate`, so the Rust side is pinned. The JavaScript side is not: `@solana/web3.js` (whose version round 25 A1 measured for its 300.8 s default timeout, the measurement behind limit 25's "slow crank"), `@metaplex-foundation/mpl-core` (which builds the `ExecuteV1` that `ix.test.mjs` compares the pages against), `@solana/spl-token` (which builds every instruction `ix.test.mjs` treats as ground truth), `bs58` and `@noble/hashes` (the browser sha256 shim) all come from that unaudited manifest. A dependency bump changes what 912 on‑chain assertions and 682 offline assertions are actually comparing against, and no reader has ever been shown the file that decides it.

The gate's own comment says the right thing and then does not do it: *"a coverage gate that excludes the files controlling the certification is the same shape as the defect it exists to catch."*

**Evidence if I am right.** `git ls-files | grep -vE '^(programs|bank|scripts|sim|launch|tests|web)/' | grep -vE '^(SPEC|DESIGN-v6|HOLDER-GUIDE)\.md$|^(Cargo|Anchor)\.toml$'` returns a non‑empty list, and `./scripts/audit-coverage.sh` exits 0 anyway. If it returns nothing, then the JS dependency set is not under version control at all — which is the same finding with a worse consequence, because "rebuild from `$COMMIT` and confirm these sha256 values" then holds only for the Rust.

**Fix.** Enumerate the root the same way the directories are enumerated: replace the five named files with `git ls-files` at depth 1 and an explicit, reasoned exclusion list (as round 29 did). Then bundle whatever appears. Related and already accepted, so not re‑filed: `web/build.mjs` resolves esbuild from `/home/ubuntu/luna-remotion/node_modules/esbuild`, outside the repository, which is round 36 A10 ("esbuild in‑tree remains optional") — but note that it makes the ceremony's own "compare `app.js` sha256 with a build you made yourself from that commit" instruction unreproducible by anyone outside this box.

### F3 — LOW — the new rehearsal value set cannot be judged by the ceremony page's own judge, and item 22's named pass/fail list never exercises the ceremony at all. Fixable layer (tooling + docs). Outside (a)–(d).

**Construct.** `web/src/lib/plan-ceremony.mjs`:

```js
export function judgeRehearsal(p, nowSec) {
  const out = []
  for (const [k, e] of Object.entries(p || {}))
    if (!k.startsWith('_') && (e?.value === null || e?.value === undefined)) out.push(`${k} is OPEN`)
  if (out.length) return out
  ...
}
```

and `web/src/pages/ceremony.mjs`:

```js
const judgeValues = (lj, now) => P.launchJudge === 'mainnet'
  ? judgeLaunch(lj, { nowSec: now, pobSet: POB_SET }) : judgeRehearsal(lj, now)
```

The new `launch/rehearsal-init.json` deliberately carries `"lock_deadline": { "value": null, "status": "REHEARSAL-NA" }` ("the rehearsal programs are NEVER made final"). `judgeRehearsal` treats **every** null as OPEN and does not know the `REHEARSAL-NA` / `REHEARSAL-OPEN` statuses, so even with the rehearsal profile's program ids and `launchValues` filled in, the page would refuse the file forever on `lock_deadline is OPEN`. The `rehearsal` profile also still carries `launchValues: null` and `programs: { seal: null, … }`.

**Why it matters.** The ceremony page is the only thing that writes the twenty‑plus values nothing can ever correct, and it will be used for the first time **on mainnet**, in Gary's browser, with Phantom. Item 22's named rehearsal items are the crank, the alarm, two revenue cycles, one forced post‑sweep recovery and one DAS read — the ceremony is not among them, and SPEC road step 10 (the ceremony) comes *after* step 9 (mainnet deploy). The natural place to rehearse it is precisely the rehearsal tree, and `launch/rehearsal-init.json` now exists for exactly that, but the page cannot consume it.

**Why only LOW.** The page's *library* is exercised against real programs on a validator (`e2e-localnet.mjs` drives step 0 and all six road‑step‑10 steps with `readStep → build → simulate → send → readStep must be []`, plus a resume pass and a refused second initialize), and each step is guarded both before (`judgeLaunch`, the probes, the byte hashes) and after (`readStep` compares every field and STOPS). What is unrehearsed is the browser, the wallet and the operator, and round 43 already recorded "a real Phantom" as unmeasured. No value moves and no crack is refused.

**Evidence if I am right.** `judgeRehearsal(JSON.parse(fs.readFileSync('launch/rehearsal-init.json')), Date.now()/1000|0)` returns an array containing `"lock_deadline is OPEN"` even with every `REHEARSAL-OPEN` key filled. And `grep -n 'launchValues' web/src/config.js` shows the `rehearsal` profile still at `null`.

**Fix.** Skip keys whose `status` is `REHEARSAL-NA` in `judgeRehearsal` (or delegate the whole judgement to `check-launch-params.mjs`'s `--rehearsal` mode, which already understands the vocabulary), fill the rehearsal profile's ids and `launchValues` from `REHEARSAL-RECORD.txt`, and add to item 22's list: *"step 0 and road step 10 run through the ceremony page in a browser with a wallet, against the rehearsal deployment, with every `readStep` returning `[]`."* Gate‑5 arm: a `ceremony.test.mjs` case that judges the real `launch/rehearsal-init.json` with its `REHEARSAL-OPEN` keys filled and expects `[]`, shown red by restoring the current null rule.

### F4 — LOW — three places where the holder guide or SPEC says less than the code does. Fixable layer (docs). Outside (a)–(d).

**(a) A bare burn is a second exception to "credited stays yours."** The guide says: *"Anything credited to you stays yours until it is delivered (**the one exception** is opening your vault while the Bank's pool is frozen…)."* `retire_burned` returns an unclaimed share **to the pool** (`retire(..., redeemed=false, forfeit=false)` → `c.owed_scaled -= pending`), so a holder who burns the NFT any other way loses the credited‑but‑undelivered share as well as the contents. The guide warns about bare burns in a different paragraph, in terms of "destroys everything inside it" — the credited share is not inside it.

**(b) A frozen POOL halts `split_revenue` too.** Limit 28 names, with precision, what a frozen *vault* account, a frozen *Squads* account and a frozen *revenue* account do, and for the pool it names only claims. But `split_revenue` moves both halves in one instruction, and SPL Token refuses a transfer whose **destination** is frozen, so a frozen pool refuses every split and the holders' 85 % waits in the revenue address exactly as it does for a frozen Squads account. Same class, same non‑loss, but the limit enumerates the other three and omits this one.

**(c) The "only our page" warning names destruction, not redirection.** The guide's reason for *"Only open your vault on the Bank's redeem page"* is *"Burning the NFT any other way … destroys everything inside it forever."* The sharper risk is that the sweep's destination wallet is chosen entirely by whoever builds the transaction and **no program compares it with the asset's owner** — the helper cannot (the asset is not in its account list and is not recoverable from the signer PDA), SEAL and BURN never see it. A convincing fake page produces a valid, pairing‑complete redemption that sends the contents to a stranger and burns the vault. This is inherent to "the owner alone redeems" and is unfixable in frozen programs; it is a disclosure gap, not a code one.

**Evidence if I am right.** (a) `grep -n 'the one exception' HOLDER-GUIDE.md` beside `retire`'s `!redeemed` branch in `mint/src/lib.rs`. (b) A suite arm freezing the pool and calling `split_revenue` fails at the Token `TransferChecked` with `0x11`, which no arm currently covers (R28.F1 freezes the *Squads* account). (c) Build the page's redemption with `dest` replaced by a stranger's wallet: SEAL, the helper and BURN all accept it.

**Fix.** Three sentences: name the bare burn as a second exception; add "and every split" to limit 28's pool clause; and in the guide say *"a fake page can also send everything in your vault to someone else, not just destroy it — check the address you are sending to, and only use the Bank's page."* Gate‑5: the frozen‑pool split arm, which is worth having anyway.

### F5 — INFO — status‑vocabulary and build‑state drift around the new rehearsal file. Docs.

SPEC item 53 describes `launch/rehearsal-init.json`'s statuses as *"MAINNET … PROPOSED (a rehearsal choice for Gary to approve), REHEARSAL-OPEN …, REHEARSAL-NA"*. The file as delivered uses **`RULED`** for every rehearsal choice (each sourced to *"Gary 2026-10-08 (chat) approved the rehearsal timings, census, swap bot and real-token amounts"*) and has **no** `PROPOSED` entries — so SPEC describes values as awaiting approval that Gary has already ruled on. Separately, `web/README.md`'s open‑gaps list still says *"Rehearsal mode (SPEC 53) is still not built"*, which is now true only of the ceremony profile, not of the checker's `--rehearsal` mode. Whether `check-launch-params.mjs` accepts `RULED` in a rehearsal file I cannot see (section 9). One further wording point: item 53's remedy for a front‑run rehearsal initialize is *"close the programs and redeploy"* — a closed loader‑v3 program cannot be re‑deployed at the same id, so the remedy is in fact *new throwaway ids* (harmless for a rehearsal, but the runbook should say it).

### F6 — INFO — one suite arm cannot fail, and one SPEC figure is pinned by nothing. Tests/docs.

`X.7` asserts `ord.length === 0` and `revealed_total === minted_total` at a point where the census has already been exhausted and `L.19` has already asserted it — so both are entailed and the arm cannot go red. The suite's own comment concedes this (*"Say what this actually shows"*), which is the honest thing to do, but under gate 5 an arm that cannot fail should be replaced with one that can: plan a crank against a snapshot with a known undrawn FIFO head and assert the exact reveal order. Second: limit 54's *"A claim batch costs about 4,000 CU per vault (P.31: 6 vaults, 29,192)"* cites an arm that asserts only `cu < 400,000` on a batch whose size is computed at run time, so neither the per‑vault figure nor the vault count is pinned; if the batch size drifts the number silently goes stale.

---

## The four questions about the accepted limits

**1. Is any limit worse than stated?** I found none worse, and I tried hardest on the five that would hurt most.
- **Limit 27** (claim into a dead account): correct as written, including that the cost falls on *other* holders, and that a bare‑burner can therefore destroy, for free, the share `retire_burned` would have returned to everyone. Bounded by one event per vault and by the crank retiring first each pass.
- **Limit 32** (the cap): the ring bound 64 ↔ 3,047 live is arithmetically right, and "live counts an unretired bare burn" is right.
- **Limit 40** (Core): one consequence it does not name, which round 43 triaged and which I agree is in its class rather than new. If a Core upgrade enables compression, an **owner** can turn a vault into a `HashedAssetV1`; SEAL's `read_core_asset` then refuses `NotACoreAsset` (so that vault can never be opened, by anyone) *and* `reveal_level` refuses it as a non‑burned non‑`AssetV1`, which halts the FIFO for every vault behind it. That is the same halt limit 40 already names, reached by a different mechanism and triggerable by a holder rather than by Core. Round 43's recommended gate‑5 arm (pin "Compression currently not available" so the day Core enables it the suite goes red) is the right control and I second it.
- **Limit 46**: complete on the key's powers; see R5 for the two small omissions (the page refuses a *benign* hook too; the single‑PoB freeze case).
- **Limit 10 / the swap**: the "cap × windows, never one sweep" framing is the honest one and SPEC uses it.

**2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?**
- **Limit 35** is not a limit at the ruled numbers and SPEC says so; I verified it binds nowhere for S from 1 to 2,100. It is correctly kept as a floor for other values.
- **Limit 42's** categorical "only two fit" was already corrected in round 26; the current text is right and the page's contract does not depend on the narrow exception.
- **Nothing** is closed by something the author missed. The one place I expected to find that — a stranger poisoning a reserve ATA to block a redemption — is genuinely closed, and for a reason SPEC does not spell out: the three reserve ATAs can only be created by the ATA program, which always writes no delegate and no close authority, and `Approve`/`SetAuthority` both need the PDA's signature. So round 40 V40‑4's "a stranger can cause none of these" is stronger than it reads: it is structural, not incidental. Worth adding one clause to limit 44 so a later reader does not have to re‑derive it.

**3. Is any DISCHARGED item not actually discharged?** No. I checked the ones with the most room to be wrong: 14 (closed on both mint and claim paths — `R42.C8` added the claim arm), 19 (closed by construction; there is no state in which a vault is activated but unlevelled, because `activate` requires 1..=5 and the level is immutable once drawn), 30 (`P.0e`/`P.0f` verify by *source inspection* that neither `SweepTighten` carries a money field and that `WiringArgs` is absent in both programs — the right check for a deletion), 33 (both applies are exercised, 3c.K5 and 3c.G2, and both early applies refused), 51 (built and measured, with its one‑sided `BoostTermsMoved` rule correctly recorded as the ruled asymmetry), 12/17 and 54 (measured, with the v5/v6 provenance of each number stated and the 14‑vault extrapolation labelled as extrapolation).

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?** No. 22, 38, 50, 52 and 53 all still read OPEN, `launch/mainnet-init.json` still carries three `OPEN` values, and the round‑43 VALIDATION ends by naming step 8 and steps 9–11 as what remains. Two things to watch rather than findings: item 53 has *grown* a built artefact (`launch/rehearsal-init.json`, `--rehearsal`) while staying open, which is the right state but is the shape in which items quietly become "done"; and **limit 59 carries no recorded Gary ruling**, unlike every other ACCEPTED item, even though its own text says the grief can be repeated through the entire 7‑day charter window. Round 43's triage noticed the same. Get the ruling, or move it out of ACCEPTED.

---

## What I could not measure

Stated plainly, because the value of this report depends on it.

- **I ran nothing.** No validator, no suite, no selftest, no job. Every number I quote is either recomputed by hand from the bundled source or read from the bundled logs/verdicts.
- **Not in this bundle, and therefore outside my measurement:** `bank/crank.mjs` (so V43‑1's `planRescues` repair, and the crank order, fee floor and heartbeat), `bank/detectors.mjs` (so `judgeRedemptionCoverage` and `classifyPdaTokenAccount`, which the redeem page's cross‑check and refusal logic depend on), `bank/alarm.mjs`, `bank/layout.mjs`, `bank/txread.mjs`'s consumers, `scripts/check-launch-params.mjs` (so item 38's only gate, the new `--rehearsal` mode, and whether it accepts `RULED` in a rehearsal file — note this file is simultaneously the gate on permanent values and a module **bundled into the published ceremony page**), `web/test/ref.mjs` (so whether `ix.test.mjs`'s extraction is sound — though its explicit CONTROL for `diffIx` is reassuring), and the root dependency manifest (F2).
- **V43‑1's Core behaviour** I confirmed from `e72d63e` plus the pinned binary's embedded `file:line` references plus the project's own recorded premise, and the suite now measures it — but I did not execute it.
- **Never measured by anyone, and still true after this round:** a real Phantom signing a real transaction; a real Squads v4 returning a rescued vault; the RPC proxy behind the real Cloudflare front end (the nginx rate‑limit key depends on a real‑IP configuration that lives outside this repository); the shipped mainnet bytes running anything; whether a holder understands any sentence on any page.
- **Structural to the design, not a gap I can close:** the four keyed programs' mainnet bytes are not the bytes any test has ever run, and the dress rehearsal deploys the `localnet` build, so step 8 adds no evidence about the shipped binaries either.

---

## Given that no human firm will ever see this and the programs will be immutable: what to do before launch that AI audit structurally cannot

Ordered by how much a failure costs, and each one something a model reading files cannot do.

1. **Rehearse the ceremony, in a browser, with a wallet, against a live cluster — and treat it as a gate.** This is the single act that writes twenty‑plus values nobody can ever correct, and it has never been performed outside a mock. Fix F3 (one line in `judgeRehearsal`, the rehearsal profile's ids and `launchValues`), then on the rehearsal deployment: run step 0 and all six road‑step‑10 steps in Phantom, confirm every `readStep` returns `[]`, and **deliberately break three things and watch the page stop**: a wrong value in the rehearsal file (must be refused before any signature), a step re‑sent after a confirmation time‑out (must re‑read and not re‑send), and a second collection created in a second browser (must STOP, not adopt). Record the signatures. No model can press a button in Phantom.

2. **Do a hostile dry run of the ceremony on mainnet values with the signing step removed.** Load the real mainnet build with the real `launch/mainnet-init.json` (charter date and lock deadline filled), connect Gary's wallet, and walk the preflight and all six steps up to but not including each signature, printing the full decoded transaction for each. Have a second person read those twenty‑plus values off the screen against `DESIGN-v6.md`'s rulings, line by line, out loud. A model can check the JSON against the JSON; only a person can check the JSON against what Gary meant.

3. **Fire every alarm you intend to rely on, on the rehearsal deployment, and confirm the message reaches a human who is not at the terminal.** Specifically: freeze the rehearsal pool and confirm the forfeit page; park a Core asset in a rehearsal vault's deposit address and confirm `nested_vault` *and* that the crank's rescue actually lands (V43‑1's repair is the one thing I could not verify at all); let the crank's heartbeat go stale for three hours; flood one program's history and watch `scan_gap` drain. The alarm's selftest proves each detector *can* fire; only a live run proves the page arrives.

4. **Walk the forced post‑sweep hand recovery with the runbook open and nothing else.** Item 22.4 requires it. Have the person who will do it at 3 a.m. — not the person who wrote the runbook — perform it from the text alone, and fix every sentence they have to ask about. A model cannot tell you which sentence is ambiguous to a tired operator.

5. **Decide the three custody questions before the lock, because afterwards they are permanent facts about holders' money.** (i) Move the Giraffish Moments update authority cold or into a Squads **for the duration of the charter window only** — limit 46 says that key can end the project or own the electorate, and the window is the only time it matters. (ii) Move the `$CBOB` release wallet off this box (limit 56). (iii) Confirm, in writing, who holds `bank/keys/deploy-authority.json` and where its backup is, because losing it before step 11 means new program ids, which is a program change. Each is Gary's call and each is a one‑line decision a model cannot make.

6. **Get the two missing rulings on the record.** Limit 59 (the pre‑funded‑address grief, repeatable all week) has no ruling; and F4(c) — that a fake redemption page can *redirect* rather than merely destroy — should be a disclosure Gary approves rather than a sentence an auditor suggests.

7. **Re‑read the four holder‑facing sentences that would be most expensive to be wrong**, with someone who has never read the code: *"Only you can open it"*, *"Nothing can leave it while it is closed"*, *"Anything credited to you stays yours until it is delivered"*, and the hourly‑limit paragraph. F4 shows two of those four already need a clause. The pattern there is not a bug in the code; it is that absolute sentences accrete exceptions one round at a time, and an immutable system cannot afford one that is false on launch day.

8. **Keep `scripts/audit-coverage.sh` honest about itself** (F2), then run it strict before you freeze. The gate that decides whether anything has been read is the one place where being wrong is invisible, and it has now been wrong about its own subject twice (rounds 19 and 30).