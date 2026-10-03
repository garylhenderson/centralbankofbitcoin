# CBOB v6 — Round 22 audit

**What this round could actually see.** The bundle contains MINT's `lib.rs`, the six `bank/` files, `run-tests.sh`, and SPEC. It does **not** contain SEAL's, BURN's or GOV's `lib.rs`, `bank/sigwalk.mjs`, `scripts/cron-install.sh`, `scripts/check-launch-params.mjs`, `scripts/pob-merkle.mjs`, HOLDER-GUIDE.md or DESIGN-v6.md. The prompt says "every line of the four programs is new to you"; three of the four programs are not in the bundle. I flag this as a finding in its own right (P-1) and mark every claim below that rests on SPEC's prose rather than source.

---

## R1 — THE CRANK (`bank/crank.mjs`)

**R1-1. HIGH — the crank pages on idempotent refusals, and its own two lanes make that routine.**
*Construct:* `crank.mjs` `run()`/`send()` push every failed instruction into `failures`; only `runDistribute` classifies a refusal (`MonthNotElapsed`) as benign. Every instruction the crank sends is permissionless, so any concurrent actor produces refusals that are *success by another name*: `AlreadyCaptured`, `AlreadyRevealed`, `RevealOutOfOrder`, `RescheduleTooEarly`, `AlreadyActive`, `AlreadyRetired`, `NothingToDistribute`. The two lanes are *designed* to run concurrently (`.crank` vs `.crank-reveal` locks, "a slow full pass must not starve the every-minute reveal"), and cron fires both in the same second at the top of each hour (full pass `37 * * * *`, lane `* * * * *`). Both plan the same captures/reveals from independent reads; the slower side's sends land second and fail.
*Gain:* no money. A false page to Gary roughly every hour during any sale (plus fees), on the crank's *only* failure channel — the exact "cries wolf" failure mode `detectors.mjs`'s own comments say destroys an alert channel.
*Evidence if true:* during a sale, the crank log shows `FAIL capture <asset>` / `FAIL reveal #N <asset>` with `AlreadyCaptured`/`AlreadyRevealed` at hour boundaries where both lanes had the same queue. Testable on the local validator: start the full pass and the lane in the same second with one pending reveal; one side's transaction fails and `NOTIFY` fires.
*Fix:* classify the idempotent refusals as "done by someone else" (log ok, don't page), exactly as `runDistribute` already does for `MonthNotElapsed`.

**R1-2. LOW — `readySlot` assumes zero skipped slots; the program tolerates 64 per hash.**
*Construct:* `readySlot()` computes the earliest slot at which all three hashes exist *if nothing is skipped*; `try_capture` accepts A up to `reveal_slot + MAX_SKIPPED_SLOTS`. A capture sent in the gap fails with `RevealTooEarly`. The comment calls a NotYet answer "harmless", but the failure path records it and pages (subsumed by R1-1's fix).
*Evidence:* a `FAIL capture` line with `RevealTooEarly` during any period of slot skipping; a selftest case with a gapped synthetic SlotHashes buffer would pin it.

**R1-3. HIGH — one crashed reveal-lane run blocks the lane for two hours and pages every minute.**
*Construct:* `lock.mjs` `acquireLock` — `if (age < staleMs) return { ok: false }` precedes any liveness check, so a lock left by a **dead** holder is refused until `staleMs` (the crank passes 2 h). `crank.mjs`'s top-level catch pages on every refused start under `--live`. A kill -9, OOM or reboot leaves the generation record; the kernel `flock` died with the process, so the next minute's cron passes `flock -n`, starts node, refuses at the in-process lock, and pages. The refusal message names the base path (`.crank-reveal.lock`), which the generation scheme never creates, so hand-recovery is opaque.
*Gain:* ~120 pages from one crash, and the every-minute lane is down for two hours — which is precisely the "crank outage" precondition of accepted limit 25 (the re-roll) for every vault minted between hourly full passes in quiet traffic.
*Evidence:* plant `.crank-reveal.lock.0` with a dead pid and a fresh timestamp, run the lane three times → three refusals, three notifies. The selftest covers stale+alive and stale+dead but has **no fresh+dead case**.
*Fix:* check `pidAlive`/`pidStart` *before* the age gate and break a dead holder's lock immediately (the mechanism already exists for the stale case); at minimum stop paging ELOCKED for the every-minute lane, and name the generation file in the message.

**R1's four explicit questions, answered:**
- *A plan the program will refuse:* R1-1 and R1-2 above; also a `distribute` sent after a failed join batch hits `JoinWaitingFirst` (one wasted fee, correctly recorded).
- *A plan that pays or joins a dead vault:* **none found.** The planner skips positively-burned assets in every pay/join/activate path; the only dead-weight join is the on-chain `claim` path (accepted limit 27). An `'other'` (unreadable) asset would be paid, but no on-chain state produces `'other'` for a real vault.
- *A reveal out of order:* **none found.** The loop is FIFO from `revealed_total`, breaks at the first not-ready record, and the attribute hash is checked before any fee is spent.
- *Value moved anywhere unpinned:* **none found.** The send loop builds only the seven permissionless MINT instructions with program-pinned destinations; the key signs as fee payer (and as the reveal's rent payer) only.

Minor: the retire filter `r.level !== 0` delays retiring a burned-before-draw vault (it stays in GOV's live supply until the FIFO draws it — safe direction); a frozen pool makes the crank skip post-distribution *joins* that touch no tokens; `t.address !== r.vault_ata` in the claims loop is dead code for active vaults (the same string by construction).

---

## R2 — THE ALARM

**R2-1. CRITICAL — a one-lamport account planted at a vault's canonical cbBTC ATA address permanently bricks that vault, and every shipped control reads it as quiet.**
*Construct:* the ATA address `[asset-signer PDA, Tokenkeg, cbBTC]` under the ATA program is publicly derivable the moment a mint lands. A plain system transfer of one lamport (or a rent-exempt ~0.0009 SOL, which is permanent regardless of rent collection) to that address creates a system-owned account there. The ATA program's create (including the idempotent form) cannot create over a funded account, so:
  - **Funding/activation is permanently blocked.** MINT's `activate` requires `read_token` on the canonical ATA (`owner == SPL_TOKEN_ID`, 165 bytes) — a system account fails `VaultAccountMissing`. The buyer cannot fund the vault any other way (activation pins the canonical address; a non-canonical PDA-owned account is invisible to activation and destroyed on redemption per limit 44).
  - **Redemption is likely blocked too** — the burn's emptiness proof demands every reserve ATA "declared, PDA-owned… and empty" (SPEC's control table); a system-owned account at that address is not PDA-owned. I could not verify this against BURN's source (not in the bundle); it must be checked.
  - **Detection is total silence.** The crank's activation filter `if (!t || t.state !== 'ok') continue` skips with no problem entry. The alarm's balance loop records `readTokenAccount(info).amount` — a foreign/malformed account reads as balance `0`, with no prior balance to diff, so `detectBalanceDrops` never fires. `--reconcile` uses `getTokenAccountsByOwner`, which cannot see a system account. The signature walk cannot see a plain system transfer. `spl.mjs`'s own header names this exact primitive ("reachable by a stranger for one lamport") and the round-11 fix made the *readers* stop throwing — which also removed the only accidental signal (a thrown balance read paging the alarm) and replaced it with quiet.
*Gain:* for the price of a fee, an attacker permanently prevents any vault from ever holding its reserve. The buyer's mint price (already paid into revenue) is stranded; a charter member's spent Proof of Burn is destroyed — one of 240, in a window that can never reopen. A bot watching new mints can brick every later-funded vault of a sale, or every charter claim as it lands, for well under 0.01 SOL. The same plant on the **pool** ATA address (before anyone creates it — see R5-1) permanently kills every distribution and claim; that variant *is* detected (`pool_unreadable`) but is equally unfixable.
*Evidence if true:* on the local validator, mint a vault, send one lamport to its derived cbBTC ATA address, then (a) attempt the idempotent ATA create (fails), (b) attempt `activate` (`VaultAccountMissing`), (c) run the crank (silent skip) and the alarm (quiet). All runnable in the existing harness.
*Fix:* (1) the alarm must treat `foreign`/`malformed` at a canonical ATA address — vault or pool — as a CRITICAL planted-account finding instead of balance 0; the crank should report it as a problem. (2) The funding client (and the redeem page, item 50) should create the ATA **in the same transaction as the mint/claim** — the buyer generates the asset keypair, so the address is secret until the mint lands and an atomic mint+fund is unplantable; the holder guide must say so. (3) BURN's treatment of a non-token account at a declared reserve address must be read from source and written down either way.

**R2-2. MEDIUM — `detectUpgradeAuthorityAfterLock` is silently disabled when `CBOB_LOCK_DEADLINE` is unset.**
*Construct:* `alarm.mjs` `Number(process.env.CBOB_LOCK_DEADLINE || 0) || null` → null → the detector returns `[]` forever. A missing env var reads as calm — the file's own header says a read that fails is an alarm, never a pass. This is the post-launch watch behind limits 13 and 39.
*Evidence:* run the alarm with the env unset against a program upgradeable past the real date → no `program_not_locked`; grep the tree for anything asserting the env is present (nothing).
*Fix:* page or throw in production mode when the deadline is unset.

**R2-3. MEDIUM — the off-curve-owner control rests on untested API wiring.**
*Construct:* `alarm.mjs` passes `k => PublicKey.isOnCurve(new PublicKey(k).toBytes())`; every selftest case injects a fake `isOnCurve`. If the installed web3.js lacks the static form (older versions expose only the instance getter), the call throws, the catch sets `ok = null`, and "unreadable is NOT a verdict" silently skips **every** owner — `unredeemable_owner` never fires and limit 43's stated mitigation is not delivered.
*Evidence:* `node -e "console.log(typeof require('@solana/web3.js').PublicKey.isOnCurve)"` in the deployed environment; grep `selftest.mjs` for a call to the real function (none).
*Fix:* one selftest assertion calling the real `PublicKey.isOnCurve` on a known PDA (false) and a known keypair (true).

**R2-4. LOW — the production-value assertions omit `max_supply` (2,100) and `level_caps` (945/525/315/210/105).** Both are write-once `initialize` values (item 38), watched only for drift that no instruction can produce, so a wrong launch value is never reported. *Evidence:* the `want` list in `detectStandingRisks`. *Fix:* add them.

**R2's two explicit questions:** *dangerous state read as quiet* — R2-1 (the planted account), R2-2, R2-3. *Routine state paged every pass* — none in the alarm itself beyond intended standing alarms; two borderline cases worth knowing: `redemptions_near_cap` pages on every ordinary redemption for the full window once live supply is small (cap 1 at ≤47 live: one redemption → HIGH each pass for an hour — truthful but noisy at end-of-life), and an expired ack re-pages by design until re-affirmed.

---

## R3 — THE LAYOUTS

Verified, not assumed: I recomputed every offset by hand. `MintConfig`'s last field ends at 679 (+8 disc), matching the Rust `MINT_CONFIG_SPACE` arithmetic to the byte (935 with padding); `VaultRecord` is 221 bytes matching SPEC; GOV's pinned `mint_index` (41), BURN's `bare_burns_retired` (454), SEAL's `collection` (9) and `reserve_mints` (41) all match. The discriminator preimages (`account:<Struct>`), the `Vec<Pubkey>` handling, the u128 LE codec, the bool refusal, and the round-trip are all real. The selftest's field-for-field comparison is order- and type-sensitive, so a Rust edit that reorders, adds, removes or retypes a field turns the build red, and the cross-program and suite offset scrapes catch a moved field three ways.

One residual, LOW: the pinned-offset scrape only sees `const OFF_*: usize = N;` declarations. A program that inlined a literal offset would be invisible to it. *Evidence:* the regexes in the selftest's `pinned()` helper. *Fix:* none urgent; note it for the next Rust edit.

---

## R4 — THE MONEY ARITHMETIC

I compared `accrual.mjs` line-for-line against MINT's `credit`, `claim`, `retire`, `ceil_sats` and `join`: **no divergence found.** `credit`'s `delta = avail·SCALE/w` with truncating division, `owed += delta·w`; `ceil_sats`; `pendingSats`'s truncating floor and its throw-on-negative (mirroring the program's `checked_sub` → `Overflow`); `debtAtActivation = w·acc`; `available`'s clamp (the program refuses `PoolShort` where the mirror returns 0 — the alarm reports the shortfall, which is the consistent pair). I also verified the pool-solvency invariant by construction (distribute refuses a short pool; claims drop balance and owed equally; retire only lowers owed), which is what discharged item 11 rests on.

One asymmetry worth stating, not a divergence: the crank catches `pendingSats`'s throw **per vault** and reports it, while on chain a record with debt above entitlement fails the **whole batch** (`Overflow`). Safe direction; only reachable via a state bug, which is exactly when you want the loud version.

---

## R5 — THE SWAP HOP

**R5-1. MEDIUM — nothing in the delivered tree creates the pool ATA, and `revenue.mjs`'s comment says `initialize` does.**
*Construct:* `revenue.mjs` step 4: "The pool already exists (initialize derives it)". MINT's `initialize` derives the *address* and performs no ATA-program CPI; no instruction in MINT creates it; `split_revenue` transfers into it and `distribute` reads it, both of which fail on a nonexistent account. The suite and simulation necessarily create it test-side, which masks the gap.
*Gain:* the first live revenue cycle wedges at the split (return landed, no split → open cycle → page → manual repair), and the window between `initialize` and whoever eventually creates it is exactly the dust-plant target of R2-1's pool variant — permanent, detected, unfixable.
*Evidence:* read `initialize`'s body (no ATA CPI); grep the tree for a pool-ATA creation (revenue.mjs creates the *bank* ATA idempotently in the same transaction — the asymmetry is the smell).
*Fix:* create the pool ATA idempotently in revenue.mjs's step 4 (one instruction, same pattern as the bank ATA), and add it to the launch checklist and the dress rehearsal.

**R5-2. MEDIUM — a crash between the split landing and the ledger save wedges every later cycle, though the chain proves the cycle closed.**
*Construct:* `cycle.splitSig = await sendAndConfirmTransaction(...)` then `save(led)`; a kill in between leaves `returnedSats` with no `splitSig` → `cycleIsOpen` true → the open-cycle guard throws on every later run until a human edits `revenue-ledger.json`. Loud (`cycle_unsplit` HIGH) but manually repaired, and the revenue cycle is down meanwhile.
*Evidence:* write a ledger row with `returnedSats` and no `splitSig` while the revenue ATA is empty, run `node bank/revenue.mjs` → it throws at the guard.
*Fix:* at the guard, re-check the revenue ATA for open cycles with a return; provably empty → stamp `splitByOther` with the emptiness as the reason and proceed. The proof is already imported and used ten lines below.

**Worst case, bounded:** per-sweep cap × cooldown windows until the guardian stops, ≤ revenue SOL above the reserve — limit 10 as stated, not worse. One naming gap: `quote-api.jup.ag` is a second trust root with the same blast radius as the operator key (the pre-signature inspection cannot bound a swap transaction that simply transfers the operator's balance; the real bound is the dedicated wallet, which SPEC states as an ops instruction). Say so in limit 10 so nobody reads the signer/key checks as a destination bound.

**Nothing here moves value unpinned:** sweep → operator (program-pinned); return → the revenue PDA's ATA (derived); split → program-pinned. Verified against the instruction lists.

---

## R6 — THE GATES

**R6-1. LOW/MEDIUM — the mainnet probe is skippable with a green exit.** No network (or blocked DNS) → the probe is skipped, a line is printed, and the run still exits 0. Loud for a human reading logs; invisible to any automation reading exit codes. *Evidence:* run `run-tests.sh` with DNS blocked. *Fix:* a ship-gate mode (`CBOB_REQUIRE_MAINNET=1`) that fails when the probe cannot run.

The equality floors are real (count must EQUAL, both in `run-tests.sh` and selftest's own `FLOOR`); the both-directions discipline is real; the vacuous-empty cases are handled (`everywhere` requires >0 occurrences; the first-pass quiet states are deliberate). The inherent residual: assertion-count equality cannot detect substituting a hard assertion for a trivial one — mitigated, not removed, by the both-ways rule. No further finding.

---

## THE FOUR QUESTIONS ON THE ACCEPTED LIMITS

**1. Is any limit WORSE than stated?**
- **Limit 28 is broader than stated.** A frozen *vault* cbBTC account does not merely defer its claim — it makes that vault's **redemption impossible** while frozen: the emptiness proof refuses a non-empty reserve ATA, and SPL refuses transfers and burns from a frozen account, so the vault can never be emptied and never burned. "A member can always get their Bitcoin out" is false in that state. *Evidence:* SPEC's own control-table description of `VaultNotEmpty` plus SPL freeze semantics; the suite has frozen-*pool* tests (3c.F0–F3) and a claim-deferral test (P.18) but no frozen-vault-account redemption test. *Fix:* one sentence in limit 28 and the holder guide; one suite test.
- **Limit 43's mitigation** rests on the untested wiring of R2-3; if it is broken the limit has no detection at all.
- **Limit 25's precondition** ("a crank outage") is reachable from a single crashed lane run via R1-3 — a two-hour lane outage *is* the outage.
- **The "1 lamport griefs a burn" limit understates its family:** the same lamport at the *ATA address* (not the PDA) is permanent, not "until the next redemption" — that is R2-1, a new finding, not a restatement.
- Limits 10, 26, 27, 32, 34, 35, 36, 41, 42, 44, 45, 46, 47, 48, 49: checked against the delivered code and SPEC; not worse than stated (34 and 32 could not be checked against source — see P-1).

**2. Is anything listed as a limit not actually a limit?** None found. Items 9/44/50 remain genuinely open (the redeem page does not exist; `judgeRedemptionCoverage` has no caller). One completeness note on limit 36: `monthly_inline` also silently no-ops when the pool account is not a readable token account of ours — covered by `pool_unreadable`, so the limit is complete in effect.

**3. Is any DISCHARGED item not actually discharged?** Items 11, 14, 19, 30, 31, 33 verified against MINT's source where checkable (11's invariant holds by construction; 14's `DuplicateAttribute`; 19's `NotRevealed`; 30/31/33's initialize-only writes). Items resting on GOV or BURN (15's `VaultTooNew`, 33's apply paths, 12/17's measurement) could not be re-verified — sources absent.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38 and 50 are all still tracked as open, the crank is installed dry-run, and nothing in the delivered tree demotes them. Caveat: item 50's holder-guide promises could not be checked — the file is not in the bundle.

---

## ANYTHING ELSE

**P-1. HIGH (process) — this round's bundle cannot certify three of the four programs.** SEAL (the seal/thaw pairing), BURN (the emptiness proof, the rate ring, the retire CPI), GOV (the tally, the snapshot, the execution skips), `sigwalk.mjs` (the alarm's entire transaction scanner), `cron-install.sh` (the subject of several gates), HOLDER-GUIDE.md and DESIGN-v6.md are absent, while the prompt claims the round "reads it whole". Several of my checks above (the rate arithmetic, the redemption half of R2-1, limit 34) rest on SPEC's prose. *Evidence:* the bundle's own file list. *Fix:* deliver the full tree to the next round and run `scripts/audit-coverage.sh` against *this* round's bundle — it should fail.

Minor notes: `runDistribute`'s `MonthNotElapsed` match depends on `e.logs` being attached to the thrown error (the author documents the Anchor-name-not-in-message trap in `revenue.mjs` and compensates here — fragile but working on current web3.js); `seenSplits` grows unboundedly in alarm state; `REDEEM_RATE_BPS` in layout.mjs is an unused duplicate of a constant hardcoded in `redemptionCapacity`.

---

## WHAT THIS PROJECT SHOULD DO BEFORE LAUNCH THAT AI AUDIT STRUCTURALLY CANNOT

1. **Randomized differential testing of the money state machine.** The 645 assertions are hand-written paths. Write a generator that fires random sequences of mint / reveal / activate / distribute / claim / retire / redeem / split / sweep against the validator with `accrual.mjs` as the oracle, asserting after *every* step: pool ≥ ceil(owed); Σ(w·acc − debt) == owed over active vaults; no negative pending; weights and counters consistent; no token movement outside pinned paths. Thousands of seeds. AI rounds write paths; they do not write interleavings.
2. **The dress rehearsal with deliberate failure injection** (item 22, adversarial): kill -9 `revenue.mjs` between sweep and ledger save; kill the crank mid-pass; corrupt `state.json`; delete the ledger marker; plant dust at a vault ATA and at the pool ATA; drain the crank key below the floor; run the alarm during live traffic. Verify each *pages* and recovers per a written runbook. The selftests prove the pure functions; only this proves the I/O, cron and pager as one system.
3. **A read-back ceremony at initialize.** After the four `initialize`s and *before* removing upgrade authorities, dump every config from chain, decode with `layout.mjs`, and diff against `launch/mainnet-init.json` field by field — signed off by a second person who derived the values independently. The alarm's `test_value_in_production` is the after-the-fact version; make it a gate, and add `max_supply`/`level_caps` to the list (R2-4).
4. **Create the pool ATA deliberately, immediately after `initialize`** (R5-1), and record it as a launch step — the window is a permanent-kill griefing target.
5. **Verify the lock.** After `set-upgrade-authority --final` on all four, re-run the alarm and confirm all four read IMMUTABLE and the Core hash matches the pinned dump; keep `CBOB_LOCK_DEADLINE` set and asserted present (R2-2).
6. **Custody and humans the code leans on but cannot enforce:** the swap-operator wallet holds nothing but cycle funds; a named human answers the pager at 3 a.m.; runbooks exist for frozen pool, frozen vault account (M4), planted ATA (R2-1), open revenue cycle, reschedule storm, and guardian-key theft.
7. **A capped-value beta.** Redemption, pool and charter bugs cannot be stopped by design. Run the first weeks with a small float, the stops pre-armed, and every page treated as a drill.
8. **Close the coverage gap before counting rounds.** With P-1 standing, this round cannot be one of the two clean ones the ship gate requires — and the stopping condition has still never been met.