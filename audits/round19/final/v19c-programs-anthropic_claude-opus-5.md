# INDEPENDENT REVIEW — ec7d17e..HEAD

Scope note first, because it bounds everything below: I received the **programs** bundle. `bank/detectors.mjs`, `bank/lock.mjs`, `bank/spl.mjs`, `bank/anchor.mjs`, `bank/alarm.mjs`, `bank/revenue.mjs` and `scripts/audit-coverage.sh` are **not** in it, and three of the seven numbered targets turn on their contents. Where I could not measure, I say so and give the exact command that settles it. I have not filed a CRITICAL, because I could not construct one that survives the code as written; that is a statement about this diff, not a compliment.

---

## R1 — THE SELF-AUDIT'S OWN REPAIRS

### R1-1. `supersede()` deletes a day-level `resolvedBy` that suppresses THREE findings, in order to un-suppress ONE. MEDIUM

**Construct.** `DONE_MARKS = ['finishedAt','nothingToDo','resolvedBy']`, derived from `detectDistribution`'s *unfinished* predicate, and `for (const mark of DONE_MARKS) delete out[mark]`.

Day-level `resolvedBy` is not a single-purpose flag. Your own `bank/selftest.mjs` shows it suppressing at least three different arms:

```
t('...and a refusal a human RESOLVED is settled, not re-raised', ... resolvedBy ... distribution_refused → false)
t('an UNFINISHED day can be resolved too', ... resolvedBy ... distribution_unfinished → false)
t('...and a human can resolve it', ... unreadableAtas + resolvedBy ... distribution_vault_unreadable → false)
```

The comment claims the list is safe because it is "derived from the detector, not retyped — one fact, one reader." That derivation reads exactly one arm's predicate. It is therefore correct about *which flags silence `distribution_unfinished`* and silent about *what else those flags do*.

**What an accident gains.** Reachable ordering: morning run refuses (unlevelled vault) → writes `refused` + `nothingToDo` + `finishedAt`, and (if any vault ATA is poisoned) `unreadableAtas`. Operator investigates, decides the dust account is junk, writes `resolvedBy: 'gary: dust account, ignored'`. Afternoon: level added, plan proceeds → `supersede` deletes `refused`, `nothingToDo`, `finishedAt` **and `resolvedBy`**. The operator's written record of why a CRITICAL was accepted is gone from the money ledger, and `distribution_vault_unreadable` re-fires every 30 minutes until it is re-resolved. The one file "the last file anyone should be editing to quiet an alarm" is now the file an operator has to edit twice for the same fact.

**Evidence if I am right.** `node -e` on a ledger record `{startedAt,refused,nothingToDo,finishedAt,resolvedBy,unreadableAtas:[{vault:'v',state:'malformed'}]}` through `supersede()` returns a record with no `resolvedBy` and an intact `unreadableAtas`; feeding that to `detectDistribution` raises `distribution_vault_unreadable`.

**Fix.** Do not clear a multi-purpose suppressor by list membership. Either (a) clear only `finishedAt` and `nothingToDo`, and make the detector's unfinished arm ignore `resolvedBy` when `supersededAt > resolvedAt` (add a timestamp), or (b) keep the derived list but move day-level `resolvedBy` to a scoped form (`resolvedFindings: {distribution_unfinished: '...'}`) so a targeted clear is expressible. Option (b) removes the class.

### R1-2. `unreadableAtas` is written and never cleared — a stale-flag site the sweep missed, in the opposite polarity. MEDIUM

**Construct.** `if (poisoned.length && !DRY) { st.days[day].unreadableAtas = ...; save(st) }`. Nothing anywhere deletes it.

`DONE_MARKS` enumerates the flags that make a day read *finished*. This is the mirror image: a flag that makes a day read *broken*, with the same lifetime bug. A vault poisoned at 09:07 and cleaned up by 14:00 leaves the afternoon run's record still asserting an unreadable ATA, forever, and the only way to silence it is the `resolvedBy` that R1-1 shows `supersede` deletes.

**Fix.** One line, same place: `if (!DRY) { if (poisoned.length) st.days[day].unreadableAtas = ...; else delete st.days[day].unreadableAtas; save(st) }`. And add it to the same derived-list discipline: the flag set that *raises* findings deserves the same treatment as the set that suppresses them.

### R1-3. The `isTableRow` hoist left a second, looser definition of "row", and it is the fail-open one. LOW

`controlTableBlock` uses `lines[i].startsWith('|')`, not `isTableRow`, and stops at the first line that does not start with `|`. A **blank line inside the table** — which markdown tolerates as two adjacent tables, and which a future editor will produce — truncates the block, so `EVERY row in the control table block carries a classification` stops checking every row below it. That is precisely the hole this arm was written to close ("a NEW control row added in a non-conforming format left the count at 5 and went unchecked entirely"), reachable by a whitespace edit.

**Evidence.** Insert an empty line after row 3 of SPEC's control table and add a malformed row 6; `controlTableBlock(spec).length` drops to 3 and the arm stays green.

**Fix.** Terminate the block on the next markdown heading or on two consecutive non-`|` lines, and assert `block.length === rows.length` — a block shorter than the number of classified rows in the file means the block finder lost some.

### R1-4. `import fsx2 from 'fs'` beside `import fs from 'fs'`. LOW

Two bindings for one module in the file whose stated discipline is "one fact, one reader". `fs` was already in scope at every `fsx2` use site. Delete it.

### R1-5. The delivered-targets guard is a path-string check, and prose walks straight past it. MEDIUM

**Construct.** `audit19.ts` scrapes `/\b((?:programs|bank|scripts|tests)\/[\w./-]+\.(?:rs|mjs|sh|ts))\b/` out of the R1–R7 block and requires every hit to be in `TARGETS`.

R1 bullet 3 says *"nothingToDo's only reader SUPPRESSES distribution_unfinished"*. R5 bullet 4 says *"Two new arms assert that a stale nothingToDo suppresses distribution_unfinished. Do they prove what they claim?"* Neither names `bank/detectors.mjs`, so the guard is satisfied and the file is absent from the programs bundle. Same for `bank/lock.mjs` / `bank/spl.mjs` / `bank/anchor.mjs`, on which R2 ("THE MONEY PATH") entirely depends — `withLock`, `readLedger`, `requireTokenAmount`, `pinnedAccountData`.

**Evidence that I am right.** This report cannot answer R5's fourth bullet from primary sources; see R5-1, where I have to hand you a command instead of a verdict. That is the measurable cost, and it is the same cost the guard was built to stop paying.

**Fix.** Do not derive the required set from prose. Derive it from **imports**: for every file in `TARGETS`, resolve its first-order local imports (`from './x.mjs'`, `require('./x')`) and require those to be bundled too. Then the guard is closed under the dependency graph rather than under whether a sentence happened to spell a path.

### R1-6. `REPORT FORMAT` says "R1-R6". There are seven targets. LOW

R7 was added; the instruction that tells auditors how to order their report was not. One of N sites, in the instrument, in the round whose theme is one of N sites. It also means R7 findings land in an unordered tail.

### R1-7. The manifest record is well-formed; the porcelain claim checks out.

`git status --porcelain` untrimmed → `split('\n').filter(Boolean)` in the manifest is correct, and `if (dirty)` is correctly falsy on a clean tree (empty string, not `"\n"`). `dirtyAfter !== dirty` compares like with like. No finding. The `WATCHED` scope correctly excludes `audits/`, which the round writes as it runs — that was a real trap and it is avoided.

### R1-8. Rendering: the floors interpolate correctly. Verified against the files.

The rendered prompt I received reads `286-assertion … 434 off-chain detector … 93 allocation … 19 against live mainnet`, and `run-tests.sh` holds `MIN_ASSERTIONS=286 / DET_FLOOR=434 / ALLOC_FLOOR=93 / MAINNET_FLOOR=19`. The single escaped `\${FLOORS.onchain}` renders literally, as intended. I found no other escaping defect in the rendered artifact. Two stale sentences survive rendering and are worth a line each: the bundle note still claims *"in at least one prompt across rounds 1-17 … passes at 27 of 27 files"* (the tree has since gained `scripts/audit18.ts` and `scripts/audit19.ts`), and the diff header says "rounds 17 and 18's repairs" where the target section says round 18's. LOW.

---

## R2 — THE ROUND-18 OFF-CHAIN REPAIRS

### R2-1. The `settledAsPayout` direction is CORRECT. No finding — traced end to end.

Not resetting the clock ⇒ larger `holdDays` ⇒ in `decideEmission`, the third branch `daysSinceLastPayout >= maxHoldDays` fires **earlier**. Confirmed by the file's own pinning (`52` vs `2` → `[true,false]`). The default pays sooner, as claimed. Three auditors reaching this before me does not make it right, so: the trace is the first branch (`smallestPer < MIN_PER_VAULT`) → second (`>= threshold`) → third (`held >= 31`). Only the third reads `held`, and it is a `>=`. Direction confirmed.

### R2-2. `resolvedAs` is a string compared with `===` and validated nowhere, and it is documented nowhere an operator will read. MEDIUM

**Construct.** `paymentState(row) === 'resolved' && row?.resolvedAs === 'paid'`.

`resolvedAs: 'Paid'`, `'paid '`, `'PAID'`, `'yes'`, `true` all mean *not a payout* silently. There is no whitelist, no normalisation, and no throw. Compare the discipline four functions away: `holdDays` **throws** on a day key that is not a real date; `loadLevels` **throws** on an unrecognised level string and names the key. The one field an operator types by hand that changes the payout *schedule* gets neither.

And `grep -n resolvedAs SPEC.md` returns nothing. The field exists only inside a doc comment in `distribute.mjs`. The operator runbook (`SPEC.md` → "What the job refuses to do") does not mention it.

**What an accident gains.** An operator hand-pays a day, writes `resolvedAs: 'PAID'`, and the 31-day ceiling now measures from an older anchor. Direction is benign (pays sooner), so this is not a loss — but the *same typo class* in the opposite field would not be, and a field with no validation invites exactly that. The worse consequence today is that nobody outside this file knows the field exists, so the fix that was chosen ("say so with a field, not a phrase") is not actually available to the operator.

**Fix.** `const RESOLUTIONS = new Set(['paid','unpaid'])`; throw from `holdDays`/`settledAsPayout` on any other non-undefined value, naming the day and the vault, the way `loadLevels` does. Add two lines to SPEC's distribution section documenting `resolvedBy` + `resolvedAs`.

### R2-3. The forced payout at the ceiling can cost more in SOL fees than the drop is worth, and it recurs. MEDIUM

**Construct.** `decideEmission` forces a payout when `smallestPer >= MIN_PER_VAULT` — i.e. **1 satoshi** — and `held >= 31`. `MIN_PER_VAULT = 1n`.

At the published 2,100-vault census (denominator 6,405), the smallest forced drop is `available ≈ 3,203` sats: `floor(3203*2/6405) = 1`. The payment loop then makes ~2,100 confirmed transfers, and the job's own budget check demands `5_000 * outstanding * 2` = **21,000,000 lamports (0.021 SOL)**.

- Drop delivered: 3,203 sats ≈ 0.000032 BTC.
- Fees paid by the project: 0.0105 SOL actually spent (0.021 reserved).

At any plausible BTC/SOL ratio those are the same order of magnitude, and at the low end the fees exceed the drop. The holders are not short-changed (fees come from the distributor's SOL, not the pool), but the project burns SOL to deliver a rounding error, **and each forced payout resets `holdDays`, so at persistent low volume this recurs every 31 days forever**.

**Evidence.** `node bank/distribute.mjs --dry-run` against a 2,100-vault fixture with `available = 3203n` and `held = 31`: it will plan 2,100 transfers of 1–3 sats and print a `needSol` of 21,000,000.

**Fix.** The ceiling exists so nobody waits more than a month. It does not require paying *everybody a satoshi*. Add an economic floor to the forced branch — e.g. `MIN_FORCED_DROP` in sats, or `forced` requires `available >= K * activated.length` for a K set from the fee-to-sat ratio — and say on the card that below that floor the pool carries. This is the same correction you just made to `MAX_HOLD_DAYS`'s comment: the honest statement is "the ceiling forces out a *small* pool, not a *negligible* one".

### R2-4. The refusal now pages by SMS on a condition any vault holder can trigger for about the price of a restaurant meal, and it still halts everyone. MEDIUM

**Construct.** `if (plan.refusal) { execFileSync(NOTIFY, [msg,'cbob-distribute']); process.exitCode = 1 }`, where `NOTIFY = /opt/scripts/notify-gary-sms.sh`.

The trigger is `allocateWeighted`'s unlevelled-vault refusal. Reaching it requires only owning a vault and funding it to 21,000 sats — ~$14 of BTC that the attacker **keeps**, on a vault they keep, before the operator has added it to `levels.json`. Result: every holder's payout halts for the day, and the owner's phone rings. Repeat with another vault tomorrow. The charter round is free by design, so a holder of several charter vaults has several days of this for the cost of the sats alone.

Two things changed this round and both push the wrong way: the condition now **pages**, and the paging channel is **SMS**, while SPEC states the pipeline "alerts by EMAIL (never SMS)". The refusal is now a louder griefing surface than it was when round 18 accepted the halt.

**Fix — and this is not the redesign you have forbidden.** An unlevelled activated vault does not have to halt anyone. Compute the census and denominator **including** it (so nobody is overpaid), pay everyone else their correct share, and **carry that vault's share forward** as an explicit `owed` entry in the ledger with its own detector at HIGH. That is neither "quietly dropping one holder" (it is recorded and alarmed and owed) nor "overpaying everyone else" (the denominator includes it). It converts a stranger-triggered global halt into a stranger-triggered single-vault deferral. If you keep the halt, at minimum: page on the **second consecutive** refusal, and use the email path the rest of the pipeline uses.

### R2-5. `paymentState` is still safe for every caller. Verified.

Callers: the transfer loop (`'paid'`/`'resolved'` skip, `'ambiguous'` report, `'unpaid'` send), the `outstanding` fee-floor predicate, `holdDays` via `settledAsPayout`, `supersede` via `settledAsPayout`. Neither new reader can cause a send. A resolved row is still never re-sent. No finding.

One thing worth stating because it is *not* obvious and is load-bearing: `supersede` returns `{ ...rec }`, a **shallow** copy, so the `const done = st.days[day].paid` reference captured at the top of `main()` survives the `st.days[day] = sup.rec` assignment. If anyone ever deep-copies in `supersede`, every row written after that point goes into an orphaned object and the ledger loses the day's payments. Pin it: `t('supersede preserves the identity of the paid map', supersede(r,'now').rec.paid === r.paid, true)`.

### R2-6. The dust bound is CORRECT. Proof, since you asked for the re-derivation.

`per_i = floor(A·w_i/D)` with `D = Σ w_i` over `activated`. `dust = A − Σ per_i = Σ (A·w_i/D − floor(A·w_i/D)) = Σ frac_i`. Each `frac_i ∈ [0,1)` and there are `|activated|` terms, so `dust < |activated|` **unconditionally** — including `A < |activated|` (all `per_i = 0`, `dust = A < D/2 ≤ ...`; and in that regime `smallest < min` returns the `empty` record with `dust: 0n` anyway) and including skipped vaults (they are not in `activated`, contribute no weight to `D` and no term to the sum). Attainment at `A = D−1`: `floor((D−1)w/D) = w−1`, so `Σ per = D − N` and `dust = N − 1 = 2099`. Both the code comment and SPEC's 2,099 are right, and the earlier 6,404 was a true-but-loose bound. No finding.

### R2-7. The census round-trips. No finding.

`census` returns `{ ...Object.create(null) }` — a plain object, JSON-safe, and `denominator` reads it with `Object.hasOwn`, so a prototype-supplied `I` contributes 0. The resume branch reads `plan.census` back from JSON and only ever indexes it with the five literal level names. No consumer needs a prototype and none is denied one.

---

## R3 — `scripts/bank-sign.sh`

### R3-1. I could not find an accepted input that decodes to something other than what was pasted.

The round trip is the right check and it is sufficient: if `encode(decode(TX)) == TX` then `decode(TX)` is the canonical preimage, so there is no second string Node could resolve differently. I attacked it at:

- **Non-canonical trailing bits** (`AB==`, `AAB=`): GNU `base64 -d` either errors or emits bytes whose re-encode differs → `CANON != TX` → refused.
- **Extra terminal padding** (`AAAA====`): passes the `*=*[!=]*` and `%4` gates, then fails the round trip. Refused.
- **Embedded whitespace**: stripped by `tr -d '[:space:]'` before any check, which is correct for a wrapped paste. Multi-byte "spaces" (NBSP `C2 A0`) survive `tr` (byte-wise) and are then caught by the alphabet `case`. Fails closed.
- **Locale collation** in `case "$TX" in *[!A-Za-z0-9+/=]*)`: a locale where the range matches accented characters would let one through the `case`, and `base64 -d` then rejects it. Fails closed.
- **`set -euo pipefail` inside `$( )`**: `CANON=$(... | ...) || true` — the `|| true` applies to the assignment, `CANON` holds whatever the pipeline emitted before dying, and the `!=` comparison catches it. Fails closed.
- **Length**: `printf` is a bash builtin, so no `ARG_MAX` at that step; the final `exec` carries 1,644 characters, three orders of magnitude under any limit.

### R3-2. It rejects nothing legitimate. Verified arithmetically.

A 1,232-byte transaction is `1232 = 3·410 + 2` → 410 full quanta (1,640 chars) plus one `xxx=` → **1,644 characters, one `=`, at the end, length ≡ 0 mod 4, canonical**. Passes all four gates. Your own 512-byte fixture (684 chars, one `=`) confirms the shape, and the two whitespace arms confirm the paste repair.

### R3-3. A missing GNU `base64` denies the only sanctioned signing path with a misleading diagnostic. LOW

`CANON` becomes empty and every transaction is refused as *"not CANONICAL base64"* — which is a lie about the operator's input. On a rebuilt box, a BSD/busybox `base64` (no `-w`), or a `PATH` shadow, the Bank cannot sign anything and the error blames the paste. Your selftest pins the direction (fails closed, correctly) but not the message.

**Fix.** Two lines before the round trip: `command -v base64 >/dev/null && printf '' | base64 -w0 >/dev/null 2>&1 || { echo "this host's base64 does not support -w0 (GNU coreutils required) — refusing rather than guessing"; exit 2; }`.

### R3-4. The corrected `ps` comment is true, with one inaccuracy. LOW

It is true: after `exec`, the base64 sits in the co-signer's `argv` and is readable from `/proc/<pid>/cmdline` for the life of the process, and it is *not* in the wrapper's own history or `argv`. It is also correctly characterised as minor (an unsigned transaction is not a secret). The inaccuracy: the comment quotes the line as `exec node bank/cosign.mjs --tx "$TX"`; the actual last line is `exec /usr/bin/env node bank/cosign.mjs --tx "$TX" ${LIVE[@]+"${LIVE[@]}"}`. Quote the line verbatim or say "the last line of this file", not both.

---

## R4 — `scripts/cron-install.sh`

### R4-1. Full enumeration. The new header is complete with respect to money.

| installed line | can it move money as installed? |
|---|---|
| `23,53 * * * *` `alarm.mjs` | No. Reads and notifies; not in the pinned signer set. |
| `7 9 * * *` `distribute.mjs$DIST_DRY` | **YES** unless a tagged `--dry-run` was preserved. Loads `keys/distributor.json`, sends cbBTC. |
| `41 */6 * * *` `revenue.mjs$REV_LIVE` | Only with `--live`, which a fresh install omits. |
| `19 4 * * *` `alarm.mjs --reconcile` | No. State enumeration. |
| `9 */2 * * *` deadman (`test`/`find`/notify) | No. |

Five tagged lines, two money jobs, and the header names both with the right polarity. `crontab -l | grep -cF "$TAG"` == 5, as the closing echo asserts. The computed posture print reads the crontab it just wrote, so it is authoritative rather than prose — that is the right design and it is correctly implemented.

### R4-2. One fact, two predicates — and the money-arming one is the stricter. MEDIUM

```sh
# preserve:
ours | grep -q 'distribute\.mjs --dry-run'
# posture print:
crontab -l | grep -F "$TAG distribute" | grep -q -- '--dry-run'
```

The **preserve** demands the exact adjacency `distribute.mjs --dry-run`. The **print** accepts `--dry-run` anywhere on the line. They disagree, and the header instructs the operator to *"add --dry-run to the distribute line yourself"* without saying where. Cron hands the whole line to `/bin/sh`, so `… bank/distribute.mjs >> log 2>&1 --dry-run …` **works at runtime** (redirections are parsed positionally) and is **not preserved**. A re-run of the installer then silently arms the live cbBTC sender.

The posture print does save you — it will say `LIVE FROM THE NEXT 09:07` — so this is loud rather than silent *provided a human reads stdout*. If the installer is ever run from a provisioning script, nobody does.

**Evidence.** Install with `… distribute.mjs >> $LOG 2>&1 --dry-run #cbob-vault-cron distribute`, re-run `cron-install.sh`, and read the new crontab: the flag is gone.

**Fix.** One predicate, and the loose one: `ours | grep 'distribute\.mjs' | grep -q -- '--dry-run'`. Same for `--live`. Then the preserve and the print agree by construction — and pin that they agree, with a selftest arm that runs both against the same fixture.

### R4-3. `--dry-run` takes the same exclusive lock as the paying run, and the new EXIT CODES comment invites running it as a health check. MEDIUM

`distribute.mjs` reaches `withLock(LOCK, main, { staleMs: 20h })` on **both** paths; `--dry-run` only suppresses *writes*, not the lock, and not the DAS page walk or the ~2,100 sequential `getAccountInfo` calls. So a dry run holds the lock for minutes.

The new header says, approvingly: *"a wrapper or CI job that runs `--dry-run` as a health check will go red on a griefed day, which is the intended signal"*. A CI job on that pattern will sooner or later be inside the lock at 09:07, at which point the real distribution exits **3** with `CBOB DISTRIBUTION DID NOT RUN` and pages — and the day is skipped, because the cron does not retry. The document now recommends a monitoring pattern that can suppress a payout.

**Fix.** Either take no lock under `--dry-run` (it writes nothing), or take a *shared* lock, or say in the same comment: "do not schedule `--dry-run` inside the 09:07 window."

---

## R5 — THE GATES

### R5-1. The two `nothingToDo` arms do not prove what the surrounding comment claims. MEDIUM

**Construct.**
```js
t('...and a STALE nothingToDo would silence it — which is why the writer clears it',
  D.detectDistribution({days:{'2026-08-20':{startedAt:'x', nothingToDo:'…',
    paid:{v1:{sig:'abc'}, v2:{sig:null}}}}}, {today:'2026-08-21'})
    .some(f => f.kind === 'distribution_unfinished'), false)
```

The assertion is about `distribution_unfinished` **only**. The comment above it, and the much longer justification in `distribute.mjs`, claim something stronger: *"a half-finished day with unpaid holders **goes silent**"* / *"the half-finished day is silent"*. Nineteen lines up on the same page, `t('CRITICAL when a transfer has no signature', … distribution_unresolved, true)` shows that a `sig: null` row raises `distribution_unresolved`. If that arm is not gated on `finishedAt`, then the day in the fixture above is **not silent** — it raises a CRITICAL — and the fail-open premise the whole `supersede` repair rests on is overstated.

This matters because the crashed-day fixture in `distribute.mjs`'s own selftest (`crashed = { plan: {...} }`, **no `paid` rows at all**) is the *only* shape for which "silent" has been demonstrated — and that is a day on which no money moved. The dangerous shape (a mid-loop crash) always leaves at least one `{sig:null, sentAt}` intent row on disk, because the intent is written before each send.

**Evidence that settles it, one command:**
```
node -e "import('/opt/cbob-vaults/bank/detectors.mjs').then(D=>console.log(
  D.detectDistribution({days:{'2026-08-20':{startedAt:'x',nothingToDo:'q',
    paid:{v1:{sig:'abc'},v2:{sig:null,sentAt:'x'}}}}},{today:'2026-08-21'})
  .map(f=>f.kind)))"
```
If that prints `['distribution_unresolved']`, the repair is still right but its justification is wrong about the state it describes — the same criticism this round levelled at round 18's comment. If it prints `[]`, the claim holds and you should assert it on the **full kind list**, not on `.some(unfinished)`.

**Fix.** Assert on `.map(f => f.kind)` in both arms, so the assertion says what the comment says.

### R5-2. `isTableRow` as a definition of a row: sound in the fail-closed direction, and it does miss shapes.

`/^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/` requires pipe-**space** at line start and pipe-space-`**` before the verdict. It misses:
- a row with no space after the leading pipe (`|**X**|…`) — your own negative fixture,
- a verdict cell that leads with anything before the bold (`| ⚠️ **ON-CHAIN.**`), which is a *plausible* future edit given how much of this document leads with ⚠️,
- a verdict written `**ON-CHAIN**.` or `**On-chain.**`.

All three land in `controlTableBlock` and make `EVERY row … carries a classification` go **red**, so they fail closed. That is the right direction. The one shape that fails *open* is R1-3's blank line. No real control row currently fails to match — I checked all five against the regex by hand.

### R5-3. The `MintVault` struct regex is sound, and the positional constant is genuinely pinned.

`/pub struct MintVault<'info>\s*\{([\s\S]*?)\n\}/` is non-greedy to the first newline-brace. Inside the body there is no line beginning with `}` — doc comments are `///`, attributes are `#[…]`, and no field carries a braced type. Field order parsed from the source: `config, asset, collection, owner, bank, payer, revenue, instructions, seal_config, mint_authority, mpl_core, system_program` → `indexOf('bank') == 4 == MINT_IX_BANK_IDX`. Anchor emits accounts in declaration order, and `tests/3prog.test.ts` builds them in exactly that order, so the on-chain index and the parsed index are the same fact. Truncation before `bank` yields `-1` (closed); truncation after cannot move index 4. Your two pinned rejections of the luna-pro finding are correct. No finding.

### R5-4. `codeOnly` is not a shell comment parser, but it cannot fail open here. LOW

`!/^\s*#/` strips the shebang, and would strip a line inside a here-doc or a quoted multi-line string that begins with `#`. Since `codeOnly` only ever **removes** lines, and no real `exec` line can begin with `#`, the "exactly ONE exec-of-the-co-signer line" arm cannot be defeated by it. Combined with the `^\s*exec` anchor, an `echo` or a trailing comment mentioning the command is correctly not a second candidate. It is under-general and safe. Name it in the comment (`this is a line filter, not a shell parser; it is sound here only because it can only remove lines`) so nobody reuses it on a file with a here-doc.

### R5-5. `errNames`'s enum-body scrape will happily invent a variant out of a comment. LOW

`/^\s*(?:#\[msg\("[^"]*"\)\]\s*)?(\w+),\s*$/gm` matches **any** line ending in `word,`. MINT's error enum currently contains a seven-line `//` comment block; none of those lines happens to end in `word,`. That is luck, not design: `// a delegate, a close authority,` would be scraped as a variant named `authority`. Today the damage is bounded by `t('...and the check is looking at something real', bankErrs.sort(), ['BankKeyOutsideMint','BankKeyOutsidePair'])`, which goes red on any phantom beginning `BankKeyOutside` — but a phantom with another name silently enlarges `errNames`, which is exported into the whole-enum comparison you claim to have verified (16/33/21/17).

**Fix.** Strip `^\s*(//|/\*|\*)` lines from the body before matching. Two characters of regex.

---

## R6 — THE COUNTS AND THE ARITHMETIC

### R6-1. All four floors verified against the files. All ten card figures re-derived and correct.

Floors: `MIN_ASSERTIONS=286`, `DET_FLOOR=434` = `selftest.mjs const FLOOR`, `ALLOC_FLOOR=93` = `distribute.mjs   const FLOOR`, `MAINNET_FLOOR=19`. The two new cross-checks match the actual indentation of both `FLOOR` lines (`^const` and `^  const`). ✓

Arithmetic, independently:
- 240: 108+60+36+24+12 = **240**; 216+180+144+120+72 = **732** ✓ (and 45/25/15/10/5 % of 240 gives exactly those counts).
- 2,100: 945+525+315+210+105 = **2,100**; 1890+1575+1260+1050+630 = **6,405** ✓.
- V/I = 6/2 = **3** ✓.
- Per $1,000 @732: 2.7322→**2.73**, 4.0984→**4.10**, 5.4645→**5.46**, 6.8306→**6.83**, 8.1967→**8.20** ✓.
- Per $1,000 @6405: 0.31226→**0.31**, 0.46838→**0.47**, 0.62451→**0.62**, 0.78064→**0.78**, 0.93677→**0.94** ✓.
- Shares: 189000/6405=**29.5082**, 157500/6405=**24.5901**, 126000/6405=**19.6721**, 105000/6405=**16.3934**, 63000/6405=**9.8361**; exact sum = 640500/6405 = **100.000**, and the *rounded* five also sum to 100.0 ✓.

No arithmetic defect on the card.

### R6-2. SPEC states five assertion counts. The gate checks three. Two are wrong, plus one in `cosign.mjs`. MEDIUM

```
SPEC.md: "Every detector is proven in BOTH directions by `bank/selftest.mjs` (69 assertions)."      → real 434
SPEC.md: "node bank/distribute.mjs --selftest   # 63 allocation assertions, both directions"        → real 93
SPEC.md: "The 270-assertion suite runs against real mainnet Core cloned onto a validator"           → real 286
bank/cosign.mjs: "The judgement is proven in bank/selftest.mjs, both directions, 20 assertions"     → stale
```
The three checked copies (`# 286 assertions, real cloned Core`, `(+ 434 detector`, `93 allocation and`) are right; the four unchecked ones are wrong by 6.3×, 1.5×, and 16 assertions. This is the exact defect SPEC's own gate section names — *"a documented count that is visibly wrong teaches the reader that the floors beside it are decorative too"* — surviving in four sites, one of them in the SHIP GATE table that is supposed to justify the whole process. `MAINNET_FLOOR` has no SPEC cross-check at all (the regex `(\d+) allocation and \d+ live-mainnet` captures only the allocation number).

**Fix.** Stop storing the counts twice. Have `run-tests.sh` emit `assertion-counts.json` and have a `docs:check` step (or one more selftest arm) require **every** integer in SPEC that is followed by `assertion`/`allocation`/`detector` to appear in that file. In the interim: fix the four numbers, capture the mainnet number in the existing regex, and add an arm for `cosign.mjs`.

### R6-3. `floor()` compares the PASS count to the floor, not the assertion count. LOW

```sh
n=$(grep -oE "$3" <<<"$2" | grep -oE '^[0-9]+' | tail -1)
```
For output `92/93 allocation assertions as predicted`, `n` is **92**. The die message then says *"92 assertions but the floor says 93"*, which is not what happened. It is not exploitable — the sub-suite's own exit code catches any failure before `floor()` runs, and `-eq` catches a shrink — but the gate whose whole purpose is to count assertions is counting passes, and the redundant `-ge` above it can now never fire. Capture the denominator: `grep -oE '/[0-9]+' | tr -d /`.

### R6-4. The card's per-$1,000 and share-of-drop figures are computed from an idealised census the random assignment will not produce. LOW

`(1000 * w / 6405)` and `(100 * n_l * w_l / 6405)` are exact only if the level lottery lands **exactly** 945/525/315/210/105. It will not. The real denominator will differ, so a holder's actual share differs from the card. The code is honest (it uses the real census); the card is not labelled as a projection, and the selftest's `matches the card` arms give the misleading impression that the published figure is checked against reality rather than against an assumption. One sentence on the card ("at the expected census; the actual census and denominator are published at every settlement") closes it.

---

## R7 — WHAT THE SELF-AUDIT MISSED

### R7-1. `settledAsPayout` is the only cadence reader in `distribute.mjs`. The claim holds *inside this file*. It is untested outside it.

Verified callers of `paymentState`: the transfer loop, the `outstanding` fee-floor predicate (correctly asking "will the loop send it", not "did money move"), `holdDays`, `supersede`. Each asks the right question. But the sweep was run over one file. `detectDistribution` in `bank/detectors.mjs` makes the same kind of judgement about the same rows (`distribution_unresolved`, `distribution_refused`, and whatever it means by a row being settled), and I could not read it. If that arm treats `resolvedBy` alone as "money landed" anywhere, the conflation the round-18 fix removed from `holdDays` still exists in the alarm. **Grep it before you believe the claim: `grep -n 'resolvedBy\|resolvedAs\|\.sig' bank/detectors.mjs`.**

### R7-2. The `realDay` round-trip fix is one of two date-validation sites. MEDIUM

`holdDays` now round-trips its day keys. The other operator-supplied date in the tree is `judgeAck`'s `until`, and the only assertion on it is `t('an ack with an unreal date is refused', D.judgeAck({why:'x',until:'2026-13-45'}).ok, false)` — a *month* out of range, which naive `Date.parse` also rejects. `2026-02-30`, the exact string that produced the confident 173 in `holdDays`, is untested there, and the two live-ack arms only exercise `2026-08-22`.

**Evidence, one command:**
```
node -e "import('/opt/cbob-vaults/bank/detectors.mjs').then(D=>console.log(
  D.judgeAck({why:'x',until:'2026-02-30'}, Date.parse('2026-03-01T12:00:00Z')).ok))"
```
If that prints `true`, an ack written `until: 2026-02-30` silences a CRITICAL two days past its stated expiry, and the round-trip fix reached one of two sites — in the round whose thesis is one-of-N sites. **Fix:** export `realDay` from a shared module and use it in both places, with the same assertion pair on each.

### R7-3. "Exempt does not mean unchecked" was applied to one of the three instructions that take `bank: Signer`. MEDIUM

This overlaps accepted limit 3, so I am filing only the part that is **worse than stated**: limit 3 records the *fact* that the pair is exempt wholesale. What it does not record is that round 18's own written rationale is a general argument that was acted on in exactly one place.

MINT's comment: *"`MintVault` takes `payer: Signer` at index 5 and this handler transfers `price_lamports` FROM THE PAYER"* → narrow the exemption to positional identity. SEAL's `OpenForRedemption` takes `payer: Signer` at index **4** and hands it to Core's `UpdatePluginV1` as the rent payer; BURN's `BurnVault` takes `payer: Signer` at index 5 and hands it to `BurnV1`. Neither is positionally confined; SEAL's walk exempts `is_open`/`is_burn` in their entirety, and BURN has no walk at all.

Today the exposure is small and asymmetric (BurnV1 *credits* the payer with the asset's rent; a thaw's plugin update probably reallocs nothing). But the reason MINT was narrowed was not the size of the number — it was that "exempt" and "unchecked" are different words. A future Core release that charges rent on `UpdatePluginV1`, or a future SEAL field that makes `payer` fund something, turns a documented limit into a drain, and the confinement in the sibling program will already have been written.

**Fix.** Same three lines, twice: in SEAL's walk, when `is_open`, require `config.bank` to appear only at `SEAL_IX_BANK_IDX = 3`; when `is_burn`, only at `BURN_IX_BANK_IDX = 3`. The index constants already exist in both directions.

### R7-4. Other fixes checked for one-of-N, with results.

- **`Object.hasOwn`** — reached all four sites I can see (`census`, `denominator`, `allocateWeighted`'s unlevelled guard, `loadLevels`'s bad-level check). `LEVEL_WEIGHTS[levels[v]]` in the payment loop is downstream of the guard. Clean.
- **Floor equality** — reached `floor()`, `MIN_ASSERTIONS`, both sub-suite `FLOOR`s. Clean (see R6-3 for the residual).
- **Flag preservation in the installer** — reached both money flags. Clean, modulo R4-2's predicate mismatch.
- **The suppressor-list derivation** — reached one suppressor consumer (`distribution_unfinished`) out of at least three that read `resolvedBy`. **Not clean** — that is R1-1.
- **Stale-flag clearing** — reached the suppressors, missed `unreadableAtas`. **Not clean** — R1-2.

---

## THIRD TARGET — WHERE THE SYSTEM IS STRONGER THAN ITS OWN DOCUMENTATION

### U-1. The control table does not say the Bank must sign every MINT. It does, on-chain, unskippably. HIGH (documentation)

Row 1 of the table — *"the ONE place that says what actually runs"* — reads:

> **THE BANK MUST SIGN AT ALL** … any unsealing or burn attempted **without the Bank**. `programs/cbob-vaults/src/lib.rs` and `programs/cbob-vault-burn/src/lib.rs` each take `bank: Signer` …

**MINT does too, and pins it:**
```rust
pub bank: Signer<'info>,
…
require_keys_eq!(ctx.accounts.bank.key(), cfg.bank, MintError::NotTheBank);
```
So **no vault can be created without the Bank's signature, ever** — a third on-chain refusal, in the busier of the two paths, absent from the table. `onChainBankPin('programs/cbob-vault-mint/src/lib.rs')` already returns `true`, so a row naming MINT passes the existing gate unchanged.

Two things make this the same defect the owner caught, not a nit:
1. This round **deliberately loosened `rows.length === 5` to `>= 5`** with the comment *"Three programs pin the Bank's signature; the table names two. Writing the truer, stronger third row turned this assertion RED."* The gate was widened to make room for the row, and **the row was never written.** The repair stopped at the obstacle.
2. SPEC's own "Where this stands" section lists **two Bank duties that are not on-chain rules** — refuse to co-sign a mint while a proposal's voting window is open, refuse a charter-priced mint not backed by a burned Proof of Burn. Those duties are *enforceable at all* only because the Bank's signature is mandatory on every mint. A reader of the table cannot see the mechanism that makes the duties meaningful.

**Fix.** Add the row (the format is already proven by the `TRUE extra ON-CHAIN row` fixture):

> `| **THE BANK MUST SIGN EVERY MINT** | any vault created without the Bank. \`programs/cbob-vault-mint/src/lib.rs\` takes \`bank: Signer\` and \`require_keys_eq!\` it against \`config.bank\`, so a mint missing the Bank's signature does not fail policy, it fails to execute. This is what makes the two written mint duties enforceable at all | every mint | **ON-CHAIN.** The program refuses. |`

Then tighten `>= 2` back to `>= 3` on the verified-ON-CHAIN count, so the third row cannot be deleted silently.

### U-2. SPEC asserts an on-chain impossibility that is no longer true, and it is the one guarding permanent customer BTC loss. HIGH

Two places say a control cannot exist "even in principle":

> **⚠️ THE BANK MUST BE A PLAIN KEYPAIR** … It **cannot** be enforced on chain: `Pubkey::is_on_curve` is host-only and panics on BPF, so `update_config` cannot refuse a program address even in principle.

> **⚠️ AND NEITHER CAN A VAULT'S OWNER. A DAO CANNOT HOLD A VAULT** … Nothing on-chain can refuse it (`is_on_curve` panics on BPF), so `detectNestedVaults` reports an off-curve owner at CRITICAL (`unredeemable_owner`) and **that detection is the entire control.**

Both conclusions follow from "you cannot test an address for on-curve-ness on BPF", which is true (measured fact 5). But **that is not the property you need.** The property you need is: *can this key sign a TOP-LEVEL instruction?* And since round 17 both MINT and SEAL read the instructions sysvar, that property is now directly observable on-chain.

The mechanism, in full, because this is the kind of claim that must be checkable:

- `load_instruction_at_checked(i, &sysvar)` returns an `Instruction` whose `accounts: Vec<AccountMeta>` carry `is_signer` **as declared in the transaction message**.
- A PDA — a Squads vault, any program address, any smart wallet — cannot be in a message's signer set. It has no private key. It obtains `is_signer == true` only inside a CPI, where the *caller's* `invoke_signed` supplies it, and that never appears in the message.
- Anchor's `Signer<'info>` reads `AccountInfo::is_signer`, which **is** true for a CPI-supplied signer. That is exactly why `mint_vault`'s `owner: Signer` does not stop a DAO buying an unredeemable vault, as SPEC correctly notes.
- Therefore: if `mint_vault` additionally requires that **it is itself the top-level instruction**, then `owner.is_signer` becomes proof of a real keypair signature — which is precisely the redeemability property v5 needs (two top-level owner signatures).

```rust
// mint_vault, inside the block that already loads the sysvar and `current`
let me = load_instruction_at_checked(current, &sysvar)?;
require!(me.program_id == crate::ID
      && me.data.len() >= IX_MINT_VAULT_DISC.len()
      && me.data[..IX_MINT_VAULT_DISC.len()] == IX_MINT_VAULT_DISC,
    MintError::MintMustBeTopLevel);
```
Four lines. No new account, no new read, no new dependency. It converts *"a DAO pays real money, deposits real cbBTC and receives a permanently sealed asset, and the entire control is an off-chain CRITICAL with no remedy"* into a program refusal at the moment of sale.

The identical argument applies to the Bank rule: `apply_pending_bank` can require the incoming Bank key to appear as a **message-level** signer of the top-level instruction, which refuses a Squads vault as Bank at the moment of rotation instead of a week later via an off-chain detector. (A plain `Signer` constraint alone is weaker — a Squads CPI satisfies it — so the sysvar read is the load-bearing part.)

**What it costs, stated so the trade is visible.** It forecloses any future launchpad/candy-machine wrapper that CPIs `mint_vault`. There is none today, and if one is wanted later it can be allow-listed by program id. It does **not** stop a keypair owner transferring the vault to a PDA afterwards (measured fact 3, genuinely unpreventable) — but that is the holder's own act, not us selling them a brick.

**Evidence that I am right about the gap.** SPEC says it itself: *"Suite test 5.2 does not cover it either — it passes the PDA with `isSigner:false` and is refused by `AccountNotSigner`, which is a different property."* A test that CPIs `mint_vault` from a stub program with a PDA signer as `owner` would **succeed today**. Write it; it will pass, and that pass is the finding.

**This is the most valuable item in this report.** Not because the code is wrong, but because the documentation asserts an impossibility, and while it does, nobody will ever build the control that exists.

### U-3. Control-table row 2 describes MINT and SEAL identically. MINT is strictly stronger; SEAL is not. LOW/MEDIUM

> `programs/cbob-vaults/src/lib.rs` walks every top-level instruction and refuses `BankKeyOutsidePair` if `config.bank` appears outside the open/burn pair; `programs/cbob-vault-mint/src/lib.rs` refuses `BankKeyOutsideMint` outside a `mint_vault`.

Since this diff, MINT is **positional**: the Bank's key may appear only at index 4 of a `mint_vault`, and naming it as `payer` is refused (test 9d.4). SEAL exempts the whole pair. One sentence therefore under-claims MINT and over-claims SEAL simultaneously — and the over-claim direction is the dangerous one, because a reader concludes the Bank cannot be named `payer` of a redemption when it can. Split it into two clauses. (See R7-3 for the code-side half.)

### U-4. `burn_vault` proves more than BURN's header and SPEC's impossibility 2 admit. LOW

BURN's header lists what it **CAN** prove as "PDA lamports zero; every reserve mint's ATA … declared, PDA-owned, undelegated and empty; no declared account is a live Core asset." SPEC's impossibility 2 says everything beyond the reserve mints "rests on … `bank/cosign.mjs` pre-signature plus two post-hoc detectors."

Both understate. The second loop in `burn_vault` applies the *full* proof — `dataLen == 165`, delegate zero, close-authority zero, `amount == 0` — to **any** declared account owned by the asset-signer PDA, reserve or not. So a redeemer who declares an airdropped non-reserve token account gets an on-chain refusal if it holds anything, and a Token-2022 account with extensions is refused outright. That is a real protection against the exact loss both documents describe as off-chain-only.

### U-5. `distribute.mjs`'s header says "THREE THINGS IT REFUSES TO DO". It refuses eight. LOW

Also refused, all in code: a distributor key that is not `config.treasury`; a key file readable beyond its owner; an index count that disagrees with `minted_total`; an index that reports an asset both live and burnt; a level register that is absent or unparseable or carries an unknown level; a vault burned between the plan and its turn in the loop. SPEC's "What the job refuses to do" is closer but still short. An enumeration in a header is how a control gets deleted by someone tidying up — you have written that sentence elsewhere in this very file. Say "refuses to guess, refuses to pay twice, refuses to create accounts, and refuses several other things enumerated in SPEC" or drop the count.

---

## KNOWN AND OPEN — where it is worse than stated

**Limit 12 (compute units) got worse again, and here is the number to measure.** `mint_vault`'s confinement is now a **nested** loop: for every top-level instruction, for every account in it, one 32-byte pubkey compare — on top of the per-instruction sysvar deserialization, which is itself the expensive part (`load_instruction_at_checked` copies and deserializes the whole instruction). A transaction with three mints (a plausible batch activation) runs that walk three times over three instructions each carrying twelve accounts, *plus* three `CreateV2` CPIs into Core with an Attributes plugin. Nothing anywhere measures it, and the failure mode is that batch activation stops working at some batch size nobody has established.

**Concrete ask, not a redesign:** add `ComputeBudgetProgram.setComputeUnitLimit` probing to `tests/3prog.test.ts` — binary-search the smallest limit at which each of `mint_vault` (1 and 3 per transaction), `open_for_redemption`, `burn_vault` (1/2/3 reserve mints) succeeds, print the numbers, and pin them as a ceiling the way `MAX_RESERVE_MINTS` is pinned to 831/975/1119 bytes. You already have the pattern; the CU axis is the one dimension of the redemption ceiling that has never been measured, and it may sit below the byte ceiling you did measure.

**Limit 3** — see R7-3. Not worse in magnitude; worse in that the rationale for fixing it is now written down in the sibling program and was not acted on here.

**Limit 2 (no override on a coverage refusal)** — interacts with R2-4. If an unlevelled-vault refusal ever coincides with a coverage refusal, an operator has two unanswerable halts and one SMS channel.

Everything else on the known list I found as stated.

---

## VERDICT CHALLENGES

Three claims in this diff that I think are wrong, restated so they are easy to check:

1. *"the half-finished day is silent"* — R5-1. One command settles it.
2. *"`nothingToDo` has exactly one reader"* — true; *"`resolvedBy` has one reader"* is what the DONE_MARKS derivation implicitly assumes, and it is false. R1-1.
3. *"no holder ever waits longer than a month while the pool can give every activated vault at least one satoshi"* — true as written, and now economically hollow at the boundary. R2-3.

Two claims I attacked and could not break: the base64 round trip (R3), and the `mint_vault` positional confinement (I tried the CPI wrapper, the fake-discriminator instruction, duplicate account metas, and address-lookup-table resolution; all fail closed).

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Six things, none of them in SPEC's SHIP GATE, ordered by how much of this round's finding volume each would have pre-empted.

**1. Generate the transaction space instead of hand-writing negatives.** Every Bank-key finding in rounds 15, 17, 18 and this one is the same shape: *some position or some instruction nobody enumerated*. Stop enumerating. Write a generator in `tests/` that, for each of the three Bank-signed instructions, builds N random transactions from: {0..3 extra instructions} × {System, Token, Token-2022, ATA, Core, MINT, SEAL, BURN, a stranger program} × {the Bank's key inserted at every index of every instruction, including duplicated} × {the instruction under test at every position, and reached by CPI from a stub program}, and asserts a refusal unless the transaction is in a small explicitly-blessed set. Run 10,000 cases in CI. That harness — not an auditor — is what finds "the payer slot" the day it is written. It is a day of work and it retires a defect class that has cost four rounds.

**2. Crash-point exhaustion on the money job.** `distribute.mjs` calls `save()` at seven distinct points. Build a harness that runs the whole job against a mocked RPC and kills the process **after each `save()`, one at a time**, then resumes, and asserts three invariants over the resulting ledger: no vault holds two signatures; no vault with a signature is re-sent; no day carries `finishedAt` with an unresolved row. That is ~30 mechanical scenarios and it covers every ordering R1 asks about (quiet-then-pay, refuse-then-pay, pay-crash-resume, two runs, dry-run between) by construction rather than by an auditor reasoning about them in prose. Every supersede/stale-flag finding in the last three rounds falls out of it automatically.

**3. Record and replay real RPC chaos.** The off-chain pipeline "has never run against a live deployment" and is tested entirely against hand-built fixtures, which is why its defects are always *shapes nobody imagined* (a 0-data account at a derived ATA, a short DAS page, a rolled-over date). Capture a golden corpus: point the jobs at mainnet in read-only mode for a month, record every RPC response to disk, and replay the corpus in CI with fault injection (truncate a page, drop a field, return a 200 with `{}`, return a token account of every length from 0 to 200 bytes). Fixtures encode what you expected; a corpus encodes what happened.

**4. Buy adversaries with execution, not opinions.** Sixteen rounds of models reason; none of them runs code against your validator. Before a single vault mints: deploy the four programs to devnet with a **published, funded bounty** (a fixed pot, escrowed, with a public scope naming the Bank key, the revenue PDA and the distributor as targets) and run it for 30 days with the full crontab live and a small but real cbBTC balance. A single person who actually submits a transaction is worth more than a round, and the price is knowable in advance. This is the only item here that produces *execution by an adversary*, which is the one thing this process structurally cannot generate.

**5. Kill the duplicated-fact problem at the root rather than gating it.** R6-2 exists because five documents restate four numbers, and the gates check three of the five. Equality floors made this worse, not better: every added assertion now requires a synchronised edit across `run-tests.sh`, two `.mjs` files and SPEC. Invert it — have the suites **emit** `build/assertion-counts.json`, and generate the numeric spans in SPEC (or a `SPEC-generated.md` include) from it at build time. Then "a fact stored twice" is not a defect you gate, it is a state that does not exist. Apply the same treatment to `MAX_RESERVE_MINTS` (emit the measured byte table) and to the control table's fourth column (generate it from the Rust and cron, rather than parsing prose and comparing).

**6. Institutionalise the one review that actually works.** The two worst defects since round 17 were found by the owner **reading**, not by a model and not by a gate: the co-signer row's under-claim, and the `${FLOORS.onchain}` literal. Both were found by looking at a *rendered artifact* rather than at source. Make that a scheduled step with a checklist, not luck: before each round, render (a) the audit prompt, (b) the customer card, (c) the control table, and (d) the output of `cron-install.sh` on a fresh crontab, and read all four aloud against the code with a fixed list of five questions — *does every sentence name a control that runs? does any sentence understate one? is every number in it derived? does any claim say "cannot" where a mechanism now exists? does the fourth column match the third?* Question four is the one that would have surfaced U-2, and no gate in this repository can ever ask it.