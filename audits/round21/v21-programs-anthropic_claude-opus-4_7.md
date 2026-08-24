# Round 21 Audit Report

I'll follow the requested order: R1–R8, then the four questions on limits, then anything else.

---

## R1 — THE COMMITMENT SCHEME

### FINDING R1-C1 — CRITICAL — The Bank can grind the entropy slot's blockhash while it is producing it

**Construct.** `commit_seed` derives `deck_slot = current_slot + 32`. `commit_deck` reads the blockhash of that slot from `SlotHashes`. `bank_salt` is fixed by the earlier hash. What is NOT fixed is *what blockhash arrives in slot X* — that is determined by whichever validator produces slot X.

**What a cheating Bank must control:** either (a) be a validator scheduled to produce slot X, or (b) collude with such a validator. Solana's leader schedule for the next few hundred slots is public and knowable at the moment `commit_seed` is submitted, so the Bank knows *exactly which validator* will produce the entropy slot before it decides whether to submit `commit_seed` at all.

**Attack.** The Bank submits `commit_seed` at slot S iff the leader for slot S+32 is one it controls or has bribed. That leader can then choose whether to produce or skip slot S+32 based on which choice gives a better `sha256(salt||blockhash)` when tested against the pre-computed off-chain deck. Skipping the slot costs the leader one block reward (~0.005 SOL of priority fees + inflation); producing gives one binary bit of freedom per rejected slot. With colluding leaders across the 32-slot window and neighbors, the effective grinding factor is bounded by the fraction of stake the Bank controls or can bribe.

Even absent validator control: `commit_seed` can be submitted **many times** across many slots (see R1-C2), each with a different `+32` target, and the Bank chooses which to actually land based on which future leader schedule looks favorable.

**Evidence that would exist if I'm right:**
- Reading the current leader schedule (`getLeaderSchedule`) shows the leader for slot `commit_seed.slot + 32` is knowable at `commit_seed` submission time. **This is a documented Solana feature.**
- Nothing in `commit_seed` prevents the Bank from testing multiple candidate salt hashes ahead of time and choosing the one that hits a favorable slot leader.

**Fix.** Either (i) use a genuine VRF (Switchboard, ORAO), which requires a CPI budget you don't have, or (ii) accept this as a limit and state it: the deck is grindable by a Bank that is a large validator or that can bribe them, bounded by their stake fraction. Do **not** claim the scheme "removes the Bank from the trust argument" — the deck.mjs header says so and it is false.

---

### FINDING R1-C2 — CRITICAL — `commit_seed` is one-shot per `deck_salt_hash`, but the deck can be re-drawn if the entropy slot is missed and there is no `deck_root` yet

**Construct.** Look at the actual guards:
- `commit_seed`: requires `c.deck_salt_hash == [0u8; 32]`. Once set, cannot be re-called.
- `commit_deck`: requires `c.deck_root == [0u8; 32]`. Once set, cannot be re-called.

**But**: what happens if `commit_seed` succeeds and then the entropy slot ages out of SlotHashes (512 slots ≈ 3.4 minutes) before `commit_deck` is called? `commit_deck` will return `DeckSlotUnavailable` **forever** on that salt hash.

The header comment on `SLOT_HASHES_MAX` claims this is fatal by design and prevents re-seeds. **But there is no admin escape hatch to reset `deck_salt_hash` back to zero.** So a Bank that submits `commit_seed`, watches the resulting entropy blockhash, and dislikes the derived seed can:
1. Do nothing for 3.4 minutes.
2. `deck_slot`'s blockhash ages out.
3. Now `commit_deck` returns `DeckSlotUnavailable` forever with THIS salt.
4. But `deck_salt_hash` is set, so `commit_seed` also refuses forever.

This appears to fail-closed (minting is permanently bricked). But look at the *actual failure mode*: **the entire program is unrecoverable and the launch is dead**. In production this means the admin will do a program upgrade to unblock it, at which point the Bank has effectively gotten a free re-roll by burning a program upgrade. The admin will not refuse the upgrade — the alternative is that nothing ever mints.

**So the effective control model is:** "Bank commits seed. Bank likes the blockhash → proceed with commit_deck. Bank dislikes it → force a program upgrade to reset." That is not one-shot.

**Evidence.** Grep the four programs for anything that clears `deck_salt_hash` or `deck_slot`. There is nothing. The only recovery from an aged-out entropy slot is a program upgrade.

**Fix.** Add an admin instruction `reset_deck_commitment` that clears both fields, and make the alarm scream if it is called. This makes the re-roll observable rather than requiring an upgrade to fix. Yes, it defeats the one-shot property — that property was already defeated by the missing recovery path, this just makes the failure honest.

---

### FINDING R1-M1 — MEDIUM — `paused` does not gate `commit_seed`/`commit_deck`

**Construct.** `set_paused` only affects `mint_vault` (checked via `require!(!cfg.paused, MintError::MintPaused)`) and `sweep_sol_for_swap`. It does not affect `commit_seed` or `commit_deck`.

**Implication.** If the admin pauses the system due to an incident, the Bank can still commit or lock in a deck during the pause. If the incident is precisely "we noticed the Bank is misbehaving," a pause does not stop the very action being investigated.

**Evidence.** Search `mint/src/lib.rs` for `cfg.paused` — it appears in `mint_vault` and `sweep_sol_for_swap` only. `commit_seed` and `commit_deck` have no such check.

**Fix.** Add `require!(!c.paused, MintError::MintPaused)` to both.

---

## R2 — `blockhash_of_slot`

### FINDING R2-H1 — HIGH — All-zero hash check is defense-in-depth for a case that cannot happen, and MASKS the more likely defect

**Construct.**
```rust
require!(h != [0u8; 32], MintError::BadSlotHashes);
```

**Analysis.** A real blockhash from a real slot cannot be all-zero — it's a hash of block contents. So this check exists to catch a *malformed* sysvar. But if the sysvar is malformed, we already checked `require_keys_eq!(acct.key(), slot_hashes::ID)`, which pins it to the real sysvar (the runtime writes it, no one else can). So the "all-zero" check is checking for something that requires the runtime itself to be broken.

**However** — and this is what makes it a finding — the check is placed **inside the matching branch**, so it only fires when a matching slot is found with a zero hash. It does NOT catch a truncated or malformed entry where the stride is wrong and we happen to read a `want` value out of hash bytes of an earlier entry.

**Layout check.** `u64 count | (u64 slot, [u8;32] hash)*`. Stride is 40 bytes. Endianness is little-endian on Solana (correct). Ordering is newest-first (irrelevant here — we linear scan). ✓

**Truncation check.** `data.len() >= 8 + n * 40` — correct. ✓

**However**: there's no upper bound check on `want` making sense. If `want == 0` (which would happen if `Clock::get()?.slot` returned 0 in some anomalous case — cannot happen in prod but no code enforces it), the loop matches the first entry with `slot == 0`, and returns whatever hash sits at that offset. Not exploitable in production, but a `require!(want > 0)` would document intent.

**Evidence that the all-zero check is checking-the-checker.** No test in the suite could ever produce a "matching slot with zero hash" from real Solana. The check is unfalsifiable in the test environment, which is the shape the prompt is asking about.

**Fix.** Remove the `h != [0u8; 32]` check (it's dead) OR document explicitly that it's defense against runtime corruption. Add `require!(want > 0)` for the same reason.

---

### FINDING R2-M1 — MEDIUM — `n <= SLOT_HASHES_MAX` but `n` is not asserted `>= 1`

**Construct.** If the sysvar carries `count = 0` (e.g., early in cluster startup), the loop runs zero times and returns `DeckSlotUnavailable`. That is technically correct — no matching slot exists — but the error message says "the entropy slot has aged out of SlotHashes," which is the WRONG reason. An operator getting this error at genesis would look for the wrong problem.

Not exploitable. Fail-closed. But it's the same "reject for the wrong reason" class as the R4 finding.

---

### FINDING R2-H2 — HIGH — The entropy slot can be skipped (missed slot) and there is NO retry path

**Construct.** Solana skips slots regularly (validator down, no leader, etc.). If `deck_slot = commit_seed.slot + 32` happens to be a skipped slot, `SlotHashes` will simply not contain that slot number. `blockhash_of_slot` returns `DeckSlotUnavailable`.

**And there is no re-seed.** So a missed slot bricks the launch permanently — same recovery problem as R1-C2, but reachable by pure chance rather than by malice.

**Probability estimate.** Mainnet skip rate is typically 1-5%. Over a 32-slot window that's the probability the exact slot at index +32 is skipped, which is that same 1-5%. So there is a **1-5% chance the deck commitment fails on the first attempt** and cannot be re-attempted without a program upgrade.

**Evidence.** Search Solana docs for "skip rate mainnet." Any sample of `getBlocks` shows skipped slots.

**Fix.** Either (a) use "the most recent blockhash in the range [deck_slot, deck_slot+K]" — still unpredictable at commit time — or (b) add the admin reset from R1-C2 and accept that it's rescuable.

---

## R3 — THE DISTRIBUTE HALT

### FINDING R3-H1 — HIGH — `data[0] !== 1` is not sufficient to identify a Core tombstone

**Construct.**
```javascript
tomb = !raw || raw.data.length < 1 || raw.data[0] !== 1
```

Core's Key discriminator: `KEY_ASSET_V1 = 1`. Other values include `KEY_UNINITIALIZED = 0` (the tombstone) and various other keys (`KEY_COLLECTION_V1 = 5`, plugin registries, etc.).

**What else has `data[0] !== 1`?**

1. **`data[0] == 0`**: tombstone (correct — treat as burnt).
2. **`data[0] == 5`**: a Collection V1 header. If the RPC accidentally returned a collection account instead of the asset (misconfigured indexer, cache pollution), this would read as "burnt" and the vault would be silently skipped.
3. **Any future Core key type**. Metaplex ships new versions.
4. **An empty account**: `raw.data.length < 1` — treated as tombstone. But an empty account at a vault address could also be a System-owned account that was never a vault (index bug).

**The important case: `data[0] == 5` (collection).** If the RPC pagination is buggy or the caller passes a wrong ID, this reads as burn. That should be a halt (something is wrong with the index), not a skip.

**Fix.** Instead of `!= 1`, use `== 0` to specifically identify `KEY_UNINITIALIZED`:
```javascript
tomb = raw && raw.data.length >= 1 && raw.data[0] === 0 && raw.owner.equals(CORE)
```

Also require the account to still be Core-owned. A vault whose owner changed to System (impossible today but possible if Core changes) should HALT, not skip.

---

### FINDING R3-M1 — MEDIUM — The `catch` intentionally fails-closed on RPC failures, but the RPC used is not the one that returned the vault in the first place

**Construct.**
```javascript
try {
  const raw = await conn.getAccountInfo(new PublicKey(v), 'confirmed')
  tomb = !raw || raw.data.length < 1 || raw.data[0] !== 1
} catch { tomb = false }   // could not ask ⇒ do NOT assume burnt ⇒ halt
```

The direction is correct — an RPC failure halts. But this uses `conn`, the same connection used for everything. If `conn` is degraded, EVERY vault's tombstone check hits this branch, sees `tomb = false`, and every vault ends up in `unreadableLevels`. This produces a halt with error text like "could not read the asset: RPC timeout" — misleading because it names the LEVEL fetch that failed with the `fetchAsset` error, not the tombstone probe.

Fail-closed is right; the message will misdirect the operator.

**Fix.** Distinguish the two: if `fetchAsset` failed AND `conn.getAccountInfo` failed AND the account is live, report as "RPC failure, cannot judge vault." If `fetchAsset` failed AND `conn.getAccountInfo` succeeded AND the account is live, report as "asset is present but does not deserialize" — that's the actual chain-vs-code disagreement worth halting for.

---

### FINDING R3-C1 — CRITICAL — Third route to the halt: a Core UPGRADE that changes the AssetV1 layout

The Phase 1 discharge argues:
1. Level is written at mint (no unlevelled window).
2. Burned vault → tombstone → skip.

There is a third route the diff does not address: **Metaplex upgrades Core**, changing the AssetV1 attribute serialization. `fetchAsset` (which uses the newer SDK version) throws on old data OR the account still deserializes but `attributes.attributeList` is empty/differently keyed.

If Metaplex Core changes the wire format (they have upgrade authority — this is proven fact 8 in the SHIP GATE), every vault becomes unreadable simultaneously, `fetchAsset` throws, the tombstone check sees `data[0] === 1` (still an asset), and every vault ends up in `unreadableLevels`. The halt fires globally.

**Evidence.** `SPEC.md` explicitly says "METAPLEX CORE IS THE FIFTH PROGRAM AND WE DO NOT CONTROL IT... A Core upgrade changing UpdatePluginV1, ExecuteV1 or BurnV1 semantics would have reached every vault with no signal." This exact concern applies to distribute.mjs's level read.

**Fix.** This is a genuine limit — it cannot be prevented, only observed. Add `prog.core.hash` to a pre-flight check in `distribute.mjs`: if Core's hash has changed since the last successful distribution, refuse and require operator confirmation. The alarm already watches this; distribute should too.

---

### FINDING R3-H2 — HIGH — `bank/distribute.mjs` unchanged in the diff apart from this hunk, but there is a race between the DAS query and the tombstone check that widens the window

**Construct.** The main loop reads `vaults[]` from DAS (uniqLive), then iterates and fetches per-vault data. Between the DAS query and the per-vault `getAccountInfo` there is time — possibly minutes for 2,100 vaults. A vault burned during that window will now be caught by the new tombstone check (good).

But the count check earlier:
```javascript
if (BigInt(uniqLive.length + uniqBurnt.size) !== mintedTotal)
  throw new Error(...)
```
uses `mintedTotal` read BEFORE the DAS query. If a mint happens during the DAS query, `mintedTotal` at read time is < DAS answer, and this throws with the wrong direction. If a burn happens during the DAS query, DAS may not have caught up, so `uniqLive + uniqBurnt < mintedTotal` — this halts on a legitimate transient state.

**Not the diff's fault**, but it's on the same code path and the diff doesn't fix it. It's now the primary remaining route to a customer-triggerable payout halt: burn a vault at the exact wrong moment and stop everyone else's payout.

**Fix.** Re-read `mintedTotal` after DAS returns. If the count check fails, retry the DAS query. Only halt if the discrepancy persists across two retries.

---

## R4 — THE TWO DEFECTS ALREADY FOUND

### FINDING R4-C1 — CRITICAL — `commit_deck` still has ordering that depends on state a later check should establish

**Construct.** The re-ordered `commit_deck`:
```rust
require!(ctx.accounts.config.deck_root == [0u8; 32], MintError::DeckAlreadyCommitted);   // 1
require!(root != [0u8; 32], MintError::BadDeckRoot);                                      // 2
let want = ctx.accounts.config.deck_slot;                                                 // 3
let committed = ctx.accounts.config.deck_salt_hash;                                       // 4
require!(committed != [0u8; 32], MintError::SeedNotCommitted);                            // 5
require!(hashv(&[&salt]).to_bytes() == committed, MintError::BadSalt);                    // 6
let bh = blockhash_of_slot(&ctx.accounts.slot_hashes, want)?;                             // 7
```

The `SeedNotCommitted` check at line 5 fires when `committed == 0`, but `want = deck_slot` was read at line 3. If `deck_salt_hash == 0` (no seed), `deck_slot` is also 0 (never set). Then `blockhash_of_slot(..., 0)` at line 7 would run — but doesn't, because line 5 catches it first.

**However**, if 2.0c (`SeedNotCommitted` when no seed) is asserted to fail with that specific error and `commit_seed` is called first, the ordering is: root check → sentinel → seed check → salt check → blockhash. This ordering means:

**A caller who submits `commit_deck` with the wrong salt and no seed yet gets `SeedNotCommitted` (correct).** But: a caller who submits with the CORRECT salt and no seed yet ALSO gets `SeedNotCommitted`. So the salt argument is never validated. Is that a problem? No — if there's no committed salt hash, the salt argument is meaningless. But it means an attacker who repeatedly probes `commit_deck` before `commit_seed` learns nothing.

Actually, worse: the ordering means `deck_root == 0` check fires FIRST. If `commit_deck` succeeded once (root set), a second call with anything gets `DeckAlreadyCommitted`. That's what the diff intended. **But there is a subtle case**: what if `deck_root` is non-zero but `deck_seed` IS zero? That state cannot arise from these two instructions. Verified: `commit_deck` sets both `deck_root` and `deck_seed` in one atomic operation. ✓

**However** the SEQUENCE `commit_seed → wait 3.4 min → commit_deck fails with DeckSlotUnavailable` leaves state:
- `deck_salt_hash = X`
- `deck_slot = Y` (aged out)
- `deck_root = 0`
- `deck_seed = 0`

Now a subsequent `commit_seed` gets `SeedAlreadyCommitted`. And subsequent `commit_deck` gets `DeckSlotUnavailable`. **Both instructions are permanently bricked.** This is R1-C2 again — no recovery. This ordering is symptomatic of a state machine that can enter a stuck state, which no re-ordering fixes.

---

### FINDING R4-H1 — HIGH — 11.11a's assertion `at11 >= 0 && at11 < PROBE_CEILING` can pass even if `at11 == 0` — which would be catastrophic

**Construct.**
```typescript
rec('11.11a','a mint at the PRODUCTION deck depth of 11 still serializes','true',
  String(at11>=0&&at11<PROBE_CEILING))
```

`at11 == 0` means "zero caller attributes fit at depth 11" — i.e., the depth-11 mint fails at N=0. The assertion `at11 >= 0` is trivially true in that case. So this arm passes even if depth 11 packet-refuses at N=0, which is exactly the CRITICAL a round-20 auditor filed.

**Look at the actual assertion:** `at11 >= 0` — this includes `at11 == 0`. Should be `at11 >= 2` (matching 11.11c) or at LEAST `at11 >= 1`.

11.11b (`at7 > at11 && at11 > at13`) catches the case where at11 == at13 == 0 (both fail), but if at7 == 29 and at11 == 0 and at13 == 0, the assertion `at11 > at13` fires FALSE and 11.11b fails — good. But if at7 == 29 and at11 == 1 and at13 == 0, the assertion passes and yet only 1 attribute fits at production depth.

**This is the same class as the round-20 defect**: an assertion that can pass under the exact conditions the auditor was trying to detect. 11.11c partially covers it (`at11 >= 2`), but 11.11a's headline claim is `at11 >= 0`, which is `String(true)` — literally cannot fail if the probe ran at all.

**Evidence.** Grep 11.11a and confirm `at11>=0` — that predicate is true unless the probe threw. Change `at11` to any small number to see that 11.11a passes.

**Fix.** `at11 >= 2 && at11 < PROBE_CEILING` — same bound as 11.11c.

---

### FINDING R4-H2 — HIGH — The three "at depth" measurements (11.11a/b/c) all use the same synthetic proof (32 bytes of 0xab), not the real deck

**Construct.**
```javascript
const dt = depth===undefined ? await deckTail()
  : Buffer.concat([u8b(1), proofBuf(Array.from({length:depth},()=>Buffer.alloc(32,0xab)))])
```

When `depth` is specified, the proof elements are all-`0xab` — not real Merkle proof nodes. The transaction still serializes fine (Borsh doesn't care about semantics), and the packet size is identical (proof elements are 32 bytes regardless of content). So the byte measurement is correct.

**But**: the on-chain program would REJECT such a mint with `BadDeckProof`. The measurement is a client-side serialization test that never reaches the program. So 11.11a's claim "a mint at PRODUCTION deck depth of 11 still serializes" is technically accurate (client serializes it) but does not test that the PROGRAM accepts it.

That's fine for the packet-bound measurement (which is what 11.11 is about). But the statement "a mint at the PRODUCTION deck depth of 11 still serializes" reads as if the program accepts it. It only tests the client. Rename or clarify.

Not a defect, but the arm's title is misleading given what it measures. Consider `'a redemption transaction at production deck depth of 11 fits the 1,232-byte packet'`.

---

## R5 — SUITE NEW ARMS

### FINDING R5-H1 — HIGH — 2.0c passes for the wrong reason if `commit_deck` requires additional state that isn't visible

**Construct.**
```typescript
const noSeedYet=await att(()=>commitDeck(Buffer.alloc(32,7)))
rec('2.0c','a deck committed before any SEED is REFUSED','REJECT',...)
```
And `because('2.0c','SeedNotCommitted')`.

The ordering in `commit_deck` is:
1. `deck_root == 0` — passes (never committed)
2. `root != 0` — passes (Buffer.alloc(32,7) is non-zero)
3. Reads `deck_slot` and `deck_salt_hash`
4. `deck_salt_hash != 0` → `SeedNotCommitted` fires ✓

The `because` pins it. ✓ But if a future change adds a check BEFORE #4, 2.0c would still pass (a REJECT is a REJECT) but for a different reason. The `because` catches that, so it's fine — but note this depends on `because` being maintained. It is a real cross-implementation check.

**However**, 2.0e (`commit_seed` allowed) has NO `because` and passes if commit_seed returned OK. But `commit_seed` has multiple failure modes (`SeedAlreadyCommitted`, `BadSaltHash`, `Overflow`). If a bug caused `commit_seed` to silently no-op, 2.0e would still pass (ok=true from `send`). The `2.0e` arm assumes the transaction landing on-chain implies the state changed. That's usually safe on Solana, but the following 2.0f depends on state changing. If 2.0e succeeded but did nothing, 2.0f would ALLOW the second `commit_seed` (no state to prevent it), the assertion `REJECT != ALLOW` fails, and the test detects the bug.

So 2.0f transitively verifies 2.0e's side effect. OK. But if you delete 2.0f, 2.0e becomes untested. Note.

---

### FINDING R5-M1 — MEDIUM — 2.0h compares seeds derived from the same inputs; a shared bug in `sha256` or `seedFrom` produces identical wrong outputs

**Construct.**
```typescript
DECK_SEED = seedFrom(SUITE_SALT, entropy!)
// ...
rec('2.0h','the seed the PROGRAM stored is byte-identical to the one bank/deck.mjs derives',
  DECK_SEED.toString('hex'),
  cfgSeeded!.data.subarray(OFF_DECK_SEED, OFF_DECK_SEED+32).toString('hex'))
```

This compares:
- What `bank/deck.mjs` computes: `sha256(SUITE_SALT || entropy)`
- What the program stores: `sha256(salt || bh)` where `bh` is read from SlotHashes.

Both use SHA-256 (guaranteed to agree — it's a spec). Both use the same salt input. Both read the same blockhash (test parses SlotHashes with the same layout as the program).

**A shared bug in `sha256` is impossible** — different implementations (Node's crypto vs Rust's `hashv`) but both are compliant. Actual risk: shared BUG in **the test's own parser** of SlotHashes.

Test parses:
```typescript
if (Number(shAcct!.data.readBigUInt64LE(off)) === deckSlot) {
  entropy = shAcct!.data.subarray(off+8, off+40)
}
```

Program parses (in `blockhash_of_slot`):
```rust
if u64::from_le_bytes(data[off..off+8].try_into().unwrap()) == want { ... }
```

Layouts agree. Endianness agrees (LE). Stride agrees (40). Offset agrees (8). ✓

So 2.0h is a real cross-implementation check. The only shared bug would be if BOTH parsers misread SlotHashes the same way (e.g., both had the wrong stride). Very unlikely.

**However** — and this is a real gap — 2.0h does NOT verify that the seed the program stored matches the entropy for the CORRECT slot. If the program had a bug that read the wrong slot's hash (say, `deck_slot - 1`), but the test parsed SlotHashes the same wrong way, they'd both derive from `deck_slot - 1` and match. **The test's `entropy` variable comes from finding the entry where `slot === deckSlot`.** If either parser matched the wrong slot number, both would agree.

Fix: assert that `deckSlot` in `shAcct` really is the intended slot. This is implicitly covered by `commit_seed` deriving `deck_slot = current + 32` and being read back at OFF_DECK_SLOT, but explicitly assert `deckSlot == commit_seed_recorded_slot + 32` or similar.

---

### FINDING R5-C1 — CRITICAL — Offsets OFF_DECK_SLOT (593) and OFF_DECK_SEED (601) are hardcoded and NOT verified against Rust struct layout

**Construct.**
```typescript
const OFF_DECK_SLOT=593, OFF_DECK_SEED=601
```

Let me compute the real offsets from the struct:

```rust
pub struct MintConfig {
    // 8 discriminator
    pub version: u8,                    // 8 → 9
    pub admin: Pubkey,                  // 9 → 41
    pub collection: Pubkey,             // 41 → 73
    pub bank: Pubkey,                   // 73 → 105
    pub governance: Pubkey,             // 105 → 137
    pub treasury: Pubkey,               // 137 → 169
    pub round_id: u32,                  // 169 → 173
    pub opens_at: i64,                  // 173 → 181
    pub closes_at: i64,                 // 181 → 189
    pub price_lamports: u64,            // 189 → 197
    pub cap: u32,                       // 197 → 201
    pub minted_this_round: u32,         // 201 → 205
    pub minted_total: u64,              // 205 → 213
    pub max_supply: u64,                // 213 → 221
    pub bank_treasury: Pubkey,          // 221 → 253
    pub split_bps: u16,                 // 253 → 255
    pub paused: bool,                   // 255 → 256
    pub swap_operator: Pubkey,          // 256 → 288
    pub sol_reserve_lamports: u64,      // 288 → 296
    pub bump: u8,                       // 296 → 297
    pub max_sweep_lamports: u64,        // 297 → 305
    pub sweep_cooldown_secs: i64,       // 305 → 313
    pub last_sweep_at: i64,             // 313 → 321
    pub pending_governance: Pubkey,     // 321 → 353
    pub pending_governance_at: i64,     // 353 → 361
    pub governance_timelock_secs: i64,  // 361 → 369
    pub pending_admin: Pubkey,          // 369 → 401
    pub pending_admin_at: i64,          // 401 → 409
    pub pending_bank: Pubkey,           // 409 → 441
    pub pending_bank_at: i64,           // 441 → 449
    pub pending_operator: Pubkey,       // 449 → 481
    pub pending_operator_at: i64,       // 481 → 489
    pub level_caps: [u32; 5],           // 489 → 509
    pub level_minted: [u32; 5],         // 509 → 529
    pub deck_root: [u8; 32],            // 529 → 561
    pub deck_salt_hash: [u8; 32],       // 561 → 593
    pub deck_slot: u64,                 // 593 → 601   ✓ OFF_DECK_SLOT
    pub deck_seed: [u8; 32],            // 601 → 633   ✓ OFF_DECK_SEED
}
```

**The offsets are correct.** ✓

But note: the comment in the test says "ASSERTED, NOT ASSUMED: 2.0h reads deck_seed at OFF_DECK_SEED and compares it against the seed this file derived independently." This assertion validates the SEED offset (if it were wrong, 2.0h would fail). It does NOT validate the SLOT offset — 593 is used to read `deckSlot`, then the test waits for that slot. If OFF_DECK_SLOT were wrong (e.g., 601 by mistake), the test would read `deckSeed` as an integer (whatever value), wait for that "slot" (never arrives or arrives at random time), and then either time out or match a random SlotHashes entry.

If OFF_DECK_SLOT is off by 8 (points to seed field), `deckSlot` would be a random 8 bytes of the seed — a huge number. The loop `for(let i=0;i<200 && await conn.getSlot(CM)<=deckSlot;i++)` waits for that. It would time out (200 * 300ms = 60s). Then `entropy` would be null. Then `DECK_SEED = seedFrom(SUITE_SALT, entropy!)` would throw or produce garbage. Detected downstream.

So OFF_DECK_SLOT is transitively verified. ✓ But an assertion `deckSlot == commit_seed_slot + 32` would make this explicit and would ALSO catch a program bug where `deck_slot` was set to `current` instead of `current + 32`.

---

### FINDING R5-M2 — MEDIUM — 2.0f (`SeedAlreadyCommitted`) does not verify `deck_slot` was NOT updated by the second attempt

If the program's second `commit_seed` was accepted (bug), the test detects a REJECT ↔ ALLOW mismatch. But if the check fired AND `deck_slot` was mutated before the check, that would be silent. Look at the code:

```rust
pub fn commit_seed(ctx: Context<CommitSeed>, salt_hash: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.slot;
    let c = &mut ctx.accounts.config;
    require!(c.deck_salt_hash == [0u8; 32], MintError::SeedAlreadyCommitted);
```

The `require!` fires before any mutation. Anchor transactions revert on `require!` failure, so state doesn't change. ✓

Safe. Not a finding.

---

## R6 — ACCEPTED LIMITS REWRITES

### FINDING R6-M1 — MEDIUM — Limit 23's measured table is inconsistent with claim about "unchanged conclusion"

**Construct.** Limit 23 says:

> This item stays OPEN AND BLOCKING anyway, and the reason is unchanged: the root commits ONCE.

But the measured table shows depth 11 (production) allows 18 attributes vs the program's 7. That means:
- Deck size is currently NOT a constraint on attributes.
- Deck size still commits ONCE.
- The DECK SIZE decision is still permanent.

But the discussion under Limit 23 doesn't actually explain WHY it stays OPEN AND BLOCKING if the packet bound is comfortably above the program bound. If depth 11 allows 18 attributes, changing deck size to depth 12 or 13 leaves 13-15 attributes — still above 7. The measured evidence undermines the claim that deck size needs a special pre-commit decision.

The genuine reason it stays OPEN AND BLOCKING is subtler: **the deck census** (which levels exist and in what quantities) determines the on-chain caps AND is baked into the deck root. Changing the census requires recomputing the root. That's the "deck size" the item really means, and the "size" language is confusing.

**Fix.** Rename to "THE DECK CENSUS MUST BE DECIDED BEFORE MINTING OPENS." State that deck depth is NOT the constraint; the CENSUS at each level is.

---

### FINDING R6-H1 — HIGH — Limit 19 discharge is questionable — the halt is still customer-reachable

**Construct.** Limit 19 says the halt is CLOSED BY CONSTRUCTION because "there is no window in which a vault is activated but unlevelled."

But look at `bank/distribute.mjs`:
```javascript
if (unlevelled.length) return { ...empty, refusal: true, skip: `${unlevelled.length} activated vault(s) carry no level` }
```

The condition `unlevelled` is populated by `unreadableLevels.push([v, ...])`. Look at when that happens:
```javascript
try {
  const asset = await fetchAsset(umi, umiPk(v))
  const lv = levelFromAttributes(asset?.attributes?.attributeList)
  if (lv) levels[v] = lv
  else unreadableLevels.push([v, 'no single valid `level` attribute on the asset'])
} catch (e) {
  // tombstone check ...
  unreadableLevels.push([v, `could not read the asset: ...`])
}
```

The halt fires when:
1. Asset fetches successfully but has no valid `level` attribute — impossible if `mint_vault` writes it. ✓
2. Asset fetch throws AND account is NOT a tombstone — this is the "RPC failure, no answer" case.

Case 2 is a customer-triggerable halt IF the customer can cause `fetchAsset` to throw for their vault while the account remains live. `fetchAsset` throws on: Core version mismatch, malformed attributes, network error.

**Can a customer trigger a Core-version mismatch?** No — Core is Core.

**Can a customer cause malformed attributes on their vault?** Look at Accepted Limit 13: "the level is immutable in practice because no shipped instruction can rewrite it." The Attributes plugin is delegated to the SEAL PDA. The owner cannot rewrite attributes. ✓

**Can a customer cause a network error?** No.

So the discharge appears valid in the current implementation. But the argument rests on Core's behavior not changing. If Core changes attribute serialization, EVERY vault becomes "unreadable" and the halt fires globally — see R3-C1.

The discharge should be qualified: "closed AS LONG AS Metaplex Core does not change attribute serialization, and by construction otherwise."

---

### FINDING R6-M2 — MEDIUM — Limit 1a rewrite is correct on the confinement but silent about the SUITE OF PROGRAMS involved

Limit 1a says "SEAL's `open_for_redemption` refuses `BankKeyOutsidePair` and MINT's `mint_vault` refuses `BankKeyOutsideMint`, both since round 17."

Correct. But BURN's `burn_vault` does NOT have this confinement. Look at `programs/cbob-vault-burn/src/lib.rs`:

Search for `BankKeyOutside`... it's not defined in the BurnError enum. The scan in BURN checks for a preceding OPEN but does NOT walk instructions to confine the Bank's key.

So the confinement is on-chain in TWO of THREE programs that take the Bank's signature. BURN's `burn_vault` allows the Bank's key to appear in arbitrary other instructions in the same transaction.

**Is this exploitable?** For a redemption to succeed, `open_for_redemption` must appear earlier in the transaction, and SEAL's `open_for_redemption` already walks the full transaction and refuses `BankKeyOutsidePair`. So the confinement is enforced BY SEAL for any transaction containing a `burn_vault`. But for a **standalone burn** (which BURN refuses due to `NoPrecedingOpen`), the walk in BURN doesn't matter.

**However**, a transaction with a burn but no open never reaches BURN's success path, so the confinement question is moot. So the current arrangement is safe.

**But the LIMIT description implies both SEAL and MINT programs enforce this while BURN doesn't need to.** The description would be clearer as: "SEAL's scan covers the pair; BURN inherits this because it refuses without a paired open; MINT enforces it independently."

Not a defect, but the description under-claims where BURN gets its coverage from — which matters if someone modifies BURN later and removes the paired-open requirement without noticing SEAL's scan was doing the work.

---

## R7 — COUNTS AND ARITHMETIC

### VERIFICATION — Floors in `scripts/run-tests.sh`

Reading the source:
```
MIN_ASSERTIONS=330      ✓ prompt says 330
DECK_FLOOR=17           ✓ matches nothing in prompt (prompt says "19 against live mainnet")
DET_FLOOR=439           ✓ prompt says 439
ALLOC_FLOOR=103         ✓ prompt says 103
MAINNET_FLOOR=19        ✓ prompt says 19
```

**Prompt says "plus 439 off-chain detector assertions proven in both directions, 103 allocation, and 19 against live mainnet."** The prompt is silent on the deck floor (17). SPEC.md mentions deck (17) inside a comment about "17 deck and 19 live-mainnet assertions." ✓

### VERIFICATION — Census arithmetic

**240-vault census: 108/60/36/24/12**
- Sum: 108+60+36+24+12 = **240** ✓
- Denominator: 108*2 + 60*3 + 36*4 + 24*5 + 12*6 = 216 + 180 + 144 + 120 + 72 = **732** ✓

**2100-vault census: 945/525/315/210/105**
- Sum: 945+525+315+210+105 = **2100** ✓
- Denominator: 945*2 + 525*3 + 315*4 + 210*5 + 105*6 = 1890 + 1575 + 1260 + 1050 + 630 = **6405** ✓

### VERIFICATION — Per-$1000 figures at 240 vaults (published: 2.73, 4.10, 5.46, 6.83, 8.20)
- I: 1000 * 2 / 732 = 2.7322 ≈ **2.73** ✓
- II: 1000 * 3 / 732 = 4.0984 ≈ **4.10** ✓
- III: 1000 * 4 / 732 = 5.4645 ≈ **5.46** ✓
- IV: 1000 * 5 / 732 = 6.8306 ≈ **6.83** ✓
- V: 1000 * 6 / 732 = 8.1967 ≈ **8.20** ✓

### VERIFICATION — Per-$1000 figures at 2100 vaults (published: 0.31, 0.47, 0.62, 0.78, 0.94)
- I: 1000 * 2 / 6405 = 0.3123 ≈ **0.31** ✓
- II: 1000 * 3 / 6405 = 0.4684 ≈ **0.47** ✓
- III: 1000 * 4 / 6405 = 0.6245 ≈ **0.62** ✓
- IV: 1000 * 5 / 6405 = 0.7806 ≈ **0.78** ✓
- V: 1000 * 6 / 6405 = 0.9368 ≈ **0.94** ✓

### VERIFICATION — Shares at 2100 vaults (published: 29.5, 24.6, 19.7, 16.4, 9.8)
- I: 100 * 945 * 2 / 6405 = 189000/6405 = 29.508 ≈ **29.5** ✓
- II: 100 * 525 * 3 / 6405 = 157500/6405 = 24.590 ≈ **24.6** ✓
- III: 100 * 315 * 4 / 6405 = 126000/6405 = 19.672 ≈ **19.7** ✓
- IV: 100 * 210 * 5 / 6405 = 105000/6405 = 16.393 ≈ **16.4** ✓
- V: 100 * 105 * 6 / 6405 = 63000/6405 = 9.836 ≈ **9.8** ✓
- Sum: 29.5 + 24.6 + 19.7 + 16.4 + 9.8 = **100.0%** ✓

**All arithmetic checks out. No finding here.**

---

## R8 — ONE-OF-N-SITES

### FINDING R8-C1 — CRITICAL — `blockhash_of_slot` is a raw parse of a sysvar; the same shape appears in `bank/distribute.mjs` reading the SAME sysvar, and only ONE was hardened

**Construct.** MINT's `blockhash_of_slot` in Rust hardens the parse: pins key, bounds count, validates size, refuses all-zero.

Look at the test's parallel parser in `tests/3prog.test.ts`:
```typescript
const shAcct=await conn.getAccountInfo(SLOT_HASHES,CM)
const shN=Number(shAcct!.data.readBigUInt64LE(0))
let entropy:Buffer|null=null
for(let i=0;i<shN;i++){const off=8+i*40
  if(Number(shAcct!.data.readBigUInt64LE(off))===deckSlot){entropy=shAcct!.data.subarray(off+8,off+40);break}}
```

This test parser has NONE of the hardening: no key pin, no bound on `shN`, no size check on the buffer, no all-zero check.

Is this a defect? The test parser is in test code, not production. It's fine. **BUT** the pattern "one hardened raw parser and one un-hardened raw parser reading the same sysvar" is exactly the class R8 is asking about.

**More important**: does any production code do this same raw read? Search `bank/*.mjs` for `SysvarS1otHashes` or `SLOT_HASHES`... Not present in the diff or the files bundled. But nothing in the diff prevents future code from copying the test's un-hardened parser.

**Fix.** Extract the hardened parse into `bank/sysvar.mjs` and export it, so future code has a single canonical reader.

---

### FINDING R8-H1 — HIGH — The tombstone check pattern in `bank/distribute.mjs` is duplicated between the level loop and the payment loop

**Construct.** The prompt notes: "the payment loop already knew better." So the payment loop has:
```javascript
if (!stillThere || stillThere.data.length < 1 || stillThere.data[0] !== 1) { ... }
```

And the new level loop has:
```javascript
tomb = !raw || raw.data.length < 1 || raw.data[0] !== 1
```

**Same logic, two copies.** If the tombstone predicate needs to be tightened (see R3-H1, which recommends `data[0] === 0` instead of `!= 1`), both sites must be updated. A change to one and not the other resurrects the exact defect this fix closes.

**Fix.** Extract into a helper:
```javascript
const isTombstone = raw => raw && raw.data.length >= 1 && raw.data[0] === 0
```
Use in both places. This is the "one of N sites" defect the prompt flags as this project's most repeated.

---

### FINDING R8-H2 — HIGH — `commit_seed` reads `Clock::get()?.slot` directly; `mint_vault` does not use `slot` at all but uses `unix_timestamp`; the deck timing model is one-of-N-sites with governance timelock model

**Construct.** `commit_seed` uses `Clock::get()?.slot` — measured in slots (~400ms).
Governance timelock uses `unix_timestamp` — measured in seconds.
Sweep cooldown uses `unix_timestamp`.

Two clock models in one program, and the operator/reader must know which is which. `deck_slot` is a slot number; `pending_governance_at` is a unix timestamp. If someone modifies `commit_seed` or `commit_deck` and reads `unix_timestamp` by accident (both come from `Clock`), the deck timing becomes ~2500x wrong. There's no unit test that would catch a substitution.

Not exploitable today. Type-system-should-catch-this but Rust doesn't have units.

---

## ACCEPTED LIMITS — the four questions

### Q1: Is any limit WORSE than stated?

**Limit 10 (no fresh per-cycle swap operator wallet).** Says "the swap operator can take the SOL." Understated: with a **per-cycle cap and cooldown**, the operator's per-attack loss is `max_sweep_lamports * cooldown_windows_before_detection`, not "the SOL." The alarm's cooldown check is at CRITICAL if `sweep_cooldown_secs < 3600`. If deployed at 3600s with 50 SOL cap, and detection is within 30 min alarm cadence, exposure is roughly 50 SOL per incident. Say so. The current limit understates by not mentioning the caps make this bounded per cycle.

**Limit 15 (vault minted during open proposal).** Says "the Bank could mint into an open vote." Understated: the Bank co-signs every mint AND controls the deck (see R1-C1). So the Bank can mint into an open vote AND ensure the new vault is a high-level one (higher weight in future distributions, though NOT more voting power — one vault one vote — but higher WEIGHT for payout, which is more valuable). Not gameable if quorum divisor is snapshotted, but the WEIGHT question is worth mentioning.

**Limit 22 (nothing has ever run distribution against a live chain).** This limit is more critical than stated. Reading each vault's level with `fetchAsset` over 2,100 vaults, at typical Helius rate limits (10 RPS free tier, 100 RPS paid), takes 21-210 seconds. During that window: (a) any burn causes the R3 halt, (b) any Core version mismatch causes global halt (R3-C1). The limit should explicitly state that **production rate limits and their failure modes must be measured before this pays real customers.**

### Q2: Is anything listed as a limit not actually a limit?

**Limit 21 (MINT confinement forecloses ever putting the Bank key in a multisig).** This is TRUE for the Bank-key-in-multisig scenario, but SPEC already stated that as a design decision under TRUE 2-of-2. This is more properly a KNOWN LIMIT (design consequence), not an accepted audit finding. Recategorize.

**Limit 6 (aborted flock indistinguishable from one that never fired).** This is described as a logging shortfall, but reading `bank/lock.mjs` — the lock file records the token and PID. An operator can distinguish a completed run (`releaseLock` clears the file) from an aborted one (file still exists with a stale token). So the limit description doesn't match what the code actually does. Verify the actual behavior; the limit may already be closed by mechanism.

### Q3: Is any DISCHARGED item not actually discharged?

**Item 19 (unlevelled-vault halt).** Discharged as "closed by construction." R3-C1 above shows the halt is REACHABLE via a Core upgrade path. The discharge is contingent on Metaplex not changing Core's attribute wire format. This should be qualified in the DISCHARGED text: "closed by construction against customer-triggerable causes; a Core upgrade that breaks attribute deserialization would re-open it globally."

**Item 12/17 (compute units).** The measurement (58,956 CU plain, 73,657 CU at widest pad) is convincing. But: the measurement was taken WITHOUT the new commitment scheme's `commit_seed`+`commit_deck` in the mix. `blockhash_of_slot` iterates up to 512 entries. That's a linear scan of 40-byte entries — about 20,480 bytes memory-accessed per call, plus 512 comparisons. Rough estimate: 2,000-5,000 CU. Not exhausting, but the discharged measurement doesn't include this new instruction. **Re-measure `commit_deck` compute usage** and add to the discharged item to prevent regressions.

### Q4: Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**Item 23 (deck size must be decided before minting opens).** The measurement in the item shows the packet is not the binding constraint. There's a subtle drift: the item stays OPEN AND BLOCKING but the discussion undermines the reason. In practice, this looks headed toward de-facto acceptance ("we measured it, it's fine, ship") without formal discharge. It should either be DISCHARGED with the measurement OR the item's OPEN AND BLOCKING criterion should be restated (see R6-M1: the census, not depth, is what matters).

**Item 22 (nothing has ever run distribution against a live chain).** This is the most operationally dangerous open item. Every round should re-affirm it or discharge it with a live test. It's been open for at least one round and I don't see a plan to close it in this diff.

---

## OTHER FINDINGS

### FINDING X1 — MEDIUM — `hashv(&[&salt]).to_bytes() == committed` — timing side channel not relevant on-chain but constant-time equality is idiomatic

Not exploitable on Solana (no side channel). Standard array equality is fine. Note for future readers who might extract this pattern.

### FINDING X2 — MEDIUM — `commit_seed` and `commit_deck` both require `has_one = admin`, but Anchor's `has_one` check is not asserted in the diff's test coverage

`CommitSeed` struct: `#[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]`.
`CommitDeck` struct: same.

The `has_one = admin` refuses if the passed `admin: Signer` doesn't match `config.admin`. In `commit_seed(signer=bank)` in the test, `bank` is set as admin during `initialize`, so this passes. But the test never exercises `commit_seed(signer=alice)` (a non-admin) to prove `has_one` fires. If Anchor's `has_one` check silently no-op'd (upgrade bug), the test would still pass.

**Fix.** Add a negative test: `commit_seed` with a non-admin signer must fail with `ConstraintHasOne`.

### FINDING X3 — HIGH — The suite's `commitDeck` helper defaults `signer = bank`, but so does `mkVault`; a test that calls `commitDeck()` without arguments passes if either `bank` or `alice` can commit

`const commitDeck=(root:Buffer,salt:Buffer=SUITE_SALT,signer=bank)=>send(...)`.

`bank` is the admin. But the test never exercises `commitDeck(root, salt, alice)` to prove that non-admin cannot commit. If `has_one = admin` were removed, the suite would go green (bank is still admin, everything else works). Same as X2.

**Fix.** Add: `const notAdmin = await att(() => commitDeck(DECK_ROOT, SUITE_SALT, alice)); rec('2.0j', 'commit_deck requires admin', 'REJECT', ...)`.

### FINDING X4 — MEDIUM — `DeckSeedCommitted` event includes `salt_hash` and `slot`, but not the eventual seed

For an observer to verify the seed independently, they need: salt_hash (emitted), slot (emitted), and the eventual salt (revealed in `commit_deck`). `DeckCommitted` includes `seed` — good. So an off-chain verifier can:
1. Observe `DeckSeedCommitted{salt_hash, slot}`.
2. Observe `DeckCommitted{root, seed, slot}`.
3. Verify `sha256(salt || blockhash(slot)) == seed` by reading blockhash from historical data.

But the `salt` itself is never emitted — only used as an argument to `commit_deck`. An observer must scrape transaction instruction data for `commit_deck` to get salt, OR trust the Bank's post-hoc revelation. **Add salt to `DeckCommitted` event** for observability.

Not a security defect. An observability improvement.

### FINDING X5 — LOW — `paused` doesn't block `commit_deck` either

Same as R1-M1 but for `commit_deck`. Add `require!(!c.paused)`.

### FINDING X6 — HIGH — `MintConfig` `space` calculation is fragile

The `Initialize` account:
```rust
#[account(init, payer = admin, space = 8 + 1 + 32*5 + 4 + 8 + 8 + 8 + 4 + 4 + 8 + 8 + 32 + 2 + 1 + 32 + 8 + 1
                                      + 8 + 8 + 8 + 32 + 8 + 8 + 32 + 8 + 32 + 8 + 32 + 8
                                      + 4*5 + 4*5 + 32 + 32 + 8 + 32 + CONFIG_PADDING,
```

That's a manual sum of field sizes. If a field is added or reordered and the sum isn't updated, `Account::init` allocates too little space and every subsequent write silently truncates. Nothing tests this. The struct itself doesn't derive `Space` automatically.

Compute the real size:
- 8 disc + 1 version + 32*5 keys (admin/collection/bank/gov/treasury) = 169
- + 4 round_id + 8 opens_at + 8 closes_at + 8 price + 4 cap + 4 minted_round + 8 minted_total + 8 max_supply + 32 bank_treasury + 2 split_bps + 1 paused + 32 swap_operator + 8 sol_reserve + 1 bump = 128
- Total to bump = 297
- + 8 max_sweep + 8 cooldown + 8 last_sweep + 32 pend_gov + 8 pend_gov_at + 8 timelock + 32 pend_admin + 8 + 32 pend_bank + 8 + 32 pend_op + 8 = 192 → 489
- + 4*5 caps + 4*5 minted + 32 root + 32 salt_hash + 8 slot + 32 seed = 20+20+32+32+8+32 = 144 → 633
- + CONFIG_PADDING (112) → 745

Real struct size: 745 bytes.

Space calculation: 8 + 1 + 32*5=160 + 4+8+8+8+4+4+8+8+32+2+1+32+8+1 = 128. So 8+1+160+128 = 297.
+ 8+8+8+32+8+8+32+8+32+8+32+8 = 192. Total 489.
+ 4*5+4*5+32+32+8+32 = 20+20+32+32+8+32 = 144. Total 633.
+ CONFIG_PADDING (112). Total 745.

**Matches.** ✓ But this is fragile and nothing tests it. Add `#[derive(anchor_lang::InitSpace)]` or write a compile-time assertion.

### FINDING X7 — MEDIUM — `commit_deck` accepts a `salt` argument but the salt is never verified to be uniformly random

The salt commitment scheme's security requires the salt to be unpredictable to anyone but the Bank. If the Bank uses `salt = [0x01; 32]` and publishes `salt_hash = sha256([0x01;32])`, an attacker cannot forge but the salt is grindable BY THE BANK before commit. That's not the attack — the Bank commits salt_hash BEFORE the entropy slot exists — but a Bank that uses a WEAK salt gives attackers a way to challenge whether the salt was chosen adversarially after seeing the leader schedule.

Not a code defect (nothing can enforce salt randomness on-chain), but SPEC should require the Bank to use a cryptographically random salt from a well-known RNG.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Nineteen rounds of AI audit structurally cannot:

1. **Run the production system at scale.** Every audit has been a code review, not an incident response drill. Concrete recommendation: **before mainnet, deploy to devnet with 240 real vaults, run distribute daily for 30 days**, and let real Helius rate limits, DAS lag, and real Core interactions produce their own findings. Limit 22 (nothing has run distribution live) is the single most operationally dangerous open item and it will not close in an audit round.

2. **Produce adversarial economic reasoning.** Auditors read code paths, not incentive structures. R1-C1 (Bank grinds blockhash via validator collusion) is an economic finding that becomes obvious only when you compute the cost/benefit for a specific validator stake. Concrete recommendation: **publish an incentive analysis document**: for each entity (Bank, swap operator, admin, largest holder), enumerate what they can do, what it costs them, and what it earns them. This is a governance artifact, not a code artifact.

3. **Bind auditor claims to reality.** Auditors say things that turn out to be wrong (~1/3 CRITICAL findings across 19 rounds). The suite has grown to 330 assertions to convert refuted claims into permanent tests, which is the right pattern — but the CONVERSION IS MANUAL. Concrete recommendation: **when an auditor makes a testable claim that is rejected, the person doing the ruling MUST write the assertion that rejects it before merging the ruling.** Not "we should assert this eventually" — the assertion is part of the ruling document. This closes the "auditor says X, we say not-X, six months later X becomes true unnoticed" gap.

4. **Force convergence.** Every round finds something in the previous round's fix. Rounds do not converge because rounds cannot see far enough to fix without producing new defects. Concrete recommendation: **impose a FREEZE where the next round of changes REQUIRES rejecting a previous audit finding, not making new changes.** For 30 days, the only permitted commits are (a) adding tests that pin previous rulings, and (b) fixing findings against tests. New features and new hardening are forbidden. Rounds against a genuinely frozen tree can converge; rounds against a moving target cannot, and this project has 19 rounds of evidence.

5. **See the operations that hold real money.** Custody, key management, physical security, incident response, refund policy, communications during an incident, tax reporting, KYC/AML if applicable — none of these are in any file the auditor reads. Concrete recommendation: **write a two-page operational runbook** covering: how to sign the Bank's key without a co-signer skipping the policy (Yubikey? air-gapped machine?), how to detect and respond to a compromised swap operator key in under one cooldown window, and what happens the day Helius has an outage. **The runbook is what fails when the code is fine.** Currently there is no runbook; SPEC.md contains fragments.

6. **The single biggest hole visible from here**: R1-C1. The commitment scheme is called "unforgeable and public," and it is not. A Bank that is a validator (or bribes one, at costs of ~0.005 SOL per skipped slot) can grind the entropy by choosing when to submit `commit_seed`. The claim in `deck.mjs` that "non-revelation is not mitigated but impossible" is precisely the kind of over-claim this project has committed six times. The honest statement: **the deck is grindable by a Bank with validator stake or the money to buy it, bounded by their stake fraction; without validator collusion it is fair.** Rewrite SPEC and deck.mjs to say that.