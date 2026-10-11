# D6 UI fix audit: `club-actions.mjs` and `club-controls-browser.cjs`

**Read in full:** `/scratch/cbob-d6-ui/web/src/lib/club-actions.mjs` and `/scratch/cbob-d6-ui/web/test/club-controls-browser.cjs`.

**Also read, for context only:**
- The original `/opt/cbob-vaults/web/src/lib/club-actions.mjs`, lines 90-173.
- Scratch `club.mjs`, the `ui.mjs` helpers, `market.mjs:160-202`, `vault.mjs:140-164` and `account.mjs`.
- The Gary backend at a97feac6: `portal-market.ts:1-120`, the capability lines in `route.ts`, and the order RPCs in `20261010_gc_cbob_portal.sql`.
- The nginx proxy example.

I ran nothing. Nothing under the root Bank source was touched.

## Verdict

- **U1 is resolved.** Order rows and the Cancel / Request cancellation buttons are drawn at `club-actions.mjs:145-150`. That is before either flag is checked and before the ownership read at `:154`. An outage of the ownership read leaves cancellation visible, and the test covers that.
- **U2 is resolved.**
  - The holder section depends only on `mine && holder` (`:155`), and runs before the `if (!trading) return` at `:158`.
  - Entry to trading (`:159-180`) depends only on `market.tradingEnabled === true` (`:143`).
  - `mountClubAction` now refuses before building the form when `s.holderActionsEnabled !== true` (`:98-101`).
- **The legacy flags are not used as a fallback.** `market.enabled` and `actionsEnabled` are not read anywhere in this file. Both checks use strict `=== true`.
- **The UI can't bypass the server.** The server still makes the decision for each lane (`portal-market.ts:25-32`). The UI only decides what to display.
- **Old and new versions together:**
  - New UI with a backend older than a97feac6: the new fields are missing, so every holder and trading entry is hidden. Cancel stays visible. This fails closed.
  - Old UI with the new backend: the U1/U2 coupling comes back, because `marketState` still emits `enabled` (`portal-market.ts:58`). The UI must ship before either flag is turned on.
- **The proxy passes the fields through.** It is a plain `proxy_pass` to :3003 (`nginx-club.conf.example:4-6`), so it can't strip them.

Nothing in this scope blocks the change. The items below are low severity or test gaps.

## Findings

**F1: Low (existed before D6). Overlapping reviews can show the wrong one.**
- **Where:** every control in the panel renders into the same `messages` node. That covers the holder buttons (`:156-157`), Review purchase / Review offer (`:161-162`) and Review listing / Review offer (`:166`). `reviewAction` calls `clear(out)` only after its `prepare` request returns (`:14-15`).
- **Failure path:**
  1. A member clicks "Review purchase", then "Activate vault".
  2. The `buy_order` prepare happens to return last.
  3. The pane now shows the purchase review. The member thinks they are confirming an activation and confirms a SOL purchase instead.
- **Mitigation already present:** the review screen says "You are buying this vault…".
- **D6 relevance:** D6 shows the holder and trading controls together in more combinations of flags.
- **Fix:** give each `reviewAction` call a sequence number and drop any response that is no longer the latest. Or disable every `.trade-panel` button while a prepare is in flight.

**F2: Low. Some orders can still not be cancelled from the UI.**
- **Market read fails:** cancellation depends on `clubRead('market')` succeeding (`:141`). If that read fails, no order rows are drawn at all. The vault ownership read is no longer a dependency.
- **Vault already opened:** the panel only mounts when the register status is not `opened` (`market.mjs:188`). The account desk only links to `/market/?a=` (`account.mjs:72`). Orders still open on a vault that was opened outside the portal's `open` path therefore have no cancel control.
  - These orders can't settle, because settlement re-reads the vault and checks expiry (`portal-market.ts:131,239`).
  - They still show on the desk until they expire.
- **Read limit:** `marketState` reads at most 5000 orders across all members (`portal-market.ts:52`). Past that, a member's own older order can drop out of the list.
- **Fix:**
  - Put a Cancel control on each row of the account desk.
  - Return the member's own orders as a separate query with no limit.

**F3: Low. The trading switch pauses orders, it doesn't cancel them.**
- The new copy at `:151` is accurate: orders remain authorized and "can settle when trading resumes".
- The rest of U1's recommendation is still not done: nothing cancels or expires standing orders in bulk when trading is turned off.
- Gary should approve this behaviour before trading is first turned on.

**F4: Low. Governance still uses the legacy field.**
- `governance.mjs:27` gates voting on `session.actionsEnabled`, which the backend aliases to the holder flag (`route.ts:99`). This is correct today.
- It is the one remaining reader of a legacy field, so it would go wrong if that alias is ever removed.
- **Fix:** switch it to `holderActionsEnabled === true`.

## Test coverage gaps (`club-controls-browser.cjs`)

1. **No positive `mountClubAction` case.** Lines 50-52 only test with the holder flag off. A regression that always hid the form would still pass. Add a holder-on run that checks `.action-form` renders for claim, buy and open.
2. **"No legacy fallback" is not tested.** Every fixture sends the new fields. Add backend-shape fixtures that should all hide holder and trading entry:
   - `{enabled:true}` with `tradingEnabled` missing.
   - `{actionsEnabled:true}` with `holderActionsEnabled` missing.
   - String values such as `'true'` or `'1'`.
3. **The `settling` path is untested.** Nothing covers an own order in `settling`, the "Request cancellation" label, the `cancellation_requested` response, or a cancel that returns 409.
4. **Some absences are never asserted:**
   - "Activate vault" is not checked absent for a non-owner while the holder flag is on.
   - "Review purchase" is not checked absent on the member's own vault while trading is on.
   - The buyer-side "Review offer" entry button is not checked when `mine=false`.
5. **One label means two things.**
   - "Review offer" is both the owner accepting an offer (`:162`) and a non-owner making one (`:166`).
   - The test's `labels.includes('Review offer')` can't tell which control it found, and members see the same label for opposite actions.
   - **Fix:** use different labels, or add `data-action` attributes and assert on those.
6. **The test can flake on slow machines.** It waits a fixed 100ms (`:39`).
   - Each absence assertion is paired with a presence assertion that proves rendering finished, so a slow run fails loudly rather than passing silently.
   - A `data-state="ready"` marker on the panel would remove the timing dependence.
7. **The test can't run in CI as written.** It needs a Chrome already listening on :9223, plus esbuild and ws loaded from absolute paths in other projects (`/home/ubuntu/luna-remotion`, `/opt/gary-club`). Pin these dependencies in the Bank repo before relying on it as a gate.

## Verification still missing before any enablement (carried over)

- No HTTP check against a built app that `prepare`, `confirm`, `order` and `cancel` return the expected status for each lane under all four flag combinations.
- No browser run of this UI against the real a97feac6 backend. The fixtures stub the session and market shapes, so a field rename on either side would not show up.
- No deployed-environment check that both flags are absent or `0` until the independent triage pass is done.
