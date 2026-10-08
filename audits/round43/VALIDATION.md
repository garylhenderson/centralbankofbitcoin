# Round 43 repair validation

Round 43, the confirmation round on the final tree, is **LAUNCH-CLEAN on both
passes, quorum met**, under Gary's launch gate of 2026-10-08 (SPEC.md ship gate
3). Under the older clean-round rule it is NOT CLEAN; the launch gate does not
use that counter.

- **Programs pass:** 6/8 counted (quorum with no margin). LongCat and Qwen
  max-0902 were not counted. All eight returned on the first run.
- **Off-chain pass:** 7/8 counted. LongCat was not counted. All eight returned
  on the first run.

Audited tree `542bd3f`, which differs from round 42's repairs (`79b4076`) only in
`audits/` and `scripts/audit43.ts`'s context margin. Program source equals
`RELEASE_COMMIT` `0b3ddb3`. No confirmed finding in (a) the programs, (b) a value
path, (c) a holder's crack, or (d) at HIGH or MEDIUM. Both triages independently
re-checked every confirmed finding of rounds 41 and 42: all are outside (a)-(d).

## Gary's ruling on V43-1 (2026-10-08, Linq)

*"if they are stupid and send it that's their fault."* No program change. A vault
sent into another live vault's deposit address, and taken by that host's owner
during their own opening, is the sender's loss. It is disclosed in the holder
guide, the crank now rescues such a vault every full pass, and V43-1 stays LOW,
outside (a)-(d). Recorded in SPEC limit 58.

## Repairs, programs pass (`VERDICT-programs.md`)

- **V43-1 (LOW): a host vault's owner can keep a vault nested in it by opening
  their own vault before the rescue runs.**
  - **Measured** (gate 5 item 1, required before step 11): R43.V1 cracks the
    burned fixture Z with an empty vault nested in it, Core-Executing the nested
    vault out in the same transaction. It lands; the vault is the host owner's;
    the host is gone. R43.V1a: the rescue afterwards is refused, pinned to
    `NotNested`. The control is 9.5/9.6. The first arm used two fresh vaults and
    pushed P.2a's excluded fixtures to 22 (911/912); it was moved onto Z.
  - **Crank:** `planRescues` (built on `detectNestedVaults`) plans
    `rescue_nested(vault, host, bank_treasury)` on every full pass for a nested
    vault whose host is itself, a live vault or a burned asset; foreign hosts are
    never planned. `NotNested` is benign (a race). The crank-instruction
    allowlist arm now names `rescue_nested` (permissionless; MINT pins the
    destination).
  - **Docs:** HOLDER-GUIDE.md, SPEC's section-9 table, impossibility 3, limit 58
    and the automation table.
  - **Tests:** eight R43 V43-1 selftest arms (planner, send block run as written,
    `main()` wiring, budget, BENIGN). **Shown red** in an isolated copy with the
    destination swapped to the host.
- **V43-2 (INFO):** the `web/test/e2e-localnet.mjs` header now states the
  current rescue rule. Comment only.

## Repairs, off-chain pass (`VERDICT-offchain.md`)

- **V43o-1 (LOW, tooling): the release-commit check died in the dress-rehearsal
  tree.** `scripts/run-tests.sh`'s check is now `release_gate`. Outside the
  rehearsal tree it is unchanged. Inside it (marker `REHEARSAL-RECORD.txt`), it
  passes only when the program difference from `RELEASE_COMMIT` is exactly the
  recorded id swap, byte for byte; web offline tests, which pin mainnet ids, are
  skipped there only. Seven arms run the gate on a fixture made by
  `rehearsal-tree.sh`'s own swap. **Shown red** with `c08c576`'s runner.
- **V43o-2 (LOW, alarm): one permanently unreadable signature froze a program's
  scan.** It is retried for 3 passes (`UNREADABLE_SKIP_PASSES`), then skipped on
  the record as the level finding `tx_skipped_unreadable` that only a person
  clears (watermark `bank/unreadable-reviewed`), so the cursor and backlog move
  on. The poster does the same. SPEC's reader and backlog boundaries say so.
  Four arms run the real extracted walk. **Shown red** with `c08c576`'s alarm
  and poster.
- **V43o-3 (LOW, test): the reveal-skip arm could not fail.** The reveal loop is
  extracted and run with an unreadable and an unread asset (nothing is sent) and
  a burned one (sent). **Shown red** with only the `break` deleted.

Merging the three repairs surfaced two interactions, both fixed: the crank
allowlist arm (above), and the V43o-3 extraction's end anchor, which now stops
before the new rescue block.

## Validation

- Detector selftest **966/966** (945 + 21); web offline **682/682**; launch,
  poster and allocation selftests pass.
- Canonical run (`.cache/r43-suite.log`, `CBOB_SHIP_GATE=1`, at `5c3a86d`): **RC 0**.
  On-chain **912/912** (floor 912), detectors 966/966, web offline 682/682,
  allocation 39/39, mainnet walk 33/33, expiry budget 4/4, swap fork 16/16.
  Program source equals `RELEASE_COMMIT` `0b3ddb3`. R43.V1 and R43.V1a pass,
  and R43.V1a's reason pin is `NotNested`.
- Pages end to end (`.cache/r43-web-e2e.log`): **132/132**, exact floor 132, RC 0.

Two runs before this one failed and were fixed, not loosened: 911/912 (P.2a, the
first arm's census cost) and a TypeScript transform error (a name collision in
the moved arm).

## Launch gate

Rounds 41 and 42 are the two launch-clean rounds; round 43 is the launch-clean
confirmation on the final tree, and its repairs are validated above. **The audit
side of the launch gate is met.** What remains is the road: step 8 (the mainnet
dress rehearsal, item 53's proof re-run at the release commit, which V43o-1
makes possible), then steps 9-11, and Gary's dates.

## Addendum: Metaplex Core moved under the suite (found at the rehearsal)

The rehearsal tree, with an empty cache, dumped Core fresh and the pin refused it.
Metaplex had upgraded Core on 2026-09-03 (create and execute fees fixed at
1,500,000 and 48,720 lamports instead of rent-derived, #300) and on 2026-10-07
(v0.15.3, VerifiedCreators only, #302; OtterSec-verified build of `8c5cee35`,
whose trimmed hash `1b0151ff` the deployed bytes match). The alarm paged the first
at CRITICAL on 2026-09-03; the suite kept passing because it booted the cached
August dump. On the test validator's rent rate the old formulas equal the fixed
amounts, so no arm could have seen the difference.

- **Measured before re-pinning:** the full suite against the deployed Core,
  912/912, swap fork 16/16 (a diagnostic runner in the rehearsal tree; its first
  attempt ended on a 30-second confirmation timeout under box load, L.12b, and
  was re-run).
- **Re-pinned** (`c1e6ee8`) in all four copies (run-tests, e2e-localnet, run-sim,
  build-mainnet) to `30dce56b`, from two independent dumps that agree.
- **New gates:** the mainnet probe asserts the deployed Core hashes to the pin
  (shown red on the August pin; floor 33 -> 35), and the selftest asserts the four
  copies are one value and catches a drifted one (floor 966 -> 968).
- **Certifying run on the re-pinned tree:** RC 0. On-chain **912/912**, detectors
  968/968, mainnet probe 35/35, web offline 682/682, swap fork 16/16; pages end to
  end **132/132**; the Test Vault simulation **71/71**.
