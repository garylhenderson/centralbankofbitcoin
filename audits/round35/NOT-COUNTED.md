# Round 35: NOT COUNTED (no quorum; superseded by a program change)

Launched 2026-10-07 at `1281ab4`, both passes, round 33's roster. OpenRouter
refused 9 of 16 seats at once with HTTP 402 `in_flight_budget_exhausted` (the
account held $10.78 at the time; the refused outputs are in `failed/`).
Usable reports: programs 3 of 8, off-chain 4 of 8. Quorum is 6 of 8, so no
verdict was written and none may be written from these reports.

The provider-failed seats were NOT re-run at the same commit, because the
owner then ruled a program change (2026-10-07, item 58 in SPEC: every vault
carries a permanent transfer power held by MINT, used only by `rescue_nested`
to extract nested and orphaned vaults). The next counted round audits that
code. The seven usable reports were read for anything that still applies to
the new tree; see the next round's VALIDATION.
