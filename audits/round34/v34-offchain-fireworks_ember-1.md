# Round 34 audit — off-chain pipeline, MINT, and the sweep helper

**Scope and method.** I read the whole bundled tree independently, then verified round 33's verdict against it rather than assuming it. I traced every crank instruction's account metas against MINT's `#[derive(Accounts)]`, re-derived the payout arithmetic against `credit`/`claim`/`retire`/`reweigh`/`owed_of`/`join`/`expire_boost`, recomputed the oracle math and the Pyth offsets, walked the judge against the builder instruction by instruction, and drove the round-33 repairs at their boundaries. Where I claim a defect I state what would exist on chain or in a run if I am right. Where I found none I say what I checked, so a clean area is a measured area, not an unexamined one.

---

## R0. Round 33's verdict and its repairs

Round 33 was NOT CLEAN (one LOW, three INFO, one gate-5 obligation). I verified each repair at its site and probed for regressions.

**L1 (the clock-domain mix in `detectSweepState`) — repair HOLDS, and I checked the new hole it could have opened.** The window is now symmetric: `Math.abs(t - st) <= half` with `half = cooldownSecs / 2` (`bank/detectors.mjs` `detectSweepState`). A wider window is the dangerous direction for this detector, so I re-derived the thief cases rather than trusting the verdict's control:

- Thief sweeps *after* the honest cycle: the program enforces a full cooldown between sweeps, so the thief's `last_sweep_at` is at least `cooldown` after the honest sweep's landing, and the honest row's `startedAt` precedes its landing by only seconds. `|t_thief − st_honest| ≥ cooldown > cooldown/2`. Not explained.
- Thief sweeps *before* the honest cycle: the honest cycle cannot start until a full cooldown after the thief's sweep, so `|t_thief − st_honest| ≥ cooldown − ε > half`. Not explained, and the thief's sweep pages at the first pass after it lands (within one alarm interval), long before the honest sweep can mask it.
- The `cooldownSeen` floor (`Math.min(..., 21600)`, persisted, rolled back on an undelivered page) closes the review-33 lengthening attack: a vote can only lengthen the cooldown, so the smallest value ever seen is the sound bound, and a thief cannot widen the window by executing a longer cooldown. Verified against MINT's `tighten_sweep` (`c.sweep_cooldown_secs.max(x)` — monotone up only).

The selftest arms the boundary at ±10800/±10801 at cooldown 21600 and ±1800/±1801 at 3600, plus skew-quiet cases at +300 and −3700 s. Both directions, real values.

**D1 (uncertain send explaining a sweep) — repair HOLDS.** A `pendingSweepSig` now explains only when the alarm's own `getSignatureStatuses(..., { searchTransactionHistory: true })` (not the floodable walk) shows it confirmed/finalized with no error (`bank/alarm.mjs` `pendingSigs`/`landedSigs`). A throwing lookup yields an empty `landed` set — the loud direction. The extracted-fragment arm runs the real code against stubbed statuses.

**D2 (`mint.last_sweep_at` unwatched) — repair HOLDS.** It is in `WATCHED_KEYS`; `missingWatchedKeys` names it if a reader drops it (the generic mechanism is already armed both ways via the round-23 I3 arm).

**D3 (the "47 launch" count unchecked) — repair HOLDS.** `RX.launch` is now `/(\d+) launch\b/g`, which matches the Running-the-tests phrasing "47 launch and 33 live-mainnet"; the arms plant a stale 48 (caught) and an empty match (fails the nonempty requirement).

**Gate-5 (wSOL dust arm).** R33.G4 is claimed in the suite (a stranger's pre-filled wSOL account closes under the swap's own instructions). I cannot execute the suite here; the claim is consistent with the round-31 measurement and with `CloseAccount` semantics on a native account, and the on-chain floor moved 861→866. No contradiction found.

**No regression from the repairs found.** The consecutive-clean counter correctly stays at 0/2.

---

## R1. The crank (`bank/crank.mjs`)

I checked every instruction's metas against MINT's account structs, in order, including writable/signer flags:

- `reveal_level`: 9 keys, order and flags match `RevealLevel` (config W, record W, asset W, collection W, payer signer+W, mint_authority R, slot_hashes R, core R, system R).
- `claim` (join and pay batches), `distribute` (pool R, burn=0), `expire_boosts`, `split_revenue` (config R, revenue W, mint R, three ATAs W, token R), `activate`, `retire_burned`, `capture_entropy`, `reschedule_reveal` — all match.

**No plan the program refuses in a loop, no dead-vault payment, no out-of-order reveal found.** Specifically:

- Burned vaults are retired, never joined or paid; `'other'` (null read) vaults are excluded from joins and claims and reported as problems, and an unreadable eligible vault suppresses the distribution (`joinable === false`), matching `JoinWaitingFirst`.
- The reveal loop is strictly FIFO from `revealed_total` and breaks at the first not-ready record; `judgeRevealAttrs` refuses a mismatched list *before* a fee is spent and treats an already-`level`-carrying list as done-elsewhere.
- `budgetPlan` keeps the floor in reserve on every branch and runs the base plan whenever covered; the reveals it drops are paged by name.
- The pre-expiry/claim arithmetic is exact (see R4); a distribution landing between plan and send makes the program pay *more*, never revert the batch; a retire landing in between makes the program skip the vault (`if !r.active { continue }`), never revert.
- The crank signs only as fee payer; every destination is pinned on chain (split destinations, `vault_ata` recorded at activation, the accumulator). Nothing routes value to the crank key.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

### LOW — the daily reconcile reports every Token-2022 account a vault owns as holding "0 units", whatever it actually holds

**Construct.** `bank/alarm.mjs` `reconcile()`: the Token-2022 enumeration maps each account through `readTokenAccount(account).amount`. `bank/spl.mjs` `readTokenAccount` deliberately returns `{ state: 'foreign', amount: 0n }` for any account not owned by classic Tokenkeg — correct for the money paths, wrong for an *enumeration* that explicitly queries the Token-2022 program. So the T22 leg of the reconcile produces `{ address, amount: 0n }` for every T22 account, and `detectUndeclaredTokenAccounts` emits `vault … owns token account … (0 units) that is NOT a canonical reserve ATA`.

**What an accident gains / loses.** The detection itself fires at CRITICAL, which is the control — this is not a missed detection. What is lost is the *amount*: a T22 account holding real value reads as "(0 units)", which invites a human to deprioritize a CRITICAL as rent-only dust. This is the project's own most-repeated shape — a reader hardened for one purpose (refusing T22 on money paths) reused at a second site (enumeration) where the refusal silently discards information.

**Evidence if true.** Create a Token-2022 token account owned by a vault's asset-signer PDA holding 1,000,000 base units; run `node bank/alarm.mjs --reconcile`; the `undeclared_token_account` finding for that address reads "(0 units)". A classic SPL account beside it reports its true amount. Checkable in one run.

**Fix.** In `reconcile()`, read the amount for the T22 leg from the base layout (offset 64, which T22 shares with classic for the first 165 bytes) instead of through `readTokenAccount`, e.g. `amount: account.data?.length >= 72 ? account.data.readBigUInt64LE(64) : 0n`, or add an explicit enumeration reader that does not refuse T22. Add a both-ways arm: a synthetic T22-shaped account with a nonzero amount is reported with that amount.

**Dangerous-state-quiet / routine-state-loud check (the rest of R2).** No new dangerous state read as quiet found. The round-33 false-CRITICAL (clock skew) is repaired and armed. Level findings re-assert by design; one-shots carry the pass time; freezes page once and stand at INFO; `joins_waiting`, the stops, and the wedged-bounds findings are INFO and do not page. The watched-key list, the production value list (21%/51%/3-day, 7-day notice, tighten bounds, 30-day month, 1-hour window, census, PoB root and collection, $CBOB mint and boost ceilings), the five programs' upgrade authority and bytes, and the four third-party programs are all present and asserted.

---

## R3. The layouts (`bank/layout.mjs`)

The assertions are real. `parseRustStruct` is strict (a private, `pub(crate)`, or unreadable line throws rather than dropping a field); the field lists are compared name-and-type against the Rust; every `OFF_*` constant any program pins is scraped and compared against the computed offsets, with an explicit arm that *no scraped constant goes uncompared*; the layout versions and `BOOST_RING` are scraped from the Rust; `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are scraped, evaluated, and held to the fixed lengths less padding. **Round 24 D6 is closed:** the SEEDS comment's assertion now exists — every seed is scraped from its program's `*_SEED` constant and compared, with both-ways arms (a mistyped seed and an undeclared one are each caught). A struct change cannot slip past this without turning the build red.

---

## R4. The money arithmetic (`bank/accrual.mjs` vs MINT)

I traced the four non-obvious cases against the program, not just the formula shapes:

- **`credit`/`ceil_sats`/`available`/`owed_of`/`reweigh`/`join`** — line-for-line equal, including `owed_of`'s carry-before-debt order and `reweigh`'s debt restart at the new weight.
- **Pre-expiry then distribution (crank `preExpires`).** The crank expires due boosts *before* distributing, so on chain the expiry happens at the *old* accumulator and the vault earns this distribution at level weight only. The crank's `owed = pendingScaled(..., acc_old) + level·(acc_new − acc_old)` matches exactly: after `reweigh(c, r, 0)`, `pending = level·acc_new + carry − level·acc_old = owed_at_expiry + level·delta`.
- **Distribution-makes-due then expiry (crank `postExpires`).** The boost was live during the distribution, so the vault earns `level+boost` for it; the crank's `pendingSats({level, debt, boost, carry}, acc_new)` equals the program's post-expiry `pending` because `expire_boost`→`reweigh` preserves owed exactly.
- **Join-then-deliver in one pass.** A pre-joined vault enters at `debt = w·acc_old` (the join precedes the distribution, and `monthly_inline` provably waits during the join batches because `waiting_to_join > 0` until the last one), so its first claim is `w·delta`; the crank's `pendingSats({level, debt: w·acc_old}, acc_new)` matches.

No divergence. The crank expires every due boost before distributing and every boost its own distribution makes due right after; the alarm pages `boosts_stalled` and watches `cbob_mint` and the boost bounds as fixed-forever.

---

## R5. The swap (`bank/swap.mjs`) and the revenue cycle (`bank/revenue.mjs`)

**(a) Oracle math — correct.** `sats = lamports · sol.price · 10^(sol.expo − btc.expo) / (btc.price · 10)`; the exponent is applied to the numerator when non-negative, to the denominator when negative; both divisions floor (conservative); all BigInt until the float `satsPerLamport`, whose ~1e-16 relative error is meaningless against a 100 bps gate. `minSats = expectedSats · 9850 / 10000`, floored, and `minSats ≤ 0` refuses dust.

**(b) Pyth verification — sufficient for the accepted trust.** The account is a derived PDA (shard 0, push-oracle program), must be owned by the receiver, must be Full-verified (tag 1 at byte 40), must carry the expected feed id; offsets (price 73, conf 81, expo 89, publish 93) are proven against real cloned accounts by the fork. Only the receiver program can write the account (owner-write rule), and it writes only from Wormhole-verified messages, so nobody can write a chosen price; a replayed old price is bounded by the 180 s age check against the *chain* clock, and a >30 s future stamp is refused. This is limit 10(a)'s stated trust, not a new hole.

**(c) Deviation filter — right quantities, right direction.** `orcaSpot = (sqrt_price/2⁶⁴)²` is raw cbBTC-per-wSOL, matching `satsPerLamport`'s units; `meteoraSpot = (1 + bin_step/10⁴)^(−active_id)` is the inverse of the X-in-Y price, the correct reversal. The fork proves both against real pool state (SW.0). Float cannot flip a 100 bps gate.

**(d) Minimum out — same floor, right units.** Both venues carry `minSats` (oracle − 150 bps) at byte 16 of the swap data, in cbBTC sats, on the output token. The fork proves a floor 5% above the oracle is refused by each program with nothing moved (SW.1b/SW.4b). Within the 100 bps gate the 150 bps floor never false-refuses an honest pool.

**(e) The judge — complete for the built shape.** It requires the exact seven-instruction sequence: CU limit 400,000 and no price instruction anywhere; both ATA creates with payer=owner=operator and the derived account; one System transfer of exactly `lamportsIn` to the operator's own wSOL ATA; SyncNative of it; the swap naming the pinned pool with the operator's wSOL in (key 3 Orca / key 4 Meteora), cbBTC out (key 5 both), amount, floor, and Orca's exact-input/a_to_b/min-price-limit bytes; one close back to the operator. Extra instructions fail the length check; a second System or ComputeBudget instruction fails the count or position checks; venue accounts it does not pin (vaults, tick/bin arrays, oracle, `host_fee_in`) are validated on chain by the venue program or bounded to the protocol fee (round 32 C14). What it cannot catch — a tampered module in the same tree — is limit 10(c)'s accepted box-owner residue, and the post-swap delta check (`delta < guaranteed` throws) catches a misroute after signing.

**(f) Derivations — fork-proven.** Orca tick arrays (current and two below for a_to_b, `String(start)` seed), the oracle PDA, vaults read from the pool; Meteora bin arrays (active and two above for Y→X, i64-LE index seed), bitmap present-or-program-id, `host_fee_in` as None, event authority, two token programs. An uninitialized or boundary array fails on chain → classified refused → next venue → loud, never a value loss.

**(g) wSOL — closed.** Exact wrap, sync, exact-input swap, close back. A pre-existing balance or a stranger's dust returns to the operator on close (round 31 measured, R33.G4 armed); a frozen account fails the sync → refused → loud; a delegate does not block the owner's close.

**(h) Failure and retry — no double-swap, no false close.** `classifySendFailure` asks the chain: preflight refusal, landed-with-error, and expired-never-landed are refusals (Meteora may be tried); landed-and-succeeded is recorded; anything unsettled keeps the cycle open and loud. `cycleIsOpen` requires both a return and a split; the ledger cannot read a failed cycle as closed, and the alarm holds every row to the chain's sweeps and splits.

**(i) Adversary bound — as disclosed.** The on-chain floor caps extraction at 150 bps under the oracle per swap (10 SOL cap, 6 h cooldown), further only if Pyth itself is off — exactly what the holder guide states. The operator key's worst case (cap × windows until the guardian stops, never more than the PDA holds above the reserve) is unchanged and buyer-facing.

---

## R6. The gates

- **Floors are equality, not lower bounds**, and the selftest's own `FLOOR = 909` equals `DET_FLOOR`; SPEC's stated counts are matched at *every* occurrence per floor, with planted-stale and empty-match arms (including the round-33 "47 launch" repair).
- **No vacuous arm found** in the round-30/31/32/33 additions: the flood-drain arm uses a stub cluster with real newest-first paging; the `detectSweepState` arm carries 19 real boundary values; the extracted-fragment arms execute the alarm's actual code; the router arms run the real router in a throwaway state dir.
- **`build-mainnet.sh`** proves all five artifacts: behavioural key checks for the four initializing programs (mainnet rejects / localnet accepts the test key), byte-identity of the sweep helper against both the localnet build and the `target/deploy` bytes the suite deployed, a dirty-tree refusal, and the pinned Core hash.
- **`cron-install.sh`** arms nothing it should not: `--live` is preserved only from our own tagged, uncommented, job-anchored line (both flag orders armed in the selftest), every money job is `flock -n`-wrapped, the rehearsal tree is refused before any read or write, and the deadman (a non-node watcher) correctly falls outside the flock gate.

---

## The four questions on the accepted limits

1. **Is any limit worse than stated?** No. I specifically re-derived limit 10's round-33 paragraph (the symmetric window, the smallest-seen cooldown, the direct-lookup rule for uncertain sends) and it is *not* worse than stated — the masking case it admits (a thief's sweep followed by an honest one while the alarm is down a full cooldown) is real but requires that outage, and the transaction walk covers it.
2. **Is anything listed as a limit not actually a limit?** No. Limits 6 and 7 remain real (a wedged live holder still stalls a lane; the alarm's `crank_silent`/`royalties_unswept` are the mitigation, not a fix).
3. **Is any discharged item not discharged?** No. Items 51 and 54 are built and measured; the v5 family (1a–24) went with the Bank; 12/17, 14, 19, 30, 31, 33 are each closed by the mechanism named.
4. **Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 remain OPEN AND BLOCKING in SPEC and "not started" in the road table; nothing in the code or the gates treats them as done.

## Other findings

**INFO — the redemption post understates released SOL by the closed accounts' rent.** `bank/redemption-poster.mjs` `releasedFromTx` counts System transfers from the vault PDA (the vault wallet's lamports) and token transfers, but not the sweep helper's `CloseAccount` instructions, which return each emptied reserve account's rent (~1,488,440 lamports on mainnet) to the holder. The post's SOL figure is therefore short by up to ~0.0045 SOL on a three-reserve redemption. Cosmetic, public-post only, no funds affected; against the account's own "never a number that is not real" rule it is a small incompleteness. Fix: sum `closeAccount` instructions whose source is a vault-owned account, or read the vault PDA's pre/post lamport delta.

---

## Given that no human firm will ever see this and the programs will be immutable: what AI audit structurally cannot do

The honest summary of this round is that the code is heavily gated and the gates are real; the residual risk has moved almost entirely into places no reading of this tree can reach. Concretely, before launch:

1. **Run the dress rehearsal with real money at throwaway ids (item 22), because AI never executes.** The named pass/fail items are the point: the crank's live passes at ~2,100-vault scale (paging, rate limits, a transient RPC error on vault 1,900), one full revenue cycle through *each* pool with Orca forced to refuse once, and one forced post-sweep failure walked through the hand recovery to a clean `--audit`. No assertion suite substitutes for a confirmation timeout on a real cluster.
2. **Rebuild the five programs on a second machine by a second person and compare sha256 against `dist/SHA256SUMS`.** `build-mainnet.sh` itself says the compiled constant is not proven to be Gary's key — only reproducibility bridges that. AI reads one tree on one box; it cannot attest to an independent build.
3. **Hold a witnessed `initialize` ceremony with post-write read-back.** The checker validates the JSON, not the signed transaction (round 24 A6). A human must build the four initialize transactions *from* `launch/mainnet-init.json`, sign them, and read every written config value back against the file — including the five values the alarm only judges by bounds or drift (guardian, swap operator, sweep cap, cooldown, SOL reserve).
4. **Test the holder surfaces (item 50) with real wallets.** AI cannot sign with Phantom or Ledger, cannot judge whether the redeem page's warning is comprehensible to a holder about to destroy a nested asset, and cannot run the sweep-at-execution proof with a stranger's deposit landing mid-transaction on the rehearsal deployment.
5. **Measure the human operational loop, which no detector arms.** A timed guardian drill (pull `emergency_stop_sweep` and `emergency_stop_sales` on the rehearsal deployment, measure time-to-stop), and a timed hand-recovery drill of an open revenue cycle. The alarm assumes a human reaches the guardian wallet within one cooldown; that assumption has never been measured.
6. **Stand up an off-box, second-provider watcher.** The ledger, the crontab, the alarm, and both hot keys are one user on one box (limit 10's box-owner residue, item 24 D2(3)); every price, pool, and config read goes through one RPC endpoint (limit 10(b)). No in-tree check can vouch for the tree's own integrity. An independent host reading through an independent provider is the only control for both, and AI cannot provision it.
7. **Decide key custody as a human act.** The $CBOB release wallet (limit 56) and the swap operator key (limit 10) sit on this box; moving them to Gary's wallet or a Squads and deleting the box copies is Gary's call, and no audit — AI or otherwise — can make or enforce it.
8. **Run an adversarial day on the rehearsal and watch the alarm.** A stranger flooding the MINT scan (delay measured against the 2,000-per-pass drain), padding transactions into log truncation (the `log_coverage_gap` review loop exercised by a real human writing the watermark), dusting the revenue PDA below `MIN_SWEEP_LAMPORTS`, and creating Token-2022 accounts for vault PDAs (which would also have caught the LOW above in a live run). AI can reason about each; only a live flood proves the pages arrive and a human can clear them.