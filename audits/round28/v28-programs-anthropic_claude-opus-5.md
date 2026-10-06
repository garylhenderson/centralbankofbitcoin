# Independent Audit — CBOB v6 (five programs + surrounding evidence)

Tree read: the bundle as given (post‑`93f8c36`). I recomputed every cross‑program offset and account space from the struct definitions, re‑derived the Merkle scheme against MINT, traced the pool accumulator through every mutation, and walked the pairing/emptiness/rate‑limit logic by hand. Where I could not measure, I say so and give the experiment.

**Summary of disposition:** I confirm no theft path, no unseal‑without‑burn, no pool‑accounting break, and no cross‑program offset error. Round 27's four confirmed topics (D1–D4) are repaired in this tree and its three required regressions (R27.C1/C2, R27.V1, R27.S1) are present and correctly constructed. I file **1 HIGH (with a named experiment that would settle it), 2 MEDIUM, 5 LOW, 3 INFO**, and I withdraw four claims I formed and then refuted against the code.

---

## R0 — Round 27's verdict, verified against this tree

| Round 27 topic | My independent check | Result |
|---|---|---|
| D1 (stale status prose) | SPEC now reads "Rounds 22‑26 completed; none was clean. Round 26's programs pass also lacked quorum (5/8…)"; road step 7 points at `audits/FREEZE.md` rather than enumerating | **repaired** |
| D2 (boost price has no launch ceiling) | `set_boost_terms` bounds only `weight`/`epochs` against `max_boost_weight`/`max_boost_epochs`; price is any `u64 > 0`. HOLDER‑GUIDE and DESIGN‑v6 §3 now both say exactly that | **repaired** (see F4 for what is still missing) |
| D3 (shared error codes) | `WrongGaryMint` genuinely covers three distinct comparisons (token program key, mint key, mint owner); `SweepAboveCap` covers `amount == 0` and `amount > cap`. SPEC's new "Shared error‑code diagnostics" section states both; `launch/mainnet-init.json` `lock_deadline.source` now says five programs | **repaired** |
| D4 (per‑asset PoB plugins) | SPEC 46 now separates update‑authority adapters from owner‑managed plugins and names the freeze‑delegate burn block and the shared alarm blind spot | **repaired** |
| W5/W6/W7 regressions required before the next freeze | `R27.S1` credits a token‑program‑owned destination and checks its data/owner unchanged; `R27.C1/C2` claim with a program‑owned PoB owner and a separate payer; `R27.V1` votes with a program‑owned vault. The test wrapper's `PDASIGN!` mode preserves its original unsigned forwarding path | **present and correct** |

Two defects in how those repairs were wired into the suite are filed below as **F7** (arm labels reused for a different property) and **F8** (arms that cannot fail).

---

## R1 / R1s — Custody, the pairing, the emptiness proof, the sweep helper

### Claims I attacked and could not break

I traced these and found them sound; I record them so the next reader does not redo the work:

* **The pairing binds both halves in both directions and fails closed.** SEAL scans *after* `load_current_index_checked`, BURN scans *before* it; both see top‑level instructions only and both bind asset **and** owner. Two redemptions in one transaction each pair with their own half (the `[open A, open B, burn B, burn A]` interleaving resolves correctly). A wrapper on either half breaks its own match, not the other's.
* **A thawed vault cannot survive the transaction.** Every refusal downstream of the thaw (`RateLimited`, `VaultNotEmpty`, `ClaimBeforeBurn`, a frozen source in the helper) reverts the thaw with it.
* **The asset‑signer cannot be made permanently unemptiable.** I thought I had a kill: the owner can run arbitrary instructions as the asset‑signer during a thaw, and `system_instruction::transfer` refuses a `from` account that carries data (`InvalidArgument`), so `allocate`‑ing data at the asset‑signer would make BURN's `lamports == 0` unreachable for ever. It does not work: an account with 0 lamports is not persisted, and funding it to rent exemption makes the burn in the *same* transaction fail, so the allocation never survives. **Withdrawn.**
* **Sweep‑helper pair aliasing is closed by construction.** A source must be owned by `signer`, a destination by `dest`, and `signer != dest`, so no account can be both and no cross‑pair chain (A→B, B→C) is expressible. A duplicated source is refused by `read_token` on the already‑closed account (`SR.12a`/`SR.12b` pin that it is the *second* read, not the first owner guard).
* **A closed source passes BURN for the right reason.** After `CloseAccount` the account is System‑owned with no data, so BURN's "no token program owns it → skip" branch fires. The helper's closing also means BURN never evaluates the delegate/close‑authority bytes for that account — harmless, because the account no longer exists.
* **Reaching the helper outside a redemption.** Core's `ExecuteV1` is refused on a frozen `PermanentFreezeExecute` asset (3.7, S6.2) and approves only `authority == owner` on a thawed one (SR.5, SR.5a, SR.5c against the pinned binary). Called directly the helper needs a signature nobody holds. Called by a stranger with *their own* accounts it moves their own tokens — no reachable harm.
* **(c) The destination wallet is not compared with the asset owner, and that is not an exposure.** Binding `dest` to the asset owner would buy nothing: `open_for_redemption` thaws the asset, and any owner‑signed `ExecuteV1` can then move contents anywhere (the suite's own `sweep()` helper takes a `to` parameter). A malicious page redirects value with or without the helper. **Withdrawn as a finding**; it belongs in the "what a client can do to its own user" bucket, which item 50 already owns.
* **(d) The lamport sweep.** `signer.lamports()` is read at execution; BURN re‑reads at its own execution, so any later deposit fails the burn closed. Core does not debit the signer.
* **(e) The missing‑reserve‑ATA race.** With the prior transaction of SPEC's REDEEMING step 1 creating all three classic ATAs, the race is closed: those accounts cannot be closed by anyone but the asset‑signer, so once created they persist and the helper can always name them. A stranger **cannot** create a Token‑2022 ATA for a classic mint (probe‑measured `IncorrectProgramId`), and a stranger **can** create a non‑ATA token account owned by the vault PDA (`InitializeAccount` needs no owner signature) — but BURN only inspects *declared* accounts, so that account does not block the burn; it is destroyed (limit 44). I found **no** account a stranger can create that neither the sweep can name nor BURN will skip.

### F1 — HIGH (one experiment away from CRITICAL): `reveal_level`'s strict FIFO is a single permanent chokepoint, and the only evidence that a vault owner cannot jam it is five owner plugins at their **empty** values

**Construct.** `programs/cbob-vault-mint/src/lib.rs`, `reveal_level`:

```rust
require!(index == ctx.accounts.config.revealed_total, MintError::RevealOutOfOrder);
…
if !burned { … invoke_signed(UpdatePluginV1 { Attributes }, …)?; }
```

and `activate`: `require!((1..=5).contains(&r.level), NotRevealed)`.

So: one vault that can never complete `reveal_level` permanently blocks **every vault minted after it** from being levelled, therefore from activating, therefore from ever being paid. There is no escape hatch — no out‑of‑order path, no skip‑after‑N, no record‑only reveal — and the programs become immutable.

**What an attacker gains.** A charter claimant at mint index *n* denies payouts to all 2,100 − *n* later vaults, for ever, while keeping their own vault redeemable. At index 0–5 that is the entire paid supply, which makes every later sale round a sale of a vault that can never earn.

**Why the current evidence does not close it.** The suite attaches owner‑managed plugins to **C1, the head of the queue**, and reveals it (`R26.P1`–`P7`). That is the right experiment — but `R26.P4` adds `{type:'Autograph', signatures: []}`. An **empty** list. `Autograph` is the one owner‑managed Core plugin with unbounded variable‑length data (`Vec<AutographSignature>` of `(Pubkey, String)`), its `check_update_plugin` is a validating check (which is why Core consults it when *we* update Attributes), and nothing in the suite, the sim or the host tests measures `reveal_level` against a **grown** one. The relevant failure modes are not catchable by our program: BPF heap exhaustion during Core's Borsh deserialization of a large `Vec<String>` (32 KB default, 256 KB maximum) and global CU exhaustion — neither can be recovered by ignoring a CPI error.

**Evidence that would exist if I am right.** On the pinned Core binary: mint a vault; as its owner `addPlugin({type:'Autograph'})`, then `updatePlugin` repeatedly appending signatures (rotating owner wallets if Core requires each signature's address to sign) until the asset is N KB; then send `reveal_level` with `SetComputeUnitLimit(1_400_000)` and `RequestHeapFrame(262_144)`. If the attack exists you will see `ProgramFailedToComplete`, "memory allocation failed", or "exceeded CUs" from `CoREENxT…`, and `revealed_total` will not advance — for that vault, for ever, with every later vault stuck behind it. If instead Core bounds the message length or dedups by address so the plugin cannot grow, the reveal will succeed at the maximum achievable size and the claim is refuted.

**Also certain, independent of the experiment: the documents contradict each other on this.** DISCHARGED item 19 says the customer‑triggerable payout DoS is "CLOSED BY CONSTRUCTION … v6 has no off‑chain allocator, so there is nothing left to halt." Limit 40 says a Core change to `UpdatePluginV1` "halts the level queue (no later vault can be revealed or activated)." Both cannot be true. The queue is haltable; what item 19 closed is only the `levels.json` variant. **Item 19 is not fully discharged** and should say so.

**Fix (choose before the freeze).**
1. Run the experiment. If it refutes the attack, convert it into a permanent assertion (ship gate 5) with the measured maximum asset size.
2. If it confirms it, the cheap immutable fix is a size‑gated record‑only reveal: in `reveal_level`, if `ctx.accounts.asset.data_len() > ASSET_WRITE_CEILING` (a plain length read — no deserialization, no Core call), draw the level, write `r.level`, advance `revealed_total`, and **skip** the Core attribute write. The draw is unchanged (the entropy is already captured and stored), the money path reads `r.level` from the record, and the only loss is the on‑asset label for a vault its own owner bloated. Note the corresponding HOLDER‑GUIDE sentence ("written onto the vault") would need a qualifier.
3. Either way, limit 40 should name the *per‑asset, owner‑triggerable* form of the queue halt, not only the Core‑upgrade form.

### F2 — LOW: coverage gaps in the helper that are measurable and currently unmeasured

None of these is a defect I can demonstrate; all are arms the prompt names and the suite does not have. Under ship gate 5 they should exist:

* a **native wSOL** source (the `amount` field is derived for native accounts; `Transfer` then `CloseAccount` is expected to work, untested);
* a source carrying a **close authority** other than the asset‑signer (expected: `CloseAccount` refuses and the redemption reverts — fail‑closed, untested);
* a destination wallet that is **another vault's asset‑signer** (accepted by the helper; the value becomes locked in that vault until *it* is redeemed — self‑inflicted, undisclosed, untested);
* a destination that is **not an ATA** but is a same‑mint account of the destination wallet (accepted; untested);
* an instruction that **deposits lamports into the asset‑signer between the helper and the burn** (expected `VaultNotEmpty`; this is the arm that proves (d) fails closed, and it does not exist).

---

## R2 / R2b — The pool, the counters, the boost

**The invariant holds.** I verified every mutation of `owed_scaled` against the pool balance:

* `credit`: `owed += floor(avail·S/w)·w ≤ avail·S`, and `avail = balance − ceil(owed)`, so `balance ≥ ceil(owed_new)`.
* `claim`: `owed −= pay·S` exactly as `balance −= pay`.
* `reweigh` / `expire_boost`: `owed_of` is invariant across a weight change (the owed share moves to `carry`, the debt restarts at the new weight), and `owed_scaled` is untouched.
* `join`: `debt = w·acc`, `carry = 0`, so `owed_of = 0`.
* `retire`: `owed −= pending`, weight and boost unscheduled together.

The pool's balance can fall **only** through `claim` (nothing else ever signs as the config PDA — no `Approve`, no `SetAuthority`, no `CloseAccount` anywhere in MINT), so no third party can break it.

**Counters.** `pending_this_epoch ≤ pending_count` is preserved: a current‑epoch request increments both; `advance_epoch` zeroes only `pending_this_epoch`; `join` decrements only `pending_count`; `retire` decrements both iff `request_epoch == dist_epoch`. A request can only have `request_epoch == dist_epoch` if it was made after the last reset, so the paired decrement can never underflow. `total_active_weight`, `boost_weight_total`, `boosts_active`, `boosts_due` and the ring are consistent across all four mutators; the ring cannot collide because `max_boost_epochs ≤ BOOST_RING − 1 = 63` and `advance_epoch` drains slot `dist_epoch % 64` on entry, so purchases during epoch *E* can only land in the other 63 slots. The host test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` drives this through the program's own free functions for 260 epochs with per‑index ring checks — that is the right shape of evidence.

**Liveness.** Neither gate can be made permanent. `JoinWaitingFirst` is cleared by `claim`'s pending branch, which only compares `dest.key == r.vault_ata` and never reads that account, so a waiting vault can be joined even if its cbBTC account does not exist or has been closed. `BoostsExpireFirst` is cleared by `expire_boosts`, which needs nothing but the record. Both are permissionless. A vault cannot be `pending` **and** boosted (`boost_vault` requires `active && !pending`), which is what keeps `join`'s use of the bare `LEVEL_WEIGHTS[level−1]` consistent with `weight_of` — worth noting as a sharp edge that only holds because of that one require.

### F3 — LOW: the boost price has no on‑chain floor, and the worst case of that is never stated as a number

**Construct.** `set_boost_terms` (MINT) bounds `weight` and `epochs` against the `initialize` ceilings and bounds `price` only by `> 0` to mean "on". GOV's `create_proposal` checks nothing about price either. `SetBoostTerms` is an **ordinary** action: ~10.71% of the snapshotted live supply carries it (quorum 21% × threshold 51%, above the 10% turnout floor).

**What a coalition gains.** Set `boost_price = 1` (10⁻⁶ $CBOB). A coalition holding the 225 vaults it needed to pass the vote boosts each by +12 for 24 distributions, for a total cost of 0.000225 $CBOB. If those are Level I vaults their weight goes from 450 to 3,150 against a census total of 6,405 → **34.6% of the next 24 distributions against a 7.0% fair share**, i.e. ~5× for free. Everyone else loses ~27% of 24 payouts.

**Why this is a documentation finding and not a program finding.** SPEC 51 does say "switch boosts on at **any price above zero** … It is an ordinary action (10.71% YES…)", and SPEC's Schedule section already states the +12 compression (V : I collapsing to 18 : 14). HOLDER‑GUIDE says "the price has no such launch ceiling" and "a boosted vault can out‑earn higher levels". So the *capability* is disclosed. What is absent is the **quantified worst case**, which SPEC does supply for the directly comparable governance power ("an ordinary proposal can open a round with a cap of 2,100 at the 21,000‑sat floor"). The asymmetry matters because a buyer reading SPEC's "Where this stands, honestly" §4 gets the round‑price number and not this one.

**Evidence if I am right.** Arithmetic, reproducible from `LEVEL_WEIGHTS`, `MAX_BOOST_WEIGHT_BOUND = 12`, `launch/mainnet-init.json` (`max_boost_epochs = 24`) and GOV's thresholds; `bank/accrual.mjs --selftest` can assert the 5× figure directly.

**Fix.** Add the number to SPEC's concentration section and to the HOLDER‑GUIDE honest list, in the same sentence shape as the round‑cap disclosure. (A price floor, or moving `SetBoostTerms` to the `KEY_CHANGE_YES_BPS` class, is a program change under freeze — Gary's ruling makes it an ordinary action, so I am not proposing it.)

---

## R3 — The level draw

The SlotHashes parse is pinned to the sysvar id, bounds `n ≤ 512`, bounds the buffer against the declared count, and refuses an all‑zero hash. The A/B/C walk is deterministic and the capture deadline is correct: A ≤ `rs + 64`, so C ≤ `rs + 208` < the 300‑slot window, and A is still inside the 512‑slot buffer for the whole window. The host tests exercise skipped slots at A, B and C and a full/truncated/forged buffer — paths a local validator cannot produce.

**Is it worse than SPEC 26?** One refinement, not a worse bound. SPEC 26 already concedes C's leader "can CHOOSE AMONG MANY DRAWS" (64 tries → 96% for Level V) and that one validator was measured holding two adjacent rotations. Round 27 correctly rejected the "best‑of‑16 by moving B" claim — `floor(B/4)` is constant across a 4‑slot group, so moving B does not change C's target, and a non‑colluding B leader chooses blind. But a validator holding **both** B's and C's groups multiplies its options (4 values of hB × its own C choices × block grinding). Since SPEC's stated bound is already "chooses among many draws, effectively what it wants", this does not make the accepted limit worse. **No finding.** HOLDER‑GUIDE states it truly ("can pick among several results, by skipping a block or changing what goes into it … enough to choose the level of a vault created in the same moment").

A burned vault at the head still takes its draw (`L.11`), and the reschedule target is `now + 16`, a slot that does not exist when the call lands. The re‑supply hash is over the exact Borsh encoding including order, so a caller cannot alter a byte or a position.

---

## R4 — Governance

No minority path I can find carries what it should not. Minimum passing YES is `max(ceil(0.51·ceil(0.21·S)), ceil(0.10·S))` = **10.71% of S** at the ruled numbers (I recomputed at S = 2,100: 441 cast / 225 YES vs. a 210 turnout floor), so limit 35 is exactly right. Key changes need `ceil(0.50·S_snapshot)` and can never share a proposal with each other. `tighten_sweep` is monotone, so cross‑kind ordering genuinely does not matter for it; the stale‑restart half is skipped by stop time with GOV's `>=` and MINT's `<` agreeing on the tie. Every GOV CPI payload matches MINT's Borsh signature byte for byte (I checked all six, including `Option<Pubkey>` for `arm_guardian`). `Proposal` space (259 bytes declared, 143 worst‑case actual) and `ACTION_MAX_BYTES = 37` (Brakes) are correct.

### F4 — LOW: the measured PDA‑vote capability makes a *durable, trustless* vote‑custody market practical, which is materially stronger than the disclosed "atomically rentable" limit

**Construct.** `cast_vote` takes `owner: Signer` with a separate `payer`, has no stack‑height or top‑level restriction, and `R27.V1` now **measures** that a program‑owned vault votes via `invoke_signed`. `returnFromPda` measures that the same program can transfer it back.

**What that enables.** SPEC's "Known limits" discloses vote rental as *atomic* ("transfer to a broker, cast, transfer back, all in one transaction"), which is trustless but one‑shot and per‑proposal. A deposit‑style custody program is now demonstrably possible: holders deposit vaults, the program votes as directed, holders withdraw. That makes assembling 10.71% for an ordinary action — and `ceil(50%)` of a 240‑vault charter snapshot for a **guardian or swap‑operator change** — a standing market rather than a per‑vote coordination problem. It interacts directly with SPEC's concentration analysis (top three = 91 PoBs) and with limit 47.

**Evidence if I am right.** `R27.V1` and `returnFromPda` in `tests/3prog.test.ts` are the evidence; nothing further is needed. The claim is about disclosure, not about program behaviour.

**Fix.** Extend the "a vote is atomically rentable" limit to say that custody‑based aggregation is also possible and measured, and fold it into the concentration paragraph in "Where this stands, honestly". Note also that a deposited vault is unredeemable while deposited (limit 43), which is the only friction.

---

## R5 — The charter claim

`pob_extra` is bounded by `MAX_POB_EXTRA` **and** by `remaining_accounts.len()` before the split, so the crank slice can never be mis‑sliced; extras are forwarded never as signers; the burn's meta list uses `MPL_CORE_ID` as the `None` sentinel for the two optional accounts, which is the correct Core convention (confirmed by `OR.4` landing). Identity is by address against a domain‑separated, sorted‑pair Merkle root; I verified `scripts/pob-merkle.mjs` matches `merkle_leaf`/`merkle_root_from` byte for byte, including odd‑node promotion and the lexicographic byte comparison (`Buffer.compare ≤ 0` ≡ Rust `[u8;32] <=`). A leaf can never be replayed as a node.

**Is SPEC 46 now complete?** Close. Two additions I would make, neither new on‑chain behaviour:

* A **PoB holder** can self‑brick their own claim by adding an owner‑managed `FreezeDelegate` (frozen) to their PoB — SPEC 46 now says this, good — but it should also say the holder can simply **transfer** the PoB away and that the claim window cannot be reopened for them. (Self‑inflicted; completeness only.)
* The hot wallet can also **move a PoB out of the collection** via Core's update path, which SPEC 46 calls "the same brick class"; that is right, but it is worth stating that it is *targeted* (one holder, silently, with no collection‑level diff for the alarm to see) rather than a window‑wide brick.

---

## R6 — One‑time configuration and the trusted hop

I re‑read all four `initialize` bodies. The dangerous accepted‑but‑wrong values are the ones limit 38 already names, with the standout being `redeem_window_secs` (program bound 10 s … 24 h, mainnet must be 3,600 — a value of 10 turns the whole anti‑key‑theft control into 2.1% per ten seconds) and `sweep_cooldown_secs` (program bound **1 s** … 24 h at initialize, so 50 SOL per second is an accepted value). Both are caught only by `scripts/check-launch-params.mjs` and the alarm after the fact. That is stated.

The 10% royalty is genuinely immutable: the only Core CPIs in the tree are `CreateV2`, one `AddCollectionPluginV1` inside a once‑only `initialize`, `UpdatePluginV1` (asset Attributes in MINT, asset PermanentFreezeExecute in SEAL) and `BurnV1`. Nothing can add an asset‑level Royalties override (MINT's PDA signs only the create and the Attributes update; `R.8` measures the owner refused), and `R.5`/`R.6`/`R.6a`/`R.6c` measure that `PluginAuthority::None` refuses update *and* removal even to a keypair update authority with a working control.

The redemption cap **is** exactly a rolling window: `k = min(max(cap,1), 64)`, `kth = ring[(head − k) mod 64]`, allowed iff `now − kth ≥ window`, then write at `head`. At most `cap` redemptions in any window ending at a redemption; `k` is clamped to the ring, so past 3,047 live vaults the limit is stricter, never looser; a backwards clock fails closed. Limit 32 is accurate.

### F5 — LOW: `initialize` does not check that the pinned `$CBOB` mint has no mint or freeze authority, and limit 38's roll‑call omits it

**Construct.** MINT `initialize` checks `cbob_mint` is SPL‑Token‑owned, 82 bytes, initialized, and neither `payment_mint` nor `GARY_MINT`. It does not read bytes 4..36 (mint authority COption) or 46..82 (freeze authority COption).

**What a wrong‑but‑accepted value locks in.** A `cbob_mint` with a live mint authority gives that authority unlimited boost currency for ever (boosts are priced in a token it can print). A live freeze authority gives it per‑holder boost denial. The actual mainnet mint (`GMm2yY2z…`) has neither, verified off chain — so this is a trust that is checked by one JSON file and a human, permanently.

**Evidence if I am right.** Pass a freshly created mint with a mint authority as `cbob_mint` in `initialize` on a validator: it is accepted. There is no arm for it (`0.1o`–`0.1v` cover the payment/GARY/T22/non‑mint/bounds cases, not the authorities).

**Fix.** Either add the two COption checks to `initialize` (four lines, before the freeze), or add `cbob_mint`, `max_boost_weight` and `max_boost_epochs` to limit 38's explicit must‑be‑ruled list and assert the two authorities in `scripts/check-launch-params.mjs`. The second is free; the first is the one that survives a wrong signed transaction (limit 38 already warns that the checker validates the JSON, not the transaction).

---

## R7 — Cross‑program raw reads

I recomputed every offset from the struct declarations. All correct:

* **MintConfig** (serialized 1,005 bytes, `MINT_CONFIG_SPACE` 1,261 = 1,005 + 256 padding): collection 9, governance 41, pool_ata 73, round_id 105, price 125, minted_total 141, bank_treasury 157, split_bps 189, sales_stopped 191, sweep_stopped 192, guardian 193, swap_operator 225, sol_reserve 257, bump 265, max_sweep 266, cooldown 274, last_sweep 282, level_caps 290, level_minted 310, revealed_total 330, payment_mint 338, pob_collection 370, pob_root 402, charter_opens 434, charter_closes 442, charter_claimed 450, bare_burns_retired 454, total_active_weight 462, active_count 470, acc 478, owed 494, last_distribute 510, sales_stopped_at 518, sweep_stopped_at 526, pending_op 534, pending_op_at 566, monthly 574, pending_guardian 582, set 614, at 615, notice 623, sweep_floor 631, cooldown_ceiling 639, reserve_ceiling 647, dist_epoch 655, pending_count 663, pending_this 671, cbob_mint 679, max_boost_weight 711, max_boost_epochs 712, boost_price 714, …, boost_expiring 749. Every GOV and BURN constant matches, and the suite's TypeScript offsets match independently.
* **VaultRecord**: 221 bytes serialized (`8+1+32+8+8+1+1+1+32+32+1+1+1+2+32+16+1+8+1+8+16` = 211, + 10 padding), GOV's `mint_index` at 41 correct.
* **BurnConfig**: 571 serialized, `burned_total` at 42, space 827 = 571 + 256.
* **SEAL Config**: collection 9, reserve Vec at 41; space 398 vs 142 actual.
* **GovConfig**: 94 serialized, space 350.
* **Sweep helper**: mint 0, owner 32, amount 64, length exactly 165, classic‑SPL owner required (so a zero‑extension Token‑2022 account, which is also 165 bytes, is refused by owner — the stated reason in limit 44 is the right one).

### F6 — INFO: MINT's own `SEAL_CONFIG_DISC` and exported `MINT_CONFIG_DISC` are not statically pinned

`3.1y` pins BURN's `SEAL_CONFIG_DISC` against `sha256("account:Config")`; `3.1u`/`3.1p` pin BURN's and GOV's `MINT_CONFIG_DISC`. MINT's copy of `SEAL_CONFIG_DISC` is only measured behaviourally (every successful mint runs `check_seal_wiring`), and MINT's exported `MINT_CONFIG_DISC` is unused by MINT and pinned nowhere. Two one‑line arms close both. Under ship gate 5 ("every rejected finding that could be measured is an assertion") this is the cheapest gap on the board.

---

## R8 — The suite, the simulation and the build as evidence

The reason discipline is strong: I walked every `REJECT` arm in `tests/3prog.test.ts` and `sim/test-vault.ts` looking for an unpinned negative and did not find one of consequence. `SR.12b` is a particularly good construction — it distinguishes the helper's explicit source‑owner guard from `read_token`'s `IllegalOwner` on an already‑closed account, i.e. it proves *which* refusal fired. `RL.S1`–`S6` and `stampCaps` are a correct repair of round 26's cap‑certification: the interval `[a.minted − k − b.bare, b.minted − k − a.bare]` does bound the live supply at the *k*-th burn, and equality of the endpoint caps is the right certification condition.

### F7 — MEDIUM: `scripts/build-mainnet.sh` proves "these are the bytes the suite ran" for **one of five** programs

**Construct.** The script builds mainnet into `$CACHE/mn` and localnet into `$CACHE/ln`, then:

```bash
cmp -s "$OUT/cbob_vault_sweep.so" "$LN_DIR/cbob_vault_sweep.so"
cmp -s "$OUT/cbob_vault_sweep.so" "$ROOT/target/deploy/cbob_vault_sweep.so"
…
echo "  sha256 of the five programs as the suite and the sim DEPLOYED them (target/deploy, localnet build):"
for f in … ; do echo "    $(sha256sum "$ROOT/target/deploy/$f.so" …)"; done
```

Only the sweep helper's `target/deploy` bytes are compared against anything built from the commit being certified. For SEAL, MINT, BURN and GOV the script **prints** `target/deploy` hashes under a caption asserting the suite ran them, with nothing tying them to the current source.

**What an accident gains.** Edit MINT, commit, run `build-mainnet.sh` without re‑running `run-tests.sh`: the script passes every gate (clean tree, source key check, behavioural key check on the freshly built mainnet artifacts) and emits a certification record in which the "as the suite deployed" MINT hash belongs to older source than the `dist/` hash beside it. Given immutability, the link between "848 assertions passed" and "these bytes" is the one thing this script exists to establish.

**Evidence if I am right.** Run `run-tests.sh`; change one line in `programs/cbob-vault-mint/src/lib.rs`; commit; run `build-mainnet.sh`. It exits 0 and prints a stale MINT `target/deploy` hash. (The sweep `cmp` would not fire, because the sweep crate is unchanged.)

**Fix.** Three lines: `for f in $PROGS; do cmp -s "$LN_DIR/$f.so" "$ROOT/target/deploy/$f.so" || die "$f: target/deploy is not this commit's localnet build"; done`. The localnet artifacts for all five are already built in `$LN_DIR`, and the existing sweep `cmp` is empirical proof that a different `CARGO_TARGET_DIR` does not perturb the bytes. If any of the four fails to match, that is itself a result worth having before launch.

*Note:* the script's key verdict rests on `tests/initauth.test.ts`, which is not in this bundle, so I cannot check that the "REJECTS/ACCEPTS" lines mean what they claim.

### F8 — MEDIUM: the shared history reader asserts two v1 properties no consumer needs, and the mainnet probe makes certification depend on the shape of arbitrary third‑party traffic

**Construct 1.** `bank/txread.mjs`:

```js
if (tx.version === 1) {
    need(object(m.transactionConfig), 'v1 transactionConfig')
    need(m.accountKeys.every(k => k.source !== 'lookupTable'), 'v1 lookup-table key')
}
```

Nothing downstream reads `transactionConfig`, and every consumer needs only resolved string keys, which `jsonParsed` supplies regardless of `source`. These two assertions encode format assumptions derived from **one** captured transaction (`tests/fixtures/mainnet-v1.json`, all keys `source: "transaction"`). If v1 permits lookup tables, or permits an omitted `transactionConfig`, the reader throws on a valid transaction — and because the design deliberately refuses to advance a cursor on unknown coverage, the alarm's signature walk and `bank/revenue.mjs`'s `splitsSince` wedge on that signature, every pass, for ever. That is precisely the failure round 27 just repaired, re‑introduced by the repair.

**Construct 2.** `scripts/probe-mainnet-facts.mjs`:

```js
for (const sig of page1.filter(s => !s.err).slice(0, 20)) {
  const tx = await readParsedTransaction(conn, sig.signature)   // throws
  …
}
if (!simulationPayer) throw new Error('no funded simulation fee payer found…')
```

`readParsedTransaction` throws on any validation failure, with no `try/catch`. The probe needs **one** funded payer out of twenty samples, but a single unreadable sample aborts the probe, and `run-tests.sh` then dies at step 6 (`die "mainnet probe failed"`). So the certifying run's success depends on the parse shape of twenty arbitrary recent SPL‑ATA‑program transactions chosen by whoever happens to be transacting.

**Evidence if I am right.** Point the probe at a block range containing a v1 transaction that resolves any key from a lookup table (or a transaction with `meta.innerInstructions === null`, or `meta.logMessages === null`): the probe exits non‑zero with an "unreadable parsed transaction" message and `run-tests.sh` dies before the on‑chain suite. For the alarm, feed the same signature through its walk and observe the cursor not advancing across passes.

**One claim I checked and withdrew:** I first flagged `keys.size === m.accountKeys.length` (the no‑duplicate‑keys requirement) as a wedge on valid data. It is not — the runtime rejects transactions that load the same account twice (`TransactionError::AccountLoadedTwice`), so duplicates cannot appear in a landed transaction's resolved key list. **Withdrawn.**

**Fix.** (a) Delete both v1‑specific assertions; they protect nothing and they are the only places the reader asserts a property of a format the repo has one sample of. (b) Wrap the probe's sampler in `try { … } catch { continue }` — it is a convenience sampler, not a certification claim. (c) Keep the alarm's fail‑closed behaviour, but make the notice carry the offending **signature** and the exact validation field, so the wedge is one human action rather than a diagnosis.

### F9 — LOW: three arms cannot fail, and two now measure a different property than their label

**Cannot fail.** `rec('C.2', …, 'true', String(!!C1))`, `rec('C.13', …, 'true', String(!!C2))`, `rec('2.1', …, 'true', String(!!V.asset))`. In each case the value tested is the return of a constructor (`claim()` → `mkV()`, `mkVault()` → `mkV()`) that returns an object unconditionally; a failed send throws out of `main` and the run exits 2 with `FATAL`. So the *property* is still gated (the runner dies), but the arm's identity, its reason pin and its line in the 848‑assertion table are lost. These are exactly the "arms that cannot fail" the prompt asks for. Fix: build them from `att()` results like every neighbouring arm.

**Mislabelled after the round‑27 repair.** `R27.C1/C2` and `R27.V1` were inserted *inside* two existing arms:

* `rec('C.13','a CHARTER claim while the guardian has stopped sales','true',String(!!C2))` — `C2` is now the **program‑owned** claim, and the arm is the unfailable kind above.
* `rec('7.6','the owner votes','ALLOW',RA(v1))` — `v1` is now the **PDA** vote (`signedOwnerIx(pdaVote)` with the owner slot replaced by `CPI_OWNER`). The arm named "the owner votes" no longer measures an ordinary keypair owner voting. That property survives only incidentally, via `G.7` and the `propose()` helper's real votes.

Also: `rec('R27.C2', …)` calls `fetchAsset` unconditionally, so a failed `cpiClaim` crashes the run instead of producing an attributable MISMATCH.

Fix: give the new properties their own arms and restore `7.6`/`C.13` to measuring what they are named for.

### F10 — LOW: SPEC's "three‑layer fallback" is true of `distribute` only, and item 50's list of unbuilt surfaces omits the one holders are told is automatic

**Construct.** SPEC's control table: "`bank/crank.mjs` — layer one of the three-layer fallback (ours, then anyone's permissionless call, then ordinary traffic doing it in-line)". Layer three exists only for distribution: `monthly_inline` rides on `mint_vault`, `claim_charter_vault`, `activate`, `claim` and `retire_redeemed`. **No host instruction performs an `activate`, a `join` or a `claim` in line.** Delivery of a payout happens only when someone sends `claim`; joining happens only via `activate` or `claim`.

HOLDER‑GUIDE: "Once it holds at least 21,000 sats of cbBTC, it is **activated**… **Activation is picked up automatically**" and "Payouts are credited to your vault every month once due and **delivered inside your vault**". Both rest entirely on `bank/crank.mjs`, which is installed **dry‑run** (limit 22) and whose live I/O at ~2,100 vaults has never run. Item 50 lists the deposit‑address page, the redeem page and the poster as the unbuilt holder surfaces — it does **not** list any surface through which a holder can activate their own vault or pull their own owed share. The guide's "anyone can run it for free" is not a surface for a non‑technical holder.

**Evidence if I am right.** Read MINT for in‑line `activate`/`claim` calls: there are none. Read item 50's bullet list: no activation/claim page. Read the crank's cron posture: dry‑run.

**Fix.** Correct the control table to say the third layer covers distribution only; add "a page from which a holder can activate their own vault and claim its owed share" to item 50's list of promised‑but‑unbuilt surfaces; or soften the guide's "automatically".

---

## The four questions about the accepted limits

**1. Is any limit worse than stated?**

* **Item 19 (DISCHARGED) is the one that is wrong.** "There is nothing left to halt" is contradicted by limit 40's own words ("halts the level queue"), and F1 argues the halt may be *customer‑triggerable* — the same property item 19 was written to close. Treat item 19 as partially discharged until F1's experiment is run.
* **Limit 40** is accurate as far as it goes but names only the Core‑upgrade route to a level‑queue halt, not the per‑asset route.
* **Limit 10 (swap hop)** — I confirm the bound is "cap × cooldown windows until the guardian stops it", not one sweep, and that `MIN_SWEEP_COOLDOWN_SECS = 1` is accepted at `initialize`, so the *program* permits 50 SOL/second. Stated in limit 38; worth repeating inside limit 10 where readers go for the bound.
* Limits 25, 26, 27, 28, 29, 32, 34, 35, 41, 42, 44, 45, 46, 47, 48, 49, 51, 52, 54, 55, 56: I checked each against the code and found each accurate. Specifically: 32's ring arithmetic and the 3,047 crossover are right; 35's 10.71% is right to the vote; 27's "pays into a dead account" is right (the vault's ATA is unreachable for ever