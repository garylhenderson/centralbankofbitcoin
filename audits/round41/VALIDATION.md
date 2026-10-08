# Round 41 repair validation

Round 41 is NOT CLEAN on both passes, quorum met (programs 8/8; off-chain 7/8,
the Qwen 2.4T seat not counted: its report was one sentence of intent and two
unexecuted tool stubs). Audited tree `5741f0e`, scope-frozen. No confirmed
defect in the five programs (none since round 27) and no repair changes a
program. Consecutive clean rounds stay 0 of 2.

## Repairs, programs pass (`VERDICT-programs.md`)

- **V41-1 (LOW; claimed MEDIUM):** a stranger sending about 0.00065 SOL to each
  of the four program config addresses left System-owned, zero-data accounts
  there, and the pages read them as configs that could not be parsed. Every
  page's config, vault-record, collection and buy-snapshot read now treats a
  System-owned, zero-data account as absent (`absentIfDust` in `anchorAccount`,
  `readVault`, `resolveCollection`, `readBuySnapshot`). The pre-launch pages say
  "not initialised yet", and the ceremony's `initialize` still lands on the
  dusted address.

## Repairs, off-chain pass (`VERDICT-offchain.md`)

- **C01 (LOW):** the redemption poster deduplicated by transaction signature
  alone, so a second redemption in the same transaction was silently dropped.
  Drafts are now keyed `signature:vault` (`draftKey`). R41 C01 runs the poster
  loop on a two-redemption transaction (two drafts; a re-read drafts none).
  It turns red under a signature-only key.
- **C02 (LOW):** the oracle-age bound was pinned only through the constant it
  tests. R41 C02 now pins 180 s in literals: 181 s is refused and 180 s is
  accepted. It turns red at 300 s.
- **C03 (INFO, documentation exception):** SPEC's crank rows describe the fee
  key's budgeting correctly. The key is refused only below the plan's cost
  without its reveals, and then keeps as many reveals as leave it at or above
  0.005 SOL. Text only. **Independently re-verified before round 42: PASS**
  (`.cache/drift42.md`, job 1, by a probe of `budgetPlan`). Wording tightened
  from "above" to "at or above" (drift B1).

## Gate-5 obligations closed

- **C04 (measured rejection, pinned):** a redemption of an undrawn (level 0)
  vault makes the poster run refuse loudly. It throws "is not I..V", queues
  nothing and keeps its cursor; it never drafts "Level undefined". R41 C04
  turns red when the level check accepts 0.
- **C06 (measured rejection, pinned):** the minimum sweep is 0.01 SOL in a
  literal (`10_000_000n`), and `sweepAmount` returns 0 just below it and the
  amount at it. R41 C06 turns red with the minimum at 1 SOL.
- **C8 (programs, measured):** SPEC item 50's rent rule is now a measurement.
  A 1-lamport System credit to a fresh address is refused for rent, and the
  address stays empty (R41.C8a). A credit of exactly the rent floor lands
  (R41.C8b, control). A credit of the floor minus one to an emptied vault
  wallet is refused (R41.C8c). So a vault wallet never holds a sub-rent
  balance, and a lamports-only sweep credits either 0 or at least the floor.
  The "sweep below rent to a nonexistent destination" the triage asked for
  cannot be built for exactly this reason; R41.C8c is the measurement of that.

## Pre-round-42 drift sweep (`.cache/drift42.md`)

- **Holder-facing:** none.
- **Class A (dust class in `bank/`):** A1-A3 fixed. `isSystemDust` was added to
  `bank/anchor.mjs`: `pinnedAccountData` returns null for dust,
  `readTokenAccount` reads dust as absent, and the alarm's config read marks a
  dusted config missing. They are covered by arms R42 A1 (the pinned reader and
  the alarm's own extracted `g()`) and R42 A2/A3. Each turns red under its
  mutation.
- **Class B:**
  - B1, B2 (SPEC header now "round 41, 2026-10-08"), B4 and B5 (two crank fee
    comments) are fixed.
  - B3 is this round's FREEZE row.
  - B6: the gitignored `web/dist-mainnet-local/` is stale. It is rebuilt
    before any ceremony use and is never served as is.
  - B7 (ops, not a doc): the live crontab's CBOB block is still the v5 one. It
    runs a `bank/distribute.mjs` that no longer exists and has no crank or
    reconcile line. It is left for Gary's go-live decision: re-run
    `scripts/cron-install.sh`.

## Validation

- Detector selftest **940/940**; launch 49/49; poster 24/24; web offline
  **671/671**.
- Canonical run (`.cache/r41b-suite.log`, `CBOB_SHIP_GATE=1`): **EXIT 0**,
  on-chain **899/899** (floor 899, including R41.C8a-c), allocation 39/39, mainnet
  walk 33/33, expiry 4/4, swap fork 16/16; launch, poster, proof-of-burn and host
  floors held.
- Pages end to end (`.cache/r41b-web-e2e.log`): **129/129**, including
  all four config addresses dusted by a stranger: preflight shows no conflict,
  step 0 is still next, and every ceremony step then lands on the dusted
  addresses.
