# Tuesday rehearsal and operational closure

Deployed operational source: `0d991b394df1637f4fe1c28ffffed8ce425759e1`.
The reviewed changes were committed, pushed and fast-forwarded into v6 before
installation. The public-data job and legacy Notice caller use that exact
immutable worktree. The existing feature pages and Gary application remain at
the releases recorded in FEATURES-PUBLICATION.md. No page bundle, published
fingerprint, program source, root dist binary, charter value or ceremony artifact
was changed by this batch.

## Full rehearsal passed

From clean, pushed source `92197156129c22dfc9fd3cb4b2236049a5765896`, before
integrating the operations changes:

- Canonical full suite, including all 913 program assertions and the 16-case
  real-pool swap fork. All prerequisite checks/floors passed with CBOB_SHIP_GATE=1.
- Test Vault simulation: 71/71.
- Holder end-to-end: 160/160, including the Phantom-like signer, real Lighthouse
  checks and actual local-validator instructions. This is not acceptance in a
  real holder's Brave/Phantom session.
- Two-provider program observations before/after, archive sealing and final
  rehearsal verification all passed. No network gate was skipped.

Root archive: `/var/lib/cbob-prelock-rehearse/run-KtvBwhuu`.
Evidence digest:
`02ce152d1e503e75675c933b2a66980ee4c11c15789c1ec08bc7ec7e1dc8d3e7`.
The run lasted about 63 minutes. It is expressly REHEARSAL ONLY and cannot
authorize Friday's lock. The new operations code was tested separately below;
do not attribute this program rehearsal to the later operations commit.

## A5: two background jobs isolated

The public producer now runs as cbob-data and financial recovery as
cbob-reconcile. Their namespaces hide the application's real environment and
sibling Bank/Gary/cache/backup/ceremony files. Each gets only its scoped
credentials and required source/dependencies. Both have no extra groups, no new
privileges, read-only filesystems with narrow write exceptions and IPv4/IPv6
instance-metadata denial. The producer still has its documented broad database
service credential; no narrower database role is claimed.

Existing state was copied under the original producer lock. Its inode is
unchanged. The real Gary environment is byte-identical. Both ordinary services
succeeded and both existing timers resumed. No new timer was enabled. A second
pin operation exercised the future publisher's first refresh through the actual
named transient, real production mounts and restricted identity; it passed.

20 live checks pass: actual effective identities/hardening, both metadata denies,
healthy jobs/timers, limited private credential names, fresh vault/governance/
market feeds, original environment and lock preservation, both running financial
switches off and signing access closed. Effective bind paths and drop-in sets
were independently read back and match the intended templates.

Operator tests: 9 isolation groups, 17 existing deployment checks, 28 producer
Node cases, 13 public-service plus 11 reconciliation namespace checks, unchanged
host credential fixture, and real transient timeout/descendant cleanup. The
fixtures deliberately make sibling secrets world-readable and prove they remain
hidden. The final shutdown branch refuses predecessor restoration if termination
cannot be verified. Failed installer rollback leaves schedules paused.

Migration receipt: `/var/backups/cbob-job-isolation/migration-vgso22jf/receipt.json`.
Initial source-pin restore point: `/var/backups/cbob-public-data/source-5lpgkh4d`.
Restricted first-refresh restore point: `/var/backups/cbob-public-data/source-qosilqng`.
Operational and credential-rotation instructions: launch/JOB-ISOLATION.md.

## A11 and D9: legacy scheduler cleanup

Removed the one daily job targeting the deleted v5 bank/distribute.mjs. Kept
the older Notice reconciliation at the same hourly minute and same localhost
POST route, with its credential now read internally by a pinned Node caller.
No credential is placed in curl argv. Every unrelated crontab line is preserved;
before/after private copies and exact read-back are retained. The migration did
not invoke that endpoint or send a test message. A read-only HEAD returned 405;
3 mocked Node tests and 3 Python transformation groups passed.

Private receipt:
`/home/ubuntu/cbob-ecosystem-audit/2026-10-13/legacy-crons-nxksrx08/receipt.json`.
The Notice job retains its existing ubuntu/configuration scope; it is distinct
from A5's financial-recovery service. The payout crank remains unarmed, and no
revenue/crank entry has --live. Keep the immutable caller worktree while that
cron references it. See launch/LEGACY-CRON-CLEANUP.md.

## Reviews and remaining gates

Five first-party Claude Sonnet 5.5 subscription sessions reviewed these two
batches and their corrections. Fresh Max authentication and disabled paid extra
usage were required before every run; API-key source none, MCP empty, no
OpenRouter or paid fallback. Original reports and sanitized provenance are
adjacent. Reviews were static; execution/hash/host evidence is the operator's.

The Core watcher remains scheduled, recent and at unreadable streak zero, with
the expected live Core hash. Holder actions and trading remain off separately.
Owner signing, immediate independent initialization read-back, collection
propagation/relay installation, real member/wallet acceptance and release
approvals remain necessary. Real mainnet charter claims cannot precede October
19 noon Austin. Exact announcement copy still awaits the owner. Friday's lock
requires the separately witnessed full certification after Thursday noon Austin,
an externally recorded digest and explicit authority-removal approval.

The concrete handoff is launch/RELEASE-ACCEPTANCE.md and the existing owner
signing checklist. No signing session, program lock or public announcement was
performed by this operational closure.
