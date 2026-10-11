# Ecosystem audit remediation, October 11

Source: owner-supplied CBOB-AUDIT-2026-10-11.md, Parts A, B and C.

## Decision record

D5(b) RULED by Gary: "Do B and let's keep pushing."
Keep the condition: the live Metaplex Core build must be public, verified and diffed,
and the full suite must pass against its exact live bytes before the programs are locked.
Do not commit a permanent charter date while this is unmet. October 16/19 are unconfirmed
targets, not a launch commitment; revised dates require Gary's ruling.

D1-D4 and D6-D13 remain OPEN. Preserve the already-directed Gary Club-first experience.
Preparation, tests and drafts continue. No unilateral custody policy, royalty, DNS,
cron arming, announcement, signing, lock, or date decision follows from D5(b).

## Work order and current status

1. G-A1 issuance retries and confirmation expiry: audited, migrated and deployed; actions remain OFF.
   A8 read-triggered rebroadcast removed; recovery stays with timer and explicit status.
2. A6/G-C7 publishing protection and committed go-live replacement: underway.
   Legacy cron removal remains D9; guarding the destructive old entrypoint is a code fix.
3. Monday holder blockers: A1 pending D1; B1-B4/G-C1 copy/media corrections; G-B1
   charter desk; G-B8 holder-guide draft; G-B2 announcement draft pending D8 and dates.
4. Trading: A2, G-A2, G-A3, G-C6, G-B3/G-B4/G-B5, then first-party Claude audit/triage.
5. Governance creation/execution G-B6, with D11 proposal terms left for Gary.
6. Remaining A/B fixes, C1-C10 and G-B7/G-B9/G-B11/G-B12, then visual checks.

No item is considered complete merely because code was written. Validation, required
Claude reviews, migration/deployment and served-byte checks will be recorded here.
Frozen programs, release binaries and build manifests stay unchanged.

## October 11 repair batch

- G-A1/A8: Gary Club commit 9776e376, compatibility follow-up 1e15df00.
  Deployed build e9qDilNBD6TRAoXOYDEU4, followed by Austin-time adapter 13f2e1b6 / ycyfKqOsIeeT_F-e-bS47. Migration applied with zero active issuance
  rows. Three guard RPCs resolve for service_role over HTTP and refuse anon;
  database grants also refuse authenticated. Fourteen real PostgreSQL checks,
  29 portal assertions and all nine Gary Club test groups passed. Actions stay OFF.
- B17: v=2 session discovery returns 200 signedIn:false. Old clients retain 401,
  so already-open pages cannot mistake a signed-out response for a wallet.
- G-C7: committed retirement stub c7bf967 installed at both legacy entrypoints.
  Original scripts and metadata retained privately at
  /var/backups/cbob-retired-publishers/20261011-8_whwo3n. Both refuse with exit 1.
  No cron was removed or armed.
- Public correction batch: B1/B3/B4/B7/B9/B11/B14/B18/B19/B21/B23/B27/B29/B30/B32/B33,
  part of B8/B12/B15/B22/B37 and G-C1 prepared. Seven film targets return 200;
  all seven original numbered statement bodies compare equal to 1ddbb43.
  The desk has dates/count/countdown handling, not yet the full public eligibility
  checker. Numbered statements 2026-3, 2026-5 and 2026-7 get dated corrections, including their feed descriptions.
- A6/A10 publishing work: committed-only stage, review-linked pins, strict table
  parsing, CSP hashes on static documents, exact backups and restore. Go-live is
  a staged future procedure; it has not configured or exposed the relay.
- Browser checks at 375 and 1440 pixels: no runtime exceptions or horizontal
  overflow. Targeted flows also checked signed-out v2, invalid lookup before
  initialization status, and census execution under CSP.

## Explicitly not closed

This batch does not finish the owner audit. A1/D1 custody alternatives, A2 order
state, A4 self-custody voting, A5 service isolation, A7 ceremony teardown, A9 live
vote round-trip, A11 cron argv, B5 market preopening redesign, B6 burn-count proof,
B13 common navigation, B16 Cloudflare injection, and the remaining visual polish
still need work. Static script CSP is present; server framing headers and the
Cloudflare injection decision are separate.

Trading remains OFF: G-A2 opening consent sets, G-A3 expiry/funding, G-C6 linked
wallet self-offers, G-B3 public offers/sales, G-B4 inbox, G-B5 transfers all remain.
The additional Claude findings H1 (split switches, D6) and H2 (separate holder
actions and immediate post-claim vault link) block holder enablement.
G-B6 proposal creation/execution, the C1-C10 reference pages, and the remaining
milestone/activity views are not complete. No launch readiness is claimed.

The charter desk and the census fail closed when current state cannot be
verified. The register refuses a changed MintConfig during its read. This is
not a historical per-settlement census; that claim was removed from current
copy and corrected above the archived statement.

DRAFTS.md contains the announcement and guide amendments for Gary's eventual
approval. Neither was published or sent. Any date promise remains blocked by D5(b).

## Correction triage follow-up

R2/R3: dated notices correct archived claimless-delivery and unactivated-empty claims; original bodies retained. R4: remaining automation claims corrected. JSON-LD revision dates updated. Charter status now refuses older or malformed indexes missing initialization and claim-counter fields. Feed GUIDs and issue dates stay unchanged; a new announcement remains subject to approval.

R1 remains a publish gate: commit the full source, then obtain a first-party Claude review of every web/src change since served source 1ddbb43, independent triage, and explicit review-linked bundle pins before publishing. D3 financial wording remains pending Gary approval.

## Application review follow-up

Full application review of 1ddbb43 to 61a4cf6 found no new publication blocker with actions closed. Its N1-N3/N6 follow-ups now reject malformed charter windows, missing schema fields, null vault entries and malformed session replies; persistent link nodes preserve keyboard focus during refresh. The desk reads the actual on-chain close time rather than manufacturing it from an interval. N4/N5 wording inconsistencies are corrected; account copy explicitly says trading is closed. The optional plan-vault automatic-draw wording remains a deferred pre-enable issue, because changing its shared planner also requires a coordinated Gary engine rebuild. Fifty-six ecosystem checks pass, including ten new malformed-index and session regression cases. Independent triage must review this follow-up before accepting pins.

## Owner triage correction pass

See TRIAGE-HANDOFF.md for findings 1-13 and the chain-backed historical burn census. This supersedes the earlier B2/B3/B8/B9 status: buy-page B2 is now corrected; D3 P&F wording remains pending. B3 notices, B8 statement 2026-2 and B9 index wording are corrected. No website publication or Gary deployment will run before the owner-arranged Claude re-triage.
