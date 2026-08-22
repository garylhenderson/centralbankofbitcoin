# ROUND 6 — FINDINGS

Prior fixes verified real, not relocated: lifetime cap is read in `mint_vault`; BURN reads reserves from SEAL config; `mark_opened` filters-then-appends; classic-SPL check fires at config time; treasury rotation requires governance in both paths; cross-program reads are discriminator-AND-version pinned and I re-derived every offset (SEAL 8/9/41/73/105, MINT 8/9/41/73/105/137/205/213/221/253/255/256/288) — all consistent across MINT, BURN, GOV, alarm.mjs, revenue.mjs.

## F1 — HIGH: The completeness reconcile that BURN's safety argument depends on does not exist

`programs/cbob-vault-burn/src/lib.rs` header: "plus the off-chain scanner, which uses `getTokenAccountsByOwner` and DOES see non-ATA accounts." **No shipped file calls `getTokenAccountsByOwner`.** Not alarm.mjs, not distribute.mjs, not revenue.mjs. The alarm's own footer admits it only tails program signatures.

Why this is the load-bearing gap: anyone can create a token account **owned by a vault PDA** without the PDA signing (owner is just a field on initializeAccount3), and anyone can deposit into it. `burn_vault` checks only *declared* accounts; an undeclared account's value is destroyed with the vault. The Bank's simulation cannot see it (the account isn't in the tx). The only possible detector is a state reconcile — `getTokenAccountsByOwner(assetSignerPDA)` diffed per pass — and it isn't written. Worse, a standalone creation tx touches only the Token/ATA program, so it never appears in any of the five `getSignaturesForAddress` scans either: `detectPdaTokenAccounts` can only see creations nested inside SEAL/MINT/BURN/GOV/CORE txs. By the time `detectBurns` fires HIGH, the burn is already irreversible.

**Fix:** add to alarm.mjs a per-vault `getTokenAccountsByOwner(pda, {programId: each token program})` diff against the canonical-ATA set; alarm CRITICAL on any non-canonical account, and gate burns operationally on a clean reconcile.

## F2 — HIGH: The alarm's Core scan is structurally blind on mainnet, and failed reads pass silently

`bank/alarm.mjs` main loop: `getSignaturesForAddress(prog, { until: prev.lastSignature, limit: 200 })` for `CORE`. On mainnet, Metaplex Core processes far more than 200 txs per 30-minute pass. `until`-pagination returns the **newest 200**; the older-but-unseen band is permanently skipped next pass because the cursor advances to the newest. A bare `BurnV1` of a vault — the exact proven-impossibility this detector exists for — is one tx among thousands; probability of landing in the sampled 200 is ~0. This works on the local validator only because local Core volume is tiny. The report then prints "no … burns" — a claim of coverage the sampling cannot support.

Two adjacent silent-pass bugs: `if (!tx) continue` consumes a signature (cursor moves past it) when `getParsedTransaction` returns null — an RPC hiccup permanently hides that tx's instructions. And in `readConfigs`, a null `getAccountInfo` (transient RPC failure is indistinguishable from "not deployed") makes main() print "mint config not initialised — nothing to watch yet" and **exit 0 with no notification** — a failed read reported as a quiet pass.

**Fix:** drop the program-level Core scan; use per-asset `getSignaturesForAddress` (or Helius webhooks — the RPC is already Helius) for vault assets; treat null tx fetches as pending, not consumed; distinguish "read failed" from "account absent" with a retry.

## F3 — HIGH: distribute.mjs can double-pay customer cbBTC

`bank/distribute.mjs`: the "one distribution per UTC day" guard is `st.days[day] ||= { paid: {} }` — a read-then-write on a JSON file with **no lock**. Cron (09:07) plus a manual run (the exact scenario the ops runbook invites) both load the same state, both see `done == {}`, both pay every vault; the second `save()` also clobbers the first's records. Second path: `done[v] = {...}; save(st)` is written **after** `sendAndConfirmTransaction` returns. A confirmation timeout on a tx that actually landed throws → catch → exit 3 → vault unrecorded → any re-run same day re-pays it. The header's claim "recorded BEFORE the next one starts, so a crash halfway resumes instead of redoing" is true only for crashes *between* transfers, not between landing and recording.

**Fix:** `flock` a lockfile; write a pending intent `{asset, amount, sig: null}` *before* sending; on resume, look up the sig and only re-send if genuinely absent.

## F4 — HIGH: The "50 SOL cap" on the trusted hop is enforced nowhere on-chain, and the operator cannot be rotated

`sweep_sol_for_swap` is permissionless with caller-chosen `amount`, bounded only by `bal >= keep + amount`. Anyone can move the **entire** sweepable treasury to the pinned operator in one transaction. The 50-SOL bound exists only as `MAX_PER_CYCLE_LAMPORTS` inside revenue.mjs's own calls. Meanwhile `update_wiring` accepts bank/governance/treasury/admin/max_supply/bank_treasury/split_bps — **not `swap_operator`, not `sol_reserve_lamports`**; both are initialize-only and immutable. So the stated model — "a compromised operator key is capped at one cycle's worth" — is false: a thief (or any griefer, since the sweep is permissionless) can push the whole treasury to the operator address in one tx, and there is no rotation path; the only response is `set_paused`, which stops *future* sweeps after the money has moved. The cap's real value was detection latency (alarm fires with only 50 SOL gone); this removes it.

**Fix:** on-chain per-sweep maximum and/or cooldown slot stored in config, and make `swap_operator` rotatable (admin + governance, like treasury).

## F5 — MEDIUM: detectApprovals likely never fires on real mainnet parses

`bank/detectors.mjs` `detectApprovals` keys on `ix.parsed.info.owner`. Real `jsonParsed` SPL-Token `approve`/`approveChecked` responses expose `source`, `delegate`, `amount`, `signers` — I could not confirm `owner` is among them, and the selftest feeds a synthetic shape that includes it. If it's absent, `pdaSet.has(undefined)` is false and the delegate-survives-the-re-seal detector — the only coverage for the thaw-window delegate attack — is a production no-op while the selftest stays green. This is the codebase's own stated failure mode: a gate that has only ever said "quiet" is untested.

**Fix:** resolve the owner by looking up the `source` account (or use `signers`), and add one test case built from a real mainnet approve tx's parsed JSON.

## F6 — MEDIUM: set_collection_royalties is an untested hand-built Core CPI

Discriminators `IX_ADD_COLLECTION_PLUGIN_V1 = 3` / `IX_UPDATE_COLLECTION_PLUGIN_V1 = 7` are the only Core opcodes in the codebase never exercised by the suite (CreateV2=20, BurnV1=12, UpdatePluginV1=6 all are). The args layout (plugin tag 0, u16 bps LE, u32 vec len, Creator{pk,u8}, RuleSet tag 0, trailing Option tag on add-only) is consistent with the validated `PLUGIN_ATTRIBUTES=6` ordering, so I will not claim a specific wrong byte — but per this repo's own rule, an untested path is not a path, and the failure modes include landing on a *different* instruction if the constant is wrong. Also, `add: bool` forces the admin to guess whether the plugin exists; picking wrong fails the CPI (fail-closed, but a footgun).

**Fix:** add it to the 82-assertion suite against real cloned Core before mainnet, both add and update paths, or remove it until tested.

## F7 — MEDIUM: The revenue ledger is self-attestation, with a crash window that hides a sweep

`--audit` and `detectUnreconciledRevenue` reconcile against the same local JSON the script writes; nothing cross-checks `SolSweptForSwap` events or the revenue ATA balance on-chain. If the box (or the operator key holder) edits the ledger, the reconciliation lies. Crash window: `cycle.sweptLamports` is saved only *after* the sweep confirms — a kill between confirm and save leaves SOL gone from the revenue PDA with a ledger entry lacking `sweptLamports`, which the detector explicitly skips. Nothing stops starting a new cycle while an old one is unreconciled, stacking exposure.

**Fix:** alarm should independently derive sweeps from on-chain events and compare to the ledger and the revenue ATA balance; write the sweep intent before sending.

## F8 — MEDIUM: distribute.mjs never checks distributor key == config.treasury

revenue.mjs asserts `operator.publicKey == config.swap_operator` and refuses otherwise. distribute.mjs — the thing that pays the holders' 85% — reads no such pin: it pays from whatever key sits in `keys/distributor.json` while `split_revenue` sends to `ATA(config.treasury)`. If treasury is rotated (governance) or initialized to a different address, the 85% accumulates at the config address while distribute reports "no cbBTC to distribute" forever — a silent halt, or stale-wallet payouts. Two sources of truth, no cross-check, asymmetric with the sibling script.

**Fix:** load config.treasury and throw unless it equals the distributor pubkey.

## F9 — MEDIUM: re-running cron-install.sh silently un-`--live`s the revenue cron

`grep -v 'cbob-vaults/bank'` strips the existing lines and re-adds them from the heredoc — **without** `--live`. An operator who added `--live` in production, then re-runs the installer for any reason, silently stops the revenue cycle; distributions dry up with no alarm (nothing is "unreconciled" — nothing was swept).

**Fix:** preserve/warn on modifications, or move `--live` to a state file the installer doesn't own.

## F10 — MEDIUM: build-mainnet.sh proves INIT_AUTHORITY for one of four binaries

`ask()` deploys and interrogates only `cbob_vault_mint.so`. SEAL, BURN and GOV carry the same localnet/mainnet `INIT_AUTHORITY` fork and ship unverified. The two-build control itself is sound (I tried to make both answer the same wrong way; the ACCEPTS control defeats a vacuous REJECTS) — it just doesn't cover 3 of 4 artifacts.

**Fix:** loop the initauth test over all four programs.

## LOW (compressed)

- `split_revenue` comment inverts its own rounding: holders get the floor, Bank takes the remainder, so sub-unit dust rounds **in the Bank's favour** — dust, but the comment claims the opposite.
- `paused` gates `sweep_sol_for_swap` but not `split_revenue`; neither doc mentions the asymmetry.
- GOV: no proposal expiry or cancel (a passed proposal is executable indefinitely while quorum holds); quorum is measured against ever-minted supply, so burned vaults permanently inflate the denominator; minting between voting-end and execute can block a ratified proposal (griefing at mint price). All design-level, none enable theft — I could not make the CPI escape MINT's bounds.
- `run-tests.sh` default suite is `3prog.test.ts` — confirm GOV and the revenue instructions are actually in the default path; a green run that skips them proves nothing about them (and per F6, royalties is definitely skipped).
- Keys, ledgers and state files are never `chmod 600`; logs with balances/config go to world-readable `/tmp`.
- Dead `OwnerWouldBrick` variant; GOV's layout comment places `bump` at 221 (actual 296) — unread, but stale.

# WHAT I TRIED AND COULD NOT BREAK

- **split_revenue redirection:** fake mint, wrong `decimals`, hostile destinations, fake token program — all killed by ATA derivation from config addresses, the `SPL_TOKEN_ID` account constraint, and TransferChecked's mint/owner checks. A stale delegate on the source is irrelevant (owner signs). Balance 0/1/u64::MAX all behave; the two transfers sum to `total` exactly.
- **sweep destination:** caller-supplied `swap_operator` fails `require_keys_eq` vs config; reserve arithmetic is overflow-checked.
- **Double-vote:** VoteRecord is PDA-seeded by asset, owned by GOV, and no close instruction exists — transfer-then-revote hits an existing account; burned/foreign/PDA-owned assets all fail `read_core_asset` or the signer check.
- **Double-execute / stale-execute:** `executed` is set before the CPI and reverts atomically with it; failing proposals cannot be burned because quorum/threshold checks precede the flag.
- **Governance CPI escape:** `set_round` re-validates window/cap; `mint_vault` independently enforces `max_supply`, round window, and the Bank co-signature — a hostile majority cannot mint past the cap or touch existing vaults' plugins.
- **distribute `allocate()`:** pure, floor keeps the remainder, deterministic order, proven both directions by its selftest.
- **Config offset pins:** re-derived field-by-field for all four programs and all three raw readers — no misread exists today.

# THE SINGLE THING

**Make distribute.mjs's payment ledger write-ahead and locked** (pending intent with signature before sending, reconcile-by-signature on resume, `flock`). It is the only component that moves customer cbBTC automatically every day, its current crash and concurrency semantics silently double-pay, and it needs no attacker — one confirmation timeout is enough. F1's missing reconcile is a close second and should land in the same release.