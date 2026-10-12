Reviewed source commit: `fc3be7655784dce3119186e16f16774f4cd939cd`

# CBOB Bank recovery and hosted-fixture corrections: independent re-triage

**Scope and method.** I used only Read, Glob and Grep. I ran no commands, tests, network calls or models, made no edits, and opened no env or key files. `/opt/cbob-vaults` HEAD is `refs/heads/v6` at `fc3be7655784…`, which matches `source_commit` and `source_dirty:false` in `/home/ubuntu/cbob-ecosystem-audit/hosted-rehearsal-fc3be76.log`.

**What I read:**
- RECOVERY-BATCH.md, RECOVERY-INITIAL-REVIEW.md and HOSTED-FIXTURE-INITIAL-REVIEW.md.
- `web/src/pages/ceremony.mjs`, `web/src/lib/ceremony-pending.mjs` and `ceremony-reads.mjs`.
- `tx.mjs`: buildTx, signExact, sendSigned.
- `ui.mjs`: `action`.
- `rpc-proxy.mjs`: method allowlist and `refusal`.
- `decode.mjs`: token, mint and Core parsers, and `absentIfDust`.
- `bank/layout.mjs`: config structs.
- `bank/live-programs.mjs`: error strings.
- `scripts/ceremony-compare.mjs` and its test, `verify-ceremony.mjs`, `pin-review.mjs` and its test.
- `ceremony-pending.test.mjs`, `ceremony-receipt.test.mjs`.
- `web/test/ceremony-flow-browser.cjs`.
- `web/deploy/ceremony-hosted-rehearsal.mjs`, `bundle-ceremony.mjs`, CEREMONY-WINDOW.md §5, and the `run-tests.sh` suite list.

**Hashes not checked.** I could not recompute the file hashes in the log, so its link to the commit rests on the log's own record.

---

## Verdict

- **B1, F1 and F6 are fixed.** The correction matches the earlier findings.
- **B2 is fixed for same-origin tabs.** One procedural gap remains: two different origins do not share the lock or saved state (see F-4).
- **B3 is only partly fixed, and the fix introduced a regression.** `stableSetupAccount` throws when a stranger has put SOL on a cbBTC token account address that step 5 has not created yet. Anyone can do this for about 0.0009 SOL, and it makes the two-provider `--preflight` refuse with a misleading "network read or decoding failed" label. The program configuration accounts are still hashed in full, including counters that change during normal operation.
- **Hosted fixture:** R1, R2, R4, R6, R7 and R9 are fixed. R3 and R5 are partly fixed. V2-7 is correctly still PARTIAL.

**Safe to push?** Yes, as a source checkpoint. Nothing in this commit publishes, accepts pins, enables holder or trading actions, or signs. The page stays gated by pins and the owner's rulings. It is **not** ready to serve as pin or signing evidence until R-1 below is fixed and R-2 is either fixed or accepted in writing.

---

## Remaining blocking items (before signing; not before pushing)

### R-1. MEDIUM. Regression: a dusted token account address makes the independent `--preflight` refuse, with the wrong label

**Where:**
- `scripts/ceremony-compare.mjs:10`
- `scripts/verify-ceremony.mjs:84-89`
- `decode.mjs:34` (`need(d, 165)` throws)
- Compare `ceremony-reads.mjs:59` and `decode.mjs:29`: the page itself treats dust as absent.

**Failure path:**
1. Before step 5, the cbBTC token account addresses for `ata(MINT_CFG, cbBTC)` and `ata(REVENUE, cbBTC)` are public and can be worked out by anyone.
2. Anyone sends them a rent-exempt amount of SOL. The result is a System-owned account with zero bytes of data.
3. `getMultipleAccountsInfoAndContext` returns that account.
4. `stableSetupAccount(a, 'token')` calls `parseTokenAccount`, which throws "token account: too short".
5. The outer `catch` reports `REFUSED: network read or decoding failed` (`verify-ceremony.mjs:100`).

The required two-provider preflight then refuses permanently, and the label points at the network. That is the mislabel V2-4/N7 was meant to remove. The earlier raw hash would have matched across providers, so this failure is new.

**Fix:** in `stableSetupAccount`:
- Return `null` for `absentIfDust(account)`.
- Parse as mint, token account or collection only when the owner is the expected program (the token program or Core). Otherwise hash the raw bytes with the owner, so an unexpected owner still shows up as a difference.
- Add tests for:
  - a zero-length System account (expect `null`);
  - a non-token-owned account with data (expect a raw hash, no throw).

### R-2. LOW-MEDIUM. B3 is not fully closed: configuration accounts are hashed in full, but they contain counters that change during operation

**Where:**
- `ceremony-compare.mjs:6-17` (`kind='config'` hashes every byte).
- `bank/layout.mjs`, which lists these changing fields:
  - `MintConfig` (54-79): `minted_this_round`, `minted_total`, `revealed_total`, `charter_claimed`, `acc_scaled`, `owed_scaled`, `last_distribute_at`, `dist_epoch`, `pending_*`, `boosts_*`, `cbob_burned_total`, `boost_expiring`, `last_sweep_at`;
  - `BurnConfig` (94-97): `burned_total`, `rate_head`, `rate_ring`;
  - `GovConfig` (99-103): `proposal_count`, `last_*_id`.
- `verify-ceremony.mjs:87-88`: the two reads are only ordered by a minimum slot, not taken at the same slot.

**Failure path:** in `--after`, any mint, burn, proposal or crank that lands between provider A's finalized slot and provider B's makes the comparison fail. It is reported as "independent setup, collection, mint and funding account agreement". The batch's claim that "every byte except supply/amount/Core counters" is compared is therefore stable only while nothing touches the programs.

This fails closed and a re-run clears it. However, the Bank's own cranks make it likely after launch, and the label reads as a real disagreement between providers.

**Fix (either):**
- Mask the changing fields per struct using `layout.offsets()`.
- Or retry the pair a bounded number of times until `firstSetup.context.slot === secondSetup.context.slot`. On a final mismatch, report "unstable read", not "disagreement".

**Tests to add:** a counter-only difference passes; an authority or collection difference fails.

---

## Corrections verified

### B1: fixed
- The in-session step-0 signature is no longer passed in as `receipt`. `recovery` is assigned only:
  - after `resolveCollection` accepts a manual entry (`ceremony.mjs:77-79`), or
  - from a verified `landed` pending verdict (`:101`).
- The receipt is shown in `#step-zero-receipt`, which sits outside `out` and `list` (`:40`, `:60-64`, `:83`). `clear(out)` and the list re-renders cannot remove it. It is also repeated in the "record the collection" box (`:233`, `:238`).
- A manual entry that is refused throws before `recovery` is assigned, so it cannot leave bad recovery state behind. An empty or invalid key throws inside `exclusive`, and `finally` releases the lock.

### B2: fixed
- **Locking:**
  - A busy flag and an exclusive `navigator.locks` lock with `ifAvailable` wrap Connect, every step action and the receipt form (`:41-52`, `:67`, `:74`).
  - `stepAction` checks the run generation at click time (`:53-58`). Because everything runs under the lock, no stale handler can interleave.
  - Without Web Locks the page refuses (`:46`).
- **Saved pending record:**
  - The page saves `{collection, signature:null, lastValidBlockHeight}` and reads it back to confirm the write before the wallet is asked to sign (`:308-309`; `ceremony-pending.mjs:14-17`).
  - After signing, it shows the receipt and saves the signature before broadcast (`:314-315`).
  - If the wallet throws, the record is removed (`:312`). This is safe: `signExact` never broadcasts (`tx.mjs:149-161`), and a changed blockhash is refused (`tx.mjs:111`), so the saved `lastValidBlockHeight` stays valid for the transaction.
- **`pendingVerdict` (`ceremony-pending.mjs:21-37`):**
  - finalized with an error → clear;
  - finalized → requires the exact launch-key receipt;
  - any non-null status → wait;
  - otherwise clears only when the finalized block height is past `lastValidBlockHeight` **and** no account exists at finalized commitment.

  This logic is sound: after finalized expiry the transaction can never land, and a Core create that did land leaves an account behind.
- **Proxy:** the methods this needs (`getSignatureStatuses`, `getBlockHeight`, `getAccountInfo`, `getTransaction`) are all allowed (`rpc-proxy.mjs:54-56`, `:179`, `:190-194`).
- **Sign-time guard:** the sign handler re-checks the saved pending record and the collection state under the lock (`:291-295`). A pending record left in this browser blocks step 0 in other tabs of the same origin.
- **Unverified collections checkbox:** it gates the step-0 dry run (`:269-272`).

### B3: partly fixed
- **Correct:** the masked byte ranges.
  - Mint supply 36..44.
  - Token account amount 64..72.
  - Core `num_minted` and `current_size`: the offset is worked out from the name and URI lengths, matching `parseCoreCollection`.
  - Owner and executable stay in the comparison.
- **Correct:** `programFailureCheck` maps exactly the messages `live-programs.mjs` throws (`:34`, `37`, `42`, `44`, `45`, `53`). Anything else falls into a generic network/configuration label with no provider text, so no credential-bearing URL can leak.
- **Not done:** see R-1 and R-2.

### F1: fixed
`pin-review.mjs:14-15` requires exactly one approval line, approving the exact reviewed commit. A BLOCKED line is refused, and a test covers it.

### F6: fixed
`ceremony-reads.mjs:105-121`:
- Only finalized `launch` verdicts are cached.
- The cache is per connection, keyed on CORE, collection, authority and signature.
- Unavailable, failed and other-creator results are never cached. A test covers this.

### Hosted fixture
- **R1, fixed:** the run refuses on a dirty tree unless `--development` is passed. It logs the commit, Node version, esbuild version and the hash of every `web/deploy/*` file.
- **R2, fixed:** three origin/method checks:
  - accepted origin → 502;
  - forbidden method → 403 with `-32601`;
  - wrong origin → 403.
- **R4, fixed:** waits for `close`.
- **R6, fixed:** the doc states that systemd is not covered.
- **R7, fixed:** the doc requires a re-run on the exact commit.
- **R9, fixed:** `SUDO_GID` is validated.
- **R3, partial:** see F-6.
- **R5, partial:** signal handlers, a cleanup step per item, and the marker file are in. A sweep of leftover marked fixtures at startup is not.

---

## Follow-ups (not blocking a push)

### F-1. LOW-MEDIUM. A reload can show a false STOP when the status is finalized but the transaction is not yet served
**Where:** `ceremony-pending.mjs:26-27`, reached through `ceremony.mjs:155`.

`getSignatureStatuses` can report finalized before `getTransaction(finalized)` returns the transaction on a load-balanced provider. In that window the page shows "STOP: …could not be verified". This is the same class as B1 (a STOP right after a successful landing), but only on reload, and a retry clears it.

**Fix:** return `waiting` when the result is `unverifiable` because the transaction is unavailable. Throw only when the result is `other`, or when the transaction does not create this collection.

### F-2. LOW. The saved pending record is never retired after success
After a success, every later reload re-verifies it, which depends on long-term `getTransaction` history.

**Fix:** delete it once SEAL names the same collection, or once the finalized receipt has been verified and the operator has acknowledged recording it.

### F-3. LOW. A failed or expired receipt keeps saying "save this"
After a `clear` verdict, or an in-session send failure, `#step-zero-receipt` still says "Save this step-0 receipt" for a failed or expired attempt (`:97`, `:314`).

**Fix:** relabel it as "earlier attempt failed or expired: not your collection".

Also, the waiting message (`:156`, `:215`) should point to "Resume using your step-0 receipt" once the transaction has expired but an account exists. Today that state only says "wait".

### F-4. LOW (procedural). Two origins do not share the guard
The lock and `localStorage` are per origin. Opening both the hosted origin and the SSH-tunnel fallback during step 0 bypasses the duplicate-collection guard until the first collection is discoverable on chain.

**Fix:** add one runbook line: never open both origins in the same ceremony.

### F-5. LOW. Gaps in test coverage
- The browser harness is not in `run-tests.sh`.
- It loads esbuild and `ws` from unrelated projects (`/home/ubuntu/luna-remotion`, `/opt/gary-club`), and the bundler does the same (`bundle-ceremony.mjs:6`). This belongs to V2-1.
- Its reload resets `F`, so it only covers the "never landed" path. Not exercised in the page:
  - reload → pending `landed` → adopted;
  - the F-1 window;
  - two tabs contending for the Web Lock.

### F-6. LOW. Hosted fixture checks still missing
- The rehearsal does not exercise "Unattested page file" (a file listed only in BUILD.txt) or a wrong commit.
- It does not sweep leftover marked fixtures.
- It still tests a fresh bundle, not the attested candidate bytes (R1's stronger form).

### F-7. INFO. Still missing from the earlier review
- No argument-parsing tests and no two-provider fixture for `verify-ceremony.mjs`.
- No v0 `loadedAddresses` receipt test.

---

## Still open, unchanged
- V2-1: dependency provenance and an independent rebuild.
- Real installed nginx, unit and owner-browser delivery (V2-7 partial).
- D6 integration with the real backend.
- Current two-provider preflight (now also blocked by R-1).
- Immutable artifact and pin approval.
- Owner rulings D2, D6, D10 and D13, plus timing acknowledgment.
- Carried from the earlier review: F2–F5.
