## R1. The crank

### MEDIUM — A frozen revenue cbBTC account can make the crank send a distribution the program will refuse

**Construct:** `bank/crank.mjs`, `main()` and `planCrank()`.

The revenue ATA is read with `readTokenAccount()`, but unlike the pool and vault accounts, its SPL state byte is never read. `planCrank()` therefore treats a frozen revenue ATA with a positive balance as splittable, adds 85% of that balance to its predicted pool balance, and may plan both `split_revenue` and `distribute`.

If the revenue ATA is frozen and the pool has no undistributed balance, `split_revenue` fails at the token transfer. The crank then continues to its planned `distribute`, which has no new pool funds and is refused with `NothingToDistribute`. This spends fees on a plan the program cannot complete. The alarm also misses the *zero-balance* version of this state; see the shared evidence below.

**Evidence to check:** On a validator, freeze the revenue ATA, leave its balance positive, and pass its read to `planCrank()` with an empty pool and a due period. It should plan both actions. Sending them should produce a token-program frozen-account failure followed by `NothingToDistribute`.

**Fix:** Read and pass the revenue ATA’s frozen state. Do not count frozen revenue toward `splitToPool` or plan the split; report it explicitly. Add an alarm for a frozen revenue ATA even when its balance is zero.

No additional crank defect was established here in the normal positively-burned case: the planner excludes assets it positively identifies as burned and schedules retirement before payout work. The separately described direct-`claim` dead-weight edge remains accepted limit 27.

## R2. The alarm

### MEDIUM — A frozen, empty revenue ATA reads as quiet

**Construct:** `bank/alarm.mjs`, revenue ATA read in `main()`; `bank/detectors.mjs`, `detectUnsplitRevenue()`.

The alarm reads the revenue token amount but does not inspect its frozen state. It calls `detectUnsplitRevenue()` only when the account is readable and has a positive amount. If Coinbase freezes the revenue ATA while its balance is zero, the alarm emits no finding. Yet subsequent cbBTC transfers into that ATA—including mint payments and swap returns—will fail while it remains frozen.

This is distinct from the accepted frozen-pool limitation: it is an unreported frozen *revenue* account, and it can prevent new revenue from reaching the pool at all.

**Evidence to check:** Freeze an empty revenue ATA on a validator and run the same read/detector path. The result should contain no revenue finding, while a transfer into the ATA should fail with the token program’s frozen-account error.

**Fix:** Add a revenue-account health detector that pages on frozen state regardless of balance. Use the same state read in the crank so it does not plan an impossible split.

I found no separate routine-state paging defect in the supplied detector code that I can substantiate.

## R3. The layouts

### LOW — The layout gates do not resolve symbolic Rust array sizes

**Construct:** `bank/layout.mjs`, `FIXED`, `fixedLength()`, and `parseRustStruct()`; `bank/selftest.mjs`, Rust/layout parity assertions.

`VaultRecord`/`MintConfig` parity is checked by comparing parsed field names and type strings. For the MintConfig boost ring, Rust declares `[u32; BOOST_RING]`, while JavaScript hardcodes that symbolic type to 256 bytes. The parser compares the literal string, not the value of Rust’s `BOOST_RING` constant. The tests round-trip JavaScript’s own assumed 64-element encoding; they do not assert that the Rust constant is 64.

A future Rust edit changing `BOOST_RING` while leaving the field declaration unchanged could therefore pass the struct comparison while the off-chain decoder continues to assume 64 entries. The current supplied Rust value is 64, so I am **not** claiming a present offset mismatch.

**Evidence to check:** Change only Rust’s `BOOST_RING` from 64 to 32. The current textual struct comparison still sees `[u32; BOOST_RING]`; verify whether the layout selftest fails. If it does not, the gate permits the mismatch.

**Fix:** Parse and compare constants used in symbolic field types, or make both the Rust array length and the layout’s fixed size explicit numeric values that are mechanically compared. Also bind the operational constants relied on by off-chain code—such as `REVEAL_LEAD_SLOTS` and `MAX_CRANK`—to the Rust values, not only selected constants.

For the supplied current declarations, I found no concrete present cross-program offset discrepancy in the shown layout checks.

## R4. Money arithmetic

I found **no concrete divergence** between the supplied `bank/accrual.mjs` formulas and the shown MINT formulas for `credit`, `owed_of`, `reweigh`, `ceil_sats`, or `join`. The crank’s boost expiry calculations are consistent with the shown carry/debt arithmetic.

However, `accrual.mjs` does not itself implement or mirror `retire` or `join`; the crank plans those operations separately. Its selftest’s selected examples are not a general proof of parity with Rust. This is a parity-test limitation, not a demonstrated payout mismatch.

I cannot assess the other three program implementations’ arithmetic from this prompt: their source files are not included.

## R4b. Boosts and $CBOB

### MEDIUM — MINT does not enforce the $CBOB mint’s fixed-supply authority properties

**Construct:** `programs/cbob-vault-mint/src/lib.rs`, `initialize()`; `scripts/check-launch-params.mjs`, `judgeLaunch()`.

MINT checks that the supplied `$CBOB` mint is classic SPL, 82 bytes, initialized, and not cbBTC or $GARY. It does **not** check that the mint authority is revoked, that the freeze authority is absent, that decimals are six, or that supply is the ruled fixed supply. The launch checker validates that `cbob_mint` is a plausible public key but does not read that mint account or bind the value to a verified creation record.

The provided `create-cbob-token.mjs` builds the mint, mints the full supply, sets no freeze authority, revokes mint authority, and does all of that in one transaction. That transaction is atomic: its own instruction sequence cannot leave a partially minted successful result. But MINT’s one-time initializer can still accept a different initialized classic SPL mint with live authorities or the wrong supply if the launch value is entered or the prescribed creation path is bypassed.

**Evidence to check:** Create a classic SPL mint with a live mint authority (and/or freeze authority), initialized state, and a distinct address. Pass it to `initialize()` with otherwise valid arguments. The shown MINT checks permit it. The launch checker should also be tested with that mint address; it currently has no on-chain mint read to reject it.

**Fix:** At minimum, have the launch gate read and validate the actual mint account and compare its authorities, decimals, and supply to the ruling before any `initialize` is signed. Preferably, MINT’s `initialize` should enforce the immutable properties it can verify itself, including absent mint/freeze authorities, expected decimals, and exact supply.

The crank’s due-boost expiry ordering and `pendingScaled()` formula match the shown MINT `owed_of`/expiry mechanics. I cannot independently verify GOV’s boost proposal checks because its source was not supplied.

## R5. The swap hop

### HIGH — The crank/revenue transaction signer will sign unvalidated instructions returned by Jupiter

**Construct:** `bank/revenue.mjs`, the validation block immediately before `vtx.sign([operator])`.

The script checks that the versioned transaction has exactly one signer (the operator), excludes the BPF upgradeable loader and MINT from `staticAccountKeys`, and limits the number of address-table lookups. It does **not** inspect the compiled instructions or their accounts. In particular, it does not reject a System Program transfer from the operator to an arbitrary recipient, an SPL transfer from the operator’s token accounts, or instructions whose program/account addresses are supplied through an address lookup table.

A substituted or compromised `/swap` response can therefore return a transaction containing a valid swap plus an extra transfer signed by the operator. The script will sign it. That can move the swept SOL onward or drain other SOL/cbBTC already held by the operator. This is beyond the script’s claimed “look at it before signing” check; it is not the on-chain sweep destination changing, but it is value leaving the trusted off-chain hop.

**Evidence to check:** Construct a v0 transaction with the operator as its sole signer, a System Program transfer from the operator to an attacker-controlled key, and no MINT or loader program in the static keys. Include it in a mock swap response. The current checks should accept it for signing. Repeat with relevant addresses resolved through an address lookup table.

**Fix:** Validate the full compiled message, including resolved lookup-table addresses, against a deliberate instruction/program/account policy; do not treat signer count and a short forbidden-key list as transaction validation. Bound outgoing token and SOL balances as well. A fresh, isolated per-cycle wallet can reduce exposure but does not replace validation.

The on-chain cap and cooldown limit what can be swept from the revenue PDA. They do **not** limit what an accepted malicious swap transaction can then move from the operator wallet.

## R6. The gates

### MEDIUM — The live-mainnet probe can be skipped while `run-tests.sh` exits successfully

**Construct:** `scripts/run-tests.sh`, DNS conditional around `scripts/probe-mainnet-facts.mjs`.

If DNS lookup for `api.mainnet-beta.solana.com` fails, the runner prints `SKIPPED` and continues successfully. The `MAINNET_FLOOR` is enforced only in the other branch. Thus the named live-mainnet assertions are not a mandatory gate: a run can be green without executing them.

This is especially important because the probe covers facts that the local validator cannot establish. A loud skip message is useful to an operator, but it does not prevent a successful test exit or prove that the launch artifact was tested against those facts.

**Evidence to check:** Run with DNS blocked or with the DNS lookup forced to fail. Confirm that `run-tests.sh` exits zero without reporting `MAINNET_FLOOR` assertions.

**Fix:** Make the mainnet probe mandatory for the ship gate, independently of ordinary local test runs. Have the launch gate require a recorded successful probe against the intended mainnet state/artifact; do not let “DNS unavailable” satisfy that gate.

## Accepted limits and blocking items

1. **Is a limit worse than stated?** Yes. Limit 10 describes the swap operator as the trusted hop, but the Jupiter transaction validation does not constrain what that hop signs. The worst case through a malicious response is not just the current on-chain sweep amount: it can include the operator wallet’s other SOL and cbBTC balances. Limit 10 should explicitly include this exposure until instruction validation and wallet isolation are enforced.

2. **Is anything listed as a limit not actually a limit, or already closed?**
   - Limit 27 remains a real on-chain edge: a direct caller can claim/join a bare-burned vault before retirement. The crank’s positive-burn check mitigates its own plan; it does not remove the permissionless program path. That is already disclosed and should not be re-filed.
   - The wording/status for limit 51 is stale in one respect: `launch/mainnet-init.json` now marks `max_boost_weight` and `max_boost_epochs` **RULED**. The `$CBOB` mint address is still OPEN, so the launch blocker remains, but those bounds are no longer awaiting a ruling according to the supplied launch file.
   - Limit 38’s statement that the swap operator and sweep parameters are still OPEN/PROPOSED is also stale: the supplied JSON has a RULED swap operator, sweep cap, cooldown, and SOL reserve. The charter opening date and lock deadline remain OPEN.

3. **Is any DISCHARGED item not actually discharged?** I found no specific discharged code defect that I can substantiate from the supplied source. The layout-constant issue above is a weakness in the *future-change gate*, not a current decoded-offset mismatch.

4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?**
   - **22** remains blocking: the live-cluster crank rehearsal described in the document has not been demonstrated here.
   - **50** remains blocking: the promised holder redemption preflight and posting/website surfaces are not built. The pure `judgeRedemptionCoverage()` function is not a pre-signature control.
   - **38** remains blocking for the open charter date and lock deadline, despite the stale status wording for other values.
   - **51** remains blocking until the actual `$CBOB` mint is created and verified; its two bounds appear ruled in the supplied launch JSON.

## Before launch: what AI cannot do

The prompt does not include the SEAL, BURN, or GOV source files, despite describing the audit tree as whole. I therefore cannot certify those program implementations or GOV’s boost/governance paths from this material. Before immutability, require a **complete artifact-based review of the actual four built binaries and all deploy/init transactions**, not just source claims or test counts.

Concretely, have a responsible human operator:

- independently reproduce the mainnet build and compare each deployed program’s bytes and ID to the reviewed artifact;
- verify every initialization account, mint, authority, collection, treasury, pool ATA, and launch parameter directly from confirmed chain state before signing;
- run the missing live-cluster crank/revenue/alarm dress rehearsal, including RPC failures, frozen accounts, and a hostile or malformed Jupiter transaction response;
- verify the `$CBOB` mint authorities, freeze authority, decimals, exact supply, and release balance on chain;
- have a second person independently check the irreversible authority-removal transactions and confirm all four programs are actually immutable afterward.

No AI reading can establish that the right secrets, binaries, accounts, and irreversible transactions were used in the real launch.