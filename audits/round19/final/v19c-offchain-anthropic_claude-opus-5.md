# INDEPENDENT SECURITY REVIEW — ec7d17e..HEAD

Scope note before anything else: I received the **off-chain bundle** (distribute.mjs, cosign.mjs, bank-sign.sh, cron-install.sh, selftest.mjs, detectors.mjs, SPEC.md, run-tests.sh) plus the full diff. `bank/alarm.mjs`, `bank/anchor.mjs`, `bank/lock.mjs`, `bank/spl.mjs`, `bank/revenue.mjs` and three of four programs are **not in this bundle and not in the diff**, and several of the questions I was asked turn on them. Where that bites, I say so rather than guessing — see R1-4.

---

# R1 — THE SELF-AUDIT'S OWN REPAIRS

## R1-1 · MEDIUM · The "a prompt may not ask about a file it does not deliver" guard is defeated by paraphrase, and it is defeated *right now*

**Construct.** `scripts/audit19.ts`:

```ts
const named=[...new Set([...targetSection.matchAll(
  /\b((?:programs|bank|scripts|tests)\/[\w./-]+\.(?:rs|mjs|sh|ts))\b/g)].map(m=>m[1]))]
```

The check requires only that **paths spelled as paths** in the R-sections appear in `TARGETS`. It says nothing about files the questions *depend on* but name in prose.

Measured against the shipped prompt:

* R1 bullet 3 — "*because nothingToDo's only reader SUPPRESSES distribution_unfinished*" — the reader is `bank/detectors.mjs`. Not spelled. **Not in the `programs` TARGETS list.**
* R5 bullet 4 — "*Two new arms assert that a stale nothingToDo suppresses distribution_unfinished*" — same file, same omission.
* R5 as a whole is about `bank/selftest.mjs`, whose *new* arms read `bank/anchor.mjs` (the `pinnedAccountData` arm), `bank/alarm.mjs` (the `if (s.err) continue` arm) and `programs/cbob-vault-gov/src/lib.rs`. **None of those three is in either TARGETS list.** I am asked "do the new arms prove what they claim?" about arms whose subject I cannot read.

So the round-19 repair for "the prompt asks about files it does not deliver" is itself one-of-N: it fixed the *spelled* references on both passes and left the *prose* references on both. This is the same shape as the defect it repairs, in the repair.

**What it costs.** Exactly what the comment says it costs: confident wrong findings answered from a diff hunk. The self-audit's own note records two such findings last round.

**Evidence if I am right.** Render `PROMPT` for `FOCUS=programs`, grep for `detectors.mjs` — absent from the bundle section. Grep the rendered `programs` prompt for `distribution_unfinished` — present in R1 and R5. The guard exits 0.

**Fix.** Derive the required set from what the *delivered targets read*, not from what the prose spells: static-scan each `TARGETS` file for `readFileSync('/opt/cbob-vaults/…')` and `import … from './…'` and require the closure. That is mechanical and would have caught all four files above.

## R1-2 · MEDIUM · `supersede` deletes `resolvedBy`, which is not a "done mark" — it is an operator's written judgement, and three other detector arms honour it

**Construct.** `bank/distribute.mjs`:

```js
export const DONE_MARKS = ['finishedAt', 'nothingToDo', 'resolvedBy']
…
for (const mark of DONE_MARKS) delete out[mark]
```

`DONE_MARKS` is derived (and gated) from **one** predicate — `detectDistribution`'s `distribution_unfinished` arm. But `rec.resolvedBy` is read by **three** arms in `bank/detectors.mjs`:

```js
if (rec.unreadableAtas?.length && !rec.resolvedBy) …      // distribution_vault_unreadable, HIGH
if (rec.refused && !rec.resolvedBy) …                      // distribution_refused, HIGH
if (rec.startedAt && !rec.finishedAt && !rec.nothingToDo && !rec.resolvedBy …) // unfinished
```

The derivation answers "*what suppresses `distribution_unfinished`*" and the code then uses it as "*what a superseding run may destroy*". That is cardinality where attribution was needed — the round-11 defect the suite has a whole arm for, committed inside the enumeration written to stop hand-kept lists.

**Reachable ordering, all inside one UTC day:**

1. 09:07. Some vault ATA is poisoned (a stranger, 1 lamport, free). `main()` writes `st.days[day].unreadableAtas` and saves. Pool is below threshold → `nothingToDo` + `finishedAt`. `distribution_vault_unreadable` fires HIGH every 30 minutes.
2. Operator looks, decides it is dust, writes `st.days[day].resolvedBy = 'gary: dust account, ignored'`. Alarm goes quiet — this is the documented mechanism (`selftest.mjs`: *"...and a human can resolve it"*).
3. 14:00, an afternoon run. Pool now clears. `supersede` fires, deletes `nothingToDo`, `finishedAt` **and `resolvedBy`**.
4. `unreadableAtas` is still on the record. `distribution_vault_unreadable` re-fires HIGH, forever, every 30 minutes, on a condition a human already adjudicated — and the adjudication text is **gone from the money ledger**. `supersededWas` records only `refused` and `nothingToDo`, so the deletion is silent.

**What an accident gains.** The permanent-nag class this repository has fixed four times, plus destruction of the only written record of an operator decision in a money ledger.

**Evidence if I am right.** Ledger day with `{unreadableAtas:[…], nothingToDo:'x', finishedAt:'y', resolvedBy:'gary: dust'}`, then a run that proceeds: `grep resolvedBy bank/distributions.json` returns nothing for that day, and `detectDistribution` returns `distribution_vault_unreadable`.

**Fix.** Split the concepts. `DONE_MARKS` should be the marks the *writer* produced (`finishedAt`, `nothingToDo`) — never a field only a human writes. If `resolvedBy` must be cleared to un-suppress `unfinished`, move it out of the day record into a per-finding acknowledgement (you already have `bank/acks.json` and `judgeAck`, with an expiry, for exactly this), and have the detector read *that*. Then the derived-list gate becomes correct instead of merely mechanical.

## R1-3 · MEDIUM · `done` is captured *before* `st.days[day]` is replaced by `supersede`'s return value; correctness rests on a shallow spread preserving one reference

**Construct.**

```js
const done = st.days[day].paid          // captured early
…
const sup = supersede(st.days[day], new Date().toISOString())
st.days[day] = sup.rec                  // WHOLE object replaced
…
done[v] = { amount: …, sig: null, sentAt: … }; save(st)
```

`supersede` does `const out = { ...rec }`, so `out.paid` is the *same object* `done` aliases. Today that works. It works only because the copy is shallow.

**What an accident gains.** Change `{ ...rec }` to `structuredClone(rec)` — a completely natural hardening for a pure exported function whose whole justification in the diff is "*a pure exported function whose safety depends on a caller's branch guard is one refactor away from being wrong*" — and `done` becomes detached. Every intent row and every signature written by the transfer loop then lands in an orphaned object; `save(st)` persists a day with `paid: {}`. A crash, or simply tomorrow's `holdDays`, sees no payments. **The next run re-sends every transfer.** That is the double payment this file's entire header is about.

Note the irony: the guard added this round (`alreadyPaid`) was added precisely because a pure function must not depend on a caller's branch. This defect is the mirror — a caller depending on an implementation detail of the pure function.

**Evidence if I am right.** Replace the spread with a deep clone, run `--selftest` (green — nothing covers this), then run a real distribution against a devnet mint and diff `distributions.json` before/after: `days[today].paid` is empty while transfers landed on chain.

**Fix.** One line: re-read after the assignment — `st.days[day] = sup.rec; const done = st.days[day].paid` — or make `supersede` mutate in place and return metadata only. And add an assertion that the alias survives: `const d = st.days[day].paid; st.days[day] = supersede(st.days[day],'now').rec; assert(st.days[day].paid === d)`.

## R1-4 · LOW · Rendering / staleness defects in the prompt that no gate sees

I rendered the prompt (it is what I was given). The floors **do** interpolate — 286/434/93/19, matching `run-tests.sh` exactly. The single `\${` is the deliberate R1 example. Those three claims are confirmed.

What is *not* confirmed:

* **Item 12 of KNOWN AND OPEN** says "*COMPUTE UNITS are unmeasured anywhere. **This one got worse this round — see R1.***" In round 18's prompt R1 *was* the instruction-introspection walk, so the cross-reference was true. In round 19 R1 is the self-audit's repairs, which touch no compute. The pointer is stale and misdirects.
* **REPORT FORMAT** says "*Order by target: R1-R6*" while the prompt defines **R1–R7**. R7 — "what the self-audit missed", the highest-yield target — is excluded from the requested ordering.
* It also asks for "*the verdict challenges*". Round 18's prompt carried a verdict section; round 19's does not. Auditors are asked to attack a section that was not shipped.
* "*Fifteen rounds have produced…*", "*EIGHT ROUNDS RUNNING…*", "*sixteen rounds of AI audit structurally cannot*" — three different counts in one document, for round 19/20.

**Why this is a finding and not pedantry.** The floors are gated *because a number duplicated into a document drifts*. Every other number in this prompt is typed and ungated, inside the instrument that performs the certification. Same class, same file, unfixed.

**Fix.** Read the round number and the R-list from one place (`const TARGETS_R = [...]`, and render both the section headers and the REPORT FORMAT line from it). Assert in `selftest.mjs` that the report-format line names every `**Rn.` heading present in the rendered prompt.

## R1-5 · LOW · The manifest record is well-formed; two adjacent nits

`dirty.split('\n').filter(Boolean)` on porcelain output preserves the two-column status prefix (`" M bank/foo.mjs"`) and drops the trailing empty element. Valid JSON, correctly aligned. **The self-audit's fix here is right.**

Two nits beside it:
* `WATCHED` is built by de-duplicating `['programs','bank','scripts','tests', ...TARGETS paths]`. Every `bank/*` and `scripts/*` target is already covered by the directory pathspec; the only entries that add anything are `SPEC.md` and (redundantly) `scripts/run-tests.sh`. Harmless, but the comment claims the scope is "derived from TARGETS so it cannot drift from the bundle" — it is derived from TARGETS *plus four hardcoded directories*, and it is those four that do the work. A target added outside them (`docs/CARD.md`, say) would be watched; one added inside them was already watched. The claim is stronger than the mechanism.
* `verifyRoster`'s new output-ceiling pre-flight **throws for the whole roster** if any single model reports `top_provider.max_completion_tokens < MAX_OUT`. With `MAX_OUT` raised to 128,000 this round, one provider re-declaring a 64k ceiling turns a full round into **no round at all**. That is fail-closed in the wrong granularity: drop the model, do not abort the certification. Same for the 2.3-chars/token context guard, which is deliberately the *densest* observed ratio and therefore the most likely to throw.

---

# R2 — THE ROUND-18 OFF-CHAIN REPAIRS

## R2-1 · HIGH · `resolvedAs: 'unpaid'` silently forfeits that vault's payment, permanently and with no alarm

**This is the direct answer to R2's second bullet, and the answer is: no, it is not still true for every caller.**

Round 18 introduced `resolvedAs` as a first-class value with two legal readings, and taught exactly one function about it:

```js
export function settledAsPayout(row) {
  if (paymentState(row) === 'paid') return true
  return paymentState(row) === 'resolved' && row?.resolvedAs === 'paid'
}
```
Asserted in both directions, including `resolvedAs: 'unpaid'` → false, under the comment *"a resolution that says nothing landed is NOT a payout day"*.

`paymentState` was deliberately left unchanged. Trace `resolvedAs: 'unpaid'` through the other three readers:

| reader | verdict for `{sig:null, resolvedBy:'gary: nothing landed', resolvedAs:'unpaid'}` |
|---|---|
| `paymentState` | `'resolved'` (the `row.resolvedBy` test is above `row.rejected`, on purpose) |
| transfer loop | `if (state === 'resolved') continue` — **never sent** |
| `outstanding` (SOL floor) | `paymentState !== 'unpaid'` — **not budgeted for** |
| `detectDistribution` | `!r.sig && !r.skipped && !r.rejected && !r.resolvedBy` → `resolvedBy` present → **silent**. The `refused` arm is also `!r.resolvedBy` → **silent** |

So an operator who investigates an ambiguous transfer, establishes on chain that **nothing landed**, and records that honestly in the field round 18 created for it, causes that vault to be **permanently unpaid for that day, with no finding, no page, and no retry on any later run**. That day's share stays in the distributor and silently carries into the dust.

The `paymentState` comment says the escape is "*a human who wants it retried deletes the row*". Round 18 then shipped a *second* documented way to say the same thing which does the opposite. Two sites, one fact, the newer one wrong — the repository's signature defect, inside the round-18 repair, in the direction that loses a customer's money.

**Evidence if I am right.** Write that row into `distributions.json` for a day with a real plan, run `node bank/distribute.mjs` (or `--dry-run`): the vault is skipped, `sent` does not count it, and `node bank/selftest.mjs`-style `detectDistribution` on that ledger returns `[]`.

**Fix (pick one, but pick one):**
* `paymentState`: `if (row.resolvedBy) return row.resolvedAs === 'unpaid' ? 'unpaid' : 'resolved'` — the honest resolution becomes retryable, which is what the operator meant. This changes `settledAsPayout` not at all (`'unpaid'` is not a payout day).
* Or refuse the value: throw at load if any row carries `resolvedAs: 'unpaid'`, with a message telling the operator to delete the row.
* Either way: **enumerate `resolvedAs`'s legal values in one exported constant**, validate against it, and add a detector arm `distribution_resolved_unpaid` at HIGH for any such row that is still unpaid. And document `resolvedBy`/`resolvedAs` in SPEC — neither appears there at all, so the field an operator must use to keep the cadence honest exists only in a source comment.

## R2-2 · CONFIRMED, direction is correct · `settledAsPayout`'s default

Traced end to end; the builder is right and the three prior auditors were right.

`holdDays` returns `dayDiff(anchor, day)` where `anchor` is the last day with a `settledAsPayout` row. Not counting a bare `resolvedBy` leaves `anchor` **older** ⇒ `n` **larger** ⇒ `daysSinceLastPayout` larger ⇒ `decideEmission`'s third branch `daysSinceLastPayout >= maxHoldDays` becomes true **sooner** ⇒ `pay: true, forced: true`. `holdDays` feeds nothing else that branches (`describeCadence` is descriptive). Larger holdDays ⇒ pays earlier. **The default is not backwards.** The pinning assertions (`52` vs `2` → `[true, false]`) are the right ones.

But see R2-3, which is what that direction actually buys.

## R2-3 · MEDIUM · The forced-at-ceiling payout can cost more in SOL fees than it delivers in satoshis, and nothing checks

`decideEmission` forces a payout at the ceiling whenever `smallestPer >= MIN_PER_VAULT` — and `MIN_PER_VAULT` is **1 satoshi**.

At the published 2,100-vault census (`den = 6405`), the smallest possible forced drop is `available = 3203` (see R2-4): every vault gets 1–3 sats, total ≈ 3,203 sats. The fee budget for that run is `5_000 * 2100 * 2 = 21,000,000` lamports = **0.021 SOL**. At $100k BTC and $200 SOL, that is roughly **$3.20 delivered for $4.20 in fees** — the run destroys value, and `settledAsPayout`'s conservative default makes it happen *sooner*.

Nothing in `decideEmission` compares the drop to its own cost. `MIN_PER_VAULT = 1n` is described as "the ABSOLUTE floor — you cannot send zero", which is true and is not an economic floor.

**Fix.** Give the forced branch its own floor expressed in cost terms, e.g. require `available >= FORCED_MIN_MULTIPLE * activated.length * FEE_SATS_EQUIV`, or simply set a forced-payout floor in satoshis and say on the card that the monthly ceiling applies "once the pool is worth sending". Whatever the number, **it is a Gary decision, and it belongs beside `EMISSION_MIN_PER_VAULT` as a second provisional constant** — right now the ceiling silently commits to paying at any positive amount.

## R2-4 · HIGH · The published cadence floor is **wrong by a factor of two**, and the comment claims an assertion that does not exist

**Construct.** `bank/distribute.mjs`, on `MAX_HOLD_DAYS`:

> *"the ceiling forces a payout only while the pool can give every activated vault at least one satoshi. … **At the published 2,100-vault census that floor is a denominator's worth — 6,405 sats.** Asserted in BOTH directions in bank/selftest.mjs."*

And `SPEC.md`, in the customer-facing cadence section:

> *"Below one satoshi per vault — **a denominator's worth, 6,405 sats** at the 2,100-vault census — `decideEmission` returns 'nothing to distribute' before the ceiling is consulted, and the wait is unbounded."*

**Re-derive it.** The smallest share belongs to a Level I vault, weight **2**:

```
per_I = floor(available * 2 / 6405) >= 1  ⟺  available * 2 >= 6405  ⟺  available >= 3203
```

At `available = 3203`: `3203*2 = 6406`, `floor(6406/6405) = 1`. Every vault gets at least one satoshi (I:1, II:1, III:2, IV:2, V:3).
At `available = 3202`: `6404/6405 = 0`. `allocateWeighted` skips.

**The floor is 3,203 sats, not 6,405.** In general it is `ceil(denominator / min_weight)` = `ceil(6405/2)`, not `denominator`. "A denominator's worth" is the right figure only if the minimum weight were 1 — and the schedule's minimum weight is 2, which is the whole point of the 2/3/4/5/6 ladder.

**Second defect in the same paragraph.** "*Asserted in BOTH directions in bank/selftest.mjs*" — the two arms that exist assert the *predicate* (`smallestPer: 0n` never fires at any age; `smallestPer: 1n` fires at the ceiling). **Nothing anywhere asserts 6,405, or 3,203, or any sats figure for this floor.** That is a comment naming a control that does not run — the ninth-plus instance of this project's tracked defect class, and it is what let the wrong number ship: the builder wrote the claim and the gate in the same commit and gated the wrong thing.

**What it costs.** The number is on a customer-facing disclosure about *how long a holder can be made to wait*. It overstates the required pool by 100%, so it understates how often the monthly ceiling actually fires. (Note the direction: the system is **better** than the document says — see also the Under-Claim section — but a wrong figure on a card is wrong in either direction.)

**Evidence if I am right.**
```js
allocateWeighted(bals2100, levels2100, 3203n).skip   // → null   (pays)
allocateWeighted(bals2100, levels2100, 3202n).skip   // → "only 3202 for a denominator of 6405"
```

**Fix.** Correct both sites to **3,203**, express it as `ceil(denominator / Math.min(...Object.values(LEVEL_WEIGHTS)))`, and *actually* assert it — both directions, at both censuses (240 → 366) — plus a SPEC-reading arm of the same shape as the dust one already added, so the two documents cannot diverge again.

## R2-5 · MEDIUM · A £17 griefing surface is now an SMS pager on every daily run, with no rate limit and no exclusion path

**Construct.**

```js
if (plan.refusal) {
  const msg = `CBOB DISTRIBUTION REFUSED and paid nobody: ${plan.skip}`
  console.error(msg)
  if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} }
  process.exitCode = 1
}
```
`NOTIFY = '/opt/scripts/notify-gary-sms.sh'`.

The trigger is `unlevelled.length` in `allocateWeighted`: any vault that is *activated* (≥ 21,000 sats ≈ $21 at $100k BTC) and absent from `levels.json`. Minting is public. So a stranger who mints one vault and funds it with 21,000 sats:

1. Halts **every** holder's distribution (accepted limit, round 17).
2. Now also **SMSes the owner at 09:07 every day**, un-rate-limited, until an operator edits the register.
3. And `bank/alarm.mjs` independently raises `distribution_refused` at HIGH — every 30 minutes, ~48 more notifications per day, because `rec.refused` is written and only `rec.resolvedBy` silences it.

SPEC states, deliberately, that the alarm alerts "*by EMAIL (never SMS)*" — to keep the channel credible. The money job's newest branch routes a **stranger-triggerable** condition to SMS. The two halves of the same pipeline now disagree about noise discipline in the direction that trains the owner to ignore the pager.

Note the shape of the only remedy: the operator must **assign the griefer's vault a level**, which under "assigned by fate, permanent, cannot be appealed" makes the attacker a paid participant at a level the attacker forced you to choose under time pressure.

**Fix.**
* Page **once per condition per day**, not once per run: key the notify on `st.days[day].refusedNotifiedAt`.
* Give `levels.json` an explicit non-paying value (`"QUARANTINE"`) that `allocateWeighted` accepts as *not activated, not in the denominator, not a refusal*. That converts a halt-plus-page into a one-line operator action with no fate assigned and no payout.
* Route the refusal to the same channel as the alarm (email), and keep SMS for the deadman and for the SOL floor — conditions only *you* can cause.
* Keep `exitCode = 1` as designed; the reasoning in the new EXIT CODES block is sound.

## R2-6 · REFUTED · `census()`'s null-prototype spread

The census round-trips. `Object.create(null)` is only the *accumulator*; `return { ...c }` produces an ordinary object, so `JSON.stringify` emits it, the resume path reads it back as a plain object, `denominator`'s `Object.hasOwn(c ?? {}, l)` is fine on either, and `plan.census[l] || 0` in the log is fine. No consumer needed a prototype. **No finding.** The prototype-key hardening is correct and is the reason `census({a:'__proto__'})` no longer produces a `__proto__` key.

## R2-7 · CONFIRMED (bound), MEDIUM (what the bound describes)

**The mathematics is right.** `dust = available - Σ_v floor(available·w_v/den)`. Since `Σ w_v = den`, `Σ (available·w_v/den) = available` exactly, so `dust = Σ frac_v` with each `frac_v ∈ [0,1)`, hence `dust < n` **always** — including `available < n` (e.g. `available=1, n=3` → dust 1) and including every skip return (which reports `dust: 0n`). Attainment at `available = den-1` checks out: I re-derived `dustAt(6404) = 13,444,095 / 6405 = 2099` exactly, and `2099 = 2100 - 1`. The builder's rejection of the "true maximum is ~1,731" finding is **correct**.

**But the figure describes only the allocator, and both documents present it as the settlement remainder.** SPEC: "*at 2,100 vaults the remainder can be up to **2,099** sats a settlement*". What actually stays in the distributor is `dust + Σ per[v]` over every vault that was **skipped** (burned after the plan was fixed), **refused**, **ambiguous**, or resolved-as-unpaid (R2-1). One Level V vault burned mid-run retains its whole share; a frozen-ATA day retains many. Those all "carry to the next drop" — which is the correct behaviour — but they are not bounded by 2,099, and the tightened figure now reads as though they were.

**Fix.** One clause: "*integer-division dust is under one satoshi per paid vault (≤ 2,099 at 2,100 vaults); shares for vaults that could not be paid also carry forward and are not bounded by that figure*." And publish the carried total per settlement alongside the census and denominator — you already print `dust`; print `available - Σ(sent)` too, which is the number a holder can actually check.

---

# R3 — `scripts/bank-sign.sh`

## R3-1 · The round trip is sound. I could not break it.

The gate is `decode(TX)` then `encode(...)` then string equality. If that holds, `TX` **is** the canonical encoding of some byte string `B`, and `Buffer.from(TX,'base64')` on canonical input yields `B`. Every accepted input therefore decodes to exactly what was pasted. Specifically:

* `====`, `A===`, `AB==`, `AAB=`, `AAAA====` → all refused (`base64 -d` errors, or the re-encode differs). ✓
* Embedded whitespace: stripped by `tr -d '[:space:]'` before anything else, so a wrapped or trailing-newline paste passes. ✓ (Confirmed by the two new selftest arms, which run the real script.)
* Quoted-printable soft line breaks (`=\n` from a mail client): the `\n` is stripped, leaving a mid-string `=`, which the `*=*[!=]*` case catches. ✓
* `set -euo pipefail` inside `$( … )`: handled by the trailing `|| true`. A failing decode makes `CANON` empty, which can never equal a non-empty `TX`. **Fails closed.** ✓ (The `base64`-unavailable arm proves this.)
* `base64 -w0` availability: absent/BSD `base64` ⇒ empty `CANON` ⇒ refuse everything. Availability problem, not a security one, and the box is Ubuntu.
* Locale: `[A-Za-z0-9+/=]` inside `case` uses collation ranges, so a non-C locale can make that *pattern* accept exotic letters. It does not matter — the round trip refuses them. **But it means the alphabet, padding and length checks are now decorative**, and their error messages are the ones an operator will see for genuinely different problems. Consider ordering the round trip **first** and keeping the three earlier checks purely for better diagnostics.

**It rejects nothing legitimate.** 1232 bytes → `410` full 3-byte groups (1640 chars) + one 2-byte group (`XXX=`) = **1644 chars, one `=`**, length ≡ 0 mod 4, canonical. Accepted. Node/`solana`/`spl-token` all emit canonical base64, so there is no producer whose output this refuses.

## R3-2 · The corrected `ps` comment is substantively true but quotes a line that does not exist

The claim — "the transaction IS in `ps`" — is correct: the last line is

```sh
exec /usr/bin/env node bank/cosign.mjs --tx "$TX" ${LIVE[@]+"${LIVE[@]}"}
```

so the base64 sits in the co-signer's `argv` (and `/proc/PID/cmdline`) for that process's life. The *comment* quotes it as `exec node bank/cosign.mjs --tx "$TX"` — missing `/usr/bin/env` and the `LIVE` expansion. Cosmetic, but this repository has been bitten repeatedly by comments that quote source inexactly, and one arm of the suite (`there is exactly ONE exec-of-the-co-signer line in the code`) exists *because* a comment quoting this line broke a gate. **Quote it exactly, or do not quote it.**

The risk assessment ("an unsigned transaction is not a secret") is right. Writing it down as an accepted limit rather than changing `cosign.mjs` before a freeze is the correct call.

---

# R4 — `scripts/cron-install.sh`

## R4-1 · HIGH · Disabling the distribute cron by **commenting it out** — the exact operator behaviour `ours()` was written to respect — re-arms the live cbBTC sender on the next installer run, and deletes the evidence

**Construct.**

```sh
ours() { grep -F "$TAG" <<<"$CUR" | grep -v '^[[:space:]]*#'; }
DIST_DRY=''
if ours | grep -q 'distribute\.mjs --dry-run'; then DIST_DRY=' --dry-run'; fi
…
grep -v "$TAG" <<<"$CUR" > "$TMP"          # ← removes commented-out tagged lines too
```

The round-19 repair explicitly recognises commenting-out as *"the ordinary way an operator DISABLES a cron"* — and uses that insight in exactly one direction: to stop a commented revenue line arming `--live`. For distribute the same insight is not applied. Trace it:

1. Operator installs. Distribute is live (documented).
2. Operator decides to stop distributing and comments the line out. Cron stops running it. Correct, ordinary, and what `ours()`'s own comment calls the normal way.
3. Anything re-runs `cron-install.sh` (a redeploy, a new lock dir, a logrotate change — the script does five unrelated things).
4. `ours()` filters the commented line out → no `--dry-run` found → `DIST_DRY=''`.
5. `grep -v "$TAG"` **deletes the commented line entirely**.
6. A fresh, uncommented `bank/distribute.mjs` with no `--dry-run` is written. **The live cbBTC sender is armed from the next 09:07, and the record of the operator's decision is gone.**

The asymmetry the diff's own comment names — *"failing to preserve `--live` under-arms and is safe; failing to preserve `--dry-run` ARMS"* — applies with full force to the case the repair did not consider. This is one-of-N inside the fix for one-of-N, in the money installer, for the second consecutive round.

The only mitigation is the new MONEY POSTURE print, which is computed correctly from the written crontab and *will* say `LIVE FROM THE NEXT 09:07`. That is a human reading stdout of a script they ran for an unrelated reason.

**Evidence if I am right.**
```sh
./scripts/cron-install.sh
crontab -l | sed 's|^\(7 9 .*distribute\)|# \1|' | crontab -   # disable the normal way
./scripts/cron-install.sh
crontab -l | grep distribute      # uncommented, no --dry-run; the commented line is gone
```

**Fix — structural, and I would not ship without it.** Make `distribute.mjs` **opt-IN** (`--live`) exactly like `revenue.mjs`, and delete `--dry-run` as the gate. Then no crontab an installer writes can move money, in any ordering, and the header's whole confessional paragraph becomes unnecessary. Failing that: (a) preserve a commented-out tagged line *as commented out* rather than deleting it, and (b) refuse to write an armed distribute line unless the operator passes an explicit `--arm-distribute` flag to the installer.

## R4-2 · The new header is true for the four jobs I can verify, and unverifiable for the fifth

Enumerating every installed line:

| line | tag | can it move money as installed? |
|---|---|---|
| `23,53 * * * *` `bank/alarm.mjs` | watcher | **No.** Read-only + notify. It is not in the signer set (`selftest.mjs` pins exactly three signers, and this is not one). |
| `7 9 * * *` `bank/distribute.mjs$DIST_DRY` | distribute | **YES, on a fresh crontab.** No `--dry-run`; loads `keys/distributor.json`; sends cbBTC. Header states this correctly. |
| `41 */6 * * *` `bank/revenue.mjs$REV_LIVE` | revenue | **Header says dormant. I cannot verify — `bank/revenue.mjs` is in neither the bundle nor the diff.** Note that `sweep_sol_for_swap` is *permissionless on-chain*, so "dormant" is a property of that file's `--live` gating only, and nothing in this bundle proves the gate covers the sweep, the swap and the return. R4 asked me to "read the crontab lines; do not take the header's word for it" — the crontab line is right; the *claim about what the program does without `--live`* is undeliverable from this bundle. |
| `19 4 * * *` `bank/alarm.mjs --reconcile` | reconcile | **No.** State enumeration. |
| `9 */2 * * *` deadman | deadman | **No.** `test(1)`/`find(1)` + notify. |

`crontab -l \| grep -cF '$TAG'` = 5, matching the printed instruction. The MONEY POSTURE block reads the real crontab (`crontab -l … | grep -q -- '--dry-run'`) and is the right pattern.

**One omission in the header.** It tells the operator distribute is armed, but not that an armed distribute **SMSes on a condition any stranger can trigger** (R2-5) and exits non-zero. An operator installing this will be paged, and the header is the last place they read before it happens.

---

# R5 — THE GATES

## R5-1 · `isTableRow`: one definition, used in four places, sound-but-brittle; and `tableSrc` is not the control table

`const isTableRow = l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l)`

Used by `tableRows`, `controlTableBlock`'s validator, `tableLines`, and the two moved-to-prose arms. That is genuinely one definition now. ✓

**What it misses / what fails wrongly:**

* **`^\| ` requires a space after the leading pipe.** `|**BANK MUST SIGN**| … |**ON-CHAIN.** …|` is perfectly valid GitHub Markdown and renders identically, and it turns `EVERY row in the control table block carries a classification` **red**. Fails closed, so not dangerous — but this is the second incarnation of "a gate that fails when the documentation becomes more accurate", which the diff itself just fixed (`rows.length === 5` → `>= 5`). Loosen to `/^\|\s*.*\|\s*\*\*(…)\.\*\*/`.
* **`tableSrc = specSrc.split('\n').filter(isTableRow).join('\n')`** is *every classified row anywhere in SPEC*, not the control-table block — while the assertion's own title says "NAMED in the control table". Today it is equivalent (no other SPEC table carries `**ON-CHAIN.**` / `**AUTOMATIC.**` / `**PROCEDURE.**`), so this is LOW. But the repair went whole-file → all-table-rows, and the *block* is already computed twenty lines above. Use `block.join('\n')` and the title becomes true.
* A real control row cannot fail to match for any reason I can find *other* than the leading-space requirement — the classification must be the first thing after some pipe, and every existing row satisfies that.

## R5-2 · LOW · The `MintVault` struct parser under-counts fields; the gate's protection rests on fail-closed behaviour, not on the parse

`mintVaultFields` takes `^\s*pub (\w+):` inside the non-greedy `\{([\s\S]*?)\n\}` body. The body regex I could not break — no Anchor attribute, doc comment or `#[account(...)]` block produces a line-initial `}` — and the pinned `slice(0,6)` assertion makes a mis-parse loud. **The builder's rejection of "truncation can permit a stale constant" is correct**, and I confirm the direction: truncation before `bank` → `indexOf = -1 ≠ 4` → red; truncation after `bank` → index unchanged.

Two things the parse cannot see:

* **A non-`pub` field.** Anchor deserialises accounts in *declaration* order regardless of visibility; the parser counts only `pub`. A non-pub field inserted before `bank` shifts the runtime index while leaving the parsed index at 4.
* **Account composition** — `pub common: CommonAccounts<'info>` — counts as *one* parsed field and expands to N accounts at runtime. Idiomatic Anchor, and invisible here.

In both cases the *consequence* is fail-closed, and I want to be precise about that rather than overstate it: if `bank`'s real runtime index moves off `MINT_IX_BANK_IDX`, then **every honest mint refuses** (`a.pubkey == bank && n != 4`), because Anchor's `require_keys_eq!` forces the real `bank` account into its real slot. There is no arrangement I can construct where the exemption lands on `payer` while an honest mint still works — so the round-18 theft does not return. This is a **robustness** defect in a new gate, not a vulnerability.

**Fix.** `^\s*(?:pub\s+)?(\w+)\s*:` and additionally pin the total field count (`mintVaultFields(mintSrc).length === 13` or whatever it is), which catches composition too — a composed struct changes the count.

## R5-3 · LOW · `codeOnly` is unsound for shell in general; one arm in the same block still uses raw source

`codeOnly = src => src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')`

**What `#` is not a comment, at line start:**
* **Inside a heredoc.** `bank-sign.sh` has none, so this is safe *today*; `cron-install.sh` has two (`<<CRON`, `<<ROT`) and its own selftest block reads it by `indexOf` slicing rather than `codeOnly`, so no arm currently mixes the two. If `codeOnly` is ever pointed at `cron-install.sh`, every crontab comment line becomes invisible code and vice versa.
* Inside a multi-line quoted string.
* `#!` shebang — stripped, harmless.

**What it does not strip:** a trailing comment. The builder identified this and answered it correctly with `there is exactly ONE exec-of-the-co-signer line in the code`, which is the right fix ("first match" was the defect, not "comments"). Verified: the anchored `/^\s*exec .*cosign\.mjs.*$/gm` counts 1 in `codeOnly(signSh)`, and a trailing-comment reproduction cannot match because it does not start the line.

**One-of-N inside the repair:** the *earlier* arm in the same block —

```js
t('the wrapper forwards no argument it has not recognised',
  /^\s*exec .*cosign\.mjs --tx "\$TX" \$\{LIVE\[@\]\+"\$\{LIVE\[@\]\}"\}\s*$/m.test(signSh), true)
```

— still tests **raw `signSh`**, while the three arms below it test `codeOnly(signSh)`. Safe today (the `^\s*exec` anchor cannot match a `#`-prefixed line), but it is two definitions of "the exec line" in one block, one comment-aware and one not, in the gate whose entire purpose is stopping two readers of one fact from drifting. Route it through `codeOnly` too.

## R5-4 · LOW-MEDIUM · The two new "stale `nothingToDo`" arms in `selftest.mjs` do **not** prove the danger their comment claims

**Construct.**

```js
t('a half-finished day raises the alarm...',
  D.detectDistribution({days:{'2026-08-20':{startedAt:'x',
    paid:{v1:{sig:'abc'}, v2:{sig:null}}}}},{today:'2026-08-21'})
    .some(f=>f.kind==='distribution_unfinished'), true)
t('...and a STALE nothingToDo would silence it — which is why the writer clears it',
  D.detectDistribution({days:{'2026-08-20':{startedAt:'x',nothingToDo:'holding: quiet morning',
    paid:{v1:{sig:'abc'}, v2:{sig:null}}}}},{today:'2026-08-21'})
    .some(f=>f.kind==='distribution_unfinished'), false)
```

The comment above them says the fail-open is *"a half-finished day with unpaid holders goes silent."* **It does not go silent in this fixture.** `v2: {sig: null}` is an unresolved row, so `distribution_unresolved` fires at **CRITICAL** in the second case too. The arms prove the narrow predicate (`unfinished` is suppressed) and then justify themselves with a claim about the *day* that the same fixture refutes.

The genuinely silent shape is the one `distribute.mjs`'s own new arms use — a plan written and the process dying **before any row** (`crashed = { plan: {…} }`, `paid` absent). Those arms are correct.

**Why it matters here.** These two arms are the *documentation* for why `supersede` must clear the flags. A justification that its own fixture refutes is precisely the "argued from a premise its code makes false" defect the round-19 comment on `supersede` calls out one file away.

**Fix.** Change both fixtures to `paid: { v1: { sig: 'abc' } }` (or `paid: {}`). Then the first arm fires only `distribution_unfinished`, the second fires **nothing at all**, and the pair actually demonstrates a half-finished day going dark.

## R5-5 · LOW · `errNames` is still blind to one `#[msg]` shape

The new enum-body scrape is a real improvement and I confirm it now catches a bare `Variant,` with no `#[msg]`, and works with the attribute on either the same line or the preceding line (`\s*` spans the newline; `$` is multiline).

Remaining blind spot: `[^"]*` inside `#\[msg\("[^"]*"\)\]` stops at the first `"`, so **a message containing an escaped quote** (`#[msg("the \"bank\" slot")]`) makes the line unmatchable and the variant invisible to `bankErrs` — fail-open, the same class the repair just closed. Use `(?:[^"\\]|\\.)*`, or simply drop the attribute from the pattern entirely and take `^\s*(\w+),\s*$` plus `^\s*#\[msg\(.*\)\]\s*(\w+),\s*$` as two alternatives.

## R5-6 · LOW · The floor-drift readers are indentation-coupled (fails closed, but say so)

`num(/^const FLOOR = (\d+)$/m, selftest)` and `num(/^  const FLOOR = (\d+)$/m, distribute)` — the second requires **exactly two leading spaces**. Reformat, and `num` returns `'NOT FOUND'` → mismatch → red. Correct direction, but it means the anti-drift gate for the money file breaks on whitespace. Match `/^\s*const FLOOR = (\d+)\s*$/m` in both and, since `distribute.mjs` now exports nothing for it, consider exporting the floor so the gate can `import` it instead of scraping.

---

# R6 — THE COUNTS AND THE ARITHMETIC, INDEPENDENTLY

## R6-1 · The floors agree, four ways. ✓

| number | `run-tests.sh` | owning file | SPEC "Running the tests" | rendered prompt |
|---|---|---|---|---|
| on-chain | `MIN_ASSERTIONS=286` | — | `# 286 assertions, real cloned Core` | 286 |
| detector | `DET_FLOOR=434` | `selftest.mjs` `FLOOR = 434` | `(+ 434 detector` | 434 |
| allocation | `ALLOC_FLOOR=93` | `distribute.mjs` `FLOOR = 93` | `93 allocation` | 93 |
| mainnet | `MAINNET_FLOOR=19` | — | `19 live-mainnet` | 19 |

The equality change (`-eq` in `floor()` and on `MIN_ASSERTIONS`) is correct and the reasoning is right. Two notes: the `-ge` checks immediately above each `-eq` are now dead code, and the allocation count is **data-dependent** (`for (const missed of needed)` adds one assertion per suppressor parsed out of `detectors.mjs`), so `ALLOC_FLOOR` is now coupled to another file's source. That coupling fails closed in every case I traced (a regex miss gives `needed = []`, dropping 3 assertions → 90 ≠ 93 → red, and the `needed.length > 0` guard fires too), but it should be written down where the floor is set.

## R6-2 · MEDIUM · SPEC carries **three** stale assertion counts, one of them two lines from the gated one

The round-19 repair added `selftest FLOOR == DET_FLOOR` and `distribute FLOOR == ALLOC_FLOOR`. It did not sweep SPEC. Measured against the real values:

| SPEC text | says | real |
|---|---|---|
| "*Every detector is proven in BOTH directions by `bank/selftest.mjs` (**69 assertions**)*" | 69 | **434** |
| "*`node bank/distribute.mjs --selftest` &nbsp;# **63** allocation assertions*" | 63 | **93** |
| "*The **270-assertion** suite runs against real mainnet Core*" (SHIP GATE table) | 270 | **286** |

The second is in the **same code block** as `93 allocation and 19 live-mainnet`, which *is* gated by `t('SPEC states the allocation floor', num(/(\d+) allocation and \d+ live-mainnet/, spec), alloc)`. One line gated, the identical fact three lines down not. That is one-of-N-sites, in the SPEC-count gate, in the round that added a SPEC-count gate for the dust figure.

Also stale and ungated, in the document that decides whether this ships: "*Thirteen AI audit rounds*", "*Rounds 6 through 10*", "*Thirteen rounds, thirteen with a real finding. The gate has been met **zero** times*" — at round 19/20.

**Fix.** One arm: extract every `\b\d{2,4}\b` that appears within 40 characters of the words `assertion(s)` in SPEC.md and require each to be a member of `{onchain, det, alloc, mainnet}`. That is a five-line gate and it closes the whole class instead of the three instances I happened to find.

## R6-3 · The schedule arithmetic reproduces exactly. ✓

Re-derived from the weights, independently:

* **240 census** 108/60/36/24/12 → sums to 240 ✓; matches 45/25/15/10/5% of 240 exactly ✓; denominator `108·2+60·3+36·4+24·5+12·6 = 216+180+144+120+72 = **732**` ✓
* **2,100 census** 945/525/315/210/105 → sums to 2,100 ✓; matches the odds exactly ✓; denominator `1890+1575+1260+1050+630 = **6,405**` ✓
* **Per $1,000 @240**: 2.7322→**2.73**, 4.0984→**4.10**, 5.4645→**5.46**, 6.8306→**6.83**, 8.1967→**8.20** ✓
* **Per $1,000 @2,100**: 0.31226→**0.31**, 0.46838→**0.47**, 0.62451→**0.62**, 0.78064→**0.78**, 0.93677→**0.94** ✓
* **Shares @2,100**: 189000/6405=29.508→**29.5**, 157500/6405=24.590→**24.6**, 126000/6405=19.672→**19.7**, 105000/6405=16.393→**16.4**, 63000/6405=9.836→**9.8**; exact sum **100.0%** and the rounded five also sum to 100.0 ✓
* Level V / Level I = 6/2 = **3×** ✓
* Dust bound: `dustAt(6404) = 2099 = 2100 - 1`, attained ✓ (worked above)

**Every published figure checks out.** The one wrong number in the cadence disclosure is R2-4's 6,405.

## R6-4 · MEDIUM · The published census tables assume a **fixed deck**; the published odds assume **independent draws**. The code has accidentally chosen one of the open items.

Known-and-open #18 says the randomness source (VRF / commit-reveal / *a sealed 240 deck*) is deliberately absent from the code, and asks me to say if the code has assumed one. **It has, in the disclosure layer.**

* SPEC and the card publish odds — "*I 45% | II 25% | III 15% | IV 10% | V 5%*". Independent draws.
* SPEC and `distribute.mjs --selftest` publish censuses — 108/60/36/24/12 and 945/525/315/210/105 — which are *exactly* those percentages of 240 and 2,100, to the unit. That is only achievable with a **sealed deck**, i.e. sampling without replacement from a fixed multiset.
* Every downstream figure — the denominator (732 / 6,405), all ten per-$1,000 numbers, all five share percentages, the 3,203-sat cadence floor, and the 2,099-sat dust maximum — is computed **from those exact censuses** and asserted as fact in the suite.

Under independent draws none of those is a constant. At 240 draws with p=0.05, the Level V count has sd ≈ 3.4 — 8 or 17 are both ordinary outcomes — the denominator moves with it, and each per-$1,000 figure moves by a few percent. A holder who reads "*your Level V vault receives $8.20 per $1,000*" and then receives $8.55 or $7.90 has been given a point estimate dressed as a schedule.

**This is not a request to pick the randomness source.** It is: the disclosure has already picked one, and the suite has pinned it.

**Fix — cheapest first:**
1. **Deal a sealed deck** (exactly 945/525/315/210/105 for the first 2,100, pro-rated per round). Then every published figure is *true*, the commitment scheme in known-limit #16 becomes trivial (hash the shuffled deck, publish before activation, reveal after), and "assigned by fate, cannot be appealed" becomes checkable. This is the option SPEC already lists.
2. Or relabel every table and card figure as "**at the expected census**", add the variance, and change the suite's assertions from "the census is X" to "the *expected* census is X".

Option 1 also removes the census from the set of things that can drift, which is the thing this repository is worst at.

---

# R7 — WHAT THE SELF-AUDIT MISSED

The claim under test: *"`settledAsPayout` is the ONLY site asking the cadence question and no other `paymentState` caller conflates the same thing."*

**The first half is true. The second half is false**, and R2-1 is the finding: `resolvedAs` is a value with two meanings, taught to `settledAsPayout` and to nothing else, and its second meaning silently forfeits a payment in the three readers that were not touched (`paymentState`, the transfer loop, `detectDistribution`). Note also that `detectDistribution`'s row predicate is a **fourth hand-rolled copy** of `paymentState` (`!r.sig && !r.skipped && !r.rejected && !r.resolvedBy`), living in a file that cannot import it — one fact, four readers, the newest three unaware of the newest field.

Applying "was this fix applied to all sites of its own shape" to the rest of the diff:

| fix | sites of its shape | applied to |
|---|---|---|
| floors → equality | `floor()`, `MIN_ASSERTIONS`, `selftest FLOOR`, `distribute FLOOR`, **SPEC's three prose counts** | 4 of 7 (R6-2) |
| `Object.hasOwn` for level keys | `census`, `denominator`, `allocateWeighted`, `loadLevels` | **4 of 4 ✓ — complete** |
| honour only *our tagged, uncommented* cron lines | `--live` on revenue, `--dry-run` on distribute, **and the commented-out form of each** | 2 of 4 (R4-1) |
| `codeOnly` on exec-scraping arms | 4 arms in the block | 3 of 4 (R5-3) |
| "prompt must deliver what it asks about" | spelled paths on both passes; **prose-named files on both passes** | 2 of 4 (R1-1) |
| derive the suppressor list from the detector | `distribution_unfinished`; **`distribution_refused` and `distribution_vault_unreadable` also honour `resolvedBy`** | 1 of 3 (R1-2) |
| SPEC/code number agreement | dust (gated ✓), **cadence floor (R2-4, ungated and wrong)**, assertion counts (R6-2) | 1 of 3 |

## R7-1 · HIGH · Every `mint_vault` requires the Bank's signature, and this repository contains **no tool that can produce it** — while its own gates forbid adding one

**Construct.** Three facts from files in this bundle:

1. `programs/cbob-vault-mint` takes `bank: Signer` and `require_keys_eq!`s it against config. SPEC's control table row 1 states it: *"no vault can be unsealed **or burned** without the Bank's signature"* — and MINT's confinement, the new `MINT_IX_BANK_IDX`, `BankKeyOutsideMint` and tests 9d.1–9d.4 exist only because the Bank co-signs **every mint**, i.e. every activation.
2. `bank/cosign.mjs` is the **only** file permitted to read the Bank key — pinned in `selftest.mjs` (`exactly ONE file in the tree reads the Bank key` → `['bank/cosign.mjs']`; `exactly THREE signers exist` → cosign/distribute/revenue; `exactly ONE file invokes the co-signer` → `scripts/bank-sign.sh`).
3. `cosign.mjs` signs only what `judgeRedemptionTx` blesses, and that function's **first** check is:

```js
if (opens.length !== 1 || burns.length !== 1) {
  bad.push(`expected exactly one open_for_redemption and one burn_vault, found …`)
  return { ok: false, … }
}
```

A `mint_vault` transaction has zero of each. **`./scripts/bank-sign.sh mint.b64 --live` refuses it at the shape stage, always.**

**So one of these is true, and both are serious:**
* **Minting is impossible with the shipped tooling** — the product cannot onboard a member.
* Or the Bank key will be used **outside the "ONE sanctioned path"**, by hand or by an unversioned script, in which case: SPEC's SIGNING section ("*producing a Bank signature any other way is out of policy*", "*a second signer is a build failure rather than a discovery*") is false in production for the busiest money path, and every control in that section — one reader, one `partialSign`, downstream of the refusal, one invoker — applies to the *rare* path and not the frequent one. That is round 17's CRITICAL ("the rare path was hardened and the busier one left open") repeating one layer up, in the tooling instead of the program.

**And the mint path has no substitute checks at all.** Known limit 1a says the program allowlist and the fee-payer check are off-chain "in `judgeRedemptionTx`". `judgeRedemptionTx` **does not cover mints**. So for a transaction the Bank co-signs at every activation there is:
* no program allowlist — any instruction to any program may ride along;
* **no fee-payer check** — the on-chain confinement cannot see the fee payer (SPEC's row says so), and there is no off-chain arm for mints, so `mint_vault(bank=cfg.bank, payer=attacker, owner=attacker)` with `feePayer = bank` and a `ComputeBudget setComputeUnitPrice` of the attacker's choosing bills the Bank's SOL, repeatably, bounded only by the Bank's balance;
* no check that a mint is not happening during an open proposal (SPEC calls this a *written duty*) and no check for the charter Proof-of-Burn (SPEC's other written duty) — both were to be enforced by the co-signer that cannot run.

**Evidence if I am right.** Build any valid `mint_vault` transaction, base64 it, `./scripts/bank-sign.sh mint.b64 --live` → exits 1 at the shape check with `expected exactly one open_for_redemption and one burn_vault, found 0 and 0`. Then `grep -rn "fromSecretKey" bank/ scripts/ tests/` → three files, none of which signs a mint.

**Fix.**
* Add `judgeMintTx(ixs, cfg)` to `bank/detectors.mjs`, proven both ways: exactly one `mint_vault` to MINT; the Bank's pubkey **only** at `MINT_IX_BANK_IDX`; the Bank is **not** the fee payer (`feePayer !== bank`, and `null` refuses — same rule round 16 flipped for redemptions); a program allowlist (MINT, Core, System, ComputeBudget); `owner` on-curve; `max_price_lamports` within a configured ceiling; **no open proposal** (read `gov.proposal_count`/the live proposal window); and for a price-0 round, a declared burned PoB.
* Route it through `cosign.mjs` with a `--kind mint|redemption` and a `scripts/bank-sign.sh … --mint` mode, so the one-reader / one-`partialSign` / one-invoker gates keep covering it.
* Add **two rows to SPEC's control table** — the mint's on-chain Bank pin, and the mint's pre-signature policy — and note that `rows.length >= 5` now makes that free.

## R7-2 · MEDIUM · Transfer failures are classified by regex on `e.message`, and the ambiguous bucket has no automatic exit

```js
const rejected = /custom program error|Error Code:|Transaction simulation failed|insufficient funds/
  .test(String(e.message))
```

Anything not matching becomes `sig: null, rejected: false` → `paymentState` = `'ambiguous'` → **never re-sent, never skipped, requires a human per vault**, and known limit 2 says there is no override flag.

That bucket catches every *local* failure: a DNS blip, an RPC 429, a socket reset, a `TypeError` from a malformed account map. None of those submitted a transaction, so all of them are retryable — and all of them get parked. On a 2,100-vault run against a flaky endpoint, this produces a manual queue of hundreds of rows, each a `distribution_unresolved` CRITICAL, each needing an on-chain investigation.

**The fix is available and it collapses the whole class.** `sendAndConfirmTransaction`'s timeout errors are typed (`TransactionExpiredBlockheightExceededError` / `TransactionExpiredTimeoutError`) and carry the **signature**. Better still: build and sign the transaction, take `bs58(tx.signature)` **before** sending, and write it into the intent row. Then:

```js
done[v] = { amount, sig: null, intendedSig: SIG, sentAt }
```

and no row is ever truly ambiguous — the next run resolves it with one `getSignatureStatus(intendedSig)`, automatically, with no human. That converts your worst-documented operational limit (known limit 2 plus "an ambiguous row needs a human") into a lookup, and it removes the incentive to hand-edit the money ledger, which R2-1 shows is where the real damage lives.

Secondary: classify by exception *type*, not by message text — `instanceof SendTransactionError` ⇒ rejected/retryable; the two expiry types ⇒ ambiguous-with-signature; everything else (client-side) ⇒ rejected/retryable.

## R7-3 · LOW · Exit code 3 is documented as "could not start" and is also every mid-run fatal

The new EXIT CODES block says `3 the run could not start (lock held, or a fatal read failure)`. But `withLock(LOCK, main, …).catch(…)` exits 3 for **anything** `main()` throws — including a DAS failure, a `requireTokenAmount` refusal, or a `holdDays` date abort, *after* transfers have begun. A wrapper triaging "3 = harmless, 1 = act" mis-handles a run that died mid-payout — which is exactly the state `distribution_unfinished` exists to catch.

**Fix.** 3 for `ELOCKED` only; a distinct code (4) for a fatal after `startedAt` was written. And document it in the same block.

## R7-4 · LOW · Assorted, each a one-liner

* **`import fs from 'fs'` and `import fsx2 from 'fs'`** in the same file, six lines apart, because the selftest block wanted a second name. Two readers of one module in the file whose header is about not having two readers of one fact.
* **`realDay('0000-01-01')` returns true** — it round-trips through `toISOString().slice(0,10)`. A hand-edited or corrupted ledger key of `0000-01-01` with no paid rows becomes the anchor, `holdDays` ≈ 740,000, and the next run with ≥ 3,203 sats is **force-paid**. The validation checks well-formedness, not plausibility. Add `Math.abs(dayDiff(d, today())) <= 3650`.
* **Resume path loses `total`/`dust`.** The final log prints `String(plan.total ?? '')` → empty, and `dust 0`, on every resumed day. The two numbers a holder checks their share against are reported as blank on precisely the days something went wrong.
* **`const done = st.days[day].paid`** throws `TypeError` on a hand-edited day record lacking `paid` (the `||=` only fires when the key is absent). Use `st.days[day].paid ||= {}`.

---

# WHERE THE SYSTEM IS SAFER THAN ITS OWN DOCUMENTATION SAYS

The owner's finding was an under-claim. Four more of exactly that shape:

## U-1 · MEDIUM · `scripts/bank-sign.sh` says it "is not a control" and "contains no judgement". It contains the strongest deterministic control in the signing path.

**Construct.** The header:

> *"⚠️ **READ THIS BEFORE ASSUMING IT IS A CONTROL. It is not one** … This file holds no key, reads no key, and **contains no judgement**."*

Then, forty lines down, the same file refuses:
* any argument it does not recognise (so `--force` cannot be smuggled through);
* an empty transaction;
* a non-base64 byte;
* `=` padding before the end;
* a length that is not a multiple of 4;
* **and, new this round, any input whose canonical re-encoding differs from what was pasted.**

That last one is a *proof*, not a mitigation: within the sanctioned path, it makes it **impossible** for the Bank to judge a different transaction than the operator pasted. It is not skippable, needs no human discipline, and it closes the failure the file's own comment calls "the worst failure this file can have". It also reads the transaction **before** the `cd`, which closes a measured fail-open that no gate could see.

Read as a description of the *policy*, "not a control, no judgement" is true — a key holder can sign elsewhere. Read as a description of *the file*, which is how an operator and a buyer will read it, it says the wrapper does nothing. It does four things, one of them non-bypassable, and **SPEC's control table has no row for any of them.**

**Fix.** Split the sentence the way the co-signer's row was split: *"Nothing forces a signature through this wrapper — that is policy. But every signature that does go through it is provably of the bytes the operator pasted: the wrapper decodes and re-encodes and demands equality before Node sees a byte."* And add a control-table row — `**PROCEDURE.** …` for the choice to use the wrapper, with the canonical-base64 check named as the mechanical part.

## U-2 · MEDIUM · `distribute.mjs` runs at least four real, automatic, on-every-run controls that the control table — "the ONE place that says what actually runs" — does not mention

| control | what it guarantees | documented? |
|---|---|---|
| `if (!treasury.equals(distributor.publicKey)) throw` | The on-disk payer **must be** `config.treasury`, read from chain and discriminator/version-pinned. A treasury rotation cannot leave payouts flowing from a stale key, and a stolen distributor key cannot pay from an address the chain does not name. | Not in the table. SPEC lists the distributor *address* only. |
| unique `live + burnt` must **exactly equal** `minted_total` | A short or duplicating DAS page cannot cause an overpay, and 2,100 copies of one id cannot route the whole day's drop to one recipient. `>=` on raw counts would have permitted both. | SPEC says only "*refuses to guess (any failed read stops the run)*" — far weaker than the actual invariant. |
| **the plan is fixed once per day and reused on resume** | Two vaults at the same level receive the same amount even across a crash. Without it a resumed day pays its second half less than its first — a direct breach of "your level determines your share". | SPEC says "*a crash resumes instead of redoing*", which is about double-paying, not about fairness. Not stated. |
| **the mid-run liveness re-read** — `getAccountInfo(asset)` and `data[0] !== 1` before every transfer | A vault bare-burned between the plan and its turn does **not** receive cbBTC into a PDA nobody can ever sign for. This is the only place in the system that defends against the one attack SPEC calls unpreventable, and it defends the *money* rather than detecting the burn. | Not documented anywhere. |

Every one of these is `ON-CHAIN`-adjacent or `AUTOMATIC`, verifiable from source, and stronger than the corresponding sentence in SPEC. The `rows.length >= 5` change this round makes adding them free — and the new arm *"a TRUE extra ON-CHAIN row, correctly formatted, does NOT break the build"* was written for exactly this.

**Why an under-claim here is expensive.** The table is the document that answers "what is actually protecting my Bitcoin". Four real protections missing from it means a buyer under-values the system, an operator does not know they exist (and so may refactor one away — the mid-run liveness check in particular looks like a redundant RPC call to anyone optimising the loop), and the next auditor spends a round rediscovering them.

## U-3 · LOW · The signing-key permission check is a real control in three places and is credited in none

`cosign.mjs`, `distribute.mjs` and `revenue.mjs` each refuse to load a key file whose mode has any group/other bit (`mode & 0o077`). SPEC's SIGNER-SET bullet enumerates which file reads which key and says nothing about this. It is three-of-three (a rare complete fix in this repository — round 15 closed the one that was missing) and it is the only thing standing between a mis-`chmod` and a readable Bank key. Name it.

## U-4 · LOW · `judgeRedemptionTx` fails **closed** on two omissions, and the accepted-limits list reads as though it fails open

Known limit 1a: *"The PROGRAM ALLOWLIST and the FEE-PAYER check are off-chain… A redemption signed with a tool other than `scripts/bank-sign.sh` gets neither."* True. But within the tool, both are **stronger than that sentence suggests**: an *omitted* `allowedPrograms` permits the pair and nothing else (round 15), and a fee payer the caller could not determine is a **refusal**, not a shrug (round 16 deliberately flipped this). A second caller of `judgeRedemptionTx` cannot inherit a hole by forgetting to configure it. That is a durable property of the judge and it is worth one clause in 1a.

---

# CARRY-OVER LIST — where an accepted limit is worse than stated

* **#2 (a coverage refusal has no override) and the ambiguous-row queue are the same limit, and it is worse than "rhetorical".** R7-2 shows the ambiguous bucket also swallows every transient *local* failure, and R2-1 shows the documented escape (`resolvedBy`) has a second value that silently forfeits the payment. Combined: the only way to get a wrongly-parked vault paid is to hand-edit the money ledger — which R1-2 shows an automated job may then overwrite. Three accepted limits interacting into a money-loss path.
* **#12 (compute units unmeasured).** The prompt says this got worse; I can add that it is now worse in a *second* place. `mint_vault`'s confinement is `O(instructions × accounts)` with a `require!` per account **plus** a sysvar deserialisation per instruction, and a `mint_vault` also does a Core `CreateV2` CPI and a lamport transfer. Nothing bounds the number of top-level instructions an attacker may add to a transaction the Bank co-signs, so a mint can be pushed over budget — self-DoS only (they pay for it), but it means the honest-mint CU headroom is unknown *and* attacker-influenced. This is one measurement (`ComputeBudget` + `getSimulationUnits`) away from being a number.
* **#16 (level register off-chain, no commitment).** R6-4 shows the commitment is *cheaper than stated* if you deal a sealed deck, because then the published census figures become true rather than expectations and the hash-then-reveal has something to commit to. The limit is written as "a fix that is not built"; it is really "a fix that a different randomness choice makes almost free".
* **#17 (`EMISSION_MIN_PER_VAULT` provisional).** There is a **second** unratified constant hiding behind it: `MIN_PER_VAULT = 1n`, which is what the monthly ceiling actually forces out (R2-3). The provisional-constants list should name both.
* **#18 (randomness / ladder / FOMC deliberately absent).** The randomness source **has** been assumed, in the disclosure layer — see R6-4. That is the answer to the question the section asks.

# VERDICT CHALLENGES — the diff's own rejections, re-checked

Four claims in the diff are marked "rejected by measurement". I checked all four and **three hold**:

* **"the prompt ships a literal `${FLOORS.onchain}`" — correctly rejected.** Rendered: 286/434/93/19 all interpolate; the one escaped `${` is the R1 example. Confirmed.
* **"the settledAsPayout default is backwards" — correctly rejected.** Traced independently; larger `holdDays` fires the ceiling sooner. Confirmed (R2-2).
* **"the MintVault struct regex can permit a stale positional constant" — correctly rejected on consequence.** Truncation before `bank` fails closed; truncation after cannot move the index; and even a *successful* index shift refuses every honest mint rather than exempting the wrong slot (R5-2). Confirmed, and stronger than the diff claims.
* **"superseding could strip `finishedAt` off a completed paying day" — rejected on the production claim, and the rejection is right for `finishedAt`.** But the guard added in response reaches only `finishedAt`. The same function still unconditionally deletes `resolvedBy` on a day carrying a resolved day-level finding, which *is* reachable from `main()` — R1-2. The finding was closed one field short.

One claim I want to push back on: `bank/distribute.mjs`'s dust comment says *"Measured across the 2,100-vault census: worst observed 2,099, never near 6,404."* The suite tests **seven** hand-picked `available` values. "Worst observed" over seven samples is not a measurement of a bound; the *proof* (`Σ frac_v < n`) is, and it is in neither comment. State the proof — it is one line and it holds for every census, not just this one.

---

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Sixteen-plus rounds of AI review have converged on a repeatable pattern: models find *text-vs-text* and *code-vs-comment* defects extremely well, and find *nothing at all* that only appears when the system runs against reality. Every one of the worst defects in this project's history — the wrapper resolving a relative path against the repo, the `subarray(45)` non-issue, the `2026-02-30` rollover, the `nothingToDo` suppressor, this round's `resolvedAs: 'unpaid'` — is a *behavioural* fact, and each was found either by running something or by a human reading. Do the things that reading cannot do:

1. **Run one full distribution end to end on devnet, with 200 real vaults, and break it on purpose.** Not `--selftest`; the real `main()`. Kill it with `SIGKILL` at three points (after the plan save, mid-loop, between a `sendAndConfirm` landing and its `save`), freeze one destination ATA, point the RPC at a proxy that 429s 10% of sends, poison one ATA with a 1-lamport account, and burn one vault after the plan is fixed. Then reconcile the ledger against `getSignaturesForAddress` on the distributor. **This one exercise would have caught R1-3, R7-2 and R2-1**, none of which any amount of reading has produced in three rounds of looking straight at them. Write down the resulting ledger states as golden fixtures.

2. **Adopt one adversarial invariant per money file and check it against the chain, not against the ledger.** For distribution: `Σ(on-chain cbBTC transfers out of the distributor on day D) == Σ(amounts in days[D].paid with a sig)`, computed from `getSignaturesForAddress`, run by `alarm.mjs --reconcile`. Accepted limit #11 ("distribution reconciles against a ledger the payer wrote") is the single largest structural weakness left and it is closable with one RPC walk. You did this for sweeps in round 7 and stopped there — one of two sites, again, and this time the site you skipped is the one that touches customers.

3. **Do a two-hour destructive-refactor drill instead of another read.** Pick four "safe" edits a competent maintainer would make and see what stays green: (a) `{...rec}` → `structuredClone(rec)` in `supersede`; (b) delete the mid-run liveness re-read as a "redundant RPC call"; (c) hoist `cosign.mjs`'s `partialSign` above the refusal; (d) reorder `MintVault`'s accounts. (c) and (d) are gated. (a) and (b) are not, and (a) double-pays every holder. **A gate is only proven by an edit that should break it**, and your suite proves that for negatives it invented, not for edits a maintainer would actually make. Make this drill a release step and record which edits were caught.

4. **Give one human ninety minutes to read only the customer-facing surface** — the card, SPEC's Distribution and Cadence sections, the control table — with the source closed, and write down every number and promise. Then check each against the code. That exercise, exactly, is what produced the owner's under-claim finding and would have produced R2-4 (6,405 vs 3,203) and R6-2 (69/63/270) in the first twenty minutes. No AI round finds these reliably, because a model reading source and prose together resolves the contradiction in favour of whichever it read second.

5. **Stop letting the certification instrument certify itself.** `scripts/audit19.ts` computes the prompt, decides who counts as an auditor, and writes the manifest that records the answer; `bank/selftest.mjs` — a file the round audits — contains the arms that adjudicate findings *against that round*. Round 19 already caught this class twice (the quorum env override, the runner that could not fail). Move the manifest verification into a separate script that reads only the artifacts, and require the round's own `head` and `dirty` fields to be checkable by a third party with `git` and `jq` and nothing else.

6. **Freeze, and mean it.** The gate needs two clean rounds against an unchanged tree, and it has been met zero times in nineteen rounds because every round's repairs reset it — and eight rounds running have found their worst defect in those repairs. Nothing in this report requires a design change. Land these fixes, then **stop editing for two full rounds**, and accept that a round which finds only what it found last time is the signal you have been waiting for rather than a wasted round.

**One thing I would not ship without, above all the rest:** R7-1. Either the Bank cannot sign a mint and the product cannot onboard anyone, or the Bank key is about to be used by hand on the busiest money path in the system, with no allowlist, no fee-payer check, and none of the four controls SPEC's SIGNING section promises. Resolve that before anything else in this report.