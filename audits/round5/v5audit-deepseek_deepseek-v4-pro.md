**CRITICAL – No On-Chain Lifetime Supply Cap**  
The `mint_vault` handler increments `minted_total` but never checks it against a maximum. The `set_round` instruction only sets per‑round caps (`cap`); `minted_total` is purely informational. A governor majority can therefore:

1. Call `set_round(opens_at, closes_at, price_lamports=0, cap=0)`.
2. Have the Bank co‑sign `mint_vault` an unlimited number of times.

The result is unbounded inflation, diluting every existing vault’s vote and revenue share. The intended ~2,100 lifetime supply is an off‑chain promise with zero on‑chain enforcement.

**Fix:** Add a `max_total` field to `MintConfig` (set during `initialize` or by governance) and require `minted_total + 1 <= max_total` inside `mint_vault`.

---

**CRITICAL – Charter Provenance Is Never Written On‑Chain**  
The MINT program includes an `Attributes` plugin in `CreateV2` but supplies an *empty* attribute list. The business requires that charter‑member information (Notice serial, Governor standing) be “stamped onto the vault at mint and be the ONLY surviving record.” The current code writes nothing; the Proof‑of‑Burn token and the Notice are destroyed, leaving no on‑chain proof of charter status.

**Exploit:** A charter member mints a vault. No attribute distinguishes it from a public‑round vault. When governance voting relies on “charter=yes” there is no verifiable source; a future auditor or buyer sees identical vaults.

**Fix:** Include the provenance attribute(s) as part of the initial attribute list when `mint_vault` is called for a charter round. The exact data must be passed in an additional account or instruction data and validated by the program.

---

**HIGH – Broken Delegate & Close‑Authority Checks Can Irreversibly Brick Vaults**  
Both the SEAL’s `inspect_reserves` and the BURN program check for a delegate/close‑authority by reading four bytes:  
`d[72..76] == [0,0,0,0]` (delegate) and `d[129..133] == [0,0,0,0]` (close_authority).  

SPL token accounts use a `COption<Pubkey>`: a 1‑byte tag (`0` = None, `1` = Some) followed by 32 bytes of (possibly garbage) data. If a delegate was ever set and then **revoked**, the token program writes `tag=0` but does not guarantee zeroing the remaining 32 bytes. On a reused or previously‑closed account, those bytes can be non‑zero. The four‑byte check will fail even when `tag=0`, causing `ReserveDelegated` and rejecting `close_redemption` or `burn_vault`.  

**Consequence:** A vault that legally has no delegate can become permanently trapped – the owner cannot re‑seal or burn it, and the Bitcoin remains locked (or the vault cannot be destroyed if empty).  

**Fix:** Check only the tag byte:  
- Delegate: `d[72] == 0`  
- Delegated amount: `d[121..129] == [0u8; 8]` (still fine)  
- Close‑authority: `d[129] == 0`

---

**MEDIUM – Admin Can Redirect Treasury Without Governance**  
The MINT `update_wiring` function allows the `admin` (a single key) to replace the `treasury` account. All mint fees flow to this treasury, and 85% is meant for vault holders. A malicious admin can change the treasury to a wallet they control, siphoning all future mint revenue. There is no governance gate on this critical parameter.

**Fix:** Either remove `treasury` from `update_wiring` (make it immutable after `initialize`) or require the `governance` signer to change it.

---

**MEDIUM – `mark_opened` Destroys All Existing Attributes**  
`close_redemption` calls `mark_opened`, which builds an `UpdatePluginV1` with a single attribute `"redemption":"opened"` and writes it as the **entire attribute list**. Metaplex Core’s `UpdatePluginV1` replaces the entire plugin data; any attributes previously set (e.g., future charter provenance) are permanently erased.

**Effect:** If charter provenance is later added (as required by CRITICAL‑2), the first redemption wipe will destroy it. A drained vault would lose both the provenance **and** the `"redemption":"opened"` stamp if a subsequent update overwrites again – but the core issue is the irreversible loss of the only on‑chain charter record.

**Fix:** Instead of writing a single attribute, read the existing attribute list, append or overwrite the `"redemption"` key, and write the full list back. The SEAL program would need to handle the complexity of preserving unknown attributes.

---

**LOW – Non‑Reserve Token‑2022 Extensions Not Rejected in Burn Second Loop**  
`burn_vault`’s second loop (over all `remaining_accounts`) skips the token‑extension length check (`d.len() == TOKEN_ACCOUNT_LEN`) for non‑reserve token accounts. A vault holding a Token‑2022 asset with confidential transfers or hidden extensions could show `amount=0` but hold real value, passing the on‑chain emptiness proof.

**Real‑world impact:** The Bank must detect such tokens off‑chain and refuse to co‑sign. The on‑chain guard is incomplete, but the 2‑of‑2 model still relies on the Bank. However, if the Bank fails or is compromised, the blind spot becomes exploitable.

**Fix:** For every token account examined, reject any account whose owner is `SPL_TOKEN_2022_ID` and whose length exceeds `TOKEN_ACCOUNT_LEN`, similar to the reserve check.

---

**THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY**  
Add a **hard total‑supply cap** to the MINT program and enforce it in `mint_vault`. Without it, a governor majority can mint unlimited vaults at zero cost, destroying the economic model and making the entire vault system valueless.