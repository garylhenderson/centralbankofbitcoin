# Round 38 — independent audit of the v6 tree

I read the whole tree, re-derived every cross-program offset and account space from the structs, re-tested round 37's three confirmed findings at their sites, and re-derived its measurements. Then I went looking for what a repair changes. I found one real coding defect in the round‑37 repair area, plus two documentation/robustness items. **No new CRITICAL or HIGH in the five programs**, and I found no path that moves value out of a vault, the pool or the revenue address.

---

## R0. Round 37's verdicts, verified

**I independently confirm all three of round 37's findings are real, and that each repair is at the site of its shape.**

**V1 (LOW) — flood blocks the redeem page.** Confirmed by reading: `vaultWalletAccounts` (`web/src/lib/reads.mjs`) makes one `getProgramAccounts`-per-program read, and the round‑37 tree's predecessor used one `getTokenAccountsByOwner`; the page's RPC is the proxy, which aborts a response over `MAX_RESPONSE = 8 MB` (`web/deploy/rpc-proxy.mjs:46, 216-235`); the failure became a `ReadError` and the redeem page showed only a refusal. The repair is present and correct in shape: the three reserve accounts are read **by address** (`reserves.map(m => ata(o, m))` → `accounts()`), everything else is listed in bounded reads (`dataSlice {64,8}` for classic and 165-byte T22, `{0,0}` for all T22), at most `STRAY_FULL_READ_MAX = 200` are read in full, and the residual is one tick‑box, never a refusal. The NFT read is bounded the same way. I could **not** verify the 448 bytes/account, the 18,723‑account threshold or the ~27.9 SOL figure — those need the real provider, which is exactly Gate‑5 item 1.

**V2 (LOW) — decoy collection stops the ceremony.** Confirmed by reading: `coreCreateCollection` (`web/src/lib/ix.mjs`) passes the update authority as `R(updateAuthority)` (read‑only, non‑signer) — which is *required* for step 0 to name MINT's `["mint"]` PDA — so anyone can create a collection naming it for one collection's rent. The repair is present: pins (config.js, SEAL, the launch file, browser memory, this session) win and every other chain collection is named and ignored; with no pin, a chain candidate is adopted only if `collectionCreator` proves the launch key created it.

**V3 (INFO) — frozen cbBTC activation copy.** Confirmed by reading: `activate` does `let (amount, _) = read_token(...)` (`cbob-vault-mint/src/lib.rs`), and `read_token` never inspects the state, so a frozen account CAN request and join. The repair is present in `planActivate` (it builds the instruction and adds a note), and `plan.test.mjs` now pins the frozen path.

**Offsets and spaces: recomputed, all correct.** I re-derived `MintConfig` (version 8, collection 9, governance 41, pool_ata 73, minted_total 141, bank_treasury 157, sales_stopped 191/192, guardian 193, swap_operator 225, sol_reserve 257, max_sweep 266, cooldown 274, charter_closes 442, bare_burns_retired 454, total_active_weight 462, active_count 470, acc 478, owed 494, last_distribute_at 510, stops 518/526, pending_guardian 582, notice 623, sweep_floor 631, cooldown_ceiling 639, reserve_ceiling 647, dist_epoch 655, pending_count 663, pending_this_epoch 671, cbob_mint 679, max_boost_weight 711, max_boost_epochs 712, boost_price 714, boosts_active 725, boosts_due 729, boost_weight_total 733, cbob_burned_total 741, boost_expiring 749..1005), `VaultRecord` (asset 9, mint_index 41, reveal_slot 49, level 57, active 125, retired 126, vault_ata 129, debt 161, pending 177, request_epoch 178, boost_weight 186, boost_end_epoch 187, carry 195; 211 + 10 padding = 221), `BurnConfig` (burned_total 42, redeem_window 50, rate_head 58, ring 59), `GovConfig` (quorum 41, threshold 43, min_voting 45, proposal_count 53, bump 61, per-kind marks 62/70/78/86), `SealConfig` (collection 9, reserves 41), `Proposal` (id 8, actions 16, …), `VoteRecord` (74). Every `*_SPACE` constant equals `8 + struct + padding`. All the pinned discriminators and indices (`BURN_IX_ASSET_IDX 0`, `BURN_IX_OWNER_IDX 2`, `SEAL_IX_ASSET_IDX 0`, `SEAL_IX_OWNER_IDX 2`) match the structs they bind. `programs/cbob-vault-sweep/Cargo.toml` has no `localnet` feature, so the tested bytes are the shipped bytes, as `scripts/build-mainnet.sh` proves by `cmp`.

**Not measured here (stated, not claimed):** no validator, no `run-tests.sh`, no `web/test/e2e-localnet.sh`, no alarm/crank/revenue job. The 895/925/39/24/49/33/14/4/71 counts, the 168,343 CU figure, the 1,061‑byte redemption, the 448 bytes/account and the e2e results are round 37's measurements, not mine. The `518/518` in `VERDICT-programs.md` versus `582/582` in `VALIDATION.md` is consistent (pre-repair vs post-repair floors; `run-all.mjs`'s floors now sum to 582), not a contradiction.

---

## Findings

### 1. LOW — a re-plan silently drops a classic stray from the sweep list, so the redeem page refuses an opening it says it never refuses

**Construct.** `web/src/lib/plan-redeem.mjs`, `planRedemption`, the block commented *"second pass (the re-plan just before the opening)"*:

```js
const canReceive = a => !s.noPrior || s.ownerAtaExists.has(ownerAta(a.parsed.mint).toBase58())
const noAccount = [...helperStrays, ...transferStrays].filter(a => !canReceive(a))
for (const a of noAccount) { helperStrays.splice(helperStrays.indexOf(a), 1); transferStrays.includes(a) && transferStrays.splice(transferStrays.indexOf(a), 1) }
```

`helperStrays.splice(helperStrays.indexOf(a), 1)` runs for **every** member of `noAccount`, including members of `transferStrays`. For a transfer stray, `helperStrays.indexOf(a)` is `-1`, and `Array.prototype.splice(-1, 1)` removes the **last element of `helperStrays`**. `transferStrays` is filtered correctly; `helperStrays` is not.

**What an attacker gains.** A classic stray (an airdropped token the vault holds with no foreign close authority) is removed from the helper's pair list without being added to `left` or to any acknowledgement. The page then:

* builds the opening without sweeping it, and `burn_vault` is never shown it (the page declares only the reserve ATAs to BURN), so nothing on chain refuses the burn; and
* runs `judgeRedemptionCoverage(owned, [...covered])` with `covered` **not** containing it, so the cross-check produces a reason naming its address; that address is not in `named`, so the page does `refuse.push("The vault holds something this page did not expect, so it will not open it: …")`.

So the observed outcome is a **spurious refusal that names nothing the holder can act on** — which contradicts the page's own invariant ("NOTHING here may block an opening"), `web/README.md` ("nothing a stranger can put at a deposit account refuses an opening, at any volume") and SPEC (`:937-939`, `:1954`). If the cross-check ever fails to flag it, the branch becomes worse: the stray is stranded with **no box** at all.

**Reachability.** `canReceive` is only ever false when `s.noPrior` is true (the re-plan). A transfer stray (a C5 account, or one whose mint is readable and unfreezable with a non-frozen receiving account) whose owner ATA does not exist lands in `noAccount`. The first plan creates the owner's ATA for every stray it sees, so the stray must **arrive between the first read and the button press** — trivial, because the holder reads the boxes and ticks them before pressing, and a stranger only has to hand the vault a 165‑byte token account of a fresh mint once. The vault must also hold at least one helper stray, which anyone can arrange with an airdrop.

**Evidence that would exist if I am right.** An offline arm in `web/test/plan.test.mjs`:

```js
const p = planRedemption(ids, snap({ noPrior: true,
  pdaTokens: [...snap().pdaTokens, tok(kp(300), kp(301), 9),            // the helper stray
              tok(kp(302), kp(303), 1, { closeAuthority: stranger })] })) // the C5 stray, owner ATA absent
// today:  p.helperStrays → []   (the helper stray was spliced out)
//         p.ack           → [ 'left:<302…>' ] and p.refuse contains the 300… address
// fixed:  p.helperStrays → [ '<300…>' ] and p.ack names both
```

The existing arm `L2: a stray of a NEW mint arriving after the set-up` does not catch it: its `late` stray has no close authority, so it lands in `helperStrays` and `indexOf` is correct. The e2e's W5 arm never passes `noPrior`.

**Fix (page only).**

```js
for (const a of noAccount) {
  if (helperStrays.includes(a)) helperStrays.splice(helperStrays.indexOf(a), 1)
  if (transferStrays.includes(a)) transferStrays.splice(transferStrays.indexOf(a), 1)
}
```

or filter both arrays by `canReceive`. Add the arm above and the matching e2e case.

---

### 2. INFO — the ceremony's creator check can be forced to `unverifiable`, and with no pin the page then offers step 0 again

**Construct.** `web/src/lib/ceremony-reads.mjs`, `collectionCreator`: the check reads the **first** transaction naming a candidate collection, up to `HISTORY_PAGE × HISTORY_PAGES = 5,000` signatures. Past that it returns `{ by: 'unverifiable', why: 'more than … transactions name it …' }`. `resolveCollection` then puts the candidate in `ignored` and returns `collection: null`, and `web/src/pages/ceremony.mjs` offers **step 0** — creating a *second* collection.

**Who can do it.** Anyone, for about 0.025 SOL: pad a collection's history with ~5,000 transactions naming it as an unused account. The window is the interval between step 0 landing and SEAL being initialized, in a browser whose `localStorage` memory is gone and before Gary has recorded the address in `config.js`.

**Why it is only INFO.** The page names the ignored collection in a warning box that says exactly what to do ("if the launch key did create it, write it in `web/src/config.js` and rebuild"), the outcome is a second collection that costs Gary rent and confuses explorers rather than a wrong collection in use, and once two launch‑key‑created collections exist the next run stops. It does contradict the page's own claim that a decoy "changes nothing".

**Evidence that would exist if I am right.** An offline arm: `resolveCollection` with `created: null`, `fromLaunch: null`, `remembered: null`, `discovered: [A]`, `creatorOf: async () => ({ by: 'unverifiable', why: '…' })` → today `collection: null` and `ignored: [A]`, i.e. step 0 is next. **Fix:** when the only candidates are `unverifiable` *and* one of them is not a decoy by name/URI, stop with "found a collection this page cannot verify; pin it in `config.js`" rather than offering step 0.

---

### 3. INFO — the holder guide over-states the frozen-cbBTC consequence for a zero-balance account

`HOLDER-GUIDE.md`: *"If Coinbase freezes your vault's cbBTC, you cannot open it at all (not even to take the $GARY and $GIRAFFISH) until Coinbase unfreezes it."* A frozen account **holding zero** can be closed (measured round 30, and stated in SPEC 44), and `planRedemption` correctly does not refuse it (`t.state === TOKEN_FROZEN && t.amount > 0n`). The vault can therefore be opened. The sentence is only false for an unactivated vault whose cbBTC account is frozen and empty, but it is written unconditionally. SPEC 28's reasoning ("a frozen account cannot be emptied") has the same gap. **Evidence:** an e2e arm that freezes an empty reserve ATA and lands the opening.

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?** No, in the programs. Two are *narrower* than the text suggests, and one is worse in a way the docs half-cover:

* **Limit 9 / 44** — "nothing detects a FOREIGN Core asset nested in a vault continuously, and since v6 nothing refuses the redemption either" — is stated accurately. But the redeem page's coverage cross-check is now the only pre-signature control, and **finding 1 above shows that control can refuse an opening it was designed never to refuse**. That is a control that fails in the *other* direction than the limit describes.
* **Limit 40's Core-size boundary** is stated as "bounded observations at the pinned binary, not a proof for every plugin shape or size combination". That is honest, and I could not narrow it.
* **Limit 46** — the hot PoB collection key — is stated more completely than any earlier round's text (round 24 A2, round 25 D8, round 37). I found nothing it omits. In particular the positive bound (the key cannot transfer or burn a PoB) is right: Core approves a transfer/burn only for the owner.
* **Limit 47** is right that the stop can be permanent, and the "vote plus a week" reading is correctly qualified.

**2. Is anything listed as a limit not actually a limit, or closed by something the author did not notice?** One:

* **Limit 27's second half** — "a bare-burned vault still WAITING to join can be joined by a `claim` that names it, adding weight nobody can collect until it is retired" — is still true, and the `JoinWaitingFirst` gate means such a join is *required* before the next distribution can run. But a bare-burned vault is not reachable by `activate`'s pending branch (`require_live_vault`), so the only way to clear the gate for it is `claim`, which pays nothing for a pending vault. That makes the gate clearable for free, which is what the crank relies on — worth saying explicitly, because it is the one place where the gate cannot deadlock. Not a defect; a limit stated with less precision than it deserves.

**3. Is any DISCHARGED item not actually discharged?** No. I re-checked 14 (duplicate attribute keys — refused in both mint paths), 15 (`VaultTooNew` against `index_snapshot`), 17/12 (compute — measured, byte wall binds first), 19 (`NotRevealed` in `activate`, no unlevelled active vault), 30 (`split_bps`/destinations/`max_supply` written once), 31/33 (`monthly_secs`/`notice_secs` are `initialize` values and exercised), and the v5 Bank/deck/distributor family. Each holds at the site.

**4. Is anything in OPEN AND BLOCKING quietly treated as accepted?** **Item 50 is the risk.** The redeem page is the only pre-signature control left after the Bank was deleted, and it is built and staged, not published. Round 37's V1/V2/V3 repairs are all in `web/`, and this round I found a further defect **inside** that repaired code (finding 1). That is the pattern to watch: `web/` is now load-bearing for the control table's `PROCEDURE` row, and it is the newest, least-audited code in the tree. Item 50 must not be closed on the strength of an offline test count alone; it needs the e2e arm plus a real-browser pass. Items 22, 38, 52, 53 remain genuinely open and none is demoted.

---

## R1–R8: what I checked, and what I could not

* **R1 (pairing).** Sound. SEAL binds asset at index 0 and owner at index 2 of the *later top-level* BURN instruction; BURN binds the same two of the *earlier top-level* SEAL instruction; both use `load_instruction_at_checked`, which sees top-level instructions only and reports the **outer** index during a CPI. So a wrapper needs a genuine top-level open *and* a genuine top-level burn for the same pair (WR.1–WR.4), and the fail direction is a halt. Two vaults in one transaction, an open before its own burn, and cross-pairing all resolve consistently. The thaw has no second caller and no re-freeze exists; `set_frozen(false)` is only reached after `found`.
* **R1 (emptiness).** The reserve loop requires the derived ATA under **both** token programs to be declared, PDA-owned, undelegated, extension-free and empty; a sub-165 token-owned account at a derived ATA address is not creatable (the ATA program sets `closeAuthority = None`, and `System::createAccount`/`assign` at a PDA address needs the PDA's signature). The second loop catches a declared live Core asset and a declared PDA-owned token account with extensions/delegation/balance. Undeclared holdings are destroyed — accepted, and correctly the page's job.
* **R1s (helper).** Access control is exactly Core's `ExecuteV1` owner rule; the pair checks refuse a foreign source, a mismatched destination mint, an aliased destination wallet, a wrong token/system program, an odd count and non-zero data; duplicate sources fail at the second read because the first closed the account. The lamport sweep reads at execution and nothing between it and `burn_vault` credits the asset-signer.
* **R2 / R2b.** `owed_scaled` is preserved by `reweigh`/`unschedule_boost`/`expire_boost`/`retire` (each is an exact identity on `weight*acc + carry − debt`), and `credit` adds exactly the sum of the vaults' increases, so `pool_balance ≥ ceil(owed_scaled)` holds inductively; `distribute`/`monthly_inline` both compute `avail = balance − ceil(owed)`. The boost earns **exactly N** distributions: it is bought at `dist_epoch = E`, ends at `E+N`, and `advance_epoch` moves the ring slot into `boosts_due` when `dist_epoch` reaches `E+N`, which is after the N‑th participating distribution; `BoostsExpireFirst` then refuses the next one. `BOOST_RING = 64` with `N ≤ 63` guarantees distinct slots. The `monthly_inline`-first ordering in `boost_vault` is what stops a boost counting the month it rides in on.
* **R3.** `SlotHashes` is parsed as `u64` count + `(u64, [u8;32])` entries with the declared count bounded, the buffer length checked, and a zero hash refused. A, B and C are the smallest produced slots in their windows; `want` advances two leader groups; `now ≤ reveal_slot` → `NotYet`, past the window → `Expired`, and `try_capture` returns `NotYet` (never a partial draw) if C does not exist yet. FIFO is `index == revealed_total`, and a burned vault still draws. SPEC 26's "chooses among many draws" is accurate, and the holder guide now says so.
* **R4.** Quorum is `ceil(snapshot × bps/10000)` with `need > 0`; threshold is YES of votes cast; turnout is `ceil(10% of snapshot)`; a key change is `ceil(50% of snapshot)` at creation; the two key changes cannot share a proposal; `last_*_id` ordering is per kind; a superseded action is logged and skipped, and the mark still moves. I found no way for a minority to carry what it should not, and no way to reach money. SPEC 47's "permanent at low turnout" is right.
* **R5.** Identity is by address against a domain‑separated, sorted‑pair Merkle root; the PoB is burned by CPI as its owner in the same instruction; the window is two `initialize` timestamps and a clock comparison; `pob_extra` accounts are passed never as signers and bounded by 8. SPEC 46 is as complete as I can make it.
* **R6.** Every `initialize` bound is checked in-program, and `scripts/check-launch-params.mjs` refuses the file before signing. The one residual the build script itself names is real and correctly stated: `build-mainnet.sh` proves the mainnet artifacts **reject the test key**, not that the compiled constant is Gary's key — a third wrong key rejects identically. The bridge is reproducibility, and that is a procedure.
* **R7.** Every offset recomputed and correct (above).
* **R8.** I did not find an arm that cannot fail among the ones I re-derived (`RL.S1-S6`, `P.11a`, `L.23`, `X.7`, `9.13a`, `R36.G2a/b`, `SR.*`, `3c.*`). The `because()` pins I sampled name the right program and the right code. Arms I could not re-run are named in R0.

---

## Given that no human firm will ever see this, and the programs will be immutable — what must happen before launch that AI audit structurally cannot do

1. **Run the mainnet dress rehearsal (item 22) and record signatures.** Specifically: one full live revenue cycle through Orca **and** one with Orca forced to refuse so Meteora really runs; one forced post-sweep failure walked through the hand recovery with `--audit` clean; the crank's live passes against ~2,100 vaults including a transient RPC failure at vault 1,900; the alarm's live passes in rehearsal mode. No round in this series has ever executed `bank/revenue.mjs` or the crank against a live cluster.
2. **Measure the real provider and the real proxy.** Round 37's V1 threshold (448 bytes/account, 18,723 accounts, ~27.9 SOL) is a synthetic estimate against an 8 MB cap that is code, not measurement. Get the actual per-account response size, the provider's own `getProgramAccounts` limits, and whether it paginates or times out before the proxy does. Then re-run the e2e with 320 parked accounts and with 20,000.
3. **Land a redemption from a real Phantom build**, not `signExact`'s in-process signer. `signExact` refuses a wallet that changes the message; that refusal has never been exercised against a real extension or the in-app browser, and the whole "the sweep helper fits" argument rests on the wallet not adding an instruction.
4. **Fund and exercise the three cbBTC accounts and the revenue rent on mainnet (item 52) before the first mint**, and confirm the Squads' ATA still exists. Until then every split and every paid mint fails, and the failure mode is loud but late.
5. **Build the four `initialize` transactions from `launch/mainnet-init.json` by machine, not by hand.** The checker validates the JSON; the round‑24 A6 note is right that whoever builds the transactions can diverge from it. Make the ceremony page the only builder and diff its bytes against the file.
6. **Have one person read the two load-bearing invariants against a live chain.** The pool's `owed_scaled ≥ Σ owed_of` and the open↔burn pairing are exactly the kind of thing a model re-derives from the same source it is checking. A human with a block explorer and the four account dumps is a genuinely independent check on those two and only those two.
7. **Re-read the pinned third-party program hashes and upgrade authorities at the moment of launch** (Core, Orca, Meteora, Pyth receiver and push oracle, Classic Token, Token-2022, ATA). The alarm watches them, but an upgrade between the audit and the lock is not covered by any assertion in this tree.
8. **Stop auditing and lock.** Thirty-seven rounds have produced a tree whose newest, least-tested, most load-bearing code is now `web/` — and this round found a defect inside a repair from the round before. The freeze counter is 0/2 and `web/` changes have reset it repeatedly. The remaining risk is not undiscovered program logic; it is that the control table's `PROCEDURE` row keeps growing while the freeze keeps not happening.