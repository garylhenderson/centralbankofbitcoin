# Independent audit — CBOB v6 (five programs + the pipeline beside them)

Scope read: all four vault programs, the sweep helper, both Cargo manifests sets, the suite, the Test Vault simulation, the expiry-budget and coverage gates, the runners, the build script, the rehearsal script, `txread`/`sigwalk`, SPEC/DESIGN/HOLDER-GUIDE, round 33's verdict and validation record, RT3.

**Bottom line: I found no way for anyone but the owner to get value out of a sealed vault, no way for an emptied vault to survive, no break in the pool invariant, no break in the boost schedule, and no governance path to money.** I recomputed every cross-program offset and every account space from the structs and they are all correct. What I do report is two MEDIUMs (one a control the code does not have and the documents claim it does; one a permanent, undocumented buyer-facing surface), one LOW in the coverage gate, and two INFOs.

---

## R0. Round 33's verdict and its repairs

I verified the verdict's four confirmed findings are repaired **at the sites it named**, by reading the bundled tree:

| R33 item | Site in this tree | Verdict |
|---|---|---|
| **D3** (arm 2.1 could not fail) | `tests/3prog.test.ts`: `rec('2.1',…,'ALLOW',vMint.ok?'ALLOW':'REJECT',vMint.err)` | **Repaired.** The arm now records the mint's own outcome. |
| **D2** (DESIGN said `MIN_ROUND_PRICE_SATS` was fixed at `initialize`) | DESIGN-v6 §6a now reads "a constant compiled into the program (no `initialize` argument sets it)" — matches `MINT:477` / check at `969`. | **Repaired.** |
| **D1** (SPEC REDEEMING step 1 restated the refuted categorical claim) | SPEC REDEEMING step 1 now carries limit 42's measured sizes (1,367 padded / 1,219 narrow). | **Repaired.** |
| **L1** (pre-funded program id blocks the standard deploy) | SPEC road step 9 now carries the pre-deploy read, the measured Allocate/Assign/write-buffer/`DeployWithMaxDataLen` recovery, the 890,880-lamport dust case and the rehearsal requirement. | **Repaired as a runbook item**, which is the right place; no program change. |
| **Gate-5 obligations (W1a, W1b, W2)** | `R33.G1` (640-byte budget + 10,198-byte autograph revealed in FIFO at the default budget), `R33.G2a/G2b` (many-signer autograph grown to Core's heap refusal, then revealed), `R33.G3` (`0x1b` re-delegation refusal + control), plus `R33.G4`; floor 861 → 866; `tests/cpi-wrapper` gained `SIGSPDA!`. | **Discharged.** |

I checked the repairs for the project's own characteristic regression (a fix applied to one of two identical sites) and found none: the new `SIGSPDA!` branch is test-only and in its own workspace, the forwarder's `PADTAIL!` 20,000-byte guard still sits above the runtime's 10,240-byte CPI cap so `R31.W1a` still measures the runtime and not the wrapper, and no program byte changed (`programs/` is identical in shape to what rounds 29–33 read).

Round 33's refutations I re-derived from first principles and agree with: W3 (DESIGN line 107 is correct), W5 (a Core collection has no owner, so a nested `CollectionV1` holds nothing), W6 (`SR.12a`'s reason is pinned separately at `3593`), W9 (limit 36 makes no token-account claim about expiry), W10 (`expire_boosts` needs records only). I did **not** reproduce W1/W2 on a validator (no validator window taken; see "measurement limits" at the end), but the suite now pins both.

**Round 33's accepted item A1 has a sibling it did not name, and I am not re-filing it:** the measured foreign-authority `FreezeDelegate` brick has a `FreezeExecute` twin that blocks the *sweep* instead of the transfer, so the vault can be bare-burned but never emptied. Same class, same owner signature, same guide paragraph; A1's "optional sentence" disposition covers it.

---

## R1 / R1s. Custody and the sweep helper

### Positive results (no finding)

* **The pairing cannot be split.** SEAL walks `current+1..` for a *top-level* `burn_vault` binding asset **and** owner; BURN walks `0..current` for a *top-level* `open_for_redemption` binding the same pair. A wrapped burn beside a genuine top-level open passes BURN's pairing but then dies at `retire_redeemed`'s `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1` (depth 3 ≠ 2), reverting the Core burn with it. A wrapped open dies at `NoTerminalBurn`. Both walks fail *closed* on an early `Err`.
* **`retire_redeemed` is reachable only from BURN.** At stack height 2 the caller must be the program of the current top-level instruction, and that instruction is required to be `burn_vault` for this exact asset. There is no third-party route.
* **No thawed vault can leave a transaction.** The thaw is in asset state; the only instruction that writes it is `open_for_redemption` (there is no re-freeze), and the thaw is only reachable in a transaction that must also burn. If the burn fails, everything reverts. Confirmed by construction, not by test.
* **The pool invariant `balance ≥ ceil(owed)` holds under every ordering.** `credit` adds `delta·w ≤ avail·SCALE` to `owed` against `avail = balance − ceil(owed)`; `claim` reduces both by exactly `pay`; `retire` reduces `owed` only. I also verified the stronger property the suite's `ledger()` asserts: `owed_scaled` equals the sum of `w·acc + carry − debt` over live records, preserved by `join` (0), `reweigh` (unchanged), `claim` (`pending − settled`) and `retire` (removed).
* **The emptiness proof's interaction with the helper is sound for the right reason.** After the helper's `CloseAccount`, SPL assigns the account to the System program and reallocs to 0, so BURN's first loop reaches `if acc.owner != SPL && != T22 { continue }` — a skip because *nothing owns it*, not because it reads zero.
* **Nothing a stranger can create blocks a redemption, given SPEC's prior transaction.** Token-2022 ATAs for classic mints are uncreatable (measured `F4.2`); non-ATA accounts and nested assets are invisible to BURN unless declared (so they do not block, they are destroyed — limit 44); lamports are swept at execution; the three classic reserve ATAs, once created, cannot be un-created (closing needs the PDA, which needs a thaw, which needs the burn).
* Helper edge cases I worked through and found safe: duplicate source (second iteration hits `IllegalOwner` on the closed, System-owned account — and `SR.12b` pins that it is *that* reason, not the source-owner guard); `src == to` is impossible given `signer != dest`; a source that is also a later destination is refused; wSOL sources close legally; a close-authority or frozen source reverts the whole redemption and both are owner-created states that BURN already refuses; a credit to a non-System destination lands (`R27.S1`).

### FINDING 1 — MEDIUM. The sweep helper is a generic "drain the signer" program, not confined to Core asset-signer PDAs, and both the program header and SPEC state the opposite

**Exact construct.** `programs/cbob-vault-sweep/src/lib.rs::process`. The only authorization on `accounts[0]` is:

```rust
let (signer, dest, token, system) = (&accounts[0], &accounts[1], &accounts[2], &accounts[3]);
if !signer.is_signer { return Err(ProgramError::MissingRequiredSignature); }
…
if src_owner != *signer.key { … IllegalOwner }
```

Nothing requires `accounts[0]` to be `["mpl-core-execute", asset]`, or to be off-curve, or to be reached through Core. The header asserts the opposite:

> "Called by anyone directly it can do nothing: the source accounts belong to the asset-signer PDA, which only Core can sign for, and Core signs only for the asset's owner."

and SPEC repeats it in the round-23-F1 entry of "Known limits": *"Called directly it can move nothing (the sources belong to the asset-signer PDA, which only Core signs for, and only for the owner)."*

**What the code actually is.** For **any** signer `S` on **any** transaction, one instruction with data `[0]` transfers the *full live balance* of every named classic SPL token account owned by `S` to a chosen destination, closes each one (rent to the destination), and then sends **every lamport `S` holds** to that destination — `S` need only be a system account with no data, which every user wallet is.

**What an attacker gains.** Not vault theft: the vault invariants are untouched, because the sources must be owned by the signer and only the owner can `ExecuteV1` on a thawed vault. What is gained is a **permanent, immutable, keyless, project-branded wallet drainer on mainnet**, with two properties ordinary drainers lack:

1. **Amount-free.** The instruction carries no amounts and no mint list; one 4-account + N-pair instruction with one data byte empties whatever is there.
2. **Execution-time reads.** A signature obtained now (e.g. under a durable nonce) drains balances that arrive *later*. A hand-built `Transfer`/`transfer(lamports)` cannot do that; it must name amounts that exist at signing time.

Once the upgrade authority is removed this cannot be changed, and it will sit under the Central Bank of Bitcoin's name as a verified program other drainer kits can reference.

**Evidence that would exist if I am right.** On a local validator, a transaction signed by an ordinary keypair `K` (no Core asset anywhere), with accounts `[K(signer,w), attacker(w), Tokenkeg, System, K's ATA(w), attacker's ATA(w)]` and data `[0]`, **lands**: `K`'s ATA is closed, its tokens are at the attacker's ATA, and `getBalance(K) == 0`. No arm in the suite sends that shape. `SR.1` sends the helper directly with `pdaSigns=false` and is pinned to `missing required signature` — a *different* property (that `accounts[0]` must be a signer at all), which is why the false claim survived round 25's audit of the helper.

**Fix (before the lock; it is one derive and, in the redemption, zero extra transaction bytes).** Take the Core asset as a fifth fixed account and confine the signer:

```rust
let asset = &accounts[4];
let (expected, _) = Pubkey::find_program_address(&[b"mpl-core-execute", asset.key.as_ref()], &MPL_CORE_ID);
if *signer.key != expected { return Err(ProgramError::InvalidArgument); }
```

The asset key is already present in the `ExecuteV1` account list, so the inner instruction gains one account index, not one key. If you want the stronger form, also read the asset's owner (`data[1..33]`) and require `dest` to equal it — that closes R1s(c) by construction instead of by argument, at the cost of the "sweep to any wallet I choose" behaviour item 50 currently allows. Either way, **correct the header comment and SPEC's "can move nothing"**, and add the direct-call arm to the suite (gate 5 requires the measurement either way).

### R1s answers, item by item

* **(a)** Only the owner can reach it *through Core* (measured `SR.5`, `SR.5a`, `SR.5c`, and `R24.1a/1c` for the one approving plugin route). But "called directly it needs the asset-signer's signature" is **false** — see Finding 1. It cannot be reached while the vault is frozen (Core refuses `ExecuteV1`, `0x9`, arm 3.7 with the decoded state), so it is always inside a transaction that must burn.
* **(b)** Odd lists (`SR.7`), zero pairs (`SR.13`), duplicate sources (`SR.12a/12b`), foreign sources (`SR.11`), mismatched destinations (`SR.12`), frozen sources (`SR.14`), destination == signer (`SR.10`) are all refused or measured. Untested but safe by inspection: wSOL source, non-ATA destination, a destination repeated across pairs, a destination wallet that is another vault's asset-signer (allowed — the owner's own signed choice, round 33 A11). **A source that is also a destination is impossible** by the two owner checks, and no arm needs to prove it.
* **(c)** Safe *for vaults* only because of (a). Given Finding 1, the absence of a destination check is what turns the helper into a general drainer rather than a vault sweeper.
* **(d)** Nothing can leave the asset-signer non-zero afterwards: the owner builds the transaction, Core adds no lamports, and the pair closes send rent to `dest`, not to the signer. `SR.4a` measures the exact delta (gift + prior wallet balance + released ATA rent + asset refund − fee) and the burn then sees 0.
* **(e)** Answered above: no stranger-creatable account both escapes the helper and fails BURN's skip, **provided** the page's prior transaction creates all three reserve ATAs. That dependency is load-bearing and belongs in item 50, where it is.
* **(f)** S8.0's 1,061 bytes + 52 (compute budget) + 96 (separate payer) = 1,209 of 1,232. There is no fourth reserve (the list is written once, capped at 3), and the in-line monthly run adds no account beyond the pool the claim and the burn already carry. **But the 23 remaining bytes cannot hold a single stray-token pair** (64 bytes of keys), so item 50's "offer to rescue stray CLASSIC tokens" is impossible in the widest page shape and only available in the narrow owner-payer shape. Worth saying in item 50 rather than leaving the reader to do the arithmetic.
* **(g)** The helper's bytes are triple-compared (`dist/` vs `$CACHE/ln` vs `target/deploy`), and `build-mainnet.sh` dies if `target/deploy/cbob_vault_sweep.so` is missing — so yes, the suite's bytes are the proven bytes. The arm that cannot fail in the helper's set is not an arm but a *claim*: `SR.1`'s pin proves the signer requirement, not the confinement (Finding 1).

---

## R2 / R2b. The pool and the boost

No finding. What I checked, so it can be rechecked:

* **Counters.** `pending_this_epoch` is only ever incremented beside `pending_count`, zeroed by `advance_epoch`, and decremented in `retire` exactly when `request_epoch == dist_epoch` (which, since `dist_epoch` is monotone, is precisely the case where the request is still inside the current epoch's count). `join` decrements only `pending_count`, correctly, because it requires `dist_epoch > request_epoch`. Therefore `pending_this_epoch ≤ pending_count` always, so `waiting_to_join`'s `checked_sub` can never error and so can never brick a host instruction. This is the one underflow that *would* have been a CRITICAL (it propagates with `?` out of `monthly_inline`, which every host calls); it is unreachable.
* **Weight conservation.** `total_active_weight` is mutated only by `join` (+base), `retire` (−`weight_of` computed before `unschedule_boost`) and `reweigh` (−before +after); `boost_weight_total` only in `boost_vault` (+extra, before `reweigh`), `unschedule_boost` (−`r.boost_weight`). All consistent.
* **A boost earns exactly N.** `end = dist_epoch + epochs` with `epochs ≥ 1`, so a new boost is never immediately due; `advance_epoch` moves `ring[end % 64]` into `boosts_due`; `distribute` requires `boosts_due == 0` **before** the `w == 0` branch and before any `$GARY` burns, and `monthly_inline` returns before `tick` and before `credit`. So `dist_epoch` can never pass a due end epoch, which means every expiry happens at exactly the accumulator its last distribution left, and `unschedule_boost`'s `>=`/`<` branch selection is exact. Since `epochs ≤ BOOST_RING − 1`, all live end epochs lie in `(dist_epoch, dist_epoch+63]` — 63 values, distinct mod 64 — so two live boosts never share a slot.
* **Liveness.** Every gate is clearable permissionlessly and without any token account: `expire_boosts` needs only the config and the records (so a vault whose cbBTC account is gone, frozen or bare-burned can still be cleared), and `join` needs only the record plus the *address* recorded in `vault_ata` (an address is always passable even if no account exists there). `JoinWaitingFirst` and `BoostsExpireFirst` both return without stamping `last_distribute_at`, so a blocked month stays due and nothing is lost.
* **Aliasing.** The one hazard class I looked for — an Anchor-cached account written back over a raw `store_record` — is closed in every host: `crank` only writes records with `level == 0 && !entropy_set`, and every path that holds an Anchor copy of a record requires `level ∈ 1..5` (`activate`'s request and join paths, `boost_vault`) or fails and reverts (`R24.5`). In `claim`, records are raw on both paths and are re-read after the crank (`K.7`, `BO.36`).
* **SPEC's weaker rule is the true one** (round 24 W11): a joining vault is never credited by a distribution that *ran* before it joined, but it does share the pool's undistributed balance at the next distribution. Limit 55 bounds only the *unsplit* part; the undistributed-but-split part is bounded by the distribution cadence, which the holder guide implies ("anything the Bank has received since the last payout is not yours yet") rather than states. Not filed.

---

## R3. The level draw

No finding; SPEC 26 is not understated. `try_capture` is deterministic in the only sense that matters (which slots the chain produced is settled before it runs), the window arithmetic holds (A ≤ `reveal_slot+64` and C ≤ `reveal_slot+208`, both inside the 300-slot window and inside SlotHashes' 512), an all-zero hash fails closed, and `blockhash_in_window` pins the sysvar key, bounds the count and checks the buffer length before indexing.

Two things worth keeping in the reader's eye, both already written down:

* A validator can time a **reschedule** (not only a mint) into its own rotation; limit 26 says so explicitly.
* `reschedule_reveal` cannot race a capture (it requires the window to have *already* lapsed, when a capture is impossible), so the re-roll in limit 25 really does need total silence for a full window. HOLDER-GUIDE's honest list now states both the leader's choice and the re-roll truly.

---

## R4. Governance

No finding. The CPI from `execute_proposal` carries exactly `[mint_config(mut), gov_pda(signer)]`, so it can only reach MINT instructions whose account list is `Governed` — and all six reachable discriminators are hardcoded per action, so there is no data path to any other instruction (including the `Guardian`-context stops, which share the shape but not the discriminator). Minority capture: the smallest passing ordinary vote is 10.71% of the snapshot (so limit 35 is right that the turnout floor never binds at the ruled numbers), and key changes need ⌈50%⌉ of the snapshot and cannot share a proposal. The quorum divisor counts bare-burned-but-unretired vaults that cannot vote, which only ever makes a proposal *harder*, and anyone can lower it first with `retire_burned`. Permanent freeze: a stolen guardian can hold sales and the sweep shut forever at sub-50% turnout (limit 47, accurate), and nothing else freezes — redemption, activation, distribution, claims and voting are never gated by either stop.

---

## R5. The charter claim

No finding, and SPEC 46 is complete enough on the hot wallet: it names bricking, admission control on the collection *and* on individual assets *and* by flipping an oracle between transactions, the alarm's 30-minute sampling blind spot, the positive bound (the key cannot transfer or burn a Proof of Burn), and the end of the exposure at the window's close. Core's refusal of post-creation permanent delegates and of owner-managed plugins on a collection is the load-bearing fact and it is measured.

The pass-through is correctly de-privileged: `is_signer` is forced false on every extra account, and `n_extra ≤ 8 ∧ ≤ remaining.len()` before the split, so `crank_accts` cannot be made to alias the extras. An extra account that is also a named writable account of the instruction is handed to Core as a non-signer; Core writes none of them.

---

## R6. One-time configuration and the trusted hop

No finding on the programs. Every `initialize` bound is consistent (`sweep_floor ∈ [0.1 SOL, max_sweep]`, `max_sweep ∈ [1,50] SOL`, `cooldown ∈ [1s,24h] ≤ cooldown_ceiling ≤ 7d`, `reserve_ceiling ∈ [rent_exempt, 10 SOL] ≥ sol_reserve`, `sol_reserve ∈ {0} ∪ [rent_exempt, ∞)`), the collection-cleanliness parse is exact (`num_minted == 0` **and** `len == o+8`, so no plugin registry), and the royalty is immutable: the only `AddCollectionPluginV1` is in a once-only `initialize`, there is no `UpdateCollectionPluginV1` anywhere, and `reveal_level`'s `UpdatePluginV1` is pinned to `PLUGIN_ATTRIBUTES` on an asset that must equal `vault_record.asset`, so MINT's PDA can never be aimed at the collection. Re-delegation is now pinned too (`R33.G3`, `0x1b`).

The rate limit **is** exactly a rolling window: `kth = ring[(head + 64 − k) % 64]` with `k = min(max(cap,1), 64)` and `now − kth ≥ window` admits at most `cap` in any window ending at a redemption; the ring is written *before* the emptiness proof, so a failed redemption does not consume budget, and a non-monotone clock fails closed. `cap` can read one high for a bare burn not yet retired (limit 32, D8) — accurate.

Residual, unchanged: the swap operator's worst case is `cap × cooldown windows` until the guardian stops it, never more than the revenue PDA holds above the reserve, never a vault or the pool. One genuine tightness: the cooldown is monotone non-decreasing by construction (`tighten_sweep` takes `max`, GOV refuses `x ≤ live`), which is exactly what round 33's alarm repair depends on.

---

## R7. Cross-program raw reads — recomputed, all correct

I rebuilt every layout from the structs and every pinned offset:

* **MintConfig** data = 1,005 bytes; `MINT_CONFIG_SPACE` = 1,005 + 256 = **1,261** (matches the expression term by term). Every offset GOV and BURN pin is right: governance 41, pool\_ata 73, price 125, minted\_total 141, split\_bps 189, sales/sweep\_stopped 191/192, guardian 193, swap\_operator 225, sol\_reserve 257, max\_sweep 266, cooldown 274, last\_sweep 282, level\_caps 290, level\_minted 310, revealed 330, charter\_closes 442, charter\_claimed 450, bare\_retired 454, weights 462/470, acc 478, owed 494, last\_dist 510, stop times 518/526, pending op 534/566, monthly 574, pending guardian 582/614/615, notice 623, bounds 631/639/647, epoch/pending 655/663/671, cbob\_mint 679, boost bounds 711/712, terms 714/722/723, counters 725/729/733/741, ring 749..1005.
* **VaultRecord** data = 211; space = **221** (SPEC's figure, and the rent figure 1,772,920 reconciles with the measured mainnet 0-byte 650,240 at 5,080/byte).
* **BurnConfig** 571 + 256 = **827**; `burned_total` at 42, window 50, head 58, ring 59.
* **SEAL Config** 8+1+32+4+96+1+256 = **398**; reserves Vec length at 41.
* **GovConfig** 94 + 256 = **350**. **Proposal** = **259** with `ACTION_MAX_BYTES = 37` correct for the widest variant (`Brakes`).
* Every reader pins address + owner + discriminator + `version`, and every length guard (`>= 714` in GOV, `>= 462` in BURN, `>= OFF_RESERVES+4+32n` in both SEAL readers) is satisfied.
* The helper's classic-token offsets (0/32/64, length 165) are right, and it deliberately does not read `state[108]` — the token program enforces frozen on transfer, which is the safe direction.

---

## R8. The suite, the simulation and the build as evidence

Two gate-level items, plus the claim-coverage answer.

### FINDING 3 — LOW. The coverage gate excludes the JavaScript/TypeScript build configuration, so every pin the suite's measurements rest on has never been bundled

**Exact construct.** `scripts/audit-coverage.sh`:

```sh
listed=$(git ls-files 'programs/*' 'bank/*' 'scripts/*' 'sim/*' 'launch/*' 'tests/*' \
      SPEC.md DESIGN-v6.md HOLDER-GUIDE.md Cargo.toml Anchor.toml)
```

Round 15 added `Cargo.toml`/`Anchor.toml` with the argument that "a coverage gate that excludes the files controlling the certification is the same shape as the defect it exists to catch", and round 29 L1 widened the enumeration after `sim/fixtures.mjs` and the program manifests were found missing. The **JS side of the same configuration is still outside**: the package manifest and lockfile that pin `@solana/web3.js`, `@solana/spl-token`, `@metaplex-foundation/mpl-core`/`umi-*`, `bs58` and `tsx`, and `tsconfig.json`, which `Anchor.toml` names (`test = "yarn run ts-mocha -p ./tsconfig.json …"`).

**What an accident gains.** Those pins decide what the suite *measures*: `R.7/R.7a/R.7b` assert MINT's hand-built Core opcodes against the installed mpl-core serializers; every byte count (`9.14*`, `S8.0`, `E.3a`, `3c.P1`) is produced by the installed web3.js transaction encoder; limit 25's 300.8 s socket measurement is a property of web3.js 1.98.4. An SDK bump that changes a serializer or the default `Connection` can move a certified number or silently relax an assertion, and no auditor has ever been shown the file that controls it — which is exactly the condition this gate exists to make impossible.

**Evidence that would exist if I am right.** `git ls-files | grep -E '^(package\.json|package-lock\.json|yarn\.lock|tsconfig\.json)$'` returns at least one path (the suite cannot run without a manifest, and `Anchor.toml` references `./tsconfig.json`), while `./scripts/audit-coverage.sh` reports "every file's CURRENT content has been in a completed, quorate round's bundle". If instead those files are **untracked**, the finding is worse, not better: the dependency set that produces every measured number is not version-controlled at all.

**Fix.** Add `package.json`, the lockfile and `tsconfig.json` to the enumeration (and any other tracked root file that is not a document), bundle them in the next round, and — separately — decide whether the lockfile should be excluded with a named reason the way `*/Cargo.lock` is. Note that excluding the JS lockfile for the *same* reason as `Cargo.lock` ("generated dependency pins") is defensible; excluding `package.json` and `tsconfig.json` is not.

### Arms, and claims no arm exercises

* The only vacuous-arm candidate I found that round 33 did not is already repaired (`2.1`).
* `SR.1`'s negative fires for a *different reason* than the claim it is cited for — see Finding 1. This is the R8 answer: the arm proves "`accounts[0]` must be a signer", the documents claim "called directly it can move nothing".
* Claims in this prompt no arm exercises: a native wSOL source; a non-ATA destination; a destination repeated across pairs; a source carrying a delegate *through the helper*; `pob_extra = 8`; a 30-record `expire_boosts` (whose default-budget cost is extrapolated from the 20-record gate, not measured — a caller can always raise the limit, so this is not a brick); and the direct-call shape in Finding 1. The first six are round 33 A10's accepted optional set; the last is a finding.
* `tests/expiry-budget.mjs` is sound as evidence of what it claims: twenty *distinct* records, real MINT execution, counters conserved (`280 − 20·12 = 40`), the ring/due arithmetic exercised at `dist_epoch == end`, and it says plainly that it is not twenty lifecycles.
* `tests/initauth.test.ts` is correct against the current `initialize` signature (I checked all twenty arguments and the eight accounts in order), and its `REACHED_PAST` set for MINT (`BadBoostSetup` first after the authority check) is the right one. `build-mainnet.sh`'s source grep is weak-but-honest and its banner already says the compiled constant is NOT PROVEN.
* `scripts/validate-core-gate.sh` fails in both directions and dies on every wrong answer; the Core hash is hardcoded, not environment-overridable; both runners pin the three token programs and re-verify them off the validator.

---

## Anything else

### FINDING 2 — MEDIUM. A vault's displayed name, image and metadata are chosen by whoever mints it, are immutable forever, and no document says so

**Exact construct.** `programs/cbob-vault-mint/src/lib.rs::create_vault`:

```rust
require!(name.len() <= MAX_NAME_LEN, MintError::NameTooLong);
require!(uri.len()  <= MAX_URI_LEN,  MintError::UriTooLong);
```

`name` and `uri` are caller-supplied in both `mint_vault` and `claim_charter_vault`, with **length checks only**. No instruction in any of the five programs ever calls Core's `UpdateV1`/`UpdateV2`, and the collection's update authority is MINT's `["mint"]` PDA, which has no instruction that writes an asset's name or uri. So both fields are fixed at mint and permanent. Separately, `check_attributes` reserves `redemption`, `level` and `charter` by **exact string match**, so a minter may stamp `Level`, `LEVEL`, `level ` or `1evel` with any value they like beside the program's authoritative lowercase `level`.

**What an attacker gains.** For the price of one vault — 21,000 sats (~$18 at the price recorded in DESIGN) in a voted round, or **free** during the charter window — a minter can create a vault in the CBOB collection whose rendered name, image and off-chain trait list claim Level V while its on-chain record and `level` attribute say Level I, and resell it at Level V prices. Most marketplaces render the asset's `name` and the JSON at `uri` (which the minter hosts and can change *after* the sale); the on-chain Attributes plugin is read by DAS but is not what every marketplace's trait panel shows. The same surface permanently embeds whatever else a minter puts at that uri in a collection the project cannot edit — up to 2,100 times, with no remedy after the lock.

HOLDER-GUIDE tells a buyer "Your level never changes. It is drawn at random … and written onto the vault," and prints the 1× / 1.5× / 2× / 2.5× / 3× table. It never says that the *name and picture* on a vault are the minter's, nor that only the on-chain record is authoritative. SPEC's known-limits list, which exists to hold exactly this kind of chosen cost, does not contain it either. This is the project's own bar ("every buyer-facing cost is written down") not being met.

**Evidence that would exist if I am right.** In the suite, replace one `mkVault()` call's `name` with `"CBOBTC Vault — LEVEL V"` and its uri with any attacker-controlled URL: the mint lands (no arm constrains either field), `fetchAsset` returns them, `reveal_level` writes `level: I` beside them, and no later instruction can change either. On mainnet, the collection would show two vaults with the same rendered level and different records.

**Fix (choose one before the lock).**
1. **On chain, cheap:** have MINT build the name (`format!("CBOBTC Vault #{}", index)`) and pin the uri to a program-held base plus the index, or at minimum require the uri to start with a prefix fixed at `initialize`. This is a few lines in `create_vault` and removes the surface permanently.
2. **Off chain, free:** accept it as a product decision and write it into SPEC's "Known limits" and the holder guide's honest list — "the name and picture on a vault are chosen by whoever minted it; only the vault's on-chain record and its `level` attribute are authoritative, and the Bank's pages show those" — and make `level`'s reservation case-insensitive/trimmed if you keep caller attributes at all.

Option 1 costs nothing a buyer values and cannot be added after the lock; option 2 is acceptable only if Gary rules on it explicitly, because it is a new buyer-facing cost, not one already on the list.

### FINDING 4 — INFO. SPEC item 53 claims the rehearsal script proves "all five programs plus `bank/layout.mjs`" were patched; it proves four

`scripts/rehearsal-tree.sh`'s completeness assertion is:

```python
for need in ['programs/cbob-vaults/src/lib.rs', 'programs/cbob-vault-mint/src/lib.rs',
             'programs/cbob-vault-burn/src/lib.rs', 'programs/cbob-vault-gov/src/lib.rs',
             'bank/layout.mjs']:
```

The sweep helper's source carries no program id (it is native, with no `declare_id!`), so requiring it to be patched would be wrong — the script is right and the sentence is not. Round 25 D6 corrected the *map* claim ("the five program ids, the sweep helper's included, and the repo root path") and left the *proof* claim behind. One-line doc fix; I note it because item 53 is the only evidence that the rehearsal runs the shipped code.

### FINDING 5 — INFO. Limit 36's skip list is incomplete

`monthly_inline` also returns without crediting when the pool account is **frozen**, when it is not (yet) a classic token account, and when `total_active_weight == 0` with no current-epoch request. The first is stated under limit 28 and red-team 3 finding 1, the second under limit 52, the third under `distribute`'s prose — but limit 36 presents itself as the list of skip reasons and names four of seven. Costless to complete; worth completing because limit 36 is what a reader consults when a month looks missed.

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?**
Yes, one: the sweep helper's reach. SPEC's round-23-F1 entry and the program header both claim the helper "can move nothing" when called directly. It can move everything the *caller* owns, to anywhere, with amounts read at execution — Finding 1. No vault limit is worse than stated; limit 32's rolling-window arithmetic, limit 47's permanence, limit 46's hot-key consequences, limit 10's cap-×-windows bound, limit 26's best-of-many draws and limit 28's whole-redemption block are each accurate or understate the code's safety.

**2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?**
No. I specifically retested the three that looked like candidates: limit 35's "never binds" is arithmetically right (⌈0.51·⌈0.21S⌉⌉ ≥ 0.1071S > 0.10S); limit 29's "no instruction moves a non-cbBTC token out of the revenue address" is exactly true (`split_revenue` pins `payment_mint`, `sweep_sol_for_swap` moves lamports only); limit 27's dead-weight window is real and is not closed by anything in the current code (`claim` still does not read the asset). One *narrowing* the author may not have noticed and could record: the helper's closing of every account it empties makes BURN's `ReserveDelegated` check unreachable on the swept path (a delegate on a closed account is inert, arm 3.3a), so limit 44's delegate exposure is smaller than its phrasing suggests.

**3. Is any DISCHARGED item not actually discharged?**
No. I re-derived 30 (nothing writes `split_bps`, `bank_treasury`, `pool_ata` or `max_supply` after `initialize`), 14 (`DuplicateAttribute` really is refused — but see Finding 2 for the near-miss-key surface it does not cover, which was never item 14's subject), 19 (there is no activated-but-unlevelled state: `activate` requires `level ∈ 1..5` and the join path inherits it), 33 (both applies are exercised), 51 and 54. Round 33's three gate-5 obligations are discharged by `R33.G1/G2a/G2b/G3`.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?**
No. 22, 38, 50, 52 and 53 all still read as blocking, `launch/mainnet-init.json` still has `charter_opens_at` and `lock_deadline` null, and the holder guide is still marked DRAFT with item 50 forbidding publication. One thing to watch rather than a finding: the round-33 VALIDATION record's "rehearsal validation" is the patch-and-reverse proof only ("Nothing was built, deployed or sent at the throwaway IDs"), and the commit message reads "record round 33 build and rehearsal validation". Item 53 requires the **full `run-tests.sh` inside the rehearsal tree at the release commit**, which has not happened since `d57ee3a`. SPEC says so; do not let the commit titles accumulate into an impression that it has.

---

## Measurement limits of this pass

I took no validator window and sent no transaction. Every claim above is either (a) derived from the source in this bundle, with the arithmetic shown so it can be rechecked, or (b) attributed to a measurement someone else recorded. Specifically: I did **not** execute Finding 1's direct-call transaction, and that is the one thing that would settle it in one minute (it is four accounts, one data byte, an ordinary keypair, and no Core asset anywhere); I did not re-run round 33's heap probes; I did not run `audit-coverage.sh`, so Finding 3 rests on `Anchor.toml`'s reference to `./tsconfig.json` and on the suite's imports implying a tracked manifest — one `git ls-files` confirms or kills it; and I could not audit `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/crank.mjs`, `bank/revenue.mjs`, `bank/swap.mjs`, `bank/layout.mjs`, `bank/accrual.mjs` or `check-launch-params.mjs`, none of which are in this bundle, so every statement here about detectors, the crank, the swap or the launch checker is a reading of SPEC, not of code.

---

## Given that no human firm will ever see this and the programs will be immutable

Concrete things to do before the lock that AI audit **structurally cannot** do, in the order they bite:

1. **Run the two one-minute adversarial transactions, not the reasoning.** Finding 1 and Finding 2 are each settled by sending one transaction on the local validator (the helper called by a bare keypair; a mint with a lying name and uri). Thirty-three rounds of readers have produced ~1/3 wrong CRITICALs because reading is cheap and sending is not. Institutionalise the inverse: **no finding at MEDIUM or above is closed, in either direction, without a transaction signature or an exit code.** You already do this for refutations (gate 5); do it for confirmations.
2. **Hire the adversary you cannot simulate: a paid, scoped, time-boxed exploit bounty on a mainnet-fork deployment at throwaway ids, with the real ruled values, before the lock.** Not an audit — a bounty with money on the table and a published scope ("drain a vault, mint past the census, pass a key change under 50%, block all distributions, brick a redemption"). A model cannot be motivated by a payout and cannot discover what it did not think to look for; an attacker with a week and a prize can. Size it against the value at risk (2,100 vaults × 21,000 sats minimum), not against convenience.
3. **Independent reproducible builds by a second party.** `build-mainnet.sh` says plainly that the compiled `INIT_AUTHORITY` is NOT PROVEN and that the bridge is reproducibility — and nobody has ever rebuilt from a commit and compared the sha256s. Have one person who does not hold write access to this box rebuild all five programs from the release commit in a clean container, publish the hashes, and compare them with `dist/SHA256SUMS` *before* deploy. That is a human act of independence no model in this tree can perform, because every check here lives under the same user as the code it checks.
4. **Rehearse the deploy, including its failure modes, with the five program keypairs offline.** Round 33 L1 is the shape of the risk: the most sensitive step has a public prerequisite (five known addresses) and a recovery path that has been measured once, in a scratch file, by one reader. Rehearse at throwaway ids: pre-fund, fail, recover with Allocate/Assign/write-buffer/`DeployWithMaxDataLen`, deploy all five, `initialize` in order, create the three cbBTC accounts, fund the revenue PDA, verify bytes, **then** `set-upgrade-authority --final` on all five in one sitting with a second person reading the commands aloud. Write the sequence as a script that refuses to continue on any mismatch.
5. **Read back every `initialize` value from the chain and diff it against `launch/mainnet-init.json`, in the same session, before anything mints.** The checker validates JSON, not the signed transaction (item 38, round 24 A6). Build the four transactions *from* that file programmatically, then decode the on-chain configs with `bank/layout.mjs` and fail the launch on any difference. Two values are still null; do not let the charter date be typed by hand at the terminal.
6. **Decide the three ruling-shaped questions explicitly, in writing, before the freeze:** the helper's confinement (Finding 1 — code or documented?), minter-chosen name/uri (Finding 2 — code or disclosed?), and whether the Giraffish Moments key stays hot through the charter window (limit 46 is reaffirmed, but it is the single largest remaining exposure and the only one whose cost is "the project never starts"). A model can lay out the options; only the owner can take the decision, and after the lock there are no options left.
7. **Publish the honest list before you take money, and make it the same document the code is audited against.** The holder guide is the only artifact a buyer will read. Item 50 forbids publishing it until the surfaces exist; keep that, and add Findings 1 and 2 to the honest list if you choose disclosure over repair. The discipline that has made this tree good — every accepted cost written down, numbered, and re-checked each round — is also the thing that will protect you when something does go wrong, and it is worth nothing if the buyer never sees it.