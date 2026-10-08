# Independent audit — v6 whole tree, round 41 current

I reviewed the four vault programs, the stateless sweep helper, the `web/` holder pages, the redemption/ceremony path, the launch ceremony, the RPC proxy, `txread`/`sigwalk`, the suite floors, and the accepted-limits list. I did not rerun the validator suites in this session; claims below are static against the bundled source and the recorded measurements unless noted.

The short result: **I did not find a new CRITICAL, HIGH, or MEDIUM defect that survives the tree.** I did verify that the round-41 page-side dust repair is present in the current shape, and that the programs’ core value controls hold under the rules they claim. The remaining release-blocking risk is overwhelmingly in **OPEN AND BLOCKING items 22, 38, 50, 52, 53**, not in a newly discovered program vulnerability.

---

## R0 — Round 41 repairs and regressions

The round-41 confirmed LOW was page-side: dust at the four program-config PDAs stopped the ceremony with a false not-owned error. In this tree:

- `web/src/lib/reads.mjs` `anchorAccount()` now calls `absentIfDust()` before owner checks.
- `web/src/lib/ceremony-reads.mjs` `resolveCollection()` and `readStep()` likewise treat System-owned, 0-data accounts as absent.
- The ceremony preflight/steps path no longer hard-stops on the V41-1 shape.
- The round-41 gate-5 arms for the rent rule are present in `tests/3prog.test.ts` (`R41.C8a`-`R41.C8c`) and the e2e.

I do not re-file V41-1. I found no surviving same-shape bug in the current tree.

The remaining R0 problem is the same as before: the pages are built and staged, not published. That is **item 50**, still OPEN, and until published the only pre-signing protection for items 9/44 is the staged page, not anything in production.

---

## R1 / R1s — Sealed vault custody and sweep helper

The pairing is at least as strong as the prior measured rounds indicate:

- `open_for_redemption` refuses without a later top-level `burn_vault` for the same asset and same owner (`NoTerminalBurn`).
- `burn_vault` refuses without an earlier top-level open for the same asset and owner (`NoPrecedingOpen`).
- Both bind asset at account 0 and owner at account 2, and the matching uses instruction-sysvar top-level reads; CPI wrappers cannot satisfy either half because the opposite half is hidden top-level.
- The fail direction is closed: a mismatch halts redemption; it does not permit a thaw.

The sweep helper still has no independent authority. It requires `signer.is_signer`; through Core `ExecuteV1` the signer is the asset-signer PDA, and Core authorizes only the current asset owner on this pinned Core. Direct call refuses `MissingRequiredSignature`. I find no route for a transfer delegate, collection update authority, or permanent-freeze plugin authority to execute it on a thawed vault.

The pair-list checks are correct:
- source must be classic SPL, owned by the signer;
- destination must be classic SPL, same mint, owned by the single destination wallet;
- `signer == dest` is refused;
- a source-account close with foreign close authority is refused by the helper close, which is why the page moves C5 accounts with a plain `ExecuteV1` transfer instead.

Zero-pair lamport sweeps are safe in the current page contract. The holder-visible destination is the owner/fee-payer on the page path, so it already exists. The rent-rule arms (`R41.C8a`-`R41.C8c`) now measure the runtime behaviors SPEC item 50 relies on.

The destination is chosen by the transaction builder, but the only party who can cause the vault’s wallet to sign is the owner at Core’s Execute authorization boundary. A malicious page can choose a different recipient, but a malicious page can also ask the owner to sign anything; the page already belongs to the same trust boundary as the holder’s browser. No on-chain fix would help.

I do not find a surviving unburned-thawed-vault path.

---

## R2 / R2b — Community pool and $CBOB boost

The pool accounting remains coherent on its stated invariant:

- `join` starts debt at `weight * acc`, carry 0.
- `credit` increases `acc_scaled` and the aggregate `owed_scaled` by matching amounts.
- `claim` settles whole sats, normalizes debt to current `weight * acc`, carries the sub-sat remainder, and subtracts only the settled scaled amount from `owed_scaled`.
- `reweigh` preserves a vault’s owed share into `carry_scaled` and resets debt.
- `retire` removes weight and subtracts exactly the retired vault’s pending scaled share; a forfeit does the same under frozen pool.
- Frozen claims defer without moving `owed_scaled`.
- Due boosts and waiting joins gate distributions and can be cleared permissionlessly.

The boost schedule still earns exactly N distributions: the distribution that reaches `end_epoch` makes it due, and no later distribution can run before expiry. Early retirement removes the boost from the ring or the due set. I found no double-credit, double-expiry, or lost-share path on static read.

The only edge that remains is already accepted in item 27: a bare-burned but un-retired vault can be paid/joined by a permissionless claim until `retire_burned` runs. That is not new.

---

## R3 — Level draw

The SlotHashes parse is defensive and bounded; a zero hash is refused, and a malformed or wrong-key sysvar account is refused. The draw uses the smallest produced slot in `[want, want + MAX_SKIPPED_SLOTS]`, as required. FIFO is enforced by `RevealOutOfOrder`. A missed window reschedules rather than defaulting. A burned vault at the head still draws to avoid blocking the FIFO, which is the intended behavior.

The remaining dominant influence is the C-slot leader, which is accepted limit 26. The code matches that limit. I do not find a new influence path below the reported one.

---

## R4 — Governance

Liveness and execution rules remain consistent with the design:

- `index_snapshot` prevents a vault minted after proposal creation from voting.
- `quorum_supply` is the live supply at creation.
- `VoteRecord` is seeded by asset, so a vote is bound to the asset across transfers.
- Guardian and swap-operator replacements need half of the snapshotted live supply and cannot share a proposal.
- Per-kind latest IDs and `CBOB_ACTION_SKIPPED` prevent a stale action of the same kind from reviving a superseded decision or reverting its bundle.
- Tightening is monotone and bounded.

I found no bypass that lets a minority carry an ordinary action, or a key change.

---

## R5 — Charter claim

The PoB Merkle tree is domain-separated, sorted, and bounded. The claim burns the PoB as its owner under MINT’s CPI before minting the vault, all in one instruction, so a failed mint reverts the burn. The pass-through accounts are never signers. The page refuses PoBs/collections with external plugins, which is the documented conservative client behavior.

I found no way for a PoB holder or third party to claim twice with one PoB, or to claim a lookalike.

---

## R6 — One-time configuration and trusted hop

The one-time initialize checks the critical wiring and pinned mints/bounds. Wrong ruled values remain the launch-value problem captured by OPEN item 38, not an in-code privilege issue:

- The callback release authority is the launch key’s actual wallet secret on this box, and the launch values still have `charter_opens_at`, `lock_deadline`, and `vault_collection` OPEN.
- The trusted swap operator is bounded by signed destination, cap, cooldown and reserve, and the guardian can stop it. This remains accepted limit 10.
- The redemption rate limit is a true 64-slot ring with `RATE_RING == 64`, and the code matches the SPEC description.

I found no wrong-but-accepted value path that is not already covered by the launch checker or SPEC.

---

## R7 — Cross-program raw reads

I recomputed the raw offsets from the struct definitions:

- MINT config: `minted_total` at 141, `bare_burns_retired` at 454, charter close at 442, governance at 41, sweep bounds at 257/266/274, stop timestamps at 518/526, boost bounds at 711/712.
- VaultRecord: `mint_index` at 41.
- BurnConfig: `burned_total` at 42.
- SEAL config: collection at 9 and reserves count at 41.

These match the constants in the source and the suite offsets. The sweep helper reads classic SPL at mint 0, owner 32, amount 64, length 165. Correct.

---

## R8 — Suite evidence

I could not rerun the validator suites in this session, so I do not provide a false green run. The floors are wired to equal counts, and the build scripts prove the key behavior with positive/negative arms. The tests contain `R41.C8a`-`R41.C8c`, which directly close the round-41 gate-5 obligation.

The mainnet dress rehearsal and live distribution/revenue-cycle evidence are still OPEN (items 22, 53), not discharged.

---

## Accepted limits — the four questions

1. **Is any limit worse than stated?**  
   I did not find one that is materially worse than the wording already records. The most load-bearing accepted items remain what they say: immutability, Core upgradeability, Coinbase freezes, the trusted swap operator, the hot $CBOB wallet, and the incomplete pre-signing coverage of foreign NFTs/airdrops.

2. **Is anything listed as a limit not actually a limit?**  
   No. The ones I checked are still closed in the code. Item 40’s concrete Core risks, item 44’s destruction cases, and item 46’s PoB collection authority exposure are all present and documented.

3. **Is any DISCHARGED item not actually discharged?**  
   I see no discharged item that was quietly reopened. The Bank, deck, distributor, token-bucket, and old update-wiring pieces are gone or replaced. The boost item 51 is implemented as accepted.

4. **Is any OPEN AND BLOCKING item being treated as accepted?**  
   No. Items 22, 38, 50, 52, and 53 are still labeled OPEN in the tree. The launch file still has exactly the three OPEN values named. The web pages are built/staged, not published. The e2e and rehearsal path is not run by `run-tests.sh` and the rehearsal profile is not built. None of this is being stated as accepted in the audited docs.

---

## Findings

I have no new confirmed CRITICAL/HIGH/MEDIUM finding to report.

The closest remaining review concerns are already accounted for in accepted limits or OPEN items, not fresh program defects:

- **OPEN item 50** remains the most serious live-money gap: until the redeem page is published, the production path that the holder guide describes does not exist. That is not a code bug in this tree; it is a release gate.
- **OPEN item 22** means the crank and revenue cycle have not run against a live cluster. The program arithmetic is strongly tested, but the operational I/O is not.
- **OPEN item 53** means the rehearsal tree proof is present but the rehearsal values/profile are unfinished.
- **OPEN item 38** means the three launch values must still be set and checked before init.

If the project treats the current state as “ready because the programs pass,” that would be the largest failure this audit can identify. The code is not yet in the state it promises to holders.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what structurally cannot be delegated to AI audit

These are concrete requirements, not optional hardening:

1. **Publish the holder pages before any holder-facing promise leaves DRAFT.**  
   The pages are the only pre-signing control for the accepted destruction cases. No mainnet launch or holder-guide publication should happen while `web/` remains staged. The page hashes and the local-ceremony mode should be verified from an off-box copy.

2. **Run the full dress rehearsal at throwaway IDs, including the e2e path, before road step 10.**  
   The rehearsal should prove:
   - the crank runs against the live cluster;
   - the alarm runs in `CBOB_ALARM_REHEARSAL=1`;
   - one full revenue cycle lands through Orca and one through Meteora;
   - one forced post-sweep failure is walked through the hand-recovery runbook;
   - the redeem page survives repeated stranger deposits and listing failures.

3. **Pre-sign the launch ceremony only after `launch/mainnet-init.json` has zero OPEN values.**  
   `charter_opens_at`, `lock_deadline`, and `vault_collection` must all be RULED. The collection should be pinned in `web/src/config.js` and rebuilt before step 0.

4. **Make the program-final step a recorded, one-session sequence.**  
   At road step 9 and again before step 11, dump each deployed program, hash the first `dist/` length, verify the tail is zeros, then remove upgrade authority and dump again. Do not let this be two separate human actions with time between them.

5. **Move the launch-key private material off the box before launch.**  
   The deploy/upgrade authority, the guardian/Phantom seed equivalent, the revenue swap operator key, and the $CBOB release wallet key all live on the box. The larger structural risk is not a program invariant, it is key custody under an AI-only audit process.

6. **Do not treat an AI pass as run evidence.**  
   The current process is good at static reasoning and regression pinning, but it does not execute a Phantom wallet, a real provider, or a live revenue cycle. The measured validator suites and fork tests are the evidence. They must be re-run at the actual release commit, not the last audited commit.

**Bottom line:** the immutable programs, as currently written, hold together under the documented controls. The real remaining risk is not an obscure program bug — it is that the release is not yet in the state the holder-facing process promises.