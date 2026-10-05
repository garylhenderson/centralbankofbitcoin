# AUDIT REPORT — v6 off-chain pipeline, swap, sweep helper, and gates

---

## R5: THE SWAP (`bank/swap.mjs`, `bank/revenue.mjs`) — never before audited

### FINDING 1 — MEDIUM: `judgeSwapInstructions` does not verify the swap's output account, minimum-out bytes, or direction

**File/function:** `bank/swap.mjs`, `judgeSwapInstructions`

**What is missing:**

The judge verifies: allowed programs, single signer, exactly one swap naming the pinned pool, one SOL transfer to the operator's own wSOL ATA, one close of that ATA. It does **not** verify:

1. That the swap's **output token account** is the operator's own cbBTC ATA (`ata(CBBTC, owner)`). For Orca this is `keys[5]` (ownerCbbtc); for Meteora it is `keys[5]` (user_token_out). A builder bug or a tampered module could redirect the swap output to an arbitrary account and the judge would pass it.

2. That the **minimum-out field** in the swap instruction data equals the oracle-derived `minSats`. The builder writes `u64(minSats)` at byte offset 16 of the swap data. A tampered builder could write `0`, removing the on-chain floor entirely, and the judge would not detect it.

3. The **direction flags** (Orca bytes 40–41: `amount_specified_is_input=1, a_to_b=1`; Meteora's implicit Y→X by account order). A flipped direction would swap cbBTC→SOL instead of SOL→cbBTC.

4. That the **SOL transfer amount** equals `lamportsIn`. The judge checks the destination but not the amount.

5. That no **ComputeBudget priority fee** is set. The judge allows any `ComputeBudgetProgram` instruction. A `setComputeUnitPrice` with a high micro-lamport value multiplied by 400,000 CU could drain a meaningful fraction of the operator's SOL as a priority fee.

**What an attacker or accident gains:** In the threat model where the builder function is buggy or a dependency is compromised, the judge is the last check before the operator key signs. These gaps allow a malformed transaction to be signed. The return-step delta check in `revenue.mjs` would catch a zero-output redirect (delta = 0 → throw), so the immediate theft path is partially bounded. But a redirected output to an attacker-controlled account that already holds cbBTC could produce a non-zero delta that passes. Removing the on-chain floor exposes the swap to sandwich extraction up to the full pool depth.

**Evidence that would exist if I am right:** Construct an Orca instruction list where `keys[5]` of the swap is a random pubkey instead of `ata(CBBTC, owner)`. Call `judgeSwapInstructions`. It returns `[]` (no problems). Similarly, set the minSats bytes at offset 16 to zero; the judge still returns `[]`.

**Fix:** Add to `judgeSwapInstructions`:
- Assert `swaps[0].keys[5].pubkey.equals(ata(CBBTC, owner))` (Orca) or the equivalent Meteora position.
- Read `swaps[0].data.readBigUInt64LE(16)` and assert it equals the expected `minSats` (pass it as a parameter).
- Assert the direction bytes for Orca (`data[40] === 1 && data[41] === 1`).
- Assert the SOL transfer amount equals `lamportsIn`.
- Assert no `ComputeBudgetProgram` instruction sets a unit price (only `setComputeUnitLimit` is allowed).
- Assert the two ATA-creation instructions target the operator's wSOL and cbBTC ATAs respectively.

---

### FINDING 2 — LOW: pre-existing wSOL balance makes the swap transaction fail at the close step

**File/function:** `bank/swap.mjs`, `swapInstructions`; `bank/revenue.mjs`, swap loop

**Mechanism:** The transaction wraps exactly `lamportsIn` SOL into the operator's wSOL ATA, swaps that amount, then closes the wSOL ATA. SPL Token's `CloseAccount` requires the token balance to be zero. If the wSOL ATA already holds wrapped SOL (from a previous failed cycle that wrapped but did not close, or from anyone sending SOL to it), the swap consumes `lamportsIn` but the residual balance prevents the close. The entire transaction reverts atomically, so nothing is lost, but the swap cannot proceed until the residual is manually unwrapped.

**What an attacker gains:** A grief vector: anyone can send a small amount of SOL to the operator's wSOL ATA (a system transfer to the ATA address), wrapping it via `syncNative` is not needed since the ATA already exists. The next swap attempt fails. The cycle stays open and the alarm pages. The operator must manually close or drain the wSOL ATA.

**Evidence:** Send 1 lamport to the operator's wSOL ATA. Attempt a swap. The close instruction fails with "close account has non-zero balance" (or the equivalent SPL error). The transaction reverts.

**Fix:** Before the swap, check the wSOL ATA balance. If non-zero, either (a) unwrap the residual first (transfer lamports out and sync), or (b) skip the close and leave the account open, closing it in a follow-up transaction. Option (b) is simpler and preserves atomicity of the swap itself.

---

### FINDING 3 — LOW: `revenue.mjs` hardcodes cbBTC decimals as `8` in the split instruction

**File/function:** `bank/revenue.mjs`, step 4 (split), line constructing `Buffer.from([8])`

**Mechanism:** The `split_revenue` instruction takes a `decimals` parameter used in the `TransferChecked` CPI. `revenue.mjs` hardcodes `8`. The crank correctly reads the decimals from the mint account (`splitDecimalsByte`). If the payment mint's decimals were ever different from 8 (which they cannot be for the pinned cbBTC, but the asymmetry is a maintenance hazard), the split would fail on-chain.

**Evidence:** Compare `revenue.mjs` line `Buffer.from([8])` with `crank.mjs` line `splitDecimalsByte((await conn.getAccountInfo(payMint, 'confirmed'))?.data?.[44])`.

**Fix:** Read the decimals from the mint account, as the crank does, or at minimum assert that the pinned payment mint's decimals are 8 before using the hardcoded value.

---

### FINDING 4 — INFO: oracle staleness is judged against the box clock, not the chain clock

**File/function:** `bank/swap.mjs`, `oracleFloor`; `bank/revenue.mjs`, `market()`

**Mechanism:** `nowSec` is `Math.floor(Date.now() / 1000)`, the box's wall clock. If the box clock is skewed forward by more than 180 seconds, a genuinely stale oracle would pass the freshness check. If skewed backward, a fresh oracle would be refused (safe direction). The crank already reads the Clock sysvar for its planning (round 24 I2 repair); the swap does not.

**Evidence:** Set the box clock 300 s ahead. Feed a Pyth account with `publishTime = nowSec - 250`. `oracleFloor` accepts it (250 < 180 is false, but `nowSec` is 300 ahead so `nowSec - publishTime` = 50 < 180).

**Fix:** Read the Clock sysvar's `unix_timestamp` (as the crank does) and use it for the staleness check, falling back to the box clock only if the sysvar is unreadable.

---

## R0: ROUND 24 REPAIRS

### FINDING 5 — LOW: `judgeSwapInstructions` selftest does not exercise the missing checks from Finding 1

**File/function:** `bank/selftest.mjs`, the `M1` judge arms; `sim/swap-fork.mjs`, SW.6/SW.6a

**Mechanism:** The selftest arms test: second signer, two swaps, foreign program, no wSOL close, redirected SOL transfer. They do **not** test: redirected swap output account, zeroed minSats, flipped direction, excessive priority fee. The fork test (SW.6a) tests a redirected SOL transfer but not a redirected swap output. So the gaps in Finding 1 are not covered by any assertion.

**Evidence:** Search the selftest for any mutation of `swaps[0].keys[5]` (Orca output account) or `swaps[0].data` at offset 16 (minSats). None exists.

**Fix:** Add arms that mutate the output account, zero the minSats, flip the direction byte, and add a `setComputeUnitPrice` instruction, and assert the judge refuses each.

---

### FINDING 6 — INFO: H1 repair's recovery logic does not cover the crank's `fee_ceiling` stream

**File/function:** `bank/crank.mjs`, `crankNotices` and the fee-ceiling warning path

**Mechanism:** The crank's fee-ceiling warning is sent via `execFileSync(NOTIFY, [...], { stdio: 'ignore' })` with label `cbob-vault-crank:fee_ceiling`. This is a one-shot notification (not a level condition). But `crankNotices` only handles the `full` and `reveal` lanes. The fee-ceiling warning has no RECOVERY path: once sent, the stream stays open until the router's 48-hour expiry. If a fee-ceiling warning fires and then the key is topped up, no RECOVERY is sent for that stream.

**Evidence:** The `crankNotices` function takes `lane` as `'full'` or `'reveal'`. The fee-ceiling warning is sent directly via `execFileSync` with label `CRANK_LABEL + ':fee_ceiling'`, bypassing `crankNotices`. No RECOVERY is ever sent for this label.

**Fix:** Either route the fee-ceiling warning through `crankNotices` (adding a third lane), or accept that it auto-expires after 48 h and document this.

---

## R1: THE CRANK

### FINDING 7 — LOW: crank's projected `acc` for claims may overstate if the distribution is raced

**File/function:** `bank/crank.mjs`, `planCrank`, the claims section

**Mechanism:** The crank projects the post-distribution accumulator (`acc += avail * ACC_SCALE / w`) and plans claims against it. If another distribution lands between the plan and the send (a benign race), the crank's `distribute` is refused as benign, but the claims are still sent with the projected `acc`. The program's `claim` computes the actual owed amount on-chain, so no overpayment occurs. But the crank may send claims that pay zero or less than expected, wasting fees. The `BENIGN` regex does not cover a claim that pays nothing (there is no error; it just pays zero).

**What is lost:** Transaction fees for claims that pay nothing. At 14 vaults per batch and ~5,000 lamports per signature, this is minor.

**Evidence:** Simulate a distribution race: plan a distribute + claims, then advance the epoch before sending. The distribute is refused (benign). The claims are sent but pay zero. No error is raised.

**Fix:** After a benign distribute refusal, skip the claims for that pass (they will be re-planned next pass with the correct `acc`).

---

## R2: THE ALARM

### FINDING 8 — LOW: `detectUnsweptRoyalties` resets its clock on any balance fall, including a partial sweep below the floor

**File/function:** `bank/detectors.mjs`, `detectUnsweptRoyalties`

**Mechanism:** The clock restarts whenever `lamports < prevLamports`. A sweep that moves less than the sweepable excess (e.g., a sweep of 1 SOL when 5 SOL is sweepable) causes the balance to fall, resetting the clock. If sweeps are consistently partial (capped by `max_sweep_lamports`), the clock resets every sweep and `royalties_unswept` never fires, even if the excess has been sitting for days.

The comment says "a working sweep that is merely capped never pages," which is the intended behavior. But if the cap is set very low (e.g., 1 SOL per 6 h) and royalties accrue at 2 SOL per 6 h, the excess grows indefinitely while the clock keeps resetting. The detector would never fire.

**Evidence:** Set `max_sweep_lamports` to 1 SOL, cooldown to 6 h. Accrue 2 SOL per cycle. Each sweep reduces the balance by 1 SOL (a fall), resetting the clock. The excess grows by 1 SOL per cycle. `royalties_unswept` never fires.

**Fix:** Only reset the clock if the balance falls to or below `reserve + floor` (i.e., the sweepable excess is cleared). A partial sweep that leaves excess above the floor should not reset the clock.

---

## R3: THE LAYOUTS

No new findings. The SEEDS assertion (round 24 D6) is now real: it scrapes each `pub const *_SEED` from the Rust source and compares. The cross-program offset assertions are comprehensive. The layout versions are scraped and compared. The SPACE constants are scraped and evaluated.

---

## R4: THE MONEY ARITHMETIC

No divergence found between `bank/accrual.mjs` and the MINT program's `credit`, `owed_of`, `reweigh`, `ceil_sats`, `join`. The BigInt formulas match the Rust checked-arithmetic formulas. The crank's boost expiry ordering (pre-expires before distribute, post-expires after) matches the program's `BoostsExpireFirst` gate.

---

## R6: THE GATES

### FINDING 9 — LOW: `sim/swap-fork.sh` floor is 10 but the fork test has exactly 10 assertions, leaving no room for the judge-gap arms

**File/function:** `sim/swap-fork.sh`, `SWAP_FLOOR=10`

**Mechanism:** The fork test runs 10 assertions (SW.0, SW.1, SW.1a, SW.1b, SW.4, SW.4a, SW.4b, SW.6, SW.6a, SW.6b). The floor is 10. Adding the judge-gap arms from Finding 5 would increase the count, requiring a floor update. This is not a defect per se, but the floor-equality mechanism means any addition requires a simultaneous floor update, which is a place for a mistake.

**Evidence:** Count the `rec(...)` calls in `sim/swap-fork.mjs`: exactly 10.

**Fix:** When adding the Finding 5 arms, update `SWAP_FLOOR` in the same commit.

---

## SWEEP HELPER (`programs/cbob-vault-sweep/src/lib.rs`)

No defects found. The program:
- Refuses any data other than `[0]`.
- Requires the first account to be a signer (the asset-signer PDA, signed by Core in ExecuteV1).
- Verifies each source token account is owned by the signer.
- Verifies each destination is owned by the dest wallet and has the same mint.
- Transfers the full live balance, closes the source, and sweeps all lamports.
- Is stateless and holds no key.

The program correctly does nothing when called directly (not through ExecuteV1), because the caller would need to provide a signer they control, and they can already do anything with their own accounts.

---

## ACCEPTED LIMITS: THE FOUR QUESTIONS

### 1. Is any limit WORSE than stated?

**Limit 10 (swap operator):** The limit states the operator can keep the SOL. With the new swap code, the operator also signs swap transactions. The judge gaps (Finding 1) mean a compromised builder module could produce a transaction the judge passes but that redirects output or removes the floor. The limit's "what remains trusted: the two pool programs and the Pyth price" should also list "the integrity of `bank/swap.mjs` itself." Not worse in terms of on-chain bounds, but the off-chain attack surface is wider than the limit states.

**Limit 55 (unsplit revenue edge):** The limit says "as little as 100 $GARY at the monthly boundary." This is correct: the first distribution can be the free `distribute(false)` or a host's in-line run, and only the second needs a burn. Not worse.

No other limit appears worse than stated.

### 2. Is anything listed as a limit not actually a limit?

**Limit 54 (compute at widest host shapes):** Listed as DISCHARGED. The measurement is real and the arms exist. However, the note says "a charter claim is heavier than a mint" and "one piggybacked capture is NOT safely under the default." The discharge is valid for the crank (which sends captures individually) but the holder-page obligation is correctly deferred to item 50. Not a false discharge.

No item appears falsely discharged.

### 3. Is any DISCHARGED item not actually discharged?

**Item 51 ($CBOB boost):** DISCHARGED. The boost is built, tested (suite section BO), and the crank/alarm mirror it. The buyer's terms (`max_price`, `min_weight`, `min_epochs`) are implemented. The one-sided rule (move in buyer's favour lands at new terms) is stated. Discharge is valid.

**Item 54 (compute):** DISCHARGED. The measurements are cited with specific CU values. The crank is unaffected. The holder-page obligation is in item 50. Valid.

No false discharges found.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**Item 50 (holder surfaces):** The sweep helper is built (`programs/cbob-vault-sweep`), but the redeem page is not. The item correctly states this. The sweep helper is deployed and locked with the other four (road step 9). The item is not being quietly treated as accepted.

**Item 22 (nothing against a live chain):** Still OPEN. Correct.

**Item 38 (initialize values):** Charter opening date and lock deadline are still OPEN. Correct.

No quiet demotions found.

---

## HOLDER-GUIDE ACCURACY

The guide's statements about the swap ("trades only through fixed pools (Orca, with Meteora as the fallback) and refuses any price below a floor taken from Pyth's price feed") are accurate. The guide's statement about the sweep helper ("empty the vault at the very moment the opening runs, inside the same all-or-nothing step") matches the helper's behavior. No new false promises found beyond those already corrected in round 24.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Three things this project should do before launch that AI audit structurally cannot:

**1. Run the swap against the live pools with real funds in the dress rehearsal, and verify the output on-chain.** The fork test clones pool state, but the live pools have different liquidity, different tick distributions, and real MEV. A 1-SOL swap through Orca and a 1-SOL swap through Meteora (forced by temporarily making Orca refuse, e.g., by setting an impossible floor) should be executed with real SOL, and the cbBTC output should be verified against the oracle floor. This tests the actual transaction construction against the live programs, including any IDL drift since the fork was built. The AI can reason about the code but cannot observe whether the live Orca program accepts the exact byte sequence at the current tick distribution.

**2. Have a human verify the Pyth feed IDs against Pyth's published catalogue, independently of this codebase.** The feed IDs (`BTC_USD: e62df...`, `SOL_USD: ef0d8...`) are stated to come from "Pyth's own catalogue (hermes /v2/price_feeds), 2026-10-05." An AI reading this codebase cannot independently verify that these hex strings correspond to the real BTC/USD and SOL/USD feeds on the Pyth hermes API. A human should visit the Pyth hermes endpoint, look up the feed IDs, and confirm they match. A wrong feed ID that happens to be a valid Pyth account for a different feed (e.g., ETH/USD) would produce a plausible-looking but wrong price, and the deviation check might not catch it if the wrong feed's price is within 1% of the correct one at that moment.

**3. Have a human physically verify the operator key's isolation.** The operator key (`bank/keys/swap-operator.json`) is on the same box as the alarm, the ledger, and the crontab. Limit 10 (D2) states this. A human should verify that the key file has mode 600, is owned by the correct user, and that no other process on the box can read it. The AI can check the code that reads the key, but cannot verify the filesystem permissions, the absence of other users with access, or the integrity of the backup that contains the key. The $CBOB release key (`bank/keys/cbob-release.json`) has the same issue at a much larger scale (limit 56). A human should decide whether these keys should be on a separate machine or in a hardware wallet before launch.