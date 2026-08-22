# ROUND 16 AUDIT — bank/cosign.mjs's new arms, the lock restore, the ack allowlist, and round 16's own repairs

Scope note: I read the diff 2f84b40..HEAD as the subject, and the full tree for context. Where I claim something is wrong, I say what evidence would exist. Where I checked a claimed control and it holds, I say so in one line and move on.

---

## R1 — THE CO-SIGNER'S NEW REFUSALS

### Finding 1 — MEDIUM: the allowlist confines programs, but Core is a multi-asset program — a customer can smuggle an UNSCANNED bare burn (or nesting) of a second vault into the transaction the Bank signs

**Construct.** `judgeRedemptionTx`'s arm 2 permits any instruction to `D.CORE_ID` that does not name the Bank. Core instructions carry their asset at account 0, and nothing in the judge binds that account to the asset being redeemed. So this transaction passes the judge today:

```
[ open_for_redemption(A), Core BurnV1(B), ...sweeps for A..., burn_vault(A) ]
```

where B is another vault the customer owns. It is not the pair, it is not SEAL/BURN, it does not name the Bank, and Core is on the allowlist, so all four arms are quiet. The customer signs (they own B), the Bank co-signs, and B is bare-burned with **no scan of B's PDA at all** — the exact thing the co-signer exists to prevent, for one vault over. The same hole admits `TransferV1(B → A's PDA)` (deterministic in-transaction nesting, the mirror of the carried token-deposit case) and `ExecuteV1` on any other asset the customer owns.

**What an attacker gains.** On-chain, nothing they could not do alone — Core BurnV1 needs only the owner. What they get is the Bank's signature on the transaction containing it. The system's evidentiary invariant is "the Bank only signs scanned redemptions"; this makes it "the Bank signs transactions *containing* a scanned redemption". If B holds an undeclared nested vault or tokens, the Bank's name is on their destruction. A malicious redemption client can also walk a phished customer into this ("we'll clean up your old vault in the same transaction").

**Evidence if I'm right.** Build the transaction above in the selftest's own harness: `j([mkOpen(), { programId: D.CORE_ID, data: [12, 0], accounts: ['OtherAsset', 'coll', OWN, OWN] }, mkBurn()]).ok` returns `true` today. Post-hoc detection does work (`detectBurns` fires `bare_core_burn` for B, and `correlateBurns` does not launder it — that path is tested). The finding is about the pre-signature control, not the alarm.

**Fix.** In the judge's loop, for any instruction on `CORE_ID`: refuse if `accounts[0] !== asset`, and refuse `data[0] === 12` (BurnV1) unconditionally — a redemption's burn goes through BURN, never raw Core. Both refusals are free: no legitimate redemption needs a Core instruction on a second asset.

---

### Finding 2 — MEDIUM: the judge never looks at where the money goes, and the human-escape output doesn't show it either

**Construct.** The author carries "does not verify that a sweep sends the vault's tokens to the OWNER" as a stated limit, justified as "the customer spending their own money". That framing covers the hostile-customer model. It does not cover the two cases that actually hurt:

1. **The phished customer.** A malicious redemption client composes the transaction and routes the sweep to itself. The Bank co-signs; the customer signs what their wallet shows as "redeem your vault". The Bank's co-signature — the thing the whole system markets as the check — is on the theft.
2. **The off-chain deal.** A customer sells their vault's *contents* ("pay me, I'll redeem to your address"), then redeems with the destination as their own ATA. The Bank's co-signature was the deal's credibility. Requiring destination == owner makes the Bank's signature unusable for settling such deals, which protects the Bank.

And the tool's own output makes the human escape blind to exactly this: a clean run prints `holds N thing(s), declares M` and "every holding this scan can see is declared" — it never prints a single sweep destination. The operator who "looks" cannot see the one thing a tricked customer needs looked at.

**Evidence if I'm right.** The selftest's own `sweep()` helper uses `['someAta', 'ownerAta', OWN]` and passes; change the destination to `'attackerAta'` and it still passes — nothing in the judge or in `main()`'s output distinguishes them.

**Fix.** The parser-free version: `connection.simulateTransaction` with `accounts`/`postTokenBalances` for the PDA's token accounts, and require every decrease from a PDA-owned account to have a matching increase to an account whose owner is the declared owner. That also catches the in-transaction deposit deterministically (it appears as a post-balance the scan never saw). The cheap version: print every transfer destination and its resolved owner in the inspect output, so the human escape can actually see it. Either way, the carried limit's rationale ("their own money") should be corrected — it is the customer's money only if the customer meant the destination.

---

### Finding 3 — LOW: arm 1 exempts the pair entirely, so the Bank can be named `payer` in the open or the burn

**Construct.** The judge checks `open.accounts[3] === bank` and `burn.accounts[3] === bank`, then skips the pair in the confinement loop. Nothing stops the customer naming the Bank *again* at open index 4 (`payer`) or burn index 5 (`payer`). In the open, that makes the Bank a writable signer in the UpdatePluginV1 CPI; in the burn, the Bank is the account Core's BurnV1 refunds the asset's rent to (measured fact 4). No theft — but the Bank's balance moves in a transaction the judge blessed, in a position the judge never checked.

**Evidence.** `j([{...mkOpen(), accounts: [AST,'coll',OWN,BANKK,BANKK,'cfg','seal','core','sysvar','sys']}, mkBurn()]).ok` is `true` today.

**Fix.** Assert the Bank appears exactly once in each half, at index 3.

---

### Finding 4 — LOW: the scan-defeat runs both ways — in-transaction EXTRACTION produces a false refusal

The author carries the deposit direction (fund a PDA account after the scan). The mirror is real too: a customer rescuing a nested asset or sweeping a Token-2022 account *out* during the redemption (the only way to resolve a live-host `nested_vault`) is refused by coverage, because the scan still sees the holding. The human escape handles it, but the refusal message ("it would be DESTROYED") is wrong for that transaction. State both directions, or read post-state (Finding 2's simulation fixes both).

**On the specific sub-questions:** arm 1's presence test is complete for top-level legacy instructions — CPI signer privilege requires the account in the outer instruction, a sysvar-reading program can observe but not act (and arm 2 excludes unknown programs anyway), duplicate metas are resolved by decompilation, and ALTs cannot reach the judge at all (3.1i proves `Transaction.from` throws on v0 — fail closed, correct for a signer). The 165-byte discriminator is right: classic Token accounts are always 165, Token-2022 accounts are always ≥166 (base 165 + AccountType byte + TLV). The DAS scan's remaining blind spot is index *correctness* (a lagging or wrong index answers `items: []` truthfully-as-of-itself), which is the already-carried race, not an envelope-shape hole.

---

## R2 — THE LOCK RESTORE AND THE flock LAYER

**The interleavings.** Two racers: one wins the rename, the other gets ENOENT — clean. Three racers (A breaks, C replaced, D claims in the hole): A's restore `rename(stolen, file)` *replaces* D's fresh claim, so the true holder's lock survives — the measured claim holds. But D's `claim()` already returned true: **D believes it holds for its entire run and finds out only at `releaseLock`, after the money moved.** The header says exactly this, so it is a stated narrowing, not a new finding — but note the restore does not merely ignore the interloper's lock, it *overwrites* it, so the double-pay window is the width of two syscalls and the interloper's only signal is a warning printed after the fact. Four racers collapse to the three-racer case (only one interloper wins the link).

**Is "no arrangement of rename, link and unlink is a compare-and-swap" true?** Yes, for Node's fs API. `link`/`symlink`/`mkdir`/`wx` give compare-and-swap with expected=absent (CAS-*create*); `rename` replaces unconditionally; `unlink` is unconditional; nothing gives content-conditional replace. `renameat2(RENAME_NOREPLACE/EXCHANGE)` would not help even if Node exposed it — the break is inherently stealing, and stealing cannot be made safe with pathnames. The claim is correct. Not a finding.

### Finding 5 — LOW: the flock directory is on tmpfs and nothing recreates it after a reboot; and a contended run is invisible in the log

**Construct.** On Ubuntu, `/var/lock` is a symlink to `/run/lock`, a tmpfs cleared at boot. `cron-install.sh` creates `/var/lock/cbob` once, at install time. After any reboot, `flock -n /var/lock/cbob/alarm.flock ...` fails with `cannot open lock file ... No such file or directory`, exit 1 — **all four money jobs silently stop running** until someone re-runs cron-install. It fails *closed* (jobs don't run) and the deadman pages within two hours because the alarm's state file goes stale, so this is an availability finding, not a correctness one. Separately: `flock -n` prints nothing on contention and the command never runs, so a locked-out run leaves **no log line at all** — indistinguishable from the cron not firing. For `distribute`, a contended 09:07 run means a silently skipped day until `distribution_missed` fires tomorrow.

**Evidence.** `ls -la /var/lock` on the box (symlink to `/run/lock`); reboot; `flock -n /var/lock/cbob/x true` → exit 1, "No such file or directory".

**Fix.** Put the flock dir under `$R` (persistent, same uid) or `mkdir -p` it in the cron line itself; and append `|| echo "LOCKED OUT $(date)" >> $LOGDIR/<job>.log` so a contended run is distinguishable from a dead cron.

**Minor text drift in the same file:** the restore-failure throw says "A copy may remain at ${stolen}" — after the code just tried to `unlinkSync(stolen)`. If the unlink succeeded, no copy remains. Hedged but misleading in the one message an operator reads under pressure.

### Finding 6 — LOW: `judgeCronTemplate` matches the *word* "flock", and only sees lines shaped exactly like today's jobs

**Construct.** `/\bflock\b|\$FLOCK\b/` matches anywhere in the line, including a trailing comment: `7 9 * * * cd $R && /usr/bin/node bank/distribute.mjs >> x.log 2>&1 # flock` returns `[]` — the gate passes a line with no flock prefix. And the job filter `node\s+bank\/\S+\.mjs` means a restructured job (`node $NODE_FLAGS bank/distribute.mjs`, or a variable path) becomes *invisible* to the judge — it returns `[]` because it saw nothing, which reads as "all jobs wrapped". It also reads the template, not `crontab -l`; the author states that, but the installed crontab is the artifact that matters.

**Evidence.** `D.judgeCronTemplate('7 9 * * * cd $R && /usr/bin/node bank/distribute.mjs # flock')` → `[]` by construction.

**Fix.** Anchor the flock match as a command prefix (`&&\s*\$?FLOCK?\S*\s`), and assert the judge *found* the expected number of job lines (4), so a restructured line fails red instead of vanishing.

---

## R3 — THE ACK ALLOWLIST

### Finding 7 — MEDIUM-LOW: `nested_vault` is ackable unconditionally, but on a LIVE host it is actionable — the kind conflates two different findings

**Construct.** The ack was built for conditions "unanswerable by construction", and the round-14 rationale for `nested_vault` was the *burnt-host* case. But the detector fires the same kind for a live host, and that case has an answer: redeem the host and transfer the inner asset out during the thaw (costly — it destroys the host — but it is an action, and the only one). Worse, the detector's own detail says "Do not co-sign a redemption of ${host} until this is resolved", which is self-contradictory for the live-host case: the resolution *is* a redemption of the host (with the inner extracted mid-thaw — the false-refusal case of Finding 4). An operator can currently ack away a finding that has a remedy.

**Evidence.** `detectNestedVaults` emits `nested_vault` identically for live and burnt hosts (it has `burnt` on the entries and doesn't use it for this); `applyAcks` downgrades either.

**Fix.** Include host liveness in the finding (`nested_vault` vs `nested_vault_burnt_host`), keep only the latter ackable, and fix the detail text for the live case to name the extraction path. On flooding: not exploitable — `applyAcks` iterates findings, not acks, so junk keys in acks.json attach to nothing.

On set membership otherwise: `vault_owns_itself` and `unredeemable_owner` are correctly unanswerable; `bank_is_off_curve` and `distribution_refused` are actionable (rotate / `resolvedBy`) and correctly excluded.

---

## R4 — ROUND 16'S OWN REPAIRS

**`readProgramData`: correct.** Bincode layout of `UpgradeableLoaderState::ProgramData` is enum u32 (4) + slot u64 (8) + `Option<Pubkey>` tag at byte 12 + 32 bytes when `Some`. ELF at 45 (upgradeable) / 13 (immutable) is right, and the selftest proves both. One shape wart: the too-short branch returns `{authority: null}` while the normal branch returns `{hasAuth}` — in `alarm.mjs` that degrades to 'IMMUTABLE' + `subarray(null)` → `subarray(0)`, i.e. a loud hash drift rather than a misread. Acceptable; a too-short ProgramData cannot exist on-chain.

### Finding 8 — MEDIUM-LOW: `banks_disagree`'s detail claims "REDEMPTION IS ALREADY HALTED" for a divergence that does not halt redemption

**Construct.** `burn_vault` cross-checks SEAL's bank against BURN's (`WiringDiverged`); `mint_vault` cross-checks SEAL's against MINT's. So redemption halts only when `seal.bank ≠ burn.bank`. When `seal.bank == burn.bank ≠ mint.bank`, *minting* is broken and redemption is fine — but the finding prints "REDEMPTION IS ALREADY HALTED" regardless, because the text is static.

**Evidence.** `D.detectStandingRisks({ 'seal.bank': A, 'burn.bank': A, 'mint.bank': B })` fires `banks_disagree` with the "REDEMPTION IS ALREADY HALTED" text today; the selftest only exercises the seal≠burn case. This is the wrong-CRITICAL-text class the process exists to catch — during a staged mint-bank rotation it pages a false statement about the product's most sensitive path.

**Fix.** Name the diverging pair in the detail and state what actually halts for each (`seal↔burn`: redemption; `seal↔mint`: minting). CRITICAL severity is otherwise right, and the staged-rotation "false positive" is a true positive — redemption really is halted mid-rotation; the text already says what to do.

### Finding 9 — MEDIUM-LOW: the BANK_KEYS spread duplicates all three bank keys in WATCH — one rotation now pages twice

**Construct.** `seal.bank`, `mint.bank` and `burn.bank` were **already explicit WATCH entries** (`'co-signs every redemption'`, `'co-signs every mint'`, `'co-signs every burn'` — all pre-existing, none in this diff). The new `...BANK_KEYS.map(...)` adds each a second time. `detectConfigDrift` iterates WATCH linearly, so one landed bank rotation now produces **two** CRITICAL findings with different `why` strings. Alarm fatigue is a stated enemy of this project; the repair manufactures it.

**Evidence.** Read the WATCH array in the current tree: all three keys appear twice. `detectConfigDrift({ 'mint.bank': A }, { 'mint.bank': B })` yields two findings.

**Fix.** Remove the three explicit entries (BANK_KEYS now owns them) or dedupe WATCH by key at construction.

### Finding 10 — LOW (comment class): the BANK_KEYS comment's history is false, and its assertion cannot fail

The doc comment says "nothing even WATCHED two of them — `seal.bank` was in `WATCH`, `mint.bank` and `burn.bank` were not". All three were explicit WATCH entries, and therefore in WATCHED_KEYS via `WATCH.map`. What was missing was the *comparison*, not the watch. And the selftest assertion added to prove it — `D.BANK_KEYS.filter(k => !D.WATCHED_KEYS.includes(k))` — is **`[]` by construction**, because `WATCHED_KEYS` spreads `...BANK_KEYS` directly. It cannot fail, ever, whatever happens to WATCH. (The `COLLECTION_KEYS` twin beside it has the same shape, pre-existing.) This is the R6 class inside the R4 repair: an assertion certifying a repair it is structurally incapable of catching. The substantive fix (the comparison) was needed and is real; the justification and the gate are not.

### Finding 11 — MEDIUM-LOW: the `if (s.err) continue` assertion certifies text, not behavior

**Construct.** The laundering route stays closed only while `alarm.mjs` skips failed transactions before decoding. The gate is `/if \(s\.err\) continue/.test(alarmSrc)`. It goes red on any innocent reformat (`if (s.err) { continue }`, filtering upstream) — safe direction — but it also **passes if the guard is deleted and the string survives in a comment**, and it says nothing about whether the guard precedes decoding. The property is real today; the gate is a tripwire over spelling.

**Evidence.** Delete the line, add `// we used to skip failed txs with if (s.err) continue` — the assertion passes and the route is open. No test would catch it.

**Fix.** Make it behavioral: extract the skip into a predicate, or drive the alarm's decode path with a failed transaction containing a `burn_vault` and assert no `burn_via_program` finding. The regex can stay as a second layer.

**MINT's corrected comment: now right.** `is_signer` is true for a PDA passed via `invoke_signed`, so a program can satisfy `owner: Signer` while v5's pairing (top-level only) can never be satisfied by it. The corrected text, including the note that 5.2 exercises `AccountNotSigner` rather than the PDA case, is accurate.

---

## R5 — THE COMMENTS

Named drifts found this round, in addition to Findings 9/10 above:

### Finding 12 — MEDIUM-LOW: SPEC's control table lists `bank/cosign.mjs` as the headline pre-signature control; two paragraphs later SPEC says nothing calls it

The table is the ONE place every other comment points at as "what actually runs". Its first row describes checks that run only when a human runs a CLI that no cron, service or client invokes. The text "**It is not wired into anything** … That is an open gap, not a control" appears two paragraphs *below* the table — a reader under pressure reads the table. The row itself must carry the status: `(EXISTS, NOT WIRED — nothing calls it)`. This is the same defect as the three denials round 15 fixed, in the inverse direction and in the document that defines the class.

All other headers in the diff check out against what executes: the cosign.mjs header (mitigation, one slot old, inspect-only default), the lock.mjs header (narrowing, honestly stated), the SEAL/BURN header rewrites (point at the table), SPEC's proven-impossibility 2, the `judgeCronTemplate` "BLIND TO" note, and the cron-install.sh flock rationale.

---

## R6 — THE GATES THEMSELVES

1. **`BANK_KEYS.filter(k => !D.WATCHED_KEYS.includes(k))` cannot fail** — Finding 10. The strongest cannot-fail assertion this round: the checked set is spread into the superset two lines earlier.
2. **`t('...so the two fingerprints are NOT the same slice', 45 === 13 → false)`** — vacuous; it restates that two literals differ. The two assertions above it carry the property. Harmless, but it is an assertion that can never go red.
3. **`judgeCronTemplate`** — Finding 6: passes on comment-mention, blind to restructured job lines, gates the template not the installed crontab.
4. **The detector floor exists in three copies** — SPEC's text, `run-tests.sh`'s `DET_FLOOR`, and `selftest.mjs`'s internal `FLOOR` — and only SPEC↔runner are gated. The internal floor can silently fall behind reality again, which is the exact defeat its own comment describes. Gate the internal floor against the runner's, or delete it and let the runner's be the only one.
5. **The litter check scans the shared `os_tmp` directory** for `.breaking.` — a stale file from any earlier crashed selftest (or a concurrent run) turns it red for an unrelated reason. Use a per-pid subdirectory.
6. **The `if (s.err) continue` regex** — Finding 11.

---

## CARRY-OVER LIST — is anything worse than stated?

1. **Nothing wired to the co-signer.** As stated, and it remains the most important open item. The one-reader assertion is a tripwire against an *accidental* second reader (it catches the two literal strings; an assembled path or a different env var evades it) — worth having, not a control. The smallest thing that makes it a control: the redemption client customers actually use must call `cosign.mjs`, and the Bank key must live behind it (no other signing path on the box). Until then every check in R1 is a tool, and Finding 1's smuggled-burn case shows the tool's own output needs to list *all* instructions for the human escape to mean anything.
2. **Lock hole** — as stated; honestly narrowed, flock covers the unattended path, Finding 5 is the operational residue.
3. **Correlation lag** — as stated.
4. **Compute units** — as stated, but now cheap to close: the 9.14 harness already builds the worst-case transaction; `simulateTransaction` returns `unitsConsumed`. If the 3-mint worst case exceeds the 1.4M CU transaction ceiling, `MAX_RESERVE_MINTS = 3` is wrong regardless of the 1119-byte measurement, and no byte harness will say so. Add 9.14c.
5–8. As stated. On (6): the dead Attributes delegation is consistent with v5 (the vault dies rather than being stamped); harmless residue, correctly carried.

---

## VERDICT CHALLENGES

- **"Co-signer never checks collection/owner" — rejection CONFIRMED.** SEAL and BURN enforce `ForeignVault`/`NotTheOwner` on-chain; a Bank signature on a reverting transaction buys nothing (atomic failure, the Bank isn't fee payer per arm 3, signatures are message-bound, durable nonces are refused). The residual is reputational ("the Bank signed an attempt"), which is weak and not worth a shape check the chain already performs.
- **"Legacy-only parsing is a HIGH availability failure" — rejection CONFIRMED.** MAX_RESERVE_MINTS is 3 and the business has exactly 3 reserve assets; no legitimate redemption needs v0 today, and fail-closed is the right direction for a signer. 3.1i is the correct conversion.
- **"Declare-everything bricks a vault" — rejection CONFIRMED, with a sharpening.** The human escape is real *because* the on-chain burn permits an undeclared account: hand-sign without declaring the griefer's Token-2022 account and the burn lands, orphaning only the griefer's dust. But note the escape depends on the operator understanding that — which is why Finding 2 (show the operator the actual flows) matters more than the verdict credits.
- **"Judge does not verify owner and bank are signers" — rejection CONFIRMED.** Anchor's `Signer` constraints are the control; a transaction missing them reverts; the Bank's signature on it is harmless.
- **"If one of the fixes is wrong"** — the BANK_KEYS repair is right in substance (the comparison was needed) but wrong in its stated premise (Finding 10), introduced a new duplicate-finding defect (Finding 9), and ships a detail text that is false in one of three divergence cases (Finding 8). That is this round's instance of the pattern.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Sixteen rounds of AI audit share three structural limits: every auditor reads the same bundle with the author's framing, every round is episodic, and nothing rehearses a human. What the project should do that this process structurally cannot:

1. **A differential second implementation of the redemption judge, written from SPEC alone** — different language, different author (a model given SPEC.md and the wire formats, never the code). Run both on every signing request; disagreement refuses. Sixteen rounds of models reading the same source share its blind spots; a from-spec reimplementation has different ones. This is the closest available substitute for the absent firm.
2. **Continuous adversarial fuzzing, not episodic rounds.** A standing harness that mutates real serialized redemption transactions (instruction order, extra instructions, account substitutions, truncated data) and runs them against the judge and against a validator with the real programs. AI rounds are snapshots; the input space is not.
3. **Game days with a human in the loop, timed.** Delete `state.json`, corrupt a ledger, remove `/var/lock/cbob`, revoke the Bank key, kill DAS — on a clone — and measure how long recovery actually takes and whether the operator's runbook works. AI audit reads code; it cannot rehearse an operator, and most of this system's real controls are operator actions.
4. **A canary vault with real, sacrificial value, redeemed end-to-end in production on a schedule before customers rely on it.** The suite proves mechanisms against cloned Core; only production proves the pipeline — DAS lag, RPC behavior, the actual redemption client, the actual operator.
5. **Monitoring that does not share the box.** Every watcher, both ledgers, and all three keys are one uid on one host. A second host (or a serverless function) reading only public chain state — collection membership, config PDAs, program hashes — and paging independently. Today's deadman watches the watcher's file from the same box the attacker would be on.
6. **A signing-transparency log off-box.** Every cosign verdict — the scan result, the reasons, the message hash, the decision — appended to an append-only store off the machine. When a dispute arrives ("why did the Bank sign this?"), the answer must be reconstructable; today it lives in a scrollback buffer.
7. **Rotate the audit's framing, not just the roster.** The prompt tells the auditors what the author thinks the risks are; that is a single point of failure, and this round's prompt is no exception. Have one model write the attack brief from the raw tree with no author framing and another audit against it. Disagreement between the two briefs is itself a finding.
8. **A bug bounty once value is live.** Even a modest one buys adversarial attention that no roster of models re-reading the same bundle provides — the only remaining source of genuinely independent eyes.

And the one-line version of this round: the repairs are mostly real, but the BANK_KEYS repair shipped a false premise, a tautological gate, and a duplicate finding — the sixth round running where the newest fix carries the next round's findings.