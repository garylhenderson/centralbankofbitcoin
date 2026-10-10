You are an independent security auditor. Five Solana programs (four vault programs and a stateless sweep helper) and the off-chain pipeline beside them will hold real Bitcoin (cbBTC) and two other tokens for real holders, and once launched the programs will be IMMUTABLE: no upgrade authority will exist, so every surviving bug is permanent. FIND FAULTS. Assume the author is wrong until proven otherwise. Do not confirm their work and do not praise it.

=====================================================================
READ THIS FIRST. IT CHANGES YOUR JOB.
=====================================================================
**THERE IS NO HUMAN AUDIT FIRM. THIS PROCESS IS THE CERTIFICATION.** The owner ruled that this system will be audited by AI or not at all. A finding you decline to write because "someone else will catch it" is a finding nobody writes.

That cuts BOTH ways. Across 21 earlier rounds on the previous design, about a third of "CRITICAL" findings were WRONG on measurement: invented sysvar mechanics, a Borsh claim contradicted by working mints, a recommendation that would have destroyed customer SOL. Round 24 alone rejected 16 program claims and 16 off-chain claims on measurement. With nobody downstream to sort real from imagined, a wrong CRITICAL costs real engineering time and can push a correct design into a wrong change. So before you write a finding, say what evidence would exist on chain or in a test run if your claim were true, so it can be checked.

The four vault programs and the sweep helper pass a 913-assertion suite on a local validator running REAL Metaplex Core cloned from mainnet, minting real vaults and moving real SPL tokens; plus 1089 off-chain detector assertions proven in both directions, 39 allocation, 69 launch-value, 6 host unit tests (one is Anchor's generated `test_id`) and 35 against live mainnet and 4 expiry-budget assertions using synthetic genesis state, every number behind a floor that must EQUAL the count. A Test Vault simulation (71 assertions) runs one vault's whole life against real Core, the real cbBTC / $GARY / $GIRAFFISH mint accounts and two real mainnet Proof of Burn assets, including a redemption through the sweep helper after a stranger's deposit. A mainnet-fork run (16 assertions) swaps SOL to cbBTC through the real pinned pools. A claim that contradicts a measured run is a claim about your own reasoning, unless you show the run is not measuring what it says.

THIS IS v6, A REDESIGN, AND THIS ROUND READS IT WHOLE. Nothing below is a diff: you get the files whole. This pass bundles all five programs. Three independent read-only red-team passes (the last, `audits/v6-redteam/RT3-stage3c.md`, is bundled) and rounds 22 through 34 have read the vault programs. Round 25 was the first audit of the sweep helper and the direct swap; this round examines their repairs and the entire current tree.

**ROUND 48 READ THIS TREE BEFORE YOU, AND ITS VERDICT IS YOUR FIRST TARGET.** This pass's verdict is bundled in full (R0 says, from the file list, exactly which round-48 records are). They are evidence to verify, not authority to agree with. Read their results and measurement limits directly. Independently audit the whole current tree; establish whether every repair holds and whether any new defect survives measurement.

**THE OWNER'S RULINGS ARE NOT FINDINGS.** DESIGN-v6.md records product decisions (no Bank key, no admin, a guardian that can only stop, immutability, a 7-day charter window, 10% royalties forever, 85/15 forever, the 2.1%-per-hour redemption cap, 21% quorum / 51% threshold / 3-day votes, the Proof of Burn collection authority staying a hot wallet, the sweep helper, Orca-then-Meteora for the swap). Do not argue them. DO report where the code fails a ruling, where a ruling opens a hole the documents do not already accept, and where HOLDER-GUIDE.md promises something the code does not do.

=====================================================================
THE TARGETS, IN ORDER
=====================================================================
**R0. ROUND 48'S VERDICT AND ITS REPAIRS, AND WHY THIS ROUND IS THE LAST.** Round 48 audited round 47's repairs. Its programs pass was not launch-clean only because quorum was not met (5 of 8 seats were real audits); its off-chain pass was launch-clean (6 of 8). Neither confirmed anything in (a)-(d). Every confirmed item is repaired since: V48-1 (LOW) the redeem page now claims first for a vault WAITING to join too, so a join and a credit that land while the holder approves are collected instead of refused (ClaimBeforeBurn); MINT's claim skips or joins a waiting vault and never fails it, which the end-to-end test now shows on chain before and after the vault may join; V48-2 the two scripts that boot or kill a test validator and missed round 47's one-at-a-time lock now take it, and the selftest finds every such script by its content; V48-3 the holder pages' README had a stale count and described the token listing as it was before round 46; and seven off-chain items (V48o-1 to V48o-7: the Core watch's handling of a diagnostic killed outside its trap and its now-gated selftest, a false CRITICAL on a token account made for a burnt vault's wallet, the transaction reader's SOL-transfer check, and the cron installer refusing to install beside untagged jobs), outside this round's scope. **RULING, Gary 2026-10-10: THIS IS THE FINAL ROUND.** It audits the five programs and the pages that holders and Gary sign, with the suite, the simulation and the build that are their evidence. If it requires no change there, the programs are deployed and made permanent (road steps 9 to 11). Tooling, alarm and documentation findings are still reported at their true severity and fixed, but they do not hold the deploy. **WHAT THIS PASS CARRIES (computed from its file list, not typed).** Round 48's records bundled here: `audits/round48/VERDICT-programs.md`, `audits/round48/VALIDATION.md`. Every module a bundled JavaScript or TypeScript file imports is bundled here EXCEPT these 10, which this pass does NOT carry: `bank/crank.mjs` (imported by `tests/3prog.test.ts`; read in the other pass); `bank/detectors.mjs` (imported by `sim/test-vault.ts`, `web/src/lib/plan-redeem.mjs`; read in the other pass); `bank/layout.mjs` (imported by `tests/expiry-budget.mjs`, `tests/3prog.test.ts`, `web/meta/generate.mjs`, `web/src/lib/ceremony-reads.mjs`, `web/src/lib/reads.mjs`, `web/test/get.test.mjs`, `web/test/redeem-fixtures.mjs`; read in the other pass); `bank/lock.mjs` (imported by `scripts/rehearsal-recover.mjs`; read in the other pass); `bank/spl.mjs` (imported by `scripts/rehearsal-recover.mjs`; read in the other pass); `bank/swap.mjs` (imported by `scripts/rehearsal-steps.mjs`, `scripts/rehearsal-recover.mjs`; read in the other pass); `scripts/check-launch-params.mjs` (imported by `web/src/pages/ceremony.mjs`, `scripts/rehearsal-steps.mjs`; read in the other pass); `web/src/generated/errors.json` (imported by `web/src/lib/tx.mjs`; in NEITHER pass); `web/src/generated/pob-set.json` (imported by `web/src/pages/ceremony.mjs`, `web/src/pages/claim.mjs`; in NEITHER pass); `web/test/ref.mjs` (imported by `web/test/get.test.mjs`, `web/test/proxy.test.mjs`, `web/test/ix.test.mjs`, `web/test/e2e-localnet.mjs`; read in the other pass).  A claim that turns on any file named in this paragraph is a claim about a file you were not given: say so, rather than inferring its contents. Independently verify every confirmed finding's repair at all sites of its shape and for regressions, and re-test the claims it disproved; do not re-file a claim merely because a verdict contains it. The launch gate (SPEC gate 3, RULING Gary 2026-10-08) blocks launch on any confirmed finding in the five programs, any path that moves or miscredits value, anything that stops or wrongly refuses a holder's crack, and any HIGH or MEDIUM anywhere; LOW/INFO in the fixable layer (pages, alarm, crank, jobs, tooling, tests, docs) is still fixed and tested but does not block. This is the confirmation round on the final tree. Grade honestly and report EVERYTHING you find at its true severity: the gate never lowers what you report, and a finding that belongs in (a)-(d) must say why. **THIS PASS ALSO CARRIES web/** (the holder pages /vault/, /redeem/, /claim/, /buy/, the unlisted launch ceremony, the metadata generator and the RPC allowlist proxy), audited thirteen times (rounds 36-48) and repaired since; the rehearsal signing page (the rehearsal profile, walletRefusal, the hosted origin in web/deploy/ceremony-local.mjs and the per-tree program set in web/deploy/rpc-proxy.mjs) is new in round 46: every transaction they build is one a holder or Gary signs, so check each against the programs, SPEC item 50's client contract and the Known-limits C5 rule, and look for any path where a holder loses value the page said was safe. Independently validate its confirmed findings, measurements, rejected claims, accepted limits and any resulting repairs against this tree. If it was clean, this is a second, independent audit of the unchanged code: test its conclusions from first principles. If it found defects, verify every repair at all sites of its shape and for regressions. Do not re-file an old claim merely because the prior verdict contains it; show a surviving defect. Check the suite, simulation, holder promises and operational gates along with the program logic.

**R1. CUSTODY: CAN ANYONE BUT THE OWNER GET VALUE OUT OF A SEALED VAULT, OR AN EMPTIED VAULT SURVIVE?**
The seal (`programs/cbob-vaults/src/lib.rs`, `open_for_redemption`) thaws only when a top-level `burn_vault` for the same asset AND owner follows in the same transaction; `programs/cbob-vault-burn/src/lib.rs` burns only after a matching top-level open and an emptiness proof. In v6 there is NO Bank co-signature: the owner's signature plus these rules are the whole gate. Attack the pairing (CPI wrappers, two vaults in one transaction, account-index binding, instruction-sysvar parsing), the emptiness proof (Token-2022 extensions, delegates, close authorities, lamports, nested Core assets, declared-but-foreign accounts), and anything that lets a thawed vault leave a transaction unburned.

**R1s. THE SWEEP HELPER (`programs/cbob-vault-sweep/src/lib.rs`, audited in round 25).** A native, stateless program with no key and no config. The redeem page calls it through Metaplex Core `ExecuteV1` between SEAL's open and BURN's burn; Core signs as the vault's asset-signer PDA. For each (source, destination) token-account pair it reads the LIVE balance, transfers all of it, closes the source (rent to the destination wallet), then sends every lamport of the asset-signer to the destination wallet. Prove or break:
  (a) **Nobody but the asset's owner can make it move value.** Called directly it needs the asset-signer's signature; through Core, Core decides who may `ExecuteV1`. Is that ONLY the owner (not an update authority, a delegate, a plugin authority such as SEAL's PermanentFreezeExecute PDA, or a collection authority)? Can it be reached while the vault is still frozen, i.e. outside a redemption, and what then?
  (b) **The pair list.** Any pair can be named: a source owned by the asset-signer (checked) and a destination owned by the ONE destination wallet with the same mint (checked). What if the same source appears twice, a destination appears twice, a source is also a destination, a source is a native wSOL account, a source has a delegate or close authority, an account is frozen, the destination is not an ATA, or the destination wallet is the vault's own asset-signer (refused) or another vault's asset-signer? What does an odd or zero-pair account list do?
  (c) **Destination checks.** The destination wallet is chosen by whoever builds the transaction, and the program does not compare it with the asset's owner. Given (a), is that safe? Does the lamport transfer to a destination below rent-exemption, or to a non-system account, fail in a way that blocks redemption?
  (d) **The lamport sweep.** It moves `signer.lamports()` read at execution, emptying a system account to zero. Can anything leave the asset-signer non-zero afterwards inside the same transaction (a later instruction depositing, Core itself), and does BURN's `lamports == 0` check still see exactly what the sweep left?
  (e) **Interaction with BURN's emptiness proof.** BURN requires every reserve mint's ATA under BOTH token programs to be DECLARED, and skips an account no token program owns. The sweep closes what it empties. Show the closed account passes for the right reason. What remains if a vault's reserve ATA does NOT EXIST when the page builds the transaction: the sweep cannot name it (it refuses a non-token account), but anyone can create a classic ATA for any owner, permissionlessly, and deposit into it before the redemption lands. SPEC's REDEEMING step 1 says the page creates the missing reserve accounts in a PRIOR transaction. Is that sufficient, and is there any account a stranger can create for the vault that neither the sweep can name nor BURN will skip (a Token-2022 ATA for a classic mint, a non-ATA token account, a nested Core asset)?
  (f) **Does it fit?** S8.0 in `sim/test-vault.ts` measures the three-asset redemption through the helper, claim included, inside one legacy transaction (1,232 bytes). Check what that measurement includes and what a real page adds (compute budget instructions, a fourth reserve, the in-line monthly run's accounts).
  (g) **Evidence.** SR.0-SR.4a in `tests/3prog.test.ts` and S8.* in the simulation. Find an arm that cannot fail, or one refused for a reason other than the one named. Is the helper deployed in the suite from the same bytes `scripts/build-mainnet.sh` proves?

**R2. THE COMMUNITY POOL'S MONEY (`programs/cbob-vault-mint/src/lib.rs`).**
`split_revenue` 85/15 into a program-owned pool; a weighted accumulator (`acc_scaled`, `owed_scaled`, per-vault `debt_scaled`); TWO-STEP activation (`activate` requests; a vault JOINS only once `dist_epoch` has passed its request); `JoinWaitingFirst`: no distribution while any eligible-but-unjoined vault waits; `distribute` by a 100 $GARY burn or a free monthly path; `monthly_inline` riding inside mint, charter claim, activate, claim and the redemption's `retire_redeemed`; `claim` paying only into each vault's own recorded cbBTC account; `retire_redeemed` (refuses while a whole sat is owed, EXCEPT when the pool is frozen, where the share is forfeited to the pool) and `retire_burned`. **Prove or break the invariant "the pool always holds at least ceil(owed)".** (Round 24 W11: the true rule about revenue that arrived before a vault joined is SPEC's weaker one, not the stronger wording; attack SPEC's.) Look hard at every counter (`pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight`) under every ordering of the host instructions, and at liveness: can anyone make distributions or redemptions impossible for others?

**R2b. THE $CBOB BOOST.** OWNER-ONLY (`BoostNotTheOwner`) with the buyer's terms `max_price`/`min_weight`/`min_epochs` (`BoostTermsMoved`, one-sided by ruling). `boost_vault` (the owner burns `boost_price` of THE `cbob_mint` pinned at initialize for an ACTIVATED vault, which then weighs `boost_weight` more for the next `boost_epochs` distributions), `expire_boosts` (records only), `set_boost_terms` (GOV only, inside `max_boost_weight` / `max_boost_epochs` fixed at initialize), the per-record `carry_scaled` that `reweigh` moves what a vault is owed into, the `boost_expiring` ring of 64 and `boosts_due`, and the `BoostsExpireFirst` gate on `distribute` and `monthly_inline`. **Prove or break: a boost earns EXACTLY its N distributions and not one more; nothing a vault earned is lost or gained when its weight changes (by boost, expiry, claim normalisation, or retire); `total_active_weight`, `boost_weight_total`, `boosts_active`, `boosts_due` and the ring always agree, including past epoch 64; no record can be expired twice, early, or never; and nobody can make distributions impossible by boosting or by a vault whose token account is gone.**

**R3. THE LEVEL DRAW.** `capture_entropy` / `reveal_level` / `reschedule_reveal` and the crank that rides on four host instructions: three slot hashes from three leader groups after the mint, drawn WITHOUT REPLACEMENT from the remaining census, strictly in mint order (FIFO), a missed window rescheduled to a future slot, never defaulted. Check the SlotHashes parse, the skipped-slot handling, the FIFO, a burned vault at the head of the queue, the attribute re-supply hash, and what a minter, a crank operator or a slot leader can actually influence. SPEC 26 now states (round 24 A1) that C's leader CHOOSES among many draws; say if it is WORSE than that, and whether HOLDER-GUIDE.md now says it truly.

**R4. GOVERNANCE (`programs/cbob-vault-gov/src/lib.rs`).** One vault one vote bound to the ASSET; electorate fixed at creation (`index_snapshot`, live `quorum_supply`); no proposal before the charter window closes; quorum, threshold and a 10% YES turnout; a guardian change or a new swap operator needs YES from half of the live vaults snapshotted when the proposal is created, never in the same proposal, and lands only after a notice via a permissionless apply; the guardian may cancel a pending swap operator; `TightenSweep` only tighter and only inside bounds fixed at initialize; an overtaken action is a logged no-op (`CBOB_ACTION_SKIPPED`), not a revert. Find any way a minority carries what it should not, any way a vote reaches money it should not, and any way governance can be frozen forever (SPEC 47 now states a stolen guardian key's stop can be permanent at low turnout; is it worse?).

**R5. THE CHARTER CLAIM.** `claim_charter_vault`: the Proof of Burn identified by ADDRESS against a Merkle root of 240 addresses (domain-separated, sorted pairs), CPI-burned as its owner in the same instruction, inside a window fixed at initialize that can never reopen, not gated by the guardian, and `pob_extra` accounts passed through to Core's burn never as signers. The Proof of Burn collection's update authority is a hot wallet we do not control (kept by ruling, alarmed; SPEC 46 now says it can end the project or capture governance). Is SPEC 46 now complete, and is there anything that wallet, a PoB holder or a third party can do that it still omits?

**R6. THE ONE-TIME CONFIGURATION AND THE TRUSTED HOP.** Every `initialize` across the four vault programs: what it accepts, what it refuses, and what a wrong-but-accepted value would lock in FOREVER once the upgrade authority is removed (from all five programs, the sweep helper included). The swap operator (`sweep_sol_for_swap`) is the one trusted key: bound its worst case. The 10% royalty is a Core plugin with authority None: confirm nothing in our programs or in Core lets anyone change it. The redemption cap (`programs/cbob-vault-burn/src/lib.rs`) is a rolling window over a 64-slot ring of timestamps: check it is exactly that.

**R7. CROSS-PROGRAM RAW READS.** GOV and BURN read MINT's config, GOV reads MINT's vault record and BURN's config, MINT and BURN read SEAL's config, all by raw offset pinned by discriminator and layout version. The sweep helper reads classic SPL token accounts by raw offset (mint 0, owner 32, amount 64, length 165). Recompute every offset and every account space from the struct definitions. A wrong offset here is a silent misread that the type system cannot see.

**R8. THE SUITE, THE SIMULATION AND THE BUILD AS EVIDENCE.** `tests/3prog.test.ts`, the Test Vault simulation and `scripts/build-mainnet.sh` are what the claims above rest on. Find arms that cannot fail, arms whose negative fires for a different reason than the one named (the `because()` list pins many), claims in this prompt that NO arm exercises, and any program whose mainnet bytes are not proven to be the bytes the suite ran.

=====================================================================
THE ACCEPTED LIMITS ARE THE MOST VALUABLE THING YOU CAN ATTACK
=====================================================================
Reproduced VERBATIM from SPEC.md. **Do not re-report these as new findings. DO tell us:**
  1. **Is any limit WORSE than stated?** An accepted limit that is actually exploitable is the one thing immutability locks in.
  2. **Is anything listed as a limit not actually a limit**, already closed, or closed by something the author did not notice?
  3. **Is any DISCHARGED item not actually discharged?**
  4. **Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

## ACCEPTED LIMITS — the audit carry list, closed

**Read this before filing a finding.** Twenty-one v5 audit rounds and three v6
red-team passes produced these. Every one was measured or read against the code,
every one is real, and the ones under ACCEPTED are not going to be fixed. A limit
written down before a round is not a finding when that round re-reports it; a
limit left unwritten resets the freeze counter every time a fresh reader notices
it, which is the treadmill `audits/FREEZE.md` exists to leave.

**This section and "Known limits, stated rather than papered over" above are
different lists and the difference is not stylistic.** That one holds properties
of the DESIGN — consequences of decisions taken deliberately, most of them
on-chain and permanent. This one holds unrepaired AUDIT FINDINGS. A defect that
is accepted lands here; a cost that was chosen lands there. Numbering follows
`audits/FREEZE.md` so the two documents can be read side by side, which is why
there are gaps: a discharged item keeps its number rather than letting the list
renumber underneath a reader. v6 items continue the numbering from 25.

**Three states, and an item is in exactly one of them.** ACCEPTED means will not
fix. OPEN AND BLOCKING means it must be done before anything mints and must not
be quietly demoted to accepted — limit 17 sat there for five rounds and was
discharged by measurement, not by argument. DISCHARGED means measured closed, or
removed with the thing it was about, with the reason named, so a later reader can
neither re-report it nor mistake the list for complete.

**v6 moved a whole family of items to DISCHARGED at once.** Items 1a, 1b, 2, 3,
4, 5, 11, 15, 16, 18, 20, 21, 23 and 24 were about the Bank key, its co-signer,
the deck or the off-chain distributor. None of those exist in v6, so the limits
went with them. Each is kept below, under DISCHARGED, with what replaced it.

---

### ACCEPTED — will not fix

#### `bank/lock.mjs` — the mutual exclusion under the money crons

**6. An aborted `flock` run is indistinguishable from one that never fired, in
the log.** *Costs:* diagnosis time after an incident. *Who:* the operator.
*Why not fixed:* it is a logging shortfall, not a correctness one, and every
change to this file in rounds 12, 14, 15 and 16 introduced a defect.

**7. A wedged-but-alive holder is a permanent silent skip under `flock -n`.** A
process that holds the lock and never finishes stops every later run of that
job (the crank, the reveal lane, revenue, and the daily `--reconcile`; round 38
C04: the reconcile lane has no deadman, so its stall is silent, which costs only
the daily undeclared-account report, never a payout). *Costs:* our layer of the automation
stops until a human notices. *Who:* holders, through a later payout or reveal.
*Why not fixed:* the alternative — a timeout that steals the lock — is how a
double-send happens. v6 makes the stall survivable rather than silent: every
crank instruction is permissionless and the monthly distribution also runs
in-line in ordinary traffic, and the alarm raises `distribution_overdue` when a
period passes with no distribution and `reveal_rescheduled` when a capture
window lapses. ⚠️ Round 23 (D5, M3, M4): that sentence was UNTRUE for two of the
three jobs until this round. A wedged crank whose distributions traffic kept
running in-line left owed shares undelivered with every detector quiet; it now
pages `crank_silent` (no LIVE full-pass heartbeat in 3 hours while the crank is
armed). A wedged, dead or never-armed revenue job left royalty SOL sitting with
no ledger row and nothing reading the revenue address; it now pages
`royalties_unswept` (a sweepable 1 SOL or more, a day without a sweep). Round 23
(L15) also stopped a DEAD holder blocking a lane: `bank/lock.mjs` breaks a dead
or recycled pid's lock at any age; a live one is still never stolen from. (v5
text named `detectDistribution`'s `distribution_unfinished`, which was deleted
with `bank/distribute.mjs`.) ⚠️ Round 24 (H1, L4): "its failures page from the
crank itself" was true once per stream: every crank page shared one router
label, so the first failure opened it and every later one, of either lane, was
suppressed for 12 hours with nothing to close it. Each crank lane now has its own
stream (`cbob-vault-crank:full`, `:reveal`, `:fee_ceiling`), pages its FULL
failure list, and sends a RECOVERY on its first clean live pass. The alarm no
longer takes the crank's word alone: the heartbeat carries the pass's failures
and problems, and three live passes in a row with failed actions
(`crank_failing`), or one problem in three in a row (`crank_problem`, e.g. an
owed vault left out of every batch), page HIGH; a `crontab -l` that cannot be
read is `crank_posture_unreadable` HIGH and keeps the armed-since clock, where it
used to read as "not armed" and silence `crank_silent`.

#### `bank/alarm.mjs` / `bank/detectors.mjs` — continuous detection

**8. Cross-pass correlation lag.** If the signature walk reaches the burn in a
LATER pass than the DAS diff, the CRITICAL has already gone out and nothing
retracts it. *Costs:* a false CRITICAL that a human must close by hand.
*Who:* the operator. *Why not fixed:* retraction means the alarm editing its own
history, and a pipeline that can un-say a CRITICAL is worse than one that cries
wolf. ⚠️ This item FELL OFF round 16's carry list while still unfixed; the leak
is recorded in the freeze log as one.

**9. (v6 restated, and WIDER than v5) Nothing detects a FOREIGN Core asset nested
in a vault continuously, and since v6 nothing refuses the redemption either.**
In v5, `bank/cosign.mjs`'s `scanPda` asked DAS for every asset the vault's PDA
owned and refused the co-signature, so a foreign nested asset failed the
redemption CLOSED; what was missing was only advance warning. v6 deleted the
co-signer. `detectNestedVaults` walks our own collection and cannot see a
foreign asset, so the only pre-signature check left is the redeem page's
`judgeRedemptionCoverage`, run by the redeem page, which is built in `web/` but
staged, not published (item 50), and an owner who
redeems by any other client destroys the nested asset. *Costs:* the asset.
*Who:* the holder, to their own property; a nested vault itself is no longer
lost (item 58: `rescue_nested`), but undeclared tokens in a burned host still
are. *Why not fixed:* the chain cannot
enumerate what a PDA owns (proven impossibility 2), and continuous detection
needs a per-vault DAS owner search every pass. See also item 44.

#### The swap hop (`bank/revenue.mjs`, MINT `sweep_sol_for_swap`)

**10. (v6 restated) The swap operator is the one trusted hop.** Royalty SOL is
swept on chain to a long-lived operator key and swapped to cbBTC off chain; mint
prices are cbBTC and never touch it. *Costs:* the operator (or a thief of its
key) can keep the SOL: per-sweep cap x cooldown windows until the guardian
pulls `emergency_stop_sweep`, never more than the revenue PDA holds above the
reserve. *Who:* holders and the Squads, of royalty revenue only. *Why not
fixed:* there is no trustless SOL->cbBTC without a DEX CPI. **BUYER-FACING** for
what the key can take (in the holder guide's honest list since round 25, D5:
royalty SOL up to the cap every cooldown until the guardian stops it, never a
vault, the pool or sale cbBTC). What v6 adds: the
operator must sign, a vote can only tighten its bounds and only inside the
`initialize` bounds (1 SOL, 24 h, 0.1 SOL ruled), a replacement needs half of
all live vaults (as snapshotted at the proposal's creation) plus 7 days' notice,
and the guardian can stop the sweep and
cancel a pending replacement. ⚠️ ROUND 24 (M1; Gary 2026-10-05: "Orca direct +
Meteora fallback"): THE SWAP NO LONGER SIGNS WHAT A THIRD PARTY BUILT. Until round
24 `bank/revenue.mjs` signed the transaction Jupiter's `/swap` endpoint returned,
checked only by a narrow blacklist (round 23 D3), and round 24 measured that
endpoint's host GONE. `bank/swap.mjs` now builds the swap itself against two
PINNED pools: the Orca Whirlpool `CeaZcx…` (SOL/cbBTC, ~$10M liquidity, 0.16%
fee) first, the Meteora DLMM `H2USRS…` (~$0.9M) only if Orca's program refuses.
Every account is pinned or derived, and both programs' interfaces are from their
published IDLs. ⚠️ ROUND 25 (D1, L1) CORRECTED WHAT THE PRE-SIGNING JUDGE WAS SAID
TO DO. At `2b67fb1` `judgeSwapInstructions` checked only the allowed programs, one
signer, one venue instruction naming the pinned pool, one System instruction whose
second key is our wSOL account, and one close of that account back to us.
Measured, each of these passed it on both venues: the output account changed to a
stranger's, a floor of zero, a changed amount, Orca's direction flipped, a
priority fee appended, a Token `Approve` of our cbBTC to a stranger, a changed ATA
owner, and a 50 SOL wrap. It now takes the cycle's `lamportsIn` and `minSats` and
requires the EXACT seven-instruction sequence `swapInstructions` builds: a
compute-unit limit of 400,000 and no compute-unit price (it refuses a priority
fee); each ATA creation for the operator's own wallet and mint; one System
transfer of exactly `lamportsIn` from the operator into its own wSOL account;
SyncNative; the venue's swap with the operator's wSOL and cbBTC accounts at their
pinned positions, its amount `lamportsIn`, its threshold `minSats` and, for Orca,
the direction and price limit pinned; and no Token instruction but SyncNative and
the one close (`bank/swap.mjs` `judgeSwapInstructions`; selftest round-25 L1 arms refuse each of the verdict's eight tampers on both venues). **What a judge in this tree can and cannot
catch:** it lives in the same file tree, under the same user, as the builder and
the signing key, so it catches OUR defects, never a tampered module (whoever can
edit `bank/swap.mjs` can edit the judge, or `bank/revenue.mjs`, which holds the
key: the box-owner residue in (3) below). A builder defect that misroutes the
output or drops the floor is also caught AFTER signing: `bank/revenue.mjs` throws
when the operator's cbBTC delta is below the floor, and the cycle stays open and
loud.
The OUTPUT FLOOR is enforced ON CHAIN by the pool program and comes from Pyth (the
sponsored, fully verified SOL/USD and BTC/USD accounts: at most 180 s old,
confidence within 0.3%, `MAX_ORACLE_CONF_BPS = 30` since round 25 I3; the live
confidence is about 1.5 bps), never from the pool's own price. A pool whose spot
price is more than 1% from the oracle at the read the swap is built from is
skipped; the earlier read only decides whether to sweep at all (round 38 C03). This
read-time filter does not bind the price at execution; the transaction enforces
the separate 150 bps output floor. The price's age is judged against the
chain's Clock sysvar, never the box clock; an unreadable Clock refuses the cycle,
and a `publishTime` more than 30 s ahead of it is refused (`oracleFloor`,
`market()` in `bank/swap.mjs`; selftest round-25 L2 arms, fork arms SW.7-SW.7b). (Round 25 L2:
at `2b67fb1` the age was judged on the box clock, which round 24 I2 had already
taken off the crank, so a box running slow accepted a stale price, and a
future-dated price passed.) **The bound, as a number:** the output floor is the
oracle-derived expected output less 150 bps (`SWAP_TOLERANCE_BPS`), rounded down
to whole sats. Each USD feed's reported confidence must be at most 0.3% of its
reported price (`MAX_ORACLE_CONF_BPS = 30`). These checks do not establish a hard
bound on deviation from the true SOL/cbBTC market price. Confidence measured on
2026-10-05 was 1.5 bps for SOL and 1.0 bps for BTC. Proven on a mainnet fork (`sim/swap-fork.sh`, a
`run-tests.sh` gate): real swaps through both real programs against cloned real
pool state, and a floor 5% above the oracle refused by each program with nothing
moved.
**What remains trusted** (round 25 D1: this list named only the first item):
(a) the two pool programs and the Pyth price (a stale or manipulated oracle is
bounded by the age, confidence and pool-agreement checks, not removed); (b) THE
ONE RPC ENDPOINT every price, pool account and floor is read through; (c) the
integrity of `bank/swap.mjs` and `bank/revenue.mjs` themselves, which no check in
the same tree can vouch for; (d) THE THIRD PARTIES' UPGRADE KEYS, all live and
none ours (round 25 I2, read on mainnet 2026-10-05): the Orca Whirlpool program
`whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`, upgradeable by
`GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV`; the Meteora DLMM program
`LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`, by
`JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd`; and Pyth's receiver
`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` and push oracle
`pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`, both by
`6oXTdojyfDS8m5VtTaYB9xRCxpKGSvKJFndLUPV3V3wT`. Whoever holds any of them can
replace the program the swap or its floor runs on. The alarm watches each one's
upgrade authority and bytes, at HIGH rather than CRITICAL because their upgrades
are routine; it detects, it cannot prevent (`THIRD_PARTY_PROGRAMS`, `bank/detectors.mjs`).
**Throughput has a permanent ceiling; the alarm observes net balance changes**
(round 25 A2, qualified in round 27). The ruled cap, 10 SOL per 6-hour cooldown, can only be lowered by a vote, so
royalty SOL beyond about 34 SOL a day (round 37 C05: the hourly job reads the
chain clock a few seconds before the sweep lands and MINT stamps `last_sweep_at`, so
the run six hours later finds the cooldown a few seconds short and the next one,
seven hours on, sweeps: 24/7 x 10 SOL, not 24/6 x 10) waits in the revenue address however large
the backlog, and `detectUnsweptRoyalties` restarts its clock on every fall of the
balance. A capped sweep resets that clock only if the balance falls between
alarm reads. Incoming royalties can hide a successful sweep, so the clock can
continue and page even while sweeps work; inspect the transactions and ledger.
Round 25 (L4): at
`2b67fb1` the revenue cron ran at `41 */6` while `last_sweep_at` is the chain time
the sweep LANDS, a few seconds after the run starts, so the next run usually read
the cooldown as not yet elapsed and skipped: 20 SOL a day in practice. The job now runs HOURLY
(`41 * * * *`, `scripts/cron-install.sh`) and judges the cooldown on the chain Clock
(`sweepCooldownOver`), so it sweeps on the first run after the cooldown truly
elapses; the alarm's `royalties_unswept` grace now follows the on-chain cooldown.
**Dust is not swept** (round 30 L3). Anyone can send lamports to the revenue PDA,
and an amount above the reserve too small to buy one whole sat used to fail the
revenue job at its market step every hour, with a failure page. The job now
sweeps nothing below `MIN_SWEEP_LAMPORTS` (0.01 SOL, `bank/swap.mjs`
`sweepAmount`) above the reserve; such dust waits for real royalties.

**Hand recovery of an open cycle** (round 25 A3). `bank/revenue.mjs` refuses to
start a cycle while one is open and says to resolve it by hand (`--audit` lists
them); the automatic path cannot double-swap, the hand path can. Live failures use stable `cbob-revenue:<stage>` streams; only a stage actually passed can send its saved recovery, and failed notification delivery keeps its marker. Before swapping
by hand, look up every recorded confirmed or candidate signature with `getSignatureStatuses(...,
{ searchTransactionHistory: true })` and read the operator's wSOL and cbBTC
balances. Round 26 preserves known uncertain-send candidates as `pendingSweepSig`,
`pendingSwapSig` (and `pendingSwapVenue`), `pendingReturnSig` and `pendingSplitSig`;
these are evidence to investigate, not confirmation or permission to retry.
A swap whose confirmation timed out may have landed, and a second swap would
then be a double swap. Check the return and split before repeating either too.
Record the hand return in the ledger and re-run
`--audit` until it is clean.
⚠️ Round 24 (D2), still true: (1) THE OPERATOR WALLET must hold nothing but the
cycle's funds and its fee float; nothing on chain enforces that. (2)
`OPERATOR_FLOOR` IS the 0.02 SOL float and nothing refills it: fund it above the
floor and top it up by hand. (3) The DETECTION half does not survive a
compromise of THIS BOX: the revenue ledger, the crontab and the alarm belong to
one user, so whoever can write the ledger can also stop the alarm. Round 24 (L10)
holds the ledger to the chain wherever the alarm can (a sweep under a row marked
refused, an explicit split held to the same total-and-order anchor as a
`splitByOther` one, a verification horizon that follows the sweeps the scan saw,
start times capped by the sweep's block time),
which catches an off-box key thief and honest mistakes, never the box's owner.
⚠️ Round 32 (L1): the walk-derived `unledgered_sweep` can be DELAYED by a stranger
flooding MINT's transaction scan (about 0.01 SOL a pass), so each pass also judges
MINT's `last_sweep_at` from account state (`sweep_unledgered_state`, CRITICAL): a
newer sweep with no ledger cycle that recorded a LANDED sweep within half a
cooldown of it pages whatever the scan's backlog. Round 33: the window is
symmetric because the cycle's start is the box's wall clock and the sweep's time
the chain's, so ordinary clock skew cannot page an honest sweep; a thief's sweep
cannot sit inside an honest cycle's window, since it must wait a full cooldown
after the honest one and revenue.mjs writes a row only once the cooldown has
passed; and an uncertain send explains a sweep only when a direct
`getSignatureStatuses` lookup (not the floodable walk) shows it landed. The
cooldown used is the SMALLEST the alarm has ever seen (and never above the ruled
6 h): a vote can only LENGTHEN it (MINT keeps the maximum, GOV refuses a shorter
one) and anyone may execute a passed proposal, so judging with the current value
would let a key thief sweep and then execute a longer cooldown to widen the
window (review 33). Only the LATEST
`last_sweep_at` is visible, so a thief's sweep followed by an honest one while
the alarm itself was down for a whole cooldown is masked here and left to the
transaction walk. Round 34 (L3): split recovery starts its scan at the return's
CHAIN time, so a box clock running ahead of the chain no longer starts it after
the split it needs. Residual: a cycle row written before `returnBlockTime` was
recorded has only the box clock, which `closesCycle` also anchors on, so if
that clock ran ahead such a row cannot be closed automatically; it stays open
and alarmed, and closes by hand recovery.


#### MINT

**13. (v6 restated) A level is immutable only as far as MINT's upgrade authority
is trustworthy, until that authority is removed.** In v6 the Attributes
plugin's authority is MINT's `["mint"]` PDA, and the only instruction that writes
attributes after `CreateV2` is `reveal_level`, once (`AlreadyRevealed`). 11.13
and 11.14 assert that neither the owner nor the `INIT_AUTHORITY` can rewrite a
drawn level (Core refuses), and 11.15 that the drawn value survives. The
reserved `redemption` key is still refused at mint, though nothing has written
it since v4. *Costs:* until the upgrade authority is removed, whoever holds it
could ship an instruction that rewrites any vault's level, which decides how
much every holder is paid. *Who:* every holder. *Why not fixed:* it is closed by
removing the upgrade authority at launch (ship gate), and the alarm reports any
program still upgradeable past the lock date (the earlier of `lock_deadline` and
MINT's `charter_opens_at`, round 23 L12). **BUYER-FACING.**

#### v6 stage 3 — the draw, the pool, and what they leave

**25. A MINTER WHO DISLIKES THEIR DRAW CAN LET IT LAPSE FOR A RE-ROLL — BUT ONLY
IF NOBODY CAPTURES IT FOR THE WHOLE WINDOW.** Slot hashes are PUBLIC, so once a
vault's three hashes exist anyone can compute its draw off chain without
capturing it (stage 2's comment saying the minter "cannot see the draw without
capturing it" was wrong). Since stage 3 a missed window is RESCHEDULED to a fresh
future slot (Gary: *"We can't lock everyone in the lowest level"*), so a minter who
computes a bad draw and declines to capture gets a new roll — PROVIDED no one else
captures in the ~300-slot (~2 min) window. *Costs:* one re-roll per full window of
total silence; repeated silences are repeated rolls. *Who:* every other holder,
through the census (a re-rolled Level V is a Level V someone else did not draw).
*Why not fixed:* any rule that assigns a level WITHOUT entropy (stage 2's
lowest-level default) punishes holders for a crank that did not run, which Gary
ruled out. ⚠️ Round 22: traffic captures nothing unless it NAMES the record, so a
lapse needs only that nobody who names this record sends a capture, and both the
crank operator and the minter's own client can withhold one. *The control:*
capture is permissionless and rides on `mint_vault`,
`claim_charter_vault`, `activate` and `claim` (up to 4 queued vaults each), the
crank's reveal lane runs every minute, and **every reschedule logs
`CBOB_REVEAL_RESCHEDULED`** and counts on the record (`reschedules`), so the alarm
pages on a reschedule, except where the runtime truncated that transaction's
logs: then the line is lost and the alarm records it as a `log_coverage_gap`,
whose signature is kept until a person reviews it, and which sends a new email
only if that stream is not already open (rounds 29-32; the cost is stated in
"Reader coverage boundary"). ⚠️ **ROUND 22 CORRECTED THIS:** it used to say a lapse
"needs a crank outage AND no protocol traffic". That is false: capture accounts on
the host instructions are OPTIONAL (most traffic carries none), and a crank that
is up but slow (it confirms each capture serially) also lapses windows in a burst.
⚠️ Round 25 (A1) measured how little "slow" takes: one RPC socket that accepts and
never answers. web3.js 1.98.4's default `Connection` (the crank's and revenue's at `2b67fb1`)
waited 300.8 s before failing, longer than the whole window, and the next minutes'
`flock -n` runs skip silently meanwhile (item 6).
And a window that lapses with NOBODY calling reschedule logs nothing at all, so
the alarm now also pages when the level queue does not move between two passes
(`reveal_queue_stalled`). **BUYER-FACING** (in the holder guide's honest list since
round 25, D3, which also deleted its "Nobody else can").

**26. THE LEADER OF THE LAST ENTROPY SLOT CAN STILL GRIND ITS OWN BLOCK.** The draw
hashes three slot hashes from three different leader rotations (A at or after the
reveal slot, B and C each two 4-slot groups later; alignment measured on mainnet).
That removes every other leader's influence, but C's leader produces its block
KNOWING hA and hB and may vary its contents. ⚠️ Round 22 corrected "(or skip,
handing C to the next leader)": B and C target the FIRST slot of a 4-slot leader
group, so a skip by C's leader moves C to that SAME leader's next slot, and the
leader schedule is public, so a validator can time a mint (or a reschedule) to
put C inside its own rotation. Being C's leader is chosen, not a stake-share
lottery. *Costs:* a validator that is C's leader can CHOOSE AMONG MANY DRAWS, not
merely bias one. ⚠️ Round 24 (A1): C is the smallest produced slot in
`[want, want + 64]`, so the leader can skip its own first slot(s) and move C
within its own 4-slot group; skipping alone is best-of-4, which takes P(Level V)
from 5.0% to 18.6% and the expected weight from 3.05 to 4.38 (against the
945/525/315/210/105 census), and varying its block's contents adds more (64
tries reach 96%). For its own vault, or a cohort's, it is selection within the
levels still left, not a nudge. And ⚠️ (round 22) **not just one vault's**: every
vault minted in the same slot shares the same `reveal_slot`, so the same three
hashes, so C's leader chooses for that whole cohort at once (each vault still
mixes its own asset address into the hash, so one choice serves the cohort
jointly, not each vault separately). *Who:* the census, as in 25. *Why not fixed:* the last
contributor to any public-hash scheme can always do this; only a VRF (a program we
do not control) answers it. One validator was measured holding two adjacent
rotations, so "three different leaders" is likely, not guaranteed. **BUYER-FACING.**

**27. A claim between a BARE burn and its retirement pays into a dead account, and
a join adds dead weight.** A vault its owner bare-burns through Core keeps its
weight until anyone calls `retire_burned`. A `claim` in between pays that vault's
own share into its cbBTC account behind the burned asset, where nothing can ever
sign for it; and a bare-burned vault still WAITING to join can be joined by a
`claim` that names it, adding weight nobody can collect until it is retired
(red-team 3 finding 2). `claim` does not check that the asset is alive.
*Costs:* that vault's own share since the last claim, and a sliver of every
other vault's share while the dead weight sits in the denominator. *Who:* every
OTHER holder (round 38 V38-4): the burner could never collect from a burned
vault, and `retire_burned` would have returned that share to the pool, so a
claim naming the dead vault takes it from everyone else; `claim` is
permissionless, so a stranger can choose to cause it. *Why not fixed:* refusing it needs the asset account in
every claimed pair (a third account per vault, a third smaller batch). The crank
never pays or joins a positively burned vault and retires it first, every pass;
`retire_burned` returns whatever was not yet claimed to the pool. A boosted
vault's dead weight is larger by its boost, up to +12 (round 23).

**28. Coinbase can freeze cbBTC accounts, including the POOL.** A frozen VAULT
account is skipped by `claim`, logged (`CBOB_CLAIM_DEFERRED_FROZEN`) and stays owed
in full (P.18), and ⚠️ (round 22) it also blocks that vault's WHOLE redemption,
its $GARY and $GIRAFFISH included: BURN requires every reserve account empty and a
frozen account cannot be emptied. The alarm pages `vault_account_frozen` (it reads
every reserve account's state each pass). A frozen POOL stops every claim that
pays until it is thawed. ⚠️ Round 24 (D4) corrected "(joins still go through)":
`claim` never checks the pool for a freeze, so a claim that pays anything reverts
WHOLE at the pool `Transfer`, the joins and expiries in it included; a join goes
through only in a claim that pays nothing (the crank sends join-only batches).
The same holds inside a redemption: one that carries a paying `claim` during a
pool freeze reverts, so the redemption must leave the `claim` out ("REDEEMING A
VAULT", item 50). ⚠️ Round 23: a frozen CBOBTC Squads cbBTC
account halts `split_revenue` too, because both halves move in one instruction,
so the holders' 85% waits in the revenue address (not lost) until it is thawed.
A frozen REVENUE address cbBTC account does the same and also refuses every paid
mint and swap return into it (round 23, L9): the alarm pages
`revenue_account_frozen` at any balance and the crank reports it instead of
splitting into the refusal. Since stage 3c
(red-team 3 finding 1) it no longer locks any vault: a redemption with the pool
frozen lands and FORFEITS its undelivered share back to the pool (logged
`CBOB_REDEEMED_POOL_FROZEN`, 3c.F0-F3), and the in-line monthly run never credits
from a frozen pool. *Who:* every holder, and a redeemer during a pool freeze loses
whatever was credited to their vault and not yet delivered. *Why not fixed:*
nothing on Solana can prevent an issuer's freeze; it is the trust cbBTC itself
carries. Anyone could try to provoke a freeze by sending tainted cbBTC to the
pool. **BUYER-FACING** (the holder guide states it).

**29. Only cbBTC splits.** The pool pays vaults in cbBTC, so `split_revenue`
refuses any other token; anything else sent to the revenue address stays there
for ever (no instruction moves a non-cbBTC token out of it). v5 could split any
token to a distributor wallet able to swap it.

#### v6 stage 3b and 3c: what a vote can reach, the rate limit, and the trigger

**32. The redemption rate limit queues honest holders too, and can be spent by
someone redeeming their OWN vaults.** At most `ceil(2.1% x live)` (floor 1)
redemptions in any rolling window, whoever signs: in a rush, self-custody holders
wait in the same line as everyone else (45 per hour at 2,100 live vaults). An
attacker holding vaults can spend an hour's budget only by redeeming those
vaults, each of which is burned, so blocking one hour costs about 2.1% of live
supply in vaults. A bare Core burn is not a redemption and is not limited (it
releases nothing). The window is an `initialize` value; ⚠️ **mainnet MUST be
3600**. Stage 3c replaced stage 3b's token bucket (which let 2x the cap through
in one rolling hour, red-team 2 finding 4) with a ring of the last 64 redemption
times: RL.2 lands exactly the cap against an empty window, RL.3 is still refused
60% of a window later, RL.4 lands once the window has rolled past, and RL.7
replays every redemption BURN remembers and finds no window over the cap. The
ring bounds the cap at 64, which covers live supply up to 3,047; above that the
limit is stricter, never looser. Round 24 (D8): "live" here is minted minus
redeemed minus RETIRED bare burns, so a vault bare-burned through Core counts
until the crank retires it (within the hour, or by anyone's `retire_burned`),
and for that while the cap can read one higher than the true live supply. Proven at a short window; the 3600 s value is
the same arithmetic, not separately exercised.

**34. Ordering is per KIND, and says nothing across kinds.** A later executed
round, guardian change or operator arm supersedes an earlier one of the same kind,
and since stage 3c the earlier one is SKIPPED and logged `CBOB_ACTION_SKIPPED`
rather than refused, so it cannot take its bundle down (7.26, E.2, red-team 2
finding 6). Different kinds execute in whatever order executors choose (RT1.2); a
stale restart half is skipped by stop time (3b.S1, mirroring MINT's
`StopIsNewer`) and `tighten_sweep` is monotone, so neither needs ordering.

**35. (v6 restated) The 10% turnout rule never binds at the ruled numbers.** YES
must reach 10% of the snapshotted live supply (D.1). With Gary's quorum 21% and
threshold 51% the smallest passing vote is already 10.71% YES, so the turnout
rule only matters if `initialize` is given other values. It stays as a floor for
that case.

**36. The in-line monthly run is skipped by a host that is early, sees an empty
pool, finds an eligible vault still waiting to join, or finds a DUE $CBOB boost
(round 23: `claim` runs the month before it expires; the next host runs it), and a month with NO
protocol traffic distributes nothing until someone calls `distribute` or the next
host lands.** "Programmatic" means any ordinary instruction does it; it does not
mean a clock fires it. The crank is layer one; the alarm pages
`distribution_overdue`.

**37. Every host instruction carries the pool (one more account).** Measured
costs are in the suite (9.14a/9.14c, P.33, 3c.P1). The redemption carries it
through BURN into `retire_redeemed`. A charter claim with an Oracle pass-through
fits only without a crank attached, so the claim page must send no crank when
`pob_extra > 0` (red-team 3 finding 7).

#### v6: what we rest on, and what immutability locks in

**39. Immutability makes every surviving bug permanent.** Once the upgrade
authority is removed nobody can fix anything. A minting bug can be stopped by the
guardian (and then sales stay stopped unless a vote accepts the bug); a bug in
redemption, the pool, governance or the charter claim cannot be stopped at all.
*Who:* everyone. *Why not fixed:* it is the ruling ("Nobody, including us, can
change the rules"). The answer is the order of operations: ship gate, Test Vault
simulation and mainnet dress rehearsal all pass BEFORE the authority is removed.
**BUYER-FACING** (in the holder guide's honest list since round 25, D5).

**40. Metaplex Core is upgradeable by Metaplex.** Every seal, thaw, sweep, burn,
Execute, level write and (round 35) rescue is a CPI into Core. A Core upgrade that
changes `UpdatePluginV1`, `ExecuteV1`, `BurnV1`, `TransferV1` or the plugin rules
reaches every vault,
and our immutable programs cannot adapt. ⚠️ Round 24 (A5) names two concrete
consequences: MINT proves a burn only by Core's exact 1-byte `Key::Uninitialized`
tombstone, so a Core change to it makes every redemption refuse `NotBurned` (in
`retire_redeemed`) and `retire_burned` likewise; and nothing advances
`revealed_total` without a successful Core `UpdatePluginV1`, so a Core change
that breaks it halts the level queue (no later vault can be revealed or
activated). ⚠️ Round 25 (N3) names a third: **who may act through a vault's
wallet.** The sweep helper's whole access control is Core's `ExecuteV1`
authority rule on a THAWED vault. Read at Core `e72d63e` (the source is not
proven identical to the pinned binary): the asset approves Execute only for
`authority == owner` (`state/asset.rs` 325-337), the collection abstains
(`state/collection.rs` 294-301), and the one plugin route that approves anyone
else is the AgentIdentity external adapter with an `ExecutionDelegateRecordV1`
(`plugins/external/agent_identity.rs` 127-138, `processor/execute.rs` 106-118).
Adding that adapter needs the collection's update authority, MINT's PDA, and our
programs' only Core CPIs are the create (which also installs the rescue's
PermanentTransferDelegate), the Royalties plugin at `initialize`, the Attributes
update, the burns (MINT, BURN), SEAL's thaw and (round 35, item 58)
`rescue_nested`'s `TransferV1`, none of which adds an adapter. So it is
sound today, and a Core change to that rule would widen who can empty a vault
during its redemption. MEASURED against the pinned Core binary: SR.5 and SR.5a
refuse a stranger and an owner-added transfer delegate on a genuinely thawed
vault (`NoApprovals`, 0x1a); SR.5b pins the collection authority to MINT's
off-curve PDA. On a control asset, SR.5c refuses the collection update authority
with the same reason and SR.5d lets its owner sweep the wallet to zero. SR.5e
checks that the refused vault attempts preserved its balances, owner and seal.
*Why not fixed:* not ours. The alarm watches
`prog.core.upgrade_authority` and `prog.core.hash`; it detects, it cannot
prevent. **BUYER-FACING** (round 25 D5: the holder guide's honest list now
names all three consequences).
⚠️ Round 28 validation, a MEASURED Core size boundary. The pinned Core runs each
instruction in a fixed 32 KiB heap; a requested larger heap frame does not help
it. An owner may add the owner-managed Autograph plugin, and any signer may then
add their own signature (an update must carry every existing signature
unchanged, so a stranger cannot replace or shrink the list: R31.W1b, 0x28). With
the largest message that fits, 10,198 bytes (the runtime refuses 10,199: CPI
instruction data is capped at 10,240 bytes, R31.W1a), on the FIFO-head vault beside
all five owner-managed plugins, the actual MINT reveal landed (R28.A1, R26.P6).
Afterwards Core could not shrink that real vault: clearing the signatures
(R28.A2) and `RemovePlugin` of even the small FreezeDelegate (the first round-28
full-run attempt, `.cache/r28-first-onchain-failed.log`) exhausted the heap and
reverted. So the owner cannot remove ANY owner-managed plugin from it, including
a delegate they approved. On that same real vault the owner freezes still thawed
(R26.P7); a transfer (R28.A3) and the complete redemption transaction, SEAL open,
Execute sweep of its funded cbBTC and BURN (R28.A4), both succeeded as
simulations, leaving it unchanged; and the vault then completed activation,
claims and votes in the suite. An isolated probe on a simpler asset shape
(`.cache/r28-recovery-probe.mjs`) also refused a stranger's further signature for
heap. Near this boundary the asset's shape decides the outcome, so these are
bounded observations at the pinned binary, not a proof for every plugin shape or
size combination. *Why not fixed:* Core's allocator and Autograph rules are not
ours. **BUYER-FACING** (holder guide, things to know before you open).

**41. A leaked custodial key is bounded only by the 2.1%/hour REDEMPTION cap, and
transfers are not limited.** The cap was built so that if Gary Club custodial
keys leaked, a thief could not empty every vault faster than we could move them
to fresh keys. It does that for redemptions. A thief holding the keys can instead
TRANSFER every vault to their own wallet at once, then redeem at the cap, or simply
keep or sell them (red-team 2 finding 4). *Who:* custodial holders. *Why not
fixed:* Gary kept the cap (RT2-4) for what it does bound, and an unlimited
transfer is also what lets custodial vaults be moved to fresh keys. The holder
copy must not claim the cap stops a key thief. **BUYER-FACING.**

**42. The redemption page must prepare missing destination ATAs in a PRIOR
transaction.** This keeps the fully padded legacy shape, including compute-budget
instructions and a separate fee payer, within the packet limit: adding all three
creates to its 1,209 bytes gives 1,367. The narrower owner-payer helper shape
without compute extras serializes to 1,219 bytes with all three creates, so the
old categorical “only two fit” claim was false (round 26 D4). That narrow variant
is an offline size measurement, not a landed transaction or the page contract.
*Who:* the required redemption-page client. *Why not fixed:* prior preparation
supports its required legacy shapes without depending on the narrow exception.
This is the current client contract, not an impossibility across all formats.

**43. An off-curve owner (a DAO, a multisig, a program) cannot redeem.** The
pairing needs the owner's signature on two top-level instructions, which a PDA
cannot give. Round 23 (F8) MEASURED the wrapper shapes with a test-only CPI
forwarder (`tests/cpi-wrapper`, its own workspace, deployed only to the suite's
validator): `retire_redeemed` through it refuses `NotFromBurn` (WR.1); a real
open with a wrapped burn refuses `NoTerminalBurn` (WR.2); a wrapped open with a
real burn refuses `NoPrecedingOpen` (WR.3); and the vault stays live with
everything it held (WR.4). ⚠️ Round 22 corrected "nothing on chain can refuse an off-curve
owner at mint": `is_on_curve` panics on BPF, but requiring `mint_vault` to be a
TOP-LEVEL instruction (the stack-height check `retire_redeemed` already uses)
would force the owner to sign the transaction, which only an on-curve key can.
The cost is that no program could mint a vault by CPI. Not built; an owner
decision, and only possible before the lock. The alarm reports any vault owned off-curve as
`unredeemable_owner` at CRITICAL; a marketplace escrow can look the same and is
recoverable. **BUYER-FACING.**

**44. Undeclared airdrops are DESTROYED on redemption; a nested vault is not (round 36 L2: it is rescued, item 58).** The
three reserve assets are checked on chain every time; anything else a vault's PDA
holds and the burn is not shown dies with the asset (9.5/9.6, 9.9). ⚠️ Round 25
(D7): narrower than that for CLASSIC SPL tokens. The sweep helper moves any
classic token account the vault PDA owns, of any mint, ATA or not, when the page
names it with a destination account of the same mint owned by the destination
wallet (`programs/cbob-vault-sweep/src/lib.rs`, the pair checks), and closes it.
So `judgeRedemptionCoverage`'s list of stray classic token accounts can be a
SWEEP LIST rather than only a warning (the redeemer's destination account for
each mint must exist first, item 42). Not covered: Token-2022 accounts (the
helper reads only 165-byte classic accounts), a frozen stray account holding a
balance (its transfer reverts the redemption; a frozen one holding zero is only
closed, measured round 30), an account whose CLOSE authority someone else kept
(round 35 C5: the helper always closes what it sweeps, and that close reverts the
whole call, R36.C5; the redeem page moves such a balance with a plain token
transfer through Core Execute instead and leaves the empty account undeclared),
and nested Core assets. In v5 the
Bank refused such a redemption; in v6 only the redeem page's
`judgeRedemptionCoverage` can warn before the owner signs, and that page is built
but staged, not published (item 50). Post-hoc, the alarm reports undeclared token accounts daily
(`--reconcile`) and nested vaults every pass. *Who:* the holder, to their own
property (a nested vault itself is no longer lost: item 58). **BUYER-FACING** (the holder guide tells holders to send only the three
reserve assets).

**45. If every vault is redeemed, governance cannot act until a new vault
exists** (a proposer must show a live vault, and nothing else can create a
proposal). Red-team 2 finding 7, accepted: with no vaults there is nothing left
to govern but sales, and immutable programs with no admin cannot be rescued.
⚠️ Round 24 (D3) corrected "can never act again": `mint_vault` needs no live
vault (MINT lib.rs 1092-1098), so a round still open, under its cap, with sales
not stopped and the lifetime supply not reached can mint one, and its holder can
then propose. Once all 2,100 have been minted (`minted_total` counts redeemed
vaults too), or with no open round, it is as stated.

**46. The Giraffish Moments collection's update authority is a HOT wallet, kept by
ruling, and through the 7-day charter window it can END THE PROJECT BEFORE IT
STARTS or CAPTURE ALL OF GOVERNANCE.** A Proof of
Burn is one of 240 assets in that shared collection, and its update authority is
the Gary Club inventory hot wallet (Gary, RT2-1: "we keep it and it will stay
secure"). Whoever holds it can add an external plugin that Core consults on every
burn. Mitigations that shipped: `claim_charter_vault` passes up to 8 extra
accounts through to Core's burn of the Proof of Burn (never as signers), so a
benign or approving hook cannot brick the claim at the program level (tested
against a real Core Oracle plugin; the claim page does not use it: it sends no
pass-through accounts and refuses a Proof of Burn or collection carrying an
external plugin, `web/src/pages/claim.mjs`, so a hook added during the window
stops page claims until the page is rebuilt to pass its accounts), and the alarm pages on ANY plugin or update-authority change on
that collection. Round 23: Core refuses a PermanentBurnDelegate or
PermanentTransferDelegate added after creation (each validates its own add) and
refuses owner-managed plugins on a collection, and the LIVE Moments collection
was read 2026-10-04 to carry only its royalties plugin. Moving a Proof of Burn
out of the collection is the same brick class as a rejecting hook. Packet: in the
widest claim shape (separate payer, two compute-budget instructions, a depth-8
proof) at most FOUR distinct extra accounts fit a legacy transaction (measured
offline: 4 = 1,213 bytes, 5 = 1,246); keeping eight in legacy requires omitting
the separate payer and compute-budget instructions. v0 with a lookup table is
another client option; these legacy measurements do not establish a v1 limit.
⚠️ Round 22: the alarm watches the COLLECTION account, not each
of the 240 assets, so a plugin added to an individual Proof of Burn is not paged.
The hot update-authority wallet can add update-authority plugins or external
adapters; owners can also add owner-managed plugins, including a freeze
delegate that can block the burn while frozen. These per-asset changes share
the same alarm blind spot.
⚠️ Round 25 (D8), two bounds this item omitted. (a) THE ALARM SAMPLES STATE: it
compares the collection's plugins and update authority once a pass (every 30
minutes), so a hook added and removed again between two passes leaves no diff
and is never paged. (b) THE POSITIVE BOUND: that key cannot transfer or burn an
individual Proof of Burn. Core's asset approves a transfer or burn only for its
owner and the collection abstains (`state/asset.rs` 271-296,
`state/collection.rs` 240-258; the owner-managed delegates need the owner), and
it refuses a PermanentTransferDelegate or
PermanentBurnDelegate added after creation (each rejects its own add, Core
`e72d63e` `plugins/internal/permanent/permanent_*_delegate.rs`), so what the key
can do is gate or brick claims, as below, never take a Proof of Burn.
⚠️ **What remains, stated in full (round 24, A2; Gary 2026-10-05: "Keep it hot,
document it", reaffirming RT2-1).** The charter claim is the ONLY way a vault can
exist without a vote: `create_proposal` needs a live vault owned by the proposer
(GOV), and `mint_vault` needs a round (`round_id > 0`, `NoRound`), which only a
GOV proposal can set. So during the 7-day charter window whoever holds that key
can: (1) **END THE PROJECT BEFORE IT STARTS**: add a plugin that REJECTS every
charter claim and hold it through the window. No vault would exist, so no
proposal and no sale round could ever happen, and the window can never reopen.
(2) **CAPTURE GOVERNANCE**: add a plugin that admits only Proofs of Burn they
hold (on the collection, on individual assets, which the alarm does not watch, or
by flipping the oracle between transactions). Their vaults would then be the
whole electorate, and half of all live vaults would be theirs alone: guardian and
swap-operator changes (and with the operator, royalty SOL), sale rounds and
prices down to the floor, and the $CBOB boost terms. After the window closes
`claim_charter_vault` refuses by clock alone and this exposure ENDS (a captured
electorate, once formed, does not). Gary keeps the key hot by ruling (RT2-1,
reaffirmed 2026-10-05); holding it cold or in a multisig through the window
would close it. *Who:* every charter member, and the whole project.
**BUYER-FACING** (in the holder guide's honest list since round 24).

**47. A stolen guardian key can hold sales and the sweep shut for a vote plus a
week at best, and FOR GOOD while fewer than half of all live vaults vote to
replace it.** The guardian can only stop, so a thief can stop sales
and the sweep, and stop them again after every restart vote, and cancel any
swap operator a vote arms. It cannot touch a vault, a payout or a rule. The cure
is a vote that replaces the guardian: YES from half of ALL live vaults (live when
the proposal was created; vaults minted during the vote can neither vote nor
raise the bar, round 25 D1), never bundled with a swap-operator change, landing only after 7 days' notice, which the
guardian in office cannot cancel. *Why not fixed:* that delay is what stops a
captured vote removing the brake in one breath (red-team 2 finding 2). A guardian
of `None` is legal, so the holders can also retire the brake by the same rule.
⚠️ Round 24 (A4): "a vote plus a week" assumes the replacement PASSES. It needs
YES from ⌈50% of ALL live vaults⌉ at creation (GOV `execute_proposal`,
`KeyChangeNeedsHalf`), not of votes cast, so at turnout below that the thief
keeps the key and re-stops after every restart: the stop is then PERMANENT. No
funds are lost; redemption, activation, distribution and claims are never
affected by either stop. Operational note: the guardian wallet is also
`INIT_AUTHORITY`, which signs only the one-time `initialize`.

**48. The charter claim cannot be stopped.** By ruling ("no pause during that
round") `claim_charter_vault` does not read the sales stop, so a bug in the
charter path runs for the whole 7-day window. *Why not fixed:* a stop there could
cost a charter member their claim for good, because the window can never reopen.

**49. A vault's record rent is not refunded.** Each vault's `VaultRecord` (221
bytes, 1,772,920 lamports on mainnet as measured 2026-10-06, 2,429,040 on the
test validator, paid by the minter) is never closed, by design (see
"The community pool"). DESIGN-v6 once promised a refund; red-team 2 finding 7
caught it and the design was corrected rather than the code.

**59. WHOEVER SEES A MINT, CLAIM OR COLLECTION CREATE IN FLIGHT CAN MAKE THAT ONE
ATTEMPT FAIL** (round 42, C12, measured). Core's `CreateV2` and
`CreateCollectionV2` create the new account with System `create_account`, which
refuses an address that already holds lamports. So a party that learns a new
vault's or the collection's address before the transaction lands (the slot
leader, or an RPC upstream; Solana has no public mempool) can fund that address
first, and the attempt fails whole. Suite R42.C12a (`mint_vault`), R42.C12b
(`claim_charter_vault`: the Proof of Burn is NOT burned) and R42.C12c (the
collection), each pinned to the System program's `0x0` (already in use);
R42.C12d shows a fresh address then lands. *Nothing is lost* but the
transaction fee: no payment, no Proof of Burn and no vault moves.

*Why not fixed in the programs:* the refusal is inside Core's create, and MINT
could only work around it by draining the address before the CPI. That is a
program change at the frozen release, for a grief that needs a privileged
position, costs the griefer more than the victim (at least mainnet's 650,240-lamport rent
floor for a 0-byte account per attempt, 890,880 on the test validator, R41.C8, left at an address they cannot spend from), and is defeated by retrying at a fresh address. *What the pages do:*
before every attempt, `checkNewAddress` (`web/src/lib/reads.mjs`) reads the new
address. If it is empty, the same key is reused, so a retry after an unknown
outcome can never buy twice. If Core already owns it, the earlier attempt
landed and is not repeated. Anything else means someone funded it, and a fresh
address is used with a note saying so. That covers the buy page, the claim
page and the ceremony's step 0. The ceremony adopts a remembered collection
only if Core owns it, so a funded address can never become the collection.
*Limit, stated:* a party in that position could repeat the grief on every
attempt during the 7-day charter window. Each repeat costs them lamports, and
each retry costs the holder a fee.

**58. A NESTED OR ORPHANED VAULT CAN BE EXTRACTED, BY ANYONE, TO ONE PLACE**
(round 35; Gary 2026-10-07: *"we can't extract the orphan?"*, then chose the
CBOBTC Squads as the destination, accepted the marketplace flag, and, after the
review below, sent EVERY rescue there). Every vault is born with a third
permanent plugin, `PermanentTransferDelegate`, whose authority is MINT's
`["rescue"]` PDA, a seed no other signing path uses. The only instruction that
signs with it is the permissionless `rescue_nested(vault, host, new_owner)`. It
moves the vault only when its owner IS the Core asset-signer PDA of `host` and
`host` is the vault itself, a POSITIVELY burned asset, or a LIVE vault of this
collection, and only to `bank_treasury`, the CBOBTC Squads, which returns it to
whoever sent it in (the transfer is in the vault's own history) with an
ordinary transfer. Review 35 (M1): sending it to a live host's OWNER would hand
a vault sent to the wrong deposit address to the stranger who owns that
address. That ruling governs where the RESCUE sends a vault. It does not stop
the host's owner reaching the vault during their own opening, which review 35
already named ("open, Execute, burn") and round 43 measured (R43.V1, V43-1): a
host owner who opens first keeps it, and the rescue is then refused
`NotNested`. So the crank sends `rescue_nested` itself on every full pass for
every nested vault `detectNestedVaults` names whose host is the vault itself, a
burned asset or a live vault (round 43; `planRescues`, selftest R43 V43-1), and
the holder guide tells a sender to run it at once. RULED, Gary 2026-10-08
(Linq, on round 43 V43-1): *"if they are stupid and send it that's their
fault."* No program change: a vault sent into another live vault's deposit
address and taken by that host's owner during their own opening is the
sender's loss, disclosed in the holder guide, and V43-1 stays LOW, outside the
launch gate's (a)-(d). A foreign live asset as host is refused (`HostUnresolved`): its owner
can execute its own wallet, and it may be an escrow or a bundle the rescue must
not break; so is a host that never existed (its keypair's holder can still
create it) and a non-nested vault (`NotNested`). Nothing else changes: level,
seal, weight and record stay as they are, and payouts keep accruing in the
vault's own wallet, so whoever receives it receives all of it and no other
vault is diluted. This replaces round 29 D2's "orphaned forever". *Costs:*
about 43 bytes of rent per vault, and some wallets and marketplaces flag any
NFT carrying a permanent transfer delegate (disclosed in the holder guide).
*Limits, stated:* the crank sends the rescue every full pass (hourly) and anyone
may send it sooner, so a vault can still be taken out by its live host's owner
in the window before either lands; the return is a person's act from the Squads, paged by
`vault_rescued_to_squads` once and `vault_awaiting_return` every pass until it
leaves; the Squads can redeem nothing (limit 43: a redemption needs the owner as
a top-level signer) but COULD vote with a vault it holds, which is a custody
rule, not a program one: it does not; a vault nested inside a foreign asset that
itself cannot execute (sitting in its own wallet, or a collection or group
account) stays stuck, as before. Suite R35.N1-N9, R35.N2a (the return),
R35.N8a; detectors name the rescue in `nested_vault` and `vault_owns_itself`.

**57. A vault's name, picture and extra attributes are the MINTER's, and permanent**
(round 34 L1). `create_vault` checks only their lengths (name 64, URI 200
bytes), no program ever calls Core's update, and the collection's update
authority is MINT's PDA, so they can never be changed; the URI's JSON (the
picture) can even be changed off chain by whoever hosts it. The reserved
attribute keys (`level`, `charter`, `redemption`) are refused only in exact
case, so a minter can add a lookalike such as `Level: V`. None of this moves
value: each vault is its own wallet attached to its NFT, every money decision
reads the vault's on-chain `VaultRecord` (and the program's own lowercase
`level` attribute), and the minter still cannot choose the level (item 26). *Who:*
a buyer on a marketplace who trusts a vault's name, picture or a lookalike
trait. *Why not fixed:* building the name and pinning the URI and
case-insensitive keys would be program changes before the lock; the ruling is to
disclose it. **BUYER-FACING** (holder guide, honest list).

**55. A vault that joins can share revenue that was still UNSPLIT when it asked**
(round 22, F1; ACCEPTED by Gary 2026-10-04). cbBTC in the revenue address that
has not yet been split into the pool is not part of the distribution that makes
a waiting vault eligible, so one transaction that joins it, splits and
distributes lets it share that balance. It costs 200 $GARY (two burn-path
distributions), or ⚠️ (round 24, D1) as little as 100 $GARY at the monthly
boundary, where the first of the two can be the free `distribute(false)` (MINT
lib.rs 1646-1651) or a host's in-line monthly run; plus a funded, revealed vault.
The crank splits every pass, so
the balance at stake is about an hour of sales WHILE THE CRANK RUNS (round 23:
nothing bounds it on chain, so during a crank stall it grows for the same
$GARY; `revenue_unsplit` pages). Closing it would mean splitting
inside every activation and distribution on chain: more code under the lock for
a bounded, costly edge. Written into the holder guide's honest list.

**56. THE WHOLE $CBOB SUPPLY SITS ON A HOT KEY ON THIS BOX** (round 23, L17;
custody RULED by Gary 2026-10-04: "A new dedicated release wallet"). All
2,100,000,000 $CBOB were minted into the release wallet `AT2qf412…`, whose secret
is `bank/keys/cbob-release.json` (mode 600, in the nightly R2 backup), generated
on this box by `launch/create-cbob-token.mjs`. *Costs:* anyone who reads that
file, on the box or from a backup, can move every $CBOB not yet released: sell
it, or burn it to boost vaults they own, each by up to +12 weight (more than any
level's 2 to 6) for up to 24 distributions, the ruled ceilings, at whatever terms
a vote has switched on. The mint itself is safe (no mint and
no freeze authority, so nobody can print more or freeze anyone). *Who:* every
$CBOB holder, through the price, and every vault holder, through boost-weighted
payouts. *Why not fixed:* the ruling keeps the supply in a dedicated release wallet
the Bank releases from. The custody is recorded and pinned
(`launch/mainnet-init.json` `cbob_release_wallet`, refused by
`scripts/check-launch-params.mjs` if it changes); moving it to Gary's own wallet
or a Squads, and deleting the box key, would close it and is Gary's call.
**BUYER-FACING** (in the holder guide's honest list since round 25, D5).

### OPEN AND BLOCKING — not accepted, must be done before anything mints

These are the ones nobody may write "accepted" against. Limit 17 lived here for
five rounds and left by being measured, which is the only exit.

**22. (v6 restated) NO DISTRIBUTION HAS RUN AGAINST A LIVE CHAIN AT SCALE.** v6
moved payment on chain (`distribute` + batched `claim`), and the job that sends
those instructions is now `bank/crank.mjs` (installed DRY-RUN), not v5's
`distribute.mjs`. The programs' arithmetic is proven in the suite and the Test
Vault simulation, both on a local validator. **The mainnet dress rehearsal (road
step 8, 2026-10-09 to 10-10, `audits/rehearsal-2026-10-09/RECORD.md`) ran the
crank's live passes on mainnet at FIVE vaults (round 45, V45-8: the ruled size),
recorded "PASS at 5 vaults (scale not exercised)".** What stays open is the crank's
I/O against ~2,100 vaults: cost, rate limits, paging, a transient RPC error on
vault 1,900 of 2,100, and the every-minute reveal lane keeping up.
⚠️ Round 25 (L5): NOR HAS THE REVENUE CYCLE, BY ANY GATE. `bank/revenue.mjs`'s
sweep, re-price, venue loop, return, split, ledger writes and recovery run in no
suite, sim or fork (`scripts/run-tests.sh` never invokes it, and its selftest arms
read its source), and this item used to scope the rehearsal to the crank and the
alarm. The dress rehearsal (road step 8) therefore passes or fails on these NAMED
items, each recorded with its transaction signatures:
  1. the crank's live passes against the rehearsal deployment, as above;
  2. the alarm's live passes in rehearsal mode (item 53);
  3. **ONE FULL LIVE REVENUE CYCLE THROUGH EACH POOL**: sweep, swap, return,
     split, the ledger row closed and `--audit` clean, once through Orca and once
     with Orca forced to refuse (a floor above its price) so the Meteora fallback
     really runs;
  4. **ONE FORCED POST-SWEEP FAILURE, WALKED THROUGH THE HAND RECOVERY**: a cycle
     whose sweep lands and whose swap then fails, the alarm's CRITICAL for a sweep
     with no matching return raised, the next run refused at the open-cycle guard,
     the cycle recovered by hand as limit 10's runbook says, and `--audit` clean
     again;
  5. (carried, A17) one DAS read of a collection holding a burned Core asset,
     settling whether DAS sets `burnt` on it.

**Recorded on mainnet (round 47, V47o-3):** 22.1 PASS at 5 vaults (scale not
exercised); 22.3, 22.4 and 22.5 PASS; **22.2 FAIL, a true detection.** The alarm's
live pass 1 passed. Between the passes Metaplex upgraded Core on mainnet (2026-10-09
21:21 UTC), and pass 2 raised exactly that (CRITICAL `config_drift` on
`prog.core.hash`) and the watchdog gap of the deliberate pause, so no pass 2 with
nothing to report was obtained. The driver's verdict stands as written. **RULING,
Gary 2026-10-10: 22.2 is accepted as passed.** The alarm ran live twice on mainnet
in rehearsal mode and caught a real change to a dependency within one pass, which is
its job; a re-run for a quiet pass 2 adds no proof of the programs. Item 22 stays
OPEN AND BLOCKING only for the ~2,100-vault scale above.

**38. EVERY `initialize` VALUE IS WRITTEN ONCE AND CAN NEVER BE CORRECTED.** With
no admin and immutable programs, a wrong launch value is permanent. Each must be
the ruled one before deploy: `max_supply` 2,100; `level_caps` 945/525/315/210/105;
`monthly_secs` 2,592,000; `notice_secs` 604,800; `redeem_window_secs` 3,600;
`min_voting_secs` 259,200; `quorum_bps` 2,100; `threshold_bps` 5,100;
`sweep_floor_lamports` 1 SOL; `cooldown_ceiling_secs` 86,400;
`reserve_ceiling_lamports` 0.1 SOL; the charter window (7 days; the dates are not
yet set); `bank_treasury` the CBOBTC Squads; `payment_mint` cbBTC; the three
reserve mints; `pob_root` from `scripts/pob-set.json`; the guardian; the swap
operator; the sweep cap, cooldown and SOL reserve. The alarm reports a wrong
value only AFTER it is written, and only for the values on its production list
(`test_value_in_production`); the guardian, swap operator, sweep cap, cooldown and
SOL reserve are not on that list, so for their exact ruled values the
pre-signing check below is the only gate; after writing, the alarm judges only
bounds on two of them (`sweep_cooldown_too_short`, `sweep_bound_ineffective`) and
pages a later CHANGE to each of the five as `config_drift` (round 31). So the
values now live in
ONE file, `launch/mainnet-init.json`, each marked RULED, PROPOSED or OPEN with its
source, and `scripts/check-launch-params.mjs` refuses it BEFORE anything is signed
unless nothing is OPEN, every ruled value equals the alarm's production list (the
same list, imported), every bound each `initialize` enforces is met, the swap bot's
values sit in the alarm's working band, and the Proof of Burn root recomputes from
`scripts/pob-set.json` (its selftest, 69 launch assertions behind a floor in
`run-tests.sh`, proves each kind of refusal). Still OPEN: the charter opening date
(Gary), the lock deadline that follows from it, and `vault_collection`, which
only exists once road step 10 creates it (round 35). Everything else is RULED,
including the swap bot's values, the swap operator key (generated 2026-10-04)
and the $CBOB mint (created on mainnet 2026-10-04). ⚠️ Round 24 (A6): the checker
validates the JSON, not the signed transaction, so whoever builds the four
`initialize` transactions must build them FROM that file, and the programs
themselves check less than the checker does (SEAL reads only owners; off-curve
keys are accepted; `redeem_window_secs` may be anything from 10 s to 24 h).

**50. THE SURFACES PROMISED TO HOLDERS (round 35: BUILT AND STAGED in `web/`, NOT YET PUBLISHED; before that, NOT BUILT).** The holder guide says the
Bank's pages show each vault's deposit address (its asset-signer PDA, not the
NFT's own address; round 25 D9 added this surface to the list), that the redeem
page checks a vault for anything that would be destroyed and warns before the
holder signs, offers to trigger (and join) a payout first, and empties the vault
at the moment the opening runs so a stranger's deposit cannot block it; and that
every opening is announced on X and the CBOB website. None of the pages is
PUBLISHED: the deposit-address page (`/vault/`) and the redeem page, which runs
`judgeRedemptionCoverage` and calls the sweep helper, are built in `web/` and
staged (round 35, below), and `bank/redemption-poster.mjs` drafts posts and has no sender (an
automated new post on @cbobtc needs Gary's go-ahead and the website surface is not
chosen). The sweep helper `programs/cbob-vault-sweep` the page needs is BUILT
(round 24, A3; round 25 D2 corrected "being built"): byte-identical in `dist/`,
`target/deploy/` and the localnet build's release output
(`.cache/ln/sbpfv3-solana-solana/release/`, sha256 `9e21cc9c…`, the file
`scripts/build-mainnet.sh` compares), and watched by the alarm
(`prog.sweep.upgrade_authority`, `prog.sweep.hash`); only the staged redeem page
calls it. v6 removed the only other pre-signature check (the Bank), so until the
page is published items 9 and 44 have no preventive control in production. Round 35 (Gary, 2026-10-07): the pages are BUILT in `web/`
(outside `programs/`, `bank/` and `scripts/`), staged, not published:
`/vault/` (lookup, deposit address, contents, activation, rescue),
`/redeem/`, the charter `/claim/` and sale `/buy/` pages (never listed here
before, and without them nobody can get a vault), and the unlisted launch
ceremony that walks step 10 with Gary's wallet. Each vault's metadata link is
`https://centralbankofbitcoin.com/v/<asset>.json`, served from chain state by a
generator job (the ratified level art once drawn), and the pages reach the chain
through a same-origin `/rpc` proxy that keeps the provider key on the server
(both decided by Gary 2026-10-07, both staged, not enabled). OPEN AND BLOCKING because the
holder guide promises it; it is also a precondition of road step 11. **The holder
guide (marked DRAFT) may not be published before this item ships** (round 25 L1:
it speaks of these surfaces in the present tense).

**What a redemption client (the redeem page first) must do**, written here because
nothing on chain makes it:
  * **Prior transaction:** create the owner's destination accounts (item 42) and
    any of the vault's three reserve accounts that does not exist yet, so the
    sweep can name all three.
  * **`claim` before the sweep, EXCEPT while the pool is frozen** (round 24, D4):
    a claim that pays reverts the whole transaction at the frozen pool, so the
    redemption sends no `claim` and `retire_redeemed` forfeits the undelivered
    share (item 28; suite 3c.F2).
  * **Sweep through the helper** (round 24, A3; "Known limits", the round 23 F1
    entry): one Core `ExecuteV1` into `programs/cbob-vault-sweep`, naming every
    reserve account, so the sweep moves LIVE balances and the vault wallet's
    lamports. A client that sweeps pre-read amounts can be delayed indefinitely
    by a griefer who keeps paying fees.
  * **Mind the legacy packet** (round 25 D9). Measured, Test Vault S8.0: claim + open +
    the helper sweeping all three reserves + burn is **1,061 bytes** with the
    owner as fee payer. Both compute-budget instructions add 52 bytes and a
    separate fee payer adds 96 (32 for the key, 64 for its signature), so the
    widest page shape is about 1,209 of the 1,232: it fits, with 23 bytes to
    spare. S8.1a measured **168,343 CU** for this four-instruction redemption
    (2026-10-05), below its legacy default combined budget of 800,000 CU. This is the
    measured shape, not an upper bound for arbitrary extra token pairs. A
    redemption carries no crank.
  * **A lamports-only sweep needs a destination that exists** (round 25 D9). With
    no token pairs, the helper's only credit is a System transfer of the vault
    wallet's lamports, and a credit below rent exemption to an account that does
    not exist yet is refused (measured, R41.C8a-c: a 1-lamport credit to a fresh
    address and a credit of the rent floor minus one to an emptied vault wallet
    are refused; the floor itself lands, so a vault wallet never holds a sub-rent
    balance). The canonical destination is the owner, who pays the
    fee and so exists; a page that names any other destination must check it.
  * **Offer to rescue stray CLASSIC tokens** (round 25 D7, item 44): the helper
    sweeps any classic SPL account the vault PDA owns, except one whose close
    authority someone else kept (R36.C5), when the page names it with
    a same-mint destination account owned by the redeemer, so the coverage check's
    stray classic token accounts can be swept rather than destroyed (the
    destination accounts are created in the prior transaction, item 42; mind the
    packet above, since each pair costs bytes). Round 36: a C5 account's balance
    moves by a plain transfer through Core Execute instead, and the page never
    delivers a stray whose mint has a freeze authority (unless it is a reserve
    mint), whose receiving account is frozen, or whose mint it cannot read (H1): it names
    it and asks the holder to tick it as lost, so no stranger can block an opening
    (round 37 V1: not by volume either; see the C5 limit). Round 38 (V38-2): per-item boxes cover only what is there at the
  check. Anything that arrives after it is covered by ONE standing consent the
  holder ticks before signing (its id carries no address, count or digest). At
  the press it is never delivered and asks for no new box, and the press makes
  at most two dry runs (`prepareOpening`).
  * **Close every reserve account it empties** (round 24, D8; the helper does):
    `burn_vault` checks `amount == 0`, not closure, and nothing can sign for the
    PDA after the burn, so an unclosed account strands about 1,488,440 lamports of
    rent per account on mainnet, the redeemer's own loss.
  * **Set the compute-unit limit** on any transaction that carries a crank, or
    send no crank (item 54); the claim page sends no crank when `pob_extra > 0`
    (item 37).
  * **Run `judgeRedemptionCoverage` before the holder signs** and warn on anything
    the burn would destroy (items 9 and 44).
  * **Deploy, verify and lock the helper with the four programs** (road steps 9
    and 11): it is permanent once the upgrade authority is removed, like them.

**Reader coverage boundary (rounds 28-29).** Monitoring reads legacy/v0/v1
parsed history. Missing required metadata is unknown coverage: the reader
refuses it and scanners keep their cursors; since round 32 (L2) the alarm reports
such a transaction, and a signature listing that throws, as `tx_unreadable` and
finishes the transaction scan, so the findings it already holds are still
delivered. Holding the cursor assumes the fault is transient (round 43,
V43o-2): one signature that stays unreadable (an RPC that always answers it
malformed, or a transaction version this reader does not know) froze that
program's cursor and any backlog for good, so every newer transaction went
unread. Now a signature unreadable on `UNREADABLE_SKIP_PASSES` (3) consecutive
passes is skipped: the walk moves past it, it is kept in the alarm state's
`unreadSkips`, and `tx_skipped_unreadable` (HIGH, a level condition) stands on
every pass until a person has read each kept signature by hand (another RPC, an
explorer) and written the last one to `bank/unreadable-reviewed`
(`detectUnreadSkips`, the same keeping rule as `logGaps` below: an unreviewed
entry is never dropped). Its instructions, token movements and event lines are
NOT examined by the alarm until then; the account-state detectors are
unaffected. The poster does the same: two runs stop with the cursor held, and
the third queues the signature REJECTED for a hand read and moves on. Its counts
are kept per signature (round 44, V44o-1), so this holds while a backlog drains
or a walk gaps too, when each run re-walks the same window and reads older
signatures first. The revenue job's split-recovery scan (round 44, V44o-2)
collects a read the reader refuses and keeps scanning: a readable split beside
it still closes its cycle, and a refused signature never does; a returned cycle
left open after such a scan fails the `recovery` stage naming the signature for
a hand read (limit 10). RPC failures in the account reads BEFORE the scan (configs, vault
set, balances) still end the pass as `run_failed`, which pages and is retried.
The runtime's standalone `Log truncated` marker is different, because ANYONE can
cause it for one fee: an ordinary transaction that merely names one of our
programs (or the revenue account) as an unused account, padded with enough
instructions, is listed by the scanners' signature walks with its logs
truncated (round 29 M1, measured). Refusing the whole pass on it let one
stranger halt every alarm pass, the redemption poster and revenue recovery,
repeatably. So the reader still refuses it by default, and each walking scanner
instead opts in to receive it flagged, with every other field validated: the
alarm records that signature in its state's `logGaps` and pages a
`log_coverage_gap` (HIGH), does not read its event lines, still runs every
instruction- and token-movement detector on it, and moves its cursor past it
(round 30 L1: only when one of our five programs actually RAN in that
transaction, top level or inner; a stranger's padded transaction that merely
names one cannot have lost a CBOB line and is recorded at INFO, unpaged; round
31 L1: because any no-op call to a permissionless instruction makes "ours ran"
true, the gap is a LEVEL condition only a person clears: one finding with
signature-free text stands on every pass while any kept gap is newer than the
reviewed-through watermark a human writes to `bank/log-gaps-reviewed` after
inspecting them (`detectLogGaps`), so a stranger's extra gaps send no new email
and the router's recovery window cannot swallow a real one; the cost is that a
second, genuine gap while the stream is already open adds to `logGaps` without a
new email, and is seen when the open gaps are reviewed, because an unreviewed
gap is never dropped from `logGaps` (round 32 L3), and more than 2,000 unreviewed
escalate the page to CRITICAL; the list therefore grows by at most 8,000 entries
a pass, at a stranger's cost of one fee each, until a person writes the
watermark);
the revenue scan reads its outflow, which comes from instructions and inner
instructions, not logs; the poster never drafts from its logs and queues a
REJECTED hand-draft entry when it called BURN at the top level. The gap is
real: CBOB event lines in such a transaction (a reschedule, a frozen-claim
deferral, a REDEEMED line) can be lost, which is why each one is paged for a
human to inspect, and a permanently truncated result cannot be repaired by
fetching it again. The cursor advance is only ever past a recorded gap, and the
alarm keeps every cursor when the page is not delivered.

**Scan backlog boundary (rounds 30-31).** One pass reads at most 2,000
transactions per program (`PER_PROGRAM_READS`, round 31 L2; the walk itself
pages at most 20 of 1,000 signatures), newest first. More than that after the cursor (about 0.1
SOL of stranger transactions naming the program, or a genuine burst) used to gap
EVERY later pass forever, because each pass re-read only the newest window and
the transactions just after the cursor were never examined. Now a gap persists
how far the pass got (`backlogs[program] = { head, before }` in the alarm's
state, `st.backlog` in the poster) and the next pass resumes from there, so any
backlog drains (the alarm at 2,000 transactions per program per pass, the
poster at up to 20,000 per run; a signature that stays unreadable delays the
drain by at most three passes, then is skipped on the record, round 43 V43o-2;
its count survives a pass that a flood keeps from reaching it, round 45 V45o-4) and the cursor moves to the
backlog's head once a pass reaches the old cursor; a cleared cursor drains the
same way. The bound that remains: while a backlog drains, transactions newer
than its head are examined only afterwards, and every such pass pages
`scan_gap` HIGH. A sustained flood therefore delays detection by roughly its
size divided by 2,000 passes on THAT program only (about 0.01 SOL per pass of
delay: 5,000 lamports a transaction; the alarm runs every 30 minutes). One pass
reads at most 8,000 transactions in all before it reports, so even a flood on
all four programs at once (about 0.04 SOL a pass) delays the pass's report, the
account-state findings included, by roughly 16 to 52 minutes at the per-read
rates measured in round 31, against 40 to 130 minutes for a single program
before round 31. The hand-run poster still walks up to 20 pages (20,000) per
run, with the same resumable backlog. A transaction naming several of our programs is fetched
once per program. A
backlog is declared drained only on positive proof: a resumed walk that comes
back EMPTY (which is also how the RPC answers a resume point it no longer knows)
must be followed by the cursor itself as the very next signature, or, with no
cursor, by a resolvable resume point with nothing below it; otherwise the
backlog is kept and `scan_backlog_unproven` pages CRITICAL every pass, because a
resume point that has fallen out of the cluster's history needs that window
re-scanned by hand. The poster applies the same proof.

**Transaction-format boundary (validation, 2026-10-06).** The packet sizes and
default-budget figures above certify the stated legacy shapes; S9b separately
exercises v0. Current transaction builders use legacy/v0. Solana v1 is active,
allows 4,096 bytes and 64 inline accounts, and requires explicit compute-unit and
loaded-account-data limits in its message configuration. ComputeBudget
instructions do not configure v1. A future v1 client must set those fields and
measure its own execution; none of these tests certifies a CBOB v1 transaction.
Larger packets do not change the protocol's reserve, attribute or per-instruction
crank bounds. See the [official format comparison](https://solana.com/docs/core/transactions/versioned-transactions).

**Wallet wrapping on the holder pages (round 47, measured 2026-10-09).** Phantom wraps a
transaction as [compute budget 200,000 + price, Lighthouse checks, the page's instructions,
a Lighthouse check on the payer]. On a local chain with the pinned mainnet Lighthouse
program, every holder transaction wrapped that way is ACCEPTED by the programs, the
claim-first crack included (SEAL's and BURN's instruction walks are position-independent),
whenever it fits: claim 1,213 bytes, draw 701, activate 456, rescue 565-597, set-up
708-797, payout 357-458. Two things do not hold. (1) Phantom's 200,000 limit is BELOW a
claim-first crack's need (194,694 CU bare, 207,519 with Lighthouse: refused, "exceeded CUs
meter"), so the pages set their own budget whenever it fits and the judge refuses a wallet
limit below what the page measured. (2) The widest openings (claim-first + strays 1,218
bytes; W5 1,201) fit neither a budget nor Lighthouse in legacy; they go exactly as built
under the default budget. A v0 transaction with a protocol lookup table (23 static keys)
makes room for both (claim-first 1,208 bytes with its own budget, W5 1,160), which is a
client change recorded as an option, not taken. The pages' judge and the e2e's
Phantom-like signer are described in `web/README.md`.

**52. THE POOL'S AND THE SQUADS' cbBTC ACCOUNTS MUST EXIST BEFORE THE FIRST
SPLIT, AND THE REVENUE ADDRESS MUST HOLD RENT** (round 22, S5 and F26). The CBOBTC
Squads address `bc92Z…` was verified on mainnet 2026-10-03 to be a Squads VAULT
(off-curve, no account of its own) whose cbBTC ATA already exists. The revenue
address starts at 0 lamports, so a first royalty smaller than rent exemption
would fail: fund it above rent at launch. `initialize` only DERIVES the pool address; nothing creates
the token account, and `split_revenue` needs both it and the CBOBTC Squads' cbBTC
ATA. Until both exist every split fails (loud: `pool_unreadable`,
`revenue_unsplit`). ⚠️ Round 24 (D8): an explicit `distribute` reads the pool
account BEFORE anything else, so until the pool's cbBTC account exists every
`distribute` refuses, EVEN THE FREE LAUNCH TICK that credits nothing and only
advances the epoch so waiting vaults can join, and with it the crank's own
monthly call. The in-line monthly run in a host instruction degrades gracefully
instead (it performs the launch tick without reading the pool, and treats a pool
that is not yet a token account as holding nothing). Road step 10 creates both, idempotently, right after
`initialize`. Round 23: the revenue address's OWN cbBTC account must exist too
before the first paid `mint_vault`, which pays into it; road step 10 creates it
with the other two.

**53. A DRESS REHEARSAL AT THROWAWAY PROGRAM IDS CANNOT RUN THE SHIPPED OFF-CHAIN
CODE UNCHANGED** (round 22, from a disqualified report, verified): the program
ids are constants in `bank/layout.mjs`, `bank/revenue.mjs` and
`bank/detectors.mjs` (and in `bank/alarm.mjs`, `bank/selftest.mjs`, the four
programs' cross-references, the tests and the sim). **ADDRESSED by a recorded patch,
not by changing the audited code:** `scripts/rehearsal-tree.sh` makes a detached
worktree of HEAD outside the repo, generates five throwaway program keypairs, and
applies exactly six substitutions (the five program ids, the sweep helper's
included, and the repo root path, so the rehearsal's keys, locks and caches never
touch production's; round 25 D6 corrected "five ... the four ids"). It then PROVES the
patch is only that: reversing the map recreates every file of HEAD byte for byte,
git's own diff names the same files, and the four keyed programs plus
`bank/layout.mjs` were patched (the native sweep helper carries no id in its
source; its address lives in `bank/layout.mjs` and the alarm, which are patched,
and its keypair is replaced). No derived address (config, pool, mint authority PDA) is hard-coded
anywhere in the code, measured 2026-10-04 by deriving our PDAs under every seed we
use and checking every off-curve literal, so the ids are the whole patch. It writes
`REHEARSAL-RECORD.txt` (commit, map, patch sha256). It never builds or sends.
The shipped cron installer refuses any tree with this rehearsal marker before
touching the host's production jobs or logrotate configuration. Run the rehearsal
commands explicitly; do not install them into the production cron schedule. **Proven
2026-10-04 at `d57ee3a`: the FULL `scripts/run-tests.sh` passes inside the
rehearsal tree at throwaway ids** (every gate of that commit, on-chain and off). Its first run caught the one thing a byte-exact reverse
cannot: a selftest regex written as an ABBREVIATED id, now fixed, and the script
refuses any leftover 4+ char id prefix. Round 24 (D4) called that proof of
`d57ee3a` stale until it was re-run at the release commit. **Round 46 (V46-7): it
was re-run at `e7c192a`** (round 45's VALIDATION: the full certifying runner inside
the recorded rehearsal tree, RC 0, program source equal to `RELEASE_COMMIT` under the
recorded id map, `/tmp/claude-1000/rehearsal-proof-e7c192a.log`), so staleness is no
longer what keeps this item open. **What keeps it OPEN:** every repair commit needs
the same in-tree run again (round 46's and round 47's included); the last in-tree
run is `e7c192a`. The dress rehearsal itself (road step 8, item 22) ran to its end
on mainnet on 2026-10-09 to 10-10 (round 47, V47-8). Round 46 (V46-8,
Gary's option 1, 2026-10-09): the mainnet rehearsal deploys the SHIPPING build to
its throwaway ids, so the init key is Gary's wallet and Gary signs road step 10 on
the rehearsal signing page (`scripts/rehearsal-run.mjs --ceremony page`, the box
only waits and reads each account back); the seed-7 localnet key, which mainnet
will not let pay, is accepted only on a local cluster. A rehearsal tree made earlier
is moved to a new commit IN PLACE by `scripts/rehearsal-refresh.mjs`, which keeps
every throwaway key and state file byte for byte and re-applies the same recorded
map. Round 43 (V43o-1): round 42's release-commit gate (C10)
could never pass in this tree, whose programs carry the throwaway ids. Where
`REHEARSAL-RECORD.txt` stands, the runner's `release_gate` now proves the program
difference from RELEASE_COMMIT is EXACTLY the recorded substitution (map, patch
sha, the four keyed programs patched, the reverse map recreating
RELEASE_COMMIT's bytes) and skips the web offline gate, whose mainnet-id
cross-check cannot pass there by design (measured: `ids.test` 39/41); both stay
mandatory everywhere else (selftest V43o-1).
⚠️ **Round 24 (D5): "the ids are the whole patch" is true of ADDRESSES, not of
VALUES.** The alarm judged every pass as mainnet (`production: true`, with
`pob_root`, the PoB collection, the governance numbers and the lock deadline
pinned), so a rehearsal at throwaway values pages `test_value_in_production` and
`lock_deadline_unset` on EVERY pass, and at the ruled values nothing can mint for
about ten days (the 7-day charter, then a 3-day vote for a round) without burning
a real Proof of Burn. **HOW THE DRESS REHEARSAL MUST RUN THE ALARM:** inside the
rehearsal tree, with `CBOB_ALARM_REHEARSAL=1` exactly (`bank/detectors.mjs`
`alarmProduction`; any other value, or none, is production, so a typo fails
closed). That turns OFF only the production-value checks (`test_value_in_production`
and the lock-deadline checks); every other detector runs unchanged, and every
report and every notice says REHEARSAL. Round 45 (V45-9): the driver
(`scripts/rehearsal-run.mjs`) runs it with `CBOB_REHEARSAL_NOTIFY` pointing every
notice at `.rehearsal-run/notify.sh`, which only appends to
`.rehearsal-run/notices.log`: the alert router is never invoked, so a rehearsal
stream can never mute or close a production one, and nothing reaches Gary. (Run by
hand instead, use `--dry-run`.) The crank and the revenue job need no flag (round 44, V44o-5):
inside a tree carrying `REHEARSAL-RECORD.txt` every notice they send takes its
own `cbob-vault-crank-rehearsal:*` or `cbob-revenue-rehearsal:*` label and says
REHEARSAL (`rehearsalNotice`), so neither can share a production stream. **The
rehearsal swap operator's key** lives where the revenue job reads it, the
rehearsal tree's `bank/keys/swap-operator.json` (600; `revenue.mjs` reads
`/opt/cbob-vaults/bank/keys/swap-operator.json`, which the tree maps to its own
root), and the other throwaway keys in `.rehearsal-keys/`. ⚠️ Refreshing the
rehearsal tree REMOVES the worktree: while any throwaway key holds value, back
up both directories first or do not refresh. **The rehearsal value set (round 43, built):** `launch/rehearsal-init.json`, beside
`launch/mainnet-init.json` with every one of its keys, each marked MAINNET
(deliberately the ruled value), PROPOSED (a rehearsal choice for Gary to approve),
RULED (a rehearsal choice Gary has approved, 2026-10-08), REHEARSAL-OPEN (a key or date made at rehearsal time, never before) or
REHEARSAL-NA. Its periods are short and inside each `initialize` bound (each
source cited in the file): a 30-minute charter, a 10-minute month, 2-minute
notice and votes, a 60-second redeem window, five vaults one per level. The
swap bot sits in the alarm's band (1-hour cooldown, 5 SOL cap) with a 0.001 SOL
reserve, so each revenue cycle can be about 0.1 SOL. Payment and reserve mints
are the real three (item 22.3 swaps through the real pools, and the pages and
alarm pin them); the guardian, treasury, swap operator, PoB set, vault
collection and $CBOB are throwaway and MUST be (a real PoB root would let a
rehearsal claim burn a holder's Proof of Burn). `init_authority` cannot be
throwaway: every program compiles it in and the rehearsal tree swaps program ids
only. RULED, Gary 2026-10-08 ("you sign the transactions"): the rehearsal
deploys the `--features localnet` build, whose only difference is that key, and
the box test key signs. That key's seed is in our source, so every preparation
step (keys, the build, the roles, the PoB set, $CBOB, the filled values) runs
BEFORE the deploys, the ceremony initializes right after the last one, and every
config is read back before any token moves; no later step runs, even by `--step`,
until it has (round 45 V45-6). A read-back that is not ours means close the
programs and redeploy at NEW throwaway ids (a closed loader-v3 program id can never
be reused). **The driver (round 45).** The deploy wallet only FUNDS: a throwaway
`deployer` key in `.rehearsal-keys` pays every deploy and is every rehearsal
program's upgrade authority, so the real programs' upgrade key never signs a
`solana program` command, and before each deploy the program keypair's public key
must equal its recorded throwaway id and must not be a mainnet id (V45-3). Each
deploy writes its own recorded buffer, and only a recorded buffer is ever closed.
On mainnet `--rpc box` is required and the Solana CLI reads the RPC from a 600
config file, so the provider key is in no process's argv (V45-2). A step whose
signature landed while the chain does not show it done STOPS; the resumable steps
(the rescue, the forced failure) re-read the chain and send only what is missing
under `--resume <step>`, and the state file is never edited by hand (V45-4). Launch day's
build still takes Gary's wallet in Phantom. There is no
lock deadline: the rehearsal programs are never made final, so closing them
recovers their rent. `node scripts/check-launch-params.mjs --rehearsal` judges
it (the bounds, the never-mainnet keys, the compiled-in signer, the rehearsal
alarm's band) and lists each REHEARSAL-OPEN key until it is filled; the mainnet
check refuses the file by name (`_rehearsal`), filled or not. Selftest R43
REHEARSAL, 19 arms, each shown red by removing its guard.

---

### DISCHARGED: measured closed, or gone with the thing it was about

*Moved here from OPEN AND BLOCKING in round 24 (D4): decided and built, so it
blocks nothing. Its one accepted residue, boost timing, stays disclosed below.*

**51. LEVEL-UPS BY BURNING $CBOB: DECIDED AND BUILT AS THE $CBOB BOOST
(2026-10-04).** Gary: build it before the lock; a TEMPORARY boost, not a level
change; outside the caps; terms by a Governor vote, off at launch; the $CBOB mint
created first. Built in MINT (`boost_vault`, `expire_boosts`, `set_boost_terms`,
the carry, the `BoostsExpireFirst` gate) and GOV (`SetBoostTerms`, ordered like a
round, bounds checked at creation). Owner-only since round 23 (Gary: "no gifted
boosts"; `BoostNotTheOwner`, suite BO.6). See DESIGN-v6 section 3. Measured by suite
section BO and init arms 0.1o-0.1v; mirrored off chain in `bank/accrual.mjs`
(`reweigh`, `pendingScaled`), the crank (expiry before and after a distribution)
and the alarm (`boosts_stalled`, the boost bounds watched as fixed forever).
The $CBOB mint exists on mainnet (`GMm2yY2z…`, created 2026-10-04 with NO mint and
NO freeze authority) and the ceilings are ruled, weight 12 and 24 distributions
(`launch/mainnet-init.json`). Since round 23 `boost_vault` also takes the
buyer's terms (`max_price`, `min_weight`, `min_epochs`): a vote that moves the
terms AGAINST the buyer between signing and execution (price above `max_price`,
weight below `min_weight` or epochs below `min_epochs`) refuses with
`BoostTermsMoved` and burns nothing. ⚠️ Round 24 (D1): a move in the buyer's
FAVOUR (a lower price, more weight, more epochs) is not refused; the boost lands
at the NEW terms, including a longer hold on the vault's one boost slot. This is
the ruled, one-sided rule; earlier text here said any change refused.
**A boost is N DISTRIBUTIONS, not N months (round 23 F2; Gary: "that's part of
the game theory on boosts").** The 100 $GARY burn path has no interval, so anyone
who sends the pool a sat and burns 100 $GARY runs a distribution: a
24-distribution boost can be run out in a few transactions for about 2,400 $GARY,
and that ends every live boost at once.
**What a vote can do with the terms:** switch boosts on at any price above zero,
at +1..+12 weight for 1..24 distributions, or off. It is an ordinary action
(10.71% YES after a 3-day public vote), not a key change. It cannot touch a live
boost, a level, a vote, the census, the 85/15 or custody.
**Who can boost at launch:** the release wallet holds all 2,100,000,000 $CBOB,
so until the Bank releases some, nobody else can buy a boost.
**Retired records keep `boost_weight` and `boost_end_epoch` as history;** they
are inert (`retire` unschedules; `claim`, `expire_boosts` and the crank skip
retired records).
**What a boost does NOT do, stated for holders:** it does not change a level, a
vote, the census or the 85/15; it buys a larger share of the next N
distributions only, and those are only as large as the revenue behind them. A
burner is partly bidding for bitcoin their own purchase helped put in the pool.
**Boost timing (accepted, disclosed):** a boost earns from the next distribution,
so a burner who expects a large one (a big sales week) can time the purchase. Every
boost still receives exactly N distributions whatever their size; the price is set
by a vote that can see the same flows.

*Moved here from OPEN AND BLOCKING in round 24 (D4): measured, and the crank is
unaffected. What it requires of the holder pages (the compute-unit limit) is
a requirement of item 50, which stays OPEN.*

**54. COMPUTE AT THE WIDEST HOST SHAPES: MEASURED 2026-10-04, AND IT BINDS THE
HOLDER PAGES** (round 22, D7; suite arms 10.5, 10.6, 10.6a, simulated so nothing is
consumed; figures re-read at `2b67fb1`, round 25 D6, `.cache/suite.log`). One
capture walks the full 512-entry SlotHashes three times and costs **114,756 CU**.
A plain mint costs 75,898; a mint carrying the full crank of 4 due captures costs
**524,588**, inside the 1,400,000 transaction maximum but REFUSED
under the legacy/v0 default 200,000 budget (10.6a proves the default refuses exactly when the
measured cost says it should). One piggybacked capture is NOT safely under the default
either: arm 10.6b measured a mint plus one capture at **188,594** with all 512
entries (lands, 5.7% spare), yet in round 25's third suite run a paid mint carrying
one capture ran out at exactly 200,000 and failed, and a charter claim is heavier
than a mint. The suite's own one-capture sends passed in earlier runs only because a
fresh validator's SlotHashes was still short; every crank-carrying send in the suite
now sets the limit, as below. Consequences:
  * **The bank's crank is unaffected**: it sends each capture as its own
    transaction (114,756) and each reveal alone (150,344 with its inline capture,
    arm 10.4).
  * **Holder pages (item 50) must set the compute-unit limit on ANY transaction
    carrying a crank**: host cost + 115,000 per capture + margin, and MAX_CRANK
    is 4 per host instruction. A legacy/v0 page that cannot rely on the wallet
    keeping its compute-budget instruction sends NO crank; the crank lane
    captures within a minute anyway.
  * A claim batch costs about 4,000 CU per vault (P.31: 6 vaults, 29,192), so the
    crank's 14-vault batches sit near 60,000, far under the legacy/v0 default (extrapolated
    from the measured per-vault cost, not measured at 14).
  * Not changed on chain: a binary search over SlotHashes would make captures
    cheap, but it rewrites the entropy reader during the freeze to save holders a
    compute-budget instruction. Recorded as an option, not taken.

**12 / 17 — compute units.** Was: "unmeasured anywhere; there may be a CU ceiling
below the 1,232-byte ceiling", promoted to release-blocking after five auditors
across rounds 18 and 19. **MEASURED on the v5 artifact** (`meta.computeUnitsConsumed`
off landed transactions, not a simulation): a plain mint 58,956 CU / 890 bytes;
the widest pad that measured legacy packet allows is 18 instructions at
73,657 CU / 1,228 bytes,
leaving 1,326,343 CU of the 1,400,000 cap. At 816.7 CU per padded instruction,
exhausting compute would need roughly 1,700 padding instructions — about 32,000
bytes of transaction. **The byte wall binds more than twenty-five times before the
compute wall in that legacy shape**, so that shape fits under the measured CU budget
ON THE PADDED-MINT PATH. This is not a v1 packet or resource-budget measurement.
(Round 23: a mint carrying four captures fails at the legacy/v0 DEFAULT 200,000
budget, item 54.) Assertions 10.1–10.4, including a
deliberately generous 400,000 CU regression ceiling that exists to catch an
order-of-magnitude change, not to pin today's number.

**14 — duplicate attribute keys are not rejected at mint.** **CLOSED on chain**:
`mint_vault` and `claim_charter_vault` refuse `DuplicateAttribute`. It was bounded
and harmless while attributes were provenance only; the level made it
load-bearing, because a map a reader takes a money decision from may not have two
answers. Assertion 11.4.

**19 — the unlevelled-vault halt as a customer-triggerable payout DoS.**
**CLOSED BY CONSTRUCTION**, and it was the single most-reported finding in this
project's history: fifteen of twenty-two auditors across rounds 18 and 19 called
it a public DoS, because anyone could fund a vault to 21,000 sats before its
`levels.json` entry existed and stop every payout until a human edited JSON.
`levels.json` is deleted. In v5 the level was proven against a pre-committed deck
at mint; in v6 it is drawn on chain after the mint, and `activate` refuses a vault
whose level is not drawn (`NotRevealed`), so **there is no state in which a vault
is activated but unlevelled**, and the payout reads the level from the vault's
own record. v5's off-chain allocator kept a refusal for an unreadable level
(excluding one holder silently overpays every other holder); v6 has no off-chain
allocator, so there is nothing left to halt.

**30: ~~the 85/15 ratio is still a VOTE.~~ DISCHARGED by stage 3b:** `split_bps`,
both destinations and `max_supply` are written once by `initialize`; `update_wiring`
no longer exists (P.0e, P.0f). History: in stage 1 `split_bps` was a governance
wiring field, so holders could vote their own share up or down.

**31: ~~the 31-day branch of the cadence is reasoned, not exercised.~~ SUPERSEDED
by stage 3b:** the cadence is deleted; the free path's period is an `initialize`
value (150 s in the suite), so it IS exercised now (PG.8, PG.9, IN.*).

**33: ~~a replacement swap operator lands after seven days, and that branch is
reasoned.~~ DISCHARGED by stage 3c:** the notice is an `initialize` value
(`notice_secs`, 60 s in the suite), so the successful apply is exercised for both
keys: 3c.K5 lands an armed swap operator and 3c.G2 a new guardian once the notice
has run, and 6.20g / 3c.G1 refuse an early apply. The 7-day value is the same
arithmetic.

**v5 items that went with the Bank, the co-signer, the deck or the distributor:**

- **1a. The co-signer's program allowlist and fee-payer check were off chain** (and
  the Bank-pubkey confinement was on chain, `BankKeyOutsidePair` /
  `BankKeyOutsideMint`; round 20 caught 1a under-claiming that). **Gone:** v6 has
  no Bank key, so there is no privileged signature to confine and no Bank SOL for
  a fee payer to spend; SEAL's second instruction walk was deleted with it.
- **1b. The Bank's policy was procedure, not enforcement.** **Gone:** there is no
  Bank policy; the programs' rules are the whole second party.
- **2. A coverage refusal had no override** (a stranger's airdrop could make a
  vault unredeemable until an operator intervened). **Gone:** nothing a
  stranger can do makes a redemption refuse off chain. The redeem page (item 50)
  still refuses, by design, only a problem with a reserve account (the vault's
  or the holder's own), a non-owner signer, a vault that is gone, foreign,
  unrecorded or retired, an opening that does not fit one transaction, or what
  the coverage cross-check finds that the page did not name (round 40 V40-4:
  this used to say "nothing refuses"). The cost moved: an undeclared airdrop is
  now destroyed rather than blocking (item 44).
- **3. The Bank could be named `payer` inside the approved pair.** **Gone** with
  the Bank.
- **4. The allowlist permitted a bare Core `BurnV1` of a second vault beside a
  real redemption.** **Gone** with the allowlist. A bare burn by the owner is still
  possible (proven impossibility 1) and `retire_burned` / the alarm handle it.
- **5. The judge never looked at where swept money goes.** **Gone** with the
  judge; the destination was always the holder's to choose.
- **11. Distribution reconciled against a ledger the payer wrote.** **Gone:** v6
  has no payer and no ledger; the accounting is the MINT config's accumulator and
  `owed_scaled`, and P.32 asserts the pool always holds what it owes.
- **15. A vault minted during an open proposal could vote on it.** **CLOSED ON
  CHAIN** by v6 stage 2: `VaultTooNew` against the proposal's `index_snapshot`.
- **16. The Bank-as-fee-payer gap on the mint path.** **Gone** with the Bank.
- **18. The unsigned transaction was visible in `ps`** (`scripts/bank-sign.sh`).
  **Gone:** the script is deleted.
- **20. A poisoned ATA silently removed one holder while a whole-payout halt
  paged.** **Gone** with `bank/distribute.mjs`. In v6 a frozen vault account is
  deferred and stays owed (item 28), logged `CBOB_CLAIM_DEFERRED_FROZEN`, and the
  alarm reports `claim_deferred_frozen`; a claim never creates or redirects an
  account.
- **21. The mint confinement foreclosed ever putting the Bank key in a
  multisig.** **Gone** with the Bank.
- **23. The deck size had to be decided before minting opened.** **Gone:** stage
  2 deleted the deck. Kept for the record, because it reversed its own
  conclusion: measured at last, the PACKET held 29 / 18 / 13 caller attributes at
  deck depth 7 / 11 / 13 against a program limit of 7, so the program bound and
  deck size never squeezed provenance; a round-20 CRITICAL saying not even zero
  fit at depth 11 was refuted by that measurement. v6's attribute budget
  depends on no deck: 640 stored bytes, proven to fit a legacy reveal (L.12).
- **24. The deck was fair; the queue was not** (the Bank co-signed every mint, so
  it chose who reached which index, and with the published deck could hand
  Level V to chosen parties). Written as OPEN TO GARY with three options; **v6
  took option (b)**: the Bank is gone from `mint_vault`, and with no deck there
  is no index-to-level map to aim at. What replaced it, and what that leaves, is
  items 25 and 26.



=====================================================================
MEASURED FACTS. DO NOT RE-FILE THESE AS BUGS.
=====================================================================
1. A bare Core BurnV1 by the owner cannot be prevented while the vault stays freely transferable. There is no burn-only lock. `retire_burned` exists for exactly this.
2. Token accounts owned by a PDA cannot be enumerated on chain, and neither can nested Core assets. Undeclared airdrops and nested vaults are destroyed by a redemption; the redeem client warns before the owner signs.
3. A vault transferred to its own asset-signer PDA (or into another vault's) is bricked forever, and Core permits it.
4. Core BurnV1 does NOT sweep the asset-signer PDA's lamports (measured); dropping BURN's lamports==0 check would destroy customer SOL. The sweep helper now moves those lamports to the owner before the burn.
5. Pubkey::is_on_curve is host-only and panics on BPF; an off-curve owner (a DAO, a multisig) cannot redeem.
6. overflow-checks = true, so arithmetic overflow ABORTS.
7. A burned asset's address is NOT re-mintable: the account survives, Core-owned, one byte, Key::Uninitialized, and a re-mint is refused (measured in the suite and the simulation).
8. INIT_AUTHORITY on mainnet is Gary's wallet Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb; `--features localnet` swaps in a test key; `scripts/build-mainnet.sh` proves which binary carries which key by behaviour, and that the sweep helper (which has no key) is byte-identical between its localnet and mainnet builds.
9. Mainnet's rent rate is LOWER than solana-test-validator's default (650,240 vs 890,880 lamports for 0 bytes, measured 2026-10-03; a classic token account is about 1,488,440 lamports on mainnet, round 24). The programs' constant `RENT_EXEMPT_0_BYTES = 890_880` is therefore stricter than mainnet needs, never looser.
10. cbBTC has a live freeze authority (Coinbase). A frozen vault account defers that vault's claim; a frozen POOL stops all claims, a claim that PAYS then reverts the whole transaction (round 24 D4), and a redemption sends no claim and forfeits its undelivered share rather than locking the vault (by design, stated to holders).
11. `HOST_FLOOR` counts Anchor's `declare_id!`-generated `test_id` (read the current floor and host test output; do not carry an old count forward).
12. Core never CPIs into lifecycle hooks, and an asset owner's `AddExternalPluginAdapterV1` on a collection-authority asset is refused `NoApprovals` (round 24 A5/W3, read in Core source at `e72d63e`).

TRANSACTION HISTORY: The shared `bank/txread.mjs` reads legacy/v0/v1 through the installed SDK's RPC transport because its parsed-response decoder rejects v1. Independently check its schema, incomplete-coverage refusals and consumer behavior, including round 29's repair: runtime-truncated logs, which anyone can cause, are refused by default, while the three walking scanners opt in to a flagged transaction, page or queue it as a recorded gap and keep walking (SPEC "Reader coverage boundary"). Find a way that path loses a CBOB event silently, or advances past something it should not. Round 41's changes (the dust rule extended from token accounts to every address the pages and ceremony expect to be created later, the program configs above all, so a stranger pre-funding a config address cannot stop the launch ceremony; the buy page's read moved into readBuySnapshot; the redemption poster drafts one post per redemption, not per transaction; the oracle's 180 s age bound pinned in literals; the crank's fee-budget sentence corrected), round 40's changes (a System-owned, data-less account at an expected token-account address, which anyone can create by sending lamports, now reads as absent and creatable everywhere the pages, the ceremony and the metadata generator classify accounts, so dusting cannot block an opening or the launch; the swap floor's 150 bps is pinned by hand; the ceremony's remember check can fail), round 39's changes (the redeem page re-reads every promised account by address at the press and never silently drops one; a CBOB vault someone sends into yours is rescued to the Squads in the prior transaction instead of blocking the opening; the crank's actual send path and order, the alarm's baseline writes, the bundle's redemption plan and the ceremony key's freshness are now tested so that each test fails when its property breaks), round 38's changes (the crank SENDS the joins it plans from a frozen pool; the redeem page's final re-plan never stalls on late arrivals, which a standing consent covers, and removes the right item; the ceremony refuses rather than re-offering collection creation when it cannot verify the existing one; limit 27's cost falls on the other holders; the holder guide's late-deposit promise is narrowed), round 37's changes (the redeem page reads the vault's reserves directly and lists every other account and NFT in bounded reads, so neither a token-account nor an NFT flood can block an opening: what it cannot list becomes one tick-box; the ceremony ignores a stranger's decoy collection; a frozen cbBTC account can activate; the crank ticks and joins during a frozen pool; the cron check ignores commented lines; --audit no longer counts a refused sweep), round 36's changes (the redeem page refuses only reserve-account problems, nested CBOB vaults and a non-owner signer, and leaves every other stray behind with an itemised acknowledgement, including strays whose mint someone else can freeze or whose destination is frozen; the RPC proxy relays only transactions that call a CBOB program; the payout expires due boosts first; `nested_vault` and `vault_owns_itself` can no longer be acknowledged; release-commit binding of the pages' pinned program hashes), round 35's changes (every vault born with a PermanentTransferDelegate held by MINT's ["rescue"] PDA and the permissionless `rescue_nested`, which moves a vault stuck in its own deposit address, a burned asset's wallet or a live CBOB vault's wallet ONLY to the CBOBTC Squads; the alarm's rescue events and `vault_awaiting_return`; road steps 9-11 reordered so only step 11 makes the programs final; the vault collection created at step 10 and required by the launch checker), round 34's changes (the five program ids CLAIMED ON MAINNET with an inert placeholder and step 9 rewritten as extend + upgrade + verify; vault metadata disclosed as the minter's; closesCycle sorting once with growth paged; Token-2022 reconcile amounts; split recovery from chain time; gate-5 arms for the full worst shape, ATA addresses, the no-CPI read and the seal against its owner), round 33's repairs (the sweep window symmetric at half a cooldown with uncertain sends confirmed by a direct status lookup; `mint.last_sweep_at` watched; the deploy runbook for a pre-funded program id) and gate-5 arms (worst single-signature and many-signer reveal shapes via a test-only `SIGSPDA!` forwarder, royalty re-delegation refused, a stranger's pre-filled wSOL account), round 32's (a state-derived sweep check, `sweep_unledgered_state`, that no scan flood can delay; per-transaction read and listing errors reported as tx_unreadable without aborting the pass; unreviewed log gaps never evicted; the coverage gate's focus-exact headline and shape-based split) and gate-5 suite arms (maximum 10,198-byte autograph, pre-funded PDAs and ATA, the update-authority bound), round 30's (and round 31's: one level, signature-free truncation-gap notice per pass; a per-program read budget of 2,000 transactions; the coverage gate's positive QUORUM MET check) to attack: a scan gap is now a persisted, resumable backlog (`bank/sigwalk.mjs` startBefore, the alarm's `backlogs` state, the poster's `st.backlog`) instead of a permanent blind spot, and the truncation gap pages only when one of our programs ran (SPEC "Scan backlog boundary"); the crank keeps its fee floor in reserve when budgeting reveals; the revenue job skips dust under MIN_SWEEP_LAMPORTS; the coverage gate is content-aware and counts only triaged, quorate rounds; the public fixture is reader evidence, not execution of a CBOB v1 transaction. Packet/default-CU measurements in SPEC are explicitly legacy/v0. No v1 writer is certified.

=====================================================================
ARCHITECTURE (v6)
=====================================================================
- A vault is a Metaplex Core asset (CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d) in the CBOB collection, minted only by MINT. Contents live in Core's asset-signer PDA ["mpl-core-execute", asset]; ExecuteV1 makes that PDA sign and requires the owner. A PermanentFreezeExecute plugin, authority SEAL's ["seal"] PDA, keeps it sealed. Permanent plugins are create-only.
- FOUR vault programs: SEAL (seal, thaw-on-the-way-to-a-burn), MINT (config, rounds, mint, charter claim, level draw, pool, boosts, guardian stops, governed setters), BURN (burn, emptiness proof, rate limit, retire CPI into MINT), GOV (proposals, votes, execution by CPI into MINT signed by the ["gov"] PDA). PLUS the SWEEP helper (EB2uVvsaThLp4PWt3LwAWveTCa9ZynPVbWzZfUhMf2aa): native, stateless, no key, reached only through Core ExecuteV1. Core is a sixth program we do not control. All five of ours become immutable at launch.
- Redemption (SPEC "REDEEMING"): a PRIOR transaction creates the owner's destination accounts and any of the vault's reserve accounts that do not exist yet; then ONE transaction, owner alone: claim (MINT, if owed and the pool is not frozen) ... open_for_redemption (SEAL) ... Core ExecuteV1 into the sweep helper (moves every named reserve account's LIVE balance and every lamport of the vault wallet to the owner, and closes the reserve accounts) ... burn_vault (BURN, which CPIs MINT retire_redeemed). No path leaves a surviving emptied vault; a partial sweep reverts the thaw.
- Money: mint prices are paid in cbBTC into MINT's ["revenue"] PDA; royalty SOL is swept by the one trusted swap operator off chain, swapped in a transaction we build ourselves against a pinned Orca Whirlpool (Meteora DLMM fallback) with a Pyth-derived minimum out enforced on chain, and returned as cbBTC; split_revenue sends 85% to the program pool and 15% to the CBOBTC Squads (permanent); distributions credit activated (joined) vaults by level weight 2/3/4/5/6 plus any live boost; claims pay into each vault's own cbBTC account.

REPORT FORMAT. Order by target, then the four questions about the accepted limits, then anything else. Findings CRITICAL / HIGH / MEDIUM / LOW. For each: the exact construct (file and function), what an attacker or an accident gains, the evidence that would exist if you are right, and the fix. End with one section: GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot? Be concrete.

=====================================================================
THE v6 COMMITS, so you can see what each stage claimed
=====================================================================
617504d Round 48 validated at 128d84d; round 49 (final, internal) prepared
128d84d Round 48 repairs: V48-1..V48-3 and V48o-1..V48o-7, each shown red without its fix
93d8930 Round 48 recorded: programs no quorum (5/8), off-chain launch-clean (6/8); both require changes
d0e77e0 Round 47 validated at bba189a; round 48 prepared
6dfca99 Road row 8 says the 22.2 FAIL was accepted
70dafdf SPEC 22.2: Gary's ruling recorded (accepted as passed, a true detection)
bba189a Round 47 repairs: V47-1..V47-9 and V47o-1..V47o-9, each shown red without its fix
17dc301 Round 47 recorded: LAUNCH-CLEAN on both passes (7 of 8 each), not a no-change round
487a8b4 Round 47 prepared: every new file bundled, post-46 changes in R0; README records the reproduction
a30924c Verifiable build gate: own the container's output before writing sums
b3f300c Pin the stripped release build (d2ae5fc) and make the verifiable build a gate
d2ae5fc Deploy and ship the STRIPPED program bytes (the verifiable build reproduces them)
7c56943 Verifiable build: clear the root-owned target with sudo; report and upload always run
0393ec7 Verifiable build: compare three per-program rebuilds against the workspace build; a mismatch is reported, not failed
d0184aa Verifiable build: also runs on a pushed verify-* tag (the box token cannot dispatch)
61ee675 Verifiable build workflow: the five programs in Solana's verifiable-build container on GitHub's runner
51f7c6a Round 46 validated at 1650336; FREEZE row; README record regenerated
3438c6c Mainnet dress rehearsal done: record, the 22.2 reading, SPEC road step 8
1650336 Rehearsal refresh records the FULL commit id (a short --to made the mainnet resume refuse)
0b8a204 Re-pin Metaplex Core to the 2026-10-09 build (51d41542) after 912/912 against it
6a6359d README in the Chairman's voice, its facts generated from their sources and checked by every run
2272656 Core watch: alert on any Metaplex Core upgrade and run the full suite against the new bytes
d2a3791 Pre-launch batch B: show my vaults, dry run on a lagging node, rehearsal wording, driver retries, page-mode collection
708af02 Stray listing works on Helius: getTokenAccountsByOwner per program, each stands alone
63539c2 Holder pages work with Phantom: one strict wallet-edit judge, the page's own compute budget
2b384ce Ceremony relay accepts the wallet's Lighthouse guard; every ceremony step tested as Phantom returns it
daba832 Ceremony: accept a wallet's bounded compute-budget and Lighthouse additions, and nothing else
fd119e4 Rehearsal page: a REHEARSAL-OPEN vault_collection keeps its status when the ceremony fills it
1246a30 Round 46 repairs: the Phantom-signed mainnet dress rehearsal (option 1) and V46-1..V46-8, V46o-1..V46o-5
ec064d6 Round 46 off-chain verdict: LAUNCH-CLEAN (6/8); REQUIRES CHANGES V46o-1..V46o-5, V46-7, V46-8
255edd7 Round 46: reports (8/8 both passes, no re-runs) and the programs verdict (LAUNCH-CLEAN, 6/8; REQUIRES CHANGES V46-1..V46-8, rehearsal tooling and pages)
63a92b2 Round 46 prepared (Gary 2026-10-09: one more round; a clean round means no changes)
9b130d7 Round 45 validated at e7c192a: 912/912, 1032 detectors, e2e 132/132, sim 71/71; item 53 re-proven; driver end to end on a local chain (net 0.105 SOL)
e7c192a Round 45 off-chain repairs: V45o-1..V45o-6
7a1a683 Round 45 driver repairs: V45-1..V45-11, rehearsal-aware id arms
6a78834 Round 45 off-chain verdict: LAUNCH-CLEAN, quorum met (7/8)
fbf044d Round 45: reports (programs 8/8 after same-prompt GLM and MiMo re-runs; off-chain 8/8 after Fable and Qwen 2.4T re-runs) and the programs verdict (LAUNCH-CLEAN, 6/8)
0d58d4e Round 44 validated; e2e and sim wait on the chain clock for on-chain windows
c9a811d Round 45 prepared: confirmation of round 44's repairs and the new rehearsal driver
a3cfd79 Dress-rehearsal driver (road step 8, item 22), box-signed; release gate fixed for rehearsal trees
94f06a8 Round 44 repairs: V44-1..V44-7 (programs pass) and V44o-1..V44o-5 (off-chain pass)
30b8650 Round 44 off-chain verdict: LAUNCH-CLEAN, quorum met (8/8)
e1022e6 Round 44: off-chain reports (8/8 after a same-prompt DeepSeek re-run) and the programs verdict (LAUNCH-CLEAN, 6/8)
2e8c979 R44: sendV0 confirms against its own blockhash (L.12b timed out twice under load); round 44 programs reports
03b70f9 Dress-rehearsal value set, check-launch-params --rehearsal, round 44 prepared
43e2183 Round 43 addendum: Core re-pin validated (912/912, e2e 132/132, sim 71/71)
c1e6ee8 Re-pin Metaplex Core to the deployed build; the mainnet probe now fails a stale pin
64247cb Round 43 validated: 912/912 on-chain, 966 detectors, 132/132 end to end; launch gate met
5c3a86d R43.V1: rename the nested fixture to NZ (N is already declared in that scope)
4d50811 R43.V1 measured on the burned fixture Z with an empty nested vault
2b0651f Round 43 repairs: alarm skips a permanently unreadable signature, crank rescues nested vaults, rehearsal-aware release gate, reveal-run arm
c08c576 v6 round 43 (launch confirmation): both passes LAUNCH-CLEAN, quorum met
542bd3f audit43: measured per-family context margin for Anthropic (17 seats, rounds 40-42)
f350e1d Round 42 validated: 909/909 on-chain, 132/132 end to end; launch-clean under the 10-08 gate
79b4076 Round 42 repairs + launch-gate ruling (canonical suite + e2e validation PENDING)
4a67d00 Round 41 repairs: dust-safe config reads, poster per-vault drafts, pinned gate-5 arms
5741f0e v6 round 41 audit: the end-to-end page test rides in the programs pass
9845cf2 v6 round 40: repairs validated; round 41 audit
8dba479 v6 round 40 audit: bundle the new redemption fixtures
48ca983 v6 round 39: repairs validated; round 40 audit
21f36e1 v6 round 39 audit: page tests ride in the off-chain bundle
99976d6 v6 round 38: repairs validated; round 39 audit
45271f9 v6 round 38 audit: drop the unchanged v1 fixture from the programs bundle
75ba692 v6 round 37: repairs validated; round 38 audit
0ae07d2 v6 round 36: repairs validated; scope frozen; round 37 audit
6bc3b49 web: undrawn vaults show the covered vault (Gary chose A)
667731c web: vaults numbered from #1 (Gary); pin the round-35 MINT build hash
9480314 v6 round 36 audit: bundle the ceremony's local server and embedded data
0b3ddb3 v6 round 35: rescue_nested (item 58), holder pages, launch gaps closed
1281ab4 v6 round 34: repairs validated (871/871 on-chain, 912/912 detectors)
90a05ff docs(vaults): record round 33 build and rehearsal validation
82bb3ef fix(vaults): repair round 33 findings and pin five more gate-5 refutations
18dbff6 docs(vaults): record round 32 build and rehearsal validation
ec4a0e1 fix(vaults): repair round 32 findings and pin gate-5 refutations in the suite
dee953e docs(vaults): record round 31 build and rehearsal validation
4ae79d6 fix(vaults): repair round 31 findings; gap paging, read budget, quorum check
425111d chore(vaults): round 31 preflight fixes (bundle sigwalk, replace oversized off-chain seat)
aa2b521 docs(vaults): record round 30 build and rehearsal validation
0d13b03 fix(vaults): repair round 30 findings; scan gaps drain instead of blinding
c5aab17 docs(vaults): record round 29 build and rehearsal validation
88acce2 fix(vaults): repair round 29 findings; scanners survive runtime-truncated logs
76753e8 docs(vaults): record round 28 build and rehearsal validation
de3d56f fix(vaults): repair round 28 findings and pin the Core autograph size boundary
93f8c36 docs(vaults): record round 27 build and rehearsal validation
e109b31 fix(vaults): close round 27 monitoring and transaction reader gaps
1d8ec10 Record round 26 build and rehearsal verification
8fe3120 Fix round 26 audit findings and certify expanded validation
93d04fe Record post-commit artifact and rehearsal validation
ba67127 Repair round 25 findings and certify evidence before fresh audits
2b67fb1 sweep helper: drop the empty localnet feature so the tested bytes ARE the shipped bytes
82d4cbc round 24 repairs: the sweep-at-execution helper, Orca/Meteora swap, holder docs corrected
6e521db round 23 repairs: owner-only boosts with the buyer's terms, wrapper attacks, host unit tests, every off-chain finding
77e7870 initauth: BURN and GOV probes pass their stage-3c accounts; build-mainnet verified again
0d7f03a $CBOB is on mainnet: pin GMm2yY2z... as THE boost mint
9048cd0 round 23 brief: point the auditors at the $CBOB boost and the token creation
328def0 create-cbob-token: read the metadata back at confirmed, and a local mode with mainnet's Token Metadata
d678806 the $CBOB boost: burn $CBOB, a vault weighs more for N distributions, then exactly back
4d50d42 SPEC 53: the full suite passes in the rehearsal tree at throwaway ids
d57ee3a rehearsal: no abbreviated program ids anywhere in the code
967aa8b measure the piggyback crank's compute; a recorded patch for the dress rehearsal ids
00e0425 round 22 programs: the tie fix, the evidence gaps, the doc corrections; round 23 runner
2de0d00 round 22 off-chain: every confirmed finding fixed (counter stays 0)
fa417ce v6 FREEZE at baa7d0b; round 22 starts
baa7d0b v6: the Test Vault simulation is green (59/59) and the launch values are checked before signing
9312275 v6 stage 3c: red-team 2 and 3 fixed; the suite is green at 645
9bf6279 v6 stage 4: the selftest, the control table and the floors match v6; run-tests is green end to end
cecd825 v6 design: quorum 21%, red-team 2 rulings, and the cap no longer over-claims in the guide
f37abb4 v6 stage 4: the crank (layer one) and the redemption poster (drafts only)
a868fb5 v6 stage 4: the off-chain readers are the Rust structs, and the alarm watches liveness
0dd1f5a v6 design: governance is 3 days, 20% quorum, 51% yes
a20d1d3 v6 red-team 2: no theft or unseal in the programs; seven edge findings
9be3a7c v6 stage 3b suite: the first vault cannot carry a vote, redemptions queue, and the month distributes itself
bec1dff Holder guide draft: the four things a holder ever does, and the honest list
e14a76f v6 stage 3b: the distribution period is an initialize parameter, capped at 30 days
533e62f v6 stage 3b programs: a distribution is a 100 $GARY burn or a month, and the month runs itself
bbb158d v6 design: the monthly distribution runs itself off ordinary traffic, no human, no burn
c667c43 v6 design: a distribution costs a 100 $GARY burn, or happens monthly for free
c2ee76c v6 stage 3b programs: a vote only reaches what may safely change, and redemptions are rate-limited on chain
fe693b6 v6 stage 3 suite: every vault paid by weight into itself, and every draw from real entropy
daa1ff2 v6 design: charter claim window is 7 days, not 14
4fafff8 v6 stage 3 programs: the community pool lives in the program, and no level is drawn without entropy
ec99209 v6 design: stage 3b governance package and an on-chain 2.1%/hour redemption cap
464c318 v6 red-team 1: one early charter vault can carry any vote alone
482bf70 v6 design: a missed reveal is rescheduled to a future slot, never assigned the lowest level
c0a9806 v6 stage 2 suite: the charter vaults vote the first round in, and every quota fills exactly
7a5084e v6 stage 2 programs: the level is drawn after the mint, the charter claim burns a pinned PoB, and governance is the vote from block one
2c364e2 v6 design: payouts are weighted, activated vaults only, and a claim never creates an account
fa5ac3c v6 design: royalties fixed at 10% forever
b411095 v6 stage 1 suite: the owner alone redeems, and the guardian can only stop
3e564f2 v6 design: the round price floor is 21,000 sats


=====================================================================
THE FILES UNDER AUDIT
=====================================================================
Audited commit: 617504d5a1ccfcd5805e182d5e7008c22468eb9c. Read each file below WHOLE, from /opt/cbob-vaults, before you report on it; do not answer from a description. SPEC.md's ACCEPTED LIMITS section is quoted in full above.

- `scripts/pob-merkle.mjs` (3,293 bytes): Proof-of-Burn Merkle proof construction; first delivered in round 26 after the coverage gate identified its omission
- `scripts/rehearsal-tree.sh` (7,103 bytes): throwaway-ID rehearsal tree, key preservation and reverse-map proof; first delivered in round 26
- `scripts/token-programs.sh` (2,407 bytes): pinned mainnet Token, Token2022 and ATA bytes; prepare and post-boot identity gates
- `tests/expiry-budget.mjs` (7,468 bytes): synthetic-genesis twenty-due-boost default-CU execution gate, not full lifecycle evidence
- `scripts/audit-coverage.sh` (14,459 bytes): source enumeration and prompt-delivery coverage gate, including the new JavaScript test
- `programs/cbob-vault-mint/src/lib.rs` (186,326 bytes): MINT: mint, charter claim, level draw, the community pool, the guardian, every governed action. THE LARGEST SUBJECT.
- `programs/cbob-vaults/src/lib.rs` (22,620 bytes): SEAL: the seal, and the thaw that only exists on the way to a burn
- `programs/cbob-vault-burn/src/lib.rs` (33,669 bytes): BURN: the emptiness proof, the rolling-hour redemption cap, the retire CPI
- `programs/cbob-vault-gov/src/lib.rs` (51,190 bytes): GOV: one vault one vote, snapshots, the supermajority for key changes, logged skips
- `programs/cbob-vault-sweep/src/lib.rs` (5,555 bytes): SWEEP (NEW, round 24 A3): the stateless helper every redemption calls through Core ExecuteV1. Audited in round 25; check its repairs.
- `programs/cbob-vault-sweep/Cargo.toml` (740 bytes): the sweep helper's crate: its features and its one dependency
- `programs/cbob-vault-mint/Cargo.toml` (321 bytes): MINT crate: the localnet feature that swaps the init authority, and its dependencies (never sent before round 30; round 29 L1)
- `programs/cbob-vaults/Cargo.toml` (400 bytes): SEAL crate: features and dependencies (never sent before round 30; round 29 L1)
- `programs/cbob-vault-burn/Cargo.toml` (321 bytes): BURN crate: features and dependencies (never sent before round 30; round 29 L1)
- `programs/cbob-vault-gov/Cargo.toml` (319 bytes): GOV crate: features and dependencies (never sent before round 30; round 29 L1)
- `tests/cpi-wrapper/Cargo.toml` (560 bytes): the test-only CPI wrapper crate (never sent before round 30; round 29 L1)
- `sim/fixtures.mjs` (3,536 bytes): how the 71-assertion simulation patches the real cbBTC/$GARY/$GIRAFFISH mint accounts and asserts nothing else changed (never sent before round 30; round 29 L1)
- `tests/initauth.test.ts` (9,157 bytes): THE KEY PROOF build-mainnet runs: mainnet artifacts must reject the test init key, localnet must accept it (rewritten in v6, last shown in round 17; round 30 L1)
- `Anchor.toml` (331 bytes): the workspace toolchain and cluster pins (current content never shown to a completed round; round 30 L1)
- `Cargo.toml` (124 bytes): the workspace manifest: overflow-checks and release profile (current content never shown to a completed round; round 30 L1)
- `scripts/validate-core-gate.sh` (4,100 bytes): the Core-binary gate the runners call (current content never shown to a completed round; round 30 L1)
- `sim/run-sim.sh` (5,079 bytes): the 71-assertion simulation runner and its floor (current content never shown to a completed round; round 30 L1)
- `tests/3prog.test.ts` (351,412 bytes): THE SUITE: every claim above is an arm here; find the ones that cannot fail
- `sim/test-vault.ts` (57,829 bytes): THE TEST VAULT SIMULATION: real Core, real mints, real Proof of Burn assets
- `sim/clone-pob.mjs` (5,215 bytes): how the simulation clones the real Proof of Burn accounts, and the one field it changes
- `scripts/probe-mainnet-facts.mjs` (14,404 bytes): mainnet facts: signature paging, reserve freeze authorities, Token-2022 ATA refusals and classic controls
- `bank/txread.mjs` (7,835 bytes): shared legacy/v0/v1 parsed history reader, validation and fail-closed coverage
- `bank/sigwalk.mjs` (2,341 bytes): the signature walk and its round-30 resume point, which the prompt asks about
- `scripts/run-tests.sh` (42,761 bytes): the runner and its floors
- `scripts/build-mainnet.sh` (13,170 bytes): builds the mainnet binaries and proves which key each carries; now FIVE programs, the sweep helper's bytes proven identical to the tested ones
- `DESIGN-v6.md` (35,488 bytes): Gary's rulings: product decisions, NOT to be re-litigated, only checked against the code
- `HOLDER-GUIDE.md` (17,641 bytes): the plain-English promises to holders: every sentence must be true of the code
- `SPEC.md` (218,066 bytes): ACCEPTED LIMITS, the control table, the proven impossibilities, the REDEEMING steps
- `web/.gitignore` (19 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): their offline tests and tooling; are they non-vacuous?
- `web/README.md` (44,341 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): their offline tests and tooling; are they non-vacuous?
- `web/build.mjs` (10,487 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): their offline tests and tooling; are they non-vacuous?
- `web/deploy/ecosystem.rpc-proxy.config.cjs` (766 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/deploy/nginx-rpc.conf` (2,305 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/deploy/rpc-proxy.mjs` (21,517 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/gen-errors.mjs` (1,806 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): their offline tests and tooling; are they non-vacuous?
- `web/meta/generate.mjs` (12,937 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/config.js` (11,462 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/html/buy.html` (1,518 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/html/ceremony.html` (1,925 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/html/claim.html` (1,536 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/html/redeem.html` (2,329 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/html/vault.html` (1,874 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/lib/ceremony-reads.mjs` (12,595 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/lib/decode.mjs` (9,879 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/lib/enc.mjs` (1,312 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/lib/ids.mjs` (2,998 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/lib/ix.mjs` (12,701 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/lib/plan-ceremony.mjs` (24,537 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/lib/plan-get.mjs` (11,353 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/lib/plan-redeem.mjs` (31,383 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/lib/plan-vault.mjs` (5,263 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/lib/reads.mjs` (23,851 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/lib/tx.mjs` (14,634 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/lib/ui.mjs` (2,806 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/lib/wallet.mjs` (1,319 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/pages/buy.mjs` (5,444 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/pages/ceremony.mjs` (19,639 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/pages/claim.mjs` (6,645 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/pages/draw.mjs` (3,507 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/pages/redeem.mjs` (16,264 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/pages/vault.mjs` (15,032 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/shims/crypto.mjs` (739 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/shims/empty.mjs` (278 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/shims/globals.mjs` (325 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/shims/url.mjs` (242 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/src/style.css` (4,355 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the pages build every transaction a holder or Gary signs; check them against the programs
- `web/deploy/ceremony-local.mjs` (7,393 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the localhost server for running the ceremony off the public site
- `web/src/generated/launch.json` (2,489 bytes): HOLDER PAGES / CEREMONY (item 50, round 35): the launch values the ceremony embeds; must equal launch/mainnet-init.json
- `audits/v6-redteam/RT3-stage3c.md` (3,901 bytes): the last red-team pass and what it found
- `web/test/get.test.mjs` (18,592 bytes): HOLDER PAGE TEST (moved to the programs pass in round 46 for the off-chain pass's context space): is it non-vacuous, and does it test what its names claim?
- `web/test/proxy.test.mjs` (43,530 bytes): HOLDER PAGE TEST (moved to the programs pass in round 44 for the off-chain pass's context space): is it non-vacuous, and does it test what its names claim?
- `web/test/ix.test.mjs` (16,677 bytes): HOLDER PAGE TEST (moved to the programs pass in round 44 for the off-chain pass's context space): is it non-vacuous, and does it test what its names claim?
- `scripts/rehearsal-run.mjs` (39,158 bytes): the dress-rehearsal driver (round 45; round 46: on mainnet it deploys the SHIPPING build, upgrades it, and Gary signs road step 10 on the page while the driver only waits and reads back); it moves real SOL and tokens on mainnet
- `scripts/rehearsal-steps.mjs` (75,176 bytes): the dress-rehearsal driver (round 45; round 46: on mainnet it deploys the SHIPPING build, upgrades it, and Gary signs road step 10 on the page while the driver only waits and reads back); it moves real SOL and tokens on mainnet
- `scripts/rehearsal-recover.mjs` (9,894 bytes): the dress-rehearsal driver (round 45; round 46: on mainnet it deploys the SHIPPING build, upgrades it, and Gary signs road step 10 on the page while the driver only waits and reads back); it moves real SOL and tokens on mainnet
- `bank/rehearsal-env.mjs` (4,533 bytes): the rehearsal-only overrides (round 45; round 46 V46o-3: the load-time refusal pages through the literal production notifier)
- `sim/rehearsal-local.sh` (4,186 bytes): the local dress rehearsal (round 45; round 46: CBOB_LOCAL_CEREMONY=page runs the page-mode driver with the stand-in helper)
- `sim/das-shim.mjs` (5,050 bytes): the local DAS stand-in the dress rehearsal reads (round 45)
- `web/test/e2e-localnet.mjs` (65,277 bytes): HOLDER PAGE END-TO-END TEST (moved to the programs pass in round 44 for the off-chain pass's context space, as in round 41): is it non-vacuous, and does it test what its names claim?
- `web/test/e2e-localnet.sh` (5,357 bytes): HOLDER PAGE END-TO-END TEST (moved to the programs pass in round 44 for the off-chain pass's context space, as in round 41): is it non-vacuous, and does it test what its names claim?
- `web/test/redeem-fixtures.mjs` (4,770 bytes): HOLDER PAGE END-TO-END TEST (moved to the programs pass in round 44 for the off-chain pass's context space, as in round 41): is it non-vacuous, and does it test what its names claim?
- `audits/round48/VERDICT-programs.md` (45,912 bytes): round 48 programs verdict and measurements; independently verify its findings and claims
- `audits/round48/VALIDATION.md` (4,441 bytes): round 48 repairs and their measured validation
- `scripts/rehearsal-refresh.mjs` (10,495 bytes): NEW (round 46): moves a rehearsal tree to a new commit IN PLACE, keeping every throwaway key and state file byte for byte
- `sim/rehearsal-ceremony-helper.mjs` (5,575 bytes): NEW (round 46): the LOCAL stand-in for Gary that signs road step 10 from the page's own STEPS, so the page-mode driver is proven on a local validator; refuses mainnet genesis
- `web/deploy/nginx-rehearsal-ceremony.conf.example` (2,771 bytes): NEW (round 46): the reviewed, NOT installed, nginx location for the hosted rehearsal signing page (unlisted path, basic auth, loopback, no-store)
- `web/test/fixtures/placeholder/src/lib.rs` (663 bytes): NEW (round 46, V46o-4): the source of the placeholder the five mainnet ids hold today, tracked as the web suite's fixture
- `web/test/fixtures/placeholder/Cargo.toml` (246 bytes): NEW (round 46, V46o-4): the placeholder fixture's crate manifest (the binary itself is pinned by SHA256SUMS, not sent)
- `web/test/fixtures/placeholder/README.txt` (884 bytes): NEW (round 46, V46o-4): what the tracked placeholder fixture is, and what is deliberately not in it
- `web/test/fixtures/placeholder/SHA256SUMS` (317 bytes): NEW (round 46, V46o-4): the pinned sha256 of the placeholder fixture (binary 20,920 bytes) and its source
- `tests/cpi-wrapper/src/lib.rs` (3,918 bytes): TEST-ONLY CPI forwarder the suite uses to attack the redemption path one level down (never deployed beyond the test validator)
- `launch/mainnet-init.json` (5,674 bytes): every value the four initialize calls will write ONCE, with its ruling
- `launch/rehearsal-init.json` (10,226 bytes): NEW (round 44): the dress-rehearsal value set; it must never pass the mainnet launch check, and its values must sit inside each initialize bound
- `web/src/lib/my-vaults.mjs` (2,109 bytes): (after round 46, first audited in round 47, found on mainnet during the rehearsal): "show my vaults", the vault page lists the connected wallet's vaults and keeps only those verified on chain; never audited
- `scripts/validator-lock.sh` (2,112 bytes): NEW (round 47, V47o-2; bundled in BOTH passes): one test validator at a time, a kernel flock every runner takes before its exit trap, inherited by the runners a holder starts and never by the validator
- `scripts/sbf-strip.sh` (1,711 bytes): (2026-10-10, first audited in round 47): every build and test runner deploys the program bytes STRIPPED with platform-tools v1.54 llvm-objcopy, because solana-verify's container output is stripped; dist/ is the stripped release build
- `.github/workflows/verifiable-build.yml` (5,417 bytes): (2026-10-10, first audited in round 47): the gate on a machine that is not ours: the container workspace build, solana-verify's per-program rebuild and the audited hashes must be one set of bytes (road step 9)
- `README.md` (16,412 bytes): (2026-10-10, first audited in round 47): the public repository's front page, in the Chairman's voice; its facts block is generated by scripts/readme-facts.mjs and checked by run-tests.sh. Every sentence must be true of the code, like HOLDER-GUIDE.md
- `audits/rehearsal-2026-10-09/RECORD.md` (4,766 bytes): (first audited in round 47) the mainnet dress rehearsal record (road step 8), including item 22.2 recorded FAIL because the real Metaplex Core upgrade landed mid-rehearsal
