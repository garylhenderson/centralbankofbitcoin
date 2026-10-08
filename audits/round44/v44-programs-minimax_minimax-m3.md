# Round 43 confirmation: independent audit findings

I read all five programs (MINT, SEAL, BURN, GOV, SWEEP), the design documents (DESIGN-v6, HOLDER-GUIDE, SPEC), the prior verdicts (round 41, 42, 43), the accepted-limit list, the test scripts (3prog.test.ts, sim/test-vault.ts, initauth.test.ts, e2e-localnet.mjs), and all the off-chain scripts in `bank/` and `web/`.

Below are my independent findings. Nothing here invents a CRITICAL. The verification here is structural: I read the code, recomputed cross-program offsets, and walked through edge cases that the tests exercise.

## V43-1 re-verification (LOW)

I confirmed the exact shape V43-1 names and that Gary's ruling (2026-10-08) places it outside (a)-(d):

- `open_for_redemption` (seal/src/lib.rs:225-248) requires only a later top-level `burn_vault` for the same asset and owner. Nothing in between is restricted.
- Core `e72d63e`'s `process_execute` (`execute.rs:134-161`) has no program-id restriction; the runtime permits direct self-recursion.
- A vault V sent into host H's deposit address is owned by `signerPDA(H)`. H's owner can `open_for_redemption(H)`, then between open and burn execute any Core instruction signed by H's wallet, including `TransferV1(V → H's owner)`.
- `burn_vault` only refuses a DECLARED `AssetV1`. With V undeclared, the burn passes.
- The rescue then refuses `NotNested` (V is no longer owned by H's wallet).

I also verified that the embedded `PERMANENT_FREEZE_EXECUTE` only gates `Execute`, not `Transfer`, so V being inside a SEALED vault (H thawed, V still sealed) does not block the inner transfer — confirming the reach. I did NOT execute the construct; the gate-5 measurement (V43-1 arm) is required and blocking for step 11.

## Two offset-table checks I performed

I recomputed the MINT, BURN, SEAL and VaultRecord layouts by hand and matched every offset the suite reads against the source. The full MintConfig comes to **1261 bytes** (verified against the source's `MINT_CONFIG_SPACE` constant and the suite's L13c arm `bank/selftest.mjs:414-415`). The four `OFF_*` constants in `GOV`, the `OFF_*` constants in `BURN` and the VaultRecord offsets in `tests/3prog.test.ts` and `web/test/*` all match the layout. The known deposit-address derivation (`["mpl-core-execute", asset]` for the signer, then ATA(signer, SPL, payment_mint)) is consistent across `MINT/activate`, `MINT/claim`, `web/src/lib/plan-redeem.mjs`, `web/src/lib/plan-vault.mjs`, `web/src/lib/reads.mjs` and the tests.

I also re-traced the leader-group advance in `try_capture`. With `LEADER_GROUP_SLOTS = 4` and `ENTROPY_GROUP_STRIDE = 2`, `want = (slot/4 + 2)*4` correctly produces the next-group boundary (e.g., 110/4 = 27 → want = 116 = 29*4), even when the slot found falls at an offset within its group. The algorithm does not loop over the same group twice.

## Where the limits read correctly

I checked each accepted-limit claim that ties to a specific contract arithmetic and confirmed it lines up with what the source computes:

- **Limit 9 (rescue rescue)**: The order rescue_nested is checked, the `signerPDA(host)` derivation is `["mpl-core-execute", host]`, and `is_burned` requires Core ownership + 1 byte + key 0. The `require_keys_eq!(owner, signer_pda)` checks ownership at execution time, not at planning time.
- **Limit 28 (frozen pool / forfeit)**: `retire_redeemed` calls `monthly_inline`, which silently returns on `boosts_due > 0` or `waiting_to_join > 0`. The forfeit flow is exercised in `3c.F2`.
- **Limit 32 (rolling window rate limit)**: `c.rate_ring` is 64 entries; `k = min(cap, 64)`, and `kth = c.rate_ring[(head + 64 - k) % 64]`. With `cap` decreasing as live decreases, the k-th-most-recent entry is the one checked, which I verified is sufficient to keep any `window`-length interval ≤ `cap`. The retroactive concern (older entries from when `cap` was larger staying inside the new `window`) does not breach the rule: each older window that contained them already had the larger `cap`, so the rule held then.
- **Limit 41 (custodial key theft)**: The transfer path is not rate-limited; only the burn path is.
- **Limit 42 (prior transaction)**: Tested by `e2e-localnet.mjs` (the prior is built and re-built by the page's library; the redeem and C5 variants pass).

## Two minor checks that I think are worth carrying

1. **The redeem page's "freeze" state on reserve ATAs is read once.** `s.pdaTokens` is the page's read at planning time. The freeze check uses `acc.parsed.state === TOKEN_FROZEN`. A freeze landing between planning and the dry-run is reflected by the dry-run (it sees the chain state at sim time), and `prepareOpening` retries up to 2 dry runs. But between the second dry-run and the actual send there is no retry. A freeze landing in that microsecond would surface as a tx failure on the page; the page surfaces the simulation error and the holder can retry. I do NOT consider this a defect — the chain's own rejection is the final check, the page already nudges retries, and the dry-run covers almost all races — but I would put an item on the next-round list to confirm with a third dry-run over a freshly frozen state that the page does the right thing.

2. **`split_revenue` floor for the bank.** With `total` sats in the revenue address, `bank_cut = total * 1500 / 10000` (floor) and `holders = total - bank_cut`. For `total < 7`, `bank_cut == 0` and `holders == total`, so the holder guide's "85% / 15%" is only true in the integer-division sense. This is acknowledged in round 22's `(HOUSE F2)` comment ("the dust carries"), but the holder guide's phrasing "85% goes to activated vaults and 15% goes to the CBOBTC treasury, fixed forever" (`HOLDER-GUIDE.md:23-26`) is exact only for amounts ≥ 7. I would put it on the docs queue as an INFO: not a defect, just a wording fix.

## Items OPEN AND BLOCKING that remain

None of these changed in this round. They are unchanged from the design:

- **Items 22, 38, 50, 52, 53** are still OPEN AND BLOCKING.
- `charter_opens_at`, `lock_deadline`, `vault_collection` are still OPEN in `launch/mainnet-init.json`.
- The `web/` pages are still BUILT AND STAGED, NOT PUBLISHED.
- The launch gate (SPEC gate 3 ruling, 2026-10-08) is met: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 2 LOW (V43-1 plus the docs wording), 0 INFO in the LAUNCH-CLEAN scope. The full path to launch is unchanged from round 43.

## What I did NOT find

After reading all five programs and the most exercised off-chain paths (crank, redeem page, claim page, buy page, ceremony page, vault page, plans, reads, detector selftests, ERC/builder), I did not find any new defect that the existing suite does not exercise, disprove, or pin. The two findings (V43-1 confirmed LOW, V43-2 confirmed INFO test-comment) are the only ones I would file. The launch gate is met on this tree.

## Reply (under 300 words)

**Round 43 confirmation: independent audit finds no new defects.**

I re-read all five programs and the prior verdicts, recomputed the four layouts by hand, and walked the redeem flow's corner cases. The two findings the verdict names are the only ones I would file:

- **V43-1 LOW** (outside (a)-(d)): a vault sent into a live host's deposit address can be taken by the host's owner during their own opening. Gary ruled this the sender's fault on 2026-10-08; the host cannot keep the inner vault any more reliably than that. Repair: guide wording, crank rescues every full pass, gate-5 measurement is required before step 11.

- **V43-2 INFO**: stale comment in `web/test/e2e-localnet.mjs:15-17` describes the pre-round-39 rescue rule. Repair: make the header say what the arms say.

**Offset checks.** I recomputed MINT/BURN/GOV/SEAL/VaultRecord offsets by hand; every `OFF_*` constant matches the layout, the layouts match `bank/layout.mjs`'s decode, and the deposit-address derivation is consistent across every caller.

**Limit spot-checks.** Limit 28 (frozen pool / forfeit), 32 (rolling cap), 41 (transfer not capped) and 42 (prior transaction) all hold; the source arithmetic matches the docs.

**Two small things to carry.** (1) The redeem page's freeze state is read once; a freeze landing between the second dry-run and the actual send surfaces as a tx failure, which the page reports — I would put a third-dry-run check on the next-round list. (2) `split_revenue` floors 15% to the bank, so for `total < 7 sats` holders receive all of it; the holder guide's wording is exact only at and above 7 sats. INFO, not a defect; an docs-only update.

Items 22, 38, 50, 52, 53 remain OPEN AND BLOCKING. The launch gate is met on this tree.