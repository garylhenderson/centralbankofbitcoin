# Round 26 audit: v6 tree at `93d04fe` / `ba67127`, five programs plus the off-chain pieces in the bundle

**How to read this report.**

- Every finding gives the evidence that would exist on chain, or in a run, if the finding is true.
- **"Measured"** means a run in the bundle already shows it.
- **"Read"** means I derived it from the source. I ran nothing. For each read finding I name the arm that would settle it.
- I recomputed every raw offset and account space in R7 by hand. They are listed there and they agree with the code.
- **Summary:** I found no confirmed program defect. I found one Core interaction that is unmeasured and that I can neither confirm nor rule out from source (F1). If it holds, it is the most dangerous permanent liveness bug in the tree. I also found one design coupling that turns a stated accepted limit into an avoidable one (F2).

---

## R0. Round 25's repairs

| Repair | Holds? | Residue |
|---|---|---|
| **N1** | Yes. The host test drives `join`, `reweigh`, `retire` (both `unschedule_boost` branches), `expire_boost`, `credit` and `tick`. It checks every ring slot per index. BO.38 does the same on chain at a wrapped slot. | INFO. The purchase lines are still a *copy* of `boost_vault` (MINT, the `end`/`i` block). If the handler drifts, the test keeps passing against the copy. The real fix is a `schedule_boost` free function, which would change program bytes, so do it only with another program edit before the lock. The host test also never drives `retire(redeemed=true)` or claim normalisation (debt reset, carry). |
| **N2** | Mostly. C7 is fixed by RL.7 stamps. C8 is fixed: P.11a demands a fixed five-level string, 3.7 checks decoded owner and frozen state, S7.4 accepts `{avail, avail-1}`, S7.2! predicts one reason. C9 is fixed by K.7/BO.36, BO.37, S9b, 8.14b and the BK.* labels. The five pins exist: R24.1/1a, R24.2, S9b, BO.35, R24.5. | LOW. RL.7's stamp keeps the *larger* live supply under concurrency, so it overstates the cap and can only miss a violation, never invent one. It is sound but weak exactly where it matters, RL.2's burst. Stamp from BURN's own state instead: emit `live` and `cap` in a `msg!` inside `burn_vault`. That needs a program change, so alternatively parse `burned_total` and timestamps per signature. |
| **N3** | Yes for a stranger, a transfer delegate and the collection UA (on a control asset). SR.5e preserves balances, owner and seal. | INFO. No arm for a Freeze or Burn delegate authority driving Execute. Core's rule in source (owner-only) covers it. |
| **N4** | Yes. Each pin names `Program EB2u… failed: <error>`, so the helper's refusal is distinguished from SEAL, Core or BURN gates. | LOW. **SR.12a** (duplicate source) is pinned to "Provided owner is not allowed", the same text SR.11 produces. The pin does not assert the *absence* of `CBOB_SWEEP refused: source`, so SR.12a would pass if the first pair failed SR.11's check. Add `!err.includes('CBOB_SWEEP refused: source')`. |
| **N5** | Partly. S8.0 asserts `B ≤ 1232−52−96` and S8.1a measures 168,343 CU. | LOW. The "widest page shape" (≈1,209 bytes) is arithmetic on offline deltas. It was never built and landed. See F5 for why 23 bytes of slack is not enough. |
| **N6** | Yes for the helper (`cmp` against `target/deploy`). | INFO. The four other programs' `target/deploy` hashes are only *printed*, not compared to `.cache/ln`, and not written to `dist/MANIFEST.txt`. Persist them. |
| **D1–D9** | Mostly true. | See F7 (D1 wording), F5 (D7 is packet-infeasible as written), F8. |
| **Byte identity** | Plausible. VALIDATION compares a fresh mainnet build to `dist` from `2b67fb1`. Anchor embeds source line numbers in error origins, so "comments preserve line counts" is the correct concern, and an identical hash settles it. | INFO. See F10: the *current* runner (MAINNET_FLOOR=33, new hash log lines) has never run end to end. |

---

## R1 / R1s. Custody and the sweep helper

I attacked the following and found **no break:**

- **Pairing:** CPI wrappers, two vaults in one transaction, v0 with lookup tables (S9b proves the instructions sysvar carries resolved keys), and owner change mid-transaction. Alice opens, transfers to Bob, burns as Alice: BURN reads owner = Bob and refuses `NotTheOwner`.
- **Emptiness:** the delegate, delegated-amount and close-authority COption offsets 72, 121 and 129 are correct.
- **Closed accounts:** a closed classic account is reassigned to System inside the transaction and is skipped for the right reason (SR.4 lands).
- **Stranger-created accounts:** Token-2022 ATAs of classic mints cannot be created (W1, measured). Classic ATAs are sweepable. Non-ATA strays are skipped when undeclared, which is limit 44.
- **Close authority:** a stranger cannot set one, because SetAuthority needs the vault PDA.
- **Leftover lamports:** nothing can leave the asset-signer non-zero after the helper. No instruction the owner did not write runs between it and `burn_vault`. A Core Execute fee, if any, is taken from the payer; SR.4a's exact accounting passed.

Answers to (b) and (c):

- **Destination ownership:** the destination is not bound to the owner. That is safe *given* Core's owner-only Execute (W2 stands).
- **Another vault's asset-signer as destination:** it merely funds that vault. Its owner can sweep it.
- **A frozen destination** reverts the transaction. The owner can name a different wallet, which is an advantage of the unbound destination.

**F5 (LOW, operational, holder-facing via D7). The redemption has 23 bytes of slack in its widest legacy shape, and the documents promise more than fits.**

- **Construct:** SPEC item 50 "Mind the packet" (≈1,209/1,232) and the round-25 D7 text in limit 44 ("the coverage check's list of stray classic token accounts can be a SWEEP LIST").
- **Strays do not fit:** each extra (source, destination) pair costs 2 keys (64 bytes) plus indices, roughly 66 bytes. So in the widest shape **zero** stray tokens can be rescued in a legacy transaction.
- **Wallet injection:** Phantom routinely appends Lighthouse assertion instructions after simulation. They carry a program id and accounts, which is well over 23 bytes. Wallets may also add or replace compute-budget instructions. The page's own transaction can then fail to serialise in the most common wallet.
- **Evidence if true:** sign S8's exact transaction through Phantom on devnet or a mainnet fork. The wallet will report a too-large transaction or add instructions.
- **Fix (no program change):**
  - The redeem page builds a **v0 transaction with a lookup table**. S9b already proves SEAL and BURN pair correctly through a lookup table, and the S9b transaction was 444 bytes.
  - With v0, limit 42's prior-transaction requirement becomes optional, and stray rescue becomes real.
  - Correct the D7 text: "a SWEEP LIST in a v0 transaction; in a legacy transaction, none fit at the widest shape."

**R1s(g).** Helper deployment bytes are proven equal (N6). SR.0–SR.14 can fail, except the SR.12a weakness above.

---

## R2 / R2b. The pool and the boost

I checked solvency algebraically:

- **`credit`:** `owed += ⌊avail·S/w⌋·w ≤ avail·S`, so `⌈owed⌉` rises by at most `avail`.
- **`claim`:** pays ⌊pending/S⌋ and lowers owed by exactly that times S.
- **`retire`:** lowers owed without moving tokens.

So `balance ≥ ⌈owed⌉` holds under SPEC's weaker rule.

- **Counters:** `pending_count`, `pending_this_epoch` (including a same-epoch retire), `active_count`, `total_active_weight`, `boost_weight_total`, `boosts_active`, `boosts_due` and the ring agree under every ordering I could construct.
- **Ring:** live end epochs fall in `(e, e+63]`, which is 63 distinct residues, so slots cannot collide.
- **Exactly N distributions:** every epoch advance with `w > 0` is a crediting distribution, and `delta > 0` because `avail ≥ 1` sat and `w ≤ ~40k`. A boost bought in epoch e therefore earns e→e+1 … e+N−1→e+N, which is N exactly.
- **Liveness:** a waiting vault is always joinable by `claim`, which needs no account read, or retirable. A due boost is always expirable by `expire_boosts`, which needs records only. Nobody can make distributions impossible for others.

No finding here beyond limits 27, 28 and 55.

---

## R3. The level draw

**F1 (UNVERIFIED; CRITICAL if true). Can a vault's owner make `reveal_level` fail forever, halting the FIFO for every later vault?**

- **Construct:** MINT `reveal_level`. For a live asset it *must* succeed a Core `UpdatePluginV1(Attributes)` CPI before `revealed_total` advances, and the FIFO (`RevealOutOfOrder`) makes every later vault wait.
- **The owner's tools:** Core lets an asset owner add **owner-managed** internal plugins (FreezeDelegate, TransferDelegate, BurnDelegate, and possibly others). For FreezeDelegate the owner can set the authority to a key nobody holds, for example an off-curve address. R24.1 only proves that *external adapters* are refused to owners.
- **What I cannot determine from source:** whether any owner-addable plugin's lifecycle validation rejects an `UpdatePluginV1` of the Attributes plugin by its plugin authority. FreezeDelegate (frozen) is the obvious candidate. I don't believe it does, but nothing in the bundle measures it.
- **Impact if it does:** for the cost of one paid mint, anyone halts every reveal and every activation of every later vault, permanently, because the programs are immutable. Later minters are never levelled and never earn. Governance still works, but nothing can fix it.
- **Evidence:** one arm. Mint a vault, have the owner `addPlugin(FreezeDelegate{frozen:true})` (and, separately, each other owner-managed plugin Core allows), wait for entropy, and call `reveal_level`.
  - Expect ALLOW and the level written.
  - If Core refuses, F1 is confirmed.
- **Fix, if confirmed (or anyway, see F2):** decouple the draw from the Core write.

**F2 (MEDIUM, design; makes accepted limit 40's second consequence avoidable). The FIFO's progress is coupled to a Core CPI it does not need.**

- **Construct:** `reveal_level`. The census draw, `level_minted`, `revealed_total` and `r.level` are pure MINT state, and the payout reads the level from `VaultRecord` (`weight_of`). Only the *display* attribute needs Core.
- **What the coupling costs:**
  - Limit 40's "a Core change that breaks UpdatePluginV1 halts the level queue".
  - F1's attack surface.
  - Any future attribute-size or rent surprise.
- **Fix (program change, only possible before the lock):**
  - Split into `reveal_level` (FIFO, record only, never CPIs) and `stamp_level` (permissionless, any order, retryable, writes the attribute from `r.level`, idempotent).
  - The crank sends both. A failed stamp then delays nothing.
  - `activate` keeps requiring `r.level ∈ 1..5`.
- **Evidence:** the existing L.* arms move to cover both instructions, plus one arm where stamping fails and the next vault still reveals.

**SPEC 26 is accurate, not worse.** C's leader knows hA and hB, can move C within its own 4-slot group by skipping, and can grind block contents. Two further levers already fall under "a validator can time a mint (or a reschedule)":

- Anyone landing a `reschedule_reveal` chooses `reveal_slot = now+16`, so a validator can place C in its own rotation for a lapsed vault.
- A holder of an *earlier* uncaptured vault re-rolls the census seen by every later vault by letting it lapse (limit 25's "repeated silences").

HOLDER-GUIDE says "pick among several results… enough to choose the level". That is true; "many" would be the measured word.

---

## R4. Governance

I found no minority path beyond the stated ones (limits 34, 35, 46, 47, vote rental). The checks I confirmed:

- **Restart skips:** GOV's skip test (`>=`) matches MINT's `StopIsNewer` (`<`).
- **CPI count:** five CPIs at most (W3 stands).
- **Account sizes:** `ACTIONS_SPACE`, Proposal, GovConfig and VoteRecord sizes are correct.

Stated limit 47 is not worse.

**F7 (LOW, false to holders on a natural reading).** HOLDER-GUIDE "Who can do what" says: "vaults **sold** during the vote cannot vote on it."

- **Natural reading:** a holder reads "sold" as *resold on a marketplace*.
- **What the code does:** an existing vault bought mid-vote **can** vote, if its previous owner had not (`VoteRecord` is seeded by asset, and the index is below the snapshot). Only vaults **minted** after creation are refused (`VaultTooNew`).
- **Fix:** "vaults minted after the vote opens cannot vote on it."

---

## R5. Charter claim

SPEC 46 is now complete as far as I can tell. The Merkle tree has domain separation and sorted pairs, and promotion is handled identically in JS and Rust. Pass-through accounts are never signers. Core never CPIs hooks (fact 12). Nothing to add.

---

## R6. One-time configuration

Nothing new. Everything the programs accept but the checker refuses is covered by item 38 and round-24 A6:

- SEAL checks owner only.
- An off-curve guardian or operator is accepted.
- `charter_opens_at` may already be past at initialize; only `closes > now` is checked. This is worth one checker line: refuse an `opens_at` earlier than the planned initialize time plus margin.

The royalty's immutability rests on Core `PluginAuthority::None` (R.5–R.6c). Our programs have no CPI that could add an asset-level override (only MINT's PDA could, and MINT has no such path).

**The redemption cap is exactly a rolling window:**

- `kth = ring[(head − k) mod 64]` is the k-th most recent.
- `≥ window` gives half-open semantics.
- Ring zeros mean "long ago".
- A clock moving backwards fails closed.

---

## R7. Raw reads (recomputed)

**MintConfig:**

| Field | Offset |
|---|---|
| governance | 41 |
| round_id | 105 |
| price | 125 |
| minted_total | 141 |
| sales/sweep stop | 191/192 |
| guardian | 193 |
| operator | 225 |
| reserve | 257 |
| max_sweep | 266 |
| cooldown | 274 |
| charter_closes | 442 |
| bare_retired | 454 |
| weight | 462 |
| acc | 478 |
| owed | 494 |
| last_dist | 510 |
| stop times | 518/526 |
| pending operator | 534 |
| monthly | 574 |
| notice | 623 |
| floor / ceilings | 631/639/647 |
| dist_epoch | 655 |
| cbob_mint | 679 |
| max boost weight / epochs | 711/712 |
| boost_price | 714 |
| ring | 749–1005 |

- **Space** is 1,261 = 1,005 + 256.
- **VaultRecord:** 221 bytes. Fields at 41, 49, 57, 125, 129, 161, 177, 186, 187 and 195 all agree.
- **BurnConfig:** 42 / 50 / 58 / 59–571.
- **SEAL:** collection at 9, reserves Vec at 41.
- **Classic token account:** 0 / 32 / 64 / 72 / 108 / 121 / 129, length 165.

All agree with every constant in the four programs and the helper.

---

## R8. The suite as evidence

**Arms that cannot fail, or fail for the wrong reason:**

- **SR.12a:** see R0, N4.
- **RL.7:** conservative stamp; see R0, N2.
- **X.7:** admitted.
- **10.6a:** consistency-only by design.

**Claims no arm exercises:**

- F1: owner-managed plugins versus reveal.
- F5: wallet-injected instructions; the widest shape actually landed.
- A redemption with a separate fee payer and compute-budget pair *landed*.

**F10 (LOW, process).** VALIDATION shows the 829/740/16 run used the runner *before* MAINNET_FLOOR=33 and the new per-artifact hash lines. The expanded probe passed separately. So the runner as committed has never completed end to end, and "every number behind a floor that must EQUAL the count" is unproven for the runner that will certify.

- **Fix:** one clean `CBOB_SHIP_GATE=1 ./scripts/run-tests.sh` at HEAD, its log retained.

**F11 (INFO, comment drift in frozen paths).** These descriptions no longer match what the scripts do:

- `rehearsal-tree.sh` header: "four program ids… four fresh keypairs… five substitutions (the four mainnet ids…)". The script maps five ids plus root, six substitutions.
- `run-tests.sh` line 2: "the three CBOB vault programs".
- `build-mainnet.sh` round-6 note: "the Squads key".

These are not defects. They are this project's most-repeated failure class (a comment that misdescribes what runs).

---

## The accepted limits: the four questions

1. **Worse than stated?**
   - **Limit 40's level-queue consequence:** not worse in itself, but **F1** could make the same halt reachable by any minter today, without any Core change. Measure it.
   - No other limit is worse than written.
2. **Not actually a limit, or closable?**
   - **Limit 40 (queue halt):** closable by F2's split.
   - **Limit 42 (prior-transaction ATAs) and limit 46's legacy extra-account ceiling:** legacy-only. S9b proves v0 plus a lookup table works through SEAL and BURN, so the redeem and claim pages can remove both.
   - **Limit 44:** narrower than v5 for classic strays, but only in v0 (F5).
3. **Discharged but not discharged?** None found. Item 54's page obligations are correctly carried into item 50.
4. **Open and blocking but treated as accepted?** No item was relabelled. The certification evidence is weaker than presented in two places:
   - Item 53: VALIDATION refreshed the rehearsal tree but did **not** run `run-tests.sh` inside it. SPEC correctly keeps it OPEN.
   - F10 above.

---

## Before launch: what an AI audit structurally cannot do

1. **Mutation-test the suite.** Run a mutation tool (cargo-mutants or a hand list) over the four programs and the helper: flip each `require!`, each `checked_sub`, each `>=`/`>`, each offset constant. Re-run the 829 assertions. Every surviving mutant is a property nobody tests. This measures the suite's strength, which no reader can.
2. **Differential-fuzz the accounting.** Run `bank/accrual.mjs` (BigInt) and the Rust free functions under property-based random sequences: join, boost, expire, retire, credit, claim, frozen defer, with ≥10⁶ steps. Assert identical `owed`, weights and ring.
3. **Run real wallets against every page transaction.** Sign the exact claim, mint, boost and redeem shapes through Phantom, Solflare, Backpack and a Ledger on a mainnet fork. Record whether each wallet injects instructions, changes compute budget, or refuses the size (F5).
4. **Run a real-value canary deployment before the lock.** Deploy the rehearsal ids with small real cbBTC and run them for weeks:
   - include a deliberately frozen pool (on your own test mint);
   - include a Core devnet upgrade drill;
   - attempt F1;
   - include a public bug bounty with an escrowed reward;
   - use outside testers with no repo access.

   Immutability makes every week of pre-lock real use worth more than any review round.
5. **Make builds reproducible and publicly verified.** Use `solana-verify` (or an equivalent) so that anyone can rebuild `93d04fe` and match the deployed hashes. Publish the record before removing upgrade authority. Today the bridge from "rejects the test key" to "contains Gary's key" is your own reproducibility claim.
6. **Hold key ceremonies for the three hot keys** (swap operator, $CBOB release wallet, Moments update authority through the window). These are human custody decisions, already ruled, but their execution (backups, who can read the R2 bucket, revocation drills) needs a human walking through it and a record.
7. **Have a human check the holder copy.** A non-engineer reads HOLDER-GUIDE cold and says what they believe each sentence promises. F7 is exactly the class of error an author-adjacent reader misses.
8. **Write and drill a Core-upgrade response runbook.** For the day Metaplex ships a Core change: who reads the diff, what is checked against the three named consequences, and what is announced to holders. The alarm detects the change; only humans can respond.