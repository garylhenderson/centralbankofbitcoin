# Round 42 repair validation

Round 42 is NOT CLEAN on both passes, quorum met.

- **Programs pass:** 8/8 counted. Opus 5.5 (a provider `content_filter`) and
  Fugu (output cut off) were re-run with the same prompt; the failed first
  outputs are in `failed/`.
- **Off-chain pass:** 7/8 counted. Qwen was re-run after a cut-off first
  output; MiniMax was not counted because it cited code that is not in the tree.

Audited tree `4a67d00`, scope-frozen. No confirmed defect in the five programs
(none since round 27), and no repair changes a program. The runner now checks
that the program source equals `RELEASE_COMMIT` (C10 below). Consecutive clean
rounds stay 0 of 2.

## Repairs, programs pass (`VERDICT-programs.md`)

- **V42-1 (INFO, `web/deploy/ceremony-local.mjs`): a malformed path crashed the
  local ceremony server.**
  - **Fix:** `staticFile` treats a malformed escape (`/%E0`, `/%`) as a 404. The
    server's listener is exported as `localListener` and turns anything it
    throws into a 500, never a dead process.
  - **Test:** R42's V42-1 arms in `proxy.test.mjs` drive the real listener on
    loopback. `/x/` returns 200, `/%E0` and `/%` return 404, and `/x/` still
    returns 200 afterwards. Controls: escapes stay refused.
  - **Shown red:** with the decode guard removed the response is a 500; with
    both guards removed the process dies with `URIError`.
- **V42-2 (INFO, `web/src/lib/ceremony-reads.mjs`): an earlier transaction could
  hide the real create.**
  - **Fix:** `collectionCreator` no longer judges a collection by the oldest
    transaction naming it. It takes the oldest SUCCESSFUL transaction that holds
    Core `CreateCollectionV2` for exactly that address; a collection is created
    once. Failed transactions are skipped, whether marked by the listing's `err`
    or by `meta.err`. The search is bounded at 25 successful transactions.
  - **When no create is found** in a complete history, the result is now
    `unverifiable` (a prominent "pin it" warning, with step 0 still offered),
    never `other`.
    - The two older arms that expected `other` were updated: a failed create
      only, and the launch key creating a different address.
    - This deliberately departs from the triage's suggested `other` control for
      a launch-key create of a different address. Such a candidate exists on
      chain, so its create happened somewhere the page could not read; a
      warning is the honest answer.
    - No stranger gains a lever from this. A decoy a stranger creates is still
      `other` (it has a successful create by them), and making a candidate
      unverifiable still costs the 5,000-transaction padding of round 39 B4.
  - **Tests:** six new arms:
    - A stranger's failed transfer listed first, flagged by the listing's `err`.
    - The same, flagged only by `meta.err`.
    - A stranger's successful transfer listed first.
    - Strangers' transfers only.
    - 25 successful transfers before the create.
    - End to end with nothing pinned: the real collection is adopted.
  - **Shown red:** against round 42's reader, every new arm and both updated
    arms fail.
  - **Docs:** the `web/README.md` collection rule was rewritten to match.

## Repairs, off-chain pass (`VERDICT-offchain.md`)

- **C01 (LOW, `bank/alarm.mjs`): after a shrunk index pass, omitted vaults lost
  their baseline.**
  - **Fix:** when the index's list shrank and is reported untrustworthy, the
    pass reads and judges every STORED vault's reserves, minus vaults that were
    burnt. Every baseline is kept, and a fall in an omitted vault is paged.
  - **Tests:** two R42 C01 arms extract the whole balance block and run it as
    written across three passes: full, shrunk, full with a fall in an omitted
    vault. The fall is paged; a fall during the shrunk pass is paged in that
    pass.
  - **Shown red:** both arms fail with the old `for (const v of vaults)` restored.

## Gate-5 obligations closed

- **C12 (programs, required): MEASURED, AND IT REOPENED A FINDING (new accepted
  limit 59).**
  - **The measurement.** A stranger who funds a new vault's or the collection's
    address before the create lands makes that attempt FAIL. Core's
    CreateV2 / CreateCollectionV2 use System `create_account`, which refuses an
    address that holds lamports ("already in use", System `0x0`). The first
    canonical run stopped at exactly this point, on the pre-funded charter claim.
  - **The arms** record the refusal and pin the reason:
    - R42.C12a: `mint_vault`.
    - R42.C12b: `claim_charter_vault`; the Proof of Burn is not burned.
    - R42.C12c: the collection.
    - R42.C12d: a fresh address then lands.
  - **Nothing is lost** but the fee. Retrying with a fresh address lands.
  - **The pages were the problem.** The buy and claim pages reused the same new
    address on every retry, and the ceremony's dry run reused step 0's key, so a
    holder could stay blocked.
  - **The page fix.** `checkNewAddress` (`web/src/lib/reads.mjs`) runs before
    every attempt:
    - empty: the key is kept, so a retry after an unknown outcome can never buy
      twice;
    - Core-owned: the earlier attempt landed and is not repeated;
    - anything else: a fresh key, with a note to the holder.
    It is wired into buy, claim and ceremony step 0. Ceremony step 0 passes only
    the public address, so round 39's C04 guarantee still holds.
  - **Program side.** No program change: the refusal is inside Core. SPEC
    limit 59 states the grief, who can do it (a slot leader or an RPC
    upstream), what it costs each side, and why it is not fixed in the frozen
    programs.
  - **Tests:**
    - Offline: get.test C12 (the three states, and the call sites in all three
      pages).
    - End to end: a stranger funds the first claim's address; the network
      refuses that claim; the check reports it taken and supplies a fresh key;
      the claim lands, and a re-check says landed.
- **C8 (programs):** `claim_charter_vault` with two attributes sharing a key is
  refused, pinned to `DuplicateAttribute` (R42.C8).
- **C13 (off-chain, a measurement):** the full worst shape (R34.G1b) is revealed
  with its entropy captured inline: capture plus reveal in one transaction, with
  no compute-budget instruction (R42.C13, units recorded).
- **C7 (programs):** an Attributes plugin whose body could not be parsed makes
  `planDraw` answer `unknown`, not throw a TypeError. Arm R42 C7 in
  `get.test.mjs`; the triage measured the old TypeError.
- **C08 (off-chain):** the crank's two fee-warning labels are read from its own
  template and enter the router-label arm.
- **C09 (off-chain):** `OPERATOR_FLOOR` is 0.02 SOL, read from `revenue.mjs`.
- **C06 (off-chain):** a Pyth exponent outside -18..0 is refused by name in
  `readPyth` and in `oracleFloor` (the int32 extremes, +1 and -19). -8, -18 and
  0 read.
- **C10 (off-chain):** `run-tests.sh` refuses to run when the program source in
  the tree differs from `RELEASE_COMMIT`. Shown both ways on a clone: it passes
  on a clean tree, and a one-line edit to `programs/cbob-vault-mint/src/lib.rs`
  is FATAL.
- **C26 (carried from round 36 A8):**
  - The holder pages' offline tests (`run-all.mjs`) are now part of the
    canonical run, held to an exact total (`WEB_FLOOR`).
  - `e2e-localnet.sh` now holds the end-to-end count to an exact floor
    (`E2E_FLOOR`) instead of trusting an exit code.
- **C14 (recommended):** `nginx-rpc.conf` names its dependency on the host's
  Cloudflare real-IP setup.

## Test robustness (not a finding)

The R34 L1 performance arm timed `detectSplitClaims` by wall clock against an
8 s bound. While another workload loaded this shared box, the unchanged code
measured 7.0 to 10.8 s and the arm failed. It passed in round 41's run. It now
measures CPU time against a 15 s bound. The old algorithm took 34 s, so a return
to it still fails the arm.

The same load made the local validator's clock lag the box's. The suite's
`waitEnds` waited only on the box's clock, so a governance execute was refused
with `VotingOpen`. Its helper does not throw, so the boost after it met the old
terms and the run stopped at `BoostTermsMoved`. `waitEnds` now also waits for
the chain's Clock sysvar to reach the window's end, which is what GOV checks.

## Validation

- Detector selftest **945/945**; web offline **682/682**; the README hash table
  was refreshed to a fresh build of both profiles (bundle 83/83).
- Canonical run (`.cache/r42-suite.log`, `CBOB_SHIP_GATE=1`): SUITE_RESULT
- Pages end to end (`.cache/r42-web-e2e.log`): E2E_RESULT
