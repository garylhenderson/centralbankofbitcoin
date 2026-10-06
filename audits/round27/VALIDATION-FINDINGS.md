# Round 27 — findings discovered during repair validation

This addendum records findings discovered after the external audit requests completed, while validating the round-27 repairs. It does not change the external auditor counts or relabel their reports. The off-chain verdict remains seven substantive auditors out of the original eight and eight confirmed findings from its triage. The MEDIUM reader failure and INFO documentation boundary below are two additional validation discoveries. Round 27 remains **NOT CLEAN**; the consecutive-clean counter remains **0/2**.

## V1 — MEDIUM: version-1 transactions stop historical transaction readers

The first full repair-validation run stopped in `scripts/probe-mainnet-facts.mjs` before the on-chain suite. Its simulation fee-payer sampler requested a recent transaction with `maxSupportedTransactionVersion: 0`; the live RPC returned error `-32015` because that transaction was version 1. Evidence: `.cache/r27-suite.log`. The signature-paging assertions had run, but the mainnet probe and full runner did not pass. This failed attempt is not counted as successful validation.

The sampler uses a historical address only as a funded payer in unsigned ATA simulations. It does not sign as that address or send a transaction. Skipping unsupported samples could avoid this particular failure, but would leave the operational problem unresolved:

- `bank/alarm.mjs` used the same maximum version in its parsed-transaction walk. An unsupported transaction throws before the completed report/state save. The old cursor is retained, so the same transaction can stop later passes. The outer failure notice makes this a loud outage rather than a false clean report, but transaction surveillance does not progress.
- `bank/revenue.mjs` used the same reader in `splitsSince`. The exception stops automatic evidence-based recovery of returned-but-unsplit cycles. It does not prove a split or close a cycle.
- `bank/redemption-poster.mjs` stops before saving past that transaction; later runs retry it. It remains a draft generator with no sender.

Our writers continuing to construct legacy transactions does not constrain the formats used by other participants whose transactions enter those histories. No version-1 CBOB attack transaction was sent in this investigation. The demonstrated failure is reader compatibility, not a demonstrated on-chain loss.

## Independent evidence

A fresh, successful public mainnet transaction was read through raw `getTransaction` with `encoding: jsonParsed` and maximum version 1:

- Signature: `5BUyzZNq4ieKuJLLfj4T8pbYNF71yBqKAkZoVvZEnXM9ohsM29aT47JntRJc2wAD1Ks4WRGCBnL9etYMzHWYJQer`
- Slot: `453742789`; observed 2026-10-06.
- Parsed message: resolved account keys and instructions, plus version-1 `transactionConfig`.
- Existing `normaliseTx` reads three top-level and nineteen inner instructions; metadata contains 85 log lines.

The installed web3.js version is `1.98.4`. Its parsed-response version schema accepts only legacy and version 0. The actual `getParsedTransaction` method rejects this real version-1 result even when its request opts into maximum version 1. Merely changing the numeric request option is insufficient. A synthetic response through the installed SDK independently gives the same schema refusal.

The public result is preserved in `tests/fixtures/mainnet-v1.json`. Investigation scripts and logs are `.cache/triage27o/live-version.*`, `tx-version.*`, and `txread-review.*`. Actual source-extracted old alarm and revenue bodies, with I/O stubbed to return the observed RPC error, confirmed the cursor/recovery consequences above. No live alarm, revenue or crank entrypoint was imported or run; no transaction or notification was sent.

## Repair and independent review

`bank/txread.mjs` shares one parsed-history reader among the alarm, revenue recovery, redemption poster and mainnet probe. It uses the connection's existing RPC transport, explicitly requests resolved legacy/version-0/version-1 history, preserves the returned version and configuration, and validates the result before returning it. It does not replace the shared SDK installation, deserialize or sign version-1 wire transactions, or change on-chain programs.

The validation checks supported versions, transaction identity, account keys, instruction structure and metadata needed by the consumers. A null transaction remains unknown; RPC failures, unsupported future versions and malformed or incomplete monitoring coverage throw. Empty arrays are explicit empty coverage; missing/null logs or inner instructions are not treated as empty history. Token-balance coverage and the fields used by money/account detectors also require validation.

Independent review caught two important distinctions in the initial draft: dropping metadata could otherwise turn nineteen CPI instructions into no CPI history, and parsed instruction payloads cannot all be assumed to have one shape. Memo payloads may be strings. System transfers use lamports; SPL transfers use token amounts. ATA `recoverNested` has a different field set from account creation and must not be required to supply the creation-only `account` field. The latter shape was checked against the [Agave ATA parser](https://github.com/anza-xyz/agave/blob/master/transaction-status/src/parse_associated_token.rs).

Ten independently executed source-extracted integration assertions exercise the actual alarm walk, revenue split scan, poster loop and poster release calculation, using the new reader and stubbed I/O. They show:

- The captured version-1 result and synthetic legacy/version-0 parsed controls preserve transaction/CPI consumption and permit the intended cursor progress.
- The revenue scan retains the selected token outflow and supplies a valid time/amount anchor to `closesCycle`.
- The poster retains the fixture's three outgoing token amounts; this public trade fixture contains no CBOB redemption event, so no draft is invented.
- Missing log coverage refuses all three consumers, holds alarm/poster cursors, saves no poster state, and supplies no split evidence.

Evidence: `.cache/triage27o/txread-consumers.*` and `durable-consumers.*`. The exact ten-assertion snippet, `.cache/r27-consumer-tests.txt`, was incorporated into `bank/selftest.mjs` by the implementation agent. Legacy/version-0 controls reuse the parsed payload; they are not claimed as newly executed wire transactions. The canonical detector run subsequently passed 860/860 (`.cache/r27-v1-selftest4.log`); independent review read that result rather than claiming a second full run. The implementation agent also recorded five identical mainnet artifact hashes in `.cache/r27-v1-byte-identity.log`. Full on-chain suite, fork, probe and build results belong in the separate repair-validation record and are not inferred from these isolated checks.

Final independent remeasurement accepted the complete public fixture, refused the tested unsupported-version/identity/metadata/instruction-shape/RPC failures, and accepted a valid-shaped ATA `recoverNested` control. The ten extracted consumer assertions passed again after the targeted field checks were added.

The narrow reader still trusts the configured RPC's authenticated account and transaction data. It does not prove RPC honesty, guarantee future transaction formats, or turn unavailable historical metadata into known absence. Keeping cursors/cycles unresolved on unknown coverage is intentional. A live CBOB version-1 redemption/revenue ceremony was not performed.

## Correction to the original documentation sibling analysis

The alarm's signature walk scans the four initializing programs; its original report's four-program count was accurate for that scope. The D3 verdict has been narrowed accordingly. The separate current descriptions of upgrade-authority monitoring and the simulation build list still incorrectly named four while those paths include the fifth, stateless sweep helper. Validation also found `launch/mainnet-init.json`'s `lock_deadline.source` saying all four programs must be immutable; the actual deadline watch covers five. Only that source description changed from four to five: its value, status and every other launch field remain unchanged. This is another site of D3, not an additional runtime finding or a change to its severity/count. There is no blanket replacement of historically correct four-program or four-initializer descriptions.

## V2 — INFO: transaction-format boundaries were stated too broadly

Independent program-side review confirmed documentation overclaims exposed by v1. SPEC's reserve/helper measurements, 18-instruction padding maximum, byte-versus-compute comparison, and item 50's 1,232-byte/default-budget figures needed explicit legacy scope. Item 54's default budgets and ComputeBudget-preservation rule apply to legacy/v0. Item 42's prior-ATA preparation remains the chosen client contract, not an all-format impossibility. SEAL's comments additionally claimed an ALT was required and no measured versioned redemption existed, despite S9b; a test comment incorrectly called v0 the only way to reach the attribute budget.

These sites now state their measured format. A short SPEC boundary cites the [official versioned-transaction documentation](https://solana.com/docs/core/transactions/versioned-transactions), distinguishes v1's larger packet and explicit message resource configuration, and retains the existing protocol bounds. No HOLDER-GUIDE format promise required changing.

**No on-chain logic defect was confirmed.** SEAL/BURN pairing and MINT retirement inspect normalized Instructions-sysvar entries, resolved keys and stack height, not transaction wire bytes. Current [Agave account-loader source](https://raw.githubusercontent.com/anza-xyz/agave/master/svm/src/account_loader.rs) constructs this representation from `SVMMessage`; the [SDK serializer](https://raw.githubusercontent.com/anza-xyz/solana-sdk/master/instructions-sysvar/src/lib.rs) checks instruction-offset overflow. This is source reasoning, not proof of the live validator's source identity or a CBOB v1 execution.

SEAL remains exactly 417 lines; independent comparison found every non-doc-comment line identical to HEAD. The implementation rebuild records all five production artifacts byte-identical in `.cache/r27-v1-byte-identity.log`; that log was reviewed, not represented as another independent rebuild. No protocol behavior, counts or floors changed in this documentation repair. **No CBOB v1 transaction execution is certified.**
