I'll focus on the highest-value targets and give concrete, checkable findings. Given the scale, I prioritize what immutability makes permanent and what the test harness cannot catch.

# SUMMARY

I found one genuine CRITICAL in the sweep helper that survives measurement, one HIGH in MINT's monthly-inline accounting, several MEDIUM/LOW, and a set of corrections to the accepted-limits list. The most important finding (R1s-C1) is a destination-binding gap in the sweep helper that the prompt's R1s(c) explicitly invites, and which the suite's SR.* arms do NOT actually close for the lamport sweep.

---

# R1s. THE SWEEP HELPER

## R1s-C1 — CRITICAL — the lamport sweep has no destination binding to the owner, and the helper never checks the destination wallet against the asset owner

**Construct:** `programs/cbob-vault-sweep/src/lib.rs`, `process`.

The helper validates, for each token *pair*, that `to_owner == *dest.key` and `to_mint == src_mint`. It validates that `signer.key != dest.key`. It does **not** validate that `dest` is the asset's owner, nor anything about `dest` at all beyond "not the signer." The final step is unconditional:

```rust
let lamports = signer.lamports();
if lamports > 0 {
    invoke(&system_instruction::transfer(signer.key, dest.key, lamports), ...)
}
```

`dest` is `accounts[1]`, chosen entirely by whoever builds the `ExecuteV1` call.

The prompt (R1s-a) asserts the access control is "called directly it needs the asset-signer's signature; through Core, Core decides who may ExecuteV1 … is that ONLY the owner." That is true for *who may invoke*. But the question in R1s-c is whether, given that only the owner can invoke, an arbitrary destination is safe. The author's answer (SPEC, holder guide) is: yes, because the owner chooses their own destination. **That reasoning has a hole the suite does not test.**

Consider a vault held in a **Gary Club custodial wallet** (the design's central custody model — accepted limit 41 says custodial keys exist). Gary Club holds the owner key. The holder does not. When the holder redeems through the Bank's redeem page, the page builds the `ExecuteV1` and names `dest`. **The destination is chosen by the page, not proven to be the signing owner.** There is no on-chain binding that the lamports (and the swept tokens) go to the key that authorized the Execute. A compromised or malicious redeem page — or anyone who can get the custodial owner key to sign an `ExecuteV1` into this helper (e.g. a phishing transaction presented as a redemption) — sends every token and every lamport to an attacker-named `dest`, and it is a *legitimate* helper call.

Compare SEAL/BURN: those bind `owner` at account index 2 and require the owner to *sign two top-level instructions*. The sweep helper, by contrast, binds nothing to the signer except "the sources belong to the asset-signer PDA." The tokens go to `dest`; the lamports go to `dest`; `dest` is free.

**Why the SR.* arms don't catch it:** SR.2 refuses a *token pair* whose destination is not owned by the named `dest` wallet — but that only checks the token-account's owner equals `dest.key`, i.e. it checks internal consistency of the pair, not that `dest` is the vault owner. SR.4/SR.4a/SR.13 all use `alice` (the owner) as `dest`, so they never exercise a non-owner destination that is otherwise well-formed. There is **no arm** where a well-formed redemption names a destination wallet that is not the asset owner and the helper refuses it. It cannot refuse it — the code has no such check.

**What an attacker/accident gains:** the entire contents of a redeeming vault (cbBTC, $GARY, $GIRAFFISH, SOL) diverted to an arbitrary wallet in a single legitimate-looking `ExecuteV1`, for any vault whose owner key can be made to sign one (all custodial vaults; any self-custody holder tricked into signing a malicious "redeem" transaction). This is strictly worse than a normal key-theft redemption because it bypasses the holder's own wallet entirely — the value never touches the owner.

**Evidence that would exist if I'm right:** build the helper's `ExecuteV1` with `dest = attacker_wallet` and valid pairs (`to_owner == attacker_wallet`), signed by the owner. It succeeds and moves everything to `attacker_wallet`. The suite has no arm asserting this is refused; the on-chain programs have no code that would refuse it.

**Fix:** the helper must bind the destination wallet to the asset owner. Since the helper is reached only via Core `ExecuteV1` as the asset-signer PDA, read the asset owner. The cleanest fix: pass the asset account and verify `dest.key == asset_owner` (Core AssetV1 bytes 1..33). Alternatively, require `dest` to be a signer — but Core signs as the PDA, not the owner, so the owner's signature is not naturally present in the Execute'd instruction; reading the asset owner is the real fix. This is immutable, so it must be fixed before launch.

**Caveat / what would refute this:** if Core's `ExecuteV1` requires the *owner* to be a signer on the outer transaction AND the helper could read that owner, the risk reduces to "a malicious client the owner trusts." But even then, the custodial case (Gary Club holds the key and signs on the holder's behalf) means the *holder* is never a signer and cannot see the destination — the binding to "the key that signed" is exactly the key the holder does not control. The design explicitly relies on the redeem page being honest (item 50, PROCEDURE). For an *immutable* program handling all three tokens plus SOL, "trust the page" with zero on-chain destination binding is a CRITICAL gap. The prompt's own R1s(c) flags this as the question to answer, and the answer in the tree is "given (a), is that safe?" — (a) only establishes *who invokes*, not *where value goes*.

---

## R1s-M1 — MEDIUM — a source that is also a destination earlier in the pair list, or a destination named twice, is not rejected; the close-then-reference pattern is only partially tested

**Construct:** `programs/cbob-vault-sweep/src/lib.rs`, the `chunks(2)` loop.

SR.12a tests the *same source named twice* and relies on the second iteration failing because the first `close_account` already closed it (verdict notes it is caught at `read_token` returning IllegalOwner/InvalidAccountData, not at the source-owner guard — see the `SR.12b` meta-assertion). But other aliasing shapes are not tested:

- A `dest` token account of pair A used as the `src` of pair B. After pair A transfers into it and pair B reads it as source: `src_owner` would be `dest.key` (the destination wallet), which is `!= signer.key`, so it refuses `IllegalOwner`. OK — but untested.
- The same `dest` account named as the credit destination in two pairs of the same mint. This is harmless (both credit the same account) but means the "all of it" transfer semantics are per-source; no aggregation bug, but also untested.

**What is gained:** nothing demonstrably, but the close-before-the-whole-list-is-validated ordering means the helper performs CPIs for pair 1 before it has validated pair N. If any CPI has a side effect the later validation would have forbidden, it is not rolled back within the helper (the transaction as a whole reverts, so atomicity holds). This is a robustness concern for an immutable program, not a demonstrated exploit.

**Fix:** validate all pairs before performing any transfer/close, or document that per-pair interleaving is intentional. Low priority given transaction atomicity.

---

## R1s-D1 (accepted-limits check) — item 44 / SR.13 — the zero-pair lamport-only sweep to a non-existent sub-rent destination

Item 50 / round 25 D9 states: "A lamports-only sweep needs a destination that exists … a credit below rent exemption to an account that does not exist yet is refused." But the helper does **not** refuse it; the System program does, and only if the amount is below rent exemption AND the account does not exist. The helper transfers `signer.lamports()` unconditionally. If the vault wallet holds more than rent-exemption, a System transfer to a brand-new account succeeds and *creates* it. The claim "the canonical destination is the owner, who pays the fee and so exists" is the mitigation, but it rests entirely on the page naming the owner — which is exactly R1s-C1. This is consistent with my CRITICAL: the destination freedom is real and the "exists" reasoning only holds for the owner-as-dest case.

---

# R2. THE COMMUNITY POOL

## R2-H1 — HIGH — `monthly_inline` and the invariant "pool always holds at least ceil(owed)" under a frozen pool that later thaws

**Construct:** `programs/cbob-vault-mint/src/lib.rs`, `monthly_inline`, `credit`, `retire` (forfeit branch), and `ceil_sats`.

The invariant P.32 asserts `pool.bal >= ceil(owed)`. Walk the frozen-pool forfeit path:

1. Pool frozen. A redemption lands; `retire_redeemed` with `forfeit = true` calls `retire(…, redeemed=true, forfeit=true)`. The vault's `pending` share is subtracted from `owed_scaled` (`c.owed_scaled = c.owed_scaled.checked_sub(pending)`), and the share is "forfeited to the pool" — meaning it stays in the pool balance but is no longer owed. Good: `bal` unchanged, `owed` decreased, invariant preserved.

2. But `monthly_inline` runs *after* retire inside `retire_redeemed`. With the pool still frozen, `monthly_inline` reads `d[TOKEN_STATE_OFF] == TOKEN_STATE_FROZEN` → returns early. Good.

3. Now the pool thaws. The forfeited amount is sitting in `bal` as `avail` (balance minus `ceil(owed)`). The next `distribute`/`monthly_inline` credits it to the *remaining* vaults. This is the intended "forfeited to the pool" behavior.

This is self-consistent. **However**, consider the interaction with `owed_scaled` rounding across many forfeits. Each forfeit subtracts the *scaled* pending (which may carry a sub-sat remainder) from `owed_scaled`, but the *balance* still holds whole sats. `ceil_sats(owed_scaled)` rounds up. Across many partial-sat forfeits and credits, is there a sequence where `ceil(owed)` exceeds `bal`? 

The credit path adds `floor(avail * SCALE / w)` to `acc`, and `owed += delta * w` which is `<= avail * SCALE` (floor loss), so `owed_scaled` tracks at most what was distributed in scaled units. `bal` tracks whole sats paid in. The claim path pays `floor(pending/SCALE)` whole sats and reduces `owed` by `pay * SCALE`. The residual `carry` stays in the vault and in `owed`. Because `ceil_sats` rounds the *total* `owed` up to whole sats, and each vault's sub-sat residues can sum to up to (active_count - 1) scaled units below a sat, `ceil(owed)` can exceed the sum of individual `floor` payouts by up to `active_count` sats. The pool retains dust precisely to cover this (P.13). I could not construct a violation; **the invariant appears to hold.** 

I am **downgrading this to a non-finding on the pool balance invariant** — it survives my analysis. The forfeit path is sound. I note it here because the prompt asked to attack it hard and the analysis is non-obvious; a future change to `ceil_sats` or the forfeit subtraction order would be the place a violation enters.

## R2-M1 — MEDIUM — `pending_this_epoch` underflow protection vs. a retire in the request epoch across a tick

**Construct:** `retire` and `advance_epoch`.

`advance_epoch` sets `pending_this_epoch = 0`. `retire` decrements `pending_this_epoch` only `if r.request_epoch == c.dist_epoch`. Consider: vault requests in epoch E (`pending_this_epoch += 1`, now counts it). A distribution runs (`advance_epoch`: `pending_this_epoch = 0`, `dist_epoch = E+1`). Now the vault is `pending` with `request_epoch = E`, and `pending_count` still counts it, but `pending_this_epoch` is 0. If it is now retired (bare-burn-retire while waiting): `retire` checks `r.request_epoch (E) == c.dist_epoch (E+1)` → false → does NOT decrement `pending_this_epoch` (correct, it's 0) but DOES decrement `pending_count`. Good.

The dangerous case: vault requests in epoch E, retired in the *same* epoch E before any tick. `pending_this_epoch` was incremented at request; `retire` sees `request_epoch == dist_epoch`, decrements both. Good. F21.1 tests exactly this and it holds.

I find no underflow. `waiting_to_join = pending_count - pending_this_epoch` with `checked_sub` — if `pending_this_epoch` could ever exceed `pending_count` this aborts. Can it? Every `+1` to `pending_this_epoch` is paired with a `+1` to `pending_count` in `activate`; every `-1` to `pending_this_epoch` in `retire` is paired with a `-1` to `pending_count`; `join` decrements `pending_count` but not `pending_this_epoch` (because a join only happens when `dist_epoch > request_epoch`, i.e. the request was NOT this epoch, so it was never in `pending_this_epoch` for the current epoch... but `pending_this_epoch` was reset to 0 at the tick that made it joinable). This holds. **Non-finding**, but the coupling is fragile and un-asserted for the join-decrements-count-only case against `pending_this_epoch`.

---

# R3. THE LEVEL DRAW

## R3-M1 — MEDIUM (accepted-limit WORSE check) — the "three different leaders" claim is weaker than even SPEC 26 admits, because `want` after a skip does not re-align to a group boundary

**Construct:** `try_capture` / `blockhash_in_window`, the `want` advance:

```rust
want = (slot / LEADER_GROUP_SLOTS).checked_add(ENTROPY_GROUP_STRIDE)
    .checked_mul(LEADER_GROUP_SLOTS)...
```

This takes the *produced slot found*, divides by 4, adds the stride (2), multiplies by 4. So after finding hA at slot `sA`, B targets `(sA/4 + 2)*4`. If `sA` is e.g. slot 2003 (group start 2000), B targets `(500+2)*4 = 2008`. Fine. But the first produced slot `>= 2008` could be 2008, 2009, 2010, or 2011 — all in the *same* leader group (2008..2011). Then C targets `(that/4 + 2)*4`. If B landed at 2011, C targets `(502+2)*4 = 2016`. 

Now consider accepted limit 26's claim: a leader holding two adjacent rotations gives it more influence. The code's group alignment is correct, but note: **A, B, C each take the *smallest produced slot* at or after a target that is a group boundary**, and the leader schedule is public. A validator that is the leader for groups starting at 2008 AND 2016 (two of the three contributing groups) controls hB and hC. The stride of 2 guarantees A, B, C are in *different groups*, but NOT different *leaders* (SPEC 26 admits this). My addition: because C is computed from B's *found slot* not B's *target*, a leader that skips within its B-group can shift which group C lands in, adding a second degree of freedom beyond "grind C's block." This makes the residual marginally worse than SPEC 26's "best-of-4 for C alone" — a B-leader who is also a C-leader can jointly choose hB *and* the C-group. 

**This is within the spirit of accepted limit 26 (the last-contributor residual) but the mechanism — C's target depending on B's *produced* slot — is not stated.** It is not a new exploitable finding so much as a confirmation that limit 26 is at least as bad as stated, arguably slightly worse for a two-rotation validator. Disposition: **limit 26 is not understated enough to reclassify; noted for completeness.**

---

# R6/R7. CONFIGURATION AND RAW READS

## R7-L1 — LOW — `read_mint_config` in GOV reads `OFF_MINT_MAX_BOOST_EPOCHS + 2` as its length bound, but the boost ring (`[u32; 64]`) follows; the version pin is the only guard and it is correct, but the space constant is worth re-verifying

I recomputed `MINT_CONFIG_SPACE` term-by-term against the struct and the pinned offsets GOV/BURN read (governance 41, minted_total 141, bare_retired 454, charter_closes 442, sweep bounds 631/639/647, boost bounds 711/712). These are internally consistent with the suite's offset table (`OFF_*` in `3prog.test.ts`), and the suite asserts the live config decodes at these offsets (3.1w, X.1-X.2). The version-6 pin + discriminator makes a silent misread fail closed. **No offset defect found.** The `CONFIG_PADDING = 256` buffer means a 7th field could be appended without changing any current offset — but there is no realloc, so a 7th field that *grows the needed base* beyond the allocated `MINT_CONFIG_SPACE` would brick; the padding covers that. Non-finding; the raw-offset machinery holds.

---

# R0. ROUND 28'S VERDICT

Round 28 verdict is **NOT CLEAN, incomplete quorum (5/8, 6 required)**. Its confirmed findings (M1 log-truncation reader, L1 token-2022/ATA byte mismatch, D1-D3 doc siblings) were validated as repaired in VALIDATION.md and the suite floor moved 848→855. I confirm:

- The log-truncation fix (`txread.mjs` refusing the standalone `Log truncated` marker) is present and the fixture passes. **Holds.**
- The Token-2022/ATA pin mismatch (`token-programs.sh`) — the pins are *captured* bytes and the file's own comment admits "The bundled Token2022 and ATA differed." The round-28 verdict L1 says this is a **dependency-evidence gap, not a CBOB behavior failure**, and that the suite now loads and compares them. I confirm the comparison runs. **Holds as a documented limitation**, but see R0-N1 below.

## R0-N1 — the round-28 Autograph heap boundary (accepted limit 40 addition) is a genuine permanent hazard the holder guide understates

The measured Core boundary (R28.A2): once a vault's Autograph reaches ~10 KB, Core cannot remove *any* owner-managed plugin, "including a delegate they approved." The holder guide says "In tests such a vault still drew its level, its owner locks still came off, and a transfer and a full opening both passed a simulation." But A3/A4 are **simulations**, not landed transactions, and the validation record explicitly says "Failure to write a larger state is not evidence that revealing it would fail" and "arbitrary mixed shapes remain unproven." A holder who adds an autograph book plus a delegate they later want to revoke is permanently stuck with that delegate. The guide's "leave add-ons off" warning exists, but the custody model (Gary Club wallets signing) means a *custodian* could add such plugins. This is correctly in the honest list; I confirm it is a real, permanent, immutable-locked hazard and the disclosure is adequate-but-barely. **Not a new finding; disposition: accepted limit 40 is correctly stated.**

---

# ACCEPTED LIMITS — the four questions

1. **Worse than stated?** — Item 44/50 (sweep helper destination). The accepted framing is "the holder, to their own property" and "the page empties the vault to the owner." R1s-C1 shows the on-chain helper has **no destination-to-owner binding at all**, so the risk is not "holder's own property" but "anyone who can get an owner key to sign an Execute names the destination." For custodial vaults the holder is never the signer. **This is materially worse than the accepted framing and I classify it CRITICAL.**

2. **Listed as a limit but already closed / closed by something unnoticed?** — None found that are wrongly open.

3. **DISCHARGED not actually discharged?** — Item 33 (notice-period apply) and item 54 (compute) are genuinely discharged (3c.K5/3c.G2 and 10.6a/E.3c exercise them). Item 51 (boost) is discharged with arms. I found no falsely-discharged item.

4. **OPEN AND BLOCKING quietly treated as accepted?** — Item 50 (surfaces not built) is correctly OPEN AND BLOCKING, and it is the on-chain preventive-control gap behind R1s-C1. The tree does NOT treat it as accepted. Good — but note R1s-C1 means even a *built* page cannot fully close the destination gap without a program change, because the binding must be on-chain for custodial vaults.

---

# GIVEN NO HUMAN FIRM AND IMMUTABILITY: what AI audit structurally cannot do

Concrete, before launch:

1. **Fix the sweep-helper destination binding on-chain (R1s-C1) or formally accept it with a holder-visible disclosure.** AI audit keeps asking R1s(c) and the tree keeps answering "the page is honest." That answer is a *procedure*, and item 50's page is unbuilt. Make the helper read the asset owner and require `dest == owner`. This is the single change most likely to matter and it is permanent.

2. **Run the two things no local validator and no AI can measure: the live revenue cycle (both venues, forced Meteora, forced post-sweep failure) and the live crank against ~2,100 vaults** (item 22). These are the only components that have *never executed against a live chain*. AI reasoning about RPC paging, rate limits, and a transient error on vault 1,900 is worthless; measurement is everything.

3. **Pin the actual mainnet Token-2022 and ATA bytes** (round-28 L1). The suite currently ships *different* bytes than mainnet for two of three token programs and only notices via comparison. For an immutable system that reads 165-byte layouts and refuses 170-byte ones, test against the real bytes, not a captured snapshot that already differs.

4. **Build the destination-page and run `judgeRedemptionCoverage` against real DAS**, because the on-chain programs cannot enumerate PDA holdings and AI cannot test DAS behavior on a local validator. Settle A17 (does DAS set `burnt`).

5. **A human must physically confirm the deployed bytes and remove the upgrade authority in the correct order** (SEAL→MINT→BURN→GOV→sweep, then lock). `build-mainnet.sh` proves source-to-bytes but explicitly "NOT PROVEN that the compiled constant IS Gary's key." Only Gary signing a real `initialize` closes that, and only a human watching the `set-upgrade-authority --final` closes immutability. No audit can do this.

The structural gap AI audit cannot fill is exactly where R1s-C1 lives: a control that is "on-chain refusal" vs "trust the client" looks identical in a passing suite when every test arm uses the honest client. The suite's own `because()` discipline is excellent for *refusals it exercises*; it is silent on *refusals that were never written*. Before launch, enumerate every value flow (where do tokens/SOL go?) and require each to have an on-chain binding or an explicit accepted-limit row — the destination of the sweep helper is the one that slipped through.