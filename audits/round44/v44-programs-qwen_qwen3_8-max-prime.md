# Round 44 — independent audit of the v6 final tree

I audited what is actually in this bundle: the five programs (`SEAL`, `MINT`, `BURN`, `GOV`, `SWEEP`), their manifests, the suite/sim source, `web/` (pages, ceremony, metadata generator, RPC proxy), the launch value files, the runners, and the round-43 verdicts. I re-derived the accounting, the pairing, the introspection, the offsets, and the Merkle scheme from source rather than trusting the prior verdicts.

I did **not** find a new CRITICAL, HIGH, or MEDIUM defect in the five programs. I am stating that as a result of tracing the code, not as agreement with the author. Below is what I verified, the few genuine observations I can defend, and — importantly — what this pass *cannot* see.

---

## R0 — Round 43's verdict and repairs

**Verdict on the verdicts:** I re-checked the mechanisms, not the conclusions.

- **V43-1 (host owner extracts a nested vault during their own crack).** I confirm the *mechanism* from source independently: `open_for_redemption` (`programs/cbob-vaults/src/lib.rs:225-248`) walks only for the paired `burn_vault` and places **no restriction on instructions between open and burn**; Core `ExecuteV1` invokes whatever program the caller names; `PermanentFreezeExecute` validates only Execute, so a sealed asset is still transferable by its owner. The redemption path therefore genuinely permits `[open(H), ExecuteV1(H){Core TransferV1(V→owner)}, sweep, burn(H)]` with V undeclared, because `burn_vault` refuses only a *declared* `AssetV1` (`programs/cbob-vault-burn/src/lib.rs:350-354`). This is real. I agree it is LOW and outside (a)-(d) *on the recorded ruling*, and MEDIUM-in-(b)/(d) if Gary reads review-35 M1 as "a misdirected vault must never reach a live host's owner." That is a ruling only Gary can give, and it is the single decision that could force a SEAL change before step 11. **This must be resolved before step 11.**
- **V43-2 (stale e2e header).** Confirmed: `web/test/e2e-localnet.mjs:15-17` still describes the pre-round-39 rescue rule while the arms at `:231`/`:239` assert the opposite. Comment-only, correctly INFO.
- **V43o-1 (release gate).** `release_gate()` is present in `scripts/run-tests.sh` and reads correctly: outside a rehearsal tree it requires `git diff --quiet RELEASE_COMMIT -- programs Cargo.toml Cargo.lock`; inside one it requires the program diff to equal the recorded id-swap byte-for-byte. I could not find a bypass in the bundled code.
- **V43o-2 / V43o-3 (alarm unreadable-sig skip; reveal-run extraction).** These live in `bank/alarm.mjs` / the reveal runner, which are **not in this bundle** (see finding F-1). I cannot independently re-verify them this round.

The Core re-pin claim (deployed Core == `30dce56b…`) I can only confirm *structurally*: the probe and selftest arms exist in the bundled runners, but I cannot re-run them here.

---

## R1 — Custody / the open↔burn pairing

I attacked the pairing and could not break it:

- The SEAL walk is forward-only from `current+1` and requires asset **and** owner match; the BURN walk is backward-only and requires the same. Cross-pairing (open A / burn B) fails both directions; ordering is enforced because each walk only sees the correct side. A burn placed before the open satisfies neither walk.
- Both walks read top-level instructions only. A CPI-wrapped open or burn resolves to the *outer* instruction's index/program, so a wrapper cannot supply the matching instruction; this is consistent with the measured WR.1–WR.4 refusals.
- Atomicity holds: any failure of the burn (emptiness proof, rate limit, Core burn) reverts the thaw. There is no transaction state in which a vault is thawed but unburned.
- `retire_redeemed` is correctly confined: `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1` plus instruction-introspection of the *current* top-level instruction being BURN's `burn_vault` for this asset. A direct call fails the stack check; a wrapper CPI fails the program-id check. Both are needed and both are present.

I found no path that lets a non-owner extract value from a sealed vault.

## R1s — Sweep helper

I traced every sub-question:

- **(a)** Direct invocation requires `signer.is_signer`; a vault's asset-signer PDA can only be signed by Core `ExecuteV1`, which is owner-gated. A frozen (sealed) vault refuses `ExecuteV1` via `PermanentFreezeExecute`, so the helper is unreachable outside a redemption. Holds.
- **(b)** Duplicate source: the first pair closes it; the second `read_token` reads a zeroed account whose owner ≠ signer → `IllegalOwner`. Source-as-destination is impossible because signer ≠ dest and an account cannot be owned by both. Zero/odd pair counts are refused. Holds.
- **(c)** `dest` is not compared to the asset owner. **This is safe only because invocation is owner-gated** — the owner is choosing where their own value goes. See F-2.
- **(d)** The lamport sweep reads `signer.lamports()` at execution and moves all of it. A later same-transaction credit to the PDA would make `burn_vault` refuse (revert), which is self-grief only. Holds.
- **(e)** BURN's reserve loop `continue`s an account that is not token-owned or is shorter than 165 bytes. I satisfied myself this is safe: a reserve ATA that *holds value* is necessarily Token-owned and 165 bytes (it cannot be closed while non-empty, and its owner/size cannot be changed without the Token program), so the skip only ever applies to genuinely empty/closed accounts. This rests on SPL-Token's close-requires-zero-balance behaviour, which the suite measures but which I could not re-derive from bundled source alone — noting it as a dependency, not a defect.
- **(f)** The measured 1,061-byte shape plus page additions stays under 1,232; strays that do not fit are dropped to `left`, so the base redemption always fits. Holds.

## R2 / R2b — Pool and boost accounting

I re-derived the accumulator invariant `pool ≥ ceil(owed_scaled / ACC_SCALE)`:

- `credit`: `delta = floor(avail·S/w)`, `owed += delta·w ≤ avail·S`, so `ceil(owed_new/S) ≤ ceil(owed_old/S) + avail = balance`. Maintained.
- `claim`: transfers `pay = floor(pending/S)` and subtracts `pay·S` from `owed_scaled`; the sub-sat remainder stays in `carry`. Pool balance and owed both drop by `pay`. Maintained.
- `reweigh` (boost/expiry): preserves the vault's owed via `carry`, adjusts `total_active_weight` by the delta, leaves `owed_scaled` unchanged. No value created or destroyed.
- `join` sets `debt = weight·acc`, so a joiner is owed 0. `retire` subtracts the vault's pending from `owed_scaled`. The `JoinWaitingFirst` and `BoostsExpireFirst` gates prevent the skip-ahead cases.
- `pending_count` / `pending_this_epoch` bookkeeping is consistent across request, epoch-advance, join, and retire-while-pending (including the earlier-epoch retire case).

I could not construct a double-credit, a negative-owed, or a pool-drain path. The boost ring (RING=64, max 63 epochs) cannot collide because a boost must be expired before any distribution advances past its end epoch. This matches the extensive suite coverage; I found no gap.

## R3 — Level draw

Domain separation (leaf `0x00`, node `0x01`, sorted pairs) prevents second-preimage. Reveal is strictly FIFO by `mint_index`; a burned vault still draws so the queue cannot stall. The residual manipulations (C-leader grinding, lapse-for-reroll) are limits 25/26 and I found nothing beyond them.

## R4 — Governance

I re-checked the thresholds: quorum, threshold, 10% turnout, and the 50%-of-snapshot key-change rule all use the *snapshotted* divisor and ceiling division; `need > 0` guards prevent a zero bar. Double-vote is blocked by the asset-seeded `VoteRecord`; `VaultTooNew` blocks post-snapshot vaults; `executed` is set inside the atomic CPI so a failed action reverts it. The per-kind ordering marks (`last_round_id` etc.) and the skip-not-revert behaviour are consistent and prevent an overtaken action from reviving a superseded decision. I found no minority-carry or money-reach path; the immutable fields (`split_bps`, destinations, `max_supply`, royalty) have no governing instruction.

## R5 — Charter claim

Merkle-by-address is sound (lookalike cannot verify); the PoB must be live, owned by the signer, and is burned by CPI in-instruction so it cannot be replayed; `pob_extra` accounts are never passed as signers. The hot-wallet exposure during the window is limit 46 and I found nothing beyond it.

## R6 — One-time configuration

`initialize` refuses default treasury/operator, zero PoB root, non-reserve payment mint, and out-of-bounds windows/bounds. The remaining risk is a *correct-but-wrong* ruled value locked forever, which is item 38 (open) and is a launch-process risk, not a code defect.

## R7 — Cross-program raw offsets

I recomputed the full `MintConfig` layout from the struct: total data 997 bytes + 8 discriminator, `MINT_CONFIG_SPACE` = 1,261 with padding. Every cross-program offset used by GOV/BURN matches my computation: `governance`=41, `minted_total`=141, `bare_burns_retired`=454, `charter_closes_at`=442, `sol_reserve`=257, `max_sweep`=266, `cooldown`=274, `sales_stopped`=191, `sweep_stopped`=192, `sales_stopped_at`=518, `sweep_stopped_at`=526, `sweep_floor`=631, `cooldown_ceiling`=639, `reserve_ceiling`=647, `max_boost_weight`=711, `max_boost_epochs`=712. `VaultRecord.mint_index`=41, `BurnConfig.burned_total`=42. The sweep helper's token offsets (0/32/64, len 165) are the standard SPL layout. **No offset error found.**

## R8 — Suite / sim / build as evidence

The suite pins refusals to named error codes (`because()`), asserts floors equal counts, and measures byte sizes and CU. `build-mainnet.sh` proves which init key each of the four keyed programs carries (behaviourally) and that the sweep helper's mainnet bytes equal the tested localnet bytes. I found no arm that structurally cannot fail. My limitation is scope (F-1), not a flaw in the visible tests.

---

## Findings

### F-1 — INFO (audit scope, not a code defect): most of `bank/` is not in this pass's bundle
The off-chain components that actually move value or gate liveness — `bank/crank.mjs`, `bank/revenue.mjs`, `bank/swap.mjs`, `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/layout.mjs`, `bank/selftest.mjs`, `bank/accrual.mjs`, `bank/lock.mjs` — are **not present in this bundle**. Only `bank/txread.mjs` and `bank/sigwalk.mjs` (detection helpers that move no value) are here. Consequently my review this round covers the five programs and `web/`, **not** the full off-chain pipeline, and I cannot independently re-verify round-43 repairs V43o-2/V43o-3 or the crank's `rescue_nested` wiring from this bundle. **Evidence if I'm wrong:** the files exist and were simply omitted from the prompt; re-bundle them and this finding closes. **Fix:** ensure the confirmation round that certifies the off-chain pipeline actually carries those files; do not let a "clean" programs verdict be read as certifying `bank/`.

### F-2 — INFO (dependency concentration, confirms limit 40 consequence #3): the sweep helper has zero defense-in-depth on destination or authority
`programs/cbob-vault-sweep/src/lib.rs` performs no check that `dest` is the asset owner, and no check on *who* authorized the invocation beyond `signer.is_signer`. Its entire security is Core's `ExecuteV1` owner rule. This is by design and already stated, but I confirm from source that there is **no** secondary control inside the helper: a Core upgrade that widens `ExecuteV1` authority would immediately permit a non-owner to drain a thawed vault through this exact program. **Evidence:** the helper's only guards are `signer.is_signer`, `signer != dest`, and per-pair owner/mint checks (lines ~45-60); there is no owner-of-asset comparison. **Fix:** none available without changing the helper (immutable at lock); this is a reason to treat any Core `ExecuteV1`-authority change as an emergency. Not a new defect; recorded so the concentration is not forgotten.

### F-3 — INFO (documentation): `web/test/e2e-localnet.mjs` header still describes the rejected rescue rule
Same as round-43 V43-2; I confirm it is not yet corrected in this tree (`:15-17`). Comment-only. **Fix:** as round 43 stated.

No CRITICAL / HIGH / MEDIUM findings in the five programs this round.

---

## The four accepted-limit questions

1. **Is any limit worse than stated?** I did not find one that is. Limits 26, 27, 28, 32, 40, 44, 46, 47 all read, to me, at or below their stated severity. The one that comes closest is **limit 58 / V43-1**, where the *stated* outcome ("rescued to the Squads") is in a race with the host owner's extraction; that is not "worse than stated" so much as "the statement omits the race," and it is exactly what V43-1 repairs.
2. **Is anything listed as a limit not actually a limit?** I did not find a listed limit that is already closed. Limit 27's dead-weight window is genuinely real until the crank retires the burn; limit 9's missing continuous foreign-asset detection is genuinely absent until the redeem page is published.
3. **Is any DISCHARGED item not actually discharged?** The discharged items I could check against bundled code (14 duplicate attributes, 19 unlevelled halt, 30/31 cadence removal, 33 notice exercised) do appear discharged. I could not re-verify discharged items that depend on `bank/` (e.g. anything resting on the crank/distributor deletion) because those files are not bundled — see F-1.
4. **Is any OPEN-AND-BLOCKING item being quietly treated as accepted?** Items 22, 38, 50, 52, 53 are still described as open and I see no code that papers over them. The one risk is that a "launch-clean" programs verdict is used to imply item 22 (live rehearsal) is done — it is not, and only a human-run dress rehearsal closes it.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

AI audit structurally cannot do the following; these are the things that must be done by humans/live execution before launch, because no amount of additional AI reading substitutes for them:

1. **Run the live mainnet dress rehearsal with real value (item 22).** AI can reason about the crank, alarm, and revenue cycle, but cannot observe real RPC rate limits, real Pyth feed staleness, real Orca/Meteora liquidity/slippage, real DAS index lag, or a transient failure on vault 1,900 of 2,100. Only a live run produces that evidence. This is the single most important thing AI cannot do.
2. **Verify deployed bytes and remove the upgrade authority.** AI can prove *which key* a build carries and *what* the bytes should be, but a human must actually deploy, dump the on-chain bytes, compare, and then run `set-upgrade-authority --final`. The immutability step is a human act; if it is skipped or done wrong, every "immutable" guarantee above is void.
3. **Protect the hot keys.** The swap operator key, the $CBOB release wallet, the guardian wallet, and the PoB collection key are custody/operational risks that no code audit can assess or fix. Their compromise is bounded only by process (hardware isolation, multisig, monitoring), which AI cannot provide.
4. **Decide the V43-1 ruling.** Whether a misdirected vault may be kept by a live host's owner is a product/legal decision, not a technical one, and it gates whether a SEAL change is required before the lock. Only Gary can answer it.
5. **Confirm third-party programs will not be upgraded hostilely.** Core, Orca, Meteora, and Pyth are all upgradeable by keys this project does not hold. AI can flag the dependency; it cannot prevent or even detect a future malicious upgrade in advance. Ongoing human monitoring is required.
6. **Validate holder comprehension.** Whether real holders will read the warnings, tick the right boxes, and avoid sending vaults to deposit addresses is a human-factors question no code audit answers. The honest-list disclosures only work if holders actually read them.
7. **Keep the off-chain watcher alive.** The alarm/crank must actually run after launch. AI certifies the logic; it cannot guarantee the process stays up, is not wedged, or that someone acts on a CRITICAL page.

The programs, as bundled, are the most heavily scrutinized part of this system and I found no new blocking defect in them. The residual risk is concentrated exactly where AI audit is weakest: the live run, the key custody, the human launch steps, and the third-party programs this project rests on.