# Findings

## R1. Custody and redemption

### MEDIUM — A zero-balance wrapped-SOL account can pass the emptiness proof while holding SOL

**Construct:** `programs/cbob-vault-burn/src/lib.rs`, `burn_vault`, the generic `remaining_accounts` loop.

For non-reserve SPL accounts owned by the vault’s asset-signer PDA, the loop checks the token `amount` and delegate/close-authority fields. It does not inspect the native-token `is_native` field or reconcile a wrapped-SOL account’s lamports with its token amount. Anyone can transfer SOL directly to a wrapped-SOL token account without invoking `SyncNative`; the account’s token amount can therefore remain zero while it holds SOL above its rent reserve. If that account is declared, the current proof can accept it and burn the vault, leaving the SOL in an account whose PDA authority is no longer usable.

**Evidence if true:** On the real Core/SPL validator, create the vault PDA’s wrapped-SOL ATA, transfer SOL directly into it without `SyncNative`, and verify the token amount remains zero while lamports exceed the native reserve. Include the ATA in `declared`; if `burn_vault` succeeds and the lamports remain in the token account after the asset is burned, the claim is confirmed.

**Fix:** Reject declared native token accounts, or explicitly validate their native reserve and backing. The redemption client should also identify and close/sweep wrapped-SOL accounts before burning. This is not prevented merely by declaring the account.

The stated airdrop limit covers undeclared accounts, but does not cover this case: declaring the account does not currently make the proof reject its hidden SOL balance.

### Pairing and wrapper evidence gap — not a demonstrated pairing bypass

The top-level instruction checks appear to bind asset and owner in both directions. The suite does **not** exercise the requested CPI-wrapper shape, and Round 22 explicitly recommended a wrapper test for `retire_redeemed` that is still absent from the supplied suite. The stack-height check in MINT appears intended to make a CPI-invoked `burn_vault` fail when it tries to retire the record, but that conclusion should be demonstrated against a wrapper rather than inferred.

**Evidence needed:** A test-only wrapper should attempt (a) CPI `open` followed by CPI `burn`, and (b) a top-level matching `open` followed by CPI `burn`. Assert the transaction fails and the asset remains sealed/live. Also test two valid redemptions in one transaction without relying on the rate limit to reject the second burn. The supplied tests mostly exercise top-level pairs; the multi-vault case is refused by the cap.

## R2. Community pool

I do not find a counterexample in the supplied code to the pool solvency invariant, subject to the token mint/account assumptions in the configuration. The accumulator credits no more scaled liability than the available pool balance; claims reduce the recorded liability by the amount paid; retirement removes that vault’s liability; and distribution subtracts the rounded-up existing liability before crediting more. The boost reweigh path preserves the vault’s calculated pending amount by moving it into `carry_scaled` and does not change `owed_scaled`.

The requested statement **“no vault is ever paid for revenue that arrived before it joined” is false**, but this is not a new finding: the design explicitly permits a joined vault to share revenue already in the pool at a later distribution, and accepted limit 55 records the narrower unsplit-revenue edge. Joining at the accumulator prevents earning from a distribution that already ran; it does not timestamp revenue or exclude pre-join balances from future distributions. Do not describe that stronger property as guaranteed.

### MEDIUM evidence gap — the new boost’s hardest expiry/accounting orderings are not all tested

The visible boost tests cover ordinary expiry, a due boost blocking a distribution, and retirement before/after due. They do not appear to cover the most consequential combined orderings requested here: a boost and a distribution in one transaction in both instruction orders; a claim that pays and normalizes a boosted vault immediately before/after expiry; retirement of a boosted vault while a due boost is blocking a distribution; and repeated expiry-ring wraparound.

**Evidence if there is a defect:** The relevant on-chain state would disagree: recomputing active weights from all live records would not equal `total_active_weight`; summed record boost weights/counts would not agree with `boost_weight_total`/`boosts_active`; ring counts plus `boosts_due` would not equal active boosts; or the pool liability/payout would change solely because of reweighing or expiration.

**Fix:** Add state-machine tests for those orderings, including at least one ring wraparound. I do not have evidence from the supplied code alone that the boost arithmetic is broken, so this is an evidence gap, not a claimed accounting loss.

## R3. Level draw

The supplied code and test description do not establish a new draw vulnerability beyond accepted limits 25 and 26. `L.3c` now re-derives the captured entropy from raw SlotHashes, and reveals remain FIFO. The accepted limits already correctly state that a minter can compute an outcome from public hashes, that named captures can be withheld until rescheduling, and that the C-slot leader can bias a cohort sharing a reveal slot.

**Evidence gap:** The suite uses a local validator with no skipped slots for its `readySlot` helper. It does not demonstrate skipped-slot boundary cases around A/B/C selection or a SlotHashes buffer approaching its full 512 entries. A failure would be visible as the program selecting different produced slots from an independent parser, or as a capture refusing/accepting at the wrong boundary. Add generated sysvar-layout/parser tests or a validator scenario with skipped slots before treating those cases as exercised.

## R4. Governance

I did not identify a demonstrated threshold bypass or a route for a vote to call an unlisted MINT action. The action discriminators, account offsets, and ordering marks shown here are internally consistent.

The cost of a bare-burned vault remaining in the live-supply denominator until retired is explicitly stated: it can make a proposal harder to pass, not easier. The threshold values and three-day period remain one-time launch settings; their launch validation is still blocking, as discussed below.

## R5. Charter claim

### MEDIUM — The Proof-of-Burn collection authority can plausibly seize or destroy claim assets, beyond the documented rejecting-hook risk

**Construct:** MINT’s `claim_charter_vault` accepts any Core burn accounts supplied for the Proof of Burn, but neither it nor the initialization path restricts the Proof-of-Burn collection’s plugins or update authority. The accepted-limit text discusses a hot collection authority adding a rejecting hook that blocks claims. It does not disclose the more destructive delegate-plugin case: the suite itself creates a collection with a `PermanentBurnDelegate` plugin, demonstrating that this plugin kind can be installed on a collection. If Core applies that collection-level delegate to its assets as expected, the Moments collection authority could install a burn or transfer delegate and then burn or transfer Proofs of Burn without their holders’ signatures, consuming or seizing charter eligibility.

This is an expansion of the consequences of the **ruled** hot-wallet authority, not an argument to reverse that ruling. It is not addressed by passing Oracle accounts through to Core.

**Evidence if true:** On the real Core build, clone the Moments collection and a PoB asset; have the collection update authority install a collection-level `PermanentBurnDelegate` or `PermanentTransferDelegate`; then attempt Core `BurnV1` or transfer using the delegate, without the PoB owner signing. If successful, record whether MINT’s pinned-root claim then refuses the burned asset or whether ownership has changed. The supplied tests create a permanent-burn-delegate collection but do not test its effect on a PoB.

**Fix:** Before launch, establish and document the actual Core permissions of the Moments collection authority. If the authority can install such delegates, either remove that capability/change the collection trust boundary, or explicitly accept and disclose that the authority can destroy or seize unclaimed PoB rights. The existing alarm is post-change detection; it cannot restore a burned PoB or recover a transferred one.

A rejecting hook and the eight-account pass-through cap remain within accepted limit 46. This finding concerns asset seizure/destruction, not merely a hook refusing claims.

## R6. One-time configuration and trusted hop

No new on-chain bypass of the sweep cap/cooldown or the 85/15 wiring is evident in the supplied code. The SOL hop remains genuinely trusted: a compromised operator can sweep repeatedly at the configured cap/cooldown until stopped, bounded by available SOL above the reserve. That is disclosed in accepted limit 10.

Launch values are a separate safety boundary: code accepts many values that are inside test-oriented bounds but wrong for production. The supplied launch file still has OPEN fields, so the on-chain constraints alone are not a sufficient launch gate. See OPEN AND BLOCKING below.

## R7. Cross-program raw reads

The offsets visible in the supplied structs and constants agree:

- MINT `MintConfig`: governance 41, `minted_total` 141, `charter_closes_at` 442, `bare_burns_retired` 454, stop timestamps 518/526, tighten bounds 631/639/647, boost bounds 711/712.
- SEAL config: collection 9, reserve vector length 41.
- BURN config: `burned_total` 42, redemption window 50, rate head 58, ring 59.
- MINT `VaultRecord`: mint index 41.

I find no offset error in these supplied definitions. The visible suite’s layout-reader assertions are useful, but source-string/layout assertions are not substitutes for exercising malformed sibling accounts against the on-chain readers; the readers should continue to fail closed on discriminator, owner, version, and length as implemented.

## R8. Suite and simulation evidence

The suite is substantial, but it does not measure every claim it is sometimes used to support:

- **No CPI-wrapper pairing test** is present; Round 22 itself recommended one for the MINT stack-height check.
- **No successful two-vault redemption in one transaction** is shown. The cited two-redemption case is refused by the rate cap, so it does not independently prove both pairings succeed and bind correctly.
- **No wrapped-SOL hidden-balance test** is present. The existing airdrop tests cover token amounts, not native-token lamports with a stale zero amount.
- **No PoB collection delegate theft/destruction test** is present. The suite proves a permanent burn delegate can be attached to a collection, but not its effect on the PoB assets.
- **Skipped-slot entropy selection is not exercised** by the local helper, which assumes the local validator skips no slots.
- The supplied documents disagree on the Test Vault simulation count: the prompt/design say **59/59**, while SPEC’s running-tests section says **60**. That count mismatch is documentary evidence drift, not a demonstrated program defect; reconcile it against the actual run output and floor.

# Accepted-limits questions

1. **Is any limit worse than stated?**  
   Yes. The wrapped-SOL case above is worse than the stated undeclared-token loss: a declared non-reserve token account can still appear empty to BURN while holding SOL. The PoB collection hot-wallet capability may also exceed the documented “rejecting hook” impact if Core’s collection-level delegate behavior is confirmed.

2. **Is anything listed as a limit not actually a limit, or closed by something unnoticed?**  
   The stronger invariant “no vault is ever paid for revenue that arrived before it joined” is **not** a property of this code. The code excludes a vault from distributions before it joins, but later distributes pooled balances to the then-joined set. The documents already describe this behavior; accepted limit 55 is specifically about unsplit revenue. Do not present the stronger arrival-time invariant as proven.

3. **Is any DISCHARGED item not actually discharged?**  
   I do not see evidence here that the listed arithmetic/layout items are open again. However, the redemption pairing’s wrapper behavior remains an **unmeasured evidence gap**, not a closed property demonstrated by the supplied suite. Do not treat the absence of a reported exploit as equivalent to the missing wrapper test.

4. **Is anything in OPEN AND BLOCKING being quietly treated as accepted?**  
   These remain blocking, not accepted:
   - **22:** the production crank has not been exercised against a live deployment at scale.
   - **38:** all immutable initialization values must be finalized and checked before signing.
   - **50:** the promised redemption and claim-holder surfaces are not built; the guide’s preflight and announcements do not exist.
   - **51:** the $CBOB mint address and launch bounds/configuration must be finalized.
   
   Also complete the explicitly documented **52** prerequisites: create the pool and treasury token accounts and fund the revenue PDA for rent before splitting. The throwaway-ID rehearsal at 53 does not substitute for the live crank rehearsal at 22.

# Additional documentation issues

- HOLDER-GUIDE says sales and royalties flow “into the Bank”; in this design they flow to the MINT revenue PDA and then, for the holders’ share, the program-owned pool.
- The guide says “Activation is picked up automatically” and payouts arrive at least monthly. Those outcomes depend on a live crank, ordinary protocol traffic, or a caller; the program cannot wake itself. The documents acknowledge this limitation, but the guide should not promise unconditional automatic execution.
- The guide promises every opening is announced on X and the website, while the poster is draft-only and the website surface/sender are not built. This is correctly still OPEN AND BLOCKING under item 50.
- The guide’s redemption flow must account for the measured packet constraints: create destination accounts in a prior transaction for a three-reserve redemption; do not assume a crank can be piggybacked within the default compute budget.

# Given that no human firm will ever see this and the programs will be immutable, what should this project do before launch that AI audit structurally cannot?

1. **Run a hostile, transaction-level rehearsal on the exact release artifacts.** Use a second operator who did not write the tests. Include wrapper CPIs, multiple vaults per transaction, every reserve account, frozen accounts, Token-2022 extensions, native wrapped-SOL accounts with direct lamport donations, and PoB collection delegate changes. Save signed transaction bytes, logs, post-state, program hashes, and validator/Core hashes as the evidence record.
2. **Run the production crank and alarm against a live, disposable deployment at realistic scale before any holder value exists.** Measure RPC paging, compute, retries, lock behavior, confirmation latency, and a deliberately injected RPC failure late in a 2,100-vault pass. This is already blocking item 22.
3. **Make launch initialization a witnessed ceremony, not a script-only check.** Two independent people should compare every serialized initialize argument and derived PDA against the ruled values, verify the live mints/authorities and PoB root on-chain, confirm all required token accounts and rent, then independently verify the deployed program hashes and revoked upgrade authorities.
4. **Do not open the charter window until the holder-facing paths work end to end.** Test a real wallet’s claim, payout, and redemption path, including prior destination-ATA creation, crank compute-budget handling, warnings for nested assets and stray accounts, and the actual public-announcement process.
5. **Obtain explicit owner sign-off on the PoB collection authority’s destructive capabilities.** Test whether its Core authority can install a burn/transfer delegate and act without PoB-holder signatures. Detection after the fact is not recovery. If the ruling keeps that authority hot, the accepted risk must say exactly what it can do, not only that it can reject burns.