# Round 33 — Independent audit of the whole v6 tree

**Verdict up front: I found no CRITICAL, HIGH or MEDIUM program defect. Two findings survive: one LOW (a stated-count error inside round 32's own repair record — the exact defect class this project's gates keep rotting from) and one INFO (an ordering constraint for item 50's multi-vault redemption client that no document states).** Everything below shows the work, because "I found nothing" from an auditor that looked at nothing is worthless. Where I claim a construct is sound, I name the mechanism I tried to break; where I could not verify (off-chain files not in this bundle), I say so.

---

## R0. Round 32's verdict and its repairs

I read `VERDICT-programs.md` and `VALIDATION.md` as evidence, then re-derived each repair from the bundled source.

**Repair of L1/off-chain-L4 (the coverage gate's cross-focus credit) — present and sound.** `scripts/audit-coverage.sh` `bundles()` now recognizes the FOCUS ternary by its shape (`const TARGETS[^=]*=\s*FOCUS\s*===\s*'programs'\s*\?\s*\[`), finds the split with `\]\s*:\s*\[`, and — the load-bearing part — **fails closed** (`raise SystemExit`) on any header that mentions `FOCUS` in an unrecognized form, instead of falling through to crediting both foci. I traced all five selftest shapes by hand: the three split spellings (`] : [`, `]:[`, `]\n  :\n  [`) all parse to `{programs: {a.rs}, offchain: {b.mjs}}`; `] ; [` and the double-quoted `FOCUS === "programs"` both raise. `first_line_quorate` is an anchored `re.fullmatch` with the focus-exact label, so a combined `VERDICT.md` with a one-focus headline credits only that focus. The repair holds at all sites of its shape (there is one `bundles()`, one consumer).

**The six ship-gate-5 arms — present.** R31.W1a (requires the runtime's own `too large (10241 > 10240)` text, not our wrapper's guard — the wrapper's guard is 20,000, so the runtime is genuinely the refuser), R28.A1 (10,198-byte maximum), R31.W1b (0x28 for a stranger's lone signature), R31.W2a/W2b (pre-funded config/record/ATA), R32.A22a/b (0x1a for the Moments-shaped update authority, with owner controls landing). `MIN_ASSERTIONS = 861` in `run-tests.sh`. All six carry their reason check inline, so no `because` pin is needed.

**DESIGN's three sentences — corrected** in the bundled DESIGN-v6.md (mint index in the `VaultRecord`; `ClaimBeforeBurn` as a sub-sat check with `retire` removing the weight; `sales_stopped`/`sweep_stopped` field names). Present.

**Round 32's W1 refutation (stockpiled restart proposals) — independently re-verified from source.** `restart` clears the flag but leaves `sweep_stopped_at` (MINT `restart`); the guardian's next `emergency_stop_sweep` is a false→true transition and re-stamps; every proposal created before that re-stop is then refused `StopIsNewer` by MINT and skipped as `stop_is_newer` by GOV. Each further window costs a fresh 3-day vote. The refutation holds.

**Round 32's W2 refutation (CloseAccount owner field) — re-verified.** The helper's `read_token` refuses a source closed earlier in the same instruction (owner becomes System → `IllegalOwner`, pinned by SR.12a and SR.12b's "reached the second, closed source" check), and BURN skips the closed account through the non-token-owner branch. Holds.

### Finding 1 — LOW: round 32's own repair record misstates the gate selftest's count

- **Construct:** `audits/round32/VALIDATION.md`, the sentence "Its self-test has 13 both-ways cases" (and "the gate's 13 cases"), against `scripts/audit-coverage.sh`'s selftest, which computes `total = len(cases) + 5` = **9 headline cases + 5 shape cases = 14**, and prints `X/14`.
- **What is gained:** nothing today — the gate's own floor is computed from the code, not the prose. But VALIDATION is the record the next round is told to trust, and this project's single most repeated self-inflicted defect is a stated count drifting from the real one until a gate silently accumulates slack (round 19's `MIN_ASSERTIONS` 284-vs-286; SPEC's "thirteen" vs a real suite size, flagged in SPEC's own warning paragraph). VALIDATION itself says "14 gate cases" four paragraphs later, so the record contradicts itself.
- **Evidence if I am right:** count the tuples in the `cases = [...]` literal (9) and the shape tests (3 splits + 2 bad variants = 5) in the bundled `audit-coverage.sh`; grep VALIDATION for both "13" and "14".
- **Fix:** correct the "13" to 14 in VALIDATION.md, and confirm `bank/selftest.mjs`'s assertion (which round 32's verdict says asserted "8/8" at `dee953e`) now matches whatever the 14-case selftest prints — that file is not in this bundle, so I could not check it; if it still pins a literal count string, it must read 14.

---

## R1. Custody: the seal/burn pairing and the emptiness proof

I attacked the pairing, the proof, and the "thawed vault survives" question. No defect found. The dead ends, so the next reader doesn't re-walk them:

- **CPI wrappers.** `retire_redeemed` requires `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1` (a direct CPI from a top-level program) *and* that the top-level instruction be BURN's `burn_vault` for this asset (instructions-sysvar, top-level only). A wrapper CPI-ing `burn_vault` puts `retire_redeemed` at height 3 → refused. A wrapper CPI-ing `retire_redeemed` directly is at height 2 but its top-level instruction is not BURN → refused. SEAL's forward walk and BURN's backward walk both bind asset (account 0) and owner (account 2), so neither half can be borrowed from another vault's redemption in the same transaction (suite 3.9/3.10/9.0/4.10/4.10a, wrapper arms WR.1–WR.4).
- **The Token-2022 derivation addresses.** This is the question R1s(e) poses, so I chased it fully. BURN requires *both* ATA derivations per reserve mint to be declared. A T22 token account for a classic mint cannot be initialized (Token-2022's account init loads the mint and rejects a mint owned by the classic program — the ATA-program refusal the probe measured at F4.2 is the same wall one level up), so the T22 derivation can only ever be a System-owned or non-existent account, which BURN skips by owner. **The one thing a stranger can put at the T22 derivation is a classic Token account owned by the vault PDA with dust in it** — that blocks the burn (`VaultNotEmpty`) until swept, but the sweep helper *can* name it (any classic 165-byte account owned by the asset-signer, ATA or not), so it is rescuable by exactly the page behavior SPEC 44 already documents ("the helper moves any classic token account the vault PDA owns, of any mint, ATA or not"). No unrescuable blocking account exists.
- **Lamports.** The helper drains the wallet to zero at execution; Core's `BurnV1` neither adds nor removes signer lamports (measured fact 4), so BURN's `lamports == 0` sees exactly what the sweep left. A later instruction in the owner's own transaction crediting the PDA would fail the owner's own burn — self-inflicted only.
- **Closed accounts pass for the right reason:** after the helper's `CloseAccount`, the account is System-owned with 0 lamports and empty data; BURN's reserve loop skips it on owner and the second loop skips it on lamports. Double-covered.

## R1s. The sweep helper

(a) Access control rests on Core's `ExecuteV1` owner rule on a thawed vault; SR.5/SR.5a/SR.5b/SR.5c/SR.5d/SR.5e measure stranger, transfer-delegate, collection-authority (ours is MINT's off-curve PDA) and control-asset cases, and the AgentIdentity route is refused to owners (R24.1a) and even to keypair update authorities without the registry PDA (R24.1c). Direct calls need the asset-signer's signature (SR.1). While frozen, Execute is refused by the seal itself (3.7, D5.3). Sound.

(b) Pair list: duplicate source fails closed on the second read of the closed account (SR.12a/SR.12b); source==destination is impossible (owner checks conflict, and `signer == dest` is refused); duplicate destinations are harmless; wSOL sources work (transfer then close, rent to the wallet); a delegated source fails the transfer (fail-closed, owner revokes via Execute — known, 3.3); frozen sources revert the redemption (SR.14, limit 28); non-ATA destinations work by design; another vault's asset-signer as destination wallet is the redeemer's own choice of where their value goes.

(c) The destination is chosen by whoever builds the transaction, and through Core that is only the owner. A lamports-only sweep to a non-existent destination fails (System transfer doesn't create accounts) — item 50's "the canonical destination is the owner" covers it; R27.S1 measures crediting a non-System destination.

(d)–(g) Covered in R1 above and in the S8.0/S8.1a measurements (1,061 bytes; 168,343 CU; the widest page shape ~1,209 of 1,232 with 23 bytes spare). The helper's suite deployment is proven byte-identical to the shipped bytes twice over in `build-mainnet.sh` (against the fresh localnet build *and* `target/deploy`).

## R2 / R2b. The pool and the boost

I re-derived the invariant "pool ≥ ceil(owed)" through every mutating path: `credit` (owed grows by `delta·w ≤ avail·SCALE`, balance unchanged), `claim` (balance and owed both fall by exactly `pay`, and `ceil(x−k) = ceil(x)−k` for integer k), `retire` in all four modes (redeemed/forfeit/bare, active/pending), `join`, `reweigh`, `expire_boost`. It holds structurally, and the suite's `ledger()` re-checks it from the records after every money operation in sections IN/3c/P.

Counters: `pending_count`/`pending_this_epoch` stay consistent under every retire ordering because `pending_this_epoch` is zeroed at each `advance_epoch` and `join` (which only fires for earlier-epoch requests) correctly never touches it — F21.1 exercises exactly the both-counters retire. Liveness: every gate (`JoinWaitingFirst`, `BoostsExpireFirst`) has a permissionless exit (claim joins; `expire_boosts` needs only records, and 30 records fit a legacy packet — I recomputed: 64+3+1+31·32+32+1+42 = 1,135 ≤ 1,232). A vault's recorded ATA cannot be closed while sealed (Execute is frozen), so no third party can manufacture a `VaultAccountMissing` wedge.

Boost ring: the `N ≤ 63` bound means a boost bought at epoch `e` lands in a slot last drained at `e+N−64 ≤ e−1`, and the only other boosts that can share the slot end at exactly the same epoch, so they fall due together — the 260-epoch host test through the program's own functions covers four wraps including early/due retires at wrapped indices. No double-expiry (weight zeroed), no early expiry (`BoostNotDue`), no lost earnings (carry moves the owed share across every weight change; the suite's `books()` re-derives the totals from records).

## R3. The level draw

The SlotHashes parse is defensive and fail-closed (count ≤ 512, length checked, zero-hash refused, key pinned). Window arithmetic: C ≤ reveal_slot + 208 < the 300-slot window < the 512-slot buffer, so an in-time capture always finds all three hashes. FIFO is enforced by `index == revealed_total`; a burned head still draws (the Core write is skipped) so the queue never stalls. SPEC 26's statement matches the code, and HOLDER-GUIDE's draw sentences ("can be enough to choose the level", "a draw nobody records in time is drawn again") are true of it.

## R4. Governance

Ordering marks: an already-over round still moves `last_round_id` before skipping (RT3-4, fixed); each kind is marked exactly at its execution; `TightenSweep` is monotone (max/min) so it needs none. The key-change bar (half of the *snapshotted* live supply), the un-bundling rule, the notice, and the guardian's inability to cancel its own replacement are all as SPEC states. I could not construct a minority path: at the ruled numbers the smallest passing ordinary vote is 10.71% YES, above the 10% turnout floor (limit 35's claim re-verified), and key changes need 50% of the snapshot. Frozen-forever paths are the documented ones (limit 45's terminal state; limit 47's low-turnout guardian stop).

## R5. The charter claim

The Merkle scheme is domain-separated and sorted; the JS builder and the Rust verifier are proven to agree by the program accepting JS-built proofs, and the selftest refuses outsiders for all 240 leaves. `pob_extra` accounts are passed through never as signers. SPEC 46 is, as far as I can construct, complete about the hot wallet: it names the brick, the capture, the per-asset alarm blind spot, the sampling gap, and the positive bound (which round 32 measured and this round's suite now pins as R32.A22a/b). The one residual I looked for — a PermanentFreezeDelegate added to the collection to freeze individual PoBs — is the same brick class as the rejecting oracle and falls inside 46's stated "add a plugin that REJECTS every charter claim" / per-asset discrimination bound.

## R6. One-time configuration and the trusted hop

The programs check less than `check-launch-params.mjs` (SEAL reads only owners; `charter_opens_at` may be in the past; the $CBOB mint's authorities are unread) — all stated by item 38/A2, and the launch file still shows `charter_opens_at` and `lock_deadline` OPEN, so nothing has quietly closed. The swap operator's worst case is cap × windows until the guardian stops (limit 10, correctly stated as a rate, not a total). The royalty's `PluginAuthority::None` immutability is measured both ways (R.3–R.6c). The redemption cap is exactly a rolling window over a 64-entry ring; I re-derived the k-th-most-recent index arithmetic and the initialization-to-zero semantics, and RL.7's replay (each redemption against its own interval-certified cap) is a sound check of the claim.

## R7. Cross-program raw reads

I recomputed every offset from the struct definitions: all 30+ MintConfig offsets GOV and BURN pin (141, 191, 192, 193, 225, 257, 266, 274, 442, 454, 518, 526, 631, 639, 647, 711, 712…), VaultRecord (9/41/125/126/177/186/187/195, total 221), BurnConfig (42/50/58/59, space 827), SEAL config (9/41, space 398), GOV config (space 350), the sweep helper's token-account offsets (0/32/64/108/165), and the mint layout (44/45/82). **All correct.** The suite pins every discriminator against its Anchor derivation at runtime (3.1a–3.1t), which I cannot improve on by hand.

## R8. The suite, simulation and build as evidence

Arms that could be false passes were my priority; the ones I checked hold: `P.11a`'s fixed five-level expectation line (a wrong payout produces a mismatched string), `SR.12b`'s negative pin (the duplicate-source refusal must *not* be the first guard's), `S7.2!`'s one-reason prediction, `X.7`'s honest restatement of what an empty plan proves, `ID.1`'s uniqueness check, `RL.S1–S6` (harness self-tests with real want values), and the `because` pins I spot-checked (0x11 for frozen accounts, 0x1a for Core authority refusals, the runtime's own size text for R31.W1a). The floors equal their counts everywhere I recomputed (861/907/39/47/6/33/4/14/23/71/16). The `initauth` probe's argument encodings match all four `initialize` signatures field-for-field, and each program's `REACHED_PAST` error is genuinely below the authority check.

### Finding 2 — INFO: an unstated ordering constraint for multi-vault redemptions in item 50's client contract

- **Construct:** MINT `retire_redeemed`'s trailing `monthly_inline`, versus `claim`'s leading `monthly_inline` (`programs/cbob-vault-mint/src/lib.rs`).
- **Mechanism:** within one transaction, due-ness of the month can only go true→false (whoever runs it stamps `last_distribute_at`) — **except** when a claim's monthly was *blocked* (`boosts_due > 0` or an eligible vault waiting) and a later instruction in the same transaction unblocks it (an `expire_boosts`, or a joining `claim`). Then the first `burn_vault`'s in-line monthly credits every still-active vault — including one whose `claim` already ran earlier in the transaction. That vault's burn then refuses `ClaimBeforeBurn`.
- **What an attacker gains:** nothing; this is a self-grief. The failure is a reverted, retryable transaction with a named error. But the holder guide promises the redeem page "offers to trigger (and join) a payout first", so the page will build exactly the shapes that can hit this (a join-claim, then a burn, then a second vault's already-claimed burn).
- **Evidence if I am right:** on any validator, one transaction `[claim B (B waiting → joined, monthly blocked by B itself), open A, sweep A, burn A (monthly now unblocked and due → credits B), open B, sweep B, burn B]` fails with `ClaimBeforeBurn` on B; the same vaults in per-vault `[claim, open, sweep, burn]` sequences succeed.
- **Fix:** one bullet in item 50's client contract: in a multi-vault redemption, a vault's `claim` must come after any *earlier* burn in the transaction (or the page uses strictly sequential per-vault claim→open→sweep→burn groups, which is always safe — I verified both orderings against the code). No program change needed or possible after the lock; this is documentation of an existing constraint.

---

## The four questions on the accepted limits

**1. Is any limit WORSE than stated?** I attacked 28, 32, 41, 44, 46, 47 and found none worse than written. Two near-misses I worked through: a frozen *zero-balance* reserve account does not actually block a redemption if the page omits it from the sweep (BURN reads `amount == 0` and passes; the stranded rent is the redeemer's own loss, already item 50's "close every reserve account" bullet) — so 28 is if anything slightly *over*-stated for the zero-balance case, which is the safe direction. And the T22-derivation classic account (R1s(e) above) is rescuable by the helper, so it stays inside 44's "the helper moves any classic token account the vault PDA owns".

**2. Is anything listed as a limit not actually a limit?** Limit 35 re-verified numerically: at quorum 21% / threshold 51%, the smallest passing vote is ⌈0.51·⌈0.21N⌉⌉ ≥ 10.71% of N > 10%, so the turnout rule genuinely never binds at the ruled numbers and is correctly kept as a floor for other initialize values. Limit 42's round-26 correction (the narrow 1,219-byte three-create variant fits) is accurately scoped as a measurement, not the page contract.

**3. Is any DISCHARGED item not actually discharged?** 51 (boost) is built and measured end-to-end including the ring wrap on-chain (BO.34/BO.38). 54 (compute) is measured with the v6 arms and its holder-page consequence is correctly folded into item 50. 14, 19, 30, 31, 33 are closed by the cited on-chain arms. I found no false discharge.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 all remain open in SPEC and the road table; `launch/mainnet-init.json` still shows `charter_opens_at` and `lock_deadline` as OPEN; the holder guide is still marked DRAFT with item 50's publication ban intact.

---

## What I could not verify from this bundle

`bank/alarm.mjs`, `bank/detectors.mjs`, `bank/selftest.mjs`, `bank/crank.mjs`, `bank/revenue.mjs`, `bank/swap.mjs`, `scripts/check-launch-params.mjs`, `scripts/cron-install.sh`, `sim/swap-fork.sh` and the round audit scripts are not in this prompt. The coverage gate asserts their current content was delivered to a completed, quorate round; I can only audit the two that are bundled (`txread.mjs` — whose validation I checked against the bundled v1 fixture, including the `truncatedLogs` refuse/flag split and the v1 no-lookup-table-key rule; and `sigwalk.mjs` — whose paging, sentinel semantics and `startBefore` resume I traced). Round 32's off-chain repairs (`sweep_unledgered_state`, `tx_unreadable`, the never-evicted gap list) live in the unbundled files; I accept them on VALIDATION's 907/907 run and note that this round's bundle therefore cannot re-verify them — the coverage gate's own standard says they were shown to a quorate round, which is the process working as designed.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what should this project do before launch that AI audit structurally cannot?

1. **Execute item 22's rehearsal with a human at the terminal, and treat its named pass/fail list as the launch decision.** The crank against ~2,100 real accounts, one full revenue cycle through *each* pool with Orca forced to refuse once, and one forced post-sweep failure walked through the hand recovery by hand. No prompt-based round can exercise live I/O, rate limits, or a transient RPC error on vault 1,900 of 2,100. Record the signatures.

2. **Build and personally use the redeem page (item 50) end-to-end on the rehearsal deployment before anything mints.** It is the only remaining preventive control for limits 9 and 44, it is the precondition for road step 11, and a human clicking through the real flow — coverage warning, prior-transaction ATA creation, claim-before-sweep, helper sweep, the multi-vault ordering note from Finding 2 — is the only test of the client contract that matters.

3. **Do the initialize read-back ceremony with two people.** Build the four transactions *from* `launch/mainnet-init.json` (item 38's A6 gap is that the checker validates JSON, not transactions), sign, **simulate, then read every field back off-chain against the file before broadcasting** — and only then set `charter_opens_at` and `lock_deadline`. After the authority is removed, a wrong value is forever.

4. **Verify the deployed bytes and the upgrade-authority removal on-chain, witnessed.** Compare the five on-chain program hashes against `build-mainnet.sh`'s SHA256SUMS at the release commit, confirm all five upgrade authorities are gone, and have a second person (or a recorded screen capture) attest to it. This is the single most irreversible minute of the project and it is a human act.

5. **Run a randomized property test of the pool arithmetic before the lock.** The suite's `ledger()` checks the books after every money operation *along the suite's fixed path*. A few thousand randomized operation sequences (credit/claim/join/retire/reweigh/expire in random legal orders, asserting `owed == Σ records' owed` and `pool ≥ ceil(owed)` throughout) is mechanically checkable in an afternoon and covers orderings no fixed script visits. The host tests already do a constrained version; generalize it. This is the one place where the money code's correctness can be *proven* rather than sampled, and AI review structurally samples.

6. **Soak the alarm and crank in production mode against the real (empty) deployment for days before the charter opens.** The scan-flood, log-gap, backlog-drain and `sweep_unledgered_state` paths have never seen genuine mainnet noise; the dead-man's switch has never fired for real. Let them run against the live cluster with nothing at stake.

7. **Write and rehearse the charter-window runbook.** Who watches what during the 7 days, who can reach the guardian wallet, what the response is to a Metaplex Core upgrade announcement mid-window (limit 40), and the pre-agreed decision tree for "alarm pages at 3 a.m. on day 2". AI audits reason about code; nobody reasons about a 7-day live window at 3 a.m. without a runbook.

8. **Have a human verify key custody as a physical fact.** The guardian wallet, the swap operator key, the $CBOB release wallet, and the box itself (limit 10's residue: the ledger, crontab and alarm share one user). The documents pin *addresses*; only a person can confirm the *secrets* are where the documents say, with the stated protections, and decide whether the $CBOB release wallet moves to a Squads before launch — that is Gary's call and limit 56 says so.

9. **Accept that the last audit layer is time.** Consider a canary: Gary personally claims one real Proof of Burn early in the window, verifies the vault, funds and redeems a small amount through the real page, before the window is broadly announced. It costs one charter slot out of 240 and buys the one integration test no validator can provide — the real chain, the real Core, the real page, the real key. If that cost is unacceptable, the Test Vault simulation is the substitute, and its boundaries are already stated honestly.

**Result: no program defect confirmed above INFO. One LOW (VALIDATION's 13-vs-14 count) and one INFO (the multi-vault claim/burn ordering note for item 50). The clean-round counter is a matter for the freeze log; nothing here should reset it, but both findings should be repaired and the LOW's underlying count check confirmed against `bank/selftest.mjs` before this tree is declared clean.**