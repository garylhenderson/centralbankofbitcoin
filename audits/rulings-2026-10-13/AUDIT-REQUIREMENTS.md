# Exact audit excerpts for source follow-up

Snapshot of canonical local audit requirements; not updated production claims.

## CBOB-AUDIT-2026-10-11.md

40: | A2 | Medium | `web/server/club-engine.mjs:44-45,98`; `/opt/gary-club/src/lib/cbob/portal-market.ts:71,101` | An order's `vault_state` hash includes raw reserve balances, and anyone can raise those: dust to the public deposit address, or the permissionless `claim` crank (`programs/cbob-vault-mint/src/lib.rs:1660`). So anyone can kill any listing or offer for about 5,000 lamports, and every monthly distribution plus claim kills all open orders. A dead order still shows "Review purchase" until it expires, and the seller cannot relist because of the unique-listing index. The hash protects no buyer, since reserves only grow while a vault is closed. | Hash only level, retired and burned state. At fill time, require each reserve to be at least the recorded amount and not frozen. On a mismatch, auto-cancel and notify both sides. |
315: **G-A2.** Openings don't pass the consented and seen sets through (`club-engine.mjs:126-129`).
317: **G-A3.** Stale orders: expired orders are hidden but never retired, and offers placed without enough SOL stay on display.
319: **G-C6. Self-offer.** A signed-in member whose vault sits in Phantom can place an offer on their own vault (`portal-market.ts:63` compares only the custodial wallet).
356: | G-B3 | Public "For sale" layer on /market/ | Price on cards, a For-sale tab and filter, sort by price, floor per level, a recent-sales feed, each vault's sale history and offer count. Back it with a public `/data/market.json` that contains no member identities. |
357: | G-B4 | Offers received on /account/ | An inbox of offers on my vaults with accept buttons, plus an email when an offer arrives |
358: | G-B5 | Move a vault in and out | Guided "move from Phantom into your Bank account to trade", and "withdraw to Phantom" (Gary Club `/api/wallet/send` already handles Core assets) |

## bank-journey-triage.md opening requirements

66: ### B2. A deposit or payout between prepare and confirm blocks an opening. Real. Fails closed (availability, not loss). Blocks activation of `open` only.
67: - **Confirmed:**
68:   - `club-engine.mjs:113` calls `readRedemptionSnapshot` without `known`, `consented`, `seen` or `noPrior`.
69:   - `effectHash` (`:131`) covers `details`, which include the raw `reserves`, `owed_sats` and the full ack set (`:118-119`).
70:   - Confirm requires an exact match (`portal-market.ts:193`).
71: - **Triggers:**
72:   - 1 base unit sent to a reserve ATA.
73:   - Anyone calling the permissionless `poolClaim` that names the vault.
74:   - Any distribution, which changes `owed_sats`.
75:   - A new stray, which adds an ack.
76: - **Corrections to the earlier review:**
77:   - The LATE_CONSENT wording is literally true. It describes what is lost *if* the vault opens and promises nothing about opening. It is not consent to a false loss.
78:   - The real harm is availability for custodial members. They have **no fallback**: `?wallet=phantom` needs a key they don't hold. So a griefer paying about one fee per minute can block the opening indefinitely. That is why this blocks activation of `open`, even though it causes no loss.
79: - **Related defect, N2 below:** in the same code path, a stranger can force set-up step after set-up step, and an optional rescue can block the opening outright.
80: - **Least-scope fix (engine only, no program change):**
81:   - At confirm, for `open`, rebuild the plan the way `prepareOpening` does: set `consented` to the ticked ack ids, `known` to the prepared `helperStrays ∪ transferStrays`, `seen` to the prepared `pdaTokens`, nested and compressed addresses, and `noPrior` to true. Use the `prepareOpening` loop.
82:   - Fail only on `stop` equal to `refuse`, `prior`, `ack` (genuinely new) or `dry-run`.
83:   - Take `reserves`, `owed_sats` and the live balances out of the hash. Bind `{stage, asset, consented ack ids, known set}` instead, and accept dropped strays, the way V38-2 does.
84:   - Pass the context from the stored prepared payload, never from client input. `judgeInput` stays as it is.
85: 
86: ### N2. The club opening path ignores `noPrior` and treats an optional rescue as required. Medium. Blocks activation of `open`.
87: - **Where:** `club-engine.mjs:116` takes `p.prior[0]` without filtering out `optional`.
88: - **Failure 1:** if the only prior step is the optional nested-vault rescue (`plan-redeem.mjs:229-233, 298`) and its dry run fails, prepare throws on every attempt and the opening is blocked permanently. The exact path skips it (`redeem.mjs:144`).
89: - **Failure 2:** each new deliverable stray of a new mint schedules a fresh owner-ATA set-up (`plan-redeem.mjs:189, 284-287`), so one round becomes a fresh set-up confirmation with rent. The planner's guarantee that a stranger cannot make the holder pay for account after account (`:175-176`) doesn't hold here.
90: - **Fix:**
91:   - Use `p.prior.filter(g => !g.optional)`.
92:   - Offer the rescue as a separate skippable action, or skip it.
93:   - Re-plan the opening stage with `noPrior: true`, as above.
94: 
95: ### B3. The grouped "listed below" acknowledgment. Fixed in the current snapshot. Not a blocker.
96: - `club-actions.mjs:43` now renders `a.list` and `a.more`, matching `redeem.mjs:114-115`.
97: - **Still missing:** a test that prepares more than `STRAY_GROUP_OVER` (20) strays and checks that the `group:` ack shows 20 list items plus "and N more".
98: 
99: ### M1. The opening review's balances. The current UI no longer claims a simulated receipt. Now Low.
100: - `:31` headlines "Accounts found at the vault address" and says "These are observed balances, not a simulated receipt."
101: - The only simulated figure is the SOL change (`club-engine.mjs:128-130`), and it is labelled as an estimate.
102: - **Remaining, all Low:**
103:   - Every account with the cbBTC mint is labelled "cbBTC" (`:33-34`). A stray non-ATA cbBTC account, frozen or with someone else's close authority, therefore shows a second "cbBTC" row next to the reserve. Label any account that isn't one of the vault's own three ATAs by its address. The client can derive those ATAs with `makeIds(profile).depositAddress(asset)` and `ata`.
104:   - `details.owed_sats` is never shown. The exact path shows "Payout owed... collected in the same step" (`redeem.mjs:95`).
105:   - The burn check isn't needed here: the server builds the instructions, `burnVault` is always included (`plan-redeem.mjs:207`), and the dry run must pass (`club-engine.mjs:125`). Simulated per-mint receipts are optional.
