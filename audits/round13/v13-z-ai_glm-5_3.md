# ROUND 13 — AUDIT BY MECHANIC

Method note before anything else: I treated the passing 259-assertion suite as ground truth for on-chain behaviour, and attacked the v5 pairing by trying to construct counterexamples (CPI chains, interleavings, mid-transaction transfers, PDA owners, instruction-shape spoofing) rather than by re-reading the checks. Where I claim something is unreachable or unimplemented, I name the file or the mechanism. The on-chain pairing itself survives everything I could build. The defects this round are real, and they are almost all in the layer the v5 rewrite made load-bearing: the off-chain Bank duty that does not exist, the transaction-size ceiling nothing enforces, and an alarm that pages CRITICAL on every legitimate redemption.

---

## 1. MINT

**MEDIUM — the charter provenance that survives redemption is a record of what was STAMPED, not of what was TRUE, and the verification layer does not exist.**
Construct: `mint_vault` takes `attributes` from the caller. The only thing that binds a `charter: 0042` attribute to an actual burned Proof-of-Burn is the written Bank duty ("refuse a charter-priced mint that is not backed by a burned Proof of Burn"). No file in this repo implements it — there is no Bank signing service at all (see UNBREAK, HIGH). Gain: anyone minting in a charter-priced round stamps charter attributes unverified; after redemption destroys the vault, the "surviving record" (mint tx + DAS burnt entry) faithfully preserves an unverified claim, forever. Additional wrinkle: the asset keypair survives the burn in the original minter's hands, and `mint_vault` accepts any signer-holding key as the asset — so the same address, and its DAS record, can be re-minted and its burnt flag cleared by whoever holds that key. The mint *transaction* (signature-indexed) is the only immutable record; DAS is not. Fix: implement the Proof-of-Burn check in the Bank co-signer before launch, and state in the spec that DAS is a convenience view, not the record.

**LOW — the dangling Attributes authority is unreachable today; leaving it is defensible, but the comments now lie.**
The Attributes plugin authority is the SEAL `["seal"]` PDA. Only the SEAL program can produce that signature, and SEAL v5 has no instruction that writes attributes — so nothing in the current system can mutate a vault's attributes post-mint. That is actually a *stronger* provenance property than v2-v4 had, and I would not change the plugin wiring in the same session as the terminal-burn rewrite either. But: the MINT comment "bounded so the Attributes plugin stays within what SEAL's `mark_opened` is willing to parse" names an instruction that no longer exists, and `ReservedAttribute` guards a stamp that nothing can ever write. Fix: keep the wiring, delete or correct the comments, mark `ATTR_REDEMPTION` as vestigial, and note in the spec that the SEAL PDA's attribute authority is deliberately dead — a future SEAL upgrade that adds an attribute-writing instruction silently re-arms it.

Checked and clean: price/slippage guard, lifetime cap against `minted_total`, round window, owner-must-sign (5.2 now actually reaches the program), collection binding via the SEAL-config cross-read, revenue PDA pinning, the sweep cap/cooldown/reserve bounds and their direction-split governance gate.

---

## 2. UNBREAK (open_for_redemption + burn_vault)

### The author's six questions, answered directly

**(a) Can a vault be thawed and NOT burned? — NO, in any construction I could build.**
Solana atomicity does the heavy lifting: SEAL's forward scan only requires the burn instruction to be *present* later in the message, but every instruction in a message executes, and any failure reverts the thaw with it. I tried the specific shapes:
- *Present-but-doomed burn* (short account list, missing `declared` arg, owner not flagged signer, bank not signer): SEAL's scan matches on pubkeys only and thaws — then the burn fails at Anchor and the whole transaction reverts. The thaw never survives.
- *CPI wrapper*: a top-level wrapper CPIing `open_for_redemption` sees the wrapper's index; it still needs a *top-level* burn later, and that burn's own backward scan needs a *top-level* open — which the wrapper's CPI open cannot be. Both halves fail.
- *ALT / durable nonce*: neither changes instruction semantics; the instructions sysvar carries resolved pubkeys for versioned messages. No effect.
- *Two redemptions sharing a transaction*: both halves bind asset AND owner in both directions; I walked the interleavings (open A, open B, burn A, burn B; burn scanning backward past the other vault's open) — the pubkey binding disambiguates every case.
- *Transfer mid-transaction*: open(X) → transfer to Y → burn(owner Y) fails `NoPrecedingOpen` because the open named X; burn(owner X) fails `NotTheOwner` because the asset now reads Y. Both directions closed.

**(b) Is the asset+owner binding complete? — YES.** Index 0 and index 2 are bound by pubkey in both programs, both directions, and each half independently re-verifies ownership against the live asset bytes, so the introspection binding is defense-in-depth against cross-pairing rather than the only line. Test 9.0's shape (a burn riding another vault's thaw) is refused for the right reason.

**(c) Does discriminator/account drift fail closed? — TRUE for the drift class claimed, with two caveats worth stating.**
A BURN upgrade that renames the instruction changes the discriminator → match fails → thaw refused → halt. A reorder that moves the asset or owner off indices 0/2 → the pubkey comparison fails (a config PDA or collection account can never equal a wallet owner) → halt. Caveat 1: the suite's 3.1a–3.1f pins read the *repo source*; they protect the repo's builds against accidental drift, but a deployed BURN upgraded without redeploying SEAL is not covered by any test — the real tripwire is the alarm's `prog.burn.hash` CRITICAL, which is the thing to trust. Caveat 2: a "drift" that keeps indices 0/2 semantically intact while changing behaviour is not drift, it is an upgrade, and no on-chain construction can catch it. The claim as scoped is true.

**(d) Is top-level-only introspection load-bearing in both directions? — TRUE, and I can prove the strongest counterexample fails.**
The best attack is nested Core Execute: outer owner signs `ExecuteV1(outer)` → outer PDA signs `ExecuteV1(inner)` → inner PDA signs a CPI `open_for_redemption(inner)` with the PDA as owner. The CPI open itself would pass its ownership checks (the PDA *is* the inner asset's owner and can sign via the CPI chain). It dies at the other half: satisfying it requires a *top-level* `burn_vault` naming the PDA as `owner: Signer`, and a PDA can never sign a top-level instruction. The burn half is what makes the whole design CPI-proof, exactly as the comment claims.

**(e) Does the reserve list strand every vault past the transaction ceiling? — YES, and here are the numbers.** This is the HIGH finding below.

**(f) Does requiring a preceding open create a new stranding class? — NO for funded vaults.** Contents cannot leave without a thaw, so a broken SEAL already halted redemption; the burn's new dependency adds nothing. The one genuine regression: destroying a never-funded mis-mint now requires a thaw, so a SEAL halt also blocks mis-mint cleanup. Cosmetic — no funds at risk.

### Findings

**HIGH — the redemption transaction ceiling is unenforced, and `MAX_RESERVE_MINTS = 8` exceeds it on legacy transactions in every configuration.**
Construct: the reserve list is additive-only up to 8; every redemption must declare BOTH token-program ATA derivations for EVERY configured mint, funded or not. Arithmetic from the measured baseline (802 B, 17 accounts, 2 signatures, 430 B headroom):
- Each additional **funded** mint: +4 accounts (mint, PDA ATA, T22 derivation, destination ATA) = 128 B + ~20–30 B of instruction encoding ≈ **+150 B** → legacy fails at **4 funded mints** (802 + 3×150 ≈ 1252 > 1232).
- Each additional **unfunded** mint: +2 declared accounts = ~66 B → legacy fails at **8 total** (≈1264); 7 total barely fits (≈1198).
Gain: one ordinary, alarmed-as-HIGH `update_config` addition strands every vault in existence simultaneously — thaw is illegal without a burn, and the burn no longer fits. This is the author's own stated worst case and the arithmetic confirms it. Fix, in order: (1) cap `MAX_RESERVE_MINTS` at a **measured** legacy-safe value (3, with a suite redemption test run AT the cap — 4.6 only ever tests one mint); (2) drop the dead Token-2022 derivation requirement (see next finding), which roughly doubles headroom; (3) before adding mint #2, build and test the versioned-transaction + ALT redemption path — an ALT holds all ~45 accounts at 1 byte per reference and the whole 8-mint redemption lands around 550–650 B, so the rescue is real, but nothing in this repo constructs a versioned transaction and the rescue is currently untested fiction.

**MEDIUM — the Token-2022 ATA derivation requirement is provably dead weight (answering the direct question: NO, it is not reachable for a classic SPL mint).**
The ATA program refuses to create an ATA whose mint is not owned by the token program it was handed (this is precisely why cross-program ATAs cannot exist), and the derivation address is a PDA of the ATA program, so no other route can create an account there. A classic SPL mint's owner is Tokenkeg forever. The T22 derivation can therefore never be a token account; requiring its declaration proves nothing and costs one account slot per reserve mint per redemption — i.e. it halves the declared-account budget that the ceiling above is measured against. Fix: remove the inner loop (keep the outer), or gate it behind a probe in `probe-mainnet-facts.mjs` that proves the unreachability first. The emptiness proof loses nothing: the second loop still inspects any declared account that happens to be token-program-owned.

**HIGH — the control the v5 design leans on — "the Bank scans BEFORE it signs" — is not implemented anywhere. It exists as prose in three program headers and the spec.**
There is no Bank signing or simulation service in this repository. `bank/` contains a watcher, a distributor, a revenue cycler and their plumbing; none of them co-signs a redemption, and none of them is invoked at signing time by anything. The closest shipped artefact is `alarm.mjs --reconcile`, which (i) runs daily, (ii) is post-hoc, and (iii) iterates `live` vaults only — so it cannot see a holding destroyed by a burn even after the fact. Under v2-v4 this gap stranded value; under v5 it destroys it, and the destruction is invisible to every shipped detector. Gain: any undeclared holding that lands inside the 24-hour reconcile window before a redemption — an airdrop, a maliciously created PDA-owned token account (which needs no PDA signature and touches none of our programs) — is destroyed silently. Fix: implement the Bank co-signer as an actual service: on every open/burn co-signature request, run `getTokenAccountsByOwner` (both token programs) and a DAS asset lookup on the asset-signer PDA, and refuse unless every holding is a declared-empty reserve ATA or is swept in the same transaction. Until that exists, the v5 claim "the gap is covered by the Bank's co-signature" is a comment, not a control.

**LOW — staggered Bank rotations create permissionless halt windows.**
SEAL, BURN and MINT each hold their own copy of the Bank key with independent arm/apply/cancel, and every `apply` is permissionless. A rotation armed in all three can be landed in one by anyone, leaving `WiringDiverged` refusing every burn (and `NotTheBank` refusing every mint) until the other two land. Fail-closed, alarm-visible, but anyone can trigger the stagger. Fix: runbook requirement to land all three `apply`s in one transaction; the alarm's `rotation_armed` CRITICAL is the mitigation that exists today.

---

## 3. ROYALTY

**MEDIUM — after governance is handed to the GOV PDA, `set_collection_royalties` is permanently unreachable, and nothing checks it was set before the handover.**
Construct: the instruction requires `governance: Signer` equal to `config.governance`. Once governance is the GOV program's PDA (which can only ever sign `set_round`), no key on earth can satisfy it — the same lock-in the suite asserts at 7.18 for the treasury, but for the royalty *rate*. If the Royalties plugin is not added before the handover, it cannot be added at all without a 7-day governance rotation. The code comment says "do this BEFORE" — nothing enforces it, tests it, or alarms on it. Fix: a suite step and an alarm standing check that the collection carries the intended Royalties plugin (creator = revenue PDA, bps ≤ 1000) *before* `apply_pending_governance` lands, since afterwards the only remedy is the rotation timelock.

Otherwise clean: the CPI is exercised against real Core in both opcodes (6.24–6.30), the 1000 bps ceiling is enforced, one creator at 100% to the revenue PDA, and the plugin's authority is None so the MINT PDA retains update rights. Note for the spec, not a defect: Core royalties are marketplace-enforced; a venue that ignores the plugin pays nothing, and no code here changes that.

---

## 4. VOTING

**No new finding.** What I checked and found sound: the asset-seeded `VoteRecord` PDA blocks double-voting across ownership changes (init collision, asserted 7.7/7.9 for the right reason — system 0x0); a burned vault cannot vote (the asset account no longer decodes as AssetV1); quorum uses ceiling division against `max(snapshot, live)` with the tally rule snapshotted into the proposal; execution is forward-only, expiring, and refuses dead rounds; the CPI wiring and the pinned MINT-config read are correct. The known limits (vote lending, mint-during-window, `minted_total` monotonicity, the untested 7-day expiry) remain exactly as documented and I have nothing to add to them.

---

## 5. TRANSFER

**No new finding.** `PermanentFreezeExecute` gates ExecuteV1 only; transfer is free by design and the seal PDA is the sole signer for the plugin, which is create-only. The v5 rewrite is what makes this section clean: because a thaw cannot survive a transaction, there is no longer any state in which a thawed, draining vault can be transferred. The brick-to-own-PDA transfer remains possible and UI-blocked only (known impossibility #3) — nothing new to file.

---

## 6. SELL

**LOW — the residual misrepresentation surface is the never-funded vault, and nothing marks it.**
v5 eliminated the dangerous case (drained-but-alive, resellable). What remains: a vault minted but never activated holds nothing, is live, sealed, and transferable, and is indistinguishable from a funded vault in any listing that doesn't read the chain. The reserve ATA is derivable by anyone and the balance is one RPC call — the buyer's verification step exists but is manual and unenforced (Core has no transfer hook to enforce it with). Fix: surface the derivable reserve balance in every marketplace/UI integration as a stated requirement; the alarm's activation watch is the backstop that exists.

**LOW — cbBTC's live freeze authority is an external kill switch on redemption.** A frozen reserve ATA fails the sweep, which fails the burn, which reverts the thaw — fail-closed, but the Bitcoin is stuck until Coinbase unfreezes. `distribute.mjs` already models frozen ATAs; the redemption path should document the dependency.

---

## 7. NESTING AND AIRDROPS

**Direct answer: there is NO on-chain construction that closes the enumeration gap.** Token accounts and Core assets owned by a PDA are not enumerable on-chain; the only deterministic addresses in the system are the reserve ATA derivations, and Core exposes no owner→assets lookup. The measured matrix (9.1–9.11) is accurate as stated, and the assertions-as-ALLOW discipline is the right way to keep it honest.

**MEDIUM — the reconcile is blind after the burn, and it does not have to be.**
`reconcile()` iterates `live` vaults only. But a burned vault's asset-signer PDA address still resolves, and `getTokenAccountsByOwner` on it still returns the orphaned token accounts — they persist, owned by a PDA that can never sign again. The destruction is therefore *detectable*; the shipped code simply doesn't look. Fix: each pass, take the vaults burned since the previous pass (the alarm already knows them from `detectVaultSetChange`) and scan their PDAs; any surviving balance is destroyed-or-orphaned value and is a CRITICAL. This converts the worst v5 consequence from invisible to caught within 24 hours, independent of the still-missing pre-sign scan.

---

## 8. THE INVARIANT

What holds, and I could not break it: vaults are born frozen (asserted on the plugin *state*, 2.3a); nothing can leave without SEAL's PDA signing the thaw; a thaw cannot end a transaction without a burn; the burn cannot land without the emptiness proof over every derivable account; the asset is gone in the same transaction; the PDA's rent is swept. There is no instruction anywhere that empties a vault and leaves it alive, and I found no construction that manufactures one.

What the 100% claim does not currently survive, ranked:
1. **The enumeration gap, whose only control is unimplemented** (UNBREAK, HIGH). Every undeclared holding is destroyed on redemption, silently.
2. **The bare Core BurnV1** (accepted impossibility #1) — the owner can always destroy their own contents directly. Detected only by `detectVaultSetChange`, whose signal is being destroyed by noise (below).
3. **The transaction ceiling** (UNBREAK, HIGH) — an ordinary config addition strands the entire system at once.
4. **Four upgrade authorities** — any one of them can rewrite its program's rules; the spec's multisig requirement is a pre-mainnet obligation, not a property of this code.

---

## CARRY-OVER VERDICTS (asked, not re-filed)

- **`bank/lock.mjs`**: the round-12 rewrite is correct at process-scheduling scale — link-based claim, token release, unreadable-refusal, pid+start-time liveness, and the re-read before unlink close every interleaving that two Node processes can actually produce. The residual unlink-vs-unlink TOCTOU is real, is acknowledged in the file, and lives in a microsecond window. Yes, **flock(2) on a held fd is the right answer**: kernel-enforced exclusion, released automatically on process death, no break logic, no TOCTOU, no stale locks. Replace, don't patch further.
- **Chain-derived reconciliation of distribution outputs**: still open. `distributions.json` remains the distributor key's own testimony; nothing verifies recorded signatures against the chain.
- **Fresh per-cycle swap operator wallet**: still open, still unenforceable with a long-lived key, still an ops instruction.

---

## OFF-CHAIN FINDING THAT SPANS MECHANICS

**HIGH — the burn detectors now cry wolf at CRITICAL on every legitimate redemption, which disables the only tripwire for the one attack the programs cannot prevent.**
Under v5, every redemption is a burn. `detectVaultSetChange` raises `vault_burned` **CRITICAL** for each redeemed vault; `detectBurns` raises `burn_via_program` **HIGH** for each `burn_vault` instruction — and the redemption transaction is scanned twice (it touches both SEAL and BURN, so it appears in both programs' signature walks), so each redemption produces one CRITICAL and two HIGHs and an email. The file's own standard — "a detector that cries wolf is one people learn to scroll past" — is violated by its own burn path, and the finding people will scroll past is `vault_left_index`, which is the *only* detector for a bare Core BurnV1 destroying a customer's Bitcoin. Fix: correlate, with data the alarm already holds — a vault that disappeared AND whose `burn_vault` signature was scanned AND whose transaction carried the paired `open_for_redemption` is a redemption: report INFO. A vault that disappeared with no scanned `burn_vault` is a bare Core burn: CRITICAL, alone, unmuddied. Also dedupe findings per signature across the four program walks, and answer the direct question: no, HIGH on `detectBurns` is no longer the right severity — it is the normal path now.

---

## WHAT WOULD A 100% CLAIM HAVE TO SURVIVE, PER MECHANIC, THAT THIS CODEBASE DOES NOT CURRENTLY PROVE

- **MINT**: a charter round in which the Proof-of-Burn duty is enforced by code rather than asserted by a comment; a suite test that mints at the config-max reserve list; a comment set that no longer names deleted instructions.
- **UNBREAK**: a redemption executed at `MAX_RESERVE_MINTS` in the transaction format the client will actually ship (versioned + ALT — currently built nowhere); a Bank co-signer service that scans before signing, tested against a planted undeclared holding; a BURN upgrade drill proving the drift direction is a halt and that `prog.burn.hash` fires.
- **ROYALTY**: proof the plugin was set before the governance handover, and an alarm that says so — after the handover it is rotation-locked.
- **VOTING**: the 7-day execution expiry exercised even once (stated untested); nothing else outstanding that I found.
- **TRANSFER**: an on-chain or protocol-level answer to the brick-to-own-PDA transfer — currently a UI promise.
- **SELL**: a marketplace contract that displays the derivable reserve balance, so the never-funded vault cannot be listed as if funded.
- **NESTING AND AIRDROPS**: a post-burn PDA scan in the reconcile, so destruction is at least detectable; until then the honest sentence is "undeclared holdings are destroyed invisibly."
- **THE INVARIANT**: the enumeration gap's control implemented; the burn alarm quiet on redemptions and loud on bare burns; upgrade authorities in multisigs before a single satoshi is deposited; and a measured, enforced reserve-mint ceiling — because the most likely way this design kills somebody's Bitcoin is currently one `update_config` call away, and the code will let it through.