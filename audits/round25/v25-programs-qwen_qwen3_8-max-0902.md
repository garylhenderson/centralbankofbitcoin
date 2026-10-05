# CBOB v6 — independent program audit (round-25 reading, whole tree)

Scope note, first, because it bounds every verdict below: this pass is the five on-chain programs plus the bundled suite/sim/scripts/docs. **`bank/` (crank, alarm, detectors, `swap.mjs`, `revenue.mjs`) is not in this bundle**, so the new Orca/Meteora swap repair is *not* audited here (see F-8). I attempted to break each named invariant; where I could not, I say what I tried rather than endorsing it.

**No CRITICAL and no HIGH program defect is confirmed in this pass.** I do not say the programs are clean; I say the theft/unseal/mis-accounting paths I attacked did not yield a confirmed exploit, and the real findings below are concentrated in the round-24 repair surface, exactly where the brief said to look.

---

## Findings, by target

### R0 — Round-24 repairs

**F-1 · LOW · C2 repair incomplete: the boost-ring host test still writes the ring by hand; "early-unschedule of a wrapped boost" is exercised nowhere.**
- Construct: `programs/cbob-vault-mint/src/lib.rs`, `host_tests::the_boost_ring_wraps_exactly_against_a_model`, and the untested path in `unschedule_boost` / `boost_vault`'s `end % BOOST_RING` index.
- The round-24 verdict prescribed: drive `unschedule_boost`, `expire_boost`, `advance_epoch` through the program's own index "and stop writing the ring index by hand." The bundled host test still does `let i = (end % BOOST_RING) as usize; c.boost_expiring[i] += 1` itself and never calls `unschedule_boost`/`expire_boost`. On-chain, `BO.34` buys a boost whose end wraps past 64 through the real `boost_vault`, but only lets it expire through the *normal due* path. No arm retires a **not-yet-due** boosted vault whose `boost_end_epoch % 64` wrapped (the `boost_expiring[i] -= 1` branch of `unschedule_boost`).
- What an accident gains: if that decrement's slot math were wrong, `checked_sub` underflows and **aborts** (fail-closed), reverting `retire` → a boosted vault at a wrapped epoch could not be redeemed and a due boost could then block `distribute`. I read the math as correct, so this is an untested-path risk in immutable code, not a confirmed exploit.
- Evidence if I'm right: `cargo test -p cbob-vault-mint --features localnet --lib` shows the test computing the index itself; grep the suite for any early `retire_burned`/redemption of a wrapped, not-yet-due boost — there is none.
- Fix: refactor the schedule-write into a free function and call it from the host test (or assert against `boost_vault`'s real index), and add one on-chain arm: advance `dist_epoch` past 64, buy a boost whose end wraps, bare-burn the vault **before** it is due, and assert `books()` (ring + due + active) still balances.

**F-7 · verification note (not a scored finding) · MINT's bytes changed; confirm the alarm does not pin the old hash.**
- The one added comment line near `merkle_root_from` moved every `require!`/`err!` site below it and changed MINT's compiled bytes. I checked the consumers in the bundle: the suite matches constants **by name** (`pinned()`, `idx()`, `constU8()`, `structBody()` all `indexOf(name…)`), and `because()` matches error *names*, not line numbers; Anchor error *codes* come from the enum, not `line!()`. `build-mainnet.sh` pins only Core's hash and otherwise reports fresh sha256s. So nothing in the bundled suite/build depends on the old bytes or line numbers.
- What I could not check: `bank/alarm.mjs` is not bundled. If the alarm keeps a program-hash baseline for MINT (as opposed to only Core's hash + upgradeability), it now points at stale bytes and would either false-alarm or silently stop detecting a swap.
- Evidence: grep `bank/alarm.mjs` / `bank/detectors.mjs` for a MINT (or any own-program) hash literal; if present, re-pin from `dist/SHA256SUMS`.

The other round-24 repairs I verified as present: C1 (`BO.30/30a/31` weight+epochs legs and the favourable-move landing, `BO.33/33a` post-transfer owner), C3 (`E.7/E.7a` five-kind execute; note the GOV "six CPIs" comment is still wrong — max is five, harmless but stale), C5 (`S7b.*` sim boost under a real quorum), C6 (`10.6` now asserts `wide.cu >= base.cu + 4×100_000`), C8 (`3.1y` added), A1/A6 comment edits present (SEAL's `SPL_TOKEN_ID` comment now says "checks only the account's OWNER").

### R1s — the sweep helper (never audited before; moves value)

I attacked (a)–(g) directly. Summary of what held, then the findings:
- **Owner-only (a):** reachable only when thawed; thaw (`open_for_redemption`) needs the owner's signature plus a matching same-asset/same-owner burn; a sealed vault refuses all `ExecuteV1`. So only the owner can reach it, and only inside a redemption. `dest` being caller-chosen is therefore safe (the caller *is* the owner).
- **Pair list (b):** duplicate source → second `read_token` hits a closed, system-owned account → revert (fail-closed); source-as-destination forces `signer==dest`, refused; duplicate destinations are distinct per-mint accounts; zero-pair is accepted and only moves lamports (harmless); odd count refused.
- **Destination (c):** lamport transfer to a wallet works; a non-system `dest` fails the redemption (owner's own foot-gun).
- **Lamport sweep (d):** nothing lands between the helper and `burn_vault` in the canonical tx; BURN reads exactly what the sweep left.
- **Emptiness interaction (e):** a swept-and-closed reserve ATA is system-owned → BURN's reserve loop `continue`s it *for the right reason*. A Token-2022 ATA for a classic mint cannot be created (Token-2022 won't initialize an account for a foreign-program mint), so the "stranger creates the missing account" vector is limited to the classic ATAs, which the prior-transaction creation closes; non-ATA accounts and nested assets remain the accepted destruction limits (9/44), not sweep gaps.
- **Fit (f):** `S8.0` measures claim+open+helper+burn in one legacy tx.

**F-2 · LOW · no arm proves a non-owner cannot invoke the helper through Core `ExecuteV1`.**
- Construct: `programs/cbob-vault-sweep/src/lib.rs::process`; dependency on Core `ExecuteV1` authority semantics.
- The safety argument (frozen refuses Execute; only the owner can thaw) is sound and is what I rely on, but the sweep-specific negative — stranger attempts `ExecuteV1` into the helper on someone else's vault — is unmeasured. `SR.1` tests a *direct* call; `SR.2` tests the owner with a wrong destination; neither is a stranger-through-Core.
- What an attacker would gain if the barrier failed: the vault's contents to an attacker-chosen `dest`. Two independent barriers make this unreachable today; the gap is evidence, not a live hole.
- Evidence if I'm right: add an arm — stranger calls Core `execute` into `sweep` on a sealed vault → Core refuses; there is no thaw path without the owner.
- Fix: add that arm to `tests/3prog.test.ts` (SR section).

**F-5 · INFO · a duplicated source reverts the whole redemption with an opaque `IllegalOwner`.**
- Construct: `cbob-vault-sweep::process`, second `read_token(src)` after the first iteration closed `src`.
- Fail-closed and not exploitable, but a redeem-page bug that repeats a source would block an opening with a token-program-shaped error rather than a named one. No on-chain change required; the page must not repeat sources.

**F-6 · INFO · `dest` is not compared to the asset's owner — confirmed safe by construction.** Recorded so a future reader does not "fix" it into a broken check: the caller is provably the owner (F-2 reasoning), so any owner-chosen `dest` is their own decision.

### R1 — custody / pairing
I tried: CPI-wrapped open/burn (already refused by stack-height + top-level-only sysvar reads, WR arms), two vaults in one tx (asset+owner bound both directions), account-index drift (fail-closed), instruction-sysvar under v0 (see F-3). **No confirmed path lets anyone but the owner extract value from a sealed vault, and no path leaves an emptied vault alive.** The thaw↔burn pairing binds asset AND owner in both directions and fails closed on discriminator/account drift.

**F-3 · LOW · versioned (v0 + lookup-table) redemption pairing is reasoned, not measured.**
- Construct: `programs/cbob-vaults/src/lib.rs::open_for_redemption` and `programs/cbob-vault-burn/src/lib.rs::burn_vault` instruction-sysvar walks.
- Round-24 W5 rejected the v0 concern by reasoning (sysvar holds resolved keys). No arm lands a v0 redemption. If key resolution ever differed, the more likely outcome is fail-closed (a refused pairing), but the canonical redemption's byte headroom is small enough that a future client could plausibly use v0+LUT.
- Evidence if I'm right: build the 3-asset redemption as a `VersionedTransaction` with an address lookup table and land it; none exists in the suite.
- Fix: add that arm.

### R2 / R2b — pool and boost accounting
I traced `credit`, `claim`, `join`, `retire`, `reweigh`, `expire_boost`, `monthly_inline` for the invariant **pool ≥ ceil(owed)** and for counter drift:
- `distribute`: `delta = floor(avail·S/w)`, `owed += delta·w ≤ avail·S` ⇒ balance ≥ ceil(new owed). Holds.
- `claim`: pays whole sats, moves the sub-sat into `carry`, reduces `owed_scaled` by exactly `pay·S` ⇒ balance and owed fall together. Holds.
- `join` adds weight but zero owed; `retire` subtracts `pending` from `owed_scaled`. Holds.
- Counters: `waiting_to_join = pending_count − pending_this_epoch` is consistent across request/join/retire/epoch-boundary orderings (I walked same-epoch retire, cross-epoch retire, interleave-with-new-request). No permanent distribution block: joining and expiring are permissionless, so `JoinWaitingFirst`/`BoostsExpireFirst` can be cleared by anyone (the crank does both).
- Boost: earns exactly N distributions (the distribution advancing `dist_epoch` to `end` is the Nth; `BoostsExpireFirst` stops the N+1st); `reweigh` carries owed into `carry` and resets debt, so nothing is gained/lost on weight change; live end-epochs span < 64 values so no ring-slot collision among live boosts.
**No defect confirmed in either invariant.** This is a negative result, not a certificate.

### R3 — level draw
FIFO (`index == revealed_total`), skipped-slot handling (smallest produced slot in `[want, want+64]`), burned-head-of-queue (draws but skips the Core write), and the attribute re-supply hash all check out. The C-leader residual is the accepted limit 26; the HOLDER-GUIDE now says "pick among several results… choose the level," which matches the code (`blockhash_in_window` picks the smallest produced slot, so skipping is best-of-4 plus content grinding). Not worse than the corrected text.

### R4 — governance
No minority carry (quorum/threshold/10%-turnout, and 50%-of-all-live for key changes), no money reach (actions are SetRound/Brakes/TightenSweep/ArmSwapOperator/SetBoostTerms; split/destinations/max_supply/royalty unreachable), and no permanent governance freeze I can construct (votes are time-boxed and re-proposable; the divisor shrinks with live supply). Overtaken actions skip-and-log without reverting the bundle. Concentration is the documented business fact (D5), not a code defect.

### R5 — charter claim
Merkle is domain-separated (0x00 leaf / 0x01 node) with sorted pairs; PoB burned by CPI in-instruction; `pob_extra` passed never as signers. SPEC 46 (hot wallet can end the project or capture governance during the window) is now stated fully and appears in the HOLDER-GUIDE honest list. I found nothing that wallet, a PoB holder, or a third party can do that 46 omits; the alarm-watches-collection-not-individual-assets caveat is already recorded.

### R6 — one-time configuration / trusted hop
`initialize` bounds are enforced as described; the off-curve-guardian/operator footgun (A6) is real but **recoverable** by a later vote (`arm_guardian`/`arm_swap_operator`), so it is not a permanent brick. The 10% royalty is Core-enforced with plugin authority None (R.5/R.6 arms). The redemption cap is a true rolling window over the 64-slot timestamp ring; I verified the k-th-most-recent index math and the empty-ring/early behavior.

### R7 — cross-program raw reads
I recomputed every offset from the struct definitions: MintConfig (version 8, collection 9, governance 41, pool_ata 73, minted_total 141, sales/sweep_stopped 191/192, guardian 193, swap_operator 225, sol_reserve 257, max_sweep 266, cooldown 274, charter_closes 442, bare_retired 454, stopped_at 518/526, pending_op 534, monthly 574, pending_guardian 582, sweep bounds 631/639/647, boost bounds 711/712), VaultRecord (asset 9, mint_index 41, level 57, active/retired 125/126, ata 129, debt 161, pending 177, boost 186/187, carry 195), BurnConfig (burned_total 42, window 50, rate_head 58, ring 59), SEAL Config (version 8, collection 9, reserves 41). **All match the pinned constants in GOV/BURN/MINT and the suite's offsets. No offset error found.** Token-account reads (mint 0, owner 32, amount 64, len 165) are correct.

### R8 — suite / sim / build as evidence
Beyond F-1..F-4: `build-mainnet.sh` proves the sweep helper's mainnet bytes are byte-identical to the tested localnet bytes (no key to swap; `cmp` gate), and `run-tests.sh` deploys all five. The `because()` reason-pins are name-based and unique-ID-guarded (ID.1). I did not find an arm that cannot fail other than those flagged below.

**F-4 · LOW · `P.11a` passes vacuously when `picks` is empty.**
- Construct: `tests/3prog.test.ts`, arm `P.11a`.
- If fewer than one level has a live unactivated candidate, `perLevel` and `wantLevel` are both empty and `'' === ''` passes. Round-24 C8's fix was applied as a ⚠️ note, not a hard fail.
- Evidence if I'm right: force `picks.length == 0`; the arm still reports ok.
- Fix: require `picks.length >= 1` (ideally assert all five levels are present or fail loudly).

---

## The four accepted-limit questions

1. **Is any limit WORSE than stated?** I re-checked 26, 27, 28, 32, 41, 44, 46, 47, 55 against the code. None is materially worse than the *post-round-24* wording — round 24 already corrected the ones that were (26 "choose," 47 "permanent at low turnout," 28 "a frozen pool reverts a paying claim"). One dependency to watch rather than re-report: limit 55's "as little as 100 $GARY" and "~an hour of sales" hold **only while the crank runs**; nothing bounds unsplit revenue on-chain during a crank stall, which the limit itself concedes.

2. **Is anything listed as a limit not actually a limit / already closed?** The round-23 F1 "stranger's dust blocks an opening" race is now **closed on-chain by the sweep helper**, and the docs say so (HOLDER-GUIDE honest list: "On the redeem page that cannot block the opening"). It is correctly described as closed, not mislabeled open. Limits 9 and 44 (undeclared airdrops / nested assets destroyed) remain genuinely open — the helper only names what the page names and cannot enumerate.

3. **Is any DISCHARGED item not actually discharged?** Items 51, 54, 12/17, 30, 31, 33 check out as discharged (built+measured). Caveat, not a numbered item: the **round-24 C2 evidence repair is only partially done** (F-1), so treat the "ring wrap proven" claim as proven for the happy path only.

4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No quiet demotion found, but two must stay open and are at risk of being read as done: **item 50** — the sweep *helper* now exists, but the redeem *page* (`judgeRedemptionCoverage` before signature, the poster sender) does not, so 50 is still blocking; and **item 53** — the rehearsal proof is pinned to `d57ee3a` and is stale; it must be re-run at the release commit. Also keep **22, 38, 52** open.

---

## Unaudited-by-this-pass (stated, not buried)

**F-8 · scope gap · `bank/swap.mjs` (Orca-then-Meteora) and all of `bank/` were not in this bundle.** The swap is a round-24 repair that moves real value. It was reportedly read by the off-chain pass and proven on a mainnet fork, but this program pass cannot confirm it. It must be audited in the off-chain pass and `sim/swap-fork.sh` re-run at the release commit before launch.

---

## Given no human firm will ever see this and the programs are immutable, do these before launch (things AI audit structurally cannot do)

1. **Run the live dress rehearsal (items 22/53) against a real cluster** — crank armed and LIVE, throwaway ids, small real amounts — including a forced transient RPC failure mid-batch and the every-minute reveal lane under real slot timing. Re-run `scripts/rehearsal-tree.sh` at the release commit (the current proof is stale at `d57ee3a`). AI can reason about the crank; it cannot operate it against live rate limits and real slots.
2. **Deploy, then dump all five programs from mainnet and byte-compare against `dist/SHA256SUMS`; then remove the upgrade authority and verify `program show` reports none.** Do this for the sweep helper too. AI cannot sign or deploy.
3. **Re-verify the Metaplex Core binary on mainnet at deploy time** against the pinned `f03e75…` hash. Core can upgrade between this audit and launch; the pinned-hash gate only means something if it is re-checked at the moment value lands.
4. **Execute the four `initialize` calls from `launch/mainnet-init.json`, then independently re-derive every written value from chain state** (not from the checker, which validates JSON, not the signed transaction — A6), and create/fund the three cbBTC accounts (pool, revenue, Squads) plus revenue rent (item 52) before the first paid mint.
5. **Settle the two OPEN values — charter opening date and lock deadline — as a human decision**, and sequence lock-deadline *before* charter open so nothing ever holds value under an upgradeable program.
6. **Move the secrets off this box**: the $CBOB release wallet key (limit 56), the swap operator key, and the guardian key into the ruled custody (cold/multisig/HSM). The audit box should not hold keys that can boost or sweep real value.
7. **Soak the crank + alarm live for days** against the rehearsal to catch timing, alert-routing, and dead-man's-switch behavior that only manifests over real elapsed time (the round-24 H1 stream-suppression class of bug).
8. **Commission the off-chain pass to actually audit `bank/swap.mjs`** (this pass could not see it) and to confirm the alarm has no stale MINT hash baseline (F-7).
9. **Human sign-off that HOLDER-GUIDE.md matches the deployed bytes**, since it is the contract with holders and several of its sentences were false as recently as round 24.

The pattern this project has already paid for five rounds running — a fix applied to one of two identical sites — is the one I would expect to bite next. F-1 is exactly that shape: the on-chain arm got the repair, the host test did not.