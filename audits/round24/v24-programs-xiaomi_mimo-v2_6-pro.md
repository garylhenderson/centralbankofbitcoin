# INDEPENDENT SECURITY AUDIT — v6, round 24

Method: every claim below is derived from the code in the bundle. For each I name the evidence that would exist on chain or in a test run if I am right, so it can be checked before anything is changed. Where I could not verify something because the file was not in the bundle, I say so rather than reasoning around it.

---

## R1. CUSTODY

**The pairing holds.** I attacked it in both directions and could not break it.

- `open_for_redemption` walks **forward** from `current + 1` over top-level instructions only, binding `BURN_PROGRAM_ID`, the `burn_vault` discriminator, `accounts[0] == asset`, `accounts[2] == owner`. `burn_vault` walks **backward** over `0..current` binding `SEAL_PROGRAM_ID`, `open_for_redemption`, `accounts[0]`, `accounts[2]`. Account indices match the structs (`BurnVault`: 0 asset, 1 collection, 2 owner; `OpenForRedemption`: same). Order-inversions, cross-asset borrows and cross-owner borrows all fail closed in one half or the other.
- A `burn_vault` hidden in a CPI is invisible to both walks (`load_instruction_at_checked` sees top level only), and a wrapped `open` reports the wrapper's index, so neither half can be satisfied from below. `retire_redeemed` adds a third wall (`get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1`). Round 23's WR.1–WR.4 measure exactly this with `tests/cpi-wrapper`; I could not construct a fourth shape.
- Emptiness: PDA lamports == 0; every reserve mint's **both** ATA derivations must be *declared*; undelegated (three field checks in both the reserve loop and the generic loop); exactly 165 bytes; amount 0; no declared account a live `AssetV1`. A declared-but-absent account is `system`-owned and `continue`s, which is correct (it holds nothing).

**F-1 (LOW) — `burn_vault` requires the reserve ATAs to be *empty*, not *closed*, so an unclosed ATA strands its rent forever.**
`programs/cbob-vault-burn/src/lib.rs`, the reserve loop: it checks `amount == 0` and never reads the account's lamports. After Core `BurnV1` nothing can ever sign for the asset-signer PDA again (measured fact 4), so `CloseAccount` is impossible afterwards. A redemption client that transfers the balance out and forgets `close` lands cleanly and leaves ~2,000,000 lamports of rent per reserve ATA (three of them) behind a burned asset. *Gain:* nothing to an attacker; it is the redeemer's own loss, and 9.14's 1,153-byte sizing assumes the close instructions are present.
*Evidence:* redeem with `close=false` on all three sweeps; the burn lands (`CBOB_REDEEMED`), `burned_total` increments, and the three ATAs still exist with `amount 0` and their full rent, owned by an unreachable PDA.
*Fix:* either `require!` each declared reserve ATA to be absent **or** `lamports() == 0`, or state in the item-50 client contract (and add a suite arm) that every swept ATA must be closed in the same transaction. Cheapest is the arm plus one line in HOLDER-GUIDE.

---

## R2 / R2b. THE COMMUNITY POOL AND THE $CBOB BOOST

**The solvency invariant holds, inductively.** I re-derived every transition rather than trusting P.32:

| transition | balance | `owed_scaled` | `ceil(owed)` | holds |
|---|---|---|---|---|
| `credit` | unchanged | `+ delta*w`, `delta = floor(avail*ACC/w)` so `delta*w ≤ avail*ACC` | `≤ old + avail = balance` | yes |
| `claim` | `- pay` | `- pay*ACC` | `- pay` exactly | yes |
| `retire` (return / forfeit) | unchanged | `- pending` | falls | yes |
| `reweigh` / `expire_boost` | unchanged | unchanged (owed moves to `carry`, debt restarts) | unchanged | yes |

`owed_of` can never underflow: `acc_scaled` is monotonically non-decreasing and every write of `debt_scaled` is `weight * acc` at the *current* acc, with the residual parked in `carry_scaled`. `PoolShort` is unreachable. Nothing but `claim` transfers out of the pool, signed by `[CONFIG_SEED]`.

**The boost ring is exact.** `end = dist_epoch + epochs` with `epochs ∈ [1, 63]`; `advance_epoch` consumes slot `dist_epoch % 64` after incrementing; since `end ≤ purchase + 63`, the first epoch with `end`'s residue is exactly `end`, so no live boost's slot is ever consumed early or by another boost. `unschedule_boost` splits due vs scheduled correctly in both `expire_boost` and `retire`. `reweigh` preserves `owed` exactly (`after*acc + owed - after*acc`). I could not find a state in which `boosts_due`, `boosts_active`, `boost_weight_total`, the ring and `total_active_weight` disagree. A boost earns exactly N distributions, including when bought in the same transaction as one (BO.21/BO.21a).

**F-2 (NOTE, not a bug) — the invariant the prompt asks me to prove is not the implemented one, and SPEC already says so.**
The prompt states *"no vault is ever paid for revenue that arrived before it joined."* That is false by design and SPEC:1224-1232 says so in as many words ("It is NOT 'a vault never earns from revenue that arrived before it joined'"). The property that **is** implemented and proven is **"no vault is credited by a distribution that ran before it joined"** — `join` sets `debt = w*acc` at the accumulator as it then stands, and P.17a/P.17b/3c.A6a pin it both ways. Do not let a later round "fix" this into the stronger claim; that would change the product.

**Counters are consistent.** `pending_this_epoch` is zeroed by `advance_epoch`, and `join` deliberately does not decrement it (the vault can only join in a later epoch). `retire` of a pending vault decrements it only when `request_epoch == dist_epoch`, which is the only case it is non-zero. `waiting_to_join = pending_count - pending_this_epoch` cannot be inflated or drained. I could not construct a distribution deadlock: every state that blocks `JoinWaitingFirst` is cleared by a permissionless `activate`/`claim`/`retire_burned`, and `tick` is reachable whenever there is anything to join.

---

## R3. THE LEVEL DRAW

Parsing is defensive and fails closed (key pinned, count bounded at 512, length checked, all-zero hash refused). Skipped-slot handling, the FIFO, a burned head-of-queue (attributes deliberately unchecked for a burned asset so the queue cannot stall on unrecoverable provenance) and the attribute re-supply hash all check out. L.23's independent replay of every draw against the census is real evidence.

**F-3 (MEDIUM, buyer-facing) — accepted limit 26 is materially WORSE than HOLDER-GUIDE states. Not "nudge"; "choose."**
*Construct:* `try_capture` — `r = u64le(sha256(hA‖hB‖hC‖asset)[0..8]) % total`, walked across the remaining census. hC is the blockhash of C's slot. The leader of that slot (a) knows hA and hB before its slot starts (public), (b) knows every `reveal_slot` and so every asset in the cohort at mint time (the leader schedule is public and `reveal_slot` is `mint_slot + 16`), (c) chooses the block's contents, and (d) can enumerate candidate blocks **offline** for the whole slot before publishing one. Each candidate is an independent draw. For a 5% Level-V remainder, 256 candidates give P(success) > 0.99999. So the C-group leader can deal chosen levels to an entire mint-slot cohort, limited only by the remaining census and its grinding budget.
*What the documents say:* SPEC 26 says "can **bias** the draw within one slot's time"; HOLDER-GUIDE says "the validator producing one of those blocks can **nudge** the result for vaults created in the same moment." Both understate. "Nudge" is the sentence that will appear on the website.
*Evidence:* a script that takes `(hA, hB, [asset keys], census)` and enumerates candidate `hC` values, printing the best achievable assignment; and on a test validator, the same block with one memo varied, showing the blockhash — and therefore the draw — moves. If the script cannot find a better-than-chance assignment within a realistic candidate count, my claim is wrong and the limit is correctly stated.
*Fix:* no code change is possible (accepted). Change HOLDER-GUIDE's honest list to: *"the validator that produces one of those blocks can choose the level of every vault minted in the same slot, within the quotas still left. Nobody else can."* and change SPEC 26's "bias" to "select." This is a truthfulness fix to a BUYER-FACING document.

**F-4 (evidence gap, LOW) — "a boost earns EXACTLY N distributions" is argued for general N and exercised only at N=2.** BO.10/BO.11/BO.14 cover N=2 end-to-end, BO.21a covers N=2 with one in the purchase transaction, and the host test covers the ring's wrap over 1,000 synthetic epochs. Nothing runs N=24 against real state. Given that `max_boost_epochs` on mainnet is 24 and item 51 is the newest money code, add one arm at `epochs = MAX_BOOST_EPOCHS_BOUND` (63) ticking 63 distributions, asserting the boost is due at exactly 63 and that `books()` holds at every step. *Evidence today:* the host test's model agrees with `advance_epoch` across 1,000 epochs — good, but it is a model, not the program.

---

## R4. GOVERNANCE

One vault one vote bound to the asset (`VoteRecord` at `["vote", proposal, ASSET]`), electorate frozen at `index_snapshot`, live-supply divisor that can only be **higher** than the true electorate (a bare burn not yet retired still counts — strictly harder to pass, never easier). Quorum/threshold/turnout arithmetic is correct; the 10% turnout cannot bind at 21%/51% (limit 35, correctly stated). Key changes need `ceil(50% of snapshot)` and can never share a proposal with the other. `TightenSweep` is monotone and bounded by `initialize` values, and GOV's creation checks imply MINT's execution checks (I verified each implication chain). `CBOB_ACTION_SKIPPED` ordering marks are per-kind and a superseded-but-over round still moves the mark (3c.R1).

I could not find a minority that carries what it should not, a vote that reaches money, or a freeze other than limit 45 (all vaults redeemed).

**Cross-check of every raw offset (R7), recomputed from the structs:**

| read | pin | recomputed | ok |
|---|---|---|---|
| MINT `minted_total` | BURN/GOV 141..149 | 8+1+32+32+32+4+8+8+8+4+4 = 141 | ✓ |
| MINT `bare_burns_retired` | BURN/GOV 454..462 | +8+8+32+2+1+1+32+32+8+1+8+8+8+20+20+8+32+32+32+8+8+4 = 454 | ✓ |
| MINT `charter_closes_at` | GOV 442..450 | 454-12 | ✓ |
| MINT stops / stop times | 191, 192, 518, 526 | ✓ | ✓ |
| MINT tighten bounds | 631, 639, 647 | ✓ | ✓ |
| MINT boost bounds | 711, 712..714 | ✓ | ✓ |
| BURN `burned_total` | GOV 42..50 | 8+1+32+1 = 42 | ✓ |
| VaultRecord `mint_index` | GOV 41..49 | ✓ | ✓ |
| SEAL collection / reserves | 9..41 / 41 | ✓ | ✓ |

Account spaces also reconcile: MintConfig fields end at 1005 + 256 = 1261 (matches the expression); VaultRecord fields end at 211 + 10 = 221, matching the documented 221 bytes / 2,429,040 lamports at mainnet rent; BurnConfig 571 + 256; SEAL 142 + 256. `Proposal`'s `space = 259` exactly equals the worst case only if five actions each took the 37-byte `Brakes` shape, which `DuplicateAction` forbids; the real worst case is 205, so there is headroom — no allocation bug.

---

## R5. THE CHARTER CLAIM

Merkle leaf/node domain-separated (0x00/0x01), pairs sorted, `MAX_POB_PROOF = 16` bound. Identity by address, not name, so the hot wallet's "Proof of Burn #241" is refused (C.8). The PoB is CPI-burned as its owner in the same instruction; `pob_extra` accounts pass through with `is_signer: false`. One leaf = one claim, because a burned address cannot be re-minted (measured fact 7).

No third party can cost a holder their claim except the two already recorded: a **rejecting** external plugin on the Moments collection (limit 46, ruled) and packet size (limit 46's four-account measurement). A PoB holder can only burn their own coupon without claiming, which is their own loss.

---

## R6. ONE-TIME CONFIGURATION AND THE TRUSTED HOP

**F-5 (MEDIUM) — SEAL's `initialize` validates less than its own documentation claims, and validates nothing about the collection at all.**
*Construct:* `programs/cbob-vaults/src/lib.rs` — `initialize(collection: Pubkey, reserve_mints: Vec<Pubkey>)`. The collection arrives as a bare `Pubkey` with **no account, no owner check, no `Key::CollectionV1` check**; and `assert_classic_spl` checks only `*acc.owner == SPL_TOKEN_ID`. It never reads the account's length or its `is_initialized` byte. The function's own doc says *"every reserve mint must be owned by it — see `assert_classic_spl`, which … reads the MINT, never a balance"* — it does not establish that the account is a mint. A **token account**, or any SPL-owned account, is accepted as a reserve mint.
*What an attacker / an accident gains:* at burn time BURN derives `[pda, token_program, that_address]` for each reserve and `continue`s when nothing is found, so the emptiness proof for that reserve is **vacuous**. If `reserve_mints[1]` were the wrong address, a vault holding real $GARY would burn cleanly and the $GARY would be destroyed — precisely the loss the reserve list exists to prevent, and the one the code's comments call "the single config value that can strand every vault at once." Separately, a wrong `collection` value writes a config that MINT then refuses (`WiringDiverged`) forever; after the upgrade authority is removed that is unrecoverable, though road step 10 runs before step 11 so it is caught in time.
*Evidence:* on a local validator, `initialize` with `reserve_mints = [cbBTC, ata(alice), giraffish]` **succeeds**; a subsequent `burn_vault` declaring only the cbBTC derivations lands while the vault still holds $GARY. And `initialize` with `collection = <any 32 bytes>` succeeds with no collection account in the instruction.
*Fix (one line each, only possible before the lock):* in `assert_classic_spl`, `require!(d.len() == SPL_MINT_LEN && d[45] == 1)`; and give SEAL's `Initialize` a `collection: UncheckedAccount` requiring `owner == MPL_CORE_ID && data[0] == KEY_COLLECTION_V1`. Note this sits **inside** accepted limit 38, and `scripts/check-launch-params.mjs` does refuse a wrong ruled value before signing — so this is a defence-in-depth gap in the program, not an unaccepted hole. It is MEDIUM because the programs are immutable and the doc string promises more than the code checks.

Everything else in R6 holds: the royalty is installed with `PluginAuthority::None` and R.5/R.6/R.6a/R.6c prove on a control collection that Core refuses both update and removal from the update authority. `sweep_sol_for_swap` is operator-signed, capped, cooled down, reserve-protected, stoppable. The rolling window is exactly a 64-slot ring of timestamps with the k-th most recent compared against `redeem_window_secs`, initialised to zero so the first `k` land; `k = min(ceil(2.1%·live), 64)` is stricter than the target above 3,047 live and never looser, and at 2,100 the ring never binds.

---

## R8. THE SUITE AND THE SIMULATION AS EVIDENCE

**F-6 (LOW) — round 23's repair of F22 was half-applied; the RL.7 half is still open.**
Round 23's verdict, F22, recommended: *"Make RL.7 replay the cap at each redemption's own live supply."* `tests/3prog.test.ts` still computes `capMax` from `minted_total` — the largest live supply there has ever been — and asserts `worst ≤ capMax`. At a live supply of 40 the true cap is 1 while `capMax` at 2,100 is 45, so a window holding five redemptions would still report `true`. The arm's text now discloses the looseness ("looser than each redemption's own cap; RL.1-RL.6 pin that exactly"), so it is honest, but the recommendation stands undone and the arm cannot fail for the reason it names. *Evidence:* the arm's own `want` string versus its computation. *Fix:* stamp `live` at each ring write (or replay `cap` from the config history) and assert per-redemption. The other two F22 sub-fixes **are** in (the `0x0` pins now carry the failing program id, 9.13 is pinned to the System program's code).

**F-7 (LOW) — round 23's F1 repro arm is still absent, and F1's only control is item 50.**
F1 (MEDIUM, confirmed) is the deposit race against an exact-amount sweep. The SPEC text was rewritten correctly, but the arm the verdict asked for — *build an exact-amount redemption, land 1 base unit of a reserve token into the vault's ATA, then send → `VaultNotEmpty`* — is not in the suite. 3.11 (`VaultNotEmpty` via a partial sweep) and 9.10 (a stranger's lamports) are different shapes. *Fix:* one arm, plus the paired positive arm through the sweep-at-execution helper once item 50 exists.

**F-8 (INFO) — arm 5.2's title claims a property the arm does not test, and the bundle cannot show the `bank/` side at all.**
5.2 ("mint a vault owned by a PDA that can never sign") passes `ownerSigns:false` and is refused `AccountNotSigner`; the `because` pin correctly names `AccountNotSigner`, so the pin is honest, but the title is the claim a later reader will trust. SPEC:371 already admits this. Separately, and more important: **`bank/layout.mjs`, `bank/accrual.mjs`, `bank/crank.mjs`, `bank/detectors.mjs`, `bank/selftest.mjs`, `bank/alarm.mjs`, `scripts/build-mainnet.sh`, `scripts/check-launch-params.mjs`, `scripts/audit-coverage.sh`, `scripts/rehearsal-tree.sh` and `sim/run-sim.sh` were not in this bundle.** Every AUTOMATIC row of the control table, the mitigation behind limits 7, 8, 9, 10, 13 and 56's pinning, the 560/39/22/14/33/24 assertion floors and the Test Vault's floor are therefore **asserted here only by the test file's imports at runtime**. I could not read them, so I am not certifying them. That is an evidence-scope statement, not a finding.

Arms that genuinely cannot fail: I looked for these specifically at round 22's behest and found the mechanism sound — `floor()` now requires the count to **EQUAL** the floor, `MIN_ASSERTIONS=748` is hard-coded and unswappable, and precondition failures (WR.pre, BO.pre, P.8a) either turn the run red or record a `NO-CANDIDATE` string that mismatches. X.7 is now honest about showing an empty queue.

---

## THE FOUR QUESTIONS ON THE ACCEPTED LIMITS

**1. Is any limit WORSE than stated?**
Yes, one, and it is buyer-facing: **limit 26** — see F-3. SPEC's "bias" and HOLDER-GUIDE's "nudge … slightly" both understate a C-group leader's power to *select* levels for a whole mint-slot cohort. Every other limit I checked is stated accurately or already corrected (36's due-boost clause, 55's unbounded-on-chain clause, 27's +12, 46's four-account measurement, 28's Squads-freeze clause are all current). Limit 32's "stricter, never looser" is arithmetically correct.

**2. Is anything listed as a limit not actually a limit, already closed, or closed by something unnoticed?**
No. I checked each for a closure the authors missed and found none. One nuance worth recording: limit 25's "one re-roll per full window of total silence" is exactly right — `RescheduleTooEarly` requires `now > reveal_slot + 300`, and capture works through `reveal_slot + 300`, so there is no gap at the boundary.

**3. Is any DISCHARGED item not actually discharged?**
No. 12/17 is correctly re-scoped with its own caveat, 14/19/30/31/33 are genuinely closed on chain or by construction, and the v5 family went with the Bank.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**
The reverse, and it is a list-integrity defect: **F-9 (LOW) — items 51 and 53 are DONE and still sit in OPEN AND BLOCKING.**
*Construct:* SPEC's OPEN AND BLOCKING section, whose stated rule is "must be done before anything mints and must not be quietly demoted to accepted … an item is in exactly one of them." Item 51's own text reads "DECIDED AND BUILT" and cites suite section BO and init arms 0.1o–0.1v. Item 53's own text reads "Proven 2026-10-04 at `d57ee3a`: the FULL `scripts/run-tests.sh` passes inside the rehearsal tree at throwaway ids."
*What is gained:* a reader scanning the blocker list cannot tell what is actually left, which is exactly the failure mode the three-state rule exists to prevent (limit 17 sat in this section for five rounds).
*Evidence:* the text of 51 and 53, against the section header.
*Fix:* move both to DISCHARGED with the reason named, leaving **22, 38, 50, 52** and 54's holder-page half as the real blockers. Nothing in this list is being treated as accepted.

---

## GIVENTHAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE: what should this project do before launch that AI audit structurally cannot?

1. **Measure the two findings that are currently arguments.** F-3 (level selection by a C-group leader) and F-1 (the deposit race) are reasoning, not runs. Commission a *writing* red-team — one that is allowed to deploy a validator, hold the leader key, and try to win — and measure both. If the grinding script cannot beat chance, my finding is wrong and the documents stand; that is the outcome worth paying for.
2. **Run the whole system at production values, once, watched by a human.** Item 22's dress rehearsal is necessary but not sufficient: it exercises I/O, not timing. Run a real redemption **hour** at `redeem_window_secs = 3600` with a 45-cap burst, and a real **month** boundary at `monthly_secs = 2,592,000` arithmetic. Nobody has ever watched the queue actually drain.
3. **A human key ceremony, witnessed.** The swap operator key (`bank/keys/swap-operator.json`), the $CBOB release wallet key (`bank/keys/cbob-release.json`, limit 56) and Gary's guardian key should be generated and stored in front of witnesses, with every copy on this box and in the R2 backup deleted or moved to a multisig. Limit 56 is the single largest unearned trust in the system and it is a file on a disk.
4. **Read HOLDER-GUIDE.md aloud as a contract, by someone who will be liable if a sentence is false.** It is the source for the website and the claim page. "The validator … can nudge the result" (F-3), "Only open your vault on the Bank's redeem page" (a page that does not exist, item 50), and "Every opening is public" (no sender exists) are three sentences that will be published before the code that contradicts them is noticed.
5. **Pre-decide the three events the code cannot respond to**, with a named human and a decision already taken: *Coinbase freezes the pool* (stop selling? wait? tell holders what?), *the Moments hot wallet adds a rejecting hook* (the charter window is 7 days and cannot reopen — what is the public message on day 1?), *Metaplex upgrades Core* (who decides whether to keep the pinned hash?). In each case the programs can do nothing and the answer must not be invented while it is happening.
6. **Give `bank/` and `scripts/` to a reader who can execute them.** This bundle did not contain them, and they carry every mitigation that is not on chain: `bank/layout.mjs` (the offsets written down a second time), `bank/crank.mjs`, `check-launch-params.mjs`, `build-mainnet.sh`. Those four files decide whether limits 38, 22 and the whole alarm layer are real. They are as load-bearing as any program and have never had this treatment.
7. **Decide limit 43 before the lock, and say the answer in the guide.** The stack-height check on `mint_vault` is the only on-chain way to stop a vault being minted to an address that can never redeem it. It can only be added before the programs freeze. If it is not built, the guide must say, in the same plain words it uses elsewhere, that a vault sent to a multisig or a DAO is gone.
8. **Watch one real charter claim land on mainnet**, from a real holder's wallet, with a real Proof of Burn and a real Merkle proof from `scripts/pob-set.json`, before the charter clock starts. That path has a 7-day window that can never reopen and no stop reaches it (limit 48). It is the one instruction in the system where being wrong is unrecoverable and undiscoverable until it is over.