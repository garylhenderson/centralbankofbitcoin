No blocking issues found. I'm approving the source and the BUILD.txt fingerprints below for publication while actions stay off. This is not live, signing or financial acceptance.

Reviewed source commit: `79f179060e54d6a350ef4a27f8d240225a1ab899`
Pin acceptance: APPROVED for `79f179060e54d6a350ef4a27f8d240225a1ab899`

## What this approval covers and what it doesn't

- It covers the holder-page source at the commit above and the `app.js` and `assets/style.css` hashes as recorded in the two BUILD.txt files. I read those hashes; I did not calculate any of them.
- I ran nothing: no git, no tests, no builds, no hashing. Every pass count below comes from your logs.
- `/opt/cbob-vaults/.git/HEAD` points to `refs/heads/v6`, which holds `79f1790…`. I could not check that the working tree is clean. Both BUILD.txt files show no "uncommitted changes" marker and no overrides, but that marker only covers `web/`.
- It does not cover the ceremony, the Gary Club adapter, the database migrations, turning holder or trading actions on, or the Friday lock.

## Artifact identities reviewed

**BUILD.txt for both profiles.** Each names commit `79f1790…` and records collection as TODO. The mainnet RPC is `https://centralbankofbitcoin.com/rpc`; mainnet-local uses `same-origin:/rpc`. Both build logs list the same hashes as their BUILD.txt.

**Input manifests.** `release-mainnet-inputs.json` and `release-mainnet-local-inputs.json` are identical. Both record node v20.20.2, esbuild 0.25.0 and snapshot `8b6263c3…0038e94`, which matches `snapshot_sha256` in `launch/build-dependency-lock.json`.

**Fingerprints being accepted.** These are the 16 rows that currently fail the README check:

| file | mainnet | mainnet-local |
|---|---|---|
| account/app.js | `f50e0ae5…c19b` | `f50e0ae5…c19b` |
| assets/style.css | `72bb0d57…e78d` | `72bb0d57…e78d` |
| buy/app.js | `14aac298…a0` | `6f04ab17…786` |
| claim/app.js | `7e227528…d5` | `ac1ccc06…dd5` |
| governance/app.js | `fd119c29…7559` | `ed6deb84…97a0` |
| market/app.js | `3177bf24…9442` | `8faf4e1a…738f` |
| redeem/app.js | `8f77c7aa…98ba` | `c8ce8540…67f3` |
| vault/app.js | `56515b7f…c806` | `e4077bc1…fb3b` |

**Rows that don't change.** `history/app.js` (`0eaaa91c…`) and both ceremony `app.js` files (`6f3734b0…`, `9e58b83c…`) already match the README.

**Where the current README pins come from.** They are exactly the `a9dcaca` artifact's build, as recorded in `launch/ceremony-artifact.json`. So the 16 failures are pure staleness, not drift.

## What I checked

**The source changes (`release-source-diff.patch`, d6f1ef0 to 79f1790).** I read every bundled `web/src` change:
- `club-actions`, `external-proposal`, `governance-view`, `proposal-desk`, `sale-proposal`, `trade-state`
- `account.mjs`, `governance.mjs`, `style.css`
- the `go-live.sh` and README hunks

**The proposal code against the frozen GOV program (`cbob-vault-gov/src/lib.rs`):**
- The new `create_proposal` and `execute_proposal` instructions use the same field order and account order as the program (`:301-325`, `:746`, `:826-880`).
- The client's limits match the program's: a 21,000-sat price floor, sales of at most 365 days, voting of at most 30 days, and a 7-day execution window.
- The client's predicted outcomes follow the program's skip rules (`:515-588`), including that a sale which has already closed still supersedes older rounds.

**Actions refuse with collection TODO:**
- On-chain proposal planning throws without a collection.
- The Gary Club paths are gated by `holderActionsEnabled` and `tradingEnabled`.
- The "Review offer" button appears only when trading is on.

**The generated files:**
- Each bundle has its own profile baked in (`ACTIVE_PROFILE` is `"mainnet"` or `"mainnet-local"`), and the overrides are `{}`.
- Test wallets are refused on mainnet. The only localhost references are the embedded localnet profile and a default inside a dependency.
- The CSP allows the page's own origin plus the RPC origin only.
- The `?v=` values in the HTML match the BUILD.txt hash prefixes.
- Searching the bundles finds the new refusal strings.
- The `../gary-club/node_modules` labels are deliberate: `normalizeBuildLabels` and `dependencyRoots` in `build-dependencies.mjs` produce them.

**Publication path:**
- `publish-ecosystem.sh` copies only the nine holder sections. It skips `ceremony-*`, so the ceremony is excluded as you said.
- `update-web-hashes.mjs` exits 1 on a pin mismatch unless run with `--accept-reviewed`.
- `pin-review.mjs` requires exactly one `Pin acceptance` line, so this report contains it only once.

**Prior reviews:**
- `final-source-review`, `settlement-delta-review`, `trade-vote-review` and `trade-vote-triage` all still hold.
- Every bundled file those reviews cited still contains what they described, at the cited lines.
- `TRADE-VOTES-STATUS.md` and `CHECKPOINT.md` match.

**Logs:**
- `vote-trade-offline.log` adds up to 1137/1153, with all 34 Node cases passing. The only failing file is `bundle.test.mjs`, and its 16 failures are exactly the README pin rows. **This is not a passing release suite.**
- `bank-offline.log` is an older run at 1117/1133.

## Launch documents

Both drafts are factually correct as far as I can check.

**`ANNOUNCEMENT-DRAFTS-2026-10-13.md`:**
- `charter_opens_at` 1792429200 is Oct 19 at noon CDT. Adding `charter_secs` (604800) gives Oct 26 at noon.
- `lock_deadline` 1792170000 is Oct 16 at noon.
- The +30 and +60 day marks ("around Nov 25 / Dec 25") are right. DST ends Nov 1, so they fall at 11:00 CST.
- The 21,000-sat activation deposit, the 100 $GARY payout trigger and the 2.1%-per-hour opening limit match `HOLDER-GUIDE.md`, `mainnet-init.json` and MINT.
- The voting language matches D1 and GOV.

**`OWNER-SIGNING-CHECKLIST-2026-10-13.md`:**
- The artifact `a9dcaca` / `d1b17742…` matches `ceremony-owner-verification.json`.
- Four `initialize` programs is correct: SWEEP has none.
- `verify-ceremony.mjs --after` exists.
- The 24-hour certification window matches PRELOCK-R1.

**Royalty wording.** The client's "85% to activated vaults / 15% to treasury" text for royalties and sale-round prices matches D13 and MINT's `split_revenue`.

## Minor items (no change needed for this approval)

1. `club-actions.mjs` hard-codes the three reserve mints in `knownTokens` and uses `makeIds(PROFILES.mainnet).REVENUE` instead of the active profile. Both are correct for these two profiles, but they duplicate config.
2. `external-proposal.mjs` shows the SOL estimate as an unrounded decimal. This is cosmetic.
3. The ceremony `index.html` hashes differ from the a9dcaca artifact because the CSS hash changed. The ceremony `app.js` is unchanged. That difference is why the installed artifact must not be rebuilt from this commit.

## Remaining gates, separate from this approval

1. **Pin recording.** `update-web-hashes.mjs --accept-reviewed` writes pins from its own new build. Confirm that the 16 rows it writes equal the BUILD.txt values above. If any differ, this approval does not cover them.
2. **Gary Club adapter.** The audit directory's `club-engine.cjs.sha256` is `1182baf2…`, the older CHECKPOINT value. `TRADE-VOTES-STATUS.md` records `887272c6…`. The adapter for a0dd566d needs a fresh rebuild and hash match before deployment.
3. **Database.** The ballot default-grant repair and live permission checks are pending, and the order-notice migration is pending.
4. **Legacy orders.** Zero live orders was proven now. Run a fresh zero-legacy-order check right before trading rollout.
5. **Ceremony.** It stays owner-signed from installed artifact `a9dcaca`. Holder publication does not replace it.
6. **Live acceptance.** Real members, wallets, fees and RLS still need testing before either action switch is turned on.
7. **Friday lock.** It still depends on a witnessed full-suite run against live Core within the preceding 24 hours.
8. **Announcements.** The owner must approve the exact wording before anything is sent.
