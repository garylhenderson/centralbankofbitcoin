# ROUND 9 — FINDINGS

---

## 1. HIGH — `mint.pending_bank` is watched by two detectors and populated by neither. `bank/alarm.mjs :: readConfigs`

`MintConfig` lays out (verified against the `Initialize` space arithmetic, which sums to exactly 449): `pending_admin_at@401`, **`pending_bank@409`**, `pending_bank_at@441`. The mint field list in `readConfigs` ends at `['pending_admin_at',401,'i64']`. Offset 409 is never read.

Consequences, both of which the report renders as "quiet":
- `detectConfigDrift`'s watch row `['mint.pending_bank', CRITICAL, 'A BANK ROTATION IS ARMED']` compares `undefined ?? null` against `undefined ?? null` — never fires.
- `detectStandingRisks`' rotation loop does `const v = cur['mint.pending_bank']` → `undefined` → falsy → no finding, **every pass, forever**.

The selftest passes in both directions because it calls `detectStandingRisks({ 'mint.pending_bank': OTHER })` directly. This is precisely the round-8 `detectIndexShortfall` class: detector proven, wiring untested. Round 8's own summary asserts "`mint.bank` … and every pending-rotation slot are watched."

**Exploit.** Whoever holds MINT admin calls `update_wiring(bank: Some(attacker))`. Nothing is emitted to any watcher. `governance_timelock_secs` later, *anyone* calls the permissionless `apply_pending_bank`. Now the attacker co-signs every mint — the co-signature that is the stated defence against a mint that plants a delegate or an undeclared PDA token account. The only alarm is `mint.bank` drift *after* the rotation has landed, which is exactly what the notice period exists to prevent.

**Fix.** Add `['pending_bank',409,'pk'],['pending_bank_at',441,'i64']`. Then close the class: `readConfigs` should *assert* that every key appearing in `detectConfigDrift`'s watch list and in `detectStandingRisks`' loops is present in the snapshot (or explicitly whitelisted absent), and fail loudly otherwise. Also missing today: `gov.pending_admin_at` (offset 134), `seal.pending_bank_at`, `seal.pending_admin_at` — so the alarm can say a rotation is armed but not when it lands.

---

## 2. HIGH — the alarm is guaranteed to become permanent noise. `detectSplitClaims` + `seenSplits.slice(-200)`

`alarm.mjs` stores `seenSplits: [...new Set([...seenSplits, ...prev.seenSplits])].slice(-200)`. `detectSplitClaims` iterates **every cycle in the ledger, for all time**, and raises CRITICAL `split_not_on_chain` for any `splitSig` not in that 200-entry set. `revenue-ledger.json` is never pruned. At four cycles/day the 201st split evicts the first, and from that day on every pass raises a CRITICAL about a split that demonstrably happened. It grows monotonically. ~50 days after launch the CRITICAL section is unreadable.

Same shape, different file: one frozen destination ATA in `distribute.mjs` leaves a row with `sig: null` forever (finding 4), and `detectDistribution` iterates **all** days on **every** pass, so that one row emits `distribution_unresolved` CRITICAL every 30 minutes indefinitely.

**Fix.** Verify once and record the verdict: on seeing a `splitSig` on chain, stamp `splitVerified: true` into the cycle row and skip verified cycles; or bound the check to cycles newer than the oldest scanned window. For `detectDistribution`, take a `sinceDay` and only re-report unresolved days that are still resolvable, with a separate one-shot "aged out, resolve by hand" finding.

---

## 3. HIGH — GOV's round-8 quorum fix does not do what its comment claims: minting still buys quorum

`execute_proposal`: `divisor = max(p.quorum_supply, minted_now)`, `need = ceil(divisor * p.quorum_bps / 10000)`. The header states "a mint can now only make a proposal HARDER to pass." That is false arithmetic. Minting M vaults during the window adds **M whole votes** to `cast` and at most `M·q/10000 + 1` to `need`. Net headroom gained per mint is `1 − q/10000 > 0` for every legal `q` (q ≤ 10000, and q may be lowered to 500).

**Concrete:** snapshot 2,000, q = 2000 → need 400. A holder with 100 vaults mints 375 during the open round (owner signature is theirs, Bank co-signs an ordinary sale), votes all 475 YES: divisor 2,375, need 475, cast 475, `yes_bps` = 10000. Ratified. At q = 500 the ratio is 1.05 vaults per net vote.

**Fix** (does not reintroduce the liveness problem that killed `minted_now == quorum_supply`): make new supply quorum-neutral rather than quorum-cheap —
```rust
let new_supply = minted_now.saturating_sub(p.quorum_supply);
let need = ceil(divisor * p.quorum_bps / 10_000) + new_supply as u128;
```
Every vault minted after creation then raises the bar by exactly one full vote. Existing holders are unaffected, so an open sale never blocks a proposal.

---

## 4. HIGH — `distribute.mjs :: paymentState` conflates a REJECTED transfer with an UNCONFIRMED one; one frozen ATA means a vault is never paid again

cbBTC has a live freeze authority. When `sendAndConfirmTransaction` throws with a program/simulation error the transfer **provably did not land**, but the row is written `{ sig: null, error }` and `paymentState` returns `'ambiguous'`. On every subsequent run that vault is pushed to `ambiguous` and *never retried*, `finishedAt` is never set for that day, and the day emits a permanent CRITICAL (finding 2). The vault is unpaid for that day and there is no mechanism that ever pays it.

This is exactly the distinction round 8 added to `revenue.mjs` (`sendRejected`) — the fix landed on one of two identical sites again.

**Fix.** Classify the throw the way `revenue.mjs` does (`/custom program error|Error Code:|Transaction simulation failed/`), record `rejected: true`, and have `paymentState` return `'unpaid'` for it so the next run retries; keep `'ambiguous'` only for confirmation timeouts. Add a `retryable` path and a reason field so a frozen ATA is reported as *skipped and why*, not as an unknown.

---

## 5. MEDIUM — `--dry-run` silently consumes a pending CRITICAL

In `report()`, `delivered` is initialised `true` and the notify block is guarded by `if (urgent && !DRY)`. So a hand-run `node bank/alarm.mjs --dry-run` returns `delivered = true`, and `main()` writes the **full** new state: config baseline, activation, balances **and cursors**. A CRITICAL config drift or an approve-on-a-vault-PDA that the operator was investigating becomes the new baseline and the carrying transaction is scanned past. The lock prevents concurrency but not this.

**Fix.** `if (DRY) return false` from `report`, or skip `writeState` entirely under `--dry-run`.

---

## 6. MEDIUM — `reconcile()` stops looking at a vault the moment its loss becomes permanent

`for (const v of live)` — burnt vaults are excluded. Proven impossibility #4 says Core's `BurnV1` does **not** sweep the asset-signer PDA, and #2 says undeclared token accounts cannot be enumerated on-chain. So the one state that is irreversible — a burnt vault whose PDA still owns tokens or lamports — is the one state `detectUndeclaredTokenAccounts` is never run against. The evidence is destroyed from the report at the instant it becomes evidence.

**Fix.** Iterate `[...live, ...burnt]`; for burnt ids additionally report any non-zero `getBalance` on the PDA. Tag those findings `orphaned_after_burn`.

---

## 7. MEDIUM — a cursor that stops resolving turns the whole signature scan into a silent no-op

`signaturesSince` passes `until: cursors[id]`. The file's own header records the measurement: *a signature the RPC does not find in that address's history makes it return an empty list.* If a cursor is ever poisoned (provider re-index, history pruning, a state file restored from another cluster), the pass returns `sigs.length === 0`, so `cursors[id]` is not advanced (`if (… && sigs.length)`) and the condition is permanent. Approvals, burns and unledgered sweeps are then never seen again, and the report's bottom line still reads "no approvals, no unexpected PDA token accounts, no burns…". `looked.txs` reads 0 and produces no finding.

**Fix.** Store the cursor's slot alongside the signature; each pass call `getSignatureStatuses([cursor])` (or `getTransaction`) and raise CRITICAL `cursor_unresolvable` if it does not resolve, before trusting an empty window.

---

## 8. MEDIUM — `run-tests.sh` cannot be passing as written, or the floor is not the gate

`MIN_ASSERTIONS=160`, hardcoded and non-overridable, against `tests/3prog.test.ts`. The project's own claim in this brief is an **82-assertion** suite. Both cannot be true: either `run-tests.sh` dies at step [7/7] every run (`suite made only 82 assertions, floor is 160`), or the green run being cited is not this script. Either way the floor is not measuring what it claims. Verify which, then pin the suite by sha256 in the runner as well as by filename — a count floor in the same repo as the suite is satisfied by 160 trivial assertions.

Secondary, same file: `cargo-build-sbf … | grep -viE "…" | tail -3` under `set -o pipefail` exits non-zero when *every* build line is filtered out, aborting a clean build. Fails closed, but noisily wrong.

---

## 9. MEDIUM — nothing ever verifies the Royalties plugin exists, and after the governance handover it can never be installed

The business states "the collection Royalties plugin names [the revenue PDA] sole creator at 100%". No control checks that. `collection.hash` detects *changes*, not *absence*; if `set_collection_royalties` is never run — or run with `add: false` before the plugin exists, which reverts — every secondary sale earns the project nothing and the alarm is content. And `SetCollectionRoyalties` requires `governance` to *sign*, so once `config.governance` is the GOV PDA (whose only CPI is `set_round`) the instruction is permanently unreachable except via a governance rotation timelock.

The byte encoding itself checks out against Core's layout (`basis_points: u16` LE, `creators: Vec<Creator>` = `u32` len + `Pubkey` + `u8`, `RuleSet::None` = `0`, plus `Option<PluginAuthority> = None` for the Add variant only, and `AddCollectionPluginV1 = 3` / `UpdateCollectionPluginV1 = 7`). I found no wrong byte. The defect is that it is unverified and one-shot.

**Fix.** Add `collection.royalty_bps` and `collection.royalty_creator` to the drift snapshot by parsing the collection plugin registry (you already walk this structure in SEAL's `read_attributes`), and raise CRITICAL when the plugin is absent or the creator is not the `["revenue"]` PDA. Move the governance gate on this instruction to the same arm/apply pattern as the rotations.

---

## 10. LOW/MEDIUM — cluster

- **`revenue.mjs` order of operations:** the cooldown check `return`s *before* the open-cycle guard, so a cooldown longer than 6 h means the script exits 0 without ever reporting the unfinished cycle it exists to shout about. Move the open-cycle guard above the cooldown check.
- **`revenue.mjs` and `distribute.mjs` read `MintConfig` at hardcoded offsets (137/221/253/256/288/297/305/313, 41/137/205) with no discriminator and no version byte** — the exact pin the four programs apply to each other and `alarm.mjs` now applies. All paths I traced fail closed, but the money-moving scripts should refuse a layout they were not written against.
- **`split_revenue` frozen-destination stall:** cbBTC's freeze authority can freeze `holders_ata`; `split_revenue` then reverts forever and revenue accrues unsplit. Nothing detects "cbBTC sitting in the revenue ATA for N days". Add that detector — it is the one balance in the system nobody watches.
- **A ratified proposal may set `cap` up to `max_supply` at `price_lamports = 0`.** I am not re-raising a price floor (rejected twice). The equivalent bound that does not touch the charter design is a per-round cap ceiling in `set_round` (e.g. `cap <= max_supply / 4`) so no single vote can dump the entire remaining 1,911 supply — which, given that `distribute.mjs` pays an equal share per vault activated at only 21,000 sats (~$18), is also the cheapest way to capture the whole distribution stream. `set_paused` is a real admin mitigation here; it is also the only one, and it is undocumented as such.
- **`.alarm-has-run` is written before `writeState`**; a kill in that window wedges every future pass behind `--first-run`.

---

## WHAT I TRIED AND COULD NOT BREAK

- **Double-voting in GOV.** `["vote", proposal, asset]` with `init` genuinely binds one vote per asset across transfers; VoteRecord is never closed, so no close-then-recreate. A burned vault's account is closed → `*asset.owner != MPL_CORE_ID` → refused. The collection account fails `data[0] == KEY_ASSET_V1`. A Core delegate cannot satisfy `require_keys_eq!(owner, ctx.accounts.owner.key())`.
- **Executing twice, after cancel, or stale.** `executed` flag, `last_executed_id` monotonicity, `EXECUTION_WINDOW_SECS`, and `closes_at > now` all hold; `p.executed = true` precedes the CPI and the tx is atomic. Snapshotting `quorum_bps`/`threshold_bps` really does keep `update_gov_config` off votes already cast.
- **`split_revenue` destination substitution.** All three ATAs are re-derived from `config.treasury` / `config.bank_treasury` / the `["revenue"]` PDA and the caller-supplied `mint`; `token_program` is address-pinned; `decimals` is validated by `TransferChecked`. Rounding: `bank_cut` floored, `holders = total − bank_cut`, sum exact at 0, 1 and u64::MAX.
- **`sweep_sol_for_swap`.** Destination is `cfg.swap_operator`, the operator must sign, `amount > 0`, `amount <= max_sweep_lamports`, `bal >= keep + amount`, and `last_sweep_at` is stamped in the same instruction — two sweeps in one transaction share a timestamp, so the `MIN_SWEEP_COOLDOWN_SECS = 1` floor really does close the atomic bypass.
- **Account-space arithmetic** for `GovConfig` (142), `Proposal` (82), `VoteRecord` (74), `MintConfig` (449), `BurnConfig` (155) all reconcile with the declared fields, and SEAL's post-Vec pending offsets (`109 + n*32`) are correct for any legal `n`.
- **All other pending-rotation offsets** in `readConfigs` (burn 106/146, gov 102, seal computed) are right. Only MINT's `pending_bank` is missing.
- **The Royalties CPI encoding** — I looked for the wrong byte and did not find one.

---

## THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

**Read `mint.pending_bank` at offset 409 in `readConfigs`, and add a startup assertion that every key referenced by `detectConfigDrift` and `detectStandingRisks` is actually produced by `readConfigs`.** Today an armed rotation of the co-signer on every mint is invisible to the only watcher, and the selftest is green about it — the third consecutive round in which the detector was proven and the wiring was not.