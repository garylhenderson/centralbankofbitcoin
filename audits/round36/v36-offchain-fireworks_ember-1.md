# ROUND 36 AUDIT — off-chain pipeline, MINT, and the sweep helper

I read the whole tree against the brief. I could not execute code, so every claim below names the on-chain or test evidence that would exist if it were true, and I have held each to the standard that a wrong CRITICAL costs real engineering time. The honest headline: after 35 rounds this pipeline is heavily converged, and I found **no CRITICAL or HIGH** that survives careful reading. What follows is what I verified, the defects I did find (LOW), the accepted-limits audit, and the structural section.

---

## R0. ROUND 35'S VERDICT AND THE REPAIRS

Round 35 reached no quorum; its record is a triage, an adversarial review of `rescue_nested`, and a validation. I treated every changed line as unaudited and re-derived each repair.

**The program change (item 58) holds against what the off-chain code assumes.** `rescue_nested` requires: the vault live in `config.collection` (`require_live_vault`); the vault's owner (bytes 1..33) equal to `PDA(["mpl-core-execute", host], Core)` (`NotNested`); host is the vault itself, positively burned (`is_burned`: Core-owned, 1 byte, key 0), or a live CBOB vault (`HostUnresolved` otherwise); and `new_owner == config.bank_treasury` (`WrongRescueDestination`). The review's M1 is fixed — the destination is unconditionally `bank_treasury`, never the host's owner. M2 is fixed — a foreign live host is refused. The detectors agree: `parseCbobLogs` attributes `CBOB_VAULT_RESCUED` to MINT only (selftest proves a foreign print is ignored), `detectProgramEvents` pages it HIGH/urgent/once, and `detectNestedVaults` routes a Squads-held vault to `vault_awaiting_return` (level) before the off-curve branch. The rescue does not touch the `VaultRecord`, so the crank's and alarm's money tracking (keyed by asset id and `vault_ata`, not owner) is undisturbed — a rescued vault keeps accruing into its own PDA ATA, which is what item 58 states.

**The triage repairs, verified at their sites:**
- C1/C2/C15 (road steps 9–11 contradicted each other about `--final`): SPEC's road table now defers `--final` to step 11 with dump-and-verify on both sides and a re-verify at step 10. Holds.
- C3 (GOV's `MIN_ROUND_PRICE_SATS`/`MAX_ROUND_SECS` unpinned against MINT's): now pinned in the suite (R35.C3, floor 889). Holds.
- C4 (deploy-authority custody): stated in SPEC step 9 with the backup named. Holds as a record.
- C5 (a stray token account whose close authority a stranger keeps): now a stated "Known limits" entry; the redeem page sweeps its balance and leaves it undeclared. **Verified the mechanism:** the sweep helper's `CloseAccount` is signed by the PDA-as-owner, and SPL Token honours a set `close_authority` over the owner, so naming such an account reverts the sweep; BURN refuses it declared (`ReserveDelegated`); left undeclared and empty, nothing of the holder's is lost. The page-side handling is the real fix and it is item 50's contract.
- C9 (crank activates/joins/pays nested and off-curve vaults): superseded by item 58 — payouts travel with the vault. Accepted, and the crank's behaviour is consistent with that.
- C10 (index lag pages CRITICAL): now a stated "Known limits" entry (level-triggered, router-graced). Holds.
- C18 (`seenSplits` grows unbounded): `detectSplitHistoryGrowth` pages HIGH at 50,000; `closesCycle` sorts once per list. Holds.
- Review L2 (the Squads can vote with a held vault): stated in item 58 as a custody rule. Holds as stated (see the accepted-limits section — it is not worse than stated).
- Review L6 (test gaps): R35.N1–N9, N2a, N8a in the suite. Holds.

One residual survives; it is Finding 1.

---

## R1. THE CRANK (`bank/crank.mjs`)

I checked the planner against the program's refusals, the send order, and the value paths.

**No plan the program will refuse.** The send order is reschedule → capture → reveal → retire → preJoins (claim) → preExpires → split → distribute → postExpires → activate → claims. This satisfies the program's gates: `distribute` refuses `JoinWaitingFirst` while an eligible vault waits (the crank joins them first, in their own claim batches) and `BoostsExpireFirst` while a boost is due (the crank expires first). The preJoin claims run `monthly_inline`, which declines while `waiting_to_join > 0` or `boosts_due > 0`, so the in-line run cannot fire mid-join and race the explicit distribute. A distribute refused because a host's in-line run or a stranger's burn landed between plan and send is re-judged against a fresh config read (`judgeDistributeRefusal`): benign only when `dist_epoch` or `last_distribute_at` moved; `PoolShort` is always a fault. The selftest arms each race code both ways.

**No dead vault is paid or joined.** `retireBurned` takes positively burned vaults (Core-owned, 1 byte, key 0) at any level; the claims loop skips `burned` and reports `other` (a null RPC read); preJoins and joins require positively `live`. The program's `claim` does not check liveness (accepted limit 27), so the crank's filter is the control, and it is present at all three sites.

**No reveal out of order.** The reveal loop walks from `revealed_total` and breaks at the first not-ready vault; the program refuses `RevealOutOfOrder` regardless. The attribute list is read off the live asset and hash-checked (`judgeRevealAttrs`) before a fee is spent; a list already carrying `level` is "revealed elsewhere" (benign), a mismatch is a fault, and `[]` is sent only for a positively burned asset (`revealAttrSource`), matching MINT, which skips the Core write and the hash check for a burned asset.

**The budget arithmetic is sound.** `planCostLamports` counts every transaction (claims already batched; preJoins/expires batched by `CLAIM_BATCH`/`EXPIRE_BATCH`) plus per-reveal Core attribute rent. `budgetPlan` runs the base plan whenever the key covers it, keeps the floor in reserve, and budgets reveals in mint order; a key that cannot cover the base is refused with the shortfall named. The round-30 L2 behaviour (reveals never spend the key below the floor; the base runs even below it) is armed both ways in the selftest.

**It moves no value the program does not pin.** The crank signs only as fee payer; the selftest pins the instruction set (`activate`, `capture_entropy`, `claim`, `distribute`, `expire_boosts`, `reschedule_reveal`, `retire_burned`, `reveal_level`, `split_revenue`), that it builds no token/SOL transfer of its own, calls no program but MINT, and that the distribute it sends is the free path (`burn = 0`).

One observation, not a defect: the crank's tick branch requires `!pool.frozen`, while the program's explicit `distribute(false)` with `w == 0` reads the pool via `read_token` but ticks regardless of freeze (the tick precedes the credit logic). The crank is more conservative, and the tick still runs in-line through `monthly_inline` (which ticks before the pool-state check) on any host instruction, so the launch tick is not blocked. This is the safe direction and consistent with round 22 F7.

---

## R2. THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

**No dangerous-quiet state found.** I traced the fixed-forever values (the whole `WATCH` list, including `prog.sweep.*` and the four third-party programs), the pending guardian/operator (`swap_operator_armed`, `guardian_armed` at CRITICAL every pass), the PoB collection's plugins and update authority, the redemption window (`redemptionCapacity` recomputes BURN's `max(1, ceil(live × 210/10000))` capped at the 64-ring), a frozen or insolvent pool (`pool_frozen` urgent; `pool_insolvent` against `ceil(owed_scaled)`), an overdue distribution (`detectDistributionOverdue` with the joins/boosts/launch-tick stalls), and the post-lock upgrade authority for all five programs (`detectUpgradeAuthorityAfterLock`, deadline = earlier of the file and `charter_opens_at`). Gary's production values are all asserted: 2100/5100/259200, 604800 notice, the three tighten bounds, 2592000 month, 3600 window, the census, the mints, the PoB root and collection, the $CBOB mint and boost ceilings.

**No routine state paged every pass.** The freeze kinds page on transition and stand at INFO (`applyFrozenTransitions`); one-shot kinds are urgent with the pass time in the text (new to the router each time); level kinds re-assert and get a RECOVERY on the first clean full pass; the brakes page on transition only; `sales_stopped`/`sweep_stopped`/`guardian_retired` are INFO. The router arms run the real `/opt/scripts/alert-router.py` in a throwaway state dir and fail if it is absent — they cannot pass vacuously.

**The round-32/33 sweep backstop is sound.** `detectSweepState` judges `mint.last_sweep_at` from account state (immune to scan floods), with a symmetric half-cooldown window (box `startedAt` vs chain sweep time), an uncertain send explaining only on a direct `getSignatureStatuses` confirmation, and the smallest cooldown ever seen (never above 6 h) so a lengthening vote cannot widen the window. The first pass judges from 0 (MINT's initial value), a fresh sweep waits out the grace without advancing the baseline, and an undelivered page rolls the baseline back.

---

## R3. THE LAYOUTS (`bank/layout.mjs`)

The assertions are real. `parseRustStruct` is strict (a private, `pub(crate)`, or unreadable line throws), and the selftest holds every struct's field list equal to the Rust, name and type, both ways (an added field and a retyped field are each caught). Every cross-program `OFF_*` constant any program pins is scraped and compared against the computed offset, and the "none scraped and ignored" arm closes the round-22 L2 gap. **Round 24 D6 is closed:** the SEEDS block scrapes each of the 11 seeds from its declaring program and fails on a mistyped or unmapped seed. Versions are scraped from all four programs (including sibling copies), `BOOST_RING` is pinned three ways, and `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are scraped, evaluated, and held to the layout's fixed lengths minus padding (1005/211). A struct change cannot slip past: any of these turns the build red.

---

## R4. THE MONEY ARITHMETIC (`bank/accrual.mjs`)

The mirror equals the program, line for line. `credit` (`delta = avail × 1e12 / w`; `owed += delta × w`), `pendingScaled` (`(weight + boost) × acc + carry − debt`, refusing negative), `reweigh` (owed → carry, debt restarts at the new weight), `ceilSats`, and `available` (floor at 0 where the program refuses `PoolShort` — a deliberate, documented divergence: the mirror reads 0, the alarm reports the shortfall) all match MINT's `credit`/`owed_of`/`reweigh`/`ceil_sats`/`avail`. The crank expires every due boost before the distribution (`preExpires`: `dist_epoch >= boost_end_epoch`) and every boost its own distribution makes due right after (`postExpires`: `boost_end_epoch == dist_epoch + 1`), and its owed computations for a pre-expired vault (`atExpiry + levelWeight × (acc − oldAcc)`) and a post-expired one (boost still on at the same acc) both equal what the program pays, including the in-line expiry path in `claim`. The alarm pages `boosts_stalled` and watches `cbob_mint`, `max_boost_weight`, and `max_boost_epochs` as fixed-forever CRITICAL drift.

---

## R5. THE SWAP (`bank/swap.mjs`) AND THE REVENUE CYCLE (`bank/revenue.mjs`)

**(a) Oracle math.** `sats = lamports × sol.price × 10^(sol.expo − btc.expo) / (btc.price × 10)`; the exponent sign is handled by multiplying numerator (e ≥ 0) or denominator (e < 0), all BigInt, no overflow at any reachable size. `expectedSats` floors, `minSats = expectedSats × 9850/10000` floors again — sub-sat, negligible, and the safe direction for a quoted expectation. `satsPerLamport` is float but feeds only the deviation heuristic; the enforced floor is BigInt. The floor (oracle − 150 bps) sits below an honest pool's return (Orca 16 bps fee + sub-bps impact at royalty size), proven on the fork at the ruled 10 SOL (SW.8/SW.9).

**(b) Pyth verification.** The account is the derived sponsored PDA (shard 0, under the push-oracle program), required to be owned by the receiver, `verification_level == Full` (byte 40 == 1), and the expected feed id (bytes 41..73); price/conf/expo/publishTime at 73/81/89/93 — proven against the real cloned accounts on the fork (SW.7). Ownership plus derivation plus the feed-id check is sufficient *given Pyth's programs*: a forged write requires compromising the receiver, which is accepted limit 10(d) and watched at HIGH. Staleness (180 s) and the future-stamp bound (30 s) are judged against the chain's Clock sysvar (byte 32, owner-checked), never the box clock; an unreadable clock refuses.

**(c) Deviation filter.** `orcaSpot = (sqrt_price/2⁶⁴)²` is sats per lamport (A = wSOL, B = cbBTC, raw units); `meteoraSpot = 1/(1+bin_step/10⁴)^activeId` is the same quantity inverted (X = cbBTC, Y = wSOL) — the right quantities in the right directions, armed both ways through `market()` at ±99/±101 bps. Float cannot pass a pool it should refuse in any way that matters, because the filter is a heuristic and the on-chain floor is the enforcement.

**(d) Minimum out.** Both venues carry `minSats` (Orca `other_amount_threshold` at offset 16, Meteora `min_amount_out` at offset 16), the same `oracleFloor` value the filter used, in cbBTC base units — the units both programs expect.

**(e) The judge is complete.** It requires the exact seven-instruction sequence: `SetComputeUnitLimit(400000)` and no priority fee anywhere; both ATA creations for the operator's own wallet and mint; one System transfer of exactly `lamportsIn` from the operator to its own wSOL ATA; `SyncNative` of it; the swap with the pinned pool (key 2 Orca / key 0 Meteora), the operator's wSOL in (key 3 / key 4) and cbBTC out (key 5 both), amount at offset 8, floor at 16, and Orca's exact-input/a_to_b/min-price-limit bytes; and exactly one close of the wSOL account back to the operator. No second signer, no foreign program, no Token instruction but SyncNative and the one close. The unpinned swap accounts (vaults, tick/bin arrays, oracle, bitmap, event authority) are validated by the venue program against the pinned pool, so a tampered builder cannot route value past the judge; the eight round-25 tampers are each refused by name on both venues, and the round-24 judge is shown to have passed all eight (the arms can fail).

**(f) Derivation.** Orca's three tick arrays for a_to_b (current, then the two below; `floor` not `trunc` for negative ticks, and a tick exactly on a boundary starts that array), the oracle PDA, vaults read from the pool; Meteora's bin arrays (active, then the two above for Y→X), the bitmap extension present-or-program-id, `host_fee_in` as None, the event authority, two token programs. All proven against the real programs on the fork. A tick-array boundary crossing or an uninitialised array fails on chain and is classified `refused`, falling to the other venue.

**(g) wSOL.** Wrap exactly `lamportsIn`, sync, exact-input swap (nothing left), close back. A pre-existing balance is swept to the operator (its own money); wSOL has no freeze authority so the account cannot be frozen; a delegate requires the operator's own key; the ATA is deterministic and owned by the operator regardless of who created it.

**(h) Failure and retry.** Meteora runs only on an Orca *refusal* (preflight refusal, landed-and-failed, or expired-and-never-landed, all read off the signature's status), never on an unconfirmed send — an unknown status stops the cycle open and loud with the candidate signature preserved. A confirmation timeout on a swap that later lands is classified `landed` and recorded, so no second swap and no double count. Every path leaves the cycle open until a cbBTC return is recorded *and* a split at least as large is anchored on chain (`closesCycle`, anchored on the return's chain time); the alarm holds an explicit `splitSig` to the same anchor as a `splitByOther` one.

**(i) Adversary bound.** With a 100 bps gate and a 150 bps on-chain floor, a sandwich or a pool pushed to the gate's edge can take at most ~150 bps minus fees per cycle — ~0.15 SOL at the ruled 10 SOL cap, ~0.6 SOL/day at the 6 h cooldown, of royalty SOL only. A stale-but-accepted oracle (≤180 s) is bounded by the deviation filter disagreeing with the moved pool; a manipulated Meteora pool (~10× thinner) is skipped if it strays >100 bps and floored otherwise. This is disclosed to holders ("up to 1.5% below Pyth's price") and is not material against the cycle size. **The operator key's worst case is unchanged and on-chain:** 10 SOL per 6 h until the guardian stops it, never more than the revenue PDA holds above the reserve; the judge constrains only a thief who also uses this tree, which is the accepted box-owner residue. The ledger cannot read a failed cycle as closed (`cycleIsOpen` requires a return and a split; `sendRejected` rows carrying a sweep are themselves CRITICAL).

---

## R6. THE GATES

Every floor must **equal** its count (`floor()` checks `-ge` then `-eq`; the selftest's own `FLOOR = 917` is equality), so deleting work turns the build red. The SPEC stated-counts gate reads *every* occurrence of every floor and fails on zero occurrences (no vacuous pass on empty input). The wiring gate derives the detector list from `Object.keys(D)` and requires each result to be consumed in `main()`/`reconcile()` outside comments; deleting a detector is caught by the H1 "no stale kinds" arm (its kinds stop being emitted). The control-table gate parses SPEC's rows and requires an ON-CHAIN row to name a real error variant of the named program. `build-mainnet.sh` proves the sweep helper's bytes identical across `dist/`, the localnet rebuild, and `target/deploy`, and behaviourally proves the four keyed programs' INIT_AUTHORITY swap both ways; the rehearsal-tree proof recreates HEAD byte-for-byte under the reverse map and refuses a leftover 4-char id prefix. I did not find a round-24 repair armed in only one direction; the arms I checked (H1 router, L1–L13, I1–I5, R25–R35) each have a failing case.

---

## FINDINGS

**LOW — `detectNestedVaults`'s `unredeemable_owner` text is stale for a vault nested in a since-burned foreign asset.**
- **Construct:** `bank/detectors.mjs`, `detectNestedVaults`, the off-curve branch ("marketplace escrow … or its contents are sealed for good").
- **What it gains:** nothing is lost; the runbook is wrong in one case. Since item 58, a vault nested in a *burned* foreign asset can be extracted to the Squads by anyone (`rescue_nested`: `orphan = host == vault || is_burned(host)`, and a burned host routes to `bank_treasury`). The detector walks only our collection (its `owners` map holds our vaults' PDAs), so a foreign asset-signer PDA as owner falls to the off-curve branch and reports "sealed for good", which is now false when the host is burned.
- **Evidence if true:** `programs/cbob-vault-mint/src/lib.rs` `rescue_nested` (`is_burned(&a.host)?` → `orphan` → `dest = bank_treasury`); `detectNestedVaults` builds `owners` only from the DAS page of our collection, so no foreign PDA is in it. A test: nest a vault in a foreign asset, burn the foreign asset, and `rescue_nested(vault, host=burned_foreign, new_owner=Squads)` lands while the alarm reports `unredeemable_owner` with "sealed for good".
- **Fix:** the text should note that if the host is a burned asset, anyone can rescue the vault to the Squads. The detector cannot read the foreign host's state, so this is a text caveat, not a logic change. (Round 35's review L4 named the detector-text family; the validation fixed `nested_vault` and `vault_owns_itself` and left this one.)

No other finding survived. In particular I looked for and did **not** find: a crank plan the program refuses; a payment or join into a dead vault; a reveal sent out of order; a dangerous-quiet alarm state; a routine page; a layout assertion a struct change could slip; a divergence between `accrual.mjs` and MINT; a judge bypass; a second-swap or double-count path in the revenue cycle; or a gate that passes vacuously.

---

## THE ACCEPTED LIMITS, INTERROGATED

**1. Is any limit WORSE than stated?** None found. Limit 10's operator key is bounded on chain (10 SOL / 6 h, guardian-stoppable), and its "what is trusted" list (two pool programs, the oracle, the one RPC, this tree's integrity, four third-party upgrade keys) matches the code. Limit 25/26's draw residuals are as stated and the crank's every-minute lane plus in-line capture is the stated control. Limit 27's dead-weight window is bounded by the crank retiring first each pass. Limit 28's frozen-pool behaviour matches: the crank never distributes from a frozen pool and defers frozen claims; the program's explicit distribute crediting from a frozen pool is the deliberate stage-3c behaviour the SPEC states. Limit 32's cap arithmetic in `redemptionCapacity` equals BURN's. Limit 55's unsplit-revenue edge is bounded by the crank splitting every pass and paged by `revenue_unsplit`. Limit 58's Squads-can-vote is a stated custody rule, and the held vault is paged every pass (`vault_awaiting_return`), so a vote with it would not be silent in substance.

**2. Is anything listed as a limit not actually a limit, or already closed?** Limit 9 (foreign nested asset) is genuinely still open — no per-vault DAS owner search exists. The rest are real costs, not papered-over closures.

**3. Is any DISCHARGED item not actually discharged?** Items 12/17 and 54 (compute) are measured with the figures in SPEC; 14 (duplicate attributes), 19 (unlevelled halt), 30 (85/15), 31 (cadence), 33 (notice) are closed on chain or superseded with the reason named; the v5 family (1a–24) went with the Bank/deck/distributor, which are verifiably deleted (the selftest pins the retired files' absence and that nothing imports them).

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22 (dress rehearsal), 38 (launch values), 50 (holder pages), 52 (pool/Squads/revenue accounts), 53 (rehearsal tree) all remain OPEN. Item 50's pages are being built in `web/` but are staged and unpublished, and the item is still marked OPEN AND BLOCKING with the holder guide barred from publishing first. Nothing has demoted them.

---

## ANYTHING ELSE

- The `web/` holder pages are outside this audit bundle and have never been in a quorate round's bundle. That is item 50's blocking condition, not a new finding — but it means the redeem page that must run `judgeRedemptionCoverage` before the holder signs is currently certified by nobody, and it is the only pre-signature control for items 9 and 44.
- The alarm's paging path (`/opt/scripts/alert-router.py`, `notify-gary-sms.sh`) is outside the audited tree. The selftest exercises the router's real behaviour, but the end-to-end delivery of an actual page to a human is not something any gate proves.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — WHAT AI AUDIT STRUCTURALLY CANNOT DO

1. **Execute the dress rehearsal (item 22) — this is the single largest gap.** AI audit reasons; it never runs the crank, alarm, or revenue cycle against a live cluster with ~2,100 vaults, real rate limits, a transient RPC error on vault 1,900, or the every-minute reveal lane keeping up. The 889 assertions run on a local validator; the live I/O is unproven. Item 22's named items — including one full live revenue cycle through *each* pool (Orca forced to refuse once) and one forced post-sweep failure walked through the hand recovery — must pass with signatures recorded before anything mints.
2. **A human reads the four `initialize` transactions against `launch/mainnet-init.json` at signing.** The checker validates the JSON, not the signed transaction (round 24 A6). One wrong value is permanent; a person must confirm the bytes being signed encode the ruled values.
3. **Key custody is unverifiable by this process.** The $CBOB release wallet (limit 56), the swap operator key (limit 10), the deploy authority (C4), and the PoB collection hot wallet (limit 46) all rest on backups, custody, and "it will stay secure" — none of which an audit of code can establish. A person must verify the backups exist and restore from one.
4. **The holder pages (item 50) need the same rigour as the programs, by a different reader.** They build every transaction a holder signs and run the only pre-signature coverage check; they are currently unaudited by any round.
5. **An independent re-derivation of the money arithmetic, not a mirror.** `accrual.mjs` is the same author's formulas as MINT's; a shared misunderstanding passes both. A second party re-deriving "what is this vault owed" from the SPEC's English, then diffing against both, is the only check that catches it.
6. **Prove the paging path end-to-end.** Send a real test page through the router and notify script and confirm a human receives it. An alarm that cannot reach anyone is the quiet-pipeline failure this whole design exists to avoid, and no gate proves delivery.
7. **A second indexer or a DAS-failure drill.** The alarm's completeness rests on DAS (`getAssetsByGroup`). Its failure modes (partial pages, lag) are guarded, but its correctness and availability are third-party facts no audit can pin.
8. **One final human read of the complete frozen diff before `--final`.** This round read MINT and the sweep helper; SEAL, BURN, and GOV were read by earlier rounds. Immutability locks whatever survives; a person reading the whole frozen tree's diff since the last full human-readable review is the last chance to catch what a split-scope process missed.