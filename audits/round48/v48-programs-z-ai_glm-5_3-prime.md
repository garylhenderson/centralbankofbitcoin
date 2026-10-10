# Round 48 — independent audit of the whole tree

**Verdict up front: LAUNCH-CLEAN under the 2026-10-08 gate (no confirmed finding in (a)–(d)); NOT a no-change round.** One confirmed LOW finding in the fixable layer, plus measurement limits I state where the bundle does not carry the file.

---

## R0. Round 47's verdict and its repairs

### Repairs I can verify in this bundle

| Repair | Where I verified it | Result |
|---|---|---|
| V47-3 (R.4 reads the raw plugin registry) | `tests/3prog.test.ts` `registryOf`, R.4 (`Royalties|0`) and the new control R.4b (AppData adapter reads `Royalties|1`) | **present, both directions** |
| V47-4 (ceremony compute floor) | `web/src/pages/ceremony.mjs`: `signExact(wallet, tx, …, { minUnits: sim.unitsConsumed \|\| null })` — the measured need, not `pageUnits` | **present** |
| V47-5 (judge refuses removed signer/writable) | `web/src/lib/tx.mjs` `judgeWalletEdits`: both directions of the `roles` sets are now compared | **present** |
| V47-6 (README SEAL/BURN wording) | `README.md` program table: SEAL "keeps each vault sealed…", BURN "proves its wallet empty, burns it and retires its record" | **present** |
| V47-7 (road row 8 carries 22.2) | `README.md`: "done on mainnet 2026-10-09 to 10-10; 22.2 FAIL accepted by Gary (a true detection); scale not exercised" | **present** |
| V47-8 (SPEC 53 restated) | SPEC item 53: the "has not yet run to its end" sentence is gone; "the last in-tree run is `e7c192a`" and the per-commit requirement remain | **present** |
| V47-9 (proxy comment) | `web/deploy/rpc-proxy.mjs` header: "the five exact filtered shapes" | **present** |
| V47o-2 (validator lock) | `scripts/validator-lock.sh` bundled; sourced by `run-tests.sh`, `run-sim.sh`, `build-mainnet.sh`, `e2e-localnet.sh` before their exit traps; the validator is booted without the lease | **present** |
| V47o-9 (dist/ named) | `run-tests.sh`: `[ -s "$ROOT/dist/SHA256SUMS" ] \|\| die "dist/ is absent…"` plus the README bootstrap order | **present** |
| V47-1, V47-2, V47o-1, V47o-6, V47o-8 | `scripts/readme-facts.mjs`, `scripts/core-watch.mjs`, `scripts/cron-install.sh`, `web/test/mock-rpc.mjs` are **not in this bundle** and are not on its exceptions list | **cannot verify from code**; the README's generated block (43 rounds, the round-47 row, the 22.2 qualifier) is consistent with the repairs, and VALIDATION.md records three selftest arms for V47-1/V47-2 |

### The verdict's disproofs — re-checked from first principles

- **Muse's HIGH (an empty Token-2022 reserve ATA bricks any crack):** the disproof holds. The ATA program derives a different address per token program and refuses `IncorrectProgramId` when the mint is owned by classic Token (the round-47 measurement `t22.log` is cited, not bundled; the mechanism is the ATA program's own program-id check, and the pinned probe asserts all three reserve mints are classic, 82 bytes, every certifying run). SEAL's `assert_classic_spl` refuses a non-classic reserve mint at initialize, so the Token-2022 derivation for a reserve mint can never hold a Token-2022 account. BURN's reserve loop skips non-Token-owned addresses, so the declared-but-absent Token-2022 ATA passes for the right reason.
- **MiMo's W47-1/W47-2 (wallet-edit judge):** I read `judgeWalletEdits` against the code. The rules are exactly the documented ones, fail closed before anything is sent, and are pinned by existing arms. The W47-2 shape (a wallet budget on a page-budgeted transaction) cannot fit the packet: a limit-only ComputeBudget instruction costs 40 bytes (32 program key + 8 data) and the widest openings are ~1,200 bytes, so 1,240+ exceeds 1,232. Both disproofs stand.

### The surviving gap — see Finding 1

Round 47's own verdict, under "Gate-5 obligations" item 7, listed three **measurable rejections** whose assertions were requirements, not findings: **C11** (a `rehearsal-refresh` selftest arm with an ignored fixture), **C16** (the judge refusing a second limit or price), and **C26** (the one-character `?.body?.frozen` in `planClaim` plus an arm). **None of the three was discharged.** VALIDATION.md's repair list covers V47-1..V47-9 and V47o-1..V47o-9 only; the detector floor's +9 (1072→1081) is the validator-lock, Core-watch and dist-naming arms, not these. The bundled code confirms all three absences (details in Finding 1).

---

## R1. Custody: can anyone but the owner get value out of a sealed vault, or an emptied vault survive?

**No finding.** What I checked:

- **The pairing.** SEAL's walk starts at `current+1` and matches BURN's discriminator plus account 0 (asset) and account 2 (owner); BURN's walk covers `0..current` and matches SEAL's discriminator plus the same two positions. A burn *before* the open fails both halves (BURN finds no preceding open; SEAL finds no later burn). Two redemptions in one transaction pair correctly and are bounded only by the rate limit (4.9, 4.10a). The account positions are pinned by suite arms 3.1c–3.1f and by the "MUST stay account N" comments in both programs.
- **CPI wrappers.** `retire_redeemed` requires `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1` (exactly one CPI from a top-level instruction — a two-deep CPI fails this even though the sysvar would match) *and* the current top-level instruction to be BURN's `burn_vault` for this asset. WR.1–WR.4 exercise the wrapper shapes; both refuse, the vault keeps everything.
- **The emptiness proof.** PDA lamports == 0; every reserve mint's ATA under *both* token programs must be declared, and is skipped only when not Token/Token-2022-owned (a closed account reads as non-Token-owned to later instructions in the same transaction — consistent with SR.12a/SR.12b's pinned refusal and with SR.4's landing); declared Token-owned accounts with owner == PDA get the delegate, close-authority, extension and amount checks in *both* loops. A Token-2022 ATA for a classic reserve mint cannot exist (see R0). A nested Core asset declared refuses; undeclared is the accepted limit 44/58.
- **Atomicity.** The thaw is a Core plugin write inside the same transaction as the burn; any later failure reverts the thaw with it. There is no instruction sequence that leaves a thawed, live vault at the end of a landed transaction.

## R1s. The sweep helper

**No finding.** Per question:

- **(a)** Access control is Core's `ExecuteV1` rule: only the asset's owner (SR.5, SR.5a, SR.5c; the collection authority is MINT's off-curve PDA, SR.5b; the AgentIdentity route cannot be added by an owner, R24.1a). While frozen, Core refuses the Execute (3.7, pinned to Core 0x9 with the seal decoding frozen and the signer being the owner). Direct calls need the PDA's signature (SR.1).
- **(b)** Duplicate source: the first pair closes it; the second `read_token` fails (the closed account is no longer Token-owned) — the whole redemption reverts, fail closed (SR.12a/SR.12b). A source that is also a destination fails the owner check. A source with a kept close authority reverts the close (R36.C5). A frozen source reverts the transfer (SR.14). Odd account count and non-zero data are refused (SR.6, SR.7). Zero pairs is the lamports-only sweep (SR.13).
- **(c)** The destination is the owner's choice, and only the owner can reach the helper — safe. A sub-rent credit to a non-existent account is refused by the runtime (R41.C8a–c); the canonical destination is the fee-paying owner.
- **(d)** `signer.lamports()` is read at execution; nothing in the redemption's remaining instructions (the burn, Core) credits the PDA; BURN's `lamports == 0` sees exactly what the sweep left (SR.4a measures the exact delta including gifts, released rent and fees).
- **(e)** The closed account passes BURN for the right reason: it is no longer Token-owned, so the reserve loop skips it (measured by SR.4 landing and pinned by SR.12b's refusal shape). A stranger cannot create a Token-2022 ATA for a classic mint (IncorrectProgramId), cannot create a non-ATA account at the ATA address (off-curve PDA), and a nested Core asset is the accepted limit. The page's prior transaction creating missing reserve accounts is sufficient.
- **(f)** S8.0 measures the three-asset redemption, claim included, at ≤ 1,084 bytes with room for the compute pair (+52) and a separate payer (+96). A fourth reserve is impossible (SEAL caps at 3, and 9.14 pins the ceiling). The in-line monthly run's accounts (the pool) are already in the claim and the burn.
- **(g)** SR.0–SR.4a and S8.* are non-vacuous (each refusal is pinned to the helper's own log line or program error; SR.4a checks the exact lamport delta). `build-mainnet.sh` compares the helper's dist bytes against `target/deploy` (what the suite deployed) and against the localnet rebuild; the helper has no localnet feature, so the tested bytes are the shipped bytes.

## R2. The community pool

**No finding.** The invariant "the pool holds at least ceil(owed)" holds by construction: `credit` adds `floor(avail·SCALE/w)·w` to `owed` where `avail = balance − ceil(owed)`, so `ceil(owed′) ≤ ceil(owed) + avail = balance`; `claim` subtracts `pay·SCALE` from both sides exactly; `retire` only decreases `owed`. I re-derived this and checked every counter (`pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight`, `boost_weight_total`, `boosts_active`, `boosts_due`, the ring) under every ordering of the host instructions and both retire branches — the suite's `ledger()`/`books()` recompute them from every record after each money operation (BK.*), and the host unit tests drive the ring through four wraps against an independent model. Liveness: every gate (`JoinWaitingFirst`, `BoostsExpireFirst`) is cleared by a free permissionless instruction; a frozen pool forfeits rather than locks (3c.F); an empty pool with waiting vaults stalls only until revenue arrives, which is the design (there is nothing to distribute).

## R2b. The $CBOB boost

**No finding.** A boost earns exactly its N distributions (BO.21/BO.35 pin both in-transaction orderings); `reweigh` moves the owed share to `carry` and restarts the debt at the new weight, so nothing is lost or gained on any weight change (boost, expiry, claim normalisation, retire); the ring, `boosts_due`, `boosts_active` and `boost_weight_total` agree past epoch 64 (host test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps`, plus BO.34/BO.38 on chain); no record can be expired twice (`expire_boost` requires `boost_weight > 0` and clears it; `retire` only unschedules when `boost_weight > 0`), early (`dist_epoch >= boost_end_epoch` required), or never (the gate blocks distributions and the crank/claim expire); a vault whose token account is gone cannot block distributions (`expire_boosts` needs only records). Owner-only (`BoostNotTheOwner` reads the asset's current owner bytes), buyer's terms one-sided by ruling.

## R3. The level draw

**No finding.** The SlotHashes parse is defensive (count ≤ 512, length checked, zero hash refused, sysvar id pinned); the skipped-slot rule (smallest produced slot in `[want, want+64]`) is pinned by host tests against an independent model; the FIFO is strict (`RevealOutOfOrder`); a burned vault at the head still draws (L.11); the reschedule targets a slot that does not exist when it lands and is logged/counted; the attribute re-supply is hash-checked (`AttributesMismatch`). What a leader can do is exactly SPEC 26 and the holder guide's honest list — C's leader chooses among many draws, best-of-4 alone taking P(Level V) from 5.0% to 18.6%, cohort-wide; I found nothing worse than that. The guide states it truly.

## R4. Governance

**No finding.** The electorate is fixed at creation (`index_snapshot`, live `quorum_supply`); no proposal before the charter closes; quorum/threshold/turnout computed against the snapshot with ceiling division and non-zero floors; key changes need half of ALL live vaults, never bundled, notice-gated, guardian-cancellable for operators only; ordering is per-kind with logged skips; an overtaken action cannot take its bundle down. A minority cannot carry anything: the smallest passing ordinary vote is 10.71% YES (above the 10% floor), and key changes need 50%. Frozen-forever scenarios are the accepted limits 45 and 47, stated.

## R5. The charter claim

**No finding.** The Merkle scheme is domain-separated (0x00/0x01), sorted, proof ≤ 16, and the program accepting the JS-built proof is the drift check (C.2, S2.1); the window is clock-only and can never reopen; the PoB is burned as its owner in the same instruction; `pob_extra` accounts are passed never as signers; the claim is not gated by the guardian. What the hot Moments wallet can do is limit 46, stated in full (block claims, capture governance, per-asset blind spot, sampling gap); I found nothing it still omits — it cannot transfer or burn an individual PoB (Core's owner-only rule, R32.A22), and the per-asset plugin routes that could matter (external adapters) are refused by the claim page and passed through at the program level.

## R6. One-time configuration and the trusted hop

**No finding.** Every `initialize` bound is as SPEC states; the launch checker (not bundled — see limits) is the pre-signing gate and limit 38 stays OPEN for the three OPEN values. The swap operator's worst case is cap × windows until the guardian stops (limit 10, with the round-37 C05 cadence correction); the tighten bounds are absolute; the royalty is authority-None and nothing in our programs or Core lets anyone change it (R.3/R.6/R.6a/R.6c/R.33.G3, and MINT's only collection-level Core CPI is the one-time AddCollectionPluginV1 at initialize). The redemption cap is exactly a rolling window over a 64-entry ring of i64 timestamps, with the k-th most recent redemption required to be a full window old, `k = min(cap, 64)`, cap = ceil(2.1% × live) with floor 1, live read from MINT's config at burn time — and the ring is stamped before the emptiness checks but atomically, so failed burns consume no budget.

## R7. Cross-program raw reads

**No finding.** I recomputed every offset from the struct definitions. MintConfig: governance 41, minted_total 141, bare_retired 454, charter_closes 442, sol_reserve 257, max_sweep 266, cooldown 274, sweep_floor 631, cooldown_ceiling 639, reserve_ceiling 647, max_boost_weight 711, max_boost_epochs 712 — all correct (body 997, space 1,261, matching the round-47 measurement). VaultRecord: mint_index 41, asset 9, version 8 — correct (space 221). BurnConfig: burned_total 42 — correct. SEAL config: version 8, collection 9, reserves 41 — correct. Every reader pins address, owner, discriminator and version. The sweep helper's classic-account offsets (mint 0, owner 32, amount 64, len 165) are correct.

## R8. The suite, the simulation and the build

**No finding beyond R0's.** The floors in `run-tests.sh` (913 on-chain, 1081 detectors, 805 web, 69 launch, 24 poster, 14 pob, 6 host, 4 expiry, 35 mainnet, 16 fork) equal the README's table and VALIDATION.md's runs; the sim floor is 71 and the e2e floor 152. The `because()` pins make wrong-reason refusals fail (I checked the pins for the sweep helper, the charter claim, the pool and the rate limit — each names the program's own error). The arms I probed for vacuity (RL.S1–S6, R42.C12c/d, X.7, SR.12b, ID.1) can all fail. The build provenance: the suite deploys the stripped localnet build; `build-mainnet.sh` compares the helper's dist bytes against exactly those bytes and against a fresh localnet rebuild; the four keyed programs are proven by the behavioural init-authority test in both directions, with the one acknowledged gap (the compiled constant is not proven to be Gary's key by acceptance — stated in the script's own "NOT PROVEN" section and closed only by reproducibility, which the GitHub workflow provides on a third machine).

---

## The four questions about the accepted limits

1. **Is any limit WORSE than stated?** No. I attacked each of the buyer-facing ones: the swap operator's bound is cap × windows with the cadence correction stated; the leader's draw influence is exactly SPEC 26's numbers with the cohort effect; the frozen-account matrix (vault account, pool, revenue, Squads) matches the code's deferral/forfeit/skip behaviour in every combination I traced; the rate limit's "stricter, never looser" past the ring is correct; the rescue's live-host window is R43.V1 as ruled. Nothing is exploitable beyond its stated cost.
2. **Is anything listed as a limit not actually a limit?** No. Each one I traced to a real mechanism (or a real absence) in the code.
3. **Is any DISCHARGED item not actually discharged?** No. The v5 Bank-family discharges are real (the files and instructions are gone); items 14, 19, 30, 31, 33 are closed by the mechanisms SPEC names, which I verified exist.
4. **Is anything in OPEN AND BLOCKING quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are stated as open in SPEC, the README and VALIDATION.md; 22.2's FAIL is recorded as a ruling, not a quiet demotion — item 22 stays open for the ~2,100-vault scale, which the README now says plainly.

---

## Findings

### F48-1 — LOW (fixable layer: pages, tests, tooling). Round 47's gate-5 obligations for its own measurable rejections were not discharged in the repairs.

**The construct.** Three sites, all verifiable in this bundle:

1. **C26 — `web/src/lib/plan-get.mjs`, `planClaim`:** `const frozen = ['FreezeDelegate','PermanentFreezeDelegate'].some(t => pick.info.plugin(t)?.body.frozen)`. The optional chain stops at `plugin(t)`; a plugin whose registry entry parses but whose *body* fails to parse (`decode.mjs`'s `pluginBody` catch sets `body = null`) makes `.body.frozen` a TypeError on `null`. `planDraw` guards exactly this shape (`if (attrPlugin && !attrPlugin.body) return { state: 'unknown', … }`, round 42 C7's fix); `planClaim` does not. The same shape in `web/src/pages/vault.mjs`'s "Sealed" row falls through to "No seal found on this NFT." — a false statement when the plugin exists and Core still enforces the freeze.
2. **C16 — `web/src/lib/tx.mjs`, `judgeWalletEdits`:** the `let limit = null, price = 0n` loop silently lets a second limit or price instruction overwrite the first; the verdict's obligation was to refuse duplicates and arm it.
3. **C11 — `scripts/rehearsal-refresh.mjs`:** no selftest exists; the obligation was an arm with an ignored fixture pinning that `untracked()` (which uses `git ls-files --others` with no exclude) sees ignored files — the property the whole key-preservation proof rests on.

**What an attacker or accident gains.** Nothing today. All three are fail-closed: the TypeError is caught by the claim page's handler and shown as an error (nothing is signed); duplicate compute-budget instructions are refused by the runtime at sanitisation; the refresh's semantics are currently correct. The cost is what SPEC ship gate 5 exists for: a future change — a Core format change that nulls a plugin body, a "cleanup" that adds `--exclude-standard`, a wallet that ships two budget instructions the runtime someday tolerates — would regress silently, with no test going red. Round 47's verdict listed these as "requirements, not findings"; VALIDATION.md's repair list and the detector floor's +9 (lock, Core-watch, dist-naming arms) show none of the three was done.

**Evidence if I am right.** The three source sites above, read against round 47's VERDICT "Gate-5 obligations" item 7 and VALIDATION.md's repair list; `web/test/get.test.mjs` (bundled) has a frozen-PoB arm that passes a *parsed* body and no null-body arm.

**The fix.** The one-character `?.body?.frozen` in `planClaim` plus a `get.test.mjs` arm with a null FreezeDelegate body (and the same guard for the vault page's "Sealed" row); the duplicate-budget refusal in `judgeWalletEdits` plus a `tx.test.mjs` arm; a `rehearsal-refresh` selftest arm with an ignored fixture in the snapshot. Each shown red with the fix reverted, per the house rule.

**Classification.** Outside (a)–(d): no finding in the five programs, no value path, no refused crack, not HIGH/MEDIUM. It does not break LAUNCH-CLEAN, but it makes this a requires-changes round.

---

## Measurement limits

- Not in this bundle and not on its exceptions list, so claims about them are claims about files I was not given: `scripts/readme-facts.mjs`, `scripts/core-watch.mjs`, `scripts/core-watch-suite.sh`, `scripts/cron-install.sh`, `web/test/mock-rpc.mjs`, `web/test/run-all.mjs`, `bank/selftest.mjs`, `bank/alarm.mjs`, `bank/accrual.mjs`, `bank/revenue.mjs`, `scripts/pob-set.json` (the set itself; the root is pinned in `launch/mainnet-init.json` and re-derived by the probe every run). V47-1/V47-2/V47o-1/V47o-6/V47o-8 are verified only through VALIDATION.md and the README's generated output.
- I ran nothing on a validator. Every program-level conclusion above is from reading the source against the suite's pinned arms and the measured facts; where a behaviour is load-bearing I named the arm that measures it.
- The invoke pattern of N AccountMetas against N−1 AccountInfos (the last meta duplicating the program id) appears throughout the Core CPIs; the suite exercises every one of them on a real validator with real Core, so the pattern is proven by the runs even though I could not re-derive the syscall's account resolution from memory.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Have Gary read the addresses aloud, from his wallet, on his machine, before anything is signed.** `init_authority`, `guardian`, `bank_treasury`, `swap_operator`, `cbob_mint`, `pob_root` are strings in `launch/mainnet-init.json`. Every check downstream — the checker, the ceremony page, the programs — validates them against *each other*, not against Gary's actual wallet. A valid-pubkey typo locks in a wrong guardian or a wrong 15% destination forever. The ceremony page checks the *connected* wallet against `init_authority`, which is a real control at signing time — but only for that one value. A human comparing the file to the wallet on a screen he controls is the only check that closes the class.
2. **Have the Proof of Burn holders confirm the committed set is *their* set.** The Merkle root, the probe, the claim page and the suite all re-derive from `scripts/pob-set.json` — one file. Every check proves the root matches the list; no check proves the list is the right 240. If the snapshot was taken wrong, or an address was swapped before the root was computed, the whole chain agrees with itself and the wrong holders are locked out of a window that can never reopen. A public announcement of the root, with a handful of holders verifying their own PoB address proves against it, is the only control.
3. **Put a real Phantom on the widest openings before publishing the redeem page.** The e2e's Phantom-like signer is faithful to the observed wrap, but item 50's own remaining requirement stands: the claim-first-with-strays and W5 shapes, and a page-budgeted opening, through the real wallet. This is the one holder-money path where the stand-in is not the thing.
4. **Run the full certifying suite on a second, clean machine.** Every on-chain arm has only ever run on the Bank's box, against its `.env.local` RPC and its `/opt/cbob-vaults` path. The verifiable-build workflow proves the *bytes* on GitHub's runners; nothing proves the *tests* reproduce off the box. One clean-clone `run-tests.sh` (the README now gives the bootstrap order) would catch box-specific assumptions.
5. **Rehearse the human half of the alarm.** The detection half is tested both ways; the response half — a page reaching a person who can reach the guardian wallet and the swap-operator key inside the cap × window bound — has never been exercised with a human in the loop. One scheduled drill (a deliberately forced sweep failure on a throwaway deployment, a human walking the runbook) is the only evidence that limit 10's "until the guardian pulls the stop" is minutes, not days.
6. **Extend the rehearsal's stranger exposure.** The dress rehearsal ran five vaults the box controlled. Before the lock, let a handful of unaffiliated people hold rehearsal vaults and try to break them — the immutable programs will face hostile holders on day one, and the only cheap place to find what they find is a throwaway deployment.
7. **A human reads HOLDER-GUIDE.md as a promise, not as a spec.** I checked every sentence against the code; an AI can do code-vs-text. It cannot judge whether "your level never changes" and "a bug cannot be fixed" are promises this business can make to these holders, in this jurisdiction, at this size. That is a judgment only the person making the promise can make — and it is the one sentence the immutable programs will enforce forever.