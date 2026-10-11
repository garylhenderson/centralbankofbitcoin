# Final triage: CBOB correction release (public-remediation and publisher remediation)

**What I read:**
- The two triage inputs. `correction-release-triage.md` and its `.stderr` exist but are empty, probably from an earlier failed run.
- In `/opt/cbob-vaults`: all the `web/deploy` publish scripts, `scripts/{prepare-static-pages,update-web-hashes}.mjs`, `web/build.mjs`, `bank/vault-index.mjs`, `charter-status.mjs`, `bank-home.js`, `account.mjs` and the boost label in `market.mjs`.
- The changed parts of Purposes and Functions, the Schedule, statements 2026-3, 2026-5 and 2026-7, `statements/index.html` and `feed.xml`, plus SPEC 645-713.
- The served copies under `/var/www/centralbankofbitcoin` and the `.git` refs.
- The portal flag in `gary-club-cbob/src/lib/cbob/portal-market.ts`.

**What I did not do:** I ran nothing, built nothing, read no env file and made no network calls.

## Verdict

**Not ready to publish as-is.**
- **R1 (release process):** this is not a document-only release at the byte level. Every signing-page bundle changes, so the publisher refuses until the hash pins are re-accepted against a review that actually covers those bundles.
- **R2 to R4 (content):** the same misstatements this release corrects in Purposes and Functions still appear in two sibling statements and in two lines of Purposes and Functions itself.

R2 to R4 are static-only fixes. They need no re-pin and should go into the same commit. Publishing without them would not make the live site worse, but the release could not be described as reconciling the documents (G-B2).

No item found here could enable holder actions or trading:
- The portal gate is a strict `=== '1'` check (`portal-market.ts:19,44`).
- The Phantom claim path refuses while `collection` is null (`claim.mjs:43`; `config.js:78` sets `collection: null`).

H1 (one switch for holder actions and trading) and H2 (action discovery) correctly remain **blocked for enablement**.

---

## Blockers

### R1 (Medium): the release replaces every served signing bundle, and nothing yet ties the new pins to a review
**Where:**
- `publish-ecosystem.sh:17,18,25-28,36`
- `update-web-hashes.mjs:24-35`
- `web/README.md:396-415`

**Evidence:**
- The served bundles match the README pins exactly. The `?v=` prefixes of the served `index.html` files equal the pins for vault `961913cb`, redeem `d36133f4`, claim `44bfbae6`, buy `1973be0e`, account `a9c9b939` and market `e6154278`.
- The served `claim/app.js` contains no charter desk code.
- The current `claim.mjs`, `buy.mjs` and `redeem.mjs` all import `mountCharterStatus`.
- `web/dist/BUILD.txt` was built at `c7bf967` with "web/ has uncommitted changes". It shows different hashes for all eight non-ceremony bundles and for `style.css`.
- HEAD equals `origin/v6`, which is `c7bf967`. So the corrections now in the working tree appear to be uncommitted. I could not run `git status` to confirm.

**Failure path:**
- `update-web-hashes.mjs` exits 1 ("Fresh bundles differ from published pins"), so `publish-ecosystem.sh` refuses. That part fails safe.
- The way past it is `--accept-reviewed --review <file>`. That command checks only that the file exists and is at least 100 bytes (`:30`).
- If this triage, or `public-remediation-review.md`, is passed as `<file>`, the new pins for claim, buy, redeem, vault, account and market get recorded as "reviewed". Neither document reviewed the full `web/src` change between the served pins and HEAD.
- In particular, neither covers `club-actions.mjs`, `club.mjs`, `plan-*.mjs` or `position*.mjs` as they stand after the remediation edits.

**Fix (pick one):**
- **(a) Static-only publish.** Add a mode to `publish-ecosystem.sh` that stages only `web/site` and leaves the served bundles in place. This matches "correction-only". The charter desk is not live today, so holding it back does not break anything.
- **(b) Ship the bundles.** First commit and push. Then get a review of the full `web/src` change from the served-pin source to HEAD, and pass that review as `--review`.
  - Do **not** use this file. It covered `charter-status.mjs`, the `market.mjs` boost label, `account.mjs` and the action gates, nothing more.
  - Even before initialization these bundles cannot sign, but the pin record must not overstate what was reviewed.

### R2 (Medium): CBOB 2026-3 still promises claimless delivery
**Where:**
- `web/site/statements/cbob-2026-3/index.html:242`: "the eighty five arrives without a claim process".
- `statements/feed.xml:126` repeats it.

**Problem:** This is the H3 misstatement. Purposes and Functions §VI now says crediting and delivery are separate, delivery is the permissionless `claim`, and the scheduled caller is not yet enabled. The statement has no correction marker. The previous review covered only statements 2026-5 and 2026-7, so this was missed.

**Fix:** Add a dated correction aside, as was done for 2026-5. Add matching feed `<description>` and JSON-LD markers. Keep the original statement as issued.

### R3 (Medium): CBOB 2026-7, the page the charter desk links to as "charter terms", says an unactivated charter "contains nothing"
**Where:**
- `cbob-2026-7/index.html:242`
- `feed.xml:33`
- The link itself is at `charter-status.mjs:25,31`.

**Problem:** Activation *requires* at least 21,000 sats already deposited in the vault (SPEC 650; Purposes and Functions :453, :470). So an unactivated vault routinely holds reserves. This is the M8 error, corrected in Purposes and Functions but not here. Every claimant who follows the desk link lands on this statement.

**Fix:** Add a dated correction stating that a vault can hold deposits before activation and earns nothing until it joins.

### R4 (Low-Medium): Purposes and Functions still contradicts its own corrected §VI
**Where:**
- `purposes-and-functions/index.html:538`: "the automatic 85 percent flow described in Section VI".
- `:609`: "on schedule, in public, whether or not anyone is watching".

**Problem:** Both lines restate the automation claim that §VI (:497-500) now withdraws.

**Fix:** Use "the 85 percent credited and delivered under Section VI" at :538, and drop "whether or not anyone is watching" at :609.

### Fix in the same commit (Low, static only)
- **Stale JSON-LD `dateModified`:** Purposes and Functions shows `2026-08-18` at :61 and the Schedule shows `2026-08-22` at :45. Both documents were revised on 11 October.
- **Feed visibility:** the 2026-5 feed item keeps its original `guid` and `pubDate`, so subscribed readers will not resurface it. Consider a separate correction item, or accept this and say so.

---

## Deferred prelaunch work (not blocking this release)

**Actions and copy (H1/H2 and related):**
- **H1 / H2:** split the holder-actions flag from the trading flag; add a "Vault actions" block outside the trading panel; return the new asset from the claim/buy outcome. These stay blocked for enablement.
- **"Drawn shortly after issuance":** this appears in Purposes and Functions :564, Schedule §II (:275) and the 2026-5 correction (:235), plus "recorded automatically, usually within minutes" at `plan-vault.mjs:67`.
  - SPEC 1394-1397 makes the draw depend on traffic or on the crank's reveal lane, and the crank is installed in dry-run mode.
  - Arm the reveal lane before the first issuance, or soften the copy.
- **Trading advertised while closed:** `account.mjs:26` ("Standing orders settle automatically at your price") and `web/site/index.html:7` ("List yours or make an offer"). Fix with the next bundle.
- **L4:** the club claim and buy forms ignore `enabled`, so users can prepare an action and then hit a 409.

**Charter desk and index:**
- **Desk fails open on an older index:** `charter-status.mjs:7` treats a missing `initialization_observed` or `charter_claimed` as "not initialized" and "no count to check".
  - The served `/data/vaults.json` (generated 1791736802) has neither field. So the vault-index cron is not yet running the new code, and the desk guard would do nothing if the bundle shipped first.
  - Before `initialize`: confirm the cron runs the committed `vault-index.mjs`, and make the desk fail closed when those fields are absent.
  - Also validate `Array.isArray(d.vaults)`. At :28-29, a draw that throws inside the interval freezes the last render and the countdown.
- **Collection cross-check:** `vault-index.mjs:165` never compares `MintConfig.collection` with `ids.COLL`. With zero vaults, line 180 never runs either.
- **Bare-burn path is untested:** `vault-index.mjs:177` throws if a non-retired asset account is absent. Confirm against a real Core burn tombstone that `parseCoreAsset` reports `burned` rather than returning null.
- **Remaining M2 gap:** the before/after `MintConfig` comparison (:195-199) catches claims, because `owed_scaled` changes. But reads served by different RPC nodes can go backwards. Use `minContextSlot` on the second read.
- **Census label:** the Schedule's "Activated" column counts only joined vaults (`participation.active`). Vaults that have requested activation but not yet joined are excluded. Consider "Participating".

**Relay, revenue and process:**
- **Relay and go-live residuals:** L-g to L-n and L-o from the publisher triage. `go-live.sh` cannot run this release anyway, because `collection` is null (`go-live.sh:21`). Use `publish-ecosystem.sh --execute <commit>` directly.
- **Royalty path:** verify end to end that SOL royalties reach REVENUE, are swapped, and are split by `split_revenue` (cbBTC only, SPEC 649) before trading opens. Purposes and Functions :482 states 85/15 on royalties.
- **Charter cost wording:** 2026-7 says the holder pays "the network fee". The non-refundable record rent (about 0.0018 SOL, SPEC 711-713) plus the asset rent is more than a fee.
- **Pin evidence location:** `update-web-hashes.mjs:33-34` records a review path outside the repo and appends the evidence line at the end of the README. Copy the review artifact into the repo, or record the absolute path.
- **Crons bypass the publisher's discipline:** `vault-index.mjs` and `public-data.mjs` execute the working tree, not a reviewed commit.

---

## Confirmed in the current code (no further action)

- **Publisher:** B1, B2 and B3 are fixed:
  - `--check` runs before relay config (`go-live.sh:14`), with `pm2 save` after publish (:44) and in rollback (:32).
  - The build goes into the stage, and BUILD.txt, staged bytes and pins are checked (`publish-ecosystem.sh:18-37`).
  - Ignored sources are refused (:13); `origin/v6` and the exact commit are required (:10,12).
  - L-a, L-d, L-e and L-f are fixed.
- **Purposes and Functions:**
  - §V/§VI activation request, distribution triggers, the first-tick and close+30/60 timing, permissionless claim, and the unarmed caller all match SPEC 650-695.
  - Forfeits are stated (:500); lending is marked unavailable (:590, :595-596); the boost burn is not revenue (:483, :513, :520).
- **Schedule:** cells default to "Not read". The census includes burned vaults that are still active. Per-$1,000 shares are withheld while `boosts_due` is set (:321). Weight and count are checked against the config (:317).
- **vault-index:** publishes only RULED dates (:165, :239) and refuses config drift (:199). The served JSON has `charter_opens_at: null` (D5(b) holds).

## Missing verification

- **No build or test was run.** The actual hashes at HEAD and the commit status of the corrections are unconfirmed. The publisher's own checks cover both.
- **Nobody has looked at the served bytes or CDN behaviour after publishing.** There is no Cloudflare purge.
  - Files are replaced one at a time (L-c). If the edge holds a cached `index.html` but not the matching new `app.js`, the browser's integrity check fails until the cache expires.
  - After publishing, curl the origin and the edge for every changed page, then purge.
- **Not inspected:** the nginx security headers (`frame-ancestors` cannot be set in a `<meta>` CSP).
- **No tests exist** for the vault-index RULED filter, the drift refusal, the Schedule census script, or the bare-burn path. `ecosystem.test.mjs:74-75` covers the desk's mismatch rules only.
