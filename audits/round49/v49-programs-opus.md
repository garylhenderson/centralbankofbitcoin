# Round 49, programs pass: seat "opus"

**Audited commit:** `617504d5a1ccfcd5805e182d5e7008c22468eb9c` (HEAD of /opt/cbob-vaults). `git status --porcelain` showed only `?? audits/round49/`, before and after my runs.

**Program source.** `git diff --quiet d2ae5fc HEAD -- programs Cargo.toml Cargo.lock` exits 0, so the program source is the release commit's. `dist/` passes `sha256sum -c SHA256SUMS`. Its five sizes and hashes equal `web/src/config.js` `MAINNET_PROGRAM_BYTES`, and `dist/MANIFEST.txt` names `d2ae5fc`, `dirty no`.

## Headline

I found nothing wrong in the five programs, and nothing that moves value, miscredits it, or stops or wrongly refuses a crack. I found no HIGH or MEDIUM anywhere.

**Findings: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW, 4 INFO.** All five sit in the fixable layer (tooling, docs, test evidence, page copy) and are outside (a)-(d).

**Round 48's repairs hold at every site I checked:**
- **V48-1**, one condition in `plan-redeem.mjs:97`. I re-derived it from MINT's `claim`, `join` and `retire`, and it is sound.
- **V48-2.** Both runners now take the lock.
- **V48-3.** `web/README.md` is corrected.

One new LOW sits in the same lock: it is per tree, not per machine (F49-1).

## What I read, and what I ran

**Read whole:**
- **The five programs:** `programs/*/src/lib.rs`, all 5,238 lines, including MINT's host tests. Also the five `Cargo.toml`, the workspace `Cargo.toml` and `Anchor.toml`.
- **The pages and their libraries:**
  - libraries: `web/src/lib/{ix,tx,plan-redeem,reads,decode,ids,enc,plan-get,plan-vault,plan-ceremony,ceremony-reads,my-vaults,ui,wallet}.mjs`
  - pages: `web/src/pages/{redeem,claim,buy,vault,draw,ceremony}.mjs`
  - `web/src/config.js`, `web/build.mjs`, `web/deploy/rpc-proxy.mjs`
- **Round 48's records:** `audits/round48/VERDICT-programs.md` and `VALIDATION.md`.
- **Holder-facing docs:** `HOLDER-GUIDE.md`, and the brief's quoted SPEC limits.
- **Tooling:** `scripts/build-mainnet.sh`, `scripts/rehearsal-tree.sh`, `scripts/validator-lock.sh`, `tests/initauth.test.ts`.

**Read in part:**
- **SPEC:** the community-pool section and road steps 9-11.
- **README.md:** lines 1-140.
- **Tests and sim:** the suite's SR.* block (`tests/3prog.test.ts:3160-3345`, plus the `because()` pins at 3955 and 4015-4025), `sim/test-vault.ts` S8 (`:455-520`), and the round-48 diffs of `web/test/{e2e-localnet.mjs,plan.test.mjs}`.
- **Scripts:** the heads of `scripts/run-tests.sh`, `scripts/validate-core-gate.sh` and `sim/rehearsal-local.sh`.
- **`web/meta/generate.mjs`:** its first 80 lines.

**Not read:** I did not read the whole suite, the e2e test or the sim line by line. I did not read the bundled rehearsal driver files, and nothing below rests on them.

**Ran (only the four allowed offline checks, at HEAD; logs in `/tmp/claude-1000/aud49-opus/`):**

| check | result |
|---|---|
| `node web/test/run-all.mjs` | **806/806**, rc 0 |
| `node bank/selftest.mjs` | **1089/1089**, rc 0 |
| `node scripts/check-launch-params.mjs --selftest` | **69/69**, rc 0 |
| `node bank/accrual.mjs --selftest` | **39/39**, rc 0 |

**Node one-offs (scratch only):**
- I recomputed all 14 pinned Anchor discriminators from `sha256("account:…" | "global:…")`. Every pin in SEAL, MINT, BURN and GOV matches.
- `web/src/generated/launch.json` equals `launch/mainnet-init.json` value for value and status for status.
- I applied the rehearsal path map to `validator-lock.sh` (F49-1).

**Not run:** no validator, no `run-tests.sh`, no sim, no e2e, no `build-mainnet.sh`, no rehearsal script, and nothing on chain. Every on-chain claim below comes from reading the source. Where I lean on a measured arm, I name it.

---

## R0. Round 48's verdict and its repairs

**V48-1 (claim first for a waiting vault). The repair holds.**
- `plan-redeem.mjs:97` is now `claim = !!(record.active || record.pending) && !poolFrozen`.
- I re-derived from MINT what a claim naming a pending vault does inside the opening:
  - **Not yet eligible** (`dist_epoch == request_epoch`): `claim` runs `monthly_inline` first (`mint/lib.rs:1684-1686`).
    - That run may credit and advance the epoch.
    - The loop then joins the vault at the new accumulator (`:1695-1703`, `join` `:2021-2034`), owing 0.
    - Or the loop skips it, and `retire` removes it from `pending_count` / `pending_this_epoch` (`:1898-1904`).
  - **Eligible**: `monthly_inline` returns early because `waiting_to_join > 0` (`:2060-2065`). The loop joins the vault at `acc`, and `retire` then removes exactly `w` at owed 0 (`:1878-1895`). That passes `ClaimBeforeBurn` (`:1882`).
  - **Joined and credited during approval:** it is active by now, so the claim pays and leaves the carry under 1 sat.
- The claim's `dest` is `ata(pda, payment_mint)` (`plan-redeem.mjs:200`). That equals the `vault_ata` that `activate` recorded (`mint/lib.rs:1435-1449`), which is what a pending claim requires (`:1696`).
- No new widest shape: a pending vault's opening now has the active vault's shape, already measured (claim-first, 1,213 bytes wrapped).
- See F49-3 for what its new e2e arms do and do not prove.

**V48-2 (validator lock). The repair holds as written.**
- `sim/rehearsal-local.sh:24-25` and `scripts/validate-core-gate.sh:29-30` take `validator_lock` before any trap or kill.
- Both boot with `9>&-`.
- **New gap:** the lock is per tree, while the ports and the kill-all are per machine (F49-1).

**V48-3 (web README).** `web/README.md:87-92` and `:438` now match the code (one `getTokenAccountsByOwner` per program) and the floor (806, measured).

**Round 48's disproofs, re-tested against this tree:**
- **C15:** Execute is refused while sealed (suite 3.7). The helper is reachable only inside a redemption.
- **C16:** a source can never be its destination. The source must be owned by the signer, the destination by `dest`, and `signer != dest` (`sweep/lib.rs:50-60`).
- **C22:** the helper accepts what round 48 says it accepts. Measured arms:
  - SR.12a: a duplicate source is refused only because the first pair closed it.
  - SR.13: zero pairs is the lamports-only sweep.
- **C23:** BURN skips a closed reserve account because it is System-owned (`burn/lib.rs:337`).

None of round 48's rejected claims survives.

---

## R1. Custody

**What I checked: nothing found.**

**Pairing:**
- SEAL walks forward from its own top-level index for a BURN `burn_vault` whose account 0 is the asset and account 2 is the owner (`cbob-vaults/lib.rs:225-242`).
- BURN walks backward for SEAL's `open_for_redemption` with the same pair (`burn/lib.rs:257-274`).
- Both walks read top-level instructions only, so a CPI cannot satisfy either half. A wrapped half reports the outer index, which still needs a genuine top-level partner (WR.1-WR.4 measured).
- A top-level `burn_vault` must succeed or the transaction reverts, so a thawed vault cannot leave a transaction unburned.

**Ways around the pairing, each tried:**
- **Transfer mid-transaction.** Transferring the vault to O2 between open and burn makes BURN refuse `NotTheOwner` (`:244`). A second open for (A, O2) still leaves the first open needing a burn for (A, O), which can no longer succeed.
- **Two vaults in one transaction.** Each pair binds its own asset and owner.
- **Nested-vault redemption through a host's Execute.** The nested vault's owner is the host's PDA, which cannot sign the top-level burn.

**The emptiness proof:**
- All six ATA derivations must be declared (`:331-349`), and the PDA must hold 0 lamports (`:327`).
- **Reserve accounts:** a token account at a reserve ATA address must be owned by the PDA, have no delegate, no delegated amount and no close authority, be exactly 165 bytes, and hold an amount of 0.
- **Declared accounts:** a declared live Core asset is refused, and declared PDA-owned token accounts get the same checks (`:350-381`).
- A Token-2022 ATA for a classic reserve mint cannot be created: the ATA program refuses with `IncorrectProgramId`, measured live by the mainnet probe (35/35 at `128d84d`; arms at `probe-mainnet-facts.mjs:88-110`).
- `$GARY` and `$GIRAFFISH` have no freeze authority. The probe pins `null`, so nobody can freeze their reserve accounts.
- A frozen cbBTC reserve account is limit 28.

## R1s. The sweep helper (`programs/cbob-vault-sweep/src/lib.rs`, 90 lines)

**What I checked: nothing found.**

| | |
|---|---|
| **(a) Who can make it move value** | Called directly, it moves only what a signer owns, because the source owner must equal `accounts[0]`, which must sign (`:48`, `:57`). Through Core, only the owner can `ExecuteV1` on a thawed vault. Measured by SR.5 (stranger), SR.5a (owner-added transfer delegate) and SR.5c (a collection authority that can sign), each pinned to Core `0x1a`. The CBOB collection's update authority is MINT's off-curve PDA, and MINT has no Execute CPI (SR.5b). While sealed, Core refuses Execute. |
| **(b) The pair list** | Odd count and wrong program ids are refused (SR.6-SR.9). `dest` equal to the asset-signer is refused (SR.10, `:50`). A source not owned by the signer is refused (SR.11). A destination not owned by `dest`, or of another mint, is refused (SR.12). A duplicate source reverts at its second read (SR.12a/b). A frozen source reverts (SR.14). A kept close authority reverts the whole call (R36.C5; the page uses a plain transfer). A wSOL source is transferred and closed, its rent going to `dest`. A repeated destination, a non-ATA destination, or another vault's wallet as `dest` are accepted. That is safe, because only the owner chooses them. |
| **(c) The destination** | It is not compared with the owner, which is safe given (a). A lamports credit to an account that does not exist, below rent, is refused (R41.C8a-c). That only matters when the page names a destination other than the owner, and the page never does. |
| **(d) The lamport sweep** | `signer.lamports()` is read after every close, and each close pays its rent to `dest`, not the signer (`:68-70`, `:75`). Nothing later in the owner's own transaction can re-fund the PDA unless the owner adds it. BURN's `lamports == 0` (`burn/lib.rs:327`) sees exactly what the sweep left. |
| **(e) BURN after a close** | A closed account is System-owned and is skipped for that reason (`:337`). An account a stranger can create for the vault is either a classic ATA (named by the sweep once the prior transaction creates it), or a non-ATA classic account, a Token-2022 account of a Token-2022 mint, or a nested Core asset. BURN does not inspect the last three unless they are declared, so they can be destroyed (limit 44) but never block. Nothing exists that the sweep cannot name and BURN will not skip. |
| **(f) Fit** | S8.0 serializes [open, claim, Execute(helper over 3 pairs), burn] with the owner as fee payer and asserts `<= 1232 - 52 - 96` (`sim/test-vault.ts:483-495`). The page's order is claim-first (`plan-redeem.mjs:198-207`), which is the same instructions in another order. The page adds at most the 52-byte compute-budget pair and keeps the owner as fee payer. A fourth reserve is impossible (`MAX_RESERVE_MINTS = 3`, SEAL `:136`, BURN `:125`). The in-line monthly run adds no account: the pool is already in both claim and burn. Strays are popped until the packet fits (`plan-redeem.mjs:212-215`). |
| **(g) Evidence** | `build-mainnet.sh:153-162` `cmp`s the helper's mainnet bytes against the localnet rebuild AND against `target/deploy/cbob_vault_sweep.so`, the file the suite and sim deploy. The `because()` pins name each SR refusal's exact error (`3prog.test.ts:3955`, `:4015-4025`). |

## R2. The pool (`programs/cbob-vault-mint/src/lib.rs`)

**The invariant "pool ≥ ceil(owed)": proved, and nothing found.**

**`credit`** (`:1914-1921`):
- `delta = floor(avail·S / W)` and `owed += delta·W ≤ avail·S`, with `avail = balance − ceil(owed/S)`.
- So `owed' ≤ ceil(owed/S)·S + (balance − ceil(owed/S))·S = balance·S`, and therefore `ceil(owed'/S) ≤ balance`.

**`claim`** (`:1715-1758`):
- `pay = floor(pending/S)`, `owed −= pay·S`, `balance −= pay`.
- So `ceil` falls by exactly `pay`.

**`retire`** (`:1875-1910`): only lowers `owed`.

**`reweigh` and `join`:** owed-neutral per vault, so the identity "Σ `owed_of(r)` over active vaults = `owed_scaled`" holds across them. Two conditions make it hold:
- `total_active_weight` equals the sum of the live weights. `join` adds `w` (`:2024`), `reweigh` swaps `before` for `after` (`:1962`), and `retire` removes `w` including any boost (`:1879`, `:1887`).
- Every weight change resets the debt and carries what was owed (`:1958-1961`).

MINT's host test (`:3239-3241`) and P.32 / the allocation selftest (39/39) assert the same identity.

**Counters:**

| counter | where it moves |
|---|---|
| `pending_count` | +1 at request (`:1443`); −1 at join (`:2026`) and at a pending retire (`:1899`) |
| `pending_this_epoch` | +1 at request; reset at `advance_epoch` (`:1928`); −1 only when the retiree requested in this epoch (`:1900-1902`). `join` never touches it, because it needs `dist_epoch > request_epoch` |

`waiting_to_join = pending_count − pending_this_epoch` (`:2004`) is therefore exactly the number of eligible requests not yet joined.

**SPEC's "arrived before it joined" rule:** a joiner enters at `debt = w·acc` (`:2029`). So it is never credited by an earlier distribution, and it shares only what arrived after the distribution that made it eligible. That is SPEC's weaker rule (SPEC "What the rule does and does not promise"). Unsplit revenue is limit 55.

**Liveness.** No party can permanently block distributions or redemptions:
- `JoinWaitingFirst` clears by a free claim join or `retire_burned`. Joining needs no token account, only `dest == vault_ata` by key (`:1696`).
- `BoostsExpireFirst` clears by `expire_boosts`, which needs records only (`:1541-1557`).
- `monthly_inline` never refuses a host except for a wrong pool (`:2049-2090`).
- `retire_redeemed` forfeits when the pool is frozen (`:1793`).

## R2b. The boost

**What I checked: nothing found.**
- A boost bought at epoch `d` schedules `end = d + N` in ring slot `end % 64`, with `N ≤ max_boost_epochs ≤ 63` (`:1519-1521`, init bound `:581`).
- `advance_epoch` moves `ring[dist_epoch % 64]` into `boosts_due` (`:1929-1931`). A boost therefore earns exactly the N credits `d → d+N` and is DUE at `d+N`, and `distribute` and `monthly_inline` refuse to run past it (`:1601`, `:2055`).
- A slot cannot be shared between live end epochs, because `N ≤ 63 < 64`.
- `unschedule_boost` takes from `due` or from the ring by the same predicate (`:1969-1979`).
- Expiry is `reweigh(…, 0)` at the accumulator its last credit left, so nothing earned is gained or lost.
- A record cannot expire twice: `expire_boost` requires `boost_weight > 0`, and both callers skip retired records. It cannot expire early (`BoostNotDue`), and it cannot never expire (the gate).
- Owner-only: `:1494-1497`. Terms, one-sided: `:1483`.
- The host model test drives the program's own functions through four wraps (`:3167-3250`).

## R3. The level draw

**What I checked: nothing found, and nothing worse than limits 25 and 26.**
- `blockhash_in_window` (`:235-255`) pins the sysvar key, bounds `n ≤ 512`, checks the buffer length, takes the smallest produced slot in `[want, want+64]`, and refuses an all-zero hash.
- `try_capture` (`:2193-2215`): A, then B and C each two 4-slot groups on.
  - The worst-case C is about `R + 208 < R + 300`, and A stays within 300 of `now < 512`.
  - "Absent below `now`" means skipped on this fork, so the result does not depend on when the capture runs.
- FIFO: `index == revealed_total` (`:1313`). A burned head is drawn without the Core write (`:1351-1387`).
- The attribute re-supply is checked against the stored hash (`:1363`).

**Who can influence a draw:**
- **The minter** chooses the mint slot (limit 26), and can withhold capture for a re-roll if nobody else captures (limit 25).
- **A crank operator** chooses only when to capture inside a deterministic window, or when to reschedule. A reschedule sets `now + 16`, a slot that does not exist yet.
- **C's leader** can skip its own first slots, skip its whole group (handing C to the next leader, which is another re-roll), or vary its block contents.

That is the "many draws" SPEC 26 states. HOLDER-GUIDE.md's honest list says it truly ("can pick among several results ... affects every vault created in that moment at once").

## R4. Governance (`programs/cbob-vault-gov/src/lib.rs`)

**What I checked: nothing found.**
- A vote is bound to the ASSET (`:852-853`). The electorate is `index < index_snapshot` (`:428-429`). The live `quorum_supply` is snapshotted at creation (`:307-310`).
- Quorum, the 51% threshold and the 10% YES floor (`:461-480`). Key changes need YES from `ceil(50%)` of the snapshot, and the two key changes never share a proposal (`:334-336`, `:484-490`).
- Each CPI's arguments are serialized in MINT's order: set_round (i64, i64, u64, u32), restart (bool, bool, i64), `Option<Pubkey>`, `SweepTighten`, `Pubkey`, (u64, u8, u16).
- The restart skip is the exact complement of MINT's `StopIsNewer` (`>=` against `<`). No earlier action in a bundle can change the stop flags read at `:512`.
- A pre-funded proposal or vote PDA does not block: Anchor's `init` handles a funded address (R31.W2a/b).
- What a vote can reach is the brief's list and nothing more; the 85/15 split, both destinations and `max_supply` have no setter.
- Freezing governance is no worse than limit 47.

## R5. The charter claim

**What I checked: nothing found.**
- Domain-separated leaves and nodes, sorted pairs, depth ≤ 16, identity by address (`:121-134`, `:1212-1213`).
- The window is enforced by clock alone (`:1190-1191`).
- The claim CPI-burns the PoB as its owner, with `pob_extra` passed never as a signer and with its writable flag preserved (`:1232-1238`).
- **SPEC 46 is complete for everything I can derive from our code.** The hot update authority can:
  - add a rejecting or selective external plugin, on the collection or per asset (stated);
  - move a PoB out of the collection by changing the asset's update authority (stated as the same brick class).

  It cannot transfer or burn a PoB, and it cannot add permanent delegates (stated, with Core citations).
- A third party can only fund the new vault address in flight (limit 59).

## R6. One-time configuration and the trusted hop

**What I checked: nothing found.**
- Every `initialize` bound is as SPEC 38 lists it.
- **What `initialize` itself does not check, but the launch checker covers:**
  - level caps that sum below `max_supply` (accepted at `:607`; the supply then stops at the cap total, `:2229`);
  - `charter_opens_at` already in the past;
  - `pob_collection` not verified as a Core collection.
- The swap operator's worst case is `max_sweep_lamports` per cooldown, never more than the revenue PDA holds above the reserve, stoppable by the guardian (`:1055-1078`).
- The royalty is installed with plugin authority None (`:729-751`). None of our programs calls a collection-plugin update or remove, or an update-authority change. Royalties is authority-managed, so an owner cannot add an asset-level one.
- The redemption cap is exactly a rolling window over the last `min(cap, 64)` timestamps (`burn/lib.rs:277-294`). The page's read-only mirror at `plan-redeem.mjs:56-65` matches it.

## R7. Raw offsets, recomputed from the structs

**MintConfig** (body 1,005 bytes, plus 256 padding = 1,261 = `MINT_CONFIG_SPACE`):

| field | offset | field | offset |
|---|---|---|---|
| `governance` | 41 | `sweep_stopped_at` | 526 |
| `minted_total` | 141 | `sweep_floor_lamports` | 631 |
| `sales_stopped` | 191 | `cooldown_ceiling_secs` | 639 |
| `sweep_stopped` | 192 | `reserve_ceiling_lamports` | 647 |
| `sol_reserve_lamports` | 257 | `max_boost_weight` | 711 |
| `max_sweep_lamports` | 266 | `max_boost_epochs` | 712 |
| `sweep_cooldown_secs` | 274 | `boosts_due` | 729 |
| `charter_closes_at` | 442 | `boost_expiring` | 749..1005 |
| `bare_burns_retired` | 454 | | |
| `sales_stopped_at` | 518 | | |

**VaultRecord:**

| field | offset | field | offset |
|---|---|---|---|
| `asset` | 9 | `pending` | 177 |
| `mint_index` | 41 | `request_epoch` | 178 |
| `active` | 125 | `boost_weight` | 186 |
| `retired` | 126 | `boost_end_epoch` | 187 |
| `vault_ata` | 129 | `carry_scaled` | 195 |
| `debt_scaled` | 161 | total | 221 |

**BurnConfig:** `burned_total` at 42, `rate_head` at 58, the ring at 59..571.

**SEAL Config:** `collection` at 9, the reserves vector at 41.

**Other raw reads:**
- The page's `dueBoostRecords` slice (125/70: `d[0]` active, `d[1]` retired, `d[61]` boost weight, `d[62..70]` end epoch) and `waitingVaults` (offset 177) match.
- The sweep helper reads mint at 0, owner at 32, amount at 64, length 165.

Every pinned read is correct.

## R8. The suite, the simulation and the build as evidence

- **Only one thing differs between the localnet and mainnet builds:** the `localnet` feature gates nothing but `INIT_AUTHORITY` in the four keyed programs (`grep cfg(`; the helper declares no such feature). `build-mainnet.sh` proves each key behaviourally, refusing for the right reason (`initauth.test.ts`, `REACHED_PAST`). It also proves the helper's mainnet bytes are the deployed test bytes.
- **The four keyed programs' `dist/` bytes have never executed** except under the init-key probe. The suite ran the localnet build, and the rehearsal ran an id-substituted build. This is inherent to the compiled-in key and is stated in each program's header. It is not a new finding.
- **F49-3:** the V48-1 arms are narrower than their names.

---

## Findings

### F49-1: LOW. The one-validator lock is per TREE, but every runner shares one machine's ports and kills every validator on it

**Construct:**
- The lock path is a literal: `scripts/validator-lock.sh:24` (`VALIDATOR_FLOCK=/opt/cbob-vaults/.cache/VALIDATOR.flock`).
- `scripts/rehearsal-tree.sh:63` adds `"$ROOT $DEST root"` to the substitution map, which is applied to every tracked file under `scripts/` (`:75`).
- `scripts/rehearsal-refresh.mjs` re-applies the same map.
- The result: inside a rehearsal tree the lock is `<tree>/.cache/VALIDATOR.flock`, a DIFFERENT file.
- Every runner in both trees boots on 8999/9900. `run-tests.sh` (`:60-66`) and `validate-core-gate.sh` (`:33`) kill every `solana-test-val` and free those ports. Neither has a `pgrep` guard (only `rehearsal-local.sh`, `run-sim.sh` and `e2e-localnet.sh` do).

**What breaks:** the production tree's certifying or Core-watch run and the rehearsal tree's run do not exclude each other, and either can kill the other's validator mid-run.
- SPEC 53 makes exactly that in-tree run an obligation at every repair commit.
- The Core watch starts the production suite automatically on any Core upgrade.
- This is the V47o-2 failure mode (a killed diagnostic, a false URGENT) across trees. V48-2 closed the same shape within one tree.
- It fails closed: a killed run fails. I found no path to a false pass: the victim's programs are absent from the other tree's validator, so its arms fail. No value moves.

**Class: none.** Test and tooling only. Nothing in the five programs, no value path, no crack.

**Evidence (measured):** applying the map to `validator-lock.sh` in a node one-off gives:
- prod: `VALIDATOR_FLOCK=/opt/cbob-vaults/.cache/VALIDATOR.flock`
- tree: `VALIDATOR_FLOCK=/home/ubuntu/cbob-rehearsal/.cache/VALIDATOR.flock`

A rehearsal worktree exists today at `/home/ubuntu/cbob-rehearsal` (at `1650336`, before the lock was added). It gets the second lock path at its next refresh.

**Fix:**
- Put the lease outside any tree, at a fixed machine path that does not contain the repo root (for example `/run/lock/cbob-validator.flock`, or `$HOME/.cache/cbob/VALIDATOR.flock`), so the map cannot rewrite it.
- Add a selftest arm: the rehearsal-mapped `validator-lock.sh` must name the same lock file as production's. It is red today.

### F49-2: INFO. "Nothing can leave it while it is closed" is untrue of what the code does

**Construct:** the same promise appears at four sites.

| site | text |
|---|---|
| `HOLDER-GUIDE.md:40-41` | "Nothing can leave it while it is closed. Not even by you. What goes in stays in until the day you open it." |
| `README.md:12-13` | "Nothing in that wallet can leave while the vault is closed, not even for its owner." |
| `README.md:101`, generated from `scripts/readme-facts.mjs:30` | "nothing leaves its wallet until the owner opens it" |
| `web/src/pages/vault.mjs:104` | "Sealed: Yes. Nothing can leave it until it is opened." |

**What is wrong:**
- MINT's permissionless `rescue_nested` (`mint/lib.rs:1836-1869`) moves a CBOB vault out of a SEALED live host's wallet, to the Squads, with no signature from the host's owner.
- A foreign Core asset or Token-2022 token whose issuer kept a permanent delegate can also be taken out of a sealed vault wallet by that delegate.
- The same documents describe the rescue elsewhere, so they contradict themselves.
- Nothing is lost to the reserve assets, which the sentences mean, and nobody is harmed. A holder who receives a vault sent into their deposit address loses it to the rescue, as the honest list says.

**Class: none.** Documentation and page copy. It misstates no reserve asset or payout.

**Evidence:** read at the sites above.

**Fix:** "Nothing you or anyone can sign for leaves it while it is closed, except a CBOB vault sent into it (the rescue returns it to its sender) and anything whose own issuer kept a permanent transfer power." Apply the same change at all four sites.

### F49-3: INFO. The V48-1 e2e arms prove less than their names and less than round 48's gate-5 item 1

**What round 48 asked:** its gate-5 item 1 (`audits/round48/VERDICT-programs.md:218`, repair text at `:152`) asked for this arm: plan a waiting vault's opening, land a join and a distribution, then send the PLANNED opening, which must open, and the arm must be red on the old planner.

**What landed:**
- an offline plan arm (`web/test/plan.test.mjs`, red on the old planner);
- two SIMULATED bare claims (`web/test/e2e-localnet.mjs:300-303`, `:380-381`).

**The gap:**
- The second e2e arm's title says "it joins it, owing nothing", but it asserts only `!err` and a "Instruction: Claim" log line. A claim that skipped the vault would pass it too.
- No arm lands a planned pending-vault opening after a join and a credit.

The composition argument in R0 holds, so I do not doubt the repair. The evidence is just narrower than the record says ("two on-chain e2e arms", `VALIDATION.md`).

**Class: none.** Test evidence only.

**Fix:** assert the join in the simulation (the `VaultActivated` event, or a post-state read of the record through `accounts:`). Add the race arm as round 48 specified, or record why the composition argument replaces it.

### F49-4: INFO. "Run a payout" shows the pool's whole backlog, not this vault's share of it

**Construct:** `web/src/pages/redeem.mjs:205-231` (`payoutBlock`).
- Line 212 says "The Bank holds {avail} sats ... You can run one now by burning 100 $GARY from your wallet; your vault's share is then collected".
- The vault receives `avail · w / W`. With the full census active (W = 6,405 at the ruled caps), that is about 1/3,200 of the figure shown for a Level I and about 1/1,070 for a Level V.
- The page holds every input (`record.level`, `boost_weight`, `mintConfig.total_active_weight`) and shows no estimate. A holder can read the figure as what the burn buys.

**Class: none.** The burn is voluntary and named, and distributes per the rules; nothing is misdirected.

**Fix:** show "about `floor(avail·w/W)` sats would be credited to this vault" beside the 100 $GARY cost.

### F49-5: INFO (answers limits question 4). Item 22's remaining condition cannot be met on mainnet before anything mints

**The conflict:**
- SPEC item 22 stays OPEN AND BLOCKING ("must be done before anything mints") only for the crank's I/O against ~2,100 vaults.
- Before the first mint there are no vaults on mainnet, so that condition can only be met by a synthetic or local scale run, or by a ruling.
- Neither exists, and road step 11 and the charter opening (the first mint) can be scheduled without either.
- Separately, item 53's in-tree run was last made at `e7c192a`, and three repair commits have landed since (rounds 46-48). SPEC says each needs it again.

Neither is being treated as accepted in writing yet. But the R49 brief's sequence ("if no change, deploy and make permanent, road steps 9 to 11") names neither. The charter date (`launch/mainnet-init.json` `charter_opens_at`, OPEN) is the point where they would become accepted silently.

**Class: none.** Process.

**Fix:** before `charter_opens_at` is set, record one of two outcomes:
- a measured local scale gate: the crank against a validator holding 2,100 synthetic vault records, including a transient RPC failure mid-batch and the reveal lane's throughput; or
- Gary's explicit ruling accepting item 22's scale risk.

Also run item 53's in-tree suite at the final commit.

---

## The accepted limits: the four questions

1. **Is any limit worse than stated?** I found none.
   - **26:** whole-group skipping, which hands C to the next leader, is another re-roll inside "many draws".
   - **32 and 59:** priced as stated.
   - **46:** complete for everything derivable from our code (R5).
   - **10:** bounded exactly by `max_sweep_lamports` per cooldown above the reserve.
2. **Is a listed limit already closed?** No. Each limit I checked (9, 25-29, 32, 36, 37, 40-49, 55-59) is still true of the code.
3. **Is a DISCHARGED item not actually discharged?** No.

   | item | where it is discharged |
   |---|---|
   | 14 | `check_attributes` refuses duplicates, `:2242` |
   | 15 | `VaultTooNew`, GOV `:429` |
   | 19 | `NotRevealed`, `:1432` |
   | 30 | `split_bps` is written only at init, `:669` |
   | 31 and 33 | the periods are init parameters |
   | 51 | the boost is built, R2b |
   | 54 | the pages send no crank |
   | 12/17 | measured |

4. **Is an OPEN AND BLOCKING item being quietly treated as accepted?** Not yet, but item 22 has no reachable closure condition before the first mint, and item 53 is stale. See F49-5.

## Anything else checked, nothing found

- **The wallet-edit judge** (`tx.mjs:108-143`):
  - The page's instructions must survive byte for byte, in one contiguous block.
  - Roles are compared as sets in both directions. Per-instruction flags in a legacy message derive from those roles, so they cannot change while both sets are equal.
  - Only Lighthouse and a bounded compute budget may be added.
  - A Lighthouse memory write needs a new writable account, so it is refused.
- **The RPC proxy:** the five `getProgramAccounts` shapes equal what `reads.mjs` sends. The token listing is restricted to the 8-byte slice. Relayed transactions must call a CBOB program, or be one of three exact shapes.
- **The ceremony:** pins the init key and the launch file, checks bytes and probes for every program, verifies every field after each step, and reads before it sends.
- **The claim and buy pages:** `max_price` is the price read on chain; address reuse is guarded per limit 59; the charter claim sends no pass-through accounts, and refuses a PoB or collection with an external plugin.
- **The vault page:** rescue always goes to MINT's `bank_treasury`; activation requests and joins mirror MINT.
- **`web/build.mjs`'s external esbuild** (`/home/ubuntu/luna-remotion`) was already stated in rounds 36, 40 and 42. I do not re-file it.

---

## Given that no human firm will ever see this and the programs will be immutable: what to do before launch that AI audit structurally cannot

1. **Run Core-lifecycle fuzzing on a validator, not by reading.** Every AI pass, mine included, reasons about Core's plugin interactions from source. Drive random owner-managed plugin combinations (Autograph size, FreezeExecute, delegates, the new Groups plugin type 18 that `decode.mjs` lists) against the PINNED Core binary. For each shape, assert that `reveal_level`, the full redemption and `rescue_nested` still land. An unrevealable head halts the FIFO for every later vault, and nothing could fix it after step 11.
2. **Re-pin and re-run on the day of step 11.** Metaplex upgraded Core three times in five weeks.
   - Make "the deployed Core hash equals the pinned hash, and 913/913 plus the sim and e2e passed against it within the last few hours" a hard precondition typed into step 11's runbook.
   - If Core changes between step 9 and step 11, do not finalize.
3. **Make a person-in-the-loop check on mainnet before `--final`.** A non-author with a fresh machine should:
   - rebuild from `d2ae5fc` in the verifiable container;
   - compare the hashes to the dumped ProgramData;
   - redeem one real vault (minted at the real ids during the charter window's first hour, or before step 11 if the order allows) through the published page with a real Phantom and a real Ledger.

   AI passes cannot hold a hardware wallet or watch a wallet's UI.
4. **Treat the Giraffish Moments update-authority key as cold for exactly seven days.** It is the one hot key that can end the project before it starts (limit 46). Keeping it hot is ruled. A human custody procedure for the window (offline, two-person) costs nothing on chain.
5. **Close F49-5 in writing:** either a measured local scale run at about 2,100 records, or Gary's ruling, before `charter_opens_at` is set.
6. **Give the public a bug bounty with a real budget, and open it before step 11.** The code is public, and adversaries who can test against the live Core will exist the moment the ids hold value. It costs nothing to open, and a disclosure before `--final` is the only one that can still change the code.

---

**Report path:** `/opt/cbob-vaults/audits/round49/v49-programs-opus.md`
**Findings:** 0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW (F49-1), 4 INFO (F49-2 to F49-5), all outside (a)-(d).
**Verdict:** nothing in the five programs or in the pages holders and Gary sign must change before launch; the five findings are fixable-layer items (tooling, copy, evidence, process) to fix and test as usual.
