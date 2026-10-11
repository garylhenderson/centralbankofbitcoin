# Independent audit: CBOB public remediation delta, 2026-10-11

**Scope read:** `STATUS.md`; `web/src/lib/{charter-status,ecosystem,club,club-actions}.mjs`; `web/src/pages/{claim,buy,redeem,vault,market,account}.mjs` and their HTML templates; `bank/vault-index.mjs`; `scripts/{prepare-static-pages,update-web-hashes}.mjs`; `web/site/{index,schedule-of-vaults,purposes-and-functions,statements/index,statements/cbob-2026-5,statements/cbob-2026-7}.html`; `web/site/assets/bank-home.js`; `web/build.mjs` (the CSP part); `web/README.md`; the relevant parts of `SPEC.md`; `bank/layout.mjs`; and `ecosystem.test.mjs`. I also checked the served copies in `/var/www/centralbankofbitcoin` and the `CBOB_PORTAL_ACTIONS_ENABLED` gate in `gary-club-cbob/src/lib/cbob/portal-market.ts`.

**Not done:** I ran no scripts, builds or tests, made no network calls and read no env files.

---

## High

**H1. One switch turns on both the holder actions and trading.**
- **Where:** `gary-club-cbob/src/lib/cbob/portal-market.ts:19,44,47,106,204`; `club-actions.mjs:138`.
- **Problem:** `CBOB_PORTAL_ACTIONS_ENABLED` gates all of these at once:
  - `order()` (standing listings and offers);
  - `prepareIntent()` for every action (`claim`, `buy`, `open`, `activate`, `draw`, `vote`, `buy_order`, `accept_offer`);
  - `confirmIntent()`;
  - the UI's `market.enabled`.
- **Failure path:** Turning on claims, activation and opening for Monday also turns on standing orders and settlement. STATUS item 4 says trading still waits on A2, G-A2, G-A3, G-C6, G-B3 to G-B5 and the audit/triage pass. Nothing in the server or the page can enable one without the other.
- **Fix:** Use two flags, one for holder actions (`claim`, `buy`, `open`, `activate`, `draw`, `vote`) and one for trading (`order`, `buy_order`, `accept_offer`). Check the action class in `prepareIntent`. Make `market.enabled` reflect trading only.

**H2. Activation and the level draw are hidden inside the trading panel, and the holder flow after a claim dead-ends.**
- **Where:** `club-actions.mjs:131-171` (Activate and Record level draw are appended only after `if (!market.enabled) return`, under "Trade this vault"); `vault.mjs:157-160` (club mode returns before the Phantom actions); `club-actions.mjs:65-73`.
- **The post-claim gap:** The `showOutcome` function at `club-actions.mjs:65-73` gives no asset address or link after a claim. A new vault is missing from `/data/vaults.json` for up to about 10 minutes, so neither `/market/` nor `/account/` can reach it.
- **Failure path:** If H1 is fixed by splitting the flags, activation and the draw disappear for club-custody holders. Even today they are only discoverable inside a panel that says "Trade this vault" and opens with trading terms.
- **Copy that over-promises:**
  - `plan-vault.mjs:67` says "The draw is recorded automatically, usually within minutes."
  - `claim.html:28` tells holders to "request activation".
  - The crank is installed DRY-RUN (SPEC control table) and STATUS says no cron is armed.
- **Fix:**
  - Add a separate "Vault actions" block (draw when the level is not drawn, activate or join), gated by the holder-actions flag.
  - Return the new asset from the claim/buy intent and link `/vault/?a=` from the outcome.
  - Make the "automatically" wording depend on the crank actually being armed.

**H3. Purposes and Functions still promises automatic, claimless payouts, under a "Revised 11 October 2026" banner.**
- **Where:** `purposes-and-functions/index.html:497-499` ("There is no claim process … no gas spent … flows into the vaults automatically … whether the member is watching"); also lines 537, 586 and 606.
- **What SPEC says instead (650-695, 793-823):**
  - A distribution runs only when a month has passed or someone burns 100 $GARY.
  - A vault joins only at the NEXT distribution.
  - Nothing can be credited before charter close + 30 days; the first free crediting is at close + 60 days.
  - Delivery is the permissionless `claim`, which the crank sends, and the crank is DRY-RUN.
  - The Bank's own redeem page offers "Run a payout (burns 100 $GARY)".
- **Also contradicted:** "no deadline after which your share quietly becomes someone else's" conflicts with:
  - the frozen-pool forfeit at redemption (SPEC 654, 702-709);
  - `retire_burned` returning a bare-burned vault's unclaimed share (SPEC 655).
- **Impact:** These are material misstatements about how and when holders get paid, and they sit in the document being presented as reconciled before the holder announcement (G-B2).
- **Fix:** Correct these passages, or add a dated correction like the 2026-5 one, stating the cadence, the first-credit timing, the delivery mechanism and the forfeiture cases.

**H4. Purposes and Functions contradicts its own "Lending is not available" banner and the opening limits.**
- **Where:** line 589 still lists "Borrow against the charter" as an available route; line 485 lists "The lending protocol, upon its opening".
- **Problem:** Line 586's new qualifier ("must be distinguished from proposals for future services") never says which of the listed routes are proposals.
- **Also inaccurate:** Figure 11's caption "standing exits available … at all times" (594-595) and "at every moment" (597) ignore two things the same document now states at line 547: the 2.1%-per-rolling-hour cap and the need for Gary Club to sign.
- **Fix:** Mark borrowing as not available, and qualify the exit wording.

## Medium

**M1. The census denominator and the register both treat boosts that are due as still active.**
- **Where:** `schedule-of-vaults/index.html:311-325`; `vault-index.mjs:207`; `market.mjs:148`.
- **Background:** A boost is due when `boost_end_epoch <= dist_epoch` (`reads.mjs:376-377`). `distribute` refuses until due boosts are expired (`BoostsExpireFirst`, SPEC 807).
- **Problem:** The "Standard-weight share per $1,000" column is computed against a denominator that no distribution can use. Due boosts still show "★ Boosted" with "until payout N", and N is a `dist_epoch` number holders never see. The page's one-line note does not change the numbers shown.
- **Fix:**
  - Have the index emit `boost.due`.
  - Show both the current denominator and the next-distribution denominator (current minus due boost weight).
  - Label due boosts "expiring, awaiting removal".
  - Fail closed unless the sum of boost weights equals `boost_weight_total`, and the due count equals `boosts_due`.

**M2. The index takes its records and its config at different moments.**
- **Where:** `vault-index.mjs:170` (records) vs `195-197` (re-read config); per-vault `owed_sats` at 206.
- **Failure path:**
  - A join, expiry, retirement or boost between the two reads makes the census "could not be verified" for that cycle.
  - A `claim` landing between the reads overstates that vault's published "also owed" amount: the new accumulator is paired with the old debt (`plan-redeem.mjs:49-54`).
- **Fix:** Read the config with its slot before and after the records, and retry on change (or use `minContextSlot`). Compute `owed_sats` only from data read at the same slot.

**M3. One bare burn of an activated vault breaks the public census until someone retires it.**
- **Where:** `vault-index.mjs:65` marks any burned asset 'opened'.
- **Failure path:** The record stays `active` and its weight stays in `total_active_weight` and `active_count` until `retire_burned` runs (SPEC 655). The check at schedule line 317 then fails on every run. Any holder can trigger this with a wallet's burn button.
- **Fix:** Count `active && !retired` records in the census whatever the asset state, and show them as "burned, awaiting retirement".

**M4. After initialization the desk can say "to be announced" while the chain has a permanent window.**
- **Where:** `vault-index.mjs:165` returns `collection: null` whenever the build-time `ids.COLL` is unset, even when `mintConfig` exists.
- **Failure path:** `charter-status.mjs:7` then publishes "No charter date has been written permanently." That is false once `initialize` has run, and the window may already be scheduled or open.
- **Fix:** When `mintConfig` exists, take the collection from `MintConfig.collection` (checked against the SEAL/BURN/GOV wiring), or report 'unavailable'. Never report 'waiting' in that case.

**M5. A planned charter date could be published before it is ruled (latent, D5(b)).**
- **Where:** `vault-index.mjs:94` and `165` publish `launch.charter_opens_at?.value` without checking its `status`. Today the value is `null`/OPEN.
- **Failure path:** Filling in a target date for rehearsal or planning would put an unruled date into public `/data/vaults.json`. The UI hides it before the collection exists (test at `ecosystem.test.mjs:70`), but the JSON is public.
- **Fix:** Before initialization, publish the date only when `status === 'RULED'`; after initialization, publish only from the chain.

**M6. "Published at every settlement" is not implemented.**
- **Where:** Schedule Sections IV and VI (line 275), and the 2026-5 body. The 2026-5 correction does not address it.
- **What exists:** A current read every 10 minutes. `history.json` keeps hourly `bank` totals but no per-level counts. SPEC 758 says "There is no on-chain count of ACTIVE vaults per level."
- **Fix:** Either publish a per-`dist_epoch` receipt (per-level counts plus the denominator, from the same slot), or change the copy to "current census, refreshed about every ten minutes".

**M7. The superseded 2026-5 wording is still served with no correction marker.**
- **Where:**
  - `statements/index.html:270` (lede);
  - the served `/statements/feed.xml:67,73`, which is not in `web/site` and so is unmanaged by the repo and by `prepare-static-pages`;
  - the 2026-5 JSON-LD `VideoObject.description` (line 23), which repeats "assigned at activation … may be raised", and the `NewsArticle`, which has no `dateModified`.
- **Note:** The body itself is correctly retained as issued.
- **Fix:** Add a "Corrected 11 October 2026" marker to the lede and the feed item, update the structured data, and put `feed.xml` under source control.

**M8. Activation semantics are wrong in Purposes and Functions.**
- **Where:** line 470 says an unactivated vault "contains nothing". Line 453 calls activation "the first deposit".
- **What SPEC says (650-652):** Activation is a threshold (at least 21,000 sats in the vault's own cbBTC account) plus a separate `activate` call, and the vault joins at the next distribution. An unactivated vault can hold any amount.
- **Fix:** Correct Purposes and Functions. `claim.html:28` already states this correctly.

**M9. "$CBOB fees are split 85/15" contradicts the boost design.**
- **Where:** Purposes and Functions lines 512 and 519.
- **Problem:** The only on-chain use of $CBOB, the boost, burns it (`cbob_burned_total`). It produces no fee revenue to split. The document is flagged as revised for "temporary payout weight", but Section VII was not reconciled.

**M10. `update-web-hashes.mjs` can pass without checking anything, and its check mode changes files.**
- If the README table format drifts, the regex at line 17 matches nothing, `previous === readme`, and it prints "Published hash pins match" with exit 0.
- Check mode rebuilds and deletes `web/dist` and `dist-mainnet-local` (`build.mjs:102`).
- `--accept-reviewed` does not refuse a dirty tree.
- The review artifact is only size-checked (≥100 bytes), and its hash is printed but not recorded.
- `index.html`, which carries the CSP, is not pinned.
- **Fix:** Assert the replaced row count, build into a temp directory, refuse dirty builds, write the review sha and commit into the README, and pin each page's `index.html`.

**M11. The static-page CSP is fragile, and a blocked census script looks like real data.**
- **Where:** `prepare-static-pages.mjs` and the schedule page.
- **Problems:**
  - The CSP is delivered only by `<meta>`, so `frame-ancestors` cannot apply; it must come from a server header, and I could not verify one.
  - The census cells default to "0"/"none" in the HTML (schedule line 275). If the inline script's hash goes stale after an edit without `--write`, CSP blocks the script silently and the page shows a believable all-zero census.
  - At line 20, the integrity rewrite assumes `integrity` comes after `href`/`src`; a different attribute order would produce a duplicate `integrity`.
- **Fix:** Default the cells to "Not read". Run the check against the served bytes. Consider moving the inline scripts to `/assets` with SRI.

## Low

- **L1. The charter desk never refreshes.** `charter-status.mjs:16-26` fetches once. After 30 minutes on the page it flips permanently to "temporarily unavailable", and the claimed count stays frozen at load time. The open/closed state uses the client clock, and the `Math.abs` check at line 5 turns any skew over 30 minutes into "unavailable". Fix: refetch inside the interval.
- **L2. The claim count is not checked against the chain.** `charter-status.mjs:6` counts records with `charter`. That is valid, because records are never closed (SPEC 711-717), and "of 240" matches SPEC 20/235. But `MintConfig.charter_claimed` (`layout.mjs:65`) is the authoritative counter and is not published. Publish it and fail closed on a mismatch.
- **L3. The charter desk appears on the buy and redeem pages** (`buy.html:22`, `redeem.html:22`). A "window is open" banner on the opening page is confusing.
- **L4. The club claim and buy forms ignore `actionsEnabled` and the charter state** (`club-actions.mjs:94-125`). Users can prepare an action and then hit a 409.
- **L5. Small document errors.**
  - Schedule Section IV cites "Section IX", which does not exist in the Schedule (it means Purposes and Functions §IX).
  - The JSON-LD `dateModified` values are stale: Schedule line 45 and Purposes and Functions line 61.
- **L6. Dust wording.** Schedule "holds nothing back against a later date" conflicts with SPEC 772-791: dust carries in the pool to the next distribution, and forfeits return to the pool.
- **L7. Trading is advertised while it is closed.** `index.html:7` ("List yours or make an offer") and `account.mjs:26` describe trading as available.
- **L8. Internal dates in the README.** `web/README.md:283-285` names October 16/19 noon targets. They are labelled as targets, but confirm the repo is not public, or remove them.

## Missing verification

- **The delta is not deployed.**
  - The served Purposes and Functions has no correction banner.
  - The served Schedule has no CSP meta and an older census script.
  - There is no served-byte or CSP-hash check yet.
- **Untested behaviour:** the Schedule census script (due boosts, snapshot mismatch, bare burn); `charterStatus` with a stale page or with `mintConfig` present but no collection; the post-claim path to draw and activate.
- **Not inspected:** nginx security headers, and whether any server CSP is at least as strict as the meta CSP.
- **Film links:** I did not fetch them. Statements 2026-5 and 2026-7 and the home page point at `cdn.gary.club/.../film-v1/film.mp4` and `poster.jpg`, which `media-src`/`img-src` allow. The 200 status relies on `/tmp/cbob-media-links.json`.
- **D5(b) check:** no permanent charter date appears on any public page in scope. The statements in scope contain no invented dates.
