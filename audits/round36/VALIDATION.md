# Round 36 repair validation

Round 36 is NOT CLEAN on both passes; quorum was met on both (programs 7/8,
off-chain 6/8 after same-content re-runs of provider-failed seats: MiniMax and
DeepSeek recovered, Opus 5 and Kimi K3 failed again; failed outputs and the
first-run manifest are kept). The audited tree was `9480314`. No confirmed
defect is in the five programs and no repair changes a program. Consecutive
clean rounds stay 0 of 2.

Process note: two commits (`667731c`, `6bc3b49`) landed during the round. They
touched only `web/` files, which are not in the off-chain bundle; the programs
pass is judged against `9480314`, as both verdicts state. Since then the tree is
scope-frozen (Gary's ruling, SPEC gate 3).

## Repairs, programs pass (`VERDICT-programs.md`)

- **H1 (HIGH, redeem page):** a stranger could block an opening by freezing the
  holder's own destination for a junk mint. A stray is now never delivered when
  its mint can be frozen by anyone, its destination is frozen, or its mint is
  unreadable: it is named for the holder to tick and stays behind. Only problems
  with the three reserve accounts, a nested CBOB vault and a non-owner signer
  refuse.
- **L1:** the RPC proxy relays only transactions that call a CBOB program (plus
  three exact page shapes without one).
- **L2:** "Run a payout" expires due boosts first (matches the suite's expiry
  bytes).
- **L3, I2:** SPEC's C5 limit and item 38 corrected.
- **L4:** the pages pin the release commit and the build refuses a `dist/` that
  is not a clean build of it.
- **L5, I1:** the ceremony's hash reference and step-9 wording corrected.

## Repairs, off-chain pass (`VERDICT-offchain.md`)

- **L1, L2, L5:** SPEC text (the sweep helper cannot take a kept-close-authority
  account at all; the rescue always goes to the Squads; an index lag always
  pages once, then clears).
- **L3:** `unredeemable_owner` names the execute and the rescue, not "sealed for
  good".
- **L4:** `ACKABLE_KINDS` is now `unredeemable_owner` only.

## Gate 5

On chain: R36.C5 (a helper sweep naming a kept-close-authority account reverts,
nothing moves), R36.G2a/b (the two refusal reasons, each pinned; G2b's text was
first written from memory and corrected to the measured one). Detectors: C06
(revenue.mjs's own sweep compiles with the operator as fee payer and signer),
L5 (the alarm interval exceeds the router grace), L3, L4. Pages: frozen and
freezable-destination strays, the proxy refusals, release binding, the bundle
hash table, a payout with a due boost (offline and on chain), a claim-first
opening of an active vault with a month due, and the largest C5 opening
measured (2 transfers: 1,226 bytes, 180,852 CU).

## Pre-round-37 drift sweep (Gary's ruling)

An independent sweep found 16 holder-facing and 29 internal stale statements in
SPEC, HOLDER-GUIDE, DESIGN-v6, web copy and README; all applied except one it
disproved (D-B-11). Two more it noted were fixed (item 50's heading, DESIGN's
"nothing is deployed"). The redemption poster now numbers vaults from one, as
the metadata does (Gary's ruling).

## Validation

- Detector selftest **920/920**; launch **49/49**; poster **24/24**; web offline
  **518/518**.
- Canonical run (frozen runner, `CBOB_SHIP_GATE=1`, `.cache/r36c-suite.log`):
  **EXIT 0**, on-chain **895/895** (floor 895), detectors 920/920, allocation
  39/39, mainnet history walk 33/33, expiry 4/4, swap fork 16/16.
- Pages end to end on a local validator (`.cache/r36c-web-e2e.log`): **103/103**.
