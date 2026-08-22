## Findings

### H1 — HIGH — Thaw-window Token authorities on **non-ATA** accounts still survive reseal (v1 C3 / v2 H1 **moved**, not fixed)

`inspect_reserves` only looks at the two derived ATAs per `reserve_mints` entry. Anyone can `InitializeAccount` a **non-ATA** token account with `owner = asset_signer` (no PDA signature required to *create* it). During the thaw, `ExecuteV1` can `Transfer` the reserve there and `Approve` / `SetAuthority`.

**Exploit (one Bank-signed tx):**
1. Bank + owner sign `open_for_redemption`.
2. Owner (or malware/dApp that built the tx) `ExecuteV1`: create non-ATA cbBTC account owned by the PDA → `Transfer` ATA → non-ATA → `Approve(attacker, u64::MAX)`.
3. `close_redemption` with the empty, undelegated **ATAs** in `remaining_accounts`. Inspect passes; vault reseals; stamp=`opened`.
4. Attacker `Transfer`s later. No Execute, no Bank, vault still frozen.

This breaks claimed 2-of-2: after one approved redemption the owner/attacker moves reserve forever. It is also a customer-loss path if a legitimate redemption tx is extended with those inner CPIs and the Bank only checks “a matching close exists.”

ATA-only delegate/close_authority/owner checks are real for the honest ATA path. They do not close the hole.

**Fix:** Do not leave a generic Execute window. One instruction: thaw → program-built `ExecuteV1` of `Transfer` (reserve ATA → owner) only → inspect → reseal + stamp. Reject any other Token ix. If you keep the window, you cannot enumerate accounts and you cannot claim 2-of-2.

---

### H2 — HIGH — `burn_empty_vault` still cannot prove the reserve is gone (v1 C1 **relocated**, v2 H2 **unfixed**)

On-chain guarantee is only: PDA lamports == 0, **derived ATAs** declared and `amount == 0`, declared remaining accounts that *happen* to be shown are not live Core assets / not PDA-owned token accounts with base `amount > 0`. Completeness is unenforced. Token-2022 extensions are refused on ATAs only; the remaining_accounts loop still trusts bytes `[64..72]` and will burn through a confidential/non-zero withheld balance if that account is declared, or skip it if not.

**Exploit:** During a prior open, move cbBTC to a non-ATA (or never use the ATA). Later Bank+owner `burn_empty_vault` declaring the empty ATAs. `BurnV1` succeeds; PDA can never sign; reserve is gone.

SPEC’s “burn holding the reserve is impossible on-chain” is false. A scanner that mirrors this ATA loop will countersign the deletion.

**Fix:** Stop on-chain burn until a deposit registry exists, or drop `burn_empty_vault` entirely (owner can already Core-`BurnV1` per SPEC). Do not ship a burn that looks like a proof.

---

### M1 — MEDIUM — Collection update-authority lock is not in the program

The entire mint model is “collection UA = seal ⇒ Core `0x1a` on any other create.” `initialize` / `update_config` / `mint_vault` never read the collection account or require UA == `seal`. A wrong `config.collection` (or a later rotation) makes `mint_vault` fail and lets anyone create look-alike collection assets with arbitrary plugins; this program will still open/burn them and emit official events.

**Fix:** On init, update, and mint, parse the collection and `require` update authority == seal PDA.

---

### L1 — LOW — `close_redemption` has no Bank signer

Owner alone can reseal an already-frozen vault and overwrite Attributes to `redemption: opened`. Not a drain; it defaces the pristine marker the spec treats as the anti-resale signal.

**Fix:** Require `config.bank` on close, or no-op the stamp unless the freeze plugin is currently thawed.

---

### L2 — LOW — Hardcoded Core wire (`06 11 <bool>`, `06 06 …`, `0c 00`, plugin indices 17/6)

Still C8. 34 tests on today’s clone are not a pin against an upgradeable Core.

---

### Spec ≠ code

- “TRUE 2-of-2 / neither can move contents alone” — false after H1.
- “Burn holding the reserve is impossible on-chain” — false after H2.
- `update_config(collection?, bank?)` — code also rotates `admin` and `reserve_mints` (good; spec stale).
- Collection UA lock, mint-only-via-program — operational, not enforced (M1).

### v1/v2 fixes: real vs moved

| Item | Verdict |
|---|---|
| C1 close burns on `lamports==0` | **Real** on close |
| C1 emptiness | **Still on burn** (H2) |
| C3 / v2 H1 ATA delegate | **Real on ATAs**; **moved to non-ATA** (H1) |
| C4 permanent brick | **Real** (iterative redeem). Residual grief only |
| C5/C6/C7/C9/C10 | **Real** |
| v2 M1 admin/reserves immutable | **Real** (now rotatable) |
| v2 L2 init front-run | **Real** if `INIT_AUTHORITY` is the Squads key at build |
| C8 wire format | Unfixed (L2) |

### What I could not break

No leftover thaw if close is missing or fails (tx abort). No owner-alone or Bank-alone unseal. Introspection sees only top-level ixs; a CPI-fabricated close is invisible and open fails closed; ALTs resolve to real pubkeys. `seal` / `mpl_core` / `instructions` substitution held. `close_redemption` never burns. ATA delegate/close_auth/owner-change on the **derived reserve ATAs** is now rejected, including Token-2022 `len != 165`. Empty `reserve_mints` rejected. I did not find a way to thaw without a later top-level `close_redemption` for the same asset **and** owner.

---

**THE SINGLE THING:** Remove the open/arbitrary-Execute/close window. Redeem in **one** instruction that the program builds: unfreeze → `ExecuteV1` of a reserve-ATA `Transfer` to the owner only → inspect ATAs → refreeze + stamp. Do not hold customer cbBTC until leftover Token authorities cannot be planted on accounts you cannot enumerate.