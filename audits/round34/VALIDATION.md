# Round 34 repair validation

Round 34 is NOT CLEAN; quorum was met on both passes (7/8 each after same-commit
re-runs of provider-failed seats). Repairs cannot retroactively clear it;
consecutive clean rounds remain 0/2. The source audited was clean `90a05ff`. Ten
distinct topics: one MEDIUM, four LOW and five INFO. No program logic changed.

## The MEDIUM, mitigated on mainnet with the owner's approval

A stranger could pre-fund any public program id's ProgramData address and
block every loader-v3 deploy at that id for good; the only recovery would be new
ids, a program change. Gary chose to claim the ids. On 2026-10-07 an inert
placeholder (`.cache/placeholder`, 20,920 bytes, sha256 `94f75099…`, refusing every
instruction) was deployed to all five program ids on mainnet
(`.cache/placeholder/mainnet-deploy.log`), funded by Gary (1.2 SOL); each program
account is executable and loader-owned, each ProgramData account exists (20,965
bytes) with upgrade authority `FZjLB4e9mVMZTWA6YR1KbXVbByTqWsHpHy5sK83yJYUY` (held
on the box), and its bytes equal the placeholder's. The launch path (extend the
ProgramData, upgrade to the `dist/` bytes, compare, make final) was rehearsed end
to end on a local validator with the real program keypairs
(`.cache/placeholder/rehearsal.log`). SPEC step 9 states it, with mainnet's rent:
the deployed prefix must hash to `dist/` AND the tail must be all zero, checked
again after `--final`, and the alarm's program baselines are re-taken at the
upgrade.

## Other repairs

- **L (programs L1).** Disclosed: SPEC item 57 and the holder guide's honest list
  say a vault's name, picture and extra attributes are the minter's and
  permanent, a lookalike `Level` trait is possible, and only the vault's on-chain
  record counts. No program change (each vault is its own wallet attached to its
  NFT; no money decision reads the metadata).
- **L (off-chain L1).** `closesCycle` builds the deduped, sorted split view once per
  list and binary-searches it (identical results, proven on 400 random cases
  against the old form with a mulberry32 generator, each branch (chain-anchored,
  wall-anchored, excluded, `upTo` binding) hit at least 50 times, plus a
  deterministic `upTo` arm); 1,460 cycles against 100,000 splits now take well under
  the old 34 s; more than 50,000 entries page `split_history_large` (level) so the
  growth is visible.
- **L (off-chain L2).** The reconcile reads each token account's amount from its own
  program: classic and Token-2022 base fields (the latter labelled, confidential
  balances not included), "unreadable" otherwise, never a confident 0.
- **L (off-chain L3).** `revenue.mjs`'s split recovery starts its chain scan at the
  return's chain time. Review: an hour-early fallback for a row without one did
  not help, because `closesCycle` anchors such a row on the same box clock; it was
  dropped and the residual is stated in SPEC limit 10 (such a row stays open and
  alarmed, and closes by hand recovery).
- **Holder guide (review).** The name and the picture's link are permanent; the
  picture itself is hosted by the minter and can change.
- **INFO.** Mainnet rent in step 9; R33.G1 relabelled (the full shape is R34.G1);
  the sweep helper's comment (line count kept) and SPEC say a direct call moves
  only the caller's own holdings; SPEC 53 and the rehearsal script say four keyed
  programs.
- **Gate 5 (suite, 866 -> 871).** R34.G1a/b: the full worst shape (64-byte name,
  200-byte URI, the largest v0-carried attributes, five owner plugins with both
  freezes frozen, a 10,198-byte autograph) is minted and revealed by MINT in FIFO
  order. R34.G2: a stranger cannot take a token account at an ATA address.
  R34.G3: a real no-CPI transaction read through `bank/txread.mjs`. R34.G4: a
  vault's owner cannot remove, re-delegate, revoke or thaw its seal; the control
  authority can.

## Independent repair review

Mainnet claims confirmed. Two blocking findings, both fixed: R34.G1a's fit loop
only shortened the last attribute value and could not give back the 219 bytes
the full name and URI take (it now trims across all values; the shape fits at
about 549 attribute bytes), and the `closesCycle` equivalence test drew from a
low-bit LCG that left branches nearly unexercised, so a mutation removing the
`upTo` break survived (fixed as above). Smaller items fixed: step 9 wording, the
holder guide's picture sentence, the L3 residual, and R34.G4 now re-reads that
the control asset is thawed.

## Validation

- Detector selftest: **912/912** (`.cache/r34-selftest4.log`).
- First canonical run (`.cache/r34-suite.log`): **869/871**; the only failures
  were R34.G1a/b, the fit-loop defect the review found before the run reached them.

- Second canonical run, frozen runner with `CBOB_SHIP_GATE=1`
  (`.cache/r34b-suite.log`): **EXIT 0**. On-chain **871/871** (floor 871), detectors
  **912/912**, allocation 39/39, mainnet history walk 33/33, expiry budget 4/4,
  swap fork 16/16; R34.G1a/b ALLOW at the default compute budget.

Round 34 stays NOT CLEAN; these repairs go to round 35.
