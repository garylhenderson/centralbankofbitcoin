# Independent security audit — v6 final tree

I read the five programs, the sweep helper, the whole suite, the simulation, the runners, the holder pages and the ceremony from first principles, recomputing every offset, space constant and discriminator rather than reading the comments. I found **no confirmed defect in the five programs, no path that moves or miscredits value, nothing that stops or wrongly refuses a holder's crack, and nothing at HIGH or MEDIUM.** Everything below is LOW/INFO in the fixable layer, plus two things I could not verify from this bundle and one coupling I want on the record. I state for each what would exist if I am right.

---

## R0. Round 43's verdict and its repairs

**Verified, with two gaps.**

* Re-measured the round-43 repairs against the code:
  * `planRescues` — the crank's rescue planner is not in this bundle (`bank/crank.mjs`), so I verified only its *program* half: `rescue_nested`'s destination is `config.bank_treasury` (`programs/cbob-vault-mint/src/lib.rs`, `require_keys_eq!(a.new_owner.key(), dest, WrongRescueDestination)`) and `HostUnresolved` covers exactly "not the vault, not burned, not a live CBOB vault". The suite's `R43.V1`/`R43.V1a` arms and the `because('R43.V1a','NotNested')` pin are consistent with the code path (`require_live_vault` → owner read → `owner == signer_pda(host)` → `NotNested` before `HostUnresolved`). **Held.**
  * `V43o-2` (unreadable-signature skip) — `bank/alarm.mjs`/`bank/sigwalk.mjs` consumers are outside this bundle; `bank/sigwalk.mjs` itself has no skip logic, so the skip must live in the alarm. **Could not verify here.**
  * `V43o-1` (`release_gate`) — `scripts/run-tests.sh` in the bundle does what round 43 says: outside a rehearsal tree it is the unchanged `git diff --quiet "$rel" -- programs Cargo.toml Cargo.lock`; inside it, the python gate checks the map shape, the recorded patch sha256, the four keyed programs patched, and the reverse map. **Held.** One thing to note: the gate checks `git diff --quiet "$rel"` where `$rel = 0b3ddb3d…` from `web/src/config.js`. That is correct today (programs unchanged since round 35) but it means *any* future program change silently invalidates the pages' pinned hashes until config.js is updated — the gate is the only thing that catches it, and it does. **Held.**
  * `V43o-3` — a test extraction; not verifiable here.
* The Core re-pin: the four copies of `CORE_SHA256_EXPECTED` in the bundle (`scripts/run-tests.sh`, `sim/run-sim.sh`, `web/test/e2e-localnet.sh`, `scripts/build-mainnet.sh`) are all `30dce56b6b70ea524a3882ef7bc73936b9ae6ff3c3ea5cfee709ea935e710bf2`. **Held.**

**Two verification items, not findings (see F4 below and the scope note).**

---

## R1. Custody — no confirmed defect

I attacked the pairing and the emptiness proof directly:

* **Pairing.** `open_for_redemption` walks forward from `current+1` and binds asset at account 0 and owner at account 2; `burn_vault` walks `0..current` and binds the same two indices. Both walks use `load_instruction_at_checked`, which sees **top-level** instructions only. A CPI-reached open reports the *outer* index, so a wrapped open cannot satisfy a genuine burn's backward walk (`WR.3`), and a genuine open's forward walk sees the wrapper, not the burn (`WR.2`). `retire_redeemed` additionally requires `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1` and that the top-level instruction at `current` is `burn_vault` for this asset (`WR.1`, `P.23`). Two redemptions in one transaction work and are bounded by the rate limit (`4.9`, `4.10a`, `S9b.1`). I could not construct a borrow: asset **and** owner are bound on both sides, so no cross-vault borrowing is possible.
* **Emptiness proof.** `burn_vault` checks `asset_signer.lamports() == 0`, then for every reserve mint under **both** token-program derivations requires the account to be *declared* (`ReserveNotDeclared`), and if declared and token-owned requires `owner == pda`, delegate tag `[0,0,0,0]`, `delegated_amount == 0`, close-authority tag `[0,0,0,0]`, `len == 165`, and `amount == 0`. A second loop applies the same six comparisons to any *declared* non-reserve token account owned by the pda, and refuses a declared live `AssetV1`. I recomputed the field offsets (mint 0..32, owner 32..64, amount 64..72, delegate tag 72..76, state 108, is_native 109..121, delegated_amount 121..129, close authority 129..133, len 165) — correct.
* **The T22-derived address.** BURN requires both derivations *declared*, and a non-existent account can be passed (the runtime supplies a default System-owned AccountInfo — confirmed by `R35.N7` landing with `HostUnresolved` rather than an account-load failure). The ATA program refuses to create a T22 ATA for a classic mint (probe `F4.2`), so that address can only ever hold System dust, which `if acc.owner != SPL_TOKEN_ID && acc.owner != SPL_TOKEN_2022_ID { continue; }` skips. **Correct.**
* **Lamports.** The helper sends `signer.lamports()` read at execution; BURN reads `lamports() == 0` afterwards; nothing between them adds lamports. A later deposit reverts the burn (self-inflicted); a deposit before the helper is swept. **Correct.**
* **`rescue_nested`.** Destination is derived from config, not a parameter; the host test is `owner == signer_pda(host)`, then `host == vault || is_burned(host) || require_live_vault(host)`. It cannot be aimed at a foreign asset's owner or at an escrow. **Correct.**

## R1s. The sweep helper — no confirmed defect

* **(a) Access.** Called directly it needs the asset-signer's signature (`if !signer.is_signer`), which only Core can give via `ExecuteV1`. Core's rule is owner-only; the suite measured a stranger (`SR.5`), an owner-added `TransferDelegate` (`SR.5a`), and a control collection's update authority (`SR.5c`) all refused `0x1a`, with the owner landing on a control asset (`SR.5d`). SEAL's `["seal"]` PDA is a plugin authority, not an Execute approver, and SEAL's only Core CPI is `UpdatePluginV1`. **Correct.**
* **(b) Pair list.** I traced every case the prompt names: same source twice (the first closes it, changing its owner, so `read_token` on the second returns `IllegalOwner` — `SR.12a`/`SR.12b` pin exactly that); destination twice (harmless); source also a destination (implies `signer.key == dest.key`, refused by `InvalidArgument`); source not owned by the signer (`SR.11`); destination not owned by the destination wallet or of a different mint (`SR.12`); odd list (`SR.7`); zero pairs (`SR.13`); wrong programs (`SR.8`/`SR.9`); frozen source (`SR.14`). **Correct.** A *native* wSOL source and a non-ATA destination are unexercised — carried in round 43's C20; not re-filed here.
* **(c) Destination checks.** The destination wallet is chosen by the transaction builder, and (a) makes that only ever the owner. The lamport credit to a non-existent address below rent exemption is refused by the runtime (`R41.C8a`), and the canonical destination (the owner) exists because it pays the fee — SPEC 50 states this and the page follows it. **Correct.**
* **(d) Lamport sweep.** Nothing can leave the asset-signer non-zero between the helper and the burn; the burn's check sees exactly what the helper left. **Correct.**
* **(e) Missing reserve accounts.** The prior transaction (item 42) makes them nameable, and even without it BURN passes (the address is declared and skipped as System-owned); with a stranger's dust landed first, the prior create is idempotent and the sweep moves it. **Sufficient.** I found no account a stranger can create for a vault that neither the sweep can name nor BURN skips: the two reserve-ATA derivations are ATA-program PDAs (only the ATA program can create there — `R34.G2`), a T22 account at a reserve address is impossible for a classic mint, and a nested Core asset is the accepted limit 44.
* **(f) Fit.** `S8.0` asserts `B <= 1232 - 52 - 96`; the SPEC's 1,061-byte figure is the measured owner-payer shape and the page uses exactly that shape. **Consistent.**
* **(g) Evidence.** The arms can fail (each `because()` pin names a program-specific error, and `ID.1` enforces unique ids so a pin cannot read another arm's error). `build-mainnet.sh` `cmp`s the helper's mainnet bytes against both its own localnet build and `target/deploy`, which is what the suite deployed. **Held.**

## R2 / R2b. The pool and the boost — no confirmed defect

* **`pool holds >= ceil(owed)`.** `credit` adds `delta = floor(avail·1e12/w)` and `owed += delta·w`, so `ceil(owed_new) <= ceil(owed_old) + avail = balance`. `claim` reduces `owed_scaled` by exactly the sats it moves out of the pool. `retire` subtracts the vault's whole `owed_of`. I checked the same invariant through `reweigh` (owed moves to `carry`, debt restarts at the new weight, `owed_scaled` unchanged), `join` (`debt = w·acc`, `carry = 0`), and `expire_boost`. **Holds.**
* **Counters.** `pending_this_epoch` is zeroed only by `advance_epoch`, which runs at most once per instruction (no host calls both `credit` and `tick`), and `join` is only reachable when `dist_epoch > request_epoch`, so a joining vault is never inside `pending_this_epoch`. `retire` decrements both counters correctly for a same-epoch request and only `pending_count` for an earlier one. A duplicate `(record, dest)` pair cannot double-join (the second load sees `pending == false`) or double-pay (`pay == 0`). **Holds.**
* **Boost ring.** The bound `BOOST_RING - 1 = 63` is exactly what makes `end % 64` unreachable before `dist_epoch == end`: `end - e ∈ [1,63]`, so the slot is read at `end` and nowhere earlier. `unschedule_boost` takes the due branch iff `dist_epoch >= boost_end_epoch`, matching `advance_epoch`'s promotion, so `boosts_active = ring + due` always. **Holds.** The host test drives 260 epochs through the program's own free functions against a model; the coverage counters (`buys`, `early_wrapped63`) make it unable to pass by not reaching the branch.
* **Liveness.** A pending vault blocks distribution until joined, but joining is permissionless via `claim` (which does not require the asset to be alive), so no deadlock is constructible. A due boost blocks distribution until expired, and `expire_boosts` needs only the records. **Holds.**

## R3. The level draw — no confirmed defect

`blockhash_in_window` pins the sysvar id, bounds the declared count, checks the buffer holds it, refuses an all-zero hash, and takes the smallest produced slot in `[want, want+64]` — order-independent, so the sysvar's ordering cannot matter. `try_capture` derives A, then B and C each two 4-slot groups later; I bounded C ≤ `reveal_slot + 208` < `reveal_slot + 300`, so a capture inside the window always finds all three. `reveal_level` requires `index == revealed_total` (FIFO), still advances the census for a positively burned asset while skipping the Core write, and hash-checks the re-supplied attributes against `write_record`'s stored hash. SPEC 26's "C's leader chooses among many draws" is correctly stated and not understated; I found nothing worse.

## R4. Governance — no confirmed defect

`index_snapshot` and `quorum_supply` are fixed at creation; `cast_vote` refuses `index >= snapshot`; `VoteRecord` is seeded by the asset so a transfer cannot re-vote; `execute_proposal` requires `m.governance == gov_pda`, is once-only, expires after 7 days, and applies the per-kind marks **before** the "already over" skip (round 43's fix). `TightenSweep` is bounded against the live values at creation and against the `initialize` bounds at execution. Key changes need `ceil(50% of snapshot)` and are unbundled. I found no minority path and no vote that reaches money.

## R5. The charter claim — no confirmed defect

Leaf `sha256(0x00||key)`, node `sha256(0x01||min||max)`, proof bound 16, root compared to `pob_root`; the PoB's collection field **and** the passed collection account are both compared to `config.pob_collection`; the owner must sign and the asset must be owned by the signer; the burn is a CPI in the same instruction; `pob_extra` metas are all built with `false` signer. The window is two `initialize` values and a clock. Nothing else can write `charter`. **Correct.**

## R6. One-time configuration — no confirmed defect

I re-derived `MINT_CONFIG_SPACE` = 1261 (including the 8-byte disc and 256 padding), `VAULT_RECORD_SPACE` = 221, `BurnConfig` = 827, `GovConfig` = 350, SEAL `Config` = 398 with 3 reserves. All match `bank/selftest.mjs`'s L13c and the round-43 arithmetic. The royalty is installed with `PLUGIN_AUTHORITY_NONE` and Core refuses update/remove/re-delegate (`R.3`–`R.6c`, `R33.G3`). The redemption cap is exactly a 64-slot ring: `k = min(max(1, ceil(live·210/10000)), 64)`, the k-th most recent time, `now - kth >= window`. **Correct.**

## R7. Cross-program raw reads — no confirmed defect

Every offset I recomputed matches: `MINT` config 9/41/73/141/454/442/257/266/274/518/526/631/639/647/711/712/191/192, `BURN` 8/42/50/58/59, `GOV` 8/41/43/45/53/61/62/70/78/86, `VaultRecord` 8/9/41/49/57/125/126/127/129/161/177/178/186/187/195, and the sweep helper's 0/32/64/165. All are guarded by discriminator **and** version. The proxy's hardcoded `VAULT_RECORD_DISC_B58 = '8s2gvH1XffL'` is pinned transitively: `gpaShape` is asserted against the *captured* request built from `bs58.encode(acctDisc('VaultRecord'))`, so a wrong constant turns the proxy test red.

## R8. The suite, the simulation and the build — one finding

F2 below. Otherwise: the floors are `-eq` (not `-ge`), the runner refuses `CBOB_TEST_FILE` and a moved `CBOB_CACHE`, the Core gate is a pinned hash that the validator cannot tautologically satisfy, and `build-mainnet.sh` asks both builds the key question per program and `cmp`s the helper. `MIN_ASSERTIONS=912`, `DET_FLOOR=968`, `WEB_FLOOR=682`, `E2E_FLOOR=132` — all are equal-count gates.

---

## Findings

### F1 — LOW (pages/docs). `web/src/config.js` and `web/README.md` contradict the tree about SPEC item 53, and the `rehearsal` profile cannot consume the new value set.

**Construct.** `launch/rehearsal-init.json` is in the tree (round 44) and SPEC 53 states the rehearsal value set and `check-launch-params.mjs --rehearsal` are built. `web/src/config.js` still says *"SPEC item 53: launch/rehearsal-init.json and a rehearsal mode in check-launch-params.mjs are NOT BUILT"*, its `rehearsal` profile has `programs: { seal: null, mint: null, burn: null, gov: null, sweep: null }` and `launchValues: null`, and `web/README.md` says *"Rehearsal mode (SPEC 53) is still not built; the `rehearsal` profile refuses."* So the rehearsal value set exists and is judged by the checker, but the ceremony cannot use it: `makeIds` throws on the null ids, and `launchJson()` returns null → *"No launch values are configured for this profile."*

**Gain / loss.** None on chain. The cost is that a reader (or Gary, at the terminal) is told two different things about what exists, and the one file that must be edited to run the rehearsal ceremony is the one whose comment says it is unnecessary.

**Evidence if right.** `node web/build.mjs --profile rehearsal` succeeds; loading the built ceremony and connecting refuses with *"No launch values are configured for this profile."*, and `makeIds` refuses with *"this page is not configured yet: programs.seal, …"*. Both strings are in the bundled sources.

**Fix.** Update the comment; either wire `rehearsal` to `launch/rehearsal-init.json` plus the ids from `REHEARSAL-RECORD.txt`, or narrow SPEC 53's wording to say the *value set and checker mode* are built while the ceremony profile is not.

### F2 — LOW (tests). `tests/probe-round5.test.ts` cannot pass and is bundled as a live probe.

**Construct.** Its instruction data are the v5 argument lists: MINT `initialize` is sent as `[disc, collection, bank, gov, treasury]` (the current signature takes 20 arguments), SEAL `initialize` as `[disc, collection, bank, u32(1), mint]` (the current signature is `collection, Vec<Pubkey>`). Both fail deserialization inside `att()`, which swallows them; the config PDAs are therefore never created, `set_round` and `mint_vault` fail, and the probe dies at its first `fetchAsset`. It is not invoked by `scripts/run-tests.sh`, but `Anchor.toml`'s `[scripts] test = "… tests/**/*.ts"` names the whole directory.

**Gain / loss.** A file that is shown to auditors as *"retained round-5 Core behaviour probe"* verifies nothing; anyone running `anchor test` gets a red run whose reason (a v5 argument list) is not the reason the file's name implies. The properties it names are separately pinned — born-frozen by `2.3a`/`3.7`, the COption width by `probe-round5b` — so no property is lost.

**Evidence if right.** `npx tsx tests/probe-round5.test.ts` against a validator exits 1 with `FATAL` at the first `rec`, and the swallowed `att()` logs carry `InstructionDidNotDeserialize`.

**Fix.** Delete it (its properties are pinned elsewhere) or port its two builders to the current signatures and wire it into the runner.

### F3 — INFO (pages). An absent *pinned* collection is reported as "WRONG ON CHAIN: STOP".

**Construct.** `web/src/lib/ceremony-reads.mjs` `readStep('collection')` returns `['the collection <addr> does not exist']` when `ids.COLL` is set but the account is absent. `web/src/pages/ceremony.mjs`'s `steps()` treats any non-empty array as BROKEN and prints *"This account exists and does not hold the ruled values. It can never be rewritten. Stop and decide with the team before anything else."* That is false for an absent account, and the correct action is to fix the pin. Reachable because `resolveCollection` returns `config.js`'s `collection` and `launch/mainnet-init.json`'s `vault_collection` as pins **without** an existence check (only `remembered` is checked against the chain), so a typo in either file lands here.

**Evidence if right.** Put a valid-but-nonexistent base58 address in `web/src/config.js` `collection`, build, load the ceremony: the collection step shows the WRONG ON CHAIN stop.

**Fix.** Return `null` (or a distinct "absent" marker) for an absent pinned collection; keep BROKEN for an account that exists with wrong fields.

### F4 — INFO (verify). The README's committed `app.js` hash table must be re-checked at this commit.

**Construct.** `web/README.md` states the table *"is the committed reference (a bundle test fails if it does not equal a fresh build of BOTH profiles; any source change changes them)"*, and `web/src/pages/ceremony.mjs` bundles `scripts/check-launch-params.mjs`. Round 44 changed that module (`--rehearsal`). `web/src/lib/plan-redeem.mjs` also bundles `bank/detectors.mjs`, which rounds 36-43 touched. If the table was not regenerated in the same commit, `node web/test/run-all.mjs`'s `bundle` file fails and the runner's `WEB_FLOOR=682` gate turns red.

**Evidence if right.** `node web/test/run-all.mjs` — the `bundle` file reports a mismatch between the committed hash and a fresh build.

I could not compute the hash here: `scripts/check-launch-params.mjs` and `bank/detectors.mjs` are not in this bundle, so I cannot tell whether the table is current or stale. **This is a check, not a confirmed defect.**

### F5 — INFO (pages). The redeem page's refusal decision is a substring match against an off-chain module's free text.

**Construct.** `web/src/lib/plan-redeem.mjs`:
```js
for (const reason of judged.reasons)
  if (![...named].some(a => a && reason.includes(a))) refuse.push(`The vault holds something this page did not expect, so it will not open it: ${reason}`)
```
`judged.reasons` comes from `bank/detectors.mjs`'s `judgeRedemptionCoverage`, which is not in this bundle. The page's *decision to refuse an opening* therefore depends on each reason string embedding the offending account's base58 address. A reason that summarises instead of naming (or a future wording change) turns every affected opening into a refusal the page cannot explain, and the coupling is pinned only by the offline fixtures.

**Evidence if right.** Read `judgeRedemptionCoverage`'s reason strings in `bank/detectors.mjs`; if any reason does not contain the offending account's address, the redeem page refuses an opening that the page itself has already named and asked the holder to tick.

**Fix.** Have the detector return structured reasons (`{ kind, address }`) and match on the address field, not on prose. This is worth doing before publication even though the page is staged.

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?**

I could not find one, and I looked hardest at the four where a "worse" reading would matter.

* **9 / 44 (undeclared and nested holdings).** Actually *better* than stated in one direction the text under-claims: `coreAssetsOwnedBy` lists **every** Core asset the deposit address owns (not only ours) and `planRedemption` names a non-CBOB NFT in an acknowledgement, so the page does warn about a foreign nested asset. The chain still cannot enumerate, and the page is staged, so the limit stands as written.
* **26 (leader grinding).** Not worse: the statement already says C's leader "CHOOSE[S] AMONG MANY DRAWS", that skipping alone is best-of-4, that varying contents "adds more (64 tries reach 96%)", and that it applies to a whole cohort at once. I found no additional lever.
* **32 (rate limit).** Not worse: the ring bound is `min(cap, 64)`, which is *stricter* above 3,047 live — exactly as stated.
* **58 (nested/orphaned).** The V43-1 race is disclosed and ruled on (Gary, 2026-10-08). The one thing the text does not spell out is that the window is bounded by the crank's **hourly** full pass, so a nested vault is exposed for up to an hour if nobody runs the rescue sooner; the guide does say "run the rescue at once", and the crank's lane is stated as hourly. I would add one sentence rather than change the limit.

**2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?**

* **42 (destination ATAs in a prior transaction).** The stated *reason* ("This keeps the fully padded legacy shape … within the packet limit") does not describe the page's actual shape: `planRedemption` builds the narrow owner-payer shape with no compute-budget instructions, and SPEC's own round-26 note records that this narrow shape fits all three creates in 1,219 bytes. So the prior transaction is a **client contract choice**, not a packet necessity — which the limit does say in its last sentence, but the first sentence reads as if it were forced. Worth tightening so nobody "fixes" the page by removing the prior step.
* **13 (level immutability rests on MINT's upgrade authority).** Correct and still live, but note the *closure* mechanism has moved: the pages now pin `RELEASE_COMMIT` and `MAINNET_PROGRAM_BYTES`, and `run-tests.sh`'s `release_gate` fails if `programs/` differs from that commit. So the "until the authority is removed" window is additionally bounded by a build-time gate. That is a strengthening the limit does not mention.
* **36 (the in-line monthly run is skipped by an early host / empty pool / waiting join / due boost).** Closed for the *empty-pool* case by `readConfigs` being read on every page press and by the crank's re-judge against a fresh config; the rest stands.

**3. Is any DISCHARGED item not actually discharged?**

* **12/17 (compute units).** Its discharge rests on **v5** artifact measurements (58,956 CU / 890 bytes, 18 pad instructions / 1,228 bytes). The v6 numbers are in item 54 (75,898 plain mint; 524,588 with the full crank; 114,756 capture; 150,344 reveal). The v6 suite pins 10.1-10.4 and 10.5-10.6b. So the *conclusion* holds on v6, but the discharging measurement quoted under 12/17 is the v5 one — the item should cite 54's v6 numbers to be unambiguous.
* **14, 19, 30, 31, 33 and the v5-with-the-Bank items.** All genuinely discharged: `DuplicateAttribute` is refused on both mint paths (`11.4`, `R42.C8`); `levels.json` is gone and `activate` refuses `NotRevealed`; `split_bps`/destinations/`max_supply` are written once; the cadence is an `initialize` value; the notice is exercised for both keys (`3c.K5`, `3c.G2`).
* **51 and 54** are correctly under DISCHARGED with their residues stated.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

I checked all five and found none demoted:
* **22** — the five named rehearsal items are still named, and the item still says "This must be exercised before it pays anyone."
* **38** — `launch/mainnet-init.json` still has `vault_collection`, `charter_opens_at` and `lock_deadline` as `null`/`OPEN`, and `scripts/check-launch-params.mjs` refuses an OPEN value. The round-44 addition of `launch/rehearsal-init.json` does **not** close this: the mainnet file is still incomplete.
* **50** — still "BUILT AND STAGED … NOT YET PUBLISHED", and the holder guide is still marked DRAFT with "may not be published before this item ships".
* **52** — unchanged and still enforced by road step 10.
* **53** — its proof is still of `d57ee3a` and still marked STALE; round 43's `release_gate` makes the re-run *possible*, which is what the item says, not that it is done.

---

## Anything else

**Scope I could not audit from this bundle, stated so it is not mistaken for clean.** The following files are referenced by what I audited but are not in this bundle, so the claims that depend on them are unverified here: `bank/detectors.mjs` (which decides, through `judgeRedemptionCoverage`, whether the redeem page refuses — see F5), `bank/layout.mjs` (the `decode`/`encode` used by every page read and by `bank/selftest.mjs`'s L13c), `bank/selftest.mjs`, `bank/alarm.mjs`, `bank/crank.mjs`, `bank/revenue.mjs`, `bank/swap.mjs`, `bank/accrual.mjs`, `bank/redemption-poster.mjs`, `bank/anchor.mjs`, `bank/spl.mjs`, `bank/lock.mjs`, `scripts/check-launch-params.mjs`, and `web/test/{plan,get,ceremony,decode,ids,bundle,meta,tx,ref}.test.mjs` plus `web/test/run-all.mjs`. Two of my four items (F4, F5) are *about* those files. If this pass is the programs+web pass, that is expected — but the `judgeRedemptionCoverage` contract is a value-refusal path and deserves to be read by whoever holds that file.

**One structural observation about the launch gate.** Round 43 is LAUNCH-CLEAN with quorum at 6 of 8 (no margin), and its one LOW was graded LOW partly on a reading of review 35 M1 that only Gary could settle. That means the launch gate's outcome at the previous round depended on an unexecuted measurement plus a ruling. Round 43's repair (`R43.V1`) has now executed it on the burned fixture Z, which is the right answer — but it is worth noting that the arm moved the census cost onto an existing fixture to keep `P.2a` green (911/912 on the first attempt). That is a real signal: **the suite's census budget is now tight enough that a new gate-5 arm can change what other arms can measure.** A future arm may not have a fixture to spare.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

What AI audit structurally cannot do, and what only running the thing can settle. In the order I would do it:

1. **Run the dress rehearsal (road step 8) at the release commit, and record every signature.** Specifically the five items SPEC 22 names: the crank's live passes against ~2,100 vaults (cost, rate limits, paging, a transient RPC error mid-batch), the alarm's live passes in `CBOB_ALARM_REHEARSAL=1`, **one full revenue cycle through each pool** (Orca, then Orca forced to refuse so Meteora really runs), **one forced post-sweep failure walked through the hand recovery**, and one DAS read of a collection holding a burned asset. Nothing in this tree has ever run `bank/revenue.mjs` end to end.
2. **Sign with a real Phantom, once per page.** Every page test in the tree drives the pages' *library* with a JS keypair or a mock wallet. The one thing that is not exercised anywhere is the extension's `signTransaction` and the `signExact` message-equality check against a real wallet — including the wallets that add a "guard" instruction.
3. **Read the four configs back off mainnet, byte for byte, against `launch/mainnet-init.json`, with a human at an explorer.** Item 38's whole answer is "the checker validates the JSON, not the signed transaction". After the ceremony, the only proof the right values were written is a read-back, and it must be done by a person before step 11.
4. **Bring up the real public surface before publishing the guide**: the `/rpc` proxy behind nginx **with the Cloudflare real-IP chain configured** (round 42's C14 says the per-IP limits key on the visitor *only* if `real_ip_header CF-Connecting-IP` is set — on a host without it one client starves its whole region), the metadata generator's cron against the operator's provider, and `v/collection.json` served before step 0.
5. **Do one real Squads return of a rescued vault.** Limit 58's return is "a person's act from the Squads"; nothing has ever done it against the real multisig.
6. **Fund and exercise the operational wallets**: the swap operator's fee float above `OPERATOR_FLOOR`, the revenue address's rent, the crank's fee key above `FEE_FLOOR_LAMPORTS`. None of these is enforced on chain and none has ever been tested live.
7. **Get the three OPEN values and the review-35 reading from Gary in writing**, and then rebuild from the release commit and compare the five sha256 values with what is actually deployed — reproducibility is the only bridge `build-mainnet.sh` cannot cross itself.
8. **Have a person read `HOLDER-GUIDE.md` against the live pages, sentence by sentence**, with the honest list open. Every promise in that file is a statement about what a holder will see, and no assertion in this tree can test whether a holder understands it.