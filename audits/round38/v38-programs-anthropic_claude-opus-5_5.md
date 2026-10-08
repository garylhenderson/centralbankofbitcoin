# Round 38 audit: CBOB v6, five programs, `web/` and the evidence

**Auditor posture.** I assumed the author is wrong and tried to break each claim. I recomputed the claims below from the source bundled in this round. I ran nothing. Every finding names the run or test that would settle it.

**Result.** I found no CRITICAL, HIGH or MEDIUM defect in the five programs and no path that moves value out of a vault, the pool or the revenue address. I found three defects, all in `web/`:

| ID | Severity | Where | One line |
|---|---|---|---|
| **W38-1** | **LOW** | `web/src/lib/plan-redeem.mjs` | A `splice(-1)` bug lets a stranger repeatedly block the redeem page's re-plan, for about 0.002 SOL per attempt. This breaks "no stranger can block an opening". |
| **W38-2** | INFO | `web/src/lib/ceremony-reads.mjs` | With no pin, a real collection whose creation cannot be verified is ignored and step 0 is offered again. This contradicts README "a reload can never create a second collection". |
| **W38-3** | INFO | `web/src/lib/plan-redeem.mjs` | "Run a payout" joins bare-burned waiting vaults instead of retiring them, which limit 27 says the crank never does. |

None of the three is documentation-only, so none qualifies for the SPEC gate-3 exception. **This pass is NOT CLEAN.**

---

## R0. Round 37's verdicts and repairs

**V1 (stranger accounts flood the redeem page).** The repair holds at both sites I checked.

- `vaultWalletAccounts` reads the three reserve ATAs by address before any listing.
- The listings are bounded: an 8-byte balance slice for classic and 165-byte Token-2022 accounts, and a 0-byte slice (addresses only) for every Token-2022 account.
- Full reads are capped at 200.
- A listing failure returns `incomplete`; it does not throw.
- The proxy's `gpaShape` accepts exactly those three token shapes and refuses wider slices, a missing size filter and owner filters shorter than 32 bytes.
- `groupAcks` runs after the coverage cross-check, so the `named` set is still built from per-item ids. I confirmed this ordering in the file.
- The NFT side is bounded the same way and returns `incomplete` instead of throwing.

**However, the same repair round left a defect in the re-plan path. That is W38-1 below.**

**V2 (decoy collection stops the ceremony).**

- Pinned case: a decoy is named and ignored. Correct.
- Unpinned case: `collectionCreator` checks four things: the oldest transaction naming the address succeeded, its first key is the launch key, it signed, and it carries `CreateCollectionV2` for exactly this address. This is sound because the address comes from a fresh keypair and nobody can name it before it exists.
- Residual: see W38-2.

**V3 (frozen cbBTC account can activate).** Correct. `read_token` discards the account state in `activate` (`let (amount, _) = read_token(…)`).

**C01–C05 (off-chain repairs).** These live mostly in `bank/` files this bundle does not carry. I cannot independently re-verify them and I make no claim either way.

---

## R1. Custody

**The open/burn pairing survived every shape I tried:**

- A CPI wrapper on either half.
- Two vaults in one transaction, in either nesting order.
- An owner swap between open and burn.
- A transfer of the thawed vault to another key, then a burn naming that key.
- A v0 transaction whose keys come from a lookup table. The instructions sysvar carries the resolved keys, and S9b exercises this.

**SEAL** walks forward from the current instruction and fails closed. **BURN** walks backward. Both bind the asset at account index 0 and the owner at index 2.

**A thawed vault cannot leave a transaction unburned.** The matching `burn_vault` must succeed, and the transaction is atomic.

**BURN's emptiness proof:**

- A Token-2022 ATA for a classic reserve mint cannot exist: the ATA program refuses it (measured F4.2), and the address is an ATA-program PDA that nobody else can allocate.
- A reserve ATA closed by the helper either belongs to System or has zero data with amount 0, so it passes for the right reason. This is measured as 3.3a, where the account carried a delegate.
- BURN ignores accounts it is not shown, so nothing a stranger creates outside the reserve ATAs can make BURN refuse. Lamports in the vault wallet are the only other gate, and the helper sweeps them.

---

## R1s. The sweep helper

| Question | Finding |
|---|---|
| **(a)** Who can make it move value | The signer must be the asset-signer PDA, so it is reachable only through Core `ExecuteV1`. SR.5, SR.5a and SR.5c measure that a stranger, a transfer delegate and a collection update authority are each refused with `0x1a` on a thawed vault. While the vault is frozen, the PermanentFreezeExecute plugin refuses Execute (3.7). |
| **(b)** Pair list edge cases | The same source twice reverts with `IllegalOwner` after the first pair closes it (SR.12a, reason pinned). A source cannot also be a destination, because the source owner must be the signer, the destination owner must be the destination wallet, and the two are refused if equal. A native wSOL stray works: transfer, then close returns lamports. A frozen source reverts the whole call (SR.14). An odd account count is refused (SR.7). Zero pairs sweeps lamports only (SR.13). |
| **(c)** Destination wallet chosen by the transaction builder | Safe, given (a): only the owner can call it. A destination below rent that does not exist is refused, and this is documented. |
| **(d)** The lamport sweep | Nothing else in the transaction can credit the PDA unless the owner adds it. BURN checks lamports before Core's burn. |
| **(e)** Accounts a stranger can create | A prior transaction creating the reserve ATAs is sufficient, because only the PDA could ever close them. A stranger's non-ATA classic account is named or swept; one whose close authority the stranger kept is the C5 case. No account a stranger can create both escapes being named and makes BURN refuse. |
| **(f)** Packet fit | The figures are measured in S8.0, S8.1a and e2e W5. |
| **(g)** Deployed bytes | The bytes the suite deploys are cmp-proven equal to `dist/`. |

---

## R2 and R2b. Pool accounting and boosts

**The invariant survives, recomputed.** At each credit:

- `delta = ⌊avail·S/w⌋`, so the increase in owed is at most `avail·S`, where `avail = bal − ⌈owed⌉`.
- So the new owed is at most `bal·S`, and the pool still holds at least `⌈owed⌉`.

The other paths preserve it:

- **Claims** reduce the pool balance and owed by exactly what they settle.
- **`reweigh`** preserves `owed_of`, because the owed share moves into `carry` and the debt resets to `after·acc`.
- **`retire`** removes exactly the vault's pending share.

**Counters.** `pending_this_epoch` counts the records whose `request_epoch == dist_epoch`. The retire branch decrements it exactly in that case, so it cannot underflow.

**The boost ring:**

- `end % 64` cannot collide while N ≤ 63.
- A boost bought at epoch e earns the credits at epochs e through end−1, which is exactly N credits. At end it becomes due, and `BoostsExpireFirst` blocks any further credit.
- `tick` runs only when total weight is 0, which means no boosts are live.

**Offsets.** I recomputed every MintConfig offset: version 8 through the ring at 749, total size 1,005 plus 256 padding. I recomputed VaultRecord: 211 bytes plus 10 padding is 221. All the constants GOV, BURN and the proxy use match, including the boost slice at bytes 125..195.

---

## R3–R6. Draw, governance, charter, initialize

I found nothing worse than accepted limits 25, 26, 46 and 47.

- **Draw (R3).** B's leader influences which slot is C's, but does not know C's hash. Only a validator holding both B's and C's groups gains anything, and limit 26 already admits that ("likely, not guaranteed").
- **Governance (R4).** Nothing beyond limit 47.
- **Charter (R5).** Nothing beyond limit 46.
- **Initialize and rescue (R6).** `rescue_nested` cannot reach a vault with an on-curve owner: that owner can never equal an off-curve asset-signer PDA.

---

## R7. Cross-program raw reads

All verified. The sweep helper's offsets (mint 0, owner 32, amount 64, length 165) match the classic layout.

---

## R8. Evidence gaps

- `plan.test.mjs` never builds the snapshot that W38-1 needs: the re-plan (`noPrior`) case with both a helper stray and a C5 stray.
- The page's payout path has no arm with a bare-burned waiting vault (W38-3).
- The four keyed programs' mainnet bytes are still proven only by the key probe and by reproducibility, as already stated.

---

## Findings

### W38-1 (LOW). `planRedemption` re-plan drops a deliverable stray, so a stranger can repeatedly block the opening

**Construct.** `web/src/lib/plan-redeem.mjs`:

```js
for (const a of noAccount) {
  helperStrays.splice(helperStrays.indexOf(a), 1);
  transferStrays.includes(a) && transferStrays.splice(transferStrays.indexOf(a), 1)
}
```

When `a` is a C5 stray (one in `transferStrays`), `helperStrays.indexOf(a)` is −1, and `splice(-1, 1)` removes the last helper stray.

**What happens next.**

1. The removed helper stray is neither covered nor acknowledged.
2. `judgeRedemptionCoverage` flags it.
3. The page refuses: "The vault holds something this page did not expect".
4. If the judge ever stopped flagging it, the stray would instead be destroyed silently.

**Trigger.** The bug runs only on the re-plan just before the opening (`noPrior`). It needs two things in the vault wallet at that moment:

- a C5 stray whose mint has no receiving account for the holder yet, and
- any helper stray.

**How a stranger exploits it.**

1. Leave one plain stray of a mint the holder already has an account for. For example, a non-ATA cbBTC account holding 1 sat: cbBTC is a reserve mint, so the freeze rule exempts it.
2. Every few seconds, park a new C5 account of a fresh, unfreezable mint, holding 1 unit.
3. Any holder whose check and button press are more than a few seconds apart hits the refusal.
4. "Check it again" creates the missing account in a new prior transaction. The stranger then repeats step 2.

**Cost.** About 0.0015 SOL of mint rent per attempt, which is never recovered. The C5 account's rent comes back once the holder finally opens.

**Evidence that would exist if this is right.** A `planRedemption` snapshot with:

- `noPrior: true`;
- the three reserves;
- a stray of mint M1, with the holder's M1 account present;
- a stray of mint M2 whose close authority is a stranger, with the holder's M2 account missing.

That snapshot returns a non-empty `refuse` naming the M1 stray. The same snapshot with the M1 stray removed returns a plan with no refusal and a `left:` acknowledgement for M2.

**Fix.**

```js
const i = helperStrays.indexOf(a); if (i >= 0) helperStrays.splice(i, 1)
```

Add both arms above to `plan.test.mjs`, plus a property test: for any snapshot, the page refuses only for reserve problems, a nested CBOB vault, or a non-owner signer.

### W38-2 (INFO). Ceremony re-offers step 0 when the real collection cannot be verified

**Construct.** `resolveCollection` with no pin. A real collection that `collectionCreator` reports as `unverifiable` is pushed into `ignored`. That happens when:

- more than 5,000 transactions name it, which anyone can cause for about 0.025 SOL in fees by naming it as an unused account, or
- the RPC prunes its history.

`steps()` then sees `collection: null` and no `discoverErr`, and offers step 0 again.

**Contradicts.** README: "If the chain scan cannot run, step 0 is refused, so a reload can never create a second collection." That sentence covers only a scan that fails. A scan that succeeds but cannot verify the creator re-offers step 0.

**Impact.** A second launch-key collection gets created. The rent is wasted, and the operator may be confused about which address to record.

**Evidence.**

- Offline: `resolveCollection` with `discovered: [A]` and a `creatorOf` that returns unverifiable produces `{ collection: null, conflict: null }`.
- On-chain: an e2e run that pads A's history past 5,000 transactions, then reloads with browser memory cleared, shows step 0 as "next".

**Fix.** If any discovered collection is unverifiable and nothing pins a collection, refuse step 0 with the address shown and ask the operator to pin it in `config.js`.

### W38-3 (INFO). "Run a payout" joins bare-burned waiting vaults instead of retiring them

**Construct.** `planPayout` joins every waiting record with `claim`. The `waitingVaults` filter does not check whether each asset is still live.

**Contrast.** Limit 27 says the crank "never pays or joins a positively burned vault and retires it first". The page breaks that rule.

**Impact.** Dead weight sits in the denominator until someone calls `retire_burned`. No value is lost.

**Fix.** Read each waiting vault's asset. Send `retire_burned` for any that are tombstones instead of joining them.

---

## Accepted limits: the four questions

1. **Is any limit worse than stated?** Limit 44 together with the C5 policy, as built in the page, is weaker than SPEC claims, through W38-1. I found no on-chain limit that is worse than stated.
2. **Is anything listed as a limit not actually a limit?** None found.
3. **Is any DISCHARGED item not actually discharged?** Item 54 is discharged correctly; its page obligations still sit under item 50, which stays OPEN. Items 12/17, 14, 19, 30, 31, 33 and 51 hold as written.
4. **Is any OPEN AND BLOCKING item being treated as accepted?**
   - Item 22: the rehearsal has still not been run.
   - Item 53: the rehearsal value set has not been built.
   - Items 50 and 38 are still open.
   
   None of them is quietly treated as accepted. The holder guide is still marked DRAFT.

---

## What to do before launch that AI audit structurally cannot

1. **Property-test the web planner, not just the examples.**
   - Generate thousands of random deposit-address snapshots: strays, C5 accounts, frozen accounts, mints with and without freeze authorities, missing destination accounts, `noPrior`.
   - Assert one invariant on every result: the page refuses only for a reserve-account problem, a nested CBOB vault, or a non-owner signer.
   - W38-1 is exactly the class of bug example tests miss.
2. **Run the same kind of fuzzing on the MINT accounting with the Rust host tests.** Drive random sequences of the program's own free functions (`credit`, `claim`, `join`, `retire`, `reweigh`) with `proptest` or Kani, and assert two things after every step: pool ≥ ⌈owed⌉, and owed equals the sum of every vault's share.
3. **Rebuild independently.** A second person on a second machine rebuilds `dist/` from the release commit and confirms the sha256 values. That is the only bridge for the four keyed programs, whose mainnet bytes the suite never ran.
4. **Run the dress rehearsal (item 22) with real small value for weeks, at throwaway program ids.**
   - Include a real Phantom on desktop and mobile (U1).
   - Include a real Squads v4 return of a rescued vault (U2).
   - Include a real provider's limits on `getProgramAccounts` and its history depth.
5. **Pay outsiders to break the rehearsal deployment before the lock.** Fund a public canary vault with a bounty and point outside researchers at the rehearsal ids.
6. **Move launch keys off hot wallets for the charter window.** Hold INIT_AUTHORITY and the guardian on a hardware wallet. This is not a ruling change: they are already Gary's wallet.
7. **Drill the paging runbook end to end with a human on call**, including the hand recovery of a failed revenue cycle (item 22.4).