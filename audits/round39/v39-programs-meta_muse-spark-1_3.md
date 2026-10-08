# v6 Round-39 Independent Audit — whole tree

No program was changed since `45271f9`. `web/` is at `21f36e1` — the round-38 repairs plus page tests. This is a second, independent audit of that tree, not a re-file of the verdicts.

Evidence rule used throughout: a claim is listed only with the on-chain or offline measurement that would refute it.

## R0. Round-38 verdict and repairs

Round-38 PROGRAMS was `NOT CLEAN; QUORUM MET`, 5 confirmed, none in the five programs. All five repairs are present in this tree and measured.

**V38-1 LOW, `splice(-1)` — REPAIRED, verified.**
`web/src/lib/plan-redeem.mjs` now:

```js
const drop = (list, a) => { const i = list.indexOf(a); if (i >= 0) list.splice(i, 1) }
for (const a of noAccount) { drop(helperStrays, a); drop(transferStrays, a) }
```

Only the list that holds the element is spliced. No other `splice(indexOf` shape exists in `web/src`. The A1 shape — `noPrior`, one plain helper stray plus one late C5 stray whose holder account is missing — no longer refuses in the shipped planner logic: the helper stray stays in `hs`, the C5 stray goes to `left:` with an acknowledgement. A2-A4 controls (helper alone swept, C5 alone `left:`, both on first check no refusal) hold by the same code path. If this were still broken, `judgeRedemptionCoverage` would flag the dropped helper stray and `plan.refuse` would name it.

**V38-2 MEDIUM, per-arrival tick-boxes — REPAIRED, verified.**
`LATE_CONSENT_ID='late-arrivals'`, `LATE_CONSENT`, `prepareOpening` with `OPEN_ATTEMPTS=2`, `pressStopMessage`, `groupAcks` gated by `if (!s.consented)`, late-arrival `late[]` left behind under consent, `lateInfo` shown as information, `redeem.mjs` driving `replan/dryRun` through `prepareOpening`. The press stops only for `refuse`, `prior`, an uncon­sented box about a known stray or `forfeit`, or two failed dry runs. A stranger landing a `cnft:`, `lost:`, `left:`, `group:<n>:<digest>` or `unlisted:<n>` item after consent does not re-gate. If unrepaired, each new address would be a new `ack.id` and `prepareOpening` would return `stop:'ack'`.

**V38-3 INFO, ceremony unverifiable collection — REPAIRED, verified.**
`ceremony-reads.mjs:resolveCollection` returns `{collection:null,conflict:null,ignored,unverified}` when nothing is pinned and nothing verifies, `ceremony.mjs` shows `unverifiedBox` (“pin it instead”) and still offers step 0, pins win and disagreeing pins STOP, two launch-verified collections STOP, one launch-verified adopted, and after step 0 Gary must tick “I have copied it” before continuing. This is round-39 B4, replacing V38-3’s stop. If unrepaired, a padded 5,000-tx history would either stop launch day or silently adopt a decoy.

**V38-4 INFO, SPEC 27 attribution — REPAIRED.**
`SPEC.md:1423-1436` now reads “*Who:* every OTHER holder (round 38 V38-4)… `claim` is permissionless, so a stranger can choose to cause it.” The counterfactual is correct: `retire` with forfeit returns the share to the pool (`mint/src/lib.rs:1875-1884`); a `claim` naming the dead vault diverts it to an unsignable account.

**V38-5 INFO, guide late-deposit promise — REPAIRED.**
`HOLDER-GUIDE.md:236-242` no longer promises “everything”. It promises cbBTC/$GARY/$GIRAFFISH/SOL in the vault’s own accounts, names the C5 exception (“Anything sent after the check into an account someone else handed to your vault and kept the right to close stays in that account”), and `plan-redeem.mjs:199` already said exactly that. `m38 D1` shape — 7-unit C5 cbBTC account becomes a transfer stray encoding exactly 7 — is the code the sentence describes.

Off-chain C01-C04 were not in this bundle’s file list (`bank/crank.mjs`, `bank/alarm.mjs` absent). No claim about them is made here.

No V38 repair regressed at its own site. No new defect of the same shape survives at another site.

## R1. Custody — pairing, emptiness, thaw without burn

**No theft path found. No surviving emptied vault.**

*Pairing.* SEAL `open_for_redemption` scans forward from `current+1` for `BURN_PROGRAM_ID + IX_BURN_VAULT_DISC + asset[0] + owner[2]`; BURN `burn_vault` scans `0..current-1` for `SEAL_PROGRAM_ID + IX_OPEN_FOR_REDEMPTION_DISC + asset[0] + owner[2]`. Both use `load_instruction_at_checked`, top-level only. A CPI-hidden half is invisible by construction. A wrapped open needs a genuine top-level burn later, which BURN then refuses for lack of a genuine top-level open before it, and vice versa. Suite WR.1-WR.4 measures all three wrapper directions refusing for the named reason with the vault live and funded. Two redemptions can share a transaction (`open A, burn A, open B, burn B`); `open A, burn B` fails both halves on asset/owner mismatch. If this were broken, 3.9/3.10/4.10/XA-XB arms would land.

*Emptiness.* `asset_signer.lamports()==0`, `remaining.len()==declared`, every reserve ATA under both token programs declared, PDA-owned, `delegate==None`, `delegatedAmount==0`, `close==None`, `len==165`, `amount==0`, no declared live Core asset. The second loop applies the same three delegate checks plus `len==165` and `amount==0` to any declared PDA-owned token account. An undeclared non-ATA account or nested asset is invisible — proven impossibility 2, accepted limits 9/44, not a new finding. If the delegate/close offsets were wrong, 3.3/3.3a and the Token D2 probe (COption tag 4 bytes, `d[72..76]`, `d[121..129]`, `d[129..133]`) would fail.

*Rate limit.* `cap=max(1,ceil(live*210/10000))`, `k=min(cap,64)`, refuse unless `now - kth >= window`. Minting to raise the cap costs ~47 vaults per extra slot per hour at a 2,100 cap, bounded by `max_supply`. Bare burns count until `retire_burned`, reading at most one high — stated in limit 32.

## R1s. Sweep helper

**Holds on all seven sub-questions.**

(a) Only the asset owner can move value. Direct call needs `signer.is_signer`; the vault wallet’s signer is Core’s asset-signer PDA, which Core signs only inside an owner-authorized `ExecuteV1`. SEAL’s `["seal"]` PDA holds freeze authority, not execute authority; collection abstains; AgentIdentity cannot be added by an owner (R24.1a) or without the registry PDA (R24.1c). While frozen, `Execute` fails `0x9`, so the helper is unreachable outside a redemption. SR.5/SR.5a refuse a stranger and an owner-added transfer delegate with Core `0x1a` on a genuinely thawed vault; SR.5b pins the collection authority to MINT’s off-curve PDA; SR.5c refuses the collection authority on a control, SR.5d lets the control owner empty to zero, SR.5e shows balances/owner/seal preserved. If Core widened `Execute`, limit 40 already names it.

(b) Pair list. `src_owner==signer`, `dst_owner==dest`, `mint` equal, `signer!=dest`. Same source twice: first close destroys it, second `read_token` fails `IllegalOwner`, whole transaction reverts — fail-closed, owner-chosen, not stranger-injectable. Source==destination impossible by `signer!=dest`. wSOL native: transfer-then-close, amount-checked. Foreign delegate: transfer succeeds, close with kept authority reverts (R36.C5) — fail-closed. Frozen source reverts (SR.14). Non-ATA classic destination allowed if owned by `dest` — owner’s choice.

(c) Destination is owner-chosen. The program deliberately does not bind `dest` to the asset owner; through Core the caller *is* the owner. The redeem page sets `dest=owner`. A lamports-only credit below rent to a non-existent account fails — page uses the fee-paying owner, who exists. If this were exploitable by a stranger, SR.2 (bob’s account for alice’s redemption) would land; it refuses with `CBOB_SWEEP refused: destination`.

(d) Lamport sweep reads `signer.lamports()` at execution and `System transfer`s it all. No stranger instruction exists in the owner-built transaction between helper and burn; Core deposits nothing. BURN’s `lamports==0` sees exactly what the helper left. SR.4a reconciles stranger 1,000,000 + prior wallet + closed-account rent + asset delta − fee to the lamport.

(e) Closed reserve ATAs are skipped because their owner is no longer a token program — correct, they hold nothing. A missing reserve ATA cannot be named (helper refuses non-token), but anyone can create a classic ATA permissionlessly and the helper then sweeps its live dust — SPEC step 1 (prior creation) plus live sweep closes the race. No stranger-creatable account escapes both: T22 ATA for a classic mint is refused `IncorrectProgramId` by the ATA program (probe), non-ATA classic is nameable, T22 with value is undeliverable-by-design and destroyed if undeclared (accepted), nested Core is rescued (CBOB) or accepted loss (foreign).

(f) Fits. S8.0: claim+open+helper(3 reserves)+burn, owner-payer, no budget ixs, well under 1,232 with room for 52+96. Real page adds no crank to a redemption, no fourth reserve, monthly runs inside `retire_redeemed` with no extra accounts. S8.1a 168,343 CU < 800,000 default. If a fourth reserve were added, 9.14-9.16 turn red by design.

(g) Evidence stands. SR.0-SR.4a, SR.6-SR.14, SR.12a duplicate-source (`Provided owner is not allowed` on the second, closed source — correct reason, SR.12b pins it is not the first-source guard), SR.13 zero-pair lamports-only. `build-mainnet.sh` `cmp`s `dist/` vs localnet release vs `target/deploy` for the helper; it has no `localnet` feature to diverge.

## R2. Pool — `ceil(owed)` invariant

**Holds.** `credit`: `delta=floor(avail*SCALE/w)`, `owed+=delta*w ≤ avail*SCALE`, so `ceil(owed')≤balance`. `claim`: pays `floor(pending/SCALE)`, `owed-=pay*SCALE`, `bal-=pay`, preserving `bal≥ceil(owed)`. `retire`/`retire_burned`/forfeit only lower `owed`. `distribute` refuses `PoolShort`; `monthly_inline` uses `saturating_sub` and returns without credit when `avail==0`, frozen, wrong pool, or non-token pool. P.32 plus `BK.*` ledger arms (weights, boost totals, ring+due==active, `bal≥owedCeil`, `owed==Σ(weight*acc+carry-debt)`) check it after every money op. If broken, `BK.IN/3c/P` would miss a label.

Counters: `pending_count/pending_this_epoch/active_count/total_active_weight` all `checked_*`; `join` only from earlier epoch so `pending_this_epoch` untouched is correct; `retire` of a waiting vault decrements `pending_this_epoch` only if `request_epoch==dist_epoch` is correct; `advance_epoch` zeroes `pending_this_epoch`. Liveness: `JoinWaitingFirst` and `BoostsExpireFirst` are clearable permissionlessly (`claim` joins, `expire_boosts` expires, crank does both). An attacker buying waiting slots or boosts pays 21,000 sats + funding or $CBOB per slot and cannot block joins/expires.

## R2b. $CBOB boost

**Holds: exactly N, carry-exact, ring-exact.**

Bought in epoch `e` with `epochs=N`: `end=e+N`, earns the distributions closing `e+1..e+N`, due at `e+N`, refused before. `reweigh` moves `owed` to `carry`, restarts `debt=new_weight*acc`, moves denominator by delta — nothing earned lost/gained, `owed_scaled` unchanged. `unschedule_boost` takes the due branch iff `dist_epoch≥end`, else frees its ring slot; `expire_boost` requires due. Post-expiry `boost_weight=0,end=0` cannot re-expire. Ring `64`, max `63`: live ends lie in `(cur+1..cur+63)`, mods distinct; host test drives 260 epochs through `join/reweigh/retire/expire/credit/tick` against a record-rebuilt model with wrapped buys, early wrapped retires at N=63, and due retires. `total_active_weight/boost_weight_total/boosts_active/boosts_due/ring` reconciled in `books()` and `BK`. A vault whose ATA is gone still expires via `expire_boosts` (records only). If any leg drifted, BO.10/BO.14/BO.34-38 turn red.

One-sided `BoostTermsMoved` (refuse only moves against the buyer) is the ruled design, disclosed in limit 51.

## R3. Level draw

**Holds as stated; not worse than SPEC 26.**

`blockhash_in_window` pins sysvar id, `n≤512`, buffer length, refuses zero hash. `try_capture`: A smallest produced in `[reveal, reveal+64]`, B/C each `(slot/4+2)*4` — two leader groups later, group-aligned. Deterministic on settled production. FIFO `index==revealed_total`; burned head still draws and advances (L.11), Core write skipped on positive tombstone. Attributes hash-checked; budget 640 bytes proven revealable (L.12). Missed window only via `reschedule_reveal` to `now+16`, a slot that does not exist at landing. Host tests model skips at A/B/C and malformed sysvars both ways.

Residuals are as disclosed: public hashes allow off-chain computation and lapse-for-reroll only under whole-window silence (limit 25); C’s leader chooses among many draws for the whole same-slot cohort (limit 26, guide “pick among several results”). HOLDER-GUIDE states both.

## R4. Governance

**No minority path, no money reach, no silent freeze beyond SPEC 47.**

Pass needs `cast≥ceil(supply*quorum)`, `YES/cast≥threshold`, `YES≥ceil(10% supply)`, and for guardian/operator `YES≥ceil(50% supply snapshotted at creation)`. At ruled 21%/51% minimum YES is 10.71% — turnout floor binds only off-ruled values (limit 35). Actions are only `SetRound/Brakes/TightenSweep/ArmSwapOperator/SetBoostTerms`, each re-checked at creation and execution; split/destinations/supply/royalty/vaults unreachable; SEAL/BURN have no governance. Ordering per kind with `CBOB_ACTION_SKIPPED` never reverts a bundle; stale restart halves skipped by stop time matching MINT’s `StopIsNewer`. `VoteRecord ["vote",proposal,asset]` stops transfer-double-vote; `VaultTooNew` freezes electorate; live-asset read stops dead-vault votes. Zero-supply execution refused (`need>0`). Stolen guardian holding sales shut below 50% turnout is SPEC 47 verbatim — not worse.

## R5. Charter claim

**Holds; SPEC 46 complete.**

Live AssetV1, owner==signer, `update_authority==Collection(pob_collection)`, Merkle `sha256(0x00||asset)` / sorted `sha256(0x01||min||max)` against `pob_root`, depth ≤16, CPI `BurnV1` as owner in-instruction, window by clock only, no guardian gate, `pob_extra≤8` passed never-as-signer. Lookalike #241, wrong-owner, wrong-proof, re-claim all refuse (C.7-C.12). Oracle APPROVE lands with pass-through (OR.4), REJECT still refuses at Core (OR.5) — the ruled limit. Per-asset plugin blind spot, sampling window, and positive bound (cannot take a PoB) are all in limit 46. No omitted third-party capability found: transfer/burn need owner, permanent delegates cannot be added post-creation, owner-managed collection plugins refused.

## R6. One-time config, trusted hop, royalty, cap

All four `initialize`s gate on `INIT_AUTHORITY`, run once, then never write. Dangerous-but-accepted values (off-curve guardian/operator, `None` guardian, short-but-in-bounds periods) are limit 38’s subject, pinned by `launch/mainnet-init.json` + `check-launch-params` (49/49), not by programs — stated, not hidden. Collection must arrive clean/ours/unminted; SEAL→MINT→BURN→GOV collection agreement enforced (`WiringDiverged`); payment must be a SEAL reserve; $CBOB pinned classic and neither cbBTC nor $GARY; boost ceilings 1-12 / 1-63. Swap worst case is `cap × windows until guardian stops`, bounded by revenue-above-reserve — guide and limit 10 state `cap × windows`, never “one sweep”. Royalty 10% creator revenue-100% authority-None: R.5-R.6c prove even the update authority cannot rewrite/remove/re-delegate (`0x9`/`0x1b`); no program instruction touches it. Rate ring 64 covers 3,047 live, stricter beyond; window must be 3,600 on mainnet, 10-86,400 on chain.

## R7. Raw reads

Recomputed from structs: SEAL `version@8 collection@9 reserves@41`; MINT `governance@41 minted_total@141 bare_retired@454 charter_closes@442 sol_reserve@257 max_sweep@266 cooldown@274 sales_stopped@191 sweep_stopped@192 stopped_at@518/526 floor@631 ceil@639/647 max_boost@711/712`; BURN `burned_total@42`; VaultRecord `version@8 asset@9 index@41`; token `mint@0 owner@32 amount@64 len@165`; mint `decimals@44 init@45`. GOV/BURN/MINT agree on version 6, SEAL 2, BURN 4, GOV 4, Record 4; discriminators asserted against `sha256("account:…")` and `sha256("global:…")` in-suite (3.1a-3.1q). `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` decode live in X.1-X.6. No misaligned offset found. A drift would fail loudly on version/disc, not misread.

## R8. Suite, sim, build as evidence

895/895 on-chain, 926 detectors, 39 allocation, 49 launch, 33 mainnet, 4 expiry, 71 sim, 16 fork — each behind an equals-floor. `because()` pins every negative to its program error; the seven unpinned arms (R32.A22a, R33.G3, OR.5, R31.W1a/W1b, R28.A2, R35.N8) are already-stated strengthening (A4), not defects. No arm found that cannot fail: R.6b fails if R.6a wrongly lands; P.11a fixes all five levels; RL.7 replays every remembered redemption against its own certified cap; L.23 replays every draw. No claim in the prompt lacks an arm except the two noted measurement limits (compressed-NFT-via-DAS cost deciding V38-2’s grade; real-Phantom message mutation) — both stated in the verdict and still open as measurements, not defects. All five mainnet bytes proven: four via test-key accept/reject both ways plus source-key grep, sweep via byte-identity across `dist/`/`target/deploy`/localnet release.

`web/test/run-all.mjs` 618/618 in 10 files at floor, including `tx.test.mjs` 7/7 — W1 stays disproved. E2E (113/113 in validation, including three presses with late freezable + C5 arrivals landing) is not part of `run-tests.sh` — already-stated A5.

## The four accepted-limit questions

1. **Worse than stated? No.** 27 now charges other holders (fixed); 44/C5, 25/26, 28/pool-frozen forfeit, 40-43, 46-47 all match code. No accepted limit found exploitable beyond its text.
2. **Not actually a limit? No.** 35, 42, 54 remain true limits at ruled values; none closed silently.
3. **DISCHARGED not discharged? No.** 51 (boost) and 54 (compute) remain built and measured; v5 Bank/deck items remain gone with the thing they were about.
4. **OPEN treated as accepted? No.** 22 (live rehearsal + revenue cycles), 38 (charter date, lock deadline, `vault_collection`), 50 (unpublished pages, DRAFT guide gated), 52 (pool/Squads/revenue funding), 53 (throwaway-id rehearsal + rehearsal values) remain OPEN in SPEC and `mainnet-init.json`. Proxy hard-coded mainnet ids needing a rehearsal path is recorded as a remaining requirement.

## Elsewhere — `web/` second audit

Holder pages build exactly the program instructions byte-for-byte (ix tests extract suite/sim builders). `/vault/` reads level from `VaultRecord`, shows deposit PDA with “NOT the NFT’s address”, bounded token/NFT reads (reserve ATAs by address, balances/addresses only, ≤200 full reads, one box for unlisted/unexamined, ≤20 boxes then one grouped box). `/redeem/` implements item 50 verbatim: prior creates, claim-except-when-frozen with forfeit ack, helper for all three reserves + deliverable classic strays, C5 plain transfers leaving accounts undeclared, burn declaring both ATA derivations, packet-fit loop, `judgeRedemptionCoverage` cross-check refusing only unnamed coverage, standing consent for late arrivals, at most two dry runs, payout-first expiring due boosts and joining waiters. `/claim/` sends `pob_extra=0`, no crank, refuses external plugins. `/buy/` sets `max_price` from chain. Ceremony refuses non-INIT_AUTHORITY, wrong genesis, failed `judgeLaunch`, non-audited bytes or placeholder probe, then creates collection (name/link/MINT-PDA/no plugins) and initializes SEAL→MINT→BURN→GOV with ruled values, ATAs, rent — resumable, re-reading every step. Proxy allows only the 15 called methods, eight exact GPA shapes, ≤1,232-byte transactions calling a CBOB program (or three exact non-CBOB shapes), same-origin, per-IP buckets, 8 MB cap. Metadata fails closed, never backwards, slot-tracked. No holder-loss path found where the page says safe.

Findings: **0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW.** Round-38’s 1 MEDIUM + 1 LOW + 3 INFO are verified repaired; nothing new meets the bar.

---

# GIVEN NO HUMAN FIRM WILL EVER SEE THIS AND PROGRAMS WILL BE IMMUTABLE — what AI audit structurally cannot do before launch

1. **Run the live dress rehearsal with real money and real adversaries.** AI never executes against mainnet congestion, real RPC rate limits, real DAS lag, or a real stranger flooding a deposit address with 35,000 accounts past the proxy cap. Road step 8 must land: crank live passes at 2,100 vaults, alarm live in rehearsal mode, one full revenue cycle through Orca *and* one with Orca forced to refuse so Meteora runs, one forced post-sweep failure walked through hand recovery to `--audit` clean, plus DAS `burnt` semantics. No suite, sim, or fork substitutes.
2. **Reproduce the build on a second machine and compare hashes.** AI reads source; it does not prove `dist/` came from it. Rebuild `0b3ddb3` clean on independent hardware, confirm all five `SHA256SUMS`, confirm the helper’s three-way byte identity, and confirm the ceremony’s ProgramData prefix-hash-plus-zeros check on mainnet. A single-box build is a single point of forgery.
3. **Do the key ceremony in person.** AI cannot see who holds `bank/keys/`, the deploy authority, the swap operator float, the $CBOB release key, or Gary’s guardian phone. Move $CBOB custody off the box or record Gary’s explicit acceptance of limit 56; fund the operator above `OPERATOR_FLOOR` with nothing else in it; verify the placeholder upgrade authority still exists before step 9 and is destroyed at step 11; record `vault_collection`, charter date, and lock deadline by ruling, not by default.
4. **Drive the pages with a real wallet on a real phone.** AI never taps Phantom. Open a vault, claim a charter vault, buy in a round, rescue a nested vault, and run the ceremony’s local-tunnel mode on hardware Gary will use, with a wallet that adds guard instructions — `signExact` refuses, but only a human learns whether holders understand the refusal, the standing-consent box, or the “burn button destroys everything” warning.
5. **Watch what you do not control for a full month.** AI cannot hear Metaplex, Coinbase, Orca, Meteora, or Pyth rotate a key. Run the alarm for 30 days pre-lock: Core/program hash drift, PoB collection plugin/authority diff, pool/revenue freeze, `distribution_overdue`, `royalties_unswept`, `crank_silent`, log-gap review watermark. If any detector never fires in 30 days, prove it can fire by fault injection — an untested page is not a page.
6. **Publish-or-gate the holder surfaces.** The guide is DRAFT and the pages staged. Either publish `/vault/ /redeem/ /claim/ /buy/`, the metadata cron, and the RPC proxy with their runbooks, or keep the guide unpublished and block mints until they exist. An unpublished redeem page leaves limits 9/44 with no preventive control — exactly what item 50 says.