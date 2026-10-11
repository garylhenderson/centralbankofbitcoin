**Audit report: retriage time-label delta (f179e71..6b383dd), plus the Gary adapter formatter**

**Verdict: PASS. No blockers.** You can include this delta with the approved bundle once the bundle pin is re-taken (see the second missing check below).

**Syntax and precedence (all 12 edits checked)**
- **Template literals:** in `account.mjs:55-56`, `claim.mjs:77`, `market.mjs:37,72,108,119,196`, `+ ' Austin time'` sits inside `${…}`. The whole interpolation evaluates to a string, so the output is correct.
- **Ternaries:** in `history.mjs:8` and `market.mjs:45`, `+` binds tighter than `?:`. The suffix attaches only to the Chicago branch. `'Time unavailable'` and the `(UTC day)` branch are unchanged, which is correct.
- **Arrow functions:** in `governance-view.mjs:3` and `plan-get.mjs:21`, the expression body concatenates as intended.
- **Options objects:** removing `timeZoneName:'short'` leaves valid options. The `market.mjs:119` `toLocaleTimeString` with `{hour, minute, timeZone}` is still valid.

**Truth of labels**
- Austin is in America/Chicago, and the conversion is kept everywhere, so "Austin time" is accurate in both CDT and CST.
- The UTC-day chart stamp (`market.mjs:45`) is unchanged and still accurate for UTC-day aggregation.
- The output matches the existing Austin-time strings in `plan-redeem.mjs:302`, `exhibition.mjs`, `record-card.mjs` and `charter-status.mjs`. Formatting is consistent, apart from charter-status using dateStyle/timeStyle, which was already the case.

**Signing logic: none changed**
- The only server-reachable edit is `plan-get.mjs` `when`, used solely in the `refuse.push(...)` messages at lines 49, 50, 88 and 89.
- The comparisons (`now < BigInt(c.charter_opens_at)` etc.) are untouched. No instruction, account, amount or signature input is affected.
- In the Gary adapter, `generated/club-engine.cjs:1339` and `:1898` hold the matching formatter strings and nothing else that I found.
- I found no tests or code that match on a "CDT"/"CST" string. The remaining CDT hits are static historical statement pages (`web/site/statements/*`), which are correct for their August/October dates and outside this delta.

**Non-blocking note**
- Dropping the zone abbreviation means one local hour per year is ambiguous. On 2026-11-01, 1:00-1:59 AM happens twice, and "CDT" vs "CST" used to tell them apart. This only matters if a charter or sale `closes_at` deadline falls in that hour.
- Optional fix: add `timeZoneName:'short'` back alongside the "Austin time" suffix just for deadline formatters (`plan-get when`, `governance-view date`, `claim.mjs:77`), or check that no configured deadline falls in that window.

**Missing verification (needed before shipping)**
1. I did not see a byte-level diff of the regenerated `club-engine.cjs` against the previously approved bundle. Before re-pinning, confirm the only changes are the two formatter lines (1339, 1898), and that the committed bundle was built from `6b383dd` with no other changes in the working tree.
2. Any bundle hash pin now needs re-taking, because `club-engine.cjs` changed. The old pin must not validate the new file.
3. Do a quick render check on one page. Each label should print exactly one "Austin time" and must not also show a leftover "CDT/CST" next to it.
