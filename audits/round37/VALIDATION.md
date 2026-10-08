# Round 37 repair validation

Round 37 is NOT CLEAN on both passes, quorum met (programs 8/8, off-chain 6/8:
muse-spark failed with a provider error and the triage excluded LongCat as not
a real audit; counting it gives 7/8 and the same result). The audited tree was
`0ae07d2`, scope-frozen. No confirmed defect is in the five programs and no
repair changes a program. It was the first round under Gary's ruling of
2026-10-07 (SPEC gate 3); one finding (C05) qualified for the documentation
exception and was independently re-verified below. Consecutive clean rounds
stay 0 of 2.

## Repairs, programs pass (`VERDICT-programs.md`), all in `web/`

- **V1 (LOW):** a flood of stranger token accounts (about 18,700) could push the
  redeem page's single listing past the proxy's 8 MB cap. The page now reads the
  three reserve accounts by address and lists everything else in bounded reads;
  whatever it cannot list or examine is one tick-box, never a refusal; more than
  20 strays are one grouped box. The NFT check was bounded the same way (a
  failed or over-cap NFT read is one box; a CBOB vault the page does find still
  refuses, with the rescue offered).
- **V2 (LOW):** a stranger's decoy Core collection naming MINT's PDA could stop
  the ceremony. The ceremony now identifies the collection by the recorded
  address or by its creation by the launch key, and ignores decoys.
- **V3 (INFO):** a frozen cbBTC account CAN activate (MINT ignores the state);
  the vault page and its test now say so.

## Repairs, off-chain pass (`VERDICT-offchain.md`)

- **C01 (LOW):** three ack arms could no longer fail; rewritten on the ackable
  kind, plus a control arm. Each is now shown red under its own mutation (m1
  empty-reason guard removed, m2 `true` accepted, m3 kind ignored in the key).
- **C02 (LOW):** the crank now plans the free tick (and the joins after it) from
  a frozen pool, which MINT accepts; credit and paying claims stay refused. The
  alarm's covered-freeze matcher follows the crank's new text.
- **C03 (LOW):** `judgeCronTemplate` ignores commented lines.
- **C04 (INFO):** `--audit` no longer counts a refused sweep as SOL swept.
- **C07 (refuted, pinned):** a `{sendRejected, sweepSig}` row pages
  `rejected_row_has_sweep` CRITICAL in the same pass.
- **C05 (INFO, documentation exception):** SPEC limit 10's ceiling corrected
  from about 40 to about 34 SOL a day (the 7-hour cadence of the hourly job).
  Text only; `scripts/cron-install.sh` unchanged. **Independently re-verified
  before round 38: PASS** (`.cache/drift38.md`, job 1).

## Pre-round-38 drift sweep (Gary's ruling)

4 holder-facing and 10 internal stale statements, all applied: the holder
guide now says a frozen pool stops DELIVERY (crediting can continue) and
describes grouped and unlisted boxes; DESIGN-v6's frozen-pool, fee and hostile-
cooldown figures; SPEC's control table and impossibility 2; the web README's
provider requirements, reads and counts; a redeem-page sentence and a stale
crank comment.

## Validation

- Detector selftest **925/925**; launch 49/49; poster 24/24; web offline
  **582/582**.
- Canonical run (frozen runner, `CBOB_SHIP_GATE=1`, `.cache/r37-suite.log`):
  **EXIT 0**, on-chain 895/895, allocation 39/39, mainnet history walk 33/33,
  expiry 4/4, swap fork 16/16.
- Pages end to end on a local validator (`.cache/r37-web-e2e.log`): **108/108**,
  including 320 parked accounts (one grouped box, the opening lands) and a
  stranger's decoy collection ignored by the ceremony.
