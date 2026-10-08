# Round 38 Audit Report

## R0. Round 37's verdict and repairs

I independently verified all three confirmed findings from round 37's programs pass and the off-chain pass's C01-C07 repairs.

**V1 (redeem page flood).** `web/src/lib/reads.mjs` `vaultWalletAccounts` now reads the three reserve ATAs by address (getMultipleAccounts, never through the listing), then lists classic and Token-2022 accounts with 8-byte balance slices and address-only slices, reading at most 200 in full. `plan-redeem.mjs` turns `strayReadIncomplete` into one box (`unlisted:all` or `unlisted:<count>`), never a refusal. The grouped-box logic (`groupAcks`, STRAY_GROUP_OVER=20) collapses >20 stray boxes into one with a count and a digest id. The e2e test (`web/test/e2e-localnet.mjs`) exercises 320 parked accounts and asserts one grouped box with the opening landing. **Repair verified.**

**V2 (ceremony decoy).** `web/src/lib/ceremony-reads.mjs` `resolveCollection` now uses any pin (config.js, SEAL, launch file, browser memory, session) and IGNORES other chain collections with a warning. With no pin, it checks `collectionCreator` (first transaction naming the address, must be Core CreateCollectionV2 paid and signed by the launch key). Two created by the launch key is a STOP. A decoy is never adopted. The e2e test creates a stranger's decoy before step 0 and asserts it's ignored. **Repair verified.**

**V3 (frozen activation).** `web/src/lib/plan-vault.mjs` `planActivate` now builds the activation instruction for a frozen cbBTC account (MINT reads the balance, not the state) and adds a note that payouts wait for the unfreeze. `web/test/plan.test.mjs` has the V3 arms. **Repair verified.**

I re-tested the claims round 37 disproved (W1-W16) by reading the code at each site. I found no reason to reopen any of them.

## R1. Custody

I attacked the pairing (CPI wrappers, two vaults in one transaction, account-index binding, instruction-sysvar parsing) and the emptiness proof (Token-2022 extensions, delegates, close authorities, lamports, nested Core assets, declared-but-foreign accounts).

**The pairing holds.** SEAL walks forward from its own index for a burn_vault matching asset (account 0) and owner (account 2). BURN walks backward for an open_for_redemption matching the same. Both bind asset AND owner. A CPI-wrapped open reports the outer instruction's index, so a wrapper needs a genuine top-level burn for the same pair; a CPI-wrapped burn is invisible to SEAL's forward walk. The stack-height check in `retire_redeemed` (height must be exactly 2) plus the instruction-sysvar check (top-level must be BURN's burn_vault for this asset) close the wrapper path. The suite's WR.1-WR.4 and the test-only CPI forwarder measure all of this.

**The emptiness proof holds for what it can see.** The reserve loop requires every reserve mint's ATA under both token programs to be declared; a closed account (System-owned, 0 lamports) is skipped for the right reason. The second loop applies the same delegate/extension/emptiness checks to declared non-reserve accounts owned by the PDA. The known completeness gap (undeclared holdings) is the accepted limit.

**No path leaves a thawed vault unburned in a surviving transaction.** A partial sweep leaves a balance BURN refuses; the thaw reverts with it.

## R1s. The sweep helper

**(a) Access control.** The helper's whole access control is Core's ExecuteV1 rule on a thawed vault: only the asset's owner. SR.5/SR.5a/SR.5b/SR.5c/SR.5d measure this against the pinned Core binary. A frozen vault cannot be executed (the seal). Outside a redemption, the vault is frozen, so the helper is unreachable. I found no path around this that does not require a Core upgrade (accepted limit 40).

**(b) Pair list.** A duplicate source fails on the second iteration (the first closed it; `read_token` refuses the System-owned account). A source that is also a destination fails (the source must be owned by the signer, the destination by the dest wallet; the same account cannot be both unless signer == dest, which is refused). A wSOL source works (transfer then close; the close returns the rent). A frozen source's transfer reverts the whole call. A non-ATA destination is fine (the check is owner + mint, not ATA-ness). The destination wallet being another vault's asset-signer is refused only if it equals the signer; otherwise it would be a valid destination chosen by the owner (who is the only one who can execute). An odd or zero-pair account list is refused (`NotEnoughAccountKeys` / `InvalidInstructionData`).

**(c) Destination checks.** The destination wallet is chosen by the transaction builder, who must be the owner (through Core). Given (a), this is safe. A lamport credit to a non-System destination works (measured R27.S1). A credit below rent exemption to a non-existent account would be refused by the System program; the canonical destination is the owner (fee payer, exists).

**(d) Lamport sweep.** `signer.lamports()` is read at execution. A later instruction in the same transaction could deposit lamports to the PDA, but BURN's `lamports == 0` check runs after and would revert the whole transaction. Core's BurnV1 does not add lamports to the PDA (measured fact 4). BURN sees exactly what the sweep left.

**(e) Interaction with BURN's emptiness proof.** The sweep closes what it empties. A closed account passes BURN's reserve loop because it is System-owned (skipped). A missing reserve ATA created by a stranger with dust: the sweep names it (the page includes it) and moves the live balance. A Token-2022 ATA for a classic mint cannot exist (measured F4.2). A non-ATA token account can be swept by the helper if the page names it. A nested Core asset is handled by rescue_nested. I found no account a stranger can create that neither the sweep can name nor BURN will skip.

**(f) Does it fit?** S8.0 measures 1,061 bytes for claim + open + helper (3 reserves) + burn. The burn carries the pool account (for retire_redeemed's monthly_inline), so the in-line monthly's accounts are included. Compute budget instructions add 52 bytes (1,113 < 1,232). A fourth reserve is impossible (MAX_RESERVE_MINTS = 3).

**(g) Evidence.** SR.0-SR.4a, SR.5-SR.14, S8.0-S8.3, S9b. I read each arm's construction. The `because()` pins name the exact errors. The helper is deployed in the suite from `target/deploy/cbob_vault_sweep.so`, which `build-mainnet.sh` proves byte-identical to the mainnet build (no localnet feature exists in its Cargo.toml).

## R2. The community pool

I traced the invariant "the pool always holds at least ceil(owed)" through every instruction:

- `credit`: `owed_scaled += floor(avail * ACC_SCALE / w) * w <= avail * ACC_SCALE`. The rounding stays in the pool.
- `claim`: pays `floor(pending / ACC_SCALE)`, decrements `owed_scaled` by exactly `pay * ACC_SCALE`. `ceil(owed)` and `balance` both fall by `pay`.
- `retire` (forfeit): `owed_scaled -= pending`, tokens stay. Pool holds more.
- `retire` (redeemed, claimed first): pending is sub-sat. `ceil(owed)` falls by at most 1. Pool unchanged or holds more.
- `join`, `reweigh`, `expire_boost`: never touch `owed_scaled`.
- `distribute` refuses `PoolShort` if `balance < ceil(owed)`.

I checked every counter (`pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight`) under every ordering of the host instructions. `pending_count >= pending_this_epoch` always (activate increments both; advance_epoch zeroes this_epoch; join/retire decrement count, retire decrements this_epoch only for same-epoch requests). No underflow path exists.

**Liveness:** `distribute` and `monthly_inline` are permissionless. The `JoinWaitingFirst` and `BoostsExpireFirst` gates can be cleared by anyone (`claim` joins, `expire_boosts` expires). A vault whose token account is gone cannot block expiry (`expire_boosts` needs only records). A frozen pool blocks paying claims but not the redemption (forfeit path) and not the free tick. I found no way to make distributions or redemptions impossible for others.

## R2b. The $CBOB boost

I verified the ring arithmetic independently. A boost bought at epoch E with N epochs ends at E+N, scheduled at `boost_expiring[(E+N) % 64]`. `advance_epoch` consumes the slot when `dist_epoch` reaches E+N. Two live boosts can share a slot only if they share an end epoch (their ends are both in `(dist_epoch, dist_epoch+63]`, and two values in a 63-wide range congruent mod 64 must be equal). The ring never conflates different end epochs. The host unit test drives 260 epochs (four wraps) against an independent model.

A boost earns exactly N distributions: the distribution that makes `dist_epoch` reach E+N is the Nth, and the next is refused until the boost is expired. `expire_boost` requires `boost_weight > 0` (prevents double expiry) and `dist_epoch >= boost_end_epoch` (prevents early expiry). `retire`'s `unschedule_boost` handles both the due and not-yet-due branches correctly.

Nothing earned is lost or gained on a weight change: `reweigh` moves the owed share to `carry_scaled`, restarts `debt` at the new weight, and adjusts `total_active_weight` by the difference. `owed_scaled` is unchanged.

## R3. The level draw

I re-derived the SlotHashes parse (u64 count, then 40-byte entries), the window (`[want, want+64]` inclusive, smallest produced slot), the three-hash chain (A, then B and C each two 4-slot leader groups later), and the FIFO (`index == revealed_total`). All match the code and the independent re-computation in the suite (L.3c, L.10, L.23).

A burned vault at the head of the queue still takes its draw (the Core write is skipped, the census advances). The attribute re-supply hash is checked against the stored hash. A minter can only influence the asset address (mixed into the final hash), which they choose before the entropy exists.

SPEC 26's statement (C's leader chooses among many draws) matches the code's residual. HOLDER-GUIDE's description is accurate.

## R4. Governance

I checked every rule: electorate fixed at creation (index_snapshot), quorum against the snapshot, threshold of votes cast, 10% YES turnout, half-of-all-live-vaults for key changes, never bundled, notice period, guardian cancel, TightenSweep monotone and bounded, overtaken actions as logged skips.

I found no way a minority carries what it should not: the smallest passing ordinary vote is 10.71% YES of the snapshot (quorum 21% × threshold 51%), above the 10% floor. Key changes need 50% of the snapshot. A vault minted mid-vote can neither vote nor raise the bar.

I found no way a vote reaches money it should not: the action enum has no field for the split, destinations, max_supply, or a vault. MINT re-checks every bound.

Governance can be frozen if every vault is redeemed and no round is open (accepted limit 45), or if a stolen guardian key is never replaced by half of all live vaults (accepted limit 47). I found nothing worse than these stated limits.

## R5. The charter claim

The Merkle leaf/node domain separation (0x00/0x01) and sorted pairs prevent second-preimage and reordering attacks. The PoB is identified by address against the committed root. The CPI burn is as the owner, in the same instruction. The window is fixed at initialize and refuses by clock alone. `pob_extra` accounts are passed through never as signers.

SPEC 46 is complete for what I can construct: the hot wallet can gate or brick claims (end the project, capture governance) during the window, and cannot transfer or burn an individual PoB. The alarm's per-asset blind spot and the sampling gap are stated. I found nothing the wallet, a PoB holder, or a third party can do that SPEC 46 omits.

## R6. One-time configuration and the trusted hop

Every `initialize` value is written once. The programs check less than `check-launch-params.mjs`, which is the pre-signing gate (accepted limit 38). The swap operator is bounded by cap, cooldown, and reserve on chain; the guardian can stop; a vote can only tighten within fixed bounds. The 10% royalty is a Core plugin with authority None; nothing in our programs or in Core can change it (measured R.3-R.6c, R.33.G3). The redemption cap is a rolling window over a 64-entry ring of unix timestamps; I verified the k-th-most-recent index arithmetic and the head wrap.

## R7. Cross-program raw reads

I recomputed every offset from the struct definitions:

- MintConfig: version 8, collection 9, governance 41, pool_ata 73, minted_total 141, sales_stopped 191, sweep_stopped 192, guardian 193, swap_operator 225, sol_reserve 257, max_sweep 266, cooldown 274, charter_closes 442, bare_burns_retired 454, sales_stopped_at 518, sweep_stopped_at 526, pending_guardian 582, notice 623, sweep_floor 631, cooldown_ceiling 639, reserve_ceiling 647, dist_epoch 655, cbob_mint 679, max_boost_weight 711, max_boost_epochs 712. All match the constants in GOV and BURN.
- VaultRecord: version 8, asset 9, mint_index 41. Matches GOV.
- BurnConfig: version 8, burned_total 42. Matches GOV.
- SEAL Config: version 8, collection 9, reserves 41 (u32 count then keys). Matches MINT and BURN.

The sweep helper reads classic SPL token accounts at mint 0, owner 32, amount 64, length 165. Correct.

All 12 pinned discriminators are asserted against their sha256 derivations in the suite (3.1a-3.1y). I verified the account-index bindings (SEAL's BURN_IX_ASSET_IDX=0, BURN_IX_OWNER_IDX=2; BURN's SEAL_IX_ASSET_IDX=0, SEAL_IX_OWNER_IDX=2; MINT's BURN_IX_ASSET_IDX=0) against the account structs. All correct.

## R8. The suite, simulation and build as evidence

I read the suite's arm constructions for the sections covering the sweep helper (SR.*), the pool (P.*), the boost (BO.*), the rate limit (RL.*), and the wrapper attacks (WR.*). The `because()` pins name specific error codes. The floors equal the counts (895, enforced by run-tests.sh). The simulation (71 assertions) runs against real Core, real mints, and real PoB assets. `build-mainnet.sh` proves the sweep helper's mainnet bytes are identical to the tested localnet bytes and to `target/deploy`.

I looked for arms that cannot fail. The `RL.S1-S6` arms are pure-JS model tests of the cap-stamping logic (they can fail on ambiguous caps). The `R.7` series compares source constants against SDK serializers (they can fail on a drift). I did not find a vacuous arm in the sections I read.

## The four questions about accepted limits

**1. Is any limit WORSE than stated?** I did not find one. I specifically re-examined items 9, 25, 26, 28, 32, 40, 41, 44, 46, 47, 55, and 56 against the code. Each states its cost accurately.

**2. Is anything listed as a limit not actually a limit?** I did not find one.

**3. Is any DISCHARGED item not actually discharged?** I re-verified items 14 (DuplicateAttribute refused on chain), 19 (no unlevelled activated vault), 30 (split_bps permanent), 33 (notice exercised), 51 (boost built), and 54 (compute measured). All are discharged by the named evidence.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?** Items 22, 38, 50, 52, and 53 remain OPEN in SPEC and in the launch file. Nothing has been demoted.

## Findings

I found no new CRITICAL, HIGH, or MEDIUM defect in the five programs or in `web/` that survives measurement. The round 37 repairs are correctly implemented and do not regress anything I could construct.

**LOW-1 (web, documentation): The C5 transfer stray's pre-read amount is a known stale-read window that the page discloses but the holder guide does not name.**

`web/src/lib/plan-redeem.mjs` builds a Core Execute of an SPL `Transfer` for each C5 account, moving `a.parsed.amount` (the balance read at plan time). A deposit landing between the plan and the send stays in the account, and after the burn nobody can ever sign for the vault's PDA; the close authority (a stranger) cannot close a non-empty account. The page's note says "Anything sent to that account after this check stays in it" (accurate). HOLDER-GUIDE's "Someone could send a tiny amount into your vault while you are opening it... whatever cbBTC, $GARY, $GIRAFFISH or SOL is in it right then comes out to you" is accurate for the three reserves and SOL (the helper sweeps live) but does not name the C5 exception. A holder who reads only the guide might believe a late deposit to any account in the vault is swept.

*Evidence if I am right:* a C5 account at a deposit address, funded with 1 unit at plan time and 2 units at send time; the redemption lands, 1 unit arrives at the owner, 1 unit remains in the account, and the account is permanently inaccessible after the burn.

*Fix:* one sentence in the holder guide's honest list naming the C5 account as the one thing a late deposit to is not swept (the page already says it).

This is documentation-only, LOW, misstates nothing about what the programs do, and does not misstate a holder's money (the page's note is accurate at the point of signing). Under the round-37 ruling it would qualify for the documentation exception if fixed and re-verified before round 39.

**INFO-1 (suite coverage): Seven negative arms still lack reason pins.**

Round 37's A5 noted that R32.A22a, R33.G3, OR.5, R31.W1a, R31.W1b, R28.A2, and R35.N8 have no `because()` pin. This is still true in the current tree. Their labels and outcome fields are correct; a wrong-reason rejection would not be caught. This is a strengthening recommendation, not a defect.

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Run the mainnet dress rehearsal (item 22) with the named pass/fail items.** No AI round can execute the crank against 2,100 live vaults, a transient RPC error at vault 1,900, or the every-minute reveal lane under real load. The rehearsal is the only measurement of the off-chain pipeline's I/O against a live cluster. Item 22's five named items (including one full revenue cycle through each pool and one forced post-swap failure walked through hand recovery) must each produce a transaction signature.

2. **Have a human read HOLDER-GUIDE.md against the code before publication.** The guide is the holder's entire understanding of what they are buying. Every sentence must be true of the deployed programs. An AI can check individual claims but cannot judge whether a non-technical reader will understand "a payout is only as big as the sales and royalties behind it" or "the validator producing the last of those blocks can pick among several results." A human who understands both the code and the audience should read it once, aloud, and flag every sentence they had to read twice.

3. **Exercise the ceremony end to end on mainnet with Gary's real wallet before the lock.** The ceremony page is the only thing standing between a typo and a permanent wrong value. The e2e test exercises it on a local validator with a test key. The real ceremony uses Gary's Phantom, the real RPC proxy, the real genesis hash, and the real program bytes. A dry run at throwaway values (the rehearsal tree) with Gary's actual wallet and the actual browser would catch any Phantom-specific signing issue, any RPC proxy configuration error, and any UX confusion that no AI can simulate.

4. **Measure the real provider's `getProgramAccounts` behavior.** Round 37's V1 measurement used a synthetic response (448 bytes per account). The real provider may refuse, paginate, or time out at a different threshold. The redeem page's bounded reads are correct in principle, but the actual limit needs one measurement against the production RPC before the page is published.

5. **Have a second human verify the five program hashes at deploy time.** `build-mainnet.sh` proves the source names Gary's key and the artifacts reject the test key. It cannot prove the compiled constant IS that key (stated in the script's own "NOT PROVEN" section). The bridge is reproducibility: rebuild from the release commit on a second machine and confirm the sha256 values. This is a 10-minute task that closes the one gap the build script names.

6. **Decide the charter date and lock deadline now.** Items 38 and 50 are OPEN because `charter_opens_at` and `lock_deadline` are unset. Everything else is RULED. The system cannot mint until these are set, and the alarm pages CRITICAL on an unset lock deadline in production. This is a business decision, not an engineering one, and no AI round can make it.