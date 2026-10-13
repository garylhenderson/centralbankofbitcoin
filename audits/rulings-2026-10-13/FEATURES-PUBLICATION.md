# All three launch features published, October 13

The owner requested all three remaining product features. They are built, reviewed,
committed, pushed and deployed with holder actions and trading still OFF.

- Public sale-round panel on Market and Buy: voted price, dates, minted count and
  remaining capacity before login. Current live state correctly says the Bank has
  not initialized; no round or date is invented.
- Guided whole-vault transfers on Your desk: Gary Club outbound review and external
  wallet inbound signing, full destination and known reserves, explicit consent,
  fresh ownership checks and saved transaction recovery. A whole-vault move does
  not open the vault, collect a sale price or reset its votes. Receipt checks stay
  available with actions off. The RPC proxy remains staged pending the ceremony's
  actual collection configuration, as required by the launch sequence.
- Offer-arrival emails: private durable forward-only queue, verified inbox and
  current order/owner/funding checks, account opt-out, mute/suppression handling,
  bounded work and no automatic resend after uncertain submission. Default-on
  transactional notices implement the requested feature; the holder can opt out.
  Existing offers retargeted to a verified new owner can produce a new notice.
  No emails can run while the trading switch is off.

## Exact release

Bank reviewed source `a68fff57c7a74d5b6009d03cb2458e6b8830badd`.
Bank published/pinned data source `ca4294abf82493a1eac3253b28204946fa0949a8`.
Gary deployed source `8343e5373df01dfe5ca81c9b25c31416f321a435`.
Gary production build `fv6ZsFC5qAej3IOeOjcC0`.

Claude Sonnet 5.5 independently reviewed the initial batch and corrections through
first-party Max subscription authentication, API-key source none, with paid extra
usage disabled and no MCP providers. No OpenRouter or paid fallback was used.
The final review is FEATURES-FINAL-TRIAGE.md. Reviews are static; all test execution
and hash comparison evidence is explicitly attributed to Codex/operator checks.

All 20 accepted bundle pins match the frozen reviewed artifacts. The installed
ceremony JavaScript remains byte-identical. Shipping programs and frozen program
bytes are unchanged. The fresh generated server adapter matches its committed
SHA256. Only the exact offer-email migration was applied, once, with a durable
receipt; catalog sources, RLS, narrow grants, trigger and unchanged existing
fencing functions were verified. Queue empty, no synthetic user or live email.
The only nginx change adds email-preferences to the existing same-origin allowlist;
syntax and reload passed. Other sessions' preexisting production patches remained
byte-identical. New unrelated Luna changes made during the build were not shipped.

## Validation

- Bank: 1,153 offline assertions in 21 files plus 87 Node cases, all passing after
  reviewed pins were accepted.
- Gary: 29 top-level checks including 97 portal checks, 17 offer-mail cases and
  two shared transport timeout cases; TypeScript clean. Clean production build
  succeeded before the atomic swap and PM2 reload.
- Ten disposable PostgreSQL email groups pass, including privileges, concurrent
  claims, expiring leases and the non-retryable sending fence.
- Fifteen isolated built-page checks pass at 375 and 1440 pixels. Existing public
  marketplace browser regression also passes. These fixtures never sign or mail.
- 23 live checks pass: public bytes/HTML match, sale-round state is explicit,
  fresh vault/market returns, private preference route requires a session and is
  not cacheable, live recovery contains the disabled email worker, both timers
  healthy, and both switches off in file and running process.

Public backup: `/var/backups/cbob-ecosystem/20261013T160834-cbob-publish.8E23H0JX`.
Public-data unit backup: `/var/backups/cbob-public-data/source-xfoplokx`.
Private migration/review/operational receipts:
`/home/ubuntu/cbob-ecosystem-audit/2026-10-13/`.
Machine-readable results are features-release-evidence.json and
features-live-verification.json beside this file.

## Remaining launch gates

Owner signing/initialization and collection propagation, real-wallet acceptance,
and explicit holder/trading release remain outstanding. Friday's irreversible
program lock still requires a passing full suite against Metaplex's exact live
Core code in the preceding 24 hours. This release does not satisfy or bypass
that certification and does not activate the immutable signing page.

The email pass gets at most 20 seconds within the route's 45-second allowance;
the external recovery caller times out at 55 seconds. An accepted send whose
terminal DB write times out is conservatively unknown and never retried. A
suppression timeout can therefore miss an email; the private notice is durable.
