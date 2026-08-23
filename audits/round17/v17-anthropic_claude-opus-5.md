# INDEPENDENT AUDIT — ROUND 17

**Scope:** the `2f84b40..HEAD` diff (SEAL's on-chain confinement, weighted distribution, `bank-sign.sh`, the new selftest arms, the suite changes), plus `Cargo.toml`/`Anchor.toml`, plus the previous round's verdict.

Before the findings, three things I checked and could **not** break, stated so you don't spend engineering time re-defending them:

- **`allocateWeighted` cannot over-distribute.** `Σ floor(A·wᵢ/D) ≤ floor(A·Σwᵢ/D) = A`. It also cannot pay an unactivated vault (`per` is keyed off `activated`, and the payment loop iterates `plan.activated`), and `smallest` is correct when the first element is not the minimum.
- **"BURN needs no copy of the confinement" is TRUE.** `burn_vault` requires a *preceding top-level* `open_for_redemption` bound to the same asset and owner. That instruction is dispatched to SEAL and either succeeded (so the confinement ran over the whole message) or aborted the transaction. There is no transaction containing an executable `burn_vault` whose confinement was skipped. Assertions 3.8/9.0 are the right gate for it.
- **The generation-numbered lock holds.** Between `place(G+1)` and the sweep of `≤G`, the holder is `G+1`; a concurrent racer reads `G+1`, finds it fresh, and refuses. There is no interval in which the pathname set is empty. `pidStart`'s field index (19 after dropping fields 1–2) is correct. And the ELF-offset reversal is right: `size_of_programdata_metadata()` is 45 unconditionally and `set_authority` rewrites in place.

---

# R1 — SEAL's new on-chain check

## C1 — CRITICAL. The confinement was added to SEAL only. `mint_vault` takes `bank: Signer` and has **no confinement and no policy tool at all** — the round-15 theft, intact, on the path that runs 240 times at launch.

**Exact construct.** Three programs demand the Bank's signature: SEAL (`open_for_redemption`), BURN (`burn_vault`), MINT (`mint_vault` → `require_keys_eq!(ctx.accounts.bank.key(), cfg.bank, MintError::NotTheBank)`). The diff added the walk to SEAL. The comment enumerates *why BURN needs no copy* and **never mentions MINT**. `MintVault<'info>` has no `instructions` sysvar in its account list, so it cannot introspect even if it wanted to. And on the off-chain side, `judgeRedemptionTx` returns on line one for a mint transaction (`expected exactly one open_for_redemption and one burn_vault, found 0 and 0`), so `cosign.mjs` **cannot judge a mint**, and `scripts/bank-sign.sh` — "THE ONLY SANCTIONED WAY TO PRODUCE A BANK SIGNATURE" — has no mint mode. SPEC's sanctioned-path section is titled *SIGNING A REDEMPTION*.

**What an attacker gains.** A customer composes
`[mint_vault(...), SystemProgram.transfer(from = BANK, to = attacker, lamports = <bank balance − fee>)]`
and hands it over for co-signature. The Bank must sign for the mint. It signs the theft. This is *verbatim* the transaction round 15 measured, on the sibling instruction, with **neither** the on-chain confinement **nor** an allowlist **nor** a fee-payer arm **nor** a tool that would print anything. Worse variants: `SystemProgram.assign(BANK, <program>)` bricks the Bank's ability to be a fee payer, and `approve` on any token account the Bank owns. The Bank is also `payer` in the suite's own mint builder (`{pubkey:bank.publicKey,isSigner:true,isWritable:true}`), so the Bank *is* expected to hold real SOL through the mint round.

**Bound, honestly:** this steals the Bank's SOL float and can deny-of-service the Bank key (7-day rotation). It does not reach customer Bitcoin. It is CRITICAL because it is a live, trivially-composable theft on the highest-frequency Bank signature in the system, and because the mitigation the project believes it has (`bank-sign.sh`) does not cover it.

**Evidence if I'm right.** `grep -rn BankKeyOutsidePair programs/` returns hits only in `programs/cbob-vaults`. `grep -n instructions programs/cbob-vault-mint/src/lib.rs` returns nothing in `MintVault`. `node bank/cosign.mjs --tx <base64 of a mint tx>` refuses with the "found 0 and 0" reason — i.e. it cannot judge it, so there is nothing to skip. And a validator test: build `[mint_vault, SystemProgram.transfer(from=bank)]`, sign with `[bank, asset, alice]`, send — it lands and the Bank is poorer.

**Fix (in order of cost).**
1. Add the same walk to `mint_vault`: an `instructions: UncheckedAccount` pinned to the sysvar id, exempting only instructions to `crate::ID` carrying the `mint_vault` discriminator. Mint transactions are far from the byte ceiling.
2. Meanwhile: `require_keys_neq!(ctx.accounts.payer.key(), cfg.bank)` in `mint_vault` (see M2 — it belongs in all three), and write down, in SPEC's control table, that **we** compose mint transactions and never accept a customer-supplied one, with a `judgeMintTx` + a `bank-sign.sh --mint` mode as the gate for it.
3. Until one of those exists, the Bank key must hold a fee-only float and nothing else — and that is an ops instruction that appears nowhere in this repository.

## C2 — HIGH. The exemption is sound for *authority*, but it is wider than it needs to be, and the width is what leaves known-limit #3 open. Narrow it to positional identity.

**Construct.** The exemption is `program_id + first 8 data bytes`. I could not turn that into a theft: any instruction wearing SEAL's open discriminator is dispatched to the real handler (Anchor ignores trailing Borsh bytes, so padding is legal but harmless), whose account positions are fixed and whose extra accounts are inert; any instruction wearing BURN's is dispatched to `burn_vault`, which only *reads* its remaining accounts and skips anything not token-owned (so passing the Bank as a "declared account" is accepted and does nothing). The single residual is `payer` — position 4 of `OpenForRedemption`, position 5 of `BurnVault` — which is a writable signer the Bank can be named as. Cost measured in principle: `UpdatePluginV1` toggling a `bool` does not resize, so the rent delta is 0; `BurnV1` *refunds* to the payer. So limit #3 is accurately stated and is not worse than documented — **confirmed, not inflated.**

**Why it still matters.** The exemption's stated justification is "two redemptions may share a transaction". But `judgeRedemptionTx` **refuses** two redemptions in one transaction, deliberately, and there is no other sanctioned signer. So the entire "anything wearing these eight bytes is exempt" surface exists to support a shape the Bank will never agree to sign. Drop the capability and the invariant becomes exact: *the Bank's key appears in exactly two instructions, at exactly one position each.*

**Fix.** Replace the discriminator-shaped exemption with positional identity: exempt `i == current` (self) and the single matching burn already located by job 1; then add `require_keys_neq!(ctx.accounts.payer.key(), config.bank)` to both `open_for_redemption` and `burn_vault`. That closes known-limit #3 outright, removes the forged-shape surface entirely, and costs the multi-redemption capability — which the policy already refuses. Update SEAL's comment and SPEC together, and delete `IX_OPEN_FOR_REDEMPTION_DISC` from SEAL (a third copy of a fact, gone).

## C3 — MEDIUM. `while let Ok(...)` flipped this loop from fail-CLOSED to fail-OPEN when it acquired a second job.

**Construct.**
```rust
while let Ok(ix) = load_instruction_at_checked(i, &sysvar) { ... i += 1; }
require!(found, VaultError::NoTerminalBurn);
```
Under the old code, *any* error ending the loop early could only make `found` stay false → `NoTerminalBurn` → refuse. Now an early exit also **skips the confinement for every remaining instruction** and the transaction proceeds. `load_instruction_at_checked` can return `Err` for reasons other than index-out-of-range: `try_borrow_data()` on the sysvar returns `AccountBorrowFailed` if the data is already mutably borrowed, and the mapping of `SanitizeError` is a per-SDK detail. Today no borrow is held across the loop, so this is latent — but the fix is three lines and the failure direction is the one that matters.

**Evidence if I'm right.** Stub the loader to return `Err` on the third call in a unit harness: the transaction should abort; today it thaws.

**Fix.** Read the instruction count (first `u16` of the sysvar data), iterate `for i in 0..n`, and use `load_instruction_at_checked(i, &sysvar)?` so an unexpected error propagates. Then `require!(found, ...)` as now.

## C4 — LOW. `SEAL::initialize` accepts `bank == Pubkey::default()` while `update_config` refuses it.

`update_config` has `require_keys_neq!(x, Pubkey::default(), NotTheBank)`; `initialize` has nothing. A default bank is the System program id, so *every* instruction naming System would trip `BankKeyOutsidePair` — on top of the bank being unable to sign at all. `INIT_AUTHORITY` is a Squads vault where an empty field in a proposal is a realistic slip, and the config's `collection` is non-rotatable so a bad init is a fresh deploy. **Fix:** one `require_keys_neq!` in `initialize`, mirrored in BURN and MINT.

## C5 — MEDIUM. Compute units: still unmeasured, and the worst case is now the one the suite does not exercise.

The walk is *not* obviously expensive — in the common case (open at index 0, burn last) it deserializes roughly what the old code did. The new costs are (a) `accounts.iter().any()` over every instruction's metas, dominated by Core's `ExecuteV1`; (b) an **O(N²)** total for N redemptions in one transaction, since each open re-walks the whole message. Test 4.9 exercises N=2 with `mkVault(0n)` — *empty* vaults, no `ExecuteV1`, so the quadratic term is measured at its cheapest possible point. The realistic budget is `min(200k × instruction_count, 1.4M)`; a 3-reserve-mint redemption also pays ~1,500 CU per `find_program_address` (BURN derives 6, plus Anchor's `seeds::program` derivation, plus SEAL's `["seal"]`), three transfers and three closes. I am **not** claiming a breach — I'm claiming you have no number, and the suite already lands these transactions on a validator.

**Fix (one line, today).** In `att()`/`send()`, fetch `meta.computeUnitsConsumed` and record it beside each `rec`. Commit a baseline file (`tests/BUDGET.md`) with: 4.2 (1 mint), 9.14's 3-mint worst case *sent* rather than only serialized, and 4.9 with funded vaults. Then a future edit that doubles CU is a diff, not an argument. Note the byte interaction with **measured fact 10**: if CU ever forces a `SetComputeUnitLimit` instruction into a redemption, the documented 113-byte headroom at 3 reserve mints drops to roughly 65, and the ceiling table becomes tighter than SPEC states.

## C6 — LOW, and worth writing down. A real capability was removed with no runbook.

The Bank can no longer be named in *any* non-pair instruction of a redemption. So "we'll fund the customer's destination ATA in the same transaction" and "we'll pay for their sweep" are now impossible on-chain, where they were previously only policy-blocked (and a human could override by signing by hand). The Bank *can* still be the fee payer on-chain. Neither the new behaviour nor its one remaining sponsorship route is documented anywhere an operator would look.

---

# R2 — weighted distribution and the emission cadence

## D1 — HIGH. An activated-but-unlevelled vault halts **every** payout, records the day as `nothingToDo`, exits 0, and **no detector fires**. The trigger is the normal customer activation path.

**Construct.** `allocateWeighted` returns `skip` for an unlevelled activated vault. `main()` then does:
```js
if (plan.skip) {
  st.days[day].nothingToDo = plan.skip
  st.days[day].finishedAt  = new Date().toISOString()
  return                        // exit 0, no NOTIFY
}
```
and `detectDistribution` treats `nothingToDo` as a legitimate quiet day (`t('QUIET for a day with nothing to distribute', …)`). So three completely different conditions collapse into one silent state: *no cbBTC*, *holding under the cadence threshold*, and *our level register is out of date and nobody is being paid*.

**How it happens without an attacker.** Activation is permissionless and customer-driven: send ≥21,000 sats to the vault's asset-signer PDA's cbBTC ATA. Level assignment is manual, off-chain, and Bank-driven. A vault activated at 09:06 on the day it mints halts the 09:07 run for **all 2,100 holders** until a human notices. There is no notice — the alarm reports a clean day, every day, indefinitely. A griefer can also do it deliberately for ~$21 of cbBTC into any un-levelled vault.

**Contrast that reveals the inversion:** a *missing* register throws out of `loadLevels`, hits `withLock`'s catch, and **pages**. The far more likely condition — the register lagging by one vault — is silent.

**Evidence if I'm right.** Set `levels.json` to omit one activated vault, run `node bank/distribute.mjs`, observe exit 0, `distributions.json` with `nothingToDo` + `finishedAt`, and `node bank/alarm.mjs --dry-run` reporting no distribution finding.

**Fix.** (a) Distinguish *benign* skips from *pathological* ones: on an unlevelled/denominator/register skip, `execFileSync(NOTIFY, …)` and `process.exitCode = 1`, and write a distinct field (`blocked: <reason>`) that `detectDistribution` raises at CRITICAL. (b) Add a positive detector that is blind to all of this bookkeeping: **days since the last day with at least one row carrying a `sig`** > `MAX_HOLD_DAYS + 1` → CRITICAL. That single pure detector covers D1, D3 and any future silent-outage shape. (c) Remove the race: assign the level at mint (or have a job that assigns before distribute runs and is itself watched), so the register cannot lag behind an activation.

## D2 — MEDIUM. `levels.json` is now a money input of the same weight as `split_bps`, and the published census/denominator **cannot** detect the tampering the comment says they make checkable.

**Construct.** The comment added by this diff:
```js
// THE CENSUS AND THE DENOMINATOR ARE PUBLISHED EVERY SETTLEMENT … They are what
// makes a share checkable by the holder rather than taken on trust
```
Census and denominator are **invariant under any permutation of levels among vaults.** Swap vault A (V) with vault B (I) and the census, the denominator and every published figure are byte-identical, while A's share falls by ⅔ and B's triples. The one thing a holder cannot verify — *my* weight — is the only input in dispute, and it is precisely the thing this sentence claims is now checkable. The file's own honest ⚠️ paragraph twelve lines above says it is "OUR WORD". The file contradicts itself in one screen.

Meanwhile `levels.json` has: no entry in `WATCH`/`WATCHED_KEYS`, no hash in the drift watch, no `.has-run` marker (deleting it is a hard stop, which is right, but *editing* it is invisible), and it is not in `audit-coverage.sh`'s file list, so it will never appear in an audit prompt.

**Fix.** (a) Delete or correct that sentence. (b) Today, cheaply: hash `levels.json` at load, print the hash in the settlement line, store it in the alarm state and raise `config_drift`-class CRITICAL on change. That gets most of the commit-reveal benefit for ten lines and makes a swap after-the-fact detectable. (c) `bank/*.json` belongs in the coverage list.

## D3 — MEDIUM. `holdDays` treats refused and skipped rows as "paid", so the 31-day ceiling can be reset by days on which nobody was paid.

```js
const paid = days.filter(d => Object.keys(st.days[d]?.paid || {}).length > 0)
```
A row exists for a vault whose transfer was **rejected** (frozen ATA, insufficient funds) and for one **skipped** (`vault is no longer a live Core asset`). Both count. So: day X clears the cadence gate, every transfer is refused, nobody is paid, the clock resets to X. The pool is unchanged and still under threshold → 30 more days of holding. Repeat and holders can wait arbitrarily long while the "nothing longer than monthly" promise reads as satisfied.

**Fix.** `paid` must mean `Object.values(st.days[d].paid).some(r => r.sig)`. Add the assertion in both directions (a day of pure refusals must **not** anchor).

## D4 — MEDIUM. The forced payout has no economic floor, and the comment above the floor it does have is false.

`decideEmission`'s forced branch only requires `smallestPer ≥ MIN_PER_VAULT = 1n`. At 2,100 vaults (D = 6,405) a forced drop can be ~3,200 sats total, delivered by ~2,100 sequential confirmed transfers at ~5,000 lamports each ≈ 0.0105 SOL. Value delivered and fees paid are the same order of magnitude, it takes hours of `sendAndConfirmTransaction`, and it resets the clock so it recurs monthly. Meanwhile `MIN_PER_VAULT`'s retained doc sentence says *"Below this a transfer costs more in fees and noise than it delivers"* — false by roughly two orders of magnitude at 1 sat, and it is exactly the sentence that stops a reader asking this question.

**Fix.** Make the forced branch require a **total** that clears the SOL cost (or a per-vault floor tied to the fee), and flag it beside `EMISSION_MIN_PER_VAULT` as a **second unratified cadence number** — the write-up flags only the first (known item 17).

## D5 — MEDIUM. Prototype-chain level names pass both guards and then crash the money job.

`loadLevels`: `!LEVEL_WEIGHTS[l]`. `allocateWeighted`: `!LEVEL_WEIGHTS[levels[v]]`. For `l = "constructor"` (or `toString`, `valueOf`, `hasOwnProperty`) the lookup walks the prototype and returns a **function** — truthy. So it is not "bad" at load, not "unlevelled" at allocation, and `census` writes `c["constructor"] = NaN`. Then `BigInt(LEVEL_WEIGHTS["constructor"])` throws `TypeError: Cannot convert a function to a BigInt` out of a cron at 09:07. Fail-closed on money, but with a stack trace instead of the named refusal the file exists to produce — and the selftest's `'...and an unknown level string is refused too, never coerced'` uses `'VI'`, so the "both ways" claim does not cover the class.

**Fix.** `Object.hasOwn(LEVEL_WEIGHTS, l)` (or `LEVELS.includes(l)`) in both places, plus the assertion with `'constructor'` as the input.

## D6 — MEDIUM. Resume does not check solvency, and the published settlement line goes blank on resume.

The resumed plan is `{activated, per, census, denominator, skip:null}` — **no `total`, no `dust`**. The final log prints `${String(plan.total ?? '')} sats out, dust ${String(plan.dust ?? 0n)}` → `" sats out, dust 0"` on every resume. That line is a published settlement figure.

Worse: nothing compares the remaining plan against the actual balance. If the pool shrank between the plan and the resume, every remaining transfer fails with `insufficient funds`, which the regex classifies as `rejected` → `unpaid` → retryable, so you get N refusals, a page, and a day that will retry the same failure tomorrow. The cadence gate is correctly skipped; **solvency is not the cadence.**

**Fix.** On resume, compute `owed = Σ per[v] for v where paymentState(done[v]) !== 'paid' && !skipped`; if `owed > available`, refuse once with a named error and page. Recompute and store `total`/`dust` from the restored plan so the log is honest.

## D7 — LOW. Dust, and the things the cadence answers already handle.

Dust is bounded by `D − 1` per settlement and stays in the distributor ATA, which is next drop's `available` — it cannot grow without bound, and the "worse off than a split" delta is ≤1 sat. `dayDiff`/`d < day` are safe because ISO keys sort chronologically and the writer is the only source. The cron runs in **local** time while the ledger keys are UTC; for a 09:07 cron any offset within roughly ±9h maps to a stable UTC date, so no day is skipped or doubled — but nothing pins `TZ` and nothing says why that is safe. One line in `cron-install.sh` (`TZ=UTC`) and a comment removes the question permanently.

Two smaller ones: `nothingToDo` is never cleared if a held day later pays, which suppresses `distribution_unfinished` for the rest of that day's life; and `describeCadence(8)` prints **"monthly"** on a customer-facing settlement line for an 8-day gap, against a card that promises exactly three words.

## D8 — the deleted `allocate()`: nothing else depended on it. Confirmed — no importer in `bank/`, `scripts/` or `tests/`. But see M/R5 below: the file's own header still describes it.

---

# R3 — `scripts/bank-sign.sh` (never audited)

Quoting, `--` guards, symlinked `$0`, FIFOs and devices (`-f` refuses them), argv length (≈1,644 chars against a ~2MB `ARG_MAX`), and `${LIVE[@]+"${LIVE[@]}"}` are all correct. `exec` means cosign's exit code is not swallowed on the success path. Four defects:

## S1 — MEDIUM. The base64 filter does **not** fail clos