# AUDIT REPORT — v6, five programs, round 26

**Scope of work.** I read all five programs whole, the suite, the simulation, both build/run scripts, the Merkle module, the rehearsal script, the launch values, and every document. I recomputed every cross-program offset and account space from the struct definitions by hand, re-derived the pool and boost accounting against an independent model of the invariants, walked the redemption pairing both directions, and checked every round-25 repair against the current code rather than against its title. I did not re-run the suite; where a claim rests on a measured run I say what the run must have shown and whether the arm as written can actually fail.

**Verdict up front: no CRITICAL, HIGH or MEDIUM program defect found.** Round 25's repairs are real and hold. Two LOW evidence findings and a small number of INFO items follow, then the four accepted-limit questions, then the section you asked for at the end.

---

## R0 — ROUND 25'S REPAIRS, VERIFIED

**N1 (boost schedule through the program's own functions).** Holds. I diffed the host test's hand-copied purchase block against `boost_vault`'s inline scheduling: the three lines (`end = dist_epoch + epochs`; `boost_expiring[end % 64] += 1`; `boosts_active += 1`; `boost_weight_total += extra`; then `reweigh`, then `boost_end_epoch = end`) are verbatim except `cbob_burned_total`, which is a counter with no scheduling role. Everything else goes through `join`, `reweigh`, `retire` (both `unschedule_boost` branches), `expire_boost`, `credit` and `tick`. The model is rebuilt from the records alone and checks every ring slot per epoch over 260 epochs (four wraps), with coverage floors (`buys > 500`, `early_wrapped63 > 3`, etc.) so it cannot pass vacuously. The on-chain arm BO.38 retires a wrapped, not-yet-due boost by bare burn and asserts its ring slot falls by exactly one. One thing I verified independently because the whole ring depends on it: `MAX_BOOST_EPOCHS_BOUND = 63 = BOOST_RING - 1` is exactly what prevents a new boost from ever landing in the ring slot of a just-due boost (a due boost's slot was zeroed by `advance_epoch`; a new boost at `dist_epoch + 64` would collide, and 64 is refused at `initialize`). The bound is load-bearing and correctly placed.

**N2.** Each arm checked against the original finding:
- *Live-supply stamps (C7):* `sendNow` stamps every landed redemption keyed by its ordinal; RL.7 replays each against its own cap. **See LOW-1 below — the stamp is an upper bound, not the exact value.**
- *Exactly five picks (C8):* P.11a's expected string is now the fixed `I:1x II:1x.5 III:2x IV:2x.5 V:3x`; a shortfall fails. Real. **See INFO-2 on spurious failure.**
- *Narrow payout bound:* S7.4 requires `paid === avail || paid === avail - 1n`. Real.
- *Refusal reasons:* S7.2! predicts `NoActiveVaults` vs `JoinWaitingFirst` from the epoch read before the attempt and demands the other be absent; 3.7 pins 0x9 with the decoded FROZEN state and owner check. Real.
- *Crank overlap (C9):* K.7 (level-0 record in both lists; the crank's write survives, the pair path leaves it) and BO.36 (drawn active record in both; paid once, owed falls once, entropy untouched). Both can fail.
- *Frozen expiry (C9):* BO.37 — the claim expires the due boost, defers the frozen payment, keeps the whole boosted share owed, logs the exact deferred line, pays exactly once after thaw. I traced `expire_boost` → `reweigh(c, r, 0)` → `carry = owed`, `debt = base*acc`, so `owed_of` after expiry equals the pre-expiry owed; the accounting is exact.
- *Two redemptions in one v0 at cap two (C9/W5):* S9b, with the LUT, both burned, `burned_total + 2`, both sats received. Real.
- *Overtaken TightenSweep:* 8.14b — older, looser tighten executed after the newer lands and changes nothing (max/min). Real.
- *Books outside BO:* BK.IN/BK.3c/BK.P compare the exact label lists; a failed or deleted `ck` shows as a missing label. Real.
- *Ship-gate pins:* R24.1/1a (owner adding Oracle → Core 0x1a; owner adding AgentIdentity → missing-registry-signature), R24.1b/1c (controls with a keypair update authority: Oracle lands, AgentIdentity refused even to the UA), R24.2 (`Some(default)` ≡ `None`, same state, same log line), R24.5 (activate carrying its own record → `NotRevealed`, the crank's capture reverts with it), BO.35/35a (`[distribute, boost]` ends at e+1+N). All present and pinned to program-specific error text via `attP`.

**N3 (non-owner Execute on a genuinely thawed vault).** Holds. SR.5 (stranger), SR.5a (owner-added transfer delegate; the add is asserted ALLOW, the Execute REJECT), SR.5c/5d (control asset: collection update authority refused 0x1a, owner lands and empties), SR.5b (CBOB collection UA is MINT's off-curve PDA, `isOnCurve` false), SR.5e (balances, owner, seal and delegate-removal preserved after every attempt). The `because` pins name Core's program id and 0x1a, and `sealFailed` proves the refusal was not SEAL's. These arms really reach Core's authority check and really would sweep the vault if Core approved.

**N4 (helper refusal branches).** SR.6–SR.12a, SR.13 (zero pairs, lamports-only, lands), SR.14 (frozen source reverts), each pinned to the helper's own program id and error text, each inside a genuine owner open/burn so an earlier gate cannot be the real reason. SR.4a is now exact lamport conservation (stranger's 1,000,000 + prior wallet balance + closed-account rent + asset rent delta − fee) plus the helper's own log line naming the wallet balance it moved. I checked the duplicate-source arm's mechanics: the first pair closes the account, classic SPL `CloseAccount` zeroes data and assigns the System program, so the second pair's `read_token` fails `IllegalOwner` — the pin (`Provided owner is not allowed`) is the right reason, not a coincidence.

**N5.** S8.0 asserts `B ≤ 1232 − 52 − 96` (1,061 measured, so 23 bytes of slack under the widest page shape); S8.1a records `computeUnitsConsumed` (168,343 CU against an 800,000 default for four instructions). Real.

**N6.** `build-mainnet.sh` now compares `dist/cbob_vault_sweep.so` against both its own `$CACHE/ln` rebuild and `target/deploy/cbob_vault_sweep.so` (the file `run-tests.sh` and the sim deploy), and logs all five `target/deploy` sha256s. The chain shipped == tested is closed. Caveat belongs in the final section: it is closed on one box.

**D1–D9 (documentation).** I read every repaired sentence against the code:
- "half of all vaults **that exist when the vote opens**; vaults sold during the vote cannot vote on it" — matches GOV (`quorum_supply` snapshot at creation, `VaultTooNew`).
- The first-payout paragraph — matches `last_distribute_at = max(now, charter_closes_at)`, the `NoActiveVaults` burn-path refusal while `w == 0`, and the free path's month: nothing credits before close + 30d, first free crediting payout at close + 60d.
- The re-draw paragraph (minter can decline; only works in total silence; anyone can record; the job tries every minute) — matches limit 25 and the code.
- "Everything in it (cbBTC, $GARY and $GIRAFFISH and SOL) comes out … Anything else in it is destroyed" — matches the helper's scope and limit 44.
- Honest-list additions (immutability, all three Metaplex consequences, the swap key's 10 SOL / 6 h bound, the $CBOB release wallet, the charter-window key, the unsplit-revenue edge, the dust-while-opening protection) — each matches its limit and the code. "Up to 1.5% below Pyth" matches `SWAP_TOLERANCE_BPS = 150`.
- Item 50's client obligations (prior-transaction account creation, no claim while the pool is frozen, sweep through the helper, the 1,061/1,209 packet numbers, the lamports-only-destination rule, stray-classic rescue, close-what-you-empty, compute-limit rule, `judgeRedemptionCoverage`, deploy-and-lock the helper) — all present in SPEC and consistent with the code.

**"No deployed program logic was intended to change."** The MINT addition is `#[cfg(test)]` host tests (excluded from the BPF build); GOV's changes are comments. VALIDATION.md records a byte-for-byte comparison of a fresh mainnet-feature build against the certified `dist/*.so` (all five identical), and `build-mainnet.sh`'s behavioural gate re-proves the key question on both builds. I cannot re-run that comparison; the claim is structurally sound (comments and `cfg(test)` do not enter the cdylib).

---

## R1 — CUSTODY PAIRING

I attacked the pairing every way the prompt names and found it holds:

- **CPI wrappers:** SEAL and BURN both read only top-level instructions via `load_instruction_at_checked`; a wrapped open is invisible to BURN, a wrapped burn is invisible to SEAL, and `retire_redeemed`'s stack-height check (`== TRANSACTION_LEVEL_STACK_HEIGHT + 1`) refuses anything one level down. WR.1–WR.4 exercise all three with a real forwarder.
- **Two vaults, one transaction:** open A / sweep A / burn A / open B / sweep B / burn B lands (S9b, at a measured cap of two); cross-binding (open A, burn B) fails because both halves bind asset AND owner at fixed positions (4.10, 3.9, 3.10).
- **Mid-transaction transfer:** open names owner O; if the asset is transferred between open and burn, BURN's `asset_owner == owner` read at execution fails for O, and naming the new owner fails SEAL's backward match. Both directions fail closed.
- **A thawed vault leaving the transaction unburned:** impossible — the thaw reverts with the transaction unless a matching top-level burn lands.
- **Emptiness proof:** Token-2022 ATAs for the classic reserve mints cannot be created (measured on mainnet, `IncorrectProgramId`; the probe now pins this per reserve with a classic control); a declared T22 account refuses on length; an undeclared one is destroyed (limit 44). Delegates and close authorities on the PDA's accounts cannot be planted by a stranger (both need the PDA's signature), and one planted during the thaw is refused unless the account is closed (3.3/3.3a). The `lamports == 0` check reads exactly what the sweep left, in the same transaction, with nothing between (measured fact 4 is why it exists).

No path out for anyone but the owner; no emptied vault survives.

---

## R1s — THE SWEEP HELPER

**(a) Owner-only.** Called directly it needs the asset-signer PDA's signature, which only Core produces, inside `ExecuteV1`, which the pinned Core binary approves only for the asset's owner on a thawed vault (SR.5/5a/5c, 0x1a; the frozen case is 3.7's 0x9). The AgentIdentity route is unreachable: adding it needs the collection's update authority (MINT's PDA, which has no such CPI) and is refused even to a keypair UA without the agent registry's signature (R24.1a/1c). Reached while frozen: Core rejects the Execute before the helper runs. **Holds.**

**(b) Pair list.** Same source twice: first pair closes it, second read fails `IllegalOwner` (SR.12a). Destination twice: both transfers land; benign. Source-is-destination and destination-is-a-later-source: impossible, `to_owner == dest` and `src_owner == signer` with `signer != dest` are contradictory. wSOL source: a normal classic account; transfer-then-close works (close only fails if a balance remains, and the transfer just emptied it). Delegate/close authority on a source: irrelevant, the PDA signs as owner. Frozen source: the transfer reverts the whole redemption (SR.14) — documented in limit 44. Non-ATA destination: accepted if owned by the dest wallet with the same mint; the owner chose it. Destination wallet = another vault's asset-signer: allowed (only `signer == dest` is refused); the value lands in that vault's accounts, which is the signing owner's choice; BURN still requires THIS vault empty. Odd count: `NotEnoughAccountKeys` (SR.7). Zero pairs: lamports-only, lands (SR.13). **All safe or fail-closed.** Two of these (wSOL source, other-vault destination) have no arm — see INFO-1.

**(c) Destination checks.** `dest` is chosen by whoever builds the transaction, and given (a) that is the owner or nobody. A hostile page holding an owner's signature needs no helper — a plain `SystemProgram.transfer` does the same thing; the helper adds no capability (round 25's W2 was correctly rejected). A non-system `dest` fails the lamport leg (System transfer to a token-program-owned account) and reverts the redemption; a sub-rent credit to a not-yet-existing `dest` is refused (measured in the round-25 fixture failure). Both are page obligations under item 50, and the canonical dest (the owner, who pays the fee) exists by construction. **Safe.**

**(d) Lamport sweep.** Reads `signer.lamports()` at execution, empties to zero; Core's `ExecuteV1` adds nothing to the PDA afterwards; BURN's `lamports == 0` reads the same transaction's state with no intervening instruction the owner did not sign for. SR.4a measures the exact delta. **Holds.**

**(e) Interaction with BURN's proof.** A closed account is System-owned with zero lamports and zero data: the reserve loop skips it (`owner != SPL_TOKEN && != TOKEN_2022 → continue`) and the general loop skips it (`lamports == 0`) — it passes for the right reason, and S8.1 lands with all six derivations declared (three closed by the sweep, three never created). The missing-reserve-ATA race: a stranger can create a missing classic ATA with dust between the page's build and its send, and then the burn refuses `VaultNotEmpty`; the prior-transaction creation (item 50) closes this because an existing ATA cannot be re-created with new contents, only deposited into — and a deposit into an existing ATA is exactly what the live-balance sweep removes. The one account a stranger can create that neither the sweep can name nor BURN will skip is a **Token-2022 account** (170 bytes): the helper refuses it (165-only), and if a client declares it, BURN refuses `ReserveHasExtensions`. Undeclared it is destroyed (empty, the griefer's rent). This is limit 44's stated "not covered" case plus item 50's client obligation; the new wrinkle (a declared empty T22 account blocks the redemption until the client stops declaring it) is a page rule, not a program defect, and no value is at risk from a stranger.

**(f) Fit.** S8.0's 1,061 bytes is the real shape: claim + open + one `ExecuteV1` carrying the helper with three pairs + burn, owner as fee payer, pool already inside the burn's accounts. The page's additions are the compute-budget pair (+52) and a separate fee payer (+96): ~1,209 of 1,232. A fourth reserve does not exist (`MAX_RESERVE_MINTS = 3` in both programs, pinned to the measurement). A redemption carries no crank (item 54). **The measurement includes what it claims.**

**(g) Evidence.** No arm found that cannot fail; no refusal found to fire for a reason other than the one named (the `because` pins name the helper's program id and the exact error text, measured on this binary first). The helper the suite deploys is the file `build-mainnet.sh` proves byte-identical to the shipped artifact (N6).

---

## R2 — THE POOL

**Invariant "pool ≥ ceil(owed)": holds, and I re-derived it rather than trusting the suite.** `owed_scaled` equals the sum of every live record's `weight·acc + carry − debt` after every operation: `credit` adds `delta·w` to `owed_scaled` and exactly `weight·delta` to each vault (sums match, and `delta·w ≤ avail·SCALE` by the floor, so the pool's balance covers the new owed); `claim` subtracts exactly `settled` from both; `join` enters at `debt = w·acc` (owed 0, `owed_scaled` unchanged); `reweigh` moves owed into `carry` (unchanged); `retire` subtracts the vault's whole pending (redeemed, forfeited, or bare-burned); `expire_boost` preserves it. The only outflow is `claim`'s transfer, which is the same `settled` subtracted from `owed_scaled`. The N1 host test asserts `owed_scaled == Σ owed_of` every step for 260 epochs; the suite's `ledger()` recomputes it from every record after every money operation (BK.*).

**Counters.** `pending_count`/`pending_this_epoch`: incremented at request, `pending_this_epoch` zeroed by `advance_epoch`, decremented correctly on join (earlier-epoch only, since join requires `dist_epoch > request_epoch`) and on retire (same-epoch vs earlier-epoch branch both correct; F21 covers same-epoch, the host test covers the active side). `waiting_to_join = pending_count − pending_this_epoch` cannot underflow. `active_count`/`total_active_weight` move only in `join`/`retire`/`reweigh` and agree with the records in the host model.

**Liveness.** Nobody can make distributions impossible: `JoinWaitingFirst` is clearable by anyone's free `claim` (joins), `BoostsExpireFirst` by anyone's free `expire_boosts` (records only — this is exactly why a vault whose token account is gone cannot wedge the gate), a frozen pool defers but does not lock (forfeit path), and a frozen vault account defers only itself. A griefer requesting activations to keep the join gate closed buys a few minutes per funded vault; the crank joins every pass.

**Round 24 W11 (SPEC's weaker rule):** the code matches SPEC — a vault is never credited by a distribution that ran before it joined, and revenue already in the pool when it joins IS shared at the next one (that is the launch tick's purpose). The stronger wording is not in the code and not promised by SPEC. Consistent.

---

## R2b — THE $CBOB BOOST

**Exactly N distributions, verified by construction and by the orderings:** a boost bought at epoch e ends at e+N; it earns distributions e+1…e+N; the distribution that makes it due is its Nth; the gate (`BoostsExpireFirst`, checked before every `credit` and inside `monthly_inline`) prevents any further distribution until expiry; expiry reweighs at the accumulator its last distribution left. The rode-in-on case counts (BO.21/21a), the reverse order does not (BO.35/35a), the monthly-first case credits the old weight first (BO.22). **A boost can be bought while another is due** (only distributions are gated) — I checked this is safe: `dist_epoch` is frozen while due, so `end = dist_epoch + epochs` is computed against the right epoch, and the ring slot cannot collide with a due boost's old slot (zeroed at `advance_epoch`; a collision needs epochs = 64, refused at init).

**Nothing lost or gained on a weight change:** `reweigh` carries `owed_of` whole and restarts debt at the new weight; `owed_of` is identical before and after. Claim normalisation (`carry = pending − settled`, `debt = weight·acc`) preserves the sub-sat remainder. Retire zeroes it correctly in all three modes.

**`total_active_weight`, `boost_weight_total`, `boosts_active`, `boosts_due`, ring:** agree per the host model across four wraps including early retires at wrapped slots (BO.38 on chain). No record can be expired twice (boost_weight zeroed; a duplicate record in one `expire_boosts` batch is re-read after storing), early (`BoostNotDue`), or never (permissionless expiry, crank, and the gate).

**Nobody can make distributions impossible by boosting:** expiry is free and needs no token account.

---

## R3 — THE LEVEL DRAW

SlotHashes parse is defensive (key pinned, count bounded, buffer length checked, all-zero hash refused) and the host tests exercise skipped slots at A, B and C against an independent model — the paths a validator cannot produce. FIFO is `index == revealed_total`; a burned vault at the head still draws (L.11); a missed window reschedules to `now + 16`, a slot that does not exist yet; the attribute re-supply is hash-checked (L.4). A minter, crank operator or slot leader can influence only what limits 25 and 26 state.

**Is SPEC 26 worse than stated?** No. The stated form is already the strong one: C's leader chooses among many draws (best-of-4 by skipping within its own group, more by varying block contents), for the whole same-slot cohort at once, and being C's leader is chosen via the public schedule. I checked the two extensions: (i) one validator holding A's and C's groups (or all three) is possible with stake concentration — the documents already say "three different leaders is likely, not guaranteed"; (ii) the cohort point is stated. HOLDER-GUIDE now says it truly ("can pick among several results, by skipping a block or changing what goes into it … one choice affects every vault created in that moment at once").

---

## R4 — GOVERNANCE

No minority carry found: quorum/threshold/turnout arithmetic is ceiling-correct; key changes need `ceil(50% × snapshot)`; the two keys never bundle; the snapshot divisor cannot be gamed by minting (VaultTooNew) or shrunk by burns after creation (only harder). Vote renting is the stated accepted limit. A vote reaches no money: the five action kinds are bounded at creation against MINT's fixed values and re-checked by MINT at execution; the CPIs are signed by the `["gov"]` PDA and nothing else can produce that signature.

**Is 47 worse than stated?** No. A stolen guardian can stop sales and the sweep and cancel pending operators, but the sweep stop also neutralises the operator in office, so no funds move; redemption, activation, distribution and claims are untouched; the permanence at sub-50% turnout is stated. The guardian cannot cancel its own replacement (no instruction reaches a pending guardian).

---

## R5 — THE CHARTER CLAIM

Merkle construction matches the Rust byte for byte (domain tags, sorted pairs, odd promotion; the JS selftest proves outsiders fail at depths 1–240). The claim burns the PoB as its owner in the same instruction, passes extras never as signers, refuses by clock alone outside the window, and is ungated by the guardian (ruling).

**Is SPEC 46 complete?** I could not find an omitted capability. The hot wallet can: gate or brick claims (rejecting hook, on the collection or on individual assets, or flipped between alarm passes) and mint lookalikes (refused by the root). It cannot: transfer or burn an individual PoB (Core approves only the owner; the post-creation permanent delegates reject their own add), touch the CBOB collection or any vault (different collection), or act after the window (clock refusal). The two round-25 bounds (alarm cadence, the positive bound) are now stated. Complete as far as I can verify.

---

## R6 — ONE-TIME CONFIGURATION AND THE TRUSTED HOP

Every `initialize` refusal checked against its locked-in consequence: SEAL (1–3 classic-owned reserves, non-empty; the owner-only check is accepted under item 38/A6), MINT (collection clean/ours/unminted; SEAL agrees; payment mint is a reserve; treasury/operator non-default; caps non-zero and summing within supply; charter window valid and not over; root non-zero; every period and bound inside its absolute range; the $CBOB mint classic, initialized, neither cbBTC nor $GARY; boost bounds 1–12 / 1–63), BURN (SEAL names the same collection; window 10 s–24 h), GOV (MINT names the same collection; quorum 500–10,000; threshold 5,001–7,500; period 60 s–30 d). The gap between what the programs check and what the ruled values require is exactly item 38/A6, and `check-launch-params.mjs` pins the ruled values before signing. The royalty is `PluginAuthority::None` on the collection, proven immutable against a control collection both directions (R.5/R.6/R.6a/R.6c), and an asset-level override needs the update authority, which is MINT's PDA with no such CPI (R.8). The redemption cap is exactly a rolling window over a 64-slot ring of timestamps: `kth = ring[(head + 64 − k) mod 64]`, refuse unless `now − kth ≥ window`, write at head, advance; cap `ceil(live × 210/10,000)` floored at 1 and bounded by the ring (stricter, never looser, past 3,047 live; supply is 2,100). The swap operator's worst case is the stated cap × cooldown-until-stopped, never more than the revenue PDA holds above the reserve.

---

## R7 — CROSS-PROGRAM RAW READS

Recomputed from the struct definitions, field by field. MintConfig: version 8, collection 9, governance 41, pool_ata 73, round_id 105, price 125, minted_total 141, max_supply 149, bank_treasury 157, split_bps 189, sales_stopped 191, sweep_stopped 192, guardian 193, swap_operator 225, sol_reserve 257, bump 265, max_sweep 266, sweep_cooldown 274, last_sweep 282, level_caps 290, level_minted 310, revealed_total 330, payment_mint 338, pob_collection 370, pob_root 402, charter_opens 434, charter_closes 442, charter_claimed 450, bare_burns_retired 454, total_active_weight 462, active_count 470, acc 478, owed 494, last_distribute 510, sales_stopped_at 518, sweep_stopped_at 526, pending_op 534, pending_op_at 566, monthly 574, pending_guardian 582, pending_guardian_set 614, pending_guardian_at 615, notice 623, sweep_floor 631, cooldown_ceiling 639, reserve_ceiling 647, dist_epoch 655, pending_count 663, pending_this 671, cbob_mint 679, max_boost_weight 711, max_boost_epochs 712, boost_price 714, boost_weight 722, boost_epochs 723, boosts_active 725, boosts_due 729, boost_weight_total 733, cbob_burned 741, boost_expiring 749, +256 padding = **1,261 = MINT_CONFIG_SPACE** (recomputed the constant expression independently: matches). VaultRecord: version 8, asset 9, mint_index 41, reveal_slot 49, level 57, charter 58, entropy_set 59, entropy 60, attrs_hash 92, bump 124, active 125, retired 126, reschedules 127, vault_ata 129, debt 161, pending 177, request_epoch 178, boost_weight 186, boost_end 187, carry 195, +10 = **221**. BurnConfig: version 8, collection 9, bump 41, burned_total 42, window 50, rate_head 58, ring 59, +256 = **827**. SEAL Config: version 8, collection 9, reserves at 41. GovConfig and Proposal spaces recompute clean. Every offset GOV, BURN, MINT and the suite's TS constants read agrees with this walk; every read is pinned by address, owner, discriminator and version; the sweep helper's offsets (mint 0, owner 32, amount 64, len 165) are the classic SPL layout. **No misread found.**

---

## R8 — THE SUITE, THE SIMULATION AND THE BUILD AS EVIDENCE

### LOW-1 — RL.7's per-redemption caps are upper bounds, so the replay is weaker than "each against its own cap"

**Construct:** `tests/3prog.test.ts` `sendNow` stamps each landed redemption with `live = max(minted_before, minted_after) − k − min(bare_before, bare_after)`, and the comment says this is sound because "a cap never understated". That is precisely the problem: the stamped cap is never *below* the true one, so the replay check `inWin > cap` is evaluated against a cap that may be *higher* than the one BURN enforced.

**What is at stake:** nothing on chain — BURN's own arithmetic is unaffected (and is separately exercised by RL.2/RL.3/RL.4 and S10). What is lost is detection strength: if BURN ever admitted more redemptions into a window than its own computed cap, and a concurrent mint or bare-burn retirement landed between the suite's before/after reads at a cap boundary (live 95→96 moves the cap 2→3), the replay would judge the violation against the stamped cap 3 and pass.

**Evidence that would exist if I am right:** a run where IN.1's concurrent mint lands between `sendNow`'s two `supplyNow()` reads while live sits at 95; `STAMPS` then records 96 for that redemption, and RL.7's note prints a cap of 3 for a redemption BURN admitted at a true cap of 2. Today the stamps are almost always exact (RL.2 and IN.1 are the only concurrent sections, and IN.1's redemption is nowhere near a boundary), which is why this is LOW, not a false green.

**Fix:** read the two configs with `minContextSlot` set to the redemption's parent slot (or `getBlock` the landing slot and reconstruct), so the stamp is the value BURN divided by, not a bound on it; or exclude concurrent mints from any section whose redemptions are stamped.

### LOW-2 — P.11a can fail on draw luck rather than on a defect (suite robustness)

**Construct:** P.11a now requires the fixed five-level string, which requires `picks.length == 5` — one live, empty, alice-owned, unactivated vault per level. Levels are drawn from real entropy; level V's cap is 2. If both V slots are consumed by vaults that are later funded, activated or redeemed before section P, no eligible V exists and the arm fails.

**What is at stake:** a red certification run that means "unlucky draw", not "defect" — the opposite of a vacuous pass, but the project's own rule is that a red run must mean something. Round 25's verdict specified this exact repair ("fails unless picks.length === 5"), so this is the specified behaviour; I file it only because the failure trigger is outside any defect.

**Evidence:** a run whose P.11a note shows four entries in `perLevel` with the census otherwise exact (L.18 green).

**Fix:** reserve the picks at mint time — as each vault is minted and revealed in the early sections, set aside the first empty alice-owned vault of each drawn level and never fund, activate or redeem it; or move the pick selection before the RL redemptions and top up mints until all five levels are represented (the census is not yet exhausted there).

### INFO-1 — Unexercised helper shapes (answers, not defects)

R1s(b)/(c) asks about four shapes no arm exercises: a native wSOL source (works — ordinary classic semantics, transfer empties, close succeeds), a duplicate destination (works, benign), a destination wallet that is another vault's asset-signer (allowed, safe — the signing owner's choice, BURN still requires this vault empty), and a non-system destination (the lamport leg's System transfer fails and the redemption reverts — a page obligation under item 50). All four follow from SPL semantics read directly; if the project wants every R1s question armed, these are the four missing arms.

### INFO-2 — What the suite does not measure

Nothing in the suite exercises a redemption whose `claim` is skipped because the pool is frozen *and* the vault is owed a sub-sat residue only (3c.F2 covers owed ≥ 1 sat); the code path is the same `forfeit` branch with `pending < ACC_SCALE`, so this is coverage completeness, not a gap in the invariant. The rehearsal proof of `rehearsal-tree.sh` is of `d57ee3a` and is stale (item 53, correctly OPEN). The byte-identity chain (N6) is proven on one box with one cache — see the final section.

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

**1. Is any limit WORSE than stated?** I found none. Specifically checked: 25 (the re-roll needs total silence; the crank operator and the minter's client can withhold captures — stated), 26 (already stated in its strongest form, see R3), 28 (frozen vault account blocks the whole redemption; frozen pool forfeits; frozen revenue account blocks mints; frozen Squads blocks splits — all stated), 32 (unretired bare burns read the cap one higher — stated), 40 (all three Core consequences named, including the Execute authority rule), 41 (transfers unlimited — stated), 46 (complete, see R5), 47 (not worse, see R4), 55 (the 100-$GARY boundary case is stated), 56 (sell or boost; the mint itself safe — stated).

**2. Is anything listed as a limit not actually a limit?** 35 is correct arithmetic (21% × 51% = 10.71% > 10%). 34, 36, 37 are accurate descriptions of the code. I found no item listed as a cost that the code has quietly closed, and none listed as closed that the code still bears.

**3. Is any DISCHARGED item not actually discharged?** 51 (boost) is built and measured end to end, including the one-sided `BoostTermsMoved` rule the documents now state. 54's figures are consistent with the suite's current arms (10.5/10.6/10.6a/10.6b). 12/17, 14, 19, 30, 31, 33 each verified against the current code.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. 22 (with the round-25 L5 revenue-cycle additions), 38, 50, 52 and 53 are all still marked OPEN AND BLOCKING in SPEC and the road table; the holder guide is still marked DRAFT with the may-not-publish rule attached to item 50.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — WHAT AI AUDIT STRUCTURALLY CANNOT DO

1. **Prove the build environment, not just the build.** Every byte-identity proof (N6, the Core pin, the key-behaviour probes) runs on one box, one toolchain, one cache directory. A compromised `cargo-build-sbf`, a poisoned `.cache/core-mainnet.so` before the first pin, or a tampered `target/deploy` produces a self-consistent green from a poisoned root. Before launch: rebuild all five programs from the release commit on a **second, clean machine** (fresh OS user, toolchain installed from Solana's own release channel, Core re-dumped through **two independent RPC providers**), and require the five sha256s and the Core hash to match this box's `dist/SHA256SUMS`. This is the single highest-value act left: it is the only thing that turns "the tested bytes are the shipped bytes" from a one-box claim into a fact.

2. **Run the dress rehearsal, all five of item 22's named items, with signatures recorded.** No suite, sim or fork exercises the crank, the alarm or the revenue cycle against a live cluster at ~2,100-vault scale (rate limits, paging, a transient RPC error on vault 1,900, the reveal lane under burst, the full Orca cycle, the forced-refusal Meteora cycle, the forced post-sweep failure walked through hand recovery). AI cannot execute it. It is OPEN; do not let it be demoted.

3. **Verify the four `initialize` transactions, not the JSON.** The checker validates `launch/mainnet-init.json`; the programs check less (A6). Build the four transactions **from** that file, simulate them, broadcast them, then read every config field back from chain through an independent reader and diff against the JSON — before the lock, while a mistake is still a failed deployment rather than a permanent value.

4. **The lock ceremony is operational, not code.** Removing the upgrade authority from all five programs is five irreversible transactions. After each, verify `getProgramInfo` shows authority `None` from two independent RPCs, and verify the deployed bytes against the cross-machine hashes from (1). The same ceremony covers the keys no audit can see: `INIT_AUTHORITY`/guardian, the swap operator, the $CBOB release wallet, and the PoB collection hot wallet — their generation, storage and backup are the actual custody of everything item 10, 46, 47 and 56 describe.

5. **The redeem page holds the user's signature and is outside this process.** The helper deliberately binds nothing to the owner; a defect in the page that builds the transaction misdirects funds with a perfectly valid owner signature, and no program round will ever read it. Build it (item 50), then apply this same discipline to it: every item-50 obligation as an assertion, its output transactions simulated and diffed against the measured 1,061/1,209-byte shape, and `judgeRedemptionCoverage` proven to fire before signature on a vault carrying a stray classic account, a T22 account and a nested asset.

6. **Prove the pinned Core binary is the read source.** The Execute authority rule the helper's whole access control rests on was read at `e72d63e` and measured against the pinned binary `f03e75…`, but the two were never proven identical. Reproducible-build Core from `e72d63e` and compare, or obtain Metaplex's published hash for the pinned build. If they differ, the source readings (asset.rs, collection.rs, agent_identity.rs) must be re-done against the real source.

7. **Test the pager, not just the alarm.** Item 7's wedged-lock risk and every CRITICAL detector end at an SMS router and a human. A live end-to-end page test (alarm → router → phone → acknowledged) before launch, and again after any router change, is the only evidence that the detection half of every accepted limit exists.

8. **One more reader for the money code, from a different starting point.** Every verification of the pool and boost invariants in this tree — mine included — starts from the author's own struct definitions and the author's own model. The strongest remaining evidence would be an independent re-derivation that starts from the *deployed bytes* (disassemble the five `.so`s, or recompile from source on the clean machine of (1) and diff) and re-checks the three invariants (`pool ≥ ceil(owed)`, exact-N boosts, the ring's `ring + due == active`) against what is actually there, not against what the repository says is there.