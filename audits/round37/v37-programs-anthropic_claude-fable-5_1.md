# Round 37 — independent audit of the whole tree (programs, sweep helper, suite, sim, build, web/)

I read every bundled file whole, recomputed every cross-program offset and account size from the struct definitions, re-derived the pool arithmetic, re-walked round 36's verdict item by item, and ran the web/ plan modules in my head against the stated round-36 repairs. Nothing below moves value out of a vault, the pool or the revenue address, and nothing below needs a program change. What survives is in `web/` and in the documents. Severities: **0 CRITICAL, 0 HIGH, 1 MEDIUM, 3 LOW, several INFO**.

Where I could not measure (no validator, no network, `bank/` outside this bundle except `txread.mjs`/`sigwalk.mjs`), I say so.

---

## R0. Round 36's verdict and the repairs

### Confirmed findings, repairs checked at all sites of their shape

| R36 item | Repair present? | Residue |
|---|---|---|
| **H1** (freezable stray destination blocks the opening) | Yes. `plan-redeem.mjs` `undeliverable()` drops a stray whose mint has any freeze authority (unless a reserve mint), whose owner destination is frozen, or whose mint is unreadable; `redeem.mjs` re-plans with `dropStrays` after a failed dry run; the holder's OWN frozen reserve destination refuses with the reason. `plan.test.mjs` has both-way arms. The e2e freezes the holder's account for a stranger mint and asserts the opening lands. | A **sibling griefing class survives** (finding **L-A** below): the page still produces one mandatory checkbox per stranger-created Token-2022 account, including provably empty 165-byte ones, with no cap and no grouping. |
| **L1** (proxy relays non-CBOB transactions) | Partly. `txRefusal` now requires a CBOB program OR one of three exact shapes. | **Bypass by a no-op CBOB instruction** (finding **L-B**). |
| **L2** (payout cannot clear due boosts) | Yes. `planPayout` groups `expire_boosts` (≤20 per tx) → joins → distribute, refuses if its counts differ from MINT's. Offline arms and an e2e control (`BoostsExpireFirst`) exist. | None found. |
| **L3 / I2** (SPEC C5 wording; item 38 `vault_collection`) | Yes in the SPEC text bundled here. | None. |
| **L4** (release binding) | Yes. `build.mjs` refuses unless `dist/MANIFEST.txt` names `RELEASE_COMMIT` clean and sums equal the pins; `ids.test.mjs` and `bundle.test.mjs` have both-way arms. | Procedural: a release at a later commit (the tree has moved since `0b3ddb3`) requires a fresh `dist/` and a config update in one change; the test enforces it. |
| **L5 / I1** (ceremony hash reference; step-9 wording) | Yes: README table for both profiles, `bundle.test.mjs` compares a fresh build; the page footer and the upgrade-authority note say step 11. | None. |
| Off-chain L3/L4/L5, C06 | `bank/` is not in this bundle. **Not verified here.** | — |

### Round 36's refuted claims, re-tested from first principles

- **W1** (helper destination = another vault's asset-signer): refuted correctly. Core `ExecuteV1` admits only the asset owner (SR.5–SR.5e measured); the page always passes the connected owner. Nothing new.
- **W2** (claim-first order never landed): the code argument is correct (SEAL scans forward for the burn, BURN scans backward for the open, `retire_redeemed` checks the stack height and the current top-level instruction; a leading `claim` changes neither walk). VALIDATION says the e2e now lands the claim-first opening of an ACTIVE vault with a month due, with the in-line distribution in the logs and `owed_scaled` reaching 0. Consistent with my reading of `claim` (month runs **before** paying) and `retire_redeemed` (month runs **after** retiring).
- **W3–W14**: all hold on my reading. W10 (reserve "foreign close authority" refusal unreachable): correct, only the PDA can set a close authority on its own ATA and it cannot sign while sealed; defensive dead code, not a defect.
- **W9** (draw page sets no compute limit): the page sends `reveal_level` ALONE; measured 150,344 CU with the inline capture at a full sysvar, under the 200,000 default. Refuted correctly.

### The e2e and web test floors
`run-all.mjs` floors sum to 518, matching README. The e2e has no floor (R36 A8, still open); VALIDATION quotes 103/103.

---

## R1. Custody

**No path found.** Re-derived:

- **Pairing.** SEAL's open binds asset (idx 0) and owner (idx 2) and requires a later top-level `burn_vault` with the same two; BURN requires an earlier top-level open with the same two. A transfer of the thawed asset between open and burn makes the burn fail `NotTheOwner` (the burn's `owner` signer no longer owns it); a second open/burn pair for the new owner cannot be satisfied in the same transaction because the burn for the old owner must still succeed (it cannot, after the transfer) or the open for the old owner has no burn. Atomicity does the rest. Wrapper shapes measured (WR.1–4).
- **Emptiness proof.** Both derivations of each reserve ATA must be declared; a Token-2022 ATA for a classic mint cannot be created (F4.2), and nobody can take a token account at an ATA address (R34.G2), so the T22 derivation can only ever be a System-owned lamport sink, which BURN skips (owner not a token program) and nobody can recover (the stranger's loss). A declared classic account with `len > 165` refuses; a delegate, delegated amount or close authority refuses; a declared live Core asset refuses. After the helper's `CloseAccount` the source is System-owned, zero data, zero lamports, so BURN's reserve loop skips it **for the right reason** (owner check), not because of a stale length.
- **Lamports.** `asset_signer.lamports() == 0` before the Core burn; the helper reads the balance at execution. Nothing in the owner's own transaction can credit the PDA after the helper except the owner's own instruction (self-harm). A stranger cannot insert an instruction into someone else's transaction.
- **Nested assets.** Only declared ones refuse; undeclared ones die (limit 44) or, for CBOB vaults, are rescuable (item 58). The owner CAN extract a nested asset during their own redemption by a Core `TransferV1` inside Execute (the host's PDA signs as the inner asset's owner); the page chooses not to and refuses instead. Not a defect, a choice.

---

## R1s. The sweep helper

(a) Only Core can present the asset-signer as a signer, and Core's Execute approves only the owner on a thawed vault; frozen → 0x9 (3.7); stranger / transfer delegate / collection authority → 0x1a (SR.5–SR.5c). An AgentIdentity adapter cannot be added by the owner or the update authority (R24.1a/1c). Sound at the pinned Core.

(b) Pair list: re-walked every branch against the code. Same source twice → second `read_token` sees a System-owned account → `IllegalOwner` (SR.12a); source also a destination → owner check fails; wSOL source → transfer then close works (native close returns lamports); delegate on source → irrelevant to an owner transfer; frozen source with balance → reverts (SR.14); frozen source with zero → classic `CloseAccount` has no frozen check, so closed; a kept close authority → reverts (R36.C5); odd count → `NotEnoughAccountKeys`; zero pairs → lamports only (SR.13). Nothing new.

(c) The owner is the only possible builder (Core). A credit below rent to a non-existent destination fails; the page uses the fee-paying owner.

(d) See R1. The lamport sweep reads at execution; BURN sees exactly what it left.

(e) Prior-transaction creation of missing reserve ATAs is sufficient: the helper names all three unconditionally (`reservePairs` is built for every reserve), the prior transaction creates any missing one idempotently, and a sealed PDA cannot close one. I found no account a stranger can create that the helper cannot name and BURN will not skip: non-ATA classic accounts are named (or C5-transferred); T22 accounts are not seen by BURN unless declared; nested Core assets likewise.

(f) S8.0 measures claim + open + helper(3 pairs) + burn at 1,061 bytes with the owner paying and no compute-budget instructions, which is exactly the page's shape; the page adds strays until 1,232. A fourth reserve cannot exist. The in-line monthly run adds no accounts.

(g) `build-mainnet.sh` `cmp`s `dist/cbob_vault_sweep.so` against both its own localnet build and `target/deploy/`, which `run-tests.sh` deploys. The four keyed programs' localnet bytes are never `cmp`'d (R35 C12, recorded).

---

## R2. The community pool

**Invariant `pool ≥ ceil(owed)` holds**, re-derived: `credit` adds `delta·w ≤ avail·S` to `owed` where `avail = B − ceil(O)`, so `ceil(O') ≤ B`; `claim` subtracts whole sats from both; `retire` subtracts `pending` from `owed` only; `reweigh` leaves `owed` unchanged (owed moves into `carry`, debt restarts at `w·acc`). After a claim `owed_of = carry = sub-sat dust`; after expiry inside a claim, `pending = carry`. The counters `pending_count` / `pending_this_epoch` are consistent across request, join, retire (same- and earlier-epoch), and `advance_epoch`.

**Liveness.** `JoinWaitingFirst` and `BoostsExpireFirst` are both clearable by anyone with record-only instructions (`claim` joins a pending record without its ATA existing; `expire_boosts` needs only records). Redemptions never check either gate (`retire_redeemed` runs the month after retiring and never refuses its host). A frozen pool forfeits but lands. `PoolShort` is unreachable by the invariant. One design consequence, not a defect: with `w > 0` and an empty pool, the free path refuses `NothingToDistribute` and the epoch does not advance, so vaults that requested activation cannot join until revenue arrives; the holder text ("joins at the next distribution") is consistent with that.

SPEC's weaker join rule ("never credited by a distribution that ran BEFORE it joined") holds by construction (`debt = w·acc` at join). Limit 55 (unsplit revenue) is as stated.

---

## R2b. The $CBOB boost

Re-derived `reweigh`/`expire_boost`/`unschedule_boost`/`advance_epoch`: a boost bought at epoch `e` with `N` ends at `e+N`, earns distributions `e+1..e+N`, becomes due when `dist_epoch` reaches `e+N`, and `BoostsExpireFirst` refuses any further credit until expired, so it earns exactly N. `N ≤ 63` keeps ring slots distinct; the slot `(e+63) % 64` was consumed when the epoch advanced to `e−1`, so it is free. Early retire decrements the ring, due retire decrements `boosts_due`. `total_active_weight`, `boost_weight_total`, `boosts_active`, ring+due all move together in every path. Nothing is lost or gained on any weight change. A vault whose token account is gone cannot block `expire_boosts`. Agreed with the host test N1 and the suite's `books()`.

---

## R3. The level draw

`blockhash_in_window` pins the sysvar id, bounds the count, checks the buffer, refuses all-zero hashes, and takes the smallest produced slot in `[want, want+64]`; `try_capture` chains B and C two leader groups after the previous hash's group. Deterministic given the chain. A burned FIFO head still draws (L.11). Reschedule and capture are mutually exclusive by slot, so neither can be front-run against the other. SPEC 26 ("C's leader CHOOSES among many draws, for a whole cohort") is not understated on my reading; A's and B's leaders can only blind-re-roll. HOLDER-GUIDE's wording ("can pick among several results ... every vault created in that moment at once") now says it truly.

---

## R4. Governance

Quorum/threshold/turnout/key-change arithmetic re-derived; per-kind skips move the mark before the over-check (3c.R1); restart skip matches MINT's `>=`/`<` tie rule. Proposal space 259 bytes and `ACTION_MAX_BYTES = 37` recomputed correct. No way for a minority to carry beyond the stated concentration facts; no money reach. Governance can freeze as stated (limit 47) and item 45. One documentation gap, finding **L-C**.

---

## R5. The charter claim / SPEC 46

Code matches SPEC: address identity by sorted-pair, domain-separated Merkle; CPI burn as owner with the collection writable; pass-through never as signers; clock-only window; not guardian-gated. I looked for omissions in SPEC 46: moving a PoB out of the collection (stated as brick class), post-creation permanent plugins (Core refuses), per-asset hooks (stated blind spot), transfer/burn of a PoB (refuted, stated), intermittent hooks between alarm samples (stated), minting lookalikes (irrelevant, stated). I found **no new power** the hot wallet, a PoB holder or a third party has that SPEC 46 omits.

---

## R6. One-time configuration, the trusted hop, the royalty, the cap

- `initialize` bounds are as SPEC states; off-curve keys, a duplicate reserve, a window opening in the past and a 10-second redemption window are accepted by the programs and refused only by the checker (item 38, stated).
- Royalty: `PluginAuthority::None` installed by MINT; measured immutable (R.3–R.6c, R33.G3); no CBOB instruction can touch the collection's plugins; only a Core upgrade can (limit 40).
- Redemption cap: exactly a rolling window over the 64-ring (k-th most recent at `(head+64−k)%64`, half-open `now − kth ≥ W`). Timestamps are seconds, so same-second redemptions at cap 1 are refused.
- Trusted hop worst case as stated (cap × windows above the reserve), **with one unstated amplifier**, finding **L-C**.

---

## R7. Cross-program raw reads

Recomputed every offset from the structs: MintConfig (version 8, collection 9, governance 41, pool 73, round 105, price 125, minted_total 141, bank_treasury 157, split 189, stops 191/192, guardian 193, operator 225, reserve 257, bump 265, cap 266, cooldown 274, last_sweep 282, caps 290, minted 310, revealed 330, payment 338, pob_coll 370, root 402, opens 434, closes 442, claimed 450, bare 454, weight 462, active 470, acc 478, owed 494, last_dist 510, stops_at 518/526, pending_op 534/566, monthly 574, pending_guardian 582/614/615, notice 623, floor 631, cool_ceil 639, res_ceil 647, epoch 655, pending 663/671, cbob 679, maxw 711, maxe 712, price 714, w 722, e 723, active 725, due 729, wtotal 733, burned 741, ring 749..1005; space 1005+256=1261), VaultRecord (asset 9, index 41, reveal 49, level 57, charter 58, set 59, entropy 60, hash 92, bump 124, active 125, retired 126, resched 127, ata 129, debt 161, pending 177, req 178, boostw 186, boost_end 187, carry 195; 211+10=221), BurnConfig (burned 42, window 50, head 58, ring 59; 571+256=827), SealConfig (collection 9, reserves 41), GovConfig (proposal_count 53). Every pinned offset in GOV, BURN, the suite, the proxy's `mint-boosts` slice (125..195 → active[0], retired[1], boost_weight[61], boost_end[62..70]) and `mint-waiting` (177) is correct. Classic token offsets (72, 108, 121, 129, 165), Core AssetV1 (1, 33, 34) and CollectionV1 (1, 33) are correct. Core plugin tags 17/7/6 and instruction indices 20/3/6/12/14/31/21 match the SDK order.

---

## R8. The suite, the sim, the build

- **Arms that cannot fail:** `C.2` (`String(!!C1)` is always `"true"` if reached; a failed claim aborts the suite instead, so not a false pass); `X.7` (honestly labelled empty plan). The `RL.S*` arms test the test's own stamping logic.
- **Unexercised refusals (gaps, not defects):** `BadClaimList` for `expire_boosts` > 30 records and for `claim` with `crank_n > rem.len()`; `BadBurnAccounts` on the free path with remaining accounts; `WrongAsset` on `reveal_level`/`boost_vault`; `WrongCollectionAccount` on SEAL; `ReserveHasExtensions` in BURN's second loop (a non-reserve T22 account declared); the rescue branches R36 A7 named (collection host, non-Core host ≥ 66 bytes, foreign burned host, two-vault cycle, owner-added `FreezeDelegate` on a nested vault, where `PermanentTransferDelegate`'s ForceApproved is expected to win and should be measured).
- **Floors:** suite 895, web 518, host 6 (incl. `test_id`), expiry 4, sim 71. I could not count the suite's `rec` calls exactly from the text; VALIDATION's run (`895/895`) is the measurement.
- **Build evidence:** the sweep helper's deployed bytes are proven equal to `dist/`; the four keyed programs' localnet build is not `cmp`'d to `target/deploy` (R35 C12).

---

# Findings

## M-A (MEDIUM, web/ceremony) — Anyone can stop the launch ceremony page for good for one collection's rent

**Construct.** `web/src/lib/reads.mjs` `collectionsOfMint` lists every Core `CollectionV1` whose update authority is MINT's `["mint"]` PDA; `web/src/lib/ceremony-reads.mjs` `resolveCollection` returns a hard `conflict` when `discovered.length > 1`, and `web/src/pages/ceremony.mjs` `preflight()` and `steps()` both `return` on a conflict (`STOP: N collections on chain name MINT's PDA ... only one may exist`). There is no override.

**Why it is exploitable.** Core's `CreateCollectionV2` takes `update_authority` as a non-signing account: the ceremony's own step 0 relies on exactly that to name a PDA that cannot sign. So any stranger can create a Core collection with update authority = MINT's `["mint"]` PDA (the program id and seed are in this repository), for about 0.003 SOL. Consequences:
1. **Before step 0, two stranger collections:** the page refuses to start.
2. **After step 0 (or after SEAL is initialized), one stranger collection:** every reload re-runs `collectionSources`, finds two, and STOPs, including between SEAL and MINT initialize. Gary must finish road step 10 by hand with the CLI builders.
3. **Before step 0, one stranger collection with the exact ruled name, URI and update authority (all public):** `resolveCollection` adopts it (`source: 'the chain'`), `checkCollectionIdentity` and `checkCollectionBeforeMint` pass (clean), step 0 reads as DONE, and SEAL/MINT are initialized against a collection a stranger created. Functionally identical to Gary's (a clean collection is fully determined by name, URI and update authority; the creator keypair holds no power afterwards), so no value is at risk, but the recorded `vault_collection` is a stranger's choice and Gary never signed its creation.

**Evidence if true.** On the e2e validator, create two Core collections with `updateAuthority = MINT_AUTH` (any name) and run `collectionSources`/the page: it STOPs; the e2e today asserts only the lab case (`M2: the chain scan finds exactly the one collection step 0 made`). On mainnet, `getProgramAccounts(Core, memcmp[0]=5, memcmp[1]=MINT_AUTH)` returning more than one account would be the signature.

**Fix (web only).** Treat the chain scan as advisory, never as the authority: once SEAL names a collection, or `config.js`/`launch/mainnet-init.json` pins one, use it and WARN about any others; before any pin, require Gary to record the step-0 address in `config.js` (or the remembered-in-browser value) and never adopt a chain-discovered collection silently; STOP only when the authoritative sources disagree among themselves. Add offline arms for both stranger cases and an e2e arm with a decoy collection.

## L-A (LOW, web/redeem) — One mandatory checkbox per stranger account; no cap, no grouping, and provably-empty accounts are included

**Construct.** `plan-redeem.mjs`: for every Token-2022 account the vault wallet owns (`acc.program !== 'token' || acc.dataLen !== 165`), including one with `amount == 0` and `dataLen == 165`, `cannot.push(...)` becomes an `ack`; `redeem.mjs` refuses to open until every box is ticked. Classic empties are skipped; T22 empties are not.

**Why it matters.** A stranger can create N plain Token-2022 accounts (165 bytes, no extension), set the close authority to themselves, set the owner to the vault's PDA, and leave them empty: rent ~0.002 SOL each, fully recoverable later (an empty non-native account is closable by its close authority). With N in the hundreds, the sanctioned path is impractical; HOLDER-GUIDE says "On the redeem page that cannot block the opening." The README's rationale for listing T22 accounts ("a hidden confidential or withheld balance") applies only to accounts carrying those extensions, which are detectable from the account length and TLV; a 165-byte Token-2022 account with `amount == 0` holds nothing.

**Evidence if true.** `planRedemption` on a snapshot with 300 empty 165-byte `token2022` entries returns 300 `ack` items (the H1 vector list in `plan.test.mjs` includes one such account and asserts it is acked). The holder cannot open on the page without 300 clicks.

**Fix.** Skip Token-2022 accounts that are 165 bytes with zero amount (no extension can hide a balance), and collapse the rest into one grouped acknowledgement ("N accounts strangers placed at your deposit address, together holding X; all lost") with an expandable list. Add a both-way arm.

## L-B (LOW, web/proxy) — The round-36 L1 repair is bypassed by any no-op CBOB instruction

**Construct.** `web/deploy/rpc-proxy.mjs` `txRefusal`: after checking every program is in `TX_PROGRAMS`, `if (ixs.some(ix => CBOB_PROGRAMS.has(ix.prog))) return null`. Any transaction that also carries a System or Token transfer between strangers is relayed as long as one instruction names a CBOB program; `expire_boosts` naming a record with no due boost lands as a no-op, as does `reschedule_reveal` on a nonexistent... (that one fails) — `expire_boosts` suffices.

**Why it matters.** The README states "A plain SOL or token transfer is not relayed" and the repair's purpose was to stop relaying strangers' value transfers on the Bank's provider credit and attribution. The cost is unchanged from L1 (credit, attribution at 1 send/s/IP); no holder is exposed.

**Evidence if true.** `txRefusal([base64(tx with [expireBoosts(ids,[anyRecord]), SystemProgram.transfer(a→b)])])` returns `null`; `proxy.test.mjs` has no such arm (its L1 arms test transfers WITHOUT a CBOB instruction).

**Fix.** Allow non-CBOB instructions only from a whitelist of shapes the pages actually combine (ATA `createIdempotent`; System transfer only to the revenue address; Core `ExecuteV1` on a CBOB vault; the ceremony's collection create), and refuse any other System/Token instruction regardless of what accompanies it. Add the bypass as a refused arm.

## L-C (LOW, documentation: SPEC 10/47, DESIGN §4, HOLDER-GUIDE honest list) — Retiring the guardian removes the only instant stop on a leaked swap-operator key; nothing says so

**Construct.** `arm_guardian(None)` → `apply_guardian` → `guardian = default`; `require_guardian` then refuses everyone. `emergency_stop_sweep` is the only immediate brake on `sweep_sol_for_swap`. With no guardian, a leaked operator key drains `max_sweep_lamports` per `sweep_cooldown_secs` (10 SOL / 6 h ruled) until a replacement is armed (3-day vote, half of all live vaults) and applied (7-day notice): at least ~10 days ≈ 40 windows ≈ 400 SOL, bounded only by what the revenue PDA holds above 0.05 SOL. HOLDER-GUIDE says the key "could keep up to 10 SOL of royalty money every 6 hours ... until the guardian stops it" and DESIGN says only "a guardian of None is legal, so the community can also retire the brake entirely".

**Evidence if true.** Read `require_guardian` and the absence of any other sweep stop; 6c.21 already proves nobody can pull a retired brake.

**Fix.** One sentence in SPEC 10/47, DESIGN §4 and the honest list: "If the holders retire the guardian, a leaked swap-bot key has no instant stop; the bound becomes cap × windows for the vote plus the notice."

## INFO items

- **I-1 (ceremony, variant of M-A):** before step 0 the page silently adopts a stranger-created, identity-matching clean collection; harmless functionally, but Gary should see "found on chain, not created here" and confirm.
- **I-2 (MINT error text, holder-facing via `errors.json`):** `BadSweepBound` says "cooldown 1s to 7 days"; `initialize` refuses above 24 h (`MAX_INIT_SWEEP_COOLDOWN_SECS`); 7 days is the tighten ceiling's absolute bound.
- **I-3 (web/redeem):** the prior transaction makes the holder pay rent (~0.002 SOL each) for owner ATAs of stranger-chosen stray mints that will be delivered; bounded by the packet (≲8), recoverable by closing later; the page does not say so.
- **I-4 (suite gaps):** the unexercised refusals and rescue branches listed under R8; the e2e has no exact floor and is not in `run-tests.sh` (R36 A8, open).
- **I-5 (tx reader):** `validateParsedTransaction` treats a `null` `logMessages` as unreadable (fail closed) — correct; I found no way to lose a CBOB event silently through `txread.mjs`/`sigwalk.mjs`. The detectors that consume the lines are outside this bundle.

---

# The accepted limits: the four questions

**1. Worse than stated?**
- **Limit 47 / 10:** worse in one branch not written down (L-C): guardian `None` plus a leaked operator key.
- **Limit 44 / R36 H1 claim:** not worse on chain, but the page's "cannot block" is weakened by L-A (a practical block by checkbox count).
- Limits 25, 26, 27, 28, 32, 36, 40, 42, 43, 46, 55, 58: as stated on my reading. Limit 26's cohort and choice language matches the mechanism.

**2. Not actually a limit / already closed?**
- None found closed that is listed open. Limit 13 could name the rescue delegate (R36 A1, optional).
- Limit 45's correction (a round still open can mint) is accurate.

**3. DISCHARGED not actually discharged?**
- 51, 54, 14, 19, 30, 31, 33, 12/17: discharged on my reading. 54's holder-page rule holds in the built pages (no crank is ever sent).

**4. OPEN AND BLOCKING quietly treated as accepted?**
- 22, 38, 50, 52, 53: none demoted. Item 50's pages are built but unpublished and the guide is DRAFT; item 53's rehearsal value set is still "not built" and the `rehearsal` profile refuses. The ceremony (item 52) is what M-A targets, so M-A should be fixed before step 10, not after.

---

# What this project should do before launch that AI audit structurally cannot

1. **Run road step 10 against a decoy.** Before the real ceremony, create a Core collection with update authority = MINT's `["mint"]` PDA on the rehearsal deployment and prove the (repaired) ceremony page still completes. No reading of `ceremony.mjs` substitutes for a hostile account on a live validator.
2. **Sign each page's transaction with a real Phantom, desktop and mobile, against a dry run** (R36 U1). `signExact` refuses any wallet that alters the message; whether Phantom does so cannot be known from source.
3. **Do the Squads return drill with the real Squads v4** (R36 U2): rescue a vault to `bc92Z…` on the rehearsal and return it with a real multisig transaction that CPI-signs Core `TransferV1`. The suite's keypair stand-in proves nothing about Squads.
4. **The dress rehearsal as item 22 names it**, including one full revenue cycle through each pool and one forced post-sweep failure recovered by hand, and the crank against ~2,100 records with a live RPC. Then re-run `rehearsal-tree.sh`'s proof at the release commit (item 53).
5. **Watch a Metaplex Core upgrade happen.** Subscribe to Core's upgrade authority and ProgramData on mainnet for the weeks before the lock; decide in advance what you will do if the pinned hash changes between the audit and step 11, because after step 11 nothing can adapt (limit 40).
6. **Re-pin `dist/` at the actual release commit and update `web/src/config.js` in the same change**, then run `build-mainnet.sh`, `run-tests.sh` with `CBOB_SHIP_GATE=1`, `run-sim.sh`, `web/test/run-all.mjs` and the e2e, and record every sha256 next to the commit. The tests enforce the binding; only a person can perform it.
7. **Have a non-engineer read HOLDER-GUIDE.md aloud and say back what "activated", "credited", "delivered", "opened" and "rescued" mean.** Every sentence I checked is true of the code; whether a holder understands them is not a property code can have.
8. **Fix the launch values' two remaining OPEN fields with Gary and nobody else**, run `check-launch-params.mjs` on the file that will actually be embedded, and keep `lock_deadline` at least 24 h before `charter_opens_at`, since limit 13's "could rewrite any level" now also means "could sign as the rescue PDA and transfer any vault" until step 11.
9. **Decide the custody of the three hot keys this design leaves** (Moments update authority, swap operator, $CBOB release wallet) as an explicit written ruling per key with the person who holds it named, because every one of those is a limit the programs cannot see.

**Measurement limits of this report.** No validator, no network, no `bank/` beyond the two bundled readers, no run of the suite, sim, e2e or web tests; all program claims rest on reading and arithmetic checked against the measured arms the bundle names. M-A, L-A and L-B are reproducible offline with the bundled modules (`resolveCollection`, `planRedemption`, `txRefusal`) and I have stated the inputs that would show each.