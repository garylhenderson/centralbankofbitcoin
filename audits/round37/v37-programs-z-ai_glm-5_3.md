# Round 37 — independent audit of the whole v6 tree, and round 36's verdict

**Audited tree:** as bundled (round 36's `9480314` plus the two post-audit `web/` commits `667731c`, `6bc3b49`, which touched only `web/README.md`, `web/meta/generate.mjs`, `web/src/config.js`, `web/test/meta.test.mjs`, `web/test/run-all.mjs` — none of `programs/`, `bank/`, `scripts/`, SPEC or HOLDER-GUIDE).

**Headline:** Round 36's eight confirmed findings are all repaired at their sites, its refutations I re-tested hold, and I found **no defect in the five programs**. I confirm **one LOW in the holder pages' policy (with a HOLDER-GUIDE sentence that over-promises against it), one LOW documentation mismatch, and one INFO wording mismatch**. Nothing moves value out of a vault, the pool or the revenue address that should not. The clean-round counter stays **0/2**.

---

## R0. Round 36's verdict and repairs — verified

### H1 (HIGH, redeem page): repaired, and the repair holds at every site of its shape

The attack: a stranger mints a token, keeps the freeze authority, puts one unit in the vault, and freezes the holder's own receiving ATA — every plan then delivered the stray into a frozen destination and the dry run failed, with no path that dropped it. I verified the repair in `web/src/lib/plan-redeem.mjs`:

- `readRedemptionSnapshot` now carries `ownerAtaFrozen` (with an unparseable destination read as frozen — fail-safe) and `mintFreeze` per mint (`web/src/lib/reads.mjs`).
- `undeliverable()` drops a stray from delivery when its destination is frozen, its mint is unreadable, or its mint has any freeze authority (reserves excepted — they must be delivered, and a frozen reserve destination is a refusal, which is the disclosed Coinbase limit).
- The loop covers **both** `helperStrays` and `transferStrays` (the C5 path), so the same rule binds the plain-transfer route.
- The re-plan just before signing sets `noPrior`, so a stray whose destination arrived late is dropped, never a second set-up transaction.
- The `dropStrays` fallback after a failed dry run drops **every** stray, re-acknowledges, and still opens.

The suite arms (`R36 H1` vectors in `plan.test.mjs`, alone and all at once) and the e2e (a stranger freezing the holder's own account for a stranger mint: left behind, named, opening lands) exercise it. The reserve half is a refusal with a reason; the lamports-only sweep destination is the owner's own wallet, which cannot be frozen. I could not construct a surviving vector: every remaining way a stranger can block an opening is either a refusal with a reason (reserve problem, nested CBOB vault, non-owner) or a named, ticked box.

### L1–L5, I1, I2 — all repaired

- **L1 (proxy relay):** `txRefusal` now requires a CBOB program in every relayed transaction, with the three exact page shapes without one (ATA creates, the ceremony's collection create with MINT's PDA as update authority, System transfers to the revenue address). `proxy.test.mjs` refuses a plain SOL transfer, a plain SPL transfer, an ATA-create followed by a token transfer, a Core instruction that is not the collection create, a collection create with another update authority, a System transfer to anyone but the revenue address, and compute-budget-only — and accepts every transaction the pages build. Verified.
- **L2 ("Run a payout" vs due boosts):** `planPayout` now expires due boosts first (`expire_boosts` batches of 20 ≤ MINT's `MAX_EXPIRE_BATCH` 30), joins waiting vaults in batches of 14, then distributes; it re-reads MINT's settings and refuses before anything is burned if the counts differ. The e2e lands a real due boost cleared by the page's own plan, with the control distribute refused `BoostsExpireFirst`. Verified.
- **L3 / I2 (SPEC text):** the C5 limit now says the page names each in a box the holder ticks; item 38 now lists `vault_collection` as produced at step 10. Verified against the bundled SPEC.
- **L4 (release binding):** `web/build.mjs` now refuses unless `dist/MANIFEST.txt` names `RELEASE_COMMIT` (`0b3ddb3`) clean, and each pin equals `dist/SHA256SUMS` and the file's own hash and length; `bundle.test.mjs` proves each refusal with a doctored `dist/`. Verified.
- **L5 / I1 (ceremony reference and step-9 wording):** the README hash table now covers both `mainnet` and `mainnet-local`, `bundle.test.mjs` compares a fresh build of both against it, the footer points at the README table, and the ceremony page says step 11 (not step 9) makes the programs final. Verified.

### Round 36's refutations — re-tested

- **W1** (helper destination = another vault's asset-signer): correctly refuted. Core's `ExecuteV1` approves only `authority == owner` of the asset being executed; the helper's signer is vault A's PDA, reachable only through A's owner. A's owner choosing to sweep A's contents into B's wallet is the owner moving their own value, which a plain transfer already lets them do.
- **W2** (claim-first redemption never landed): correctly refuted as a defect. SEAL scans forward from the open for the burn; BURN scans `0..current` for the open; `retire_redeemed` checks stack height and the current top-level instruction. A `claim` before the open changes neither walk, and the instruction bytes are proven equal to the suite's builders. The landing was a real gap and is now Gate-5 item 4, landed in the e2e (an active vault, a month due at the opening, the claim runs the month in-line, `retire_redeemed` does not refuse, the pool falls by exactly the delivered share, nothing owed after).
- **W3–W14** spot-checked against the code; none reopens.

### Quorum and counter

Seven substantive of eight seats against six required — met. The counter correctly stays 0/2: findings survived round 36, so neither round counts clean.

---

## R1. Custody — no surviving path

- **The pairing.** Both halves bind asset (index 0) and owner (index 2); discriminators are asserted against their Anchor derivations in the suite (3.1a–3.1f); a `burn_vault` or `open_for_redemption` reached through the test-only CPI wrapper sees the outer instruction's index and is refused in both directions (WR.1–WR.4). Two vaults in one transaction pair independently (4.10a). A deposit between sweep and burn would have to be in the owner's own transaction.
- **The emptiness proof.** Every reserve mint's ATA under both token programs must be declared; a declared account owned by neither token program is skipped (a non-existent T22 derivation for a classic mint arrives system-owned at 0 lamports and is skipped — and the ATA program refuses to create it, F4.2). Delegate, close-authority, extension and balance checks are identical in the reserve loop and the undeclared loop. `asset_signer.lamports() == 0` is kept (proven impossibility 4).
- **No thawed vault survives a transaction.** The thaw is a Core plugin write inside the same transaction as the burn; a partial sweep reverts it (3.11).

## R1s. The sweep helper — holds

(a) Access control is Core's `ExecuteV1` rule: owner only, measured against the pinned binary (SR.5/SR.5a refuse a stranger and an owner-added transfer delegate on a genuinely thawed vault; SR.5b pins the collection authority to MINT's off-curve PDA; R24.1a refuses the AgentIdentity route). (b) The pair checks refuse every malformed shape I could construct (SR.6–SR.12a, SR.14); a duplicate source fails on the closed account; a source that is also a destination is impossible (signer ≠ dest is enforced). (c) The destination wallet is chosen by the transaction builder, but only the owner can reach the helper, so the destination is the owner's own choice; a non-System destination is measured safe (R27.S1). (d) The lamport sweep reads `signer.lamports()` at execution; nothing between sweep and burn can credit the PDA except the owner's own instructions. (e) A stranger's classic ATA for a reserve mint is the canonical declared account — swept, not skipped; a T22 ATA for a classic mint cannot exist; a non-ATA T22 account owned by the PDA is undeclared and invisible to BURN (item 44, accepted). (f) S8.0's 1,061 bytes reserves room for the compute-budget pair (+52) and a separate fee payer (+96): 1,209 of 1,232. A fourth reserve mint cannot exist. The in-line monthly run rides inside `claim` at no extra accounts. (g) The helper's mainnet bytes are proven identical to the tested localnet bytes and to `target/deploy` (`build-mainnet.sh`), and SR.0 confirms it is deployed in the suite.

## R2 / R2b. The pool and the boost — invariants hold

- **"The pool always holds at least ceil(owed)":** `credit` adds `w·⌊avail·SCALE/w⌋ ≤ avail·SCALE` to `owed_scaled` with `avail = balance − ceil(owed)`; claims subtract exactly what they pay; retires subtract a component of owed. The suite's `ledger()` recomputes owed from every live record after every money operation (BK.*) and P.32 asserts the bound. `monthly_inline` uses `saturating_sub` and credits nothing when short.
- **Counters under every ordering:** `pending_count`/`pending_this_epoch` are decremented only on retire of a pending record, same-epoch vs earlier-epoch both handled (F21); `advance_epoch` resets `pending_this_epoch`; the join gate (`dist_epoch > request_epoch`) and `JoinWaitingFirst` (`pending_count − pending_this_epoch`) are consistent, and the page's `waitingVaults`/`dueBoostRecords` reads match MINT's skip conditions exactly (I re-derived the dataSlice offsets 125/70: active, retired, boost_weight at 61, boost_end at 62–70 of the slice — correct).
- **Boost exactness:** the ring bound of 63 (< 64) guarantees a boost's slot is not consumed before its end epoch; `BoostsExpireFirst` plus free `expire_boosts`/claim expiry means a boost earns exactly N distributions; `reweigh` moves owed to carry and restarts debt, so nothing earned is lost or gained on any weight change; the host model test drives 260 epochs through the program's own free functions with the ring wrapped several times, and the on-chain BO.34/BO.38 arms land the wrapped cases. Nobody can make distributions impossible: every gate-clearing instruction is permissionless.
- **Liveness:** the only stall shapes left are the accepted ones (a wedged crank is survivable via in-line monthly runs and pages `crank_silent`; a frozen pool forfeits rather than locks, 3c.F0–F3).

## R3. The level draw — holds

The SlotHashes parse is pinned to the sysvar id, bounds the count at 512, checks the buffer holds the count, and refuses an all-zero hash. The skipped-slot rule (smallest produced slot in `[want, want+64]`) is deterministic and host-tested; the FIFO is enforced by `mint_index == revealed_total`; a burned vault at the head still draws (L.11); the attribute re-supply is hash-checked. SPEC 26's statement of the C-leader residual (best-of-4 by skipping alone, more by varying contents, cohort-wide) matches the code, and HOLDER-GUIDE's honest-list entry says it truly, including the cohort effect. I do not find it worse than stated.

## R4. Governance — holds

One vault one vote bound to the asset (transfer-and-revote refused, 7.8/7.9); electorate fixed at creation (`index_snapshot`, `VaultTooNew`); divisor is the snapshot, never `max`; quorum/threshold/10% turnout/half-of-all for key changes all enforced at execute; key changes never share a proposal; notice before apply; the guardian can cancel a pending operator but not its own replacement; overtaken actions are logged skips. A minority cannot carry anything it should not: MINT independently bounds every action. A stolen guardian key's stop is permanent below half turnout — stated (47) and I find nothing worse.

## R5. The charter claim — holds

Identity by address against the domain-separated, sorted-pair Merkle root; the PoB is CPI-burned as its owner in the same instruction; `pob_extra` accounts pass through never as signers; the window is clock-only and cannot reopen; not gated by the guardian. SPEC 46 is complete as far as I can construct: the hot Moments key can gate or brick claims through the window and capture the electorate, cannot take a PoB, and the exposure ends with the window.

## R6. One-time configuration and the trusted hop — holds

Every `initialize` refusal I checked fires for the named reason (0.1e–0.1v, 0.2, 0.3, 7.0 arms). The swap operator's worst case is the ruled cap × cooldown windows above the reserve until the guardian stops it — stated, buyer-facing. The 10% royalty is authority-None and Core refuses every update, removal and re-delegation (R.5/R.6/R.6a–c, R33.G3). The redemption cap is exactly a ring of the last 64 redemption times with the cap-th most recent a full window old; I re-derived the page's `rateLimit` and it matches BURN field for field.

## R7. Raw offsets — recomputed, correct

I recomputed the MintConfig, VaultRecord, BurnConfig and GovConfig layouts from the Rust structs. GOV's reads (governance 41, minted_total 141, bare 454, charter close 442, stops 191/192 and 518/526, bounds 631/639/647, boost bounds 711/712, sol_reserve 257, max_sweep 266, cooldown 274), BURN's (minted 141, bare 454, burned_total 42, window 50, head 58, ring 59) and the sweep helper's (mint 0, owner 32, amount 64, state 108, length 165) all agree with the structs and with the suite's pinned constants. One near-miss worth recording: the proxy's `mint-waiting` shape requires base58 `'2'` at offset 177 while `waitingVaults` sends `bs58.encode([1])` — these are the same thing (base58 `'2'` is the byte 0x01), and the proxy test's refused arm (`'1'` = 0x00) confirms the encoding is deliberate. No misread.

## R8. The suite, simulation and build as evidence

I looked for arms that cannot fail and for wrong-reason refusals. The `because()` pins are extensive and each names a distinct error; the few trivially-true arms (10.1, 9.13a, R.9) are measurement-harness arms whose failure mode is a broken measurement, which is what they exist to catch. X.7 says plainly that it shows an empty plan. The floors equal the counts (895 on-chain, 71 sim, 518 web, 920 detectors, 49 launch, 24 poster, 4 expiry), and `run-tests.sh` enforces equality. `build-mainnet.sh` proves all four keyed programs both ways and the helper's bytes three ways. The rehearsal reverse-map proof and the abbreviated-id refusal are sound.

---

## The four questions about the accepted limits

**1. Is any limit worse than stated?** I attacked the load-bearing ones. Limit 32's ring bound ("stricter, never looser, past 3,047 live") is arithmetically right. Limit 44's helper sweep list is now narrower than the text implies (the page will not deliver freezable-mint strays since the H1 repair) — see Finding 1. Limit 26's cohort grind is stated at its true width. Limit 55's unsplit-revenue edge is bounded by the crank's every-pass split and correctly costed. I found nothing exploitable beyond what is written.

**2. Is anything listed as a limit not actually a limit?** No. Everything I re-tested that is claimed closed is closed (14, 19, 30, 31, 33 all verified against the code).

**3. Is any discharged item not discharged?** No — spot-checked 19 (no unlevelled-active state exists), 30/31/33 (the values are `initialize` parameters and the paths are exercised), 12/17 (the measurements and ceilings are as recorded).

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 all remain OPEN in this tree; `charter_opens_at`, `lock_deadline` and `vault_collection` are OPEN in `launch/mainnet-init.json`; the round-36 validation restates all of them as blocking. Nothing has been demoted.

---

## Findings

### F1 — LOW: the H1 repair's "mint has a freeze authority → never delivered" rule destroys deliverable holder value, and HOLDER-GUIDE over-promises against it

**Construct.** `web/src/lib/plan-redeem.mjs`, `undeliverable()`: a stray is never delivered when its mint has **any** freeze authority (reserves excepted). HOLDER-GUIDE.md ("Things to know before you open"): "The redeem page … will take out the other ordinary tokens it safely can."

**What is lost.** Most major Solana tokens (USDC, USDT, and generally any token with an issuer-held freeze authority) fall under this rule. A holder who legitimately holds such a token in their vault is today shown "It is left in the vault because whoever issued this token can freeze accounts … It is lost when the vault is opened," and must tick that box; the token is then destroyed by the opening. The page could deliver it: the same file's dry-run-failure → `dropStrays` path (tested in `plan.test.mjs`: "after a dry run failed on a stray, the re-plan leaves EVERY stray behind, named, and still opens") already makes optimistic delivery un-blockable — a freeze that lands is caught by the dry run, the stray is dropped, the opening lands, and the attack costs the holder one free failed dry run rather than their tokens. Round 36's verdict itself marked the mint-freeze half of the repair "**optionally**"; the implementer took the option, and the cost is real.

**Evidence if I am right.** Offline: build a snapshot with a USDC-shaped stray (classic account, mint with a freeze authority, unfrozen source and destination) and run `planRedemption` — the stray lands in `ack` as lost, not in `helperStrays`. On a validator: freeze nothing, and the same plan refuses to deliver a perfectly movable balance. The guide sentence and the page behavior disagree in that run.

**Fix.** Either (a) deliver such strays optimistically and rely on the existing `dropStrays` path (the strictly better trade: the common case keeps the holder's tokens, the attack case costs one dry-run retry), or (b) keep the policy and add one sentence to HOLDER-GUIDE naming the exclusion: tokens whose issuer kept the power to freeze accounts are **not** taken out; they are named and lost. As written, "the other ordinary tokens it safely can" invites a holder to expect USDC out.

### F2 — LOW (documentation): HOLDER-GUIDE promises an announcement that nothing sends

**Construct.** HOLDER-GUIDE.md, "What is true about your vault, always": "Every opening is public. It is announced on X and on the Bank's website."

**What is wrong.** `bank/redemption-poster.mjs` drafts the posts and has **no sender**; no website surface is chosen. README open decision 9 and SPEC item 50 say so, but the guide — the holder-facing document — states it in the present tense with no condition. The guide's publication gate (item 50) covers the pages, not the sender.

**Evidence.** Run the poster: it drafts. Grep for a sender: none. The guide's own publication rule is the only thing standing between this sentence and a false promise.

**Fix.** One conditional sentence ("each opening is posted publicly; the posts are drafted automatically and published with the Bank's go-ahead"), or ship the sender before the guide publishes. Under the round-37 ruling this is documentation-only and misstates no program behaviour — but it misstates what the *Bank* does, and a holder reads it as a promise.

### F3 — INFO: the vault page's frozen-cbBTC activation refusal misstates the program

**Construct.** `web/src/lib/plan-vault.mjs`, `planActivate`: a frozen vault cbBTC account returns "it cannot activate until Coinbase unfreezes it." MINT's `activate` ignores the token state (`let (amount, _) = read_token(…)`), so a frozen account **can** activate on-chain; its payouts then defer per limit 28.

**Cost.** None — the crank activates anyway, and a frozen vault cannot be redeemed either way. But the page's message is false about the program, and a holder who reads it will wait where waiting buys nothing.

**Fix.** Reword ("the page will not ask while Coinbase has it frozen; payouts to a frozen account defer until it is unfrozen") or allow it.

---

## Gate status

- Gate 1 (coverage): satisfied for the audited tree per the bundled manifest method; the current tree's `web/` changes are post-audit and will need a round.
- Gate 2/3 (frozen, two clean rounds): **0/2**. Round 36 was correctly not clean; my findings F1 (page behaviour on holder value) and F2 would also need repair or acceptance before any round counts.
- Gate 4/5: the round-36 Gate-5 obligations (H1 arms, proxy refusals, the due-boost payout, the claim-first landing, release binding, the C5 measurement, the bundle hash table, the R34.G2 reason pins) are all present in this tree and I verified each against the code.
- Items 22, 38, 50, 52, 53 remain OPEN AND BLOCKING. Nothing here authorizes a deploy, an initialize, a lock, a cron install or a publication.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE: what this process structurally cannot do, and must be done before the upgrade authority is removed

1. **Read the artifact, not the source.** Thirty-seven rounds have audited Rust. The thing that ships is an ELF. Before lock: rebuild all five programs from the release commit on a **second, independently provisioned machine** with the pinned toolchain and byte-compare against `dist/SHA256SUMS`; then have a person who did not write the code drive the deployed programs' full refusal surface by hand at the real ids — before and after `set-upgrade-authority --final`. The ceremony page probes five instructions; a human should walk the error enum.
2. **Operate real time.** No round has exercised a real 7-day charter window, a 3-day vote, a 30-day month, a 7-day notice, or a 1-hour redemption window at ruled values — every one an `initialize` value that becomes permanent. Run one full real-duration cycle on the rehearsal deployment (open → claims → close → vote → round → activation → month → redemption) with the alarm live and a human reading every page.
3. **Use real wallets.** The only unmeasured behaviors left are wallet behaviors: does Phantom modify `signTransaction` messages on desktop and on mobile (U1)? Does a real Squads v4 vault execute a Core `TransferV1` return (U2)? Does Gary's actual Phantom complete the ceremony and the claim page end to end? These are one afternoon of a human's time and they close the last uncertain items on the books.
4. **Run the live system and read the logs.** Item 22's named rehearsal items — the crank against ~2,100 records, the alarm in rehearsal mode, one full revenue cycle through **both** pools with Orca forced to refuse once, and one forced post-sweep failure walked through the hand recovery by the person who would do it in an incident — are operator work, not audit work. An AI round reads the code that would log; nobody has yet read the logs of a real failure.
5. **Verify custody and the box.** File modes, backup restores, the deploy-authority key, the release wallet, the hot Moments key, the swap operator key — none of this is verifiable from the repository, and all of it is load-bearing. A person should confirm each by hand at launch, and re-run `probe-mainnet-facts.mjs` (the PoB set, the reserve mints' freeze authorities, the Squads ATA, the pinned Core hash) the same day anything is signed.
6. **Comprehension and law.** Whether HOLDER-GUIDE's sentences are understood by a real holder, and whether any of this is a security offering, are human questions. The guide is DRAFT; test it on someone who has never read SPEC.
7. **Answer the pager.** Metaplex will upgrade Core; Coinbase may freeze; the alarm will page. The runbooks exist on paper; the person on call must have executed them once in anger before the programs are final.

The audit process here — floors that equal counts, reason pins, coverage gates, repairs validated by measurement — is the strongest I have read. Its structural blind spot is that it always audits the same tree with the same eyes. The seven items above are the ones no number of rounds can substitute for.