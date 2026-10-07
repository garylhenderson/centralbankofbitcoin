# Round 33, PROGRAMS pass: NOT CLEAN; QUORUM MET

**Independent triage verdict against frozen HEAD `18dbff608ceb4373e9a54c0f8870d5c8460e39dc` (round-32 repairs `ec4a0e1`; HEAD adds round-32 documentation only). Seven substantive, completed, current-tree reports are counted against a required six, so quorum is met. Four independently confirmed findings survive (one LOW, three INFO), so the pass is not clean.**

The clean-round counter remains **0/2**.

**About 40 deduplicated claim groups: four confirmed (0 CRITICAL, 0 HIGH, 0 MEDIUM, one LOW, three INFO), one shared with the off-chain pass, about 24 accepted, covered or optional, and eleven refuted, three of them by new validator measurement.** No program defect is confirmed. The LOW is in the launch procedure (deploying at the five public program ids); the INFOs are one vacuous suite arm and two false document sentences. Both counted HIGH/MEDIUM claims (the FIFO-halting reveal) were measured and refuted again, including a many-signer shape no prior round tested; those refutations are not suite arms yet (see Gate-5 obligations).

## Auditor dispositions

`MANIFEST-programs.json`: head `18dbff6`, `dirty: []`, prompt 1,240,255 characters, requested 8, runner-counted 8, required 6. A fresh offline render (`RENDER_ONLY=1 FOCUS=programs npx --no-install tsx scripts/audit33.ts`) gives **1,240,255** characters, equal to the manifest, with no unresolved placeholders and the accepted-limits section present. `git status` shows only untracked `audits/round33/`. Every counted report was read in full; the runner's 8/8 was not taken on trust.

| Auditor | Disposition |
|---|---|
| anthropic/claude-fable-5.1 | **Counted.** `stop`, 28,742 characters. The widest current-tree review: R0 checks the round-32 repairs at their sites, offsets recomputed. M1 refuted by measurement (W1); **S1 confirmed (D3)**; L1 accepted (A1, mechanism measured true); L2 refuted by measurement (W2); L3 (A2); L4 (A3); **I1 confirmed (D1)**; **I2 part 1 confirmed (D2)**, parts 2 to 4 not false (W8); I3 (A4); I4 (A5); I5 (A6); "arms that throw" (A7). |
| anthropic/claude-sonnet-5.5 | **Counted.** `stop`, 11,901 characters. Short but a current-tree audit: names the round-32 gate-5 pins, recomputes spaces and the pool invariants, and argues a shape (many small signatures) no earlier round measured. F1 refuted by measurement (W1); F2 and F2b (A8); **F3 confirmed (L1, measured)**; F4 shared (S1); F5 (A9); F6 (A10); its limit-36 remark refuted (W9). |
| meta/muse-spark-1.3 | **Counted.** `stop`, 15,568 characters. Current tree (round-32 L1/D1 and all six gate-5 arms named at their sites, offsets recomputed). Nested-collection INFO refuted (W5); destination-PDA LOW (A11); `pob_extra` ceiling INFO covered (A12). |
| qwen/qwen3.8-2.4t-a95b | **Counted.** `stop`, 16,068 characters. Current tree, every target walked with present-code specifics (the shape-based gate split, R32.A22 arms, 861/907 floors); no finding. Not a restatement of an older verdict. |
| qwen/qwen3.8-max-0902 | **Counted.** `stop`, 20,343 characters. Current tree (names `18dbff6`, quotes the repaired gate). F1 refuted by source (W3); F2 covered by item 38 (A13); F3 (A11); F4 shared off-chain (S2); F5 (A14). |
| z-ai/glm-5.3 | **Counted.** `stop`, 24,464 characters. Current tree, offsets and both gate repairs traced by hand. Finding 1 refuted (W4); Finding 2 accepted (A15, mechanism true by code). |
| xiaomi/mimo-v2.6-pro | **Counted, thin.** `stop`, 11,562 characters after 1,641 s. Brief per target, but current-tree and specific: it cites HEAD `18dbff6`, the six gate-5 arms by id, SR.12b's exact assertion and `expire_boosts`' error at the present code. F1 covered (A12); F2 refuted (W6); F3 true and cosmetic (A16); its "13 both-ways cases" repeats a stale record line (W4). |
| meituan/longcat-2.0 | **Not counted.** `stop`, 17,806 characters, but not an audit of this tree: it is a near-verbatim imitation of round 32's VERDICT. It names HEAD `ec4a0e1`, a 1,228,427-character prompt (round 32's), and "dispositions" for round 32's roster (deepseek, opus-5, glm-5.3-prime, ember, fugu, kimi), none of which ran this round, and cites `.cache/triage33p/` files it could not have seen. Read for leads only: its "M1" (the sweep helper's `CBOB_SWEEP lamports=` log names only the System transfer) is true of the log and harmless, as it itself concludes; SR.4a checks the full lamport delta. |

**Quorum: 7 of 8 substantive, 6 required. MET.**

## Method and evidence

- Read all seven counted reports in full, longcat for leads, round 32's verdict and VALIDATION, and the round-31 heap probe the earlier refutation rests on.
- Checked every claim against source at `18dbff6`. `programs/` and the workspace manifests are unchanged since `c5aab17` (`git diff --stat c5aab17 18dbff6` over them is empty), and `ec4a0e1..18dbff6` changes no code. Five counted reports recomputed the offsets and spaces independently and agree (`MINT_CONFIG_SPACE` 1,261, `VaultRecord` 221, `BurnConfig` 827, SEAL 398, GOV 350).
- **Round-32 repairs, verified present:** the gate's shape-based FOCUS split, fail-closed on an unrecognised header (`scripts/audit-coverage.sh --selftest`: **14/14**, asserted as `14/14` by `bank/selftest.mjs:2368`); DESIGN-v6 line 107, the `ClaimBeforeBurn`/`retire` sentence and the `*_stopped` names; the six gate-5 arms R31.W1a, R28.A1 (10,198), R31.W1b, R31.W2a, R31.W2b, R32.A22a/b. `node bank/selftest.mjs` at HEAD: **907/907**, exit 0 (`.cache/triage33p/selftest.log`).
- **Gates at this code, reused, not rerun:** 861 on-chain, 907 detector, 39 allocation, 23 poster, 14 PoB, 47 launch, 6 host, 33 live mainnet, 4 expiry, 16 swap-fork (`.cache/r32-full-pass.log`, EXIT 0, spot-checked 861/907/39/33/4/16; on-chain `.cache/r32-onchain-861.log`, 861 ok lines), plus 71 simulation (`.cache/r28-sim.log`). Swap results are fork transactions, not live money.
- **One validator window.** `.cache/VALIDATOR.lock` was created atomically with `noclobber` (content `triage33-programs`) after confirming no lock existed and ports 8999 and 9900 were free. The validator ran the pinned Core (dumped off the validator and `cmp`-identical to `.cache/core-mainnet.so`, sha256 `f03e7537…`, the pin) with the suite's two feature deactivations, the suite's test CPI wrapper, and one scratch forwarder built under `.cache/triage33p/bigcpi/` (never tracked, deployed only there). Afterwards the validator had exited, both ports were free, and the lock, ledger and scratch keypairs were removed.
- **What was not touched.** No tracked file was changed. `bank/alarm.mjs`, `bank/revenue.mjs` and the crank's main path were never imported or run. No live job, notification, crontab operation, mainnet send, deployment or lock. The only file added to the tree is this verdict.

## Confirmed findings

| ID | Severity | Independent disposition and minimal repair |
|---|---|---|
| **L1**: Sonnet F3 | **LOW** | **A stranger can block the standard deploy of every program at its public id for a few thousand lamports each.** The five ids are `declare_id!` constants, cross-wired between the programs and printed in SPEC, so they are known before road step 9 ("Deploy"). **Measured** on the isolated validator with `solana-cli 4.2.1` (`.cache/triage33p/dusted.sh`, `dusted-deploy.log`): a stranger sends 0.01 SOL to a fresh program keypair's address; `solana program deploy --program-id <that keypair>` then refuses ("is not an upgradeable program or already in use") and nothing is deployed. It is recoverable without changing an id, and therefore without touching `programs/` (`dusted-recover.mjs`, `.log`): the program keypair signs System `Allocate(36)` and `Assign(BPFLoaderUpgradeable)`; the CLI still refuses that state (System `0x0`), but `write-buffer` plus a hand-built loader `DeployWithMaxDataLen` lands, `program show` reports the program with our upgrade authority, and it executes. No value path; a delay and a scramble at the most sensitive step, which no runbook, road step or limit names (SPEC's only "already in use" text is about burned asset addresses). The rehearsal (step 8) uses throwaway ids nobody can know in advance, so it would never meet this. **Repair:** in the deploy runbook, read all five ids immediately before step 9; if any holds lamports, use the measured allocate/assign/write-buffer/`DeployWithMaxDataLen` path (keep the program keypairs offline until then, since that recovery needs them); rehearse that path once at throwaway ids. No program change. |
| **D1**: Fable I1 | **INFO** | **SPEC's REDEEMING step 1 (lines 245-247) still says "A 3-asset redemption that also creates them does not fit one legacy transaction (stage 3 measured 2 mints only)".** Round 26 D4 confirmed that categorical claim false (the owner-payer helper shape with all three destination creates serializes to 1,219 bytes) and repaired it at limit 42 and the old 9.14 text, which now say so; this site of the same sentence was missed. R0 asks for every repair at all sites of its shape. **Repair:** restate step 1 as limit 42 does (the padded page shape does not fit; preparation is a separate transaction by contract, and missing reserve accounts are a separate reason). |
| **D2**: Fable I2 (part 1) | **INFO** | **DESIGN-v6 lines 314-315: "`set_round` refuses any price below `MIN_ROUND_PRICE_SATS`, fixed at `initialize`."** It is a compile-time constant (`programs/cbob-vault-mint/src/lib.rs:477`, `pub const MIN_ROUND_PRICE_SATS: u64 = 21_000`, checked at 969); no `initialize` argument sets or reads a price floor. SPEC states it correctly (326, 584). DESIGN is bundled to be checked against the code and rounds 30 to 32 corrected it on that basis. **Repair:** "fixed in the program". |
| **D3**: Fable S1 | **INFO** | **Suite arm 2.1 cannot fail.** `tests/3prog.test.ts:1366-1378`: `V=mkV(vKp,…)` is built from a keypair before any transaction, the round-32 W2b rewrite moved the mint into `att(…)` (which records instead of throwing), and 2.1 then records `String(!!V.asset)`, which is `true` whether or not the mint landed. Before round 32 the same arm followed an awaited `mkVault()` whose failure crashed the run. Detection is unchanged (R31.W2b records `vMint.ok`, and 2.2/2.2a would fail), so no false pass is reachable, but one of the 861 counted assertions measures nothing while its label claims a mint. R8 asks for exactly this. **Repair:** record `vMint.ok?'ALLOW':'REJECT'` against `'ALLOW'`; the floor stays 861. |

## Shared with the off-chain verdict

| ID / reports | Disposition |
|---|---|
| S1: Sonnet F4 (the four keyed programs' shipped bytes never run) | Round 32 S2 / off-chain C10: `build-mainnet.sh` `cmp`s only the helper and its banner says the key constant is NOT PROVEN; no sentence is false. Independent reproducible builds remain launch work (A10). |
| S2: Qwen-max F4 (`bank/txread.mjs` refuses v1 lookup-table keys) | Off-chain topic (round 32 S4). Fail-closed by design: the reader refuses unknown coverage and the alarm reports `tx_unreadable` (SPEC 1811-1816); SPEC 1885-1892 says current builders use legacy/v0 and no test certifies a v1 CBOB transaction. Left to the off-chain pass. |

## Accepted limits, covered, bounded or optional

| ID / reports | Disposition |
|---|---|
| A1: Fable L1 (owner-added FreezeDelegate with a foreign authority) | **Mechanism measured TRUE** (`heap33.mjs` D.1, pinned Core): the owner adds `FreezeDelegate{frozen, authority: stranger}`; the owner's thaw (`0x1a`), removal, transfer (`0x9`) and burn (`0x9`) are refused; the stranger's thaw lands and the owner then burns. It needs the owner to sign the add, which HOLDER-GUIDE's "Leave add-ons off your vault NFT. If you sign for it, a wallet or app can attach extra Core features ... Some cannot be undone" warns against; no sentence is false. Naming the foreign-freeze case in that paragraph is optional. |
| A2: Fable L3 (`charter_opens_at` unbounded above) | Item 38 (programs check less than the checker; the date is OPEN and Gary's); round 32 A2. The checker bounds it against `lock_deadline` and refuses a past window, not a far-future typo; an upper bound there is optional. |
| A3: Fable L4 (BURN requires the uncreatable Token-2022 derivation, 96 bytes) | True and harmless (always system-owned, skipped); SPEC 50 states 23 bytes of headroom and "not an upper bound for arbitrary extra token pairs", item 44 says "mind the packet". Round 26 L13 / round 32 A8. Removing it is a program change and an owner decision before the lock. |
| A4: Fable I3 (an explicit `distribute` during a pool freeze enlarges forfeits) | SPEC 669-670: "An explicit `distribute` is not refused for a frozen pool; it can only make vaults owed again, and owed vaults still redeem by the same forfeit"; the guide's honest list says credited, undelivered payouts stay behind. A consequence sentence is optional. |
| A5: Fable I4; Sonnet F2b (orphan dilution not in the guide) | SPEC "What got worse" and item 44 state it; item 44's BUYER-FACING note claims only that the guide says to send the three reserve assets, which it does. That anyone can activate an existing orphan by funding it (`activate` is permissionless) is true and unstated; optional sentence. Round 31 A8 / round 32 A5. |
| A6: Fable I5 (guardian = `INIT_AUTHORITY` before `initialize`) | Limit 47's operational note names the identity; pre-lock the upgrade authority still exists. Deploy, initialize, verify, lock in one sitting is a runbook ordering point (with L1's pre-deploy read). |
| A7: Fable "arms that throw" (C.2, S2.*) | A crash is `FATAL`, exit 2, red; no false pass. |
| A8: Sonnet F2 (lost swap-operator key) | Limit 10: replacement needs half of all live vaults plus 7 days and the guardian can stop the sweep; limit 47 gives the low-turnout permanence. No value beyond royalty SOL is reachable. Saying "permanent at low turnout" for the operator too is optional. |
| A9: Sonnet F5 (the redeem page sits outside the audited set) | Item 50 is OPEN AND BLOCKING and road step 11 makes the page a precondition of the lock; where it is built is the owner's process choice. Auditing it before the lock is open launch work. |
| A10: Sonnet F6; all, launch sections | Untested optional shapes (wSOL source, non-ATA destination, `pob_extra = 8`, a 30-record `expire_boosts`; round 32 A13) and the stated open obligations: reproducible build, initialize read-back, rehearsal (22), surfaces (50), accounts (52), re-proof (53), custody, bounty. |
| A11: Muse R1s LOW; Qwen-max F3 (destination may be another vault's PDA) | The owner's own signed choice; SPEC 50's client contract says a page naming another destination must check it (round 32 A3). |
| A12: Muse R5 INFO; Mimo F1 (SPEC 46 omissions) | SPEC 46 states "up to 8 extra accounts", the packet limit of four, a hook that "REJECTS every charter claim", and admission control "on individual assets ... or by flipping the oracle between transactions"; approving any chosen subset is within "gate or brick claims". |
| A13: Qwen-max F2 (off-curve guardian or swap operator accepted) | Item 38: "off-curve keys are accepted"; `check-launch-params.mjs:96-99` refuses an off-curve guardian, init authority or swap operator (selftest L8). A signer requirement at `initialize` is an owner decision before the lock. |
| A14: Qwen-max F5 (`tests/probe-round5.test.ts` uses v5 shapes) | Round 32 A17: retained probes nothing runs or cites (no SPEC reference); its property is pinned by 2.3a. |
| A15: GLM F2 (multi-vault redemption ordering) | **True by code:** a claim whose leading `monthly_inline` is blocked by the last waiting vault, which it then joins, lets the next `burn_vault`'s trailing run credit that vault, so its own later burn refuses `ClaimBeforeBurn`. It is a reverted, retryable self-grief in a shape the client contract does not use (two helper redemptions do not fit one legacy packet; SPEC 50 measures one). Single-vault redemptions are safe (retire precedes the run, `lib.rs:1785-1791`). An optional client note. |
| A16: Mimo F3 (`expire_boosts` reports `BadClaimList`, whose message describes `claim`) | True (`lib.rs:1534`, message at 2874); the code is right and named, only the diagnostic text is claim's. Cosmetic, a program change. |
| A17: all, R0 | Round 32's L1 and D1 and its gate-5 arms are present (above). |

## Refuted or unsupported premises

| ID / reports | Independent disposition |
|---|---|
| W1: Fable M1 (MEDIUM); Sonnet F1 (HIGH if measured) | **Refuted by measurement, both shapes** (`.cache/triage33p/heap33.mjs`, `heap33.log`, 7/7; Core-only reproduction of MINT's reveal CPI with round 31's calibrated construction). **(a) The worst single-signature shape** (640-byte 7-pair stored list, 64-character name, 200-character URI, a 64/200 collection, all five owner plugins, the 10,198-byte autograph; asset 11,383 bytes) reveals at 47,971 CU and keeps the autograph, as round 31 measured. **(b) Many distinct signers with short messages (new):** grown through an attacker-style forwarder that CPIs arbitrary data from a buffer, the signers' OWN next update exhausts Core's heap first, at 57, 47 and 22 signatures for 0-, 8- and 64-byte messages (Core data about 2.0-2.1 KB, far below the 10,240 CPI cap); at each maximum the reveal lands (48,902 / 56,684 / 48,034 CU), and every intermediate reveal simulation (23) landed. So no owner-reachable shape tested stalls the FIFO on the pinned Core; limit 40's caveat ("not a proof for every combination") stands as written. |
| W2: Fable L2 (`ApproveCollectionPluginAuthorityV1` on the None-authority Royalties) | **Refuted by measurement** (`heap33.mjs` C.1/C.2): the collection update authority's approval to `UpdateAuthority` and to an Address are both refused (`0x1b`) and a 50% update is refused, leaving `None`/1000; control: the same approval on an UpdateAuthority-held plugin lands. On the CBOB collection only MINT's PDA could sign it in any case. |
| W3: Qwen-max F1 (DESIGN still says the index is "recorded on the asset") | `DESIGN-v6.md:107` reads "recorded in its MINT `VaultRecord` (where GOV reads it)". The repair is present. |
| W4: GLM F1 (VALIDATION's "13 both-ways cases"); Mimo's "13" | VALIDATION's repair paragraph records the first version; its review paragraph records the fix that made it "14 gate cases". The gate prints `14/14` and `bank/selftest.mjs:2368` asserts exactly that. Historical narrative in a dated record, not a false statement about the code. |
| W5: Muse R1 INFO (a nested CollectionV1 is not refused) | A Core collection has no owner, only an update authority; it is not a holding of the vault and nothing of value is destroyed or kept. |
| W6: Mimo F2 (SR.12b passes on any non-source-owner failure) | SR.12a's reason is pinned separately (`because('SR.12a', 'Program <helper> failed: Provided owner is not allowed')`, `tests/3prog.test.ts:3593`), which is the assertion Mimo asks for. |
| W7: Longcat (whole report) | Not an audit of this tree (dispositions above). |
| W8: Fable I2 parts 2-4 | `cancel_swap_operator` "clears a voted swap operator that is still inside its notice" is true and not exclusive; "the same one-time call" is DESIGN's generic name for initialize; line 181's `weight * acc - debt` is the base formula and DESIGN 227 adds `carry` for boosts. Imprecise, not false. |
| W9: Sonnet ("limit 36 is partly wrong: expiry never depends on a token account") | Limit 36 (1411-1417) claims no token-account dependence; nothing to correct. |
| W10: Muse R2 "a due boost on a vault whose ATA is gone cannot expire via `claim`" | Immaterial: `expire_boosts` needs records only, which Muse itself notes. Not a defect. |
| W11: Qwen-2.4t R8 ("`build-mainnet.sh` behaviourally proves the INIT_AUTHORITY swap") | Overstated: it proves the test key is rejected and greps the source key; its own banner says the key constant is NOT PROVEN. No conclusion depends on it. |

## Gate-5 obligations

SPEC ship gate 5 requires every rejected finding that could be measured to be a suite assertion. These are required before certification; they are not findings.

1. **W1(a), the worst single-signature reveal through MINT.** Round 31 W1 measured it; this round re-measured it. The suite's R28.A1 writes the 10,198-byte autograph only on C1 (one charter attribute, short name and URI), so the full worst shape (640-byte stored list via `exact()`, 64/200 name and URI, five owner plugins, 10,198 autograph, then `reveal_level`) is **not pinned**. Round 32's "pin round 31's W1 maximum shape" is therefore only partly discharged.
2. **W1(b), the many-signer autograph.** Not pinned. Pinning it needs a test-only forwarder that can CPI more than a legacy packet's data (the measured approach: write the instruction into a buffer, forward it), the signers' own heap refusal at the maximum, and `reveal_level` landing there.
3. **W2, None-authority Royalties re-delegation refused** (`0x1b`) with the UpdateAuthority control landing. Not pinned (R.5-R.6c cover update and removal only).

## Measurements

| Measurement | Result | Evidence |
|---|---|---|
| Prompt re-render | 1,240,255 characters, equal to the manifest | `.cache/triage33p/render.out`, `v33-prompt-programs.txt` |
| Reveal heap, single signature (W1a) | 11,383-byte asset reveals, 47,971 CU | `.cache/triage33p/heap33.mjs`, `heap33.log` |
| Reveal heap, many signers (W1b) | signers' own update OOMs at 57/47/22; reveal lands at 56/46/21 and at 23 intermediate checks | same; forwarder `.cache/triage33p/bigcpi/` |
| Royalties None re-delegation (W2) | refused `0x1b`, stays None/1000; control lands | same, C.1/C.2 |
| Foreign FreezeDelegate (A1) | owner thaw/remove/transfer/burn refused; stranger thaw lands | same, D.1 |
| Pre-funded program id (L1) | CLI deploy refused; allocate+assign+write-buffer+`DeployWithMaxDataLen` lands and runs | `.cache/triage33p/dusted.sh`, `dusted-deploy.log`, `dusted-recover.mjs`, `.log` |
| Detector selftest at HEAD | 907/907, exit 0; gate selftest 14/14 | `.cache/triage33p/selftest.log` |

## Remaining requirements

- Repair L1 in the deploy runbook (pre-deploy read of the five ids and the measured recovery path); correct D1 (SPEC step 1) and D2 (DESIGN 314-315); make arm 2.1 measure the mint (D3). A change to `tests/` or `scripts/` resets the freeze; repairs cannot retroactively clean round 33.
- Gate 5 is unmet: pin the three measured refutations above.
- Items 22, 38, 50, 52 and 53 remain open as SPEC states; `charter_opens_at` and `lock_deadline` remain unset in `launch/mainnet-init.json`. No deployment, initialization, lock, ceremony or cron installation follows from this audit.

**Result: QUORUM MET (7 substantive of 8 seats; six required). NOT CLEAN (0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW, 3 INFO; no program defect confirmed). Counter 0/2.**
