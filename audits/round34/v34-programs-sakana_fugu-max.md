# Independent audit — v6 tree at `18dbff6` + round-33 repairs (`82bb3ef`)

**Bottom line first, because it changes how you should read the rest.** I could not substantiate a new CRITICAL, HIGH or MEDIUM defect in the five programs or in the redemption path. Everything I attacked that the prompt names — the open/burn pairing, the account-index binding, the emptiness proof, the sweep helper's access control and pair list, the pool's accumulator and counters, the boost ring, the rolling redemption window, the level draw, governance's reach, every cross-program offset and account space — came back consistent with the code and with the measured runs, and where I could find a real gap it was already written down in ACCEPTED LIMITS. I am reporting that as a result, not as a courtesy, and I am naming below exactly what I checked so you can decide whether my check was worth anything. The LOW/INFO items that follow are what survives; two of them are suite-evidence defects, which is the class this project keeps finding in its own repairs.

---

## R0 — Round 33's verdict and its repairs

**The prior pass was NOT clean (1 LOW, 3 INFO; quorum 7/8). I verified each repair at its site, not from the verdict's summary.**

| Round-33 finding | Verified in this tree |
|---|---|
| **L1** (a stranger pre-funds a public program id; `solana program deploy` refuses) | Present. SPEC road step 9 now says to read all five ids immediately before deploying and, if one holds lamports, to use the measured Allocate/Assign/write-buffer/`DeployWithMaxDataLen` path, and to rehearse it at a throwaway id. The text correctly states "any rent-exempt amount, at least 890,880 lamports" and flags the top-up case as reasoned, not measured. |
| **D1** (SPEC REDEEMING step 1 said a 3-asset redemption "does not fit") | Repaired. Step 1 now reads as limit 42 does: the padded page shape does not fit (1,367), the narrow owner-payer helper shape serializes to 1,219 and is an offline measurement, and missing reserve accounts are a separate reason. |
| **D2** (DESIGN said `MIN_ROUND_PRICE_SATS` was "fixed at `initialize`") | Repaired. DESIGN now reads "a constant compiled into the program (no `initialize` argument sets it)". |
| **D3** (suite arm 2.1 could not fail) | Repaired. `tests/3prog.test.ts` now records `vMint.ok?'ALLOW':'REJECT'` against `'ALLOW'`. |
| **Gate-5 pins W1a / W1b / W2** | Present as R33.G1, R33.G2a/G2b, R33.G3, plus R33.G4; on-chain floor 861 → 866. |

**No regression from the repairs.** The four repairs touch SPEC, DESIGN, the suite and the runbook; `programs/` is unchanged by them, so the on-chain semantics are identical to what round 32 certified. I re-derived the round-33 claim that the many-signer autograph shape does not stall the FIFO, from the code: `reveal_level` re-supplies `attributes` and hashes them against `r.attrs_hash`, which was computed at mint over the *stored* list; a growing Autograph is a Core-side plugin, not part of `attrs_hash`, so it cannot change what the reveal has to carry. That is consistent with W1(b) landing.

---

## R1 / R1s — custody, and the sweep helper

**I attacked this hardest and found no escape.** Specifically:

- **Pairing.** `open_for_redemption` scans *forward* for a top-level `burn_vault` matching asset **and** owner at indices 0 and 2; `burn_vault` scans *backward* for a top-level `open_for_redemption` matching the same pair. Both use `load_instruction_at_checked`, which sees top-level instructions only. I traced the four borrow shapes: open(A)/burn(B), open(A)/open(B)/burn(B)/burn(A), wrapped-open + real-burn, real-open + wrapped-burn. Each fails on one half or the other, and the failure is a revert, so the thaw reverts with it. The suite's 3.9, 3.10, 4.10, 4.10a and WR.1–WR.4 pin all of them, and `retire_redeemed` adds a third independent gate (stack height == 2 **and** the current top-level instruction is BURN's `burn_vault` **for this asset**). The one asymmetry I found — `retire_redeemed` binds only the asset, not the owner — is harmless because BURN has already bound the owner before it CPIs.
- **Emptiness proof.** The reserve loop requires both token-program derivations of each reserve mint to be *declared*, and skips an account no token program owns; the second loop re-checks any declared 165-byte account the PDA owns, with the same six comparisons the reserve loop uses. A canonical reserve ATA that does not exist is skipped (system-owned), so declaring a phantom address is legal — which is what makes the page's "declare all six" contract workable. I could not find an account a stranger can create for a vault that the sweep cannot name **and** BURN will not skip, beyond what limit 44 already states: a Token-2022 ATA for a classic mint cannot be created (F4.2, measured); a classic non-ATA account *can* be named by the helper and is listed by `detectUndeclaredTokenAccounts`; a Token-2022 account is genuinely outside the helper and is destroyed undeclared — item 44, verbatim.
- **The helper's access control.** Its whole gate is Core's `ExecuteV1` rule on a *thawed* vault. Directly it needs the asset-signer's signature (SR.1). Through Core, the owner is the only approver on this pinned binary (SR.5, SR.5a, SR.5c, SR.5d), and the one route that can approve a third party (AgentIdentity) cannot be added by an owner (R24.1a/R24.1c, measured). Its pair checks refuse a source it does not own, a destination not owned by the named wallet, a mismatched mint, an odd count, and a self-sweep; duplicates die on the second `read_token` of the closed account (SR.12a/SR.12b).
- **The lamport sweep.** `signer.lamports()` is read *after* the pair loop and transferred whole; nothing inside the helper re-credits it, and Core's `BurnV1` provably does not sweep the PDA (proven impossibility 4). SR.4a's exact delta identity (deposit + pre-balance + released rent + the asset's rent delta − fee) is the right way to test this and it holds.
- **(f) The packet.** S8.0's check is `B ≤ 1232 − 52 − 96`, i.e. ≤ 1,084, and it already includes the three reserve pairs, the six reserve derivations, the pool account inside the burn, and the claim. A fourth reserve is impossible (`MAX_RESERVE_MINTS = 3` in both SEAL and BURN, asserted). The in-line monthly run adds no accounts — it reads the pool account BURN already carries. **The measurement is honest and a real page adds nothing S8.0 omitted.**
- **(g) Evidence.** The helper is deployed from `target/deploy/cbob_vault_sweep.so`, and `build-mainnet.sh` `cmp`s `dist/` against both `$CACHE/ln/...` and `target/deploy/...`; the crate has no `localnet` feature, so all three are the same bytes. **Yes, the suite runs the bytes the build proves.**

---

## R2 / R2b — the pool and the boost

I re-derived the invariant **`pool_balance ≥ ceil(owed_scaled)`** from the code rather than from P.32: `distribute` computes `avail = balance − ceil(owed)` and `credit` adds `delta·w = floor(avail·1e12/w)·w ≤ avail·1e12` to `owed_scaled`, so `ceil(owed_new) ≤ ceil(owed_old) + avail ≤ balance`. Every path that *decreases* `owed_scaled` (`retire`, `retire_burned`, the frozen-pool forfeit, `claim`'s `settled`) decreases it by exactly what the vault's own `owed_of` was, and `reweigh` preserves `owed_of` across a weight change by moving it into `carry`. I found no ordering of `credit`/`claim`/`join`/`retire`/`expire_boost` that breaks it.

The counters are consistent under every ordering I could construct: `pending_this_epoch` is incremented only in `activate`'s request (alongside `pending_count`), reset only in `advance_epoch`, and decremented in `retire` only when `request_epoch == dist_epoch` — so `waiting_to_join = pending_count − pending_this_epoch` never underflows and never over-counts. `total_active_weight`/`active_count` move only in `join` and `retire`, each guarded by a flag that makes a double-application impossible.

The boost ring is right, and the reason it is right is worth stating because the comment next to it is wrong: the ring is a **count** per slot, so two boosts ending in the same epoch share a slot and are both counted. The bound that matters is `max_boost_epochs ≤ BOOST_RING − 1 = 63`, which is what `initialize` enforces, because `end = dist_epoch + N` and `advance_epoch` reads slot `dist_epoch % 64` *after* incrementing. The host test over 260 epochs (four wraps) is the right instrument and it exercises the branches that matter. **The comment "a boost may last at most `BOOST_RING - 1` distributions, so two live end epochs never share a slot" is false as written** — they do share, and the count is what handles it.

---

## R3 — the level draw

The SlotHashes parse is defensive and correct for the real layout (`u64 count`, then `(u64 slot, [u8;32])`), refuses a declared count above 512, refuses a truncated buffer, refuses an all-zero hash, and refuses a forged account key. `try_capture` is deterministic given which slots the chain produced; the window arithmetic (`A ≤ R+64`, `C ≲ R+208`, window 300, buffer 512) closes. The FIFO is strict (`index == revealed_total`) and a burned head still takes a draw, so the queue cannot stall on a burned vault. The attribute re-supply is hash-checked, and the check is correctly *skipped* for a burned vault (nothing is written to Core then, so skipping it is safe).

**Is it worse than "C's leader CHOOSES among many draws"?** No — and I want to be explicit that I looked for a *deterministic* manipulation and did not find one. `reveal_level` computes the level from the census *at reveal time*, but the FIFO forces the census at vault #k to be determined entirely by vaults #0..#k−1, so delaying a reveal changes nothing. `reschedule_reveal` is permissionless and lets the caller pick the new `reveal_slot`, which is the same lever limit 26 already names ("a validator can time a mint (or a reschedule) to put C inside its own rotation"). The cohort effect is as SPEC 26 states it. I did not find anything the limit omits.

---

## R4 — governance

Every reach-limit holds: `CharterNotClosed`, `VaultTooNew` against `index_snapshot`, `TurnoutTooLow`, `KeyChangeNeedsHalf`, `KeyChangesBundled`, `Loosening`, `TightenOutOfBounds`, and the notice gates. The "at the ruled numbers the 10% turnout never binds" claim is arithmetic and correct (`0.51 × 0.21 = 0.1071 > 0.10`). The per-kind ordering marks are set *before* the over-check, so an overtaken round still supersedes older ones. `p.executed = true` is set before the CPIs and reverts with them.

The one thing worth stating plainly, because it is a consequence rather than a defect: `quorum_supply` can be as low as 1 (a single live vault), at which point one vault passes any ordinary proposal. That is inherent to "quorum is a share of live supply" and is the same fact DESIGN §10 already quantifies at the concentration end; it is not a bypass.

---

## R5 — the charter claim

Identity by address against the Merkle root is sound, and the Rust and JS hash schemes agree byte for byte (`0x00` leaf / `0x01` node, sorted pairs, odd node promoted — I recomputed both implementations line by line). The window is a clock comparison with no flag. `pob_extra` accounts are passed through never as signers, which is exactly the property that lets a benign Oracle hook pass and cannot let a hostile one be *made* to pass. What remains is limit 46 as written, including the round-22 and round-25 additions.

---

## R6 — the one-time configuration and the trusted hop

I checked every `initialize` bound against `launch/mainnet-init.json` and every ruled value satisfies its bound (`sol_reserve` 50,000,000 ≥ 890,880; `reserve_ceiling` 100,000,000 in [890,880, 10e9]; `sweep_floor` 1e9 ≤ `max_sweep` 1e10; `cooldown_ceiling` 86,400 ≥ `sweep_cooldown` 21,600 and ≤ 604,800; caps sum 2,100 = `max_supply`; `max_boost_epochs` 24 ≤ 63; the GOV numbers). The 10% royalty is a `PluginAuthority::None` plugin, and R.6/R.6a/R.33.G3 pin update, removal and re-delegation as Core refusals with controls. The redemption cap is exactly a ring of 64 timestamps compared against the cap-th most recent — not a bucket, not an hourly counter.

**The sweep helper has no `initialize` and no key**, and `build-mainnet.sh` proves its mainnet bytes are the tested bytes. It is the one program where "wrong-but-accepted value" cannot arise.

---

## R7 — cross-program raw reads

I recomputed all of them from the struct definitions. `MintConfig`: `collection` 9, `governance` 41, `pool_ata` 73, `minted_total` 141, `bank_treasury` 157, `sales_stopped` 191, `sweep_stopped` 192, `guardian` 193, `swap_operator` 225, `sol_reserve` 257, `max_sweep` 266, `cooldown` 274, `last_sweep` 282, `charter_closes_at` 442, `charter_claimed` 450, `bare_burns_retired` 454, `sales_stopped_at` 518, `sweep_stopped_at` 526, `pending_swap_operator` 534, `monthly_secs` 574, `pending_guardian` 582, `notice_secs` 623, `sweep_floor` 631, `cooldown_ceiling` 639, `reserve_ceiling` 647, `dist_epoch` 655, `pending_count` 663, `pending_this_epoch` 671, `cbob_mint` 679, `max_boost_weight` 711, `max_boost_epochs` 712, `boost_price` 714. `VaultRecord`: `asset` 9, `mint_index` 41, `reveal_slot` 49, `level` 57, `charter` 58, `entropy_set` 59, `entropy` 60, `attrs_hash` 92, `bump` 124, `active` 125, `retired` 126, `reschedules` 127, `vault_ata` 129, `debt_scaled` 161, `pending` 177, `request_epoch` 178, `boost_weight` 186, `boost_end_epoch` 187, `carry_scaled` 195. `BurnConfig`: `burned_total` 42, `redeem_window_secs` 50, `rate_head` 58, `rate_ring` 59. SEAL: `collection` 9, `reserves` 41. **Every offset the programs pin is correct, and every account space is exact**: `MINT_CONFIG_SPACE` 1,261, `VAULT_RECORD_SPACE` 221, `BurnConfig` 827, SEAL 398, GOV 350. `GOV.ACTION_MAX_BYTES = 37` is the true maximum (`Brakes` with `Some(Pubkey)`), and `ACTIONS_SPACE = 4 + 5×37 = 189` exactly bounds a 5-action Borsh vector.

---

## R8 — the suite, the simulation, the build

I read the whole suite for arms that cannot fail. Round 33's D3 was the real one and it is repaired. **Two arms remain that can pass vacuously, both because they compare a source-derived string against another source-derived string:**

- `9.16` — `rec('9.16', …, capInSeal, capInBurn)` where both come from `idx(src,'MAX_RESERVE_MINTS')`, which returns `'NOT FOUND'` when absent. If the constant were renamed in both programs, both sides read `'NOT FOUND'` and the arm passes. (Sibling arm `9.15` pins the literal `'3'`, so a rename is still caught — the vacuity is masked, not absent.)
- `3c.M1` — MINT's `RENT_EXEMPT_0_BYTES` literal vs GOV's, both via regex with a `?? '…NOT FOUND'` fallback. A rename in both files passes. Nothing else in the suite reads GOV's copy of that constant.

Everything else I probed for a trivial pass (P.0e, P.0f, X.3, X.4/X.5, L.12/L.12a, L.23/L.23a, P.11a, P.30, 10.2a, 10.6a/10.6b, R33.G1/G2a/G2b, ID.1) has a literal on one side or a shape check that fails when the subject disappears.

**Claims in the prompt that no arm exercises** (all already named in ACCEPTED LIMITS A10, restated so the list is complete): a lamports-only sweep to a destination that does not exist; `pob_extra = 8`; a 30-record `expire_boosts`; a native-wSOL source; a valid non-ATA destination.

---

## Findings

### LOW-1 — the reserved attribute keys are reserved only in exact case

**Construct.** `programs/cbob-vault-mint/src/lib.rs`, `check_attributes`: `require!(a.key != ATTR_REDEMPTION && a.key != ATTR_LEVEL && a.key != ATTR_CHARTER, MintError::ReservedAttribute)` where the constants are the literals `"redemption"`, `"level"`, `"charter"`. Core attribute keys are case-sensitive strings, and the duplicate check is `b.key == a.key`, also exact.

**What an attacker gains.** A minter can mint a vault carrying a caller attribute `Level` (or `Charter`, or `Redemption`) alongside the program's `level`. After `reveal_level` the vault's Core attribute list contains **both** `level: I` and `Level: V`. Anything that displays the vault's level and is case-insensitive, or that picks the first matching key, can be made to show the wrong level. The buyer-facing consequence is a vault advertised at a level it does not hold. No money decision reads attributes — `activate`/`claim`/`retire` read `VaultRecord.level`, and `write_record`/`reveal_level` hash the full list so nothing can be altered after mint — so this is provenance and display, not funds.

**Evidence that would exist if I am right.** Mint a vault with `attributes = [["Level","V"]]` and confirm it lands; after `reveal_level` with the same list, `fetchAsset(...).attributes.attributeList` contains two entries whose keys differ only in case. If instead the mint is refused `ReservedAttribute`, I am wrong.

**Fix.** Compare case-insensitively (or reserve the known variants) in `check_attributes`, in both `mint_vault` and `claim_charter_vault`. This is a program change and therefore a pre-lock decision, not a repair.

### INFO-1 — two suite arms can pass vacuously

**Construct.** `tests/3prog.test.ts` arms `9.16` and `3c.M1`, as above.

**What an attacker gains.** Nothing directly; the cost is a gate that reports agreement it did not measure. `9.16`'s failure mode is masked by `9.15`; `3c.M1`'s is not masked by anything.

**Evidence.** Rename `RENT_EXEMPT_0_BYTES` in both MINT and GOV to `RENT_FLOOR_0_BYTES` and run the suite: `3c.M1` stays green while the property it claims to check is no longer being read.

**Fix.** Put a literal on one side of each comparison, as `9.15` already does.

### INFO-2 — `MINT.seal_reserves` hardcodes the bound that SEAL and BURN share

**Construct.** `programs/cbob-vault-mint/src/lib.rs`, `seal_reserves`: `require!(n <= 3 && d.len() >= OFF_RESERVES + 4 + n * 32, …)`, where `3` is a literal while SEAL and BURN each define `MAX_RESERVE_MINTS: usize = 3` and the suite pins `9.15`/`9.16` between *those two*.

**What an attacker gains.** Nothing today. The exposure is a future divergence: MINT would not notice if SEAL's constant changed, and the cross-check that exists for the other two does not cover this reader.

**Evidence.** Change SEAL's `MAX_RESERVE_MINTS` to 2 and MINT's literal stays 3; `9.16` compares SEAL's constant to BURN's and would catch the SEAL/BURN pair, but nothing compares either to MINT's literal.

**Fix.** Name the constant in MINT (or add an arm that extracts it).

### INFO-3 — `distribute` reports a vault-account error for a missing pool

**Construct.** `programs/cbob-vault-mint/src/lib.rs`, `distribute`: `read_token(&ctx.accounts.pool_token, &ctx.accounts.config.payment_mint, &pool_owner)?` returns `MintError::VaultAccountMissing` ("the vault's cbBTC account is missing or not a token account") when the **pool** account is absent or not a token account. This is the same class as round 33's A16 (`expire_boosts` reporting `BadClaimList`, whose message describes `claim`).

**What an attacker gains.** Nothing; the refusal is correct and happens before anything moves. The cost is diagnostic: the operator sees a vault-account message for a pool problem, and SPEC's "Shared error-code diagnostics" section names the other two ambiguities of this shape but not this one.

**Evidence.** Call `distribute(false)` on a validator where the pool ATA has not been created and read the error.

**Fix.** Either a distinct error variant or a sentence in the diagnostics section.

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?** I could not make any of them worse than written.

- **26** is stated as "CHOOSE AMONG MANY DRAWS", with the best-of-4 and the 64-try figure, the cohort effect, and the public-schedule timing of a mint *or a reschedule*. I looked for a deterministic variant (delay-to-see-the-census, jump-the-queue, choose-your-own-reschedule) and found none: the FIFO plus the reveal-time census makes the draw a pure function of the entropy sequence, and the reschedule lever is already named.
- **25** is stated as "one re-roll per full window of total silence; repeated silences are repeated rolls", with the round-22 correction that capture accounts on host instructions are optional and the round-25 measurement that one hanging RPC socket lapses windows in a burst. I could not find a lever for a minter to *force* silence beyond what is written.
- **44/9** are stated as destroying what the burn is not shown. I confirmed the T22 gap is real and uncloseable by the helper (it reads only 165-byte classic accounts), and that a stranger can create a classic non-ATA account for the vault — which the helper *can* name, so it is a rescue rather than a loss. Nothing here is worse than "destroyed undeclared, rescuable if classic".
- **47** and **46** are stated with the low-turnout permanence and the full capture/denial consequence. I found nothing they omit that is reachable.
- **32** is stated with the "cap can read one higher than true live supply" consequence. Correct.

**2. Is anything listed as a limit not actually a limit, or already closed by something the author did not notice?** Two items are narrower than their own text because a *later* mechanism closes them, and neither text says so:

- **Limit 27** ("a claim between a bare burn and its retirement pays into a dead account, and a join adds dead weight"). The join half is now closed by construction for any vault the crank touches, and — more importantly — `claim`'s pending path requires `dest == r.vault_ata` and then joins; a bare-burned *waiting* vault's ATA still exists, so it can still be joined. The limit stands. But the *paid-into-a-dead-account* half is bounded to "until anyone calls `retire_burned`", and `retire_burned` is permissionless and needs only the asset — so any holder can close another holder's exposure for the cost of a fee. The text says "the crank never pays or joins a positively burned vault and retires it first, every pass" and does not say that a third party can do it too, at will. That is a strengthening, not a defect; it is worth a clause because it changes who bears the wait.
- **Limit 28** ("a frozen POOL stops every claim that pays"). Since stage 3c the redemption path no longer depends on `claim` at all — it forfeits. So the limit's real content is now only "payouts stop; credited-but-undelivered shares are forfeited on redemption", which the text does say. Fine, but the older sentence "a frozen pool stops every claim that pays" reads as if it still blocks opening; the holder guide has the correct version.

**3. Is any DISCHARGED item not actually discharged?** No. I spot-checked the ones with the most room to hide: **14** (duplicate attribute keys) is enforced in `check_attributes` and asserted at 11.4; **19** (the unlevelled-vault halt) is closed by construction — `activate` requires `(1..=5).contains(&r.level)` and `weight_of` re-checks, so there is no activated-but-unlevelled state; **30/31/33** are genuinely gone with `update_wiring`, the cadence and the constant notice.

**4. Is anything in OPEN AND BLOCKING being quietly treated as accepted?** **22, 38, 50, 52 and 53 are all still treated as open in the documents I was given** — the SPEC's road table marks steps 8, 9, 10 and 11 "not started", `launch/mainnet-init.json` still has `charter_opens_at: null` and `lock_deadline: null`, and item 50's text says the page is unbuilt and is a precondition of step 11. I found no place where one of them has been demoted. One thing to watch: **item 53's proof is stale and the prompt's own framing does not flag it** — the rehearsal-tree proof is of `d57ee3a`, and the round-33 validation records a *refreshed worktree at `82bb3ef`* with 56 patched files and an exact reverse proof, but explicitly says "Nothing was built, deployed or sent at the throwaway IDs." So the rehearsal has been *prepared*, not *run*, at the release commit. That is consistent with 53 staying open; it should not be read as progress toward closing it.

---

## What this project must do before launch that AI audit structurally cannot

Concretely, in the order the lock makes them irreversible:

1. **A reproducible build from a pinned toolchain, verified by a second, independent rebuild.** `build-mainnet.sh`'s own closing banner says the compiled `INIT_AUTHORITY` constant is **NOT PROVEN** — it proves the mainnet artifact rejects the test key and that the *source* names Gary's wallet. That gap is real and no audit can close it. Rebuild from the release commit on a second machine, compare all five sha256 values, and record both manifests. Everything else in the ship gate rests on "these bytes are these bytes".
2. **Read back all four `initialize` transactions from the chain against `launch/mainnet-init.json`, field by field, and diff them.** The programs check less than `check-launch-params.mjs` does (item 38, round 24 A6), the JSON is not the transaction, and a wrong value is permanent. This is the one check that catches a builder that did not use the file.
3. **The dress rehearsal at the release commit, not at `d57ee3a`.** Item 22's five named items, plus the round-33 L1 pre-funded-program-id recovery rehearsed at a throwaway id — **including the case the documents mark "reasoned, not yet measured": exactly 890,880 lamports of dust, which needs the top-up to the 36-byte rent-exempt minimum before Allocate.** No audit produces a landed transaction; only the rehearsal does.
4. **The redeem page, built and audited, before the lock.** Item 50 is a precondition of step 11, and it is the *only* preventive control for items 9 and 44 now that the Bank is gone. It must run `judgeRedemptionCoverage` before the holder signs, prepare missing reserve accounts in a prior transaction, sweep through the helper, and set the compute-unit limit on anything carrying a crank.
5. **One full live revenue cycle through each pool and one forced post-sweep failure recovered by hand** (item 22, round 25 L5). `bank/revenue.mjs`'s sweep, venue loop, return, split and ledger run in no gate at all; its selftest reads its own source.
6. **A key ceremony, on hardware, for `initialize` and for the upgrade-authority removal, with the guardian/`INIT_AUTHORITY` identity stated aloud.** Limit 47's operational note says the guardian wallet is also `INIT_AUTHORITY`; the two roles are the same key and both are hot-adjacent. Do the initialize, verify, and remove the authority in one sitting, and set `lock_deadline` before `charter_opens_at`.
7. **Verify the lock on chain afterwards** — five `program show` reads with no upgrade authority — and record them. "Immutable" is a claim about account state, and the alarm that watches it is off-chain and on the same box as the ledger.
8. **Move the two hot custodial keys or write down that you did not.** Limit 56 (all 2,100,000,000 $CBOB in `bank/keys/cbob-release.json`, in the nightly backup) and limit 10 (the swap operator) are the two places where a file on this box is worth money after the lock, and neither is closable by code. If they stay, say so in the holder guide in the same words the SPEC uses.

What AI audit structurally cannot do is any of items 1–4: produce a reproducible artifact, read a signed transaction back off mainnet, land a transaction on a rehearsal deployment, or run a page in a browser. It also cannot weigh the business concentration in DESIGN §10 or the value of the surfaces in item 50 — those are judgment calls on facts an audit can only restate.