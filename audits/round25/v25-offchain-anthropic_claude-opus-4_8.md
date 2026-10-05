I'll focus on the never-audited code (swap.mjs, sweep helper, revenue.mjs changes) and the repairs, per the prompt's priority order.

# CBOB v6 audit — findings

## R5. THE SWAP (bank/swap.mjs, sim/swap-fork.mjs, revenue.mjs) — NEVER AUDITED

### CRITICAL-1 — `judgeSwapInstructions` does NOT check the swap's output account, the minimum-out, the direction, or the input amount. A tampered builder routes cbBTC to an attacker.

**Construct:** `bank/swap.mjs` `judgeSwapInstructions(ixs, owner, venue)`.

The prompt (R5e) asks directly: "Does it check the swap's OUTPUT account is the operator's own cbBTC account, the swap's minimum-out bytes, the direction byte, the amount, that ComputeBudget instructions cannot set a fee that drains the key…?" The answer, read off the code, is **no** to every one of those.

What the judge actually checks:
- every program is in an allowlist;
- no second signer;
- exactly one instruction to the venue program, and it *names the pinned pool* (`keys.some(k => k.pubkey.equals(pool))`);
- exactly one System transfer, into the operator's own wSOL ATA;
- exactly one Token close, wSOL → operator.

What it does **not** check about the swap instruction itself:
- **The output account.** The Orca swap's account at index 5 (`ownerCbbtc`) and Meteora's `user_token_out` are never verified to be the operator's own cbBTC ATA. A tampered `orcaSwapIx`/`meteoraSwapIx` (or a tampered `swapInstructions`) can put *any* cbBTC account there. The pool is still named, there is still one signer, the wrap still goes to the operator's wSOL, the close still returns wSOL — every judge check passes — and the swap output lands in an attacker's account.
- **The minimum-out bytes.** `minSats` sits in the instruction data (bytes 16..24) and the judge never reads it. A tampered builder can set `other_amount_threshold = 0`, and the on-chain floor the whole design rests on is gone. The judge is described as "the last line before the operator key signs"; it does not look at the one number that bounds loss.
- **The direction / amount.** Orca's `[1,1]` (exact-in, a_to_b) and the `lamportsIn` field are unchecked, so a builder could swap a different amount or direction.

**What an attacker gains:** anyone who can tamper with `bank/swap.mjs` (or a dependency it loads) between the audited bytes and the running process keeps the entire cbBTC output of every cycle, while every judge assertion the code and `sim/swap-fork.mjs` SW.6/6a/6b exercise stays green. The threat model the judge exists for is exactly "a tampered builder" — its own doc comment says "A defect here, or a tampered module, must fail loudly rather than sign." It does not fail on the two tampers that matter most.

**Evidence if true:** build `orcaSwapIx` with `ownerCbbtc = attacker` and `minSats = 0`, run `judgeSwapInstructions` on the result → returns `[]` (no problems). The fork test never tries this: SW.6a tampers only the wrap destination (index 1 of the transfer), SW.6b feeds Orca bytes to the Meteora judge. Neither mutates the swap's output account or the min-out.

**Why this is not caught by revenue.mjs's return check:** `revenue.mjs` reads the operator's own cbBTC ATA delta after the swap (`after > opBefore`). If the swap output was routed elsewhere, the delta is 0, `delta < guaranteed` throws, and SOL is "on the operator key" — so the *honest* failure is loud. But the judge is the layer that is supposed to catch a *malicious* builder before signing, and the delta check does not help if the attacker's builder also fabricates a return (it holds the operator key's trust only through the ledger, which limit 10/D2 already says is forgeable by the box owner). More importantly: the min-out tamper alone (output to the right account, threshold 0) passes the judge *and* the delta check whenever the pool happens to fill — losing the entire sandwich/slippage margin on every cycle silently, with no floor enforced on chain at all. The design's central claim ("the OUTPUT FLOOR is enforced ON CHAIN… never from the pool's own price") is only true if `minSats` is the value actually in the signed bytes, and nothing verifies that.

**Fix:** in `judgeSwapInstructions`, for the single swap instruction, assert by position (Orca index 5 / Meteora index 5) that the output token account equals `ata(CBBTC, owner)`; assert `swap.data.readBigUInt64LE(16) === minSats` (pass `minSats` into the judge); assert the direction/amount bytes for Orca (`data[40]===1, data[41]===1`, `readBigUInt64LE(8)===lamportsIn`) and the amount for Meteora. Add fork arms that tamper each.

---

### HIGH-2 — ComputeBudget fee is unbounded; the judge admits a `setComputeUnitPrice` that drains the operator key.

**Construct:** `swap.mjs` `judgeSwapInstructions` allows `ComputeBudgetProgram.programId`; `swapInstructions` only emits `setComputeUnitLimit({units: 400_000})` with no priority-fee instruction.

The prompt (R5e) asks whether the judge checks "that ComputeBudget instructions cannot set a fee that drains the key." It does not. ComputeBudget is in the allowlist with no constraint on which ComputeBudget instruction or its value. A tampered builder can add `setComputeUnitPrice(huge)` — at 400,000 CU a micro-lamport price of a few million lamports/CU drains the operator wallet to fees in one transaction. The judge sees "a ComputeBudget instruction," which is fine, and signs. Loss is bounded by the operator balance (limit 10/D2 says fund it above the 0.02 SOL float and top up by hand), but nothing here stops a single transaction consuming the whole float plus whatever cbBTC-cycle reserve sits there.

**Evidence:** add `ComputeBudgetProgram.setComputeUnitPrice({microLamports: 50_000_000})` to the ix list → `judgeSwapInstructions` returns `[]`.

**Fix:** the judge should require the ComputeBudget instructions to be exactly the one `setComputeUnitLimit` the builder emits (reject any `setComputeUnitPrice`, or cap its product `units × price` against a hard lamport ceiling).

---

### HIGH-3 — `readPyth` trusts the clock the age is measured against; the fork test measures age against the price's own `publishTime`, so staleness is never exercised against a real clock.

**Construct:** `swap.mjs` `oracleFloor` uses `nowSec` passed by the caller (`Math.floor(Date.now()/1000)` in `revenue.mjs`/`market`); `sim/swap-fork.mjs` passes `now = Math.max(st.sol.publishTime, st.btc.publishTime)`.

R5b asks: "Is the clock the age is measured against trustworthy?" On the fork, `nowSec` is set to the cloned price's **own publish time**, so `nowSec - publishTime ≈ 0` always — the staleness check can never fire in the fork. The 180 s rule is "proven both ways in bank/selftest.mjs" (M1 arm), but that arm is pure arithmetic with a hand-set `NOW`; the *integration* path (fork) deliberately defeats the clock. So the one place that exercises the real Pyth account against the real receiver program never tests that a stale-but-fully-verified update is rejected in a running swap.

Separately, `readPyth` verifies owner + derivation + full-verification + feed id, but a fully-verified `PriceUpdateV2` can carry an old `publish_time` with a legitimate signature (that is what "fully verified" means — Wormhole verified the message, not its freshness). The only freshness guard is `nowSec - publishTime > 180`, measured against the **box's wall clock**, which on this single-box deployment is the box owner's to set. A box whose clock is pushed forward... actually tightens the check; a box behind rejects fresh prices. The real exposure is the gap the fork hides: there is no on-chain enforcement that the price update is recent (the pool program enforces `min_amount_out`, not oracle freshness), so the floor's quality depends entirely on an off-chain staleness check that the integration test is rigged to pass.

**Fix:** the fork should clone the Pyth accounts *and* a recent slot/clock, or inject a deliberately old `publishTime` and assert `oracleFloor` throws; add a both-directions fork arm so "180 s" is proven against a non-degenerate clock.

---

### MEDIUM-4 — wSOL ATA pre-existing with a frozen state, a delegate, or a foreign-created balance is not handled; `createAtaIdempotent` + `syncNative` + `close` can leave the operator stuck or lose a pre-existing balance.

**Construct:** `swap.mjs` `swapInstructions` always emits `createAtaIdempotent(WSOL)`, `transfer(lamportsIn)`, `syncNative`, swap, `closeAccount(ownerWsol → owner)`.

R5g asks what happens if the operator's wSOL ATA already exists holding a balance, is frozen, has a delegate, or was created by someone else.
- **Already holds a balance:** `transfer(lamportsIn)` adds to it, `swap` consumes `lamportsIn`, `closeAccount` returns the *remainder plus the pre-existing balance* to the operator as SOL. That is correct for value but means the "wrap exactly lamportsIn" invariant the comment claims is false — the swap's input to the pool is `lamportsIn` only because the swap instruction's `amount` field is `lamportsIn`, but the account held more. Not a loss, worth noting the comment overstates.
- **Frozen (wSOL has no freeze authority normally, but a foreign Token-2022-style or a maliciously-created account):** `syncNative`/`transfer`/`close` fail, cycle aborts loud — acceptable but leaves an open cycle requiring hand resolution.
- **Created by someone else (owner mismatch):** `createAtaIdempotent` is a no-op if the account exists; if it exists with a *different owner*, the subsequent token ops fail. Loud, but again an open cycle.

The real gap: **nothing in the judge or builder asserts the wSOL ATA is empty/clean before wrapping**, and D2 already warns "the operator wallet must hold nothing but the cycle's funds." A pre-existing wSOL balance from a prior crashed cycle is silently folded into this cycle's SOL on close, which can mask a prior failure. Bounded, operator-facing, but undisclosed.

**Fix:** read the wSOL ATA before wrapping; refuse (or at least log) a non-empty or non-standard one, as `revenue.mjs` already does for the cbBTC ATA delta.

---

### MEDIUM-5 — Meteora `meteoraSpot`/deviation uses floating-point `(1 + binStep/10000)^activeId`, which overflows to `Infinity`/`0` for large `|activeId|` and can pass a pool it should refuse.

**Construct:** `swap.mjs` `meteoraSpot = p => 1 / (1 + p.binStep/10_000) ** p.activeId`.

R5c: "check… that floating point cannot pass a pool it should refuse." `activeId` is an i32; cbBTC/wSOL at 8 vs 9 decimals with a bin step of (say) 20 bps gives a large `activeId`. `(1.002)**activeId` for `activeId` in the tens of thousands is astronomically large → `meteoraSpot → 0`; `deviationBps(0, oracle) = |0-oracle|/oracle*10000 = 10000`, which *exceeds* 100 and refuses — so this direction fails safe. But for a pool near the real price the float is fine; the hazard is the intermediate: `Number(sqrtPrice)/2**64` in `orcaSpot` and the Meteora power both lose precision such that a pool genuinely >100 bps off could compute to ≤100 bps under rounding when the deviation is near the boundary. The gate is 100 bps and the float error at these magnitudes is well below that, so this is unlikely to flip a real decision — but the design leans on it and it is unproven: the fork's SW.0 only checks the *current* pools are within bound (`devO`, `devM`), never a pool engineered to sit at 99.9/100.1 bps.

**Fix:** compute the deviation in integer/BigInt against the oracle's integer `satsPerLamport` (which `oracleFloor` computes exactly), not via `Number` powers; add a fork arm with a cloned pool state pushed just across the gate.

---

### MEDIUM-6 — Double-swap on confirmation timeout is possible across venues; the ledger can read a cycle as closed that is not.

**Construct:** `revenue.mjs` step 2 loop over `m2.venues`.

R5h: "Can a confirmation timeout on a swap that later lands lead to a second swap…?" The loop advances to the next venue only when the error matches `/custom program error|Error Code:|Transaction simulation failed/` (a *refusal*); an unconfirmed send (`!refused`) re-throws, leaving the cycle open — correct, as the comment says. But within a single venue, `sendAndConfirmTransaction` timing out *after* the transaction landed throws a non-refusal error → re-throw → cycle open, SOL "on the operator." A second run then sees the open cycle and throws at the open-cycle guard — so it does not auto-retry the swap, good. The residual risk is the *recovery* path: a human resolving the open cycle by hand could resubmit the swap while the first is confirming. Not a code defect, but the design's claim "never on an unconfirmed send" holds only for the automatic path; the manual path has no guard. Worth stating in limit 10.

Also: `cycle.swapSig` is set only on success; a swap that *landed but timed out* leaves `swapSig` unset and `returnedSats` unset, so `cycleIsOpen` correctly reports open. Fine.

---

### R5(a) oracle math — notes

`oracleFloor`: `e = sol.expo - btc.expo` (both -8 on mainnet → e=0). The sign handling (`if e>=0 num*=10^e else den*=10^-e`) is correct for both signs. Integer rounding is floor (truncating division), favouring a *lower* expected, hence a lower floor — safe direction (never demands more than honest). `satsPerLamport` uses `Number(...)` floats only for the *deviation* comparison, not the floor — acceptable since the floor is BigInt. No overflow in the BigInt path. **This part is sound.** The one real concern (the floor being below an honest pool's output after fee+impact) holds because 150 bps > 16 bps Orca fee + typical impact for a ≤10 SOL cycle against ~$10M liquidity; against the ~$0.9M Meteora pool a 10 SOL (~$850) swap is ~0.1% of pool depth, impact well under 150 bps. Bounded as the prompt's R5i expects.

---

## R1. THE CRANK

### LOW-7 — `budgetPlan` drops reveals silently when the key is short, but a dropped reveal in mint order stalls the FIFO behind it until the next pass; the "dropped" page is HIGH-urgency only via `failures`, and a persistently under-funded key re-rolls draws (limit 25).

This is disclosed (L6b) and the crank pages via `failures.push`. Not a new finding; confirming the repair holds: `budgetPlan` keeps `plan.reveal.slice(0, keep)` in mint order, so it never reveals out of order. Correct.

### Confirming R0/H1 repair at every site

`crankNotices` gives each lane its own stream and a recovery; `main()` writes the lane marker and sends RECOVERY. **One gap:** the `withLock(...).catch` handler (bottom of crank.mjs) writes `laneMarker(lane)` and notifies on `${CRANK_LABEL}:${lane}`, but a *failure to acquire the lock* (ELOCKED, a live holder) also triggers this — so a merely-contended run pages a lane failure and sets the failing marker, which then produces a spurious RECOVERY next clean pass. Minor noise, not a correctness defect.

---

## ACCEPTED LIMITS — the four questions

**1. Worse than stated?**

- **Limit 10 (the swap hop) is WORSE than stated**, because of CRITICAL-1 and HIGH-2. The limit's new text says what is trusted is "the two pool programs and the Pyth price" and that the transaction "is judged before signing." That judgement is incomplete in exactly the ways that matter (output account, min-out, ComputeBudget fee), so the trust surface is larger than "two pool programs + oracle": it is also "the builder module is not tampered," which the judge was specifically written to remove and does not. D2 already concedes the box owner can forge the ledger; CRITICAL-1 adds that an off-box tamper of swap.mjs is not caught by the judge either. This should be stated.

**2. A limit that is not actually a limit / closed by something unnoticed?**

- Nothing newly closed that was listed open.

**3. DISCHARGED item not actually discharged?**

- **Limit 33 (`apply_swap_operator` branch) — the swap now has a new trusted surface (bank/swap.mjs) that did not exist when 33 was discharged; not a re-opening of 33, but the swap fork (SIM_FLOOR=10) is the only integration proof and HIGH-3 shows its staleness arm is degenerate.** Worth noting the fork proves less than it appears to.

**4. OPEN AND BLOCKING treated as accepted?**

- Item 50 explicitly lists the sweep helper deploy/lock as OPEN; consistent. No quiet demotion found.

---

## R6. GATES — assertions that cannot fail

### MEDIUM-8 — The swap fork's floor-refusal arm (SW.1b/4b) proves "5% above oracle is refused" but the floor the *production* path signs (150 bps under oracle) is never proven to be *accepted by the pool at honest price* against adversarial pool state.

SW.1/SW.4 swap at `f.minSats` against the *current* cloned pool, which is near oracle, so of course it fills. There is no arm where the pool is pushed to the edge of the 100 bps gate (the max an attacker can do within tolerance, R5i) and the 150 bps floor is tested for whether it still fills or reverts there. The design's loss bound ("what a sandwich… can take per cycle") is reasoned, not measured. Not a false gate, but an incomplete one for the claim it backs.

---

## WHAT AI AUDIT STRUCTURALLY CANNOT DO HERE — before launch

1. **Prove the running `bank/swap.mjs` bytes are the audited bytes.** Every finding above about the judge assumes the builder is honest-but-buggy. The deeper hole is that nothing pins swap.mjs (or its node_modules) the way `build-mainnet.sh` pins the programs. The signing key is on the box with the builder. **Concretely:** add swap.mjs (and a lockfile hash of its imports) to a signed manifest, verify it at process start against a hash the operator holds off-box, and have the judge be *complete* so even a tampered builder cannot route output or zero the floor. CRITICAL-1 and HIGH-2 are the minimum to make the judge do the job its own comment claims.

2. **Run the swap fork with a non-degenerate clock and adversarial pool state.** The fork is the only thing that executes real CPIs; make it inject stale prices and edge-of-gate pools so the two safety properties (oracle freshness, deviation gate) are proven by execution, not by pure-function arms that choose their own inputs.

3. **The mainnet dress rehearsal (limit 22) with the operator key live**, because the swap, the ledger-vs-chain reconciliation, and the box-compromise boundary (D2) have never run against a live cluster with a real adversary. AI cannot test the box's own trust boundary.

4. **Exercise a real griefer against the sweep helper redemption** on the rehearsal: prove one base-unit-per-slot deposits cannot block the at-execution sweep, and that a 3-reserve redemption through `programs/cbob-vault-sweep` fits the packet and compute (explicitly unmeasured per limit 50 / the round-23 F1 entry).

The single most important pre-launch action: **make `judgeSwapInstructions` complete (CRITICAL-1, HIGH-2) and prove the completeness both ways in the fork**, because it is the last line before a hot key signs a value-moving transaction, it is new and never audited, and it becomes permanent operational code the moment the box holds the operator key.