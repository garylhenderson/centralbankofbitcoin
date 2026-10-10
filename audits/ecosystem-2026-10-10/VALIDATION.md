# Gary Club ecosystem extension, 2026-10-10

This change adds a custodial Gary Club account surface and a marketplace bolt-on.
The five Bank programs and the `d2ae5fc` release binaries are unchanged. The marketplace
can be updated independently of the October 16 target program lock.

## Evidence

- Page suite: 883/883 offline assertions, all thirteen exact per-file floors.
- Local validator: 160/160 end-to-end assertions against pinned Core and token programs.
  Added tests verify Core ownership transfer, exact 90/10 SOL settlement to seller and
  REVENUE, failed transfer without either payment, and a subsequent authorized resale.
- Gary Club portal: 14 behavioral checks, including concurrent confirmations and vault
  actions, authorization scope, standing-order review, unsigned-worker fencing, disabled
  trading recovery, registry-refusal ambiguity, and a status read that cannot sign.
- Account handoff: 8 behavioral checks covering consent, Origin/CSRF, state mismatch,
  one-time redemption, parent-session expiry, wallet binding, host isolation and signout.
- Migration: create/validate/rollback on the shared database; RLS and private grants checked.
- Gary Club Next production build passed. Existing unrelated work was left untouched.
- Browser at 375px: market, account, claim, buy and redeem; no page-level overflow,
  action targets at least 44px, and no runtime exceptions.
- Mainnet read-only publisher: confirmed zero issued vaults before initialization,
  wrote the index and collection metadata to a staging directory.

## Internal Claude review

Fresh first-party Claude sessions reviewed authentication, settlement, public financial
records, and the hosted ceremony/UI. Independent triage followed the repairs. No
OpenRouter service was used.

Repairs include explicit account consent; state-bound, short-lived handoffs; strict
return paths; parent-session revocation; signed standing-order quotes; exact-role signing;
atomic order cancellation; fenced crash recovery; and preservation of ambiguous sends.
A registry refusal during a replay is never treated as proof that an earlier send failed.
Final independent triage accepted that repair. A separate focused Claude review accepted
the reserve/setup boundary: setup cannot withdraw reserves while leaving a tradable vault.
Financial event parsing authenticates the invocation stack, distinguishes direct burns,
records missing coverage, retries gaps, and only compares redemption prices when a
historical observation exists. The hosted RPC remains within its authenticated path.

The hosted page uses the Bank origin, basic authentication, a separate loopback
credential, a clean-build check, SRI and published hashes. Its delivery path remains a
trust boundary, as with the requested rehearsal arrangement.

## Activation gates

Gary still confirms the launch dates and signs step 10 with the pinned initialization
wallet. Collection-dependent actions remain disabled until that collection is recorded,
the adapter and pages are rebuilt, and the runtime checks pass. Read the launch guide
before any initialization or program lock. No alarm, payout or revenue job was armed.
The existing program certification count is not reset by this website extension.

## Published verification

- Gary Club commit `5eb5cca5` deployed through the normal production deploy script.
- Bank public and hosted assets published from clean commit `6a2fa09`; backup at
  `/var/backups/cbob-ecosystem/20261010T231215Z`.
- Live 375px browser checks cover market, account, claim, buy, redeem and vault lookup:
  no horizontal overflow, undersized action controls or JavaScript exceptions.
- Hosted guest receives 401; authenticated page and script receive 200. SRI is present,
  the served application hash matches the local clean build, and the authenticated RPC
  reports the pinned Solana mainnet genesis hash.
- Live migration grants checked: anonymous clients cannot read any of the four private
  tables or invoke the session-revocation check; the service role can read the tables.
- Public-data and previously-authorized-action recovery timers are active. These do not
  arm the Bank alarm, distribution or revenue schedules.
- Final bundle checks: 111/111. Programs and release binaries remain byte-for-byte
  unchanged from `d2ae5fc`.
- Launch checker still deliberately reports the three unresolved inputs: collection,
  charter opening and lock deadline. Gary's confirmations and signature remain pending.

## Account adapter activation after step 10

Record the real collection in the launch file, page configuration and relay environment
using the launch guide. The Gary adapter embeds the page configuration and must also
be rebuilt before account actions can be enabled:

```sh
node scripts/build-club-engine.mjs /opt/gary-club-cbob/src/lib/cbob/generated/club-engine.cjs
```

Review and commit the regenerated adapter and checksum in the Gary checkout, run its
portal checks and production build, merge and push, then use the normal production
deploy script. Rebuild and publish the committed Bank pages. Verify the live collection,
mainnet genesis, account ownership and expected program configuration before setting
`CBOB_PORTAL_ACTIONS_ENABLED=1` in Gary Club and restarting with its normal environment
procedure. Recovery must remain enabled independently of that action switch. This is
separate from the five-program immutable lock and does not change their release bytes.
