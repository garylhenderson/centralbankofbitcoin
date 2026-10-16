# October 16 operational and interface release

Gary explicitly authorized both remaining tasks on October 16: install/fund
automatic rewards, revenue splitting and fee replenishment; complete the holder
and trading releases after their technical checks. This supersedes the earlier
requirement to ask him again for those release decisions. It does not authorize
invented mainnet claims, trades, votes, deposits or destructive openings.

The five programs are already immutable. The witnessed certification, initialization,
wallet/login checks, video publication and owner excess return are completed.
Do not repeat any of them. Charter claims remain fixed to October 19 through 26,
noon Austin time. The first genuine claim and consenting-holder trade acceptance
cannot be recorded before eligible real vaults exist.

## Operational controls

- Operating budget starts with the retained 0.5 SOL in deployment wallet
  `FZjLB4e9mVMZTWA6YR1KbXVbByTqWsHpHy5sK83yJYUY`.
- Initial funding: 0.20 SOL dedicated crank, 0.05 SOL configured swap operator,
  approximately 0.25 SOL retained for replenishment, less the actual funding fee.
- Every minute, refill crank below 0.05 to 0.20 SOL and operator below 0.025 to
  0.05 SOL. Destinations are locally pinned owned wallets; operator must also
  match the decoded on-chain configuration. Two providers must agree on balances,
  network, fee and signed simulation before funding.
- Hard transfer cap: 0.25 SOL per UTC day, including initial funding. Retain at
  least 0.005 SOL in the source. Refuse excessive fees and incomplete reads.
  Never sell tokens, use a vault, or spend the protocol revenue reserve to refill.
- A durable local signed intent precedes the existing central `landAndAwait`
  registry/lander. Unknown submissions block all new topups even across UTC days.
  Reconcile their actual signatures; never infer failure from a timeout. Funding
  is complete only after two providers return the exact finalized transaction
  bytes and actual destination credits/source debit.
- Crank and revenue workers use that same central transaction guard. A prior
  interrupted send blocks the payer until reconciled and forces a fresh pass.
  Preserve existing program-enforced rules, DEX instruction policy and fee budget.
  Subsequent operator account reads require at least the confirmed send slot.
- Hourly full crank at minute 37; every-minute draw lane; hourly revenue at
  minute 41, with the ruled sweep cooldown enforced by the program. The first
  healthy no-action pass proves the operational job works; it is not a payout
  or trade receipt.
- The owner destination lives only in private `/var/lib/cbob-ops/owner-alert.json`
  (600), never in the public source. Private owner alerts use Luna's existing Linq
  line under Gary's explicit
  CBOB texting instruction. Save attempts before submission, read back exact
  provider messages, do not resend unknown alerts, and deduplicate each stream
  per UTC day. No email or Telnyx path is introduced.
- An independent systemd timer checks job freshness every two minutes and
  warns if replenishment reserve is below 0.05 SOL. This is a finite reserve;
  depletion holds funding and requires replenishment from the owner.

## Installation and release

1. Review exact source and dependency lock, run focused safety and existing
   worker/web regressions. Independently review via the first-party Claude
   subscription with metered extra usage disabled. Commit and push before any
   operational deployment. No program, frozen signing artifact or holder bundle
   changes are part of this operational implementation. The pinned `bank/ops-node`
   CLI sets the Gary project cwd and installs the ordinary TypeScript loader for
   the guard's lazy registry imports; avoid scoped import data URLs. Initial
   dependency-refused send evidence is retained and proved expired/unbroadcast
   with unchanged balances before any fresh funding attempt.
2. Prepare `bank/keys/crank.json` privately (600), verify owned source/operator
   keys and create `/var/lib/cbob-ops/wallets.json` (700 parent/600 file). Runtime
   dependency is pinned in `bank/runtime/package-lock.json`; install with
   `npm ci --prefix bank/runtime --ignore-scripts`.
3. Inspect `bank/ops-node /opt/cbob-vaults/bank/fee-topup.mjs --initialize`
   without `--live`. Only once,
   run `--initialize --live`; thereafter use `--live` without `--initialize`.
   Preserve the actual dual-provider proofs in the topup journal. If a send
   fails, inspect/reconcile its existing entry; do not erase the ledger.
4. Prime the full crank, reveal, revenue and topup via
   `bank/ops-node /opt/cbob-vaults/bank/ops-run.mjs`, keeping
   actual exit results and on-chain receipts distinct. Then use the narrow
   `scripts/install-live-ops.py --execute FULL_PUSHED_SHA`. It preserves foreign
   cron lines, replaces only the specifically recognized money jobs, arms four
   schedules and the independent watch timer, and saves a private cron backup.
   Use this installer for these jobs; the historical nine-job installer is not
   a replacement for this additional topup controller.
5. Reverify deployed holder bundles, fresh initialized feeds, permission/RLS
   denials for anon/authenticated callers and service-role controls. Existing
   owner login, wallet match and Phantom warning acceptance remain recorded.
   Check charter countdown/refusal before opening without creating a fake claim.
6. Under Gary's explicit authorization, set the two independent Gary controls
   `CBOB_PORTAL_HOLDER_ACTIONS_ENABLED=1` and `CBOB_PORTAL_TRADING_ENABLED=1`.
   Synchronize only the trading flag in the isolated public-data reader file.
   Restart/reload only the existing Gary process with its current configuration,
   refresh public data under its existing isolated service, and read back
   environment and running process flags, public market status, freshness,
   authenticated fences and unaffected wallet/login/recovery routes.
7. Record first real claim and trading acceptance only from actual holder
   requests and successful chain receipts. A Friday enablement is readiness,
   not evidence that a claim, payout or paid trade has happened. Follow the
   existing RELEASE-ACCEPTANCE.md for those condition-dependent actions.

Rollback new actions using the checked operator helper
`/home/ubuntu/cbob-operations-release-20261016/interface-release.py` with
`stop-holder`, `stop-trading` or `stop-all`. It changes the relevant file AND
PM2 process flags and synchronizes the isolated public trading copy. PM2 stores
the explicit flags across restarts; editing `.env.local` alone is insufficient.
The helper preserves every other existing process environment value, verifies
a new process ID and unchanged build, and records failures before attempting
each independent rollback step. No complete credential-file backup is made.
Run activation with `setsid --wait python3 .../interface-release.py enable`
after the reviewed source is committed and pushed. Preserve pending transaction
reconciliation, cancellation, durable journals and existing signatures. Cron
rollback uses the private backup only after comparing intervening edits;
never restore a whole stale crontab over foreign changes. Disabling interfaces
does not stop direct on-chain actions or change permanent charter dates.

This document is the reviewable release procedure. The private operational
receipts, not this procedure, establish which installation steps actually ran.
