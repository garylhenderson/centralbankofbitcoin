# Round 42 Independent Audit: programs, sweep helper, `web/`, and the evidence chain

**Verdict:**
- **Five programs:** no confirmed CRITICAL, HIGH, MEDIUM or LOW defect. I traced and recomputed every invariant the prompt names. Two gaps are unmeasured and should become suite arms (G-1, G-2).
- **`web/` and the off-chain pieces in this bundle:** one conditional LOW (W-1), two INFO (W-2, T-1) and one INFO proposal to re-word (D-1).
- **Measurement limits:**
  - I ran nothing. Every claim below names the run that would confirm or refute it.
  - The round-41 off-chain verdict is not in this bundle. Its claimed repairs C01, C02, C04 and C06 sit in `bank/` and `bank/redemption-poster.mjs` source I was not shown. I record them as **not independently verified here**, not as failed.

---

## R0. Round 41's verdict and its repairs

**V41-1, the config dust shape: the repair holds at every site in this bundle.**
- `reads.mjs` `anchorAccount` now applies `absentIfDust` before the owner check. A System-owned, 0-byte account returns `null`; any other foreign owner still throws.
- That one change covers four paths:
  - `readConfigs`, which every page uses;
  - `readVault`, for the vault record;
  - `readStep` for the seal, mint, burn and gov steps;
  - `readBuySnapshot`.
- `ceremony-reads.mjs` `resolveCollection` wraps the `SEAL_CFG` read in `absentIfDust`.
- `readStep('collection')` uses the same wrapper for its `mintDone` probe of `MINT_CFG`.
- **Control preserved:** an account owned by another program, or System-owned *with* data, is not dust, so it still yields `conflict` or a throw.
- **No regression for holder pages after launch:** the configs become program-owned and can never revert to System-owned, so the new branch is unreachable there.
- **Shape-sweep residue: none found.** These reads all go through `absentIfDust`:
  - the pool in `readRedemptionSnapshot`;
  - the receiving ATAs;
  - the `vaultWalletAccounts` by-address reads;
  - the `buy` cbBTC accounts;
  - the metadata generator's cbBTC read;
  - ceremony step 5.
- The remaining address-derived reads are of three kinds, and none can be dusted into a false refusal:
  - accounts that already exist by launch (mints, programs);
  - accounts that cannot be System-owned without a signature (an asset-signer PDA with data, an ATA with data: R34.G2, R36.G2a/b);
  - accounts that are fresh keypairs (discussed in G-1).

**R41.C8a-c, the rent rule.** The arms measure what SPEC item 50 now says:
- a 1-lamport credit to a fresh address is refused;
- a credit of exactly the floor lands;
- a credit of the floor minus one to an emptied vault wallet is refused.

The triage's request for "a sweep below rent to a nonexistent destination" cannot be built, for the reason VALIDATION gives. I agree with that substitution.

**Round 41's disproofs, re-tested from the code:**
- **C2 (buy page):** MINT has no `CloseAccount` on the revenue ATA, and step 5 creates it. Disproved.
- **C3 (wrong-program token account at an ATA address):** creating it needs the PDA's signature. Disproved.
- **C8 (rent):** now measured.
- **C11:** a classic-derived address cannot host a Token-2022 account. Disproved.
- **C15 and C16:** I checked against the arms; the disproofs hold.
- **C17 (pool dust):** reachable only before any vault exists. Disproved.

The remaining "already stated" rows match the SPEC text cited.

---

## R1. Custody

**The pairing holds.** Re-traced:
- **SEAL `open_for_redemption`:**
  - it uses top-level instructions only;
  - it scans forward from the current index for BURN plus `burn_vault`, with the asset at index 0 and the owner at index 2.
- **BURN `burn_vault`:**
  - it scans backwards over `0..current` for SEAL's open, with the same bindings;
  - it re-checks that the asset's owner is the signer.

**Shapes I tried, each refused by an existing rule or harmless:**
- **A transfer inside the thaw window** (open A, TransferV1 A to bob, burn A): BURN's live owner read fails with `NotTheOwner`. The thaw reverts.
- **A nested-vault open via Execute** (the outer asset-signer PDA "signs" SEAL open for an inner vault):
  - SEAL needs a later top-level `burn_vault` naming the PDA at index 2 as a signer, which a PDA cannot provide at top level;
  - BURN, reached by CPI, finds no top-level SEAL open (the top-level program is Core).
  - Refused (limit 43, WR.2 and WR.3).
- **Using the thawed asset-signer for something other than sweeping** (Approve, SetAuthority or a vote by a nested vault): every effect falls on the owner's own holdings. Nothing reaches another holder's value.
- **Emptiness proof:** reserve ATAs under both programs are required and declared. Their checks are:
  - owner equals the PDA;
  - no delegate, no delegated amount, no close authority;
  - length 165;
  - amount 0.
  - An account no token program owns is skipped, which is correct for the account the helper closes and for a dusted address.
  - The PDA's `lamports() == 0` is checked.
  - A declared Core `AssetV1` is refused.
- **Is there an account a stranger can create that blocks a redemption?**
  - A Token-2022 ATA for a classic reserve is refused by the ATA program (F4.2).
  - A non-ATA token account never sits at a reserve address.
  - A nested Core asset blocks only if it is declared.
  - **None blocks.**

---

## R1s. The sweep helper

**(a) Who can make it move value.** Only a signer of the asset-signer PDA can call it, which means only Core `ExecuteV1`. That route accepts the owner only on the pinned binary:
- SR.5 and SR.5a: a stranger and an owner-approved transfer delegate are refused 0x1a;
- SR.5c: the collection authority of a control asset is refused;
- SR.5b: the CBOB collection's authority is an off-curve PDA;
- R24.1a and R24.1c: no AgentIdentity adapter can be added.

Reached while the vault is frozen, `PermanentFreezeExecute` refuses with 0x9 (3.7).

**(b) The pair list:**

| Case | Result |
|---|---|
| Same source named twice | `IllegalOwner` on the second, already closed source (SR.12a and SR.12b) |
| Source equal to a destination | Impossible: the source must be owned by the signer, the destination by `dest`, and `signer != dest` |
| Destination named twice | Harmless: two transfers into one account |
| Native wSOL source | Transfer then close returns the wrapped lamports to `dest` |
| Frozen source with a balance | Reverts (SR.14); frozen and empty only closes |
| Source with a delegate | Irrelevant: the PDA is the authority |
| Close authority kept by a stranger | The close reverts the whole call (R36.C5) |
| Destination is another vault's PDA | Value goes into that vault, by the owner's own choice |
| Odd account count | Refused (SR.7) |
| Zero pairs | Lamports-only sweep (SR.13) |

**(c) Destination.** Safe given (a). A credit below rent to a nonexistent destination is refused for rent (R41.C8a). The owner pays the fee, so the owner always exists.

**(d) Lamport sweep.** Token closes credit `dest`, never the signer. No instruction the owner did not write can run between the sweep and the burn. Core `ExecuteV1` does not credit the asset-signer. BURN sees exactly zero.

**(e) BURN's skip.** It applies to a closed account and to a dusted one, and it is correct for both. The prior transaction creates the missing reserve ATAs with the owner as payer, and the helper closes them again, returning the rent to the owner. A stranger who dusts a missing reserve ATA address leaves it creatable (V40-1, e2e).

**(f) Fit.**
- S8.0: 1,061 bytes plus 148 for compute budget and a separate payer is 1,209 of 1,232.
- The in-line monthly run adds no account: the pool is already present.
- A fourth reserve is impossible by protocol.
- Each stray adds bytes. The planner drops strays until the transaction fits and names them.

**(g) Evidence.**
- The helper is byte-identical between the localnet and mainnet builds, and identical to the `target/deploy` file the suite deployed (`build-mainnet.sh`).
- SR.6 to SR.14 pin the exact program and error.

---

## R2 and R2b. The pool and the boost

**Invariant `pool ≥ ceil(owed)`: holds by construction.**
- **Credit:** `credit` adds `floor(avail·S/w)·w ≤ avail·S`, so `ceil(owed′) ≤ ceil(owed) + avail ≤ balance`.
- **Claim:** it subtracts exactly `pay·S` from `owed` and `pay` from the balance.
- **Retire:** it subtracts `pending ≥ 0`.
- **Reweigh, join and claim normalisation:** they preserve each vault's `weight·acc + carry − debt` (re-derived), so they cannot break the bound.
- **Nothing else can lower the pool.** It is a classic ATA owned by the config PDA, with no delegate and no close authority, and only `claim` signs for it.

**Counters:**
- `pending_this_epoch` is zeroed in exactly one place, `advance_epoch`.
- `retire` decrements it only when `request_epoch == dist_epoch`.
- `join` never touches it, which is correct because `join` requires `dist_epoch > request_epoch`.
- `total_active_weight` always equals the sum of live weights:
  - `join` adds the level weight;
  - `reweigh` applies the difference;
  - `retire` removes `weight_of`, including any live boost, before `unschedule_boost`.

**The boost gets exactly N distributions.**
- The only paths that advance the epoch while weight is non-zero are `credit` calls with `avail > 0`. `tick` requires `w == 0`, and a boosted vault is active.
- The end epoch is `e + N` with `N ≤ 63`, so its ring slot never collides with a live slot.
- A boost becomes due precisely at `e + N`.
- `BoostsExpireFirst` blocks distribution N+1.
- The host tests drive this through the program's own functions across four wraps.

**Liveness:** nobody can block distributions or redemptions for others.
- Every unblock is free and permissionless:
  - `JoinWaitingFirst` is cleared by a free join via `claim`;
  - due boosts are cleared by `expire_boosts`, which needs only records.
- `monthly_inline` never refuses its host except for a wrong pool address.

---

## R3. The level draw

- **SlotHashes parse:** fail-closed and bounded.
- **Window arithmetic:** C is at most `rs + 208`, below the 300-slot window.
- **FIFO:** order is enforced by `revealed_total`.
- **Burned vault at the head:** the vault still draws and the Core write is skipped (L.11).
- **Attribute re-supply:** hash-checked.
- **Re-check of SPEC 26:**
  - a choice of mint slot inside a leader group moves A only within its group, so B's and C's target groups (`(A/4+2)·4`) do not move;
  - the mint leader therefore gets no choice beyond what SPEC 26 already gives C's leader.
- **SPEC 26 is not worse than stated.** HOLDER-GUIDE ("can pick among several results … one choice affects every vault created in that moment") matches it.

## R4. Governance

**Offsets re-derived:** `charter_closes_at` 442, the sweep bounds 257/266/274 and 631/639/647, the boost bounds 711/712, and the stops 191/192/518/526.

**Execution:**
- Execution is all-or-nothing.
- Skips are logged.
- The per-kind marks advance even on `round_already_over`.

**Supermajority and limits:**
- I found no path for a minority beyond limits 46 and 47 and SPEC road item 4.
- Nothing a vote can reach touches a vault, the split, the destinations or the supply.
- **Proposal spam:** possible, at the proposer's rent, but it blocks nothing. Execution is by id and per kind.

## R5. The charter claim

Checked:
- the Merkle leaf and node tags;
- sorted pairs;
- that promotion matches between JS and Rust;
- that a proof must start at `merkle_leaf(pob)`;
- that pass-through accounts are never signers.

**SPEC 46 is complete as far as I can determine.**

## R6. The one-time configuration

Every `initialize` bound was read. What is accepted-but-wrong is already listed in item 38 / A6: SEAL takes any collection key, and the window is 10 s to 24 h.

**The royalty plugin cannot be changed:**
- its authority is None (R.6, R.6a, R33.G3);
- an owner cannot add an asset-level royalty (R.8);
- no program of ours issues a plugin update on the collection after `initialize`.

**Rate limit:** an exact k-th-most-recent rolling window over a 64-entry ring, clamped stricter above 64.

## R7. Cross-program raw reads

All recomputed from the structs:
- `MintConfig`: 1,005 bytes plus 256 padding;
- `VaultRecord`: 221;
- `BurnConfig`: `burned_total` at 42 and the ring at 59;
- SEAL reserves at 41;
- `Proposal` space 267, with a largest action of 37;
- the helper's offsets 0, 32, 64 and 165.

**No discrepancy.**

---

## Findings

### G-1. INFO / gate-5 arm, unmeasured: a mint or claim whose new asset address a stranger pre-funded

- **Construct:**
  - `create_vault` in MINT `mint_vault` and `claim_charter_vault`, where Core `CreateV2` creates the asset account;
  - `web/src/lib/plan-ceremony.mjs` step 0, where Core `CreateCollectionV2` creates the collection.
- **What is and is not measured:**
  - R31.W2b measures a pre-funded vault record and reserve ATA;
  - R31.W2a measures a pre-funded config;
  - nothing measures a pre-funded **asset** address or collection address.
- **Who could do it:** the asset address is a fresh keypair, but it is visible in the transaction once that transaction is forwarded. So a leader, or any observer able to front-run, could land a System transfer to it first.
- **What I expect:**
  - I expect Core to use mpl-utils' `create_or_allocate_account_raw`, which tops up, allocates and assigns an already-funded account, so the mint lands.
  - If Core instead uses a plain `create_account`, a front-runner could make individual charter claims fail for the cost of a fee per attempt.
  - It would be bounded: every retry uses a new keypair, and only a leader-level actor can reliably front-run.
  - The page would mislabel nothing; it would show the program error.
- **Evidence that would exist if I am wrong:** in the suite, `SystemProgram.transfer` to `kp.publicKey`, then `ixMint`/`ixClaim` with `kp`, refused with system 0x0 "already in use".
- **Fix:** none if the arm lands. Add it (R42.G1) beside R31.W2b, for both a paid mint and a charter claim, and also for `CreateCollectionV2`.

### G-2. INFO / gate-5 arm: the Core plugin and execute behaviour SR.5 rests on

This is the same class as limit 40. No action beyond the existing alarm. I list it only because SR.5 to SR.5e and R24.1 are the entire access control of the helper, and they rest on a binary Metaplex can replace.

**Recommendation:** re-run SR.5 to SR.5e and R24.1a/c in the step-9 to step-11 sequence against the then-current mainnet Core dump, not only the pinned one. Also re-pin the Core hash at that moment.

### W-1. LOW (conditional on deployment): RPC proxy rate limits key on the CDN edge, not the visitor

- **Construct:**
  - `web/deploy/nginx-rpc.conf`: `limit_req_zone $binary_remote_addr` and `proxy_set_header X-Real-IP $remote_addr`;
  - `web/deploy/rpc-proxy.mjs` `handler`, which trusts `X-Real-IP` from loopback and keys `limiter` on it.
- **The problem:** `web/deploy/ceremony-local.mjs` describes the public site as sitting behind Cloudflare. Neither file configures `set_real_ip_from` / `real_ip_header CF-Connecting-IP`. Behind a CDN, `$remote_addr` is the edge IP.
- **Consequence:** every holder routed through one edge shares a single bucket in both nginx and the proxy:
  - 10 requests/s with a burst of 60 at nginx;
  - 1/s with a burst of 5 for `sendTransaction`.
- **Attack:** one client sending allow-listed `getSlot` at about 10/s through a given point of presence denies the redeem, claim and buy pages to everyone else on that edge.
- **Impact:** no value moves, and holders can use any other client. But for the duration of the flood it defeats the "a stranger cannot block an opening" promise for page users.
- **Evidence:** behind the CDN, two clients on the same point of presence see each other's 429s, and nginx logs show only edge IPs.
- **Fix:**
  - restore the real client address: `real_ip` with the CDN's published ranges and `CF-Connecting-IP`;
  - or key the limits on that header only when the request arrives from a CDN range.
- **Applicability:** if the site is not behind a proxy, this does not apply. README step 4 ("Check") should then state that assumption.

### W-2. INFO: `ceremony-local.mjs` robustness

- **Crash:** `staticFile` calls `decodeURIComponent` unguarded. A request for `/%E0` throws `URIError` inside the request listener and terminates the process. That stops the ceremony server mid-session.
- **Rate limits:** local mode reuses `handler`, which trusts `X-Real-IP` from loopback. Any tunnel client can therefore set its own rate-limit key.
- **Reach:** both are reachable only through Gary's SSH tunnel.
- **Fix:** wrap the decode in `try/catch` and return 400; pass a handler option that ignores `X-Real-IP` in local mode.

### T-1. INFO: arms 10.6a and 10.6b can pass for a wrong reason

- **Construct:** `tests/3prog.test.ts` 10.6a `String(dflt.ok===(wide.cu<=200_000))` and 10.6b `one1d.ok===(one1.cu<=200_000)`.
- **The problem:** when the measured cost is above 200,000, any failure of the default-budget simulation satisfies the equality, including a blockhash, account or signature failure.
- **Fix:** when `!dflt.ok`, also require the logs to contain `exceeded CUs meter` (or `ComputationalBudgetExceeded`). The page rule in SPEC 54 depends on this arm.

### D-1. INFO, documentation exception candidate: limit 32 and DESIGN section 8 use "live" in two senses

- **The inconsistency:**
  - HOLDER-GUIDE says the cap is "2.1% of the vaults still sealed".
  - The program counts unretired bare burns as live (limit 32, round 24 D8).
- **Misstated money or rights?** None: the difference is at most one, for under an hour.
- **Fix:** a one-clause qualifier in the guide.

---

## The accepted limits: the four questions

1. **Is any limit worse than stated?** None found.
   - **26:** checked against mint-slot choice; no additional choice.
   - **27:** stated as falling on other holders; matches the code (`claim` has no liveness check).
   - **28:** a frozen vault ATA with a zero balance cannot occur for an active vault, because the balance only rises from at least 21,000.
   - **10:** the throughput figure (about 34 SOL a day) is consistent with an hourly job against a 6-hour cooldown stamped at landing.
   - **G-1** is the one place where, if the expectation is wrong, an exposure would exist that no limit states. Hence the arm.
2. **Is anything listed as a limit not actually a limit?**
   - **9** is narrower than its title for CBOB vaults (rescued, item 58), and it already says so.
   - **44's** "frozen stray holding zero is only closed" relies on SPL classic `CloseAccount` not checking freeze state, which round 30 measured. I did not re-measure it.
3. **Is any DISCHARGED item not actually discharged?**
   - **54:** sound only together with the requirement carried into item 50. T-1 weakens its evidence slightly.
   - **33** and the rest: sound.
4. **Is any OPEN AND BLOCKING item quietly treated as accepted?**
   - **53:** `scripts/rehearsal-tree.sh` still does not cover `web/`, whose `config.js` hard-codes the mainnet ids. Round 41 C6 records this as stated. It must not become de facto accepted: the rehearsal's item 22.1 to 22.4 cannot exercise the pages until the `rehearsal` profile is filled.
   - **22:** the revenue cycle is still untested by any gate.
   - **38:** three values are still OPEN.
   - **50:** the pages are still staged.
   - **52:** still open.
   - All remain correctly OPEN.

---

## What this project should do before launch that an AI audit cannot

1. **An independent reproducible build on a second machine and toolchain install.** Someone other than this box builds `RELEASE_COMMIT`. Their sha256 of all five `.so` files must equal `dist/SHA256SUMS` before step 9's upgrade. This is the only bridge between "the source names Gary's key" and the bytes that ship.
2. **Hardware custody for the launch-day keys.**
   - Sign the ceremony with Gary's wallet on a hardware signer.
   - Before road step 10, hold the Proof of Burn collection authority cold, or in a Squads, for the 7-day window. This is the one ruled exposure (limit 46) that is cheap to close for exactly the window it matters, and closing it does not require reversing the ruling afterwards.
3. **A funded mainnet canary between step 10 and step 11.** Use real Phantom, the real proxy behind the real CDN (W-1), and two or three charter-equivalent vaults on the rehearsal ids. Run the full life: claim, draw, activate, payout, a stranger's dust, opening, and rescue to the real Squads with a human returning it.
4. **A paid bug bounty with the upgrade authority still held**, announced for a fixed period before step 11, with the step-11 date public. Humans with adversarial incentives are the one population these rounds have never sampled.
5. **An incident drill.** Rehearse with a timer:
   - the guardian pulling both stops from a phone;
   - a Coinbase-freeze page on the pool;
   - `program_not_locked`;
   - a Core upgrade detected by the alarm.

   Record how long each takes. Limits 10, 28, 40 and 47 are bounded only by human reaction time, which no audit measures.
6. **Re-run SR.5, SR.5a-e and R24.1a/c (G-2) and the G-1 arm against a fresh mainnet Core dump on the day of step 11.** Then lock.