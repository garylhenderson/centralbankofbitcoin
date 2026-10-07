# Independent audit — v6 tree at `0b3ddb3` (round 35's tree plus its repairs)

**Basis and limits of this pass.** I read the five programs whole, `web/` whole, the suite, the simulation, the launch tooling and the bundled round‑35 records. I ran nothing (no validator, no suite, no live job); every claim below is either read off the code or off a measurement the tree itself records, and I say which. Where a claim of mine would contradict a measured run, I say what would have to be seen on chain for me to be right.

**Headline: I found no CRITICAL and no HIGH in the five programs.** I looked hardest at the four places a value‑loss bug would live — the open↔burn pairing, the sweep helper's access control and lamport/emptiness interaction, the pool's `owed_scaled` invariant under every counter mutation, and the boost ring — and each held under recomputation (details in R1, R1s, R2, R2b below). The defects I can defend are in the **holder pages' build and evidence chain**, plus two documentation/behaviour divergences. That is the honest shape of this pass: the youngest, least‑audited code is `web/`, and that is where the findings are.

---

## R0. Round 35's verdict and its repairs

Round 35 produced no verdict (`audits/round35/NOT-COUNTED.md`: OpenRouter refused 9 of 16 seats; 3 of 8 program reports, 4 of 8 off‑chain; quorum is 6). Its triage (`TRIAGE-incomplete-reports.md`), the adversarial review of the program change (`REVIEW-rescue.md`), the page review (`REVIEW-web.md`) and `VALIDATION.md` are therefore evidence, not authority. I re‑derived the ones that touch money:

* **C1/C2/C15 (steps 9/10/11 and `--final`)** — `VALIDATION.md` says step 9 now upgrades and verifies without `--final`, step 10 re‑verifies first, step 11 verifies, makes final, verifies again. That is the correct ordering and it is what the SPEC's road table now says. **Holds.**
* **C3 (`MIN_ROUND_PRICE_SATS`, `MAX_ROUND_SECS` mirrored)** — `rec('R35.C3', …)` in `tests/3prog.test.ts` regexes both sources and compares. GOV's `MIN_ROUND_PRICE_SATS: u64 = 21_000` and `MAX_ROUND_SECS: i64 = 365*24*3600` equal MINT's. **Holds.**
* **C5 (a stray whose close authority a stranger kept)** — see L3 below: the *mechanism* is correctly handled in `web/src/lib/plan-redeem.mjs`, but the SPEC text that describes it is now wrong.
* **M1/M2 of `REVIEW-rescue.md` (destination)** — `rescue_nested` derives `dest = a.config.bank_treasury` and requires `new_owner == dest`; there is no path where a caller chooses the destination, and the delegate signs in exactly one `invoke_signed`. **Holds.**
* **`REVIEW-web.md` H1 (a stranger blocking a redemption for ~0.002 SOL)** — the vectors now land in `ack` (a ticked box) rather than `refuse`: `plan-redeem.mjs` pushes `cannot.push(...)` and then `for (const x of cannot) ack.push({ id: \`lost:${x.address}\`, … })`, and the coverage cross‑check treats an ack‑named address as covered. **Holds for the reserve‑account and nested‑vault refusals, which are the only ones left.**
* **`REVIEW-web.md` M1/M2/M3** — the proxy now refuses a missing `Origin` (`if (!req.headers.origin || !allowed.has(req.headers.origin))`), checks each memcmp's bytes (`is32`, exact `'2'`/`'3'`), streams the response under `readCapped`, keys IPv6 by /64, and the build strips `source`/`_comment` from the embedded launch values (`launchPub` keeps only `{value,status}`, and `bundle.test.mjs` asserts it). **Holds.**

---

## R1. Custody: can anyone but the owner get value out of a sealed vault, or an emptied vault survive?

I could not break it, and here is why the specific attacks fail:

* **The pairing binds asset AND owner, in both directions, on top‑level instructions only.** SEAL's `open_for_redemption` walks *forward* from `current+1` for `burn_vault` with `accounts[0] == asset` and `accounts[2] == owner`; BURN's `burn_vault` walks *backward* `0..current` for `open_for_redemption` with the same two positions. A wrapper is refused in both directions because `load_current_index_checked` reports the **outer** index for a CPI (measured: WR.1 `NotFromBurn`, WR.2 `NoTerminalBurn`, WR.3 `NoPrecedingOpen`, WR.4 the vault still holds everything). Two vaults in one transaction cannot borrow each other's halves (4.10, 4.10a).
* **A thawed vault cannot survive.** The only thing that can clear the seal is SEAL's `open_for_redemption` (the `PermanentFreezeExecute` authority is SEAL's `["seal"]` PDA), and that instruction refuses without a terminal burn; a burn that fails reverts the thaw with it, because the whole thing is one transaction. The owner cannot remove, revoke, re‑delegate or thaw the seal (R34.G4 pins Core's 0x9/0x1b/0x1a/0x1a on a real vault, with a control that thaws a keypair‑held seal).
* **The emptiness proof is the one place I would have expected a hole, and the loops agree.** The reserve loop requires each derived ATA (both token programs) to be present, owned by the vault PDA, undelegated (`d[72..76]`, `d[121..129]`, `d[129..133]` all zero), extension‑free (`d.len() == 165`) and empty; the *second* loop now applies the same three delegation checks and the same length check to any declared account owned by the PDA — the asymmetry round 35's own report flagged is closed.
* **The declared‑but‑foreign case is inert:** an account that is not token‑program‑owned and not Core‑owned is skipped by both loops, so declaring junk is harmless; declaring a live `AssetV1` is `VaultStillHoldsAVault`; declaring a burned tombstone is allowed.

---

## R1s. The sweep helper

**(a) Access.** The only path that gives the helper a signature it did not itself receive is Core `ExecuteV1`, and Core approves that only for `authority == owner` on a *thawed* asset. Called directly, `if !signer.is_signer` refuses, so a caller can only move its own holdings. Core's one route that approves anyone else (AgentIdentity + `ExecutionDelegateRecordV1`) cannot be added by an owner — measured (`R24.1a`, `R24.1c`: `missing required signature`). `SR.5`/`SR.5a` refuse a stranger and an owner‑added `TransferDelegate` on a genuinely thawed vault with `0x1a`, and `SR.5e` checks the refused attempts preserved balances, owner and seal. **Sound.**

**(b) The pair list.** A source appearing twice: the first iteration closes it, the second `read_token` sees a System‑owned account and returns `IllegalOwner` — and the suite *pins that the refusal is not the source‑owner guard* (`SR.12b` asserts the error does **not** contain `CBOB_SWEEP refused: source`). A source that is also a destination is impossible (one owner per account, and `signer.key != dest.key`). A zero‑pair list is a lamports‑only sweep (`SR.13`, and the asset‑signer is emptied). An odd account count is `NotEnoughAccountKeys` (`SR.7`). A wrong token/system program is `IncorrectProgramId` (`SR.8`, `SR.9`). A destination wallet equal to the vault wallet is `InvalidArgument` (`SR.10`). A destination account of another mint is refused by name (`SR.12`). **Sound.**

**(c) Destination checks.** The program does not compare `dest` with the asset's owner, and that is safe *only because of (a)*: through Core the caller is the owner; directly the caller is the signer. The one thing I checked hard is a destination wallet that is *another vault's* asset‑signer PDA — that is permitted, and it is the owner deliberately sending their own vault's contents into another vault's wallet. Not a program defect, but a page must never build it; `plan-redeem.mjs` always names the connected wallet.

**(d) The lamport sweep.** `signer.lamports()` is read at execution and the whole balance is transferred to `dest`; nothing between the sweep and the burn credits the signer (the close of each source pays rent to `dest`, not to the signer). `burn_vault`'s `require!(asset_signer.lamports() == 0)` therefore sees exactly what the sweep left, and `SR.4a` measures the exact delta including the stranger's gift, the released rent and the fee.

**(e) Missing reserve accounts.** Sufficient. A stranger can create a *classic* ATA for the vault permissionlessly; the page's prior transaction uses `createAssociatedTokenAccountIdempotent`, so it becomes a no‑op, and the redemption's sweep names it, moves the dust and closes it. The two shapes that could dodge both the sweep and BURN do not exist for the three reserve mints: a **Token‑2022 ATA for a classic mint is refused** (measured, `F4.2`), and a **non‑ATA classic account** the vault PDA owns *is* nameable by the sweep (it takes any 165‑byte classic account owned by the signer). A nested Core asset is the only residue, and it is item 44 / item 58.

**(f) Fitting.** `sim/test-vault.ts` `S8.0` asserts `B <= 1232 - 52 - 96` on the claim+open+Execute(helper)+burn shape, and `S8.1a` measures 168,343 CU. The page adds nothing that S8.0 does not reserve for; a fourth reserve is unreachable (`MAX_RESERVE_MINTS = 3` and no instruction adds one), and the in‑line monthly run's only extra account is the pool, which the redemption already carries through BURN into `retire_redeemed`.

**(g) Evidence.** I found no arm in `SR.*` that cannot fail: `SR.1` is `missing required signature`, `SR.2` is the helper's own `CBOB_SWEEP refused: destination …` line, `SR.3` is `0xb` (NonNativeHasBalance — the old sweep cannot even close the dusted account), `SR.12a` is `Provided owner is not allowed`, and `SR.12b` is a deliberate *negative* pin. The helper's bytes are the same bytes the suite deployed (`scripts/build-mainnet.sh` `cmp`s `dist/` against both the localnet rebuild and `target/deploy/`, and the sweep crate deliberately has **no** `localnet` feature so the tested and shipped builds are identical).

---

## R2. The community pool's money

I recomputed the invariant by hand rather than trusting `ledger()`, because that helper is written by the same author.

**`owed_scaled` equals the sum of `owed_of` over active vaults, and `balance ≥ ceil_sats(owed_scaled)` always.** The four mutators are consistent:

* `credit(avail, w)` adds `delta = floor(avail·S/w)` to `acc` and `delta·w` to `owed_scaled`; each active vault's `owed_of` rises by `weight·delta`, so the sum rises by exactly `delta·w`. **`credit` does not move any token**, so `balance` is unchanged and `ceil(owed_new) ≤ ceil(owed_old) + avail = balance` — the invariant holds with slack.
* `claim` pays `floor(owed/S)` per vault and subtracts `pay·S` from `owed_scaled`; that vault's `owed_of` drops by exactly `pay·S` (the remainder moves into `carry_scaled`, and `debt_scaled` is reset to `weight·acc`, so `owed_of = weight·acc + carry − weight·acc = carry`). `balance` and `owed_scaled` fall by the same sat amount.
* `retire` subtracts the vault's full `pending` and removes it; `join` and `reweigh` leave `owed_scaled` alone and each sets the vault's `owed_of` to exactly `weight·acc − debt` (0 at join) or preserves it (reweigh).
* `distribute`/`monthly_inline` refuse `avail == 0` and only ever credit `avail`, so no path can distribute more than `balance − ceil(owed)`.

**Counters.** `waiting_to_join = pending_count − pending_this_epoch` cannot underflow: `advance_epoch` zeroes `pending_this_epoch`; a request increments both; `join` requires `dist_epoch > request_epoch` so it only decrements `pending_count`; `retire` decrements `pending_this_epoch` only when `request_epoch == dist_epoch`. The `w == 0` launch path, the `JoinWaitingFirst` gate before any `$GARY` burn, and the two‑step activation are all as documented, and `3c.A6`/`3c.A6a`/`3c.A6c` measure the first‑activator attack landing nothing.

**Liveness.** I could not find a way for a stranger to make distributions or redemptions impossible for others. `distribute`/`monthly_inline`/`claim`/`retire_burned`/`expire_boosts` are all permissionless; the only gates are states others can clear (`BoostsExpireFirst` by `expire_boosts`, `JoinWaitingFirst` by a free claim).

---

## R2b. The $CBOB boost

I traced the ring by hand as well as through the host test.

* `boost_vault` schedules at `end % 64` where `end = dist_epoch + epochs` and `epochs ≤ 63`; `advance_epoch` reads `(dist_epoch+1) % 64` into `boosts_due` and zeroes it. A slot is therefore written, consumed 64 epochs later, and can only be reused by an `end` in the open interval `(epoch, epoch+63]`, which is exactly the range `end % 64` can hit without colliding — so **two live end epochs never share a slot**, and a boost earns exactly N distributions (the `BoostsExpireFirst` gate guarantees no distribution runs past a due boost). The 260‑epoch host test (`the_boost_schedule_through_the_programs_own_functions_across_four_wraps`) drives `join`/`reweigh`/`retire`/`expire_boost`/`credit`/`tick` through the program's own functions across four wraps and asserts every ring slot against a model rebuilt from the records.
* **Nothing earned is lost or gained** across a weight change: `reweigh` moves `owed_of` into `carry_scaled` and restarts `debt_scaled` at `new_weight·acc`, so `owed_of` is algebraically unchanged; `total_active_weight` moves by exactly the boost delta and `owed_scaled` does not move. `unschedule_boost` has two branches (`due` decrements `boosts_due`; not‑yet‑due decrements `boost_expiring[end % 64]`), and `BO.38` exercises the wrapped not‑yet‑due branch on chain.
* `total_active_weight`, `boost_weight_total`, `boosts_active`, `boosts_due` and the ring agree after every money operation the suite performs (`ledger()` is invoked after each, and `BK.*` fails if any check was deleted).
* **One boost per vault** is enforced by `r.boost_weight == 0`; **only the current owner** by reading Core's owner bytes at execution (`BO.33`/`BO.33a` sell‑then‑boost); `BoostTermsMoved` is checked before any burn, so a hostile terms move burns nothing.

---

## R3. The level draw

* **SlotHashes parse** — key pinned to `slot_hashes::ID`, count bounded by 512, buffer length re‑checked against the count, all‑zero hash refused, truncated/forged buffers refused (host tests). I re‑checked the deadline arithmetic: A ≤ `reveal_slot + 64`, `want_B ≤ A + 12`, B ≤ `want_B + 64`, `want_C ≤ B + 12`, C ≤ `want_C + 64 ≤ reveal_slot + 212 < reveal_slot + 300`, and 512 > 300, so every hash the draw uses is still in the sysvar when the capture runs.
* **Skipped slots** — `blockhash_in_window` takes the *smallest produced* slot in `[want, want+64]`, and the host test's independent model reproduces A/B/C for skips placed exactly on each target. A missed window is rescheduled to `now + 16` (a slot that does not exist when the call lands) and counted; `L.17` asserts the new slot is `landing_slot + 16`.
* **FIFO** — `require!(index == config.revealed_total)`; a vault burned before its draw still takes one (`L.11`), so the queue cannot stall on it.
* **What a leader can do** — unchanged from SPEC 26 and, as SPEC 26 now says, **C's leader chooses among many draws** (skip within its own 4‑slot group = best‑of‑4; varying block contents adds more; the whole cohort minted in the same slot shares the three hashes). I confirm the SPEC's wording is the *weaker* of the two and that `HOLDER-GUIDE.md` now says "pick among several results … can be enough to choose the level of a vault created in the same moment". It is not worse than stated.

---

## R4. Governance

* **A minority cannot carry what it should not.** `execute_proposal` requires `cast ≥ ceil(quorum_bps · snapshot)`, `yes/cast ≥ threshold_bps`, `yes ≥ ceil(10% · snapshot)`, and, for a guardian change or a swap‑operator arm, `yes ≥ ceil(50% · snapshot)`. All three divisors are the *creation‑time* snapshot, never live. `KeyChangeNeedsHalf` is exercised both ways (`3c.K2` refuses with every stage‑3b vote present but short of half; `3c.K2p` asserts the precondition).
* **A vote cannot reach money it should not.** The only vote‑carried struct is `SweepTighten`, whose three fields are monotone and bounded by `initialize`; `P.0e`/`P.0f` assert the struct exists in both programs, has no destination/split/supply field, and that no `WiringArgs` survives.
* **Frozen forever?** The only permanent freeze is the one the SPEC already states (limit 47: a guardian thief at low turnout; limit 45: no live vault). I found no third path: `create_proposal` needs a live vault the proposer owns (which a still‑open round can mint, corrected in round 24), `execute_proposal` re‑checks `m.governance == gov_pda`, and an overtaken action is a logged no‑op that cannot drag its bundle down (`E.2`, `3b.S1`, `7.26`).

---

## R5. The charter claim

The PoB is identified by **address** against a Merkle root whose leaves and nodes are domain‑separated and whose pairs are sorted; I re‑implemented `layersOf`/`proofOf` by hand and confirmed the odd‑node promotion is consistent with the verifier's sibling push (a promoted node's proof carries the even sibling and the combination reproduces the promoted value). The burn is a CPI with the owner as a signer, and the pass‑through accounts are appended **never as signers** (`metas.push(… false …)`), so an external plugin cannot escalate. Outside the window it refuses by clock alone. SPEC 46 is complete: the hot update authority can gate or brick claims (and capture the electorate) and cannot take a Proof of Burn; the alarm watches the collection, not each asset; a hook added and removed between passes is not paged. I found nothing it omits beyond what is written, with one caveat I raise in L3 below about the *page's* treatment of a PoB that carries an external plugin (it refuses, correctly, rather than guessing the pass‑through accounts).

---

## R6. The one‑time configuration and the trusted hop

I recomputed every `initialize` bound against the ruled values in `launch/mainnet-init.json` and they are consistent (1 SOL ≤ 10 SOL cap, 21,600 ≤ 86,400 ceiling, 0.05 SOL ≥ 890,880 and ≤ 0.1 SOL ceiling, 3600 in [10, 86,400], 2,100 bps ≥ 500, 5,100 bps > 5,000, 259,200 in [60, 30 d], 12/24 inside 12/63). The royalty is a Core collection plugin with `PluginAuthority::None` and no CBOB instruction touches it (`R.3`, `R.6`, `R.6a`, `R.33.G3`). The redemption cap is a 64‑slot ring of `i64` timestamps with `head` advanced mod 64, checked as "the cap‑th most recent is a full window old", which is exactly a rolling window.

**Two findings here are about the *tools*, not the programs** (L1, L2 below).

---

## R7. Cross‑program raw reads

I recomputed every offset from the struct definitions and every account space from the field list. All match:

* `MintConfig` = 1261 bytes; `minted_total` 141, `bare_burns_retired` 454, `charter_closes_at` 442, `governance` 41, `sales_stopped` 191/`sweep_stopped` 192, `sales_stopped_at` 518 / `sweep_stopped_at` 526, `sol_reserve` 257 / `max_sweep` 266 / `cooldown` 274, `sweep_floor` 631 / `cooldown_ceiling` 639 / `reserve_ceiling` 647, `max_boost_weight` 711 / `max_boost_epochs` 712.
* `VaultRecord` = 221 bytes; `mint_index` 41, `reveal_slot` 49, `level` 57, `active` 125, `retired` 126, `vault_ata` 129, `debt_scaled` 161, `pending` 177, `request_epoch` 178, `boost_weight` 186, `boost_end_epoch` 187, `carry_scaled` 195.
* `BurnConfig`: `burned_total` 42, `redeem_window_secs` 50, `rate_head` 58, `rate_ring` 59. `GovConfig.proposal_count` 53. `SealConfig`: `collection` 9, `reserves` 41.
* The helper's classic token reads (mint 0, owner 32, amount 64, length 165) match `parseTokenAccount` in `web/src/lib/decode.mjs`, which `decode.test.mjs` checks against `spl-token`'s `AccountLayout` and against `mpl-core`'s own deserializers on real byte layouts.

**No misread found.**

---

## R8. The suite, the simulation and the build as evidence

I checked every floor for the "must EQUAL the count" rule and every floor against the arms I can count in the bundled sources: `MIN_ASSERTIONS=889`, `DET_FLOOR=917`, `ALLOC_FLOOR=39`, `POSTER_FLOOR=23`, `POB_FLOOR=14`, `LAUNCH_FLOOR=49`, `HOST_FLOOR=6`, `MAINNET_FLOOR=33` (I recounted the probe's `t()` calls: 5 + 15 + 8 + 5 = 33, matching), `EXPIRY_FLOOR=4`, `SIM_FLOOR=71`, and `web/test/run-all.mjs`'s ten per‑file floors summing to 457. **The floors are consistent and none of them is loose.** I also confirmed `ID.1` makes every assertion id unique, which is what makes the `because()` reason pins trustworthy.

**The gaps I found are in `web/` and are the findings below.**

---

## Findings

### M1 (MEDIUM) — the pages' end‑to‑end evidence has no floor, and the only harness with floors does not run it

**Where.** `web/test/run-all.mjs` (`FLOORS` has ten entries, none of them `e2e-localnet.mjs`) and `web/test/e2e-localnet.sh` (runs `node web/test/e2e-localnet.mjs` and propagates only the exit code).

**What it gains an attacker or an accident.** `VALIDATION.md` cites "end to end on a local validator **80/80** (`.cache/r35-web-e2e.log`)" as the pages' proof, and that harness is the only place the *landed* shapes exist: `claim` before `open`, the C5 `Execute(Transfer)`, the multi‑pair helper, the ceremony's step 0 and all four initializes, both rescues, and a full redemption with a stray and a C5 account. `e2e-localnet.mjs` prints `harness('e2e-localnet')`'s summary and exits non‑zero only if some assertion *ran and failed*; there is no count, so deleting arms keeps it green — the exact defect `scripts/run-tests.sh`'s `floor()` exists to remove ("a floor that only bounds below accumulates slack"), and the one the README claims for the ten offline files.

**Evidence that would exist if I am right.** `grep -n e2e web/test/run-all.mjs` finds nothing; `grep -c 'H\.\(t\|eq\)' web/test/e2e-localnet.mjs` counts the arms while `run-all.mjs`'s `total` does not include them; delete one `H.eq` from `e2e-localnet.mjs` and `bash web/test/e2e-localnet.sh` still exits 0.

**Fix.** Add `E2E_FLOOR = <count>` to `web/test/e2e-localnet.sh` (or `run-all.mjs`) and fail unless the printed numerator equals the denominator and the total equals the floor, exactly as `sim/run-sim.sh` does with `SIM_FLOOR`.

---

### M2 (MEDIUM) — the ceremony's tamper check is circular: the reference it tells Gary to compare against is not in the repository

**Where.** `web/src/html/ceremony.html` footer: `app.js sha256 <code>{{APP_SHA256}}</code> … Check this against BUILD.txt from the repository before connecting (README.md, "Local mode")`. `web/build.mjs` writes `BUILD.txt` **into `OUT`** (`web/dist/` or `web/dist-<profile>/`), and `web/README.md` says "`web/dist/` is ignored by the root `.gitignore`; `web/.gitignore` ignores `dist-*/`".

**What it gains an attacker.** The ceremony signs values that are immutable once written — `guardian`, `swap_operator`, `bank_treasury`, the collection, every period and bound. REVIEW‑web M4 raised the underlying risk (the page is served from the public site, `app.js` is not content‑hashed); `README.md` answers it by telling Gary to compare hashes and, better, by offering `web/deploy/ceremony-local.mjs` over an SSH tunnel. But the comparison itself cannot detect a tampered build, because `BUILD.txt` is produced by that same build and lives only in a gitignored directory. The only committed reference is `web/README.md`'s six‑hash table ("From this tree (2026‑10‑07; any source change changes them)"), and **nothing verifies it**: `bundle.test.mjs` checks SRI against the built files and that `BUILD.txt` lists each `app.js`, and greps the bundle for key‑file paths, but never reads the README table.

**Evidence that would exist if I am right.** `git ls-files | grep -c 'BUILD.txt'` → 0; `grep -rn 'README' web/test/*.mjs` finds no check of the hash table; edit any `web/src/**` file and rebuild — the built `app.js` and the README table disagree, and `node web/test/run-all.mjs` still passes.

**Fix.** Commit the release `BUILD.txt` (or the hash table) and have `bundle.test.mjs` fail when the built files differ from it; and build the independent verifier the README already recommends — a small CLI that re‑runs `judgeLaunch` on the *decoded* initialize instruction bytes, so the check does not live in the same JavaScript that builds the transaction.

---

### L1 (LOW) — the tool that compiles every page a holder signs is resolved from an absolute path outside the repository

**Where.** `web/build.mjs`: `const esbuild = require('/home/ubuntu/luna-remotion/node_modules/esbuild')`; `web/test/ref.mjs` does the same.

**What it gains an attacker.** Whoever can write that unrelated project's `node_modules` can inject code into `vault/app.js`, `redeem/app.js`, `claim/app.js`, `buy/app.js` and `ceremony-*/app.js` — every transaction a holder or Gary signs, including the immutable launch values. It is also outside `scripts/audit-coverage.sh`'s tracked set (`programs/ bank/ scripts/ sim/ launch/ tests/ web/`), so no round reads it, which is the file‑never‑seen failure mode the coverage gate exists to catch.

**Evidence.** `grep -n 'luna-remotion' web/build.mjs web/test/ref.mjs`; `git ls-files | grep -c luna-remotion` → 0; `node web/build.mjs` fails if that directory is removed.

**Fix.** Add `esbuild` to the repository's own `package.json`, pin the version, and resolve it normally; or vendor it and record its sha256 next to the program‑bytes table.

---

### L2 (LOW) — `Anchor.toml` still points the provider at mainnet with the default CLI wallet, and names one of five programs

**Where.** `Anchor.toml`: `[provider] cluster = "mainnet"`, `wallet = "~/.config/solana/id.json"`, `[programs.mainnet] cbob_vaults = "9YKV…"` (the other four are absent), `[scripts] test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"`.

**What it gains an attacker or an accident.** Nothing runs it today (`build-mainnet.sh` and `run-tests.sh` use `solana program deploy` with explicit keypairs and `--upgrade-authority`), but this is a five‑program, immutable launch: an `anchor deploy` in the repo root would target mainnet with whatever `~/.config/solana/id.json` happens to be — and `run-tests.sh` already records that this exact file was once deleted by another session. `yarn test` would also fail (it runs every `tests/*.ts`, including `initauth.test.ts`, which needs a validator).

**Evidence.** `cat Anchor.toml`; `grep -rn 'anchor ' scripts/*.sh bank/*.mjs | head` finds no user.

**Fix.** Set `cluster = "localnet"`, or delete `[provider]`/`[programs.*]`/`[scripts]`, or add a comment that the deploy path is `solana program deploy` and that this file is vestigial.

---

### L3 (LOW) — the SPEC's Known‑limits C5 entry describes a page that no longer exists, and the shipped page will destroy a Token‑2022 balance after one tick

**Where.** `SPEC.md` Known limits: "So the redeem page (item 50) sweeps its balance to the redeemer and leaves the empty account undeclared, **and refuses only an account that still holds a balance it cannot move (a frozen one, or Token-2022, as before)**." Against `web/src/lib/plan-redeem.mjs`, which for those two cases does `cannot.push({ address, text: … })` and then `for (const x of cannot) ack.push({ id: \`lost:${x.address}\`, … })` — a ticked box, not a refusal.

**Why it matters.** The change is *correct* — REVIEW‑web H1 showed a refusal lets a stranger block any vault's opening for ~0.002 SOL, and HOLDER‑GUIDE.md promises "On the redeem page that cannot block the opening". But the acceptance record now understates what the page will do: a holder who ticks the box opens a vault holding a Token‑2022 balance or a frozen stray, and those units are destroyed. Item 44 lists Token‑2022 and frozen strays under "Not covered", so the outcome is inside the accepted limits — the *text* is what is wrong, and a reader auditing against the SPEC would expect a refusal and not look further.

**Evidence.** `grep -n 'refuses only an account' SPEC.md`; `grep -n 'lost:' web/src/lib/plan-redeem.mjs`; `web/test/plan.test.mjs`'s H1 block asserts `opens(p) && p.ack.some(...)` for the Token‑2022 and frozen vectors — i.e. the tests already encode the new behaviour, so the SPEC is the stale artefact.

**Fix.** Rewrite that clause to say the page *names them in a box the holder must tick*, and add the two vectors to item 44's "Not covered" list explicitly.

---

### L4 (LOW) — two suite arms refuse for an unpinned reason

**Where.** `tests/3prog.test.ts` `rec('R34.G2', 'a stranger cannot take a token account at an ATA address (System allocate unsigned, InitializeAccount3 on the dusted address both refused); the ATA create lands for the real wallet', 'REJECT,REJECT,ALLOW,<token>,<wallet>', …)`. `att()` maps *any* failure to `REJECT`, and there is no `because('R34.G2', …)` entry, so the first two fields cannot distinguish the intended refusals (an unsigned `System allocate`, a token `InitializeAccount3` on a System‑owned dusted address) from, say, `AccountNotFound` or a malformed instruction. The third field and the resulting owner/authority are pinned, so the arm is not vacuous — only its *reasons* are unproven, which is the property every other negative in this suite is held to.

**Evidence.** `grep -n "because('R34.G2'" tests/3prog.test.ts` → nothing; the `because` list pins ~180 other ids, including the sibling `R34.G4`.

**Fix.** Add the two `because('R34.G2', …)` pins the way `R34.G4` does (the expected `custom program error` text for the System and Token refusals).

---

### L5 (LOW) — `web/README.md`'s hash table is a hand‑maintained copy that no test reads

**Where.** `web/README.md`'s "Local mode" table of six sha256 values. `bundle.test.mjs` verifies SRI and `BUILD.txt` membership, never this table.

**Why it matters.** It is the only committed, human‑readable reference for what the ceremony's `app.js` should hash to (see M2). If it drifts, the ceremony footer and the README disagree on launch day and a human has to adjudicate, which is precisely the moment for a rushed decision.

**Fix.** Have `bundle.test.mjs` parse the table and compare it with the built files.

---

## The four questions about the accepted limits

**1. Is any limit worse than stated?** I found none that is *exploitable* beyond its text. Three places where the text is now weaker or stronger than the code, none of which widens an attacker's reach:

* **C5's mitigation is stronger in the code than in the text** (L3): the page destroys Token‑2022 and frozen stray balances after a tick, where the text says it refuses. Within item 44, but the text should say it.
* **Limit 27's "a join adds dead weight"** now has an extra consequence I want on the record: a bare‑burned vault that a `claim` joins accrues a share that is paid into its asset‑signer PDA's account, and `rescue_nested` **cannot** recover it — the rescue moves the *vault asset*, and the asset is a tombstone. The units are stuck for good, exactly as the limit says, and item 58's "payouts keep accruing in the vault's own wallet, so whoever receives it receives all of it" is about a **live** nested vault, not a bare‑burned one. The two sentences read together could mislead; they are not contradictory.
* **Limit 25's "one re‑roll per full window"** is bounded in practice by the crank, but the *head of the FIFO* is what a re‑rolling minter blocks: `reveal_level` requires `index == revealed_total`, so a vault at the head that keeps lapsing stalls every reveal behind it, and the only control named is "the crank's reveal lane runs every minute" plus the `reveal_queue_stalled` page. That is stated, and it is survivable; I flag it only so nobody reads limit 25 as a cost to the re‑roller alone.

**2. Is anything listed as a limit not actually a limit, or already closed?** Yes, one, and it should be re‑worded rather than deleted: the C5 clause about the page refusing (L3). Everything else I checked is still real: 29 (only cbBTC splits — `split_revenue` refuses `mint != payment_mint`), 32 (the rolling window — RL.2/RL.3/RL.4/RL.7), 42 (prior transaction — the page packs prior creates and refuses to add any at re‑plan time), 43 (off‑curve owner — the pairing needs two top‑level signatures), 45, 46, 47, 49, 55, 56, 57, 58.

**3. Is any DISCHARGED item not actually discharged?** No. I spot‑checked the ones whose code changed most: 14 (`check_attributes` refuses `DuplicateAttribute`), 19 (`activate` refuses `NotRevealed`, so no activated‑but‑unlevelled state exists), 30/31/33 (`split_bps`/destinations/`max_supply` are `initialize`‑only; the free period and the notice are `initialize` values and are exercised), 51 (the boost is built and the ceilings are pinned at init), 54 (the pages send **no** crank on any transaction, so the compute‑unit obligation is discharged by omission — `plan-get.mjs` says so and `plan.test.mjs` asserts `p.ix.keys.length === 13` / `15` with no crank accounts).

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?** No, and the tree is unusually careful here: item 22's named rehearsal items, item 38's two still‑OPEN values (`charter_opens_at`, `lock_deadline`), item 50's missing poster sender and item 53's stale `d57ee3a` proof are all still labelled open in the SPEC, and `launch/mainnet-init.json` still carries `vault_collection`, `charter_opens_at` and `lock_deadline` as `status: OPEN` with `scripts/check-launch-params.mjs` refusing any OPEN value. The one thing I would add: **item 50 is now materially closer to done** (the pages exist, the ceremony exists, the proxy exists, the metadata generator exists) but the SPEC's list of what it promises has grown a fifth surface — the ceremony — whose integrity story (M2) is the weakest part of the set.

---

## Anything else

* **The `web/` pages' instruction bytes are correct.** `ix.test.mjs` extracts each builder's *source text* from `tests/3prog.test.ts` and `sim/test-vault.ts` and requires byte equality of data, account order and every signer/writable flag; it compares `coreExecute` against `mpl-core`'s own `execute`, `createAtaIdempotent`/`tokenTransfer` against `@solana/spl-token`, `coreCreateCollection` against `mpl-core`'s `createCollection`, and includes a control that `diffIx` catches a cleared signer flag, a flipped data byte and a wrong account. I read each builder against the Rust `#[derive(Accounts)]` structs and found no divergence.
* **`planRedemption`'s fitting loop is sound.** It rebuilds the whole redemption after each trim, `legacySize` uses a dummy blockhash with `requireAllSignatures:false` (which already reserves the signature bytes — pinned by `9.13a`), and strays that do not fit become `left:` acks rather than silent drops.
* **The `web/` claim page's `pob_extra` handling is correct.** It sends `pob_extra = 0`, refuses a PoB or collection carrying an external plugin, and refuses a frozen PoB. The suite's `OR.*` arms prove the pass‑through path works when a person supplies the accounts, so refusing is a *safe* narrowing, not a gap.
* **`bank/txread.mjs` and `bank/sigwalk.mjs`** (the two off‑chain files in the bundle): the reader validates every field it needs, refuses runtime‑truncated logs by default and only accepts them when a walking scanner opts in with `'flag'`, requires the v1 `transactionConfig` and forbids lookup‑table keys in a v1 message, and validates each money instruction's accounts and amounts. `signaturesSince` returns a GAP rather than truncating, excludes the cursor, and takes `startBefore` to resume. I found no way for either to advance past an unread transaction or to lose a CBOB event without the caller being told — the loss it *can* suffer (a truncated log) is recorded and paged, which is what the "Reader coverage boundary" says.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

The AI process has one structural weakness it cannot answer from inside: **it reasons over a tree, and the tree is not the world.** Everything below is something no amount of reading, no matter how adversarial, can substitute for. Do these, in this order, before step 11.

1. **Run the dress rehearsal at throwaway ids and record the signatures (item 22).** Specifically: the crank's live passes at ~2,100 vaults (cost, rate limits, paging, one transient RPC error injected at vault 1,900 of 2,100, the every‑minute reveal lane keeping up); the alarm's live passes in `CBOB_ALARM_REHEARSAL=1` with the router pointed at a rehearsal state directory; **one full revenue cycle through each pool** — sweep, swap, return, split, ledger row closed, `--audit` clean — once through Orca and once with Orca forced to refuse so the Meteora fallback really runs; and **one forced post‑sweep failure walked through the hand recovery** end to end. Write `launch/rehearsal-init.json` first (item 53 names it and it does not exist), and set `lock_deadline` before `charter_opens_at` so no value is ever held under an upgradeable program.

2. **Rebuild the release bytes on a machine the author does not control and compare the sha256s.** No auditor can verify the compiler, the toolchain, or the fact that the esbuild that produced every page lives outside this repository (L1). The `--features localnet` swap is already proven behaviourally by `build-mainnet.sh`; what is *not* proven by anyone is that `dist/*.so` and `web/dist/*/app.js` came from the commit they claim. Do it from a fresh clone, with `node web/test/run-all.mjs` and `scripts/run-tests.sh` both green, and publish the resulting hashes next to the ceremony.

3. **Have a person who is not the author run the three holder paths with a real wallet and a small real amount, at the real mainnet values, and check the pages' claims against what the wallet shows.** The pages assert, in words, what will happen ("You pay …", "You receive …", "Credited to this vault and not yet delivered: about N sats"). Those sentences have never been read by a holder against a live chain. This is also the only way to catch the class of defect that the `mock-rpc.mjs` wiring test cannot: a page that is byte‑correct and still says the wrong thing.

4. **Put a second, independent implementation of the pool arithmetic and the draw beside the first.** `bank/accrual.mjs` mirrors MINT's `owed_of`/`reweigh`/`advance_epoch` in BigInt and the suite's `ledger()` checks the chain against records — but both are written by the same author from the same mental model. A re‑derivation from SPEC alone, by a different person or model, checked against the same landed transactions, is the only thing that can catch a shared misconception.

5. **Settle the custody, because immutability makes it part of the contract.** The placeholder upgrade key (`bank/keys/deploy-authority.json`, `FZjLB4e9…`) ships the program change and then makes the five ids final; the swap operator key and the $CBOB release key sit on the same box; the Squads' return of a rescued vault is a person's act. Write the runbook for each, confirm the nightly backup actually contains them, and have someone other than the author restore one from backup into a throwaway environment.

6. **Do the launch ceremony over the SSH tunnel, from a locally built copy, with the hash compared against a committed reference** — not from the public site, and not against a `BUILD.txt` the build itself produced (M2). Then have the operator decode the signed `initialize` instructions and re‑run `judgeLaunch` on the decoded bytes before broadcasting.

7. **Publish the holder guide only after the pages are live and the poster has a sender** (item 50's own rule), and keep the honest list attached to the pages rather than to a DRAFT file.