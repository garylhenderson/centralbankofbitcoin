# INDEPENDENT AUDIT — v6, round 24

Scope: the four programs as delivered, `tests/3prog.test.ts`, `sim/test-vault.ts`, `scripts/run-tests.sh`, and the four documents. I recomputed every struct offset, every account space, the pool arithmetic, the boost ring, the rate-limit ring and the entropy windowing from the source in this bundle. Where I could not measure, I say so.

**What I could not break.** I want these on the record because they were the primary targets and they held under recomputation:

* **The pool invariant `balance >= ceil(owed_scaled / ACC_SCALE)` holds.** `credit` adds `delta·w ≤ avail·SCALE` where `avail = balance − ceil(owed)`, and `ceil(a+b) ≤ ceil(a)+ceil(b)`, so `ceil(owed_new) ≤ ceil(owed_old) + avail = balance`. `claim` reduces balance by `pay` and `owed_scaled` by exactly `pay·SCALE`, so the slack is unchanged. `retire` reduces `owed_scaled` only. The pool ATA is owned by the config PDA and no instruction ever `Approve`s it, so the only outflow is `claim`. Invariant proven, not merely asserted by P.32.
* **`owed_of` cannot underflow.** At `join`, `debt = w·acc, carry = 0`. Every subsequent mutation (`credit`, `claim` normalisation, `reweigh`) preserves `weight·acc + carry ≥ debt` exactly, because `reweigh` sets `carry := owed` then `debt := after·acc`, giving a new owed identically equal to the old. `acc_scaled` is monotone.
* **The boost ring cannot collide.** All scheduled end epochs lie in `(dist_epoch, dist_epoch + 63]` — 63 distinct slots in a 64-slot ring — because `BoostsExpireFirst` forbids `advance_epoch` from running twice without the due slot being drained. `boosts_active = Σring + boosts_due` is maintained by `boost_vault`/`advance_epoch`/`unschedule_boost`.
* **Every cross-program raw offset is correct.** I recomputed the full Borsh layout: `MintConfig` = 1261 bytes (`governance` 41, `minted_total` 141, `sales_stopped` 191, `sweep_stopped` 192, `sol_reserve` 257, `max_sweep` 266, `cooldown` 274, `charter_closes` 442, `bare_burns_retired` 454, `sales_stopped_at` 518, `sweep_stopped_at` 526, `sweep_floor` 631, `cooldown_ceiling` 639, `reserve_ceiling` 647, `max_boost_weight` 711, `max_boost_epochs` 712); `VaultRecord` = 221 bytes (`mint_index` 41); `BurnConfig` = 827 bytes (`burned_total` 42); `GovConfig` = 350; `SealConfig` = 398 (`reserve_mints` at 41). `MINT_CONFIG_SPACE` and `VAULT_RECORD_SPACE` as written evaluate to 1261 and 221. Every reader's length guard is satisfied. No misread.
* **`try_capture` is call-time independent inside its window.** A ≤ R+64, B ≤ R+136, C ≤ R+208, and the window closes at R+300 < 512, so every slot the draw depends on is still in SlotHashes for the whole legal capture interval. The comment's claim checks out.
* **The open↔burn pairing.** A `retire_redeemed` reached from a top-level Core `ExecuteV1` sits at stack height 2 and would pass the height check, but the sysvar check then sees `program_id == MPL_CORE_ID` and refuses `NotFromBurn`. A `burn_vault` inside `ExecuteV1` runs at height 2 and succeeds its own checks, but then CPIs `retire_redeemed` at height 3 and fails closed — and SEAL would never have thawed, because the burn is not top-level. All failure directions are halts.
* **The 10% royalty.** `PluginAuthority::None` is variant 0 and `Address` is 3, consistent with the real-Core runs (R.3, 2.3). More importantly: no instruction in any of the four programs ever signs `AddCollectionPluginV1`, `UpdateCollectionPluginV1`, `RemoveCollectionPluginV1` or `UpdateCollectionV1` after `initialize`, so MINT's `["mint"]` PDA — the collection's update authority — can never add a collection plugin, change the royalty, or hand the update authority away. The collection's configuration is frozen by absence of code, which is the strongest form available.
* **The redemption cap is exactly a rolling window.** `kth = ring[(head − k) mod 64]` is the k-th most recent; allowing a redemption only when it is ≥ one window old means at most `k` landed in any window ending at `now`. `k = min(max(cap,1), 64)`, stricter above 3,047 live.

Now the faults.

---

# R1. CUSTODY

## R1-1 — MEDIUM. The redemption grief is not "retry and it works"; it is a sustainable denial of the product's central promise, and the only fix is a client that does not exist

**Construct.** `programs/cbob-vault-burn/src/lib.rs::burn_vault` — `require!(ctx.accounts.asset_signer.lamports() == 0)` and `require!(u64::from_le_bytes(amt) == 0)` on every declared reserve ATA. The sweep that satisfies them is built off-chain from balances read before the transaction is sent (`sweep()` in the suite, the redeem flow in SPEC's "REDEEMING A VAULT").

**What the attacker gains.** Any third party can send **one base unit** of any reserve token into a target vault's reserve ATA and the redemption attempt fails `VaultNotEmpty`. The lamport leg needs the rent-exempt minimum for a 0-data account, but the token leg costs one base unit plus the transaction fee. Sustained at ~2.5 tx/s that is ≈0.045 SOL/hour, ≈1 SOL/day, to deny one named holder access to their Bitcoin indefinitely. A `Burn`/`Transfer` of an exact amount cannot be made balance-agnostic, and `CloseAccount` requires amount 0, so no legacy client built from exact reads can win the race.

**Why this is "worse than stated", not a re-report.** SPEC's "Known limits" entry records the amount correctly (round 23 F1) and Gary accepted it ("that should never matter"). But two load-bearing sentences are then false:

* `HOLDER-GUIDE.md`: *"Someone could make **one attempt** to open your vault fail … **Nothing is lost; trying again works.**"* Against a persistent attacker, trying again never works. This is a promise the code does not keep.
* `SPEC.md` control table / `DESIGN-v6` §4: *"a member can always get their Bitcoin out."* Not while a 1 SOL/day griefer is running.

The accepted limit also does not say that the **mitigation does not exist**: a sweep-at-execution-time helper invoked through Core `ExecuteV1` closes it completely, needs no program change, and is not built (item 50, OPEN AND BLOCKING).

**Evidence if I am right.** On a validator: build a redemption against a funded vault, land a 1-unit `$GARY` transfer into `ata(vault_pda, GARY)` in the intervening slot, send → `VaultNotEmpty`. Repeat in a loop and show that no fixed-amount client ever lands. Then build the same redemption where the sweep legs are produced by a helper program invoked through `ExecuteV1` that reads `amount` at execution time, and show it lands with the griefer still running.

**Fix.** No program change. (a) Build the sweep-all helper and make the redeem page use it; (b) delete "trying again works" from the holder guide and replace it with the true statement ("a persistent attacker can delay your redemption; the redeem page's sweep is written so that it cannot be raced — until that page ships, an attempt may need retrying"); (c) correct SPEC's rent figure: measured fact 9 puts mainnet's 0-byte rent-exempt minimum at **650,240**, not the 890,880 SPEC quotes, so the lamport leg is cheaper on mainnet than documented.

## R1-2 — INFO. `MAX_POB_PROOF = 16` and the `pob_extra` split let the caller hand the crank accounts to Core

`claim_charter_vault` takes `pob_extra` up to 8 and splits `remaining_accounts` at that point. A caller may set `pob_extra` so that the SlotHashes sysvar and writable `VaultRecord` accounts are handed to Core's `BurnV1` as pass-throughs. They are passed non-signer; Core writes only to accounts it recognises, and the records are then simply not cranked. No exploit found, but it is a writable account of ours crossing into a program whose future versions we do not control (limit 40). Worth one line in SPEC and, if a program edit is ever made for another reason, worth refusing a pass-through whose key is a MINT-owned account or a sysvar.

---

# R2. THE COMMUNITY POOL

## R2-1 — The prompt's second invariant is FALSE and already known-false; confirmed

"No vault is ever paid for revenue that arrived before it joined" does not hold and the code does not try to make it hold. A vault joins at `acc` as it stands; revenue already sitting in the pool is credited at the **next** distribution, shared by everyone joined then including the new vault. SPEC's "What the rule does and does not promise" states this correctly. The true invariant is the weaker one: *a vault is never credited by a distribution that ran before it joined*, which I verified (`join` sets `debt = w·acc` with `acc` unchanged since eligibility, and `JoinWaitingFirst` guarantees nothing is credited between eligibility and join). Any future round that re-reports the strong form should be shown this.

## R2-2 — LOW. `distribute` requires the pool token account to exist even for the empty epoch tick

`distribute` calls `read_token(&pool_token, …)` **before** the `w == 0` branch, so it returns `VaultAccountMissing` if the pool ATA has not been created. `monthly_inline` by contrast degrades gracefully (`if pool.owner != &SPL_TOKEN_ID { return Ok(()) }`). Consequence: between `initialize` and road step 10, the launch epoch tick can only be produced by an in-line host, never by an explicit `distribute`. This is benign given road step 10 but it is an ordering dependency nobody has written down, and under immutability the ordering is permanent. Add it to item 52's text.

**Evidence.** Initialize MINT on a fresh validator, do not create the pool ATA, request one activation, wait the period, call `distribute(false)` → `VaultAccountMissing`; then send a `mint_vault` and observe `CBOB_EPOCH_TICK`.

## R2-3 — LOW (evidence gap). Nothing prevents the same `VaultRecord` appearing twice in one `claim`, or in both the crank list and the pairs list

`claim` does not de-duplicate `remaining_accounts`. I traced it and it is safe: `load_record` re-reads the account buffer each iteration, so a second occurrence sees the stored result of the first and computes `pay == 0`. The crank/pairs overlap is also safe, because a record with `level == 0` is skipped by the crank-write path and by the pair path. **But no arm proves either**, and `store_record` writing straight into the account while Anchor holds a deserialised `MintConfig` is exactly the shape where a lost update hides.

**Arms to add.** (i) A claim whose pairs list contains the same `(record, dest)` twice, where the vault is owed ≥1 sat: assert the transfer lands exactly once and `owed_scaled` falls by exactly one settlement. (ii) A claim whose crank list and pairs list both name the same record. (iii) An `activate` whose crank list names the record being activated (this one is the live lost-update case: `crank` writes entropy to the buffer and Anchor's `exit()` then rewrites the whole record from its own copy — today unreachable because `activate` requires `level != 0` and the crank skips revealed records, but it is unreachable by coincidence, not by a check).

---

# R2b. THE $CBOB BOOST — AUDIT OF ROUND 23's REPAIRS

I checked each round-23 repair at the site of its shape. **The two program repairs are correct**, and I could not break them:

* `BoostNotTheOwner`: the owner read at `d[1..33]` is guarded by `require_live_vault`, which already asserts `d[0] == KEY_ASSET_V1` and `d.len() >= 66`, so the slice is sound; the read happens at execution time, so a vault sold a slot earlier is boosted by its new owner. The one-slot occupation attack is closed.
* `BoostTermsMoved`: `price <= max_price && extra >= min_weight && epochs >= min_epochs` is evaluated **before** the SPL burn CPI, so a refused boost destroys nothing. `monthly_inline` runs first, so a due month is credited at the pre-boost weight and the boost's `end` is computed from the post-tick epoch — which is correct and in the buyer's favour.
* The error text `TooManyActions` now reads "five actions" (F18 closed). The `0x0` reason pins now name the failing program (F22 partly closed). GOV's `IX_SET_BOOST_TERMS` pin arm (BO.29) exists. The ring wrap and the skipped-slot entropy paths are now host unit tests. The wrapper attacks (WR.0–WR.4) exist.

Two gaps survive the repair round.

## R2b-1 — LOW (evidence gap). The post-transfer case of the owner-only repair is unexercised

`BO.6` proves a *stranger* is refused. Round 23's recommended arm set also asked for: after a transfer, **the new owner is ALLOW and the old owner is REFUSED**. Neither exists in the delivered suite. The owner-only check is the newest money-adjacent code in the tree and its whole point is that it reads live ownership, which is precisely the branch nobody runs.

**Arms.** Transfer a boosted-eligible vault from alice to bob; `boost_vault` signed by alice → `BoostNotTheOwner`, nothing burned (assert `$CBOB` supply unchanged); signed by bob → ALLOW at the live terms.

## R2b-2 — LOW (evidence gap). The Test Vault simulation contains no boost at all

`sim/test-vault.ts` creates a local classic mint for `CBOB` purely to satisfy `initialize`, and never calls `boost_vault`, `expire_boosts` or `SetBoostTerms`. So the boost — the only money mechanism added since the last red-team pass — has **zero** evidence against the real cloned mints, the production census (945/525/315/210/105) and the ruled ratios. Round 23 listed this as arm (j) and it was not built. Under a production census the denominator is 6,405, so a +12 boost on a weight-2 vault moves the denominator by 0.19% rather than the suite's double-digit fractions; nothing has exercised the boost arithmetic at that scale.

**Arms.** In `sim/`: a terms vote at the ruled ceilings (12 / 24 reduced only in epochs for runtime), one boost on the Test Vault, two distributions at the boosted weight, expiry, one distribution back at the level weight, and the `books()` reconciliation against every record.

## R2b-3 — Confirmed not broken (for the record)

A boost earns exactly N distributions: it is scheduled at `end = dist_epoch + n`, becomes due when `dist_epoch >= end`, and `BoostsExpireFirst`/`monthly_inline`'s `boosts_due` guard make it impossible for epoch N+1 to be reached before expiry. A boost bought in the same transaction as a distribution counts that distribution as its first (BO.21 measures it). `reweigh` moves the owed share into `carry` and restarts the debt, so nothing is gained or lost at any weight change, and `owed_scaled` is untouched. A retire in either boost state unschedules correctly (`boosts_due` or the ring slot, never both). I could not construct a double expiry, an early expiry, or an unexpirable boost: `expire_boosts` reads no token account, so the gate can always be cleared by anyone holding only the record pubkeys.

---

# R3. THE LEVEL DRAW

## R3-1 — MEDIUM. Accepted limit 25 is worse than stated: the FIFO head holds the whole queue, and attempts are unbounded

**Construct.** `reveal_level` requires `index == config.revealed_total`; `reschedule_reveal` is permissionless once `now > reveal_slot + 300` and sets `reveal_slot = now + 16`; `r.reschedules` is `u16` with `saturating_add`, so there is **no on-chain limit** on how many times one record may be re-rolled.

**What limit 25 says.** It frames the lapse as a census-fairness cost: "one re-roll per full window of total silence … a re-rolled Level V is a Level V someone else did not draw."

**What it also is.** The holder of the head record decides whether their own entropy is captured. While they withhold it, **every vault behind them is unrevealable** (`RevealOutOfOrder`), therefore unactivatable (`NotRevealed`), therefore earns nothing. Each re-roll attempt costs the head owner one transaction (`reschedule_reveal`) and stalls the entire queue for up to ~300 slots, and nothing bounds the number of attempts. The crank is the only counterforce, and SPEC itself records that the crank "confirms each capture serially" and lapses windows in a burst. During the charter window, when 240 claims land in days, the head is a continuously contested position.

**Evidence if I am right.** On a validator: mint vault A then B..E. Loop: wait for A's window to lapse without capturing, call `reschedule_reveal(A)`, assert `reveal_level(B)` is refused `RevealOutOfOrder` and `activate(B)` is refused `NotRevealed` throughout, and assert `A.reschedules` increments without bound. The economic lever is then measurable: N re-rolls cost N transactions and delay the whole census by ~N×300 slots.

**Fix.** No program change is safe during the freeze; the honest answer is documentation plus operations: (a) limit 25 must say that the head record's owner can stall every later vault's reveal, activation and payout, not only skew the census; (b) the alarm's `reveal_queue_stalled` must page on *consecutive* reschedules of the same `mint_index` (it currently pages on queue non-movement and on any reschedule), because repeated reschedules of one record are the attack signature; (c) the crank's reveal lane must capture the head record **first and in parallel**, not serially in queue order, so the head is the one position that is never missed.

## R3-2 — MEDIUM. Accepted limit 40 is worse than stated in one specific, unrecoverable way: there is no path that advances `revealed_total` without a successful Core `UpdatePluginV1` on a live asset

**Construct.** `reveal_level` has exactly two branches. If the asset is positively burned, the Core write is skipped and `revealed_total` advances. Otherwise the `invoke_signed(UpdatePluginV1)` must succeed. There is no third branch and no timeout.

**Consequence.** If that CPI ever becomes permanently impossible for the head record — a Metaplex change to `UpdatePluginV1`'s wire format or its lifecycle validation, a change to the Attributes plugin, or anything that makes the write fail for that one asset — then `revealed_total` can never advance past it. Every later vault stays at level 0 forever, can never `activate`, and can never receive a satoshi. The **only** escape is the head owner performing a bare Core burn of their own vault, which they may refuse or be unable to do. Our programs are immutable; there is no instruction anywhere that records a level without the Core write.

Limit 40 says "a Core upgrade … reaches every vault, and our immutable programs cannot adapt". It does not say that one such change converts the level queue into a permanent, protocol-wide payout halt with no bypass, nor that the same shape applies to `set_frozen` (a Core change to `UpdatePluginV1` for `PermanentFreezeExecute` seals every vault forever).

**Evidence if I am right.** Two cheap checks. (i) On the validator, make the head record's `UpdatePluginV1` fail by any means available (e.g. add an external plugin adapter with `update: [CAN_REJECT]` to that asset using the collection's update authority in a *control* collection with a keypair update authority, mirroring the R.5/R.6 control pattern) and show `reveal_level` fails and every later `reveal_level` fails `RevealOutOfOrder`. (ii) Read Core's `AddExternalPluginAdapterV1` authority resolution and confirm whether an asset **owner** can add an adapter to an asset whose update authority is a collection. Round 23's F16 verdict covers owner-managed *plugins* only (they abstain on `update_plugin`); it does not cover external plugin adapters, and the bundle contains no arm either way.

**Fix.** If (ii) shows the owner can do it, this is a CRITICAL and must be fixed before the lock. If it shows they cannot, the residual is a Core-upgrade exposure and the correct response is: (a) state it explicitly in limit 40 ("a Core change to `UpdatePluginV1` halts the level queue permanently; a change to the freeze plugin seals every vault permanently; neither has a bypass"); (b) add the arm from (i) as a permanent regression so that a Core re-pin that breaks it turns the suite red; (c) record, in the ship-gate order of operations, that the escape of last resort is the head owner bare-burning, and that it works only if the head owner cooperates.

## R3-3 — Confirmed not worse than stated (for the record)

Limit 26's residual grind is correctly characterised. I verified the stride arithmetic: `(slot/4 + 2)*4` always lands on the first slot of a group at least two groups after A's group, for every residue of `slot mod 4`. The minter cannot grind the asset address against the hashes (the address is committed at mint, the hashes do not exist yet). A reschedule's new target does not exist when the reschedule lands. The `blockhash_in_window` parse is defensive in all four directions the host tests exercise (count bound, buffer length, all-zero hash, wrong key).

---

# R4. GOVERNANCE

## R4-1 — HIGH. "Half of ALL live vaults" is really "half of the charter vaults that claimed": the key-change supermajority is measured against a snapshot taken at the earliest legal moment, and 2,100 later vaults are disenfranchised on it

**Construct.**
`programs/cbob-vault-gov/src/lib.rs::create_proposal` sets `p.quorum_supply = minted_total − burned_total − bare_retired` **at creation**, and `require!(now >= m.charter_closes_at)` makes the earliest legal creation time the instant the charter window closes.
`execute_proposal` computes `need_key = ceil(p.quorum_supply × 5000 / 10000)` and `require!(p.yes >= need_key)`.
`cast_vote` refuses any vault whose `mint_index >= p.index_snapshot`.

**The attack.** At `charter_closes_at`, live supply equals exactly the number of Proof of Burns that were claimed. Nothing has been minted in a paid round, because a paid round needs a vote that could not exist yet. A coalition holding ≥50% of the *claimed charter vaults* therefore holds ≥50% of `quorum_supply` for any proposal created in that instant — and the snapshot never moves, so every one of the up-to-2,100 vaults minted afterwards is `VaultTooNew` on it.

Measured concentration (DESIGN-v6 §10, read off mainnet 2026-10-03): 240 Proof of Burns, 42 holders, largest wallet 41 (17.1%), top three 91 (37.9%). So:

* the top three carry a key change if **≤182 of 240** claim (i.e. ≥24% unclaimed) — and DESIGN itself budgets for 15–20% unclaimed;
* the largest wallet carries one alone if ≤82 claim.

Because the same coalition also controls ordinary actions at 10.71% of that snapshot, it controls when rounds open, hence when the electorate grows.

**What that reaches.** Two separate proposals (they may not be bundled, and they do not need to be):
1. `Brakes { set_guardian: true, guardian: Some(attacker) }` → `arm_guardian`, applied by anyone after `notice_secs`.
2. `ArmSwapOperator { operator: attacker }` → `arm_swap_operator`, applied by anyone after `notice_secs`.

Both proposals are created early against the tiny snapshot. Execute (1), wait the notice, `apply_guardian` (permissionless), then execute (2) inside its own 7-day execution window and apply it after its notice. Once the attacker is guardian, `cancel_swap_operator` is theirs, so the incumbent's only defence — cancelling the pending operator — is gone before it is needed.

**Outcome.** The emergency brake is in the attacker's hands permanently (removing them needs half of the *now much larger* live supply, voted in a snapshot the attacker also influences), and royalty SOL flows to the attacker's key at the ruled rate of 10 SOL per 6 hours, forever, with no stop. The vault contents, the pool and the 85/15 are untouched; the loss is the brake plus all secondary-royalty SOL.

**Why this is a finding and not accepted limit 45 / DESIGN §10.** DESIGN §10 analyses only *ordinary* proposals and explicitly reassures: *"It cannot change a guardian or swap operator (half of ALL live vaults) or anything fixed at `initialize`."* `SPEC.md`'s GOV table and the `HOLDER-GUIDE` row ("only with yes from half of all vaults") say the same. That reassurance is false for any proposal created while `quorum_supply` is small, which is exactly when it is created. Accepted limit 47 describes a *stolen* guardian key, not a legitimately voted one against a stale electorate. Nothing in the carry list covers this.

**Evidence if I am right.** On a validator: initialize with the production census; claim N charter vaults; at `charter_closes_at + 1` create two proposals (`Brakes{set_guardian}` and `ArmSwapOperator`) and read `p.quorum_supply == N`; vote `ceil(N/2)` YES on each; mint 500 more vaults in a voted round; assert each new vault's `cast_vote` is refused `VaultTooNew` on both proposals; execute both; apply both after the notice; assert `config.guardian` and `config.swap_operator` are the attacker's and `cancel_swap_operator` by the old guardian is refused `NotTheGuardian`. The decisive on-chain datum is `ProposalCreated.quorum_supply` sitting far below `minted_total` at execute.

**Fix (one line, using data GOV already reads).** In `execute_proposal`, for the key-change test only, divide by the larger of the snapshot and the supply now:

```rust
let key_divisor = (p.quorum_supply as u128).max(m.minted_total as u128);
let need_key = key_divisor.checked_mul(KEY_CHANGE_YES_BPS)?.checked_add(9_999)? / 10_000;
```

`m.minted_total` is already in `MintView`. This makes the key-change bar track actual supply and never loosens. The cost, which must be stated and ruled: a key change voted while supply is small becomes unexecutable if a large round mints before execution — which is the correct reading of "half of all live vaults", and it cannot freeze governance (ordinary actions, restarts and `TightenSweep` are unaffected, and the guardian can still stop).

If the owner prefers no program change, then **both documents must be corrected** to say: *the guardian and the swap operator can be replaced by half of the electorate that existed when the proposal opened, which may be a small fraction of eventual supply*, and the ship gate must require that the first proposal of either kind is not created until supply has grown. Neither of those is enforceable on chain, which is why I recommend the code change.

## R4-2 — MEDIUM. Governance can mint out the entire remaining supply at the 21,000-sat floor, and SPEC says a hostile majority "is still bounded"

**Construct.** `set_round(opens_at, closes_at, price, cap)` accepts any `price >= MIN_ROUND_PRICE_SATS` and any `cap > 0` up to `u32::MAX`; `mint_vault` is bounded only by `cap`, `max_supply` and the census. GOV requires 21% quorum × 51% threshold = **10.71% YES of the snapshot**, and `SetRound` is not a key change.

**What that buys.** A ~10.71% coalition can open a round at 21,000 sats with `cap = 2,100` and acquire every remaining vault for ~2,100 × 21,000 sats ≈ 0.44 BTC, of which 85% returns to the pool and is then shared by weight — a share the coalition itself dominates once it activates the vaults it just bought. The dilution lands entirely on existing holders' future royalty share, and the 2,100 cap is the only ceiling.

SPEC: *"A hostile majority is still bounded by MINT: it cannot mint past `max_supply`, price a round below 21,000 sats, reopen the charter window, touch the split, either destination or the royalty, or reach a vault."* True as written, and misleading: it omits that a hostile majority *can* mint the entire remaining supply at the floor in one proposal, which is the economically largest thing a vote can do.

**Evidence.** A single ratified `SetRound(price = 21_000, cap = 2_100, window = 1 year)` executed at 10.71% YES, followed by `mint_vault` to the census ceiling, with `minted_total` reaching `cap_total`.

**Fix.** Not a code change (the floor is ruled and permanent). SPEC's "hostile majority" paragraph and DESIGN §10's concentration note must state the real bound: *a coalition at 10.71% of a snapshot can sell the remaining supply to itself at the floor price*. Operationally, round caps should be proposed small and the alarm should page on any `RoundSet` whose `cap` exceeds a configured sanity value — detection only, which is all that is available post-lock.

## R4-3 — LOW. `Some(Pubkey::default())` silently means "retire the brake", and GOV does not refuse it at creation

`arm_guardian` does `c.pending_guardian = guardian.unwrap_or_default()` and `c.pending_guardian_set = true`, so `Brakes { set_guardian: true, guardian: Some(11111111111111111111111111111111) }` is indistinguishable in effect from `guardian: None` — the brake is retired. `create_proposal` refuses the default key for `ArmSwapOperator` (`EmptyAction`) but applies no such check to `Brakes`. A proposal whose on-chain text reads "install guardian 1111…" is a brake retirement, and the `GuardianArmed` event reports `guardian: Some(default)`, so even the event does not read as a retirement.

**Evidence.** Create and execute `Brakes { set_guardian: true, guardian: Some(Pubkey::default()) }`; assert `pending_guardian == default`, `pending_guardian_set == true`, and after `apply_guardian` that `require_guardian` refuses everyone (`NotTheGuardian`).

**Fix.** One line in GOV's `create_proposal`: `if let Some(g) = guardian { require_keys_neq!(*g, Pubkey::default(), GovError::EmptyAction) }`, so that retirement is expressed only as `None`. If no program edit is made, the voting UI must render `Some(default)` as "RETIRE THE BRAKE".

## R4-4 — Confirmed not broken (for the record)

I could not find a way to freeze governance beyond limit 45. Proposal PDAs are pre-fundable but Anchor's `init` handles that (7.12d), and assigning one out from under GOV requires GOV's own signature. `last_round_id`/`last_guardian_id`/`last_arm_id`/`last_boost_id` are monotone in proposal id, which is monotone, so no mark can block a later proposal. Lowering `quorum_supply` by burning your own vaults makes the bar *harder* (`A − k ≥ 0.5(L − k)` requires `A ≥ 0.5L + 0.5k`). `TightenSweep` is genuinely order-independent (`max`/`min` against live values), so no execution order can loosen it.

---

# R5. THE CHARTER CLAIM

## R5-1 — LOW. `charter_opens_at` is not required to be in the future, and nothing ties it to the lock deadline

`initialize` checks `charter_closes_at > charter_opens_at`, the span ≤ 90 days, and `charter_closes_at > now`. It does **not** check `charter_opens_at >= now`. A wrong value (0, or a past date) opens the free claim path immediately and permanently, before the operator has done anything else, and `claim_charter_vault` is by ruling ungated by the guardian's stop (limit 48). The only guard is `scripts/check-launch-params.mjs`, which today has `charter_opens_at: null / OPEN`.

Related and in the same breath: `launch/mainnet-init.json`'s `lock_deadline` is also OPEN, and the alarm's `program_not_locked` uses "the earlier of `lock_deadline` and MINT's `charter_opens_at`". So the one value that makes the charter window safe is unset, and the on-chain program does not require it to be sane.

**Evidence.** `initialize(..., charter_opens_at = 0, charter_closes_at = now + 1)` is accepted and a claim lands in the same slot.

**Fix.** The checker already exists; make it refuse `charter_opens_at <= now + margin` and refuse any launch where `lock_deadline >= charter_opens_at`. That is an off-chain change and does not touch the freeze. I would also prefer a one-line on-chain `require!(charter_opens_at > Clock::get()?.unix_timestamp)` if any program edit happens for another reason.

## R5-2 — Confirmed not broken (for the record)

Merkle domain separation (`0x00`/`0x01`) and sorted pairs are correct; `merkle_root_from` cannot reinterpret a leaf as a node. `MAX_POB_PROOF = 16` is generous for a 240-leaf tree but the root is the binding, so extra depth buys nothing. The PoB is checked as a live `AssetV1` whose update-authority discriminant is `Collection` and whose collection equals `cfg.pob_collection`, owned by the signer, and burned by CPI with the owner as authority in the same instruction — so a vault cannot exist without its PoB being destroyed. A spent leaf cannot be replayed because the address cannot be re-minted (measured fact 7). Pass-throughs are never signers. What the hot collection authority can still do is covered by limit 46; I found nothing it can do that limit 46 does not already name.

---

# R6. THE ONE-TIME CONFIGURATION AND THE TRUSTED HOP

## R6-1 — LOW. SEAL's `initialize` accepts one or two reserve mints, and does not verify that a "mint" is a mint

`programs/cbob-vaults/src/lib.rs::initialize` requires `1 <= reserve_mints.len() <= 3` and, per mint, only that the declared account's **owner** is `TokenkegQ…`. It does not require exactly three, does not reject duplicates, and does not check `data.len() == 82` or `is_initialized`.

Consequences, all permanent:
* A launch with two reserve mints silently removes the third asset's on-chain emptiness guarantee. A vault holding it would still be redeemable (the owner can declare and sweep it), but nothing on chain requires the declaration, so an undeclared balance is destroyed instead of refused. `DESIGN-v6` §5 asserts "all three slots filled" and SEAL's own comment says "Production MUST pass all three"; the enforcement is entirely in `scripts/check-launch-params.mjs`.
* A typo'd address that happens to be owned by SPL Token (a token account, for instance) is accepted and occupies one of the three slots forever. `MAX_RESERVE_MINTS` is a measured packet ceiling, so a wasted slot is a real cost.
* Duplicates are accepted and waste a slot identically.

**Evidence.** `initialize(collection, [cbBTC])` with only cbBTC's mint account declared → ALLOW. `initialize(collection, [cbBTC, cbBTC, some_token_account])` → ALLOW.

**Fix.** Off-chain only, and it exists: make `check-launch-params.mjs` refuse anything but the three ruled mints, in order, distinct, each read back off mainnet as an initialized 82-byte classic mint. Add both-direction selftest arms (the floor is `LAUNCH_FLOOR=33`; moving it is a one-line change in the same commit).

## R6-2 — Confirmed. The trusted hop's worst case, bounded precisely

With the ruled values (`max_sweep` 10 SOL, `cooldown` 21,600 s, `sol_reserve` 0.05 SOL, floor 1 SOL, ceiling 24 h, reserve ceiling 0.1 SOL):

* **Per window:** 10 SOL. **Per day:** 40 SOL. **Ceiling on what a hostile vote can do to the hop:** slow it to 1 SOL per 24 h and hold back 0.1 SOL — verified against `tighten_sweep`'s three bounds and GOV's creation-time mirrors.
* **Operator-key theft:** 10 SOL × the number of 6-hour windows until `emergency_stop_sweep` lands, never more than the revenue PDA holds above 0.05 SOL. The guardian's stop is instant and one-way. This matches limit 10.
* **`MIN_SWEEP_COOLDOWN_SECS = 1`** is not a rate limit; it only blocks several sweeps sharing one transaction (6.17). The real rate limit is the deployed value. Stated correctly in SPEC.
* **Jupiter** remains inside the trusted hop (limit 10, round 23 D3) and is the larger half of this risk, not the on-chain cap.

## R6-3 — Confirmed. The 10% royalty cannot be changed by anyone

Beyond the plugin authority being `None`: I grepped all four programs for every Core instruction they can issue. The complete set is `CreateV2`, `AddCollectionPluginV1` (once, in `initialize`), `UpdatePluginV1` (SEAL's freeze toggle, MINT's attributes write) and `BurnV1`. There is no `UpdateCollectionV1`, no `UpdateCollectionPluginV1`, no `RemoveCollectionPluginV1`, no `ApproveCollectionPluginAuthorityV1`. Therefore MINT's `["mint"]` PDA — the only key that is the collection's update authority — has no reachable instruction that touches a collection plugin or hands the update authority away. The royalty is immutable by absence of code as well as by Core's refusal. R.5/R.6/R.6a measure Core's half on a control collection in both directions, which is the right shape.

## R6-4 — Confirmed. The redemption cap is exactly the rolling window claimed

Recomputed in R-note above. One documentation precision worth adding: the cap is evaluated against `live` **at the moment of each redemption**, so the guarantee is "no window of length W contains more redemptions than the cap in force when the last of them landed" — which is what SPEC says, and which is *weaker* than "no window ever exceeded the cap at its own start" when live supply is rising. With a fixed 2,100 supply that only ever falls, this is a non-issue; say so.

---

# R7. CROSS-PROGRAM RAW READS — VERIFIED, NO FINDING

Every offset and every space constant recomputed from the struct definitions; all correct. Values given at the top of this report so they can be checked against `bank/layout.mjs` and the suite's constants without re-deriving them. Length guards: GOV needs ≥714 of 1261; BURN needs ≥462 of 1261; MINT needs ≥73 of SEAL's 398; BURN needs ≥(41+4+96) of 398. All satisfied with margin, and `CONFIG_PADDING = 256` means an appended field cannot break a reader before it breaks a writer.

One INFO: SEAL's account type is named `Config`, so its Anchor discriminator is `sha256("account:Config")[..8]` — a name generic enough that another program's `Config` would collide. It is harmless (owner and address are both pinned) and it is the only one of the five discriminators without a direct `acctDisc()` arm in the suite; it is instead proven functionally by every mint succeeding. Consider adding `rec('3.1y', ..., [...acctDisc('Config')].join(','), pinned(MINT_SRC,'SEAL_CONFIG_DISC'))` for symmetry with 3.1n/3.1o/3.1p.

---

# R8. THE SUITE AND THE SIMULATION AS EVIDENCE

## R8-1 — MEDIUM. `scripts/run-tests.sh` as delivered cannot pass: `HOST_FLOOR=5` against four host tests

**Construct.** `scripts/run-tests.sh`:
```
HOST_FLOOR=5
sub_selftest host-unit-tests cargo test -p cbob-vault-mint --features localnet --lib; HOST_OUT=$SUB_OUT
floor "host unit tests" "$HOST_OUT" '[0-9]+ passed' "$HOST_FLOOR"
```
`floor()` greps cargo's `"N passed"` and then `die`s unless `N -eq HOST_FLOOR`.

`programs/cbob-vault-mint/src/lib.rs::host_tests` contains exactly **four** `#[test]` functions: `the_lookup_takes_the_smallest_produced_slot_in_the_window`, `a_full_buffer_reads_and_malformed_ones_are_refused`, `capture_skips_at_a_b_and_c_and_matches_the_model`, `the_boost_ring_wraps_exactly_against_a_model`. The crate has one target (`src/lib.rs`) and `--lib` excludes doc tests.

**Why it matters.** This is the gate the project's own freeze discipline rests on ("the floor must EQUAL the count"). As delivered, step [6] dies with `host unit tests: 4 assertions, floor is 5`, which means **the premise handed to this round — "the four programs pass a 748-assertion suite" — is not reproducible from this bundle.** Either the floor is one too high (the certifying run was never made against this tree) or a fifth host test exists and was not delivered (a coverage gap in exactly the place round 23 asked for new evidence: the skipped-slot entropy paths and the boost ring wrap).

Note also that `bank/selftest.mjs`'s stated-count cross-check covers the five floors named in SPEC's "Running the tests" block; `HOST_FLOOR` and `SIM_FLOOR` are not among them, which is how this mismatch survives un-noticed.

**Evidence, one command.** `cd /opt/cbob-vaults && cargo test -p cbob-vault-mint --features localnet --lib 2>&1 | tail -3` → `test result: ok. 4 passed; …`. Then `./scripts/run-tests.sh` → `FATAL: host unit tests: 4 assertions, floor is 5`.

**Fix.** Determine which it is, then: set `HOST_FLOOR=4` *or* deliver the missing test. Either way, add `HOST_FLOOR` and `SIM_FLOOR` to `bank/selftest.mjs`'s stated-count gate and to SPEC's "Running the tests" block, so the two floors that are currently outside the self-check come inside it. This is the same defect class the comment inside `floor()` describes at length — a floor outside the mechanism meant to police floors.

## R8-2 — LOW. Arms that can pass while asserting nothing

* **`P.11a`** — the only arm that reads the 1 : 1.5 : 2 : 2.5 : 3 ratio off real payouts. When `picks` is empty both `want` and `got` are `''` and the arm passes vacuously; the arm's own note says so. The ratio is otherwise only pinned by P.11b (a source grep) and `bank/accrual.mjs`. **Fix:** make the arm fail when `picks.length < 5` (it is a precondition, not an excuse), or assert at least one pair of adjacent levels.
* **`10.2`** — "a mint padded to the BYTE ceiling still fits the COMPUTE ceiling" compares a *landed* transaction's bytes to 1232 and its CU to 1.4 M; a landed transaction satisfies both by construction. Its only failure mode is a crash in `mintCU`. Keep it, but say in the arm text that it is a measurement, not a refusal.
* **`X.7`** — honest and self-labelled, but with the census exhausted it asserts only that the planner plans nothing against an empty queue. The ordering property it is named for lives entirely in `bank/selftest.mjs`.
* **`RL.7`** — bounds `worst` by the cap derived from `minted_total` (the largest live supply there has ever been), which is looser than each redemption's own cap. Disclosed in the arm text; round 23 F22 asked for the per-redemption replay and it was not built. **Fix:** replay each ring entry against the live supply as of that entry.

## R8-3 — LOW. Claims in this round's brief that no arm exercises

* **Two redemptions succeeding in one transaction.** `4.9` and `4.10a` are both pinned `RateLimited`, and `S10.1` lands two in one *window*, not one transaction. So the interleaved pairing shape (`open A, open B, burn B, burn A`) is never shown **succeeding**; it is only shown reaching the rate limiter. Round 23 F24 correctly observed that reaching `RateLimited` proves both pairings passed, which is good evidence — but at a cap ≥ 2 the success case is still unproven, and the success case is the one SEAL's comment explicitly licenses ("Two redemptions may share a transaction"). **Arm:** at a live supply giving cap ≥ 2 (the sim reaches this), land `open A, sweep A, burn A, open B, sweep B, burn B` in one transaction and assert both assets burned and `burned_total += 2`.
* **The monotone-tighten property under out-of-order execution.** No arm executes an *older* `TightenSweep` after a newer one and shows the live values unchanged. The property is what makes `TightenSweep` safe to leave unordered, and accepted limit 34 rests on it. **Arm:** create T1 (cap 1 SOL) and T2 (cap 0.9 SOL), execute T2 then T1, assert cap stays 0.9 SOL.
* **`expire_boosts` as the escape when `claim` cannot run.** The brief asks about "a vault whose token account is gone". I traced that state to be unreachable (activation requires the ATA to exist, and a sealed vault's ATA cannot be closed because `CloseAccount` needs an `ExecuteV1` that the freeze forbids). Worth recording as reasoning rather than leaving it as an unanswered claim.
* **The post-transfer boost owner** and **a boost in the simulation** — R2b-1 and R2b-2 above.

## R8-4 — INFO. `3.7`'s reason pin is shared with an unrelated refusal

`because('3.7','custom program error: 0x9')` is the arm that proves "vaults are born sealed" (a bare owner `ExecuteV1` with no open). The same suite annotates `0x9` as `InvalidAuthority` for `R.6`. If Core maps a lifecycle rejection and an authority failure to the same code, then 3.7 cannot distinguish "the freeze plugin rejected" from "the Execute was malformed". The seal is nonetheless established, by `2.3a` (the plugin decodes `frozen: true`) plus `4.2` (the same Execute shape succeeds after a legitimate open). Consider adding the decoded-state read to 3.7's note so a later reader does not mistake the pin for a semantic proof. The sim's `S6.2` is weaker still (it pins only "Core failed").

## R8-5 — INFO. The suite's absolute paths defeat part of item 53's guarantee

`tests/3prog.test.ts` reads `/opt/cbob-vaults/programs/...` and `/opt/cbob-vaults/.cache/cpi-wrapper/cbob_test_cpi_wrapper-keypair.json`. Item 53's rehearsal patch substitutes the repo-root path, but `CBOB_CACHE` is independently overridable in `run-tests.sh` (`CACHE="${CBOB_CACHE:-/opt/cbob-vaults/.cache}"`). A rehearsal run with a non-default `CBOB_CACHE` would build and deploy the wrapper to one path and have the suite read the keypair from another, failing `WR.0`. Either derive the wrapper path from `CBOB_CACHE` through an env var the suite reads, or make `run-tests.sh` refuse a non-default `CBOB_CACHE` the way it refuses `CBOB_TEST_FILE`.

---

# THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

### 1. Is any limit WORSE than stated?

| limit | worse how |
|---|---|
| **25** (re-roll on a lapse) | **R3-1.** Framed as a census-fairness cost. It is also an availability lever: the FIFO head's owner stalls every later vault's reveal, activation and payout for each attempt, and `reschedules` is unbounded. |
| **40** (Core is upgradeable by Metaplex) | **R3-2.** Stated as "our immutable programs cannot adapt". Not stated: `reveal_level` has **no** path that advances `revealed_total` without a successful Core `UpdatePluginV1`, so one Core change converts the level queue into a permanent protocol-wide payout halt whose only escape is the head owner bare-burning their own vault. The same shape applies to `set_frozen` and redemption. |
| **F1 / "Known limits" redemption race** | **R1-1.** The accepted text has the mechanism right but (a) HOLDER-GUIDE's "trying again works" is false against a persistent griefer at ~1 SOL/day, (b) the stated mitigation (a client that sweeps at execution time) does not exist, and (c) the lamport figure 890,880 is the test validator's; mainnet is 650,240 (measured fact 9), so the lamport leg is 27% cheaper than documented. |
| **38 / 52** | **R2-2, R5-1, R6-1.** `distribute` (unlike the in-line hosts) hard-fails without the pool ATA; `charter_opens_at` is not required to be in the future; SEAL accepts fewer than three reserve mints, duplicates, and non-mints. Each is permanent, and each is guarded only by an off-chain script whose relevant values are still `OPEN`. |

### 2. Is anything listed as a limit not actually a limit, or already closed?

* **Limit 27** ("a claim between a bare burn and its retirement pays into a dead account") understates the *join* half in one direction and overstates the *claim* half in another: a bare-burned vault's cbBTC ATA can never be closed (the signer PDA can never sign again), so the deferred-claim case is a permanent, not transient, misdirection of that vault's own share — but only of its own share, as stated. No change needed; the wording "where nothing can ever sign for it" is already right.
* **Limit 35** (the 10% turnout rule never binds at the ruled numbers) is correct arithmetic (21% × 51% = 10.71% > 10%) and is **not** closed — but it is now *doubly* non-binding for key changes, which require 50%. Keep as is.
* **Round 23's F18** (`TooManyActions` said "four") is **closed** in this tree. **F2** (boosts are N distributions, runnable out for ~N×100 $GARY) is now documented in SPEC 51 *and* in `launch/mainnet-init.json`'s `max_boost_epochs` source text — I regard it as discharged into disclosure, not outstanding. **F3/F10/F12/F13/F14/F17/F19/F20/F21** doc corrections are present in the delivered documents. **F8/F9/F11/F22** have the arms or repairs. I found no round-23 repair that fixes one site and misses its twin.

### 3. Is any DISCHARGED item not actually discharged?

* **12 / 17 (compute units)** is already qualified by item 54 ("not in general"), and that qualification is correct. One residue: the discharge text still says "a transaction that fits cannot run out of compute ON THE PADDED-MINT PATH", which is true, but `claim` has **no bound on the number of pairs** other than the packet. With a v0 transaction and a lookup table a claim can carry far more vaults than the legacy measurement, at ~4,000 CU each plus 115,000 per crank capture. Nobody but the caller is harmed, but the discharge should name `claim` as a second path where the byte wall is not the binding constraint.
* **33 (the seven-day notice branch)** is genuinely discharged (3c.K5, 3c.G2, 6.20g, 3c.G1 exercise both directions at `notice_secs = 60`).
* **19, 14, 30, 31** and the Bank-era family: discharged, confirmed by reading — the instructions and files they named do not exist, and 0.4–0.4i prove the discriminators are absent rather than gated.

### 4. Is anything in OPEN AND BLOCKING being quietly treated as accepted?

* **Item 50** is the one. It is correctly classified OPEN AND BLOCKING, but three separate properties now *depend* on it and the dependency is not written into the item: (a) R1-1's grief has no mitigation without the page's execution-time sweep; (b) limits 9 and 44 have no preventive control; (c) item 42's prior-transaction requirement and item 54's compute-budget rule are client obligations nobody enforces. Item 50 should list these three as the reasons it blocks, so that it cannot be demoted by someone who reads it as "a nice-to-have UI".
* **Item 38** is drifting toward accepted in one spot: `charter_opens_at` and `lock_deadline` are both still `null / OPEN`, and the on-chain programs accept any value for the first. R5-1.
* **Item 22** (nothing has ever run a distribution against a live chain) is correctly blocking and nothing in this tree weakens it. I will add that R8-1 means the *local* evidence base is also not currently reproducible, which makes item 22 the second, not the first, gap.

---

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Concretely, before the upgrade authority is removed. Each of these is something an AI reading a bundle structurally cannot do, and each is cheap.

1. **Make the certifying run reproducible, and prove it.** R8-1 shows the delivered `run-tests.sh` cannot pass against the delivered `lib.rs`. Before anything else: run `./scripts/run-tests.sh` end to end on this exact tree, capture the full output to a file, record its sha256 and the git commit in `audits/`, and make the floor set self-consistent (including `HOST_FLOOR` and `SIM_FLOOR` inside `bank/selftest.mjs`'s stated-count gate). An audit round that is handed a claim it cannot verify is an audit round spent on the wrong things. This is the single highest-value hour available.

2. **Settle the one Core question by reading Core, not by reasoning.** R3-2 hinges on whether an asset **owner** can add an external plugin adapter (or anything else) that Core consults on `UpdatePluginV1`. Read `add_external_plugin_adapter.rs`'s authority resolution and `update_plugin.rs`'s validation path in the *pinned binary's* source tag — not HEAD — and write the finding into `audits/` with the file and line. If the answer is yes, this is a CRITICAL and the lock must not happen. If no, add the control arm anyway so a Core re-pin that changes the answer turns the suite red. No AI can do this for you from a bundle that does not contain Core.

3. **Get a ruling on R4-1, in writing, with the numbers in front of the owner.** Present exactly this: *at `charter_closes_at + 1`, `quorum_supply` equals the number of Proof of Burns claimed; the top three PoB wallets hold 91 of 240; if 182 or fewer claim, those three alone can install a guardian and a swap operator, and the 2,100 vaults minted later cannot vote on either proposal.* Then choose: the one-line `max(snapshot, minted_total)` divisor for key changes, or a correction to both documents plus an operational rule that no key-change proposal is created before supply has grown. This is a product decision disguised as a code decision and only the owner can make it — but it must be made before the lock, because afterwards neither option is available.

4. **Run the dress rehearsal (item 22) with three adversaries present, not just happy traffic.** On the throwaway ids, with the crank live: (a) a griefer sending 1-unit reserve transfers into a vault under redemption, so R1-1's cost is measured rather than estimated; (b) a withholding minter at the FIFO head, re-rolling against the live crank, so R3-1's stall length and the crank's win rate are measured; (c) a 1-sat-plus-100-$GARY distribution spammer, so the boost burn-through and the `last_distribute_at` interaction are measured against the real reveal lane. An AI can predict all three; only a run produces the numbers that go into the holder guide.

5. **Build the redeem page before the freeze, not after.** It is outside `programs/`, `bank/` and `scripts/`, so it does not reset the freeze counter — but it must exist before the lock because it is the only control for limits 9 and 44 and the only answer to R1-1. Its minimum: `judgeRedemptionCoverage` run and shown before the signature; the destination ATAs created in a prior transaction (item 42); `claim` before the sweep; the join-then-distribute sequence offered; a compute-unit limit on any crank-carrying transaction and no crank when `pob_extra > 0` (items 54 and 37); and the sweep built through an execution-time helper rather than from pre-read amounts.

6. **Freeze the documents with the code, and gate them mechanically.** Three of this round's findings are document findings against code that is correct (R1-1's "trying again works", R4-1's "half of all live vaults", R4-2's "a hostile majority is still bounded"). Those sentences are what buyers read. Extend `bank/selftest.mjs`'s existing control-table parser to a small set of **claim assertions**: each buyer-facing sentence in `HOLDER-GUIDE.md` that names a quantity or a guarantee gets a machine-checkable companion (a program constant, an error variant, or a suite arm id), and the build fails if a sentence has no companion. That is the only way a document claim survives an immutable launch without a human re-reading it.

7. **Record what the last reader could not check.** In `audits/`, keep a short list of the things in this bundle that rest on reasoning rather than a run: the Core authority resolution for external plugin adapters (R3-2), the per-redemption rate-limit replay (R8-2), two redemptions succeeding in one transaction (R8-3), the monotone tighten under reordering (R8-3), the boost against the real mints (R2b-2), and the post-transfer boost owner (R2b-1). Six arms. They are cheap, they all exist in the shape of arms already in the suite, and after the lock none of them can be converted into a fix — only into a disclosure.