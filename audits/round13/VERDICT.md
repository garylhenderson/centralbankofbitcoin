# ROUND 13 — VERDICT

**Organised by MECHANIC, not by file.** Twelve rounds were aimed at source files,
which is how a whole mechanic gets "covered" while nobody asks whether the
mechanic is right — exactly what happened to the redemption path, which was the
*inverse* of Gary's rule through all twelve of them.

Eight models: gpt-5.6-terra-pro, gpt-5.6-luna-pro, grok-4.6, claude-opus-5,
kimi-k3, glm-5.3, qwen3.8, minimax-m3. All eight returned.

## The headline

**THE v5 PAIRING HELD.** Not one auditor could construct a transaction that thaws
a vault and leaves it alive, or that binds one vault's thaw to another's burn.
Every one of them attacked it first, as instructed, across CPI wrappers, address
lookup tables, durable nonces, two-redemption transactions, swapped owners and
partial burns. The answers to (a)–(f) came back the same from the three strongest
reports.

What they found instead is that **the redesign made two pre-existing things
dangerous, and that the compensating control everything leans on does not exist.**

---

## ACCEPTED AND FIXED THIS ROUND

### 1. The reserve list was a kill switch — 3 auditors, independently (HIGH)
A redemption is ONE transaction now and the reserve list is additive-only, so
`MAX_RESERVE_MINTS = 8` was a Borsh bound standing where a packet bound was
needed. One ordinary admin `update_config` could add mints until no redemption
fit and seal every vault that already existed, irreversibly.

The auditors' arithmetic disagreed (grok: "4 to 5 is the cliff"; kimi: "~130
bytes/mint, ceiling 4"; gpt: "8 exceeds it"), so it was **measured** by building
the real transaction (suite 9.14):

| reserve mints | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| legacy bytes | 802 | 946 | **1090** | cannot be serialized |

144 bytes per mint against 1232. **Three is the maximum**, which is exactly the
three reserve assets the business has, with 142 bytes to spare. Cap set to 3 in
SEAL and BURN; 9.15/9.16 assert both constants against the measurement, so raising
one without re-measuring turns the suite red. A fourth reserve mint is no longer a
config change — it needs a versioned transaction, an ALT, and a client that builds
one.

### 2. Every honest redemption rang the alarm — 3 auditors (HIGH)
Under v5 a customer exit IS a burn, so each produced one CRITICAL (`vault_burned`)
plus **two** HIGHs (`burn_via_program`, twice — the transaction touches SEAL and
BURN and is scanned in both walks). That buries `vault_left_index`, the ONLY
detector for the bare Core `BurnV1` the programs cannot prevent.
`burn_via_program` is now INFO; `correlateBurns` separates the two using findings
the pass already holds. It fails SAFE (uncorrelated stays CRITICAL) and a genuine
redemption cannot launder a bare burn beside it — asserted.

### 3. Nothing was looking for a vault inside a vault (found before the round returned)
`reconcile()` scans `getTokenAccountsByOwner`, which is structurally blind to a
Core asset, and no signature scan can see nesting (it is a plain Core `TransferV1`
touching none of our programs). `detectNestedVaults` now runs **every pass at zero
extra cost** — `listVaults` was already fetching `ownership.owner` from DAS and
throwing it away. Both auditors who reached this independently confirmed the gap.

### 4. Metaplex Core was never watched in production — kimi only (HIGH)
`run-tests.sh` refuses to certify unless the local Core is byte-identical to the
pinned mainnet dump; production then watched all four of OUR programs and not the
one underneath them. `prog.core.upgrade_authority` and `prog.core.hash` are now in
the drift watch at CRITICAL.

### 5. The Bank cannot be a multisig, and nothing said so — kimi only (HIGH)
Moving the Bank key into the Squads vault — the obvious next hardening step, and
the one every other authority here has already taken — silently converts the
2-of-2 into a 0-of-2 and halts every redemption, because a Squads execution is one
top-level instruction that CPIs its contents. Cannot be guarded on-chain
(`is_on_curve` panics on BPF). `detectBankIsNotSignable` checks it off-chain at
CRITICAL, and the rule is now stated beside "TRUE 2-of-2".
**Kimi's extension of this to `admin` is REJECTED** — admin's instructions are
single top-level calls with no introspection, so admin-as-Squads is the intended
production shape. Firing on it would make the detector cry wolf about the correct
configuration; that exemption is asserted so nobody "fixes" it later.

### 6. Two stale comments the rewrite left behind (found while fixing the above)
The alarm's all-clear claimed "no burns" while listing one beneath it, and
`detectBalanceDrops` still told the reader to read a drop against an open/close
stamp that no longer exists. Under v5 a **live** vault's reserve cannot
legitimately fall at all — every route out of an SPL token account needs a thaw,
and every thaw ends with the vault destroyed.

---

## MEASURED AND REJECTED

**"Core's `BurnV1` closes the asset account, so the address is re-mintable"**
(claude-opus-5, MEDIUM). Stated to falsify the invariant's "never exists again"
and to replace DAS's burnt entry. **Wrong on every particular**, measured against
real cloned mainnet Core (9.12/9.13): the account survives, still Core-owned, with
**2,495,280 lamports** and one byte of data at `Key::Uninitialized`, and a re-mint
at that address *holding its keypair* is refused by the System program with
"account already in use". Recorded as an assertion so the claim never has to be
re-litigated — and, per kimi's better version of the same observation, noted in
SPEC as a Core behaviour we depend on and do not control.

**"The dead Token-2022 derivation halves redemption capacity"** (grok). Kimi
proved the sharper version: it is unreachable (the ATA program validates that the
mint's owner equals the token program, and the T22 ATA address is off-curve so no
one can create a raw account there either) and costs ~32 of the 144 bytes per
mint — about a **quarter**, not half. Removing it is safe and is the cheapest
capacity available, but it changes the emptiness proof and is not being done in
the same session as the redesign. Carried.

---

## ACCEPTED, NOT FIXED — carried to round 14

1. **No Bank co-signing tool exists at all.** Every document and both program
   headers leaned on "the Bank scans before it signs". Nothing signs a redemption,
   so nothing scans. The comments and SPEC were corrected mid-round to say what
   exists: **detected within thirty minutes, never prevented.**
   gpt-5.6-terra-pro added the part that matters most: **even a correct pre-sign
   scan can never be a proof.** A third party can fund a PDA-owned token account
   after the scan and before the transaction lands. There is no transaction-level
   read lock over "everything this PDA owns" and no on-chain enumeration to move
   the check into `burn_vault`. A signer is a mitigation; it closes the nesting
   case (which needs the owner's cooperation) and narrows, but cannot close, the
   airdrop case.
2. **`bank/lock.mjs` is still not exclusive** (round 12 carry-over, now with a
   concrete interleaving from three auditors): two runners read the same stale
   lock, A unlinks and re-`link()`s, B then unlinks **A's fresh lock** and claims
   its own, and both pay. Re-reading before unlink narrows the window; it does not
   make compare-and-unlink atomic. The fix is `flock`/`fcntl` on an open fd — a
   kernel lease the OS drops on death — not a better break protocol.
3. **Distribution still reconciles against a ledger the payer wrote** (round 12
   carry-over, unchanged).
4. **A fresh per-cycle swap operator wallet** (round 12 carry-over, unchanged).
5. **Drop the Token-2022 ATA declarations** (see above) — buys back ~32 bytes per
   reserve mint and would make a 4th mint reachable on a legacy transaction.
6. **Compute units are unmeasured.** Bytes were measured; nothing measures CU for
   even a 3-mint redemption. A second, unexamined ceiling.
7. **A CPI-wrapped redemption is refused by argument, not by a test.** Pinning it
   needs a wrapper program in the suite.
8. **SEAL↔BURN Bank rotation is one act and nothing says so.** Rotating the Bank
   in SEAL without BURN strands every redemption on `WiringDiverged` until both
   land. Fail-closed, but an operational trap.
9. **Duplicate attribute keys at mint** (gpt-5.6-terra-pro): `mint_vault` bounds
   count and length but does not reject duplicate keys, so `charter` can be
   stamped twice with different values and consumers disagree depending on whether
   they take the first, the last, or all.
10. **MINT still carries the dead redemption stamp** — the Attributes plugin is
    delegated to the SEAL PDA that no longer writes attributes, `ReservedAttribute`
    guards a stamp that does not exist, and a comment bounds attributes to what
    `mark_opened` can preserve. Not reachable (SEAL has no generic CPI
    dispatcher, confirmed by two auditors); left deliberately rather than making a
    second risky change in one session.
11. **A vault minted during a proposal may vote** (stated limit, re-raised).
12. **A buyer cannot verify reserve continuity atomically at purchase** (stated
    limit, re-raised). v5 removed the empty-resale lie; it did not add an
    attestation.

---

## STATE

`264` on-chain assertions (was 227) · `221` detector (was 195) · `17` allocation ·
`11` mainnet. Every floor equals its real count, and the two off-chain suites got
a floor for the first time this round — `pipefail` made a crash fail the build,
but deleting assertions kept it green.

**Nothing is deployed. Nothing has minted. Nothing holds real value.**

Thirteen rounds; **thirteen have found something real.** The stopping condition
— two consecutive rounds where no finding survives measurement — has still been
met zero times, and this round is the least converged of the thirteen, because
the mechanic it examined had never been examined at all. The human audit firm on
a frozen version is still owed.
