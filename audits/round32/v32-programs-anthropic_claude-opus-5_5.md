# Round 32 Independent Audit: CBOB Vaults v6 at the post-round-31 tree

## Result

**Programs: no CRITICAL, HIGH or MEDIUM defect survived my reading.** I recomputed every raw offset, re-derived the money invariants, and attacked the pairing, the sweep helper, the pool, the boost ring, the draw and governance. Every attack path I tried is refused by code that is present in the bundle.

What survives is:

- one LOW in the build and evidence chain (R8);
- two accepted limits that are worse than written (25/26 and 47);
- one conditional off-chain finding, which needs a measurement before it can be confirmed or refuted;
- a handful of INFO items.

I do not claim these are all the defects. They are what survived my own falsification attempts.

**Scope.** I could not read `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/crank.mjs`, `bank/swap.mjs`, `bank/revenue.mjs` or `bank/accrual.mjs`; they are not in this bundle. Any claim below about them rests on the text in SPEC.md.

---

## R0. Round 31's verdict and repairs

**Repairs verified as present in this tree:**

| Item | What I checked | Status |
|---|---|---|
| L1 (coverage gate) | `scripts/audit-coverage.sh` `first_line_quorate` requires the exact anchored headline `# Round N, FOCUS pass: [NOT ]CLEAN; QUORUM MET`. The eight selftest cases cover both directions, including "QUORUM FAILED", line-6 placement and wrong-focus labels. | Holds |
| D2 (probe usage line) | The `probe-mainnet-facts.mjs` header now names itself. | Holds |
| Offsets | The round-31 claim that "every offset and space is correct" agrees with my independent recomputation in R7. | Holds |

**Residual on L1 (INFO).** For legacy rounds that have only a bare `VERDICT.md`, `combined=True` accepts either label. So a file headed "PROGRAMS pass … QUORUM MET" also credits the OFF-CHAIN bundle whenever a `MANIFEST-offchain.json` exists with a counted quorum. No current misclassification follows; it only matters for pre-split rounds.
- *Fix:* when `combined`, require the label to match `focus`, or require both headlines in the file.

**Round 31's refutations re-derived.** These are mine, not borrowed:

- **W2 (pre-funded PDA squat).** Anchor 0.31 `init` handles lamports already sitting at the address. The suite's 7.12d lands a proposal at a pre-funded PDA.
- **W3 (undeclared Token-2022 account).** BURN's second loop iterates only the declared `remaining_accounts`. An undeclared account is never read.
- **W4 (alias pair).** Either the closed source yields `IllegalOwner`, or the owner mismatch yields `InvalidAccountData`.
- **W1 (heap).** I cannot re-measure it. The bound it rests on (Core data ≤ 10,240 bytes per CPI) is a real runtime limit, and its reasoning is consistent.

---

## R1. Custody

**Conclusion: no path lets anyone but the owner move value, and no path lets an emptied vault survive.**

**Pairing.**
- SEAL scans only *subsequent* top-level instructions. BURN scans only *preceding* ones.
- Both bind account 0 (the asset) and account 2 (the owner). I checked these positions against `OpenForRedemption` and `BurnVault`.
- The `owner` Signer on `burn_vault` makes the bound key an actual signer.
- A CPI-reached `open` reports the outer index, and the wrapped `burn` is invisible to SEAL. WR.2 and WR.3 measure both cases.

**Thawed vault leaving unburned.** The thaw can persist only if the matching `burn_vault` succeeds, and that burn destroys the asset. Two further cases also revert:
- transferring the thawed asset between open and burn fails the burn's owner check;
- Execute-driving another vault's open from a thawed PDA fails because BURN needs a top-level owner signature, which a PDA cannot give.

**Emptiness proof.**
- Reserve ATA addresses are ATA-program PDAs, so only the ATA program can create them. A Token-2022 ATA for a classic mint is refused (probe F4.2).
- A closed account is skipped. The measured SR.4 shows the close reassigns it in-transaction.
- A declared live Core asset is refused.

## R1s. Sweep helper

**(a) Who can make it move value.**
- Only a signer of `accounts[0]` can. Through Core, that is only the asset owner, measured on the pinned binary (SR.5, SR.5a, SR.5c).
- The SEAL PDA can sign only through SEAL, whose sole CPI is `UpdatePluginV1`.
- While the vault is frozen, `ExecuteV1` is rejected by PermanentFreezeExecute (3.7, S6.2).
- Direct calls by anyone else move only the caller's own accounts.

**(b) Pair list.**

| Case | Result |
|---|---|
| Duplicate source | Second read sees the closed account → `IllegalOwner` (SR.12a) |
| Duplicate destination | Fine |
| Source = destination | Impossible: `src_owner == signer ≠ dest == to_owner` |
| Native wSOL source | Moves amount; close returns rent |
| Delegate or close authority on source | Requires the asset-signer's signature to set; self-inflicted |
| Frozen source | Reverts the redemption (SR.14) |
| Non-ATA destination | Allowed |
| Another vault's asset-signer as destination | Allowed; the owner's choice |
| Odd account list | Refused |
| Zero pairs | Lamports-only sweep works (SR.13) |

**(c) Destination checks.**
- Safe given (a).
- A below-rent credit to a non-existent account is refused by the runtime, which is the owner's choice.
- An executable destination reverts.
- A token-owned destination is credited (R27.S1).

**(d) Lamport sweep.** Inside the owner's own transaction nothing but the owner can deposit after the sweep. Core Execute moves no lamports out of the signer (SR.4a is exact).

**(e) Interaction with BURN, and stranger-created accounts.** The closed account passes for the right reason: it is no longer token-owned. If the reserve ATAs are created in the prior transaction, the account set is complete. The accounts a stranger *can* create for the vault are:
- non-ATA classic accounts;
- Token-2022 accounts at non-ATA addresses;
- nested assets.

These are all *undeclared*, so they are **destroyed, not blocking** (limit 44). I found no stranger-creatable account that blocks a redemption.

**(f) Fit.**
- 1,061 bytes measured, plus 52 (compute budget) plus 96 (separate payer) ≈ 1,209 bytes.
- A fourth pair costs about 66 bytes and does not fit legacy.
- The in-line monthly run adds no accounts; the pool is already passed through BURN.
- This matches SPEC.

**(g) Evidence and bytes.**
- The helper's bytes are identical in `dist/`, the localnet rebuild and `target/deploy/` by `cmp`.
- See R8 for a gap that applies to the other four programs.

## R2. Pool invariant

**Claim: the pool always holds at least `ceil(owed)`.** The argument:

- **`credit` keeps the invariant.** It adds `delta·w`, with `delta = floor(avail·S / w)`, so `delta·w ≤ avail·S`. Hence `ceil(owed') ≤ ceil(owed) + avail = balance`.
- **`claim` keeps it exactly.** It removes `pay·S` from `owed` and `pay` from `balance`, so `ceil(owed − pay·S) = ceil(owed) − pay`.
- **`reweigh`, `join` and `retire` only lower or preserve `owed`.**
- **`owed_scaled` equals the sum of each live vault's `owed_of`.** `total_active_weight` equals the sum of weights, because every weight change goes through `join`, `reweigh` or `retire`.
- **No other instruction can move pool tokens.**

**SPEC's weaker rule** (a vault is never credited by a distribution before its join) holds by `JoinWaitingFirst` plus the epoch rule.

**Counters.** `pending_this_epoch` is decremented in `retire` only when `request_epoch == dist_epoch`, and it is reset at each `advance_epoch`. I found no ordering that underflows it.

**Liveness.**
- Joins need no live asset and no existing destination, so they cannot be blocked.
- A batch can be reverted only by a missing destination. For a live vault the destination cannot be closed outside a redemption.

## R2b. Boosts

**Exactly N distributions.** Credits run at boosted weight for the epoch transitions `e→e+1` … `e+N−1→e+N`. At `e+N` the boost becomes due and the next distribution is gated. The host tests cover this through the program's own functions, across four ring wraps.

**Other properties I checked:**
- `tick` occurs only when `w = 0`, so it never intersects an active boost.
- The ring cannot collide, because N ≤ 63.
- `unschedule_boost` handles both branches.
- A duplicate record in a batch is skipped on its second load.

**No defect found.**

## R3. The draw

**Parse and window.**
- The SlotHashes parse is bounded and fails closed.
- C is at most `r+208` slots, inside the 300-slot window.
- A is still within the buffer when captured.

**FIFO.**
- A burned head is drawn without the Core write.
- A captured entropy has no deadline.

**HOLDER-GUIDE accuracy.** Its "can pick among several results … every vault created in that moment" is true.

**But it is worse than SPEC 25/26 state — see Finding 2.**

## R4. Governance

**Ordering and bundles.**
- MINT re-checks every action against bounds GOV already enforced at creation, and those bounds are immutable. So no bundle can revert after it passed.
- Skips are per kind. The `StopIsNewer` comparators agree (GOV `>=` against MINT `<`).

**Thresholds.**
- `ceil` quorum.
- Turnout dominated by quorum × threshold at the ruled values (limit 35, correct).
- The key-change half-bar uses the snapshot.

**I found no minority path and no money path.** The permanent-freeze exposure is worse than SPEC 47 states — see Finding 3.

## R5. Charter

**Merkle.**
- Domain-separated, sorted pairs, proof bounded at 16.
- The leaf must also be a live Core asset in the PoB collection, owned by the signer.

**Pass-through.** Extra accounts are never signers.

**SPEC 46 completeness.** It already covers rejecting hooks, selective approval, removal from the collection, and sampling gaps. One addition: a hook that requires more than 8 extra accounts (or more than 4 in the padded legacy shape) bricks claims exactly as a rejecting hook does. This is the same class, stated implicitly, so it is not a new finding.

## R6. Initialization, the trusted hop, royalties, rate limit

**Initialization.**
- SEAL checks only that each reserve mint's account is owned by classic Token.
- A wrong, duplicate or incomplete reserve list with the right collection and payment mint is accepted. The missing mint would then be destroyed on every redemption.
- SPEC already states this (A6, item 38). See Finding 6 for the missing gate.

**Swap operator.**
- Worst case: cap × windows, at most the revenue balance above the reserve. At the ruled values that is about 40 SOL a day until the guardian stops it.

**Royalties.**
- Authority is None. MINT never CPIs into an asset-level `AddPlugin`. The owner cannot add one (R.8).

**Rolling window.** It is exact for half-open windows `(t−W, t]`; see Finding 7.

## R7. Raw reads

**Recomputed from the structs — all match:**

| Struct | Fields checked | Space |
|---|---|---|
| MintConfig | `minted_total` 141, stops 191/192, `sol_reserve` 257, `max_sweep` 266, cooldown 274, `charter_closes` 442, `bare_retired` 454, stop times 518/526, bounds 631/639/647, `max_boost_w` 711, `max_boost_e` 712, ring 749..1005 | 1,005 + 256 = **1,261** |
| VaultRecord | through `carry` 195..211 | **221** |
| BurnConfig | `burned_total` 42 | **827** |
| SEAL Config | — | **398** |
| GOV Proposal | `ACTION_MAX_BYTES` 37 is the maximum (Brakes) | — |

The sweep helper's token offsets (mint 0, owner 32, amount 64, length 165) are also correct.

---

## Findings

### F1 — LOW (R8): nothing binds the tested bytes of the four keyed programs to the commit being certified

**Construct.**
- `scripts/build-mainnet.sh` compares only `cbob_vault_sweep.so` against `target/deploy/`.
- For SEAL, MINT, BURN and GOV it merely *prints* the `target/deploy` hashes.
- `scripts/run-tests.sh` records no commit, dirty state or artifact hashes in `suite.log`.
- `sim/run-sim.sh` silently overwrites `target/deploy/`.

**What goes wrong.** Suppose MINT is edited after the suite last ran and then committed. `build-mainnet.sh` still passes: the source checks pass, the sweep `cmp` passes because the sweep is unchanged, and the key arms pass. Its banner then presents the stale `target/deploy` hashes as "the suite DEPLOYED".

**Evidence if I am right.** In a scratch clone:
1. run `run-tests.sh`;
2. change a constant in MINT and commit;
3. run `build-mainnet.sh`.

It exits 0, and `$CACHE/ln/.../cbob_vault_mint.so` differs from `target/deploy/cbob_vault_mint.so`.

**Fix.**
- In `build-mainnet.sh`, `cmp` all five `LN_DIR/*.so` files against `target/deploy/*.so`.
- Have `run-tests.sh` write `commit`, `dirty` and the five sha256 values as the first lines of `suite.log`.
- Have `build-mainnet.sh` require that header to equal `HEAD`, clean.
- Also enforce the `platform-tools v1.54` pin in `build-mainnet.sh`. Today it only records it, and the whole "reproducibility bridge" depends on it.

### F2 — LOW (accepted limits 25 and 26 are worse than written): a re-roll moves every queued draw behind it

**Construct.** `reveal_level` draws `u64(entropy) mod remaining`, walking a census that every earlier draw has changed.

**What goes wrong.** A lapsed head that is rescheduled, or a cohort ground by C's leader, does more than re-roll its own vaults. It **re-maps every later vault whose entropy is already captured**, because those vaults' fixed `r` values meet a different census at their turn.

**Who gains.** A holder with one uncaptured vault at the queue head and any captured vault behind it gets a **joint** selection over both levels. C's leader likewise chooses, in effect, for the whole tail of the queue.

**What SPEC says.** "*Who:* the census" is true, but SPEC reads as if one vault, or one cohort, is re-rolled. It does not say that already-captured, unrelated vaults change.

**Evidence if I am right.** A host test: fix entropy for vaults k and j > k, vary only k's level, and observe j's level change for some `r_j`. This is computable by hand from `drawOf`.

**Fix.**
- Documentation in SPEC 25/26 and the holder guide.
- No on-chain fix preserves exact quotas, since every without-replacement draw is coupled.
- A VRF does not remove the coupling either; it removes only the grinding.

### F3 — LOW (accepted limit 47, and quorum generally, are worse than written): unreachable vaults inflate the governance denominator forever

**Construct.**
- `quorum_supply = minted − burned − bare_retired`.
- These vaults can never vote, and can never leave live supply:
  - lost keys;
  - vaults sent to their own or another vault's asset-signer (proven impossibility 3, SPEC "What got worse");
  - vaults inside a burned host.
- Only `retire_burned`, which needs a tombstone, or a BURN redemption, which needs the owner's signature, can remove a vault from live supply.

**What goes wrong.** The "half of ALL live vaults" bar for replacing the guardian or the operator is measured against a denominator that only grows with such losses.

- With 15% of vaults unreachable, a key change needs **59%** of the reachable vaults voting YES.
- With 30% unreachable, it needs **71%**.

So limit 47's "permanent at low turnout" becomes structurally more likely over time. The same vaults also loosen BURN's cap slightly.

**Evidence if I am right.** Arithmetic on the GOV code. Suite 9.5/9.6 already produce an orphan, and P.29's formula shows it stays in `quorum_supply`.

**Fix.**
- State this in SPEC 47 and in "What got worse".
- Pre-lock, an owner decision: a `retire_orphaned` path for vaults owned by a burned asset's signer PDA. This was already listed as round-30 A13 for payouts; this adds the governance consequence.

### F4 — MEDIUM if measured true, otherwise nothing (off-chain): `sigwalk` treats any short page as the end of history

**Construct.** `bank/sigwalk.mjs` returns `gap:false` as soon as `batch.length < limit`. The round-30/31 positive proof covers only a resumed walk that comes back *empty*.

**What goes wrong.** If an RPC ever returns a short but **non-empty** page while older signatures remain, the cursor advances past unexamined transactions **silently**. Short pages are plausible at a blockstore/long-term-storage boundary, or under provider-side truncation.

**Evidence that would settle it.** On mainnet, walk the busy ATA program with `limit = 1000` and again with `limit = 100` over the same `until`. Any signature present in one walk and absent from the other confirms the finding. If the two walks are identical across many samples, including deep `before` values, it is refuted.

**Fix.** When a walk ends short with `until` set, prove continuity: query `before = last returned signature, limit = 1, no until`, and require that the result is exactly the cursor. Otherwise keep the backlog and page `scan_backlog_unproven`.

### F5 — INFO (R8): hex error pins have no delimiter

**Construct.** `because('3.7', '…0x9')`, `('3c.F1', '0x11')`, `('11.13', '0x1a')`, and `R.6`'s `'0x9'`, all use substring matching.

**What goes wrong.** The pin for `0x9` would also accept `0x90`–`0x9f`. Separately, `S6.2` and `R.6a` pin only "Core … failed", not which Core error.

**Effect today.** No wrong-reason pass is possible today: the ranges of Core and Token error codes are small.

**Fix.** Match `/0x9\b/`. Pin `S6.2` to `0x9`, as 3.7 already does.

### F6 — LOW (operational gate missing from road step 11)

**Construct.** Road step 10 initializes the four programs; step 11 removes the upgrade authority.

**What goes wrong.** Between those two steps the upgrade authority still exists, so item 38's "can never be corrected" is not yet true. More importantly, **no stated gate reads the four configs back** before the irreversible step 11. `check-launch-params.mjs` validates the JSON, not what was actually signed. The SEAL reserve list (any duplicates, any wrong mint) is exactly the value whose error the programs accept and which destroys holders' tokens.

**Fix.** Make step 11 conditional on a script that:
- decodes SEAL, MINT, BURN and GOV from mainnet;
- compares every field, including reserve-list order and uniqueness, the pool ATA, governance and `cbob_mint`, against `launch/mainnet-init.json`;
- confirms all three cbBTC accounts exist (item 52);
- writes the result into the lock record.

### F7 — INFO: the rolling-window boundary

**Construct.** The rate check is `now − kth ≥ W`.

**What goes wrong.** A closed interval of exactly 3,600 s can hold cap + 1 redemptions. The documents' "no hour, starting anywhere, holds more than the cap" is true only for half-open windows, which is what RL.7 measures.

**Fix.** State the semantics in SPEC, or use `>`.

### F8 — INFO (documentation)

DESIGN-v6 contains three inaccuracies:
- §1 says the mint index "is recorded on the asset". It is recorded in the `VaultRecord`.
- §3 says `burn_vault` "requires the vault's stake record to be claimed earlier". It actually requires owed < 1 sat, or a frozen pool; no `claim` instruction is required.
- §4 names `sales_paused` and `sweep_paused`. The code uses `sales_stopped` and `sweep_stopped`.

---

## The four questions about the accepted limits

1. **Worse than stated:** 25 and 26 (F2), and 47 (F3, together with the quorum generally).
2. **Not actually a limit:** none found. Item 42's narrow 1,219-byte shape is already disclosed.
3. **Discharged but not discharged:** none broken. Item 54's "crank unaffected" still rests on an extrapolated 14-vault claim batch, which SPEC states. A one-shot measurement would close it.
4. **OPEN items treated as accepted:** none. However, items 22, 50, 52 and 53 (the rehearsal value set, and `check-launch-params` rehearsal mode, both "not built") have no artifact in this tree, and F6's read-back gate is missing from the road entirely.

---

## Given that no human firm will ever see this and the programs will be immutable

What this project should do before launch that AI audit structurally cannot:

1. **An independent reproducible build by a second person on a second machine.** Use the pinned toolchain from a clean clone at the release commit, and publish matching sha256 values for all five `.so` files before deploy. After deploy, compare `solana program dump` output against them. AI cannot attest to bytes it never sees being built.

2. **Verify the pinned Core binary against Core's source.** Every access-control argument (Execute is owner-only, Royalties authority None, permanent plugins are create-only) was read at `e72d63e`, and SPEC admits that source "is not proven identical to the pinned binary". Do a verified build of Core at that commit and match it to `f03e7537…`, or obtain the hash from Metaplex in writing.

3. **Instruction-level fuzzing against real Core, for days.** Use LiteSVM or `solana-program-test` with the pinned Core and Token bytes. Run random sequences of all host instructions — mint, claim, activate, distribute (both paths), boost, expire, retire, redeem, split, freeze and thaw — across many vaults. After every step, check the BK ledger invariants (`owed == Σ shares`, pool ≥ ceil(owed), ring + due = active, the counters). The host tests exercise free functions only; this would exercise the handlers.

4. **A long adversarial mainnet canary at throwaway IDs**, beyond the dress rehearsal. Run it for weeks with real small cbBTC. Pay outside people a bounty to break custody or the pool, and to run the alarm, crank and revenue cycle. Include a forced Coinbase-like freeze test, using a mint you control with a freeze authority.

5. **A signed, recorded launch ceremony.**
   - Gary's wallet signs each `initialize` built directly from `mainnet-init.json`.
   - The F6 read-back runs.
   - Only then is `--final` applied to all five programs.
   - Every signature goes into a published lock record.
   - The guardian and INIT_AUTHORITY wallet should be a hardware wallet during the ceremony.

6. **Close the Moments-key exposure operationally.** It is ruled hot, but for the 7-day window someone should be watching the collection *and* the 240 individual assets every minute, with a pre-written response. The 30-minute alarm samples only the collection account.

7. **Settle F4 with the paired-limit walk** described in that finding before the alarm is trusted to be the only detector for limits 9 and 44.