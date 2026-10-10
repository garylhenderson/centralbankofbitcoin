# Round 47 — independent audit of the whole tree

Head read: the five programs' source is unchanged since round 27 (equals `RELEASE_COMMIT`'s program source `0b3ddb3`; `d2ae5fc`/`b3f300c`/`a30924c`/`487a8b4` changed only build stripping, the workflow, README and its generator). I audited the programs whole, every round‑46 repair at its site, the post‑rehearsal mainnet fixes, and the new files (`sbf-strip.sh`, `verifiable-build.yml`, `rehearsal-refresh.mjs`, `my-vaults.mjs`, the hosted ceremony path, README).

**Verdict up front: no new defect in the five programs. Four findings in the fixable layer: one MEDIUM (conditional, on the crack path), two LOW, one INFO, plus a scope statement this round's verdict cannot escape.**

---

## R0. Round 46's verdict and its repairs — independently verified

I re‑checked every repair against the bundled tree, not the verdict's word:

- **V46‑1 (resumable steps): repaired and complete at the sites I enumerated.** `SINGLE_SEND_STEPS` + `isSingleSend` covers every step that sends exactly one transaction whose landing its own `done` reads (`keys`, `build*`, `fund-roles`, `fund-deployer`, `fund-upgrade`, `cbob-mint`, `fill-values`, `ceremony-values`, `claim‑N`, `provision-tokens`, `buy‑N`, `crank‑reveal‑*`, `crank-full`, `alarm-pass`, `revenue-forced-alarm`, `das-read`, `sweep-deployer`). Every multi‑send step (`sale-round`, `deposit-activate`, `revenue-cycle‑N`, `revenue-forced-failure`, `rescue`, `crack`, `sweep-back`, `pob-set`) is `resumable` and its run body re‑reads the chain before each send (proposal/vote PDAs, balances, top‑up‑to‑target, re‑plan). Deploy/upgrade/ceremony steps need no mark: their `done` is chain‑state, so a landed‑but‑unconfirmed signature resolves as `mark`. I agree with the verdict's classification.
- **V46‑2: repaired.** `ceremony-values` is a `recheck` step; `judgeValuesFresh` holds the charter lead while MINT is uninitialized; the date is re‑filled immediately before road step 10 and the page is rebuilt from exactly those values (`valuesSha` pinned in `st.page`). `fill-values` still stamps an early date, but it is overwritten before anything consumes it and the judge only needs `closes_at > now` there — dead weight, not a wedge.
- **V46‑3: repaired.** The rescue's run marks `nestedSent` when it *sees* vault‑3 at the nest or treasury, so a lost nesting confirmation resumes without re‑nesting.
- **V46‑4: repaired, including the narrow edge.** A landed `pendingSwapSig` with a recorded `operatorSatsBefore` continues into return and split; an operator who closed the cycle by hand is accepted via `handClosed` instead of throwing "found 0". The only remaining throw (`operatorSatsBefore === undefined` after a landed swap) is the genuinely unknowable case, and the by‑hand exit now reads as done.
- **V46‑5: repaired.** `takesOverrides` is keyed on `launchJudge !== 'mainnet'`; `mainnet-local` inherits `'mainnet'`, so `--rpc`/`--collection`/`--launch-json` are refused at build and run time in both `build.mjs` and `activeProfile()`.
- **V46‑6: repaired.** `if (fails.length) return null` now ends the preflight as NOT READY before the mint reads.
- **V46‑8: repaired and proven live.** `initKeyFor`, `judgeInitAccount` (absent or System‑owned/empty only), `--ceremony page` forced on mainnet, `walletRefusal` before anything is read, the driver only waits (`pollUntilReady`) and reads back. RECORD.md shows the whole run landed, including Gary's real Phantom openings.
- **V46o‑3: repaired** (`refuseStrayOverridesAtLoad` pages through the literal `PRODUCTION_NOTIFIER`, never the override being refused). V46o‑1/2 live in `bank/alarm.mjs`/`selftest.mjs`, not bundled here — I cannot verify them; see the scope statement.
- **V46‑7: repaired then made stale again** — folded into Finding 3 below.

I also independently re‑tested the verdict's disproofs and agree with all of them: `apply_swap_operator` is `require_keys_neq!` in the bundled source (MiniMax's CRITICAL was invented); the sweep helper checks only source‑owner, destination‑owner‑and‑mint, and `signer != dest` (Grok's attributed refusals do not exist); `plan-redeem.mjs` builds `named` before any non‑address ack id exists (`forfeit` splits to `''` and is skipped by the `a &&`), so C9 holds; BURN's delegate checks precede the length check, so 3.3 cannot pass on `ReserveHasExtensions`.

## R1 / R1s. Custody and the sweep helper

I attacked the pairing (two vaults per transaction, account‑index binding, wrapper CPI at both levels — the stack‑height check alone is passable at height 1, which is exactly why the instructions‑sysvar discriminator check exists and holds), the emptiness proof (a non‑token, non‑Core declared account with lamports is *skipped*, but no such account can exist at a PDA‑owned address without the PDA creating it; System‑owned dust is caught by `asset_signer.lamports() == 0`), and the helper's pair list (duplicate source closes then fails `read_token` on the tombstone; a destination that is also a source is impossible because owners differ; `signer == dest` refused; zero pairs proven by SR.13). I re‑derived the classic‑SPL offsets (mint 0, owner 32, amount 64, len 165) in both the helper and BURN. **Nothing new.** The Core `ExecuteV1` authority question rests on Core's owner‑only rule plus the AgentIdentity add‑refusal (R24.1a/1c), both measured; nothing in our programs adds an adapter.

## R2 / R2b. The pool and the boost

I re‑proved the invariant "pool ≥ ceil(owed)" along every path: `credit` adds `floor(avail·S/w)·w ≤ avail·S` to `owed_scaled` while the balance falls by exactly `avail`; `claim` subtracts `pay·S ≤ pending`; `retire` subtracts `pending` with the sats staying; `join`/`reweigh` never touch `owed_scaled`. Counter behaviour under every host ordering is covered by the host unit tests (260 epochs, four ring wraps, both `unschedule_boost` branches) and the suite's `ledger()`/`books()` checks. **Nothing new.**

## R3–R7. Draw, governance, charter claim, initialize, raw reads

I recomputed every pinned cross‑program offset from the struct definitions in this bundle — all 46 MintConfig offsets GOV/BURN read (including `minted_total` 141, `bare_burns_retired` 454, the stop timestamps 518/526, the tighten bounds 631/639/647, the boost bounds 711/712), VaultRecord 41/125/126/177/186/187/195, BurnConfig 42 — all correct, and the suite pins them. The SlotHashes parse is fail‑closed (count bounded, buffer bounded, zero‑hash refused); the FIFO, reschedule and burned‑head behaviour match SPEC. GOV's minority paths, key‑change supermajority, per‑kind ordering and logged skips match the code. `pob_extra` accounts are passed never as signers. Initialize bounds match the launch file. **Nothing new in the programs.**

## R8. The suite, sim and build as evidence

Floors equal counts; the `because()` pins I sampled name the real refusal codes; the expiry‑budget file is honest that its genesis state is synthetic; the runners now deploy the *stripped* bytes, so the tested form is the shipped form for the localnet build, and the workflow proves the mainnet bytes on a machine that is not yours. The one acknowledged binary gap (localnet vs mainnet INIT_AUTHORITY) remains closed the only way it can be.

---

## Findings

### F1. MEDIUM (conditional; sits on the crack path, gate (c) if it confirms). The widest openings have never been signed by real Phantom, and the page has no fallback if Phantom's guard does not fit

**Construct:** `web/src/lib/tx.mjs` (`withComputeBudget`, `judgeWalletEdits`), `web/test/e2e-localnet.mjs` (`phantomLike`), `web/README.md` round‑47 note.

The round‑47 measurement is honest about its own limit: the widest openings (claim‑first + strays, ~1,218 bytes; W5, ~1,201) "fit neither a budget nor Lighthouse in legacy; they go exactly as built under the default budget", and "whether Phantom then adds Lighthouse to them is not documented". The e2e's Phantom‑like signer *chooses* to skip Lighthouse when it does not fit — that is a modelling decision, not a measurement of Phantom. If real Phantom appends its guard to a ~1,200‑byte transaction, the wrapped transaction exceeds 1,232 bytes and cannot be sent — and the redeem page is the only client that exists; a v0+LUT variant is "recorded as an option, not taken". The three real Phantom openings on mainnet (RECORD.md) were the simpler shapes; the claim‑first and W5 shapes were never signed by the real wallet.

**What an attacker or an accident gains:** nothing directly; what a *holder* loses is the ability to open exactly the vaults whose openings are widest (an activated vault owed a share, plus strays) — the case the product most wants to work.

**Evidence if I am right:** one real‑Phantom attempt at a claim‑first opening on mainnet (or a local chain with the real wallet) either lands or comes back oversized/modified; nothing in the current tree can answer it.

**Fix (before launch, in the fixable layer):** build and stage the v0+lookup‑table redemption variant (23 static keys were measured to make room for both a budget and Lighthouse), or measure real Phantom on the widest shape and record the answer. Until one of those exists, this is an open question on the "stops a holder's crack" limb of the launch gate, not a confirmed defect — I grade it MEDIUM because the conditional is on the one path the gate protects absolutely.

### F2. LOW. `rehearsal-refresh.mjs`'s keep‑verification does not cover gitignored paths — including the funded swap‑operator key — while claiming it covers "every untracked and ignored path"

**Construct:** `scripts/rehearsal-refresh.mjs` — `untracked()` uses `git ls-files --others` (no `--ignored`), so ignored paths never enter the snapshot; `judgeKept` then verifies nothing about them; the pre‑checkout clash check also cannot see them.

`bank/keys/swap-operator.json` is gitignored (stated in `launch/mainnet-init.json`'s source and SPEC) and is exactly where the rehearsal's funded operator key lives. The docstring and the record claim "every untracked and ignored path outside the build caches … byte for byte", but the verification is vacuous for every ignored path. In practice `git checkout` does not delete ignored files, so no key is lost today; the defect is a false guarantee plus an unexamined clash class (a future commit that tracks a path this tree holds ignored).

**Evidence if I am right:** run `git -C <tree> ls-files --others` and observe `bank/keys/swap-operator.json` absent; `snapshot()` therefore never contains it.

**Fix:** use `--others --ignored --exclude-standard` (then filter the build caches with `keepPath`), and add a selftest arm with a gitignored fixture file that must survive a refresh and appear in the snapshot.

### F3. LOW. Item 53's own rule — the full suite re‑run inside the rehearsal tree at every repair commit — has no record for the final commits, and its "what keeps it OPEN" text is stale again

**Construct:** SPEC item 53; `audits/round46/VALIDATION.md`; commits `d2ae5fc`→`487a8b4`.

Item 53 says "every repair commit needs the same in‑tree run again (round 46's included)". VALIDATION records the certifying runner at `d2ae5fc` in the **main** tree and the GitHub verifiable build, but not the in‑tree rehearsal‑tree run — and those commits changed `scripts/` in exactly the way the item cares about (`sbf-strip.sh` is now sourced by `run-tests.sh` itself, `build-mainnet.sh`, `run-sim.sh` and the e2e; the README facts gate is new). Separately, SPEC 53 still lists "the dress rehearsal itself … has not yet run to its end on mainnet" as what keeps the item open, which `audits/rehearsal-2026-10-09/RECORD.md` now contradicts — the same staleness shape as V46‑7, in the conservative direction.

**Fix:** refresh the rehearsal tree to the final commit and run the full `scripts/run-tests.sh` inside it (recording the log), or record a reasoned argument for why the stripping change cannot alter the rehearsal tree's behaviour; rewrite item 53's open‑reasons list to name only what is actually open (the per‑commit re‑run rule).

### F4. INFO. The hosted rehearsal nginx example omits the Cloudflare real‑IP dependency its sibling carries

`web/deploy/nginx-rehearsal-ceremony.conf.example` sets `X-Real-IP $remote_addr` but does not repeat `nginx-rpc.conf`'s warning that per‑IP proxy limits only key on the visitor when the host's `real_ip_header CF-Connecting-IP` include is present. The rehearsal is over and the location was removed, so this is closed in practice; record the note for the next hosted page.

### Scope statement (not a defect in any file): this round's verdict cannot cover files the bundle does not carry

The prompt's exempted list names ten files. Beyond it, the shipped runner and README now depend on files this pass was **not** given and that are not in the exempted list: `scripts/readme-facts.mjs` (a gate `run-tests.sh` fails on — no auditor has read it), `scripts/core-watch.mjs` and `scripts/core-watch-suite.sh` (the Core watch), `scripts/cron-install.sh`, `bank/selftest.mjs`, `bank/alarm.mjs`, `bank/crank.mjs`, `bank/revenue.mjs`, `bank/accrual.mjs`, `bank/redemption-poster.mjs`, and the web offline tests (`run-all.mjs`, `mine.test.mjs`, `plan.test.mjs`, `tx.test.mjs`, `bundle.test.mjs`, `meta.test.mjs`, `decode.test.mjs`, `ids.test.mjs`, `ceremony.test.mjs`), plus `scripts/pob-set.json` (carried in round 46, dropped here). Per the coverage gate's own rule, this round cannot be declared clean until each file's current content is bundled; I say so rather than infer their contents. My verdict covers exactly what was delivered.

---

## The four questions about the accepted limits

1. **Worse than stated?** No accepted limit is worse than its wording. The nearest thing is F1 — but it is disclosed as an *unknown*, not accepted, and it must be resolved before launch because it sits on the crack path. I also re‑checked the ones most likely to hide a widening (41 transfers‑first, 26 leader grind, 46 hot collection key, 47 permanent guardian stop, 32 ring bound at 2,100 supply, 55 unsplit revenue) against the code and found each stated at its true size.
2. **A limit that is not a limit, or closed unnoticed?** None found.
3. **A discharged item not discharged?** Item 51's boost‑timing residue is disclosed; item 54's page rule is met by the pages sending no crank; items 12/17/19/30/33's discharges still hold against this tree.
4. **OPEN AND BLOCKING quietly accepted?** Item 53's per‑commit in‑tree re‑run is the one aging quietly (F3). Item 22's ~2,100‑vault scale clause is correctly still open and recorded as such ("PASS at 5 vaults (scale not exercised)"); items 38 (charter date, lock deadline), 50 (pages unpublished) and 52 are correctly open and nothing proceeds as though they were done.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Put a real Phantom on the widest opening.** F1 is the concrete instance of the general truth: AI can model a wallet, it cannot be one. One person, one phone, one claim‑first opening with strays at maximum packet width — before the authority is removed. If it does not fit, ship the v0 variant first.
2. **Exercise the ~2,100‑vault scale once, with real money, before it is holders' money.** Item 22's own text says the rehearsal proves the crank at 5 vaults. A test‑net‑shaped run (or a first mainnet round run slowly with the crank's full pass observed end to end, paging, RPC errors and all) is the only substitute for the 46 rounds that never saw 2,100 accounts.
3. **Have a human read HOLDER‑GUIDE.md against the pages as a holder, not as an auditor.** Every audit here checked sentences against code; none can check whether a frightened holder with a phone understands "this is lost when the vault is opened". One usability pass on the real pages, on a phone, by someone who did not write them.
4. **Rehearse the failure that matters: a Core upgrade after the lock.** The rehearsal caught a Core upgrade *before* launch, when the suite could re‑run. After step 11 it cannot. Write and rehearse, with a human on the phone tree, the answer to "Core changed at 2am and every redemption now refuses NotBurned": who is woken, what the guardian can and cannot stop, what holders are told. The alarm detects; nothing in this system can act.
5. **Key ceremony hygiene no model can vouch for:** the guardian wallet, the deploy authority, and the $CBOB release wallet should each be verified as held the way the documents claim (hardware, multisig, or the box with its backups) by a person physically present at the lock — because every audit of custody in this record has been a reading of the box's own description of itself.
6. **Fund a standing bug bounty.** Immutability plus AI‑only certification means the next finder of a pool or redemption defect is incentivized only by the market. A public bounty, funded from the 15%, is the only post‑lock audit this design can still buy.

**Result: the five programs — no new finding, and my independent checks (offsets, pairing, helper, pool invariant, boost ring, governance paths) confirm the round 22–46 record against this tree. The fixable layer — F1 (MEDIUM, conditional, on the crack path), F2, F3 (LOW), F4 (INFO), plus the coverage scope statement. Under the 2026‑10‑08 launch gate, F1 must be settled by measurement or by shipping the v0 variant before step 11; F2 and F3 are fixable now with a test each; nothing here lowers what is reported.**