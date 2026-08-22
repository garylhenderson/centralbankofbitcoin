# ROUND 16 — INDEPENDENT AUDIT REPORT

Ordered by target. Every finding names the construct, the gain, the evidence that would exist if I am right, and the fix. Where I confirm the author, I say so plainly — this round's repairs are mostly sound, and the defects I found are in the seams around them, not in their cores.

---

## R1 — THE CO-SIGNER'S NEW REFUSALS

### R1.1 HIGH — The fee-payer arm is wired through an untested web3.js convenience property, and its fail-open direction is asserted as correct behaviour

**Construct.** `bank/cosign.mjs` → `inspect()`:

```js
feePayer: tx.feePayer ? tx.feePayer.toBase58() : null,
```

and in `judgeRedemptionTx`:

```js
if (cfg.feePayer !== undefined && cfg.feePayer === cfg.bank) { bad.push(...) }
```

The arm only fires if `Transaction.from(bytes)` populates `tx.feePayer`. Whether it does is **version-dependent web3.js behaviour**: `Transaction.from` sets `feePayer` from `message.accountKeys[0]` only in some releases; in others the property is left undefined for deserialized transactions. The code's own comment ("`null` when web3 could not resolve one") and the selftest assertion **"an UNKNOWN fee payer does not refuse on its own"** codify the fail-open direction: if `feePayer` comes back undefined, the arm is dead code and the judge passes silently.

**Gain.** If the wiring is dead, a customer submits a well-formed redemption whose fee payer is the Bank and which carries a `SetComputeUnitPrice` (ComputeBudget is on the allowlist). Priority fees are unbounded — the fee payer pays `price × CU-limit`, so this is a repeatable drain of the Bank's SOL, one redemption at a time, with no instruction listing the Bank at all. This is the exact theft the arm was built to close, reopened by a library quirk.

**Evidence.** One command settles it:

```bash
node -e "
const {Transaction, SystemProgram, Keypair} = require('/opt/gary-club/node_modules/@solana/web3.js');
const bank = Keypair.generate();
const t = new Transaction().add(SystemProgram.transfer({fromPubkey: bank.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1}));
t.feePayer = bank.publicKey; t.recentBlockhash = '11111111111111111111111111111111';
const bytes = t.serialize({requireAllSignatures:false, verifySignatures:false});
const back = Transaction.from(bytes);
console.log('feePayer =', back.feePayer && back.feePayer.toBase58());
console.log('accountKeys[0] =', back.message.accountKeys[0].toBase58());"
```

If the first line prints `undefined`, the arm has never fired. Additionally: no assertion anywhere feeds a real serialized transaction through `inspect()` and checks the fee-payer refusal end-to-end — the selftest passes `feePayer` explicitly into `judgeRedemptionTx`, testing the unit and not the wiring. Round 15's verdict says the pre-fix probe "set feePayer = bank and nothing objected" — that measured the judge without the cfg field; nobody has measured that `inspect()` populates it.

**Fix.** Derive the fee payer from the message, where it is unambiguous by construction: `tx.message.accountKeys[0]`. Add a suite assertion that serializes a legacy transaction with feePayer = Bank, runs it through `inspect()`, and requires refusal — and the mirror case for a customer fee payer. This is the same discipline as 3.1i: pin the library behaviour the arm rests on.

---

### R1.2 — Arm 1 completeness: answered

The prompt asks whether the Bank's authority can be exercised from an instruction that does not list it. Taking each candidate seriously:

- **Address lookup tables — not real.** The co-signer parses legacy only; versioned transactions throw at `Transaction.from`, asserted by 3.1i. An ALT cannot hide an account from a legacy parse because legacy messages carry no ALTs. (Corollary worth writing down now: the day v0 support is added, ALTs MUST be resolved and expanded before judgement, or arm 1 goes blind — see the verdict section.)
- **Duplicate account metas — not real.** The check is `accounts.includes(cfg.bank)` — presence, flag-agnostic, duplicate-agnostic.
- **Nested CPI — not real.** CPI signer propagation requires the account to be passed from the parent instruction with its signer flag (or to be a PDA of the calling program, which the Bank is not). A subtree that never receives the Bank cannot make it a signer. The open/burn CPIs (Core UpdatePluginV1, BurnV1) pass a fixed account list that does not include the Bank.
- **A program reading the instructions sysvar — not real for authority.** The sysvar exposes instruction metadata, not signature authority; no program can convert "the Bank signed instruction 2" into a signature. And any program that tried anything interesting with it is not on the allowlist.

The two real residuals: the fee payer (R1.1), and the pair's own unconstrained `payer` slot. SEAL's `OpenForRedemption.payer` and BURN's `BurnVault.payer` are plain `Signer`s the judge does not verify — but setting either to the Bank makes the Bank the *recipient* of Core's rent refunds (money flows **into** the Bank) and costs it nothing. Harmless. Arm 1 is complete for listed authority.

### R1.3 — The allowlist line: drawn in the right place

I tried to break the confinement with the permitted programs and could not:

- **In-transaction deposit into an undeclared PDA-owned account.** Only signers of the transaction can move tokens, and the customer composes it — so the value destroyed is value the customer put there. It is not worse than "the customer spending their own money," and it is not a route to destroying a third party's value (third parties cannot inject instructions). The author's carry is correct.
- **Sweep destination not the owner.** The customer's choice; not a Bank loss. Carried correctly.
- **CloseAccount rent to a third party.** The vault's rent is the owner's; same class.
- **Core instructions on other assets.** A second vault's Execute is sealed (PermanentFreezeExecute) and a second `open_for_redemption` is refused by the one-open rule; TransferV1/BurnV1 on other assets the customer owns are the customer's business; `UpdatePluginV1` needs the SEAL PDA; `CreateV2` into our collection needs the MINT PDA. A delegate planted on a *declared* account during the thaw window is refused by `ReserveDelegated`, and the canonical close wipes it (suite 3.3/3.3a).

No permitted program makes the confinement moot. The declined grammar is the right scope.

### R1.4 MEDIUM — `classifyPdaTokenAccount`: the right discriminator for hidden value, over-broad in refusal, and the escape hatch is the vulnerability at scale

**Construct.** `dataLen !== 165 → undeclarable`. A Token-2022 account carrying only `ImmutableOwner` (or `MemoTransfer`, `CpiGuard` — extensions that cannot hide a balance) is refused exactly like one carrying `ConfidentialTransfer` or a withheld `TransferFeeAmount`.

**Gain (griefing, and control erosion).** The author states the per-vault griefing surface. What is understated is the *aggregate*: ~0.002 SOL per vault buys a **permanent** refusal on every one of 2,100 vaults, so the "human who has looked" escape stops being exceptional and becomes the normal redemption path. An operator who hand-signs twenty redemptions a day is an operator who stops looking — and hand-signing means loading the Bank key into something other than `cosign.mjs`, which bypasses every check in R1 **and** defeats the "exactly one file reads the Bank key" tripwire by design. The tool's own documented escape route is the tripwire's documented defeat.

**Evidence.** Create a T22 ATA (auto-carrying `ImmutableOwner`, 170 bytes) for any vault's PDA for a junk mint; run `inspect()` on that vault's redemption; observe the coverage refusal naming extensions that cannot hold value.

**Fix.** Parse the TLV extension *type list* (offset 165 onward: 2-byte type, 2-byte length per entry — roughly twenty lines) and refuse only on value-bearing types (`ConfidentialTransfer`, `TransferFeeAmount`, and their mint-side siblings). The author's fear of "a new parser and a new place for a defect" is fair, but the type list is a fixed, documented format, and the alternative is a control that dies of routine. Minimum viable version: keep the refusal but print the extension type list in the message so the human's decision is a glance rather than an investigation.

### R1.5 — The DAS scan: closed, with one named remainder

HTTP status, JSON-RPC error, and response shape all fail closed; a full page refuses. The one remaining way it can answer "owns nothing" while not knowing is **indexing lag** — an asset transferred to the PDA seconds before the scan may not be on the DAS page yet. That is the airdrop race's sibling (it needs the owner's cooperation for a *vault*, but a *foreign* Core asset can be sent by anyone who holds one), and it is already carried under the airdrop race. No new fail-open path found.

---

## R2 — THE LOCK, AND THE `flock` THAT IS NOW LOAD-BEARING

### R2.1 MEDIUM — The restore's `rename` clobbers a live interloper's claim: two runners still pay, and the selftest certifies the file state, not the process state

**Construct.** In `acquireLock`'s restore branch, `fs.renameSync(stolen, file)` — and rename(2) **atomically replaces** whatever sits at `file`.

**The interleaving (four parties).** A stale dead lock exists. Racer R breaks it and claims (fresh lock, token TR). Breaker A — still judging the *original* stale token — re-reads, renames, and takes **R's fresh lock** (`takenToken ≠ held.token`). The pathname is now empty. Interloper D calls ordinary `claim()`: `link()` succeeds, **D's `acquireLock` returns `ok:true`**, D starts paying. A's restore rename puts TR's lock back — **overwriting D's lock**. End state: R holds the file and pays; D's lock is gone but D's process is mid-run and pays to completion. **Two runners pay.** The round-14 bug destroyed the true holder's lock and left one payer plus one believer; the round-15 fix preserves the true holder's lock and leaves one payer plus one believer. The double-payment — the one failure this file exists to prevent — occurs in both versions.

The header's sentence "a third runner that claims inside the hole still believes it holds **until its own release fails**" is, read literally, a description of D paying for an entire run — release happens in `withLock`'s `finally`, after `fn()` completes. But the framing ("the true holder's lock always survives") presents a file-state property as though it were the safety property.

**Evidence.** The existing selftest simulates the interloper with a raw `writeFileSync(..., {flag:'wx'})` and then asserts the *file* ends with the true holder's token — i.e., it asserts the clobber. Change the simulation to a real claim and assert the property that matters:

```js
let interloperOk = null
_afterUnlink: () => { interloperOk = LK.acquireLock(L, { alive: dead }).ok }
...
t('the interloper does NOT believe it holds', interloperOk, false)   // FAILS today: it is true
```

That assertion goes red on the current code, which is the proof.

**Fix.** There is no in-process fix — the author's no-CAS claim is correct (see R2.4) — so the fix is operational and must be stated as such: **a hand-run job must take the same `flock`** (`flock -n /var/lock/cbob/distribute.flock node bank/distribute.mjs ...`). Ship a `bank/run-exclusive.sh <job>` wrapper, print the command in `withLock`'s ELOCKED message, and reword the header from "the guard for a hand-run job" to "a guard with a residual two-payer window for hand-run jobs; use the flock wrapper." Today, cron-vs-cron is covered by flock and hand-vs-cron is covered by nothing but this lock.

### R2.2 MEDIUM — `flock -n` with no timeout turns a wedged-but-alive holder into a silent permanent skip, and the stale-break behind it is unreachable

**Construct.** `flock -n` holds the lease for as long as the process lives. The pathname lock's `staleMs` break (20h for distribute) can never fire, because every competing cron runner aborts at `flock` **before** reaching `lock.mjs`.

**Gain (accident).** A job hung on an RPC call with no timeout holds flock forever. Every subsequent cron run exits 1 with nothing written. Backstops: the alarm has the deadman (state mtime, 2h); distribute has `distribution_missed` (next day, HIGH); **revenue has nothing** — a hung `revenue.mjs` that never wrote a cycle produces no ledger row, and `detectUnreconciledRevenue` only judges cycles that exist. The revenue pipeline stops silently and indefinitely.

**Evidence.** Start `flock -n /tmp/x sleep infinity` in one shell and run the cron line in another: exit 1, no output, forever. No log line is ever produced.

**Fix.** Wrap the node invocation in `timeout(1)`: `flock -n $LOCKDIR/revenue.flock timeout 5h /usr/bin/node bank/revenue.mjs...`. A wedged process is killed, flock releases, the next cron runs. Add a revenue deadman (the revenue log's mtime, mirroring the alarm's) for defence in depth.

### R2.3 LOW — An aborted run is indistinguishable from one that never fired

The comment says "The exit code is 1 with nothing written, which is what the log should show." Cron records exit codes nowhere by default, so "nothing written" is exactly what a cron that never fired also looks like. Fix: `flock -n ... node ... || echo "$(date -u +%FT%TZ) skipped: lock held" >> $LOGDIR/x.log` — one line per skipped run, greppable, and a skipped *streak* becomes visible.

### R2.4 — The author's claims, checked

- **"No arrangement of rename/link/unlink is a compare-and-swap" — TRUE.** The break path needs atomic compare-and-*delete* over a fixed pathname; `link` gives atomic test-and-set (already used for `claim`), `rename` gives atomic replace, and neither gives conditional delete. The queue-lock alternative (uniquely-named contender files, lowest id holds) is a full redesign with its own crash-reclamation liveness problems. The durable answer is the OS lease, as installed.
- **Two and three racers, plain case — safe.** Both judge the same stale token; exactly one `rename` succeeds, the loser gets ENOENT → `lostRace`. The bad interleaving needs the four-party chain in R2.1.
- **`/var/lock/cbob` permissions** — `sudo install -d -o ubuntu -g ubuntu -m 750` under `set -e`: a failure is loud and happens before the crontab is written. Correct.
- **`cd $R && $FLOCK ... node ...` under `sh -c`** — composes as the author thinks: `$FLOCK` word-splits to `/usr/bin/flock -n`, flock holds the lease in its own process while it waits on node, and the redirection applies to the whole command. Correct.
- **`judgeCronTemplate` reads the template, not the installed crontab** — stated blindness, and the in-process lock remains as the backstop. Acceptable, but see R6.1 for how even the template check can go vacuous.

---

## R3 — THE ACK ALLOWLIST

**The set is right.** I walked every `kind` in the codebase looking for a member that is unanswerable by construction and missing: `vault_unreadable` and `tx_unreadable` are transient; `scan_cursor_unresolvable`, `bank_is_off_curve`, `vault_left_index`, `distribution_*` are all actionable; `vault_index_shrank` is an index fault to investigate. None belongs. Of the three present, `vault_owns_itself` and `nested_vault`-in-a-burnt-host are genuinely permanent; `unredeemable_owner` is the one arguable member (the marketplace-escrow reading *is* actionable — delist), but the ack is per-asset with a mandatory reason and the finding still prints at INFO, so an operator silencing a recoverable case leaves a written record of having done so. Defensible.

**The refusal path cannot be flooded into uselessness.** `applyAcks` looks up `acks[kind:asset]` per actual finding; entries matching nothing render nothing. An ack matching a real finding makes that finding *louder* (refusal note appended at its own severity). There is no mute direction.

No finding.

---

## R4 — ROUND 16'S OWN REPAIRS

**`readProgramData` — 13/45 is right, and the tag is at 12.** BPFLoaderUpgradeable's ProgramData is Borsh: `u32` enum (bytes 0–3), `u64` slot (4–11), `Option<Pubkey>` (1-byte tag at 12, pubkey at 13–44 when `Some`), ELF at 45 when `Some`, at 13 when `None`. The fix is correct and the both-ways assertions are real. One nit: a corrupt tag byte (not 0 or 1) reads as `None` and hashes from 13 — a different hash, so drift fires. Fails loud. Fine.

**`BANK_KEYS` + `banks_disagree` — the check is right; the comment is wrong (see R5.1); one noise item.** CRITICAL is defensible under this project's convention (a halted redemption pipeline is a "someone must act now"), the staged-rotation false-positive fires every pass *by design* with correct operator guidance, and the `pending_bank` standing checks already tell the operator why. But note: WATCH now contains `mint.bank` and `burn.bank` **twice** (the pre-existing literal entries plus the `BANK_KEYS` spread), so a landed rotation emits two `config_drift` findings per program — six where three suffice. Dedupe WATCH or drop the literals now that the spread exists.

**The `if (s.err) continue` reasoning — SOUND.** On Solana, any instruction failure fails the whole transaction, so a *successful* transaction containing `burn_vault` means `burn_vault` executed — which requires the paired top-level open, the Bank's and owner's signatures, and BURN's own validation that `accounts[0]` is a Core AssetV1 in our collection. The caller-supplied key therefore cannot name an asset that was not actually burned through our program. The inner-CPI variant cannot succeed without a top-level pair for the same asset (the sysvar sees only top-level instructions), and a second burn of the same asset fails on the closed account. The cross-file dependency is real and the source assertion is the right (conservative, false-red-on-refactor) kind of tripwire.

**The one-reader assertion — a tripwire, not a boundary.** It greps two string patterns (`CBOB_BANK_KEY`, `keys/bank.json`) across `bank/*.mjs` only. A second signer using a different env-var name, a different path, or living in `scripts/` passes silently. It catches accidents, not adversaries — and per R1.4, the tool's own human-escape instruction *requires* defeating it. See carry-over 1.

**MINT's corrected comment — NOW RIGHT.** `is_signer` is true for a PDA passed as a CPI signer (`invoke_signed`), so a Squads execution satisfies `owner: Signer`, and such a vault can never produce two top-level owner signatures. The corrected text is accurate, including the honest statement that test 5.2 proves a different property.

---

## R5 — THE COMMENTS, AGAIN

### R5.1 MEDIUM — The round-16 `BANK_KEYS` comment denies a control that runs — the inverse-drift class, in the newest commit, again

**Construct.** The `BANK_KEYS` doc comment: *"nothing even WATCHED two of them — `seal.bank` was in `WATCH`, `mint.bank` and `burn.bank` were not, so a landed rotation of the key that co-signs every burn was invisible the moment its `pending_` field cleared."* The selftest repeats it: *"(mint.bank and burn.bank were not, until round 16)"*.

**Why it is false.** The WATCH list in the tree already contains `['mint.bank', S.CRITICAL, 'co-signs every mint']` and `['burn.bank', S.CRITICAL, 'co-signs every burn']`, each with its own older comment ("BURN's own config was not watched at all…"). The 2f84b40..HEAD diff adds exactly one line to WATCH — the `BANK_KEYS` spread — and no `+` line adds either literal entry. They pre-existed round 15. A landed Bank rotation was therefore never "invisible": it fired `config_drift` at CRITICAL on the pass it changed. What round 16 genuinely added is the *standing comparison* (`banks_disagree`) and the shared array — both worth having, and neither what the comment claims.

**Evidence.** `git show 2f84b40:bank/detectors.mjs | grep -n "'mint.bank'\|'burn.bank'"` — both present. The duplicate-entry noise in R4 corroborates it (the spread was added beside entries the author believed did not exist).

**Fix.** Correct the comment to state what was actually missing (the comparison, and `BANK_KEYS` as the shared array), and remove the now-duplicate literal WATCH entries. This is the seventh-round class the commit was written to end, in the commit written to end it — the pattern this project keeps re-creating.

### R5.2 LOW — `audit16.ts` frames `Anchor.toml` as "TOOLCHAIN AND CLUSTER PINS"; the `[toolchain]` section is empty

The toolchain pin actually lives in `run-tests.sh`'s version check. Anchor.toml pins the cluster and little else (the build path for mainnet is `cargo-build-sbf`, which does not read it). Reword the framing so the bundle does not assert a pin that is not there.

### R5.3 LOW — The control table's first row omits the wiring caveat

SPEC's control table — "the ONE place that says what actually runs" — lists `bank/cosign.mjs` at "pre-signature" with no indication it runs only when a human invokes it; the "not wired" admission lives two paragraphs later. A reader who consults only the table (which is the stated design: every other comment points there and does not restate) sees a control that is, today, dormant. The "when" column should read "pre-signature, **when invoked — not wired into anything**."

The round-15 comment repairs themselves (SEAL's header, BURN's header, SPEC's impossibility 2, the `BURN_FIXED_ACCOUNTS` comment, MINT's "strictly stronger") I checked against what executes; they are accurate.

---

## R6 — THE GATES

### R6.1 MEDIUM — The cron-template assertion can pass vacuously: the exact class round 15 fixed, rebuilt one file over

**Construct.** `judgeCronTemplate` only judges lines matching `/node\s+bank\/\S+\.mjs/`. The real-file assertion is `D.judgeCronTemplate(cron)` must equal `[]`. If the cron lines are ever edited so that regex stops matching — the mildest case, switching `/usr/bin/node bank/alarm.mjs` to an absolute script path `/usr/bin/node /opt/cbob-vaults/bank/alarm.mjs` — **zero lines are recognised as jobs, the detector returns `[]`, and the assertion passes while checking nothing.** The crons keep working; only the exclusivity gate silently evaporates. This is the `readdirSync(existsSync(L) ? '.' : '.')` shape: a gate whose subject can vanish without the gate noticing.

**Evidence.** Apply that one edit to `scripts/cron-install.sh` and run `node bank/selftest.mjs` — the cron assertions stay green.

**Fix.** Assert the subject still exists: `const jobs = cron.match(/node\s+bank\/\S+\.mjs/g) || []; t('the template still HAS jobs to judge', jobs.length >= 4, true)` beside the existing check.

### R6.2 LOW — The mainnet probe has no assertion floor

SPEC's "Running the tests" block states four numbers; three are tied to floors in `run-tests.sh` and to the selftest's SPEC-count gate. The fourth (11 live-mainnet) has neither — the probe runs `| tail -2 || exit 1`, so deleting assertions from `probe-mainnet-facts.mjs` keeps every gate green while the stated count rots. (I counted the probe: 5 walk assertions + 3 mints × 2 = 11, so the number is currently right — which is exactly why it will drift unnoticed.) Fix: parse the probe's `N/M as predicted` line into a floor, and add the fourth number to the SPEC-count gate.

### R6.3 LOW — A tautological assertion in the on-chain suite

`rec('2.1','vault minted via the mint program','true',String(!!V.asset))` cannot fail: `mkVault` throws on a failed send (exiting via the FATAL handler), so reaching the assertion proves the mint succeeded, and `V.asset` is a generated Keypair's pubkey — always truthy. It inflates the count by one and gates nothing. Fix: delete it, or make it measure something (the asset account exists on chain and decodes as AssetV1).

### R6.4 LOW — The coverage gate excludes the audit scripts themselves

`audit-coverage.sh`'s `have` globs `scripts/*.sh` and `scripts/*.mjs` but not `scripts/*.ts` — so `audit15.ts` and `audit16.ts`, the files that define what every auditor is shown and from which the gate's own `sent` list is extracted, are outside the gate. A defect that silently truncated a future bundle would be invisible to the mechanism whose premise is that nothing escapes. Add `scripts/audit*.ts` to `have` (they are trivially "sent" — being the sender — but then a *new* .ts helper in scripts/ would also be covered).

On the prompt's general question about regex-based source assertions: the `if (s.err) continue`, `BURN_FIXED_ACCOUNTS`, and SPEC-count assertions all fail **red** when their regex stops matching for unrelated reasons (refactor, rewording) — the conservative direction. The one fail-open direction in the batch is R6.1.

---

## THE CARRY-OVER LIST

1. **Nothing wired to the co-signer — as stated, with two sharpenings.** (a) The one-reader assertion is weaker than it looks: two string patterns, `bank/` only, defeatable by any other name — and *designed to be defeated* by the tool's own human-escape instruction (R1.4). (b) The SPEC control table's first row — the load-bearing row for the completeness gap — describes a dormant control without saying so (R5.3). **The smallest thing that would make it a control:** a spool/daemon shape. `bank/cosign-daemon.mjs` watches a directory for `.tx` files, runs `inspect()` on each, writes the verdict beside it, and exposes `--approve <id>` which re-runs `inspect()` **on the same bytes** before signing. The key is read by exactly one long-lived process; the human approves an ID and never touches the key; the one-reader tripwire becomes true by construction rather than by grep.
2. **The lock's three-way hole** — R2.1. Worse than stated in one respect: the round-15 repair's own test certifies the two-payer file state as the desired outcome.
3. **Cross-pass correlation lag** — as stated. A false CRITICAL that already paged is never corrected, only superseded; alert-fatigue cost, not a funds risk.
4. **Compute units — sharpened.** No three-reserve-mint redemption has ever been **sent**: 9.14 builds and *serializes* the worst case; every redemption the suite actually executes (4.2, 6.4, 8.13, 9.x) uses one mint. The 1119-byte ceiling is proven against packet size only; the CU cost of open + up to seven Core Execute CPIs + burn has never been measured on a validator. Fix: the 9.14 harness already builds the transaction — send it. One test, and the carry-over closes or becomes concrete.
5. **Foreign nested Core assets — sharpened.** The stated limit is "detectNestedVaults cannot see one." With the co-signer unwired, the only detector that *can* see one (the pre-signature DAS scan) never runs. Today the gap is not partial; it is total. This is carry-over 1 restated as exposure rather than as a missing feature.
6–8. As stated; nothing worse found. The dead redemption stamp, the SEAL-PDA attributes delegation, duplicate attribute keys, the proposal-window mint, reserve continuity at purchase, and the payer-written distribution ledger are all unchanged and correctly characterised.

---

## ATTACKING THE VERDICT

**"The co-signer never checks the vault's collection or its on-chain owner" — rejection CONFIRMED.** A Bank signature on a reverting transaction is inert: the signature binds the whole message including the blockhash, so it cannot be transplanted; durable nonce — the one construction that would make an old signature live — is refused outright; and no program can convert another instruction's signature into authority. The judge additionally binds asset/owner/bank itself (accounts 0/2/3 of both halves), so the on-chain `ForeignVault`/`NotTheOwner` refusals are the second wall, not the only one. I could not construct a state in which the signature on a reverting transaction is worth anything beyond a social-engineering screenshot.

**"Legacy-only parsing is a HIGH availability failure" — rejection CONFIRMED, with one requirement to write down now.** Fail-closed is the correct direction for a signer: a v0 message's account list is not fully present in the bytes, and judging a transaction whose accounts you cannot see is the blank cheque this round just finished closing. But the moment `MAX_RESERVE_MINTS` is raised (a program upgrade the architecture permits), the co-signer becomes the redemption blocker, and v0 support must then resolve and expand **all address lookup tables before arm 1 runs** — otherwise the Bank-pubkey confinement is structurally blind to ALT-resolved keys. That requirement belongs in the code beside `Transaction.from` today, where the next implementer will read it.

**"Declare-everything bricks a vault" — rejection PARTIALLY challenged.** The on-chain vault is not bricked; the *control* is. The griefing costs dust per vault and is permanent per vault; at collection scale the human escape becomes routine; and the escape requires manual signing that bypasses every check in R1 and the one-reader tripwire. A refusal that can be manufactured for 2,100 vaults at ~4 SOL total is not an exceptional human decision — it is the retirement of the control by exhaustion. See R1.4 for the fix; the author's visible-block-over-invisible-loss principle is right, but the discriminator can be made narrower without a full TLV balance parser.

**"The judge does not verify owner and bank are actual signers" — rejection CONFIRMED.** The runtime enforces signer flags; a transaction that lands had its required signers. If the Bank is not a required signer, its partial signature is inert and the transaction cannot land anyway (Anchor's `Signer` constraint). One cosmetic defect: `partialSign` silently no-ops when the signer is not among the required signatures, and the tool prints "SIGNED." regardless — print a warning when the Bank is not in the message's required-signer set.

**Is one of the twelve fixes wrong?** Two candidates, neither fatal: the restore fix certifies a two-payer state as its own success criterion (R2.1 — it fixes the file, not the failure), and the fee-payer arm's wiring was never measured end-to-end (R1.1 — the fix is right, its activation is unverified). The flock install is correct but incomplete (R2.2). The other nine I checked and they do what they claim.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Five things this process structurally cannot do, none of them the ship gate's existing answers:

1. **Enumerate shapes without imagination — so stop trying to.** Every round finds shape gaps one at a time because eight models each imagine a handful of interleavings. The judges (`judgeRedemptionTx`, `judgeRedemptionCoverage`, `classifyPdaTokenAccount`, `allocate`, `paymentState`) are pure functions: put them under property-based testing. Characterise the accepted set once, then assert that *any* mutation of a canonical redemption — inserted instruction, swapped account, altered byte, extra declared account — flips the verdict to refuse. Do the same for the lock with **real processes**: a CI harness that spawns eight concurrent `acquireLock`/`releaseLock` loops with randomised crashes and asserts the invariant that matters (never two successful concurrent `ok:true` holders whose runs overlap). The single-process seams have now certified three consecutive broken versions of the break; seams cannot certify concurrency, and models cannot enumerate it. A fuzzer does not need to be right about Solana — it needs only to run.

2. **Test detection against a real fault.** The entire off-chain guarantee is detection, and it has never once been tested against an actual injected fault — only against synthetic input. Run a weekly canary: perform a real `approve` on a canary vault's ATA, a real dust airdrop to a canary PDA, a real unledgered-shaped sweep on a canary cycle, and **require the alarm to page within one pass**. A missed canary pages the deadman. This converts "every detector is proven in both directions" into "the deployed pipeline detects real faults end-to-end" — the only version of that claim that is worth anything, and the one thing no reading of the source can produce.

3. **Exercise the trusted hop once with real money at dust scale.** The sweep → Jupiter → return → split → distribute path has never executed against a live counterparty. Before any real balance exists, run one full `--live` cycle at 0.05 SOL through the real Jupiter API, the real RPC, the real SMS gateway, and a canary vault. Every failure mode that matters there — a quote shape the parser rejects, a swap that lands unconfirmed, a return that under-delivers — lives in the gap between the code and the counterparties, and no audit round reaches it.

4. **Break the author's monopoly on the audit's framing.** Every round's prompt — including the "MEASURED FACTS," the "DO NOT RE-FILE" lists, the diff range, and the roster — is written by the person whose code is under audit. That is a structural conflict no roster rotation fixes: the author decides what the auditors are allowed to consider already-settled. Two concrete moves: (a) run one round whose bundle is mechanically generated — whole tree plus raw diff, no author prose at all — and compare what the framing had been suppressing; (b) have a model independently re-derive the measured-facts list from the tree and diff it against the author's. Any fact the author asserts that the tree does not support is itself a finding; R5.1 is exactly such a fact, and it survived because the prompt asserted the history rather than the tree showing it.

5. **Get the Bank key off the single box — or accept that every control above it is conditional on the box.** The co-signer, the alarm, both ledgers, the audit process, the RPC credentials, and every signing key run as one user on one host. An on-box compromise is outside all sixteen rounds and outside all future ones; the one-reader tripwire greps the very filesystem an attacker would control. Minimum: a dedicated OS user per signer so the co-signer's key is unreadable to the jobs that don't need it; better: the Bank key behind a remote signer or HSM so that "exactly one file reads the Bank key" becomes a machine boundary instead of a regex.

---

**Summary of severities:** HIGH ×1 (R1.1, conditional on a one-command measurement that must be run before this is dismissed). MEDIUM ×5 (R1.4, R2.1, R2.2, R5.1, R6.1). LOW ×6 (R2.3, R5.2, R5.3, R6.2, R6.3, R6.4). The four arms of R1 are correctly designed and correctly scoped; the fee-payer arm's *wiring* is the one place where a designed control may not actually be running, and it is checkable in under a minute.