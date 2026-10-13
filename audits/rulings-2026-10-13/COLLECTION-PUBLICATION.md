# Owner ceremony complete; collection integration live

Completed October 13, 2026. This supersedes earlier notes that step 10 and
collection propagation were still pending. Friday's program lock is not complete.

Gary personally created collection
`7gP5aFq3qZ2EdhHiZ9BZ79c3g92pGBvFFpxTdxZAHBKU` and signed every setup step.
Creation signature:
`55g4AML55z1Zm9urxJCzLJArjg3wvmvdetsiaH5TCWxHCDVVtAXRP6QQtAezUNJxasFmKwxdgrnpD8BKafcxzfx9`.
At 19:03:56 UTC the independent verifier passed all 40 checks, including
finalized agreement from two providers on the collection, SEAL, MINT, BURN, GOV,
token accounts and revenue funding. Complete evidence: ceremony-completed.json.
The charter opening is now permanently October 19 at noon Austin time, closing
October 26 at noon. Website edits cannot postpone it if Friday's lock fails.

Signing access closed at 19:04:30 UTC: service stopped, port 8790 closed,
runtime gate and authentication copy removed, exact refusal vhost and HTTPS 404.
The immutable owner-accepted a9dcaca artifact still matches its complete manifest.
The owner-requested signing-password reset was verified; its temporary plaintext
handoff copy was removed after completion. No credentials are in this record.

## Published release

Bank/public-data source: `14a0586d46a6f0b5f34082e8d97751480c17ec6f`.
Gary source and exact build ID: collection-release-evidence.json.
Gary build: `dvY6J1bM2S2ngavVmPX7O`.
The Bank profile, launch record, generated launch input, Gary adapter and public
RPC relay all use the verified collection. The relay now listens only on
127.0.0.1:8789 behind the reviewed same-origin route. Both Gary financial switches
remain off. External wallets remain subject to the programs' charter and sale-round
conditions; these Gary switches do not disable direct on-chain instructions.

The public feeds show initialized governance, the actual charter dates and zero
vaults, claims, proposals and votes. They do not invent activity. Collection and
vault metadata now state the same activation and payout timing as the holder
pages, the treasury split and the opening limitations. Claims still cannot happen
before October 19 noon Austin time. No announcement or member email was sent.

## Reviews and verification

All four reviews used first-party Claude Sonnet subscription authentication with
paid extra usage disabled. No OpenRouter or paid fallback was used. Static review
and operator-executed tests are recorded separately. The initial review caught an
uncommitted generated launch input; it was committed and both profiles rebuilt
before approval. Old test assumptions that the collection remains null were
replaced by explicit negative fixtures without lowering assertion floors.

The first relay attempt safely rolled back because PM2's ESM import wrapper
bypassed the proxy's direct-entry guard. The reviewed correction invokes Node
directly; the actual launch configuration passes an isolated PM2 integration test.
The second attempt passed every direct check but hit nginx's old route immediately
after reload and safely rolled back. A separately reviewed one-second worker
handoff delay preserves all exact public checks and rollback behavior. The final
attempt passed both direct and public checks and completed publication.

- 1,153 offline assertions in 21 files plus 87 additional Node cases pass.
- Gary's 29 test groups, TypeScript and clean production build pass.
- Independent frozen-dependency rebuild matches all 26 mainnet artifact files.
- 40 initial on-chain read-back checks, 27 live release checks and five harmless
  unsigned program probes through the public relay pass. No probe sent a transaction.
- Ten relay configuration tests and five deployment rollback tests pass.
- Both public-data and recovery timers remain healthy; the public producer's
  isolated first refresh passed at the pinned release source.
- Programs, frozen program binaries and the installed signing artifact are unchanged.
- Foreign Gary working changes were preserved byte-for-byte; both repos pushed.

Public restore point:
`/var/backups/cbob-ecosystem/20261013T191944-cbob-publish.IFAOW8pb`.
Data-unit restore point: `/var/backups/cbob-public-data/source-xrc1gmny`.
The original Notice cron's pinned source directory must remain installed.

## Still required

Real Gary Club sign-in/expected-wallet acceptance is awaiting Gary's response.
Successful owner Phantom signing does not certify a real member login. Actual
holder claims start October 19 and need the supervised release approval and
receipts described in launch/RELEASE-ACCEPTANCE.md. Trading and offer-email inbox
acceptance have their own release approval. No destructive opening or paid trade
was manufactured for a checklist.

Run the witnessed full-suite Core certification after Thursday October 15 noon
Austin time, then reverify it immediately before Friday October 16 noon and obtain
explicit authority-removal authorization. Today's signing and rehearsal do not
satisfy that gate. Keep the Core watcher on. The exact announcement drafts still
need owner approval; Governors choose the first sale-round proposal and votes.
