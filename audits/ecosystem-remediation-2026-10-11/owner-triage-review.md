# Independent audit: CBOB owner-triage correction source 88d12e4

**Verdict**
- **Bundle-pin acceptance for 88d12e4: approved, with conditions.** The conditions are in section 6. None of the `web/src` changes adds or changes a signing path, instruction builder, authorization gate or custody behaviour.
- **88d12e4 cannot be published through `publish-ecosystem.sh --execute`.** The new public-data pinning runs inside the publisher and has one high-severity blocker (R1) and two medium ones (R2, R3). Fixing them only needs changes in `web/deploy/`, which leave the bundles and pins unchanged. That fix commit needs its own narrow review.
- **Publication still waits for the owner-arranged re-triage.**

**Method:** Read, Glob and Grep only. No build, test, git command, network call, credential read or job.
- Refs read directly: `refs/heads/v6` and `refs/remotes/origin/v6` both point to `88d12e465f99…`. The reflog shows 61a4cf6 → efd54b8 → 69bea5c → 88d12e4.
- I read the whole 515-line patch.
- I read these in full on disk: `bank/vault-index.mjs`, `bank/public-data.mjs`, `charter-status.mjs`, `club.mjs`, `ui.mjs`, `pin-public-data.sh`, `run-public-data.py`, `publish-ecosystem.sh`, `prepare-static-pages.mjs`, `update-web-hashes.mjs` and `build-club-engine.mjs`.
- I also read: the live `/etc/systemd` unit, drop-in and timer; the statement notices for 2026-2 and 2026-3, the statements index and feed entries; P&F sections IV to IX; the schedule's scroll-cue markup and CSS; the burn receipt; and the Gary adapter's formatter lines and test.

---

## 1. New release blockers (must be fixed before any `--execute`)

### R1 (High): a new pinned worktree has no dependencies, so the public-data timer gets pointed at code that cannot start
- **Where:** `web/deploy/pin-public-data.sh:12-13,20` and `run-public-data.py:9-15`.
- **The mechanism:**
  - `git worktree add --detach /opt/cbob-public-data/<commit>` checks out tracked files only.
  - `node_modules/` is gitignored (`.gitignore:2`), and the repo has no `package.json` or lockfile.
  - Node resolves `@solana/web3.js` (and `bs58`) by walking up from the worktree. None of `/opt/cbob-public-data/<sha>/node_modules`, `/opt/cbob-public-data/node_modules`, `/opt/node_modules` or `/node_modules` exists (checked).
  - The live 61a4cf6 worktree does have a `node_modules/@solana/web3.js` (1.98.4), but it was provisioned by hand. Nothing in the committed scripts does that.
- **Failure path when publishing 88d12e4 or its pin commit:**
  1. `publish-ecosystem.sh:39` calls `pin-public-data.sh`, which creates the worktree.
  2. `run-public-data.py --check` passes, because it checks only git state.
  3. The drop-in `50-reviewed-source.conf` is replaced with one pointing at the new worktree, followed by `daemon-reload`.
  4. Pages are published.
  5. `publish-ecosystem.sh:46` runs the new source, which fails with `ERR_MODULE_NOT_FOUND`.
  6. The script prints "public-data refresh deferred to the existing timer". But the existing timer is now the same broken source.
- **Consequences:**
  - Every ten-minute run fails, so `/data/vaults.json`, `/data/governance.json` and `/v/*.json` stop updating.
  - After 30 minutes the charter desk shows "temporarily unavailable" on claim, buy and redeem, and the market goes stale.
  - It fails closed (no wrong data is published), but it silently takes the public record down. Around initialization, that is the window that matters most.
- **Fix:**
  - Provision dependencies deterministically for each pinned worktree. Either commit a lockfile and run `npm ci --ignore-scripts` in the worktree, or point at a separately reviewed install whose version manifest is checked.
  - Make `--check` prove the imports actually resolve. For example, run `node --input-type=module -e "await import('@solana/web3.js'); await import('bs58')"` with cwd set to the worktree. Better still, add a dry import of `bank/public-data.mjs` dependencies that never writes.
  - Install the drop-in only after one successful dry run, such as `vault-index --dry`. This is a read; whether to run it remains the operator's call.

### R2 (Medium): the fail-closed base unit exists only in the repo, so a rollback brings back the editing-checkout bypass
- **Where:** repo `web/deploy/cbob-public-data.service:7-9` versus live `/etc/systemd/system/cbob-public-data.service:7-8`.
- The repo's base unit now has `ExecStart=/usr/bin/false`. The installed base unit is still the old one: `WorkingDirectory=/opt/cbob-vaults` running `node bank/public-data.mjs`.
- `pin-public-data.sh` never installs or checks the base unit. Its rollback path (`:36`, `elif target.exists(): target.unlink()`) removes the drop-in when there was no previous one.
- **Failure path:** any removal of the drop-in, whether by that rollback, manual cleanup, or a later "reset to the repo unit" that does not include it, silently brings back the exact A6 / finding-8 failure: the timer runs uncommitted edits from `/opt/cbob-vaults`.
- **Fix:**
  - Have `pin-public-data.sh` install the repo's base unit, or refuse unless `/etc/…/cbob-public-data.service` matches it byte for byte.
  - Have the rollback restore the previous drop-in, never fall through to no drop-in.

### R3 (Medium): `publish-ecosystem.sh` moves the timer before publishing and reports a failure as a deferral
- **Where:** `publish-ecosystem.sh:39`, then `:44`, then `:46-48`.
- The data timer is pointed at the new commit before `publish-files.py` runs. If publishing then fails, the box runs new data code under old pages. The `vaults.json` schema is unchanged in this delta, so the immediate impact is low, but the order is wrong.
- When the first run of the new source fails, the script exits 0 with a message that implies a working fallback.
- **Fix:**
  - Pin after a successful smoke run.
  - On a failed first run, restore the previous drop-in from the backup `pin-public-data.sh` already makes, and exit non-zero.

---

## 2. Findings in the delta that do not block

**N1 (Low): the consistent-read claim is overstated, and retries have no backoff.** `vault-index.mjs:196-199,258-264`
- The retry logic is correct:
  - only `CBOB_SNAPSHOT_CHANGED` is retried;
  - there are four full `collect()` attempts;
  - nothing is written until one succeeds;
  - invalid-owner errors are not hidden.
- But the two MintConfig reads use `confirmed` with no `minContextSlot`. Behind a load-balanced RPC, records read in the middle can come from a later slot than two identical config reads. In that case `charter_claimed` disagrees with the count of `charter:true` records.
- `charterStatus` then fails closed and shows "unavailable", so the result is safe. Even so, the handoff's statement "Nothing publishes from a mixed snapshot" is stronger than what the code guarantees.
- Retries fire immediately with no jitter. During a claim burst at charter open, all four attempts can collide.
- **Fix:**
  - Carry the first read's `context.slot` as `minContextSlot` into the later reads.
  - Add a short jittered delay between attempts.
- The test (`public-data.test.mjs`) covers the retry wrapper only, not `collect()`.

**N2 (Low, live today): the live 61a4cf6 timer is not fully isolated.**
- At 61a4cf6, `ROOT = '/opt/cbob-vaults'` (worktree `vault-index.mjs:39,158`). The live timer therefore reads `launch/mainnet-init.json` from the editing checkout, not from its own worktree.
- `charter_opens_at` is `OPEN` there today, so nothing is exposed now.
- An uncommitted edit that set it to `RULED` would be published into `vaults.json` before review. That would touch D5(b), although the desk itself would still show "waiting".
- 88d12e4's source-relative ROOT fixes this, but only once R1 is resolved and the new source is pinned. Until then, do not edit the launch file in `/opt/cbob-vaults` without committing.

**N3 (Low): the opened-vault ledger lives inside the editing checkout.**
- `STATE_DIR` is hard-coded to `/opt/cbob-vaults/.cache/vault-index` (`:42`), and the metadata state is in the same tree (`public-data.mjs:12`).
- A `git clean -fdx` on the editing checkout would wipe the "priced once" opening ledger.
- **Fix:** move both to `/var/lib/cbob/`.

**N4 (Low): the session check still shows a raw parser error on a non-JSON 200.** `club.mjs:8`
- A 200 reply that is not JSON (for example an HTML error page) makes `r.json()` throw a raw `SyntaxError`, and the user sees that text instead of the account-unavailable message.
- The JSON-`null` case is fixed and tested. The non-JSON case is not.
- **Fix:** `r.json().catch(() => { throw new Error('Gary Club account access is temporarily unavailable.') })`, plus a test.

**N5 (Low, UX): the charter desk briefly says "unavailable" on every load.** `charter-status.mjs:38`
- `draw()` runs once with `d = null` before the first fetch, so every page load flashes "The charter record is temporarily unavailable."
- **Fix:** use a neutral "Reading the public record" state until the first refresh finishes.
- The other claims check out:
  - **Malformed-data handling:** vault entries are type-checked; the initialization and collection fields must agree; an uninitialized index must show a claim count of 0; window times must be safe positive integers with close after open; any throw renders "unavailable".
  - **Stable link DOM:** link nodes are created once and only `textContent` and `hidden` change, so keyboard focus survives refreshes. All dynamic text goes through `el()` and `textContent`.

**N6 (Low, copy): "The Bank / Opening status" is a misleading heading on /redeem/.** `redeem.html:22` and `buy.html:22`
- On /redeem/, "opening" means opening a vault. Under this heading the desk shows charter-window text and an "until closing" countdown, which a holder can read as vault openings closing.
- Using the same heading on buy and redeem does not deliver what triage polish item 12 asked for (holder-specific headings).
- The static fallback eyebrow still reads "The charter desk".
- **Fix:** "Charter window status" (or similar) on both pages, and in the fallback.

**N7 (Low, owner decision): the 15% recipient is described three ways.**
- Buy (new copy): "15% to the treasury".
- P&F section VI: "to Gary Club".
- The original 2026-3 statement: "to the Bank".
- Section V stays reserved under D3 and unchanged, which is correct. Flagged here so the owner settles one description.
- **Buy page against the 30/60-day semantics:** the copy is correct. It says the vault starts empty, the purchase price is not the activation deposit, activation needs a 21,000-sat deposit after the level draw, and the vault joins after a distribution and earns from the following one. It does not reintroduce immediate earning.

**N8 (Info): the burn receipt counts 374 mints but only 373 distinct signatures.**
- Mints `7PkrvF…` and `Cw1tY9…` share signature `3v6oT7…` at the same block time (one transaction burned two).
- So "374 public burn signatures" in the scope statement is imprecise. The per-mint claim in the handoff is accurate.
- The census is robust:
  - the cutoff is 1786968003 (17 Aug 12:00:03 UTC);
  - the three later burns are at 1787688104 (two, 25 Aug) and 1790365091 (25 Sep);
  - no burn falls between the cutoff and the 2026-2 release.
- The `via_process` classification (369 through the process, 2 outside) was not verified independently, as instructed.

**N9 (Low, docs only): the README is stale in two places.**
- `web/README.md:675` still says "Had they waited?".
- `web/README.md:10` says vault owners "vote after activation". The code gates voting on `mint_index < index_snapshot`, and the new governance copy ("Voting opens after vaults are issued") is the accurate one.

**N10 (Low, launch backlog): the Gary adapter carries no provenance.**
- `club-engine.cjs:1339,1898` contains the Austin-time formatter, which matches `plan-redeem.mjs:302` at 88d12e4.
- But the artifact records no cbob-vaults source commit, and its `.sha256` file only proves the artifact matches itself.
- Whether 3403fd33 is byte-equal to a fresh build from 88d12e4 was not verified.
- **Fix:** have `build-club-engine.mjs` write the source commit and a clean-tree flag into the header, and have the test assert them.

---

## 3. Items verified as addressed (inspected, not rubber-stamped)

**Triage findings 2 to 5 and 10 to 12**
- **B2 (buy):** copy and the new Activate step are present, with the deliberate wording correction described under N7.
- **B3 (2026-3):** the notice covers all four required points: open only at /redeem/, stranded reserves from other burns, the 2.1% rolling-hour limit, and Gary Club signing. It links to `#section-ix`, the feed marker at `feed.xml:121` matches, and the original body is retained.
  - Nit: P&F section IX says "per hour" where the notice says "per rolling hour".
- **B9 (statements index):** the new wording is present (`statements/index.html:230`).
- **B8 (2026-2):**
  - The dated notice is present (`:236`) and states the closing census correctly.
  - The feed marker is at `:144`, and JSON-LD `dateModified` is 2026-10-11.
  - The original body, GUID and pubDate are unchanged.
  - The link targets `#section-v`. That section is under the D3 hold but already states the deposit-then-request procedure.
- **P&F section IV:** the closing census is dated and distinguished from today's count, with no em dashes.
- **Austin time:** the opening-limit note and the share and record cards use America/Chicago. The remaining UTC strings are explicitly labelled UTC-day buckets or operator-only ceremony text.
- **Copy cleanup:** account copy now says trading is closed, and the "Then and now" rename is complete in the market source.
- **Schedule:** one scroll cue by CSS (`ecosystem-nav.css:33` hides `.tw:after` on phones), and the boost-qualified metadata is present.

**Analytics and CSP**
- Analytics hosts appear only in `scripts/prepare-static-pages.mjs:15`, which covers the 11 read-only `web/site` documents.
- The compiled pages' CSP (`build.mjs:125`) is unchanged, and no `cloudflareinsights` string appears in `web/src`, `web/deploy` or `build.mjs`.
- The `web/site` documents are read-only (`bank-home.js` fetches only `/data/vaults.json`).
- The committed HTML already carries the new CSP (2026-2 `:5`), so the `--check` mode of `prepare-static-pages` will pass.

**Bundle scope**
- The ceremony page imports none of the changed modules, except `PACKET_LIMIT` reached through `tx.mjs` from `plan-redeem.mjs`. The changed line there is inside `planRedemption`, which the ceremony does not use.
- Supporting evidence: `web/dist/BUILD.txt`, built at efd54b8 with uncommitted changes during this batch, shows mainnet ceremony `4673d424…`, equal to the pin.
- Expected pin moves are all explained by the diff:
  - **buy, claim, redeem:** charter-status (plus the html changes);
  - **account, vault, market, governance:** club;
  - **market, history, governance:** exhibition and record-card;
  - **redeem, vault:** plan-redeem.

**Tests**
- Floors are consistent: ecosystem goes from 46 to 56 (10 new checks), and public-data has 5. No floor was lowered.

**Frozen code**
- Nothing in the delta touches `programs/` or `dist/`.

---

## 4. Launch backlog that predates this delta (not new blockers)

- **Enabling actions:**
  - H1: one switch (`CBOB_PORTAL_ACTIONS_ENABLED`) enables both holder actions and trading, and must be split.
  - H2: Activate and Record level draw only appear inside the trading panel, and a claim gives no link to the new vault.
  - L4: the club claim and buy forms ignore `enabled`.
- **Copy:** `plan-vault.mjs:67` still says the draw is "recorded automatically" while the crank is in dry run.
- **Trading prerequisites:** A2, G-A2, G-A3, G-C6, G-B3 to G-B5, an end-to-end check of the 10% SOL royalty reaching REVENUE, and the D1 custody alternatives.
- **Index:** no check of `MintConfig.collection` against `ids.COLL`; no `minContextSlot` (see N1).
- **Publisher checks:**
  - It does not check that the published HEAD equals the reviewed commit plus the pin and audit edits.
  - `web/site` and `index.html` have no pins (M10).
  - esbuild is loaded from `/home/ubuntu/luna-remotion`, unpinned.
  - The dependency tree is unmanaged.
- **Launch sequencing:** under the pinned model, recording the collection in `config.js` after the ceremony becomes a reviewed release plus a re-pin. Between initialization and that release, the desk will correctly show "unavailable". Schedule it well before charter opening.
- **Owner decisions:** D3 (P&F section V wording, kept unchanged) and D5(b) (no permanent date anywhere in the delta) both still hold.

---

## 5. Missing verification

1. **The mainnet-local ceremony hash `ab6a155c…` is unverified.** `web/dist-mainnet-local/BUILD.txt` is a stale 1ddbb43 build with uncommitted changes. It must be confirmed by a fresh build at acceptance.
2. **No fresh clean build of either profile, and no `node web/test/run-all.mjs`, was observed** at 88d12e4.
3. **I could not run git, so two scope claims are unconfirmed:**
   - that 69bea5c → 88d12e4 changes only `burn-chain-receipt.json` (the genesis field at line 2259 is present);
   - that the patch plus the `web/site`, README and STATUS edits I read on disk are the complete 61a4cf6 → 69bea5c delta.
4. **Whether `node_modules` in the 61a4cf6 worktree is a copy or a symlink to the mutable `/opt/cbob-vaults/node_modules`.** If it is a symlink, the live "isolated" timer's dependencies are not isolated either.
5. **The adapter at 3403fd33 was not rebuilt and compared** against 88d12e4.
6. **Live-system checks were not done:** served bytes, the Cloudflare purge, the nginx server CSP and `frame-ancestors` headers, and whether Cloudflare's automatic beacon injection matches the allowed hosts.

---

## 6. Decision

**Bundle-pin acceptance for 88d12e4: approved**, provided all of the following hold:

1. Run `scripts/update-web-hashes.mjs --accept-reviewed --review <artifact>` from a clean tree with HEAD exactly `88d12e465f99…`.
   - Commit the review artifact under `audits/` first, so the README evidence path resolves inside the repo.
   - That commit changes HEAD, so the source commit recorded in the pin evidence will be the audit commit. Its diff from 88d12e4 must contain only that `audits/` file.
2. In the new pin table:
   - both ceremony rows are unchanged (mainnet `4673d4246f6e…`, mainnet-local `ab6a155cbcbf…`);
   - only the eight holder `app.js` files and `assets/style.css` move, per profile;
   - any other movement means stop.
3. `run-all.mjs` passes every file at its exact floor after acceptance, including `bundle.test.mjs` at 133.

**Refused: publishing 88d12e4 or its pin commit as is through `publish-ecosystem.sh --execute`**, because of R1, with R2 and R3 to be fixed in the same commit.
- The fix touches only `web/deploy/`, so the bundles and accepted pins stay valid.
- It needs its own short review.
- At publication, `git diff --name-only <pin-source-commit> HEAD` must list only that reviewed `web/deploy` fix, `web/README.md` and `audits/` files.

**Separately:**
- The ceremony scripts and signing CSP are unchanged by this delta.
- Actions stay off, and `collection: null` stays as is.
- Publication remains held for the owner's separate Claude re-triage.
