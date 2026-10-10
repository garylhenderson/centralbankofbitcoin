# Round 46 repair validation

Round 46 (audited `63a92b2`) was **LAUNCH-CLEAN on both passes, quorum met**
(6 of 8 seats counted on each pass, 6 required, no margin; no re-runs). No confirmed finding in
(a)-(d). It was **not a no-change round**: the programs pass confirmed V46-1 to
V46-8 and the off-chain pass V46o-1 to V46o-5 (plus V46-7 independently), all
LOW or INFO, all outside the five programs. Gary's rule of 2026-10-09 therefore
still needs a later round that requires no changes.

## Repairs

- **Round 46 findings (`1246a30`).** Driver: resumable multi-send steps (V46-1),
  the values re-filled and re-judged with the page built right before road step 10
  (V46-2), the rescue records the nest (V46-3), the hand recovery after a landed
  swap (V46-4), the init account preflight (V46-8). Page: overrides refused on
  mainnet-local at build and run time (V46-5), NOT READY wording (V46-6). Alarm and
  revenue: an undelivered pass rolls back its unreadable counts (V46o-2), the
  load-time refusal pages once (V46o-3), the ack arm drives an ackable kind
  (V46o-1). The placeholder is tracked as a web fixture (V46o-4);
  `scripts/audit47.ts` computes its bundle claims (V46o-5); SPEC 53 (V46-7). Also
  in this commit, by Gary's ruling (option 1): the mainnet rehearsal deploys the
  SHIPPING build and Gary signs road step 10 on a hosted page.
- **Found on mainnet by Gary during the rehearsal, each fixed with a test shown
  red without it:** a REHEARSAL-OPEN collection kept its status (`fd119e4`); the
  ceremony accepts only a wallet's bounded compute-budget and Lighthouse
  additions (`daba832`), and the relay accepts Lighthouse without counting it as
  work, every ceremony step tested as Phantom returns it (`2b384ce`); every holder
  page goes through one strict wallet-edit judge and sets its own compute budget
  (`63539c2`); the stray listing uses one `getTokenAccountsByOwner` per token
  program, because Helius refuses Token-2022 `getProgramAccounts` (`708af02`);
  show my vaults, verified on chain, the dry run on a lagging node, driver retries
  (`d2a3791`).
- **After the rehearsal resumed:** the Core watch (`2272656`); the README with its
  generated, checked facts (`6a6359d`); the Core re-pin to the 2026-10-09 build
  after 912/912 against it (`0b8a204`); the refresh records the full commit id
  (`1650336`, red without the fix).

## Validation (all at `1650336`)

Certifying runner (`/tmp/claude-1000/validate-1650336.sh`), live mainnet probe
enforced on the new Core pin:

- `.cache/1650336-suite.log`: **RC 0**. Mainnet probe 35/35, on-chain
  **912/912**, detectors **1072/1072**, web offline **801/801**, README facts
  current, expiry budget 4/4, swap fork 16/16.
- `.cache/1650336-web-e2e.log`: **152/152**.
- `.cache/1650336-sim.log`: **71/71**.

The mainnet dress rehearsal ran on this code's predecessors and finished at
`1650336`: `audits/rehearsal-2026-10-09/RECORD.md`.

## Open before road step 9

Every file named above changed after round 46 read the tree. Round 47 audits the
final tree and, by Gary's rule, must require no changes. The five programs are
unchanged since round 27.

## After this validation: the stripped release build (2026-10-10)

OtterSec's remote verification rebuilds each program in Solana's
verifiable-build container, whose output is stripped, so the unstripped `dist/`
could never have shown as verified. Every runner and the release build now strip
with platform-tools v1.54's `llvm-objcopy --strip-all` (`scripts/sbf-strip.sh`,
`d2ae5fc`). The program source is unchanged (round 35's `0b3ddb3`); the five
programs are 425,352 bytes smaller in all.

- Certifying runner at `d2ae5fc` (`/tmp/claude-1000/validate-d2ae5fc.sh`):
  `.cache/d2ae5fc-suite.log` **RC 0** (mainnet probe 35/35, on-chain **912/912**,
  expiry 4/4, swap fork 16/16, detectors 1072/1072, web offline 801/801, README
  facts current); `.cache/d2ae5fc-web-e2e.log` **152/152**;
  `.cache/d2ae5fc-sim.log` **71/71**. Its release build was refused by its own
  dirty-tree guard (an uncommitted workflow edit) and was re-run from the clean
  tree: `.cache/d2ae5fc-build.log` RC 0.
- `RELEASE_COMMIT` moved to `d2ae5fc` and `web/src/config.js` pins the stripped
  hashes (`b3f300c`); web offline 801/801 at that pin.
- On GitHub's runners (run 38058938028, `b3f300c`), the container workspace
  build, `solana-verify build --base-image <v4.1.0 image> --arch v3 -- --workspace`
  for each program, and `dist/` were byte-identical for all five. That run's last
  step failed writing its sums into root-owned folders; `a30924c` fixes it, and
  its run (38059530380) passed the gate: "container build == solana-verify
  rebuild: IDENTICAL", "container build == audited hashes: IDENTICAL".
