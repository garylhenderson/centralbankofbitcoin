# Round 39 independent audit — five programs, sweep helper, off-chain, and `web/`

**Method and scope, stated first because they bound every conclusion below.** This is a static, line-by-line review of the bundled tree at the round-38 head. I re-derived every cross-program offset, re-checked every pairing and gate, and re-read the round-38 repairs in the actual source. I did **not** execute the suite, the simulation, the fork, or any crank/revenue/alarm job; where I say "verified" I mean "confirmed by reading the code at the cited location," and I name the on-chain or test evidence that would confirm or refute each claim. Several `bank/` modules (`crank.mjs`, `detectors.mjs`, `alarm.mjs`, `layout.mjs`, `revenue.mjs`, `swap.mjs`, `accrual.mjs`, `selftest.mjs`) are **not in this bundle**, so anything that lives only there is a measurement limit, not a verification.

---

## R0 — Round 38's verdict and its repairs

Round 38 was NOT CLEAN (quorum met, no margin). I independently re-checked each confirmed item against this tree.

**V38-1 (LOW, redeem page `splice(-1)`): REPAIRED.** `web/src/lib/plan-redeem.mjs` now removes a no-receiver stray only from the list that holds it:
```js
const drop = (list, a) => { const i = list.indexOf(a); if (i >= 0) list.splice(i, 1) }
for (const a of noAccount) { drop(helperStrays, a); drop(transferStrays, a) }
```
The old `splice(-1)` (which deleted the last helper stray when the stray was a C5 transfer stray) is gone. A re-plan with one helper stray plus one late C5 stray now yields no refusal and the correct `left:` box. Evidence that would refute this: a `plan.test.mjs` arm with `noPrior:true`, a helper stray, and a late C5 stray producing a `refuse` — none exists, and the code path cannot produce one.

**V38-2 (MEDIUM, late arrivals re-gate the press): REPAIRED.** The standing consent `LATE_CONSENT_ID = 'late-arrivals'` carries no address, count, or digest. In the final re-plan (`planRedemption`, the `s.consented` branch), any ack not in `consented` and not one of the two exceptions (`forfeit`, or a known stray that became undeliverable) is moved to `lateInfo` and shown as information, never as a new gate. `prepareOpening` caps dry runs at `OPEN_ATTEMPTS = 2`. A stranger landing new items after the check therefore cannot mint a new blocking ack id. The two remaining stop conditions that are *not* stranger-repeatable: a pool freeze by Coinbase (`forfeit`), and a known stray that became undeliverable (requires freezing a non-freezable-at-check-time mint or the holder's own account, which the page already excludes). Evidence: a mock/DOM test landing one new ack-producing item per press and asserting the opening still lands — VALIDATION.md reports such an e2e arm at 113/113; I could not re-run it, but the planner logic cannot re-gate on a non-consented, non-exception ack.

**V38-3 (INFO, ceremony offers step 0 on unverifiable collection): REPAIRED BY DOCUMENTED DEVIATION.** The round-38 verdict recommended a STOP. The actual repair (labeled "round 39 B4" in `web/src/lib/ceremony-reads.mjs`) deliberately chose **continue-with-warning** instead, because a STOP is itself griefable (a stranger pads a decoy's history to 5,000 txs for ~0.025 SOL and blocks launch day). Final behavior: pins win and stop on disagreement; exactly one launch-verified collection is adopted; two verified stop; with none verified, unverifiable candidates are listed with a "pin it instead" warning and step 0 is still offered; after step 0 Gary must tick that he recorded the address before continuing. This is a defensible tradeoff and is tested in `ceremony.test.mjs`. I record it as a **deviation from the round-38 recommended fix, not a surviving defect** (see INFO-3).

**V38-4 (INFO, SPEC limit 27 wrong party): REPAIRED.** SPEC.md limit 27 now reads "*Who:* every OTHER holder (round 38 V38-4) … a claim naming the dead vault takes it from everyone else; `claim` is permissionless, so a stranger can choose to cause it." This matches the recommended correction.

**V38-5 (INFO, holder-guide late-deposit promise): REPAIRED.** The guide now scopes the promise to "the vault's own three accounts and its wallet" and adds "Anything sent after the check into an account someone else handed to the vault and kept the right to close stays in it." The reserve-mint C5 case is no longer promised to come out. Consistent with `planRedemption`'s note.

**Off-chain round-38 repairs C01–C04: NOT INDEPENDENTLY VERIFIABLE.** C01 (crank sends join-only batches from a frozen pool) and C02 (`detectSweepState` comment) live in `bank/crank.mjs` / `bank/detectors.mjs`, which are not in this bundle. VALIDATION.md reports detector selftest 926/926 and a gate-5 arm "R38 C01," but I could neither read nor re-run them. See INFO-2.

**Round-38 refutations (W1–W11):** I re-checked the ones testable from this bundle and found none reopened. In particular W3 (charter window start) is still caught by `check-launch-params.mjs` (`charter_opens_at` must be in the future), and W5 (pool unfreeze between plan and send) still fails closed with no value moved.

---

## R1 — Custody: open/burn pairing and the emptiness proof

I attempted the following against `cbob-vaults/src/lib.rs` (`open_for_redemption`) and `cbob-vault-burn/src/lib.rs` (`burn_vault`):

- **CPI-wrapper pairing.** Both halves use `load_current_index_checked` / `load_instruction_at_checked`, which see only top-level instructions. A wrapped `open` reports the wrapper's index, so BURN (top-level) cannot find a preceding top-level `open_for_redemption` and refuses `NoPrecedingOpen`; a wrapped `burn` cannot satisfy SEAL's forward walk, and even if it could, BURN's own `NotTheOwner`/stack checks catch it. Because Solana transactions are atomic, any burn failure reverts the thaw. This matches suite arms WR.1–WR.4. No bypass found.
- **Two vaults in one transaction.** Each open binds asset AND owner at account indices 0 and 2; each burn does the same. Cross-borrowing (open A, burn B) fails the asset/owner match. If the second burn is rate-limited, the whole transaction reverts, so the first vault stays sealed (all-or-nothing). No custody hole.
- **Thawed vault leaving the transaction unburned.** Impossible: `open` requires a following matching `burn`; if the burn fails for any reason the atomic transaction reverts the thaw. There is no instruction that empties a vault and leaves it alive.
- **Emptiness proof vs Token-2022, delegates, close authorities, lamports, nested assets.** The reserve loop derives each reserve's ATA under **both** token programs and requires each to be declared (`ReserveNotDeclared`), PDA-owned, delegate-free (`d[72..76]==0`), delegated-amount-zero (`d[121..129]==0`), close-authority-free (`d[129..133]==0`), extension-free (`len==165`), and empty. I recomputed the SPL token-account offsets (mint 0, owner 32, amount 64, delegate COption 72, state 108, delegated_amount 121, close COption 129) and they are correct. A Token-2022 ATA for a classic mint cannot be created (probe-round5b F4.2), and any T22 account that did exist would fail `len==165`. The second loop refuses a declared live Core asset (`VaultStillHoldsAVault`) and applies the same delegate/close/amount/extension checks to any other declared PDA-owned token account. `asset_signer.lamports()==0` is enforced. **No way to get value out of a sealed vault, and no way for an emptied vault to survive.**

The completeness gap (non-ATA undeclared accounts, undeclared foreign NFTs) remains exactly as stated in accepted limits 9/44 and proven impossibility 2; I found no widening.

---

## R1s — The sweep helper (`cbob-vault-sweep/src/lib.rs`)

- **(a) Authorization.** Direct call requires `signer.is_signer`; the asset-signer PDA has no key, so a direct call cannot move a vault's holdings (SR.1). Through Core `ExecuteV1`, only the asset owner can authorize (SR.5/5a/5b/5c). The helper is only reachable while thawed, and thawing requires a following burn, so it runs only inside a redemption. Confirmed sound.
- **(b) Pair list.** Duplicate source: the first pass closes it, the second `read_token` sees a System-owned closed account and returns `IllegalOwner` (SR.12a). Source-as-destination is impossible without `signer==dest` (refused, SR.10). Destination mismatch (mint or owner) is refused (SR.2, SR.12). Odd/zero pair counts: `(len-4)%2 != 0` refuses odd; zero pairs is the lamports-only path (SR.13). A frozen source reverts via the Token program (SR.14). A source with a foreign close authority makes the helper's `CloseAccount` revert — the page therefore routes C5 accounts through a plain `Transfer` instead, never through the helper. **Two edges are not exercised by any arm** (native wSOL source; destination set to another vault's asset-signer PDA) — see INFO-1; neither is a value-moving defect (wSOL reads as a classic token account; a foreign destination is the owner's own choice).
- **(c) Destination checks.** The helper does not compare `dest` to the asset owner, but given (a) only the owner can invoke it, so `dest` is the owner's choice. A lamport credit to a below-rent or non-system destination can fail, but that only reverts the attempt (no loss) and the page uses the owner (who exists) as `dest`.
- **(d) Lamport sweep.** `signer.lamports()` is read after all token pairs and transferred in full; token-pair closes send rent to `dest`, not to `signer`, so nothing re-credits the PDA. Between the helper and `burn_vault` no instruction adds lamports to the PDA, and Core `BurnV1` does not sweep it (proven impossibility 4), so BURN's `lamports()==0` sees exactly what the sweep left.
- **(e) Interaction with the emptiness proof.** Closed reserve accounts read as System-owned and are skipped by BURN; never-created reserve ATAs are declared but System-owned and skipped. The page creates missing reserve accounts in a prior transaction (SPEC REDEEMING step 1), which is sufficient because the sweep then reads live balances at execution. I found no account type a stranger can create that is both un-sweepable by the helper and non-skippable by BURN: T22 ATAs for classic mints can't exist; non-ATA classic accounts are sweepable; nested Core assets are handled by `rescue_nested`, not the helper.
- **(f) Fit.** S8.0 (claim + open + helper(3 reserves) + burn = 1,061 bytes, owner as fee payer) covers the production shape. A fourth reserve is impossible (`MAX_RESERVE_MINTS=3`). Compute-budget (+52) and separate fee payer (+96) bring it to ~1,209 < 1,232. The in-line monthly pool account is already in the burn instruction. The measurement is complete for the legacy page shape.
- **(g) Evidence/provenance.** `build-mainnet.sh` `cmp`s the sweep helper's `dist/` bytes against both the localnet release output and `target/deploy`, so the shipped helper is byte-identical to the tested one. Confirmed by reading the script.

---

## R2 / R2b — Pool invariant and the $CBOB boost

- **Invariant "pool ≥ ceil(owed)".** I re-derived `distribute`/`credit` and `claim`. `credit` adds `delta = floor(avail·SCALE/w)` to `acc_scaled` and `delta·w` to `owed_scaled`, so `ceil(owed)` rises by at most `avail`, which equals the headroom. `claim` pays whole sats, reduces `owed_scaled` by `pay·SCALE`, and moves the sub-sat remainder into `carry_scaled`; since `pay·SCALE` is a multiple of SCALE, `ceil(owed)` falls by exactly `pay`, matching the balance reduction. The invariant holds through both. `retire`/`reweigh` preserve each vault's owed exactly (`reweigh` moves owed into `carry` and resets `debt` to `after·acc`, leaving owed unchanged). I found no counter drift in `pending_count`/`pending_this_epoch`/`active_count`/`total_active_weight` across request→join→retire, including same-epoch vs earlier-epoch retirement (the `pending_this_epoch` decrement is guarded by `request_epoch == dist_epoch`).
- **Liveness.** `JoinWaitingFirst` and `BoostsExpireFirst` can pause a distribution, but joining and expiring are free and permissionless, so no one can make distributions or redemptions permanently impossible for others.
- **Boost exactness.** A boost bought at epoch E with duration N ends at `E+N`; `advance_epoch` moves it to `boosts_due` exactly when `dist_epoch` reaches `E+N`, and `credit` accrues at the boosted weight *before* `advance_epoch` marks it due, so it earns distributions E+1 … E+N (exactly N) and the next distribution is refused until expiry. `reweigh`/`unschedule_boost`/`retire` keep `total_active_weight`, `boost_weight_total`, `boosts_active`, `boosts_due`, and the 64-slot ring consistent; the max duration 63 < ring 64 prevents a live collision, and double-expiry is blocked by `boost_weight==0` after expiry. I found no lost or gained share on boost, expiry, claim normalization, or retire.

---

## R3 — Level draw

`blockhash_in_window` parses the SlotHashes sysvar defensively (key pinned, count ≤ 512, length checked, all-zero hash refused) and selects the smallest produced slot in `[want, want+64]`. `try_capture` takes A, then B and C each two 4-slot leader groups later, and hashes `sha256(hA‖hB‖hC‖asset)`. `reveal_level` enforces strict FIFO (`index == revealed_total`), re-supplied attributes checked against the stored hash, and still draws (but skips the Core write) for a burned vault so the queue never stalls. `reschedule_reveal` only fires after the window lapses and moves to a future slot. The residuals (minter re-roll on lapse, C-leader grinding) are exactly accepted limits 25/26; I found nothing worse.

## R4 — Governance

Electorate and tally are snapshotted at creation (`index_snapshot`, `quorum_supply`); `VaultTooNew` blocks later mints; `VoteRecord` is seeded by the asset so a vault votes once per proposal regardless of transfer. Key changes require YES ≥ ceil(50% of the snapshotted live supply) (`KeyChangeNeedsHalf`), cannot bundle guardian+operator, and land only after the notice via permissionless apply. Overtaken actions are logged no-ops with the mark advanced before the over-check (RT3 finding 4 holds). `TightenSweep` is monotone and bounded. I found no minority path, no money reach, and no freeze worse than accepted limits 45/47.

## R5 — Charter claim

Merkle leaf/node are domain-separated (0x00/0x01) with sorted pairs; the proof is verified against `pob_root`; the PoB is burned by CPI as owner in the same instruction; `pob_extra` accounts pass through never as signers. The window is clock-gated and never reopenable. I reviewed SPEC 46 against the hot wallet's capabilities and found it **complete**: the wallet can brick/gate claims (stated), cannot transfer/burn individual PoBs (round-25 D8 positive bound), and lookalikes are excluded by address-based identity. A PoB holder freezing their own asset is self-inflicted; a third party can do nothing to an asset they don't own.

## R6 — One-time configuration and the trusted hop

The programs check less than `check-launch-params.mjs` (e.g., MINT does not require `charter_opens_at > now`; BURN accepts any `redeem_window_secs` in 10s–24h; SEAL checks only reserve owner program). This is precisely accepted limit 38; the pre-signing checker is the gate, and it refuses OPEN/wrong values. The royalty is installed with `PluginAuthority::None` (immutable in Core). The redemption cap is a true rolling window over a 64-slot timestamp ring; I re-verified the k-th-most-recent index arithmetic and the "stricter, never looser" behavior past 64. The swap operator's worst case is cap × cooldown windows until the guardian stops it (accepted limit 10).

## R7 — Cross-program raw reads

I recomputed every offset from the struct definitions. MintConfig: governance 41, minted_total 141, charter_closes_at 442, bare_burns_retired 454, sol_reserve 257, max_sweep 266, cooldown 274, sales/sweep_stopped 191/192, stopped_at 518/526, sweep_floor/cooldown_ceiling/reserve_ceiling 631/639/647, max_boost_weight/epochs 711/712 — all match GOV's and BURN's pinned constants. VaultRecord: asset 9, mint_index 41, pending 177, request_epoch 178, boost_weight 186, boost_end_epoch 187, carry 195 — match GOV and the suite. BurnConfig: burned_total 42. SEAL Config: version 8, collection 9, reserves 41. SPL token account (mint 0/owner 32/amount 64/state 108) and mint (decimals 44/init 45) offsets are correct. **No misread found.**

## R8 — Suite, simulation, build as evidence

- Floor discipline: `MIN_ASSERTIONS=895` must equal the count; the runner refuses a partial pass. Good.
- The sweep helper's shipped bytes are proven identical to the tested bytes (`build-mainnet.sh` `cmp`). The four keyed programs are proven to reject the localnet test key and to name Gary's key in source, with the stated caveat that the compiled constant itself is proven only by reproducibility (see INFO-4).
- **Coverage gaps:** seven negative arms still lack a `because` reason pin (already known, round-37 A5 / round-38 A4); and the two sweep-helper edges in INFO-1 have no arm. I found no arm that structurally cannot fail, and no arm whose negative fires for a different reason than named among those I could trace.

---

## Findings

I found **no CRITICAL, HIGH, or MEDIUM defect** in the five programs or the sweep helper. I did not reach this by confirming the author; I reached it by attempting the attacks in R1–R7 and finding no value-moving path, and by corroborating the measured runs. The following are INFO-level observations and measurement limits, each with the evidence that would confirm or refute it.

**INFO-1 — Two sweep-helper edges have no suite arm (coverage, not a defect).**
Construct: `programs/cbob-vault-sweep/src/lib.rs` `process`. (a) A native wSOL source is read as a classic token account and swept/closed; no arm exercises the native-close behavior. (b) A destination set to another vault's asset-signer PDA is permitted (the owner's choice); no arm exercises it. Neither moves value that isn't the invoker's own. Evidence if it mattered: add an SR arm sweeping a native wSOL account owned by the vault PDA, and an arm with `dest` = a second vault's asset-signer PDA, asserting balances. Fix: add the arms; no program change needed.

**INFO-2 — Off-chain round-38 repairs C01–C04 could not be independently verified (measurement limit).**
Construct: `bank/crank.mjs`, `bank/detectors.mjs` (not bundled). VALIDATION.md claims the crank now sends join-only claim batches from a frozen pool (C01) and detector selftest is 926/926, but I could not read or re-run them. Evidence that would confirm: `node bank/selftest.mjs` printing 926/926, and a gate-5 arm asserting `plan.claims` contains a join-only batch when the pool is frozen. Until re-run against the bundled tree, treat C01/C02 as "claimed, not independently re-verified here."

**INFO-3 — Ceremony collection rule deviates from the round-38 recommended STOP (documented, not a defect).**
Construct: `web/src/lib/ceremony-reads.mjs` `resolveCollection` ("round 39 B4"). Round 38 recommended stopping on an unverifiable candidate; the repair instead continues with a prominent warning and still offers step 0, because a STOP is griefable by a padded decoy. Residual: in the narrow window with nothing pinned and an unverifiable candidate, a second collection could be created; mitigated by the warning and a required "I recorded it" tick, and the second collection would simply be the one SEAL uses (no orphaned value). Evidence if it mattered: a `ceremony.test.mjs` arm with no pin + one unverifiable candidate asserting step 0 is offered and a warning is shown. This is a deliberate, documented tradeoff; I record it so the deviation from the round-38 fix is not mistaken for an oversight.

**INFO-4 — Build proves rejection of the test key, not acceptance of Gary's key (already stated, re-noted because immutability makes it load-bearing).**
Construct: `scripts/build-mainnet.sh`. It proves the mainnet artifacts reject the localnet test key and that the source names Gary's key, but a third wrong key would reject identically; acceptance by Gary's key cannot be demonstrated locally (no key held). Mitigation is reproducibility (rebuild from the commit, compare sha256) plus the fact that a wrong authority bricks `initialize` detectably at deploy. Evidence that would confirm a problem: a rebuild from the release commit whose sha256 differs from `dist/SHA256SUMS`, or an `initialize` that fails with `NotTheInitAuthority` when signed by Gary's wallet.

**INFO-5 — Seven negative arms still lack a reason pin (persists, already known).**
Arms R32.A22a, R33.G3, OR.5, R31.W1a, R31.W1b, R28.A2, R35.N8 have no `because` pin, so each could pass for an unmeasured reason. Already stated as round-37 A5 / round-38 A4; re-noted only to confirm it persists in this tree. Fix: add reason pins.

---

## The four accepted-limit questions

1. **Is any limit WORSE than stated?** I found none. I re-checked the exploitable ones (25 re-roll, 26 leader grinding, 28 Coinbase freeze incl. the frozen-pool forfeit, 32 rate limit, 40 Core upgrade, 41 transfer-not-limited, 44 undeclared destruction, 46 PoB hot wallet, 47 stolen guardian, 55 unsplit-revenue edge, 56 $CBOB hot key, 58 rescue). Each behaves as stated; the frozen-pool redemption forfeit and the rescue actually narrow 28 and the nested case as documented.

2. **Is anything listed as a limit not actually a limit / already closed?** No. Limit 44 is narrowed by the sweep helper for *declared* classic strays, but it remains true for *undeclared* holdings, and the text says so. Limit 9 remains true while the redeem page is staged (not published). Nothing is inadvertently closed.

3. **Is any DISCHARGED item not actually discharged?** I spot-checked 14 (duplicate attributes — `DuplicateAttribute` present in `check_attributes`), 19 (unlevelled halt — `activate` requires a drawn level), and 30 (85/15 vote — `split_bps` fixed at initialize, no `update_wiring` exists). All genuinely discharged.

4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are all still open in the text; `launch/mainnet-init.json` still carries `charter_opens_at`, `lock_deadline`, and `vault_collection` as OPEN and `judgeLaunch` refuses them; the pages are built/staged but not published (item 50 open). Nothing is being quietly demoted.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Concrete things to do before launch that AI audit structurally cannot do:

1. **Run the full mainnet dress rehearsal with real (small) value (item 22).** A live cluster exercises RPC rate limits, paging, transient errors at vault ~1,900, the every-minute reveal lane, and a full revenue cycle through both pools plus a forced post-sweep failure recovered by hand. No local validator or fork reproduces live network conditions. This is the single most important gap.

2. **Reproduce the deployed bytes on a clean machine.** Rebuild all five programs from the exact release commit in a clean environment and compare sha256 against `dist/SHA256SUMS`. This is the only real bridge for the fact (INFO-4) that the build cannot prove the compiled `INIT_AUTHORITY` is Gary's key. Then confirm `initialize` succeeds when signed by Gary's wallet before removing the upgrade authority.

3. **Verify the four `initialize` transactions are built FROM `launch/mainnet-init.json`, not hand-assembled.** The checker validates the JSON, not the signed transaction (accepted limit 38). Have a second tool decode the actual signed initialize calldata and diff it field-by-field against the JSON before broadcasting.

4. **Do a human, hardware-backed custody review of the hot keys** — guardian (`Hc6WG…`), swap operator (`bipP7…`), the $CBOB release wallet (`AT2qf4…` in `bank/keys/cbob-release.json`), and the Giraffish Moments collection authority. AI cannot assess physical/operational security, backup integrity, or whether the key material was ever exposed. These are the highest-concentration risks in the whole system.

5. **Test with real wallet firmware, not a mock.** Some wallets inject or reorder instructions. Sign a redemption, a claim, a mint, and a ceremony step with an actual Phantom (and any other supported wallet) and confirm `signExact`'s byte-equality check catches any modification. The mock cannot replicate firmware behavior.

6. **Confirm the Squads v4 multisig (`bc92Z…`) actually returns rescued vaults.** `rescue_nested` sends every rescue to the CBOBTC Squads, and the return is a *human* act. Run a live rescue and a live return before launch; the on-chain half is proven, the process half is not.

7. **Re-check the live Pyth/Orca/Meteora state at launch time.** The fork test uses cloned pool state. Immediately before the first sweep, confirm the pinned pool addresses, their upgrade authorities, and the Pyth feeds are unchanged, since all four are upgradeable by third parties and the swap's floor depends on them.

8. **Keep the audit-coverage gate strict (`scripts/audit-coverage.sh` without `--prepared`) and require two consecutive clean rounds on a scope-frozen tree** before removing the upgrade authority. The clean-round counter is currently 0/2; do not treat this or any single round as the second.

The programs, as written, present no value-moving defect that I could construct after a full independent pass. That is a statement about what I was able to attack statically, corroborated by the measured runs; it is not a guarantee, and the immutable-launch steps above are what convert it into one.