# Public marketplace publication, 2026-10-13

Published source: `7fd14754a9a666ea74c0d00747af3fa492102444`.
Reviewed application source: `c04299dc235b14a4162e5f6cfb232a7235750a66`.
Review record: `810abb7`; accepted-fingerprint commit: `7fd1475`.

The Market now has a public For sale tab, exact SOL asking prices separate from
reserve values, price sorting, level floors, current funded-offer counts, recent
sales, and receipts in each vault detail. Sales cover up to 200 recent Gary Club
receipts, explicitly not all-time volume or sales elsewhere. No wallets, account
identities or private order identifiers enter the feed. Public transaction links
necessarily expose the underlying on-chain parties. Settlement remains in the
existing authenticated, freshly reviewed trading panel.

The initial Opus review refused unfunded offer counts. The correction uses Gary
Club's exact balance/rent check and marks failed funding reads unavailable.
Receipt times are finalized, fairly retried and cached. Database asks survive
RPC/cache outages. All three review reports are preserved alongside this file.
The user requested a different model during review; both subsequent reviews used
Claude Sonnet 5.5 with first-party Max authentication, extra usage disabled,
apiKeySource none and no MCP servers. No OpenRouter or paid Claude fallback.

Verification:

- 1,153 offline assertions across 21 files plus 61 exact-count Node cases pass.
- 27 market cases cover privacy, prices, expiry, pagination, the full publisher,
  finalized receipts, budget/cache rotation, database/RPC outages, host allowlist,
  unfunded bids, 401-wallet batching and cache-write failure.
- 16 built-page fixture browser checks pass at 375px and 1440px. Isolated context;
  all remote calls and mutations blocked, no wallet signatures or real accounts.
- All 20 accepted executable/style fingerprints were independently SHA256 checked
  against the exact frozen files read by Sonnet. Its file-only review did not
  recompute hashes; our fresh suite and independent check supply that evidence.
- Publication preflight passed on the clean pushed commit. 39 files published
  and byte-checked; first public-data refresh passed immediately after deployment.
- 13 live checks pass: public JS/CSS bytes, origin HTML, public markup, fresh
  market JSON, privacy projection, data/reconcile health, timer, online Gary app,
  both switches off in configuration and running PM2 process.

Page restore point:
`/var/backups/cbob-ecosystem/20261013T151435-cbob-publish.Tys9FLW2`.
Public-data unit restore point:
`/var/backups/cbob-public-data/source-f4_0cbqj`.
The read-only timer is pinned to the published commit, not the editing checkout.
No frozen programs, installed signing artifact, Gary application source, financial
switches or on-chain state changed. No holder notifications or announcements sent.
The final review's remote-ref observation preceded our successful push; the
publication script independently required remote ancestry before executing.

Remaining product work: offer-arrival email, guided vault moves into/out of Gary
Club, and publicly accessible current sale-round minted counts. Real-wallet
acceptance, owner signing, collection readback/rebuild, separate action releases,
and the witnessed exact-live-Core test within the 24-hour pre-lock window remain
launch gates. Signing time and exact announcement wording are still awaiting the
owner's answers. This publication is not a launch-gate certification.

Operational follow-ups: a restricted database read role; deliberately fail-closed
malformed order/receipt handling; cleanup of temporary cache files after a rename
failure. The bounded history is disclosed; extend indexing if a full historical
archive is needed after the recent-200 window fills. No background build or review
is left running at this handoff.
