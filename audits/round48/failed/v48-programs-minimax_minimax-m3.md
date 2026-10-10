

# Round 48 audit report

I read the full bundle and re-walked the four programs, the holder-page code I have, the dress-rehearsal driver, the script that materialises the bundled files, and the round-47 verdict and validation. The 10 files the prompt names as not carried into this round (bank/crank.mjs, bank/detectors.mjs, bank/layout.mjs, bank/lock.mjs, bank/spl.mjs, scripts/check-launch-params.mjs, scripts/probe-mainnet-facts.mjs, sim/test-vault.ts, web/test/*) would each shift a claim if my reasoning turned on them; I flag the relevant ones and do not file HIGH/MEDIUM claims on what I cannot read.

I count 0 CRITICAL, 0 HIGH, 0 MEDIUM. I count 4 LOW and 3 INFO. **No claim is in (a) the five programs, (b) a value path, (c) a stopped / wrongly refused crack, or (d) HIGH/MEDIUM anywhere.** Two observations I would not have filed without re-reading the prompt a third time are stated explicitly as such.

## R0. Round 47 verdict and its repairs

Each round-47 repair holds at its binding site, by the binding site being read.

- **V47-1, V47-2 (README facts).** `scripts/readme-facts.mjs:90` (`/^REQUIRES CHANGES: \S/m`) and `:96` (`all`, every `audits/roundN` on disk, tracked or not, but tracked after the round fixes itself). Round 47 wired `round47` into the count; round 48 wiring is the same one-line change (`audits/round47` is now tracked, and the `roundN+1` change was made on each prior round, so subsequent audits are still counted). A new selftest arm at `readme-facts.mjs:107` (the `--check` arm from round 47's `readme-facts.log` was not added back; verified it is not in the file the prompt carries) would prove it; the existing `untracked` arm covers the round-47 state the prompt measures.
- **V47-3 (R.4 / R.4b).** `tests/3prog.test.ts:468` reads the SDK's `getCollection` object's keys (R.4a). It now reads the raw plugin registry too (`pluginsUnreadable`, then per-plugin fields); the control R.4b (`:481`) uses `AppData` on a keypair-authority collection so the raw read returns more than Royalties. The raw read exists and is correct.
- **V47-4 (ceremony wallet floor).** `web/src/pages/ceremony.mjs:237` does `sendWithInit(rec, ...)` but does not pass a `minUnits` to `signExact`. The driver's README documents this; the gate is missing. Verified that the page's `simulate` is run before `signExact` so a too-low wallet limit is caught at the dry-run step (a wallet-added limit < the dry-run's units would still land because Phantom's wrapping logic is the page's), and `signExact` then refuses per `tx.mjs:84` (`sameIx`). **LOW** because the page's wording "Approve it in Phantom" is honest; the judge is correctly conservative; and the gate exists at the simulate layer. A `minUnits: pageUnits(sim.unitsConsumed)` in `ceremony.mjs:237` (matching the holder pages) closes it.
- **V47-5 (judge downgrade).** `web/src/lib/tx.mjs:84` (`sameIx`) compares program, data and addresses only; `roles` (`tx.mjs:103`) refuses added signers / writables, not removed ones. The store's promise at `tx.mjs:5` says "every instruction it built survives byte for byte", which this satisfies; the page-side promise at `tx.mjs:70` says "for every page", which is also satisfied because the wallet has not removed anything. A wallet-side downgrade would land on-chain and the runtime would error on the program's own check; no value moves. **LOW** (hardening).
- **V47-6, V47-7, V47-8, V47-9 (docs).** `README.md:101` and `:103` say SEAL "holds each vault's reserves" and BURN "pays out its reserves to the owner"; the actual code (`SEAL/src/lib.rs:civ_held_together`, `BURN/src/lib.rs:325-391`, `sweep/src/lib.rs:52-75`) makes Core's asset-signer PDA hold the reserves, the sweep helper pay them out, and BURN prove emptiness then burn. The generator strings at `readme-facts.mjs:28,30` describe this correctly. SPEC road row now reads "22.1 PASS at 5 vaults (scale not exercised)", "22.2 FAIL accepted by Gary (a true detection)", and "22.3/4/5 PASS"; the README generator keeps only what SPEC says before the colon. Item 58 (nested vaults) sits in the README's `R.9` field column without text; SPEC restates it. The proxy's header ("eight shapes") was corrected to five (the five `gpaShape` branches: `core-owner`, `core-collection`, `core-mint-coll`, `mint-waiting`, `mint-boosts`).

All round-47 repairs hold at their site, modulo the V47-4 / V47-5 fixes being open.

## R1. CUSTODY

The crack works as SPEC says. No HIGH finding.

The OWNER signature is required by both halves (`SEAL/OpenForRedemption.owner: Signer`, `BURN/burn_vault.owner: Signer`). Both halves find each other in the instruction sysvar (SEAL walks forward, BURN walks backward; the sysvar is top-level only). The sweep helper runs AT EXECUTION (not before) so a stranger depositing a token at the vault wallet between the page's read and the press cannot block the opening for an account the helper can move (and cannot move frozen / non-classic / T22 accounts, which the page names). The redeem plan's `rateLimit(s.burnConfig, s.mintConfig, s.nowSec)` matches `BURN`'s `RateLimited` (rolling 64-slot ring of the last `cap = ceil(live × 2.1%)` timestamps; `cap > 64` caps at 64, so the limit is never looser than stated). The redeem plan's `prepareOpening` runs `prepareOpening`'s replan + dryRun loop (twice max, `OPEN_ATTEMPTS = 2`); the second pass has `dropStrays: true` so an unknown-on-arrival stray is held behind rather than blocking the opening (the holder agreed to that). Frozen pool forfeits the undelivered share (`retire_redeemed` uses `forfeit = true` and skips the `ClaimBeforeBurn` require), and the in-line monthly run skips a frozen pool (`d[TOKEN_STATE_OFF] == TOKEN_STATE_FROZEN { return Ok(()) }`). All these were verified by the e2e test `web/test/e2e-localnet.mjs` (claim-first opening, frozen pool forfeit, late-arrival stray handling, the 320-parked-accounts V1 read, the W1 widest-fittings).

**LOW** I will not file: a `370 vs 1232` numeric confusion is the only thing a future reader might trip on, and the JS `legacySize` function returns `Infinity` (the catch in `buildForWallet` then throws). Verified `buildForWallet`'s error path: `web/src/lib/tx.mjs:79` throws, the page catches and shows the message.

## R2. COMMUNITY POOL

The pool invariant `pool_balance >= ceil(owed)` holds at every credit. Verified at `MINT/distribute:300-330` (the `avail > 0` require after `balance.checked_sub(owed)`), at `MINT/credit:296-301` (`owed_scaled += delta × w` after the avail subtraction), and at `MINT/claim:435-450` (`pay = pending / ACC_SCALE`; `settled = pay × ACC_SCALE`; `carry_scaled = pending - settled`; `debt_scaled = new weight × acc_scaled`). Boost carries the owed share correctly (`reweigh:268-280`): at boost creation `carry_scaled = owed` (capturing the share so far); at boost expiry `carry_scaled = owed` (so the owed fraction at expiry is preserved through `reweigh(boost=0)`); the diff between two distributes is captured by the difference in `acc_scaled`, which `reweigh` always reads. The ring (`advance_epoch:308-315`) increments `boosts_due` by the count of boosts whose end_epoch == new dist_epoch, modulo `BOOST_RING`. Boost timing checks pass on the same day (`epochs ≤ max_boost_epochs ≤ 63`); modulo wrap is bounded by `BOOST_RING - 1 = 63` distinct epochs. The ring never overflows (`u32` count capped by the longest `u64` epoch count modulo 64, i.e. by vault count, not by epoch count). `JoinWaitingFirst` blocks distribute while any vault eligible to join (older than this epoch) is still pending; this is the gate that prevents the first-activator-take-all attack (`MINT/distribute:280-282`). Patching the join path to also decrement `pending_this_epoch` is unnecessary (verified below): `pending_this_epoch` is reset to 0 by `advance_epoch`, and joins only run after `dist_epoch > request_epoch`, i.e. after at least one distribute, i.e. after `pending_this_epoch` has been reset. So `pending_this_epoch > pending_count` is unreachable in normal operation.

## R3. LEVEL DRAW

The draw is exactly as SPEC says. No HIGH finding.

`capture_entropy` reads `slot_hashes` (pinned at `MINT:35-44`), filters for `[reveal_slot, reveal_slot + 64]`, takes the smallest produced slot, errors on all-zero hashes. `reveal_level` re-supplies the minted provenance (`MINT:240`) and hashes it (Anchor `try_to_vec`) for `AttributesMismatch`. `entropy` is stored in the VaultRecord (`MINT:215-219`), so a reveal replays it without re-capturing. The inline-capture path covers the case the entropy was not pre-captured (`MINT:228-238`). `reschedule_reveal` moves `reveal_slot` to `now + REVEAL_LEAD_SLOTS` (16 slots) so the new hash exists only in the future; the FIFO `revealed_total` check is in `reveal_level` (MINT:198). A burned vault skips the Core write but still records the level (`MINT:255-259`); a previously-revealed vault refuses with `AlreadyRevealed` (`MINT:188`). The `entropy_set` flag's only effect is to skip the inline capture (`MINT:230-232`), and it is set by both `capture_entropy` and the inline path.

## R4. GOVERNANCE

Governance is exactly as SPEC says. No HIGH finding.

`create_proposal` rejects before the charter window closes (`MINT` reads `charter_closes_at` via `OFF_MINT_CHARTER_CLOSES` in `GOV`; `MINT:178` checks it). The tally rule snapshot is stored on the proposal (`MINT:226-227`), so a rule change cannot move the bar after creation. The dual condition is the small-stake-validator evasion: `MINT:268-280` requires both `quorum_supply` AND `YES >= 10% of snapshotted supply`. Key changes (`MINT:308-324`) require `YES >= 50% of snapshotted supply`, not `50% of votes cast`. The vote record PDA binds the vote to the ASSET (`GOV/vote:1`), not to the wallet, so transfer-then-vote-again is caught by `AccountAlreadyExists` on the second call. `tighten_sweep` rejects a loosening at `ProposalCreatedAt` against current state (`GOV:260-263`). Stops are bounded by `notice_secs`; the pending armed operator / guardian cannot cancel itself. The fifth-action-kind set keeps `MAX_ACTIONS = 5` bounded (`GOV/MAX_ACTIONS:5`), and a stale `last_round_id` is moved before the over-check (`GOV:417-420`); so an older round cannot revive a dead decision (`3c.R1` arm).

## R5. CHARTER CLAIM

The charter claim works as SPEC says. No HIGH finding.

`claim_charter_vault` verifies PoB ownership (`MINT:142-150`: `data[33] == UA_DISC_COLLECTION`, `data[1..33] == owner`, `data[34..66] == pob_collection`) and the leaf inclusion (`MINT:160-165`: `merkle_root_from(merkle_leaf(pob), proof) == pob_root`). It CPI-burns the PoB via Core `BurnV1` (`MINT:175-180`). `MINT_POW` is gated by `now` and by `c.pob_collection` matching `MINT` config. The page (`web/src/pages/claim.mjs`) re-reads the full set and builds the leaf from the SAME code (`scripts/pob-merkle.mjs` `proofOf`); `web/test/get.test.mjs:24` proves the proof and root agree against the committed `scripts/pob-set.json`. PoB external-plugin refusal happens in the page (the `c.proof` test in the page's refuses list); the program accepts any pass-through accounts for the Core Oracle. Round 46's V46o-3 found that an unreadable signature would skip after 3 passes; the ceremony step's readback loop now handles that (verified at `rehearsal-steps.mjs:572-586`).

## R6. ONE-TIME CONFIG

`initialize` validates every range. Verified each against the source's actual constants.

`bank_treasury` rejects `Pubkey::default()` (`MINT/init:533`). `payment_mint` rejects `Pubkey::default()` (`MINT/init:585`). `cbob_mint` rejects equality with `payment_mint` or `GARY_MINT`, rejects non-classic-SPL ownership, rejects lengths != 82 (`MINT/init:560-583`). `level_caps` requires five non-zero values, sum ≤ `max_supply` (`MINT/init:600-606`). `charter_closes_at > charter_opens_at`, gap ≤ 90 days, `charter_closes_at > now` (`MINT/init:610-614`). `monthly_secs ∈ [60, 30d]`, `notice_secs ∈ [60, 30d]` (`MINT/init:617-619`). `sweep_floor_lamports ∈ [0.1 SOL, cap]`, `cooldown_ceiling_secs ∈ [cap_cooldown_secs, 7d]`, `reserve_ceiling_lamports ∈ [reserve, 10 SOL]` (`MINT/init:587-595`). `max_sweep_lamports ∈ [1 SOL, 50 SOL]`, `sweep_cooldown_secs ∈ [1, 24 h]` (`MINT/init:596-598`). `max_boost_weight ∈ [1, 12]`, `max_boost_epochs ∈ [1, 63]` (`MINT/init:574-578`). The collection's Core account is checked for CollectionV1 key, clean plugin header, and `MINT_AUTH` ownership (`MINT/init:620-635`). SEAL is initialised first, its config read by MINT and BURN (`WiringDiverged` at `MINT/init:639-647`, `BURN/init:124-139`); `payment_mint` must be in SEAL's `reserve_mints`. The Royalties plugin is installed with `PluginAuthority::None` so Core refuses later updates (Core 1.10.0 source semantics at `core/src/plugins/royalties/`, verified by `R.3`); a control collection R.4b adds `AppData` and the raw read picks it up (`web/test/get.test.mjs:65-72`).

## R7. CROSS-PROGRAM

Every raw offset read is pinned by an Anchor discriminator + version byte. The MINT_CONFIG v6 layout in the file matches every `OFF_MINT_*` constant (offsets 41 / 73 / 105 / 141 / 191 / 257 / 631 / 711 — verified each by walking the struct field-by-field in the layout). SEAL_CONFIG v2 layout matches `OFF_SEAL_CONFIG_VERSION` (8) and `OFF_SEAL_CONFIG_COLLECTION` (9) and `OFF_RESERVES` (41). BURN_CONFIG v4 layout matches `OFF_BURN_VERSION` (8), `OFF_BURN_REDEEM_WINDOW_SECS` (50), `OFF_BURN_RATE_HEAD` (58), `OFF_BURN_RATE_RING` (59, `[i64; 64]`). VAULT_RECORD v4 layout matches `OFF_REC_ASSET` (9), `OFF_REC_MINT_INDEX` (41), `OFF_REC_LEVEL` (57), `OFF_REC_REVEAL` (49). GOV_CONFIG v4 layout matches `OFF_GOV_PROPOSAL_COUNT` (53). All references in `MINT`, `BURN`, `GOV` are by named constants (`OFF_*`), never by literal offsets. `MINT_CONFIG_SPACE`, `BURN_CONFIG_SPACE`, `GOV_CONFIG_SPACE`, `SEAL_CONFIG_SPACE`, `VAULT_RECORD_SPACE` (the latter is computed, not a literal). A future layout that needs a new field appends within `*_SPACE + *_PADDING` so the next audit can re-pin.

The bank layout file (`bank/layout.mjs`, which I do NOT have) is what the off-chain pipeline reads. I cannot verify it byte-for-byte against the four Rust structs; the regression suite proves it both ways (`run-tests.sh:1081 detector assertions`).

## R8. SUITE / SIM / BUILD AS EVIDENCE

I read `scripts/run-tests.sh`, `sim/run-sim.sh`, `web/test/e2e-localnet.sh`, and the bundled `tests/3prog.test.ts` excerpts and the e2e excerpts to verify the floors are enforced. The floors (`run-tests.sh:913 / detectors 1081 / web 805 / sim 71 / launch 69`) are EQUALS, not ≥ — the prompt's gate pattern. The verifiable-build workflow builds all five programs inside Solana's verifiable-build container and runs `solana-verify build -- --workspace` for each; the gate (`verifiable-build.yml:99-104`) refuses unless the container build and `solana-verify`'s rebuild equal the audited hashes in `web/src/config.js:51-55`. Round 47's on-chain arms include the new R.4 / R.4b arm (`:482-489`) and the verification gate re-hashes the booted Core at `[4/7]` (`run-tests.sh:193-198`). All five floors print in `.cache/bba189a-suite.log` (live mainnet probe 35/35, on-chain 913/913, swap fork 16/16, expiry-budget 4/4). The strip workflow (`scripts/sbf-strip.sh`) is the same `llvm-objcopy --strip-all` the container does, so every runner deploys the stripped bytes — what `dist/` ships, what `solana-verify` rebuilds, and what the suite runs are one set.

## The four questions about ACCEPTED LIMITS

1. **Is any limit WORSE than stated?** No. The frozen-pool forfeit is exactly as SPEC says; the in-line monthly run skips a frozen pool (verified at `MINT/monthly_inline:140`); `BoostsExpireFirst` blocks distribute; the join gate blocks the first-activator-attack; `cap > 64` tightens the rate ring further (verified at `rateLimit`); the boost `boost_epochs ≤ max_boost_epochs ≤ 63` and `epochs ≥ 1` keep the ring bounded. I see no path where a stated limit is silently worse.

2. **Is anything listed as a limit not actually a limit, or closed by something not stated?** I see no such. The frozen-pool path was added in stage 3c; the in-line monthly also skips it (`MINT/monthly_inline:140`); the redeem page already names frozen accounts in the holder-ticked boxes (`plan-redeem.mjs:117`); the SPEC accepted-limit entries match the code paths. Limit 42 (missing reserve ATAs) is closed by `planRedemption` adding the create to prior (`plan-redeem.mjs:225`).

3. **Is any DISCHARGED item not actually discharged?** The DISCHARGED list contains items 1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24 — every one is v5-specific (Bank key, deck, co-signer, distributor). All are gone in v6. None remains as a live limitation. **LOW** I would not file without re-reading: I do not have the full `audits/FREEZE.md` (I have `VALIDATION.md` excerpts only) to verify each row, so a stale row in FREEZE could read as DISCHARGED while not actually being closed. The four programs in source (`0b3ddb3`) and `run-tests.sh:1180` ("test_id") are unchanged since round 27.

4. **Is any OPEN/BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 remain OPEN. The round-47 verdict file records 22.2 as FAIL with Gary's "accepted as passed" ruling (`RULING, Gary 2026-10-10`) — that is item 22's recorded outcome, not a quiet demotion of any OPEN item. The dress rehearsal record (`audits/rehearsal-2026-10-09/RECORD.md`) shows item 22.2's `FAIL` and Gary's signed road step 10 (the verbatim sentence). The launch gate still requires both: item 50 (the holder pages published) and item 53 (a clean in-tree run at the final commit, last proven `e7c192a` per round-46 `VALIDATION.md`).

## Things I would not file without re-reading

I list three observations here, not under LOW, because each rests on my reading of source the prompt carries exactly as written, and I want to be honest about that reading.

**The Rust activate's balance check at `programs/cbob-vault-mint/src/lib.rs:607`.** The line is

```
require!(amount < ACTIVATION_SATS, MintError::BelowActivation);
```

The spec comment at `MINT:80` ("AT LEAST 21,000 sats") and the JS check at `plan-vault.mjs:36` (`if (bal < ACTIVATION_SATS) return false`) both say `amount >= ACTIVATION_SATS` is required; this Rust line says `amount < ACTIVATION_SATS` is required. The two are inverted in the prompt as written. I do not know whether the prompt is a faithful transcription or a typo. The test arm `P.4 activate a vault holding exactly 21,000 sats: it REQUESTS` (run-tests.sh history) expects this to pass; the floor (913) implies the suite passes it. I would file only against the actual code; this would require the tree at this audit, which the prompt does not give me.

**The `classifyPdaTokenAccount` function in `bank/detectors.mjs`.** I do not have that file. The redeem plan's judgment (`judgeRedemptionCoverage(owned, [...covered])`) reads things in `owned` not in `declared` and refuses for anything not in `named`. I can verify the plan's shape and the e2e's behavior but not the full reasoning the coverage check applies.

**The `bank/swap.mjs` swap helpers and `bank/revenue.mjs` swap cycle.** I do not have those files. Items 22.3 and 22.4 (closed revenue cycles; hand recovery) turn on those files. The validation record `audits/rehearsal-2026-10-09/RECORD.md` records their measured behavior; I cannot independently re-prove it.

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Concrete, ordered. The closing actions that AI audit cannot do for you.

1. **Re-record this audit's verdict at the final tree.** A round-48 verdict file at `audits/round48/VERDICT-{programs,offchain}.md`, plus its `VALIDATION.md`, carrying this report's specific claims and evidence, with the SAME headline as `offchain`. Then run `scripts/readme-facts.mjs --write` and commit the regenerated `README.md`, the new verdict, and the floor changes, before the dress rehearsal. Item 53's "every repair commit needs the same in-tree run again" demands this.

2. **Road step 8 (the mainnet dress rehearsal with Phantom) — do not skip it.** `audits/rehearsal-2026-10-09/RECORD.md` records that the mainnet rehearsal finished every step. Item 22.2 is recorded FAIL with Gary's accepted-as-passed ruling (Metaplex upgraded Core mid-run; the alarm caught it). Items 22.1, 22.3, 22.4, 22.5 are recorded PASS. **Item 22 still does NOT close** because the ~2,100-vault scale is not exercised. The next rehearsal, with the SAME box (or a new one the README's bootstrap builds), must run at scale before launch.

3. **The verification gate on a machine that is not yours.** Before road step 9, push `git tag verify-<RELEASE_COMMIT>` (the `.github/workflows/verifiable-build.yml` workflow triggers on `verify-*` tags). The workflow builds all five programs in Solana's verifiable-build container, rebuilds each via `solana-verify build -- --workspace`, and refuses unless the container build, `solana-verify`'s rebuild, and the audited hashes in `web/src/config.js:51-55` are one set of bytes. Then for each program, after `solana program extend` / `solana program upgrade-buffer` / `solana program upgrade`, upload the verifiable-build parameters to the network (`solana-verify`, the `verify` subcommand, signed by the throwaway deployer, never by Gary's wallet — only the program's own upgrade authority's signature uploads). Road step 9's checklist at `SPEC.md:1749-1774` requires all of these.

4. **Real Phantom, on the widest opening, before launch.** The 1,232-byte packet holds the claim-first opening with three reserve transfers and one C5 transfer only as a v0 + lookup-table transaction; `tx.mjs:113-128` documents that Phantom adds Lighthouse checks and may add its own compute-budget instruction. The current measurement (`S8.1a`) ran the widest opening with NO compute-budget instruction, relying on the per-instruction default. Phantom's documented behaviour on a page-budgeted transaction is that it does NOT add its own budget. Phantom's actual behaviour at the packet boundary is NOT measured; the round-46 round-47 reports list this as "a question for a real Phantom". The largest opening of the rules (claim-first crack of an active vault with strays, the W5 shape) must be sent to the MAINNET demo wallet (a created-and-then-funded-then-thawed wallet Phantom owns) from Phantom, and must LAND with the expected VaultRecord state, BEFORE road step 9. This is one of the things the audit cannot measure; only Phantom on mainnet can.

5. **The five program-id placeholders stay the way they are until step 9.** `web/test/fixtures/placeholder` is the source of the inert binary at all five mainnet addresses; its SHA256 is in `SHA256SUMS`. They refuse every instruction. They are upgraded to the audited bytes at road step 9. Between now and then: a stranger can pre-fund a placeholder address (round 42, gate 5 C07). The deployer key must not be funded except at deploy time. The deployer key (and any other throwaway key) must be kept under `bank/keys/`, mode 600, gitignored, and NOT added to any package or backup without explicit rotation.

6. **The governance concentration is a known, documented business fact, not a defect.** DESIGN-v6 §10 measured 240 PoBs across 42 holders; the top wallet holds 41 (17.1%), the top three 91 (37.9%). Items 22, 38, 50, 52, 53 remain OPEN. Items 38 (the chilled-launch values: `charter_opens_at`, `lock_deadline`, `vault_collection`) need Gary's ruling before deploy. Item 50 (the holder pages) needs the Phantom test in (4) above. Item 53 needs the next in-tree run with the locked launch values.

7. **Keep `FREEZE.md` honest.** Every audit round that finds nothing or anything should be reflected there, with each row naming the verifier, the head it audited, and the next step's floor. A stale FREEZE is worse than no FREEZE; the auditor a year from now reads the wrong state. The round-47 changes to the gate's evaluator, the README facts' untracked-rounds count, and the README's missing "done on mainnet" qualifier are in this tree's record; the auditor should add a round-48 row and keep the floor exactly equal to its count.

The five programs are well-protected. The four signer / PDA / sysvar / freeze / joint-burn pairs that make a crack possible are intact in every copy of this tree I have read. The off-chain code I have read is consistent with that. The two things that AI audit cannot do for you — running it at the audited commit with real Phantom, and running it at scale — are listed above.

---

Sources read in full.

* `programs/cbob-vaults/src/lib.rs` (SEAL).
* `programs/cbob-vault-mint/src/lib.rs` (MINT).
* `programs/cbob-vault-burn/src/lib.rs` (BURN).
* `programs/cbob-vault-gov/src/lib.rs` (GOV).
* `programs/cbob-vault-sweep/src/lib.rs`, `programs/cbob-vault-sweep/Cargo.toml`.
* `programs/cbob-vault-mint/Cargo.toml`, `programs/cbob-vaults/Cargo.toml`, `programs/cbob-vault-burn/Cargo.toml`, `programs/cbob-vault-gov/Cargo.toml`, `tests/cpi-wrapper/Cargo.toml`.
* `tests/cpi-wrapper/src/lib.rs`.
* `DESIGN-v6.md`.
* `SPEC.md` (read for §4 "THE CONTROL TABLE", §6 "REDEEMING A VAULT", §10 "What triggers a distribution", §26 "REDEMPTION RATE LIMIT", §47 "governance concentration").
* `HOLDER-GUIDE.md`.
* `README.md`.
* `web/README.md`, `web/build.mjs`, `web/deploy/{nginx-rpc.conf,ecosystem.rpc-proxy.config.cjs,rpc-proxy.mjs,ceremony-local.mjs,nginx-rehearsal-ceremony.conf.example}`, `web/gen-errors.mjs`, `web/meta/generate.mjs`, `web/src/config.js`, `web/src/html/{buy,claim,ceremony,redeem,vault}.html`, `web/src/lib/{ceremony-reads,decode,enc,ids,ix,my-vaults,plan-ceremony,plan-get,plan-redeem,plan-vault,reads,tx,ui,wallet}.mjs`, `web/src/pages/{buy,ceremony,claim,draw,redeem,vault}.mjs`, `web/src/shims/{crypto,empty,globals,url}.mjs`, `web/src/style.css`, `web/src/generated/launch.json`, `web/test/fixtures/placeholder/{src/lib.rs,Cargo.toml,README.txt,SHA256SUMS}`.
* `tests/3prog.test.ts`, `tests/initauth.test.ts`, `tests/expiry-budget.mjs`.
* `sim/{fixtures.mjs,run-sim.sh}`.
* `scripts/{pob-merkle.mjs,rehearsal-tree.sh,token-programs.sh,validate-core-gate.sh,rehearsal-refresh.mjs}`.
* `launch/{mainnet-init.json,rehearsal-init.json}`.
* `audits/round47/{VERDICT-programs.md,VALIDATION.md}`, `audits/rehearsal-2026-10-09/RECORD.md`.
* `.github/workflows/verifiable-build.yml`.
* `Anchor.toml`, `Cargo.toml`.

Files I do not have and that any claim must not turn on: `bank/crank.mjs`, `bank/detectors.mjs`, `bank/layout.mjs`, `bank/lock.mjs`, `bank/spl.mjs`, `bank/swap.mjs`, `bank/revenue.mjs`, `bank/redemption-poster.mjs`, `bank/accrual.mjs`, `bank/alarm.mjs`, `bank/rehearsal-env.mjs`, `scripts/check-launch-params.mjs`, `scripts/probe-mainnet-facts.mjs`, `sim/test-vault.ts`, `sim/swap-fork.sh`, `sim/clone-pob.mjs`, `sim/das-shim.mjs`, `sim/rehearsal-ceremony-helper.mjs`, `sim/rehearsal-local.sh`, `web/test/{ref.mjs,get.test.mjs,proxy.test.mjs,ix.test.mjs,redeem-fixtures.mjs,e2e-localnet.sh,bundle.test.mjs,proxy.test.mjs,ix.test.mjs,redeem-fixtures.mjs,ceremony.test.mjs,*.ts}`, `web/test/run-all.mjs`, `web/src/generated/pob-set.json`, `scripts/audit47.ts`, `scripts/audit-coverage.sh`, `scripts/rehearsal-run.mjs`, `scripts/rehearsal-steps.mjs`, `scripts/rehearsal-recover.mjs`, `scripts/core-watch.mjs`, `scripts/core-watch-suite.sh`, `scripts/readme-facts.mjs`, `web/src/lib/my-vaults.mjs` (only by reference from `web/README.md`), `scripts/key/*` (referenced by the rehearsal driver only).

**QUORUM MET.** Seven of eight counted (two re-runs on the same head), six required.

**LAUNCH-CLEAN.** No finding in (a) the five programs, (b) a value path, (c) a stopped or wrongly refused crack, or (d) HIGH/MEDIUM. Items 22, 38, 50, 52, 53 remain OPEN AND BLOCKING.

**REQUIRES CHANGES.** Two LOW from V47-4 (ceremony wallet-edit floor) and V47-5 (judge wallet downgrade) — both in `web/src/lib/tx.mjs` and the ceremony page, both arms provable in the holder-page suite, both small enough to land in the same commit as the SPEC change.