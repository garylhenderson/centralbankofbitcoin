# Complete Bank journey presentation release, 2026-10-11

Scope: homepage and public register totals; shared publication navigation; claim, sale-round, opening, lookup and ceremony presentation; vault detail hierarchy and retired-vault states; Gary Club Bank authentication, email confirmation and recovery continuity.

No program, release binary, server planner, market settlement service, or generated engine changed. The generated engine remains SHA-256 `7869fc93080453e3a81ecca9c10e8fd6f6e056ad15268f5c3af8217a14698454`. The exact signing path and server financial gates remain in place. Operational check: Gary Club actions disabled; mainnet collection null. No transaction was signed and no launch date was written.

Verification:
- 910 offline web assertions in 14 files; floors unchanged.
- Dashboard browser checks at 375/1440; quote, grouped-loss disclosure, focus, polling, sharing, and retired-vault states in synthetic fixtures. No live funds or accounts used.
- Whole-journey mobile/desktop layouts: home, holder pages, schedule, statements, purposes/functions, and Gary Club login/signup/recovery.
- Published documents checked against git baseline: only shared navigation, CSS reference, correct Bank anchor and higher-resolution vault art changed. Issued words preserved.
- Static HTML stylesheet/script SRI verified against local bytes.
- Gary Club TypeScript and auth/portal/runtime/email fixture tests, including canonical redirect attacks, resume with fresh state, confirmation type, no-click-tracking, and consent SRI. Browser checks use real Chromium with all authentication mutations intercepted.

First-party Claude only: separate auth and Bank reviews, independent triages, and final checks recorded privately under `/home/ubuntu/cbob-ecosystem-audit/`. No OpenRouter. Source was frozen for final hash-pinned check after earlier reviews caught edits in progress.

## Activation gate

This is a presentation release with financial actions disabled. It does not certify activation of the existing custodial adapter. Before enabling actions, resolve and test:
- Member-wide pending issuance guard across tabs, and expiry rechecked when the intent is locked, to prevent ambiguous purchase retries.
- Opening re-planning with the consented/known/seen sets and no repeated prior account setup; optional rescue cannot block opening.
- Stale marketplace orders must be visibly renewed or retired when their bound state changes.

The UI now exposes grouped lost-item details; describes observed balances as observations rather than a simulated receipt; shows the member's trade role; and preserves a status-check path after an ambiguous confirm. These improve review clarity and do not replace the activation requirements above.

The hosted ceremony remains step 10, with the launch authority and exact ruled-value checks. Neither initialization nor the final program lock was executed.
