# Holder ballots and standard wallets: source checkpoint, October 12

Implementation: Bank `5b2dbfa` (UI implementation `ad5ef46`) (following `d691b17`, `7efd5b1`), Gary Club
integration branch `9bc60679` (fence implementation `efd1dc6d`) (following `71fbeee0`, `2642a91b`). These commits
are pushed. This is staged source, not a production release.

## Delivered in source

- Gary Club remains the default; visible external-wallet navigation on holder
  pages and governance discovers compatible Wallet Standard wallets. The
  ceremony's Phantom adapter is unchanged. External wallet mode survives vault
  lookup and the link to opening a vault.
- Every ballot starts unassigned. All Yes, All No, clear, or individual choices
  produce explicit, reviewed transactions of at most four vault votes. There is
  no unattended next-batch confirmation. Completed batches remain recorded if
  the holder stops; unsent choices survive returning from review in this page.
- Both signing paths share the same ownership, snapshot, deadline and prior-vote
  planner and key-change warning. Gary Club's approval binds every assignment.
  Live vote records are read before presenting choices, rather than relying on
  the delayed public return. Already-voted failures identify the vault.
- External signing saves a receipt before broadcasting, recovers after a reload,
  serializes sign/recovery with Web Locks, rebuilds just before signing and
  checks exact transaction effects. An unreadable receipt is displayed for
  recovery and never automatically discarded. Reconnect is available after an
  account change; the current Wallet Standard account object is used.
- The Gary migration reserves every affected asset within the intent database,
  across batch votes, legacy votes, openings and trades. Completion/failure
  releases the rows atomically; ambiguous sends retain them. A migration-specific
  RPC makes an unmigrated database refuse a batch before signing. These are
  submission concurrency controls; no on-chain asset/program was modified.
- The RPC proxy accepts the fee quote needed by external ballots, bounded to
  canonical legacy messages, confirmed commitment, size and existing Bank
  transaction policy. Its five added assertions bring it to 134/134.

## Review and verification

First-party Claude subscription only, never OpenRouter:
`BALLOT-REVIEW.md` found four Medium and five Low items; `BALLOT-RETRIAGE.md`
closes all nine and finds no source blockers. Its remaining concrete Low items
were addressed: public-address RPC substring filtering, immediate recovery
render, visible retained receipt, and stale eligibility response suppression.
`BALLOT-FINAL-ADDENDUM.md` independently finds no new blocker in those deltas.
Its small follow-ups are now handled: JSON-RPC provider failures still sanitize
to 503 (six regression cases); successful recovery clears the stale warning;
the reversed-ballot database test forces an overlap with a disposable trigger
and observes an actual lock waiter in pg_stat_activity. Those final small
follow-ups were tested after the addendum; they are not a new release approval.

Evidence in this directory:

- `ballot-records-browser.log`: 44 browser checks, including mobile/desktop,
  all/split ballots, consent, multiple batches, index lag, preserved choices,
  failed recovery, reconnect and the history register.
- `ballot-external-browser.log`: 13 checks, including two real browser tabs,
  receipt persistence, wallet refusal, fresh transaction build and both key
  change acknowledgments. Wallets and RPC responses are synthetic and no real
  transaction is broadcast.
- `ballot-unit.log`: 20 ballot, Wallet Standard and receipt tests.
- `ballot-engine.log`: 16 real-engine assertions, including mixed-batch effect
  binding and null single-asset representation.
- `ballot-gary.log`: 10 Node test groups pass, including 47 portal checks.
  Gary TypeScript check exits 0; log is empty, as expected on success.
- `ballot-db.log`: 15 real PostgreSQL checks in a disposable local database,
  using the actual production portal table definitions and service-role locks.
  Covers concurrent reversed ballots, vote/open/trade overlap, reconciliation,
  public-role denial, terminal release, backfill and whole-migration rollback.
- `ballot-club-controls.log`: the existing custody/trading browser regression
  checks pass, including interruption/recovery and separate capability switches.
- `ballot-offline-7efd5b1.log`: clean-commit-bound broader run. 1,000/1,018
  assertions pass, plus all 20 new Node cases. The only failing file is the
  existing fingerprint gate, with 18 deliberate mismatches. No pins were
  accepted, and this is explicitly not a passing release suite. Later source
  changes are confined to the tested recovery/eligibility UI and Gary test/error
  handling follow-ups.

Generated adapter SHA-256 verified directly against its committed checksum:
`f0f4c96f8d5e918088ced5de005597e94b8320313cfbd96f483407600f8c7ed7`.
Protected `programs/`, root release `dist/`, Anchor and Cargo files are unchanged.

## Release work still required

1. Apply/review the Gary migrations in order, including the ballot fence, and
   verify actual PostgREST error mapping and real-member integration before
   enabling holder actions. No production migration was applied in this batch.
2. Measure four-vault Phantom transactions with its real additions. Exact fee
   changes currently refuse and ask for another review; this deliberately does
   not authorize an unreviewed fee increase. Keep this as a release acceptance
   check, including repeated simulation fees.
3. Deploy the reviewed RPC proxy alongside holder pages; the old proxy does not
   serve the new fee method. Review the artifact and update pins through the
   normal process. No publication or live capability changes in this batch.
4. Finish private ceremony provenance/delivery, fresh independent read checks,
   owner-browser acceptance and Gary's own step-10 signatures. Friday lock still
   requires its independent R1 checks; these source tests do not satisfy them.
5. Continue governance proposal creation, trading acceptance and outstanding
   holder surfaces. Show a vault's already-cast votes in trade review. Prepare
   announcement and Phantom submission for owner review. No ruled policy
   question needs to be asked again.

Live read-only data timer remains active; latest checked run at 13:19:54 UTC
reported success/exit 0. The live website and Gary Club capability settings were
not changed by this source checkpoint.
