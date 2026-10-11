# Personal Bank desk and funded-wallet repair, 2026-10-11

The signed-in desk now aggregates the reserves in the member's Gary Club vaults,
shows owed payouts separately, displays the five-level collection, and provides
an interactive history of the current vault basket. The public market brings
Bank reserves, payout accounting and history forward; a public Bank card can be
downloaded. Mobile navigation connects exploration, the Bank and the private desk.

## Wallet failure

`default.encode is not a function` was reproduced with a populated SPL token
account through the generated Gary Club adapter. External bs58 v6 was double
wrapped by ESM/CommonJS interop. The generator now bundles bs58/base-x ESM,
checks their entry points and versions, and pins esbuild. Gary Club's `prebuild`
runs six adapter-runtime tests and the 22 existing auth/portal checks.

Gary Club fix: `b61b8041` (original isolated commit `9f1b0748`, rebased over
concurrent unrelated main changes). Production build ID:
`pJ9t949sOZ2dlhbL_Bf8O`. Adapter SHA-256:
`7869fc93080453e3a81ecca9c10e8fd6f6e056ad15268f5c3af8217a14698454`.

The actual deployed Turbopack module was loaded through its runtime and used for
a read-only mainnet wallet check. All three nonempty reserve token accounts and
the Proof-of-Burn lookup succeeded. Every returned raw token amount matched an
independent `getTokenAccountBalance` read. No session was forged, no wallet key
was loaded, and no transaction was signed or sent. Existing foreign work in the
Gary Club production checkout was preserved.

## Accounting and interaction evidence

- Offline page suite: 910 assertions across 14 files, each at its exact floor.
- Position accounting: 27 cases, including unknown balances/prices, zero versus
  unavailable, current owner filtering, pending payout separation, exact integer
  totals and same-day history snapshot mismatch.
- Read-only index selftest: 14/14; history now publishes `generated_at` so a newer
  daily observation cannot be mistaken for the current position's snapshot.
- Dashboard browser regression: 47 checks at 375 and 1440 CSS pixels. Includes
  real `$GARY`/`$GIRAFFISH` response labels and decimals, chart periods/scrubbing,
  accessible value text, level navigation, delayed session deep links, sharing
  privacy, stale/invalid snapshots, undrawn levels, empty collection and separate
  wallet/market/index failure handling. No browser runtime exceptions.
- Existing interaction checks: 30; quote/focus/export checks: 14. No live trades
  were used; authenticated browser API responses were synthetic.
- Final bundle/SRI/copy suite: 111/111. Public and hosted profiles build.
- Local browser fixtures and screenshot evidence are never published as Bank data.

Run `node web/test/run-all.mjs` for offline checks. For the standalone dashboard
browser check, serve the built public profile on localhost:8769 and an isolated
Chrome CDP instance on localhost:9223, then run
`node web/test/dashboard-browser.cjs`. It intercepts account/data reads with
synthetic fixtures; do not point it at a signed-in customer browser.

## First-party Claude review and independent triage

Private reports: `encoder-review`, `encoder-triage`, `dashboard-review`, and
`dashboard-triage`, under the operator's ecosystem audit directory. All used
first-party authenticated Claude CLI, read-only tools, and no OpenRouter.

The encoder's commit/build gate is satisfied. Production Turbopack read validation
also passed. The dashboard triage's sole remaining blocker was a symbol mismatch
introduced while replacing the permissive decimal fallback. The lookup now
normalizes one leading `$`, the browser fixture uses production response keys,
and exact 100 $GARY / 300 $GIRAFFISH checks pass at both widths.

Other corrections: ownership claims are scoped to the observed Gary Club register;
recent trades explicitly take about ten minutes to appear; the hero shows its
observation time and a prominent delayed marker. Undrawn vaults use the Bank seal.
Daily chart buckets are UTC dates; missing prices never become partial totals.
Recent-action errors are visible. Deep links wait for session resolution without
replacing an already open dialog. Charts include text observations and accessible
slider values. Downloaded Bank/vault cards mark delayed snapshots.

## Launch boundaries

Programs and release `dist/` are untouched. This release does not initialize the
Bank, enable custodial actions, run a revenue/crank/alarm job, remove cron entries,
or revoke program authorities. Dates remain targets pending the owner's ruling.

Before activation after step 10: pin codec file contents as well as package
versions, review the adapter rebuild diff (collection and explained changes),
record the new artifact hash and repeat the production compiled-module read
check. Custodial trading remains a separate bolt-on to the five Bank programs.
