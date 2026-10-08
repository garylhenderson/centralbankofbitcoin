# Round 37 audit, whole tree (programs, sweep helper, `web/`)

This was a read-only audit: I ran nothing and measured nothing. Every "verified" below means I recomputed it from the source in the bundle. Every "would exist if true" names the evidence that settles it.

**Result: I found no defect in the five programs and no path that moves value out of a vault, the pool or the revenue address.** Round 36's repairs hold at every site of their shape. I have two LOW findings and three INFO items, all in `web/`, the build gates and documents. Whether they break the clean-round streak is a grading call under SPEC gate 3, which I note under the findings.

---

## R0. Round 36's verdicts and repairs

I checked each confirmed finding's repair at every site of its shape.

- **H1 (a stranger freezes the holder's receiving account for a junk mint).** In `plan-redeem.mjs`, `undeliverable()` now keeps a stray out of the helper when any of these hold:
  - the mint's freeze authority is held by someone and the mint is not a reserve;
  - the holder's destination account is already frozen;
  - the mint is unreadable;
  - a dry run failed with strays attached (`dropStrays`).
  
  I checked the shape's other sites:
  - The C5 transfer path goes through the same filter.
  - The three reserve destinations are exempt only for cbBTC, whose freezer is Coinbase and which is already an accepted limit. $GARY and $GIRAFFISH have no freeze authority, per the mainnet probe.
  - A mint with no freeze authority cannot gain one later.
  - The re-plan runs with `noPrior`, so it never asks for another set-up transaction.
  
  The repair holds for the *vector*. The *volume* variant is F1 below.
- **L1 (RPC proxy relays non-CBOB transactions).** The repair exists but does not achieve its purpose (F2, INFO).
- **L2 (payout vs due boosts).** `planPayout` runs expire, then join, then distribute. The bytes match `ixExpire` and the 30-record and 20-batch arithmetic fits the packet. In MINT, `expire_boosts` and `distribute` agree, and the payout dry runs refuse before any burn. Holds.
- **L3, L5, I1, I2 (documents).** Applied as far as I can see. The README's hash table has `mainnet` and `mainnet-local` rows, and the bundle test compares both. I did not run it.
- **L4 (release binding).** `web/build.mjs` refuses unless `dist/MANIFEST.txt` names `RELEASE_COMMIT` on a clean tree and the pins equal `SHA256SUMS`. One structural note, not a defect: a commit cannot contain its own hash, so `config.js` can only name an *earlier* commit than the one it lives in. That is exactly the current arrangement, and it is sound as long as the programs did not change between those commits.

I also independently recomputed these, and all agree between the code and the tests and docs:
- every MINT config offset (the GOV and BURN raw reads, `OFF_*` 41/73/141/191/192/257/266/274/442/454/518/526/631/639/647/711/712);
- all `*_SPACE` constants: `MINT_CONFIG_SPACE` reaches the boost ring at 749 and totals 1,005 plus padding; `VAULT_RECORD_SPACE` is 221; the BURN ring offsets are 50/58/59;
- the dueBoost `dataSlice` (125, length 70) against `VaultRecord` offsets 125/126/186/187.

---

## R1 and R1s. Custody and the sweep helper

I tried to break these and could not.

**SEAL / BURN pairing.**
- SEAL scans forward from the current index and fails closed on `Err`. BURN scans `0..current`.
- Both bind account 0 (asset) and account 2 (owner).
- `retire_redeemed` needs stack height 2 and the top-level instruction to be BURN's `burn_vault` for the same asset. A wrapper's CPI sits at height 3 or more, so it is refused.
- Anything between open and burn that changes the asset's owner fails the owner check in BURN.
- A thaw that outlives its transaction is impossible: BURN is required later in the same transaction.

**Emptiness proof.**
- The reserve loop looks up each expected ATA by exact address. An account owned by neither token program is skipped. A closed or system-owned account has no lamports and passes for the right reason.
- The second loop applies the same delegate and close-authority checks to any other declared token account the PDA owns. This is the accepted gap and is stated correctly.

**Helper (a)–(e).**
- Core's `ExecuteV1` is the only gate, and it admits the owner only (SR.5, 5a, 5c, 5d).
- A source that is also a destination is impossible: it would need `src_owner == signer` and `to_owner == dest` with `dest != signer`.
- A duplicate source is refused by the second pair's owner check on the closed source (SR.12a).
- A delegated source: transfer by the owner is fine and close ignores delegates.
- A native wSOL source: the transfer moves lamports, then the close succeeds.
- The lamport sweep reads the live balance after the closes, and BURN's `lamports == 0` sees exactly what is left.
- A kept-close-authority source reverts the whole call, which R36.C5 measures.
- No arm exercises a delegated or native source (see R8).

**Reserve ATA that does not exist.**
- A stranger can create a classic ATA for the vault and deposit into it before the redemption lands, and the helper cannot name an account that did not exist when the page built the transaction. The page's prior transaction creates all three, so the account exists and is named.
- A Token-2022 ATA for a classic mint cannot exist (mainnet probe).
- A non-ATA token account or nested NFT is the accepted undeclared-holdings case, now surfaced as an acknowledgement.

**(f) Fit.** I recomputed the shape: 1,061 bytes plus 148 for a compute-budget pair and a separate payer. Each stray pair adds about 64 bytes. The page's fit loop moves strays to acknowledgements instead of refusing.

---

## R2 and R2b. Pool and boost

I proved the invariant on the arithmetic. I did not run it.

- `credit` adds `delta = floor(avail·S / w)`, so `owed` rises by `delta·w ≤ avail·S`, and `ceil(owed') ≤ ceil(owed) + avail ≤ balance`.
- `claim` lowers `owed` by `pay·S`, an exact integer multiple of the scale, so `ceil(owed)` falls by exactly the sats paid.
- `join` leaves a vault's pending at 0. `retire` subtracts exactly that vault's pending. A weight change preserves it through `carry`.
- Each of these steps keeps `owed_scaled` equal to the sum of the per-vault shares, and every step is checked arithmetic.

Boost ring:
- Epochs are bounded to 1..63, and live end epochs span at most 63 consecutive values, so no two live boosts share a ring slot.
- A slot drains when the epoch reaches it. A due boost leaves the ring when it becomes due.
- Early retire and due retire both unschedule at the right slot (the host test drives 260 epochs and the suite BO.38).
- `expire_boosts` needs only records, so a missing token account cannot block `BoostsExpireFirst`.

Liveness: a waiting-to-join vault can always be joined by a free `claim`, and a bare-burned pending vault is released by `retire_burned`.

---

## R3. Level draw

- The SlotHashes parse is bounded and refuses an all-zero hash.
- The A, B, C chain steps by `(slot/4 + 2)·4`.
- C is at most about reveal+208, inside the 300-slot window, and A is always still in the 512-entry buffer at the window's end.
- FIFO holds, and a burned vault still draws. Re-supplying attributes is hash-checked.
- A crank record that is also the host's typed record cannot corrupt state. In `activate` the stale level 0 makes the whole transaction revert (R24.5). In `mint_vault` the new record is still zeroed, so `load_record` skips it.
- Limit 26 is stated correctly. A skip by A's or B's leader moves C but those leaders cannot see hC, so that is a blind re-roll. The selective power belongs to C's leader. HOLDER-GUIDE says this truly.

---

## R4. Governance

- Every GOV bound mirrors a MINT bound: the reserve floor, `x ≥ floor`, `x ≤ ceiling`, price and weights. A proposal that passes creation cannot be refused at execution except by its own skip logic.
- Skips are logged, not reverted.
- Replacing the guardian needs half of the snapshot's live vaults. A stolen guardian's stop is permanent below that turnout, but a replacement can be bundled with an `execute_proposal` and a `mint_vault` in one transaction, which the thief cannot interleave. So SPEC 47 is slightly pessimistic, not worse.

---

## R5. Charter claim and SPEC 46

SPEC 46 is complete. The hot Moments key can reject, selectively admit, or freeze trading of Proofs of Burn, but it cannot burn or transfer one. `pob_extra` accounts pass through as non-signers, so they carry no privilege into Core.

---

## R6 and R7. Initialisation and cross-program reads

No wrong-but-accepted value that the checker does not catch:
- SEAL's collection is checked only by MINT and BURN afterwards.
- Off-curve guardian or operator keys are accepted by the programs and caught by the checker and ceremony.

All cross-program offsets and spaces are as listed under R0.

---

## R8. Evidence and gaps

I found no arm that cannot fail. I could not find a `because` pin for the wrong reason except where noted below.

- **Untested helper shapes:** a delegated source, a native wSOL source, a duplicate destination. I predict each passes by Token semantics.
- **R34.G2** has no `because` pin; Round 36 listed that too. It sits among the 8 or so negative arms without one.
- **Web tests (518) and the e2e (103/103) are not invoked by `scripts/run-tests.sh`,** and the e2e has no floor. All of round 36's confirmed defects were in `web/`, so the build's gate should include them.

---

## Findings

### F1 (LOW). A stranger can flood a vault wallet and make the redeem page unable to open it

**Where.** `reads.mjs` `tokenAccountsOf` / `coreAssetsOwnedBy`, `rpc-proxy.mjs` `MAX_RESPONSE`, and `plan-redeem.mjs`, which emits one acknowledgement box per stray beyond what fits.

**Claim made.** `web/README.md` item 7 says "nothing a stranger can put at a deposit address refuses an opening". HOLDER-GUIDE says "On the redeem page that cannot block the opening".

**Why it fails at volume.**
- The page reads every token account the deposit address owns in one `getTokenAccountsByOwner` call per program, with no limit.
- The proxy truncates any upstream response over 8 MB (`readCapped` throws), and public providers have their own limits.
- A stranger can create tens of thousands of token accounts owned by the PDA, for roughly 0.002 SOL of rent each.
- Past a few hundred non-empty strays, the page also demands a tick per stray.

**Estimated cost.** My arithmetic gives about 20,000 accounts (tens of SOL) to exceed the cap. This is an estimate, not a measurement.

**Harm.** It denies the *page* only; no funds are lost. A holder can still open the vault with another client, but that client has none of the warnings.

**Evidence if true.** A vault with N ≥ ~20,000 owned token accounts makes `/redeem/` show "Could not read the vault wallet's token accounts", or the tick list reaches thousands.

**Fix, page only.**
- Cap the listing and add a single "everything not listed is lost" acknowledgement.
- Page `getTokenAccountsByOwner` with filters, or enumerate non-empty accounts only.
- Reword the README and guide to "cannot block an opening by any realistic means".
- Add an e2e arm with a few hundred strays.

### F2 (LOW/INFO). The round-36 L1 repair does not make the proxy "not a relay"

**Where.** `rpc-proxy.mjs` `txRefusal` returns `null` as soon as any instruction is a CBOB program.

**Bypass.** The sweep helper called with an unfunded signer and no pairs succeeds as a no-op, so appending a bare System or SPL transfer to it relays arbitrary transfers. The README's wording ("relays only transactions that call a CBOB program") is accurate. Its implied purpose is not achieved.

**Cost of the bypass.** It is rate-limited at 1 `sendTransaction` per second per /64, and abuse spends only provider credit.

**Fix.** Either reword to say it does not stop relaying, or pin the allowed CBOB instruction discriminators (decode each instruction), or accept it.

### F3 (INFO). Build gate gap

The 518 web assertions and the e2e are outside every enforced floor (see R8). Add them to `run-tests.sh` with an exact floor before item 50 closes.

### F4 (INFO). Untested helper shapes

Add arms for a delegated source, a native wSOL source and a duplicate destination. Add the `R34.G2` reason pins. Add rescue-host arms for a collection, a non-Core account, a foreign burned host and a two-vault cycle.

### F5 (INFO, documents only)

`BadSweepBound`'s message reads "cooldown 1s to 7 days", but `initialize` bounds the cooldown at 24 hours, and 7 days is only the ceiling a tighten may reach. The message is immutable, so SPEC should say which bound is which.

---

## The four questions about the accepted limits

1. **Is any limit worse than stated?** Item 32 is correct as written: blocking costs mint price per vault, and lifetime supply (2,100) bounds the attacker's total capacity. I found no limit that is worse.
2. **Is anything listed as a limit not actually one?** Item 47's "permanent stop at low turnout" is weaker than stated, because holders can bundle `execute_proposal` and a mint atomically. It stays accurate as a conservative statement.
3. **Is any DISCHARGED item not discharged?** None. I re-derived items 14 and 19 and they hold.
4. **Is anything in OPEN AND BLOCKING quietly treated as accepted?** Item 53's rehearsal value set and mode are named as not built. Item 50 is OPEN, but the web-test gating gap (F3) is not named as part of it.

---

## What to do before launch that AI audit cannot do

1. **Run the dress rehearsal with the real holder pages**, signed by real Phantom on desktop and mobile. Verify that the wallet does not rewrite the message, since `signExact` refuses any change (U1 from round 36). Land one claim-first redemption of an active vault with a month due on the rehearsal deployment.
2. **Land one real return of a rescued vault from a real Squads v4 vault** (U2), because the suite uses a keypair standing in for it.
3. **Have a person walk the ceremony from a clean machine in local mode.** Decode the `initialize` instructions with an independent CLI decoder and compare them byte for byte against `launch/mainnet-init.json`. Confirm the `app.js` hash against the committed table.
4. **Verify the deployed bytes yourself from a clean machine** for each program: the first N bytes hash to `dist/` and the tail is zero. Do this at step 9, and again at step 11 after removing the authority.
5. **Measure real-provider behaviour for F1:** how many owned token accounts the provider and the proxy can actually return.
6. **Hold the deploy authority offline until step 11,** and exercise its loss procedure on a local validator.
7. **Practise the guardian's stop on the live rehearsal,** including who holds the key and how fast they can sign.
8. **Put the web tests and e2e under the build's floors,** and re-take every pin (program hashes, web hash table) from the actual release build only after the last commit that touches `programs/`, `bank/` or `scripts/`.