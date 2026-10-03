# v6 red-team 2 — against `9be3a7c` (stages 1-3b), 2026-10-03

Read-only, Core source checked, one read-only mainnet call. **No on-chain theft or
unseal found in SEAL/BURN/MINT/GOV**; every pinned offset and discriminator
recomputed and correct. Nothing run on a validator: each finding needs an arm.

| # | sev | finding | plan |
|---|---|---|---|
| 1 | HIGH | The PoB collection's update authority `6Aa2vdRK…` (the Gary Club inventory HOT wallet, in /opt/gary-club/.env.local and several .env backups) can add an external Oracle burn-check plugin; MINT's PoB burn passes no extra accounts, so every charter claim fails, forever (window is immutable). Before the first claim: zero vaults, no proposal possible, protocol dead. A benign future Moments hook does the same. | needs Gary: authority custody for the window + pass-through accounts + alarm |
| 2 | HIGH | A passed bundle [Brakes{guardian None}, ArmSwapOperator{attacker}] removes the brake and, 7 days later, sweeps all royalty SOL to the attacker. Guardian stop is one-round only (re-propose after StopIsNewer). | needs Gary: supermajority + notice + no bundling + guardian may cancel a pending operator |
| 3 | HIGH | `TightenSweep` unbounded: reserve=u64::MAX (or max_sweep=1, cooldown huge) locks all royalty SOL forever. | fix: hard bounds fixed at initialize |
| 4 | MEDIUM | The 2.1%/h cap does not stop a custodial-key thief (they TRANSFER every vault first; transfers are unlimited), and the bucket allows 2x cap in a rolling hour. | needs Gary: keep or drop the cap |
| 5 | MED-LOW | activate → distribute(burn) in one tx captures the whole backlog; at launch the first activator takes 100%. | fix: new activations join at the NEXT distribution |
| 6 | LOW-MED | A superseded SetRound reverts its whole bundle (e.g. kills a bundled restart). | fix: superseded action is a logged no-op |
| 7 | LOW | initialize accepts default bank_treasury; payment_mint not checked against SEAL reserves; GOV collection not checked against MINT; DESIGN says record rent refunded but nothing closes it; all-redeemed = no proposals ever. | fix the first three; correct DESIGN on rent or implement; last is accepted |
