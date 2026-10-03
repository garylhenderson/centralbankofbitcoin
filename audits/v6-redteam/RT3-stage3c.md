# v6 red-team 3 — against stage 3c (uncommitted tree on `v6`), 2026-10-03

Read-only, independent agent: all four programs, the stage 3c diff, DESIGN-v6,
RT1/RT2, HOLDER-GUIDE, `bank/crank.mjs`, `bank/detectors.mjs`, `bank/layout.mjs`,
the suite. Recomputed every cross-program raw offset (14 into MintConfig v5, plus
VaultRecord and BurnConfig), every account space constant, and all 12 pinned
discriminators: all correct. **No CRITICAL or HIGH. No theft, unseal, payout
mis-accounting, permanent distribution block, or supermajority bypass found.**
All seven stage 3c claims verified to hold.

| # | sev | finding | status |
|---|---|---|---|
| 1 | MEDIUM | A frozen POOL (Coinbase holds cbBTC's freeze authority) made every activated vault unredeemable: `retire_redeemed` refused while >= 1 sat owed, `claim` cannot pay from a frozen account, and `monthly_inline` kept re-crediting from it. Anyone could try to provoke it by sending tainted cbBTC to the pool. | **FIXED**: with the pool frozen the redemption forfeits its undelivered share to the pool (logged `CBOB_REDEEMED_POOL_FROZEN`); `monthly_inline` never credits from a frozen pool. Suite 3c.F0-F3. Holder guide states the consequence. |
| 2 | LOW | `claim` does not check the vault is alive: a bare-burned waiting vault could be joined (dead weight), and an unretired bare-burned active vault paid into an ATA nobody can sign for (destroying sats `retire_burned` would return). The crank did not filter either. | **FIXED in the crank** (never joins or pays a positively burned vault; retires it). Program side ACCEPTED: a no-profit grief only between a bare burn and its retirement, which the crank does first each pass. Selftest arms. |
| 3 | LOW | GOV accepted a reserve tighten in (0, 890,879] that MINT refuses (rent floor) when initialize used reserve 0, reverting its whole bundle. | **FIXED**: GOV mirrors `RENT_EXEMPT_0_BYTES`; suite 3c.M1 pins the mirror. |
| 4 | LOW | A newer SetRound skipped as `round_already_over` did not advance `last_round_id`, so an older passed round could execute after it. | **FIXED**: the mark moves before the over-check. Suite 3c.R1. |
| 5 | LOW | The monthly clock started at `initialize`; an initialize weeks before the charter window could let the first free tick land inside it and join only the first funded vaults. | **FIXED**: `last_distribute_at = max(now, charter_closes_at)`. |
| 6 | LOW (ops) | The crank sent activations (each runs the monthly in-line) before its explicit `distribute`, so that distribute failed `MonthNotElapsed` and paged monthly; its "join after" for this-pass requests was dead. | **FIXED**: order is retire, join eligible, distribute, activate, claim; `MonthNotElapsed` on distribute is logged as done, not a failure. Selftest arms. |
| 7 | LOW | P.33 did not measure the charter claim with a pass-through, a separate payer and compute-budget instructions. | **FIXED**: suite 3c.P1 measures it (no crank). Client rule: the claim page sends no crank when `pob_extra > 0`. |
| 8 | INFO | HOLDER-GUIDE "trigger a payout first" ignored the join gate and the current-epoch case. | **FIXED** in the guide. |

Defended (verified by reading): all cross-program offsets and discriminators;
account sizes (MintConfig 679+256 before stage-3c follow-ups, VaultRecord 221,
BurnConfig with the 512-byte ring); owed accounting across credit/claim/join/
retire; double-pay or double-join in one claim; pending counters (no underflow,
same- vs earlier-epoch retire); no permanent distribution block; the burn path
cannot tick or burn before the join gate; in-line monthly placement in every
host; `retire_redeemed` reachable only from BURN; GOV's restart skip matches
MINT's `StopIsNewer`; supermajority cannot be gamed; sweep tighten is monotone;
Merkle domain separation and PoB checks; the guardian cannot cancel its own
replacement and `cancel_swap_operator` installs nobody.
