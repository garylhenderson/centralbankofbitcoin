# Round 40 repair validation

Round 40 is NOT CLEAN on both passes, quorum met (programs 7/8; off-chain 6/8,
no margin: Opus 5 failed with a provider error, and MiniMax was not counted on
either pass because it described round 39's tree). Audited tree `8dba479`,
scope-frozen. No confirmed defect in the five programs (none since round 27)
and no repair changes a program. Consecutive clean rounds stay 0 of 2.

## Repairs, programs pass (`VERDICT-programs.md`)

- **V40-1 (MEDIUM, pages):** a stranger sending about 0.00065 SOL to a token
  account address that does not exist yet made the redeem page refuse with a
  false reason ("could not be read", "frozen by its issuer"). `absentIfDust`
  now reads a System-owned, zero-data account at an expected token-account
  address as ABSENT and creatable, in every reader (redeem, vault, buy pages,
  ceremony, generator); the ATA program's create still lands there (suite
  R34.G2). A real token account that cannot be parsed still refuses.
- **V40-2 (LOW, ceremony):** the same dusting no longer makes step 5 print a
  false "WRONG ON CHAIN: STOP"; it creates the account.
- **V40-3 (LOW, generator):** a dusted cbBTC address reads as 0 sats; the new
  vault's file is written.
- **V40-4 (LOW, SPEC):** discharged item 2 now names the redeem page's remaining
  by-design refusals instead of "nothing refuses", none of which a stranger can
  cause.
- **V40-5 (INFO, page):** the nested-vault note no longer claims who sent it in.

## Repairs, off-chain pass (`VERDICT-offchain.md`)

- **C01 (LOW):** the ceremony test's remember check now requires the call.
- **C02 (LOW):** the swap floor is pinned by hand (2 SOL at the fixture prices:
  280,355 sats expected, 276,149 minimum at 150 bps). Red with the tolerance at
  9000 bps.

## Gate-5 obligations closed (including two carried from round 39)

- **U1:** the large-autograph vault's complete redemption simulated with NO
  compute-budget instruction, as the page sends it; units recorded (R40.U1).
- **C10:** the crank's attribute reader reads the richest vault shape and
  vaults carrying plugin types Core does not know (77, 40).
- **W1 (r39):** txread accepts a Token-2022 `transferCheckedWithFee`, refuses a
  `transfer` with no amount, accepts one with it.
- **W2 (r40):** a grouped consent at the press: no stop, nothing re-listed.
- **W2 (r39):** a delegated classic stray handed to the vault by
  `SetAuthority(AccountOwner)` loses its delegate and is delivered (e2e).
- **W5 (r39):** a read-only `solana program dump` of the MINT id on mainnet
  (2026-10-08) returned 20,920 bytes equal to the placeholder (sha256
  `94f75099…`), ELF `e_flags` 3 (SBPF v3), the same as every `dist/` binary.

## Pre-round-41 drift sweep

No holder-facing items. Five internal items in the web README and a comment,
fixed; the 375px check re-run with `MOCK_DUST=1`.

## Validation

- Detector selftest **933/933**; launch 49/49; poster 24/24; web offline
  **657/657**.
- Canonical run (`.cache/r40b-suite.log`, `CBOB_SHIP_GATE=1`): **EXIT 0**,
  on-chain **896/896** (floor 896), allocation 39/39, mainnet walk 33/33, expiry
  4/4, swap fork 16/16. U1 measured: the large-autograph vault's complete
  redemption uses **158,377 CU over 4 instructions** at the default budget.
- Pages end to end (`.cache/r40b-web-e2e.log`): **127/127**, including both
  dusted addresses (the vault's missing reserve account and the holder's
  account for a delivered stray) created by the set-up and the opening landing,
  and the delegated stray delivered. The first run's two misses dusted a holder
  account for a stray this opening does not deliver; the arm was corrected, the
  page was right.
