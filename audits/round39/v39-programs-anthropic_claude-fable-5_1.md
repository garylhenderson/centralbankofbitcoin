# Round 39 audit: programs, sweep helper, pages, documents

**Scope of this pass:** read-only against the bundled tree (HEAD `21f36e1`; program sources unchanged since round 35). I executed nothing. Every claim below names the evidence a run would produce if it is right, so it can be checked before anyone acts on it.

**Headline.** No defect found in the five programs. I recomputed every cross-program offset, every account space and the Merkle/plugin encodings and they match. Round 38's five repairs are present at their sites. One new page defect survives measurement by reading (MEDIUM): the round 38 V38-2 repair introduced a path where a stray the page promised to deliver is silently abandoned when the press-time listing is incomplete, which a stranger can cause cheaply. Two LOW items are documentation/design residue. Several INFO items are coverage gaps.

---

## R0. Round 38's verdicts and repairs

| Repair | Site checked | Holds? |
|---|---|---|
| V38-1 `splice(-1)` | `plan-redeem.mjs` `drop(list, a)` with `indexOf >= 0` guard | Yes |
| V38-2 one standing consent, late items never delivered, ≤2 dry runs | `LATE_CONSENT_ID`, `s.known`/`s.consented`, `late`, `lateInfo`, `prepareOpening` | Yes, with a new residue (**F1** below) |
| V38-3 unverifiable candidate | `resolveCollection` returns `unverified`; `ceremony.mjs` warns and still offers step 0 (B4 form), requires the "recorded" tick | Yes, matches VALIDATION |
| V38-4 limit 27 "who" | SPEC 27 now "every OTHER holder" | Yes |
| V38-5 guide's late-deposit promise | guide narrowed to "the vault's own three accounts and its wallet"; README names the C5 exception | Yes |
| C01 crank sends joins from a frozen pool | `bank/crank.mjs` not bundled | **Cannot verify from this bundle** |

Round 38's eleven disproofs (W1–W11): I agree with each on reading. Its MiniMax exclusion rests on content and is correct (the line numbers it cites do not exist in this tree). Its "regrade condition" for V38-2 (cNFT via DAS) is moot after the repair: a `cnft:` ack not consented becomes `lateInfo`, never a gate.

---

## R1 / R1s. Custody and the sweep helper

Attacked by reading: CPI wrappers (both halves require top-level counterparts, and both bind asset at index 0 and owner at index 2 of the other program's fixed account struct, which Anchor's seeds/address constraints make unforgeable), two vaults per transaction (each pair binds; the rate limit decides the second), the emptiness proof (COption offsets 72/121/129, state 108, length 165, both token programs, Core tombstone check), the helper's pair list (every case in (b) resolves to the right refusal or to the owner's own choice), the lamport sweep (system-owned 0-data account can be zeroed; nothing can insert an instruction between the helper and `burn_vault`), and the T22-ATA-for-a-classic-mint route (refused by the ATA program; the ATA address is a PDA no one else can occupy, R34.G2).

**No finding.** Specific answers the prompt asked for:

- (a) Access control is Core's `ExecuteV1` owner rule on a thawed asset; a frozen vault refuses Execute (0x9) so the helper is unreachable outside a redemption. Correct as measured (SR.5*, 3.7).
- (c) The destination not being compared with the owner is safe because only the owner can drive Execute; the page hard-codes the owner. A credit below rent to a non-existent destination fails the whole transaction (stated in item 50).
- (e) A closed reserve ATA passes BURN because `CloseAccount` reassigns it to the System program with zero data, so `acc.owner` matches neither token program and the loop `continue`s. That is the right reason. No stranger-creatable account escapes both the sweep and BURN's gate.
- (f) S8.0 measures 1,061 bytes with the owner as payer; page extras (+52, +96) give 1,209. A fourth reserve is impossible on chain. Each extra stray pair costs bytes and the page trims to fit.
- (g) The helper's deployed bytes are compared to `target/deploy` by `build-mainnet.sh`, but only at the moment that script runs; `run-tests.sh` rewrites `target/deploy` every run. The real guarantee is item 53's re-run at the release commit, which stays open.

---

## R2 / R2b. The pool and the boost

Checked `credit` (delta·w ≤ avail·S, so ceil(owed) grows by at most avail), `claim` (pool and owed fall together), `retire` (owed falls, pool unchanged), `reweigh` (owed unchanged, carry absorbs), `join` (owed_of = 0 at entry), `advance_epoch`/`unschedule_boost`/`expire_boost` (ring arithmetic; N=63 slot collision impossible since e'+N' must equal e+63 exactly), and the counters under retire of a same-epoch vs earlier-epoch pending vault. Liveness: `BoostsExpireFirst` is clearable by anyone with records only; `JoinWaitingFirst` is clearable by anyone through `claim` (the destination account is compared by address, never read, so a closed or dead account cannot block the join); `PoolShort` cannot arise without the pool losing tokens by a route that does not exist (freeze authority cannot move tokens; no permanent delegate on cbBTC).

**No finding.** The invariant "pool ≥ ceil(owed)" holds under every ordering I could construct.

---

## R3. The level draw

`blockhash_in_window` is a correct bounded parse; `try_capture` is deterministic once the chain is past `want+64` for each of A, B, C and waits (`NotYet`) otherwise; a run of ≥65 skips makes a window lapse, which reschedules. A burned FIFO head is drawn with Core write skipped and the attribute hash unchecked (correct, nothing to write). The attribute re-supply hashes the same Borsh bytes stored at mint. The holder guide's "pick among several results ... by skipping a block or changing what goes into it" is true; SPEC 26 is not understated. One unstated nuance (INFO): with an 8-slot stride, one validator holding both B's and C's rotations happens with probability about its stake share, and then its selection space is 16× skips rather than 4×. The residual class is the same.

---

## R4. Governance

Quorum/threshold/turnout/half-of-all arithmetic correct with ceilings; `yes_bps` floor division is equivalent to the intended `yes/cast ≥ threshold`. Per-kind marks, skip-and-log, `StopIsNewer` tie rule (GOV `>=`, MINT `<`) consistent. Proposal space 259 bytes, `ACTION_MAX_BYTES` 37 (Brakes), GovConfig 94+256, `proposal_count` at 53. **No finding.** Limit 47 is not worse than stated.

---

## R5. The charter claim

PoB identity by address, domain-separated Merkle (`0x00`/`0x01`, sorted pairs), tombstone makes a leaf unspendable twice, `pob_extra` never signers. SPEC 46 covers the hot wallet's two capabilities and the positive bound. Two things it does not say, neither a money defect: the hot wallet can also add an Oracle that rejects **transfers**, freezing the PoB secondary market through the window (a holder who was about to buy a PoB to claim cannot); and a PoB holder who bare-burns their own PoB has only harmed themselves. INFO.

---

## R6. One-time configuration and the trusted hop

Every `initialize` bound reads as SPEC states. The royalty with plugin authority None cannot be updated, removed or re-delegated (R.5/6/6a, R33.G3), and no MINT instruction can add a collection or asset plugin after `initialize`. The rate ring is a true rolling window: redemption i lands iff `t_i − t_{i−k} ≥ W`, so any half-open window of length W holds at most k. Swap operator worst case is cap × cooldown windows until `emergency_stop_sweep`, bounded by balance above reserve.

**F3 (LOW, documentation/operations).** See below: the INIT_AUTHORITY window between road steps 9 and 10.

---

## R7. Cross-program raw reads

Recomputed from the structs: MintConfig `governance` 41, `minted_total` 141, `sales_stopped` 191, `sweep_stopped` 192, `sol_reserve` 257, `max_sweep` 266, `cooldown` 274, `charter_closes_at` 442, `bare_burns_retired` 454, `sales_stopped_at` 518, `sweep_stopped_at` 526, `sweep_floor` 631, `cooldown_ceiling` 639, `reserve_ceiling` 647, `max_boost_weight` 711, `max_boost_epochs` 712; end of fixed fields 1005, space 1261. VaultRecord `mint_index` 41, `pending` 177, `request_epoch` 178, `boost_weight` 186, `boost_end_epoch` 187, `carry` 195, space 221. BurnConfig `burned_total` 42, `redeem_window` 50, `rate_head` 58, ring 59..571, space 827. SEAL reserves at 41. Sweep helper 0/32/64/165. Web `dueBoostRecords` slice 125..195 → bytes 0,1,61,62..70 are active, retired, boost_weight, boost_end_epoch. GOV's `Brakes` Borsh and MINT's `SweepTighten` agree. **All correct.**

---

## R8 and web/. Findings

### F1 — MEDIUM — The press-time re-plan abandons a stray the page promised to deliver when the listing is incomplete, under the standing consent, with no new box

**Construct.** `web/src/lib/plan-redeem.mjs` `planRedemption`, final re-plan branch (`s.known`, `s.consented`), together with `web/src/lib/reads.mjs` `vaultWalletAccounts` and `web/src/pages/redeem.mjs` press handler.

**Mechanism.** On the first check the page lists the deposit address's token accounts, finds a classic stray X (unfreezable mint, close authority none), puts it in `helperStrays`, and tells the holder: *"Your vault also holds N units of … The opening moves it to you too."* `known = {X}`. The holder ticks the boxes and the standing consent (whose text covers only things that **arrive after** the check). On the press, `freshPlan` re-reads. If `vaultWalletAccounts`' three `getProgramAccounts` calls throw (RPC transient, or a stranger has pushed the listing past the proxy's 8 MB cap), it returns only the three reserve ATAs and `incomplete.unlisted`; if instead more than `STRAY_FULL_READ_MAX` (200) balance-holding accounts are listed, X may fall outside the 200 read in full. Either way X is **not in `s.pdaTokens`**, so:

- `helperStrays` is empty: X is not delivered;
- no `lost:X` or `left:X` ack is generated (those are built only from `pdaTokens`);
- the only new ack is `unlisted:all` or `unlisted:<n>`; `aboutKnown` splits its id to `all`/`<n>`, which `known` does not contain, so it is moved to `lateInfo`;
- `plan.refuse` and `plan.prior` are empty; `prepareOpening` finds no `newAcks`, dry-runs (reserves only, which passes) and returns `ok`;
- the page prints *"Arrived after your check, left in the vault as you agreed: This page could not list the other accounts…"* and sends. X is destroyed with the vault.

Nothing in the code asserts `known ⊆ present`.

**What an attacker gains.** Nothing directly; it is a grief that destroys the holder's non-reserve stray and contradicts what the page told them. Cost to cause the `unexamined` variant: ~200 classic accounts with one junk mint, rent ~0.002 SOL each (recoverable if the stranger keeps the close authority), assigned to the deposit address between the check and the press; `getProgramAccounts` ordering is unspecified, so X lands outside the first 200 often. The `unlisted` variant needs no attacker at all (one failed RPC call at the press).

**Why it is a defect.** The holder guide hedges ("come out only if the page named them and could move them"), but the page's own sentence is unconditional, the standing consent explicitly excludes things present at the check, and the lateInfo heading mislabels them as late arrivals. This is exactly the class the prompt names: a holder loses value the page said was safe.

**Evidence if true.** Offline, with the `plan.test.mjs` snapshot helper: first `planRedemption` with X present → `helperStrays:[X]`; second with `s.known={X}`, `s.consented={...}`, `s.strayReadIncomplete={unlisted:'…'}` and `pdaTokens` = reserves only → `refuse:[]`, `prior:[]`, `ack` has no id containing X, `lateInfo` contains the unlisted text, `helperStrays:[]`. End to end: park >200 balance-holding junk accounts between check and press; the opening lands and X's account still holds its balance behind the tombstone.

**Fix (page only).** (1) In the re-plan, re-read every address in `s.known` **by address** alongside the reserve ATAs (as `vaultWalletAccounts` already does for reserves), so a flood cannot hide them. (2) Treat `known − present` as a stop: emit an ack per missing address (`lost:<addr>`, which is `aboutKnown` and so asks) or refuse with "could not confirm the extra tokens; check again". (3) Rename the lateInfo heading so items present at the check are never described as "arrived after your check". (4) Add the offline arm and an e2e arm with the flood between check and press (round 38's e2e parks accounts only before the check).

### F2 — LOW — A stranger can make the redeem page refuse by nesting their own CBOB vault, and the stated griefing policy contradicts itself

**Construct.** `plan-redeem.mjs` (`n.ourVault → refuse`), `web/README.md` open decision 7, SPEC item 50 text "no stranger can block an opening".

**Mechanism.** Any holder of a CBOB vault can transfer it to a victim's deposit address (Core permits it, 9.1). The redeem page then refuses (*"Another vault is inside… Rescue it first"*). `rescue_nested` is permissionless and moves it to the Squads, after which the opening proceeds, so the block is one extra transaction per nested vault. But the Squads "returns it to whoever sent it in", i.e. to the griefer, who can repeat; the only bound is the Squads' manual cadence and the griefer's vault count.

**Why it is a finding.** README open decision 7 says "nothing a stranger can put at a deposit address refuses an opening, at any volume" and two sentences later lists "a nested CBOB vault the page found" as a refusal. The two cannot both be true, and the nested-vault refusal is the one a stranger can trigger. No value is lost.

**Evidence.** Deterministic from the code; e2e: a stranger nests a vault, the owner's check refuses, a rescue lands, the opening lands.

**Fix.** Documentation: state the exception plainly. Design options: have the redeem page offer the rescue inline (in the prior transaction, since the redemption is near the packet limit), and record a Squads custody rule that a vault used to grief an opening is not returned to its sender on request.

### F3 — LOW — INIT_AUTHORITY is first-come between road steps 9 and 10, and SPEC does not say so

**Construct.** All four `initialize`s (`require_keys_eq!(authority, INIT_AUTHORITY)`), SPEC road steps 9–11, limit 47's "operational note".

**Mechanism.** After step 9 deploys the real bytes, the four config PDAs are empty until Gary's ceremony. Whoever holds Gary's Phantom key in that window can run SEAL then MINT/BURN/GOV `initialize` with their own `bank_treasury`, `swap_operator`, `guardian`, `pob_root` and collection. The configs are `init` PDAs and can never be rewritten; the alarm's `test_value_in_production` would page only afterwards; the only recovery is new program ids (a program change). The ceremony's `readStep` would correctly show "WRONG ON CHAIN: STOP", so Gary would not sign over it, but the ids are already lost.

**Evidence.** Deterministic from the code: the configs have no other gate.

**Fix (documentation/procedure).** State the window in SPEC step 9 and limit 47; run steps 9 and 10 in one sitting with the ceremony page already open and its preflight showing every config absent; keep the Phantom key offline except for those minutes.

### INFO — coverage gaps (no defect claimed)

- Item 52's claim that the in-line monthly run "performs the launch tick without reading the pool" is true by reading (`total_active_weight == 0` branch precedes the pool owner check) but no arm runs a host before the pool account exists.
- No arm exercises a `Brakes` action whose `sweep` half is skipped by `stop_is_newer` while its `sales` half lands, nor `expire_boosts` with a retired record in the batch, nor `redeem_window_secs` above 24 h, nor GOV `threshold_bps` outside (5000, 7500], nor SEAL `ReserveMintNotDeclared`, nor a charter window over 90 days. Each refusal reads correctly.
- Round 38's A4 list of seven arms without `because` pins still stands.
- `build-mainnet.sh`'s helper-bytes equality is proven only at that script's run time; item 53 (re-run at the release commit) is the real gate and stays OPEN.

---

## The four questions about the accepted limits

1. **Worse than stated?** Limit 44's statement that the coverage list "can be a SWEEP LIST rather than only a warning" is weaker than written at press time (F1). Limit 47's operational note understates the INIT_AUTHORITY key's pre-ceremony power (F3). Limit 26: not worse; one INFO nuance (a validator holding both B's and C's rotations) is within the stated class. Limit 27: correctly attributed since V38-4. Limit 32, 41, 46: as stated.
2. **Not actually a limit?** None found closed. Limit 9/44's "nothing refuses the redemption" is now slightly over-broad: the page refuses a nested CBOB vault (item 58), which the text could say.
3. **Discharged not discharged?** 51, 54, 12/17, 14, 19, 30, 31, 33: each verified against the code or the suite (e.g. `MONTHLY=150`, `NOTICE=60`, `REDEEM_WINDOW=10` are exercised; `MAX_BOOST_EPOCHS_BOUND=63`).
4. **Open quietly accepted?** No. 22, 38, 50, 52, 53 remain open in SPEC and `launch/mainnet-init.json` still has three OPEN values that `judgeLaunch` refuses.

---

## Holder guide vs code

Every money sentence I checked is true of the programs: the first-payout timing (clock starts at charter close; the burn path needs a join, a join needs a tick), the 2.1%/hour cap, the three-reserve all-or-nothing, the frozen-cbBTC refusal, the forfeit during a pool freeze, boost ceilings 12/24, guardian powers. The one sentence F1 touches is the page's own, not the guide's; the guide's hedge ("could move them") is true but the page should honour it.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run the flood-at-press vector against a real RPC provider**, not the local validator: park 300 balance-holding accounts and 18,000 empty ones at a deposit address between a redeem check and the press, through the real proxy and provider, and watch whether the page abandons a promised stray (F1). The local e2e cannot reproduce provider response caps or `getProgramAccounts` ordering.
2. **Exercise every holder page with a real Phantom (extension and in-app browser) on the mainnet dress rehearsal**, especially whether Phantom's guard/simulation layers alter the message `signExact` compares. Rounds 36–38 list this as unmeasured; it decides whether any holder can open a vault at all.
3. **Do item 22 and item 53 literally**: a live revenue cycle through both pools, a forced post-sweep failure walked through hand recovery, the full `run-tests.sh` in the rehearsal tree at the release commit, and one DAS read of a burned Core asset. A reader cannot produce a mainnet provider's behaviour.
4. **Run steps 9 and 10 in one sitting with the ceremony preflight open** (F3), with Gary's key used only in local mode through the tunnel, and re-dump all five programs immediately before and after.
5. **Decide and write the Squads custody rules** that no program enforces: it never votes with a rescued vault, and it does not return a vault used to grief an opening (F2).
6. **Reproduce the five `.so` files on a second machine from the release commit** and compare sha256 with `dist/SHA256SUMS` before step 11. The key-proof script shows the mainnet build rejects the test key; only an independent rebuild shows the bytes are the audited source.
7. **Put real humans in front of the redeem page's acknowledgement boxes** before publication and record whether they understand "lost when the vault is opened". No model can measure comprehension, and every undeclared-stray outcome in this design rests on it.