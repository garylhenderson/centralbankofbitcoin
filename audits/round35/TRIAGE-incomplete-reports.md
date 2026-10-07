# Round 35 (NOT COUNTED): triage of the seven usable reports

Tree: `1281ab4` (clean apart from untracked `audits/round35/`). Read-only: no
validator, test, alarm, crank, revenue or live job was run; nothing but this
file was written. Verified against source by reading it. "ALREADY-KNOWN" means
round 34's VERDICT-*/VALIDATION or SPEC already records it with nothing new
added. Round 35 is not counted and these verdicts do not make a round.

Reporters: GLMp, LCp, XMp = programs pass (glm-5.3, longcat-2.0, mimo-v2.6-pro);
FB, LCo, XMo, GLMo = off-chain pass (claude-fable-5.1, longcat, mimo, glm).
Reliability notes: LCo's header copies round 34's verdict wording ("QUORUM MET"),
gives a fabricated full hash (`1281ab49c203...`, the tail of `90a05ff`'s), and
re-files round 34's D1 as new although it was repaired. LCp says it audited
`90a05ff`. XMo files 30+ "findings" and withdraws all but one.

## Claims

| id | reporter(s) | sev claimed | verdict | evidence |
|---|---|---|---|---|
| C1 | GLMp F1 (LCp's "deploy, verify, lock, initialize" order) | LOW | **CONFIRMED** | SPEC.md:2334 step 9 ends each program with `set-upgrade-authority <id> --final` and says the key "must not be lost before step 11"; SPEC.md:2336 step 11 is "Remove the upgrade authority..." with the precondition that item 50's redeem page exists. Following step 9 as written locks all five before step 10 (initialize) and before the step-11 precondition holds. The VALIDATION rehearsal (audits/round34/VALIDATION.md:19-20) put "make final" inside step 9. |
| C2 | GLMp F3 | INFO | **CONFIRMED** (part of C1) | SPEC.md:2335 step 10 has no dump-and-verify. The window exists only if `--final` is deferred, which is the open question in C1. |
| C3 | GLMp F2 | LOW | **CONFIRMED** (test gap, no behaviour defect) | GOV `MIN_ROUND_PRICE_SATS` gov/lib.rs:185 and `MAX_ROUND_SECS` gov:238 duplicate MINT mint/lib.rs:477 and :472 (equal today). Only `RENT_EXEMPT_0_BYTES` is mirror-pinned (tests/3prog.test.ts:1648-1650, 3c.M1). No test or selftest names either constant (grep over tests/, bank/, scripts/). G.1 (3prog:1274) tests GOV only. |
| C4 | XMp F2, GLMo F1 (MEDIUM), FB I1/#6 | LOW / MEDIUM | **CONFIRMED** (LOW, custody and documentation) | The placeholder upgrade key is `bank/keys/deploy-authority.json` (mode 600, gitignored by bank/.gitignore:1, pubkey `FZjLB4e9…`). It appears only in SPEC.md:2334 and audits/round34/VALIDATION.md:17. No SPEC limit, custody or backup statement covers it. The $CBOB release key has one (SPEC.md:1697, "nightly R2 backup"). `launch/mainnet-init.json` and `scripts/check-launch-params.mjs` do not mention it. Losing it means new ids, which is a program change. GLMo's MEDIUM overstates it: nothing is at risk, and the claim is a missing record. |
| C5 | XMp F1 | LOW | **CONFIRMED** (mechanism, client contract and limit 44 text). Not measured. | Any token holder can `SetAuthority(CloseAccount, self)` and then `SetAuthority(AccountOwner, vault PDA)`. SPL Token clears the delegate on an owner change but keeps the close authority for non-native accounts (Token-2022 processor.rs AccountOwner branch, `if is_native() { close_authority = None }`; classic SPL Token works the same way). Then: (a) the sweep helper always closes the source as the PDA (sweep/lib.rs:68-70), so naming the account reverts the redemption; (b) declaring it in the burn reverts at BURN's second loop (`d[129..133]` check, burn/lib.rs:376, ReserveDelegated) even after emptying; (c) left undeclared, the page's `classifyPdaTokenAccount` (detectors.mjs:944-948) still requires a non-zero balance to be declared, so the automatic page cannot redeem. One unit of a junk token blocks any vault's automatic redemption until a human signs anyway, which destroys the junk. SPEC limit 44 (SPEC.md:1555-1558) lists Token-2022, frozen strays and nested assets as "not covered", but not this case. The detectors.mjs:927-933 griefing note covers only Token-2022 extensions. No funds are lost. |
| C6 | XMp F3 | INFO (holder doc) | **DISPROVED** (optional wording) | HOLDER-GUIDE.md:49 says "can choose among many results", and :179-181 says "pick among several results ... can be enough to choose the level". It is not false. The "many/several" mismatch is cosmetic. |
| C7 | XMp F4 | INFO | **DISPROVED / ALREADY-KNOWN** | SPEC.md:1814-1821 states "about 1,209 of the 1,232: it fits, with 23 bytes to spare" and "not an upper bound for arbitrary extra token pairs". The rescue bullet says "each pair costs bytes" (SPEC.md:1827-1832). Round 34 A16. |
| C8 | XMp R4/R6 (guardian = INIT_AUTHORITY stolen pre-initialize; checker validates JSON not tx) | (unrated) | **ALREADY-KNOWN** | Round 24 A6, round 34 off-chain C31. |
| C9 | FB M1 | MEDIUM | **CONFIRMED** (mechanism). I rate it LOW. **Bears on rescue_nested.** | `planCrank` activates any funded vault whose asset is `'live'` (crank.mjs:357-360). It joins and pays the same way (:377-379, :488, :510-511). `main()` classifies assets only as live, burned or other (crank.mjs:600-602) and never reads the owner bytes. So the hourly crank activates and pays a vault owned by its own asset-signer PDA, by another vault's PDA, or by any off-curve key. SPEC.md:170-180 and limit 9 (SPEC.md:1107-1109) record the permanent dilution but not that our automation starts it. `activate` is permissionless, so this is not the only path. |
| C10 | FB L1 | LOW | **CONFIRMED** (false CRITICAL under indexer lag; size not measured) | detectors.mjs:1743 tolerates only `total <= seen <= mintedAfter`, so the race where the index runs ahead is fixed (round 24 L9). An index BEHIND chain (`seen < total`) pages `index_disagrees_with_chain` CRITICAL "incomplete" at :1744-1748. alarm.mjs:330 and :508 read `minted_total` before the DAS walk, so a mint that lands a moment before the read and is not yet indexed pages CRITICAL. Rare in the charter window, plausible during a busy sale. No SPEC text accepts it. |
| C11 | FB I2 | INFO | **CONFIRMED, no impact** | crank.mjs:422 hard-codes `1500n`. MINT computes `bank_cut` from `cfg.split_bps` (mint/lib.rs:1018), which is written once (:669) and never again, so the two always agree. |
| C12 | FB I3 | INFO | **CONFIRMED** (evidence gap) | scripts/build-mainnet.sh:145-155 compares only the sweep helper with `cmp`. For the four keyed programs, the localnet rebuild in `$LN_DIR` (:135) is only asked about the key (:174-177), and target/deploy is only hashed (:156-159). Neither is compared against the other. |
| C13 | FB I4 | INFO | **UNCERTAIN / latent** | detectors.mjs:658 returns -Infinity when a sweep's blockTime is later than the pass's Clock. alarm.mjs:377 reads the Clock just before the ledger (:410), and revenue.mjs runs under its own flock (scripts/cron-install.sh:151 vs :148), so this needs a sweep confirmed and recorded in milliseconds. The reporter agrees it is not reachable in practice. No action. |
| C14 | FB I1; GLMo (limit 13 pre-lock) | INFO | **ALREADY-KNOWN** in substance | SPEC.md:1978 already says `lock_deadline_unset` fires every pass until the deadline is set. The one-time `config_drift` on the upgrade is how the baseline re-take works (`carryConfigBaseline`, alarm.mjs:773). Optional: step 9 could say "expect one `config_drift` CRITICAL per program at the upgrade". |
| C15 | FB R0#3 (road order); triage observation | INFO (doc) | **CONFIRMED** (doc) | SPEC.md:2322 says "Each step must be complete before the next starts", but step 9 is "in progress (ids claimed)" while 7 and 8 are not done. SPEC.md:2338 says "Nothing is deployed", but five placeholder programs are deployed on mainnet (VALIDATION.md:12-20). |
| C16 | FB "Holder guide imprecisions" (activation) | INFO (holder doc) | **DISPROVED** (DRAFT; not false) | HOLDER-GUIDE.md:13-15 and :21-22 compress activation (someone sends `activate`, then the join at the next distribution), and "picked up automatically" holds once the crank is armed. The guide is DRAFT and may not be published before item 50 (SPEC.md:1795-1797). |
| C17 | FB (limit 8 narrower; item 54 unmeasured 14-pair crediting claim) | INFO | **ALREADY-KNOWN / optional** | Item 54 already says the 14-vault batch is "extrapolated ... not measured at 14" (SPEC.md:2074-2076). The limit-8 narrowing is optional wording. |
| C18 | LCo M1 (MEDIUM); GLMo F2 (LOW) | MEDIUM / LOW | **CONFIRMED only as a documentation gap** (the growth itself is round 34 L1, repaired by paging). **logGaps half ALREADY-KNOWN; seenSweeps half DISPROVED.** | alarm.mjs:776 persists `seenSplits` with no pruning. `detectSplitHistoryGrowth` (detectors.mjs:1505-1507) pages HIGH above 50,000 and tells a human to prune by hand. `grep split_history\|seenSplits SPEC.md` finds nothing, so the residual (stranger-growable for one fee plus one sat, manual pruning only, per-pass cost O(n log n)) is in no accepted limit. `logGaps` is disclosed (round 34 off-chain C03). `seenSweeps` grows only through `sweep_sol_for_swap`, which is operator-signed and cooldown-bounded (mint/lib.rs:1060-1062), so a stranger cannot grow it. |
| C19 | LCo M2 | MEDIUM | **DISPROVED** | Round 34 never claimed the cache works across passes. The repair is "sort once per list, binary-search" (VALIDATION.md:33-39). `sortedSplits` (detectors.mjs:687-695) does that, and the per-pass cost is C18's residual. It is not a separate defect. |
| C20 | LCo L1 | LOW | **DISPROVED / ALREADY-KNOWN** | It claims old cycles are "still checked against seenSplits". They are not: `if (!recent.has(c)) continue` (detectors.mjs:1565) skips them. But every cycle whose sweep the scan saw is always in the window (:1541-1546), and `seenSweeps` is never pruned. The position horizon is the deliberate round 12 / round 24 L10c design. The "crash clears splitSig" scenario is recovery, not this detector. |
| C21 | LCo L2 | LOW | **ALREADY-KNOWN** (disproved round 34 C16) | The float only feeds the 100 bps heuristic. The floor is BigInt. |
| C22 | LCo D1 | INFO | **DISPROVED** (stale) | Repaired in round 34 (VALIDATION.md:50-53). |
| C23 | XMo A6 | LOW | **DISPROVED** | The exact-string coupling between crank.mjs:418 and :431 and detectors.mjs:2358-2361 is pinned both ways against the real `planCrank` output (selftest.mjs:3532-3533, "R27 L2"), so a wording change turns the selftest red. A mismatch would also be a surplus page, not a silent one. |
| C24 | XMo C1-C8, A1-A5, A7-A10, L1-L3, M1-M3, S1-S18, G1-G6 | LOW | **withdrawn by the reporter** | Not re-filed. |
| C25 | GLMo (limit 10(b) swap-path number, ~250 bps) | INFO | optional | A refinement of an accepted limit. Not a defect. |

## CONFIRMED, with suggested fixes

1. **C1 + C2: road steps 9, 10 and 11 contradict each other about `--final`.**
   Fix: move `--final` out of step 9 (step 9 = upgrade, dump, prefix-hash and
   zero-tail check). Rewrite step 11 as "dump and verify all five, then `--final`
   each, then dump and verify again", with the item-50 precondition kept there.
   Add a dump-and-verify immediately before step 10's initialize. Change the key
   note to "must not be lost before step 11's `--final`". This is SPEC only.
2. **C4: the placeholder upgrade key has no custody record.** Fix: add an
   operational or accepted-limit entry naming `bank/keys/deploy-authority.json`,
   its pubkey, its backup (confirm it is actually in the nightly R2 set), who may
   use it, and the consequence of loss (new ids). Keep it offline except during
   steps 9 and 11. Optionally add a pinned `placeholder_upgrade_authority` to
   `launch/mainnet-init.json` with a checker rule. The coming program change
   ships through this key, so this matters now.
3. **C3: no pin on GOV's `MIN_ROUND_PRICE_SATS` and `MAX_ROUND_SECS`.** Fix:
   two 3c.M1-style arms in tests/3prog.test.ts (regex both sources, compare,
   distinct NOT-FOUND fallbacks). The suite floor rises by 2.
4. **C5: a stray account with a foreign close authority cannot be swept,
   declared or passed automatically.** Fix (no program change needed):
   `classifyPdaTokenAccount` / `judgeRedemptionCoverage` read bytes 129..133 (and
   the frozen state at 108) and classify such an account as "undeclarable:
   leave undeclared; its balance is destroyed; needs a human". The page must
   never name it in the sweep. Add this case to limit 44's "Not covered" list
   and to item 50's client contract. Measure it on a validator later (create,
   set close authority, reassign owner to the PDA; named in the sweep it reverts
   at close, and declared it reverts ReserveDelegated). If the programs are
   being changed anyway, an optional helper change would skip the close when
   bytes 129..133 are set and the authority is not the signer. That would leave
   the account non-empty-closed, which BURN still refuses, so the off-chain fix
   is the real one.
5. **C9: the crank activates, joins and pays nested, self-owned and off-curve
   vaults.** Fix: read the owner (`data[1..33]`) in crank.mjs `main()`, refuse
   activation and joins when the owner is any CBOB vault's asset-signer PDA
   (self or another), and record a `problem`. Both-ways selftest arms. Do
   **not** adopt FB's blanket off-curve refusal: see the rescue_nested notes
   below. On chain, `activate` could cheaply refuse
   `owner == PDA(["mpl-core-execute", asset], CORE)` if the programs are being
   changed anyway.
6. **C10: indexer lag pages CRITICAL.** Fix: treat `prevMinted <= seen < total`
   as lag (quiet, or HIGH after two consecutive passes). Page CRITICAL when
   `seen < prev pass's minted_total`, or when over. Both-ways arms.
7. **C18: the seenSplits residual is undocumented.** Fix: either prune below the
   oldest open cycle's return minus a margin (both-ways arm), or write the
   residual into SPEC's accepted limits with round 34's numbers.
8. **C15: road text.** Fix SPEC.md:2322 (note that step 9 began early, with
   approval) and :2338 ("five inert placeholders are deployed; nothing has
   minted").
9. INFO, optional: C11 (read `cfg.split_bps`), C12 (`cmp` the four keyed
   `$LN_DIR` builds against target/deploy).

## Claims that bear on the rescue_nested / PermanentTransferDelegate change

- **C9 is directly affected.** With `rescue_nested`, a nested or self-owned
  vault is no longer a permanent orphan. The crank (or the alarm's runbook)
  should call `rescue_nested` for vaults owned by a vault PDA instead of only
  refusing them. Refusing to activate while nested stays correct, and the rescued
  vault activates normally afterwards. SPEC.md:170-180 (round 29 D2, "nothing on
  chain can undo it"), limit 9 (SPEC.md:1107-1109) and limit 44 (SPEC.md:1564)
  must be rewritten when the change lands.
- **A Squads destination meets limit 43** (SPEC.md:1530-1544). An off-curve owner
  cannot redeem, so a vault rescued to the CBOBTC Squads can be redeemed only
  after Squads transfers it to an on-curve key. The alarm will page it as
  `unredeemable_owner` CRITICAL. FB's suggested "refuse off-curve owners" crank
  rule would starve exactly these rescued vaults of activation and claims. Scope
  any crank refusal to vault-PDA owners only, and give rescued-to-Squads vaults
  an expected-state exception or a runbook line.
- **Existing evidence does not cover the new delegate.** XMp and LCp cite SR.5a
  ("a transfer delegate has no Execute rule"; tests/3prog.test.ts:3101). That arm
  is an OWNER-added `TransferDelegate`, not a `PermanentTransferDelegate`. New
  arms are needed on pinned Core to prove three things. First, the MINT-PDA
  permanent delegate gets no `ExecuteV1` and no burn. Second, it can transfer a
  frozen, sealed vault, because Core's permanent-plugin precedence against
  `PermanentFreezeExecute` and the seal's freeze must be measured, not assumed.
  Third, nobody can remove or re-delegate it. That is the W9/R34.G4 family
  applied to the new plugin. Per SPEC limit 46's round-23 note, Core refuses a
  PermanentTransferDelegate added after creation, so it must be installed at
  `CreateV2` in both `mint_vault` and `claim_charter_vault`.
- **Size and packet.** The extra plugin at creation enlarges every asset and the
  create instruction. Re-measure R34.G1a/b's worst-shape fit (the margin was
  about 549 attribute bytes, VALIDATION.md:64-67) and the charter-claim packet
  (SPEC limit 46: 4 extra accounts = 1,213 of 1,232 bytes).
- **C1 and C4 sit on the deploy path.** The change is shipped as an upgrade
  through the placeholder key `FZjLB4e9…`, and the step 9/11 ordering decides
  when that becomes impossible.
- **C5 (close-authority stray) does not interact with rescue_nested.**
