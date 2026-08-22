# ROUND 13 — mechanic audit (v5 pairing first)

Pairing verdict up front, because that is what you asked to attack: **I cannot construct a successful transaction that thaws a vault and leaves it alive, or that binds vault A’s thaw to vault B’s burn.** The 259-assertion suite is consistent with that. The new design’s real failures are not a clever sysvar trick. They are an irreversible config landmine, a load-bearing Bank duty that is not implemented as a pre-sign gate, and a watcher that will now scream on every honest redemption.

---

## 1. MINT

No new on-chain finding. Checked: `price_lamports` vs `max_price_lamports`; `minted_this_round < cap` and `minted_total < max_supply` (ratchet-down only); `opens_at`/`closes_at` with `checked_sub` and `MAX_ROUND_SECS`; owner is a `Signer` (PDA mint rejected at 5.2); Bank must match `config.bank`; CreateV2 collection + SEAL-config pin (`disc` + `version` + collection/bank); Attributes written only at mint; `ReservedAttribute` on `"redemption"`; plugin authority is the derived `["seal"]` PDA, not a copied pubkey.

**LOW — dangling Attributes authority and a stamp that no longer exists.**  
`mint_vault` still sets Attributes authority to the SEAL PDA and still rejects `"redemption"`. SEAL has no remaining instruction that signs as that PDA except `UpdatePlugin(PermanentFreezeExecute)`. The capability is not reachable without a SEAL upgrade. Leaving MINT untouched is the safer of the two-change options. It is still a live lie in the binary: a comment still bounds attributes to what `mark_opened` can preserve, and `mark_opened` is gone. Fix: in the next MINT change, stop delegating Attributes (or delegate to a PDA that will never sign) and delete `ATTR_REDEMPTION`.

---

## 2. UNBREAK (open + burn)

### Answers to (a)–(f)

**(a) Can a vault be thawed and not burned? FALSE — not in any construction that commits.**  
Solana applies one commit or none. `open_for_redemption` writes `frozen=false` only after it has seen a later **top-level** `burn_vault` for the same asset and owner. If that burn fails, the thaw is not in the ledger. Nested CPI, wrapper program, ALT, durable nonce, and “burn present but reverts” do not create a committed thawed vault:

- CPI open: `load_current_index_checked` is the **outer** index. Open will accept a later top-level burn, but that burn then searches top-level opens, does not see the inner open, returns `NoPrecedingOpen`, tx aborts, thaw reverts. Mirror image if only the burn is wrapped.
- Two redemptions in one tx: allowed only as `open A … burn A, open B … burn B` (or interleaved with both pairs complete). Tested 9.0 / 3.9 / 3.10.
- ALT: sysvar returns resolved `AccountMeta.pubkey`s, not table indexes. Binding still reads instruction account 0 and 2.
- Durable nonce: extra top-level ix; does not split atomicity.
- Burn that matches the 8-byte prefix and then fails (emptiness, bank, declaration): whole tx fails.

There is no leftover `close_redemption`. There is no instruction that sets `frozen=true` again.

**(b) Pair a burn to a different vault’s thaw? FALSE.**  
Both sides require `accounts[0] == asset` **and** `accounts[2] == owner`. Same owner, different asset fails (3.9, 9.0). Same asset, different owner fails (3.10). Extra accounts prepended to a crafted burn move what sits at 0/2; the match then fails closed.

**(c) Drift fails closed? TRUE for ABI drift; true for a Core account-list change; not a statement about a hostile BURN upgrade.**  
Discriminator is `sha256("global:<name>")[..8]`. Rename → match fails → no thaw. Insert an account before index 2 → owner bind fails → no thaw. Core `BurnV1` account-list change → `invoke` fails → thaw reverts.  
A BURN upgrade that **keeps** name + indices 0/2 and turns `burn_vault` into a no-op would thaw without destroying. That is upgrade-authority compromise, not drift. Fail-closed is about accidents.

**(d) Top-level-only is load-bearing both ways; a CPI wrapper cannot satisfy it. TRUE.**  
See (a). Each half demands a genuine top-level counterpart. A wrapper cannot be that counterpart unless it *is* SEAL or BURN.

**(e) Reserve-list growth can seal every vault. TRUE. This is the live kill switch.**  
Measured (4.6): **802 / 1232 bytes, 17 accounts, one reserve mint.** Legacy keys are 32 bytes each. ~430 bytes of headroom is about **thirteen extra static keys** before the packet is full, and instruction data still grows.

Per added mint the burn **requires** both ATA derivations plus a sweep (source ATA, dest ATA, transfer, optional close). Call it three new keys + tens of bytes of ix data. **Three intended mints (cbBTC, $GARY, $GIRAFFISH) probably still fit legacy. Four to five is the cliff. Eight does not fit a legacy packet.**

ALT **does** rescue the *key list*: open and burn sharing accounts is the favourable case; signers stay static; the rest become 1-byte indexes. Nobody has measured an 8-mint versioned redemption. Nothing in the programs, the suite, or `bank/` builds that transaction. `MAX_RESERVE_MINTS = 8` is a Borsh bound, not a packet bound.

Worse: **`reserve_mints` updates are immediate and additive-only.** Bank/admin rotations wait seven days. The one config write that can make `burn_vault` unsatisfiable for every live vault does not.

**(f) Requiring a preceding open does not add a new way to strand *value*. TRUE.**  
Contents cannot leave without a thaw. An empty never-funded vault burns as `open + burn` with no sweep (8.13). If SEAL cannot thaw, you could not extract anyway. A bare Core `BurnV1` still exists for an owner who only wants the NFT gone (and that still destroys contents — proven impossibility 1).

### Findings

**HIGH — admin can permanently seal every vault with one `update_config`, and cannot undo it.**  
Construct: `SEAL::update_config(reserve_mints: Some(old ++ [m4, m5, …]))`, each `mi` a classic SPL mint, remaining accounts passed so `assert_classic_spl` passes. No Bank signature, no notice period. Next redemption: more static keys + inner transfers than a 1232-byte packet (or more than the Bank’s legacy builder will produce). Burn cannot succeed → open refuses → **cbBTC stays frozen**. `ReserveMintDropped` forbids removing the extra mints.  
Fix: (1) timelock reserve-list changes like the Bank rotation; (2) drop `MAX_RESERVE_MINTS` to a number the suite has actually redeemed (3, or 4 with a versioned+ALT test); (3) stop requiring the Token-2022 ATA derivation for a mint `assert_classic_spl` already proved is Tokenkeg — that single extra account per mint is half the cliff; (4) refuse a config write unless a redemption-shaped tx still serializes under 1232, or require ALT and test it.

**LOW — Token-2022 ATA requirement is unreachable for a classic mint and is paid for on every redemption.**  
A Token-2022 `InitializeAccount` against a Tokenkeg mint fails. The address still has to sit in `remaining_accounts` or you get `ReserveNotDeclared`. Author’s “dead weight” claim is true. It is the same finding as the capacity HIGH; do not “fix” it by dropping the 165-byte / no-extension checks.

---

## 3. ROYALTY

No finding. Checked: `set_collection_royalties` is admin+governance; `basis_points <= 1000`; one creator = `["revenue"]` at 100%; `RuleSet::None`; add vs update opcodes both executed against real Core (6.26–6.30). Marketplace honouring is not a program property. After governance is the GOV PDA this instruction is unreachable except via the timelock — intended.

---

## 4. VOTING

No new on-chain finding. Checked: standing = live AssetV1 owner bytes + owner signature; `VoteRecord` seeds `["vote", proposal, asset]` (7.7/7.9 fail with account-in-use, not a side check); quorum divisor `max(snapshot, live)` with ceiling division and `need > 0`; `quorum_bps`/`threshold_bps` snapshotted on the proposal; 7-day execution window; `closes_at > now`; `id > last_executed_id`; CPI `set_round` only; `min_voting_secs` / `threshold_bps` ratchet up; `quorum_bps` lower-bounded at 500.  
Stated limits still true and still unenforced on-chain: a vote is rentable in one tx; a vault minted mid-window may vote; Bank duty to refuse mints while `voting_ends_at` is in the future is a comment, not a check.

---

## 5. TRANSFER

No finding beyond proven impossibilities 1 and 3. PermanentFreezeExecute gates Execute, not transfer — resale works, contents follow the NFT. Mid-redemption transfer breaks the owner bind (`NotTheOwner` vs `NoPrecedingOpen`) and the tx reverts, so you cannot thaw, transfer, and keep a live empty vault. Transfer into own asset-signer PDA, or into another vault’s PDA, is still Core-legal and still fatal; still UI-only.

---

## 6. SELL

No finding that v5 did not already close. A buyer’s basis is “the reserve is still inside.” Partial sweep + re-seal is gone (3.11 / 3.11a). An emptied vault is gone in the same tx (4.4). A hostile Bank still cannot move contents without the owner. A sealed vault cannot grow a delegate (Execute is frozen). What a marketplace displays is off-chain; the program does not attest balances to a sale.

---

## 7. NESTING AND AIRDROPS

The measured matrix (9.1–9.11) is true. Declared nested asset → `VaultStillHoldsAVault`. Undeclared nested asset → burn allows, inner orphaned. Declared airdrop → `VaultNotEmpty`. Undeclared airdrop → burn allows, tokens destroyed. Nested inner vault cannot open (`NotTheOwner`). There is **no** on-chain construction that closes undeclared holdings: Core cannot enumerate PDA-owned token accounts or Core assets.

**HIGH — the control the headers name is not implemented, and the daily job implements only half of it.**  
Claim: Bank runs `getTokenAccountsByOwner` **and DAS** **before** it signs, not after.  
What exists:

- There is **no** Bank signing service in this repo. `alarm.mjs` is a watcher. Nothing simulates a redemption tx, scans the PDA, then attaches `config.bank`.
- `--reconcile` (daily) calls `getTokenAccountsByOwner` on each live PDA and runs `detectUndeclaredTokenAccounts`. That is **after** a burn can already have destroyed the balance.
- `--reconcile` does **not** call DAS `getAssetsByOwner` (or any Core-owner walk) on the asset-signer PDA. Case 9.5 — a whole vault nested, undeclared — is invisible to the one job that claims to cover the gap.

Evidence if this claim is true: grep `getAssetsByOwner` / pre-sign in `bank/` — absent; reconcile loop is token programs only.  
Fix: a signer that, given a serialized redemption tx, (1) identifies every `asset_signer`, (2) `getTokenAccountsByOwner` both token programs, (3) DAS/getAssetsByOwner for Core children, (4) refuses unless every non-zero holding is a declared remaining account and is swept, (5) **then** signs. Put the same DAS walk in `--reconcile` so nesting is not a weekend surprise. Until that ships, “the Bank must scan” is a comment next to a key.

The closed-ATA delegate argument (3.3 vs 3.3a) is **true**: a delegate on a closed account cannot move funds; a recreated ATA is empty and undelegated; after `BurnV1` the PDA cannot approve again. Do not “tighten” 3.3a into a refuse-on-closed-account — that would brick the normal sweep.

---

## 8. THE INVARIANT

“Everything stays in the vault until it is broken open, and then the vault is burned and never exists again.”

On the **declared reserve path**, v5 makes this true: no thaw without a terminal burn, no burn without a preceding thaw, emptiness proof unchanged, partial sweep reverts the thaw (3.11). The vault account is gone in the same tx (4.4).

It is **false** for anything the proof is not shown, and v5 made that worse, not better — which you already know and which the suite asserts as ALLOW on purpose. Restating it as a new CRITICAL would be the file-oriented mistake. The defect is §7: the compensating control is not built.

Bare Core `BurnV1` still destroys contents and still cannot be prevented while the NFT is transferable. That burn does **not** go through emptiness. That is still the one on-chain way the invariant dies without the Bank.

**HIGH — `detectBurns` HIGH on every `burn_vault` is now a siren on every legitimate redemption.**  
Under v5 every honest unbreak is `burn_vault`. `detectVaultSetChange` already emits CRITICAL `vault_burned` on the DAS diff. Operators will learn to ignore HIGH, then CRITICAL. The file’s own comment already says that.  
Fix: `burn_via_program` is INFO (or HIGH only when the same tx has no top-level `open_for_redemption` for that asset). Keep CRITICAL for bare `BurnV1` and for `vault_left_index`.

Charter provenance: destroying the vault destroys the Attributes record (6.5/6.6). No on-chain reader still consults those attributes (GOV and distribute do not). Whether DAS keeps attribute blobs on burnt assets is **not proven here**. If any off-chain surface treats “not in the live collection” as “was never charter,” that surface is now wrong. That is the business trade you accepted; it is not a program bug.

---

## Carry-over (still open — not a vault mechanic, still money)

**HIGH — `lock.mjs` is still not exclusive on the break path.**  
`link()` from a fully-written tmp file is a real create. The re-read-before-unlink only wins if the other breaker has **already replaced** the file. The interleaving that still double-holds:

1. A and B both read the same stale, dead lock.  
2. Both see the same token.  
3. A unlinks, `link()`s a fresh lock, starts paying.  
4. B unlinks **A’s fresh lock**, `link()`s its own, starts paying.

`_beforeBreak` tests the other order. The author still writes that a microsecond TOCTOU remains. That TOCTOU **is** the double-pay. Evidence: two `distribute.mjs` or `revenue.mjs` processes after a crashed 20h lock.  
Fix: `flock`/`fcntl` on an open fd (kernel drops the lease on death). Stop inventing break protocols. POSIX lease is the right answer; this file is not one yet.

**HIGH — distribution still reconciles against a ledger the payer wrote.**  
`detectDistribution` reads `distributions.json`. It does not walk the distributor’s cbBTC signatures or require `sum(on-chain transfers to vault ATAs) == plan`. Same user, same box, same key. Still true.

**MEDIUM — long-lived swap operator.**  
“Holds nothing but the cycle’s funds” is still an ops instruction. The Jupiter inspection is still “one signer, no BPF loader, ≤4 ALTs.” A substituted route can still drain that wallet.

---

## WHAT A 100% CLAIM WOULD HAVE TO SURVIVE

**MINT** — A mint while a proposal window is open, and a price-0 mint with no burned PoB, must be impossible or must be refused by a **real** Bank signer (not a comment + `minted_total` drift). Suite must mint with the production plugin bytes and decode `frozen: true` (2.3a already does). Collection mismatch across the four programs must be unrepresentable, not merely alarmed.

**UNBREAK** — (1) A property test: every well-formed tx that contains `open` and does not contain a succeeding `burn_vault` for the same asset+owner must fail, including CPI wrappers, ALTs, nonce advance, two vaults, swapped owners. You have point tests; you do not have that exhaustive harness. (2) **An N-mint redemption actually landed** for N = live `reserve_mints.len()`, as a versioned tx if needed, in CI, or the claim “we can unbreak” is a 1-mint claim. (3) Adding a reserve mint must be either reversible or gated on that same serialization test. (4) Production Bank must be a top-level-capable key. A Squads-CPI Bank cannot produce the top-level pair v5 requires; `Pubkey::is_on_curve` cannot check this on-chain.

**ROYALTY** — A resale on a marketplace that enforces Core royalties must land in `["revenue"]` and then through `split_revenue`. That is a marketplace fact, not a program fact. After GOV is a PDA, a royalty change must be shown via the published timelock, not assumed.

**VOTING** — Quorum against **live** voters, or an explicit accepted freeze as burns accumulate. Execution window actually expired in a test (it is not). Bank refusal to mint during a vote, tested against the signer, not the spec.

**TRANSFER** — Either Core grows a burn-only lock (it has not) or the product accepts that the owner can always `BurnV1` the NFT and destroy the reserve. Transfer-to-own-PDA and transfer-into-another-vault-PDA blocked somewhere that is not “the UI.”

**SELL** — A buyer can verify reserve presence from chain data the marketplace is forced to show, or the Bank attests it. Today that is an explorer hop. v5 removed the empty-resale lie; it did not add an attestation.

**NESTING / AIRDROPS** — A redemption signature that exists only after DAS + `getTokenAccountsByOwner` return no undeclared non-zero holding. That function is not in the tree. Until it is, 100% is a false sentence.

**INVARIANT** — The above signer, plus: no committed state in which `PermanentFreezeExecute.frozen == false` and the asset still exists; no committed burn of a vault that still holds a declared reserve; Core `BurnV1` either impossible or treated as a full loss with a CRITICAL that humans still read. `detectBurns` HIGH-on-every-redemption fails that last clause today.

I am not signing this off. v5’s pairing does what the comments say against the attacks that fit in a transaction. The 100% list above is what would have to be true before these programs hold real cbBTC; items in UNBREAK (e), NESTING, the watcher, and `lock.mjs` are not.