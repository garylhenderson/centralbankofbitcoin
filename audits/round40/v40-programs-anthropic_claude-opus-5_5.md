# Round 40 independent audit: CBOB v6 (five programs, the off-chain pipeline and `web/`)

**Tree:** as bundled (round 39 repairs, `8dba479`).

**Method:** I read every bundled file line by line. I ran nothing. Every claim below says what a run would show if I am right and how to check it.

**Bottom line**

- **Programs:** no CRITICAL or HIGH, and no confirmed defect in the five programs. Every value path out of a vault, the pool or the revenue address I attempted is closed, for the reasons given under R1 to R7.
- **Redeem page and ceremony (`web/`):** one MEDIUM. It is a stranger-triggered refusal that falsifies a HOLDER-GUIDE promise at a cost of about 0.00065 SOL. It is a regression introduced by the round 36 and round 37 repairs, and it was not caught by round 39.
- **Also:** two LOW operational findings and one INFO.
- **Grade:** the MEDIUM is not documentation-only, so this round is NOT CLEAN.

---

## R0. Round 39's verdict and repairs

### V39-1 (a promised stray dropped silently at the press): the repair holds, with one gap noted

- `redeem.mjs freshPlan(..., final)` passes `[...final.known]` to `readRedemptionSnapshot`. That calls `vaultWalletAccounts(..., promised)`, which re-reads every promised address by address together with the three reserve ATAs.
- If that re-read throws, the whole snapshot throws a `ReadError` and the press stops before any dry run.
- In `planRedemption`, the loop `for (const k of s.known) if (!s.pdaTokens.some(...)) cannot.push({address:k,...})` produces a `lost:k` box.
  - `aboutKnown` keeps that box as a new acknowledgement, so `prepareOpening` returns `stop:'ack'`.
  - A promised stray that is still present but no longer movable (frozen, or `dropStrays`) reaches the same `lost:k` path through `undeliverable` or the frozen branch.
- The listing excludes addresses already in `byAddress` (`seen`), so nothing is counted twice.
- `PROMISED_MAX = 100` is far above the number of stray pairs that fit in one packet.
- The "Arrived after your check" text is gated on `!s.seen.has(ad)`.
  - **Residual (stated in the README, not a defect):** an account that existed at the check but sat beyond the 200 accounts read in full is labelled "arrived after".
- **One gap, not a regression:** the re-read pushes a promised address into `pdaTokens` without checking that its token owner is still the deposit address.
  - Today that is safe: an owner change needs the PDA's signature, which no one can give while the vault is sealed.
  - Note it for any future change to how the reads work.

### V39-2 (a nested CBOB vault blocks the opening): the repair holds

- A nested `ourVault` no longer refuses:
  - At the check, the plan adds an *optional* `rescueNested(nested, host=asset, bank_treasury)` prior group and a note.
  - At the press (`noPrior`), it adds a `pressInfo` line instead.
- The coverage cross-check names the nested vault (`named` includes `s.nested.filter(n=>n.ourVault)`), so it cannot refuse it either.
- In `redeem.mjs`, a failed optional simulation, or a signature the wallet declines, is caught and the code continues.
- A host BURN with an undeclared nested vault is measured to succeed (9.5), and rescue from a burned host is measured (R35.N5).
- **Copy nit (INFO-1 below):** the page says "Someone sent it in; it is not yours to take" even when the holder nested their own vault.

### Round 39 off-chain items C01 to C05

These are not verifiable from this bundle: `bank/crank.mjs`, `bank/alarm.mjs` and `web/test/*` are not included. I take the stated red-under-mutation evidence as recorded, not as re-measured.

---

## The finding

### M-1 (MEDIUM). A dust transfer to an account address makes the redeem page refuse

**What it is.** A stranger sends lamports to the *address* of a token account that does not exist yet. Three page sites then treat that address wrongly, and the redeem page refuses to open the vault.

**Background, already measured.** R34.G2 shows that anyone can send at least the 0-byte rent-exempt minimum (about 650,240 lamports on mainnet) to an associated token account (ATA) address that does not exist yet. The address becomes a **System-owned account with no data and nonzero lamports**. R34.G2 also proves that the ATA program's `Create` or `CreateIdempotent` still lands on that address afterwards, with the right owner.

So such an account means "absent, can be created", never "broken". The pages read it as broken in two places.

**Site 1: the vault's own reserve accounts** (`web/src/lib/reads.mjs`, `vaultWalletAccounts`)

- Since round 37 (V1) the three reserve ATAs are read by address.
- A dusted address comes back as non-null with an owner that is neither token program, so it is pushed as `{program:'other', parsed:null}`.
- In `plan-redeem.mjs`, the reserve loop finds it (`acc` exists), finds `t = acc.parsed` null, and refuses: *"Your vault's $GIRAFFISH account could not be read. This needs a person to look at it."*
- **Affected vaults:** any vault that never held one of the three reserve tokens. That is the common case, since most vaults will hold only cbBTC.
- **Before round 37** the listing never returned such an account, so the plan created it in the prior transaction, as SPEC REDEEMING step 1 and HOLDER-GUIDE require.

**Site 2: the holder's own receiving accounts** (`reads.mjs`, `readRedemptionSnapshot`)

- `ownerAtaExists` counts any non-null account as existing.
- `ownerAtaFrozen` uses `try { parseTokenAccount(...).state === 2 } catch { return true }`, so a 0-byte System account is classed as **frozen**.
- For a reserve mint, the plan then refuses: *"Your own $GIRAFFISH account (…) is frozen by its issuer… It must be unfrozen before the vault can be opened."*
  - $GIRAFFISH has no freeze authority, so this message is false.
- The holder's ATA address can be derived from their public wallet address. Any holder who has never held $GARY or $GIRAFFISH can be blocked this way.

**What a stranger gains.** For about 0.00065 SOL per address, a stranger can make the redeem page refuse any targeted holder's opening indefinitely, with a misleading reason. No value is lost; it is a denial of service. Three statements become false:

- HOLDER-GUIDE: "On the redeem page that cannot block the opening. The page will first set up any of your vault's three … accounts that do not exist yet."
- README: "a stranger cannot block an opening".
- SPEC item 50's first client obligation.

The holder can recover by creating the account with another client (for example, receiving one unit of the token in Phantom). The page never tells them this.

**Evidence that would exist if I am right**

- **Offline:** add a `plan.test.mjs` snapshot in which `pdaTokens` holds `{address: ata(pda, GIRAFFISH), program:'other', dataLen:0, parsed:null}`. Expect `plan.refuse.length === 1` with the "could not be read" text.
- **Offline, second case:** set `ownerAtaFrozen` to contain `ata(owner, GIRAFFISH)` with no matching token account. Expect the false "frozen by its issuer" refusal.
- **On a validator** (`e2e-localnet.sh` shape):
  1. `SystemProgram.transfer(stranger → ata(depositAddress(V), GIRAFFISH), 1_000_000)` for a vault with no $GIRAFFISH account.
  2. Run `readRedemptionSnapshot`, then `planRedemption`. Expect a refusal.
  3. Repeat against `ata(owner, GIRAFFISH)`.
  4. Control: `createAssociatedTokenAccountIdempotent` on the same dusted address lands, which R34.G2 already measured.

**Fix**

- Treat "System-owned and `data.length === 0`" at any derived ATA address as **absent**:
  - In `vaultWalletAccounts`, do not push such an account.
  - In `readRedemptionSnapshot`, require `owner == TOKEN_PROGRAM` for `ownerAtaExists`, and do not class a non-token account as frozen.
- The existing prior-transaction `createAtaIdempotent` then fixes the account.
- Add the offline arms above, plus an e2e arm in which the opening lands after both addresses are dusted.

**Same class, LOW, in the same commit**

- **Ceremony** (`ceremony-reads.mjs`, `readStep('atas')`):
  - A stranger who dusts the pool's or the revenue address's cbBTC ATA address before step 5 makes the page say "WRONG ON CHAIN: STOP … can never be rewritten".
  - That account is also put in `existing`, so the page would never create it.
  - This is a false claim of a permanent failure on launch day. Treat a System-owned empty account as "not run".
- **Metadata generator** (`web/meta/generate.mjs`):
  - A dusted cbBTC ATA address for an unfunded vault fails "is not a token account".
  - A new vault has no previous file to keep, so its `/v/<asset>.json` is never written.
  - A stranger can therefore deny metadata to any new vault. Treat the account as 0 sats.
- **Buy page:** `revenueTokenExists: !!rt` has the same pattern. It is moot once the ceremony is fixed.

---

## R1. Custody: no path found

**The pairing**

- SEAL walks forward and BURN walks backward. Both use top-level instructions only, and both bind the asset (account 0) and the owner (account 2).
- WR.1 to WR.3 measure the wrapper shapes.
- Two vaults in one transaction each need their own pair, and the rate limit runs after the pair check.
- **Execute during A's thaw:**
  - It can move a nested vault B out. That is legitimate, and B's owner is A's PDA.
  - It cannot open B, because a top-level burn would need a real signature from A's PDA, which cannot sign.
  - It can cast a vote with B via CPI, which R27.V1 shows is permitted. That is harmless.

**The emptiness proof**

- I re-derived the offsets: delegate tag at 72, delegated amount at 121, close-authority tag at 129, amount at 64, length 165.
- A closed account (System-owned, 0 lamports) is skipped for the right reason: it holds nothing and the burn makes the PDA unreachable afterwards.
- A Token-2022 ATA for a classic mint cannot be created (F4.2).
- A dusted System account at an ATA address is also skipped by BURN. This is correct on-chain; it is M-1 only in the page.

**Lamports:** the helper moves `signer.lamports()` last, and BURN reads `lamports() == 0` afterwards. Only the owner's own later instruction could top the PDA up again.

## R1s. The sweep helper

- **(a)** Core approves Execute only for the owner (SR.5, SR.5a and SR.5c are measured refusals). Calling the helper while the vault is frozen is refused by Core with 0x9 (3.7).
- **(b)** Pair list:
  - A duplicate source is refused by the second `read_token` (SR.12a).
  - A source can never also be a destination, because their owners must differ.
  - A destination may appear twice.
  - A wSOL source moves its lamports with `Transfer`.
  - A delegate on the source does not block the owner's transfer.
  - A source with a foreign close authority reverts the whole call (R36.C5, stated).
  - A frozen source or destination reverts.
  - An odd account count or bad data is refused.
- **(c)** The destination is the builder's choice, which is safe given (a). A destination that is a non-System account is credited (R27.S1).
- **(d)** Nothing in the same transaction re-funds the PDA except the owner's own instruction.
- **(e)** On-chain behaviour is correct. The page side is M-1.
- **(f)** S8.0 holds as stated.
- **(g)** `build-mainnet.sh` compares the shipped helper with both `$CACHE/ln` and `target/deploy`.

## R2 and R2b. Pool and boost: the invariant holds

**`ceil(owed) ≤ balance`**

- `credit` adds `floor(avail·S/w)·w ≤ avail·S`, so `ceil(O′) ≤ ceil(O) + avail = B`.
- A claim lowers both sides by `pay` (`pay·S` scaled on the owed side, `pay` on the balance).
- `retire` and the forfeit remove owed scaled value and never remove tokens.
- `reweigh`, `join` and claim normalisation preserve each vault's share: `w·acc + carry − debt`.

**Counters**

- `pending_this_epoch` is reset only in `advance_epoch`.
- `retire` decrements it only when `request_epoch == dist_epoch`.

**Ring**

- An end at most 63 epochs ahead cannot alias.
- `unschedule_boost` takes the due branch when `dist_epoch ≥ end`, otherwise it frees the ring slot. The host test drives this through 260 epochs.
- A duplicate record in `expire_boosts` or `claim` is re-loaded after its store, so it cannot double-expire.

**Liveness:** `JoinWaitingFirst` and `BoostsExpireFirst` are each cleared by permissionless instructions that need only the record (`expire_boosts`), or the record plus `vault_ata` (joins pay nothing).

## R3. The level draw

- A is at most reveal+64, B at most A+72 and C at most B+72, so C is at most reveal+208, which is under the 300-slot window. A is always still inside the 512-slot buffer.
- Slots below `now` are settled on the fork, so the capture is deterministic.
- A burned vault at the head of the queue still takes its draw.
- **SPEC 26 is not worse than it states.** A's leader can skip its whole group, shifting which leader holds C, but without knowing any hash. HOLDER-GUIDE's "several results" understates the "many" in SPEC 26. INFO; harmonise the wording.

## R4, R5 and R6

- No minority path found.
- The key-change threshold uses the snapshot, as stated.
- SPEC 46 is complete: owner-managed and permanent plugins cannot be added by the update authority.
- `initialize` bounds match `check-launch-params`.
- The royalty authority is None (R.6, R.6a, R33.G3).
- The rate ring is exactly a k-th-most-recent check.

## R7. Raw offsets

I recomputed them; all match:

- MintConfig: 41, 141, 191, 192, 257, 266, 274, 442, 454, 518, 526, 631, 639, 647, 711, 712.
- VaultRecord: 41, 177, 186, 187.
- BurnConfig: 42.
- SealConfig: 9, 41.
- The web's 125..195 slice.

## R8. Evidence

- The M-1 path has no arm in `plan.test.mjs` or the e2e, so no test exercises it.
- The A4 reason pins are still missing (already stated).

---

## Other findings

### L-1 (LOW). The rehearsal tree never patches or scans `web/`

`scripts/rehearsal-tree.sh` substitutes and checks only `programs bank scripts tests sim launch Anchor.toml`.

- `web/src/config.js` keeps the mainnet ids.
- `web/test/ids.test.mjs`, which compares `config.js` against `bank/layout.mjs`, fails inside the rehearsal tree.
- The rehearsal profile's program list is all `null`.
- The 4-character abbreviated-id scan never looks in `web/`.

So road step 8 cannot run the pages that item 50 and road step 11 depend on. A page built from the rehearsal tree's `mainnet` profile would target the mainnet ids.

- **Evidence:** run the script, then `grep -r Gsb7AGhK <DEST>/web/src`. It still matches.
- **Fix:** add `web` to both file lists, and fill the rehearsal profile from `REHEARSAL-RECORD.txt`.

### L-2 (LOW). The pages are bundled by an esbuild outside this repository

`web/build.mjs` loads `require('/home/ubuntu/luna-remotion/node_modules/esbuild')`.

- That copy is not pinned by this repo's lockfile.
- It is not audited.
- It compiles the ceremony bundle that Gary signs immutable values with.
- The README's reference hash table is produced by the same build, so it detects drift *after* commit. It cannot vouch for the compiler.

**Fix:** pin esbuild in this repo's `package.json` and lockfile, and have a second machine reproduce the table.

### INFO-1. Copy on the nested-vault rescue

The text "Someone sent it in; it is not yours to take" is shown even when the holder nested their own vault. During the thaw, the holder could instead Execute a Core transfer of the inner vault back to themselves, with no dependence on the Squads. The ruling stands; only the copy is wrong.

---

## The accepted limits

1. **Worse than stated:** limit 42 and SPEC item 50's "prior transaction" obligation are defeated on the page by M-1. The limit text is right; the client is not.
2. **Not actually a limit:** none found.
3. **Discharged items:** all still discharged.
4. **OPEN AND BLOCKING items:** 22, 38, 50, 52 and 53 remain open. 53 is understated: see L-1.

---

## What this project should do before launch that AI audit structurally cannot

1. **Execute every finding on a real validator, then on mainnet with dust.** For each confirmed finding of every round, including M-1, a person runs the e2e arm and keeps the signatures. Then, on mainnet, deliberately:
   - dust the reserve ATA addresses and a holder's ATA addresses for a throwaway rehearsal vault;
   - open it through the published page.
2. **Prove what the wallet does.** With a real Phantom on desktop and on iOS and Android, sign a 0.001-SOL CBOB transaction and record whether `signTransaction` returns a byte-identical message. If Phantom injects guard instructions, every opening is refused by `signExact`, and no audit can see that.
3. **Make the build reproducible by someone else.**
   - A second person on a separate machine rebuilds the five `.so` files and the five `app.js` bundles from the release commit, using pinned toolchains (including esbuild, see L-2).
   - Both people compare hashes before step 9 and again before the ceremony.
4. **Run a human key ceremony.**
   - Gary runs road step 10 in local mode over SSH, with a second person watching who compares each preflight line against `launch/mainnet-init.json`.
   - Run steps 9 and 10 back to back.
   - Hold the Moments update-authority key cold for the 7-day window. SPEC 46 says this alone closes the project-ending and governance-capture risk.
5. **Add a bounded live period before the lock.**
   - Run the dress rehearsal and a capped real charter window while the upgrade authority is still held.
   - Publish a bug bounty with real money during that period.
   - Exercise a Coinbase-freeze drill on the rehearsal deployment, freezing the pool and a vault account on a test mint.
6. **Test the copy with people.** Have three non-technical holders read HOLDER-GUIDE and use the redeem page. Record what they believed would happen and compare it with what did. No model can measure that.
7. **Write a recovery runbook for every refusal message.** For each refusal the page can show, document what a person tells the holder to do. M-1 shows the page can say "needs a person" when a single ATA creation would fix it.