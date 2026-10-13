**Verdict: no blockers. I'm approving the pin, with one limit: I couldn't recompute any sha256, so byte-level hash integrity of the frozen files is unverified.**

I reviewed with file tools only. Bash is disabled in this session. I ran no tests or builds, and the test results below are Codex's.

## What I verified
- **Source identity:** `/opt/cbob-vaults/.git/refs/heads/v6` is `79f079e2…`. Both `BUILD.txt` files name that commit.
- **Dependency lock:** node v20.20.2, esbuild 0.25.0 and the snapshot hash `8b6263…` match `launch/build-dependency-lock.json`. The browser package versions and integrities in `mainnet.inputs.json` match the lock where I compared them.
- **Frozen artifacts:**
  - The ceremony `app.js` is unchanged in both profiles (`6f3734b0…`, `9e58b83c…`).
  - The other 9 files per profile differ from the README table, which still holds the old pre-pin values.
  - `history/app.js` is identical in both profiles (`54342ca2…`), which fits an unchanged-by-profile bundle.
  - The new strings and flags (`offers_available`, `offersAvailable`, "funded standing offer", "finalized transaction") are present in the frozen bundles.
  - The `.experience .market-board h3` mobile selector fix is in both `style.css` files.
- **B1 (unfunded offers counted) is fixed.** The publisher matches Gary's rule in `portal-market.ts:52-93`:
  - **Rule:** `canFundOffer` is `balance === price || balance - price >= rent`, using `confirmed` commitment and treating a missing account as 0.
  - **Reads:** unique bidder wallets are read in batches of 100, at most 4 concurrent. Mainnet is checked first.
  - **Failure:** any failure sets `funding=null`, which publishes `offers_available:false` and no counts. Unknown is never shown as zero or as the raw total.
  - **UI:** `offer_count` has a single display path, and it is gated by `offersAvailable`. Stale data also clears the counts.
- **Earlier should-fix items:**
  - An RPC or genesis failure and a corrupt cache no longer throw, so database asks stay visible and sales are marked partial.
  - The v2 cache ignores the old confirmed-time cache, and receipt reads are `finalized`.
  - Receipts are sorted by last attempt, so unresolvable ones can't starve the rest. The cap is 24 new reads per run.
  - The credential is sent only to the allowlisted database hosts, with `redirect:'error'`, and the header comment is corrected.
- **No new write or signing path:** the publisher makes only GET requests and the RPC reads `getGenesisHash`, `getMinimumBalanceForRentExemption`, `getMultipleAccounts` and `getTransaction`. It writes two local files atomically. The browser makes one GET.
- **Switches and programs:** the trading flag only changes a label, and the diff touches no program or signing artifact.

## Non-blocking issues
1. **Deploy order matters.** The new `marketBook` rejects a `market.json` that lacks the boolean `offers_available`. If the site goes live before the publisher's next run, the whole book shows "Market data unavailable" for up to ~10 minutes. Run the publisher right after deploy.
2. **Cache write blocks the public file.** `market-index.mjs:145` writes the cache before `market.json`. A failing cache write would leave `market.json` stale, which cuts against the "cache failure can't hide asks" intent. Swap the order or wrap the cache write.
3. **A malformed signature stops the whole run.** This predates the batch. A bad `signature` on any receipt (`:134`) or a bad order record throws, so the previous file is kept until it goes stale at 30 minutes.
4. **A bad bidder wallet hides all counts.** The publisher fails safe, but it hides every count, not just that bidder's.
5. **Test gap:** `readOfferFunding` is tested only with a single batch. More than 100 wallets, the 4-batch grouping and partial-batch failure are untested. I read the loop and the slicing is correct.
6. **New sales rotate late.** A just-finalized receipt that was attempted too early waits behind older attempt stamps. With many permanently unresolvable receipts, that could take a few runs. It is labeled partial.
7. **Cosmetic and longer term:** `confirmedSaleTime` now returns finalized times, so the name is stale. The publisher still holds the service-role key, and a restricted role or view would be better later.

## Before the pin takes effect
Rerun the full suite after the README pin table is updated from `BUILD.txt`. That run is the only check that the on-disk bundles and source blobs match the recorded hashes, because I did not verify them.

Reviewed source commit: `79f079e2ac4f5aa1b5ebce0c7338bbca3efd4585`
Pin acceptance: APPROVED for `79f079e2ac4f5aa1b5ebce0c7338bbca3efd4585`
