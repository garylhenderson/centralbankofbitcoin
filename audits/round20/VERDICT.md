# ROUND 20 — VERDICT

**NOT CLEAN. The freeze counter stays at zero.**

Programs pass: **6 of 8**, quorum met exactly, `head=045fcc0`, `dirty=[]`.
Off-chain pass: **5 of 8, QUORUM FAILED** — not verdict-bearing, must be re-run.

## The convergence

SIX OF SIX programs auditors, from four model families, independently reached the
same root cause in `bank/deck.mjs` — the file `audit-coverage.sh` named as the one
never sent to an auditor in twenty rounds. That is the strongest agreement this
project has ever produced on a single finding.

## CONFIRMED BY MEASUREMENT

### 1. CRITICAL — the deck commitment is not binding. It exists only in a comment.
`commit_deck(ctx, root: [u8;32])` accepts ANY 32 bytes. `grep -rniE
'bank_salt|salt_hash|reveal|commit_slot' programs/` returns ONE hit and it is a
docstring. Nothing records `sha256(bank_salt)`, nothing records the slot, nothing
checks the root against either, and no reveal instruction, deadline or penalty
exists anywhere.

The root binds the Bank AFTER it commits — every mint proves its level against it
at `index = minted_total`, and that half is real. What is not enforced is that the
root came from an unpredictable seed. **And the Bank co-signs every mint**, so it
controls ordering: build a deck with Level V at low indices, co-sign chosen parties
first. That is precisely what levels-at-mint was built to prevent, and it lands on
the one property Gary ruled on — "no way to game it".

**The register moved on chain; the trust did not.** A theorem in a comment is a
claim, not a control.

### 2. HIGH — accepted limit 1a UNDER-CLAIMS, and it was frozen yesterday.
SPEC's limit 1a says "the program allowlist AND the Bank-pubkey confinement are
OFF-CHAIN". Measured: the confinement is **ON-CHAIN in both programs** — SEAL's
`open_for_redemption` refuses `BankKeyOutsidePair` (lib.rs:450), MINT's
`mint_vault` refuses `BankKeyOutsideMint` (lib.rs:912). `bank/cosign.mjs` states
this explicitly and correctly, and adds that only the PROGRAM ALLOWLIST and the
FEE PAYER remain policy.

**The file I copied the limit from was stale, and the file that contradicts it was
in the same bundle.** Phase 1 built the mechanism that stops this — the round-20
prompt reads the limits FROM SPEC — and then seeded SPEC from the stale source
without measuring it. A fix is a place a defect can live.

### 3. HIGH — item 19's DISCHARGE IS WRONG. The halt is still customer-reachable.
Phase 1 discharged the unlevelled-vault halt as closed by construction. The route
it closed is real: there is no activated-but-unlevelled window. But a second route
was never considered, and TWO auditors found it.

An owner bare-burns their vault — Core allows it and proven impossibility 1 says
nothing can prevent it. In v5 **redemption IS a burn**, so this is the product's
main mechanic. Until DAS indexes it the vault is still listed LIVE, `fetchAsset`
hits a `Key::Uninitialized` tombstone and throws, and the level loop routes that
into `unreadableLevels` -> refusal -> **the whole distribution pays nobody**.

**Two loops in one file disagree about one event.** The PAYMENT loop already
handles exactly this (`stillThere.data[0] !== 1` -> skip that vault, carry on,
line 820). The LEVEL loop treats it as chain-and-code-disagree and halts everyone.
One fact, two readers, different verdicts — the signature defect.

### 4. MEDIUM — 11.11 is a gate that CANNOT FAIL, and the packet bound was never measured.
`for(let n=0;n<=7;n++)` caps `maxAttrs` at 7. The program refuses
`attributes.len() >= 8`. The assertion is `maxAttrs < MAX_ATTRS_BORSH` i.e.
`7 < 8` — **always true, unfailable by construction.** At depth 7 the measured
answer was 7, meaning the packet never bound at all; the loop ran out of
iterations at the program's own ceiling.

So SPEC and the freeze log say "measured at depth 7: seven fit and the eighth will
not serialize". **The eighth is refused by the PROGRAM, not the packet.** A
document asserting a measurement nobody made — the same class as the compute-unit
claim Phase 1 found, one day later.

### 5. HIGH — `level_caps` and the committed deck's census can disagree permanently.
`initialize` checks `cap_total <= max_supply` and all caps > 0. Nothing checks the
deck's per-level counts against `level_caps`; the root is opaque bytes. A deck
dealing more of a level than its cap bricks minting at that index forever — root
commits once, no re-deal, no skip.

## STILL TO MEASURE
The remaining findings across the six reports, and the depth-11 packet budget at
the real 2,100-card census, which needs a production-depth probe rather than
arithmetic.


---

## THE FIXES, AND THE TWO DEFECTS THEY INTRODUCED

**Finding 1 — the binding commitment, on chain.** Two one-shot instructions:
`commit_seed(sha256(bank_salt))`, after which the PROGRAM fixes the entropy slot
as `current + 32`; then `commit_deck(root, bank_salt)`, which re-hashes the salt
against the commitment, reads that slot's blockhash out of the SlotHashes sysvar,
derives the seed itself and STORES IT ON CHAIN.

**One freedom was taken away that the auditors did not ask for.** Six of six asked
for a committed salt and a NAMED future slot. Naming the slot is one more input
the Bank controls, and an input the Bank controls is an input the Bank can grind,
so the program derives it. By the time `commit_deck` runs there is nothing left to
choose.

**Finding 2 (non-revelation) is deleted rather than mitigated.** There is nothing
to reveal: the seed is public the instant the deck commits. What is NOT claimed —
and is written into `bank/deck.mjs` as a stated limit — is that the program
verifies `root` IS that seed's deck. It cannot; a 2,100-card shuffle in BPF is not
a thing to add days before a freeze. What changed is that a wrong root is now
PROVABLY wrong to any observer instead of indistinguishable from a fair one.

**Finding 3 — the halt.** A tombstone is now a skip, exactly as the payment loop
already did; an RPC error or a genuine chain/code disagreement still halts. A read
that could not be made is never assumed to be a burn.

**Finding 4 — the unfailable gate.** 11.11 probes to 64 and asserts the packet
actually bound; 11.11a/b/c measure the PRODUCTION depth.

### ⚠️ AND THE REPAIRS CARRIED TWO DEFECTS OF THEIR OWN. THE SUITE CAUGHT BOTH.

1. **A REJECT FOR THE WRONG REASON.** The one-shot `deck_root` check went LAST in
   `commit_deck`, so by section 11 — when the entropy slot has aged out of
   SlotHashes — a re-deal was refused as `DeckSlotUnavailable`. Nothing was open;
   the message was wrong, and "one-shot is the control" must be spoken by the
   check that enforces it. `because('11.9','DeckAlreadyCommitted')` is what found
   it. Moved to the top.
2. **THE FIX FOR THE UNFAILABLE PROBE WAS ITSELF UNFAILABLE.** Raising the ceiling
   7 -> 12 returned **12 at depth 7, 12 at depth 11 and 12 at depth 13**. Three
   geometries, one number: a loop ceiling, not a measurement — committed one hour
   after writing the note explaining that exact failure. Ceiling 64 now, and the
   arms assert both that the packet bound AND that a deeper deck buys fewer
   attributes.

**A fix is a place a defect can live, for the ninth round running.**

## THE MEASUREMENT THAT REFUTES A CRITICAL

| deck depth | vaults | caller attributes the PACKET holds |
|---|---|---|
| 7 | ~90 | 29 |
| **11** | **~2,100 (production)** | **18** |
| 13 | ~8,192 | 13 |

The program allows 7. **At the real census the PROGRAM binds, not the packet** —
so deck size does not squeeze provenance at any size this product will use, which
reverses what accepted limit 23 implied. An auditor's CRITICAL that not even zero
attributes fit at depth 11 is refuted by measurement.

## STATE

Suite **330 / 439 / 103 / 17 / 19**, all green, every floor equal to its count.
The freeze counter is **reset to zero** — three of these fixes are `programs/` and
`bank/` changes, which is exactly what Phase 2 says must happen and must be logged.

**The off-chain pass never reached quorum and must be re-run before round 20 can
be called complete in both halves.**
