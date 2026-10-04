# Round 23 audit: v6 programs and the $CBOB boost

I read all four programs, the suite, the simulation and the docs. Every check below that is not marked as a finding is something I tried and could not break. I did not run code. For each finding I say what evidence would exist if I am right.

**Byte-offset checks (no fault found).** I recomputed MintConfig (1005 bytes + 256 padding), VaultRecord (211 + 10 = 221), BurnConfig (571 + 256) and every cross-program raw offset that GOV and BURN read from MINT. Each matches.

**Counter and accounting checks (no fault found).** I also checked:
- The boost ring: epoch arithmetic and slot collisions with a maximum length of 63.
- The pending counters.
- `owed_scaled` equals the sum of pending shares through credit, claim, join, reweigh and retire.
- Pool solvency, `ceil(owed) <= balance`.

I found no exploitable bug in the programs' accounting. The findings below are about liveness, governance reach, coverage and documents.

---

## R1. Custody and redemption

### R1-1 (MEDIUM): a stranger can block any redemption by racing the exact-amount sweep

- **Construct.** The check `ctx.accounts.asset_signer.lamports() == 0` and the reserve emptiness loop in `cbob-vault-burn::burn_vault` require exactly zero. Core `ExecuteV1` can only move fixed amounts.
- **Why it races.** The redeemer reads the balance, builds the transfer and close, and lands a slot or more later. Deposits to a vault's ATA or PDA are permissionless. Any deposit in the gap makes `CloseAccount` or the lamport check fail, which gives `VaultNotEmpty`.
- **Cost.** A depositor sending one randomly sized deposit per slot costs about 5,000 lamports per transaction, roughly 0.045 SOL per hour plus the deposited dust. That is cheap compared with what a whale vault holds.
- **No client-side fix.** The redeemer cannot shotgun amounts if the attacker randomises them. Honest racing also happens: a crank `claim`, or a `distribute` (100 $GARY), changes the claim amount that the sweep must include.
- **Why the stated limits miss it.** SPEC 9.10/9.11 treat the lamport grief as a static state that costs the griefer. Limit 32 says blocking redemptions costs about 2.1% of live supply in vaults, but the race needs no burns. So limit 32 is worse than stated in kind: a cheaper block exists.
- **Evidence if I am right.** On the local validator, run a loop that sends a random 1–1000 unit cbBTC deposit to a vault ATA (and 1 lamport to the PDA) every slot. Run the standard `open + sweep + burn` against it 20 times. Every attempt should fail `VaultNotEmpty`. No arm in the suite does this.
- **Fix, before the lock.**
  - Tokens: in the first reserve loop, replace `require_keys_eq!(o, pda, ReserveNotOurs)` with `if o != pda { continue }`. The redeemer can then `SetAuthority(AccountOwner)` the whole ATA inside `Execute`, atomically, with no amount. This is safe because an account no longer owned by the PDA is not vault property. Apply the same rule in the second loop.
  - Lamports: tolerate a small residual (a fixed dust bound) instead of exactly 0. Any deposit larger than the bound costs the griefer real money each time.
  - Add the race arm to the suite.

### R1-2 (unmeasured, LOW until measured)

No arm puts owner-added Core plugins on a vault. The question is whether an owner-managed `FreezeDelegate` (frozen) on the vault at the head of the FIFO makes `reveal_level`'s `UpdatePluginV1` fail. If Core rejects it, the whole level queue stalls permanently, and the queue is global. I have not verified Core's behaviour. Evidence either way: add the plugin to a queued vault and call `reveal_level`.

### R1-3

I found no fault in the pairing: asset at index 0, owner at index 2, both mirrored. I checked CPI wrappers, two vaults in one transaction, and a burn before its open. The `retire_redeemed` stack-height path is correct, but only its first leg is tested (P.23 at top level). The second leg, a CPI wrapper beside a real `burn_vault`, is still untested, as round 22 noted.

---

## R2 and R2b. Pool and $CBOB boost

### R2b-1 (MEDIUM): one 10.7% vote can erase the Schedule of Vaults, and nothing prices the boost

- **Construct.** `set_boost_terms` and GOV `SetBoostTerms` accept any `price > 0`, so one base unit is legal. The launch file sets `max_boost_weight = 12` (the program maximum) and `max_boost_epochs = 24`.
- **Effect.** A vote that passes at quorum 21% and threshold 51% (so about 10.71% YES) can make weight +12 for 24 distributions cost almost nothing. That is 7× a Level I and 3× a Level V.
- **Atomic timing.** The coalition can run `execute_proposal`, then `boost_vault` on all its vaults, then `distribute(burn)` in one slot or bundle, before anyone can react.
- **Contradiction with the documents.** SPEC says "a Level V vault receives exactly three times a Level I" and that a vote cannot touch payouts or vaults. HOLDER-GUIDE says the same ("cannot … touch any vault").
- **$CBOB trust gap.** `initialize` pins the $CBOB mint but checks neither its mint authority nor its supply. Whoever can mint $CBOB can buy boosts without limit once terms are on. `cbob_mint` is still OPEN in the launch file.
- **Evidence.** A suite arm that proposes `actBoost(1n, 12, 24)`. It passes creation today, so it already shows the reach.
- **Fix before the lock.**
  - Initialize a small `max_boost_weight` (about 1–2).
  - Add an on-chain minimum boost price (a new `initialize` bound).
  - Require the $CBOB mint authority to be `None` at `initialize` (mint the supply first and revoke), or document it as a trust assumption.

### R2b-2 (MEDIUM/LOW): boosts are measured in distributions, and distributions are spammable

- **Construct.** The `distribute(burn=true)` path has no minimum interval or size. It needs 100 $GARY (about $9) plus `avail > 0`, and anyone can donate 1 sat to the pool to satisfy that.
- **Effect.** N such calls consume every live boost's N distributions in minutes. The boost is "exact" but can be made worthless by a third party, or timed by its holder to land on one large distribution. Round 22 and SPEC 51 accept only the timing half.
- **Evidence.** Buy a boost with `epochs=2`, then run two `1 sat + burn-distribute` pairs. The vault earns about 0 and the boost is due.
- **Fix.** Count a distribution toward boost epochs only if at least a minimum interval has passed since the last epoch advance. Otherwise disclose it in SPEC 51 and the guide.

### R2b-3 (LOW): `boost_vault` has no slippage guard

Unlike `mint_vault`'s `max_price`, `boost_vault` takes no `max_price`, `min_weight` or `min_epochs`. A ratified `set_boost_terms` that lands between simulate and send burns a different amount under different terms. Execute timing is public and executor-chosen. Fix: add the three guard arguments.

### R2-1 (LOW): a due boost stops ordinary traffic from running the month

- **Construct.** `monthly_inline` returns early with `CBOB_MONTHLY_WAITS_FOR_BOOSTS` while `boosts_due > 0`. Only `expire_boosts`, or a `claim` that names the boosted vault, clears it.
- **Gap.** SPEC 36 and the guide ("the monthly distribution runs itself off ordinary traffic … anyone can run it free") omit this extra precondition. A dead crank plus any due boost halts payouts until someone expires it. It is permissionless but not automatic.

### R2-2: no fault found

- Counters: `pending_count`, `pending_this_epoch`, `waiting_to_join`.
- Join and retire in every state.
- Boost expiry: no double, early or never expiry, and no way for a vault with a missing token account to block expiry.
- Retire of a boosted vault, due or not.
- `reweigh` carry.
- The solvency invariant.

The prompt's invariant "no vault is paid for revenue that arrived before it joined" is false by design (SPEC F2): the next distribution shares everything undistributed in the pool. The guide's "about an hour of extra sales" understates that. It is equal treatment of everyone joined at that distribution, not a theft.

### R6-1 (LOW): `split_revenue` is coupled to the Squads' cbBTC account

- **Construct.** The two `TransferChecked` calls in one instruction mean a frozen or closed Squads cbBTC ATA reverts the 85% inflow to the pool too. The Squads address is permanent and a CPI failure cannot be caught.
- **Not in limit 28.** Limit 28 covers only the pool being frozen.
- **Fix.** Split the instruction into two independent legs, or document it as a limit.
- **Road step 10 gap.** It also creates only the pool and Squads ATAs. The revenue address's own cbBTC ATA is also required before the first paid `mint_vault`. Anyone can create it, but it is unlisted.

---

## R3 to R7

- **R3, entropy.** The parse, skipped-slot handling and determinism are sound (the smallest produced slot at or after the target is final once visible). Limits 25 and 26 hold. The minter chooses the asset address that is mixed into the hash, but only before the hashes exist, so that is no extra grind. A FIFO stall via owner-added plugins is the only open question (R1-2).
- **R4, governance.** The only way a vote reaches payout money beyond the bounds is R2b-1. A minority at 10.71% carries boost terms, rounds and restarts, but not the guardian or swap operator. I found no freeze beyond limit 45.
- **R5, charter claim.** The hot wallet can do more than add a rejecting Oracle. It can move a PoB out of the collection or add a plugin to one asset, which breaks `NotAProofOfBurn` or Core's burn for that PoB. Limit 46 covers the collection-level case, but per-asset is not paged. The `payer` that signs the burn receives the PoB's rent, so it can differ from the owner. I found nothing else.
- **R6, initialize.** `cbob_mint` authority and supply are unchecked (R2b-1). `swap_operator` and `guardian` are not checked for signing ability (a mistake there is permanent). Otherwise the bounds hold. The rolling window is correct.
- **R7.** Offsets match (listed above).

---

## R8. Suite and simulation as evidence

No arm exercises these claims:

- **`SetBoostTerms` ordering.** The `last_boost_id` skip path.
- **Same-transaction cases.** A boost in the same transaction as a distribution (in either order), and a boost on a pending vault.
- **Ring wrap.** `dist_epoch % 64` wrapping, and `epochs = 63`. The suite uses a bound of 10 and a length of 2.
- **Races.** Any dust or claim race (R1-1).
- **Owner-added Core plugins** (R1-2).
- **CPI-wrapper negative** for `retire_redeemed`.
- **Direct `set_boost_terms`** called by a non-governance signer.
- **The simulation** has no boost coverage at all.

Pins that are weak:

- `custom program error: 0x0` (arms 0.1i, 7.7, 7.9, 9.13, S9.1, S9.2) matches any custom code 0, including a token program's `NotRentExempt`.
- RL.7 bounds by the cap computed from `minted_total`, which is looser than the cap at each redemption.

---

## Accepted limits, the four questions

1. **Worse than stated.**
   - Limit 32: R1-1 blocks redemptions without burns.
   - SPEC 51 and the boost timing: R2b-2.
   - The Squads freeze: R6-1 is not in limit 28.
2. **Not really a limit.** None found.
3. **Not discharged.**
   - DISCHARGED 12 says a transaction that fits "cannot run out of compute". Item 54 shows the crank-carrying mint needs 518,929 CU and fails under the default 200,000. The closure text is stale for v6.
4. **Quietly treated as accepted.**
   - Items 9 and 44 (destroyed airdrops and nested vaults) are ACCEPTED, but their only control is OPEN AND BLOCKING item 50, the redeem page, which is not built. Until it exists they have no preventive control.
   - The dust race (R1-1) would share this status.

---

## Documents that disagree with the code

- SPEC "Cross-program wiring" says MINT config 5, GOV 3, VaultRecord 3. The code says 6, 4, 4.
- GOV's `TooManyActions` message and SPEC say "four actions". `MAX_ACTIONS` is 5.
- SPEC's Schedule section still says the $CBOB level-up is "not built".
- HOLDER-GUIDE promises, in present tense:
  - "The redeem page offers this and does the steps for you."
  - "Only open your vault on the Bank's redeem page."
  - "Every opening is announced on X."
  - "Payouts … at least once a month."
  
  None of these is guaranteed or built.
- The guide's "The Bank's pages show it" refers to a Bank that no longer exists.
- The guide says "Only you can open it … a gift only ever adds to that vault's share" but does not mention dilution of others or the dust race.

---

## Given no human firm and immutable programs, what to do before launch that AI audit cannot

1. **Run property-based and stateful fuzzing** (Trident or an equivalent) over random operation sequences on a local validator. Assert after every step: pool ≥ ceil(owed), the counters equal a recomputation from records, and boost totals equal the ring plus due. Seeing the invariants hold under adversarial sequences is evidence a reader cannot give.
2. **Run a paid adversarial rehearsal** on throwaway ids with real money. Pay people to grief it: the dust race, distribution spam, boost sniping, charter-window games, and a funded Coinbase-style freeze drill. Use a time-boxed bounty, not another model round.
3. **Test the real clients.** Redemption transactions must be built and signed with real wallets (Phantom, Ledger blind-signing) and a real marketplace listing, including compute-budget handling and the two-transaction ATA step.
4. **Do a reproducible, verifiable build.** Use a verified-build tool, and have an independent party reproduce the deployed bytes. Do a key ceremony for `INIT_AUTHORITY` and the guardian, with a recovery plan.
5. **Hold a staged burn-in before removing the upgrade authority.** Run low supply caps and a fixed observation period, with a pre-agreed written criterion for "remove". A bug under immutability is permanent.
6. **Get an economist's review of the boost and distribution design** (R2b-1, R2b-2, backlog sharing), and have a lawyer review the holder promises.
7. **Run incident drills.** Rehearse a Core upgrade, a cbBTC freeze, a guardian-key loss, and a crank outage with the dead-man alarm firing.