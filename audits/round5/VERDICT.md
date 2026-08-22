# Round 5 — verdict on every finding

8 auditors: `deepseek-v4-pro`, `qwen3.8-max`, `glm-5.3`, `minimax-m3`, then the top
of three families on Gary's instruction — `gpt-5.6-terra-pro`,
`grok-4.20-multi-agent`, `kimi-k3` — plus `claude-opus-5`.

**Roughly a third of prior rounds' CRITICALs were wrong, and that held again.**
Four findings were rejected here, three of them by measurement rather than argument.

---

## ACCEPTED AND FIXED

| # | severity | found by | what |
|---|---|---|---|
| A1 | HIGH | all 8, and independently | **No lifetime supply cap.** `minted_total` was incremented and **never read** — its own doc comment named the attack it was meant to stop. `max_supply` now gates every mint and ratchets DOWN only. |
| A2 | HIGH | glm, minimax, deepseek, gpt-5.6, kimi, opus | **`set_round` could express "unlimited, free, forever".** `cap == 0` meant UNLIMITED and `closes_at = i64::MAX` never closed. `cap > 0` now required, window bounded to a year. |
| A3 | HIGH | **glm (unique)**, upheld by gpt-5.6/kimi/grok/opus | **BURN's reserve list was not canonical.** It kept its own copy and cross-checked only `collection` and `bank`, so a mint added to SEAL and not BURN was never derived, never required, never checked — and a vault holding it burned cleanly, destroying the token. Its own header claimed the cross-check prevented exactly that. BURN now reads the list out of the SEAL config. |
| A4 | HIGH | glm, deepseek, minimax, gpt-5.6, kimi, opus | **Charter provenance was never written, and `mark_opened` REPLACED the whole Attributes list**, so the first honest redemption would have erased it. No attacker needed — the happy path did it. `mint_vault` now stamps it; `mark_opened` parses the existing list and preserves it. |
| A5 | MEDIUM→CRITICAL-if-armed | **opus (unique)** | **A Token-2022 reserve mint would seal every vault forever.** A T22 ATA is 170 bytes (`ImmutableOwner`) and both reserve checks demand exactly 165, so `close_redemption` could never succeed — and `open_for_redemption` is illegal without a terminal close. Not live today (all three reserve mints are classic SPL, verified on mainnet) but the reserve list is additive by design. Reserve mints are now checked for classic SPL at **config** time. |
| A6 | HIGH | grok, kimi, opus, minimax, gpt-5.6 | **The treasury was redirectable by one admin key** — the largest fund-flow control in the system. Now requires the governance signature too. |
| A7 | MEDIUM | kimi, opus, minimax | **The owner could be an address nobody can sign for** → a vault that takes real payment and can never be opened by anyone. The owner must now SIGN. |
| A8 | MEDIUM | kimi | **Governance could reprice between a buyer simulating and landing.** The payer now passes `max_price_lamports`. |
| A9 | MEDIUM | glm, minimax, kimi, opus, gpt-5.6 | **Unpinned raw-offset reads** of a sibling program's config. Now pinned by Anchor discriminator AND a `version` byte declared as the first field. |
| A10 | LOW | deepseek | BURN's second loop did not reject Token-2022 extensions the way the reserve loop does. Fixed. |
| A11 | LOW | opus | Dead code and comment drift in SEAL from when mint/burn lived there. Removed. |

---

## REJECTED — and why

### D1 — "the trailing `0` byte breaks Borsh, so every mint and burn reverts" (gemini, round 4)
**REJECTED.** Refuted by 19/19 against real cloned mainnet Core: test 2.1 mints
through `CreateV2` with `[20, 0, …]` and 4.5 burns through `BurnV1` with `[12, 0]`.
`BurnV1`'s only argument is `Option<CompressionProof>`, so the `0` is a mandatory
`None` tag, not an extra byte. Independently rejected by gpt-5.6, grok and kimi.

### D2 — "the COption tag is 1 byte, so a revoked delegate can trap a vault" (deepseek)
**REJECTED BY MEASUREMENT.** SPL Token packs `COption<Pubkey>` as a **4-byte** tag.
Measured on a real account after approve+revoke: the tag reads `[1,0,0,0]` then
`[0,0,0,0]`, while the 32-byte payload the finding worries about stays non-zero —
and the code never reads it. Its proposed "fix" (`d[72] == 0`) would have been
strictly weaker than what is there.

### D3 — "payment before the CPI can leave a buyer having paid for nothing" (minimax)
**REJECTED.** Transaction atomicity: a later failure reverts the transfer. Minimax's
own "could not break" section cites atomicity for the open/close pairing two
paragraphs earlier. Independently rejected by glm, gpt-5.6, grok and kimi.

### D4 — "drop burn's `lamports == 0` check; Core's BurnV1 sweeps the PDA" (grok, UPHELD by grok)
**REJECTED BY MEASUREMENT — and this one would have destroyed customer SOL.**
After a real `BurnV1` the asset-signer PDA still held all 5,000,000 lamports and
the payer received only 546,800 (the *asset's* own rent refund, minus fees). Core's
`BurnV1` account list never includes the PDA, so it cannot move it. Taking this
advice would have orphaned every lamport an owner legitimately held there. Kimi and
gpt-5.6 rejected it on exactly that mechanism; grok was alone in upholding it.
The griefing observation underneath is real and is documented as a known limit.

### D5 — "vaults may be born UNFROZEN" (qwen, unresolved in its own answer)
**REJECTED BY MEASUREMENT.** The plugin decodes `frozen: true`, and — the test that
actually matters — an owner's bare `Execute` with no `open_for_redemption` anywhere
in the transaction is refused on-chain (Core `0x9`) with the contents intact. Now a
permanent test, because nothing had asserted it.

### Partially rejected: "require a minimum mint price" (minimax, glm, kimi)
**REJECTED ON THE BUSINESS.** `price_lamports = 0` is a requirement, not a defect:
the charter round is free by design. A minimum price would have broken the product
the first time it was used. Kept legal, with a comment saying why.

---

## Two process notes

**A REJECT for the wrong reason is a false pass.** Three round-5 tests (6.8/6.9/6.10)
first "passed" on `AccountNotEnoughKeys` — Anchor bouncing a short account list
before the handler ran — so they proved nothing about the supply cap they claimed
to test. Every negative test now asserts *why* it rejected.

**The test runner was certifying against the wrong validator.** Four independent
faults each produced a green-looking run that proved nothing, the worst being that
`pkill -x solana-test-validator` matches **nothing** (Linux truncates `comm` to 15
chars), so the old validator survived, the new one died on a port clash, and
`cluster-version` was answered by the old one — which had no Core. Deploys landed
on it. The runner now refuses to deploy unless Core on the validator is
byte-identical to the mainnet dump, and that gate is proven to fire both ways.
