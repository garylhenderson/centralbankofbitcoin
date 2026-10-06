# Round 30 — Independent audit of the v6 tree at `c5aab17`

I read the whole bundle, recomputed the layouts from the struct definitions, traced the redemption/boost/draw state machines, and checked the round-29 repairs against the code that is actually in this tree. My posture throughout: the author is wrong until the bytes say otherwise. Where I could not reach a conclusion from the bundled files I say so rather than guessing.

**Headline: I found no new CRITICAL or HIGH.** The five programs, the sweep helper, and the reader are unusually well-defended; 29 rounds plus three red-team passes have removed nearly everything reachable by reading. What I have is one uncertain LOW that needs a measurement, a small set of INFO/documentation items, and a verification of the round-29 repairs. I also list the claims I tried to break and failed, because a negative that was actually attempted is evidence for the next round.

---

## R0 — Round 29's verdict and its repairs

Round 29 was **NOT CLEAN** (1 MEDIUM, 1 LOW, 2 INFO). I verified each repair against this tree.

**M1 (log-truncation halt) — reader side repaired correctly.** `bank/txread.mjs` now takes `{ truncatedLogs: 'refuse' | 'flag' }`. In `flag` mode it still validates *every other field* (version, signatures, account keys, fee payer, instructions, inner instructions, balances, token balances, metadata) and only relaxes the `Log truncated` marker, returning `{ ...tx, logsTruncated: true }`. In the default `refuse` mode it still throws. This is the right shape: the marker no longer halts a walk, but a truncated transaction is never silently treated as complete. The option itself is validated (`need(['refuse','flag'].includes(...))`), so a bad option throws rather than defaulting open.

*Limit of my verification:* `bank/alarm.mjs`, `bank/revenue.mjs`, and `bank/redemption-poster.mjs` are **not in this bundle**, so I could not read the consumer side that pages `log_coverage_gap`, records `logGaps`, and advances the cursor. I am relying on `VALIDATION.md`'s description plus the 891-assertion selftest (which `VALIDATION.md` says includes an arm driving a truncated transaction through the extracted walk and requiring other findings to survive). **Evidence that would confirm the repair end-to-end:** the selftest arm that asserts (a) a truncated signature produces a `log_coverage_gap` page, (b) a co-occurring instruction-derived finding is still reported, and (c) the cursor advances. If that arm exists and is in the 891, the repair holds; I could not see it directly.

**L1 (coverage-gate scope) — repaired correctly.** `scripts/audit-coverage.sh` now derives `have` from `git ls-files` over `programs/ bank/ scripts/ sim/ launch/ tests/` plus SPEC/DESIGN/HOLDER-GUIDE and the workspace manifests, with three named exclusions, and exits 2 if git cannot answer. This is the right fix: it is no longer a hand-picked glob. I confirmed the eight files round 29 named as never-bundled (`sim/fixtures.mjs`, `tests/cpi-wrapper/Cargo.toml`, `launch/cbob-token.mainnet.json`, `scripts/pob-set.json`, `Cargo.lock`, and the four non-helper program `Cargo.toml`s) are **present in this round's bundle**, so the gate passes on prepared coverage. One residual note (INFO, below): the gate counts *bundling*, and `Cargo.lock` is excluded as "generated dependency pins" — reasonable, but it means a dependency substitution would not be caught by this gate; that is what the build/rehearsal sha pins are for.

**D1 / D2 (INFO)** — DESIGN's `activate` bullet and SPEC's orphaned-vault dilution note are documentation items; round 29 marked them fixed and they are not code I can re-break.

**Conclusion on R0:** the two substantive round-29 findings are repaired in the reader and the gate. The counter is correctly still 0/2 because round 29 itself was not clean. Rounds 30 and 31 must each be clean.

---

## R1 — Custody: open/burn pairing and the emptiness proof

I attacked the pairing and found it holds.

- **Both directions bind asset AND owner.** SEAL walks forward from `current+1` for BURN's discriminator + account 0 (asset) + account 2 (owner); BURN walks backward for SEAL's discriminator + account 0 + account 2. I recomputed the account positions against both `BurnVault` and `OpenForRedemption` structs: asset is index 0 and owner is index 2 in both. The cross-pair attempts (open A / burn B; open A / open B / burn B / burn A) cannot borrow each other's burn because each match requires the *same* asset and owner. This is measured by 3.9, 3.10, 4.10, 4.10a, 9.0.
- **Top-level only, both ways.** `load_instruction_at_checked` sees only top-level instructions, so a CPI-buried burn cannot satisfy SEAL and a CPI-buried open cannot satisfy BURN. The wrapper attacks (WR.1–WR.4) are measured against a real CPI forwarder and refuse for the right reasons (`NotFromBurn`, `NoTerminalBurn`, `NoPrecedingOpen`).
- **No surviving thawed vault.** There is no re-seal and no instruction that leaves a thawed vault alive; the burn is terminal. A partial sweep fails the emptiness proof and reverts the thaw (3.11).

**Emptiness proof offsets.** I recomputed the classic SPL token-account layout (mint 0, owner 32, amount 64, delegate-COption tag 72, state 108, delegated_amount 121, close-authority-COption tag 129). BURN's checks — `d[72..76]==0` (no delegate), `d[121..129]==0` (no delegated amount), `d[129..133]==0` (no close authority), `d.len()==165` (no extensions), `amount==0` — are all at the correct offsets and fail closed. Checking only the COption *tags* for delegate/close-authority is sufficient because SPL ignores the key bytes when the tag is None. The second loop now mirrors the reserve loop's delegate/close/extension checks for non-reserve PDA-owned accounts (this was a round-28-era gap that is closed here).

**The completeness gap is real and unchanged** (proven impossibility 2): undeclared non-reserve holdings are destroyed. That is accepted limits 9/44 and I am not re-reporting it.

---

## R1s — The sweep helper

**(a) Access control.** The helper requires `signer.is_signer`; only Core's `ExecuteV1` can produce that signature for the asset-signer PDA, and Core approves Execute only for the asset owner (measured SR.5/5a/5c against the pinned Core). While the vault is frozen, `PermanentFreezeExecute` rejects Execute, so the helper is unreachable outside a genuine open; and `open_for_redemption` itself requires a terminal burn in the same transaction. I found no route for an update authority, delegate, the SEAL plugin PDA, or the collection authority to drive it. **Holds.**

**(b) Pair list.** Duplicate source: the first occurrence transfers and closes it; a closed account is no longer SPL-owned, so the second `read_token` fails `IllegalOwner` — measured SR.12a/SR.12b (the refusal reaches the *second, closed* source, not the first owner guard). Source-also-destination is impossible (different required owners). Odd/zero account counts refuse. **Holds.** One uncertain case below (native wSOL source).

**(c) Destination not compared to owner.** This is **safe**, and I want to be explicit about why so a future round does not re-file it: only the owner can invoke (a), so the destination choice is the owner disposing of their own value. A non-owner cannot build a transaction the owner signs that redirects value, because the owner authorization *is* the signature. The only party harmed by a bad destination is the owner, and a thief with the owner's key can already transfer the vault outright (accepted limit 41). **Not a finding.**

**(d) Lamport sweep.** `signer.lamports()` is read at execution and fully transferred; BURN's `lamports()==0` then sees zero. Nothing between the sweep and the burn in the canonical transaction deposits lamports; a hostile extra deposit would only make that single redemption revert (vault stays sealed) — grief, not theft. Measured SR.4a reconciles the exact lamport delta. **Holds.**

**(e) Closed accounts pass BURN for the right reason.** After the helper closes a reserve ATA it is no longer SPL-owned, so BURN's reserve loop `continue`s it ("skip an account no token program owns"). The missing-ATA race (stranger creates + funds a reserve ATA between build and land) makes the burn refuse `VaultNotEmpty`, which is a liveness grief closed by the documented prior-transaction creation (item 42). I checked the "account a stranger can create that neither the sweep can name nor BURN will skip": a Token-2022 ATA for a classic mint **cannot be created** (the ATA program refuses `IncorrectProgramId` — this is measured in `probe-mainnet-facts.mjs`), a non-ATA classic account is sweepable and BURN-checked-if-declared, and a nested Core asset is BURN-checked-if-declared. No uncatchable-and-unsweepable account type exists among classic SPL. **Holds** within accepted limits.

**Finding R1s-1 — LOW (uncertain, needs measurement): native wSOL source.** The helper handles "any 165-byte classic SPL account," which includes a wrapped-SOL account. Its pattern is *transfer the full token balance, then CloseAccount*. For a **native** token account the token balance is backed by the account's lamports, and transferring the full native balance may fail or behave differently than for a non-native account (the account must remain rent-exempt until the close). I cannot resolve this from source alone, and it is not exercised in the suite.
- *Evidence if I am right:* a test that airdrops wSOL to a vault's PDA, then runs open → Execute(sweep naming the wSOL account) → burn, would fail at the SPL Transfer or Close with the wSOL account left un-swept, and the burn would then refuse `VaultNotEmpty`.
- *Severity bound:* wSOL is not a reserve mint, so this is an undeclared-airdrop rescue path only; if it fails, the wSOL is destroyed on burn, which is already inside accepted limit 44. Hence LOW/INFO, not higher. *Fix if confirmed:* special-case native accounts in the helper (skip the transfer, rely on CloseAccount to deliver the lamports), or document that wSOL airdrops are not rescuable.

---

## R2 / R2b — The community pool and the $CBOB boost

**Invariant "pool holds ≥ ceil(owed)" — holds.** `credit` adds `delta = floor(avail·SCALE / w)` to `acc_scaled` and `delta·w` to `owed_scaled`; since `delta·w ≤ avail·SCALE`, the new owed in sats is `≤ ceil(old_owed) + avail = balance`. `claim` pays whole sats and reduces `owed_scaled` by `pay·SCALE`; `retire` and `reweigh` only reduce or preserve owed. I traced every mutation of `owed_scaled` and `acc_scaled` and found no path where owed outruns the balance, so `distribute`'s `PoolShort` is a safety net that cannot be attacker-triggered. This matches suite P.32.

**Two-step activation counters — consistent.** `pending_count` is incremented on request, decremented on join or retire; `pending_this_epoch` is incremented on request, reset to 0 in `advance_epoch`, and decremented on retire *only when* `request_epoch == dist_epoch`. Join always occurs in a later epoch (`dist_epoch > request_epoch`), so it correctly does not touch `pending_this_epoch`. `waiting_to_join = pending_count − pending_this_epoch` cannot underflow because the this-epoch set is a subset of all pending. I looked for an ordering that desynchronizes them (request+retire same epoch, request+epoch-advance+retire, double-join) and found none. The `JoinWaitingFirst` gate is unblockable-by-attack because joining is free and permissionless.

**Liveness.** Both distribution gates (`JoinWaitingFirst`, `BoostsExpireFirst`) are cleared by permissionless, free operations (join, expire) that the crank performs. I found no way to make distributions or redemptions permanently impossible for others. A frozen vault account defers only its own claim (P.18); a frozen pool forfeits a redemption's undelivered share rather than locking the vault (3c.F). 

**Boost — exactly N distributions, nothing lost/gained.** A boost bought at epoch E ends at E+N; `advance_epoch` makes it due exactly when `dist_epoch` reaches E+N, i.e. after the Nth distribution it earned. `BoostsExpireFirst` blocks the (N+1)th until expiry. `reweigh` moves the current owed share into `carry_scaled` and resets `debt_scaled = new_weight·acc`, so `owed_of` is unchanged by a weight change — I verified the algebra (`after·acc + owed_old − after·acc = owed_old`). Double-expiry is prevented because expiry zeroes `boost_weight` and every expiry path guards on `boost_weight > 0`. The ring bound (max 63 < 64) prevents a live boost's end slot from colliding with the slot the current epoch clears; `unschedule_boost` correctly chooses the due-branch vs the ring-branch by `dist_epoch >= boost_end_epoch`. The host test drives 260 epochs (four wraps) through the program's own functions and reconciles every ring slot against the records. **I found no counter drift.**

---

## R3 — The level draw

`blockhash_in_window` parses the SlotHashes sysvar defensively (key pinned, count ≤ 512, buffer length checked, all-zero hash refused) and selects the smallest produced slot in `[want, want+64]`, which is deterministic once the fork is settled. `try_capture` spaces A/B/C two leader groups apart. The FIFO (`index == revealed_total`) is enforced; a burned vault at the head still draws (advancing the counter) but skips the Core write, so the queue cannot stall at a burned asset (L.11). A lapsed window is rescheduled to `now + 16`, a slot that does not yet exist, so no one can have precomputed its hash. The attribute re-supply is hash-checked (`AttributesMismatch`).

The residuals — minter letting a draw lapse for a re-roll (limit 25) and C's leader choosing among many draws (limit 26) — are real, accepted, and I have nothing to add beyond what SPEC already states. SPEC 26's statement that C's leader *chooses* is accurate, not an under-statement; the holder guide's honest list describes it truthfully.

---

## R4 — Governance

I recomputed the bars: quorum `ceil(21%·snapshot)`, threshold `>50%` of cast, turnout `ceil(10%·snapshot)`, and key-change `ceil(50%·snapshot)`. At the ruled numbers the smallest ordinary pass is 10.71% (> the 10% turnout floor, so turnout does not bind — limit 35 is accurate), and a guardian/operator change needs a true majority of the snapshotted live supply. A minority below 50% cannot carry a key change. No action reaches the split, destinations, max_supply, royalty, or a vault; `TightenSweep` is monotone and bounded by the `initialize` bounds. An overtaken action is a logged skip, not a revert, so it cannot take a bundle down.

The permanent-stop-at-low-turnout case (a stolen guardian re-stopping after every failed replacement vote) is real and is accepted limit 47; I found nothing *worse* than stated — in particular, redemption/activation/distribution/claims are genuinely untouched by either stop, so a frozen governance does not strand funds.

---

## R5 — Charter claim

The Merkle scheme is domain-separated (leaf 0x00, node 0x01, sorted pairs, odd node promoted), which defeats the second-preimage replay; `pob-merkle.mjs` self-tests outsiders and leaf/node collision. The PoB is identified by address against `pob_root`, owned by the signer, and burned by CPI in the same instruction, so a leaf spends exactly once. The window is clock-only and cannot reopen. The `pob_extra` pass-through sets `is_signer=false` on every forwarded account, so no pass-through account can smuggle a signature into Core's burn — this is the correct mitigation for the benign-hook brick, and the rejecting-hook case is the accepted, alarmed limit 46. I found nothing the hot wallet, a PoB holder, or a third party can do that SPEC 46 omits, within the bundled files.

---

## R6 — One-time configuration and the trusted hop

The royalty plugin is installed with `PluginAuthority::None`, which Core refuses to update or remove for anyone; the suite proves this both ways against a control collection (R.5/R.6/R.6a/R.6c), and no instruction in any program rewrites it. Confirmed immutable as claimed.

The redemption cap is **exactly** a rolling window over a 64-slot ring of timestamps: `rate_ring: [i64; 64]`, `rate_head: u8`, and the check is "the cap-th most-recent redemption is ≥ window old." `rate_head` stays in 0..63 (fits u8). The initial all-zero ring correctly lets the first `cap` redemptions through. When `cap > 64` the ring bounds it to 64, which is stricter, as stated. I found no off-by-one in `(head + 64 − k) % 64`.

`sweep_sol_for_swap` worst case: destination pinned to `swap_operator`, amount `> 0` and `≤ max_sweep_lamports`, cooldown enforced against chain clock, reserve preserved, operator must sign, guardian can stop. A compromised operator is bounded by cap × cooldown windows until the stop — this is the honest bound in limit 10 and I confirm the program enforces each term.

---

## R7 — Cross-program raw reads (recomputed from the structs)

I laid out `MintConfig` field by field from the struct. It is 997 bytes of fields (offsets 8..1004), +8 discriminator = 1005, +256 padding = **1261** total, which matches `MINT_CONFIG_SPACE` when summed. Every pinned offset reads correctly:

| field | computed | pinned (GOV/BURN) |
|---|---|---|
| version | 8 | 8 ✓ |
| collection | 9 | 9 ✓ |
| governance | 41 | 41 ✓ |
| minted_total | 141 | 141 ✓ |
| sales_stopped / sweep_stopped | 191 / 192 | 191 / 192 ✓ |
| sol_reserve / max_sweep / cooldown | 257 / 266 / 274 | ✓ |
| charter_closes_at | 442 | 442 ✓ |
| bare_burns_retired | 454 | 454 ✓ |
| sales/sweep_stopped_at | 518 / 526 | ✓ |
| sweep_floor / cooldown_ceiling / reserve_ceiling | 631 / 639 / 647 | ✓ |
| max_boost_weight / max_boost_epochs | 711 / 712 | ✓ |

`VaultRecord` (221 bytes incl. padding): version 8, asset 9, mint_index 41 — all match GOV's pins. `BurnConfig`: burned_total 42, redeem_window 50, rate_head 58, rate_ring 59 — match. `SealConfig`: version 8, collection 9, reserves-Vec 41 — match MINT's and BURN's pins. SPL token account (mint 0 / owner 32 / amount 64 / state 108) and SPL mint (decimals 44 / initialized 45, len 82) offsets are correct. **No offset error found.** This independently confirms round 29's offset recomputation.

---

## R8 — Suite, simulation, and build as evidence

- The floors **equal** the counts and are enforced with `-eq`, not `-ge` (MIN_ASSERTIONS=855, DET_FLOOR=891, ALLOC_FLOOR=39, POSTER_FLOOR=22, POB_FLOOR=14, LAUNCH_FLOOR=47, HOST_FLOOR=6, MAINNET_FLOOR=33, EXPIRY_FLOOR=4). A partial pass or a deleted assertion fails the runner. This closes the "floor accumulates slack" defect class.
- `build-mainnet.sh` proves, behaviorally, that the four mainnet artifacts **reject** the localnet test key and the localnet artifacts **accept** it, checks the source names Gary's key, and proves the sweep helper's mainnet bytes are `cmp`-identical to both the localnet build and `target/deploy` (the bytes the suite ran). The sweep helper has no `localnet` feature, so its tested and shipped bytes are the same by construction. This is as strong as a key-behavior proof can be without holding the mainnet key.
- Refusals are pinned to their *reason* via the `because()` helpers, and ID.1 asserts every assertion id is unique so a reason-pin cannot read another arm's error. This directly addresses the "rejected for the wrong reason" false-pass class.
- **Honest limitations of the evidence, stated so they are not over-read:** the Test Vault simulation's mint-authority and PoB-owner patches clone real mainnet accounts with one field changed (asserted byte-for-byte in `fixtures.mjs`/`clone-pob.mjs`); the swap fork proves real pool programs accept the built swap against cloned pool state but is not live money; the `expiry-budget` gate uses synthetic genesis records, not 20 full lifecycles; and some round-28 boundary arms (R28.A3/A4) are simulations. None of these are defects; they are the stated coverage boundary.

---

## The four questions about the accepted limits

1. **Is any limit worse than stated?** I found none that is exploitable beyond its statement. The one candidate is R1s-1 (native wSOL under limit 44's "any classic token account"), which is at most a rescue-path gap, bounded by the already-accepted airdrop-destruction cost.
2. **Is anything listed as a limit not actually a limit?** I did not find a listed limit that is already closed by something the author missed. Limits 25/26/27/28/32/41/44/46/47 all still describe live behavior.
3. **Is any discharged item not actually discharged?** I spot-checked 51 (boost), 54 (compute), 12/17 (CU), 14 (duplicate attrs), 19 (unlevelled halt), 30/31/33. Each is genuinely closed on-chain or superseded; I found no quietly-wrong discharge.
4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** Items 22, 38, 50, 52, 53 are still marked open and none is being treated as done. Item 50 (holder surfaces) remains the critical one: until the redeem page runs `judgeRedemptionCoverage` and sweeps via the helper, limits 9 and 44 have **no** preventive control, and the holder guide (marked DRAFT) must not ship before it.

---

## Findings, ordered

| ID | Sev | Construct | What it is | Evidence if true | Fix |
|---|---|---|---|---|---|
| R1s-1 | LOW (uncertain) | `programs/cbob-vault-sweep/src/lib.rs` `process` | Transfer-then-close on a **native wSOL** source may not sweep correctly; full native-balance transfer semantics differ from non-native. Bounded by limit 44 (airdrop destruction). | A test airdropping wSOL to a vault PDA, then open→Execute(sweep)→burn, failing at the SPL Transfer/Close and then refusing `VaultNotEmpty`. | Measure; if broken, special-case native accounts (skip transfer, let CloseAccount deliver lamports) or document non-rescue. |
| R0-1 | INFO | `bank/alarm.mjs` / `revenue.mjs` / `redemption-poster.mjs` (not bundled) | I could not read the consumer side of the M1 repair; only the reader (`txread.mjs`) and the selftest count are visible to me. | The selftest arm asserting a truncated signature pages `log_coverage_gap`, still reports a co-occurring instruction finding, and advances the cursor. | No code change; ensure that arm is in the 891 and visible in the next bundle, or bundle the three consumers. |
| R0-2 | INFO | `scripts/audit-coverage.sh` | Gate counts *bundling*, and excludes `Cargo.lock`; a dependency substitution is caught by build/rehearsal sha pins, not by this gate. Also greps only `scripts/audit*.ts` for the sent-set. | A future audit script saved as `.mjs` would be invisible to the sent-set. | Keep the exclusion documented; if audit scripts ever change extension, widen the grep. |
| R7-1 | INFO | All four programs | No new offset error; independent recomputation confirms round 29. Recorded so the next round can treat offsets as re-verified at `c5aab17`. | — | — |

No CRITICAL or HIGH. I attempted the pairing, the emptiness proof, the helper's pair/destination/lamport logic, the pool accumulator, the boost ring, the draw FIFO, the governance bars, the charter Merkle path, and every raw offset, and I could not produce a surviving defect in the bundled code.

---

## Given that no human firm will ever see this and the programs will be immutable, do these before launch

AI audit structurally cannot do the following, and each is a real residual risk:

1. **Run the live dress rehearsal end-to-end (item 22) with real, small amounts.** Nothing here has ever executed the crank, the reveal lane, or a full revenue cycle (sweep → swap → return → split, through *both* pools, plus one forced post-sweep failure walked through hand recovery) against a live cluster. The programs' arithmetic is proven on a validator; the I/O at ~2,100 vaults is not. This is the single largest untested surface and no amount of further reading substitutes for it.

2. **Build and ship the redeem page (item 50) before any holder can open a vault.** Until it runs `judgeRedemptionCoverage` pre-signature and sweeps via the helper, the undeclared-airdrop and nested-vault destruction paths (limits 9/44) have zero preventive control, and the DRAFT holder guide promises a surface that does not exist. The program-side guarantees are only as good as the client that assembles the redemption transaction.

3. **Verify every `initialize` value from `launch/mainnet-init.json` against the signed transactions, not just the JSON (item 38).** The checker validates the file; the programs accept a narrower set (off-curve guardian/operator, any window in 10s..24h). A wrong-but-accepted value is permanent. Have the actual four `initialize` transactions reconstructed from the ruled file and diffed, and keep `charter_opens_at` and `lock_deadline` genuinely OPEN until ruled.

4. **Move the two hot keys out of the single box before value accrues.** The $CBOB release wallet (all 2.1B, limit 56) and the swap-operator key sit on one machine with the alarm and the ledger; whoever can write the ledger can silence the alarm. The custody of the unreleased $CBOB into a multisig or a separate wallet, and the swap-operator float discipline, are human/operational actions an audit cannot perform or verify.

5. **Hold the PoB collection key cold or in a multisig through the 7-day charter window (limit 46).** This is the only window in which one key can end the project or capture governance; the exposure closes at `charter_closes_at` and never returns, so the mitigation is cheap and time-boxed. It is a key-management decision, not a code change.

6. **Re-run the rehearsal proof and the build proof at the release commit, then remove all five upgrade authorities only after every gate above is green.** The rehearsal-tree byte-exact reverse proof is of an earlier commit and goes stale on every change; the init-authority behavioral proof must be re-run against the exact deployed bytes. The order — verify, rehearse, then lock — is the only thing standing between a surviving bug and permanence.

7. **Stand up an independent re-derivation of the deployed program hashes from source by a second toolchain/box.** AI audit can read source and can read bytes, but the bridge "these bytes came from this source" is reproducibility. A second, independently-produced build that matches the deployed sha256 is the strongest available substitute for a human firm's build attestation, and it is currently asserted but not independently reproduced.