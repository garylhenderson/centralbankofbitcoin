# Round 36 Independent Audit — CBOB Vaults v6

## R0. Round 35's verdict and the `rescue_nested` program change

Round 35 reached no quorum (3/8 programs, 4/8 off-chain). Its seven usable reports were triaged; the owner then ruled the `rescue_nested` change. I verified the change and its review independently.

**The `rescue_nested` instruction is sound.** I confirmed:
- The `RESCUE_SEED` PDA signs in exactly one `invoke_signed` (MINT lib.rs:1867). No other code path can exercise the PermanentTransferDelegate.
- The destination is forced to `config.bank_treasury` and checked with `require_keys_eq!(a.new_owner.key(), dest, ...)`. The caller cannot choose the destination.
- The vault must be nested (`owner == PDA(["mpl-core-execute", host], Core)`), and the host must be the vault itself, positively burned, or a live CBOB vault. Foreign live hosts are refused (`HostUnresolved`).
- Core's `PermanentTransferDelegate` implements only `validate_transfer` (force-approve). It cannot burn, update, or execute. Verified against Core source at `.cache/triage26p-core`.
- The seal (`PermanentFreezeExecute`) only rejects `ExecuteV1`, not `TransferV1`, so the rescue can move a sealed vault. This is correct and necessary.
- The review's M1/M2 (live-host branch sending to the host's owner) was fixed: every rescue now goes to the Squads.

**Validation confirmed:** canonical run 889/889 on-chain, 917/917 detectors, fresh simulation 71/71. The suite floor rose from 885 to 889 to cover the new arms (R35.N1–N9, N2a, N8a, C3).

No surviving defect found in the rescue change.

---

## R1. Custody

The open/burn pairing is robust. I verified:
- Both directions bind asset AND owner by account index (asset at 0, owner at 2).
- `load_instruction_at_checked` sees only top-level instructions, so CPI-wrapped opens/burns cannot satisfy the pairing. Confirmed by WR.1–WR.4.
- Cross-pairing (open A, burn B) fails because each side checks the asset matches.
- A malformed burn that passes SEAL's forward walk but fails BURN's account validation reverts the whole transaction, re-sealing the vault.

The emptiness proof is unchanged and correct. The sweep helper closes reserve accounts, and the burn's check skips closed accounts (owner changed or data length 0). Measured in SR.4/SR.4a.

No finding.

---

## R1s. The sweep helper

I verified each sub-question:

**(a)** Direct calls fail (`signer.is_signer` required; only Core signs the asset-signer PDA). Through Core, only the owner can `ExecuteV1` (SR.5, SR.5a, SR.5c). A frozen vault cannot Execute (the seal rejects it).

**(b)** Duplicate source fails (SR.12a — the first close deallocates the account, the second read fails). Source-as-destination is impossible (different owners required). Zero pairs allowed (lamport-only sweep, SR.13). Odd pairs refused.

**(c)** The destination wallet is not checked against the vault's owner, but the sweep is only reachable by the owner via Core Execute. This is safe. Lamport transfer to a non-existent dest below rent exemption fails (noted in SPEC).

**(d)** The sweep reads `signer.lamports()` at execution and moves all of it. Within the atomic transaction, nothing runs between the sweep and the burn. BURN's `lamports == 0` check sees exactly what the sweep left.

**(e)** Closed reserve accounts pass the burn check (skipped). A stranger-created classic ATA for a reserve mint lands at the expected ATA address and is declared. T22 ATA for a classic mint is impossible (probe F4.2). Non-ATA token accounts and nested Core assets are the completeness gap (item 44), mitigated by rescue_nested for vaults.

**(f)** S8.0 measures 1,061 bytes; with compute budget and separate payer, ~1,209 of 1,232. Fits.

**(g)** The helper is byte-identical across dist/, target/deploy/, and the localnet build (build-mainnet.sh proves it).

No finding.

---

## R2. The community pool

I verified the invariant `pool_balance >= ceil(owed_scaled / ACC_SCALE)`:
- `distribute` computes `avail = balance - ceil(owed)` and credits `delta = avail * SCALE / weight`. Since `delta * weight <= avail * SCALE`, the invariant holds.
- `claim` pays `pay` sats and reduces `owed_scaled` by `pay * SCALE`. The carry (sub-sat remainder) stays in `owed_scaled`. Invariant maintained.
- Two-step activation prevents the same-transaction backlog capture. `JoinWaitingFirst` prevents distributing while eligible vaults wait.
- The counters (`pending_count`, `pending_this_epoch`) are consistent. `advance_epoch` resets `pending_this_epoch`, making prior-epoch requesters eligible.

**Liveness observation (INFO, not a defect):** If `total_active_weight == 0` and `pending_count > 0` but `pending_this_epoch == 0`, no distribution can run until someone joins the pending vaults via `claim` or `activate`. The crank handles this, and the alarm pages `distribution_overdue`. This is a liveness dependency on the crank, not a security issue.

No finding.

---

## R2b. The $CBOB boost

I verified the "exactly N distributions" property:
- A boost purchased at `dist_epoch = D` with `epochs = N` ends at `D + N`. It earns distributions `D+1` through `D+N` (N distributions), becoming due when the distribution advances to `D+N`.
- The ring has 64 slots; max epochs is 63, so no wrap collision. I traced the scenario where a boost ending at epoch E and a boost ending at E+64 would share a ring slot, and confirmed it cannot occur: reaching `dist_epoch = E+1` (to purchase the second boost) requires passing through epoch E, which clears the slot.
- `unschedule_boost` correctly handles both due and not-yet-due boosts.
- `reweigh` preserves earned amounts by moving owed to carry and resetting debt.
- The host unit tests cover 260 epochs (4 ring wraps) with randomized buys, early retires, and expiries.

No finding.

---

## R3. The level draw

SlotHashes parsing is correct (count bounded to 512, data length checked, all-zero hashes rejected). The three-hash construction (A, B, C with 2-group stride) is implemented correctly. FIFO is enforced by `index == revealed_total`. Burned vaults at the head of the queue still draw (skipping the Core update). The attribute re-supply hash prevents tampering. Reschedule sets a future slot. The leader-of-C grinding residual is accurately stated in SPEC 26 and the holder guide.

No finding.

---

## R4. Governance

Quorum, threshold, turnout, and key-change requirements are correctly implemented. The electorate is fixed at creation (`index_snapshot`, `quorum_supply`). Key changes need 50% of snapshotted live supply. The guardian cannot cancel its own replacement. TightenSweep is monotone and bounded. Overtaken actions are skipped, not reverted.

No finding.

---

## R5. The charter claim

Merkle proof is domain-separated and sorted. The PoB is burned by CPI in the same instruction. The window is fixed at initialize. The `pob_extra` pass-through handles benign hooks. The hot-wallet risk is accurately stated in SPEC 46 and the holder guide.

No finding.

---

## R6. One-time configuration and trusted hop

Initialize checks are thorough. The 10% royalty is a Core plugin with authority None (immutable; tested R.6). The redemption cap is a correct rolling window over a 64-slot ring. The swap operator is capped, cooled down, and stoppable.

No finding.

---

## R7. Cross-program raw reads

I recomputed every offset against the struct definitions. All offsets in GOV, BURN, and MINT reading SEAL/MINT/BURN configs are correct. The VaultRecord offsets are correct. The sweep helper's token account offsets (mint 0, owner 32, amount 64, length 165) match the classic SPL layout.

No finding.

---

## R8. Suite, simulation, and build

The suite uses `because()` to pin rejection reasons, preventing wrong-reason false passes. The build proves byte-identical sweep helper and correct INIT_AUTHORITY in both directions. The simulation runs against real cloned Core and real mints. The coverage gate (`audit-coverage.sh`) checks content hashes against completed quorate rounds.

No arms that cannot fail were found. The floors equal the counts.

No finding.

---

## Accepted limits — the four questions

**1. Is any limit WORSE than stated?** No. I checked each accepted limit against the code. The rescue_nested change (item 58) correctly narrows limits 9 and 44 for nested vaults. The sweep helper's coverage (limit 44) is accurately scoped.

**2. Is anything listed as a limit not actually a limit?** Minor documentation inconsistency in limit 44: the "Not covered" list still includes "nested Core assets," but the parenthetical "(a nested vault itself is no longer lost: item 58)" correctly notes the rescue. The sweep helper indeed cannot sweep nested Core assets (it only handles token accounts), so the "Not covered" list is technically accurate for the helper. The rescue is a separate mechanism. Recommend clarifying the wording to avoid confusion, but this is not a security issue.

**3. Is any DISCHARGED item not actually discharged?** No. The discharged items (Bank-related, deck-related, compute units, duplicate attributes, etc.) are genuinely gone or measured closed.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are genuinely open. Item 50's web pages are built but staged (not published), and the holder guide is DRAFT. The ceremony's `vault_collection` is OPEN in `launch/mainnet-init.json` and the checker refuses it.

---

## Web pages (item 50, new in this pass)

The adversarial review (REVIEW-web.md) found one HIGH and four MEDIUM issues. I verified all confirmed items were fixed:

- **H1 (stranger blocking openings):** Fixed. The redeem page no longer refuses on non-reserve issues; it requires a ticked acknowledgement. The Groups plugin (type 18) is handled gracefully in `decode.mjs`. Verified in the code and tests.
- **M1 (RPC proxy open relay):** Fixed. The proxy now requires an Origin header, checks Sec-Fetch-Site, validates getProgramAccounts filter bytes strictly, caps responses while streaming, and keys IPv6 by /64. Verified in `rpc-proxy.mjs` and `proxy.test.mjs`.
- **M2 (ceremony resume):** Fixed. The ceremony now discovers collections on chain via `collectionsOfMint` and stops on conflict. Verified in `ceremony-reads.mjs`.
- **M3 (bundle leaks key paths):** Fixed. The build strips `source` fields from launch values. The bundle test greps for key paths. Verified in `build.mjs` and the generated `launch.json`.
- **M4 (ceremony signs what the site serves):** This is an operational concern. The local ceremony mode (`ceremony-local.mjs`) mitigates it by serving from localhost over an SSH tunnel. The recommendation to independently decode the signed message before signing remains valid (see final section).

The offline tests (457 assertions) and end-to-end test (80 assertions) are non-vacuous: they compare the pages' builders byte-for-byte against the suite's builders and drive the library code on a local validator. The buy page is covered by byte tests and a mock-RPC browser run but not a full end-to-end test (no voted round in the harness); this is noted in VALIDATION.md.

**LOW finding (web, wording):** The buy page states "You pay exactly \<price\>," but the program charges the live price, which can only be equal to or lower than `max_price`. This overstates the certainty. Recommend changing to "You pay at most \<price\>." Not a security issue.

**LOW finding (web, wording):** The vault page describes a rescued vault as "The multisig returns it to whoever sent it in." This is a manual process, not automatic. Recommend clarifying that the return is a human action by the Squads, paged by the alarm. Not a security issue.

---

## Findings summary

| # | Severity | Construct | Finding |
|---|---|---|---|
| W1 | LOW | `web/src/pages/buy.mjs` | Buy page says "You pay exactly \<price\>" but the program charges at most `max_price`. Wording overstates certainty. Evidence: the page text vs. MINT's `PriceAboveMax` check. Fix: change to "at most." |
| W2 | LOW | `web/src/pages/vault.mjs` | Rescued-vault description implies automatic return. The return is a manual Squads action. Evidence: item 58 states "the return is a person's act from the Squads." Fix: clarify wording. |
| D1 | INFO | SPEC limit 44 | "Not covered" list includes "nested Core assets" while the parenthetical notes rescue_nested handles them. Technically accurate for the sweep helper but potentially confusing. Fix: clarify that nested vaults are handled by rescue, not the sweep. |

No CRITICAL or HIGH findings. No theft, unseal, payout mis-accounting, or permanent distribution block found.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

The following are things AI audit structurally cannot do, and which must be done before launch:

1. **Run the mainnet dress rehearsal with real funds (item 22).** AI cannot exercise the crank, alarm, and revenue cycle against a live cluster. The rehearsal must include one full live revenue cycle through both pools (Orca and Meteora fallback), one forced post-sweep failure walked through hand recovery, and the crank's live passes. This is the single most important remaining step.

2. **Physically verify hot-key security.** AI cannot inspect the box holding `bank/keys/cbob-release.json` (all 2.1B $CBOB), `bank/keys/swap-operator.json`, and `bank/keys/deploy-authority.json`. Verify file permissions (600), confirm they are in the nightly encrypted offsite backup, and confirm no other copies exist. The deploy-authority key is especially critical: losing it before step 11's `--final` means new program ids, which is a program change.

3. **Test the pages in a real browser with a real wallet.** AI ran the pages against a mock RPC and a local validator, but not through Phantom on a phone or desktop. The claim, buy, redeem, and ceremony pages must be exercised end-to-end with a real wallet signing real transactions, including the Phantom in-app browser on a phone (the `openInPhantomLink` path).

4. **Independently decode the ceremony's signed message before signing.** The ceremony signs immutable initialize values. AI cannot protect against a tampered `app.js` served by the site or edge cache. Before Gary signs, run a CLI tool that decodes the transaction's instruction data and re-runs `judgeLaunch` on the bytes, confirming every value matches the ruling. Do not rely on the page's own dry-run output.

5. **Verify the Squads multisig configuration and test the rescue-return process.** The Squads (`bc92Z…`) is the destination for all rescued vaults and the 15% treasury. AI cannot inspect the Squads signer set or threshold. Confirm the signer set, test that the Squads can transfer a rescued vault back to its sender, and establish a runbook for `vault_awaiting_return` pages. Confirm the Squads will not vote with held vaults.

6. **Set the charter opening date and lock deadline (item 38).** These are the two remaining OPEN values. The charter date must be set before the ceremony, and the lock deadline must be before `charter_opens_at` so nothing holds value under an upgradeable program.

7. **Verify the Cloudflare and nginx configuration.** AI read `nginx-rpc.conf` and the site's headers, but cannot test the live Cloudflare edge. Confirm the `/rpc` location is correctly proxied, the rate limits are active, and the `X-Frame-Options: DENY` and CSP headers are served. Confirm the `v/` directory is served before step 0 (the collection URI becomes permanent on chain at step 0).

8. **Test the alarm's notification delivery.** AI verified the alarm's detectors and streams, but cannot test that SMS/email notifications actually reach Gary. Fire a test alert and confirm delivery. Confirm the `crank_silent`, `royalties_unswept`, and `vault_awaiting_return` pages route correctly.

9. **Confirm the upgrade-authority removal sequence.** Road steps 9–11 must be followed exactly: step 9 upgrades and verifies (no `--final`), step 10 re-verifies then initializes, step 11 verifies, makes final, verifies again. AI confirmed the SPEC text is now consistent, but the actual execution must follow this order. The deploy-authority key must be available for steps 9 and 11, and securely destroyed or archived after step 11.

These nine items are the irreducible human work remaining. The programs and off-chain code are in strong shape; the risk now concentrates in the operational deployment, the hot keys, and the live rehearsal.