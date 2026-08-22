# ROUND 12 — FINDINGS

## 1. HIGH (deterministic) — `bank/revenue.mjs`: the operator-ATA guard is AFTER the sweep, and its own comment says it isn't

```js
cycle.sweptLamports = String(amount); save(led)          // <-- up to 50 SOL has MOVED
// "It is checked here, before anything moves."           // <-- false
const opAtaAddr = getAssociatedTokenAddressSync(CBBTC, operator.publicKey)
const opBefore = requireTokenAmount(await conn.getAccountInfo(opAtaAddr,'confirmed'), ...)
```

Round 11 replaced `?? 0n` with `requireTokenAmount`, which **throws on ABSENT**. An absent operator cbBTC ATA is the *normal* state of (a) the first `--live` run on a fresh deployment and (b) every run after an operator rotation — the flow rounds 10/11 deliberately built a notice period for. Sequence: intent row written → sweep confirmed (SOL gone) → `requireTokenAmount` throws "does not exist" → cycle left with `sweptLamports` and no return → `unreconciled_swap` CRITICAL after the grace, and **every later run dies at the open-cycle guard** until a human hand-resolves. The comment names a compensating control (ordering) that the code does not implement; the repair converted a normal condition into a fault located after the money moved.

**Fix:** move the read (and an idempotent ATA creation for the operator) above the intent write and the sweep; keep `requireTokenAmount` only for `foreign`/`malformed`, and treat `absent` as "create it, then it is 0".

## 2. HIGH (rare, but it is the exact failure this file exists to prevent) — `bank/lock.mjs`: an unreadable lock is broken with no liveness check and in silence

```js
try { held = JSON.parse(fs.readFileSync(file,'utf8')) } catch { /* treat by age */ }
const age = now - Date.parse(held?.at || 0)        // Date.parse("0") == 2000-01-01 → age ≈ 26y
if (Number.isFinite(age) && age < staleMs) return {ok:false}      // skipped
if (held?.pid && alive(held.pid)) return {ok:false}               // SKIPPED: held is null
try { fs.unlinkSync(file) } ... writeFileSync(file, payload, {flag:'wx'})  // WE WIN
return { ok:true, broke: held /* = null */ }        // → withLock prints NOTHING
```

Three things compose. (a) `acquireLock`'s own write is `open(O_CREAT|O_EXCL)` **then** `write` — two syscalls, so the file is observable at length 0 by another process. (b) A reader that cannot parse it skips *both* the freshness gate and the liveness gate and breaks it. (c) Because `broke` is `null`, `withLock` prints no warning — the "SAY SO" promise fails on exactly the break that is unsafe. Result: runner B steals a lock a *live* runner A holds, both hold in-memory copies of `distributions.json`, and vaults are paid twice. Same hole for any hand-truncated or foreign lock file.

Also: `releaseLock` returns `true` on `ENOENT`, so "my lock was broken out from under me and the thief already finished" prints nothing either.

**Fix:** unparseable/zero-length lock ⇒ **refuse** (`ok:false, unreadable:true`), never break; write the payload to `file.tmp<pid>` then `link()`/`rename` so the lock is never observable empty; report every break, including `broke: null`.

## 3. MEDIUM-HIGH — `bank/sigwalk.mjs` + alarm cursors: a poisoned sentinel makes the scanner silently blind again

The alarm advances `cursors[id] = sigs[0].signature` from a **`'confirmed'`** read. Round 6's own measurement is that an `until` the RPC cannot resolve returns an **empty list**. So a cursor whose transaction is later forked out (or pruned by a provider rotation) yields `{sigs:[], gap:false}` on every subsequent pass: no findings, no gap, cursor never advances (`sigs.length` falsy), and `report()` prints *"no approvals, no unexpected PDA token accounts, no burns…"*. That is the round-6 defect in a new shape, and nothing in the pipeline notices `looked.txs === 0` while four cursors are set.

**Fix:** take the cursor from a `'finalized'` query; each pass, if a program returns zero signatures and `getSignatureStatuses([cursor])` cannot resolve it, raise CRITICAL and refuse to trust the window.

## 4. MEDIUM — `tests/3prog.test.ts` 5.2 is vacuous, and it is round 11's defect (2) again

```js
{pubkey:bPda,isSigner:true,...}   // signers: [bank, brickAsset]
```
web3.js refuses to serialize a transaction missing a required signature, so **the program is never invoked**. Test 5.2 ("mint a vault owned by a PDA that can never sign → REJECT") would pass identically if `owner` were an `UncheckedAccount`. It has no `because()`. Neither do **1.1** (non-governor sets the round — the gate on the price strangers pay) or **2.5**. And there is **not one negative assertion on `split_revenue`'s account pinning** — the only instruction that can move cbBTC out of the revenue PDA has no test passing an attacker's `holders_ata`/`bank_ata`/`revenue_ata`.

**Fix:** pass `bPda` with `isSigner:false` and assert `AccountNotSigner`; add `because` to 1.1/2.5; add three `WrongTreasury` negatives on `split_revenue`.

## 5. MEDIUM — the bound on the bound has zero daylight, and nothing watches the money that is *not* moving

`MIN_ADMIN_SWEEP_LAMPORTS = 1 SOL` / `MAX_ADMIN_SWEEP_COOLDOWN_SECS = 24h` are also the watcher's thresholds (`cap < 1e9`, `cool > 86400`). Admin alone can set **exactly** cap = 1 SOL and cooldown = 24h; both standing checks stay quiet, and the cycle moves 1 SOL/day against an expected 50. Nothing anywhere watches the revenue PDA's **SOL balance** or the age of `last_sweep_at`; `revenue.mjs` exits 0 printing "Nothing to do". The wedge round 11 legislated against is therefore only detectable by proxies whose thresholds an admin can sit exactly on.

**Fix:** watcher floors strictly inside the program's (e.g. ≥ 5 SOL / ≤ 12h), plus a detector on `lamports(REVENUE) > X for > Y hours with no sweep`.

## 6. MEDIUM — round 11's "verify owner + discriminator before raw offsets" landed on **one of three** sites

`readConfigs` now pins owner and `acctDisc`. `revenue.mjs` (offsets 137/221/253/256/288/297/305/313) and `distribute.mjs` (41/137/205) still read `MintConfig` raw with only `if (!cfgAcc)` — a fourth copy of the offset map lives in the test suite. Not attacker-reachable (PDA of MINT), but it is the same class, in the two files that move money, and it is three lines each.

## 7. MEDIUM — `distribute.mjs` manufactures "ambiguous" out of every pre-send failure

The per-vault catch calls anything without `custom program error|Error Code|simulation failed|insufficient funds` **ambiguous** — including an RPC 429, a blockhash fetch failure, or `ataOf[v] === undefined` (reachable when a stored plan names a vault the current DAS page reports burnt but whose asset account still exists). Over ~2,100 sequential sends, transient RPC failures are near-certain, so the daily job manufactures CRITICALs that a human must resolve on chain, and each unresolved row means an unpaid vault. The signature is never written before the send, so a genuine timeout is only recoverable by scraping the truncated `error` string.

**Fix:** sign the tx, persist `sig` **then** send/confirm; classify "never submitted" as `rejected` (retryable).

## 8. LOW — poisoned vault ATAs are invisible to the watcher
`poisoned` goes to `console.error` only — no ledger field, nothing in `detectDistribution`. The vault reads as unactivated, is silently never paid, and the day still records `finishedAt`.

## 9. LOW — the has-run marker, on one of two sites again
The idle branch writes `state.json` but not `EVER`; the busy branch writes both. Pre-launch, `rm state.json` re-baselines silently — the round-10 dry-run/marker split, mirrored.

## 10. LOW — `COLLECTION_KEYS` reached `WATCHED_KEYS` but not `WATCH`
The four `*.collection` values are asserted *present* and compared *to each other*, but never diffed against the previous pass. Cross-program disagreement is caught; a simultaneous change is not.

# WHAT I TRIED AND COULD NOT BREAK

`splitByOther`: I could not manufacture the emptiness proof. Only MINT can sign the revenue PDA and only `split_revenue` moves tokens out; dusting `revAta` makes *our own* split **succeed**, not fail, so the false-proof requires a non-program failure *and* a non-empty ATA simultaneously. Split-sig reuse and the `splitByOther` anchor (N byOther cycles need N unclaimed splits) both hold, including across the horizon. `paymentState` ordering is right — `resolvedBy` above `rejected` — and the payout loop, the fee floor and the plan resume all use the one predicate. `VoteRecord` asset binding survives transfer, delegate and re-mint; quorum `max(snapshot, live)` with ceiling division and `MIN_QUORUM_BPS` cannot floor to zero; execution is monotone, windowed and cannot run post-cancel. `split_revenue`'s arithmetic sums exactly and floors toward the Bank; ATAs are all derived from config, never taken from the caller. All four `space =` calculations balance exactly with `CONFIG_PADDING` (SEAL 702, MINT 745, BURN 442, GOV 398), the MINT offset map matches `alarm.mjs` and the suite byte-for-byte, SEAL's pendings are correctly read past the reserve Vec, and Anchor's `deserialize` (not `try_from_slice`) tolerates the trailing zeros — the padding cannot brick a read. `_afterUnlink` is unreachable in production: no caller passes anything but `staleMs`. The vault mechanics absorbed another pass without moving.

# THE SINGLE THING TO FIX FIRST

**Move the operator cbBTC-ATA check (and its idempotent creation) above the intent row and the sweep in `bank/revenue.mjs`.** As shipped, the first `--live` cycle after any operator rotation moves real SOL and then aborts, wedging the entire revenue pipeline behind its own open-cycle guard — and the comment above the line asserts the opposite.