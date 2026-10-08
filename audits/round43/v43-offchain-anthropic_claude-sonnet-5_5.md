# Round 43 audit: off-chain pipeline, tooling and web tests

I did not run any of this. Everything below comes from reading the bundled files. Where I say "measured", I mean a figure from your own logs or the verdict's logs. Where I say "source-read", I mean I traced the code and did not execute it.

I found no CRITICAL, HIGH or MEDIUM defect. I found two LOW and three INFO. All five are in the fixable layer (alarm, swap builder, tooling), so none of them breaks the launch gate under (a)–(d). Against the launch gate, nothing here touches the five programs, a value path, or a holder's ability to redeem.

---

## R0. Round 42's verdict and repairs

**C01 repair (`bank/alarm.mjs`, the shrunk-index baseline). The repair holds at its site.**
- When `trustCurrent` is false, `judged` is the current list plus the stored vaults minus the burnt ones. `legs` is built from `judged`, and `balances`, frozen detection and `detectBalanceDrops` all read from those legs.
- The rollback at `if (!delivered)` still restores `prev.balances`.
- Sibling baselines written beside `vaults`:
  - `frozen`: the frozen findings come out of the same `legs` loop, so the repair covers it.
  - `cursors`, `backlogs`, `seenSplits`: these do not depend on the vault list.
  - `detectNestedVaults` and the reconcile still run on the short list. The shrink itself pages CRITICAL, so I count that as acceptable.
- One consequence to know about: a vault that was honestly redeemed and that DAS dropped from both lists is read through its closed ATAs. That produces `balance_unreadable` HIGH with the prior value carried. This is the loud direction, and it clears on the next trusted pass because the baseline keys are rebuilt from `vaults`.

**V42-2 repair (`collectionCreator`, not in my bundle).**
- I only read its tests.
- I agree with the departure from the triage: "a launch-key create of a different address" is `unverifiable`, not `other`.
- A stranger still gets `other` for a decoy, because they have a successful create for it.
- A stranger cannot turn the real collection into `other`, since that needs our key's create.

**C12 / limit 59.**
- Core's create refuses a funded address, which is a real property of `create_account`.
- `checkNewAddress` has the right three-way logic: empty reuses the key, Core-owned means already landed, anything else gets a fresh key.
- The cost asymmetry holds: the griefer strands about 650k–890k lamports per attempt against the holder's 5,000-lamport fee.
- I could not read `checkNewAddress` itself, only `get.test.mjs`'s arms for it.

**C15 (squatting a config PDA with a data account) is correctly disproved.** System `CreateAccount`, `Allocate` and `Assign` need the new account's signature, and a PDA or ATA address has no key. Dust is the only unsigned stranger action. R31.W2a, R34.G2 and V41-1 pin it.

**C06 (Pyth exponent).** The repair bounds `expo` to −18..0. The real feeds are −8. The 10^18 worst case is harmless in BigInt. I checked the call sites: `readPyth` and `oracleFloor` both enforce the bound.

---

## R1. The crank

I traced all of the following against MINT's source:
- the instruction discriminators and argument encodings;
- every account list and order (`reveal_level`, `claim`, `distribute`, `split_revenue`, `activate`, `retire_burned`, `expire_boosts`);
- the send order (retire, join, expire, split, distribute, expire, activate, claim);
- the owed arithmetic in all three branches: pre-joined, pre-expired and ordinary.

Findings, all source-read:
- I found no plan the program would refuse, other than the races the code already classifies as benign.
- I found no plan that pays or joins a dead vault. `assets[...] !== 'live'` and `=== 'burned'` guard every site.
- I found no reveal sent out of order. The queue walks from `revealed_total`, and a vault that is not ready stops the run.
- The crank moves value nowhere the program does not already pin. The only `programId` it names is MINT. It builds no transfer. The fee payer signs only as fee payer.
- `budgetPlan` keeps the floor on every branch and reveals are budgeted last.
- The `reveal` run `break`s on an attribute-read failure without adding to `failures` (round 42 C23, disproved as a defect). It stays loud only through `reveal_queue_stalled`.

---

## R2. The alarm

**Covered, as asked:**
- `WATCH`, `THIRD_PARTY_PROGRAMS` and `detectUpgradeAuthorityAfterLock` cover all five programs, the sweep helper included.
- Fixed-forever values drift at CRITICAL.
- Pending guardian and pending swap operator are paged.
- The Proof of Burn collection's plugins and update authority are watched.
- The production list asserts 21% / 51% / 3 days, the 7-day notice, the tighten bounds, the 30-day month and the one-hour window.

**Quiet but dangerous: nothing alarms on the $CBOB release wallet (LOW, F2 below).**

**Routine but paged: `lock_deadline_unset` CRITICAL on every pass today (INFO, F3 below).**

---

## R3. Layouts

- The field lists are asserted against the Rust structs by `parseRustStruct`, which now throws on any line it cannot read.
- `SEEDS` is scraped from the Rust (D6 is real).
- Cross-program offsets are scraped and compared, with a guard that nothing scraped goes uncompared.
- The space arithmetic, versions and `BOOST_RING` are checked against the Rust.
- Changing a struct without mirroring it turns the build red. I could not construct a way past these assertions.

---

## R4. Money arithmetic

- `pendingScaled` equals `owed_of` exactly: `(weight+boost)*acc + carry − debt`, with an error where MINT errors.
- `reweigh`, `ceilSats` and `available` are mirrored faithfully.
- The crank's `retiringOwed` frees the owed share before distribution, as MINT's `retire` does.
- The crank expires due boosts before and after its own distribution. `boosts_stalled` is paged, and `cbob_mint` and the boost bounds are fixed-forever drift keys.

---

## R5. The swap and revenue cycle

I recomputed these from the code and from the Pyth, Orca and Meteora layouts.

**(a) Oracle math.**
- Exponent handling is correct for every sign: `e = es − eb`, with the `×10` accounting for 9 vs 8 decimals.
- Both roundings floor.
- A BigInt `Number()` conversion appears only in `satsPerLamport`, which is used for the deviation filter and is float-safe at these magnitudes.
- The 280,355 / 276,149 vector is hand-checkable.

**(b) Pyth verification.**
- The offsets are right: Full tag at 40, feed 41–73, price 73, conf 81, expo 89, publish_time 93, minimum length 101.
- Ownership, feed id and the derived address together are sufficient, because writing the feed account requires a Wormhole-verified update and Pyth's push program only moves it forward.
- Age is judged on the chain Clock, which is read in the same batch as the prices, so it is trustworthy.

**(c) Deviation filter.**
- `orcaSpot` is (sqrt/2^64)² in raw units. `meteoraSpot` is the inverse of (1 + step)^id. Both are in sats per lamport and in the right direction.
- Float error is on the order of 1e-15, against a 100 bps bound.

**(d) Minimum out.**
- Both venues carry `minSats` at data offset 16.
- It is the same floor the deviation filter implies, because 150 bps is wider than 100 bps plus the fee.

**(e) The judge.** The exact seven-instruction sequence covers:
- the output account (key 5), the input account, the signer slot, the amount, the floor and the Orca direction bytes;
- ComputeBudget (exactly one, length 5, no price);
- the two ATA creations and the wrap.

It leaves the vault accounts and tick arrays unchecked, but both pool programs validate those against pool state. I have no remaining tamper to name.

**(f) Derivation.**
- Orca's three tick arrays are current then the two below. The oracle PDA is derived. The vaults are read from the pool.
- Meteora's three bin arrays are the active one then the two above. `host_fee_in` is None. The event authority is derived.
- The Meteora bitmap extension has a defect, described next.

**(g) wSOL.**
- A pre-existing wSOL balance or a stranger-created ATA only returns extra lamports to the operator on close.
- A dusted address is handled by the ATA program, which accepts a pre-funded PDA (R34.G2).

**(h) Failure and retry.**
- Meteora is tried only on a classified refusal, and an unknown outcome throws with the cycle left open.
- Every path leaves the row open until `returnedSats` and a split exist.

**(i) Extraction.** The worst case is bounded at 150 bps of at most 10 SOL per cycle, plus oracle confidence. Sandwiching Orca (about $10M of liquidity) costs more in fees than it earns. Meteora (about $0.9M) is marginal, at roughly $18 per cycle, about $2k a month at the theoretical maximum. That is not material at this scale. The operator key's worst case is unchanged: cap × windows until the guardian stops it, bounded by what the revenue PDA holds above the reserve.

### F1. LOW: a stranger can disable the Meteora fallback with dust (`bank/swap.mjs`, `market()`)

- **Construct:** `bitmapExists: !!bm`. `bm` is the Meteora bitmap-extension PDA, which is read through `getMultipleAccountsInfo`. Only existence is tested, not ownership.
- **Mechanism:**
  - If the real pool has no extension account (its active bin array is around index 84, well inside the internal bitmap, so this is likely), a stranger can send about 0.00065 SOL to that PDA address.
  - The address then reads as existing, System-owned and empty.
  - `meteoraSwapIx` passes the PDA as a writable present account instead of the program id ("None").
  - The DLMM program will fail to load a System-owned account as `BinArrayBitmapExtension` (my expectation is Anchor 3007, AccountOwnedByWrongProgram; I did not measure it).
  - Every Meteora attempt is refused for good.
- **Impact:** Orca-first still works. Only a cycle where Orca refuses would find the fallback dead, and it would be left open for hand recovery.
- **Evidence if I am right:**
  - A `stubConn` with `bitmap: { owner: SystemProgram, data: Buffer.alloc(0) }` gives `m.bitmapExists === true` and `swapInstructions(...)[5].keys[1].pubkey` equal to the PDA, writable.
  - On the fork, setting that PDA to a funded System account and running SW.4 should refuse.
  - I measured neither.
- **Fix:** `bitmapExists = !!bm && bm.owner.equals(METEORA.program)`. Add arms in both directions, and cross-check on the fork whether the extension account exists on mainnet.
- **Why it matters beyond itself:** this is the same dust class as rounds 40–42, in a file those rounds did not audit.

---

## R6. Gates

- **Floors:**
  - The detector selftest counts 945 and equals `FLOOR`. The web floors sum to 682 and equal `WEB_FLOOR`. The e2e floor is held outside its own exit code.
  - `build-mainnet.sh` builds five programs, refuses any other count, asks the four keyed programs about the key, and proves sweep byte-identity against both the localnet build and `target/deploy`.
  - `run-tests.sh` now refuses a program tree that differs from `RELEASE_COMMIT`. It cannot see an untracked file under `programs/`, but `build-mainnet.sh` refuses a dirty tree, which covers that.
  - `cron-install.sh` arms nothing it should not. Commented lines, prose and other projects' lines are ignored, and the reveal lane cannot arm the full pass.
  - `rehearsal-tree.sh`'s proof is sound. A destination such as `/opt/cbob-vaults-x` fails loudly in the substring check rather than slipping through.
- **I could not name a vacuous arm.** Several selftest arms depend on `/opt/scripts/alert-router.py`, so they fail on a box without it. That is conservative, not vacuous.
- **Web tests:** I read for arms that cannot fail and found none, though I could not execute them. `bundle.test`'s C03 requires both builds to succeed and to produce more than 200 characters of identical output. `get.test`'s C12 call-site check uses `indexOf` and a bound, so a missing call fails it.

### F2. LOW: nothing watches the $CBOB release wallet (detection gap, accepted limit 56)

- **Evidence:** `CBOB_RELEASE_WALLET` is referenced only in `scripts/check-launch-params.mjs`. No detector or `readConfigs` key reads `AT2qf412…` or its $CBOB ATA.
- **Why it matters:**
  - Limit 56 states that 2.1 billion $CBOB sit on a hot key on this box.
  - Limit 10 says its trusted-key compromise is detected. Limit 56 has no equivalent.
  - A thief could sell the supply or burn it for boosts, and the alarm would be quiet.
- **Fix:**
  - Read the ATA balance each pass, keep a baseline, and page once, urgent, on any decrease.
  - Add a `release` acknowledgement the operator writes when the Bank releases deliberately.
  - Do the same for the operator wallet: page when its SOL is more than the float plus an in-flight cycle with no open row.

### F3. INFO: pre-launch, the alarm pages `lock_deadline_unset` CRITICAL every pass

- **Evidence:**
  - The five placeholder programs are deployed and upgradeable (authority `FZjLB4e9…`).
  - `launch/mainnet-init.json` has `lock_deadline: null`.
  - No MINT config exists, so `charter_opens_at` is absent.
  - Production is true. `detectUpgradeAuthorityAfterLock` returns `lock_deadline_unset` for all five.
  - VALIDATION B7 shows an alarm line in the live crontab.
- **Notes:**
  - It is a level kind, so the router suppresses repeats.
  - It is deliberate (round 22 A5), but it will be the standing condition when the dress rehearsal starts.
  - Step 9's upgrades will page `prog.*.hash` CRITICAL once per program.
  - Decide before the rehearsal how a human is meant to distinguish these expected pages from a real one.

---

## The four questions on the accepted limits

1. **Worse than stated?**
   - Limit 56 under-states: the supply is on a hot key and nothing alarms on it (F2).
   - Limit 10's bound is as stated. I found nothing more the operator key can do.
   - Limit 59 is not worse than stated.
2. **Not actually a limit?** I found none.
3. **A discharged item not discharged?** I found none. Item 19 is closed by construction: `activate` requires a drawn level. Item 51's off-chain mirror matches.
4. **An OPEN AND BLOCKING item quietly treated as accepted?** Not demoted, but one detail deserves attention (F4).

### F4. INFO: item 22.5 (the DAS `burnt` flag) has a failure mode with no code fallback

- **Mechanism:**
  - The alarm decides "burned" from DAS's `burnt` field.
  - If DAS omits burnt assets from `getAssetsByGroup`, then after the first honest redemption `detectIndexShortfall` compares live plus burnt against `minted_total` (which never falls) and pages `index_disagrees_with_chain` CRITICAL forever.
  - Each redemption also pages `vault_left_index` CRITICAL as a one-shot. That kind is deliberately not in the redemption-noise allowlist, so `correlateBurns` never downgrades it.
  - It would drown the one detector that sees a bare burn.
- **Fix, independent of DAS's answer:**
  - Classify "gone" assets by a raw `getAccountInfo` tombstone read (Core-owned, one byte, key 0), which is what the crank already does.
  - Or compare the live count to `minted_total − burned_total − bare_burns_retired` read from chain.
- **If the fix is deferred:** make the dress rehearsal's one-redemption DAS read the gate, and record its outcome in item 22.

### F5. INFO: the C01 test shape should be copied to sibling baselines

The round 42 arms prove `balances` across a shrunk pass. I found no further asymmetry in `frozen` or `cursors`, but no arm pins `frozen` across a shrink. Add one: a frozen vault omitted from the short list stays in the frozen set and does not re-page.

---

## Anything else

- **Confirmation of the verdict's "disproved" list:**
  - C05: a missing signature leaves the intent row open and loud, which is correct.
  - C07: Meteora fallback is the stated design.
  - C09 and C10: the repairs landed and are pinned.
- **Holder-guide sentences I checked against code and found true:**
  - First payout timing (charter close + 30 days, then a burned payout, then free monthly).
  - The 45-an-hour figure.
  - Boost terms.
  - Opening not blockable by dust on the page's path.
  - Rescue behaviour.
- **Statements that depend on unpublished surfaces:** the redeem page, the pages' deposit-address view and the posts. They remain gated by item 50.

---

## What this project should do that AI audit structurally cannot

1. **Run the dress rehearsal, and run the failures on purpose.**
   - Cover item 22's five items with real signatures.
   - Orca refusal forced so Meteora runs.
   - A forced post-sweep failure walked through hand recovery.
   - A DAS read of a burned asset.
   - Everything in this audit is read-only, and an RPC that stalls, a router that suppresses, or a clock that drifts will not show up on paper.
2. **Have a human who did not write the code read the four `initialize` transactions byte by byte** against `launch/mainnet-init.json`. `check-launch-params.mjs` validates the JSON, not the signed message.
3. **Rebuild the five programs on a second clean machine from the release commit** and compare sha256, then compare the deployed bytes' prefix and zero tail at steps 9, 10 and 11. `build-mainnet.sh` itself says "NOT PROVEN" for the compiled constant.
4. **Drill the human parts of the alarm:**
   - Pull each brake and release it.
   - Let a level alert recover.
   - Confirm that SMS and email reach a person at 3 a.m.
   - Rehearse writing the log-gaps watermark and an ack.
   - Confirm that a person can tell the expected pre-launch pages (F3) from a real one.
5. **Decide custody before step 11, because step 11 is irreversible.**
   - Where does the deploy authority key live and who can reach it.
   - The $CBOB release key (F2) and the swap operator key are hot on this box. Their theft is detected only partly.
   - Do the 7-day charter window on an actually cold or multisigged Giraffish Moments key if the project can accept the operational cost (limit 46).
6. **Test the pages with real wallets, on real phones, in real browsers.** The e2e uses a localnet test wallet and a mock RPC. Wallets can add, reorder or reject instructions in ways no test double reproduces. Redeem a throwaway vault end-to-end on mainnet with real amounts before anyone else holds one.
7. **Put a human on the legal and disclosure side.** The hot keys, the single oracle trust and the hot Moments authority are all disclosed, but no model can judge whether a disclosure is sufficient for a real buyer.
8. **Get a human firm after launch if budget ever allows.** The ruling is "AI or not at all", but only a person with a lawyer and a conflict check can accept responsibility for the Squads multisig's 15% and for the vault's custody story.