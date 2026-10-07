# Independent security audit — CBOB Vaults v6 (round 33, programs-focused)

## Method and what I could / could not do

I read the five programs, the sweep helper, the bundled tests/sim/scripts, `bank/txread.mjs`, `bank/sigwalk.mjs`, the v6 docs, the round-32 verdict/VALIDATION, and `launch/mainnet-init.json` at the stated HEAD (`18dbff6`, repairs in `ec4a0e1`). I recomputed the cross-program offsets, account spaces and pairing logic from the struct definitions.

**Honesty bound:** I cannot boot a validator or reach an RPC in this environment, so any statement of the form "the suite/run shows X" is a prediction of what a run would show, with the exact checkable evidence named. Statements from reading code are direct. The off-chain detector bodies (`bank/alarm.mjs`, `bank/detectors.mjs`, `bank/crank.mjs`, `bank/revenue.mjs`, `bank/accrual.mjs`, `bank/layout.mjs`, `bank/selftest.mjs`, `bank/lock.mjs`) are **not in this bundle**, so I did not re-verify the round-32 off-chain repairs (`detectSweepState`, `tx_unreadable`, log-gap never-drop); those belong to the concurrent off-chain pass and I say so rather than claim them.

---

## R0 — Round-32 verdict and its repairs

**L1 (coverage-gate bundle parser fails open): repair holds.** `bundles()` in `scripts/audit-coverage.sh` now (a) splits a `FOCUS === 'programs' ? [ … ] : [ … ]` list by shape with `re.search(r'\]\s*:\s*\[', body)` and fails closed (`SystemExit`) if the split cannot be found, and (b) refuses any `TARGETS` header that mentions `FOCUS` in an unrecognised form instead of falling through to credit both foci. Tuple closers are `],`/`]\n`, never `]:[`, so the first `]:[` after the ternary opener is the real split. I found no remaining fail-open for any formatting the real round scripts (19–33) use. Residual is non-exploitable: a deliberately malformed script fails the gate (exit 2, refuse-to-certify), which is the safe direction.

**D1 (three false DESIGN-v6.md sentences): repair is INCOMPLETE — see finding F1.** Two of the three sentences were corrected in the bundled file; the first was not, while VALIDATION.md claims all three were.

**Gate-5 suite arms** (R31.W1a/W1b, R31.W2a/W2b, R32.A22a/b, R28.A1 at 10,198 bytes): present in `tests/3prog.test.ts` and consistent with the on-chain floor moving 855→861. I could not re-execute them here; the checkable evidence is a run of `scripts/run-tests.sh` reporting `861/861`.

---

## Findings

### F1 — INFO (documentation / process integrity): round-32 D1 repair incomplete; VALIDATION.md overclaims
**Construct:** `DESIGN-v6.md`, section "No mint may vote on a proposal opened before it."
**What is wrong:** The bundled file still reads *"v6: the vault's mint index is recorded **on the asset**."* The mint index is not on the Core asset; it is in MINT's `VaultRecord` (`mint_index`, written in `write_record`, read by GOV's `read_vault_index`). Round-32 D1 required exactly this sentence to be corrected, and `audits/round32/VALIDATION.md` states "three DESIGN sentences corrected (mint index in the record, claim-before-burn and retire, `*_stopped` fields)." The other two sentences **are** corrected in the same bundled file (the "Redemption settles first" bullet now says `ClaimBeforeBurn`/`retire_redeemed` removes weight; section 4 uses `sales_stopped`/`sweep_stopped`). So the file is the post-repair version and this one sentence was missed — and the validation record asserts otherwise.
**Why it matters here:** with no human firm downstream, a validation record that says "corrected" while the document still carries a false mechanical statement is how a wrong belief gets inherited by the next round and by holder-facing copy.
**Evidence that would confirm it:** `grep -n "recorded on the asset" DESIGN-v6.md` at HEAD returns the line; `git diff ec4a0e1^..ec4a0e1 -- DESIGN-v6.md` shows the two other sentences changed and this one untouched.
**Fix:** change to "the vault's mint index is recorded in its MINT `VaultRecord` (where GOV reads it)," and correct the VALIDATION claim to match what actually landed.

### F2 — MEDIUM (one-time configuration): `guardian` and `swap_operator` are accepted without any proof they are usable signing keys
**Construct:** `programs/cbob-vault-mint/src/lib.rs`, `initialize` (and the `Initialize` accounts struct).
**What is wrong:** The only checks on these two keys are `require_keys_neq!(swap_operator, Pubkey::default())` and nothing at all on `guardian` beyond storing it. Neither is a signer of `initialize`. `Pubkey::is_on_curve` panics on BPF (measured fact 5), so the program *cannot* test on-curve-ness. Therefore an off-curve value (a PDA, a mistyped address, a program) is silently accepted and then **permanently** disables the function that needs that signature:
- off-curve `swap_operator` → every future `sweep_sol_for_swap` fails (`swap_operator: Signer` can never be satisfied) → royalty SOL can never be converted, forever;
- off-curve `guardian` → every `emergency_stop_*` / `cancel_swap_operator` fails `NotTheGuardian` → the emergency brake is dead forever (and a "guardian" nobody controls can never be replaced except by the 50%-of-all-vaults vote).
Because the programs are immutable, this is unrecoverable. `bank_treasury` is correctly excluded from this concern: it only *receives* via its ATA, so off-curve is fine there (the Squads address is off-curve, item 52).
**What an accident gains:** a single typo at the one-time `initialize` bricks the trusted hop or the brake, with no on-chain signal. The only current control is `scripts/check-launch-params.mjs`, which validates the JSON, **not the signed transaction** (item 38 A6 already says the programs check less than the checker).
**Evidence that would confirm it:** on a test validator, `initialize` with `swap_operator` set to an off-curve PDA succeeds; the first `sweep_sol_for_swap` then fails with a missing-signature error and no later sweep can ever succeed.
**Fix (pre-lock, preferred):** make `swap_operator` a required `Signer` of `initialize` (it is always a real key), proving possession and on-curve-ness at the only moment it is still possible. For `guardian`, which is legally `None`, require a matching signer in `remaining_accounts` when `Some`, or at minimum add a launch-script step that obtains a real signature from the guardian key over a known message before the initialize transaction is signed. A program-level signer check is the only one that becomes permanent.

### F3 — LOW (sweep helper guardrail): destination wallet is not screened against being a vault / PDA
**Construct:** `programs/cbob-vault-sweep/src/lib.rs`, `process`.
**What is wrong:** The helper refuses `signer.key == dest.key` but performs no other check on `dest`. `dest` may be another vault's asset-signer PDA, an off-curve address, or any account. Because only the asset owner can reach the helper (via Core `ExecuteV1`), there is **no attacker path** — this is self-harm only. But a redeem page that mis-resolves the destination would sweep a holder's entire vault (tokens and lamports) into an address from which it can never be recovered.
**Evidence:** the source contains only the `signer.key == dest.key` guard; there is no suite arm for `dest = another vault's asset-signer` (the prompt's R1s(b) asks; it is not refused).
**Fix:** this cannot be fully enforced on-chain (no on-curve test, no enumeration of vault PDAs), so the control belongs in the redeem page (item 50): validate `dest` is the owner's own on-curve EOA before building. Optionally the helper could refuse `dest` owned by Core or by our four programs, which would catch the other-vault case cheaply.

### F4 — LOW (reader blind spot): v1 transactions that use lookup tables are structurally unreadable, while SPEC says monitoring reads v1
**Construct:** `bank/txread.mjs`, `validateParsedTransaction` — `if (tx.version === 1) { need(m.accountKeys.every(k => k.source !== 'lookupTable'), 'v1 lookup-table key') }`.
**What is wrong:** A v1 transaction's reason to exist is address lookup tables, and resolved LUT keys arrive with `source: 'lookupTable'`. The reader therefore rejects essentially all real v1 transactions as unreadable. The Reader coverage boundary states "Monitoring reads legacy/v0/v1 parsed history," which is only true for the (rare, pointless) v1-with-inline-keys shape. Consequence: as clients migrate to v1, the alarm's transaction-level detectors and the redemption poster lose coverage of activity that is still perfectly legal on-chain. The round-32 `tx_unreadable` handling prevents the *cursor* from being silently lost, but not the detection gap.
**Evidence:** the bundled fixture `tests/fixtures/mainnet-v1.json` has every key `"source": "transaction"`, so the passing regression covers only the no-LUT shape; feeding the same fixture with one key changed to `"source": "lookupTable"` makes `validateParsedTransaction` throw. 
**Fix:** resolve lookup-table keys in the reader, or (cheaper, pre-launch) state in SPEC that all official clients must use legacy/v0 and add a detector that pages whenever any of the five programs appears in a v1 transaction, so the blind spot is noticed rather than accumulated.

### F5 — INFO (test hygiene): retained `tests/probe-round5.test.ts` uses v5 instruction shapes and cannot run against v6
**Construct:** `tests/probe-round5.test.ts` (MINT `initialize` called with 4 args; `mint_vault` called with only `(name, uri)`).
**What is wrong:** v6 `initialize`/`mint_vault` take many more arguments, so these calls fail `InstructionDidNotDeserialize`; the probe's D5 (born-frozen) path cannot mint a vault. It is not part of `run-tests.sh` (which runs only `tests/3prog.test.ts`), and its property is covered in v6 by suite arm 2.3a, so it is stale rather than load-bearing. `tests/probe-round5b.test.ts` (D4, F4) is version-independent and still valid. Risk: a future reader runs the stale probe and trusts a false pass/fail.
**Fix:** update it to v6 shapes or annotate it clearly as historical/non-certifying.

---

## Target-by-target (where I found no new defect)

**R1 — custody / pairing.** The open↔burn pairing binds asset **and** owner in both directions and requires both halves top-level; CPI-wrapped open or break the pairing (WR.1–WR.4). Double-burn is impossible (tombstone fails `NotACoreAsset`). A thawed vault cannot survive the transaction: any burn failure reverts the thaw and sweep atomically. No new defect.

**R1s — sweep helper.** (a) Only the owner can reach it (Core `ExecuteV1` owner rule; direct call needs the asset-signer signature only Core produces; SR.1/SR.5/SR.5a/SR.5c); it cannot run while frozen (the seal refuses Execute). (b) Duplicate source → rejected on the second read because the closed account's owner is no longer a token program (SR.12a/SR.12b); source==destination is rejected via the owner check; odd pair count → `NotEnoughAccountKeys`; zero pairs → lamports-only sweep (SR.13). (c) `dest` not compared to owner is safe *given (a)*; a below-rent nonexistent lamports destination fails the System transfer and reverts the redemption (no loss). (d) `signer.lamports()` is read at execution and fully drained; burn follows immediately in the atomic transaction, so nothing re-credits it and BURN sees 0. (e) A sweep-closed reserve account passes BURN via the non-token-owner `continue`, which is safe (a non-token account holds no tokens); the prior-transaction creation of missing reserve ATAs is sufficient because the sweep then reads the live balance including any stranger deposit; a Token-2022 ATA for a classic mint cannot be created (probe F4.2 REJECT), and non-ATA/nested cases are the accepted completeness gap (limit 44). (f) S8.0's 1,061 bytes leaves the stated room; a fourth reserve cannot fit and `MAX_RESERVE_MINTS=3` forbids it. (g) helper bytes are proven identical to the tested build by `build-mainnet.sh` `cmp`. **Only F3 above.**

**R2 — pool.** I re-derived the `credit`/`claim` arithmetic: `distribute` keeps `balance ≥ ceil(owed)` because `delta·w ≤ avail·SCALE`; `claim` pays `floor(pending/SCALE)`, carries the sub-sat remainder, and reduces `owed_scaled` by no more than the vault's pending. Liveness is protected because joining and boost-expiry are free and permissionless, so no one can withhold them to block distributions. No new defect.

**R2b — boost.** A boost earns exactly N distributions (weight is read before `advance_epoch` makes it due; `BoostsExpireFirst` blocks the N+1-th). The 64-slot ring cannot collide among simultaneously-live boosts because max length is 63, so two congruent-mod-64 end epochs are never live at once. Early/due retirement, wrap, and reweigh/carry are covered by the host tests and BO arms. No new defect.

**R3 — level draw.** SlotHashes parse is defensive and fail-closed; skipped-slot handling is deterministic; FIFO is enforced; burned-head vaults still draw; the attribute re-supply is hash-checked and byte-budgeted to fit a legacy reveal. The grinding residual is the accepted limit 26, and I found it no worse than stated. No new defect.

**R4 — governance.** Snapshot divisor, `VaultTooNew`, 10% turnout, and the 50%-of-snapshot key-change bar all make thresholds harder, never easier, as supply changes post-snapshot. Overtaken actions skip-and-log without reverting the bundle. The permanent-stop-at-low-turnout case is accepted limit 47 and I found no worse variant (the guardian cannot refresh the stop timestamp by re-stopping while already stopped). No new defect.

**R5 — charter claim.** Merkle leaf/node are domain-separated and sorted; `pob_extra` accounts are passed never as signers; the window is clock-only and cannot reopen. The hot PoB authority exposure is accepted limit 46; the pass-through bound (8) vs the packet reality (≤4 in the widest shape) is already stated there. No new defect.

**R6 — one-time configuration.** See **F2** for the signing-key footgun. Otherwise the initialize bounds are checked as documented; the wide-but-checked ranges (`redeem_window_secs` 10s–24h, etc.) are item 38 launch-value obligations, not program holes. The royalty plugin is installed with `PluginAuthority::None` (immutable in Core).

**R7 — cross-program raw reads.** I recomputed the offsets the programs pin: MintConfig `minted_total`=141, `bare_burns_retired`=454, `sales_stopped`=191/`sweep_stopped`=192, stops-at 518/526, tighten bounds 631/639/647, boost bounds 711/712; VaultRecord `mint_index`=41; BurnConfig `burned_total`=42; SEAL `collection`=9, reserves=41. All match the struct field order and the sizes (VaultRecord 221, BurnConfig 827). Consistent with RT3's recomputation. No misread found.

**R8 — suite/sim/build as evidence.** Floors equal counts and are asserted equal (`MIN_ASSERTIONS=861`, detector 907, etc.); `because()` pins enforce right-reason rejections; `ID.1` enforces unique ids. The sweep helper's deployed bytes are `cmp`-proved against the tested build. I found no arm that cannot fail among the money paths; the stale probe is F5. I could not re-execute here; the checkable evidence is a green `scripts/run-tests.sh` at the release commit.

---

## The four accepted-limit questions

1. **Any limit worse than stated?** I did not find one. Limit 26's grinding, 32's ring bound, 40's Core-upgrade consequences, 46/47's governance/brake exposures all read accurately against the code. The orphaned-activated-vault dilution ("What got worse") is real and stated, including that it is largest while few vaults are active; it is an owner decision to fix pre-lock, not a new finding.
2. **Any listed limit not actually a limit / already closed?** None found still-open that is secretly closed. The discharged items I checked (14 duplicate attributes, 19 unlevelled halt, 33 operator notice, 51 boost, 54 compute) are genuinely closed on-chain/measured.
3. **Any DISCHARGED item not actually discharged?** None found. Item 33's discharge rests on `notice_secs` being an initialize value exercised at 60s; the 7-day mainnet value is the same arithmetic, which is a reasonable discharge.
4. **Any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are still genuinely open: `launch/mainnet-init.json` still has `charter_opens_at` and `lock_deadline` as `null`; the holder surfaces do not exist; the dress rehearsal and the release-commit rehearsal re-proof (item 53 — round 32 refreshed the worktree but did not run the full suite in it) are not done. The holder guide remains DRAFT and must not be published before item 50 ships.

---

## Anything else

- The reader's v1 handling (F4) and the DESIGN sentence (F1) are the two places where a *record* and the *code/document* disagree; in a no-human process those are the highest-leverage things to keep honest.
- I could not verify the round-32 off-chain repairs from this bundle (files absent). Do not let this programs pass be read as having confirmed `detectSweepState`, `tx_unreadable`, or the log-gap never-drop behavior; that confirmation must come from the off-chain pass that can see those files.

---

## Given no human firm will ever see this and the programs are immutable, do these before launch (things AI audit structurally cannot do)

1. **Key-custody attestations a human must make and own.** Move the `$CBOB` release wallet (limit 56) and, at least through the 7-day charter window, the Giraffish Moments collection authority (limit 46) off the hot box to cold/multisig, and document it. AI can describe the risk; only a human can change where the keys live and attest to it. Likewise decide how the guardian key (Gary's Phantom) is secured, since it is the only brake.
2. **Fix F2 in code, then prove key possession by signing.** Before removing upgrade authority, make `swap_operator` (and, when `Some`, `guardian`) sign `initialize`, and have a human witness each of those keys produce a real signature. This is the one launch-value class that is otherwise unrecoverable and uncheckable on-chain.
3. **Independently re-derive the Proof-of-Burn root from the authoritative burn records,** not only from `scripts/pob-set.json`. AI can recompute the Merkle root from the file and confirm each address is live-or-burned on mainnet; it cannot confirm these are the *intended* 240 burns. A wrong root bricks the charter claim permanently. A human must reconcile the set against the actual burn event.
4. **Run the mainnet dress rehearsal with real (small) funds at the terminal** (item 22), including one full revenue cycle through both pools and one forced post-sweep failure walked through hand recovery. AI can specify the pass/fail criteria; a human must execute and sign off on live money.
5. **Set the two OPEN launch values and coordinate them:** `charter_opens_at` and the derived `lock_deadline`. These are decisions plus real-world scheduling/announcement that only humans can do.
6. **Perform the deploy + upgrade-authority-removal as a witnessed, multi-party ceremony,** then independently confirm on a block explorer (not just the local script) that all five programs report no upgrade authority and that the deployed hashes equal `build-mainnet.sh`'s. AI can produce and compare hashes; a human must execute the irreversible authority removal and verify it from an independent vantage point.
7. **Hold the holder guide (item 50) out of publication until the redeem/deposit pages exist,** and have a human read the guide against the live product. The guide currently instructs "only open your vault on the Bank's redeem page," which is unfulfillable until item 50 ships; publishing it as-is would promise something the code does not yet provide.
8. **Staff the alarm response.** The guardian must be able to pull `emergency_stop_sweep`/`emergency_stop_sales` within the alarm's cadence; detection without a human who can act on it is only logging. Ensure a person is reachable for `CRITICAL` pages, especially for the trusted hop and the PoB collection during the charter window.

Net: the on-chain money paths (seal pairing, emptiness proof, pool accumulator, boost ring, rate limit, cross-program offsets) are in good shape and I confirmed the round-32 program-side repairs except for one incomplete documentation fix (F1). The actionable new items are F2 (make the two signing keys prove themselves at `initialize`), plus the guardrail/reader/hygiene items F3–F5.