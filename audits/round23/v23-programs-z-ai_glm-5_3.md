# Round 23 — Independent audit of the v6 tree, whole

I read every line of the four programs, recomputed every cross-program offset and account space from the struct definitions, replayed the pool arithmetic by hand, and checked each suite arm I rely on. Where a claim of mine is contradicted by a measured run in the suite, I say so and drop the claim — that happened twice (noted inline), and both times the suite was right.

---

## R1. CUSTODY — the seal, the pairing, the emptiness proof

**No finding.** What I verified, and the evidence basis for each:

- **The pairing, both directions, asset AND owner.** SEAL's forward walk (`open_for_redemption`) and BURN's backward walk (`burn_vault`) both match on program id, discriminator, account 0 (asset) and account 2 (owner). Two redemptions in one transaction in every interleaving (open A/open B/burn A/burn B; open A/burn B; cross-owner) fail the binding — arms 3.9, 3.10, 4.10, 4.10a, 9.0.
- **CPI wrappers.** `load_instruction_at_checked` sees top-level instructions only, so a CPI'd open reports the wrapper's index and cannot satisfy BURN's backward walk, and a CPI'd burn cannot satisfy SEAL's forward walk. `retire_redeemed` additionally requires `get_stack_height() == 1` (a direct CPI from a top-level instruction) *and* that the current top-level instruction be BURN's `burn_vault` with this asset at account 0 — so a wrapper cannot reach the retire even if it reaches the burn. I note that **this defense has never been executed against an actual wrapper program** (round 22 recommended the test; it was not built) — see the closing section.
- **The 6-AccountMeta / 5-AccountInfo CPI shapes** (charter claim's and BURN's Core `BurnV1`). I initially read this as a metadata mismatch and nearly filed it. It is disproven by measurement: every charter claim and every redemption in the suite and the simulation runs this exact shape against the pinned mainnet Core build. The claim is about my own reconstruction of `invoke`'s resolution rules, not about the code. Dropped.
- **The emptiness proof.** The reserve loop derives both token-program ATAs per reserve mint and refuses undeclared, non-PDA-owned, delegated (COption tag at [72..76], delegated amount at [121..129]), close-authority-set ([129..133]), extended (len ≠ 165) or non-empty accounts; the second loop applies the same checks to any declared PDA-owned token account; PDA lamports must be zero; declared live Core assets refuse. The SPL offsets are correct against the 165-byte layout. A declared account owned by someone else correctly passes (it is not the vault's). Undeclared holdings remain invisible — proven impossibility 2, accepted limits 9/44.
- **A thawed vault leaving a transaction unburned.** Impossible: the thaw is a state write in the same transaction as the required burn; a failed burn reverts the thaw.
- **The rate ring.** I proved the rolling-window claim: if redemption *t* lands, the check requires *t* − *t*<sub>j</sub> ≥ window where *t*<sub>j</sub> is the k-th most recent before it; therefore no window of length `redeem_window_secs` can contain cap+1 redemptions. `rate_head` is stored mod 64 and re-masked on read; the ring is zero-initialized so the first cap redemptions land. The cap is bounded above by `ceil(minted_total × 2.1%)` since live ≤ minted_total.

## R2. THE COMMUNITY POOL

**No new finding.** Both invariants hold:

- **"The pool always holds at least ceil(owed)":** `credit` adds `delta·w ≤ avail·SCALE` to `owed_scaled` where `avail = balance − ceil(owed)`, so `ceil(owed_new) ≤ ceil(owed_old) + avail ≤ balance`; `claim` decreases balance and owed by exactly `pay` and `pay·SCALE`; every retire subtracts the vault's `owed_of` from `owed_scaled` while leaving the balance. `owed_of ≥ 0` always (debt is only ever set to `weight·acc` at join/claim/reweigh, acc only grows, carry ≥ 0). `distribute` refuses `PoolShort` defensively.
- **Counters under every ordering.** `pending_this_epoch` is deliberately *not* decremented at join (it is epoch-scoped and reset in `advance_epoch`), so `waiting = pending_count − pending_this_epoch` is exactly the eligible set in every interleaving I could construct, including request → epoch advance → second request → join, and the retire paths (same-epoch and earlier-epoch), which arm F21 exercises.
- **Liveness.** Both distribution gates (`JoinWaitingFirst`, `BoostsExpireFirst`) are clearable by anyone with no prerequisites (`claim` joins; `expire_boosts` needs only records). The frozen-account redemption block is limit 28, stated.

One clarification the round brief should carry forward: the brief's phrasing of the invariant as *"no vault is ever paid for revenue that arrived before it joined"* is **not** the code's rule and SPEC already corrected this (round 22, F2): the guarantee is *never credited by a distribution that ran before it joined*; revenue already in the pool when a vault joins is shared by everyone joined at the next distribution, the new vault included. That is the launch-tick's purpose.

## R2b. THE $CBOB BOOST — the newest code

The mechanism itself survives everything I could throw at it:

- **Exactly N distributions.** A boost bought at epoch e ends at e+N; `advance_epoch` moves its ring slot to `boosts_due` exactly when the epoch reaches e+N (the Nth distribution); the gate refuses the (N+1)th. The one thing that could shorten it — an empty `tick` advancing the epoch without a distribution — cannot run while any boosted vault exists, because a boosted vault is active with weight ≥ 3, and `tick` requires `total_active_weight == 0`.
- **Nothing lost or gained on weight change.** `reweigh` sets `carry = owed_old`, `debt = new_weight·acc`, so `owed_of` is invariant; `owed_scaled` is untouched. Verified in the arithmetic and by BO.7c.
- **The totals agree.** Every mutation site (`boost_vault`, `advance_epoch`, `unschedule_boost`, `expire_boost`) moves counts consistently between `boosts_active`, `boosts_due` and the ring; two boosts sharing an *end epoch* is fine (the slot is a u32 count), and two *distinct* end epochs cannot collide mod 64 because `max_boost_epochs ≤ 63` and a slot is zeroed the moment `dist_epoch` passes it.
- **No double/early/never expiry.** Expiry requires `dist_epoch ≥ boost_end_epoch` and zeroes `boost_weight`; the gate guarantees no distribution runs past a due boost; `expire_boosts` needs no token account, so a missing or frozen destination cannot wedge the gate (the frozen path in `claim` stores the record *before* deferring, so claim-based expiry also lands).
- **Retire in either state** unschedules from the right place (due vs ring), arms BO.16/BO.17.

### FINDING 1 — MEDIUM — the $CBOB mint's authorities are neither checked at `initialize` nor ruled anywhere, so the boost's voted price is unenforceable against the mint authority holder

- **Construct:** `programs/cbob-vault-mint/src/lib.rs`, `initialize`'s cbob block — it reads only `owner == SPL_TOKEN_ID`, `len == 82`, `d[45] == 1`, `≠ payment_mint`, `≠ GARY_MINT`. The SPL mint layout puts the `mint_authority` COption tag at bytes [0..4] and `freeze_authority` at [46..50]; neither is read. `launch/mainnet-init.json`'s `cbob_mint` is OPEN with the policy "made before launch with nothing released" and no ruling on authorities. DESIGN-v6 §3 and item 51 rest the boost's safety on the burned price.
- **Gain:** once a vote switches boosts on, whoever holds (or steals) the $CBOB mint authority mints $CBOB freely and the voted `boost_price` bounds nobody. Two consequences: (a) **free pool extraction** — the authority holder boosts their own activated vaults up to +12 weight for up to 24 distributions per purchase, taking real cbBTC out of every distribution at zero cost, permanently (no on-chain check can ever be added); (b) **schedule flattening** — boosting *every* activated vault at +12 compresses the holder guide's 1 : 1.5 : 2 : 2.5 : 3 level ratios to roughly 14 : 15 : 16 : 17 : 18, transferring payout share from Level IV/V to Level I/II for the cost of transaction fees. This also contradicts HOLDER-GUIDE's table ("Gary Club … cannot do anything the rules do not allow anyone") and item 51's own disclosure ("a burner is partly bidding for bitcoin their own purchase helped put in the pool") — false for this party.
- **Evidence if I am right:** on chain after launch, the $CBOB mint account's bytes [0..4] read `1 0 0 0` (Some) and no instruction or launch check ever reads them; the launch file's `cbob_mint` entry carries no authority ruling. Both checkable in one `getAccountInfo`.
- **Fix (before the lock, or never):** rule the policy. Either pre-mint the entire supply at creation, revoke mint and freeze authority, and add to `initialize`'s cbob block `require!(d[0..4] == [0;4] && d[46..50] == [0;4])`; or keep the authority and give it the swap-operator treatment — named in SPEC's trust table, bounded, alarmed, replaceable by the half-of-all-vaults vote. Silence is the one unacceptable outcome, because immutability converts it to permanent.

### FINDING 2 — LOW — the boost's ordering and skip claims are unexercised (evidence gaps)

- **Construct:** `tests/3prog.test.ts`, section BO (BO.2–BO.19).
- **What is missing, each of which the round brief explicitly asks about:**
  1. **No arm buys a boost in the same transaction as a distribution**, in either order. `boost_vault` runs `monthly_inline` first (its comment: "a month already due belongs to the weights that earned it") and a boost placed before a `distribute(burn)` in one transaction *earns that distribution* — neither ordering has ever run.
  2. **No arm makes the month due and then boosts** — the monthly-inline-before-boost placement is untested.
  3. **The `SetBoostTerms` superseded skip (`last_boost_id`) is never exercised** — no arm executes an older passed boost-terms proposal after a newer one; the analogous round skip (7.26) is tested, this one is not.
  4. **`expire_boosts` is only ever exercised with a healthy destination** (BO.13a) — the exact case its own comment says it exists for (a vault whose token account is gone or frozen, where `claim` cannot expire it) is never run.
  5. **`IX_SET_BOOST_TERMS` is the one pinned discriminator with no pin arm** — 3.1a–3.1t cover every other cross-program discriminator; the newest one is proven only indirectly by BO.3's execution (which does gate it, but not in the canonical pin form the ship gate's rule 5 asks for).
- **Gain if a defect hides here:** a wrong ordering would credit a distribution at the wrong weight or let a boost earn one it should not; a broken skip would revert a bundle. All fail-closed, which is why this is LOW and not higher.
- **Fix:** add the five arms. Each is a few lines against the existing BO fixtures.

## R3. THE LEVEL DRAW

**No finding; the residual is not worse than stated.** The SlotHashes parse is defensive (id pinned, count bounded, buffer bounds checked, all-zero hash refused); the capture deadline arithmetic closes (A ≤ reveal+64, C ≤ ~reveal+208, window 300, buffer 512); the FIFO is enforced by `revealed_total`; a burned vault at the head still draws (L.11); the reschedule target is a slot that does not exist yet; the attribute re-supply is hash-checked. On "worse than stated": the case where one validator holds A's, B's *and* C's groups (not merely C's) is inside limit 26's own concession ("three different leaders is likely but not guaranteed… nothing on chain can refuse a repeat") — the actor, the knowledge and the one-slot grind budget are the same. I do not file it.

## R4. GOVERNANCE

**No new finding.** The vote binds to the asset via the VoteRecord PDA; the electorate and tally rule are snapshotted at creation; the charter-close gate, quorum/threshold/turnout/half-of-all-live-vaults arithmetic (all ceiling, never zero), the per-kind ordering marks, the logged skips (including the round-already-over mark that moves before the skip, RT3-4), and the `StopIsNewer` tie (stop wins, consistent between GOV's `>=` skip and MINT's `<` allow) all check out. A `Brakes` proposal arming `Some(default)` is equivalent to arming `None` and pays the same supermajority — not a bypass. Governance freezes only when no live vault exists (limit 45, accepted).

### FINDING 3 — LOW — SPEC.md's governance section is stale for the boost: it omits `SetBoostTerms` entirely and says "up to four actions"; GOV's `TooManyActions` message also says "four" while `MAX_ACTIONS` is 5

- **Construct:** SPEC.md, GOV section ("Up to four actions, at most one of each kind: `SetRound`, `Brakes`, `TightenSweep`, `ArmSwapOperator`") and the MINT instruction table (no `set_boost_terms` row); `programs/cbob-vault-gov/src/lib.rs`, `TooManyActions` message. The code has five kinds and `MAX_ACTIONS = 5`; the GOV header comment is correct ("five is every kind at once").
- **Gain:** SPEC is the map handed to auditors. A reader of SPEC alone would not know a ratified vote can switch the boost on and set its price — the one governed action that moves payout shares. This is the project's own named defect class (a control document drifting from the code), in the newest code.
- **Evidence:** diff `ProposalAction` (5 variants) against SPEC's list (4).
- **Fix:** update SPEC's GOV section and MINT table; fix the error string. Also note the suite never builds a five-action proposal (E.3 tests four kinds, E.5 tests six) — the true bound is untested at its edge.

## R5. THE CHARTER CLAIM

The claim itself is sound: identity by address against the domain-separated, sorted-pair Merkle root; the CPI burn as owner in the same instruction; the window by clock alone; `pob_extra` passed through never as signers; a lookalike refused (C.8); a spent leaf unspendable (the address is unremintable, measured). A PoB holder or third party can do nothing to someone else's claim (the owner check is on the asset bytes and the signer).

### FINDING 4 — LOW — accepted limit 46 is wider than stated: the hot wallet can also add a collection-level **burn delegate** and destroy the Proof of Burns outright, a path the pass-through mitigation does not touch

- **Construct:** the Giraffish Moments collection's update authority (the hot wallet, kept by ruling) can call Core's `AddCollectionPluginV1` with a `PermanentBurnDelegate` — the suite's own `dirty` fixture proves the pinned Core build accepts exactly this at collection level — and then `BurnV1` every one of the 240 PoBs in one transaction. Each burned leaf is spent forever (an address cannot be re-minted, measured fact 7). Limit 46 names only "an external plugin that Core consults on every burn"; the `pob_extra` pass-through answers hooks, not delegates. The alarm pages on a collection-plugin change, but that is ≤30 minutes after the fact and one transaction burns all 240.
- **Gain:** the same ruled-trusted actor, the same consequence class as 46 (a bricked, never-reopening charter window), but a *permanent destruction* mechanism the limit's phrasing does not name, and which no shipped mitigation covers.
- **Evidence if I am right:** the `dirty` fixture in `tests/3prog.test.ts` (a collection-level `PermanentBurnDelegate` accepted by the pinned Core) plus Core's delegate burn path; nothing in `claim_charter_vault` or the alarm prevents a delegate burn.
- **Fix:** none exists on chain while the authority stays hot (the ruling). Widen limit 46's wording so the next reader does not discover it, and put "verify the Moments collection carries no delegate plugins" in the charter-open runbook.

## R6. THE ONE-TIME CONFIGURATION AND THE TRUSTED HOP

- **Every `initialize`'s accept/refuse set** was checked against a wrong-but-accepted value list. The sweep bound lattice is closed (floor ≤ cap, cooldown ceiling ≥ installed cooldown, reserve ceiling ≥ installed reserve and ≥ rent, cap in [1, 50] SOL, cooldown in [1 s, 24 h], reserve 0 or ≥ rent); the census must be all-positive and sum ≤ max_supply; the charter window must be future, ordered, ≤ 90 days; the collection must arrive clean, ours, unminted; SEAL must already agree and hold the payment mint as a reserve; BURN must match SEAL's collection; GOV must match MINT's. The ruled launch values all sit inside the enforced ranges. **Finding 1 is the one gap.**
- **The trusted hop's worst case** is as stated (limit 10): cap × cooldown windows until the guardian stops, above the reserve, operator-signed, three-in-one-transaction refused (the first sweep stamps `last_sweep_at` and the second fails `SweepTooSoon` even at the 1-second floor).
- **The 10% royalty:** confirmed immutable from our side — the only collection-plugin CPI in any of the four programs is `initialize`'s one-time add with plugin authority `None`; every later `UpdatePluginV1` CPI is asset-level (freeze, attributes); Core refuses updates and removals under authority `None` (R.5/R.6, measured on a control collection both ways).
- **The redemption cap** is exactly a rolling window over a 64-entry ring of timestamps (proven under R1).

## R7. CROSS-PROGRAM RAW READS

**All correct.** I recomputed every offset from the struct definitions: MintConfig v6 (minted_total 141, bare_burns_retired 454, stops 191/192, stop times 518/526, charter close 442, sweep bounds 257/266/274, tighten bounds 631/639/647, boost bounds 711/712, governance 41, collection 9 — and the full chain 8→1005 with 256 padding, space 1261, matching `MINT_CONFIG_SPACE` term for term); VaultRecord v4 (asset 9, mint_index 41, boost fields 186/187/195, space 221); BurnConfig v4 (burned_total 42, ring at 59, space 827); SEAL Config v2 (collection 9, reserves 41); GovConfig v4 (proposal_count 53, space 350). GOV's, BURN's and the suite's pinned constants all agree with my computation. Every reader pins address, owner, discriminator and version. No silent misread exists.

## R8. THE SUITE AND THE SIMULATION AS EVIDENCE

Beyond Finding 2's gaps, I looked for arms that cannot fail or prove less than claimed:

- The boost arms that look weakest are sound: BO.7c's string comparison is exact once you notice `paid()` adds the extra map on top of `base·k` (I initially mis-added and the arm is right); BO.10b can fail (an early expiry would zero the weight); the `books()` recomputation from every record is a strong cross-check.
- The new `because()` pins for BO.* all name errors the program can actually emit for those shapes.
- The frozen-pool claim pin (`0x11`) and the Core refusal pins are consistent with the green run.
- **One discharge-wording note:** items 12/17's "the byte wall binds more than twenty-five times before the compute wall" was measured on the *padded-mint* path and is now false in general — item 54 itself measured a compute wall (518,929 CU vs the 200,000 default) well below the byte wall on crank-carrying hosts. The list is internally consistent because 54 states it, but 12/17's blanket phrasing should be scoped to the padded-mint path so a later reader does not rest on it.

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?**
- **Limit 46 — yes, wider:** Finding 4 (the burn-delegate destruction path).
- **Limit 32 — marginally, and already accounted for:** the cap's live count includes unretired bare burns, so it can be computed against an inflated live up to `minted_total`; the suite's RL.7 replay explicitly bounds by `ceil(minted_total × 2.1%)`, and `retire_burned` is permissionless with the crank running hourly, so sustained inflation costs the attacker a destroyed vault per unit and is corrected by anyone. Written down, not actionable.
- **Limit 27 — marginally:** a bare-burned *boosted* vault's dead weight is up to 12 larger. Same class, same accepted reasoning.
- **Limits 25, 26, 28, 41, 55 — not worse.** Limit 26's concession already covers a validator holding more than one of the three groups.

**2. Is anything listed as a limit not actually a limit?** No. Limit 43's round-22 note (a top-level-only `mint_vault` would force an on-curve owner) is correctly listed as not-built, not as closed. Limit 35's arithmetic is right (21% × 51% = 10.71% > 10%).

**3. Is any DISCHARGED item not actually discharged?** Items 12/17 are discharged *for the padded-mint path only* — see the R8 note; the discharge should be scoped, not revoked. Items 14, 15, 19, 30, 31, 33 are genuinely closed by the code and arms cited.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 51, 52, 53, 54 all remain open and are not demoted anywhere I can find. One staleness note in the other direction: SPEC's item 38 still calls the sweep cap, cooldown and reserve "PROPOSED, not ruled" while `launch/mainnet-init.json` marks all three RULED (Gary's "2 - yes") — the carry list lagged the ruling; update it so the checker's source-of-truth story stays clean.

### FINDING 5 — LOW — HOLDER-GUIDE overstates the redemption cap: "2.1% of all vaults in any hour" vs the code's 2.1% of LIVE vaults

- **Construct:** HOLDER-GUIDE.md, "Things to know before you open"; `burn_vault`'s cap is `ceil(live × 2.1%)` with live = minted − redeemed − bare-retired.
- **Gain:** after redemptions the true cap shrinks below the guide's number; a holder expecting "about 45 an hour at 2,100 vaults" late in the collection's life waits longer than the guide promises. The guide is the website's source.
- **Evidence:** the live formula in `burn_vault` vs the guide sentence.
- **Fix:** "2.1% of live vaults."

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what this project must do before launch that AI audit structurally cannot

1. **Run the mainnet dress rehearsal, and make it exercise the two things a local validator structurally cannot.** A local validator never skips a slot, so `blockhash_in_window`'s window search, `MAX_SKIPPED_SLOTS`, and the reschedule path have never executed against a real skip; and the crank's I/O against ~2,100 real records (paging, rate limits, the transient RPC error at vault 1,900) has never run (item 22). No amount of reading substitutes for either.
2. **Build the CPI-wrapper adversary round 22 recommended and nobody built.** A throwaway fifth program on the rehearsal validator that CPIs `open_for_redemption`, `burn_vault` and `retire_redeemed` in every wrapper shape. The stack-height check and the instructions-sysvar match are the *entire* defense against wrappers, they are three `require!`s, and they have never been executed against an actual wrapper. This is the cheapest high-value test left in the project.
3. **Make the $CBOB ruling (Finding 1) before the lock.** It is a business decision with a one-line on-chain enforcement if the answer is "pre-mint and revoke"; it is a trust-table entry if the answer is "keep the key". After the upgrade authority is removed, the choice is made forever by default.
4. **Verify the lock with hands, not assertions.** `lock_deadline` is still null. Confirm the deployed bytes against `build-mainnet.sh`'s sha256, and remove all four upgrade authorities *before* `charter_opens_at` — the alarm pages after the fact; nothing prevents a window opening under an upgradeable program except a human doing it in the right order.
5. **Have one human redeem one real vault on the shipped client.** No suite arm runs the shipped client: the prior-transaction ATA creation (item 42), the compute-budget instruction on any crank-carrying transaction (item 54), and claim-before-sweep are all currently client-side obligations with no executed instance.
6. **Fire-drill the alarm from a live cluster.** The detectors are proven in both directions offline; the paging channel, the dead-man's switch, and a human's response time have never been exercised end to end. The frozen-pool and rate-limit scenarios the alarm exists for are only real if the page reaches someone.
7. **Write and rehearse the charter-window runbook.** The window can never reopen: verify the Moments collection's plugin and authority state at open (Finding 4's delegate check belongs here), confirm the claim page sends no crank when `pob_extra > 0`, and have a human watching the first claims.

**Verdict: NOT CLEAN.** One MEDIUM (the $CBOB mint authority gap — decidable and enforceable only before the lock), four LOW, and a set of evidence gaps in the boost's suite coverage that are cheap to close. The custody pairing, the pool arithmetic, the raw offsets and the rate ring all survived a hostile read; the worst thing I found lives in the newest code, which is where this project's history says it would be.