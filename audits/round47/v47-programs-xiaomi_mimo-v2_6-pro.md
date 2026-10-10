# Independent security audit — CBOB vaults v6, final tree

I read the five programs, the sweep helper, the cross-program raw reads, the launch values, the ceremony/holder pages and the rehearsal tooling. I recomputed every pinned offset and account-space constant from the Rust structs and every discriminator named. I did not run a validator; where a claim needs a measurement I say what it is.

---

## R0. Round 46's verdict and its repairs

**Round 46's verdict is sound in its structure and its exclusions.** I re-derived the dispositions it rejected (MiniMax's `require_keys_neq!` inversion, Grok's helper refusals, Ember/GLM's `named`-set claim) and agree: `mint/src/lib.rs` `apply_swap_operator` is `require_keys_neq!`, arm 3c.K5 calls apply and checks the new key is live, `plan-redeem.mjs` builds `named` before the non-address acks exist, and `sweep/src/lib.rs` checks only the source owner and the destination owner+mint.

**Every round-46 repair I could locate is applied at its stated site** (I checked V46-1's `SINGLE_SEND_STEPS`/`isSingleSend` against which steps actually call `send()`; V46-2's `ceremony-values` re-check; V46-3's `nestedSent` recording; V46-4's `handClosed` and the landed-swap continuation; V46-5's `takesOverrides = p.launchJudge !== 'mainnet'` in both `web/build.mjs` and `config.js`; V46-6's `if (fails.length) return null`; V46-7's SPEC 53 text; V46-8's `initKeyFor`/`judgeInitAccount`).

**What is new since round 46 is round 47's wallet-wrap layer (`web/src/lib/tx.mjs`), and that is where the surviving defect is (W47-1, W47-2 below).** Its `judgeWalletEdits` was validated against a *test signer that assumes* wallet behaviour, not against a wallet.

---

## R1. Custody

The pairing holds. `open_for_redemption` walks **forward** for `burn_vault` matching asset (idx 0) **and** owner (idx 2); `burn_vault` walks **backward** for `open_for_redemption` matching the same pair. `retire_redeemed` is reachable only at `TRANSACTION_LEVEL_STACK_HEIGHT + 1` **and** only when the current top-level instruction is BURN's `burn_vault` for the same asset. Thaw therefore cannot outlive its transaction: any failure in the burn reverts the thaw.

The emptiness proof is fail-closed and I could not break it: `asset_signer.lamports() == 0`; every reserve mint's **both** ATA derivations must be declared, PDA-owned, undelegated, extension-free and empty; declared Core assets must not be live `AssetV1`; non-reserve PDA-owned token accounts are held to the same three delegate/close checks and a 165-byte length. Token-2022 accounts are refused at SEAL `initialize` (`ReserveMintNotClassicSpl`) so a T22 reserve can never arm the permanent-seal landmine.

Two things I checked and could **not** turn into findings: a vault transferred between the open and the burn makes the burn fail `NotTheOwner` and reverts; a same-transaction second redemption cannot borrow the first's pairing (asset+owner bound both directions, suite 3.9/3.10/4.10a).

---

## R1s. The sweep helper

(a) **Access control is Core's `ExecuteV1` rule and nothing else.** Called directly, `signer.is_signer` is required and the vault's signer PDA cannot produce a signature (SR.1). Through Core, only the asset owner can authorize; an owner-added `TransferDelegate` does not (SR.5a, Core `0x1a`), nor does the collection update authority (SR.5c), and the CBOB collection's UA is MINT's off-curve PDA (SR.5b). A frozen vault refuses Execute at the seal.

(b) **The pair list.** Duplicate source is refused (by the *second*, closed source's owner check — SR.12a/12b pin the reason honestly). A source that is also a destination cannot pass both the `src_owner == signer` and `to_owner == dest` checks (`signer != dest` is refused outright). Frozen source reverts (SR.14). A kept-close-authority source reverts the close, so the whole call reverts (R36.C5) and the page routes it to a plain `Transfer` instead. Odd account count refused.

(c) The destination is the transaction builder's choice, which is safe *given (a)*: only the owner can authorize the Execute. A destination below rent that does not exist is refused by the runtime (R41.C8a-c); the canonical destination is the fee-paying owner.

(d) The lamport sweep reads `signer.lamports()` at execution and empties it. Anything deposited between the sweep and the burn makes BURN refuse `VaultNotEmpty` — fail closed.

(e) A closed source has 0 lamports, so BURN's `if acc.lamports() == 0 { continue; }` skips it **for the right reason** (it is gone, not "checked and empty"). A non-token, non-Core, non-zero account is skipped only if it is not PDA-owned.

(f) S8.0 measures `open + claim + Execute(helper) + burn` at 1,061 bytes and then *subtracts* 52 (two compute-budget ixs) and 96 (separate fee payer) against 1,232. That is the right reservation. There is no fourth reserve (`MAX_RESERVE_MINTS = 3`), and the in-line monthly run's pool account is already in BURN's list.

(g) SR.0–SR.14 and S8.* each refuse for the reason their name claims (the `because()` pins are specific and I checked the unusual ones: SR.12b deliberately asserts the *absence* of the source-owner message).

---

## R2. The community pool

I re-derived the invariant. `credit` adds `floor(avail·S/w)·w ≤ avail·S` to `owed_scaled`, where `avail = bal − ceil(owed)`, so `ceil(owed_new) ≤ bal`. `claim` subtracts exactly `pay·S` from `owed_scaled` and `pay` from the balance, and because `owed = q·S + r` the ceilings move in lockstep (`ceil(owed_new) = ceil(owed_old) − pay`). `retire` subtracts `pending` without moving the balance. `join` adds no owed. So the pool always holds ≥ `ceil(owed)`. `PoolShort` and the `checked_sub`s fail closed.

`waiting_to_join = pending_count − pending_this_epoch` cannot underflow: every retire and join decrements `pending_count` and decrements `pending_this_epoch` only when `request_epoch == dist_epoch`, which is exactly the condition for membership in the latter. `BoostsExpireFirst` and `JoinWaitingFirst` are both permissionlessly clearable (`expire_boosts`, `claim`), so neither is a permanent distribution block. I could not find a liveness wedge.

---

## R2b. The $CBOB boost

I re-proved the ring argument from the code: two **live** end epochs differ by strictly between −63 and +63 (because the later boost must be bought before the earlier one ends, which bounds `a+n − (b+m)` to `(−m, n−m)` with `n,m ≤ 63`), so two distinct end epochs never collide modulo 64 while both are live; equal end epochs are a count. `MAX_BOOST_EPOCHS_BOUND = 63` is exactly what makes that true. A **due** boost has already been moved out of the ring by `advance_epoch` (which zeroes the slot), so a new boost cannot collide with it. So `advance_epoch` picks up exactly the boosts ending at that epoch.

A boost bought at epoch `e` with `epochs = N` ends at `e+N`; `monthly_inline` runs before the boost lands, so it earns distributions `e+1 … e+N` and no more. `reweigh` moves the owed share into `carry` and restarts debt at the new weight, so `owed` is preserved exactly at the change. `unschedule_boost`/`retire`/`expire_boost` cannot double-count (retire gates on `boost_weight > 0`, which `expire_boost` zeroes). The host test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` drives 260 epochs through the program's own functions and its coverage counters prevent it passing vacuously.

---

## R3. The level draw

`blockhash_in_window` pins the sysvar key, bounds the count to 512, checks the buffer length, and refuses an all-zero hash. A/B/C selection is deterministic (smallest produced slot in a 64-slot window, then two 4-slot leader groups forward twice), so `capture_entropy` is time-independent inside the window. The FIFO is `index == revealed_total`, so ordering cannot be chosen. A burned vault still takes a draw (L.11) so the queue cannot stall. A missed window is rescheduled to `now + 16`, which does not exist at call time. `L.3c` re-derives the entropy from the raw SlotHashes independently.

SPEC 26's claim ("C's leader CHOOSES among many draws, not merely bias one") is what the code buys, and HOLDER-GUIDE's wording matches it.

---

## R4. Governance

The electorate is frozen at creation (`index_snapshot` = `minted_total`, `quorum_supply` = live supply). A key change needs `ceil(50% of snapshot)` YES and can never share a proposal with the other key change. `restart` is skipped, not reverted, when the stop is newer. `tighten_sweep` is monotone and bounded by the `initialize` ceilings. GOV's `Loosening` pre-check and MINT's `TightenOutOfBounds` agree at every field (I checked all three arms of `SweepTighten` against both programs). Discriminators and every GOV→MINT raw offset match the structs.

I could not find a minority carry: at 21% quorum / 51% threshold the smallest passing YES is 10.71% of the snapshot, above the 10% floor (limit 35), and a key change needs 50%.

---

## R5. The charter claim

The PoB is pinned by address against `pob_root` (domain-separated, sorted pairs — `pob-merkle.mjs` and the Rust agree byte-for-byte, and the suite proves the Rust accepts the JS's proofs). The PoB must be a live `AssetV1` in `cfg.pob_collection`, owned by the signer, and it is CPI-burned in the same instruction. `pob_extra` is passed through to Core **never as signers**. Outside the window the instruction refuses on the clock alone.

SPEC 46 is complete as far as I can see: it names both the end-the-project and capture-governance paths, the positive bound (the key cannot transfer or burn a PoB), the alarm's per-asset blind spot and its 30-minute sampling gap. Nothing material is omitted.

---

## R6. One-time configuration and the trusted hop

Every `initialize` value in `launch/mainnet-init.json` sits **inside** the program's bounds, and several sit exactly **on** a bound (`monthly_secs = 2,592,000 = MONTHLY_SECS`; `max_boost_weight = 12 = MAX_BOOST_WEIGHT_BOUND`; `level_caps` sum = `max_supply`). Those are correct but leave zero margin: `check-launch-params.mjs` (not in this bundle) is the only thing standing between a typo and a permanent mis-initialisation.

The sweep is bounded in the program (cap, cooldown, reserve, operator signature, guardian stop) and `tighten_sweep` is monotone and ceiling-bounded. The 10% royalty is `PluginAuthority::None`, measured unreassignable (`0x1b CannotRedelegate`) and unremovable (`0x9`). The rolling rate limit is a 64-slot ring of timestamps with `k = min(cap, 64)` and `now − ring[head−k] ≥ window` — exactly a rolling window, with the ring's `k` bound making it *stricter* above 3,047 live.

---

## R7. Cross-program raw reads

I recomputed every offset from the struct definitions. All 46 pinned offsets in GOV's `MintView`/`read_stops`/`read_vault_index`, BURN's `read_mint_supply` and `SEAL_CONFIG_*`, and MINT's `check_seal_wiring`/`seal_reserves` are correct. Account spaces re-derive exactly: MintConfig 1,261 (body 1,005 + 256 padding), VaultRecord 221, BurnConfig 827, GovConfig 350, SEAL 398. Every pinned discriminator is asserted in the suite against its derivation. No misread found.

---

## R8. The suite as evidence

The floors equal their counts (`MIN_ASSERTIONS=912`, `DET_FLOOR=1072`, `WEB_FLOOR=801`, `E2E_FLOOR=152`, `SIM_FLOOR=71`, `LAUNCH_FLOOR=69`, `MAINNET_FLOOR=35`, `POB_FLOOR=14`, `ALLOC_FLOOR=39`, `POSTER_FLOOR=24`, `HOST_FLOOR=6`, `EXPIRY_FLOOR=4`), and `floor()` requires `−eq`, not `−ge`. `ID.1` proves every assertion id is unique so a `because()` pin can only read its own arm. `because()` pins are specific, and the one place where the reason differs from the name (SR.12a/12b) is pinned deliberately and honestly.

**Arms I could not find fault with but that rest on files this pass does not carry** (`bank/detectors.mjs`'s `judgeRedemptionCoverage`/`classifyPdaTokenAccount`, `bank/layout.mjs`): the coverage cross-check's reason strings are matched with `reason.includes(a)` against address substrings. I could not see the detector, so I cannot rule out a reason string that matches a wrong address by substring. That is a claim about a file I was not given.

---

# Findings

## W47-1 — MEDIUM — class (c): `judgeWalletEdits` rejects the wallet wrap it is documented to accept whenever the page set its own compute budget

**Construct.** `web/src/lib/tx.mjs` `judgeWalletEdits`, line `const keep = ix => !isLh(ix) && !(isCb(ix) && !pageSetBudget)`.

When `pageSetBudget` is true, `keep` keeps **every** compute-budget instruction. A wallet-added `SetComputeUnitLimit`/`SetComputeUnitPrice` therefore lands in `ours`, and `ours.length !== want.instructions.length` (or `sameIx` fails) rejects the whole transaction before sending.

`buildForWallet` → `withComputeBudget` sets the page's own budget for **every holder transaction that fits one**, which is all but the widest. `web/README.md` documents the wallet wrap as "[compute budget 200,000 and a price; Lighthouse checks; the page's instructions; …]" and says "every holder page now accepts exactly that wrap" — that sentence and the code contradict each other. The note's only evidence about the wallet's budget behaviour is "Phantom documents that it adds no **priority fee** to a transaction that already has one", which is about the price, not the limit.

**What is gained / lost.** If the wallet adds a compute-budget instruction to a transaction that already has one, every holder opening whose packet leaves room for the page's budget is refused before it is signed. The holder cannot open their vault on the only page the guide tells them to use (HOLDER-GUIDE: "Only open your vault on the Bank's redeem page. Burning the NFT any other way destroys everything inside it forever"). Class (c) under SPEC gate 3.

**Evidence that would exist if I am right.** Open `/redeem/` for an activated vault in a real Phantom and press Open. The page prints `The wallet changed the transaction in a way the page does not allow, so nothing was sent: the wallet added or changed instructions the page does not allow (ComputeBudget111111111111111111111111111111)` (or `…the instructions the page built were changed, removed or reordered`) and nothing is sent. On the e2e's signer it lands, because `phantomLike` in `web/test/e2e-localnet.mjs` adds a budget **only when the page set none** — that is the assumption under test, not a measurement.

**Fix.** Decide the rule from a real wallet, not from a model of one. Either (i) allow the wallet to append a compute-budget instruction whose limit is ≥ the page's `minUnits` and whose fee is bounded, exactly as it is allowed when the page set none, and require only that the page's own budget survive untouched if the wallet instead replaces it; or (ii) keep the strict rule and prove, with a real Phantom/Solflare/Ledger run recorded in the repo, that no supported wallet adds a budget to a transaction that already carries one. Whichever is chosen, make the e2e's signer take the **same** wrap the round-47 note describes (budget + price + Lighthouse always) and show every holder flow landing; today's signer is not that wrap.

---

## W47-2 — MEDIUM — class (c): `judgeWalletEdits` requires a wallet compute limit to clear the page's whole safety budget, not the transaction's measured cost

**Construct.** `web/src/lib/tx.mjs`: `const minUnits = pageUnits(sim.unitsConsumed)` in `buildForWallet`, used as `opts.minUnits`; `pageUnits = measured => Math.min(1_400_000, ceil(measured * 1.1) + 20_000)`. `judgeWalletEdits` then does `if (limit !== null && opts.minUnits && limit < opts.minUnits) bad.push(...)`.

`minUnits` is the **page's budget** (measured × 1.1 + 20,000 for the wallet's Lighthouse checks), and it is enforced as the floor for a wallet-added limit **even in the case where the page could not fit its own budget and the wallet's limit is the only one** (`withComputeBudget` returns `ixs` unchanged when the packet is full, but `minUnits` is still set). The round-47 note's own numbers: the claim-first crack measures **194,694 CU bare**; `pageUnits(194694) = 234,164`. A wallet limit of 200,000 covers 194,694 and is refused.

**What is gained / lost.** The widest openings (claim-first + strays, 1,218 bytes; W5) leave no room for the page's budget. If the wallet adds any compute-budget instruction (one `SetComputeUnitLimit` is 8 wire bytes and *does* fit), `signExact` throws `the wallet set a compute limit of 200000, below the 234164 this transaction needs, so it would fail on the network` and the opening is never sent — for a transaction that would have landed. Class (c).

**Evidence that would exist if I am right.** Build the widest opening on `/redeem/` (a claim-first opening carrying strays), have the wallet prepend `SetComputeUnitLimit(200000)` only, and observe the refusal above with `minUnits = 234164` while `simulateTransaction` of the same transaction with that limit returns `err: null`. The e2e cannot show it: `phantomLike` adds a budget only if both budget instructions fit (`wireSize(...) <= 1232`), so the "page set none + wallet added one" path is never driven.

**Fix.** Compute the floor in `judgeWalletEdits` from what is actually present: `sim.unitsConsumed` **plus** `LIGHTHOUSE_CU_ALLOWANCE` only for Lighthouse instructions the judge can see in `added`, instead of the page's full `pageUnits(...)`. `minUnits` should mean "what this transaction needs", not "what the page would have budgeted".

---

## W47-3 — LOW: `judgeWalletEdits` does not detect an account the wallet made read-only

**Construct.** `web/src/lib/tx.mjs` `judgeWalletEdits`: `for (const k of b.writable) if (!a.writable.has(k)) bad.push(...)`. There is no converse check.

A wallet can take an account the page marked writable and make it read-only. The judge passes (no *new* writable accounts), `verifySignatures` passes, and the transaction is sent — where the program's write to that account fails and the whole transaction reverts.

**What is gained / lost.** Nothing is stolen; a malicious wallet can make its own user's transaction fail. Worth closing because the judge's stated contract ("no writable account was added") is narrower than "the writability set is unchanged".

**Evidence.** `judgeWalletEdits(want, gotWithAccountMadeReadOnly)` returns `{ bad: [] }`; the same transaction then fails on chain.

**Fix.** Compare the writable sets in both directions.

---

## W47-4 — LOW (documentation, outside (a)–(d)): HOLDER-GUIDE states the opening announcements as fact

HOLDER-GUIDE.md, "Things to know before you open": *"Every opening is public. It is announced on X and on the Bank's website."* `bank/redemption-poster.mjs` **has no sender** (SPEC control table: `PROCEDURE. Run by hand; drafts only`), and item 50 lists "every opening is announced on X and the CBOB website" as one of the surfaces not yet shipped. The sentence is true of the on-chain `CBOB_REDEEMED` log line, not of the announcements.

**Evidence.** The control table's own row; the poster has no send path.

**Fix.** Either ship the sender or reword to "every opening is recorded on chain; the Bank drafts a post for each and posts them by hand." The guide may not be published until item 50 ships, but the sentence must not survive that publication unchanged.

---

## W47-5 — INFO: the rolling rate limit admits `cap + 1` in a **closed** window of exactly `redeem_window_secs`

**Construct.** `programs/cbob-vault-burn/src/lib.rs` `burn_vault`: `require!(now − kth >= c.redeem_window_secs, RateLimited)`. SPEC's own replay (RL.7) counts a window as `ring[i] > t − win`, i.e. half-open on the left.

At the `(cap+1)`-th redemption the check is `t_{cap+1} − t_1 >= window`. If the two are exactly `window` apart, it passes, and the **closed** interval `[t_1, t_1+window]` contains `cap+1` timestamps. The SPEC sentence "no window of that length, wherever it starts, holds more than the cap" is therefore true only for a half-open window.

**Evidence.** `cap` redemptions at time `T`, one more at `T + redeem_window_secs` exactly: all land; `RL.7`'s own loop (which uses `>`) reports zero violations.

**Fix.** State the window as half-open in SPEC (the code is already the industry-standard rule), or tighten to `>` and re-measure RL.2/RL.4.

---

## W47-6 — INFO: two stale or loose operational bits

- `web/test/e2e-localnet.sh` dumps Lighthouse with `${MRPC:-https://api.mainnet-beta.solana.com}`, but `MRPC` is never set in that script (unlike `run-tests.sh`, which derives it from the provider env file). It silently uses the unauthenticated public endpoint.
- SPEC item 53's "what keeps it OPEN" still lists "the dress rehearsal itself … has not yet run to its end on mainnet", and `audits/rehearsal-2026-10-09/RECORD.md` records that it has. The remaining reasons are still valid; this one is not.

---

# The four questions about the accepted limits

1. **Is any limit worse than stated?** I could not find one that is materially worse. Two are *softer* in HOLDER-GUIDE than in SPEC: limit 26 (the leader grind) is "can pick among several results" in the guide where SPEC measures best-of-4 at 18.6% for Level V and 64 tries at 96%; and limit 10's exposure is stated as "up to 10 SOL every 6 hours" where the honest bound is cap × cooldown-windows until the guardian stops it. Both readings are defensible, but the guide is the softer of the two.
2. **Is anything listed as a limit not actually a limit?** No. Every item I checked is a real cost of a decision.
3. **Is any DISCHARGED item not actually discharged?** No. Items 12/17 are explicitly scoped to the v5 shape and superseded by 10.1–10.6 for v6; 14, 19, 30, 31, 33, 51 and 54 are closed in code or in the suite.
4. **Is anything in OPEN AND BLOCKING quietly treated as accepted?** No. Item 22's ~2,100-vault scale, 38, 50, 52 and 53 are all still marked blocking and the rehearsal record's own "PASS at 5 vaults (scale not exercised)" is the honest label. Item 53 carries one stale sentence (W47-6).

---

# Given that no human firm will ever see this and the programs will be immutable

These are the things an AI round structurally cannot do, concretely:

1. **Be a real wallet.** W47-1 and W47-2 exist because the round-47 wrap was validated against a *model* of Phantom. Before the lock, run **every** holder flow — claim, draw, activate, rescue, payout, the widest opening, buy — through the real Phantom, Solflare and a Ledger, on a phone and a desktop, and record the signed messages. The judge's rule must be derived from what those wallets actually return, not from what a test signer assumes.
2. **Be a real third party.** Exercise a real Coinbase freeze and unfreeze on a vault's cbBTC and on the pool; exercise a real Squads v4 return of a rescued vault; read DAS on mainnet for a burned asset (item 22.5 did this once — repeat it after any index change); put the RPC proxy behind Cloudflare and measure it under a real burst.
3. **Hold the keys, once.** The deploy authority (`FZjLB…`), the $CBOB release wallet, the swap operator and the guardian are all single hot files on one box. A witnessed key ceremony — who generated them, where the 600-mode files and their backups live, how they are destroyed at step 11 — cannot be audited from a repository.
4. **Prove the destroy.** After `solana program set-upgrade-authority <id> --final`, have someone who is **not** the deployer dump all five programs, re-hash the prefixes and read `solana program show` for each. "Immutable" is the product's central promise and it is a one-line CLI mistake away from being false.
5. **Be the first stranger.** After step 10 and before step 11, have a person with no access to this box buy a vault with real cbBTC, fill it, activate it, and open it on the published page — from a wallet that is not Gary's and not on this machine. That is the only end-to-end proof that an outsider can get their bitcoin out.
6. **Be on call.** Rehearse the runbooks a human will actually execute: a CRITICAL `config_drift` at 3am (this already happened once, mid-rehearsal), a lost guardian key, a lost deploy authority before step 11, the swap operator key leaking.
7. **Own the words.** HOLDER-GUIDE.md and README.md are promises. Someone must sign for every sentence in them — especially the parts about announcements, returns and what a multisig "does" — and the bug bounty / private-reporting path must be live before the first vault is minted.
8. **Run the scale.** Item 22's ~2,100-vault crank and alarm behaviour (cost, rate limits, paging, one transient RPC failure deep in the walk) has never been exercised. Do it on the throwaway ids before the lock, not after.