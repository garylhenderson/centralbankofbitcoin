# R1 audit: CBOB web application delta 1ddbb43 → 61a4cf6

**Verdict: yes, this delta is safe to publish with holder and trading actions closed and the bundle pins re-accepted against this review**, provided the conditions in §4 are met. I found **no new blocker**. Every new finding below is Low. Nothing in the delta changes a signing path, an instruction builder, an authorization gate, custody or the frozen programs.

**What I read:**
- The whole patch (452 lines).
- On disk: `charter-status.mjs`, `club.mjs`, `club-actions.mjs`, `ecosystem.mjs`, `plan-get.mjs`, `ui.mjs`.
- Pages: `account`, `market`, the changed parts of `vault`, `claim` 1-84, and the import lists of all pages.
- `web/build.mjs`, `bank/vault-index.mjs`, `scripts/update-web-hashes.mjs`, `web/deploy/publish-ecosystem.sh` and `nginx-club.conf.example`.
- SPEC 640-719, `ecosystem.test.mjs`, and the README pin table.
- The `correction-triage`, `public-review` and `STATUS` reports.
- The static corrections in statements 2026-3, 2026-5 and 2026-7, `feed.xml`, and Purposes and Functions.
- The served `/data/vaults.json` (public).
- On the Gary side: the session branch at `route.ts:92-99` and the `CBOB_PORTAL_ACTIONS_ENABLED` gates.

**What I did not do:** no build, test, git command, env-file read or network call.

## 1. Facts I established

**Commit and source**
- `refs/heads/v6` and `refs/remotes/origin/v6` both point to `61a4cf63…`.
- `web/dist/BUILD.txt` records commit `61a4cf63…` with no "uncommitted changes" suffix, so that mainnet build was made from a clean `web/` at 61a4cf6.
- The on-disk files I spot-checked match the "+" side of the patch.

**Bundle scope matches the diff**
- In that mainnet build, `ceremony-0cfecdcaf80584b6/app.js` is `4673d424…`, the same as the existing pin. The ceremony page imports no changed module.
- The other eight `app.js` files and `style.css` changed. Each change is explained by the diff:
  - `club.mjs` reaches account, vault, market and governance.
  - `charter-status.mjs` reaches claim, buy and redeem.
  - `ecosystem.mjs` reaches market.
  - `history.mjs` changed itself.
- No pin moved without a source cause.

**The `plan-get.mjs` change is already in Gary's engine**
- The only change is the `when` date formatter: refusal text now shows Austin time.
- Gary's deployed `generated/club-engine.cjs:1339` already contains that formatter (commit 13f2e1b6). The server engine and the browser therefore agree, and nothing new reaches Gary in this release.

**Session compatibility (B17) holds in every combination**
- `nginx-club.conf.example:5` uses `rewrite … break`, which keeps the `?v=2` query.
- Gary returns `200 {signedIn:false}` only when `v=2` and the error is PortalError 401 (`route.ts:95`). Otherwise it still returns 401.
- New page + current Gary: signed out is read as null. Correct.
- Old already-open page + current Gary: it sends no `v`, gets 401, and reads null. Correct.
- New page + a rolled-back Gary: 401, read as null. Correct.
- The signed-in response shape is unchanged.

**Gates are untouched**
- `portal-market.ts:19,44` and `route.ts:98` still require `=== '1'`.
- `config.js:78` still has `collection: null`.
- `launch.json` still has `charter_opens_at: null/OPEN` (D5(b) holds).
- The served `/data/vaults.json` now carries `initialization_observed:false`, `charter_claimed:0`, `collection:null` and null dates. So the desk will render "to be announced, 0 of 240" rather than failing open.

**DOM safety**
- All new dynamic text goes through `el()` and `textContent` (`ui.mjs:8-21`).
- Every new `href` is a constant.
- The new HTML adds only `canonical`, `og:image`, `twitter:card` and `theme-color` meta tags plus static sections. The CSP is unchanged (`script-src 'self'`); `og:image` is not fetched by the page.

**Correction-triage items R2 to R4 are fixed, and the originals are retained**
- 2026-3 (`:235`): a dated aside reads "Crediting and delivery are separate entries". The original line 243 is retained. `feed.xml:121` carries the marker, and the JSON-LD has `dateModified 2026-10-11`.
- 2026-7 (`:235`): a dated aside reads "Deposits precede participation", covering the 21,000-sat threshold, joining, close+30/60 days and SOL account costs. It matches SPEC 650-695. The original line 243 ("contains nothing") is retained. `feed.xml:13` carries the marker.
- Purposes and Functions:
  - line 538 now reads "credited and delivered under Section VI";
  - line 609 no longer says "whether or not anyone is watching";
  - §VI (497-500) matches SPEC.
- JSON-LD `dateModified` is `2026-10-11` on Purposes and Functions `:61` and the Schedule `:45`.
- Feed GUIDs and pubDates are unchanged, as STATUS says.

**The new charter copy is accurate**
- The redeem rate cap ("2.1% of live vaults per rolling hour, rounded up") matches SPEC 21 and 1495.
- The claim page's "joins after a distribution and earns from the following one" matches SPEC 652 and 662-667.

## 2. New findings in this delta (none blocking)

**N1 (Low): the charter desk does not validate the window fields.** `charter-status.mjs:8-11`
- `charter_opens_at` and `charter_closes_at` are only truth-tested.
- **Failure path:** a malformed index with a collection set (a non-numeric string, or close ≤ open) falls through to `state: 'closed'`, showing "Closed Invalid Date Austin time" instead of "unavailable".
- An element of `vaults` that is `null` makes line 6 throw.
- **Fix:** require both to be `Number.isSafeInteger` (or both null), require `closes === opens + 604800` (the RULED `charter_secs`), and require every vault entry to be an object. Otherwise return `unavailable`.

**N2 (Low): the refresh timer can still freeze the desk, and it moves focus every minute.** `charter-status.mjs:27-30`
- **Failure path:** `draw()` inside the async interval is not in a try/catch. A throw (see N1) becomes an unhandled rejection, and the last rendering and countdown stay on screen. This is a residual of the earlier triage item.
- The desk also rebuilds its links every 60 seconds, so a keyboard user's focus is lost.
- **Fix:** wrap `draw` in a try/catch that renders "unavailable", and redraw only when the output text changes.

**N3 (Low): the session check trusts any successful reply.** `club.mjs:7-8`
- Any 2xx JSON other than `{signedIn:false}` becomes a session. A JSON `null` throws a raw TypeError that `club-actions.mjs:127` then shows to the user.
- **Failure path:** an intermediary 200 such as an error page or a future shape change becomes a "session" with `csrf` undefined. The server rejects the request, so there is no security impact, only confusing text.
- **Fix:** accept a session only if `typeof data?.wallet === 'string' && typeof data?.csrf === 'string'`. Throw the "temporarily unavailable" message otherwise.

**N4 (Low, copy consistency): renames applied in one place but not others**
- History now says "Then and now". These still say "Had they waited": `market.mjs:154,185` and the meta description at `market.html:9`.
- `vault.html:31` still says "Choose your next move", which `account.mjs` dropped.
- Owner's choice. These are flagged only so the rename is not described as complete.

**N5 (Low, copy): claim page**
- `claim.html` has "issued at no cost; A small SOL balance…" (capital after a semicolon).
- Its step 4 omits two things the linked 2026-7 correction states:
  - the level must be drawn before activation (SPEC 650);
  - nothing is credited before charter close + 30 days.
- **Fix:** add one clause, or link the correction.

**N6 (Low, tests missing for the two behaviours this release exists to change)**
- `ecosystem.test.mjs:69-76` has no case for an older index that lacks `initialization_observed` or `charter_claimed`. That is the exact regression the R-fix closed.
- It also has no case for `collection` set with `initialization_observed:false`, or for malformed dates.
- No committed test covers `readClubSession` receiving `200 {signedIn:false}`. The `*-browser.cjs` mocks only use the path, and STATUS's "signed-out v2" check was not committed.
- **Fix:** add these cases.

## 3. Existing deferred launch blockers (not introduced here; still open)

**Enabling actions**
- **H1:** one switch (`CBOB_PORTAL_ACTIONS_ENABLED`) enables both holder actions and trading. It must be split before either is enabled.
- **H2:** Activate and Record level draw only appear after `if (!market.enabled) return` inside "Trade this vault" (`club-actions.mjs:138,166-167`). After a claim, the outcome gives no link to the new vault.
- **L4:** the club claim and buy forms ignore `enabled` (`club-actions.mjs:94-125`).

**Copy that over-promises**
- **L7, carried over:** the triage said to fix this "with the next bundle", and this is that bundle. `account.mjs:26` still says "Standing orders settle automatically at your price" while trading is closed.
- `plan-vault.mjs:67` says the draw "is recorded automatically, usually within minutes", but the crank is in dry run.
- The Gary 409 message ("Account actions open after initialization and validation") no longer matches the new UI line ("Vault trading is not open yet").

**Trading prerequisites**
- A2, G-A2, G-A3, G-C6 and G-B3 to G-B5.
- End-to-end verification that the 10% SOL royalty reaches REVENUE and is then swapped and split before trading opens.
- D1 custody alternatives.

**Index**
- No check of `MintConfig.collection` against `ids.COLL`.
- The bare-burn path is untested against a real Core burn record.
- The second config read in `vault-index.mjs` does not use `minContextSlot`.
- Crons run the working tree, not a reviewed commit.

**Publishing and serving**
- `index.html` (which carries the CSP and SRI) and `web/site` are not pinned (M10).
- Nobody has checked the served bytes after publishing, and there is no Cloudflare purge.
- nginx `frame-ancestors` and server security headers have not been verified.
- The review artifact is stored as a path relative to the repo.

**Owner decisions**
- D3 purchase wording is reserved to the owner. The only buy-page change is the SOL-fee sentence, which I do not read as D3 wording; the owner should confirm.
- D5(b): no permanent date appears anywhere in this delta.

## 4. Conditions for publishing

1. Accept pins only from a clean tree at exactly `61a4cf6`, and pass this report as `--review`. `update-web-hashes.mjs:31-33` enforces the clean tree and records the source commit.
2. In the new pin table, both ceremony rows must be unchanged: mainnet `4673d424…` and mainnet-local `ab6a155c…`. If either moves, stop; the change is not explained by this diff. (`web/dist-mainnet-local` is a stale 1ddbb43 build, so the mainnet-local side is still unverified.)
3. The publisher does not check that the commit it publishes is the reviewed one plus the pin edit. `publish-ecosystem.sh:10` requires HEAD, but the README pin edit creates a new commit. Before `--execute`, confirm `git diff --name-only 61a4cf6 HEAD` lists only `web/README.md`. Unpinned HTML or static changes would otherwise pass.
4. After publishing:
   - curl the origin and the edge for all eight changed pages: each `index.html` `?v=` must match its pinned `app.js`;
   - purge Cloudflare;
   - load claim, buy and redeem signed out and confirm the desk shows "to be announced, 0 of 240".
5. Leave `CBOB_PORTAL_ACTIONS_ENABLED` unset and `collection: null`. Nothing in this release depends on changing either.

## 5. Not verified
- No build or test was run. Checking the mainnet-local hashes and any test pass is left to the publisher's checks.
- I could not run `git status`, so a clean worktree is inferred from `BUILD.txt` and the refs only.
- The served bytes, CDN behaviour and nginx headers were not inspected.
- The film and media links were not fetched.
