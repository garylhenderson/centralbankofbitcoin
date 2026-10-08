# Round 39 audit, programs plus web

No CRITICAL or HIGH finding. I did not run a validator, so every program claim below is from reading the source at the bundled tree. I recomputed offsets and account sizes by hand. I found no path that takes value out of a sealed vault, the pool or the revenue address, and I found no way to make the pool owe more than it holds.

## R0. Round 38's repairs

**V38-1 (wrong stray removed).**
- The bundled `plan-redeem.mjs` now removes each item with `drop(list, a)`, which checks `indexOf >= 0`.
- This fixes the `splice(-1)` bug at the site named.
- I found no other `splice(indexOf)` in the file. The two remaining `splice(list.indexOf(a),1)` calls are guarded by membership in the iterated list, so they are safe.

**V38-2 (standing consent).**
- The repair holds for new stray accounts, new unlisted or unexamined counts, and compressed NFTs. These become information, not new gates.
- Grouping is skipped on re-plan, so a consented `group:N:…` id cannot re-gate the press.
- The `aboutKnown` re-ask can only fire for a stray the holder was told would be delivered. A stranger cannot turn such a stray undeliverable. They cannot add a freeze authority, and the delegate is cleared on an owner change.
- One path remains where a stranger still stops the press, covered by F1 below.

**V38-3 (ceremony collection).** The rule reads correctly. Pins win, two verified collections stop the page, and unverified candidates give a warning while step 0 is still offered. The acknowledgement gate after step 0 closes the reload hole.

## F1. LOW: a stranger can still block the redeem page, by nesting a vault

**Construct.** `plan-redeem.mjs` refuses when `n.ourVault` is true: "Another vault is inside … rescue it first".

**What an attacker does.** Anyone who owns a CBOB vault can transfer it to the victim's deposit address, because Core permits that transfer (9.1). The page then refuses. The victim can call `rescue_nested`, which sends the attacker's vault to the Squads. The attacker re-nests another vault before the victim presses.

**Why the refusal protects no one.**
- The programs do not need the page's refusal. BURN does not see the nested vault.
- After the host burns, the nested vault is orphaned. It is rescuable to the Squads (R35.N4/N5), and the Squads returns it to its sender.
- The refusal therefore adds only a handle for a stranger.

**Cost to the attacker.**
- One vault per cycle, at 21,000 sats or more.
- The vault sits at the Squads until a person returns it.
- Each one also pages `vault_awaiting_return` every pass.
- This also creates operator load on the Squads.

**Documents it contradicts.** README item 7 says "nothing a stranger can put at a deposit address refuses an opening, at any volume". The same sentence then lists a nested CBOB vault as a refusal. SPEC and HOLDER-GUIDE make the same promise.

**Evidence if I am right.** An e2e arm where an attacker holding N vaults nests one, the victim rescues, the attacker re-nests, and the page refuses N times.

**Fix.**
- Make a found nested vault a tick-box: "this vault will be rescued to the Bank's multisig after the opening".
- Alternatively, state the cost in the README and SPEC and drop the promise.

## F2. LOW, unmeasured: `bank/txread.mjs` may reject a valid Token-2022 `transferCheckedWithFee`

**Construct.** `validateParsedTransaction` treats any token instruction whose type starts with `transfer` as having `info.amount`, unless the type ends in `Checked`.

**Why I think it fails.** As I recall the RPC schema, Token-2022's `transferCheckedWithFee` parses with `tokenAmount` and `feeAmount`, not `amount`. The validator would then throw "token movement amount".

**Who can trigger it.** Anyone can include such an instruction in a transaction that merely names a CBOB program or the revenue address. It costs a fee plus a one-off fee-bearing mint.

**Why it matters.** Round 29 fixed only the truncated-log class. I cannot see the consumers here, so I cannot tell whether this pages `tx_unreadable` once or halts revenue recovery and the poster. Revenue recovery and the poster still refuse on an unreadable transaction.

**Evidence needed.** Feed `validateParsedTransaction` a parsed Token-2022 `transferCheckedWithFee` fixture taken from a real mainnet transaction. If it throws, check each consumer's behaviour on that error. If it does not throw, drop this finding.

**Fix.** Accept `tokenAmount` for any `transfer*` type. Alternatively, validate only the types the detectors read.

## R1 and R1s: custody and the sweep helper

**Pairing.** SEAL walks forward from the current index and BURN walks backward, both over top-level instructions only. Both bind asset (account 0) and owner (account 2). I found no crossing, wrapper or two-vault construction that satisfies both halves without a real open and a real burn. The stack-height and top-level checks in `retire_redeemed` are sound.

**Helper (a): who can run it.**
- The helper needs the asset-signer's signature, and Core signs only for the asset's owner on a thawed vault.
- SR.5–5e cover a stranger, a transfer delegate, and the collection authority (MINT's off-curve PDA).

**Helper (b): the pair list.**
- A duplicate source fails because `read_token` rejects the already-closed account.
- A source or destination that is the other account in the pair is impossible, because the owner checks conflict.
- A native wSOL source works.
- A delegate does not stop the owner. A foreign close authority makes the close revert, which is the documented C5 case.

**Helper (c): destination.**
- The helper does not compare the destination with the owner. This is safe because Core gates on the owner.
- A destination below rent exemption fails for a missing destination account. The page uses the owner as destination, so that cannot happen in practice.

**Helper (d): lamports.**
- Nothing can leave the asset-signer non-zero inside the transaction. Any such instruction would have to be one the owner put there.
- BURN's `lamports == 0` check sees exactly what the sweep left.

**Helper (e): closed accounts.**
- A closed account is system-owned with 0 data.
- The BURN reserve loop skips an account no token program owns, so a closed account passes.
- Prior-transaction creation of missing reserve ATAs closes the race.
- A stranger-made non-ATA or nested Core asset is not seen by BURN. The page names it, and a nested CBOB vault is refused (F1).

**Helper (f): fit.** S8.0 measures claim, open, the helper with three reserves, and burn at 1,061 bytes. SPEC's 1,209-byte widest shape fits with 23 bytes spare. A fourth reserve is impossible by construction.

**Helper (g): evidence.** `build-mainnet.sh` proves the helper bytes are identical to the tested build. The arms I read look non-vacuous.

## R2 and R2b: pool and boost

**Pool invariant.**
- `credit` adds `delta*w` to `owed_scaled`, and `delta*w ≤ avail*S`.
- So `ceil(owed') ≤ ceil(owed) + avail`, and the pool always holds at least `ceil(owed)`.
- `claim` removes `pay*S` from both `owed_scaled` and the balance, which keeps the invariant.

**Counters.**
- `pending_count`, `pending_this_epoch`, `active_count` and `total_active_weight` move consistently under join, retire and `advance_epoch`.
- `waiting_to_join` cannot underflow.
- Join never touches `pending_this_epoch`. A retire decrements it only when `request_epoch == dist_epoch`.

**Boosts.**
- The ring holds up to 63 distributions, so two live end epochs never share a slot.
- `unschedule_boost` takes the due branch when `dist_epoch >= end`. Otherwise it frees the purchase slot, which is correct at wrap.
- Expiry through a claim or through `expire_boosts` preserves what was earned.
- A due boost cannot be expired twice, because `boost_weight` is zeroed.
- Distributions are gated on `boosts_due == 0`, so a boost earns exactly N distributions.

**Liveness.** `expire_boosts` needs only the records, so a missing token account cannot block distributions. A bare-burned waiting vault is clearable by anyone through `retire_burned` or `claim`.

## R3 and R4: the draw and governance

**Draw.**
- The latest of the three hashes, C, lands at most about `reveal+208`, inside the 300-slot window.
- A reschedule always targets a future slot.
- FIFO and the stored entropy hold.
- C's leader is worse than "bias one": they choose among many draws, as limit 26 says. HOLDER-GUIDE states this truly.

**Governance.**
- The electorate and quorum snapshot hold.
- I verified the GOV and MINT action encodings against each other.
- An overtaken action is a logged skip, not a revert.
- I found no minority-carry path and no way to freeze governance beyond limits 45 and 47.

## R5, R6, R7

**R5 (charter claim).**
- SPEC 46 is complete as far as I can tell.
- One further factual item belongs there. The Moments key can also remove a plugin it added mid-window, so state can flip between blocks. Only the sampled alarm sees that. The text already says the alarm samples state.

**R6 (one-time configuration).**
- The `initialize` bounds I checked are consistent.
- The ring-based cap is exactly a rolling window. `kth = ring[(head+64-k)%64]` is correct.
- Nothing in our programs changes the royalty. Authority is None, and R.6/R33.G3 measure that.

**R7 (offsets).**
- I recomputed every MintConfig offset GOV and BURN read (41, 141, 191–192, 257–274, 442, 454, 518/526, 631–655, 711–712).
- I also recomputed the VaultRecord offsets, including the web's 125..195 slice (active at 0, retired at 1, boost weight at 61, boost end at 62..70), and the space constants. All match.

## R8. Evidence

I found no arm that cannot fail among the ones I read, and I have no measurement to dispute.

**Gaps already noted by earlier rounds.** Seven negative arms still have no reason pin. These are R32.A22a, R33.G3, OR.5, R31.W1a/W1b, R28.A2 and R35.N8.

**Gap not previously raised.**
- The mainnet binaries are built `--arch v3`.
- The suite and the placeholder rehearsal ran on a validator with all features on.
- I could not confirm that mainnet-beta has the SBPFv3 deployment features active. The five ids hold an inert placeholder, but I do not know that it was v3.
- If v3 is inactive, step 9 fails or forces a rebuild. A rebuild would break "audited bytes equal deployed bytes".

## The four questions on accepted limits

1. **Worse than stated?**
   - Limit 46 omits that the hot key can add and remove its plugin between alarm samples. The text covers the sampling gap, so I treat this as complete.
   - Limit 58's "Squads could vote" is correct, because a CPI-signing owner satisfies GOV's `Signer`. It is also a governance path for rescued vaults, and no document warns about it as such.
   - F1 shows limit 44 / item 50's "a stranger cannot block an opening" is not fully true (F1).

2. **Listed as a limit but not actually one?** None.

3. **Discharged but not actually discharged?** None found.

4. **OPEN AND BLOCKING treated as accepted?** No. Items 22, 38, 50, 52 and 53 are still OPEN, and `launch/mainnet-init.json` still has three OPEN values.

## Before launch: what an AI audit structurally cannot do

1. **Prove mainnet runs the exact deployed bytes.**
   - On mainnet-beta, run `solana feature status` for SBPFv3.
   - Deploy one real v3 ELF through an upgrade and an `extend` at the claimed ids. Do this before the dress rehearsal counts.
   - Rebuild `dist/` at the final commit.
   - Run `git diff 0b3ddb3 HEAD -- programs Cargo.toml scripts/build-mainnet.sh`. It must be empty, or the page's pinned hashes must be re-pinned.

2. **Run the dress rehearsal (step 8) for real.** Do all item 22 items with real signatures on mainnet. That includes the Meteora fallback, the forced post-sweep failure, and the crank against a populated cluster.

3. **Have a human read the money paths.**
   - Reading claim, retire, credit and boost with no reference to the tests is not AI work.
   - Read the sweep helper (about 60 lines) line by line.
   - Check Core `e72d63e` against the pinned binary. SPEC admits the source is not proven identical to the pinned binary.

4. **Decide the human policies.**
   - Who holds and rotates the deploy-authority key (`bank/keys/deploy-authority.json`, one backup).
   - Who runs the Squads return for rescued vaults.
   - Whether the hot Moments key is held cold for the 7 days.
   - Whether the $CBOB release key moves off the box.

5. **Test the pages with a real wallet.** I mean Phantom, Ledger, mobile, and Squads v4 return, none of which the offline tests exercise. Add the F1 grief arm and the F2 fixture check.

6. **Drill the guardian stop and the Squads key before the lock.** Prove the stop can be pulled, and prove a stolen-key plan exists, because a stolen guardian key is permanent at low turnout.

7. **Set the lock rule.** Remove the upgrade authority only after the redeem page is live on the real site and a real small opening has been done end to end. Item 50 and road step 11 already gate this on the page existing.