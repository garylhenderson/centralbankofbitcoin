# ROUND 13 — AUDIT BY MECHANIC

I read the v5 pairing line by line and tried to break it before touching anything else. Verdict up front, because the rest of this report hangs off it: **the open↔burn coupling is sound as a shape, I could not construct a thaw that survives, and the author's answers to (a), (b), (d) and the drift half of (c) are TRUE.** What does not survive scrutiny is (c) as stated ("fails closed in *every* case"), the capacity question (e) — the author is right to be frightened of it, and his own estimate of the mechanism is wrong in the *optimistic* direction — and the off-chain completeness control, which is half-built and in one place not built at all.

---

## 1. MINT

No new defect. Checked against v5's blast radius specifically:

- Price (`max_price_lamports` payer ceiling), lifetime cap (`minted_total < max_supply`, ratchet-down), round window, owner+Bank signatures, collection binding (collection update authority = `["mint"]` PDA, direct-create rejected at 2.5) — all hold and are unchanged this round.
- **LOW — dead code left pointing at a dead mechanic, deliberately.** `ReservedAttribute` guards a `"redemption"` stamp nothing can write; the `MAX_ATTRS` comment still says attributes are bounded "within what SEAL's `mark_opened` is willing to parse and rewrite", and `mark_opened` no longer exists; the Attributes plugin's authority is delegated to the SEAL PDA, and v5 SEAL contains **no instruction that can exercise it**. I checked reachability: `core_plugin_cpi` is called only from `set_frozen` with a hardcoded three-byte payload, so the dangling authority is reachable by nothing short of a SEAL upgrade. Leaving MINT untouched was the right call — the failure mode of touching it was worse than the failure mode of leaving it. But the attribute set is now **immutable for the life of every vault**, permanently, and nobody has stated that as a product fact. If that is intended, say so in the spec and delete the stale comment; if it is not, the SEAL PDA needs a write path and this is the moment to notice it doesn't have one.

**What a 100% mint claim would still have to survive:** the hand-built CreateV2 wire format against the next Core upgrade (see finding U-4 — Core is the fifth program and nothing watches it), and the two Bank duties that exist only as comments (refuse mints during open votes; refuse charter-priced mints without a burned Proof of Burn). Neither is enforced anywhere.

---

## 2. UNBREAK (the v5 pairing) — attacked first, attacked hardest

### The author's specific questions, answered

**(a) Can a vault be thawed and not burned? No — with one exception that is not a construction but a trust assumption (U-1 below).** I went through every shape named:

- *Burn present but reverts*: Solana transactions are atomic. There is no "the thaw survives a failed burn." Any `burn_vault` failure — `VaultNotEmpty`, `ReserveDelegated`, a Core error — reverts the thaw in the same transaction. This is the whole design and it is correct.
- *Nested CPI / wrapper*: cannot satisfy either half (proof under (d)).
- *Two redemptions sharing a transaction*: each open scans forward for its own (asset, owner); each burn scans backward for its own. `open A, sweep A, burn A, open B, sweep B, burn B` and interleaved orders both work; neither can borrow the other's half.
- *Address lookup table*: the instructions sysvar stores **resolved** pubkeys. ALT compression does not change what `load_instruction_at_checked` returns. No effect.
- *Durable nonce*: `AdvanceNonce` sits at index 0 as a system-program instruction; both scans skip it by program id. No effect.
- *Instruction introspection edge cases*: both programs take the sysvar by address constraint *and* use the `_checked` loaders, so the fake-sysvar class is closed twice. The forward loop terminating on `Err` at end-of-message is correct behavior.

**(b) Is the asset+owner binding complete? Yes, for the purpose.** `accounts.get(0)` and `accounts.get(2)` on both sides pin the two pubkeys that matter, and positional indices survive pubkey deduplication in the compiled message because the sysvar carries one meta per instruction account. What is deliberately not bound — collection, bank, payer — is independently validated inside each handler (collection against the asset header and config; bank against each program's own config, plus BURN's `WiringDiverged` cross-check against SEAL's). I could not find a cross-pairing that produces a thawed live vault. Test 3.9/3.10/9.0 cover the three borrow shapes.

**(c) "Drift fails closed in every case" — TRUE for drift, FALSE as stated, and the exception is the one that matters.** Every *accidental* drift fails closed: a renamed instruction changes the discriminator and the match dies; a BURN account inserted before index 2 moves `owner` off index 2 and the match dies; a Core upgrade that changes opcode 6/12/17 semantics kills the CPI. In all of these the thaw is refused and the vault stays sealed. Confirmed.

But SEAL's check binds the burn instruction's **shape** — program id, eight bytes of discriminator, two account positions — never its **effect**. A BURN upgrade that *keeps* the discriminator and account order but deletes the `BurnV1` CPI (or deletes the emptiness proof) pairs perfectly with `open_for_redemption` and leaves a thawed, living vault — or burns a full one. That is not reachable by "drift"; it is reachable by whoever holds BURN's upgrade authority. This is a genuine change v5 made: under v2–v4, a hostile BURN authority could not unseal anything, because the thaw lived entirely in SEAL. **Under v5, SEAL's "no key can thaw a vault" is contingent on BURN's bytecode doing what its discriminator advertises.** The spec's known limit ("upgrade authority must move to a multisig") now covers not just BURN's behavior but SEAL's core guarantee, and `build-mainnet.sh`'s provenance proof is the only thing standing between that statement and silence. File this precisely, because the code comment's "fails closed, never a leak" will be quoted back at you by the next reader as covering this case, and it does not.

*Fix:* the multisig move for all four upgrade authorities stops being a hardening note and becomes a launch gate. If you want an on-chain hedge, there isn't a clean one — SEAL runs before the burn and cannot check post-state in one instruction — which is exactly why the upgrade-authority statement needs to stop being a footnote.

**(d) Top-level-only is load-bearing in both directions — CONFIRMED, with the cost spelled out.** `load_current_index_checked` inside a CPI reports the *outer* instruction's index, and the sysvar never contains inner instructions. So: an open buried in a wrapper's CPI scans forward from the wrapper's index and finds only top-level burns; any such top-level burn scans backward and finds no top-level open (the wrapper's own instruction carries the wrapper's program id) and refuses. The mirror fails symmetrically. A wrapper therefore **cannot exploit the pairing — and cannot execute a redemption at all.** That is a hard property, not an incidental one, and it produces U-2:

**(f) Does requiring a preceding open strand anything previously destroyable?** For ordinary and never-funded vaults, no — 8.13 redeems an empty vault while paused. But v5 creates a stranding class the old design did not have, through the door (d) just closed:

### U-1 — MEDIUM (stated at (c) above): SEAL's invariant now rests on BURN's bytecode, and "fails closed in every case" is false as written.

### U-2 — HIGH: the Bank can never be a multisig. Any wrapper — Squads, a smart wallet, a relayer — makes redemption impossible, and nothing on-chain can stop someone rotating `bank` into one.

The pairing requires both halves as **top-level instructions** with the Bank signing the transaction. A Squads-executed redemption is one top-level instruction into the Squads program; the open's forward scan finds no top-level burn and refuses. Today `config.bank` is a hot keypair, so this is latent. But the obvious, *correct-seeming* operational hardening — "put the Bank key in the Squads multisig like everything else" — silently converts your 2-of-2 into 0-of-2. Worse, you cannot guard it on-chain: `Pubkey::is_on_curve` panics on BPF (your own measured fact 5), so `update_config` **cannot** refuse a PDA bank even in principle. Recovery exists (admin rotates back after the 7-day notice), but a self-inflicted week-long redemption halt is the mildest version; the bad version is discovering it during an incident.

The same applies to SEAL/BURN/MINT/GOV `admin` rotated to a PDA — that bricks rotations themselves, permanently, since only admin can rotate admin.

*Fix:* an ops-checklist line is necessary but not sufficient; add it to the alarm as a standing check (`bank`/`admin` values that equal a known Squads or any PDA the Bank uses elsewhere → CRITICAL), state the hot-key requirement in the spec next to "TRUE 2-of-2" where a future operator will actually see it, and add a suite assertion that a CPI-wrapped redemption is *refused* so the property is pinned by a test, not by this paragraph.

### U-3 — HIGH (question (e), the author's prime suspect): the author is right about the cliff and wrong about the shape of it. The reserve list can strand every vault, and the dead Token-2022 derivations are not what does it.

Redemption is now irrevocably one transaction — open, every sweep, every declaration, the burn — because the burn requires all reserve ATAs empty *in that transaction* and there is no partial redemption by design. The list is additive-only up to 8. Measured: 802 of 1232 bytes at one mint, 17 accounts.

Per added reserve mint, the real cost is **three** new accounts, not two: the PDA's classic ATA (burn declaration *and* sweep source), the PDA's T22 ATA (burn declaration — dead weight, see U-5), and the recipient ATA (sweep destination) — 96 bytes of keys, plus the transfer+close inside the Execute (~36 bytes), plus two remaining-account references. Call it ~130 bytes/mint. That puts the legacy ceiling at **4 reserve mints** (3 mints ≈ 1070, fits with ~160 bytes to spare — today's intended cbBTC/GARY/GIRAFFISH set fits; 4 fits barely; 5 is over). At the configured maximum of 8, legacy redemption is ~1700 bytes: impossible.

Does an ALT rescue it? **Yes, mechanically** — the introspection reads resolved pubkeys, the programs don't care, and a v0+ALT message shrinks every repeated key to a one-byte index. But "an ALT rescues it" is a sentence about a client and a Bank signing flow that **do not exist in this repository and have never been run**. The suite measures the legacy path only. So the honest statement is: today, with 3 mints, redemption fits; an admin adding a 5th reserve mint — an additive, irreversible, well-intentioned config change — strands every vault until someone builds and tests the ALT redemption path under pressure. And there is a second, unmeasured ceiling nobody has touched: **compute**. Eight mints is open + up to eight Execute-wrapped transfer/close pairs + the burn loop over 16 declarations. Nothing in the suite measures CU for even a 3-mint redemption.

*Fix, in order:* (1) build the 8-mint v0+ALT redemption in the suite **now**, before the list grows — it is the difference between "capacity problem" and "stranded Bitcoin"; (2) drop the dead T22 derivations (U-5) to buy back ~33+ bytes per mint; (3) since transaction size cannot be measured on-chain, the suite must assert the serialized size of the *current* reserve count's redemption against 1232, every run, so the day an admin proposes a 4th mint someone sees the number.

### U-4 — HIGH: the fifth program everything rests on is the one the alarm never reads.

Every seal, thaw, sweep and burn in this system is a hand-built CPI into Metaplex Core, a mainnet program with a live upgrade authority that has shipped upgrades before and will again. The test runner pins Core's sha256 locally (`f03e753…`) — and then production never looks at it again. `readConfigs` watches `prog.seal/mint/burn/gov` upgrade authority and bytes, and the collection hash. It does not fetch the Core program account at all. A Metaplex upgrade changing `UpdatePluginV1`, `ExecuteV1` or `BurnV1` semantics lands on every vault you hold with **zero** signal here until behavior visibly changes — and behavior change is the failure, not the detection of it. Your own comment discipline says a comment naming its compensating control gets checked against the control; the runner's "byte-identical to mainnet" gate has no production counterpart.

*Fix:* add `prog.core.upgrade_authority` and `prog.core.hash` to `readConfigs`/`WATCH`, and report a hash different from the pinned `f03e753…` as CRITICAL with the pin named in the message.

### U-5 — LOW (feeds U-3): the author is correct that the Token-2022 derivation is unreachable, and the "halves capacity" framing is wrong.

Unreachable — proven, not argued: the ATA program validates that the mint's owner equals the token program being initialized, so a T22 ATA for a classic-SPL mint cannot be created; and the T22-ATA address is off-curve, so no one can createAccount a raw SPL account there either (a PDA can't sign, and only the ATA program can invoke_signed it into existence). The slot can only ever be absent or junk-lamports, and the loop skips both. **But** it is not free: BURN still *requires the address present* in `remaining_accounts`, costing ~33 bytes per mint of the budget U-3 measures. It accounts for about a quarter of per-mint overhead, not half. Removing it is safe (nothing can ever exist there) and is the cheapest capacity you'll ever buy back; do it as part of the U-3 work, since it changes the `declared` shape.

### Smaller items

- **SEAL↔BURN bank divergence halts redemption (LOW/MEDIUM).** BURN requires its `bank` to equal SEAL's (`WiringDiverged`) and each program rotates its own on its own 7-day clock. Rotating the Bank in SEAL without simultaneously rotating BURN strands every redemption until both land. Fail-closed, but an operational trap: the two rotations are one act and nothing says so.
- **The closed-ATA delegate ALLOW (3.3a) is safe — the argument is TRUE.** A delegate on an account closed in the same transaction authorizes nothing: the account is zeroed, a re-created ATA initializes fresh with delegate `None`, and post-burn the PDA can never sign a new approval. The 3.3 shape (delegate planted, balance moved by owner authority, account left open) correctly refuses. Both directions are what the chain actually does.
- **Re-minting at a burned address (LOW, informational).** Test 6.6 measures that BurnV1 leaves a tombstone (account exists, key byte changed), which is what makes "never exists again" true at that address — a CreateV2 over it would fail. This is a Core behavior you rest on and never named; if Core ever fully closes the account, whoever held the asset keypair could re-mint a *new* vault at the old address, inheriting that address's VoteRecord PDAs and its asset-signer PDA (with any orphaned contents). Worth one line in the spec and one in the Core-watch finding (U-4).

---

## 3. ROYALTY

No defect found in the mechanic. Checked: only the collection update authority (the `["mint"]` PDA) can add or update the collection Royalties plugin, and the PDA signs only through `set_collection_royalties`; the destination is hardcoded to the `["revenue"]` PDA as sole creator at 100%; `basis_points ≤ 1000`; both Core opcodes (`AddCollectionPluginV1`, `UpdateCollectionPluginV1`) are exercised against real Core at 6.26/6.29/6.30, in both directions (6.24/6.25).

Two stated-not-filed limits, verified as accurately stated: (1) after governance rotates to the GOV PDA, `governance` can never sign this instruction (7.18's twin), so royalty changes become a governance-rotation round-trip — the comment says exactly this and it is true; (2) `RuleSet::None` means royalty *payment* is marketplace-honored, not protocol-enforced — no instruction can change that, and the spec does not overclaim it. The `split_bps` comment trail (which previously justified the whole-percent rule via a mechanism that doesn't exist) now says the true thing.

**What a 100% royalty claim would still have to survive:** a marketplace that honors the plugin (off-chain fact), and the collection-hash watch actually firing on the one account that carries this plugin — it is wired, but it hashes bytes it cannot parse, so a royalty change and a metadata change are indistinguishable to it.

---

## 4. VOTING

No new defect. I re-ran the mechanic against v5 rather than trusting four quiet rounds:

- One-vault-one-vote is enforced by the thing that makes it unforgeable: `VoteRecord` at `["vote", proposal, asset]` fails `init` on the second vote, and 7.7/7.9 prove it fails *for that reason* (system `0x0`), not an incidental one — including after transfer.
- Quorum: ceiling division with a non-zero floor, `MIN_QUORUM_BPS=500`, divisor = `max(snapshot, live)`, tally rule snapshotted into the proposal — the 7.13b attack (lower quorum after votes are cast) refuses for `QuorumNotMet`.
- Execution: forward-only (`last_executed_id`, 7.25/7.26), expiry, `RoundAlreadyOver`, and the MINT-side governance check all behave as documented.
- GOV reads MINT's config pinned by address + owner + discriminator + version, one reader for both snapshot and execute — no drift surface.

The documented limits are honestly documented: vote-rental within one transaction (real, unfixed, stated), minting during an open vote (off-chain Bank duty, stated), and `minted_total` never decrementing (quorum liveness rests on the one admin-lowerable parameter — stated). Nothing in v5 changed any of these; a burned vault simply can't vote, which is correct.

**What a 100% voting claim would still have to survive:** the two stated limits above, plus the fact that the 7-day execution deadline has never been exercised (stated in the spec, correctly, as untestable locally).

---

## 5. TRANSFER

No defect, and the v5 change *strengthened* the one thing a buyer cares about. Checked: nothing in the system gates `TransferV1` (the plugin freezes Execute only), so resale is structurally impossible to kill; a sealed vault cannot be Execute-drained by anyone; and the delegate class is now closed *completely* rather than partially — a delegate can only be planted via Execute, Execute requires a thaw, and every thaw either ends in a burn or reverts. There is no transaction sequence after which a live vault carries a delegate on any reserve ATA. The pre-v5 residue case (delegate surviving a close-and-reseal) cannot arise because nothing reseals.

The one thing a transfer does *not* carry forward safely is out of scope of the chain: the buyer's verification recipe (collection membership, `frozen: true`, reserve ATA balances, no delegate, no pending redemption events) is entirely off-chain due diligence. That is not a code fault; it is the product's actual interface and should be written down as one.

---

## 6. SELL

No defect in the mechanic — and the v5 rewrite killed the exact fraud this heading existed to catch. Under v2–v4, "take half, re-seal, resell" was legal; now a partial sweep leaves a balance the burn can see, the burn refuses, and the thaw reverts with it (3.11). A vault that reads as sealed and full on the canonical reserve ATAs *is* full, because no path empties it that leaves it alive.

Two things a buyer's "still contains its reserve" basis rests on that are worth stating because nobody has:

1. **Redeemability is part of the reserve's value, and it is perishable.** A buyer verifying the balance is not verifying that the vault can ever be opened. U-3 (the 5th reserve mint stranding redemption), U-2 (Bank key becoming unusable), and U-4 (Core upgrade) are all ways a *full* vault becomes a *permanently full* vault. The sell mechanic's 100% claim is only as strong as the unbreak mechanic's liveness.
2. **Undeclared contents transfer with the vault and are destroyed at redemption** — by the *buyer's* redemption, after the seller is gone. An airdropped token or nested vault sitting in the PDA at sale time becomes the buyer's loss at redemption. The scan a buyer needs is the same scan the Bank needs (N-1), and it doesn't exist as a consumable artifact for either of them.

---

## 7. NESTING AND AIRDROPS

### N-1 — HIGH: the off-chain completeness control is half-built, and the half that is missing is the half v5 made lethal.

Answering the question directly: **no, there is no on-chain construction that closes this** — enumeration of PDA-owned token accounts and nested Core assets is impossible on-chain, full stop, and the pairing can't change that. And **no, the off-chain control is not actually implemented as described.** Three gaps, in order of severity:

1. **The pre-signature scan does not exist anywhere.** The invariant's stated control — "the Bank must scan with `getTokenAccountsByOwner` and DAS BEFORE it signs, not after" — has no code. There is no Bank redemption-signing tooling in this repository at all. What exists is `alarm.mjs --reconcile`, a **daily batch** (cron `19 4 * * *`). A token airdropped into a vault PDA at 09:00 and redeemed at 09:30 is scanned never. The control the invariant names and the control that shipped are different controls.
2. **The nested-asset half of the scan is absent.** `reconcile()` enumerates token accounts via both token programs — good — but `listVaults()` already fetches every asset in the collection via DAS and reads only `id` and `burnt`. It never looks at `ownership.owner`, so *no shipped code path* detects the 9.1/9.5 shape (vault owned by another vault's PDA) — the single most destructive undeclared case, because it carries a whole vault's contents. This is one filter away: flag any collection asset whose owner is any vault's asset-signer PDA.
3. **The evacuation path exists on-chain and is untested and unbuilt.** This is the part the brief's framing missed: a nested vault is *not* doomed if anyone acts during the parent's redemption. The outer thaw lets the outer PDA sign **any** CPI — including a `TransferV1` of the inner asset to the owner, and transfers/sweeps of every undeclared token account. The correct redemption of a nested vault is `open(outer) → Execute[transfer inner out, sweep everything] → burn(outer)`, and the inner survives in the owner's wallet. Test 9.5 only asserts the orphan outcome because the sweep didn't move it; no test asserts the rescue. So the Bank's job is not merely "refuse to sign a bad redemption" — it is "build the *complete* redemption," and that builder, like the pre-sign scan, is not in this repo. The same is true of undeclared tokens: sweep them, or in the worst case the owner can approve a delegate to themselves during the thaw and recover them post-burn (a delegate on a surviving account outlives the PDA — the 3.3a reasoning cuts both ways, usefully).

*Fix:* implement the ownership check in `listVaults`/`reconcile` (trivial, the data is already there); write the redemption builder that consumes the scan and emits the full open+sweep+evacuate+burn transaction; test the nested-evacuation redemption in section 9 so 9.5 stops being the only asserted outcome.

---

## 8. THE INVARIANT

*Everything stays in the vault until it is broken open, and then the vault is burned and never exists again.*

What survives twelve rounds and this one: containment holds (Execute frozen; no delegate can persist; no partial exit; the burn is the only exit and it is all-or-nothing against everything the proof can see). The tombstone measurement (6.6) currently makes "never exists again" true at the burned address.

What the invariant provably does **not** cover, collected from above so the spec can stop implying otherwise:

- **"Until it is broken open" can become "never," by capacity (U-3), by Bank-key failure mode (U-2), by SEAL↔BURN bank divergence, or by a Core upgrade (U-4).** Containment is enforced; *exit* is best-effort. The invariant as stated claims both.
- **"Everything" is everything the Bank scanned for.** Undeclared holdings are destroyed on the normal exit path now, and the scan that would prevent it is daily, half-scoped (no nested assets), and not wired to the signature it is supposed to gate (N-1).
- **The pairing guarantees the burn instruction is *present*, not that the burn *happened*.** SEAL verifies shape; the effect is delegated to BURN's bytecode and BURN's upgrade authority (U-1). "The vault is burned" is a statement about a program you have to trust, one indirection further than the spec admits.

### Off-chain items raised in the brief, answered

- **`detectBurns` severity: the concern is valid, and it's worse than stated.** Under v5 every legitimate redemption is a `burn_vault` → HIGH, and *also* a `vault_burned` CRITICAL from `detectVaultSetChange` — so the normal product path now pages CRITICAL every time a customer successfully redeems. That is precisely the cried-wolf condition the file's own comment warns about, on the path customers will hit most. The fix is cheap because the data is in hand: `detectBurns` sees the whole normalized transaction — a `burn_vault` with a preceding `open_for_redemption` for the same asset is a *redemption* (INFO); only a bare Core BurnV1 is CRITICAL. Same cross-reference in `detectVaultSetChange`: a vault whose burn was observed in a scanned redemption is expected, not a CRITICAL.
- **`lock.mjs`: correct as far as it goes, and it cannot go all the way.** The link-from-temp create, the refusal on unreadable/empty locks, and the token-matching re-read before unlink close every interleaving I can construct in one process, and the selftest drives both seams. But the admitted microsecond TOCTOU between re-read and unlink is real and is *unfixable by construction* in any unlink-based scheme — you cannot test-and-delete a path atomically. **Yes, flock is the right answer**: an `flock(2)`/OFD lock on an fd held for the process lifetime has no break logic at all, the kernel releases it on death (no staleness heuristic, no pid-recycling question, no unlink race), and "break a dead lock" — the entire fragile half of this file — simply stops existing. The current scheme is an acceptable interim; the 20-hour `staleMs` on the money jobs means a genuinely wedged run blocks tomorrow's payout, which is the correct failure direction, but the durable fix is the one the file already names.
- **Carry-overs (distributor reconciliation, per-cycle operator wallet): still open, still real, not re-litigated.** One sharpening on the trusted hop since I was asked to look at the pipeline: the swap-transaction check in `revenue.mjs` (one signer, forbidden programs) does **not** prevent a tampered Jupiter response from embedding a plain `SystemProgram.transfer` of the operator's whole balance to an arbitrary destination — one signer, no forbidden program, passes. The post-swap delta check catches it *after* the SOL is gone. Simulate the swap transaction before signing and require the operator's deltas (SOL out ≈ amount, cbBTC in ≥ floor); that is the same discipline the Bank owes redemptions, applied to the one trusted hop.

---

## FINAL: WHAT A 100% CLAIM WOULD HAVE TO SURVIVE, PER MECHANIC

- **MINT:** a Core upgrade changing the hand-built CreateV2 layout (nothing watches Core in production); the two Bank duties that exist only as comments.
- **UNBREAK:** a hostile or buggy BURN upgrade preserving discriminator and account order (U-1 — the pairing is shape-only); the 5th reserve mint before an ALT redemption path exists and is tested (U-3); a Bank rotation to anything that cannot sign a top-level transaction, which no program can detect (U-2); a Core upgrade with zero production watch (U-4); a SEAL↔BURN bank divergence window.
- **ROYALTY:** marketplace enforcement (inherent); governance-as-PDA freezing royalty changes (documented).
- **VOTING:** vote rental and mint-during-vote (documented, off-chain); quorum liveness resting on the single lowerable parameter.
- **TRANSFER:** survives everything above trivially — *too* trivially: transferability is the one property that can never fail, which is why U-3/U-2 stranding is the real enemy of the SELL basis.
- **SELL:** the buyer's basis requires not just "reserve present" but "redemption still possible" — currently unverifiable by a buyer against capacity, Bank liveness, or Core version.
- **NESTING/AIRDROPS:** 100% is impossible on-chain, provably; the claim must be restated as "the Bank scans completely and signs completely," which requires building the pre-sign scan, the nested-asset check, and the evacuation builder (N-1) — none of which exist.
- **THE INVARIANT:** as written it claims containment *and* guaranteed exit *and* guaranteed destruction. This codebase currently proves the first, approximates the second, and proves the third only relative to a bytecode it does not control.

The one-line summary for the owner: **the v5 pairing itself survived everything I threw at it — the ways this system now loses Bitcoin are a reserve-list addition that outgrows one transaction, a Bank key hardened into a multisig it can't sign from, a Core upgrade nobody is watching, and a completeness scan that runs daily instead of at the moment of signature.**