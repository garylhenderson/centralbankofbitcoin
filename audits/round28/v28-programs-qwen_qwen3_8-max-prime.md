# Independent audit — CBOB Vaults v6 (tree at round-27 repairs, `e109b31`)

Method note: I re-derived every cross-program offset, account-space constant, accumulator invariant and pairing rule from the bundled source, and treated the 848-assertion suite / 71-assertion simulation / probes as *evidence to check against the code*, not as proof. Where I say an invariant "holds," I mean I could not construct a counter-example and the measurement is consistent with the code; I am not certifying absence of defects I cannot imagine. I found **no CRITICAL or HIGH on-chain defect**. I report one genuine residual (off-chain) and several verification gaps. I deliberately did not re-file accepted limits.

---

## R0 — Round-27 verdict and repairs

I verified the four program-side topics (D1–D4) are documentation/diagnostic, not logic:

- **D2 (boost price has no ceiling).** Confirmed against code: `set_boost_terms` (`programs/cbob-vault-mint`) accepts any `u64` price when `price > 0`; only `weight`/`epochs` are bounded by `max_boost_weight`/`max_boost_epochs`. I checked whether an arbitrary price breaks accounting: `cbob_burned_total += price` cannot overflow in practice because the $CBOB supply is fixed at 2.1e9 with no mint authority, so total burns are bounded; and `overflow-checks = true` would abort rather than wrap. So the program behavior is safe; the over-claim was holder-facing. The doc repair is the correct fix. No program change needed.
- **D3 (`WrongGaryMint` / `SweepAboveCap` ambiguity).** Confirmed: `WrongGaryMint` covers three distinct `require_keys_eq!`/owner checks (token-program key, mint address, mint owner) at `distribute`; `SweepAboveCap` covers both `amount > 0` and `amount <= cap`. The short runtime messages do not distinguish these. This is diagnostic only; suite 6.17b already pins the zero-amount refusal. Documenting the mapping (as the repair does) is sufficient.
- **D1/D4** are current-description fixes; I did not find a code consequence.

The off-chain round-27 repair (`bank/txread.mjs`) is where I found a **surviving residual** — see finding F1.

The earlier on-chain logic repairs (frozen-pool forfeit, round-mark-before-over-check, GOV rent-floor mirror, monthly clock start at charter close, crank ordering) are present in the source and my independent re-derivation did not break them. I confirmed `retire` correctly removes a pending vault from both `pending_count` and `pending_this_epoch` (same-epoch case), so the join gate cannot underflow.

---

## R1 — Custody / pairing / emptiness proof

I attempted the named attacks and could not break the pairing or the emptiness proof:

- **Pairing.** SEAL walks forward from `current+1`; BURN walks backward over `0..current`. Both bind `asset` (account 0) and `owner` (account 2) and match the 8-byte discriminator only. `load_instruction_at_checked` sees top-level instructions, so a CPI-hidden burn/open cannot satisfy either half, and a wrapped instruction reports the outer index. A vault transferred between `open` and `burn` makes `burn` fail `NotTheOwner` (owner bytes no longer match the signer), reverting the thaw. Two vaults in one transaction pair per-asset/per-owner and cannot borrow each other's burn. I could not construct a transaction where a thawed vault survives unburned: the thaw is a Core `UpdatePluginV1` in the same atomic transaction as the burn, so any burn failure reverts the thaw, and a successful `burn_vault` always invokes Core `BurnV1` before returning `Ok`.
- **Emptiness proof.** I recomputed the SPL token-account offsets used by BURN (owner 32..64, amount 64..72, delegate tag 72..76, delegated_amount 121..129, close-authority tag 129..133, len 165) — all correct. The reserve loop requires both classic and Token-2022 ATA derivations declared for each reserve mint; a derivation that is not a token account is skipped (correct, since an ATA address can only be a token account or absent). The second loop catches any *declared* token account owned by the PDA with non-zero balance, and refuses T22 extensions/delegate/close-authority there too. The completeness gap (undeclared non-ATA accounts, nested assets) is real but is the accepted limit, and the sweep helper recovers declared classic strays.

**No finding.** One observation, not a defect: BURN does not check the reserve account `state` byte (108). A frozen-but-empty reserve ATA would pass the emptiness check, but the sweep helper cannot transfer/close a frozen account, so the redemption reverts earlier — consistent with accepted limit 28. Nothing is hidden because a frozen classic account's balance is in the checked `amount` field.

## R1s — Sweep helper

I verified the access control and pair handling:

- **(a)** Direct invocation requires `signer.is_signer` where `signer` is the asset-signer PDA; only Core `ExecuteV1` can sign for it, and Core approves Execute only for the asset owner on a thawed asset. A frozen vault cannot Execute at all, so the helper is unreachable outside a redemption. Holds.
- **(b)** Duplicate source: the first iteration closes the account, so a second `read_token` on it fails (data resized/zeroed) and the whole call reverts — no partial effect. Source-as-destination is impossible because it would require `signer == dest`, rejected up front. A destination appearing twice is harmless. wSOL is a classic 165-byte account and is handled by the generic path (though no suite arm exercises a wSOL source — see coverage note). Zero pairs → lamport-only sweep; odd count → rejected. Holds.
- **(c)** The destination wallet is not compared to the asset owner, but only the owner can build/authorize the `ExecuteV1` that carries the sweep, so the destination is owner-chosen. This is safe as a program property; the risk is a wallet UI presenting a malicious `ExecuteV1` for signature, which is outside the program.
- **(d)** `signer.lamports()` is read after the token loop; the token closes credit rent to `dest`, not `signer`, so the read is accurate. Nothing between the helper and `burn_vault` can credit the PDA within the same atomic transaction unless the redeemer inserts such an instruction, which would then fail BURN's `lamports == 0` and revert (self-grief only). Core `BurnV1` does not credit the asset-signer PDA. Holds.
- **(e)** A closed reserve account passes BURN's reserve loop because its data length drops below 165 (skip), not because it is mistaken for a live empty account — the live-vs-closed distinction is by data length, and a live account with value has len 165 and is fully checked. A stranger-created classic ATA for the vault is sweepable if named, destroyed if not (accepted limit 44). A Token-2022 ATA cannot be created for the classic reserve mints (probe confirms `IncorrectProgramId`), so there is no account a stranger can create that BURN must check but the helper cannot name, beyond the accepted undeclared-stray class.

**No finding.** Coverage gap (not a defect): no arm exercises a wSOL source, a duplicate *destination*, or a destination that is another vault's asset-signer. All are benign by construction, but they are claims with no test.

## R2 — Community pool

I re-derived the accumulator invariant **pool balance ≥ ceil(owed_scaled / ACC_SCALE)** across `split_revenue`, `distribute`/`credit`, `claim`, `join`, `retire`, and the forfeit path:

- `distribute` sets `delta = floor(avail·ACC_SCALE / w)` and adds `delta·w` to `owed_scaled`; since `delta·w ≤ avail·ACC_SCALE`, the new ceil(owed) ≤ balance. Holds.
- `claim` pays whole sats, moves the sub-sat remainder into `carry_scaled`, and subtracts `pay·ACC_SCALE` from `owed_scaled`, so the sum of per-vault `weight·acc + carry − debt` stays equal to `owed_scaled` (the suite's `ledger()` recomputes exactly this). Holds.
- `retire` (redeemed) requires `pending < ACC_SCALE` unless forfeiting; bare-burn retire returns the pending share to the pool by removing it from `owed_scaled` without moving tokens. Holds.
- **Liveness:** I looked for a permanent distribution/redemption block. A pending vault that is burned but not retired keeps `waiting_to_join > 0`, but `retire_burned` and `join` are permissionless, so it is always recoverable. A bricked (PDA-owned) vault is still "live" for `require_live_vault` and can be joined, so it cannot wedge the gate. Activating someone else's funded vault is benign (it only adds them to payouts and the 21,000 sats are locked until redemption). I could not make distributions or redemptions permanently impossible for others.

**No finding.**

## R2b — $CBOB boost

I traced the epoch/ring accounting: a boost bought at epoch `E` ends at `E + epochs`; `advance_epoch` marks it due exactly when `dist_epoch` reaches the end epoch; `BoostsExpireFirst` prevents any distribution past a due boost; `expire_boost`/`claim`/`retire` all require `boost_weight > 0` and the due condition, so no double, early, or never expiry. `reweigh` preserves owed exactly (`carry ← owed`, `debt ← new_weight·acc`), so a weight change neither creates nor destroys earned share. The ring slot collision concern is bounded by `max_boost_epochs ≤ 63 = BOOST_RING − 1`; two live boosts cannot have end epochs 64 apart. Early retirement uses `unschedule_boost`, which decrements `boosts_due` if due else the ring slot. This matches the 260-epoch host test and the wrapped-ring suite arms.

**No finding.** Note (not a defect): because boost price has no ceiling, a governance majority can set an arbitrarily high or low price. That is a governance power over an optional feature, bounded by the fixed weight/epoch ceilings; it does not touch the pool, the census, or the 85/15.

## R3 — Level draw

I checked the SlotHashes parse (key pinned, count ≤ 512, length ≥ 8 + 40n, all-zero hash refused), the skipped-slot window (smallest produced slot in `[want, want+64]`, order-independent min), the FIFO (`index == revealed_total`), and the burned-at-head case (level still drawn, Core write skipped, so the queue never stalls). The attribute re-supply hash matches the mint-time hash construction (both serialize `Vec<VaultAttribute>`). The minter commits the asset key before paying and cannot know the future slot hashes, so no grind. Residual leader influence and re-roll-on-lapse are accepted limits 25/26; I did not re-file them.

**No finding.**

## R4 — Governance

I verified the tally: quorum over snapshotted live supply, threshold over votes cast, 10% YES turnout floor, and 50%-of-all-live-vaults for any guardian change or swap-operator arm (detected by scanning actions, so a bundle containing a key change inherits the supermajority). A guardian change may share a proposal with a *restart* but not with `ArmSwapOperator`; the restart halves are individually skipped if the corresponding stop postdates proposal creation. The per-kind ordering marks (`last_round_id`, etc.) are monotone proposal ids and cannot jump, so governance cannot be frozen by the skip logic. `tighten_sweep` is monotone and bounded. I found no path for a minority below the stated thresholds to carry a key change, and no action reaches the split/destinations/max_supply/royalty.

**No finding.**

## R5 — Charter claim

I verified the Merkle scheme (leaf tag 0x00, node tag 0x01, sorted pairs, odd-node promotion) matches `scripts/pob-merkle.mjs`, and the domain separation defeats leaf-as-node replay. The PoB must be owned by the signer, in the pinned collection, and a leaf of `pob_root`; it is CPI-burned in the same instruction, so double-claim and lookalike claims fail. The window is clock-only with no flag. `pob_extra` accounts pass through never as signers. Round-27's R27.C1/C2 (program-owned PoB claiming via `invoke_signed`) is real: an off-curve owner can now claim and vote, but the resulting vault is unredeemable (accepted limit 43) — a footgun, not a theft vector.

**No finding.**

## R6 — One-time configuration and trusted hop

I walked every `initialize` bound. The value ranges are enforced, and the dangerous "wrong-but-accepted" values (e.g. `redeem_window_secs` 10s–24h, off-curve keys accepted by SEAL) are caught off-chain by `check-launch-params.mjs` — this is item 38, still OPEN, and I did not re-file it. The 10% royalty is installed with `PluginAuthority::None` and no instruction in any program updates or removes it (`set_collection_royalties` deleted, suite 0.4h); Core enforces the None authority. The redemption cap is a rolling window over the last 64 redemption *timestamps* (not slots), `cap = max(1, ceil(live·210/10000))`, k-th-most-recent check; the ring makes it stricter above 3,047 live, never looser. Confirmed as described.

**No finding.**

## R7 — Cross-program raw reads

I recomputed every pinned offset against the struct layouts. All match: MintConfig (governance 41, minted_total 141, bare_burns_retired 454, charter_closes 442, stops 191/192, stop-times 518/526, sweep bounds 257/266/274, tighten bounds 631/639/647, boost bounds 711/712), VaultRecord (asset 9, mint_index 41), BurnConfig (burned_total 42), SEAL Config (version 8, collection 9, reserves 41), and the SPL token/mint field offsets. The tight Borsh packing (no alignment padding) is why `pending_guardian_at` sits at 615 immediately after the bool at 614; the suite's offsets agree. I found no misread.

**No finding.**

## R8 — Suite / simulation / build as evidence

The `because()` reason-pins all matched in the recorded 848/848 run, so no negative is firing for the wrong recorded reason. The sweep helper's shipped bytes are proven identical to the tested bytes (`build-mainnet.sh` compares `dist/`, `target/deploy/`, and the localnet release). The four keyed programs are *not* byte-identical between tested (localnet) and shipped (mainnet) builds — that is the acknowledged `INIT_AUTHORITY` gap, bridged only by the behavioral ask + source grep + reproducibility; a third wrong key would still reject the test key identically. This is a known evidence limitation, not something I can close from here.

Coverage gaps with no arm: wSOL source in the sweep, duplicate destination, destination-is-another-vault-PDA, and any v1 transaction execution. These are claims the prompt makes that no test exercises. None is a demonstrated defect.

---

## Findings

### F1 — LOW (off-chain, monitoring availability): v1 transactions using lookup tables are rejected by `bank/txread.mjs`, which can jam a watched address's signature walk

**Construct.** `bank/txread.mjs`, `validateParsedTransaction`:
```js
if (tx.version === 1) {
  need(object(m.transactionConfig), 'v1 transactionConfig');
  need(m.accountKeys.every(k => k.source !== 'lookupTable'), 'v1 lookup-table key');
}
```
jsonParsed marks keys resolved from a v1 address-lookup-table with `source: "lookupTable"`. This validation throws on any such transaction.

**What an attacker gains.** `readParsedTransaction` is used by the alarm's signature walk, the revenue recovery scan, and the redemption poster. A third party can submit a single (even failing) **v1 + lookup-table** transaction that references a watched address — e.g. the revenue PDA or a program id, via the permissionless `split_revenue`. That signature enters the address's history. Because `txread` throws rather than returns, and the design deliberately holds the cursor on a throw ("before a caller can advance its cursor"), the walk cannot move past that signature. The result is a repeated, loud failure of that address's transaction surveillance for as long as the signature is in the walk window. This does not move funds and is not silent (the alarm's own failure detectors should page), but it degrades detection during exactly the window an attacker would choose.

**Evidence that would exist if I am right.** (1) The validation line above rejects `source === 'lookupTable'`; the bundled fixture `tests/fixtures/mainnet-v1.json` is a v1 transaction with *all-inline* keys (`source: "transaction"`), so it passes and does not exercise the LUT path. (2) Feeding `validateParsedTransaction` a v1 parsed result whose `accountKeys` include a `source: "lookupTable"` entry throws `unreadable parsed transaction: v1 lookup-table key`. (3) A live `getTransaction(..., {encoding:'jsonParsed', maxSupportedTransactionVersion:1})` on any v1 transaction that used a lookup table returns such entries.

**Caveat / severity.** I could not inspect `bank/sigwalk.mjs`/`bank/alarm.mjs` (not in the bundle), so I cannot confirm whether the consumer gaps out instead of hard-sticking; the severity assumes the throw propagates. This is a **residual**, not a regression: before the round-27 repair, `maxSupportedTransactionVersion: 0` caused the RPC to reject *all* v1 transactions, so the pre-repair behavior was strictly worse. The repair fixed inline-key v1 but not LUT v1.

**Fix.** Accept `lookupTable`-sourced keys for v1 (jsonParsed already resolves them to concrete pubkeys, which the consumers accept), or convert an unsupported/unknown transaction shape into a *skip-with-gap* that still advances the cursor past that signature, rather than a throw that pins it. Add a fixture of a real v1+LUT transaction and a selftest arm proving the walk advances over it.

### Verification gaps (not findings; naming so they are not assumed)

- **G1.** Consumer behavior of `txread` on throw (cursor hold vs gap) is unverified here because `sigwalk.mjs`/`alarm.mjs` were not provided. Needed to finalize F1 severity.
- **G2.** Whether the RPC always returns `innerInstructions`/`logMessages`/`pre|postTokenBalances` as arrays (as `txread` requires) for minimal transactions is not proven by the bundle; the live probe passing 33/33 is reassuring but only over the sampled transactions.
- **G3.** The four keyed programs' mainnet binaries are verified only by behavioral ask + source grep + reproducibility, as the build script itself states; a wrong-but-non-test `INIT_AUTHORITY` would not be caught by this box. This is pre-existing and acknowledged.

---

## The four questions about the accepted limits

1. **Any limit worse than stated?** I found none that is exploitable beyond its statement. Limits 28 (freeze), 41 (cap doesn't stop transfers), 44 (undeclared destroyed), 46 (hot Moments key), 47 (guardian stop at low turnout) read accurately against the code. F1 touches monitoring availability, which limit 8/10 rely on, but is not itself listed; it is the one item I'd add to the carry list if confirmed by G1.
2. **Any listed limit not actually a limit?** No. Limit 42's "prior transaction" requirement is correctly restated after round-26 D4 (the narrow 1,219-byte variant is an offline measurement, and the current client contract is prior preparation). I did not find a limit that is already closed but still listed.
3. **Any DISCHARGED item not actually discharged?** I spot-checked 12/17 (compute units), 14 (duplicate attributes), 19 (unlevelled halt), 30/31/33, 51 (boost), 54 (compute at widest shapes) and the Bank-family discharges. Each is consistent with the code and the cited measurements. I did not find a falsely discharged item.
4. **Any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22 (live dress rehearsal incl. both-venue revenue cycle and forced post-sweep failure), 38 (`charter_opens_at` and `lock_deadline` still null), 50 (holder surfaces), 52, 53 remain open, and `VALIDATION.md` explicitly states the live Phantom ceremony, both-venue revenue cycle, and forced post-sweep recovery "remain open." The full local run (848/860/39/22/14/47/33/16) is not being presented as satisfying item 22.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — do these before launch; AI audit structurally cannot

1. **Run the live mainnet dress rehearsal (item 22) against real cluster conditions.** AI cannot reproduce mainnet latency, rate limits, RPC failover, a transient error at vault 1,900 of 2,100, or the every-minute reveal lane keeping up. Execute the named pass/fail items with recorded signatures: crank live passes, alarm in rehearsal mode, one full revenue cycle through **both** Orca and Meteora (force Orca to refuse once), and one forced post-sweep failure walked through hand recovery to `--audit` clean.
2. **Verify the signed `initialize` transactions against `launch/mainnet-init.json` at signing time, not just the JSON.** The checker validates the JSON, not the signed bytes (round-24 A6). A human must diff the actual transaction data being signed against the ruled values before signature, since a wrong value is permanent.
3. **Reproduce the five mainnet artifacts on a physically separate machine from the same commit** and compare sha256 against `dist/SHA256SUMS`. This box cannot prove the compiled `INIT_AUTHORITY` constant is Gary's key (a third wrong key behaves identically); independent rebuild is the only bridge.
4. **Decide and execute the key-custody rulings that are organizational, not code:** whether to move the full $CBOB supply out of the on-box release wallet (limit 56), how the swap-operator key is held, and whether the Giraffish Moments hot wallet is moved to cold/multisig for the 7-day charter window (limit 46). AI can name these exposures; only the owner can change custody.
5. **Remove the upgrade authority only after all gates, and confirm removal on-chain for all five programs.** Then immediately confirm the alarm's `program_not_locked` detector goes quiet. This is a one-way human action the audit cannot perform or undo.
6. **Have a human read HOLDER-GUIDE.md against the deployed programs line-by-line before publication.** Item 50's surfaces are unbuilt and the guide is DRAFT; a legal/accuracy review of the "honest list" is a human responsibility AI should not be the sole check on.
7. **Establish a human-reachable incident path for the immutable case.** Since a redemption/pool/governance bug cannot be stopped, pre-agree (off-chain, legally, and with the community) what happens if one is found post-lock — the audit can find bugs, but it cannot provide the emergency social consensus an immutability-by-design system needs when the AI process is wrong.