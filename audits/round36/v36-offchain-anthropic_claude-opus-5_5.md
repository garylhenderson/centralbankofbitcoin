# Round 36 off-chain audit: CBOB v6

## Summary

**No CRITICAL or HIGH findings survived checking.**

What I verified by reading, rather than taking on trust:
- Every Pyth, Whirlpool and LbPair offset in `swap.mjs`.
- The tick-array and bin-array derivations and their order.
- The exponent and rounding arithmetic in `oracleFloor`.
- The crank's planned account lists against MINT's `Accounts` structs.
- The accrual mirror against `credit`, `owed_of`, `reweigh`, `join` and `retire`.
- The `rescue_nested` CPI account list.
- The rescue log parser.

The findings below are mostly places where the documentation, the gates or the round-35 repairs do not match the code. Each one names the evidence that would settle it.

---

## R0: Round 35's record and repairs

**What I confirmed in round 35's triage:**
- **C1, C2, C15:** steps 9 to 11 now contradict nothing. `--final` appears only in step 11, and step 10 re-verifies first.
- **C3:** the GOV/MINT constant pins (R35.C3).
- **C4:** the custody statement.
- **Correctly disproved:** C6, C19, C20 and C23.
- **C9:** superseded, because payouts follow the vault.
- **Review M1 and M2 are repaired in code.** `rescue_nested` sends every vault to `config.bank_treasury` and refuses a foreign live host with `HostUnresolved`. The rescue PDA signs in exactly one `invoke_signed`.

### F1 (LOW, documentation): SPEC still describes the rejected first build of `rescue_nested`

- **Construct:** SPEC, "What got worse": *"`rescue_nested` now extracts it, to the host's owner while the host lives and to the CBOBTC Squads once it is burned…"*
- **The code:** `let dest = a.config.bank_treasury;` with no host-owner branch.
- **Why it matters:** review M1 was this exact design. A reader of SPEC is told the rejected behaviour is live.
- **Evidence:** grep SPEC for "to the host's owner while the host lives".
- **Fix:** replace it with "always to the CBOBTC Squads".
- **Related stale headline:** limit 44 still says "nested vaults are DESTROYED on redemption", while its body and item 58 say they are not.

### F2 (MEDIUM, a ruling is contradicted): item 58 makes the CBOBTC Squads a signer; ruling 3 and two SPEC tables say it signs nothing

- **The contradiction:**
  - DESIGN-v6 ruling 3 says the Squads *"signs nothing, ever."*
  - SPEC's revenue table says "(receives only, signs nothing)".
  - Item 58's whole recovery path is a Squads transaction that transfers each rescued vault back.
- **Review L5 is only half applied.**
  - The holder guide's "Who can do what" table still has no row for "anyone: rescue a nested vault".
  - It has no row for the Squads' custody of other people's vaults.
  - The Gary Club row still reads "cannot … move a vault in a wallet whose key it does not hold".
- **Evidence to check:** does R35.N2a ("the return") use a real Squads v4 vault transaction, or a keypair standing in for `bank_treasury`?
  - If it uses a keypair, the return path through a real multisig has never been exercised.
  - The Squads vault is off-curve, so the transfer back has to go through a CPI-signed Core TransferV1.
- **Fix:**
  - Record the change to ruling 3 as an explicit new ruling.
  - Correct both tables.
  - Add a guide row for rescue and Squads custody.
  - Make N2a use a cloned Squads v4 program and vault, or label it as not covering one.

### F3 (LOW, policy hole): "return it to the sender" can be the wrong person; review L1 and review I7 are unaddressed

VALIDATION lists M1, M2, the `unredeemable_owner` re-kind, the stale text, voting and the tests as fixed. It does not mention review L1 or review I7.

- **When the sender is not the rightful owner:**
  - Suppose vault V sits inside host H, and H changes hands before V is rescued, whether by sale, transfer, or a sale followed by a burn.
  - The `vault_rescued_to_squads` text says "find the wallet that sent it there".
  - That sender is the previous owner of H, not the person who controlled V at the time.
  - Under the Squads-only design this now also applies to live hosts. A vault sold "inside" another vault as a bundle is returned to the seller, and the buyer loses it.
- **The grief loop (review I7):** anyone can self-nest their own vault, rescue it, and demand it back, repeatedly. Each cycle produces an urgent page and a manual multisig transaction.
- **Fix:**
  - Write the return policy into item 58: last controller versus original sender, and the right to decline or batch requests.
  - Add a buyer warning to the guide.

### F4 (LOW): the C5 limit text overstates what the sweep helper can do

- **The claim:** SPEC says *"The sweep helper can move the token out … but cannot close the account."*
- **The code:** `cbob-vault-sweep` unconditionally issues `CloseAccount` with the PDA as authority after every transfer.
- **The consequence:** an account whose close authority belongs to a stranger makes the close fail, which reverts the whole redemption. The helper therefore cannot be used on it at all.
  - The page has to move it with a separate ExecuteV1 Token Transfer of a pre-read amount.
  - That is harmless here, because leftover junk in an undeclared account is simply destroyed.
- **Evidence:** a suite arm naming a C5 account as a helper pair should revert with an `OwnerMismatch` on the close.
- **Fix:** reword the text, and pin that the page never names such an account to the helper.

### F5 (LOW, an accepted limit worse than stated): index lag is not held inside the router's grace

- **The claim:** C10 says a lag is held for the router's "25-minute grace", so one that heals never reaches anyone.
- **The schedule:** the alarm runs at `23,53`, 30 minutes apart, and only the next full pass can send the RECOVERY.
- **The consequence:** if the grace really is 25 minutes, a lag seen on one pass is emailed about 5 minutes before the recovery can arrive.
- **Evidence:** in the router harness, emit `index_disagrees_with_chain` and emit its recovery 30 minutes later. The prediction is QUEUED, then sent, then RECOVERY.
- **Fix:** either treat `prevMinted ≤ seen < total` as lag (paging only on the second consecutive pass), or correct the limit text.

---

## R1: The crank

No mis-ordered reveal, no payment into a dead vault, and no value movement outside MINT's pinned destinations were found.

What I checked:
- `retiringOwed`.
- `preJoins` before the distribution, with join-only claim batches avoiding a frozen-pool `Transfer`.
- The weight arithmetic for pre-expired and post-expired boosts.
- The `joinedNow` debt.
- The reveal account list.
- The benign-race judgement.

### F6 (MEDIUM): no RPC timeout exists, though limit 25 implies one was repaired

- **The text:** limit 25 (A1) says web3.js's default `Connection` "(the crank's and revenue's at `2b67fb1`)" hung for 300.8 s. The qualifier implies the code changed since that commit.
- **The code:** `crank.mjs`, `revenue.mjs` and `alarm.mjs` each still call `new Connection(rpc, 'confirmed')`, with no `fetch` override, no `AbortSignal.timeout` and no `confirmTransactionInitialTimeout`.
- **The consequence:** a single hung socket stalls the reveal lane longer than the whole 300-slot window. During that time the `flock -n` runs skip silently, and draws lapse into the re-roll class.
- **Evidence:** point `HELIUS_RPC_URL` at `nc -lk`. The prediction is that `crank.mjs --reveal-only` does not return for more than 120 s.
- **Fix:** pass `new Connection(rpc, { commitment, fetch: (u, o) => fetch(u, { ...o, signal: AbortSignal.timeout(15000) }) })`.
- **Note:** this might already be overridden somewhere outside the bundle; if so, say where and the finding falls away.

### F6b (INFO): the crank never sends `rescue_nested`

Nested and orphaned vaults therefore depend entirely on someone acting on a page. Adding it is cheap and permissionless. Whether to is an operational choice, not a defect.

---

## R2: The alarm

### F7 (LOW): the item-58 custody rule is not watched

- **The rule:** item 58 states that the Squads does not vote with vaults it holds.
- **The gap:** nothing checks this.
- **Fix:** add a detector, since the GOV transaction walk already exists. It should page when a `cast_vote` or `create_proposal` is signed by a vault whose owner is `mint.bank_treasury`, with both-ways selftest arms.

### F8 (LOW): two mis-paged rescue states

- **A vault the Squads keeps is paged forever.** `vault_awaiting_return` is a HIGH level kind and is not in `ACKABLE_KINDS`. A vault the Squads keeps for good reason (no sender found, or a declined grief loop) pages every pass with no way to acknowledge it.
- **One rescuable case gets the wrong page.** A vault nested in a burned asset from a foreign collection falls through to `unredeemable_owner` CRITICAL ("marketplace escrow … or sealed for good"). This happens because `owners` contains only this collection's vaults. On chain, `is_burned(host)` makes that vault rescuable.
- **Fix:** add a reason-bound acknowledgement for `vault_awaiting_return`. For an off-curve owner, test whether it is the asset-signer PDA of a positively burned account and name the rescue in the text.

### F8b (INFO): a placeholder-era page to expect

The placeholders are deployed and upgradeable while `lock_deadline` is null. Any production alarm pass therefore emits `lock_deadline_unset` CRITICAL on every pass until that date is set. This is known (C14); expect it.

---

## R3: Layouts

The SEEDS assertion now exists, so round 24 D6 is closed.

### F9 (INFO): the seed gate is one-directional

- **What it checks:** layout seeds against the Rust.
- **What it misses:** Rust seeds that are absent from the layout. `RESCUE_SEED` is one, and the web pages derive it.
- **Fix:** also assert that every `pub const *_SEED` in the four programs is in `L.SEEDS`.

---

## R4: Arithmetic

No divergence found. I checked:
- `pendingScaled`, which equals `owed_of`.
- `reweigh`, `credit` and `ceilSats`.
- The join debt, which is the level weight only.
- The crank's credit denominator: `total + preJoin − retiring(incl. boost) − expiring`.

---

## R5: The swap and the revenue cycle

### (a) to (d), (f), (g): correct as built

- **Exponents:** the sign handling is right for both feeds.
- **Rounding:** `expectedSats` and `minSats` are both rounded down.
- **Units:** Orca's `other_amount_threshold` and Meteora's `min_amount_out` are both in output units (sats) and both carry `m2.f.minSats`. This is the same floor the deviation filter was computed against.
- **Derivations:** the Orca tick-array seeds and descending order for a_to_b, the Meteora bin arrays ascending for Y to X, the event authority, the oracle and the bitmap PDAs are all correct.
- **wSOL handling:**
  - Pre-existing, foreign-created or pre-filled wSOL accounts are handled by the idempotent create, the sync and the close back to the owner.
  - The wSOL mint has no freeze authority.
  - A stranger cannot set a delegate or a close authority on the operator's account.

### (b) Oracle selection (INFO)

- **The mechanism:** anyone may push any genuine Wormhole-verified price newer than the one stored into the sponsored account.
- **The effect:** an attacker can choose among real prices published since the last sponsor push (at most about 180 s). This adds a few basis points of bias inside the floor; it cannot introduce a forged price.

### (e) F10 (LOW): the judge does not pin Meteora's `host_fee_in`

- **The gap:** `judgeSwapInstructions` checks Meteora keys 0, 4, 5 and 10 only. Key 9, `host_fee_in`, should be the program id, which Anchor reads as None.
- **The consequence:** a builder defect or tamper could set it to any wSOL token account. Meteora's host-fee share would then be diverted on every Meteora cycle. The amount is small and the floor still binds.
- **Related:** the bitmap key (1) and the oracle key (8) are left to the program to validate, which is acceptable.
- **Fix:** pin key 9 to `METEORA.program`, non-writable.

### (h) A failed send misread as refused (LOW)

- **The path:** `classifySendFailure` returns `refused` for a transaction that expired with a null status.
- **The risk:** a lagging RPC that returns null for a transaction that actually landed would push the cycle on to the Meteora fallback.
- **The bound:** the second wrap needs `lamportsIn` that the operator no longer holds, its float being 0.02 SOL, so it fails. The delta check catches the rest.
- **What makes the bound hold:** limit 10 D2(1), the rule that the operator wallet holds nothing else. State that dependency explicitly.

### (i) What an adversary can extract within the tolerance

- **Per cycle:** each cycle is bounded by the on-chain floor, at most 150 bps below the oracle, less the honest fee.
  - Orca's fee is 16 bps, which leaves about 130 bps to extract, roughly $16 at 10 SOL and SOL at $120.
  - Pushing the price to the edge of the read-time gate, or forcing Orca to refuse so that Meteora runs, does not get past the floor.
- **Per month:** at the cap (4 sweeps a day) that is at most about $1.9k, roughly 1.3% of royalty volume. It is immaterial next to the 15% Squads share, but worth taking. Fix: submit through a Jito bundle or private RPC, and cut the tolerance to around 75 bps for Orca.
- **The operator key's worst case:** cap × windows, unchanged. In addition, a malicious upgrade to Orca, Meteora or Pyth can take one cycle (10 SOL), because the floor is enforced by the program being swapped through. That is paged only at HIGH.

### The ledger

The ledger cannot read a failed cycle as closed, because closing still requires `returnedSats > 0` together with a split anchored on chain.

---

## R6: Gates

### F11 (MEDIUM): `web/`, which builds every holder transaction and the step-10 ceremony, is outside every gate except coverage

- **The gaps:**
  - The ship gate's reset rule covers only `programs/`, `bank/` and `scripts/`. Item 50 even advises building the pages outside those paths so the counter is not reset.
  - `scripts/rehearsal-tree.sh` neither patches nor dirty-checks `web/`. Its `git ls-files` scope and status check both omit it.
  - `run-tests.sh` runs no web test and holds no web floor. The 457 offline and 80 end-to-end results exist only in VALIDATION.
- **Why it matters:**
  - The redeem page is the only preventive control for limits 9 and 44.
  - The ceremony page is what Gary's wallet signs `initialize` through.
  - If `web/` hard-codes program ids, as the commit "pin the round-35 MINT build hash" suggests, a rehearsal at throwaway ids drives the mainnet ids.
- **Evidence:** run `grep -rn Gsb7AGhK web/`, run `rehearsal-tree.sh`, then grep the rehearsal tree's `web/` for the mainnet id.
- **Fix:**
  - Add `web/` to the freeze trigger, the rehearsal map, the dirty check and `run-tests.sh` with an equality floor.
  - Re-run the item-53 proof, which is already stale (D4).

### F12 (INFO)

- **`build-mainnet.sh`** compares bytes only for the sweep helper (C12). Adding a `cmp` of the four keyed programs' `$LN_DIR` build against `target/deploy` would close the gap.
- **`cron-install.sh`** arms nothing it should not. The metadata generator job the pages rely on is scheduled somewhere outside the "exactly six jobs" assertion; name where.

---

## The four questions about the accepted limits

1. **Is any limit worse than stated?**
   - Limit 25: there is no RPC timeout (F6).
   - The C10 index-lag limit: the cadence is longer than the grace (F5).
   - Limit 58: the return-to-sender policy and the grief loop (F3).
2. **Is anything listed as a limit already closed, or no longer a limit?**
   - The "What got worse" orphan dilution is closed by `rescue_nested`, provided someone runs it.
   - Limit 44's headline ("nested vaults DESTROYED") is no longer true.
3. **Is any discharged item not actually discharged?** None found.
4. **Is any open item being quietly treated as accepted?**
   - Item 50's pages are being built deliberately outside the freeze (F11).
   - Item 53's rehearsal proof is stale and does not cover `web/`.

---

## What the project should do before launch that AI audit structurally cannot

1. **Run the dress rehearsal for real, at throwaway ids, with small value.** Run every item-22 sub-item, with transaction signatures archived. Add a live `rescue_nested` and its return from a real Squads v4 vault. Run the redeem page against a vault that a griefer is depositing into every slot.
2. **Reproduce the build independently.** A second machine and a second person rebuild from the release commit and confirm `dist/SHA256SUMS`. Gary's wallet then signs one `initialize` on a disposable deployment of the mainnet binary, to prove the compiled `INIT_AUTHORITY` positively. The build script admits it cannot prove this.
3. **Hold a key ceremony with a human witness.**
   - Before step 9, move the deploy authority `FZjLB4e9…` and the $CBOB release key off the box, onto hardware or a multisig.
   - Put the Giraffish Moments update authority behind a multisig or cold storage for the 7-day window (limit 46). This is the single largest exposure, and only Gary can close it.
4. **Have a human do the final page review.** Someone reads the exact bytes the ceremony and redeem pages put in front of Gary's and holders' wallets, through a wallet simulator, on mainnet-fork state. No model saw `web/` in this round.
5. **Arrange an independent incident line.** Someone other than the box owner must receive alarm pages and hold the guardian wallet's stop procedure. The detection half does not survive a compromise of the box (limit 10 D2(3)).
6. **Freeze `web/` alongside the programs**, then run the two clean rounds with different rosters, as the ship gate requires.