# Independent audit — CBOB v6, round 38 (programs + `web/`)

Audited tree: the bundle as given (claimed `45271f9`, programs unchanged from `0ae07d2` + round‑37 repairs). Read‑only. I ran no validator, no network job and no money job; everything below is either a reading of the bundled source with the exact lines named, or arithmetic I redid by hand. Where I could not measure, I say so.

**Headline: one HIGH, one LOW, several INFO. Nothing I found moves value out of a vault, the pool or the revenue address, and I could not break the seal, the open↔burn pairing, the emptiness proof, the pool invariant, the rate limit or the governance thresholds. The HIGH is a surviving instance of exactly the promise rounds 36 (H1) and 37 (V1) were repaired to keep: *a stranger cannot block an opening*. It is still blockable, now for about one transaction fee per attempt.**

---

# R0. Round 37's verdict and its repairs

## What I verified

**V1 repair (bounded reads) — holds, at its site.** `web/src/lib/reads.mjs` `vaultWalletAccounts` now (a) reads the three reserve ATAs **by address** through `accounts()`, so no listing failure can hide them; (b) lists everything else as balance‑slices (`dataSlice {64,8}`, `dataSize 165`) or address‑only (`{0,0}`); (c) catches the listing failure and returns `{ tokens, incomplete }` instead of throwing. `coreAssetsOwnedBy` likewise never throws (`return unlisted` on both failure paths). `planRedemption` turns `strayReadIncomplete` / `nftReadIncomplete` into acknowledgements, never refusals. The proxy shapes `token-owner-amounts`, `token22-owner-amounts`, `token22-owner` exist in `gpaShape` and are pinned by `proxy.test.mjs` from captured real requests. I re‑derived the economics: at ~230 bytes/account for the balance slice and ~200 for addresses, the 8 MB cap is reached at ~35 000 / ~40 000 accounts, i.e. 71–82 SOL of parked rent, and the outcome is one tick‑box, not a refusal. **No regression. The repair closes the *volume* half.**

**V2 repair (decoy collection) — holds, with one residue (INFO‑6 below).** `resolveCollection` now prefers any pin (config.js, SEAL, `launch/mainnet-init.json`, `localStorage`, this session) and only consults `collectionCreator` when there is no pin; a decoy becomes an `ignored` warning, never a STOP. `ceremony.mjs` remembers the new address **before** signing step 0 (`remember(...)` precedes `signExact`, verified by line order and by `ceremony.test.mjs`'s source assertion), and refuses step 0 when the chain scan cannot run.

**V3 repair (frozen cbBTC can activate) — holds and is correct.** `planActivate` (`plan-vault.mjs:70–79`) now builds the request with a note. I confirmed the program behaviour it now states: `activate` reads the balance and discards the state — `let (amount, _) = read_token(...)` (MINT `lib.rs`), and `read_token` checks only owner‑program, length 165, mint and owner. So a frozen account *does* activate. The page text matches.

**Round 36 repairs re‑checked at their sites:** H1 (ack‑not‑refuse, freezable‑mint rule, `dropStrays` fallback), L1 (proxy `txRefusal` requires a CBOB program or one of three named shapes), L2 (`planPayout` expires due boosts first, then joins, then distributes), L4 (`build.mjs` binds `dist/MANIFEST.txt` to `RELEASE_COMMIT` and both sums and lengths to `config.js`), C5/R36.C5 (the helper never carries a kept‑close‑authority account; a plain `Transfer` through Core Execute does, and the empty account is left undeclared). All present, none regressed.

**Round 37's disproved claims I re‑tested and agree are disproved:** W1 (the default budget is per non‑builtin instruction; the four‑instruction redemption has 800 000 CU), W3 (`expire_boosts` reverting on a junk record is caller‑chosen and fails closed), W8 (`BadSweepBound`'s message spans two bounds; only `INIT_AUTHORITY` can reach it), W10 (`classifyPdaTokenAccount` returns `null` for a 165‑byte zero‑balance account, so it gets no box). I did not re‑file any of them.

## F1 (HIGH) — the redeem page's acknowledgement gate can be reset indefinitely by a stranger, so a holder can be kept from opening their vault through the only sanctioned client

**Construct.** `web/src/pages/redeem.mjs`, the `action(plan.prior.length ? 'Set up, then open' : 'Open this vault', ...)` handler, together with `web/src/lib/plan-redeem.mjs` `planRedemption` (the `ack` ids) and `groupAcks`.

On every press, the page re‑plans from fresh chain state and then:

```js
const newAcks = fresh.plan.ack.filter(a => !boxes.has(a.id))
if (newAcks.length) {
  newAcks.forEach(addAck)
  steps.append(box('warn', 'Something new arrived in the vault since it was checked ... press the button again. Nothing was opened.'))
  return
}
```

Every acknowledgement id is keyed to an **address** or to a **count/digest**:

* `lost:${address}`, `left:${address}`, `asset:${address}`, `cnft:${address}`
* `group:${many.length}:${fnv(ids.join(','))}` (`groupAcks`, >20 items)
* `unlisted:${inc.unexamined}` and `nfts:${ninc.unexamined}`

So **any new thing a stranger puts at the deposit address produces an id the `boxes` map has never seen, and the press is converted into "tick again"** — and then they do it again. There is no "proceed anyway", no retry cap, and the loop is identical after a reload (`check()` re‑plans from scratch).

**What an attacker gains.** The holder cannot complete an opening on the page for as long as the attacker keeps landing one new item per press. The vault and its contents are never at risk — the on‑chain redemption moves live balances and destroys nothing it was not shown — so this is liveness, not loss. But it is exactly the thing SPEC, the README and the holder guide say cannot happen:

* SPEC “Known limits”, round‑35 C5 entry: *“so no stranger can block an opening (round 37 V1: not by volume either…)”*
* SPEC item 50 / `web/README.md:79`: *“A stranger cannot block an opening”*, *“nothing a stranger can put at a deposit address refuses an opening, at any volume”*
* `HOLDER-GUIDE.md`: *“Someone could send a tiny amount into your vault while you are opening it. **On the redeem page that cannot block the opening.**”*
* the page's own invariant comment (`plan-redeem.mjs:118–121`): *“NOTHING here may block an opening.”*

**Cost per reset, by vector (this is where the severity lives).**

| vector | what the page does | attacker's cost per reset |
|---|---|---|
| **compressed NFT minted to the deposit address** | `coreAssetsOwnedBy` returns it in `compressed`; `planRedemption` pushes `cnft:${address}` | **~1 transaction fee (~5 000 lamports)**, no rent, after a one‑off Bubblegum tree |
| 170‑byte Token‑2022 ATA, empty | `cannot.push` → `lost:${address}` | ~0.00207 SOL rent, **unrecoverable** (an ATA has no close authority but the PDA) |
| classic account funded with 1 unit of a freezable mint | `undeliverable()` → `lost:${address}` | ~0.00204 SOL rent, **unrecoverable** (close needs a zero balance, and only the PDA can transfer out) |
| foreign Core NFT | `asset:${address}` | ~0.0023 SOL rent, unrecoverable |
| one more account past the 200‑account cap | `unlisted:${count}` id changes | ~0.002 SOL rent |

The compressed‑NFT variant is the one that matters: **a vault's whole redemption can be held shut for about a tenth of a cent per attempt.** Round 36 graded the identical effect (a stranger blocking an opening for pennies) **HIGH**; round 37 graded a *permanent* block costing ~28 SOL of recoverable rent **LOW**. On that calibration this is HIGH.

**Why the H1 and V1 repairs do not cover it.** Both were about *the plan*: H1 made the plan name‑and‑tick instead of refuse; V1 made the *reads* bounded. Neither touched the page's *consent model*, which is per‑address and therefore resettable by any new address. The arrival the page is defending against is also the one it cannot prevent, because the protocol deliberately lets anyone deposit.

**Evidence that would exist if I am right.**
1. Offline: call `planRedemption` on a snapshot, then again with one extra `{ address, compressed: true }` in `s.compressed`; the second call's `ack` ids contain a `cnft:` id the first did not. Then read `redeem.mjs`: the handler `return`s on `newAcks.length` before `buildTx`.
2. Against the mock (`web/test/mock-rpc.mjs`): add one new 170‑byte Token‑2022 account at `PDA` between two presses; `/report` shows `redemption: null` and the page prints “Something new arrived…” on both presses.
3. On a local validator (`web/test/e2e-localnet.sh`): a loop that creates one funded freezable‑mint account at the deposit address every 3 seconds while the e2e drives the page handler; the opening never sends.

**What would falsify the HIGH grade, specifically:** if DAS does **not** index compressed NFTs owned by an off‑curve asset‑signer PDA, or if the proxy's `getAssetsByOwner` shape cannot reach them, the cheap vector collapses and the cost per reset becomes ~0.002 SOL of permanently burned rent (≈35 SOL/day to hold a vault shut indefinitely, ≈1 SOL to ruin one session). **I did not measure cNFT indexing or minting cost in this pass.** Measure it before grading down — it is a 20‑minute DAS query.

**Fix (page only; no program change).** Acknowledge the **class**, not the address, and never re‑demand consent for an arrival of a class already consented to:

* One checkbox per category, with a count and an explicit forward‑looking clause: *“N things in this vault other than cbBTC, $GARY and $GIRAFFISH will be lost when it is opened, **including anything that arrives before the opening lands**.”* Keep the itemised list as information, not as consent.
* In the re‑plan before signing, only the **refusal** list may stop the send. New `ack` items must be rendered as information, not as a new gate.
* Drop counts and digests from any consent key (`unlisted:*`, `nfts:*`, `group:*` → one stable id per category).
* Amend `web/README.md:79, 285–287`, SPEC's C5 entry and item 50, and the holder‑guide sentence, so the claim matches: *nothing a stranger deposits refuses or delays an opening, and anything they deposit is covered by the acknowledgement you already gave.*

**Gate 5 arms this needs:** an offline arm asserting that a *new* ack‑generating arrival after consent does **not** produce a new gate; an e2e arm with an adversary loop landing one new item between presses, asserting the opening lands; and the cNFT measurement above recorded as a number.

## F2 (LOW) — SPEC item 53 and `scripts/rehearsal-tree.sh` do not cover `web/`, which now holds five more copies of the mainnet program ids and the launch identities

**Construct.** `scripts/rehearsal-tree.sh` patches only `git ls-files -- programs bank scripts tests sim launch Anchor.toml`. The python then (a) asserts the reverse map recreates HEAD **for that set only**, (b) refuses a leftover 4‑char id prefix **in that set only**, and (c) requires the four keyed programs plus `bank/layout.mjs` to have been patched.

Since round 35, `web/` holds the mainnet ids and identities in plain text:

* `web/src/config.js`: `MAINNET_PROGRAMS` (all five ids), `initAuthority`, `squads`, `garyMint`, `MAINNET_PROGRAM_BYTES` (the audited sha256s and lengths), `RELEASE_COMMIT`.
* `web/deploy/rpc-proxy.mjs`: `MINT`, `CORE`, `TOKEN`, `TOKEN_2022`, `TX_PROGRAMS` and `CBOB_PROGRAMS` (all five ids).
* `web/test/*` and `web/src/generated/*` carry the launch values and the PoB set.

**What this costs.** (1) Road step 8's dress rehearsal cannot exercise the holder pages or the launch ceremony at throwaway ids, which are precisely the surfaces that build the transactions Gary signs for the one‑time `initialize`. (2) SPEC item 53's file list — an OPEN AND BLOCKING item — is stale and no longer enumerates every place the ids live, so a reader checking “the ids are the whole patch” gets a true statement about an incomplete set. The containment today is accidental but real: the `rehearsal` profile has `programs: { seal: null, … }`, so `makeIds` throws and every page refuses — i.e. the rehearsal cannot *accidentally* drive mainnet, but it also cannot be rehearsed at all.

**Evidence if I am right.** `grep -l 'Gsb7AGhK' web/ -r` returns `web/src/config.js` and `web/deploy/rpc-proxy.mjs` (plus tests); `git ls-files -- programs bank scripts tests sim launch Anchor.toml | grep '^web/'` returns nothing; a rehearsal tree built at HEAD still contains `Gsb7AGhK…` under `web/`.

**Fix.** Either add `web` to the patched set and to the reverse‑map proof (and add `web/src/config.js` and `web/deploy/rpc-proxy.mjs` to the `need` list), **or** write into SPEC item 53 that the holder pages and the ceremony are explicitly **out of scope** for the dress rehearsal and name what therefore goes unexercised. The first is better: the ceremony page is the thing that writes the permanent values.

---

# R1. Custody — can anyone but the owner get value out, or an emptied vault survive?

**No, on every path I could construct.** What I checked, with the reasoning rather than a citation of the suite:

* **The seal.** `set_frozen` is the only writer of `PermanentFreezeExecute`, it is called only from `open_for_redemption`, and that refuses without a matching top‑level `burn_vault` later in the same transaction (`NoTerminalBurn`). Core's `ExecuteV1` is refused while the plugin is frozen.
* **The pairing.** Both halves bind asset **and** owner by *position* (SEAL `BURN_IX_ASSET_IDX 0` / `BURN_IX_OWNER_IDX 2`; BURN `SEAL_IX_ASSET_IDX 0` / `SEAL_IX_OWNER_IDX 2`), and both use `load_instruction_at_checked`, which sees **top‑level only**. A wrapper therefore cannot satisfy either half: the wrapped instruction's own index resolves to the *outer* instruction, so the match needs a genuine top‑level counterpart, and that counterpart's own program enforces the other half.
* **Two vaults in one transaction.** SEAL's forward walk and BURN's backward walk both match on the asset *and* the owner, so A's open cannot be spent by B's burn. (At the ruled supply the rate limit refuses the second anyway.)
* **Failure direction.** A top‑level `burn_vault` that fails aborts the transaction, so the thaw reverts with it. There is no construction where the thaw survives: SEAL's requirement is satisfied by the *presence* of the instruction, but its *absence of success* always reverts. An emptied, live vault is unreachable.
* **`retire_redeemed`.** Three independent locks: stack height exactly `TRANSACTION_LEVEL_STACK_HEIGHT + 1`; the **current top‑level** instruction is BURN's `burn_vault` with the right discriminator; and `ix.accounts[0]` is this asset. BURN's only CPIs are Core `BurnV1` and this, so no deeper path exists.
* **Emptiness proof.** `asset_signer.lamports() == 0`; for each reserve mint × both token programs the canonical ATA must be *declared* (`ReserveNotDeclared`), and if a token program owns it: PDA‑owned, `delegate == None`, `delegated_amount == 0`, `close_authority == None`, `len == 165` (so no Token‑2022 extensions), `amount == 0`. The second loop re‑applies all six checks to every declared account the PDA owns and refuses any declared live Core asset.
* **The closed‑account question (prompt (e)).** After SPL‑Token `CloseAccount`, `delete_account` **assigns the account to the System program and reallocs to 0**. So inside the same transaction the declared reserve ATA is System‑owned with zero data and zero lamports: the reserve loop skips it at `if acc.owner != SPL_TOKEN && != TOKEN_2022 { continue }`, and the second loop skips it at `if acc.lamports() == 0`. The address is still in `remaining_accounts`, so `ReserveNotDeclared` is still satisfied. **That is the right reason** — not an accident of the amount check.
* **Nothing a stranger can create makes BURN refuse.** A Token‑2022 ATA for a classic mint cannot be created (measured, F4.2). A delegate or a close authority on the vault's ATA both require the account's owner (the PDA) to sign — `SetAuthority(CloseAccount)` validates against `close_authority.unwrap_or(owner)`, which is the PDA. Freezing a reserve account needs the mint's freeze authority ($GARY and $GIRAFFISH have none; cbBTC's is Coinbase — limit 28). Nested Core assets only refuse if **declared**, and the page never declares them. Lamports are swept live and nothing can be inserted between the sweep and the burn inside one transaction.

**Unexercised negatives worth an arm (gate 5):** a lamport deposit instruction placed *between* the helper's Execute and `burn_vault` in the same transaction, asserting `VaultNotEmpty`; a declared reserve ATA that **does not exist** when the helper is called (the helper refuses `IllegalOwner`, so the whole opening reverts — SPEC's prior‑transaction rule is load‑bearing and untested in that direction).

---

# R1s. The sweep helper

I read `programs/cbob-vault-sweep/src/lib.rs` line by line against the prompt's (a)–(g).

**(a) Access control.** Direct call needs `accounts[0].is_signer`, i.e. the asset‑signer PDA, which only Core can produce. Core approves `ExecuteV1` only for the asset's **owner** (SR.5, SR.5a measure a stranger and an owner‑added transfer delegate both refused 0x1a). It cannot be reached while frozen — Core's seal rejects Execute before the helper runs. SEAL's PDA has no Execute path. The collection authority is MINT's off‑curve PDA with no Execute CPI. The one route that could widen this is Core's `AgentIdentity` adapter, which an owner cannot add (R24.1a) — SPEC limit 40 states it.

**(b) The pair list.** I walked every combination:

| shape | outcome | why |
|---|---|---|
| same source twice | **refused**, `IllegalOwner` | the first pair closes it; the second `read_token` sees a System‑owned account |
| destination twice | allowed | both transfers land in it |
| a source that is also a destination | **refused** | a source must be owned by `signer`, a destination by `dest`, and `signer != dest` |
| `src == to` | **refused** | same reason |
| native wSOL source | allowed and safe | destination must be the same mint, so also wSOL; the close sends rent + remainder to `dest` |
| source with a delegate | allowed | the helper transfers as the *owner*, and the account is closed, so BURN never sees the delegate |
| source with a **foreign close authority** | **refuses the whole call** | `CloseAccount` needs that authority — this is round‑35 C5, correctly documented, and R36.C5 pins it |
| frozen source | **refuses the whole call** | SPL‑Token 0x11; nothing moves |
| destination not an ATA | allowed | only owner + mint are checked, which is the right rule |
| `dest == signer` | **refused**, `InvalidArgument` | explicit |
| `dest` = *another* vault's asset‑signer PDA | **allowed** | owner‑only; the holder's own choice, as in v5 limit 5 |
| odd account count / zero pairs | refused / lamports‑only | `(len-4) % 2`; SR.13 |

**(c) Destinations.** Safe *given* (a): the only party who can make the helper run is the asset's owner, and where their own property goes has always been theirs to choose. The lamport credit to a 0‑data account below rent exemption is accepted by the runtime in practice; SPEC item 50's stricter claim is conservative, not wrong in the dangerous direction, so I am not filing it.

**(d) The lamport sweep.** `signer.lamports()` is read at execution, and nothing inside the transaction can refill it afterwards (Core's `ExecuteV1` returns without crediting the PDA; SR.4a measures the exact delta). BURN then reads the same account in the same transaction and sees zero. A cross‑transaction deposit cannot interleave.

**(e) BURN interaction.** Covered under R1 above. The one real residue is the account the page **cannot name** because the listing failed — which is F1's other face and is disclosed as a tick‑box.

**(f) Does it fit?** S8.0's 1 061 bytes is the owner‑as‑payer, three‑reserve, claim‑included shape with no compute‑budget instructions. SPEC's accounting (+52 for both compute‑budget instructions, +96 for a separate payer → ~1 209 of 1 232) is arithmetically right. The page's real shape is wider than S8.0 in one way S8.0 does not model: **each C5 `Transfer` is a whole extra Core `ExecuteV1`**. `planRedemption` handles that by dropping pairs until it fits and naming what it dropped, and the e2e measures the largest C5 shape (4 offered, 180 852 CU per round‑37 VALIDATION). A fourth reserve is impossible by construction (`MAX_RESERVE_MINTS = 3`, written once). The in‑line monthly run adds no accounts; a redemption carries no crank.

**(g) Evidence quality.** SR.6–SR.14 pin each refusal to the exact `ProgramError` the helper (not Token, not Core) produced, and SR.12b is a good instrument: it asserts the duplicate‑source refusal came from the *second* pair's `read_token`, not from the first pair's source‑owner guard. `build-mainnet.sh` proves the helper's mainnet bytes are byte‑identical to the localnet build **and** to `target/deploy/cbob_vault_sweep.so`, which is the file `run-tests.sh` and `run-sim.sh` deploy — that is the chain the prompt asks for, and the crate's deliberate absence of a `localnet` feature (which would change the metadata hash) is what makes it possible.

---

# R2. The community pool

**I prove the invariant "the pool always holds at least `ceil(owed)`".** Every write to `owed_scaled` and `acc_scaled`:

* `credit`: `delta = avail·S/w` (floor), `acc += delta`, `owed += delta·w ≤ avail·S`. Called only with `avail = balance − ceil(owed)` (explicit, `distribute`) or `balance.saturating_sub(ceil(owed))` (`monthly_inline`). So `ceil(owed')` ≤ `ceil(owed) + avail` ≤ `balance`.
* `claim`: pays `pay` whole sats and subtracts exactly `pay·S`. Balance and `ceil(owed)` fall by the same integer.
* `join`: `debt = w·acc`, `carry = 0` ⇒ the new vault is owed 0; `owed_scaled` untouched.
* `reweigh` (boost, expiry, claim normalisation): `carry = owed_before`, `debt = w_after·acc` ⇒ `w_after·acc + carry − debt = owed_before`. **Nothing earned is gained or lost**, and `owed_scaled` is not touched.
* `retire`: subtracts exactly this vault's `pending`, sets `debt = w·acc`, `carry = 0` ⇒ 0.

And the balance can only *rise* except through `claim`. Therefore `balance ≥ ceil(owed)` is inductive, and `owed_scaled == Σ owed_of(r)` over live records is inductive too (each writer moves both sides identically). The suite's `ledger()`/`BK.*` arms check exactly this after every money operation, and they can fail (`ck()` only pushes a label when `ledger()` returned true).

**Counters.** `pending_count` and `pending_this_epoch` are incremented together by `activate`'s first call. `advance_epoch` zeroes `pending_this_epoch`. `retire` decrements both when `request_epoch == dist_epoch`, else only `pending_count`. `join` decrements only `pending_count`, and requires `dist_epoch > request_epoch`, which is exactly the set `pending_this_epoch` does *not* count. So `pending_this_epoch ≤ pending_count` always, and `waiting_to_join`'s `checked_sub` cannot underflow. Under every ordering of `activate` / `distribute` / `claim` / `retire_redeemed` / `retire_burned` I tried, the pair stayed consistent. (F21.1/F21.2 land the two retire‑while‑waiting cases.)

**Liveness.** Nobody can make distributions or redemptions impossible for others:

* `boosts_due > 0` is cleared by `expire_boosts`, which is permissionless and **needs only the vault records — no token account**. So a vault whose cbBTC account is gone (impossible while sealed, but defensively) cannot wedge the gate. Correct answer to the prompt's question.
* `JoinWaitingFirst` is cleared by any `claim` naming the waiting vault — free and permissionless. A stranger *can* create waiting requests (`activate` is permissionless) but only for funded, revealed, live vaults, once each, and joining them benefits them.
* `PoolShort` cannot arise: only `claim` moves tokens out, and it always reduces `owed` by the same amount.
* `distribute` reads the pool as a token account **first**, so before the pool ATA exists every explicit `distribute` refuses — including the free launch tick (round 24 D8, correctly stated). `monthly_inline` degrades gracefully instead. Item 52 covers it.
* `WrongPool` in `monthly_inline` is the only refusal it imposes on its host — correct, since a junk pool account would otherwise let any caller suppress the monthly run.

**Round 24 W11 / SPEC's weaker wording.** I attacked SPEC's statement, not the stronger one. SPEC says a vault "is never credited by a distribution that ran BEFORE it joined", and that revenue already in the pool when it joins is shared at the next distribution. Both are exactly what the code does: `join` sets `debt = w·acc` at the accumulator as it then stands, so no prior `credit` reaches it, and the *next* `credit` divides `balance − ceil(owed)` over the new denominator. The remaining edge — unsplit revenue in the revenue address — is limit 55 and is correctly costed (100 $GARY at the monthly boundary, 200 otherwise).

---

# R2b. The $CBOB boost

**A boost earns exactly N distributions, and the ring is sound past epoch 64.** The argument:

* `boost_vault` sets `end = dist_epoch + epochs` with `1 ≤ epochs ≤ max_boost_epochs ≤ MAX_BOOST_EPOCHS_BOUND = BOOST_RING − 1 = 63`, and increments `boost_expiring[end % 64]`.
* `advance_epoch` increments `dist_epoch` *then* drains `boost_expiring[dist_epoch % 64]` into `boosts_due`.
* So a boost bought at `e` is drained exactly at the advance to `e + N`, having been credited by the advances to `e+1 … e+N`. That is N distributions, not N+1 (BO.21 and BO.35 land both orderings, and the `[distribute, boost]` order correctly gives `e+1+N`).
* **No two live ends share a slot**, because every live non‑due end lies in `(cur, cur+63]` — 63 distinct residues mod 64 — and no distribution can advance past a due boost (`BoostsExpireFirst`), so that window is stable while any boost is due.

**Totals always agree.** `boosts_active`, `boost_weight_total`, `boosts_due` and `Σ boost_expiring` are only written by `boost_vault` (one increment each) and `unschedule_boost` (one decrement each, choosing the due counter or the ring slot by the same `dist_epoch >= boost_end_epoch` test `expire_boost` uses). So `Σ ring + boosts_due == boosts_active` is inductive, and both host tests check it per‑slot against a model rebuilt from the records alone over 260 and 1 000 epochs.

**No double or early or never expiry.** `expire_boost` requires `boost_weight > 0 && dist_epoch >= boost_end_epoch`; after it, `boost_weight = 0`, so a second attempt is skipped (`expire_boosts`) or no‑ops (`claim`). `retire` unschedules from whichever side the boost is on. `expire_boosts` writes each record immediately (`store_record`), so a duplicate record in one batch is skipped on the second pass.

**Nothing is lost on a weight change.** `reweigh`'s `carry = owed_of(...)` *before* the weight changes, then `debt = w_after·acc`, gives `owed_after == owed_before` identically; `owed_of` adds `carry` before subtracting `debt`, which is why a *lower* weight can never need a negative debt. I confirmed `retire` computes `full = weight_of(r)·acc` **including** the boost before unscheduling, so the retired record's debt matches the weight that left the denominator.

**One‑sidedness.** `require!(price <= max_price && extra >= min_weight && epochs >= min_epochs, BoostTermsMoved)` — a move in the buyer's favour lands at the new terms. That is the ruling (round 24 D1), and SPEC states the longer‑slot consequence.

---

# R3. The level draw

**The SlotHashes parse is defensive and fails closed.** Key pinned to the sysvar id; `n <= 512`; `data.len() >= 8 + n*40`; an all‑zero hash on a qualifying candidate refuses rather than being fed into a draw.

**The window arithmetic closes.** With `MAX_SKIPPED_SLOTS = 64`, `LEADER_GROUP_SLOTS = 4`, `ENTROPY_GROUP_STRIDE = 2`: A ≤ `rs+64`, `want_B ≤ rs+72`, B ≤ `rs+136`, `want_C ≤ rs+144`, **C ≤ rs+208**. The capture window is 300 slots and SlotHashes holds 512, so at the latest legal capture (`now = rs+300`) the earliest needed slot (A, possibly at `rs`) is 300 back — comfortably inside the buffer, and C is always inside the window. So no vault can become uncapturable while its window is open. The host tests exercise skips exactly at A, at B's group start, at C's, and the `NotYet`/`Expired` boundaries.

**FIFO and a burned head.** `reveal_level` requires `index == revealed_total`, and `reschedule_reveal` needs only the record (no asset account), so a burned vault at the head can always be rescheduled, captured and drawn (the Core write is skipped on a positive tombstone). The queue cannot stall at a burned vault.

**What a minter, a crank operator or a slot leader can actually influence.**

* A **minter** cannot grind: the asset keypair is theirs, but the three hashes do not exist when they sign and pay. Their only lever is the *lapse* (limit 25). They cannot prevent anyone else capturing; capture does not change the value, only whether the lapse happens. So the lever is "hope nobody captures for 300 slots".
* A **crank operator** can withhold a capture for a specific record (traffic captures nothing unless it names the record) — limit 25 says so.
* **C's leader**: SPEC 26 says it "CHOOSES among many draws"; I confirm the code matches that reading (C is the *smallest produced* slot in `[want, want+64]`, so skipping its own first slots moves C within its own 4‑slot group, and it also chooses block contents). **Is it worse?** In the worst case a single large validator holds A, B and C's rotations (stride is only 2 groups = 8 slots, so 4 consecutive rotations suffice), which stacks three grinding stages. But SPEC 26 already concedes ~96% reachability of Level V for C alone with 64 content tries, so stacking adds essentially nothing to the stated bound. **Not worse than stated.** The cohort‑wide consequence (one choice serves every vault minted in that slot) is also already stated.
* **HOLDER-GUIDE now says it truly.** Its two honest‑list bullets ("the validator producing the last of those blocks can pick among several results, by skipping a block or changing what goes into it … one choice affects every vault created in that moment at once") and ("A draw nobody records in time is drawn again … the draw can be worked out from public data before it is recorded, so the minter could use this to turn down a draw they dislike") are accurate renderings of limits 25 and 26.

---

# R4. Governance

**No minority carries what it should not.** I re‑derived the gates: quorum `ceil(S·q)` of votes **cast** against the creation‑time live supply, threshold on YES share of cast, turnout `yes ≥ ceil(0.1·S)`, key change `yes ≥ ceil(0.5·S)`. At the ruled 21%/51% the smallest pass is 10.71% YES, so limit 35's claim that the turnout rule never binds is arithmetically right.

**Burning your own vaults never lowers a key‑change bar.** If you hold `k` of `N` and burn `b`, you need `k−b ≥ ⌈(N−b)/2⌉`, i.e. `b ≤ 2k−N`, which is negative whenever `2k < N`. So the attack does not exist.

**No vote reaches money it should not.** `split_bps`, `bank_treasury`, `pool_ata`, `max_supply`, `payment_mint`, `pob_root`, `pob_collection`, `level_caps`, `charter_*`, `monthly_secs`, `notice_secs` and the three tighten bounds are written only by `initialize` — I grepped every assignment. The action list is closed (five kinds, one each, bounded at creation against MINT's own live and fixed values, re‑checked at execution). `TightenSweep` is monotone (`max`/`min`), so ordering across kinds cannot loosen it.

**Freezing governance forever.** Only two routes exist and both are stated: all vaults redeemed (limit 45, corrected in round 24) and a stolen guardian key at turnout below half of all live vaults (limit 47). **One addition to limit 47 (INFO‑4 below):** the 50% bar is measured against live supply *at proposal creation*, so a third party who can buy vaults in an open round before the proposal is created raises the bar; to block a 240‑vault charter electorate they would need to push live supply above 480, i.e. buy ~480 vaults at ≥21 000 sats (~0.1 BTC). The control is that a round needs a community vote, and the attacker's cbBTC goes 85% into the pool. Worth one sentence in limit 47.

**Logged skips.** `CBOB_ACTION_SKIPPED` paths all advance their mark *before* the secondary check (a newer-but-already-over round still supersedes, red‑team 3 #4) and none can take a bundle down. `restart`'s stale‑half skip uses `>=` in GOV and `<` in MINT, which is the same tie‑break from both sides.

---

# R5. The charter claim and SPEC 46

**The claim is sound.** PoB identity by address against a domain‑separated, sorted‑pair Merkle root; the JS module and the Rust agree byte for byte (leaf `0x00‖key`, node `0x01‖min‖max`, odd node promoted with no proof element — I checked `proofOf`'s `if (sib < layers[d].length)` against `merkle_root_from`'s unconditional fold); the PoB is CPI‑burned as its owner in the same instruction, so a vault cannot exist without its PoB dying and vice versa; the window is two immutable numbers and a clock; the sales stop is not read (limit 48). Pass‑through accounts are never signers, and I confirmed nothing Core writes during `BurnV1` can be steered by them (the Oracle adapter path only reads; `WriteExternalPluginAdapterDataV1` is a different instruction).

**Is SPEC 46 now complete?** Effectively yes, and I could not add a consequence that is not already there. I checked each candidate:

| candidate | already in SPEC 46? |
|---|---|
| a collection plugin that rejects every burn → ends the project | yes, item (1) |
| a plugin admitting only the key‑holder's PoBs → captures the whole electorate | yes, item (2) |
| the alarm watches the *collection*, not the 240 assets | yes |
| the alarm *samples* state, so add‑and‑remove between passes leaves no diff | yes, round 25 D8(a) |
| the key **cannot** transfer or burn an individual PoB | yes, round 25 D8(b), with the Core lines |
| rewriting a PoB's name/uri, or moving it out of the collection | yes ("the same brick class") |
| a `PermanentFreezeDelegate` added to the collection post‑creation | not named, but it reduces to the same brick class, so no new consequence |
| a PoB **holder** freezing their own PoB with an owner‑managed delegate | yes |
| a PoB holder bare‑burning their PoB without claiming | not named. Self‑inflicted and permanent (the address can never be re‑minted), and it shrinks the electorate. One sentence would complete the list. |
| any third party | nothing: the asset signer is a fresh keypair, the record PDA is unsquattable (R31.W2b, R34.G2), and front‑running needs the PoB owner's signature |

The claim page's own policy (send no `pob_extra`, refuse a PoB or collection carrying an external plugin) is the right fail‑closed choice and is stated in SPEC 46 and `web/README.md` open decision 8.

---

# R6. The one‑time configuration and the trusted hop

I read every `initialize` against what a wrong‑but‑accepted value would lock in.

**Checked and sound:** collection clean/ours/unminted (I re‑derived the `CollectionV1` walk: `key | ua | name | uri | num_minted | current_size`, then `d.len() == o+8` forbids a plugin header); the royalty installed with `PluginAuthority::None`, which makes "10% forever" a Core property and which R.5/R.6/R.6c and R33.G3 pin in both directions (no update, no removal, no re‑delegation, with a positive control); SEAL‑before‑MINT and MINT‑before‑GOV collection agreement; `bank_treasury != default`; `payment_mint` ∈ SEAL's reserves; all three tighten bounds consistent with the values being installed and inside absolute limits; `max_sweep` 1–50 SOL; cooldown 1 s–24 h; `sol_reserve` 0 or ≥ rent; `level_caps` non‑zero and summing ≤ `max_supply`; `$CBOB` a live classic mint distinct from cbBTC and $GARY; boost ceilings 1..12 and 1..63; `redeem_window` 10 s–24 h; quorum 500–10 000; threshold 5 001–7 500; voting 60 s–30 days; notice 60 s–30 days; monthly 60 s–30 days.

**Weak points, all off‑chain‑guarded (INFO‑2 and INFO‑3 below):** `charter_opens_at` is bounded only *above* (`closes_at − opens_at ≤ 90 days`, `closes_at > now`), not below; `cbob_mint` is not required to have **no mint authority**; `pob_collection` is only checked to be non‑default; SEAL's reserve mints are checked only for their owner program (round 24 A6).

**The swap operator's worst case, bounded.** `sweep_sol_for_swap` is destination‑pinned (`cfg.swap_operator`), amount‑capped (`max_sweep_lamports`), rate‑limited (`last_sweep_at + cooldown`), reserve‑floored (`bal ≥ keep + amount`), operator‑signed, and guardian‑stoppable. So the exposure is **cap × cooldown windows until the guardian stops it, never more than the revenue PDA holds above the reserve**, and never cbBTC, the pool, or a vault. At the ruled 10 SOL / 6 h the maximum drain rate is ~34–40 SOL/day (SPEC's round‑37 C05 correction to the 7‑hour cadence is the right arithmetic). Replacement needs half of all live vaults plus 7 days, and the guardian can cancel a pending replacement. Limit 10 states this correctly, including the four remaining trusted items.

**The redemption cap is exactly a rolling window.** `head` is the write index, so `rate_ring[(head + 64 − k) % 64]` is the k‑th most recent; requiring it to be a full window old means no window of that length, wherever it starts, holds more than `k`. `k = min(max(cap,1), 64)`, so past live supply 3 047 the limit is stricter, never looser. A non‑monotonic clock makes `now − kth` negative and the `checked_sub`/require refuses — fails closed. `RL.7`'s replay against each redemption's *own* certified cap is the right instrument, and `stampCaps`'s ambiguity refusal is what makes it honest.

---

# R7. Cross‑program raw reads — recomputed from the structs

I rebuilt every layout from the Rust declarations and compared every pinned offset. **All correct.**

`MintConfig` (Anchor disc 8 + Borsh, declaration order): `version 8`, `collection 9`, `governance 41`, `pool_ata 73`, `round_id 105`, `opens_at 109`, `closes_at 117`, `price 125`, `cap 133`, `minted_this_round 137`, `minted_total 141`, `max_supply 149`, `bank_treasury 157`, `split_bps 189`, `sales_stopped 191`, `sweep_stopped 192`, `guardian 193`, `swap_operator 225`, `sol_reserve 257`, `bump 265`, `max_sweep 266`, `sweep_cooldown 274`, `last_sweep_at 282`, `level_caps 290`, `level_minted 310`, `revealed_total 330`, `payment_mint 338`, `pob_collection 370`, `pob_root 402`, `charter_opens_at 434`, `charter_closes_at 442`, `charter_claimed 450`, `bare_burns_retired 454`, `total_active_weight 462`, `active_count 470`, `acc_scaled 478`, `owed_scaled 494`, `last_distribute_at 510`, `sales_stopped_at 518`, `sweep_stopped_at 526`, `pending_swap_operator 534`, `pending_swap_operator_at 566`, `monthly_secs 574`, `pending_guardian 582`, `pending_guardian_set 614`, `pending_guardian_at 615`, `notice_secs 623`, `sweep_floor 631`, `cooldown_ceiling 639`, `reserve_ceiling 647`, `dist_epoch 655`, `pending_count 663`, `pending_this_epoch 671`, `cbob_mint 679`, `max_boost_weight 711`, `max_boost_epochs 712`, `boost_price 714`, `boost_weight 722`, `boost_epochs 723`, `boosts_active 725`, `boosts_due 729`, `boost_weight_total 733`, `cbob_burned_total 741`, `boost_expiring 749..1005`. Every one of GOV's 18 and BURN's 3 constants matches, and the length guards (`>= 714` in GOV, `>= 462` in BURN) cover the highest read.

`MINT_CONFIG_SPACE` sums to **1 261 = 1 005 + 256 padding** ✓. `VAULT_RECORD_SPACE` sums to **221 = 211 + 10** ✓, and GOV's `8 / 9 / 41` match. `BurnConfig` space `827 = 571 + 256` ✓ with `burned_total` at 42 ✓. `SealConfig` space `398`, `collection 9`, reserves `Vec` length at `41` ✓. `GovConfig` space `350` ✓. `Proposal` space `259`, which equals the maximum serialization (one action of each kind = 143 ≤ `ACTIONS_SPACE` 189) ✓. `ACTION_MAX_BYTES = 37` is `Brakes`, the largest ✓.

Sweep helper: classic token account `mint 0`, `owner 32`, `amount 64`, length exactly 165 ✓. The web page's `decode.mjs` readers agree with the official deserializers (its own `decode.test.mjs` is the right shape of test: official reader vs ours on bytes laid out as Core/Token write them).

Every raw read is pinned by **address + owner program + discriminator + version byte**, with the version declared first so it never moves. `expire_boosts`'s per‑record `load_record` checks owner + version but not the PDA derivation — which is correct, because any `VaultRecord` of this program is a legitimate record and the instruction only ever removes a due boost from it.

---

# R8. The suite, the simulation and the build as evidence

**Strong.** The `because()` list pins 200‑odd negatives to the exact error, and I spot‑checked the ones most likely to be wrong‑reason passes: `3.11 → VaultNotEmpty` (the PDA has no lamports for that vault, so the refusal really is the token amount), `3.3 → ReserveDelegated` (the delegate is checked before the amount, and the amount is already zero), `9.4 → VaultStillHoldsAVault` (the reserve loop skips the closed ATAs, so the second loop is reached), `5.3 → BadSealConfig` (the rate limit runs first, and `send()` waits for a token, so the named reason is the one that fires), `SR.3 → 0xb NonNativeHasBalance`, `SR.14`/`3c.F1`/`R28.F1 → 0x11 AccountFrozen`, `2.5`/`11.13 → 0x1a NoApprovals`. All correct. `ID.1` (unique ids) and `SR.12b` (the refusal came from the *second* guard) are exactly the right kind of meta‑instrument.

**The `expiry-budget.mjs` synthetic genesis is internally consistent** — I checked its numbers: 20 level‑I records at weight 2+12 = 280 total, `owed = 20·14·10·S = 2 800·S`, and after twenty expiries `total_active_weight = 40`, `boost_weight_total = 0`, `boosts_due = 0`. Its own caveat (not twenty lifecycles) is honest.

**Claims in this prompt that no arm exercises.** These are gaps, not defects:

1. A lamport deposit **between** the helper's Execute and `burn_vault` in the same transaction (prompt R1s(d)) — nothing lands this.
2. A declared reserve ATA that **does not exist** when the helper is called (the helper's `IllegalOwner` reverting the opening) — SPEC's prior‑transaction rule is untested in that direction.
3. A **native wSOL** source, and a **delegated** source, through the helper.
4. A destination that is **another vault's** asset‑signer PDA.
5. The page's **re‑plan loop** under an adversarial arrival (F1). No arm drives `redeem.mjs`'s handler twice with new state.
6. `activate` landing on a **frozen** cbBTC account on chain (the behaviour V3's repair now asserts in prose and in `plan.test.mjs`, but not against a program).
7. Seven negative arms still carry no `because` pin (R32.A22a, R33.G3, OR.5, R31.W1a, R31.W1b, R28.A2, R35.N8) — round 36 A12 already noted this; it is strengthening, not a defect.
8. The **compressed‑NFT** path end to end (DAS indexing of a PDA owner, and the resulting acknowledgement).

**Build as evidence.** `build-mainnet.sh` is honest about its own limit ("NOT PROVEN that the compiled constant IS that key") and closes the one gap it can: the sweep helper's mainnet bytes are compared to both this script's localnet rebuild **and** `target/deploy/cbob_vault_sweep.so`, the file the suite and the sim actually deployed. The four keyed programs' mainnet bytes rest on the behavioural ask in both directions, the source grep, the clean‑tree check and reproducibility — which is the honest maximum from one box, and is exactly why an independent rebuild (see the last section) is the one thing still missing.

---

# The four questions about the accepted limits

## 1. Is any limit WORSE than stated?

**INFO‑1 — limit 27's "who" is inverted.** It says *"Who: mainly the owner who burned it."* It is not. A `claim` between a bare burn and its retirement moves the dead vault's owed share into an ATA nobody can ever sign for; `retire_burned` would otherwise have returned that share **to the pool**, i.e. to every other holder. The burner, having destroyed their vault, loses nothing. And because `claim` is permissionless, a stranger can *choose* to do this. The magnitude is right (bounded by one vault's accrual since the last claim, and the crank retires first every pass), but the attribution should read "every other holder, and an attacker can cause it deliberately".

**INFO‑4 — limit 47 is marginally worse.** The 50%‑of‑live bar is measured against live supply **at proposal creation**, so a third party who can buy vaults in an open round *before* the proposal opens raises the bar. Blocking a 240‑vault charter electorate needs live supply above 480, i.e. ~480 purchases at ≥21 000 sats (~0.1 BTC), 85% of which lands in the pool. The real control is that opening a round needs a community vote. One sentence would complete the limit.

**Not worse:** limit 26 (stacking A, B and C under one validator adds nothing to the already‑stated ~96% reachability); limit 32 (the ring arithmetic and the "one higher than true live supply" window are exactly right); limit 35 (10.71% > 10% holds, including the small‑S ceilings); limit 44 (the helper really does read only 165‑byte classic accounts); limit 49 (221 bytes × (221+128)·5 080 = 1 772 920 lamports ✓).

## 2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?

**No.** I checked the ones most likely to have gone stale:

* Limit 29 (only cbBTC splits) is still true: `split_revenue` requires `mint == payment_mint`, and no instruction moves a non‑payment token out of the revenue PDA. A non‑cbBTC token sent there is stuck forever.
* Limit 43 (an off‑curve owner cannot redeem) is still true, and round 23's WR.1–WR.4 are the right shape of proof.
* Limit 58 (`rescue_nested`) correctly bounds itself: the destination is `config.bank_treasury` unconditionally, the host must be the vault itself, a positive tombstone, or a live vault of **this** collection, and a vault inside a foreign live asset or an uncreated address is refused. I confirmed `is_burned` is short‑circuited when `host == vault`, and that a never‑created host reads as System‑owned and is refused.
* Limit 9's narrowing by limit 44 is accurate: the helper *can* deliver classic strays, so the coverage check is a sweep list, not only a warning.

## 3. Is any DISCHARGED item not actually discharged?

**No.** Spot‑checks: item 30 — I grepped every assignment to `split_bps`, `bank_treasury`, `pool_ata`, `max_supply`; each appears only in `initialize`, and `update_wiring` and `WiringArgs` do not exist in either program (P.0e/P.0f test this positively). Item 33 — the notice is an `initialize` value and both `apply_*` successes are landed. Item 51 — the boost is built, owner‑only, with the one‑sided terms check, and its "N distributions, not N months" consequence is disclosed. Item 54 — the pages satisfy its rule by sending **no** crank at all (I checked `claimCharterVault` and `mintVault`: both are built with no crank keys, and `revealLevel`/`captureEntropy` go alone, measured at 150 344 CU against a 200 000 default). Items 12/17 — the byte‑wall‑before‑compute‑wall conclusion is restated with its scope (legacy, padded mint) and does not over‑claim v1.

## 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**No item is mislabelled, but item 53's content is stale — see F2.** Items 22, 38, 50, 52 and 53 are all still OPEN in SPEC, and the road table still shows steps 8–11 unstarted with `charter_opens_at`, `lock_deadline` and `vault_collection` OPEN in `launch/mainnet-init.json` (which `judgeLaunch` refuses). Item 50's prose correctly says the pages are **built and staged, not published**, and that the holder guide (DRAFT) may not be published before it ships. The rehearsal‑value‑set gap inside item 53 is still named as "not built", and the `rehearsal` profile refuses accordingly — i.e. the gap is honoured in code, which is the right posture. F2's point is that item 53's *file list* no longer describes where the ids live.

---

# Other findings

**INFO‑2 — the charter window's start is not bounded below on chain.** MINT's `initialize` requires only `charter_closes_at > charter_opens_at`, `closes_at − opens_at ≤ 90 days` and `charter_closes_at > now`. Nothing requires `charter_opens_at ≥ now`. So an `initialize` run late silently installs a window that is already mostly consumed, permanently, and the only visible guard is the ceremony printing the dates and `judgeRehearsal`'s `charterClosesAt > nowSec` (which a one‑second window passes). I could not read `scripts/check-launch-params.mjs` in this bundle, so I cannot say whether `judgeLaunch` adds the inequality. **Recommend:** add `charter_opens_at > now + margin` to `judgeLaunch` *and* to the ceremony's preflight, judged at the **chain** clock, and have the ceremony refuse (not merely display) a window with less than, say, 6 of its 7 days remaining. The cost of being wrong here is a permanently shortened charter window.

**INFO‑3 — three `initialize` identities are weaker on chain than off.** `cbob_mint` is checked only for owner‑program, length 82, `is_initialized`, and distinctness from cbBTC and $GARY — **not** for a null mint authority, so a $CBOB mint that could still print would be accepted. `pob_collection` is checked only `!= default`. SEAL's reserve mints are checked only for their owner program (not that they are mints, nor for duplicates). All three are pinned by address in `launch/mainnet-init.json` and the live values are correct (the mainnet $CBOB has no mint or freeze authority), so the exposure is a launch‑procedure one. Round 24 A6 already records the SEAL half; the `cbob_mint` authority half is not written down.

**INFO‑5 — a transient frozen pool can fail an opening that was planned as a forfeit.** `planRedemption` decides `claim = active && !poolFrozen` from the plan‑time read. If the pool is unfrozen between plan and send, `retire_redeemed`'s `forfeit` is false and the still‑owed vault hits `ClaimBeforeBurn`, so the opening fails. Safe (retry succeeds with the claim included), but undocumented. One sentence in `web/README.md`'s redemption section.

**INFO‑6 — residue of the V2 repair.** `collectionCreator` returns `unverifiable` when more than `HISTORY_PAGE × HISTORY_PAGES = 5 000` transactions name a candidate. In the narrow window where there is **no pin at all** (step 0 landed, `localStorage` lost, SEAL not yet initialized), a stranger who floods the real collection's history for ~0.025 SOL makes it `unverifiable`, so `resolveCollection` returns `collection: null` and the ceremony offers **step 0 again**, creating a second collection. The page does show a warning box naming the ignored address, so a human can stop; the harm is one wasted collection and confusion, not value. **Fix:** on `unverifiable`, STOP with "write it in `web/src/config.js`" rather than falling through to step 0.

---

# What I could not measure (so you can weigh the above)

* **No validator, no network.** Every on‑chain claim above is a reading of the bundled Rust plus standard program semantics. Three things I assert from semantics, not from a run here: SPL‑Token `CloseAccount` reassigns the closed account to the System program and reallocs to 0 (this is what makes BURN skip it for the right reason); a stranger's `CreateCollectionV2` naming MINT's PDA lands (the instruction passes the update authority read‑only and non‑signing, which is also why step 0 works); and `activate` lands on a frozen cbBTC account.
* **F1's cost figure.** I did not measure Bubblegum mint cost or whether DAS indexes compressed NFTs owned by an off‑curve asset‑signer PDA. **That one measurement decides whether F1 is HIGH or LOW.** Do it first.
* **`bank/` is absent from this bundle** except `txread.mjs`, `sigwalk.mjs` and `pob-merkle.mjs`. So round 37's off‑chain repairs (C01–C05, C07) and the pre‑round‑38 drift sweep are unverified here, as are `check-launch-params.mjs` (`judgeLaunch`), `detectors.mjs` (`judgeRedemptionCoverage`, `classifyPdaTokenAccount`) and `crank.mjs` — all of which the `web/` tree imports and depends on. The coverage gate must bundle them in the off‑chain pass for their current content to count toward gate 1.
* Nothing here can show whether a holder *understands* any page sentence, nor what a real Phantom does with a message, nor what a real Squads return looks like.

---

# Given that no human firm will ever see this, and the programs will be immutable

AI audit is good at the things in this report: recomputing offsets, replaying arithmetic, finding a promise a file contradicts, enumerating the shapes of an account list. It is structurally bad at four things. Each has a concrete substitute, and each costs money or days rather than tokens.

1. **Adversarial liveness.** Every finding in this report's HIGH slot is a *griefer with a budget and a loop*, and no reader found it in three rounds because reading a plan does not reveal that a *loop over* the plan never terminates. **Do:** write `web/test/grief-localnet.sh` — an adversary process that, on a local validator, continuously creates token accounts, Token‑2022 ATAs, Core NFTs and (if you can run a tree) compressed NFTs at a vault's deposit address while the e2e drives the redeem page's own handler, and assert the opening lands. Run the same loop against the ceremony (decoy collections) and the claim page (PoB plugins). Budget: two days. This is the single highest‑value thing left.

2. **A redemption path that does not need the page.** Item 50 makes one unpublished web page the sole sanctioned way out of a vault, and F1 shows that page can be delayed by a stranger. **Do:** ship a 150‑line `scripts/redeem.mjs` (node, reads a keypair file, builds exactly `planRedemption`'s transaction, no acknowledgement UI, prints what it will destroy and asks for a typed confirmation), publish it in the repository, and name it in the holder guide as the fallback. It is in the same packet shape the suite already measures, so it costs almost nothing and removes a single point of failure from an immutable system.

3. **An independent build, by someone who is not this box.** `build-mainnet.sh` says plainly that it cannot prove the compiled `INIT_AUTHORITY` is Gary's key, and that the bridge is reproducibility. Nobody has crossed that bridge. **Do:** have a second person, on a second machine, from a fresh clone of the release commit, run `cargo-build-sbf --arch v3` at the pinned toolchain and publish the five sha256 values alongside `dist/SHA256SUMS`. Then have a *third* party independently re‑derive `pob_root` from mainnet with their own tool and publish it. Two signatures on two numbers; an afternoon each.

4. **A witnessed, irreversible key ceremony.** Step 9's deploy authority (`bank/keys/deploy-authority.json`, a 600‑mode file on this box) is the only thing between the placeholder and the launch bytes, and step 11's `set-upgrade-authority --final` is the last reversible moment the project will ever have. **Do:** two people present, screen‑recorded, reading aloud the dumped prefix hash and the zero tail for each of the five programs before and after; the `--final` command run only after both have read the post‑deploy dump; the recording kept. And **run the whole ceremony in local mode** (`web/deploy/ceremony-local.mjs` over an SSH tunnel) with the `app.js` sha256 compared against the committed table — that mechanism exists and should be the only way it is ever run.

Three further things, cheaper but still outside what reading can do:

5. **Publish the frozen tree and pay for attack.** A funded bounty (scoped: value extraction, permanent liveness loss, a false holder‑facing statement) with a 30‑day public window before the lock. The findings this process keeps producing in its *newest* code are the ones a motivated outsider finds fastest.
6. **Soak the crank and the alarm at scale** on a mainnet fork with 2 100 synthetic vaults and a hostile RPC (the 300‑second socket from round 25 A1), not only the rehearsal. Item 22 names the pass/fail list; add "a flooded `getProgramAccounts`" to it.
7. **Pre‑commit the incident runbook**, because after step 11 there is no code fix for anything. One page per scenario — Core upgraded and redemptions refuse; cbBTC pool frozen; swap operator key leaked; guardian key leaked at low turnout; the page blocked by a griefer — each with the exact on‑chain instruction or human act that is available, and the exact one that is not. Write it before the lock, when the answers can still change the design.