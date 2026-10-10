# Round 47 — independent audit of the whole tree (five programs, suite, simulation, build, web/, rehearsal tooling)

**Method and what I did not do.** I read every file in the bundle whole. I recomputed every cross-program offset and account space from the struct definitions, re-derived the pool, boost-ring and rate-limit arithmetic, walked every value path in the four Anchor programs and the sweep helper, and read each holder page's transaction builder against the programs' account structs and SPEC item 50's client contract. I ran nothing: no validator, no RPC, no mainnet read. Every "measured" claim below is therefore a reading of the bundled logs and arms, and I say so where it matters. Files named in the prompt as *not carried* (`bank/crank.mjs`, `bank/detectors.mjs`, `bank/layout.mjs`, `bank/swap.mjs`, `scripts/check-launch-params.mjs`, `web/test/ref.mjs`, the generated JSON) are not inferred; where a claim would turn on them I stop.

**Headline.** I confirm **no finding in the five programs**, **no path that moves or miscredits value**, **nothing that stops or wrongly refuses a holder's crack**, and **no HIGH or MEDIUM anywhere**. Everything I did find is LOW/INFO in the fixable layer (documentation, one new page surface, two weak suite arms) and is listed with its evidence at the end. Under SPEC gate 3 this tree is LAUNCH-CLEAN on my reading; it is **not a no-change round** only in the sense that the LOW/INFO items below should still be fixed under gate 5.

---

## R0. Round 46's verdict and the post-46 changes

**The round-46 programs verdict's disproofs hold at this tree.**
- C9 (Ember/GLM W46-1): in `plan-redeem.mjs` the `named` set is built from `ack` *before* `unlisted:*`/`nfts:*` are pushed and before `groupAcks`; at that point every id but `forfeit` ends in an address, and `forfeit` yields `''`, skipped by `a &&`. Correct.
- C10 (MiniMax CRITICAL): `apply_swap_operator` is `require_keys_neq!(c.pending_swap_operator, Pubkey::default(), NoPendingOperator)`; arm 3c.K5 applies after the notice and 3c.K5a shows the old key refused. Correct.
- C25 (Grok): the helper checks only data `[0]`, destination owner and mint, and `signer != dest`; a native wSOL source, a non-ATA destination and another vault's signer as destination are all accepted. Correct.
- C26 (Grok): BURN's three delegate/close-authority checks precede `d.len() == 165`, so 3.3 is pinned to `ReserveDelegated`. Correct.

**The round-46 repairs are present at the sites named.** V46-1: `step()` sets `resumable: !isSingleSend(name)` with `SINGLE_SEND_STEPS` enumerated and `rescue`/`revenue-forced-failure` explicitly resumable. V46-2: `ceremony-values` is a `{recheck:true}` step judged by `judgeValuesFresh`, re-run by `recheckAction` when MINT is uninitialized and the date is stale. V46-3: `nestedSent` is set whenever vault-3 sits at the nest PDA or the treasury. V46-4: `handRecover` resumes after a landed `pendingSwapSig` (needs `operatorSatsBefore`) and `handClosed` reads an already hand-closed cycle as done. V46-5: `takesOverrides(P) = P.launchJudge !== 'mainnet'` in both `build.mjs` and `config.js`, so `mainnet-local` refuses overrides. V46-6: `if (fails.length) return null` after the value checks. V46-8: `judgeInitAccount` runs before anything is sent; `initKeyFor('mainnet')` is Gary's wallet; the rehearsal record shows the whole run completed with that design.

**One thing to record about the round-46 verdict itself, not this tree:** its quorum was 6 of 8 with one seat counted "narrowly". That is the triage's own honest statement; it is a process fact the launch gate should weigh, not a finding.

**Post-46 code, audited as new:**
- `scripts/sbf-strip.sh` / stripped `dist/`: `llvm-objcopy --strip-all` from platform-tools v1.54 on the linker output; every runner now deploys the stripped bytes, and `build-mainnet.sh` compares the stripped sweep helper in `dist/` with the stripped `target/deploy/` copy the suite deployed. The CI workflow pins the container by digest and `solana-verify` by version, and its gate diffs three sha256 lists. The audited-sums list is sorted with `localeCompare` on the filename while `sha256sum *.so` is glob-ordered; the recorded run came back IDENTICAL, so the orders agree for these five names. Fine. (If a sixth name ever started with a letter that ICU and ASCII order differently, the gate would fail closed, not open.)
- `web/src/lib/tx.mjs` (`judgeWalletEdits`, `withComputeBudget`, `buildForWallet`, `sendRaw`): see R0-W below; no value-moving defect.
- `web/src/lib/my-vaults.mjs` + `reads.mjs vaultsOwnedBy`: every candidate re-read from Core and MINT's record; the DAS index can only suggest. One INFO on the label (F-4).
- `reads.mjs vaultWalletAccounts` (getTokenAccountsByOwner per program, 8-byte slice): shape matches `tokenListingShape`; a refused program is named, never hides the other.
- `rpc-proxy.mjs`: Lighthouse added to `TX_PROGRAMS` and excluded from "work"; a Lighthouse-only transaction is still "does nothing these pages do". `tokenListingShape` requires exactly `{offset 64, length 8}` base64.
- `scripts/rehearsal-refresh.mjs`: snapshot before, clash check before any write, same-map re-apply with the tree script's own proofs, byte-for-byte keep check after. Sound.
- `README.md`: two INFO drifts (F-1, F-2).
- Core re-pin to `51d41542…` after 912/912: the suite's behavioural arms (SR.5–SR.5e, R.6, R33.G3, 3.7) are the evidence that Core's authority rules still hold on this binary. One INFO on SPEC 40's wording (F-3).

## R0-W. The pages against the programs and SPEC 50's contract

Checked instruction by instruction (`ix.mjs` against each program's `#[derive(Accounts)]`): `openForRedemption` (asset at 0, owner at 2), `burnVault` (asset 0, owner 2, asset_signer 3, config 5, seal_config 6, instructions 7, mint_program 10, mint_config 11, vault_record 12, pool 13, then declared), `poolClaim` (crank byte 0 then pairs), `sweepHelper`, `coreExecute` (ExecuteV1 = 31; the asset signer's signer flag cleared in the inner keys, Core re-adds it), `activate`, `rescueNested`, `distribute`, the four initializes, `claimCharterVault` (pob_extra 0), `mintVault`, the three draw instructions, `expireBoosts`. All agree with the Rust. `web/test/ix.test.mjs` compares each against the suite's/sim's extracted builders and against spl-token/mpl-core, and its control arm proves `diffIx` can fail.

SPEC 50 contract, as built in `plan-redeem.mjs`: prior transaction creates the holder's destination ATAs and the vault's missing reserve ATAs (owner pays, rent returned at close); `claim` only for an active vault and never while the pool is frozen (forfeit box otherwise); one ExecuteV1 into the helper naming all three reserves plus deliverable classic strays; one ExecuteV1 SPL `Transfer` per C5 account; `burn_vault` declaring six ATAs; sizes checked with `legacySize`; no crank anywhere; `judgeRedemptionCoverage` as a cross-check that refuses only the un-named. The frozen-reserve-with-balance, foreign-close-authority-on-a-reserve and non-owner cases refuse; everything a stranger can plant is a box. This matches the contract and the C5 rule.

`judgeWalletEdits`: a wallet may add only Lighthouse and (when the page set none) a bounded compute budget; the page's instructions must survive byte for byte, contiguous, with no new signer or writable account. I looked for a Lighthouse instruction that moves value: `MemoryWrite`/`MemoryClose` need a writable memory account or destination, which the writable rule refuses. The `at` contiguity check and the fee bound are correct. One hardening note (F-5): `sameIx` ignores per-key flags; a downgrade (writable→readonly) slips through and only makes the transaction fail. No value path.

## R1. Custody

Attacks tried on the pairing, all refused by the code as written:
- Burn hidden in a CPI: SEAL's walk sees top-level instructions only (`load_instruction_at_checked`); a wrapped burn is invisible → `NoTerminalBurn` (WR.2 measured).
- Open reached by CPI: `load_current_index_checked` reports the outer index; the wrapper would need a genuine top-level burn for the same asset+owner, and BURN independently demands a genuine top-level open (WR.3).
- Two vaults in one transaction: both halves bind asset AND owner at fixed indices; open A/burn B refused (3.9, 4.10); open A, open B, burn B, burn A pairs correctly and then meets the rate limit (4.10a).
- Transfer during the thaw: `burn_vault` reads the asset's owner bytes at execution → `NotTheOwner`.
- SetAuthority(AccountOwner) on a reserve ATA during the thaw: the reserve loop requires `owner == pda` → `ReserveNotOurs`.
- Delegate or close authority on a reserve ATA: refused unless the account is gone (3.3/3.3a).
- Token-2022 extensions: `len == 165` after the delegate checks; a Token-2022 ATA for a classic mint cannot be created (probe, measured on mainnet).
- Lamports: `asset_signer.lamports() == 0` before the reserve loop; a stranger's lamports block only a pre-read sweep (9.10/9.11); the helper moves the live balance.
- Nested Core asset declared → `VaultStillHoldsAVault`; undeclared → destroyed/rescued (stated).
- Declared foreign-owned accounts are skipped by both loops; they cannot be used to satisfy anything.
- A thawed vault leaving the transaction unburned: impossible; `NoTerminalBurn` is required for every open and any failing instruction reverts the thaw.

`retire_redeemed` is reachable only from inside `burn_vault` (stack height exactly 2 and the top-level instruction's program, discriminator and asset index 0 pinned: WR.1, P.23). `rescue_nested` moves a vault only when its owner is the asset-signer PDA of itself, a tombstone, or a live vault of this collection, and only to `bank_treasury`.

**No custody finding.**

## R1s. The sweep helper

(a) Called directly it needs the asset-signer's signature (SR.1). Through Core, this binary approves Execute for the owner only (SR.5 stranger, SR.5a owner-added transfer delegate, SR.5c a signable collection update authority, all `NoApprovals`; SR.5d owner control). On a frozen vault Execute is refused by the seal (3.7). I note that the Execute-authority reading in SPEC 40 is of source `e72d63e`, and the pinned binary since 2026-10-09 has no published source; the suite's SR.5 family is now the whole evidence (F-3).
(b) Source twice: the second read finds a System-owned, zero-length account → `IllegalOwner` (SR.12a, pinned to the second guard by SR.12b). Destination twice: fine. Source also a destination: impossible (owner must be signer for a source and dest for a destination; `signer != dest`). Native wSOL source: `amount = lamports − rent` moves, close returns rent to dest; accepted. Delegate on source: owner transfers, delegate irrelevant. Foreign close authority: close reverts (R36.C5). Frozen: transfer reverts (SR.14). Non-ATA destination: accepted (owner's choice). Destination = another vault's asset-signer: accepted; lamports and tokens land in that vault (the redeemer's own choice; the lamports then block that vault's redemption until swept). Odd count → `NotEnoughAccountKeys` (SR.7); zero pairs → lamports-only sweep (SR.13).
(c) Destination not compared with the owner: safe because only the owner can reach the helper through Execute, so the destination is the owner's choice. Lamport credit to a non-System account lands (R27.S1); a sub-rent credit to an absent account is refused (R41.C8a–c); the pages name the fee payer, which exists.
(d) `signer.lamports()` at execution, all moved. Nothing a stranger controls can run between it and `burn_vault`; Core's BurnV1 does not touch the asset signer (fact 4, SR.4a's exact lamport ledger).
(e) The closed account passes BURN as `owner ∉ {Token, Token-2022}` → `continue`, i.e. skipped for the right reason (a zeroed System-owned account). A reserve ATA that does not exist at build time: the page creates it in the prior transaction; a stranger's deposit between the two is then swept live. A Token-2022 ATA for a classic mint cannot be created (measured on mainnet); a non-ATA token account or a nested Core asset is never a reserve derivation, so BURN ignores it and the helper need not name it: destroyed, not blocking. Sufficient.
(f) S8.0 asserts `B ≤ 1232 − 52 − 96` on claim+open+helper(3 pairs)+burn with the owner paying. The real page puts `claim` first (same size), adds its own two compute-budget instructions when they fit (`withComputeBudget`), and has no separate payer. A fourth reserve does not exist; the in-line monthly run's only account is the pool, already present in `claim` and `burn_vault`. The measurement covers the page's shape. What it does not cover is a Phantom-added Lighthouse wrap on the ~1,200-byte openings, which the README states cannot fit.
(g) SR.0–SR.14, R36.C5, S8.0–S8.3 are each tied to an exact Core/Token/helper error. The helper deployed by the suite is `target/deploy/cbob_vault_sweep.so`, which `build-mainnet.sh` `cmp`s with `dist/`; both now stripped by the same script.

## R2. The pool

Invariant "pool ≥ ceil(owed)" by induction over every mutation:
- `credit`: `delta = ⌊avail·S/w⌋`, `owed += delta·w ≤ avail·S`, with `avail = balance − ceil(owed)` (or `saturating_sub` in-line) → holds.
- `claim`: pays `P = ⌊pending/S⌋` sats and subtracts `P·S` from `owed`; `B − P ≥ ceil(owed) − P`. Carry keeps the sub-sat remainder; `debt = w·acc`. Deferred-frozen leaves both untouched.
- `retire`: `owed −= pending`, no payment (ClaimBeforeBurn unless forfeit).
- `reweigh`/`expire_boost`: `owed` unchanged, carry absorbs the share.
- `join`: `debt = w·acc`, nothing owed.
Round 24 W11's weaker rule is what the code does: a joined vault shares what is in the pool at the next distribution.

Counters under every ordering: `pending_count` and `pending_this_epoch` move together on request, `advance_epoch` zeroes `pending_this_epoch`, `retire` decrements `pending_this_epoch` only when `request_epoch == dist_epoch` (correct, F21.1), `join` decrements `pending_count`. `active_count`/`total_active_weight` move only in `join`, `retire`, `reweigh`. Duplicate records in one `claim`/`expire_boosts` are re-read from the account each pair (BO.32, K.7).

Liveness: `JoinWaitingFirst` can always be cleared by a permissionless `claim` naming the record and its recorded ATA (no liveness or balance read in the join path), `BoostsExpireFirst` by `expire_boosts` with records only; a batch is the caller's own. With `w == 0` and nothing pending, the free path refuses `NoActiveVaults` until a new request (limit 45's analogue; stated). A frozen pool blocks paying claims, not joins, not forfeits.

**No pool finding.**

## R2b. The boost

A boost bought at epoch `e` for `N` ends at `e+N`: `ring[(e+N)%64]++`; `advance_epoch` moves `ring[new]` into `due` and zeroes it. It earns distributions `e+1..e+N` exactly (BO.21/BO.35 pin both orderings in one transaction). No distribution runs past a due boost (`distribute` and `monthly_inline`). `unschedule_boost` takes the due or ring branch by `dist_epoch ≥ end`; `retire` of a boosted vault removes `weight_of` (level+boost), the ring/due count and `boost_weight_total`. `reweigh` conserves `owed_scaled`. The N1 host test drives 260 epochs through the program's own functions. `N ≤ 63 < 64` so two live end epochs never share a slot. Nothing earned is gained or lost on weight change; `expire_boost` logs and zeros `boost_end_epoch`. Double expiry impossible (`boost_weight == 0` skip); early impossible (`dist_epoch ≥ end` required); never impossible (permissionless, records only).

**No boost finding.**

## R3. The draw

`blockhash_in_window`: sysvar key pinned, count ≤ 512, buffer length checked, smallest produced slot in `[want, want+64]`, all-zero hash refused. `try_capture`: A ≥ reveal_slot, B and C each two 4-slot groups past the previous; C ≤ reveal+208 < window 300; A stays inside the 512 buffer at any capture time ≤ reveal+300. FIFO: `index == revealed_total`. A burned head still draws, Core skipped (L.11). Attribute re-supply hashed against `attrs_hash` (L.4). Reschedule: `now + 16`, only after the window, logged.

Influence: the minter chooses the mint slot (hence which leaders hold A/B/C's groups); C's leader chooses among draws by skipping within its 4-slot group and by block content; a rescheduler chooses `now` and so C's neighbourhood; a minter can let a draw lapse only if nobody captures for 300 slots. SPEC 26 states "chooses among many draws" with the best-of-4-by-skipping numbers; HOLDER-GUIDE says "can pick among several results, by skipping a block or changing what goes into it ... every vault created in that moment at once." That is true. It is not worse than stated: the reschedule timing lever is already named in 26.

## R4. Governance

Snapshot at creation (`index_snapshot`, `quorum_supply = minted − burned − bare_retired`), vote bound to the asset, `VaultTooNew`, no proposal before `charter_closes_at`, quorum/threshold/10% YES, key changes need ≥50% of the snapshot and never share a proposal, notice before apply, guardian may cancel a pending operator and nothing else, `TightenSweep` monotone and bounded, overtaken actions skipped with `CBOB_ACTION_SKIPPED` and the round mark advanced before the over check (3c.R1). GOV's `restart` skip (`stopped_at ≥ created_at`) mirrors MINT's `StopIsNewer` (`stopped_at < created_at` to pass). Proposal space 259 bytes, `ACTION_MAX_BYTES` 37 (`Brakes`), both recomputed.

Minority carrying what it should not: a 10.71% YES can open a round at the floor with cap 2,100 and set boost terms at any positive price (ruled; stated in item 51 and the guide). Reaching money: no action touches the split, destinations, supply, royalty or a vault. Frozen forever: limit 47's "permanent at low turnout" is exact; a stolen guardian key can also cancel every armed operator forever, which 47 states. **No governance finding.**

## R5. The charter claim

Address identity by domain-separated, sorted-pair Merkle root; `merkle_leaf`/`merkle_root_from` match `pob-merkle.mjs` byte for byte (leaf tag 0x00, node tag 0x01, odd node promoted); depth ≤ 16. The PoB must be a live AssetV1 in `pob_collection`, owned by the signer, burned by CPI as owner in the same instruction; `pob_extra` accounts never signers; window by clock alone; not gated by the stop. SPEC 46 names the two outcomes (end the project / capture governance), the per-asset alarm blind spot, the 30-minute sampling gap and the positive bound (no transfer or burn by the key, measured R32.A22a). Checked for omissions: moving a PoB out of the collection (stated, same class), renaming (irrelevant, identity by address and the page labels from the pinned set), freezing (owner-managed, the key cannot), minting lookalikes (C.8). I found nothing SPEC 46 omits.

## R6. One-time configuration and the trusted hop

`initialize` across the four programs accepts what the launch checker must catch: a `guardian` of `None` (no brake ever; legal by ruling), any on- or off-curve `swap_operator`, any non-default `pob_collection`, caps summing below `max_supply` (then the census is the effective supply), a `charter_opens_at` already past (only `closes_at > now` is required), `redeem_window_secs` 10 s, `monthly_secs` 60 s, `min_voting_secs` 60 s, SEAL reserve accounts checked for owner only. All stated in item 38; `launch/mainnet-init.json`'s ruled values sit inside every bound I recomputed (reserve ceiling 0.1 SOL ≥ reserve 0.05 SOL ≥ rent; floor 1 SOL ≤ cap 10 SOL; cooldown ceiling 24 h ≥ 6 h; boost epochs 24 ≤ 63). The swap operator's worst case is cap × cooldown windows until `emergency_stop_sweep`, never cbBTC. The royalty: `PluginAuthority::None` at `initialize`; no MINT CPI updates, removes or re-delegates a collection plugin afterwards (R.6/R.6a/R33.G3 measured). The rate limit is exactly a 64-slot ring of timestamps with the k-th most recent at `(head + 64 − k) % 64` and `now − kth ≥ window`.

## R7. Raw reads

Recomputed from the structs: MintConfig body 1,005 bytes (+256 = 1,261; `MINT_CONFIG_SPACE` sums to 1,261), with `governance` 41, `pool_ata` 73, `round_id` 105, `price` 125, `minted_total` 141, `bank_treasury` 157, `sales_stopped` 191, `sweep_stopped` 192, `guardian` 193, `swap_operator` 225, `sol_reserve` 257, `max_sweep` 266, `cooldown` 274, `level_caps` 290, `level_minted` 310, `revealed_total` 330, `charter_closes_at` 442, `charter_claimed` 450, `bare_burns_retired` 454, `sales_stopped_at` 518, `sweep_stopped_at` 526, `monthly_secs` 574, `pending_guardian_at` 615, `notice_secs` 623, `sweep_floor` 631, `cooldown_ceiling` 639, `reserve_ceiling` 647, `dist_epoch` 655, `pending_this_epoch` 671, `cbob_mint` 679, `max_boost_weight` 711, `max_boost_epochs` 712, `boost_expiring` 749. Every GOV, BURN and suite constant matches. VaultRecord body 211 (+10 = 221): `mint_index` 41, `level` 57, `vault_ata` 129, `debt` 161, `pending` 177, `request_epoch` 178, `boost_weight` 186, `boost_end_epoch` 187, `carry` 195; GOV's 9/41 and the proxy's 125..195 slice (`d[61]`, `d[62..70]`) match. BurnConfig 827 (`burned_total` 42, window 50, head 58, ring 59). GovConfig 350 (`proposal_count` 53). SEAL config 398 (`version` 8, `collection` 9, reserves 41). Helper: 0/32/64/165. No misread.

## R8. The suite, simulation and build as evidence

Arms that cannot fail, or are weaker than their names: see F-6 (R.4's regex) and F-7 (`C.2`-style "true" arms that can only throw, which is still a red run). The `because()` list pins every negative I checked to the right program and code, including the cross-program ones (3c.F1 `0x11`, SR.3 `0xb`, 9.13 System `0x0`). Claims in the prompt no arm exercises: the holder guide's "announced on X" (no sender; item 50, known); the mainnet 3,600 s window and 30-day month (same arithmetic, stated). Bytes: the suite deploys the stripped localnet build; the four keyed programs are proven by behaviour (`initauth.test.ts`, both directions, REACHED_PAST limited to post-authority errors); the helper byte-identical; the CI gate ties `dist/` to the container and to `solana-verify`.

---

## The accepted limits: the four questions

**1. Worse than stated?** None found exploitable. Two wording gaps: limit 40's Execute-authority analysis cites source `e72d63e` while the pinned Core (since 2026-10-09) has unpublished source (F-3); limit 46 is complete.

**2. Not actually a limit / already closed?** Limit 42's categorical "only two fit" is already corrected in its own text. Nothing else to remove.

**3. DISCHARGED not discharged?** 14, 19, 30, 31, 33, 51, 54 and the v5 family are correctly discharged against this code.

**4. OPEN AND BLOCKING quietly accepted?** Item 22: the road table marks step 8 "done" while item 22's own text keeps the ~2,100-vault scale open and 22.2 is recorded FAIL by true detection (F-2). Item 53: the in-tree full-suite proof is recorded at `e7c192a`; the release moved to `d2ae5fc` and the rehearsal tree was refreshed to `1650336`; no in-tree run at the final commit is recorded (F-2). Items 38, 50 and 52 read correctly as open.

---

## Findings

No CRITICAL, HIGH or MEDIUM. All of the following are outside (a)–(d): none is in the five programs, none moves or miscredits value, none stops a crack.

**F-1. INFO (docs, holder-facing).** `README.md`'s generated programs table says SEAL "holds each vault's reserves". It does not: the reserves sit in Core's asset-signer PDA; SEAL holds the `PermanentFreezeExecute` authority and the thaw-only-toward-burn rule. Evidence: the sentence in the facts block (and its source string in `scripts/readme-facts.mjs`, not bundled). Fix: "holds each vault's seal: nothing leaves its wallet until the owner opens it".

**F-2. INFO (docs, gate state).** (i) SPEC's road table marks step 8 "done" while item 22 remains OPEN AND BLOCKING for the ~2,100-vault scale and 22.2 is recorded FAIL (a true `config_drift` detection of the Core upgrade). The row should carry both qualifications so item 22 is not read as discharged. (ii) Item 53 still requires "the same in-tree run again" at the final commit; the recorded proof is at `e7c192a`, the release is `d2ae5fc`. Evidence: `SPEC.md` road table, item 22/53 text, `audits/round46/VALIDATION.md`, `RECORD.md`. Fix: record the item-22 state per sub-item and either run the in-tree suite at `d2ae5fc` or state why item 53 is now moot (rehearsal complete, programs closed).

**F-3. INFO (docs).** SPEC limit 40 grounds "who may act through a vault's wallet" in Core source `e72d63e`. The pinned binary `51d41542…` was deployed from unpublished source; the holder guide says so, SPEC 40 does not. What stands is the behavioural evidence (SR.5–SR.5e, 3.7, R.6, R33.G3 on the pinned binary). Fix: add the sentence and name the arms as the current basis.

**F-4. INFO (new surface, limit 57 class).** `my-vaults.mjs` labels each pick `"<minter-chosen name>, Level X[, active]"`. The name is untrusted (limit 57); a vault named "Level V" renders "Level V, Level I". Only the holder's own vaults are listed, so no value moves, but the level should lead and the name trail (or be omitted) so the record's fact is not visually overwritten. Evidence: the label template in `myVaultsView`.

**F-5. INFO (hardening).** `judgeWalletEdits`'s `sameIx` compares program, data and key *addresses* but not per-key `isSigner`/`isWritable`. Additions are caught by `roles`; a downgrade is not, and only makes the transaction fail on chain after the holder signed. Fix: compare flags too, then the message is byte-equal or refused.

**F-6. INFO (weak arm).** Suite R.4 lists collection plugins by a regex over fetched keys that omits newer kinds (`groups`, `freezeExecute`, `permanentFreezeExecute`), so it would miss a collection plugin of those kinds. It cannot pass falsely today because 0.1g refuses any pre-existing plugin and `initialize` adds only Royalties; the arm is weaker than its title. Fix: enumerate the mpl-core plugin list.

**F-7. INFO (edge).** `plan-get.mjs planClaim`: `pick.info.plugin(t)?.body.frozen` throws a TypeError when a FreezeDelegate registry entry exists with an unparsable body (`body === null`), surfacing as an opaque error rather than the "needs a person" refusal. Not producible by Core today. Fix: `?.body?.frozen`.

**Already-known drifts, not re-filed:** HOLDER-GUIDE's "announced on X and on the Bank's website" (poster has no sender; item 50, the guide is DRAFT and may not be published first); the pages' deposit-address surface (item 50).

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE: what to do before launch that AI audit structurally cannot

1. **Put real Phantom on the real pages against the real programs, on mainnet, at the widest shapes, before step 11.** Every model here reads code; none has driven Phantom. The rehearsal landed three Phantom openings, but the two widest shapes (claim-first with strays ~1,218 B, W5 ~1,201 B) fit neither the page's budget nor Lighthouse, and whether Phantom then adds its wrap or produces an oversize transaction is, by the README's own words, undocumented. Do a 1,200-byte opening on a rehearsal-grade deployment through the actual extension and the actual mobile app. If Phantom refuses or alters it, the fix is a v0 lookup-table client, and that is a page change, not a program change, so it must be known before the pages are published, not after holders depend on them.

2. **Decide, as a matter of record, whether to launch immutable programs on a Core build whose source is unpublished**, or to wait for Metaplex's tag and OtterSec verification of `51d41542…`. The suite's 912 arms are behavioural evidence on that binary; no reader (human or model) has read its source. Only Metaplex can close that, and only Gary can rule on waiting.

3. **Have a second human hold the keys the box holds.** The deploy authority (until step 11), the swap operator key, the $CBOB release wallet and the crank key sit on one machine with the alarm that watches them. No audit can verify custody; a second signer or a cold copy under a different person is an operational act.

4. **Run the launch ceremony's dry run with Gary at the keyboard reading each value aloud against `launch/mainnet-init.json` and `DESIGN-v6.md`**, with someone else checking. The programs accept several wrong-but-legal values (a past `charter_opens_at`, a 10-second window, a `None` guardian). The checker judges the file, the page judges the embedded copy; a human must judge that the file says what Gary decided, especially the still-OPEN `charter_opens_at` and `lock_deadline`.

5. **Write down, now, the playbook for the three things that can only be survived operationally:** a Coinbase freeze of the pool (who tells holders, how the crank is parked), a Metaplex Core upgrade after the lock that breaks `UpdatePluginV1` or `BurnV1` (what the alarm says, what holders are told, that nothing can be fixed), and a stolen guardian key at low turnout (how a 50%-of-live-vaults vote is organised). AI can list these consequences; only people can rehearse the response.

6. **Publish the holder guide only after the redeem page is live and only after a non-engineer has opened a vault from it unassisted**, reading nothing but the page. Whether a holder understands "tick each box, each names something lost" is a measurement no model can make.