# Ecosystem experience redesign, 2026-10-11

The market now leads with the five existing vault designs at full resolution, an
interactive level showcase, the public collection, a state-driven Chairman dispatch
and Bank figures. The account page presents the Gary Club wallet and owned vaults as
one personal desk. Claim, buy, open and lookup use the same navigation and typography.

Interaction additions: saved public vaults on the visitor's device, gallery/list views,
share links, downloadable public-record PNGs, clearly marked design specimens, and an
illustrative payout-weight explorer. The illustration uses one earning vault per level,
no boosts, and weights 2 + 3 + 4 + 5 + 6. It is never presented as a live payout.

Financial actions still use the reviewed Gary Club panel. No transaction builder,
backend, launch value, cron schedule, Bank program or release binary changed.

## Validation

- 883 offline assertions across all thirteen page test files, including 111 bundle
  assertions. Bundle checks tie versioned script and stylesheet URLs to their actual
  hashes and SRI. Canonical metadata is not mistaken for an external stylesheet.
- 30 browser interaction assertions at 375px and 1440px: level selection, illustrative
  arithmetic, list/gallery, saved live and retired vaults, hindsight, wallet balances,
  owned vault cards, deep links, exports, reduced motion and overflow.
- 14 additional browser assertions: selector and refresh focus, persistent chart period
  and disclosures, exact 90/10 payment presentation, unchecked consent, a readable mobile
  review, preservation of an in-progress review across refresh, export snapshot time,
  preserved URL parameters, and unavailable/bare-burn exports that never assert zero
  released reserves. These are local fixtures, never public data or live transactions.
- Mobile checks of market, account, claim, buy, open and lookup: no page overflow,
  undersized primary controls or runtime exceptions. Exported PNGs visually inspected.
- First-party Claude review followed by a fresh independent Claude triage. No OpenRouter.
  Triage found no blocking defects after repairs. Remaining history/focus/copy/cache-test
  observations were also addressed. Physical iOS/Android and screen-reader operation
  have not been tested; Chrome desktop and emulated mobile were used.

## Repairs from review

Unavailable opening records and bare burns export explicit labels without invented
zero payouts. Snapshot timestamps are captured with the vault. Refreshes retain good
history, reject older snapshots, preserve focus/disclosures/chart choices and leave
transaction review alone. Delayed-data notices stay visible. Lookup ownership is
separate from account ownership. The static showcase works even if the index is down.

PNG exports contain public vault records only, never account names, wallet balances
or private orders. Specimens explicitly state that they are not issued vaults.
