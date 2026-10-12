# CBOB correction batch audit (base ec2dbc6, uncommitted, `/opt/cbob-vaults`)

**Method.** I used Read, Grep and Glob only. I made no edits and ran no commands, tests, builds, network calls or models. I opened no env or key files.

**What I read:**
- `resume-source.patch` in full.
- The new `scripts/pin-review.mjs`, `scripts/pin-review.test.mjs` and `scripts/ceremony-receipt.test.mjs`.
- The current `ceremony-reads.mjs`, `ceremony.mjs`, `club-actions.mjs`, `verify-ceremony.mjs`, `update-web-hashes.mjs` and `prepare-ceremony.sh`.
- Context: `tx.mjs` (`signExact`, `sendSigned`), `reads.mjs`, `ui.mjs` (`action`), `rpc-proxy.mjs` (`refusal`), `ceremony-local.mjs` (env reads) and `bank/live-programs.mjs`.
- On the Gary Club side, for the server status set and order uniqueness: `portal-market.ts` and the `20261010` migration.
- The relevant parts of `CEREMONY-ARTIFACT-RETRIAGE.md` (V2-2, V2-3, V2-4, V2-6).

---

## BLOCKING

### B1. HIGH: a successful step 0 is immediately reported as a STOP, and the only on-screen copy of the step-0 signature is removed at the same moment

**Where:**
- `web/src/pages/ceremony.mjs:256-268`, `:66`, `:170-172`
- `web/src/lib/ceremony-reads.mjs:109-111`, `:181-184`
- `web/src/lib/tx.mjs:199`

**Failure path:**
1. On sign, `:257` sets the module-global `recovery = {collection, signature}`.
2. `sendSigned` returns when the transaction is **confirmed** (`tx.mjs:199`).
3. `:264` re-reads the step (confirmed, done). Then `:267-268` removes `list` and calls `steps(ctx)`.
4. `steps` calls `collectionSources` (`:170`). That passes `receipt: recovery` (`:66`) into `resolveCollection`.
5. `resolveCollection` checks the receipt **first** (`:181`). `collectionFromReceipt` asks for the transaction at `commitment: 'finalized'` (`:109`).
6. Only about a second has passed since confirmation. Finalization takes at least about 32 slots (around 13 seconds), so the result is `null`.
7. The receipt check returns `unverifiable`, and `resolveCollection` returns `conflict: 'Step-0 receipt refused: the exact transaction is not available as a successful finalized receipt'`.
8. `steps` renders **"STOP"** (`:172`).

This happens on the normal path of every ceremony, not as an edge case.

**What makes it worse:**
- **The receipt disappears.** The "Save this step-0 receipt" box (`:258`) sits inside `area`, which is inside `list`. `:267` removes it. The STOP page that follows does not show the signature; `:188` shows it only on the success branch. The operator therefore sees the signature only while `sendSigned` is in flight, which is usually a few seconds. That is the artifact this batch exists to preserve.
- **Recovery is possible but invisible.** Clicking Connect again after about 15 seconds (`run()`, with `recovery` still in memory) would pass. Nothing on the page says so, and the runbook treats STOP as stop, inside the 5400-second window.
- **A failed send traps the page until a full reload.** If step 0 fails or expires after signing, `recovery` still names a transaction that never landed or failed. One example is C12 "taken", where a stranger funds the address so `create_account` fails. In that state:
  - every later `run()` or `steps()` returns "Step-0 receipt refused";
  - the "taken → re-read with a new key" recovery at `:231-234` is dead in-page.
- **A wrong or empty resume entry also sticks until reload.** The same is true when the operator types a wrong receipt into the resume form. An empty field makes `new PublicKey('')` throw (`ceremony-reads.mjs:106`), so the receipt cannot be cleared from the page.
- **The refusal copy for a fresh receipt is misleading.** For a receipt that is just not finalized yet, the message ("not available as a successful finalized receipt") reads as "the transaction failed".

**Fix:**
- Do not feed the in-session signature into `receipt`. `ctx.created` already pins it ("this session").
- Keep the signature in a separate display variable, rendered **outside** `list`, for example a fixed element next to the resume form, so re-renders never remove it. Also persist it to `localStorage` next to the address, as a hint only.
- Assign `recovery` only from the resume form, and clear it on refusal.
- In `collectionFromReceipt` on the page:
  - poll with a bounded wait (for example up to 60 seconds) until the transaction is finalized, showing a "waiting for finalization" note;
  - or distinguish "not yet finalized" (`getSignatureStatuses` shows confirmed) from "absent" or "failed".
- Keep `finalized` in `verify-ceremony`.

**Missing test:** drive `steps()` through step 0 against a mock whose finalized `getTransaction` returns `null` for the first N calls. Assert:
- no STOP;
- the receipt is still visible after the re-render;
- a failed send does not poison later runs.

The current tests are pure-library tests plus source regexes (`ceremony.test.mjs:347-348`), so they cannot see this.

### B2. MEDIUM (signing gate: open duplicate-collection paths remain; one is reachable by a double-click)

**(a) Concurrent `run()` produces two independent step-0 UIs.**
- **Where:** `ceremony.mjs:40`, `:47-50`, `:82`.
- `#connect` has no in-flight guard. `action()` disables only its own button, and only until `run()` resolves.
- **Failure path:**
  1. A double-click on Connect, or Connect followed by Verify, starts two `run()` calls.
  2. Both call `clear(out)` before their first `await`. Both then append a full preflight and step list.
  3. Each has its own `ctx`, so `plan-ceremony.mjs:254` generates a separate `ctx.newCollection` for each.
  4. The sign-time re-read (`:245`) is `readStep(ctx,'collection')`. With `ctx.ids.COLL` null it returns `null`, so neither UI can see the other's key.
  5. Two Phantom approvals then produce two launch-key collections. `resolveCollection` would later stop with "launch key created 2" or, if one is padded, silently adopt the other.
- **Fix:**
  - Add a module-level run generation. A stale run stops appending, and all handlers check the generation before acting.
  - Disable both entry buttons while a run is active.
  - In the step-0 sign handler, refuse if a different step-0 key from this page load is unresolved.

**(b) Reloading while step 0 is in flight re-offers step 0 with a new key.** This is pre-existing and is the exact "lost browser state" scenario.
- **Where:** `ceremony.mjs:63`.
- The remembered address is dropped when it has no account yet. The first transaction can still land until its `lastValidBlockHeight`, roughly 60 to 90 seconds.
- **Fix:** remember `{address, signature, lastValidBlockHeight}` before sending. While the block height is ≤ `lastValidBlockHeight`, or while the signature status is unknown, refuse step 0 ("an earlier step 0 may still land; wait").

**(c) With no receipt and an unverified padded candidate, step 0 is still offered with a warning only (`:174`, `:118`).**
- This is by design (round 39 B4).
- A one-checkbox acknowledgment gating the step-0 dry run whenever `found.unverified.length > 0` would turn the warning into a deliberate act, at no cost to the anti-griefing property.

### B3. LOW/MEDIUM (signing-gate item 5, not source acceptance): V2-4 is only partly fixed

**Where:** `scripts/verify-ceremony.mjs:83-87`, `:40`.

- **The lamport flap is fixed. The data flap is not.**
  - The two reads are still at different slots (`minContextSlot` is a floor, not equality), with no retry.
  - `data` is hashed in full for every key, and anyone can change several of them:
    - **Reserve mints and `cbobMint`:** the supply field changes on any holder's SPL `burn`. That costs one token unit plus fees, can be looped, and cbBTC supply also moves organically.
    - **Payment ATAs after step 5:** any dust token transfer changes `amount`.
    - **The Core collection:** its size counters change after vault mints, which matters if `--after` is re-run later.
- **N7 is now inverted.** `:40` catches everything from `independentPrograms()` as "independent program bytes and authority agreement". That includes a missing provider config, a public-RPC 429 or timeout (`live-programs.mjs:12`), "Bank program differs", and the real disagreement (`:53`). A transient network fault is now reported as an integrity disagreement.

**Fix:**
- Compare decoded stable fields only: mint authority, freeze authority, decimals and initialized for mints; mint, owner, delegate and close authority for token accounts; the Core identity fields for the collection.
- Or retry a bounded number of times until both `context.slot` values are equal.
- Map `independentPrograms` errors by message to three named checks: disagreement, audited bytes, network.

---

## FOLLOW-UP (not blocking this batch)

### F1. MEDIUM: pin review is bound to the source, but not to an approval
**Where:** `scripts/pin-review.mjs:12-13`; `prepare-ceremony.sh:46`.

The validator binds the review to:
- the ancestor commit;
- a diff of exactly `A <audit>`;
- the committed bytes;
- the fingerprints, via `prepare`.

It never requires the review to approve. A review stating "BLOCKED, do not accept these pins" that lists the hashes passes both `update-web-hashes` and `prepare`.

**Fix:** require a machine-readable line, for example ``Pin acceptance: APPROVED for `<reviewed>` ``, matching the reviewed commit. Refuse any review containing a BLOCKED verdict. Reviewer independence remains procedural.

### F2. LOW: a receipt suppresses the "two launch-created collections" stop
**Where:** `ceremony-reads.mjs:181-197`.

If a duplicate already exists, a receipt for either collection pins it. The other is then labelled only "not the collection named by verified step-0 receipt", and nothing says the launch key also created it.

**Fix:** when a receipt pins, still run `check()` on the other discovered candidates. Name any that were launch-created as "a second collection created by the launch key exists". This should be a warning, not a stop.

### F3. LOW: order confirm releases its lock on a lost response
**Where:** `club-actions.mjs:198-200`.

`finally { reviewLocks.delete(messages) }` releases the lock on a network error, unlike the action-confirm path (`:72-76`). The member is shown an error and can prepare a fresh quote, which gets a new UUID, and confirm it. That creates a second standing offer, because the migration's only order uniqueness index is for listings (`gc_cbob_one_listing`, migration `:35`).

The impact is bounded: a completed trade cancels the buyer's other offers on that asset (`portal-market.ts:166-167`).

**Fix (either):**
- Keep the lock and offer "Retry this authorization" with the **same** `review_token`, which is idempotent through the primary-key 23505 refusal (`portal-market.ts:92-94`).
- Or add a partial unique index on `(member_id, asset) WHERE kind='offer' AND status IN ('active','settling')`.

### F4. LOW: the client lock is scoped to one in-memory element
**Where:** `club-actions.mjs:12`, `:201`, `:65-66`.

- **Reopening the vault clears the lock.** The UI itself says "Reopen this vault" (`:201`). Reopening builds a new `messages` element, so a pending action no longer blocks preparation. The server's `gc_cbob_asset_in_flight` index (migration `:54`) and the issuance guard remain authoritative, so this is not a custody defect. The browser test covers only one element.
- **The redeem/claim pages stay disabled after unlock.** `.action-form` controls disabled at `:65-66` are never re-enabled after a `failed` or `prepared` unlock. These pages pass no `onSettled`, so they stay disabled until reload.

### F5. LOW (needs root): the env allowlist deletes instead of refusing
**Where:** `launch-ceremony.mjs:132-134`; the unit file's `UnsetEnvironment`.

- **Deleting after start cannot undo pre-main effects.** Deleting from `process.env` after Node has started cannot undo variables that act before `main`. The unit's denylist still misses several such variables:
  - `OPENSSL_CONF` and `OPENSSL_MODULES` (provider loading);
  - `NODE_ICU_DATA`;
  - `NODE_COMPILE_CACHE`;
  - `NODE_USE_SYSTEM_CA` together with `SSL_CERT_FILE` / `SSL_CERT_DIR`;
  - `GLIBC_TUNABLES` and `MALLOC_*`.
- **Silent deletion also destroys the evidence** that such a variable was present.

**Fix:**
- Have the launcher **refuse** on any name outside the allowlist. First confirm on the box exactly which variables systemd injects, such as `NOTIFY_SOCKET` and `MONITOR_*`.
- Have `check-ceremony-env.py` validate the **key names only** in all three env files against the same allowlist. This closes the gap at the source.

### F6. LOW: the receipt is re-fetched on every re-render
**Where:** `ceremony-reads.mjs:181-182`.

Each `steps()` re-render calls `getTransaction` again. The proxy limit for that method is `[2,12]` (`rpc-proxy.mjs:59`). A 429 mid-ceremony becomes a `ReadError` STOP. A finalized verdict cannot change, so cache it for the page lifetime.

### F7. INFO: the symlink check needs a real-path rehearsal
**Where:** `pin-review.mjs:10`.

`realpathSync(file) !== path.resolve(file)` fails closed if any component of `root` is a symlink. `prepare` runs it in `/scratch/cbob-vaults-cache/...`, while the tests use `os.tmpdir()`. Confirm in the inert-build rehearsal that the stage path has no symlink component.

---

## Covered and found correct

- **`collectionFromReceipt` / `creatorInTransaction`:**
  - it requires a 64-byte base58 signature, finalized, `meta.err === null`, and `signatures[0] ===` the given signature;
  - the Core program, discriminator 21 and `accounts[0] ===` the named collection must all match;
  - the fee payer at `keys[0]` must be the init authority;
  - ALT-loaded keys are appended in the correct order (static, then writable, then readonly);
  - history padding cannot forge or block it.
- **The `verify-ceremony --creation-signature` path checks both providers**, and refuses a signature without an explicit recorded collection. This resolves V2-3(c).
- **`resolveCollection`:**
  - a refused receipt is a STOP, never an offer of step 0;
  - a receipt cannot override a different pin (it conflicts);
  - an identical browser hint is skipped and not re-checked through history.
- **`validatePinReview`:**
  - path allowlist, no traversal, symlinks refused;
  - ancestor check;
  - the diff must be exactly `A <audit>`;
  - the working copy must equal the committed bytes.
- **`prepare-ceremony.sh`** binds the evidence commit, a delta of only `README`, and the inclusion of the fingerprints (`:46`). That addresses V2-2's binding gap, apart from F1.
- **Root env checks:**
  - `/etc/cbob` must be a real, root-owned directory that is not writable by group or others, which closes the V2-6 rename-swap;
  - `UnsetEnvironment` now covers `LD_*` and the proxy variables;
  - the allowlist covers every variable `ceremony-local.mjs` and `rpc-proxy.mjs` read (`CBOB_CEREMONY_PROFILE`, `CBOB_CEREMONY_ORIGINS`, `CBOB_CEREMONY_HOSTED_AUTH`, `CBOB_CEREMONY_COMMIT`, `CBOB_CEREMONY_PROXY_SECRET`, `CBOB_LOCAL_PORT`, `CBOB_RPC_UPSTREAM`, `CBOB_DAS_UPSTREAM`, `CBOB_VAULT_COLLECTION`, `CBOB_RPC_ORIGIN`, `CBOB_RPC_PORT`).
- **`club-actions`:**
  - a stale prepare failure is suppressed (`:23-24`, `:184-185`);
  - the confirm lock holds through `sending` and through a lost response;
  - the server's intent status set is exactly `prepared`, `sending`, `complete`, `failed` (migration `:45`), and every terminal state unlocks;
  - an expired-quote 409 unlocks after "Check this action" returns `prepared`;
  - the order quote is checked on the client for kind, asset and the 90/10 split.
- **The preparation test floor** went from 58 to 74, a change of 16 = 11 receipt tests + 5 pin-review tests. That matches.

## Verification still missing

1. A page-level test of the step-0 landing, re-render and finalization lag, including a failed send and a sticky resume entry (B1).
2. A double-click / concurrent `run()` test and a reload-in-flight test (B2).
3. A receipt test using a v0 transaction with `loadedAddresses`, and a test for a receipt when two launch-created collections exist (F2).
4. Argument-parsing tests for `verify-ceremony`, a two-provider receipt fixture, and the stable-field comparison (B3).
5. Browser tests for:
   - the order-confirm lost response (F3);
   - unlock on `failed` and `prepared`;
   - a cross-panel reopen (F4).
6. Tests for the parent-directory branch of `check-ceremony-env.py`, and for the launcher allowlist under the `mainnet-hosted` profile. That second test overlaps with known gate V2-7.

**Verdict:**
- **Do not accept this batch for pins or the ceremony build until B1 is fixed.** On the happy path the ceremony page stops right after step 0 and removes the receipt it just told the operator to save.
- **B2 and B3 must be closed before signing.**
- **F1 to F7 can follow.**
- **The V2-1 (dependency provenance) and V2-7 (production delivery rehearsal) gates are unchanged.**
