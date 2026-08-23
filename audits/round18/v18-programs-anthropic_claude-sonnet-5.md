# Audit Report — Round 18, against 2c8cd9b..HEAD

Findings ordered per instructions: R1–R6, carry-over re-checks, verdict-challenge (under-claims), then extras. Severities are my own; each finding states what would exist on-chain/in a run if I'm right, and what would falsify it.

---

## R1 — `mint_vault`'s bank-key confinement

### R1.1 — MEDIUM: no aggregate bound on Bank-as-payer across stacked `mint_vault`s in one transaction
The confinement's exemption is "program_id + first-8-bytes." I tried to construct a forged instruction that wears this shape but does something else with the Bank's key, and could not: Solana transaction execution is atomic, and every account slot in `MintVault` other than `owner`/`bank`/`payer`/`asset` is pinned by `address=`/`seeds=`/in-handler `require_keys_eq!`. Any instruction that dispatches to the real `mint_vault` handler and *passes* is, by construction, a genuine mint. So the exemption itself looks sound — **but I could not verify this on a validator, and every prior six rounds' "this reasoning holds" claim about this exact code shape has had a counter-example found by the next round.** I recommend an actual localnet transaction with a mismatched account list wearing the mint_vault discriminator before trusting this conclusion.

What *is* real: the test fixture (`3prog.test.ts`) uses `payer == bank` in every mint call. Nothing on-chain bounds *how many* legitimate `mint_vault` instructions with `payer = bank` can share one Bank-signed transaction — each is individually valid (cap/`minted_total` checks read fresh state per-instruction so no cap bypass), but the aggregate SOL cost the Bank is agreeing to by signing is unbounded by anything on-chain, and — per the round's own preamble — **there is no off-chain judge for mint transactions at all** (`judgeRedemptionTx` only knows the open/burn pair). If the Bank's mint-signing process is "sign whatever `mint_vault` shape is put in front of it" without independently counting instructions, N stacked mints in one tx drain N× the price from the Bank in one signature, with no on-chain or off-chain control noticing.
**Evidence that would confirm this:** grep the Bank's actual mint-signing tool (not in this bundle) for whether it counts `mint_vault` instructions per transaction or just checks program_id/discriminator once.
**Fix:** either forbid `payer == bank` on-chain, or give `mint_vault` (like redemptions) an off-chain judge that bounds per-transaction instruction count and aggregate price.

### R1.2 — LOW: `seen_self` is currently unfalsifiable, not currently protective
Neither SEAL's nor MINT's confinement loop contains a `break`. Given that, the loop can only terminate via `Err` at `i == N` (the first out-of-range index), which is strictly after `i == current` (current is always a valid in-range index of the executing instruction). So for *any* syntactically valid transaction, `seen_self` **cannot** currently be false — the guard defends against a hypothetical future refactor that adds an early exit, not against anything reachable today. The comment ("proves the walk got at least this far") is accurate as a statement about robustness-to-future-edits, but slightly overclaims present-day necessity. Not a vulnerability; flagging so the next round doesn't mistake "the guard exists" for "the guard is exercised by any test that actually breaks early" — no such test appears to exist in the diff (3.1b3 etc. don't construct a scenario where the loop would stop before `current`).

### R1.3 — Confirmed, not exploitable: fee payer reasoning is right
`ix.accounts` never contains the fee payer unless it's also named as an account in some instruction; the confinement literally cannot see it. This matches limit 1a and is correctly stated in both new comments. No new finding here — restating only because R1 asked directly.

### R1.4 — Confirmed: `IX_MINT_VAULT_DISC` is now correctly pinned, other constants unaffected
I checked every other discriminator/offset constant touched by this diff (`IX_OPEN_FOR_REDEMPTION_DISC`, `IX_BURN_VAULT_DISC`, `SEAL_CONFIG_DISC`, `OFF_VERSION/COLLECTION/BANK`) — none were changed by round 17; only `IX_MINT_VAULT_DISC` is new, and suite 3.1b3 computes it from `sha256("global:mint_vault")` rather than asserting a hand-copied literal. This is the correct pattern. No finding.

---

## R2 — Cadence and weight repairs (`bank/distribute.mjs`)

### R2.1 — HIGH: the Feb-30 rollover fix does not fix the case it claims to fix, and its own self-test locks in the broken value
The new guards are: (a) `ISO_DAY = /^\d{4}-\d{2}-\d{2}$/` — a **shape** check only, and (b) `Number.isFinite(dayDiff(...))` — a **finiteness** check only. Neither validates calendar range. `'2026-02-30'` matches the shape regex (all digit groups are the right width), so it is never added to `bad` and is not thrown on. If the underlying date parser rolls Feb-30 into March-2 (which the diff's own comment states was *measured*: "`2026-02-30` PARSES, rolling into March, and returned a confidently wrong 173"), the result is finite, so the finiteness guard doesn't fire either. Walking the arithmetic: March 2 → Aug 22, 2026 is 29(Mar)+30(Apr)+31(May)+30(Jun)+31(Jul)+22(Aug) = **173** — exactly the value the comment says was the old bug.

The self-test added this round is:
```js
t('...and a shaped-but-impossible date does not produce a confident wrong answer',
  (() => { try { return holdDays(...) } catch { return 'REFUSED' } })(), 173)
```
The third argument to `t()` is the *expected* value everywhere else in this file (every other assertion in the same block uses this pattern with a genuinely correct expected result). Here it is `173` — the exact value the surrounding comment says must not occur. Either:
- the code still returns 173 (the bug is *not* fixed, and the test enshrines the bug as "expected", passing green while contradicting its own comment), or
- the code throws `'REFUSED'` (a string), which can never `===` the number `173`, meaning this specific assertion would **fail** every run — which would mean the "395 assertions, all passing" claim is false for this file.

I could not execute this to determine which branch is real, but neither branch is consistent with the claim "does not produce a confident wrong answer."
**Falsifying evidence:** run `node -e "const {holdDays}=await import('./bank/distribute.mjs'); console.log(holdDays({days:{'2026-02-30':{paid:{a:{sig:'x'}}}}},'2026-08-22'))"` on the actual Node version deployed. If it throws, this test assertion is failing today and the floor-count claim is wrong. If it returns 173, the fix does not cover this case and the header comment is false.
**Fix:** validate calendar range explicitly (e.g. `new Date(y,m-1,d).getMonth() === m-1` round-trip check, which catches rollover), not just shape.

### R2.2 — HIGH: unlevelled-vault halt is a routine operational failure mode, not a rare griefing edge case
The "overpay" argument for halting (rather than excluding the unlevelled vault from just that day's denominator) is internally consistent — excluding a vault from a day's split permanently forfeits its share of that day's specific revenue, which can't be un-distributed later. But the trigger condition — *any single activated vault lacking an entry in `levels.json`* — is not adversary-only. Per limit #16, the level register is off-chain, manually maintained, with no commitment scheme and (per this diff) no described synchronization with on-chain activation. Given mints happen continuously ("240 at launch, 2,100 at full scale," per R1's own text) and a vault becomes "activated" the instant its balance crosses 21,000 sats — an on-chain event with zero coupling to when a human updates `levels.json` — there is likely **always** a window where a just-activated vault has no level yet. During that window, *every holder of every previously-levelled vault also gets paid nothing*, every single day, until an operator notices and edits the file. This is not "anyone can mint one vault and grief" — it's "ordinary operational lag between two decoupled processes (on-chain activation, off-chain level assignment) will routinely zero out payouts for the entire holder base."
**Evidence that would confirm this:** check whether `levels.json` is updated synchronously (same transaction/same script invocation) as activation, or asynchronously on some cadence; if asynchronous, the halt window exists on every activation by design.
**Fix:** exclude only the unlevelled vault(s) from the current day's payout (their day's dust genuinely is lost, as the author argues), while paying everyone with a real level; alarm on the excluded vault separately. This gives up the "no partial-day loss ever" property but restores availability for everyone else, which given the described cadence is the more realistic trade.

### R2.3 — Unresolved: does `distribution_refused` actually reach a human?
`detectDistribution` raises the finding; `bank/alarm.mjs`'s actual notification path (paging/Slack/email vs. log-file-only) is not in this bundle, so I cannot confirm escalation. Given the prompt's explicit instruction to trace this rather than assume it, I flag it as **unverified** rather than pass/fail. **Evidence needed:** the code path in `alarm.mjs` from a HIGH-severity finding to an actual outbound notification, and a test asserting that path fires (not just that the finding object is produced).

### R2.4 — Confirmed correct: `Object.hasOwn` fix is complete for its own scope
Both `allocateWeighted`'s `unlevelled` filter and `loadLevels`'s `bad` filter were converted to `Object.hasOwn`. Since `census()` is only invoked after the `unlevelled` early-return (i.e., only when every activated vault's level is already a genuine `LEVEL_WEIGHTS` key), no prototype-polluted string can reach `census`. I did not have `census`/`denominator`'s source in this bundle to check independently — flagging as unverified, not a finding.

### R2.5 — LOW: ledger-throws-on-bad-key is safe today but worth a note
Confirmed only the distribute script itself and human manual edits (`resolvedBy`) can write into `st.days`; customers can't inject a key. The throw is therefore not attacker-reachable, consistent with the "known limits" framing. But it does mean **one human typo in a manually-added day key halts distribution for every vault, not just the erroneous record** — worth weighing against R2.2's same-shaped risk.

---

## R3 — `scripts/bank-sign.sh` base64 hardening

### R3.1 — HIGH: trailing-`=`-count is unbounded; a single-character substitution reproduces exactly the bug this fix was meant to close
The new checks are: (1) alphabet-only, (2) no non-`=` after any `=`, (3) `length % 4 == 0`. None of these bound *how many* trailing `=` there are. Take any legitimate transaction base64 string that legitimately ends in one padding character, e.g. `...WXY=` (a 4-char group with one real trailing `=`, decoding the final group to 2 bytes). Replace the character immediately before the existing `=` with another `=`: `...WX==`. This is:
- same total length (still `%4==0`),
- entirely within the base64 alphabet (`=` is an allowed character),
- has all its `=` at the very end with nothing non-`=` following (passes the padding-position check).

But `WX==` is a 2-real-char + 2-padding group, decoding to **1 byte**, versus the original `WXY=`'s 3-real-char + 1-padding group decoding to **2 bytes** — i.e. the modified string decodes to a transaction **one byte shorter** than the pasted one, silently. This is the identical failure class ("decodes to a DIFFERENT, SHORTER transaction than pasted") the fix's own comment claims to close.
**Evidence that would confirm this:** `node -e "console.log(Buffer.from('WXY=','base64').length, Buffer.from('WX==','base64').length)"` — expect `2` and `1`.
**Fix:** additionally require the count of trailing `=` to be exactly 0, 1, or 2 (reject 3+), *and* — since that alone doesn't stop the WXY=→WX== substitution (which only uses 2 padding chars, already "legal") — require that swapping the padding count doesn't happen invisibly: the only robust fix is to re-encode the decoded buffer back to base64 and diff-compare against the pasted string byte-for-byte, rejecting on mismatch. Anything short of a round-trip comparison leaves this class open.

### R3.2 — Confirmed: does not appear to reject legitimate transactions
1644 characters, alphabet-only, single trailing `=`, length % 4 == 0 — passes all three checks. No false positive identified.

---

## R4 — Gates added this round

### R4.1 — MEDIUM: the new SPEC-completeness regex is blind to `#[msg]`-less error variants
`errNames` extraction requires `#[msg("...")]\s*(\w+),`. Anchor does not require a `#[msg(...)]` attribute on an error variant — it's cosmetic. A future `BankKeyOutsideX` variant declared without one is invisible to this regex, hence invisible to the new "every BankKeyOutside* must be named in SPEC" gate — reproducing, one level down, the exact "a control with no row is invisible to a row-checker" defect this gate was built to close. Not exploitable today (both current variants carry `#[msg]`); worth hardening (e.g. scan for the enum variant pattern independent of the attribute, or require `#[msg]` on every error variant via a separate lint) before it becomes load-bearing again.

### R4.2 — LOW, unverified: "exactly two ON-CHAIN rows" checks count, not identity
`rows.filter(r => r.endsWith(...)).length === 2` verifies there are two rows whose *text* says "claims ON-CHAIN, source says ON-CHAIN." I don't have the row-to-source mapping function in this bundle, so I cannot confirm the two rows are actually independently checked against SEAL and MINT respectively rather than, say, two rows both incidentally validating the same program. Flag for verification, not a confirmed defect.

### R4.3 — MEDIUM, unverified: `Keypair.fromSeed`/`Keypair.generate` gap — likely untidy, not confirmed safe
Every `Keypair.generate()` call visible in this bundle (e.g. `const a=Keypair.generate()` in the new theft test) is unambiguous test-fixture use — disposable identities on a local validator, no funds at risk. If the flagged calls elsewhere in the tree are the same pattern, this is untidy, not exploitable. But I don't have visibility into every call site (this bundle is diff-scoped), and a `Keypair.fromSeed` call *in a production signing script* deriving a real key from a fixed/predictable seed would be a genuine key-compromise vector categorically different from `fromSecretKey`. Given a prior round already reported this live and unfixed, I recommend an actual `grep -rn 'Keypair\.\(fromSeed\|generate\)' --include=*.{mjs,sh,ts} $(cat scripts/audit-coverage.sh file list) | grep -v /tests/` before closing this out either way.

---

## R5 — Comments, both directions

I re-read every touched comment for over- *and* under-claims. The five specific documents named in R17's second-worst finding (SEAL header, `cosign.mjs`, `distribute.mjs` header) are corrected in this diff and now accurately describe the on-chain confinement. SPEC.md's prose/table are not in this bundle, so I can't independently verify those two were also corrected — flagging as unverified rather than assuming.

One residual **minor over-claim** (opposite direction from what R1 asks, but relevant to "read both directions"): MINT's confinement comment states "it reaches the Bank's SOL float... It does NOT reach customer Bitcoin." This is true for *custody*, but doesn't account for *availability*: if the Bank's mint-side SOL float were drained (per R1.1's stacking scenario) and the Bank also relies on that float to pay fees for redemption co-signing, a mint-side drain could cascade into an inability to co-sign redemptions — an availability effect on customer Bitcoin *access*, even though custody itself is untouched. Worth a footnote in that comment rather than a flat "does not reach."

---

## R6 — The arithmetic

I could independently re-derive and confirm the two census figures given in the promp