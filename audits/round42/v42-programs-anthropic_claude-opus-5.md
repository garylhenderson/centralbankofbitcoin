# Independent audit — v6 programs, pages and gates, at `4a67d00`

**Scope of what I actually did.** I read the five programs, `bank/txread.mjs`, `bank/sigwalk.mjs`, every bundled `web/` file, the two runners, the suite, the simulation, SPEC, DESIGN-v6, HOLDER-GUIDE, round 41's two records and `launch/mainnet-init.json`. I recomputed by hand every cross-program byte offset, every account-space constant, the boost ring's collision bound, the entropy window arithmetic, the pool invariant, the rate-limit ring indexing, and the GOV/MINT instruction encodings. I ran nothing (no validator, no network, no job). Every claim below says what evidence would exist if I am right.

**Headline.** I found **no defect that moves value out of a vault, the pool or the revenue address**, and no way to leave a thawed vault alive. I confirm round 41's V41-1 repair at every site that matters and name the two reads that are *correctly* not wrapped. I file **one MEDIUM** (in the certification machinery, not the programs), **two LOW** and **three INFO**. I also report three claims I developed and then **killed by checking**, because a wrong finding costs you more than a missing one.

---

## R0. Round 41's verdict and its repairs

### V41-1 (the dust-at-config-addresses finding) — repair verified, and it is complete

Present at every site where a *later-created derived address* is read:

| site | repair |
|---|---|
| `web/src/lib/reads.mjs:44` `anchorAccount` | `absentIfDust(await account(...))` → `null` = "not created yet" |
| `web/src/lib/ceremony-reads.mjs:124` `resolveCollection` | SEAL config dust-wrapped before the conflict test |
| `ceremony-reads.mjs:21,31,66` `readStep` | collection, `mintDone`, each of the three cbBTC ATAs |
| `reads.mjs` `readBuySnapshot` | both reads `.map(absentIfDust)` |
| `reads.mjs` `vaultWalletAccounts`, `readRedemptionSnapshot` (pool, owner ATAs), `redeem.mjs` `payoutBlock` ($GARY), `web/meta/generate.mjs` (vault token) | all wrapped |

The predicate is the right one: **System-owned AND zero data**. A System-owned account *with* data (reachable only at an address whose key someone holds, never at a PDA or ATA) is still refused, and a foreign-program-owned account is still refused. That distinction is what keeps the repair from becoming a hole.

**Two reads are deliberately not wrapped, and both are correct:**

- `reads.mjs` `readVault`'s **asset** read. The address is either a keypair the page just generated (claim/buy, unpredictable) or a vault the holder pasted. A dusted address yields the right message ("That address is not a Metaplex Core NFT").
- `ceremony-reads.mjs` `readStep('fund')` reads only `a?.lamports ?? 0`, so a stranger's dust *reduces* the shortfall the step transfers. Pre-funding above rent makes the step read `[]` (done), which is the truth.

`web/meta/generate.mjs`'s MINT-config read is also unwrapped, and that is right too: a dusted config means "MINT is not initialized", and the generator's answer is `fatal` with nothing written.

**Unverifiable here:** `bank/anchor.mjs`'s `isSystemDust` (VALIDATION's class-A drift repair) is not in this bundle. I cannot confirm `pinnedAccountData`, `readTokenAccount` or the alarm's config read. **Carry this to the off-chain pass.**

### The round-41 gate-5 arms I can check

- **R41.C8a/b/c** are present in `tests/3prog.test.ts` and each pins its refusal *by reason* (`/insufficient funds for rent/i`), not merely by failure. `MIN_ASSERTIONS` moved 896 → 899 and the runner demands equality. ✓
- The arithmetic behind C8 is sound and is now the load-bearing fact under SPEC item 50's lamports-only rule: a zero-data System account may hold **0 or ≥ rent-exemption, never between**, so the helper's "empty to zero" is legal and BURN's `lamports == 0` sees exactly what the sweep left.
- C01/C02/C04/C06 (poster key, oracle literals, undrawn-level refusal, min-sweep literal) live in files not bundled here. **Carry to the off-chain pass.**

### A claim in round 41's verdict I re-tested and agree with

C8 as *filed by Muse* ("SPEC item 50's rent sentence is false") was correctly disproved: the runtime refuses a transaction that leaves a newly written account rent-paying. I confirm the mechanism and the measurement now pins it.

---

## R1. Custody: can anyone but the owner get value out, or an emptied vault survive?

**No, on both counts, and here is the argument rather than the assertion.**

A committed transaction cannot contain a thawed-and-unburned vault:

1. `open_for_redemption` thaws only if a **top-level** `burn_vault` for the same `(asset, owner)` appears later (`programs/cbob-vaults/src/lib.rs`, the fail-closed walk; `load_instruction_at_checked` sees top level only).
2. Every top-level instruction in a committed transaction executed and returned `Ok`. So that `burn_vault` ran and succeeded.
3. `burn_vault` succeeds only after `invoke(Core BurnV1)` returns `Ok`. So the asset is a tombstone.

A CPI wrapper cannot break either half: a wrapped open reports the *outer* index, so BURN's backward walk (`0..current`) finds the wrapper's program id, not SEAL's, and refuses `NoPrecedingOpen` (WR.3 measures exactly this, and the thaw reverts with the transaction). `retire_redeemed` is triple-gated — stack height `TRANSACTION_LEVEL_STACK_HEIGHT + 1`, the current top-level instruction must be BURN's `burn_vault` discriminator, and its account 0 must be this asset (WR.1).

Emptiness proof: I re-walked both loops. The reserve loop demands all six ATA addresses (classic × Token-2022 per reserve mint) be *declared*, skips what no token program owns, and otherwise requires PDA ownership, no delegate (`d[72..76]`, `d[121..129]`), no close authority (`d[129..133]`), exactly 165 bytes and zero amount. The second loop applies the *same* three delegate checks and the length check to every declared PDA-owned token account and refuses a declared live `AssetV1`. The asymmetry round 13 found is gone.

**The one thing a stranger could try here is closed.** Anyone can permissionlessly create the *classic* reserve ATA for a vault and fund it. If the page had not named it, BURN would see a declared non-empty account and refuse. But the page's prior transaction creates every missing vault reserve ATA, the plan is re-read after it, and the helper moves **live** balances — and once created, a vault's ATA cannot be closed by anyone (nobody signs for the PDA) nor given a delegate or close authority. The Token-2022 ATA address of a classic mint cannot be made into a token account at all (probe F4.2), and no one can allocate at an ATA address (R36.G2a/b, R34.G2). **So there is no account a stranger can create for a vault that the sweep cannot name and BURN will not skip.**

---

## R1s. The sweep helper

Read line by line against every question in the brief.

- **(a)** Direct call needs the asset-signer's signature, which nobody holds (SR.1). Through Core, the approval set on a thawed asset is `authority == owner` only; the collection abstains; a transfer delegate has no Execute rule (SR.5, SR.5a); the collection update authority is MINT's off-curve PDA and MINT has no Execute CPI (SR.5b/5c/5d). Frozen ⇒ Core refuses (3.7, S6.2). ✓
- **(b)** Same source twice is refused for the *right* reason: the first iteration's `CloseAccount` reassigns the account to the System program with zero data, so the second `read_token` fails `IllegalOwner` before any owner comparison — and SR.12b asserts the source-owner log line is **absent**, which is the only way to tell those two refusals apart. Source-as-destination is impossible because `signer != dest` is enforced and a single account cannot be owned by both. A wSOL source works (165 bytes, close returns the wrap to `dest`). Odd list → `NotEnoughAccountKeys` (SR.7); zero pairs → lamports-only (SR.13); frozen source → the transfer reverts the whole opening (SR.14); a kept close authority → the close reverts (R36.C5, which is why the page uses a plain `Transfer` for that shape instead).
- **(c)** Safe *because* of (a): the owner chooses where their own value goes. A non-System destination takes the lamport credit without its data changing (R27.S1); a below-rent credit to a non-existent destination is refused by the runtime, which is why item 50 names the owner as the canonical destination (R41.C8).
- **(d)** The lamport read happens last, after the closes, so it includes released rent (SR.4a reconciles the exact delta including a stranger's gift, released rent and the fee). Core's `BurnV1` neither sweeps nor credits the signer (measured fact 4). Nothing in a *stranger's* control can refill it, and only the redeemer's own later instruction could.
- **(e)** Covered under R1 above.
- **(f)** S8.0 reserves 148 bytes (52 compute-budget + 96 separate payer) against the 1,061-byte measurement, and R40.U1 lands the largest shape with **no** compute-budget instruction. There is no fourth reserve to worry about: `MAX_RESERVE_MINTS` is 3 in both SEAL and BURN, the list is written once, and 9.15/9.15a/9.16 bind the constants to the measurement.
- **(g)** `scripts/build-mainnet.sh` compares `dist/cbob_vault_sweep.so` against **both** its own `$CACHE/ln` rebuild **and** `target/deploy/cbob_vault_sweep.so`, the file `run-tests.sh` and `run-sim.sh` deploy. Since `build-mainnet.sh` builds into `$CACHE/{mn,ln}` via `CARGO_TARGET_DIR` and never writes `target/deploy`, that second comparison is meaningful. The helper declares no `localnet` feature, so the metadata hash is identical. **The shipped bytes are the tested bytes, with one ordering obligation: `run-tests.sh` must have run from the same commit first** (the script says so and dies if the file is absent, but it cannot tell a *stale* `target/deploy` from a fresh one beyond the byte compare — which is sufficient, since a stale file would differ).

**No finding.**

---

## R2 / R2b. The pool and the boost

**"The pool always holds at least ceil(owed)" holds by induction.** `distribute`/`monthly_inline`: `avail = balance − ceil(owed)` (checked, `PoolShort` otherwise), and `credit` raises `owed_scaled` by `floor(avail·S/w)·w ≤ avail·S`, so `ceil(owed)` rises by at most `avail`. `claim`: balance falls by `pay`, `owed_scaled` by exactly `pay·S`, so `ceil(owed)` falls by exactly `pay`. `retire` and `reweigh` never raise `owed_scaled`.

**`reweigh` is exactly share-preserving**, which is the hinge of the whole boost design: `owed = w·acc + carry − debt`; it stores `carry := owed`, `debt := w'·acc`, so the new owed is `w'·acc + owed − w'·acc = owed`. Therefore `owed_of` can never go negative and every `checked_sub` in `owed_of` is unreachable as a failure. I verified the five callers (`join`, `claim`, `expire_boost`, `boost_vault`, `retire`) each leave the identity intact.

**Counters, under every ordering I could construct.** `pending_this_epoch ≤ pending_count` always (incremented together; `advance_epoch` zeroes the former; `join` only ever fires for an *earlier* epoch so the former was already cleared; `retire` decrements the former only when `request_epoch == dist_epoch`, which can only be true while the increment is still live). Hence `waiting_to_join`'s `checked_sub` cannot underflow. F21.1/F21.2 pin the retire-while-waiting case for both a redemption and a bare burn.

**The boost ring cannot collide, and this is provable rather than measured.** With `epochs ∈ [1, 63]`, two simultaneously live boosts whose ends differ by 64 would require one end `> E + 63` while `end ≤ E + 63`. Contradiction. `MAX_BOOST_EPOCHS_BOUND = BOOST_RING − 1` is therefore exactly the right bound, not a safety margin.

**A boost earns exactly N.** `boost_end_epoch = dist_epoch + epochs`; the epoch advances once per distribution *and* once per empty tick, both through `advance_epoch`; the `BoostsExpireFirst` gate sits in front of `distribute`'s burn path, `distribute`'s tick path, and `monthly_inline`. So the accumulator cannot move past a due boost, and `expire_boost` fires at exactly the accumulator its last distribution left. `tests/expiry-budget.mjs` is a genuinely good arm here: its synthetic genesis is *coherent* (20 × (2 + 12) = 280 weight, `owed_scaled` = 20 × 14 × acc), so the post-state assertion `total_active_weight === 40n && boost_weight_total === 0n` would catch an accounting error, not just a crash.

**Liveness.** A due boost can always be cleared: `expire_boosts` needs only MINT-owned `VaultRecord` accounts and never touches a token account, so a frozen or missing cbBTC account cannot stall the gate — that is precisely why the instruction exists separately from `claim`. A bare-burned-but-unretired boosted vault is still expirable (the record is `active`; the asset is not read). A retired record keeps `boost_weight` as inert history and is skipped by `claim`, `expire_boosts` and `boost_vault`.

**No finding.**

---

## R3. The level draw

**The window arithmetic is correct and has margin.** `A ≤ rs + 64`; `want_B = (A − A%4) + 8 ≤ A + 8`, so `B ≤ rs + 136`; `C ≤ rs + 208`. The capture deadline is `rs + 300`, and at that moment `A` is 300 slots back, inside SlotHashes' 512. So a capture that is in time always finds all three hashes.

**Determinism.** `blockhash_in_window` returns the *smallest produced* slot ≥ `want` present in the sysvar. Produced slots are only ever added. So once the function returns `Some`, the answer is final for the whole window, and A→B→C chains deterministically. The claim in MINT's comment is true.

**Parsing is fail-closed**: sysvar id pinned, `n ≤ 512`, buffer length checked against `8 + n·40`, an all-zero hash refused rather than fed into a draw. The host tests exercise a 512-entry buffer, a declared 513, a truncated buffer, a forged key, a zero hash, and skips landing on A, on B's group start and on C's group start against an independent model.

**FIFO liveness.** `reschedule_reveal`, `capture_entropy` and `reveal_level` are all permissionless; `reschedule` always targets `now + 16`; a *burned* head still draws with the Core write skipped. The Attributes plugin is authority-managed with MINT's PDA as its authority, so the owner cannot remove it, revoke it or re-delegate it, and an owner-added external adapter that could reject an update is refused `NoApprovals` (R24.1/R24.1a). **The one remaining way the head can stick is Core's heap — see finding 2.**

**SPEC 26 vs. the code.** C is the smallest produced slot in `[want, want+64]`, so C's leader can skip its own first slot(s) to move C *within its own group* and can also vary its block. SPEC 26 and the holder guide both say so, including that one choice serves a whole same-slot cohort. **It is not worse than stated.** One nuance SPEC gets right and a careless reader would not: a skip by A's or B's leader shifts the later targets, but that leader produces its block *without knowing hB/hC*, so it is a blind re-roll, not a selection.

---

## R4. Governance

- A minority cannot carry what it should not *within the rules*: quorum is ceiling-based against the creation snapshot, `need > 0` is required (so a zero electorate cannot pass anything), the threshold is a share of votes cast, YES must reach 10% of the snapshot, and a guardian or operator change needs YES ≥ ceil(50% of the snapshot) and may never share a proposal with the other.
- `Brakes{set_guardian:false, guardian:Some(x)}` cannot smuggle a guardian change (MINT's `arm_guardian` is only reached when `set_guardian` is true), and `Some(default)` is byte-identical in effect to `None` (R24.2 pins the state *and* the log line).
- The per-kind marks move **before** the "round already over" skip, so a newer-but-expired round still supersedes an older one (3c.R1).
- Every action GOV forwards re-encodes to MINT's exact Borsh signature; I checked all six discriminators' payload layouts against MINT's handler parameters.
- **Frozen forever:** limit 47 is accurate and not understated. A stolen guardian key can stop sales and the sweep, cancel every armed operator, and re-stop after every restart; it cannot cancel its own replacement, touch a vault, a payout or a rule. Below 50% turnout the stop is permanent. I could find nothing it reaches beyond `mint_vault`, `sweep_sol_for_swap` and a *pending* operator.
- **Vote-then-exit** (vote YES with half the supply, then redeem it all) is strictly weaker than the already-stated "a vote is atomically rentable" limit and does not lower any bar. I considered it and am not filing it.

---

## R5. The charter claim and SPEC 46

I enumerated what the Giraffish Moments update authority, a PoB holder and a third party can each do. SPEC 46 covers: a rejecting hook (ends the project), an admitting hook (captures governance), per-asset plugins (alarm blind spot), 30-minute state sampling, the positive bound (it cannot transfer or burn a PoB), name/URI rewrites being irrelevant because identity is by address, moving a PoB out of the collection as the same brick class, the owner's freeze delegate, the 8-account pass-through and the legacy packet bound, and the page's refusal on any external plugin.

I could not find anything it omits. Two things I checked and found already covered: a PoB holder cannot brick their own claim through Core's heap (R28.A4 lands a Core `BurnV1` on a 10,198-byte-autograph asset as a simulation), and an owner transferring the PoB off-curve is self-harm.

**SPEC 46 is complete as far as I can establish.**

---

## R6 / R7. One-time configuration, the trusted hop, the royalty, the rate limit, raw reads

**Every offset recomputed from the structs. All correct.** For the record (post-discriminator byte positions):

`MintConfig` — `version 8`, `collection 9`, `governance 41`, `pool_ata 73`, `round_id 105`, `price 125`, `minted_total 141`, `sales_stopped 191`, `sweep_stopped 192`, `guardian 193`, `swap_operator 225`, `sol_reserve 257`, `bump 265`, `max_sweep 266`, `cooldown 274`, `charter_closes 442`, `bare_burns_retired 454`, `sales_stopped_at 518`, `sweep_stopped_at 526`, `sweep_floor 631`, `cooldown_ceiling 639`, `reserve_ceiling 647`, `max_boost_weight 711`, `max_boost_epochs 712`; total space **1,261** ≥ GOV's required 714. `VaultRecord` — `mint_index 41`, `level 57`, `active 125`, `retired 126`, `vault_ata 129`, `debt 161`, `pending 177`, `request_epoch 178`, `boost_weight 186`, `boost_end 187`, `carry 195`; space **221**. `BurnConfig` — `burned_total 42`, `window 50`, `rate_head 58`, `ring 59`; space **827**. `SealConfig` — `collection 9`, reserve `Vec` length at **41**. The RPC proxy's `mint-boosts` slice `[125, 70)` maps `active/retired/boost_weight(+61)/boost_end(+62)` exactly, and `mint-waiting`'s memcmp at 177 is `pending`. The sweep helper's `0/32/64/165` are right.

**The redemption cap is exactly a rolling window.** `(head + 64 − k) % 64` is the k-th most recent; `k = min(max(cap,1), 64)`; a redemption lands only if that entry is a full window old; then `ring[head] = now`. Initialised to all zeros with `head = 0`, so the first `cap` land. A backwards chain clock makes `now − kth` negative ⇒ `RateLimited` — **fail-closed**. The ring bound is correct: `ceil(live·0.021) ≤ 64 ⟺ live ≤ 3047`, and `max_supply` is 2,100.

**The royalty.** `initialize` installs Royalties once with `PluginAuthority::None`; no instruction in any of the five programs touches it; R.5 (control: an `UpdateAuthority`-held plugin *can* be rewritten) and R.6/R.6a/R.6c (the `None`-held one cannot be updated or removed, with the removal proven well-formed by its control) plus R33.G3 (it cannot be re-delegated either, 0x1b) make this a measured property of Core, both directions.

**`initialize` bounds.** Every range check cross-consistent (`sweep_floor ≤ max_sweep`, `cooldown ≤ cooldown_ceiling`, `sol_reserve ≤ reserve_ceiling`, reserve 0-or-above-rent). What it does **not** check is already recorded as limit 38 / round 24 A6: on-curve-ness of `guardian`/`swap_operator`, that a SEAL "reserve mint" is a *mint* rather than any Tokenkeg-owned account, and the exact ruled values. I verified `check-launch-params.mjs` is the only gate for those and that **the ceremony builds the four `initialize` transactions from that same embedded file** (`valuesFrom(launch.json)`), which closes A6's operational half for the ceremony path. `expectMint`'s `last_distribute_at: charterClosesAt` is right precisely because `initialize` requires `charter_closes_at > now`.

**The trusted hop's worst case** is bounded as stated: cap × cooldown windows above the reserve, operator-signed, guardian-stoppable, vote-tightenable only inside the init bounds, replacement needs half of all live vaults plus notice, and the guardian can cancel a pending replacement. With the ruled values a hostile vote can slow royalties to 1 SOL / 24 h and hold back 0.1 SOL. I could not widen it.

---

# Findings

## 1. MEDIUM — The ship gate, the certifying run and the rehearsal patch all omit `web/`, which is the only pre-signature control on holder money

**Construct.** Three sites, one blind spot.

- `SPEC.md`, THE SHIP GATE, gate 2: *"No change to `programs/`, `bank/` or `scripts/` since the first of the clean rounds began."* `web/` is not in that list, yet `web/src/lib/plan-redeem.mjs`, `plan-get.mjs`, `plan-vault.mjs`, `plan-ceremony.mjs` and `ix.mjs` build **every transaction a holder or Gary signs**, and SPEC item 50 makes the pages a launch precondition and road step 11's gate.
- `scripts/run-tests.sh` runs no `web/` test. Its floors cover the on-chain suite, detectors, allocation, poster, PoB merkle, launch params, host tests, mainnet probe, expiry budget and the swap fork. The pages' 671 offline assertions and the 129-assertion end-to-end run are outside the run that certifies a release — including under `CBOB_SHIP_GATE=1`.
- `scripts/rehearsal-tree.sh` patches `programs bank scripts tests sim launch Anchor.toml`. `web/` is excluded from the file list **and** from the "no leftover 4+ char mainnet id prefix" check. `web/src/config.js` `MAINNET_PROGRAMS` holds all five mainnet ids, and `web/deploy/rpc-proxy.mjs` hard-codes MINT (and derives `MINT_AUTH`, `REVENUE`, `CBOB_PROGRAMS`, `TX_PROGRAMS` from it). So the rehearsal tree's proof — "reversing exactly that map recreates every file of HEAD byte for byte, and no file outside the map changed" — is true of its *list* and false of the claim `REHEARSAL-RECORD.txt` and SPEC 53 make: *"the ids are the whole patch."* SPEC 53's enumeration of where the ids live (`bank/layout.mjs`, `bank/revenue.mjs`, `bank/detectors.mjs`, `bank/alarm.mjs`, `bank/selftest.mjs`, the four programs, the tests and the sim) never acquired `web/` when `web/` landed in round 35.

**What it gains an attacker or an accident.** Nothing on chain. What it gains is a hole in the certification: the redeem page could be modified between the two clean rounds without resetting the clean-round counter; a certifying run would prove nothing about it (a page that names the wrong destination account, drops a reserve from the helper's pair list, or mis-plans an acknowledgement destroys holder tokens with no program refusing it); and the dress rehearsal (items 22 and 53) cannot exercise the pages at all, because the `rehearsal` profile's ids are `null` and the un-patched `mainnet` profile points at mainnet. The three blind spots reinforce each other: nothing notices, because `bundle.test.mjs` compares the rehearsal tree's build against a fresh build of the *same* un-patched source and passes.

**Evidence if I am right.** `grep -n "programs/.*bank/.*scripts/" SPEC.md` at gate 2 shows the three-directory list. `grep -n "run-all\|web/test" scripts/run-tests.sh` returns nothing. In `scripts/rehearsal-tree.sh`, the python `files = subprocess.check_output(['git','-C',dest,'ls-files','--','programs','bank','scripts','tests','sim','launch','Anchor.toml'])` has no `web`. `grep -rn 'Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo' web/` returns `web/src/config.js` and `web/deploy/rpc-proxy.mjs`. After `scripts/rehearsal-tree.sh`, `grep -c Gsb7 $DEST/web/src/config.js` is non-zero while `grep -c Gsb7 $DEST/bank/layout.mjs` is zero.

**Fix (all three, no program change).**
1. Add `web/` to ship gate 2's freeze set in SPEC, so a page change resets the counter like a program change.
2. Add to `scripts/run-tests.sh`, behind a floor that must **equal** the count (the house rule): `sub_selftest web node web/test/run-all.mjs` with `WEB_FLOOR=671`, and refuse a skip under `CBOB_SHIP_GATE=1`.
3. Add `web` to `rehearsal-tree.sh`'s `ls-files` list so the five ids and the repo-root path are substituted and the abbreviated-id check covers it; then correct SPEC 53's enumeration to name `web/src/config.js` and `web/deploy/rpc-proxy.mjs`, and add "a rehearsal `web/` build with the throwaway ids in the `rehearsal` profile" to item 53's *"Still to write before the rehearsal"* list, beside `launch/rehearsal-init.json`.

---

## 2. LOW — The FIFO reveal queue is a single, permanent, unfixable point of failure, and SPEC names it only as a consequence of a Core upgrade

**Construct.** `reveal_level` requires `index == config.revealed_total` (strict mint order, by design, because each draw changes the census the next one sees), and it advances `revealed_total` only after a successful Core `UpdatePluginV1`. There is no skip, no timeout, no default, and no admin. If one vault's attribute write can never succeed, **every vault minted after it can never be revealed, therefore never activated, therefore never paid** — permanently, under immutable programs.

Every owner-reachable route to such a state is closed **except Core's fixed 32 KiB instruction heap:**

- The Attributes plugin is authority-managed with MINT's `["mint"]` PDA as its authority, so the owner cannot remove, revoke or re-delegate it; MINT has no instruction that does either.
- An owner-added external adapter that could reject an update is refused `NoApprovals` (R24.1), and even `AgentIdentity` needs the agent registry's PDA (R24.1c).
- A burned head draws with the Core write skipped (L.11), so a bare burn is not a halt.
- Round 28 measured the trap's *other* half on a real vault at the boundary: Core could no longer shrink it (clearing the autograph and `RemovePlugin` of even `FreezeDelegate` both exhausted the heap), so an owner who crosses the line **cannot step back**.

**What it gains.** A holder who mints a vault and inflates it past the reveal's heap cost before the crank reaches it halts the payout schedule for every later vault, for ever, for the price of one vault plus the fees to grow an autograph. Their own vault is sacrificed too.

**Why I file this LOW rather than higher.** There is a structural reason to believe it is unreachable, and I want to state it so you can check it rather than trust it. Every state the owner can reach was produced by a Core write that *succeeded*. An autograph write at the limit must deserialise the whole asset **plus a second, equally large copy** of the signature list from instruction data, then re-serialise. The reveal deserialises the same asset plus a ≤ 650-byte attribute list (`MAX_ATTR_BYTES = 640` exists for exactly this reason). So the reveal's peak allocation is roughly one whole autograph *smaller* than the write that created the state — which is what the suite observed: R33.G2a grew signatures until Core refused the next write, and R33.G2b then revealed it; R34.G1b revealed the full worst single-signature shape (64-byte name, 200-byte URI, largest v0-carried attributes, five owner plugins, 10,198-byte autograph).

**The gap in the evidence** is that the two maximisers were never combined: R33.G2a grew its many-signer autograph on a `mkVault(0n)` vault (default name and URI, no caller attributes, no other owner plugins), and R34.G1b's single autograph is bounded by the 10,240-byte CPI data cap rather than by Core's heap. The shape an attacker would actually build is the many-signer autograph grown to Core's own write refusal **on top of** the 640-byte attribute list, the 64-byte name, the 200-byte URI and the other four owner plugins.

**Evidence if I am right.** On the pinned Core binary: build that combined shape, grow signatures through the `SIGSPDA!` forwarder until Core refuses, then attempt the real `reveal_level`. If it fails with a heap panic while every preceding write succeeded, the halt is reachable and `revealed_total` is stuck at that index with no recovery.

**Fix.**
1. **Gate-5 arm** (the measurement that settles it): extend R33.G2a to start from R34.G1b's vault rather than a bare one, and assert the reveal lands at the refusal point and at the step before it.
2. **Write it down as its own accepted limit**, whatever the measurement says: *"the level queue is strictly ordered and cannot skip; a vault whose Core attribute write can never succeed halts every later vault's reveal permanently, and the asset's size is the owner's to choose. Bounded observation at the pinned binary, not a proof."* Today a reader must infer it from limit 40's round-28 paragraph plus the FIFO rule, and limit 40 frames it as *"a Core change that breaks it halts the level queue"* — a Metaplex risk, not an owner-reachable one. The holder guide's "not every combination of add-ons has been tested" is the only place the residual appears, and it does not say what the consequence is for *other* holders.

---

## 3. LOW — `planDraw` can throw on an unparsable Attributes body instead of saying so

**Construct.** `web/src/lib/plan-get.mjs`:
```js
const attrs = (assetInfo && !assetInfo.burned ? assetInfo.plugin('Attributes')?.body.attributeList || [] : []).map(...)
```
`web/src/lib/decode.mjs` `plugins()` sets a registry entry's `body = null` when that one plugin's body fails to parse, while `pluginsUnreadable` is set only when the *registry* fails. `planDraw`'s guard tests `pluginsUnreadable`. So `plugin('Attributes').body` can be `null` and `.attributeList` throws a `TypeError`, which is not a `ReadError` and reaches the page as a raw message instead of "this page cannot draw its level; the Bank's draw job does it every minute."

**Reachability.** I believe it is **unreachable today**: only MINT's PDA writes a vault's attributes, the list is bounded at 8 entries and 640 bytes, and Core wrote it. I am filing it because it is a one-character fix in code that decides what a holder signs, and because the same pattern (`?.body.x` after a guard that only covers the registry) could be copied to a body that *is* owner-controlled.

**Evidence if I am right.** Feed `planDraw` a `parseCoreAsset` result whose `Attributes` entry has `body: null` and `pluginsUnreadable: false`; it throws rather than returning `{state:'unknown'}`.

**Fix.** `assetInfo.plugin('Attributes')?.body?.attributeList || []`, and extend the guard to `pluginsUnreadable || !assetInfo.plugin('Attributes')?.body` so the holder gets the plain message. One arm in `get.test.mjs` both ways.

---

## 4. INFO — Accepted limit 14's discharge is measured on one of its two sites

`DuplicateAttribute` is asserted by 11.4 only through `mkVault`, i.e. `mint_vault`. `claim_charter_vault`'s duplicate path is never sent, although C.11 does pin its `ReservedAttribute` refusal. The two calls share `check_attributes`, so there is no behavioural doubt — but limit 14's text says *"`mint_vault` and `claim_charter_vault` refuse `DuplicateAttribute`. Assertion 11.4"*, and 11.4 covers one of them. **Fix:** one arm, `claim(alice, i, {attrs:[['x','1'],['x','2']]})` with `because(..., 'DuplicateAttribute')`.

## 5. INFO — Two coverage gaps the brief asks about that no arm exercises

- **A deposit between the sweep and the burn, inside one transaction.** There is no arm of the shape `[open, Execute sweep, System transfer → asset-signer, burn]` asserting `VaultNotEmpty`. The outcome is forced by BURN reading `lamports()` at its own execution, and only the redeemer can insert such an instruction, so this is coverage rather than risk. One arm would pin the "does BURN see exactly what the sweep left" half of R1s(d).
- **A helper destination wallet that is another vault's asset-signer PDA,** and **a native wSOL source.** Both are legal and both are the holder's own choice; neither is measured. Worth one arm each if you want R1s(b)/(c) fully pinned.

## 6. INFO — `txread.mjs`'s truncation detection is pinned to an exact runtime string

`logsTruncated = meta.logMessages.includes('Log truncated')`. If the runtime ever changes that marker, the reader accepts a truncated transaction as complete and a CBOB event line is lost **with no `log_coverage_gap` recorded** — the one failure mode of this file that is silent rather than loud. SPEC's "Reader coverage boundary" describes the behaviour but does not flag the string as an external pin. **Fix:** either record it as a pin in that section, or add the structural cross-check (one `Program <id> invoke [1]` line per top-level instruction) that round 34 ruled optional under C10.

---

# The four questions about the accepted limits

**1. Is any limit WORSE than stated?** No limit I tested is worse. Two are *less complete* than they read:
- **Limit 40** states the FIFO-halt consequence only for a Core upgrade; the owner-reachable asset-size residual is the sharper version (finding 2).
- **SPEC 53 / limit 38's neighbourhood** claim the program ids are the whole rehearsal patch; `web/` is not covered (finding 1).

**2. Is anything listed as a limit not actually a limit?** No, but two have been quietly narrowed by work since they were written:
- **Limit 52**'s revenue-rent half is now *mechanised*: the ceremony's step 6 computes the shortfall from the live rent floor and the step reads `[]` only once it is covered. It belongs in OPEN AND BLOCKING until the ceremony runs, but the text should say the ceremony closes it rather than "fund it above rent at launch".
- **Limit 35** (the 10% turnout never binds) is arithmetically correct: at quorum 21% / threshold 51% the smallest passing vote is ≈ 10.71% YES, and I checked the small-`S` ceiling cases too.

**3. Is any DISCHARGED item not actually discharged?** I re-checked 14, 19, 30, 31, 33, 51, 54, 12/17 and the whole Bank family (1a–5, 11, 15, 16, 18, 20, 21, 23, 24). All are genuinely discharged: there is no `bank: Signer`, no `update_wiring`, no `update_config`, no deck instruction anywhere in the four programs, and 0.4–0.4i prove the deleted paths answer `InstructionFallbackNotFound` rather than a gated handler. The only soft spot is item 14's one-site measurement (finding 4).

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52 and 53 are all still OPEN in SPEC, the holder guide is still DRAFT, and the road table marks steps 9–11 as not done. But **item 53 is further from runnable than its text admits**: besides `launch/rehearsal-init.json` and a rehearsal mode in `check-launch-params.mjs`, the rehearsal now also needs a `web/` build at throwaway ids (finding 1), and item 22's named pass/fail list cannot include the holder pages until that exists.

---

# Three claims I developed and then killed

Stated because a verdict that only lists what survived hides how much of its reasoning was wrong.

1. **"Blocking an hour of redemptions is cheap: mint 45 empty vaults at the 21,000-sat floor and redeem them."** I checked: the mint price is not refunded, so the attacker pays ≈ 945,000 sats of which 85% lands in the pool for the holders they are griefing, plus ~0.2 SOL of unrecoverable record rent — and redeeming consumes no more of the 2,100 lifetime supply than buying and holding does, because `minted_total` counts the mint. Limit 32's "costs about 2.1% of live supply in vaults" is accurate and arguably understates the attacker's cost. **Not a finding.**
2. **"A frozen vault cbBTC account with zero balance makes `retire_redeemed` refuse `ClaimBeforeBurn` with a misleading message."** Unreachable: to be `active` a vault must have held ≥ 21,000 sats at activation, and a sealed vault's balance can only rise, so the page's `frozen && amount > 0` refusal always fires first with the correct freeze wording. **Not a finding.**
3. **"`readVault` and `meta/generate.mjs` missed the V41-1 repair."** Checked each: the asset address is either a fresh keypair or a holder-pasted vault (dust yields the right message), and a dusted MINT config correctly reads as "MINT is not initialized". **The repair is complete where it matters.**

---

# Measurement limits of this pass

- **Nothing was executed.** Every statement is a reading of the bundled source plus arithmetic I did by hand. The round-41 repairs in `bank/anchor.mjs`, `bank/redemption-poster.mjs`, `bank/swap.mjs` and `bank/crank.mjs` are **not in this bundle** and I did not verify them.
- `bank/detectors.mjs` (`judgeRedemptionCoverage`, `classifyPdaTokenAccount`), `bank/layout.mjs` (`decode`), `scripts/check-launch-params.mjs` (`judgeLaunch`) and every `web/test/*.mjs` except `e2e-localnet.mjs` are not bundled. The pages' cross-check, the launch gate and the byte-for-byte instruction comparisons against the suite and mpl-core therefore rest on records, not on my reading.
- Core's heap behaviour, SPL Token's `CloseAccount` semantics (no frozen check; owner reassigned to System), the runtime's `InsufficientFundsForRent` rule and `Message.compiledInstructions` in web3.js 1.x are all external facts I reasoned from rather than measured here. Finding 2 turns entirely on the first of these.
- The base58 of `VAULT_RECORD_DISC_B58` in `rpc-proxy.mjs` I could not compute by hand; the proxy's shape tests (off-chain pass) cover it.
- I did not check the `web/README.md` build-hash table, the ceremony's rendering, or whether any holder understands any sentence.

---

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

What AI audit structurally cannot do, with what to do about each. These are not suggestions; each is a thing that will be false of your launch unless someone does it.

**1. Fuzz Core, don't reason about it.** Findings 2's whole residual is "we measured the worst shapes we could *think to build*." Write a harness that enumerates plugin combinations (owner-managed count × autograph signature count × attribute bytes × name/URI length) against the **pinned Core binary** on a local validator, and for each reachable state attempts the real `reveal_level`, the real redemption and the real rescue. Record the frontier. An AI picks shapes it can imagine; a loop picks the ones it cannot. Budget a day of compute, not a round of reading.

**2. Run the dress rehearsal, and run it with the pages.** Item 22's five named items plus the pages. Today the rehearsal cannot touch `web/` at all (finding 1). Nothing in this audit — mine or any of the eight seats' — is evidence about `bank/crank.mjs` paying 2,100 vaults over a real RPC, about one full revenue cycle through each pool, or about a holder in Phantom on a phone opening a vault whose deposit address a stranger has flooded. **The single highest-value hour you can spend is a live redemption of one real vault with real cbBTC, by Gary, on the published page.**

**3. Put a second pair of eyes on the five bytes that can never change.** `launch/mainnet-init.json` has three OPEN values and 30 that are permanent. `check-launch-params.mjs` validates the file; the ceremony builds from the file. Nobody has ever compared the *signed transaction bytes* against the ruling. Before step 10: dump the four `initialize` instruction payloads from the ceremony's dry run, decode them by hand against DESIGN-v6's rulings, and have a second person who did not build them sign off line by line. An AI cannot be that second person, because it is the first.

**4. Decide the custody questions AI cannot decide for you.** Three keys dominate every remaining risk and all three are rulings, not bugs: the Giraffish Moments update authority stays hot through the one window that can end the project (limit 46), the entire $CBOB supply sits in a file on one box (limit 56), and the swap operator and the revenue ledger and the alarm live under one user (limit 10's residue (3)). Each is closed by a cold key or a multisig and a deleted file, each costs you an afternoon, and each is a decision no audit can make. **Limit 46 is the one I would change: a cold Moments key for seven days removes the only window in which one key can end the project before it starts.**

**5. Make the freeze mean what it says.** Add `web/` to gate 2 and the web floor to `run-tests.sh` (finding 1) *before* you start the two clean rounds, not during them. Otherwise the counter will be measuring a tree that is not the tree you ship.

**6. Write the recovery runbook for the things that have none.** Three states are unrecoverable and permanent: a stuck FIFO head (finding 2), a 50%-turnout failure against a stolen guardian key (limit 47), and a wrong `initialize` value (limit 38). For each, write down now — while you can still change the programs — what you would actually do, and whether the answer is "nothing". If the answer to any of them is "nothing and the project is over", that is a ruling to take deliberately before the upgrade authority is removed, not a discovery to make afterwards.