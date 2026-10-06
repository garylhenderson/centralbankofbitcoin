# Independent audit — v6, whole tree, round 32

I read every bundled file whole, recomputed every cross-program offset and account space from the struct definitions, re-derived the pool invariant inductively, traced the custody pairing both directions, and re-verified round 31's verdict and repairs against this tree. My honest result: **no new CRITICAL, HIGH or MEDIUM.** The prompt warns that a wrong CRITICAL costs real engineering time; I refuse to manufacture one. What follows is the evidence for each "holds", the small things that are real, and the structural gaps this process cannot close.

---

## R0 — Round 31's verdict and its repairs

Round 31 was NOT CLEAN with quorum met: one LOW (L1, the coverage gate's quorum check), two INFO (D1 prompt round number, D2 probe usage line), everything else refuted or accepted. I verified each independently:

- **L1 repair holds.** `scripts/audit-coverage.sh` now requires the verdict's **first line** to fullmatch `# Round {num}, {FOCUS} pass: (?:NOT )?CLEAN; QUORUM MET\s*` (`first_line_quorate`), with an 8-case both-ways selftest covering "NO QUORUM MET", "QUORUM NOT MET", line-6 placement, wrong focus and made-up wording. The manifest count check (`auditors >= required`) is retained; the verdict headline is now a positive, exact guard, which is what L1 asked for. Residual is process trust (the gate trusts triage's headline), not code. Correct.
- **D2 repaired.** `scripts/probe-mainnet-facts.mjs`'s usage line names itself.
- **D1** is about the next round's script (not bundled); the repair rule (derive the prior round from the bundled verdict path) is the right shape.
- **W1 (reveal heap) confirmed as refuted.** The suite's R28.A1/A2 measure the boundary on the pinned Core: a 10,150-byte autograph lands the reveal; shrinking it afterwards fails on heap. The worst owner-reachable shape cannot block the FIFO. The suite arms exist and are pinned.
- **W2 (address squat) confirmed as refuted.** Suite 7.12d lands a proposal at a pre-funded PDA; Anchor 0.31.1 `init` tops up and allocates. SEAL's config space is 398 bytes (matches W2's measurement and my recomputation: 8+1+32+4+96+1+256).
- **W9 confirmed.** `MINT_CONFIG_SPACE` sums to 1,005 + 256 = **1,261** (I recomputed field-by-field from `MintConfig`; Qwen's 1,253 was wrong).
- The round-31 repairs to files I can see (gate, probe, SPEC item 38's `config_drift` sentence) are present and consistent with VALIDATION.md. The alarm/detector/poster repairs are in files not bundled this round; I cannot re-verify those beyond the stated selftest counts (901/901, 23/23), which `run-tests.sh`'s floors match.

No regression found in the bundled repairs.

---

## R1 — Custody: the pairing and the emptiness proof hold

I attacked the pairing in every shape I could construct:

- **Both halves bind asset AND owner, both directions, top-level only.** SEAL `open_for_redemption` walks forward from `current+1` for BURN's `burn_vault` with `accounts[0]==asset` and `accounts[2]==owner`; BURN walks `0..current` for SEAL's open with the same two bindings. `load_instruction_at_checked` sees top-level instructions only, so a CPI-wrapped half is invisible to the other half — WR.1/WR.2/WR.3 measure all three wrapper shapes refused (`NotFromBurn`, `NoTerminalBurn`, `NoPrecedingOpen`) and WR.4 measures the vault intact afterwards.
- **Two vaults, one transaction:** open A/open B/burn A/burn B pairs correctly; cross (open A, burn B) refuses (4.10); both-pair at cap 1 refuses the second on the rate limit, which also proves the pairing accepted the first (4.10a). Two redemptions landing together at cap 2 are measured in v0 with a lookup table (S9b).
- **A thawed vault cannot leave a transaction unburned:** SEAL refuses the thaw without the terminal burn; if the burn fails the whole transaction reverts, thaw included. After the burn the asset is a 1-byte tombstone and `read_core_asset` refuses it (len ≥ 66, key 1), so no second open.
- **The emptiness proof:** PDA lamports == 0; every reserve mint's ATA under both token programs declared, PDA-owned, delegate-free (tag [72..76], delegated_amount [121..129], close authority [129..133]), exactly 165 bytes, amount 0; no declared account a live Core asset. The second loop applies the same checks to any declared PDA-owned token account and refuses Token-2022 extensions. A declared tombstone passes (`d.is_empty() || d[0] != 1`); a declared live nested asset refuses (`VaultStillHoldsAVault`).
- **The rate limit is exactly a rolling window over a 64-slot ring.** I traced the arithmetic: `k = min(max(cap,1),64)`, the k-th most recent sits at `(head + 64 − k) % 64`, and a redemption lands iff that entry is a full window old. At cap 2: redemptions at t=0,10 refuse the third at t=20 (2nd-most-recent is t=0, 20 < 3600) and land it at t=3600 — exactly cap per window, any start. The cap is recomputed per redemption from `minted − burned − bare_retired`, falling as vaults burn (4.9, RL.2–RL.4, S10). Ring bound 64 covers live supply to 3,047; above that k clamps to 64, stricter never looser; max supply 2,100 gives cap 45. `now.checked_sub(kth)` cannot underflow (ring holds past Clock times; Clock is monotone).
- **`retire_redeemed` provenance:** stack height == 2 AND the current top-level instruction is BURN's `burn_vault` for this asset. A wrapper reaches height 2 but the top-level instruction is the wrapper's, not BURN's — refused (WR.1). BURN-through-wrapper reaches height 3 — refused. No path around it.

No custody break found.

---

## R1s — The sweep helper

(a) **Access control holds.** Called directly it needs the asset-signer's signature, which only Core can produce, and only inside `ExecuteV1`, which the pinned Core approves only for the asset's owner (SR.5 stranger and SR.5a owner-added transfer delegate refused 0x1a on a genuinely thawed vault; SR.5c refuses the collection update authority on a control; SR.5b pins the CBOB collection authority to MINT's off-curve PDA; SR.5d proves the control lands for the owner). On a frozen vault, ExecuteV1 is refused by the PermanentFreezeExecute plugin (3.7, S6.2), so the helper runs only inside a SEAL open — which requires a terminal burn in the same transaction. There is no "outside a redemption" reach.

(b) **Pair list.** Same source twice: the first close zeroes the amount and the second `read_token` sees a zeroed owner → `IllegalOwner` (SR.12a, and SR.12b pins that the refusal came from the second, closed source, not the first guard). Destination twice: fine. Source-is-destination and destination-is-source: refused by the owner checks (`to_owner != dest`, or the closed-account owner read). Native wSOL source: transfer of `amount`, then close of the rent — works. Delegate/close-authority on a source: the transfer is by the owner (the PDA), so a delegate is irrelevant; a foreign close authority would fail the close, but only the PDA can set one and only during a redemption the owner itself builds — unreachable as an attack, and BURN's `ReserveDelegated` would refuse anyway. Frozen source: the transfer reverts the whole redemption (SR.14; accepted limits 28/44). Non-ATA destination: any classic 165-byte account owned by `dest` with the same mint passes. `dest == signer` refused (`InvalidArgument`, SR.10); another vault's asset-signer as `dest` is the owner's own choice of their own funds. Odd list: `NotEnoughAccountKeys` (SR.7). Zero pairs: lamports-only sweep (SR.13).

(c) **Destination checks are safe given (a).** Only the owner can execute, so the builder of the transaction is the owner (or a page the owner reads before signing). A lamport credit to a non-existent destination below rent fails and blocks the redemption — but the canonical destination is the owner, who pays the fee and therefore exists; this is item 50's documented client obligation, and round 31's W10 already refuted the contrary claim. A credit to an existing non-system account lands (R27.S1, measured, token data unchanged).

(d) **The lamport sweep** reads `signer.lamports()` at execution, after the closes (which credit `dest`, not the signer). Nothing in the owner's own transaction deposits between the sweep and the burn; Core's BurnV1 does not sweep the PDA (measured fact 4). BURN's `lamports() == 0` sees exactly what the sweep left. A griefer cannot inject an instruction into the owner's transaction.

(e) **Interaction with BURN's proof.** A closed reserve account passes BURN's loop for the right reason: on the pinned classic Token program, `CloseAccount` leaves the data readable within the transaction (owner field still the PDA, amount 0, no delegate) — this is not argued, it is measured: SR.4 and S8.1 land redemptions whose helper closed all three reserve accounts, and they would revert `ReserveNotOurs` if the owner field were zeroed. For a reserve ATA that does not exist when the page builds the transaction: the prior transaction creates it (item 42/50), after which a stranger's dust into it is swept live. The stranger-created-account classes: a Token-2022 ATA for a classic mint **cannot be created** (probe F4.2, measured on mainnet); a non-ATA classic account for the vault PDA **is sweepable** (the helper checks owner/mint/length, not ATA-ness); a nested Core asset is the accepted-limit-44 destruction class (theirs, not the redeemer's); a frozen stray with a balance reverts if named and is destroyed if not — the page's coverage check is the guard (item 50, OPEN).

(f) **It fits.** S8.0 measures claim + open + helper(3 reserves) + burn at 1,061 bytes, asserted ≤ 1,232 − 52 − 96 (compute pair + separate payer). A fourth reserve cannot exist (`MAX_RESERVE_MINTS = 3`, and 9.14/9.15/9.16 pin the constant to the measurement). The in-line monthly run's account (the pool) is already inside the measured shape. S8.1a measures 168,343 CU against the 800,000 default for four instructions.

(g) **Evidence.** SR.0–SR.14 pin every refusal branch to its measured error text; S8.* lands the real three-asset redemption after a stranger's deposit. `build-mainnet.sh` proves the helper's mainnet bytes byte-identical to the localnet build **and** to `target/deploy` (the bytes the suite and sim deployed). The suite deploys what it proves.

---

## R2 — The pool: the invariant holds, and liveness holds

**"The pool always holds at least ceil(owed)"** — I proved it inductively over every mutator:

- `split_revenue`: pool grows, owed unchanged.
- `distribute`/`monthly_inline`: `avail = balance − ceil(owed)` (refuses `PoolShort` on underflow); `owed += δ·w` where `δ = avail·SCALE/w`, so `δ·w ≤ avail·SCALE` and `ceil(owed_new) ≤ ceil(owed_old) + avail ≤ balance`. The division residue stays in the pool, undistributed.
- `claim`: pool −= pay; `owed_scaled −= pay·SCALE` exactly; ceil falls by exactly pay.
- `retire` (redeemed/forfeit/bare): `owed −= pending`; pool unchanged; the residue or forfeited share stays in the pool.
- `join`/`reweigh`/`expire_boost`: owed unchanged (`reweigh` moves owed to `carry` and restarts debt at the new weight; `owed_of` after = `owed_of` before, identically).

The suite's `ledger()` recomputes `owed_scaled == Σ(weight·acc + carry − debt)` over every live record after every money operation (BK.IN/BK.3c/BK.P arms fail if any label is missing), and host test N1 checks it over 260 epochs with buys, early and due retirements, and expiries. The only pool outflow is `claim`'s Transfer, signed by the config PDA (`CONFIG_SEED` signs nowhere else), into each vault's **recorded** `vault_ata` (`WrongVaultAccount` otherwise; P.19). No instruction writes `vault_ata` after `activate`, and `activate` derives it.

**Counters.** `pending_this_epoch ≤ pending_count` always (both incremented together; `join` decrements only `pending_count` and only for earlier-epoch vaults; `retire` decrements both consistently, `request_epoch == dist_epoch` iff counted); `waiting_to_join = pending_count − pending_this_epoch` is exactly the eligible-but-unjoined set. `active_count`/`total_active_weight` move only in `join`/`retire`/`reweigh` and are checked against the records by the suite.

**Liveness.** `JoinWaitingFirst` is clearable by anyone for free (the join branch of `claim` checks only `dest.key == vault_ata`, never the account's existence, so a missing account cannot wedge it); `BoostsExpireFirst` is clearable by anyone for free (`expire_boosts` needs only records). A griefer can keep `waiting > 0` only by continuously funding real vaults to 21,000 sats, and anyone joins them the same pass. Distributions and redemptions cannot be durably blocked for others.

---

## R2b — The boost: exactly N, nothing lost, counters agree

- **Exactly N distributions.** A boost bought in epoch e ends at e+N; `advance_epoch` makes it due when `dist_epoch` reaches e+N; the (N+1)-th distribution is refused `BoostsExpireFirst` until expiry. It earns the N distributions e→e+1 … e+N−1→e+N and not one more. Measured both orders: BO.21/BO.21a (boost then distribute in one transaction — the one it rode in on counts) and BO.35/BO.35a (distribute then boost — bought in the new epoch, ends at e+1+N).
- **Nothing lost or gained on a weight change.** `reweigh` carries `owed_of` into `carry_scaled` and restarts debt at the new weight; `owed_of` is identical before and after, at buy, at expiry, at claim normalisation, and at retire. BO.7c measures the carried share whole; BO.37/BO.37a measure a due boost expired inside a claim against a frozen destination — the whole boosted share stays owed, is logged, and is paid exactly once when thawed.
- **Ring/counters agree past epoch 64.** `max_boost_epochs ≤ 63 = BOOST_RING − 1`, so a boost's end slot is always in the future lap (`end % 64 ≠ dist_epoch % 64` since epochs ∈ [1,63]); `advance_epoch` zeroes each slot as it passes, and distributions are gated while anything is due, so a slot never carries two laps. Host test N1 drives the schedule through the program's own functions over 260 epochs (four wraps) with per-slot model checks, early wrapped retirements (including N=63 same-epoch), due retirements and expiries, with coverage minimums so it cannot pass by never reaching a branch. BO.34/BO.38 measure the wrap on chain.
- **No double/early/never expiry.** After expiry `boost_weight == 0` (skipped everywhere); `expire_boost` requires `dist_epoch >= end`; a retired vault's boost is unscheduled from whichever branch applies (`boosts_due` or the ring), measured BO.16/BO.17.
- **No distribution block from a vault whose token account is gone:** `expire_boosts` reads records only.

---

## R3 — The level draw

- `blockhash_in_window` pins the sysvar id, bounds the count at 512, checks the buffer holds what the count claims, takes the smallest produced slot in `[want, want+64]`, and refuses an all-zero hash. Host tests cover skipped slots at A, B and C against an independent model, a full 512-entry buffer, a 513-count, a truncated buffer, a forged key and a zero hash.
- FIFO is `index == revealed_total` (`RevealOutOfOrder`); a burned vault at the head still draws (Core write skipped on the positive tombstone read), so the queue never stops at it (L.11).
- A missed window is rescheduled to `now + 16`, a slot that does not exist yet, only after the window has passed, never defaulted (L.15–L.17e); every reschedule logs `CBOB_REVEAL_RESCHEDULED` and counts on the record.
- The attribute re-supply is hash-checked against the mint-stored value (`AttributesMismatch`, L.4); the 640-byte budget is proven revealable in a legacy transaction (L.12) and one byte more is refused at mint (L.12a).
- A minter cannot grind: the asset address is mixed into the hash, but the three slot hashes do not exist at signing. A crank operator cannot choose anything (the capture slot is deterministic). SPEC 26's statement — C's leader chooses among many draws, cohort-wide, and a validator can time a mint or a reschedule into its own rotation — is accurate as written, and HOLDER-GUIDE.md now says it in plain terms ("can pick among several results… one choice affects every vault created in that moment at once"). It is not worse than stated.

---

## R4 — Governance

- One vault one vote bound to the asset (`VoteRecord` seeded `["vote", proposal, asset]`; 7.7/7.9 refuse a second vote after transfer); standing read live off the asset's owner bytes; a burned vault cannot vote or propose (`read_core_asset` requires key 1).
- Electorate fixed at creation (`index_snapshot`, `quorum_supply = minted − burned − bare_retired`); a vault minted mid-vote can neither vote nor raise the bar (G.6/G.7). Burning your own vaults lowers the divisor and your votes proportionally — your share *falls* ((v−k)/(s−k) < v/s for v<s), so no manipulation that way; burning others' vaults is impossible.
- At the ruled numbers the smallest passing ordinary vote is 10.71% YES of the snapshot (limit 35 stated correctly); key changes need ceil(50%) of the snapshot (`KeyChangeNeedsHalf`, 3c.K2 refuses quorum+turnout-short-of-half with the precondition pinned by 3c.K2p) and never bundle (`KeyChangesBundled`, 3c.K1).
- No freeze beyond the accepted limits: proposals need one live vault (45), execution is permissionless inside a 7-day window, an overtaken action is a logged skip that cannot take its bundle down (7.26, E.2, 3c.R1, 3b.S1), and a stale restart is refused identically by GOV's skip (`stopped_at >= created_at`) and MINT's `StopIsNewer` (`<` required) — the tie rules match.
- SPEC 47 is not worse than stated: a stolen guardian can stop sales and the sweep and cancel a pending operator, permanently at sub-half turnout, but cannot touch a vault, a payout, a rule, or its own replacement. Funds are never at risk from it.

---

## R5 — The charter claim; SPEC 46 is complete

- PoB identity is by address against the 240-leaf root, domain-separated (0x00/0x01), sorted pairs, odd-promoted — `scripts/pob-merkle.mjs` matches MINT's `merkle_leaf`/`merkle_root_from` byte for byte, and the suite proves the program accepts this module's proofs (the only check that can fail if they drift). Depth 8 for 240 leaves; `MAX_POB_PROOF = 16` is a compute bound, and an over-long proof computes a wrong root and is refused.
- The PoB must be a live Core asset, owned by the signer, in the pinned collection; it is CPI-burned as its owner in the same instruction; a burned leaf is a 1-byte tombstone and fails the live-asset read (C.7); a lookalike from the same collection and authority fails the root (C.8); a CBOB vault offered as a PoB fails (C.10).
- `pob_extra` accounts pass through to Core's burn never as signers (OR.3 refuses an over-claim; OR.4 lands through an approving oracle; OR.5 proves a rejecting oracle still refuses, pinned to Core's own error).
- SPEC 46's full statement — end-the-project and capture-governance through the window, the per-asset and sampling blind spots, and the positive bound (the key cannot transfer or burn a PoB) — matches what the code and Core actually allow. I found nothing it omits: minting a "#241" is refused by the root; moving a PoB out of the collection is the stated brick class; name/uri rewrites are cosmetic.

---

## R6 — Initialize and the trusted hop

Every wrong-but-accepted initialize value I could construct funnels to item 38's pre-signing checker, which item 38 itself names as the only gate for the values the programs check lightly:

- SEAL checks each reserve account's **owner** only, not that it is a mint, and not duplicates. A classic token *account* accepted as a reserve mint would make its reserve ATA uncreatable (SPL `InitializeAccount3` unpacks the mint) and brick every redemption forever; a non-mint `payment_mint` would additionally fail `mint_vault`'s 82-byte read and brick every mint. The checker pins the ruled three and cbBTC. Item 38's text ("SEAL reads only owners") already carries this.
- Off-curve guardian/swap-operator accepted (a PDA guardian is a brake that can never be pulled; a PDA operator is a dead sweep with funds safe in the revenue PDA). Item 38's text ("off-curve keys are accepted") carries this.
- `redeem_window_secs` accepts 10 s (360× the intended rate), `min_voting_secs` accepts 60 s, quorum accepts 500 bps, the charter window accepts 90 days — all pinned to the ruled values by the checker, all named in item 38.
- **Observation (INFO, inside item 38's scope, not a new finding):** MINT's `initialize` checks the $CBOB mint is classic, initialized, and neither cbBTC nor $GARY, but never reads its mint-authority or freeze-authority COptions. The ruled mint (`GMm2yY2z…`) was created 2026-10-04 with neither (verified at creation) and the checker pins the address, so the only exposure is a checker bypass during the ceremony — which is item 38's exact subject. Two byte reads (`d[0..4]==0`, `d[46..50]==0`) would close it on chain; adding them now would reset the freeze counter for marginal gain. Noted so it is a decision, not an oversight.
- The swap operator's worst case is bounded as stated: `amount ≤ max_sweep_lamports`, one per `sweep_cooldown_secs`, never below `sol_reserve_lamports`, operator-signed, guardian-stoppable; a vote can only tighten, inside the initialize bounds. Three sweeps in one transaction refuse (6.17); a zero sweep refuses (6.17b); a stranger's sweep refuses (6.17a).
- The 10% royalty is installed once with `PluginAuthority::None`; R.6/R.6a measure Core refusing update and removal even by the update authority, R.5/R.6c prove the control collection's plugin *is* changeable with `UpdateAuthority` (so the refusal is the authority, not the call shape), and no instruction in any of our programs names the Royalties plugin again.

---

## R7 — Cross-program raw reads: all recomputed, all correct

From the struct definitions, field by field:

- **MintConfig (1,261 bytes):** version[8], collection[9..41], governance[41..73], pool_ata[73..105], round_id[105..109], opens_at[109..117], closes_at[117..125], price[125..133], cap[133..137], minted_this_round[137..141], **minted_total[141..149]**, max_supply[149..157], bank_treasury[157..189], split_bps[189..191], **sales_stopped[191]**, **sweep_stopped[192]**, guardian[193..225], swap_operator[225..257], **sol_reserve[257..265]**, bump[265], **max_sweep[266..274]**, **sweep_cooldown[274..282]**, last_sweep_at[282..290], level_caps[290..310], level_minted[310..330], revealed_total[330..338], payment_mint[338..370], pob_collection[370..402], pob_root[402..434], charter_opens_at[434..442], **charter_closes_at[442..450]**, charter_claimed[450..454], **bare_burns_retired[454..462]**, total_active_weight[462..470], active_count[470..478], acc_scaled[478..494], owed_scaled[494..510], last_distribute_at[510..518], **sales_stopped_at[518..526]**, **sweep_stopped_at[526..534]**, pending_swap_operator[534..566], pending_swap_operator_at[566..574], monthly_secs[574..582], pending_guardian[582..614], pending_guardian_set[614], pending_guardian_at[615..623], notice_secs[623..631], **sweep_floor[631..639]**, **cooldown_ceiling[639..647]**, **reserve_ceiling[647..655]**, dist_epoch[655..663], pending_count[663..671], pending_this_epoch[671..679], cbob_mint[679..711], **max_boost_weight[711]**, **max_boost_epochs[712..714]**, boost_price[714..722], boost_weight[722], boost_epochs[723..725], boosts_active[725..729], boosts_due[729..733], boost_weight_total[733..741], cbob_burned_total[741..749], boost_expiring[749..1005], +256 padding. Every GOV offset (41, 141, 191, 192, 257, 266, 274, 442, 454, 518, 526, 631, 639, 647, 711, 712) and every BURN offset (141, 454) matches.
- **VaultRecord (221 bytes):** version[8], asset[9..41], mint_index[41..49] — GOV's reads match; the pool fields follow at the offsets the suite's constants use (active[125], retired[126], vault_ata[129..161], debt_scaled[161..177], pending[177], request_epoch[178..186], boost_weight[186], boost_end_epoch[187..195], carry_scaled[195..211], +10 padding).
- **BurnConfig:** version[8], collection[9..41], bump[41], **burned_total[42..50]** — GOV's read matches; redeem_window_secs[50..58], rate_head[58], rate_ring[59..571], +256.
- **SEAL Config:** version[8], collection[9..41], reserve Vec at [41..45+32n] — MINT's and BURN's reads match.
- **SPL layouts:** token account mint[0..32] owner[32..64] amount[64..72] delegate-tag[72..76] state[108] delegated_amount[121..129] close-tag[129..133], len 165 (sweep helper, MINT `read_token`, BURN's two loops all agree); mint decimals[44] is_initialized[45], len 82 (MINT, the probe, the fixtures).
- All four account discriminators and all twelve instruction discriminators are asserted in the suite against their Anchor derivations (3.1a–3.1y, BO.29); I cannot recompute sha256 by hand, but those arms fail the build if any drifts.

No silent misread found.

---

## R8 — The suite, the simulation and the build as evidence

- **No arm that cannot fail.** The `!!C1`/`!!V.asset` shapes (C.2, 2.1) sit behind helpers that throw on failure, killing the run before `rec` — enforced, not vacuous (this is round 31 W8's own conclusion, and I verified the call paths). Every negative I checked is pinned to its reason by `because()`, and ID.1 proves ids unique so a pin cannot read another arm's error. The simulation arms (10.5/10.6/10.6a/10.6b, R28.A3/A4) assert on outcomes and costs, not merely the absence of a throw (10.6 requires the four captures' CU delta).
- **Wrong-reason traps I specifically probed:** 3.7's `0x9` is justified against SR.5's `0x1a` (owner approved, seal rejects vs. no approval); SR.12b pins the duplicate-source refusal to the *second* read; S7.2! predicts the one refusal reason from the chain epoch and forbids the other; RL.2 derives the RateLimited code from BURN's own enum rather than typing it.
- **Floors equal counts** everywhere in `run-tests.sh` (855/901/39/23/14/47/6/33/4, and the sim's 71), and the equality form (`-eq`, not `-ge`) is what round 19 required.
- **Bytes provenance:** the four keyed programs' mainnet builds are proven to *reject* the test key and the localnet builds to *accept* it, per program, with the right-reason (`NotTheInitAuthority` or a named later check) — and `build-mainnet.sh` itself states the residual (the compiled constant is not proven to be Gary's key; reproducibility is the bridge). The sweep helper is byte-identical across `dist/`, the localnet release build and `target/deploy`. This is measured fact 8's stated boundary, not a new gap.
- **Claims in the prompt with no arm:** the ones round 31's A5 named (empty pre-created reserve ATA through the helper, non-ATA stray through the helper, `pob_extra = 8`, a 30-record `expire_boosts`) remain source-verified only; I re-verified each at source (the `amount > 0` guard then close; owner/mint/length-only checks; `MAX_POB_EXTRA = 8`; `MAX_EXPIRE_BATCH = 30`). Optional arms, not defects.
- **Dead artifacts (INFO):** `tests/probe-round5.test.ts` encodes v5 instruction shapes and is wired into no gate — it would fail if run, and nothing runs it; `Anchor.toml`'s `[programs.mainnet]` lists only `cbob_vaults`, which is inert on the scripted path (cargo-build-sbf and the solana CLI are used directly) but would mislead a manual `anchor` invocation. Neither affects the certification path; both are cheap to delete or correct before the freeze.

---

## The four questions on the accepted limits

1. **Is any limit worse than stated?** I found none. The ones I re-derived rather than trusted: 32 (the ring is exactly the rolling window; the cap falls as live supply falls; the 64 bound is stricter-never-looser; the "one higher until a bare burn is retired" caveat is stated), 35 (10.71% > 10% at the ruled numbers — correct), 45 (corrected by round 24 D3 — `mint_vault` needs no live vault), 26 (cohort-wide choice, stated), 46 (complete, per R5), 47 (not worse — no funds reachable), 10 (the operator×guardian double-compromise is the conjunction of two stated limits; round 31 A2 already judged both sentences true and suggested one optional clause), 28 (a frozen vault account blocks the whole redemption including $GARY/$GIRAFFISH — true, the sweep's transfer reverts).
2. **Is anything listed as a limit not actually a limit?** No. 35 is a true non-binding floor; 45 is correctly scoped; the v5 family (1a–24) is genuinely gone with the Bank/deck/distributor (the suite's 0.4–0.4i arms prove the instructions do not exist).
3. **Is any DISCHARGED item not discharged?** No. 51 (boost) is built and measured end-to-end; 54 (compute) has real arms with the default-budget refusal proven to track the measured cost; 19 is closed by construction (`activate` requires a drawn level); 14, 30, 31, 33, 12/17 verified against the code and arms.
4. **Is any OPEN AND BLOCKING item quietly treated as accepted?** No. 22, 38, 50, 52, 53 remain under OPEN AND BLOCKING, the road table shows them not started/open, and the ship gate names them. The holder guide's present-tense promises are held by its DRAFT label plus item 50's publication ban.

---

## Findings

**INFO-1 (R6, inside item 38's scope):** MINT `initialize` does not read the $CBOB mint's mint/freeze authority COptions. Covered by the checker's address pin and the creation-time verification; named above so the freeze-reset trade-off is a decision.

**INFO-2 (R8):** `tests/probe-round5.test.ts` (v5 shapes, unwired) and `Anchor.toml`'s single-program `[programs.mainnet]` are dead but misleading artifacts. Delete or correct before the freeze; neither runs today.

No CRITICAL, HIGH, MEDIUM or LOW findings survive measurement in the bundled tree.

---

## Given that no human firm will ever see this and the programs will be immutable — what AI audit structurally cannot do

1. **Be its own second builder.** `build-mainnet.sh` says it in its own output: the compiled INIT_AUTHORITY constant is not proven to be Gary's key; reproducibility is the bridge. That bridge cannot be crossed on this box, by this user, with this toolchain. Before the lock: one physically independent party, on a different machine, with a freshly installed toolchain, rebuilds from the release commit and matches all five sha256 — and one of them reads the four programs' `INIT_AUTHORITY` lines against Gary's wallet address out loud.
2. **Read the signed initialize transactions.** The checker validates `launch/mainnet-init.json`, not the transactions (round 24 A6). A human must decode the four actual signed initialize transactions — every argument, every account — against that file immediately before broadcasting. This is the single irreversible act the whole system hangs on, and no gate in this repo sees the signed bytes.
3. **Run the dress rehearsal with real money and watch it misbehave.** Item 22's named items — the crank's live passes at ~2,100-vault scale, the alarm's live passes, one full revenue cycle through Orca and one through Meteora with Orca forced to refuse, and one forced post-sweep failure walked through the hand recovery to a clean `--audit` — are not run by any suite, sim or fork. The revenue cycle in particular has zero automated coverage. AI can script it; a human has to watch it against a live cluster with real RPC flakiness and real (small) funds, and has to be the one who decides the recovery runbook actually works at 3am.
4. **Audit the box and its keys.** The $CBOB release wallet (all 2.1B), the swap operator key, the guardian wallet and the PoB collection hot wallet are all hot on one machine (limits 56, 10, 47, 46). This process reads code; it cannot verify backup hygiene, file permissions in practice, who else has shell, whether the R2 backup is encrypted, or whether the PoB wallet should spend the charter window in a multisig (the one change that would close 46, and Gary's to make).
5. **Test the redeem page with humans (item 50).** `judgeRedemptionCoverage` only protects a holder if the warning is actually seen and understood before a signature. That is a UX property; no assertion measures it. It needs real users on the rehearsal deployment, including the "a stranger nested something into your vault" case.
6. **Test the alert delivery path, not the detectors.** The detectors page; whether the page reaches Gary as an SMS at 3am is a different system (router, notify script, phone). One end-to-end, human-observed drill of a CRITICAL from chain to pocket.
7. **Verify the pinned Core under mainnet's live feature set at launch time.** The suite deactivates SIMD-0500 and SIMD-0161 to load SBPFv0 Core; mainnet's feature set drifts. The rehearsal must confirm the pinned Core still loads and behaves under whatever is live the week of launch — and the alarm's Core hash/authority watch must be confirmed firing before, not after, the lock.
8. **Rehearse the social runbooks.** Stolen guardian (47), compromised PoB wallet during the window (46), a Coinbase freeze of the pool (28), a leaked custodial key (41): the responses are organizational — move vaults to fresh keys, communicate to holders, wait out a freeze. AI can draft these; only humans can rehearse them and find the missing step.
9. **Consider a time-boxed public bounty before the lock.** This process is AI-only by ruling, and it has now converged through 31 rounds — but every one of those rounds is the same small set of model families reading the same bundle. A two-week public bounty is the one source of genuinely independent eyes this process structurally excludes. It is the cheapest remaining insurance per dollar, and it is the owner's call, not the audit's.
10. **Sign the two OPEN values as a human act.** The charter opening date and the lock deadline are irreversible and Gary's. The checker refuses to pass while they are null; nothing measures that the chosen dates are the announced ones. That check exists only as a human comparing a film's promise to a JSON file.

The code, as bundled, survives everything I could measure or trace against it. What remains is everything that is not code.