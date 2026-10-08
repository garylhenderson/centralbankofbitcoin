# Round 44 Independent Audit, Programs Pass (v6 final tree)

## Verdict

**No finding survives in the five programs.**

- **Programs (SEAL, MINT, BURN, GOV, the sweep helper):** I re-derived every check that custody, accounting and pairing rest on. Nothing broke.
- **Round 43 repairs:** every repair visible in this bundle holds.
- **Confirmed findings:** three LOW and five INFO. All are in the fixable layer: runner and build tooling, the dress-rehearsal plan, docs and one sim pin.
- **Launch gate:** no finding falls in classes (a) to (d). I grade F3 (the dress rehearsal never exercises the holder pages) LOW, and give my reasons below. If Gary reads the launch gate's "anything that stops or wrongly refuses a holder's crack" as covering an unrehearsed client, F3 becomes MEDIUM under (c) and (d), and it is the one item here I would not ship without addressing.

**What this pass cannot see.** `bank/crank.mjs` (round 43's `planRescues`), `bank/alarm.mjs` (V43o-2's skip-after-3), `bank/selftest.mjs`, `scripts/check-launch-params.mjs` and the other `web/test/*` files are in the off-chain bundle. I cannot verify V43-1's crank repair, V43o-2, or the new `--rehearsal` judge from source. I verify only what this bundle shows about them.

---

## R0: Round 43's verdicts and repairs

| Item | My check | Result |
|---|---|---|
| V43-1, measured | Suite R43.V1 builds `ixOpen(Z)`, then Core `execute(Z){TransferV1(NZ to alice)}`, then a sweep, then `ixBurn(Z, reserves)`. It asserts `ALLOW,alice,false`. R43.V1a asserts the rescue then refuses, pinned to `NotNested`. The control is 9.5/9.6. | **The arm can fail** (it wants ALLOW and a specific owner). It measures exactly the shape the round 43 verdict described. |
| V43-1, docs | The holder guide's honest list and SPEC limit 58 now name the race and Gary's ruling. | Present. One tense issue: see F7. |
| V43-2 | `e2e-localnet.mjs` header lines 15-17 now describe a plan that does not refuse, an optional rescue, and `bank_treasury`. | Repaired. |
| V43o-1, release gate | `run-tests.sh` `release_gate`. | Present. It is **weaker than SPEC 53 claims**: see F1 and F2. |
| Core re-pin | `30dce56b…` appears identically in `run-tests.sh`, `sim/run-sim.sh`, `build-mainnet.sh` and `web/test/e2e-localnet.sh`. The probe asserts the deployed bytes equal the pin and are not the August pin. | Holds. Its consequence for the rehearsal is in F3. |
| Round 43's disproved claims | I re-tested C3 (Core `CompressV1` refusal), C7 (`MINT_CONFIG_SPACE`), C8 and C9 from first principles. | All stay disproved (layouts recomputed in R7 below). |

---

## R1: Custody

I attacked the pairing every way the brief names. All attempts fail.

**The pairing walks.**
- SEAL walks forward and BURN walks backward. Both read top-level instructions only and both bind account 0 (asset) and account 2 (owner).
- A wrapped open is refused (WR.3) and a wrapped burn is refused (WR.2).
- Two vaults in one transaction each need their own pair; the second is rate-limited at cap 1 (4.9, 4.10a) and lands at cap 2 (S9b).

**Transferring the vault mid-thaw.** I tried `open(A,o1)`, then Core `TransferV1(A to o2)`, then `open(A,o2)`, then `burn(A,o2)`.
- SEAL's first open still requires a later successful `burn(A,o1)`.
- After `burn(A,o2)` the asset is a tombstone, so `burn(A,o1)` cannot succeed.
- The transaction is atomic, so the thaw reverts.
- **No path leaves a thawed vault unburned.**

**The emptiness proof.**
- The reserve loop skips an account no token program owns. It is right to: the Token-2022 ATA of a classic mint cannot become a token account. ATA refuses it (probe F4.2) and allocating it needs the ATA program's signature (R36.G2a).
- The C5 close-authority case is handled off-chain and is already stated.

**What can leave value in the vault wallet before the burn.** Only instructions inside the transaction can, and the sweep runs last before BURN. Core `BurnV1` does not credit the asset signer. `retire_redeemed`'s in-line distribution touches only the pool and config.

## R1s: The sweep helper

| Question | Finding |
|---|---|
| (a) Who can reach it | Only Core `ExecuteV1` under the asset owner can drive it on a vault. SR.5, SR.5a and SR.5c are measured at the re-pinned Core, which passed 912/912. While the vault is frozen, the seal refuses Execute (3.7, S6.2). |
| (b) Pair aliasing | A source can never equal a destination, because the source owner is the signer, the destination owner is `dest`, and `dest ≠ signer` (SR.10). A duplicate source is refused because the second read sees a closed account (SR.12a). A duplicate destination is harmless. A native wSOL source works: Transfer then Close returns its lamports to `dest` (not measured, already stated). An odd or zero pair count is SR.7 and SR.13. |
| (c) Destination | Choosing the destination is the owner's prerogative under (a). A credit below rent to an account that does not exist is refused (R41.C8). In practice the destination always exists, either as the fee payer or as the recipient of a Close. |
| (d) Lamports | `signer.lamports()` is read after the closes, and nothing later in the transaction credits the asset signer. SR.4a's exact lamport accounting passes at the re-pinned Core. |
| (e) Accounts a stranger can create | A classic ATA, a non-ATA classic account, a Token-2022 account for a non-reserve mint, or a Core asset. All are undeclared, so BURN never inspects them. None can block the burn, and destruction is limit 44. **There is no account a stranger can create that BURN neither skips nor sees.** |
| (f) Packet size | S8.0 measures claim, open, the helper and burn at 1,061 bytes with the owner paying and no compute-budget instructions. That is the shape the page sends. A fourth reserve is impossible by protocol (`MAX_RESERVE_MINTS = 3`). The in-line monthly run adds no accounts. |
| (g) Test evidence | SR.0-SR.14 pin real reasons. **Gap:** S6.2 in the sim is pinned only to "Core failed" (F8). The suite's sweep bytes are proven identical to `dist/` by `build-mainnet.sh`. |

## R2 and R2b: The pool and the boost

**The invariant `pool ≥ ceil(owed_scaled)` holds.**
- `credit` adds `floor(avail·S/w)·w ≤ avail·S`, so `ceil(owed_new) ≤ ceil(owed_old) + avail = balance`.
- `claim` removes `pay·S` from owed and `pay` from the balance together.
- `retire` removes the full `pending` and moves no tokens.
- `reweigh` leaves owed unchanged.
- A frozen pool changes neither side.

**`owed_of` cannot underflow (which would block claims or retires).** After every write, the debt equals `weight·acc` or is less.

**The counters.**
- `pending_this_epoch` counts only current-epoch requests.
- It is zeroed in `advance_epoch` and decremented in `retire` only when `request_epoch == dist_epoch`.
- `join` decrements only `pending_count`, because a join requires an earlier epoch.

**The boost ring.**
- An end epoch lies in `dist_epoch + 1 … +63`, so no two live slots collide.
- A boost bought at epoch e with N distributions becomes due at e+N, which means exactly N distributions.
- These properties are independently re-derived and match host tests N1 and BO.21, BO.35 and BO.38.

**Liveness.** Joining needs only the record, and expiry needs only records. I found no way to make distributions impossible.

## R3: The level draw

- The parse, the skip handling and the window arithmetic are correct. C lies at most about 216 slots after the reveal slot, and the window is 300.
- The FIFO cannot stall on a burned vault (L.11).
- Limit 26's "chooses among many draws" is accurate. I found nothing worse than what is stated.
- The permissionless reschedule's choice of timing is already in limit 26.

## R4 and R5

- **R4:** GOV's skip rule (`>=`) mirrors MINT's `StopIsNewer` (`<`). The half-of-all-vaults test uses the snapshot. I found nothing beyond limits 45 and 47.
- **Observation, likely already known:** vaults whose keys are lost, or that sit in off-curve custody, count toward `quorum_supply` forever. They can never be retired. If enough of them accumulate, quorum or the half-of-all bar becomes permanently unreachable. That is the same permanent-stop class limit 47 describes, from a different cause. It should be one sentence in limit 47.
- **R5:** SPEC 46 is complete as far as I can test. The hot wallet can gate or brick claims, never take a Proof of Burn, and the window ending closes the exposure.

## R6: One-time configuration

I re-checked every bound in the four `initialize` functions.

- `launch/rehearsal-init.json` satisfies every bound: cap 5 SOL ≥ 1 SOL; floor 0.1 SOL ≤ cap; ceiling 7,200 ≥ 3,600; reserve 1,000,000 ≥ 890,880 and ≤ the reserve ceiling 10,000,000; monthly ≥ 60; notice ≥ 60; window ≥ 10; vote ≥ 60; caps sum to 5.
- The royalty authority is `None` (R.3, R.6, R33.G3).
- The rate limit is exactly a ring of 64 recent timestamps.

## R7: Cross-program offsets, recomputed

| Structure | Result |
|---|---|
| MintConfig | 1,005 bytes + 256 padding. Every field GOV, BURN and the tests read is correct: 41, 141, 191-192, 257, 266, 274, 442, 454, 518, 526, 631, 639, 647, 655, 663, 671, 711, 712, 714, 729, 749. |
| VaultRecord | 211 + 10 = 221 bytes. The `dueBoostRecords` slice (offset 125, length 70) puts active at +0, retired at +1, `boost_weight` at +61 (absolute 186) and `boost_end` at +62..70 (187..195). Correct. The proxy's waiting filter at 177 is correct. |
| BurnConfig | 42, 50, 58 and 59..571 match the space. |
| SEAL config | Reserve vector at 41. |
| Sweep token read | Offsets 0, 32 and 64, length 165. |

## R8: Suite, simulation and build

- `build-mainnet.sh` proves the sweep helper's bytes match `dist/`, `target/deploy` and the localnet build, and proves the other four programs' keys behaviourally.
- F1 and F2 below are gaps in the runner's release gate, not in `build-mainnet.sh`. That script refuses dirty and untracked trees.

---

## Findings

### F1. LOW (tooling). `release_gate`'s rehearsal branch accepts any whitespace-free text swap, and a marker file selects that branch

- **Construct:** `scripts/run-tests.sh` `release_gate`, the Python block.
- **What it checks about the map:** six entries, three fields each, the right names, and `o ≠ n`. It never checks that the `o` values are the five mainnet ids and the root path, or that the `n` values are base58 pubkeys equal to `.rehearsal-keys/*` and `target/deploy/*-keypair.json`.
- **Why that matters:** the reverse map restores any token. A map entry such as `require!(found, → drop((found,` silently turns SEAL's `NoTerminalBurn` check into a no-op. The gate still prints "equals RELEASE_COMMIT under the recorded id map" and **skips the web offline gate**.
- **Marker selection:** the branch is chosen by `REHEARSAL-RECORD.txt` existing in `$ROOT`. Nothing refuses it in `/opt/cbob-vaults`, and nothing refuses it under `CBOB_SHIP_GATE=1`.
- **Mitigations that limit the impact:** the suite would catch many such swaps, and `build-mainnet.sh` is unaffected. That is why this is LOW. But SPEC 53's sentence "proves the program difference … is EXACTLY the recorded substitution" overstates what the gate proves.
- **Evidence:** in a scratch copy, write a six-line map with real ids for mint, burn, gov, sweep and root, and the swap above for seal. Write `.rehearsal-files` and `.rehearsal-sha`, then run `release_gate`. It passes.
- **Fix:**
  - Require `{o}` to equal the five ids in `rehearsal-tree.sh`'s `PROGS` plus `/opt/cbob-vaults`.
  - Require each `n` to be a 32-byte base58 key equal to `solana-keygen pubkey target/deploy/<crate>-keypair.json`.
  - Refuse the rehearsal branch when `ROOT == /opt/cbob-vaults` or when `CBOB_SHIP_GATE=1`.
  - Add a selftest arm with a non-id `n`.

### F2. LOW (tooling). Both branches of the release gate are blind to untracked files

- **Construct:** `git diff --quiet "$rel" -- programs Cargo.toml Cargo.lock`, and `git diff --name-only` in the rehearsal branch, list modified tracked files only.
- **Gap:** an untracked `programs/*/build.rs` is compiled by cargo and can emit `cargo:rustc-cfg=…`. An untracked repo-root `.cargo/config.toml` (rustflags) is also invisible. Either changes the binaries the suite tests while the gate reports the source equal to `RELEASE_COMMIT`. `build-mainnet.sh` refuses untracked files (`git status --porcelain`), so the shipped artifacts are safe; the gap affects only the claim that the tested source is the release source.
- **Fix:** also require `git ls-files --others --exclude-standard -- programs .cargo Cargo.toml` to be empty, and refuse a `.cargo/` directory that differs from `rel`.

### F3. LOW (I argue below for treating it as near-blocking). The dress rehearsal never runs the holder pages against a live cluster

Item 22's named pass/fail items are the crank, the alarm, two revenue cycles, a hand recovery and DAS. None of them is a redemption, claim or purchase through `web/`. Several facts compound this:

1. `rehearsal-tree.sh` does not patch `web/`. The web gate is skipped in the rehearsal tree by design.
2. The `rehearsal` profile in `web/src/config.js` has program ids, RPC and `launchValues` all null.
3. That profile's `initAuthority` is Gary's `Hc6WG…`, but `rehearsal-init.json` rules the localnet key `GmaDrpp…`.
4. That profile's `squads` is the real CBOBTC Squads, but the rehearsal treasury must be throwaway.
5. So the ceremony and every page refuse, or would target the wrong keys, in a rehearsal.
6. The redeem page is the only pre-signature control in production (items 9, 44, 50). Its first execution against mainnet would be a real holder's opening.
7. Since the re-pin, Core's fixed create and execute fees (1,500,000 and 48,720 lamports) differ from the old rent-based fees **only at mainnet rent**. The round 43 addendum says no local arm can see the difference. No arm has ever run a redemption, a claim or a purchase under the deployed Core's real mainnet fee path. That includes SR.4a's property that the asset signer ends at exactly 0 and the page's cost display.

**Not in (a) or (b):** it is not a code path that moves or credits value wrongly.

**Why I still grade it LOW and not MEDIUM:** e2e 132/132 and the browser mock exercise the same library. Against that, round 43 listed "real Phantom, live proxy" as unmeasured and did not make them blocking.

**Fix:** add item 22.6 to SPEC.
- Through the actual staged pages, against the rehearsal deployment, with a real Phantom on a phone and on desktop: one charter claim; one purchase; one activation; one opening carrying a stranger's late deposit and a stray; one rescue.
- Record the signatures, and assert the asset signer is 0 and the balances after each.
- Make the `rehearsal` profile buildable from `REHEARSAL-RECORD.txt`: ids, `initAuthority = GmaDrpp…`, `squads = the throwaway treasury`.

### F4. INFO (docs, plus a latent tooling gap). Stale "rehearsal mode not built" text, and the ceremony would use the wrong judge

- **Stale text:** `web/README.md` open decision 4, the rehearsal comment in `web/src/config.js`, and the `judgeRehearsal` comment in `plan-ceremony.mjs` all say rehearsal mode is not built. SPEC 53 (round 43) says it is.
- **Wrong judge:** when wired, `ceremony.mjs` `judgeValues` uses the page-local `judgeRehearsal`. It checks bounds only. It does **not** run `check-launch-params.mjs --rehearsal`'s never-mainnet checks (no real PoB root, no real Squads, no ruled operator).
- **Fix:** import the rehearsal judge from `check-launch-params.mjs`, as the mainnet path does, and correct the three texts.

### F5. INFO. `rehearsal-init.json` uses a status its own legend does not define

Most values carry `status: "RULED"`. The file's `_comment` and SPEC 53 define only MAINNET, PROPOSED, REHEARSAL-OPEN and REHEARSAL-NA. Either the legend or the values are wrong. I cannot see whether `--rehearsal` accepts RULED.

### F6. INFO. SPEC limit 59 overstates the griefer's cost

Limit 59 cites "at least the 890,880-lamport rent floor per attempt". 890,880 is the test validator's 0-byte rent. Mainnet's is 650,240 (fact 9). The cost stated to holders is about 37% too high.

### F7. INFO. "Our payout job runs the rescue every hour" is in the present tense while the crank is installed dry-run

The holder guide and SPEC limit 58 both say this. Item 22 lists the crank as installed dry-run. The guide is a DRAFT gated on item 50, but the arming of the crank should be named as part of that gate.

### F8. INFO. Sim S6.2's reason pin is too broad

S6.2 is pinned to "CoREENxT… failed", so any Core failure satisfies it. Pin it to `custom program error: 0x9` (InvalidAuthority from the frozen seal), as suite 3.7 does.

---

## The accepted limits: the four questions

1. **Is any limit worse than stated?** Two are slightly mis-stated. Limit 59's cost is overstated (F6). Limit 47 omits the case where lost keys and unvotable custody permanently inflate `quorum_supply`. I found none worse in effect than written.
2. **Is any listed limit not really a limit?** No.
3. **Is any discharged item not actually discharged?** Item 14 (duplicate attributes) is closed on both paths (11.4, R42.C8). Items 12/17 and 54 are measured. None is mis-discharged.
4. **Is any open item being quietly treated as accepted?** Items 22, 38, 50, 52 and 53 stay open. F3 is the risk that item 22 closes without the pages ever running.

---

## Before launch: what an AI audit structurally cannot do

1. **Run F3's live page rehearsal by hand**, with Gary's real Phantom on real phones, before step 11. AI cannot hold a wallet or watch a phone render.
2. **Get an independent reproducible build of the five programs** from `RELEASE_COMMIT` on a machine that is not this box, ideally with the OtterSec or `solana-verify` pipeline, and compare against `dist/SHA256SUMS` and the deployed ProgramData. Every AI round reads source; none can prove the deployed ELF came from it except on this box's word.
3. **Have a second person check the initialize transactions.** Before Gary signs the four initializes, someone other than the builder decodes each transaction's bytes (Phantom's simulation, or an independent decoder) against `launch/mainnet-init.json`. The checker validates the JSON, not the signed bytes (item 38 A6).
4. **Hold the Moments update authority cold (hardware or a multisig) for the seven days.** It is the single largest residual risk (limit 46), and the fix is operational, not code.
5. **Run long property fuzzing of MINT's accounting**: host-level, millions of random interleavings of join, claim, boost, retire, distribute and freeze, against the `owed == Σshares` and `pool ≥ ceil(owed)` model. Run it for days, not the 260 epochs the host test covers.
6. **Put a named human on call** for the alarm's CRITICAL pages through the charter window and the first month, and rehearse reaching the guardian wallet within minutes.
7. **Re-read Core's changelog and pin at step 11.** Metaplex upgraded Core twice under this suite. Be ready to delay step 11 if Core moves again between the rehearsal and the lock.