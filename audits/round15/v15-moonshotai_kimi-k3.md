# ROUND 15 AUDIT — FINDINGS

Ordered R1 → R2 → R3 → R4 → carry-over → verdict challenges → other → the structural answer.

---

## R1 — `bank/cosign.mjs`

### R1-1. CRITICAL — The judge constrains *which programs* are called, not *what the Bank's signature authorizes*. A customer can smuggle in instructions that spend the Bank's own authority, and the tool signs them.

**The exact construct.** `judgeRedemptionTx` (detectors.mjs) refuses extra instructions to `cfg.sealProgram` and `cfg.burnProgram` — and nothing else:

```js
for (const ix of ixs) {
  if (ix === open || ix === burn) continue
  if (ix.programId === cfg.sealProgram || ix.programId === cfg.burnProgram) { bad.push(...) }
}
```

It never inspects the **signer set** of the transaction: not the `isSigner` flags on other instructions' keys, and not the fee payer. But `tx.partialSign(bank)` signs the *whole message*. A Solana signature authorizes every instruction in it.

**What a redeeming customer can append to a well-formed redemption that this tool blesses:**

1. `SystemProgram.transfer({ fromPubkey: bank, toPubkey: attacker, lamports: <all> })` with the Bank marked `isSigner` — **drains the Bank's SOL wallet.**
2. `transferChecked` / `closeAccount` / `approve` on any token account the Bank owns, Bank as authority — **drains or delegates anything the Bank holds.**
3. **MINT's `mint_vault`** — which *requires* `bank: Signer<'info'>`. The Bank's signature on the redemption transaction satisfies it. This bypasses the Bank's two written mint duties in SPEC ("refuse to co-sign a mint while a proposal's voting window is open" and "refuse a charter-priced mint not backed by a burned Proof of Burn") — the co-signer judges the redemption pair and never looks at the mint. The Bank co-signs an uninspected mint.
4. `ComputeBudgetInstruction.setComputeUnitPrice({ microLamports: <huge> })` with the **Bank as fee payer** — the Bank pays an arbitrary priority fee.
5. Any third-party program instruction naming the Bank as signer.
6. The same via a **CPI wrapper**: a wrapper program that CPIs `mint_vault` with the Bank's account marked signer in the wrapper's top-level keys. The runtime accepts the Bank's transaction signature for the inner call. (This variant is *also* caught by the fix below, because the wrapper's instruction keys must mark the Bank as signer.)

**Evidence that would exist if I am right:** build `[open_for_redemption, sweep, burn_vault, SystemProgram.transfer(bank→attacker)]`, base64 it, run `judgeRedemptionTx` on its instruction list — it returns `ok: true` (no extra SEAL/BURN instruction; the transfer is to the System program). `cosign.mjs --tx … --live` then prints `SIGNED.` and emits a transaction that moves the Bank's lamports. The selftest block "the Bank's pre-signature judgement" contains **no assertion** that an instruction naming the Bank as signer is refused, none about the fee payer, and none about MINT. That absence is checkable in one grep: `grep -c "feePayer\|isSigner" bank/selftest.mjs` in the judge block → 0.

**The fix.** After the pair checks, enumerate authority: for every instruction in the transaction, refuse if the Bank pubkey appears in `ix.keys` with `isSigner === true` at any position other than `open.accounts[3]` and `burn.accounts[3]`; refuse if `tx.feePayer === bank`; refuse any `advanceNonceAccount` instruction (see R1-3). As defense in depth, refuse *any* instruction to MINT or GOV — the Bank has no legitimate business in this transaction beyond the pair. The policy should be: **the Bank signs a redemption and nothing else.**

---

### R1-2. MEDIUM — `scanPda` reads a missing or malformed DAS result as "the vault owns nothing," and coverage then passes vacuously.

```js
const j = await r.json()
if (j.error) throw ...
for (const it of (j.result?.items || [])) { ... }
```

If the HTTP response is 200 with a body that parses but has **no `result`** (a proxy/gateway error page in JSON, a truncated-but-parseable body, a provider-specific error shape that isn't JSON-RPC `error`), `j.result?.items || []` is `[]` → `owned` gets nothing → `judgeRedemptionCoverage([], declared)` → **ok**. The tool prints "every holding this scan can see is declared" about a scan that saw nothing. The header's own rule — "a refusal to answer is not an answer" — is implemented for the full-page case and the `j.error` case only.

The full-page guard (`items.length >= 1000`) is also the *only* truncation check, and it is not the only way the call can fail to answer: a proxy that caps page size below the requested `limit` returns a short page that reads as "end of list."

**Evidence:** stub `fetch` to return `{ jsonrpc:'2.0', id:'c' }` (no `result`) and `inspect()` returns `stage: 'clean'` for a vault holding real tokens. Fix: `if (!j.result || !Array.isArray(j.result.items)) throw`, and page until a genuinely short page instead of fetching page 1 once.

---

### R1-3. MEDIUM — No durable-nonce / blockhash check: the Bank's signed approval can be made non-expiring.

The tool never reads `tx.recentBlockhash`. A customer who builds the redemption on a **durable nonce** (first instruction `SystemProgram.advanceNonceAccount`) gets a Bank signature that is valid *indefinitely*, not for ~90 seconds. The header's honest caveat — "what it can see is one slot old" — becomes "valid until the customer chooses to execute," with the vault's contents free to change arbitrarily in between (the on-chain emptiness proof still protects *declared* accounts; everything undeclared is exposed for an unbounded window rather than a race-sized one).

**Evidence:** `judgeRedemptionTx` never inspects System-program instructions; a nonce-advance at index 0 passes. Fix: refuse any transaction containing `advanceNonceAccount`.

---

### R1-4. MEDIUM — The Bank is read from SEAL's config only; BURN keeps its own copy, and the two can disagree.

`inspect()` reads `bank` from SEAL's config (offset 73, pinned — good). But `burn_vault` enforces `ctx.accounts.bank.key() == burn_config.bank`, and *additionally* requires BURN's own copy to equal SEAL's (`WiringDiverged`). The two banks are rotated by *separate* admin instructions with separate notice periods, so they can disagree for days. In that state the co-signer checks both halves against the **SEAL** bank, signs, and the transaction fails on-chain at `WiringDiverged` — the tool has put the Bank's name on a doomed transaction, and its "bank on chain" line reports half the truth.

**Evidence:** arm (and land) a SEAL bank rotation without the matching BURN rotation; `cosign.mjs` signs; the transaction fails on-chain. Fix: read BURN's config through `pinnedAccountData` as well and refuse to sign unless the two agree.

---

### R1-5. MEDIUM — No permission check on the Bank key file. The one-of-N-sites defect, in the newest key-holder.

`revenue.mjs` and `distribute.mjs` both enforce `fs.statSync(KEYFILE).mode & 0o077 === 0` before reading a signing key. `cosign.mjs` reads `/opt/cbob-vaults/bank/keys/bank.json` — the single most sensitive key in the system once `--live` exists — with no mode check at all. This is the project's signature defect class (a control applied to N−1 of N identical sites) in the file that did not exist last round.

**Evidence:** `grep -n "statSync" bank/cosign.mjs` → nothing. Fix: the same three lines as the other two jobs.

---

### R1-6. LOW — No serialized-size check; the tool will sign a transaction that can never be transmitted.

A client that ignores the 9.14b requirement (destination ATAs in a *prior* transaction) and folds ATA creation into a 3-mint redemption produces a >1232-byte transaction. `Transaction.from` parses it fine, the judge passes, the scan passes, and the Bank signs bytes the network will never carry. Fix: `tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232` before signing — cheap, and it converts a silent operational failure into a refusal with a reason.

---

### R1-7. LOW — `scanPda` discards zero-balance token accounts; the alarm's own detector reports them.

`if (amount !== '0') owned.push(...)` — while `detectUndeclaredTokenAccounts` asserts "an undeclared account with a ZERO balance still fires (it is still destroyed)." The two completeness judgements in the same repository now disagree. The value at risk is the stranded rent (~0.002 SOL/account), so LOW — but the inconsistency will confuse the next reader of either file. Also: the PDA's own lamports are not scanned; if a vault has been griefed with SOL (9.10) and the customer's transaction omits the lamport sweep, the tool signs a transaction the burn refuses on-chain. A warning (not a refusal) is the right shape for both.

---

### R1-8. LOW — v0 transactions are unsupported, silently.

`Transaction.from` expects a legacy message; a versioned (v0 + ALT) message misparses or throws. It fails closed, and what the Bank signs is the re-serialized *legacy reinterpretation* (so judged == signed — no hole), but SPEC's own "fourth reserve mint" path is explicitly "a versioned transaction with an address lookup table" — which this tool can never co-sign. Either say so in the header, or `VersionedTransaction.deserialize` and refuse v0 with a clear error.

---

### R1-9. LOW — The declared list is never checked against the reserve ATA derivations.

The tool reads the SEAL config (it has `reserve_mints` at offset 105+) but never derives the 2×N reserve ATAs to confirm they appear in `declared`. A redemption missing one fails on-chain (`ReserveNotDeclared`) *after* the Bank has signed. Liveness only, but the co-signer has everything it needs to catch it.

**What the selftest assertions do NOT cover, enumerated:** Bank-as-signer elsewhere; fee payer; MINT/GOV instructions; CPI wrappers; durable nonces; v0; serialized size; zero-balance accounts; malformed DAS responses; SEAL/BURN bank divergence; reserve-ATA presence in `declared`; two redemptions (covered — refused); collection correctness (relies on-chain, acceptable).

---

## R2 — `bank/lock.mjs`

### R2-1. HIGH — The restore path is not exclusive in the three-process case, and the header now claims the TOCTOU is "CLOSED."

**Two racers:** exclusive, genuinely. A and B both judge the stale lock dead; `renameSync` is atomic; the loser gets ENOENT and returns `lostRace`. That part of the claim is true.

**Three racers — the interleaving that survives:**

1. Lock `L` is stale, token `T`, holder dead. A and B both read it, both pass the re-read.
2. B completes its *entire* break — rename, token match, `claim` — between A's re-read and A's rename. B now **holds** a fresh lock, token `T2`, and enters its critical section (starts paying).
3. A executes `renameSync(L, stolenA)` — renaming away **B's fresh lock**. A reads `stolenA`, sees `T2 ≠ T`, enters the restore path.
4. Between A's rename and A's `openSync(file, 'wx')`, the path `file` **does not exist**. C — the cron firing, a manual run — calls `acquireLock`, and its ordinary `claim` (atomic `link`) **succeeds on the empty path**. C holds, token `T3`, and enters its critical section.
5. A's `wx` fails `EEXIST` — **swallowed** (`catch { /* somebody already holds it; theirs stands */ }`). A then `unlinkSync(stolenA)` — **destroying B's lock content** — and returns `lostRace`.

Result: **B is mid-critical-section believing it holds `T2`; C holds `T3` and is running.** Two processes in the section this file exists to make singular. B's eventual `releaseLock(L, T2)` reads C's `T3`, mismatches, and `withLock` prints a warning — after the double payment, not before.

The window for step 4 is microseconds, and step 2's window is microseconds — but the entire stated purpose of this rewrite was that microsecond windows around money movement must be *zero*, and the header now reads "ROUND 14 CLOSED THE TOCTOU." It narrowed it (two racers → three racers, one window → two stacked windows). It did not close it.

**Second defect in the same path:** the restore's `openSync(file,'wx'); writeSync; closeSync` is not crash-safe. A crash between open and write leaves a **zero-byte lock**, which under the round-12 rule is a permanent *refusal* requiring manual intervention — a crash in the restore converts a live lock into an outage.

**Evidence that would exist:** the interleaving above is constructible with the existing seams plus a third process; the selftest covers restore-*success* (`_beforeSteal` injecting a replacement) but has **no case for restore-EEXIST** (no third process) and none for crash-in-restore. `grep -n "EEXIST" bank/selftest.mjs` → nothing in the restore path.

**Fix:** (a) restore with the same tmp-file + `linkSync` pattern as `claim` — atomic, fully-formed, no zero-byte window; (b) on restore-`EEXIST`, **do not unlink `stolen`** — preserve the evidence and `console.error` loudly; (c) correct the header to state the residual honestly; (d) the actual fix remains the one the header names: an OS lease on an open fd, where a dead holder's lock *cannot* be stolen because the kernel releases it, and no break path exists at all.

### R2-2. LOW — `releaseLock` returns `true` on ENOENT.

A lock that vanished mid-run (broken out from under a *live* holder via a pid-recycling false negative, or the race above) is indistinguishable from a clean release; the `withLock` warning never fires. The vanished-lock case is exactly the one worth a warning.

### R2-3. LOW — The selftest's no-litter assertion reads the wrong directory.

`fsx.readdirSync(fsx.existsSync(L) ? '.' : '.')` — both branches are `'.'`, while `L` is in `/tmp`. The `.breaking.` files the assertion hunts live beside `L`. The assertion passes vacuously no matter how much litter the restore path leaves. Fix: `readdirSync(path.dirname(L))`.

---

## R3 — Round 14's other repairs

### R3-1. MEDIUM — A malformed `acks.json` produces a `console.error` in a cron job. Round 12's own lesson: "a stderr line on a cron is not a report."

`readAcks()` handles present-but-broken correctly *as far as it goes* — it acks nothing (fails closed, good) and prints to stderr. But the alarm runs from cron; stderr lands in `alarm.log`, which nobody reads — the precise shape round 12 fixed for poisoned distribution ATAs by *persisting* them and raising a detector finding. A corrupted ack file means someone or something has been editing the mute button; that is worth a HIGH finding in the report, not a log line. Fix: `readAcks` returns the problem; `main()`/`reconcile()` push a finding (`acks_file_unreadable`, HIGH) into the list before `applyAcks`.

### R3-2. LOW — `applyAcks` keys on `f.asset`, but two detectors emit `pda` instead.

`detectApprovals` and `detectPdaTokenAccounts` return `{ kind, pda, ... }` with no `asset` field, so `applyAcks`'s `if (!f.asset || !f.kind) return f` makes those kinds **unackable** — e.g., a permanent `non_ata_token_account` condition can never be downgraded. Either key on `f.asset ?? f.pda` or state the restriction. The three kinds the mechanism was built for (`vault_owns_itself`, `nested_vault`, `unredeemable_owner`) all carry `asset`, so the mechanism works for its stated purpose.

### R3-3. LOW — `unredeemable_owner` fires on BURNT vaults.

The second loop of `detectNestedVaults` iterates `vaults` (live **and** burnt, deliberately for the nesting arm) without skipping burnt assets. A burnt vault owned by an off-curve address raises `unredeemable_owner` CRITICAL every 30 minutes — but a burnt vault can never be redeemed by anyone; the finding is noise on arrival. It is ackable, which mitigates; skipping `v.burnt` in the second loop is cleaner.

### R3-4. LOW — `validate-core-gate.sh`: no EXIT trap, and a 1/256 self-inflicted false failure.

(a) `die` during any arm leaves the validator running on :8999 — and ARM 1's validator has **no Core**, so a failed validation leaves behind exactly the environment the gate exists to reject. `run-tests.sh` has `trap cleanup EXIT`; this script needs `trap kill_v EXIT`. (b) `printf '\xff' | dd … seek=5000` has a 1/256 chance of writing the byte already present, producing an untampered file and a dying "FALSE PASS" that means nothing. Read the byte and write its XOR.

### R3-5. The `REDEMPTION_NOISE` allowlist — attacked, holds.

I could not construct a laundering. The correlation key (`burn_via_program`'s `accounts[0]`) is caller-supplied but **chain-verified on success** (burn_vault checks owner/collection on accounts[0]), and failed transactions are skipped by the walk (`if (s.err) continue`), so a fake `burn_via_program` cannot be manufactured without the Bank's signature on a real redemption. Per-asset correlation stops a genuine redemption covering a bare burn beside it (selftest proves both directions). The four allowlisted kinds are exactly what a redemption legitimately produces; `approve_by_vault_pda`, `nested_vault`, `undeclared_token_account`, `vault_left_index` stay loud. No finding.

### R3-6. Floors — verified, with the structural caveat stated.

DET_FLOOR=275, selftest FLOOR=275, ALLOC_FLOOR=17, MIN_ASSERTIONS=267 — internally consistent with the suite output strings the runner greps. The `|| RC=$?` capture fix is correct under `set -e`. Caveat worth writing down: floors **count** assertions; they do not judge them. Weakening an assertion's expected value keeps the count. That is not a defect — it is the boundary of what a floor is — and it is currently unstated.

---

## R4 — The comments

The new drift direction the prompt predicted is present: **comments denying a control that now runs.**

- **R4-1 (MEDIUM, seventh round of the class):** SEAL's header — "The Bank's co-signature could refuse in the moment … but **NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.** Nothing scans before it signs, because nothing signs. Until that is built, the pre-signature control is a human procedure, not a control." `bank/cosign.mjs` exists. SPEC's control table lists it. SEAL's header contradicts both.
- **R4-2 (MEDIUM):** BURN's header — "**no Bank co-signing tool exists in this repository**, so nothing scans before it signs. The pre-signature refusal is a human procedure until one is built." Same defect — and the "CANNOT prove completeness" paragraph *in the same file* was repaired to point at SPEC's table while the header two paragraphs above was not. One-of-N-sites inside a single file.
- **R4-3 (MEDIUM):** SPEC, Proven Impossibility 2 — "…which today is two post-hoc detectors and, explicitly, NOT the Bank co-signature, **because nothing in this repository signs a redemption**." Contradicts SPEC's own control table two sections away, which lists `bank/cosign.mjs` as the pre-signature control. This is the exact sentence shape round 14 claimed to have fixed.
- **R4-4 (MEDIUM):** `detectNestedVaults` docstring — "a FOREIGN Core asset nested inside a vault … ⚠️ **NOTHING DOES IT**." `cosign.mjs`'s `scanPda` does precisely it (DAS `getAssetsByOwner` on the PDA, pre-signature). SPEC's table says the co-signer catches it; the detector comment says nothing does. The alarm-side gap is real; "NOTHING" is not.
- **R4-5 (MEDIUM):** `lock.mjs` header — "ROUND 14 CLOSED THE TOCTOU THIS PARAGRAPH USED TO ADMIT." The code narrows it to a three-process interleaving (R2-1). The comment claims more than the code delivers — the question the prompt explicitly asked.
- **R4-6 (MEDIUM):** `cosign.mjs` — "Asserted against the suite's own builder in 3.1c-3.1f." 3.1c–3.1f assert the account *indices* 0 and 2 out of the program sources. **Nothing asserts `BURN_FIXED_ACCOUNTS = 11` against anything** — grep the suite for it: absent. The comment names a control that does not run, in the file written to end that class. If BURN's account list grows, the count drifts silently; the claimed tripwire does not exist.
- **R4-7 (LOW, carry-over #6 confirmed and worse):** SPEC's stale numbers are now wrong in at least six places: "178 assertions" (267), "93 detector and 14 allocation" (275/17), "10 allocation assertions" (17), "The 264-assertion suite" in the SHIP GATE table (267), "(69 assertions)" for selftest (275), "Thirteen rounds" ×2 (fourteen). VERDICT.md's STATE line says "250 detector" against a floor of 275 — the same document that says "every floor equals its real count." And the sweep-authorisation contradiction survives in **two** places: the revenue table ("who: permissionless") and "The sweep is bounded IN THE PROGRAM. `sweep_sol_for_swap` is permissionless" — the code has required the operator's signature since round 7.

---

## Carry-over list

1. **Cross-pass correlation lag** — confirmed open, not worse. `correlateBurns` still has no memory; a burn the signature walk reaches a pass late leaves the CRITICAL already sent. The suggested fix (a short memory of recent `burn_via_program` assets) remains unbuilt.
2. **Compute units unmeasured** — confirmed open, and now load-bearing: 9.14b's operational advice (ATA creation in a prior transaction) assumes bytes are the only constraint. A 3-mint redemption's CU cost is unknown, and the suite could measure it cheaply — simulate `sizeFor(3)` and read `meta.computeUnitsConsumed`. Until that number exists, `MAX_RESERVE_MINTS = 3` rests on one of two ceilings.
3. **`prog.*.hash` offset 45** — confirmed, not worse: for an authority-less program the hash covers the wrong 32 bytes but is *stable*, so the watch still functions; a later authority removal changes the hash and fires CRITICAL, which is arguably the desired signal.
4. **Foreign nested asset** — improved, not worse: the co-signer closes it pre-signature; the alarm-side gap remains, and the detector comment now misstates it (R4-4).
5. **`burn_via_program` caller-supplied key** — not worse than stated; see R3-5. The key is chain-verified on success and failed transactions are skipped.
6. **SPEC contradictions/stale counts** — worse than stated; see R4-7 (six stale counts, two surviving "permissionless" claims).
7. **MINT dead stamp / "strictly stronger"** — confirmed still present, unchanged.
8. **Payer-written ledger / no per-cycle operator wallet** — confirmed open.
9. **Duplicate attributes / vote-during-proposal / non-atomic reserve continuity** — confirmed open.

---

## Verdict challenges

- **Admin exemption from `detectBankIsNotSignable` — CONFIRMED correct.** Enumerated every admin instruction in all four programs: SEAL `update_config`/`cancel_pending`; MINT `update_wiring`/`set_paused`/`cancel_pending_*`; BURN `update_config`/`cancel_pending`; GOV `update_gov_config`/`cancel_pending_admin`. None uses instruction introspection; all are single calls a Squads vault signs by CPI. The only instruction that becomes unreachable when *governance* is a PDA is `set_collection_royalties` — a pre-existing, documented governance-PDA property, not an admin-PDA one. The rejection stands.
- **Closed-ATA delegate ALLOW (3.3a) — CONFIRMED safe.** The delegate does not sign the redemption transaction, so it cannot act inside it; after it, the account is closed and a re-created ATA is delegate-free.
- **The 9.14b written requirement** — sufficient for honest clients, and a client that ignores it fails *locally* (web3.js refuses to serialize), never on-chain — the safe direction. But note R1-6: the co-signer currently signs such transactions anyway; the ≤1232 check belongs in the tool.
- **Round 14's seven fixes:** fix 1 (validate-core-gate) carries R3-4; fix 3 carries R3-3; fix 5 (the comment repair) is **incomplete** — R4-1/2/3/4 are the same class surviving the repair for it, again; the lock rewrite carries R2-1. Fixes 2, 4, 6, 7 survive my reading.

---

## Other

- **R1-5 and R4-6 are the same lesson in the newest file:** the project's most reliable defect producer — a control applied to N−1 of N sites — appeared in the file that did not exist last round, twice (key-mode check; the asserted-nowhere constant). Whatever process reviews new files should grep *new* files for the *existing* control patterns as a matter of course.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Fifteen rounds of AI audit share three structural limits: the auditors reason but rarely execute; they see a bundle, not a system running; and each round audits the previous round's repairs, so the process measures *agreement*, never *attacker effort*. What answers those here:

1. **A canary deployment with sacrificial real funds.** SPEC admits the pipeline "has never run against a live deployment." Deploy all four programs on mainnet, mint one vault holding $100 of cbBTC, and run the *entire* operational loop against it for a month — alarm, reconcile, revenue cycle, distribution, co-signer. No audit round substitutes for the alarm paging at 03:00 about something real, or for discovering that `getAssetsByOwner` on the production RPC returns a shape the code mishandles (R1-2) before a customer's Bitcoin depends on it.
2. **Mutation testing of the suites, systematically.** This project's recurring disaster is tests that pass vacuously (9.14 compared a value to itself for a full round; 5.2 proved the wrong property; the no-litter assertion reads the wrong directory). A mutation harness — flip the `frozen` byte, delete the owner check, swap 85/15, off-by-one every offset — must turn the suite red, and the mutations that *don't* are the real test-suite findings. This is a different activity from writing assertions and no amount of re-reading replaces it.
3. **A fuzz harness against the four programs on the validator.** Random instruction sequences, CPI wrappers, substituted and duplicated accounts, extra trailing accounts, u8 boundary `declared` values — with invariants asserted (no thaw without burn, no burn without open, nothing leaves a sealed vault, no value created). AI rounds construct transactions by reasoning; a fuzzer constructs the ones nobody reasoned about.
4. **Operational drills, executed, not read.** The co-signer, the lock, and the ledgers are one-host, one-uid. An AI audit cannot: rotate the Bank key for real; `kill -9` a distribution at transfer 1,000 of 2,100 and resume it; delete `distributions.json` and watch the refusal; restore the box from backup. These are the failure modes the code was written around, and they have never been *performed*.
5. **Independent monitoring off the box.** The dead-man's switch emails Gary *from the box whose death it is supposed to report*. A heartbeat to a second host or an external dead-man service is the only arrangement in which "the box died" is a page rather than silence. No code change answers this; it is infrastructure.
6. **Second-party build reproduction.** `build-mainnet.sh` says the bridge is reproducibility — then have someone *else*, on a *different machine*, rebuild from the commit and compare sha256. A reproducibility claim verified only by the author on the author's box is an assertion, not a proof.
7. **Measure the SHIP GATE by effort, not by findings.** "Two consecutive clean rounds" certifies that eight models agreed twice. It says nothing about how hard anyone tried. A minimum adversarial budget — N hours of a tool-equipped model roster *executing* attacks on a validator, counted in attempts — is a gate an AI process can actually meet and a skeptic can actually read.
8. **Coverage ≠ scrutiny.** `audit-coverage.sh` proves a file was *in a prompt*. `cosign.mjs` was in this round's bundle and still held R1-1. A per-file finding ledger — which files have ever produced a finding under hostile reading, and when last — is a better proxy for "read with attention" than presence in a bundle.
9. **An economic review by the business.** Fifteen rounds check code against stated intent. Nobody checks intent against reality: whether 21,000 sats is the right activation line, whether the free charter round is being gamed, whether 85/15 survives contact with the actual revenue. That is not a code question and no model round answers it.