# Audit of the full v6 tree (five programs, `web/`, round 42 repairs)

I found no confirmed defect in the five programs that moves value, miscredits the pool, or wrongly refuses a crack. I ran nothing here (no validator, no tests). Everything below is read from the supplied source and documents. One finding is a measurement gap with possible systemic impact that I could not settle by reading.

## R0. Round 42's verdict and repairs

- **V42-1 repair (`ceremony-local.mjs`).** `staticFile` now catches the `decodeURIComponent` failure and returns null, and the listener is wrapped in a try/catch. I traced `%2e%2e`, `%00`, `//x` and `/rpc?x` and found no traversal or crash.
- **V42-2 repair (`collectionCreator`).** It now skips failed transactions and takes the first successful `CreateCollectionV2` for exactly that address. It cannot be tricked by a stranger's earlier transaction.
  - A stranger can still push it to `unverifiable` cheaply. A no-op transaction that names the address read-only costs about 5,000 lamports, and 25 of them hit `CREATOR_FETCH_MAX`.
  - The result is only the "pin it" warning, and step 0 is still offered, so the ceremony cannot be stopped. That is acceptable.
- **C12 / limit 59.** The disproof of "system transfer to a new address" rests on the rent rule. A successful pre-create transaction that moves lamports into the address would itself fund it and block the create. So the only pre-create transactions that can coexist with a successful create are zero-lamport ones.
- **C01 and the other round 42 repairs.** I read no contradicting code. `alarm.mjs` is not in this bundle, so I cannot check C01 itself.

## R1, R1s. Custody and the sweep helper

I tried to break the following and failed:

- The pairing in SEAL and BURN (the burn must bind both asset and owner, top-level only).
- The emptiness proof.
- Duplicate sources and duplicate destinations.
- A destination equal to the signer.
- Frozen sources.
- Missing reserve ATAs. A missing ATA only needs to be declared, not to exist, so a stranger cannot block a burn by creating one late.
- Anything stranger-created that is not a reserve ATA. Such accounts are never inspected, so they cannot block a burn.
- The helper's raw token offsets (0, 32, 64, length 165), which are correct.

The helper's destination is not bound to the asset owner. That is safe against third parties because Core gates `ExecuteV1` to the owner. It does not protect against a malicious page that builds the owner's transaction. That residual is inherent to the web client, which is the only preventive control.

### F1. Owner-callable Core instructions that could halt the level queue (unmeasured; HIGH if it reproduces, otherwise open)

- **Construct.** `reveal_level` requires the asset to be `Key::AssetV1` or positively burned; anything else gives `WrongAsset`. The FIFO cannot skip a vault, and a Core CPI failure cannot be caught on Solana.
- **Why it matters.** Any owner-reachable state that makes Core refuse MINT's `UpdatePluginV1`, or turns the asset into a non-`AssetV1` key, halts every later reveal. Because activation requires a drawn level, it also halts every later activation. The guardian cannot stop this, and the programs are immutable.
- **What the suite measured.** Five owner plugins and the 10,198-byte autograph. R26, R28, R31 and R33 cover those.
- **What no arm measures.** Core's owner-authorised `CompressV1`, which turns an asset into `HashedAssetV1`. I could not confirm from the supplied material whether the pinned Core refuses `CompressV1` on a vault with `PermanentFreezeExecute`, `PermanentTransferDelegate`, Attributes and the collection Royalties plugin (rule set None).
- **Evidence if I am right.**
  - A sealed vault's owner runs Core `CompressV1` against the pinned binary and it lands.
  - Afterwards `reveal_level` for that vault reverts `WrongAsset`.
  - `read_core_asset` refuses it, and `retire_burned`, `rescue_nested` and the redeem page all fail.
- **Required measurement.**
  1. Enumerate every Core instruction in the pinned binary.
  2. For each, attempt it as the owner and as a stranger on a fresh, unrevealed, sealed vault, with each owner plugin variant, including delegated authorities.
  3. After each success, attempt `reveal_level`.
  4. Record a table.
- **If `CompressV1` succeeds.** The only program-level fix is to treat a Core-owned non-`AssetV1` account like a burned one: take the draw and skip the write. The tree is scope-frozen and I am not recommending the change lightly. The alternative is accepting an owner-triggerable permanent halt.

## R2, R2b. The pool and the boost

I recomputed the following and found them consistent:

- The pool invariant `bal ≥ ceil(owed)` across credit, claim, join, retire, reweigh and forfeit.
- The boost ring bound. The `epochs ≤ 63` limit keeps live end slots distinct.
- Exactly-N boost earning, including a boost bought inside the in-line month.
- The counters:
  - `pending_this_epoch ≤ pending_count` always holds.
  - A join never touches `pending_this_epoch`.
  - A retire decrements it only when the request epoch equals the current epoch.
- Duplicate records in `claim` and `expire_boosts`.

Liveness holds. `JoinWaitingFirst` and `BoostsExpireFirst` are always clearable permissionlessly, with no token-account dependency for expiry, and `claim` joins without reading the account.

## R3. The level draw

The SlotHashes parse is defensive and fail-closed. The window arithmetic (300 slots against 512 retained, C at most about 216 past the reveal slot) is sound. SPEC 26 is not worse than stated. A leader of A, B and C could grind its own mint, which SPEC already treats as "likely, not guaranteed". F1 is the only added risk to the queue.

## R4, R5, R6, R7

- **R4, governance.** The paths I checked reach only MINT's bounded setters. Quorum, threshold, turnout and key-change rules all hold on read.
- **R5, charter claim.** The Merkle domain separation is correct. I found no omission in SPEC 46 beyond what is already written.
- **R6, one-time configuration.** I recomputed the MintConfig, VaultRecord and BurnConfig sizes and every raw offset. All match the structs: 141, 454, 442, 257, 266, 274, 518, 526, 631, 639, 647, 711, 712, and the dueBoost slice of 125..195 with weight at 61 and end at 62.
- **R7, rate ring.** The ring is exactly a rolling window over 64 slots, and the k-th-most-recent index is correct.

## Accepted limits: the four questions

1. **Worse than stated: limit 47 (a stolen guardian key).** It says "no funds are lost". Two corrections follow.
   - **Stranded royalty SOL.** `sweep_sol_for_swap` is the only exit for royalty SOL. If the sweep stop can never be lifted, all future royalty SOL (8.5% of resale volume belongs to holders) is stranded forever. That is a holder loss, not "no funds lost".
   - **A "half of all live vaults" bar that only rises.** A lost-key vault, one sent to a dead address, or one held off-curve counts in `quorum_supply` forever. It can only leave through a redemption that its holder cannot perform.
   - **Why the guardian is the weak point.** The guardian is Gary's everyday Phantom wallet, the same key as `INIT_AUTHORITY`. The guardian is a plain `initialize` argument, so it can still be changed to a cold multisig before init with no program change.
2. **Not really a limit.** Limit 44 still lists "a frozen stray account holding a balance reverts the redemption". The redeem page never delivers such strays any more (round 36 H1), so that sentence now applies only to other clients.
3. **Discharged items.** Item 19 ("no state in which a vault is activated but unlevelled") holds only while the FIFO advances. F1 is the single point of failure behind that discharge.
4. **Blocking item treated as accepted.** Item 50 is the only preventive control for items 9 and 44. `web/` is outside gate 2's frozen paths (`programs/`, `bank/`, `scripts/`). Fixes such as V42-1 and V42-2 therefore did not reset the counter, even though the pages are what holders actually sign. Round 36 A8 and round 41 C6 already flagged this, and it is still open.

## Other findings

- **F3. LOW, supply chain.** `scripts/build-mainnet.sh` runs `cargo-build-sbf --arch v3` with no `--locked`. `Cargo.lock` is excluded from `audit-coverage.sh` and so was never shown to an auditor. The immutable bytes depend on the lockfile and the transitive crates. Record the lockfile sha256 in `dist/MANIFEST.txt`, build with `--locked`, bundle the lockfile in the next audit, and prefer a containerised verifiable build (`solana-verify`).
- **F4. INFO, evidence.** The shipped mainnet bytes (INIT_AUTHORITY swapped, so a different build) never run the 909-assertion suite. `build-mainnet.sh` proves the key behaviour only. The ceremony's probes and initialize on mainnet are the first execution of those exact bytes.
- **F5. INFO, arms never exercised:**
  - a native wSOL source in the helper;
  - a helper destination that is another vault's asset-signer;
  - a helper destination that is not an ATA;
  - the 3,600 s rate window at its real value;
  - `claim_charter_vault` with a pre-funded asset address through Core's real code path;
  - a deposit landing between the sweep and the burn.

## Before launch, beyond what AI audit can do

1. **Measure the Core surface (F1).** Have a person run every Core instruction as owner and stranger against a fresh vault on a fork of the pinned Core, and keep the table. This is the highest-value remaining measurement.
2. **Move the guardian off the daily wallet.** Use a hardware or multisig guardian distinct from `INIT_AUTHORITY`. Document the royalty-SOL consequence of a permanent sweep stop.
3. **Cap the first sale round.** The round cap and price are voted, so get the first vote to set a small cap and then watch a real redemption cycle.
4. **Make the build verifiable.** Use a deterministic container build and have a second person rebuild and hash.
5. **Do a real mainnet dress rehearsal (item 22).** Run it end to end with real wallets, a real Phantom and Squads return, the redeem page behind Cloudflare, and the alarm running. Exercise the exact mainnet bytes at throwaway ids before the lock.
6. **Hot-key custody.** Check the deploy authority `FZjLB4e9…`, the swap operator, the $CBOB release wallet and the Moments hot wallet. Deliberately rehearse a loss or theft of each.
7. **User testing.** Have real holders on real phones walk the redeem page, because only a human can tell whether the boxes and warnings are understood.
8. **Legal and communications.** Settle terms of use, the "crack your vault" promise, and what to say if a bug is found after the lock.
9. **Page and domain hardening.** The site is the one component that can send a holder's funds elsewhere. Lock down DNS, the CDN and the deploy pipeline. Publish the page bundle hashes on a second channel, so holders can verify them against what Gary signed.