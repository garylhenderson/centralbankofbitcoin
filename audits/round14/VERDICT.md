# ROUND 14 — VERDICT

**Pointed at the REPAIRS**, because round 13's eight auditors saw v5 (committed
17 minutes before the round launched) and **not one of the fixes it produced**.
Plus the five files that had escaped every round, and round 13's own verdict, so
the auditors could attack the accept/reject calls.

Eight models. kimi died on a transport error and was re-run alone; all eight
reports are in this directory.

**First round run under the ruling that there will be no human audit firm.** The
prompt said so, and told the auditors what that changes: a finding you decline to
write is a finding nobody writes, and a wrong CRITICAL now costs real engineering
time with nothing downstream to sort it out.

## The headline

**THE v5 PAIRING HELD A SECOND TIME.** grok and glm each attacked it directly and
neither could construct a transaction that thaws a vault and leaves it alive, or
that binds one vault's thaw to another's burn. kimi: *"I could not construct a
laundering. The per-asset correlation is complete, GIVEN one on-chain fact, and
that fact holds."*

**Everything found was in round 13's repairs or in the never-audited files.**
Zero findings in the four programs' logic. That is the third round running where a
file no auditor had seen produced the worst finding.

**Three of the six were the same shape: a fix applied to one of N identical
sites. All three were mine, written the same day.** That is this project's most
repeated defect and it now has a six-round streak, each time inside the repair
for it.

---

## ACCEPTED AND FIXED

### 1. `scripts/validate-core-gate.sh` could not fail (gpt-terra, minimax — HIGH)
The script that proves the gate that proves the test environment that certifies
everything else. **Never audited in thirteen rounds.** Broken two ways:
- **No `set -e`**, and every arm's verdict was an `echo` — including
  `!!! FALSE PASS — gate is useless`. The last line was `kill_v`, which succeeds.
  It printed that a gate was worthless and **exited 0**.
- **It validated the wrong directory.** `CACHE=/tmp/cbob-vault-test` while
  `run-tests.sh` reads `${CBOB_CACHE:-/opt/cbob-vaults/.cache}` — whose own
  comment says why it moved: *"NOT /tmp: it is world-writable, and this directory
  holds the Core binary every gate below compares against."*

Rewritten with `set -euo pipefail` and `must_fire`/`must_pass` that exit non-zero.
Proven in both directions (a gate that always passes and one that always fires
each exit 1) and green across all three arms on the real thing.

### 2. `correlateBurns` rewrote ONE of FOUR sites (opus — HIGH)
A redemption of an activated vault produces `vault_burned` **and**
`vault_vanished` (CRITICAL, from `detectDeactivations`, which never mentions
burning), plus `deactivated` and `reserve_fell` on a one-pass DAS lag. The repair
covered `vault_burned` alone, so **every honest exit still rang a CRITICAL** and
`vault_left_index` stayed exactly as buried as before — the fix delivering none of
what it was written for. Now an explicit `REDEMPTION_NOISE` allowlist covers all
four. The allowlist is the point: an approve by the vault's PDA, a nested vault,
an undeclared account or `vault_left_index` on the same asset stay at full
severity, because **a burn must never launder the evidence of something that
should not have happened**. Both regressions proven to go red.

### 3. Nesting is the narrow subcase of a general one (opus — CRITICAL)
A vault owned by **any** off-curve address can never be redeemed: v5 needs two
TOP-LEVEL owner signatures and a program signs only by CPI. **Identical mechanism
to `detectBankIsNotSignable`, which round 13 added for the Bank and not the
owner.** And it is reachable by accident — `mint_vault`'s `owner: Signer` does not
prevent it, because `is_signer` is TRUE for a PDA passed as a CPI signer, and
MINT's comment calling that "strictly stronger" than an on-curve test is wrong.
Test 5.2 does not cover it either: it passes the PDA with `isSigner:false` and is
refused by `AccountNotSigner`, a different property. **A DAO buying a charter
vault from its Squads treasury pays, deposits real cbBTC, and receives a
permanently sealed asset.** Nothing on-chain can refuse it; detection is the whole
control, now `unredeemable_owner` at CRITICAL.
*Stated rather than guessed:* an off-curve owner may also be a marketplace escrow
holding a listed vault, which is recoverable. We do not know whether Core
marketplaces escrow or use a transfer delegate, so the finding names both
readings. Nothing has minted, so zero false positives today.

### 4. A CRITICAL nobody can act on (kimi — MEDIUM)
`vault_owns_itself` is bricked by construction; `nested_vault` into a burnt host
is unrecoverable; `unredeemable_owner` on a DAO-held vault may never clear. Each
would fire CRITICAL every thirty minutes forever — **which is exactly how
`vault_left_index` gets scrolled past.** The project's own rule, written after
round 10: *a finding with no way to be answered is one that will eventually be
ignored rather than answered.* Round 13 broke it in the commit that quoted it.
`applyAcks` + a separate `bank/acks.json`, keyed `<kind>:<asset>`. It **downgrades
to INFO and keeps the finding printed with its reason** — never deletes, because
silencing something is how it stops being true unnoticed. The reason is mandatory
(a non-empty string, not `true`), and the report prints the acked count every pass
so a growing ack list is as visible as a growing finding list.
**And the first `readAcks` would have acked NOTHING, forever** — a bare
`readFileSync` that is not imported in that file, whose ReferenceError landed in
its own catch. It read as wired and did nothing. Absent and broken are now told
apart; the judgement moved into a pure `parseAcks` tested both ways.

### 5. Three more comments claimed the nonexistent Bank co-signing control (kimi — MEDIUM)
SEAL's `Config.reserve_mints` doc, BURN's "what this can and cannot prove", and
SPEC's proven impossibility 2 — the last contradicting SPEC's own table two
sections away. **Sixth round for this class**, surviving inside the repair for it.
All three now **point at** the control table in SPEC rather than restating it, so
there is exactly one place to change when the Bank signer exists.

### 6. Two floors and a swallowed failure (kimi — LOW)
`selftest.mjs`'s own internal `FLOOR` was **195 against a real 221**, in the same
commit that added the external floor and claimed every floor equals its count —
and SPEC documents running that file directly, bypassing the runner. Fixed.
And my floor commit had **swallowed the output of a failing selftest**:
`OUT=$(cmd)` under `set -e` aborts before the echo, where the `| tail -3` it
replaced always printed. Proven: a deliberately broken assertion now prints AND
fails the build.

### 7. My own harness, found before the round returned
`9.14` **compared a value to itself** and could never go red (grok caught it
independently) — a real measurement dressed as a gate. Pinned to a literal, plus
`9.14a` pinning the BYTES, because the count is a step function.
The ceiling harness **never swept the PDA's lamports** — a vault nobody had
griefed — so the worst case is 831/975/**1119**, not 802/946/1090. Three still
fits; honest headroom 113, not 142.
**Only TWO reserve mints fit if the redeemer must create their destination ATAs**
(9.14b, glm). Creating them need not be atomic with the burn, so it MUST be a
prior transaction — now a written requirement on any redemption client instead of
a silent assumption.
`detectNestedVaults`' docstring called the foreign-asset gap "the reconcile's
job"; the reconcile is structurally blind to a Core asset. **The over-claim class
again, in the fix for it, written the same hour.** It now says OPEN GAP.

---

## CONFIRMED CORRECT BY THE AUDITORS

- **The admin exemption from `detectBankIsNotSignable` is right.** kimi checked
  every admin instruction in all four programs; grok and glm agree. Admin's calls
  are single top-level instructions with no introspection, so admin-as-Squads is
  the intended shape. Round 13's rejection of the "flag admin too" extension
  stands, and the exemption is asserted so nobody "fixes" it later.
- **The closed-ATA delegate ALLOW (3.3a) is safe** — kimi: *"Both directions are
  what the chain actually does."*
- **Burnt hosts belong in `detectNestedVaults`** (minimax, glm, kimi).
- **`bank/anchor.mjs` is correct** — the never-audited fix for a defect class
  survived its first reading, with one LOW.
- **Account sizing after `MAX_RESERVE_MINTS = 3` is correct** (minimax, kimi).
- **No laundering of a bare Core burn into INFO could be constructed** (kimi,
  glm, grok).

---

## ACCEPTED, NOT FIXED — carried to round 15

1. **No Bank co-signing tool exists.** Being built next.
2. **`bank/lock.mjs` is still not exclusive.** Being built next.
3. **Cross-pass correlation lag** (kimi R1-b, glm R1-a): the "self-correcting"
   claim is too strong. If the signature walk reaches the burn in a *later* pass
   than the DAS diff, the CRITICAL already went out and nothing retracts it. The
   fix is a short memory of recently-seen `burn_via_program` assets.
4. **Compute units are unmeasured** — a second ceiling that may sit below the byte
   ceiling (four auditors).
5. **`prog.*.hash` slices at a fixed offset 45**, which is wrong when a program's
   upgrade authority is absent (gpt-terra, minimax): the ELF starts at 13 then.
   Pre-existing; now applies to Core too.
6. **The foreign-nested-asset gap is closable** with a per-vault DAS owner search
   and was not closed (kimi R3-b).
7. **`burn_via_program` does not verify the asset is one of ours**, so the
   correlation key is caller-supplied (opus R1-4).
8. **SPEC still contradicts the implementation on sweep authorisation** and
   carries stale assertion counts in "Running the tests" (gpt-terra, kimi).
9. **MINT still carries the dead redemption stamp** and its "strictly stronger"
   comment is now known to be false (see accepted finding 3).
10. Round 12's originals: chain-derived reconciliation of distribution outputs; a
    fresh per-cycle swap operator wallet.
11. Duplicate attribute keys at mint; a vault minted during a proposal may vote;
    a buyer cannot verify reserve continuity atomically. All stated limits.

---

## STATE

`267` on-chain · `250` detector · `17` allocation · `11` mainnet. Every floor
equals its real count — including `selftest.mjs`'s own, which did not until this
round.

**Nothing is deployed. Nothing has minted. Nothing holds real value.**

Fourteen rounds; **fourteen with a real finding.** THE SHIP GATE (SPEC.md) has
been met zero times. Round 14 changes the shape of the argument, though: for the
first time the four programs produced **no** finding, and everything landed in
same-day repairs and in files nothing had ever read. Both of those are now
measured — `scripts/audit-coverage.sh` for the second, and the freeze for the
first, since repairs are only dangerous while there are still repairs.
