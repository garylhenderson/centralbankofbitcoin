## R1 — self-audit repairs

### HIGH — `supersede()` leaves `resolvedBy`, which still suppresses an unfinished distribution

**Exact construct**

```js
export function supersede(rec, nowIso) {
  const was = [rec?.refused, rec?.nothingToDo].filter(Boolean)
  ...
  delete out.refused
  delete out.nothingToDo
  delete out.finishedAt
  return { rec: out, ... }
}
```

while the detector suppresses unfinished-run reporting on `resolvedBy` too:

```js
if (rec.startedAt && !rec.finishedAt && !rec.nothingToDo &&
    !rec.resolvedBy && day !== opts.today) {
  ...
}
```

**Impact**

The repair clears two prior no-pay verdict fields and `finishedAt`, but it does not clear a prior day-level `resolvedBy`.

Reachable ordering:

1. A distribution is refused because an activated vault lacks a level. The ledger records `refused`, `nothingToDo`, and `finishedAt`.
2. A human marks that refusal resolved with `resolvedBy`—which the detector explicitly supports.
3. The missing level is added and a same-day run proceeds.
4. `supersede()` removes `refused`, `nothingToDo`, and `finishedAt`, writes a plan, and starts transfers.
5. The process dies after a partial payout.
6. On the next alarm pass, `resolvedBy` remains. `distribution_unfinished` is suppressed even though the current payout attempt is unfinished.

That recreates the fail-open condition the repair is meant to eliminate: some holders can remain unpaid or ambiguous with no `distribution_unfinished` alarm.

**Evidence if correct**

A pure regression test should currently demonstrate this:

```js
const prior = {
  startedAt: '2026-08-22T09:07:00Z',
  refused: 'missing level',
  nothingToDo: 'missing level',
  finishedAt: '2026-08-22T09:07:05Z',
  resolvedBy: 'operator: level assigned',
}
const rec = supersede(prior, '2026-08-22T14:00:00Z').rec

detectDistribution({
  days: {
    '2026-08-22': {
      ...rec,
      plan: { activated: ['v1'], per: { v1: '100' } },
      paid: { v1: { sig: null, sentAt: '...' } },
    },
  },
}, { today: '2026-08-23' })
```

It should contain `distribution_unfinished`; under the current construct it will not.

**Fix**

When a no-pay verdict is superseded by a live payment plan, move any prior resolution metadata into immutable audit-history fields and remove it from the active day state:

```js
if (out.resolvedBy) {
  out.supersededResolvedBy = out.resolvedBy
  delete out.resolvedBy
}
```

Do not simply discard audit evidence. Preserve it as prior-verdict history, but ensure active detector semantics cannot treat a resolution of the old refusal as resolution of a later payout attempt. Add the exact regression case above.

---

### HIGH — `audit19.ts` can certify a commit that auditors did not receive

**Exact construct**

`DIFF` and `BUNDLE` are built at module initialization:

```ts
const DIFF = execSync(`cd ${R} && git diff ec7d17e..HEAD ...`).toString()
const BUNDLE = TARGETS.map(... f(path) ...).join('\n')
const PROMPT = `... ${DIFF} ... ${BUNDLE}`
```

but the alleged audited commit is captured later, after an awaited network operation:

```ts
async function main(){
  fs.mkdirSync(OUT,{recursive:true})
  await verifyRoster()
  ...
  const head=execSync('cd '+R+' && git rev-parse HEAD').toString().trim()
  ...
  await Promise.all(MODELS.map(m=>ask(m).then(land)))
  ...
  const headAfter=execSync('cd '+R+' && git rev-parse HEAD').toString().trim()
  if(headAfter!==head) ...
}
```

**Impact**

There is an unprotected interval between reading the source/diff for `PROMPT` and recording `head`.

A commit can land after `PROMPT` has been assembled but before `head` is read. The manifest then records the new commit as `head`; `headAfter === head`; the tree can be clean; and the script exits successfully. The auditors actually saw the prior tree.

This defeats the stated fixed-tree property and makes the manifest materially false. It is particularly dangerous because the process treats the manifest as certification evidence.

**Evidence if correct**

Instrument the runner with a temporary pause immediately before `await verifyRoster()` or immediately before the `head` capture:

1. Start `audit19.ts`.
2. Let module initialization construct `PROMPT`.
3. Commit a source change in a target file.
4. Allow the script to continue.
5. Observe that:
   - `MANIFEST-*.json.head` names the newer commit;
   - `headAfter` matches it;
   - the prompt artifact/diff contains the prior content;
   - no dirty-tree or moved-HEAD failure occurs.

**Fix**

Capture and pin the commit before reading any audited content. Build all inputs from that immutable commit, not from the working tree:

```ts
const AUDIT_HEAD = execSync(`cd ${R} && git rev-parse HEAD`).toString().trim()
const gitShow = (path: string) =>
  execSync(`cd ${R} && git show ${AUDIT_HEAD}:${path}`).toString()

const DIFF = execSync(
  `cd ${R} && git diff ec7d17e..${AUDIT_HEAD} -- programs bank scripts tests`
).toString()
```

Then:

- require a clean watched tree before prompt construction;
- record `AUDIT_HEAD` in the manifest;
- compare `HEAD` both immediately before model dispatch and after completion;
- preferably write the exact prompt bytes and `sha256(prompt)` into the manifest.

---

## R2 — round-18 `bank/distribute.mjs` repairs

### MEDIUM — refusal notification creates a durable customer-triggerable paging channel

**Exact construct**

```js
if (plan.refusal) {
  const msg = `CBOB DISTRIBUTION REFUSED and paid nobody: ${plan.skip}`
  console.error(msg)
  if (!DRY) { try { execFileSync(NOTIFY, [msg, 'cbob-distribute']) } catch {} }
  process.exitCode = 1
}
```

An activated vault with no level causes:

```js
return { ...empty, refusal: true,
  skip: `${unlevelled.length} activated vault(s) carry no level: ...` }
```

**Impact**

An unlevelled vault can halt the whole payout job and cause an SMS/page on every daily execution until the operator repairs the level register. The attacker need not control the distributor or the Bank key once there is a mintable vault whose PDA can be funded to the activation threshold.

This is not merely an alert about a one-time operational defect. It is a repeatable external paging primitive coupled to a global payout halt. The new behavior converts an already-known distribution-griefing surface into a persistent human-interruption surface.

The current code also has no “already notified for this refusal generation” state, no notification backoff, and no resolution-aware suppression in the direct notifier. `resolvedBy` suppresses detector output but does not suppress the daily direct notification if the underlying condition remains.

**Evidence if correct**

On a test deployment:

1. Identify an existing minted vault absent from `levels.json`.
2. Fund its cbBTC ATA to `21_000` sats.
3. Run distribution on consecutive days.
4. Each run should:
   - refuse all payments;
   - invoke `notify-gary-sms.sh`;
   - exit nonzero.

This should occur without any privileged action by the party funding the vault.

**Fix**

Keep the refusal loud, but make paging stateful and rate-limited:

- record a stable refusal fingerprint, e.g. sorted missing vault IDs plus levels-register version/hash;
- notify once when that fingerprint first appears;
- escalate only after a bounded interval or state change;
- retain nonzero exit and detector finding on every run;
- add an explicit operator acknowledgment/expiry mechanism that affects paging only, not detection or payout refusal.

Do not suppress the refusal itself merely to stop pages.

---

### LOW — the corrected dust claim is still over-generalized for skipped allocations

**Exact construct**

The comment claims:

> “the true bound is `dust < activated count`”

and the test checks:

```js
if (r.dust >= BigInt(r.activated.length)) return 'BOUND BROKEN'
```

only over fixtures whose `activated.length` is nonzero.

**Impact**

For a no-activated-vault allocation, `allocateWeighted()` returns:

```js
{ activated: [], dust: 0n, ... }
```

and `0n < BigInt(0)` is false.

This does not create a payout error because there are no paid vaults. But the stated universal inequality is false if read as applying to all allocator return values, including skips. The correct claim is conditional: for a successful allocation to `n > 0` paid vaults, `0 <= dust < n`.

**Evidence if correct**

```js
const r = allocateWeighted({ a: '0' }, { a: 'I' }, 1n)
r.dust === 0n
r.activated.length === 0
r.dust < BigInt(r.activated.length) // false
```

**Fix**

State and test the actual invariant:

```js
if (r.skip === null) {
  assert(r.activated.length > 0)
  assert(r.dust >= 0n && r.dust < BigInt(r.activated.length))
}
```

The substantive arithmetic for successful allocations is correct: each paid vault contributes a fractional remainder in `[0,1)`, so the sum is strictly less than the number of paid vaults. At 2,100 paid vaults, `2,099` is attainable at `available = 6,404`.

---

### R2 verification notes

- The `settledAsPayout()` direction is correct. A bare `resolvedBy` does **not** reset the clock, so `holdDays` is larger; a larger `holdDays` reaches the 31-day forced-payment branch sooner, not later. This favors earlier forced payout when `smallestPer >= 1`.
- `paymentState()` remains correct for resend prevention: rows with `resolvedBy` remain `resolved` and the transfer loop skips them. The new cadence predicate answers a separate question.
- `census()` returns a normal object via `{ ...c }`; it serializes normally into JSON and does not expose its temporary null prototype to ledger consumers.

---

## R3 — `scripts/bank-sign.sh`

No accepted base64 bypass was identified from the supplied code.

The decode/re-encode comparison rejects the previously accepted noncanonical forms (`====`, `AB==`, `AAB=`, excess padding, nonzero trailing bits). Whitespace is deliberately normalized before canonical comparison; that means the accepted semantic input is the whitespace-stripped base64 payload, which matches the documented wrapped-paste behavior.

`set -o pipefail` plus:

```bash
CANON=$( ... ) || true
```

does not create an acceptance bypass: a decoder or encoder failure produces an empty or incomplete `CANON`, which cannot equal nonempty `TX`.

The remaining operational constraint is platform dependency: `base64 -w0` is GNU coreutils syntax. It will reject every otherwise-valid transaction on systems with BSD/macOS `base64`, which lacks `-w`. The installed environment appears Ubuntu-oriented, but this should be made explicit and preflighted rather than discovered during a live signing event.

**Fix**

At startup, require GNU-compatible base64 behavior:

```bash
base64 --help 2>&1 | grep -q -- '-w' ||
  { echo "GNU coreutils base64 with -w is required" >&2; exit 2; }
```

The corrected `ps` comment is materially accurate: the payload is absent from this wrapper’s argv but present in the `cosign.mjs --tx "$TX"` process argv after `exec`.

---

## R4 — cron installer money claim

The fresh-install header is materially accurate for the five installed cron jobs:

| Installed job | Schedule | Can move customer money as installed? |
|---|---:|---|
| `bank/alarm.mjs` | `23,53 * * * *` | No. Monitoring only. |
| `bank/distribute.mjs$DIST_DRY` | `7 9 * * *` | **Yes on a fresh install.** `DIST_DRY=''`, so it runs live and can transfer cbBTC. |
| `bank/revenue.mjs$REV_LIVE` | `41 */6 * * *` | No on a fresh install. `REV_LIVE=''`; revenue is opt-in on `--live`. |
| `bank/alarm.mjs --reconcile` | `19 4 * * *` | No direct transfer path shown; reconciliation reads state. |
| deadman `notify-gary-sms.sh` | `9 */2 * * *` | No customer-asset movement, though it sends an operational SMS. |

On rerun, the posture varies correctly according to preserved tagged uncommented lines: `--dry-run` can leave distribution dormant, and `--live` can arm revenue.

---

## R5 — changed gates

No accepted security finding from the `MintVault` positional parser.

The non-greedy struct-body regex can indeed terminate at an injected line-level `}`. But for the asserted property its direction is fail-closed:

- truncation before `bank` yields `indexOf('bank') === -1`, failing the equality test;
- truncation after `bank` cannot alter the index of an already parsed `bank` field.

The parser is brittle as a source parser, but the identified early-close mechanism does not permit a stale bank index to pass.

`isTableRow` is deliberately strict. A control-table row with formatting such as `|**CONTROL**...` rather than `| **CONTROL**...` does not match it, but the added table-block assertion catches it as an unclassified row. This is fail-closed, not an invisible control row.

The two stale-`nothingToDo` tests demonstrate detector suppression. They did not demonstrate the writer behavior until the later `supersede()` tests. Those later tests still miss the retained-`resolvedBy` path described in the R1 finding.

---

## R6 — counts and arithmetic

### MEDIUM — SPEC still publishes the false 6,404-satoshi dust maximum

**Exact construct**

`bank/distribute.mjs` was corrected, but `SPEC.md` still states:

> “at 2,100 vaults the remainder can be up to 6,404 sats a settlement.”

**Impact**

This is a customer-facing disclosure error. `6,404` is a loose upper bound based on the denominator, but the wording “can be up to” asserts it as an attainable maximum. It is not.

The true maximum for the published 2,100-vault population is `2,099` sats.

**Evidence if correct**

For counts `[945, 525, 315, 210, 105]`, weights `[2,3,4,5,6]`, and denominator `6,405`, at `available = 6,404`:

- level-I per-vault payment: `floor(6404*2/6405) = 1`;
- level-II: `2`;
- level-III: `3`;
- level-IV: `4`;
- level-V: `5`.

Total paid:

```text
945*1 + 525*2 + 315*3 + 210*4 + 105*5
= 4,305
```

Dust:

```text
6,404 - 4,305 = 2,099
```

That equals `activated - 1`; it does not approach `6,404`.

**Fix**

Replace the SPEC claim with the same conditional accurate claim used in the allocator documentation:

> For a successful payout to `n` activated vaults, dust is under `n` satoshis. At the published 2,100-vault census, the maximum is 2,099 sats.

Add a selftest assertion that scans or pins this published disclosure too. The current arithmetic test only validates code-side comments and figures, not this still-live customer document.

---

### LOW — several documentation assertion counts remain stale and understate the test suite

**Exact constructs**

`SPEC.md` still says:

```text
bank/distribute.mjs --selftest   # 63 allocation assertions
```

while the enforced allocation floor is `79`.

It also says:

```text
bank/selftest.mjs ... (69 assertions)
```

while its floor is `427`.

**Impact**

These are under-claims, not safety bypasses, but they directly contradict the project’s stated requirement that a test-count claim be mechanically true. They also demonstrate that the count gate checks only selected count locations, not all live claims.

**Evidence if correct**

- `scripts/run-tests.sh`: `ALLOC_FLOOR=79`
- `bank/distribute.mjs`: `const FLOOR = 79`
- `bank/selftest.mjs`: `const FLOOR = 427`
- `SPEC.md`: still contains `63 allocation assertions` and `69 assertions`.

**Fix**

Update both locations and expand the count gate to reject stale count claims anywhere in SPEC, or eliminate scattered numeric claims in favor of a single generated test-status block.

---

### R6 arithmetic verification

The supplied schedule figures are otherwise correct:

- `108/60/36/24/12` with weights `2/3/4/5/6`:

```text
108*2 + 60*3 + 36*4 + 24*5 + 12*6 = 732
```

- `945/525/315/210/105`:

```text
945*2 + 525*3 + 315*4 + 210*5 + 105*6 = 6,405
```

- Per `$1,000` figures:

```text
240-vault census:  2.73, 4.10, 5.46, 6.83, 8.20
2,100-vault census: 0.31, 0.47, 0.62, 0.78, 0.94
```

- Level shares at 2,100 vaults:

```text
29.5%, 24.6%, 19.7%, 16.4%, 9.8% = 100.0% after rounding
```

---

## Carry-over limits: worse than stated

### HIGH — unmeasured compute consumption is now directly on a Bank-signed mint path

The accepted limit says compute units are unmeasured and “got worse this round.” That is accurate but understated operationally.

The new MINT confinement scans every top-level instruction and every account meta:

```rust
for (i, ix) in load_instruction_at_checked(...) {
    ...
    for (n, a) in ix.accounts.iter().enumerate() {
        require!(...)
    }
}
```

This executes in `mint_vault`, which requires the Bank’s top-level signature. An attacker can construct a transaction with many validly encoded instructions/accounts within packet limits and drive up the cost of the introspection loop. The packet bound prevents unbounded work, but does not establish that valid ordinary mint transactions remain comfortably below the transaction CU limit under mainnet feature settings.

This is not presently a theft primitive. It is a mint availability and Bank-operations risk. The accepted-limit wording should explicitly say that the new confinement’s worst-case CU cost has not been measured.

**Evidence:** run a validator CU measurement suite over maximum-size valid transactions containing the mint instruction plus maximal permitted top-level instruction/account-meta padding, and establish the margin against the configured compute budget and mainnet limit.

**Fix:** measure it before deployment; set and enforce an explicit transaction-shape budget where feasible; add an integration assertion that the worst permitted shape completes below an agreed CU ceiling.

---

## Verdict challenges

1. **The “bare `resolvedBy` pays sooner” conclusion is correct.** It should not be reversed.
2. **The `MintVault` regex early-brace concern does not establish a stale-index bypass.** The demonstrated truncation is fail-closed for the asserted index.
3. **The base64 round-trip is not shown bypassable by the listed malformed canonical forms.**
4. **The claim that the manifest’s porcelain record is malformed is not established.** `dirty.split('\n').filter(Boolean)` preserves the leading two-character porcelain status fields; JSON serializes the resulting lines correctly. The more serious manifest issue is the wrong-tree race described above.

---

## Anything else — documentation under-claims

The repository has corrected the core Bank-signature under-claim in the control table, but count under-claims remain in SPEC. This is the same directional failure: the system is stronger/more tested than documentation says, yet the documentation is still mechanically false. The count checker should treat both exaggeration and understatement as drift.

---

## Given that no human firm will ever see this, what should this project do that sixteen rounds of AI audit structurally cannot?

1. **Run a funded adversarial staging program with real operational humans.**  
   Put nontrivial but bounded real value in a staging environment; require independent operators to execute mint, distribution, refusal recovery, ledger corruption recovery, bank signing, and redemption under incident conditions. AI can inspect source and synthetic tests; it cannot establish whether the actual people, credentials, notifications, backup procedures, and cron environment behave safely under pressure.

2. **Obtain independent key-custody and host-hardening verification.**  
   The decisive policy controls are outside the programs: Bank-key custody, distributor-key custody, swap-operator isolation, file permissions, cron ownership, RPC credentials, and notification credentials. Have a separate operator perform a machine-level review from the running host: process list, systemd/cron state, filesystem ACLs, backups, shell histories, environment exposure, SSH access, sudoers, and incident access paths. This must produce signed evidence, not another source review.

3. **Produce reproducible deployment and binary-attestation artifacts.**  
   Build from a clean, independently cloned source checkout in a separate environment. Publish hashes for source commit, all program binaries, Core dump, lockfiles, and deployed ProgramData ELF hashes. Verify on-chain program bytes against those artifacts. AI review of a repository cannot prove the deployed executable came from that repository.

4. **Commission economic and operational game-day testing.**  
   Exercise the actual bad-ordering cases: quiet-then-pay, refusal-then-repair, partial payout then crash, notification outage, RPC outage, poisoned ATA, stale lock, reboot during cron, operator key rotation, and a customer-triggered missing-level refusal. Require written recovery time objectives and a record of who had authority to act.

5. **Adopt a release authority independent of code authors.**  
   A person or multisig group that did not write the patch should control production deployment approval. Their job is not to re-audit Rust line by line; it is to reject changes without reproducible artifacts, measured execution evidence, tested rollback, and an operational owner for every alert. AI cannot create organizational separation from the author whose code it is evaluating.