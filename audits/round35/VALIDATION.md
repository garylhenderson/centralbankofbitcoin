# Round 35 changes and validation (round 35 itself NOT COUNTED)

Round 35 did not reach quorum (`NOT-COUNTED.md`). Its seven usable reports were
triaged independently (`TRIAGE-incomplete-reports.md`); the owner then ruled a
program change, which was reviewed adversarially (`REVIEW-rescue.md`) and
changed again on that review. Consecutive clean rounds stay 0 of 2. The next
counted round (36) audits everything below.

## The program change: item 58, `rescue_nested`

Gary, 2026-10-07: *"we can't extract the orphan?"* Every vault is now born with
a third permanent plugin, `PermanentTransferDelegate`, authority MINT's
`["rescue"]` PDA. The permissionless `rescue_nested(vault, host, new_owner)`
moves a vault whose owner is the Core asset-signer PDA of `host` when `host` is
the vault itself, a positively burned asset, or a live vault of this collection,
and only to `bank_treasury` (the CBOBTC Squads), which returns it to its sender.
Anything else is refused. Mints were already atomic: D2 was about nesting, not
failed mints.

Review (no CRITICAL/HIGH; the rescue PDA signs in exactly one place; the
delegate cannot burn, update or execute in Core; destinations cannot be faked):
- **M1 (fixed, Gary ruled):** the first build sent a vault in a LIVE host to
  the host's OWNER, which hands a vault sent to the wrong deposit address to a
  stranger. Every rescue now goes to the Squads.
- **M2 (fixed by M1):** a foreign live host (escrow, bundle) is refused instead
  of having its owner receive the vault.
- **LOW (fixed):** Squads-held vaults paged `unredeemable_owner` CRITICAL every
  pass; now `vault_awaiting_return` (HIGH, level) until returned. Stale "bricked
  forever" / "destroyed" text in SPEC 2-3 and the holder guide corrected. The
  Squads could vote with a vault it holds: stated in item 58 as a custody rule.
- **Tests (fixed):** the host-type check is pinned (R35.N9, foreign live host,
  `HostUnresolved`); Core's reasons pinned on the owner-reach test (R35.N8a);
  the return path measured (R35.N2a). `RescueNoProgress` was removed: with a
  single destination it can no longer occur.

## Off-chain and documentation (from the triage of the seven reports)

- C1/C2/C15: road steps 9-11 no longer contradict each other: step 9 upgrades
  and verifies (prefix hash + zero tail) without `--final`; step 10 re-verifies
  first; step 11 verifies, makes final, verifies again. "Nothing is deployed"
  corrected.
- C3: GOV's `MIN_ROUND_PRICE_SATS` and `MAX_ROUND_SECS` pinned to MINT's (R35.C3).
- C4: the placeholder upgrade key's custody is stated (on the box, gitignored,
  in the nightly encrypted offsite backup; verified in snapshot `e5dce8ca`
  2026-10-07).
- C5: a stranger's token account with a kept close authority: stated as a
  limit, and the redeem page sweeps its balance and leaves it undeclared.
- C9: superseded by item 58 (payouts into a nested vault travel with it).
- C10, C18: stated as limits (index lag inside the router's grace; the split
  history grows with paging).
- The vault collection was never created by any step: road step 10 now creates
  "Central Bank of Bitcoin Vaults" (Gary) before `initialize`;
  `launch/mainnet-init.json` gains `vault_collection` (OPEN) and the launch
  checker refuses until it is recorded (49 assertions).
- Alarm: `CBOB_VAULT_RESCUED` is read only from MINT (spoof-proof) and every
  rescue pages `vault_rescued_to_squads` (HIGH, urgent, once).

## Validation

- Detector selftest **917/917**; launch checker **49/49**.
- First build (rescue to host owner): canonical run EXIT 0, **885/885**
  on-chain; fresh simulation **71/71** (`.cache/r35b-suite.log`, `.cache/r35-sim.log`).
- Squads-only build: canonical run `.cache/r35d-suite.log` **EXIT 0**: on-chain
  **889/889** (floor 889), detectors 917/917, allocation 39/39, launch 49/49,
  mainnet history walk 33/33, expiry 4/4, swap fork 16/16. (`r35c` was stopped
  after R35.N8a pinned a GUESSED Core code; measured, Core refuses removing a
  permanent transfer delegate with 0x1a, not the seal's 0x9.) Fresh simulation
  **71/71** (`.cache/r35d-sim.log`).

## The holder pages (`web/`, item 50)

Built 2026-10-07 (Gary): /vault/, /redeem/, /claim/, /buy/, the unlisted
ceremony, the metadata generator and the RPC allowlist proxy; staged, not
published. An independent adversarial review (`REVIEW-web.md`) found one HIGH
(a stranger could block any vault's opening on the redeem page for about
0.002 SOL) and four MEDIUM; all confirmed items fixed. Offline tests 457/457
(`node web/test/run-all.mjs`); end to end on a local validator **80/80**
(`.cache/r35-web-e2e.log`): ceremony step 0 and all four initializes, both
charter claims, the level draw, activation, both rescues landing at the
Squads, and a full redemption including the C5 account. The buy page is
covered by byte tests and a mock-RPC browser run only (no voted round in the
harness).
