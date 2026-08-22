# ROUND 16 — VERDICT

**Pointed at round 15's twelve repairs and round 16's own five**, plus `Cargo.toml`
and `Anchor.toml` — never in any audit prompt in sixteen rounds, and the first
carries `overflow-checks = true`, quoted to every auditor in every round as
measured fact 6.

Eight models, **a changed roster**: qwen and minimax out, deepseek-v4-pro and
gemini-3.1-pro in.

## The headline

**A THEOREM THE AUTHOR WROTE IN A HEADER WAS FALSE, AND IT WAS LOAD-BEARING.**

Round 15 measured a hole in `bank/lock.mjs` and then justified leaving it open:

> *"no arrangement of `rename`, `link` and `unlink` is a compare-and-swap — every
> scheme reduces to check-then-act."*

opus broke it in one line: **`link()` IS compare-and-swap.** CAS(absent → mine),
atomic, kernel-enforced, and `place()` has relied on it since round 12. What this
file never had is CAS(theirs → mine), and it does not need one — the hole exists
only because the break REMOVES the contended name and then tries to put it back.

They also named the measurement that settles it, and it settled against me.
Round 15's own selftest planted the interloper with a raw `writeFileSync(wx)`;
replace it with a real `acquireLock` and **the true holder and the interloper
both return `ok:true`** — the double payment this file exists to prevent, in a
scenario no assertion had ever stated. Measured before the fix.

So the mechanism changed. The lock is now the set of records `<file>.0`,
`<file>.1`, …; the holder is the highest-numbered one; a breaker LINKS
`<file>.<G+1>` and sweeps only strictly below its own. A live holder's record is
never removed by anyone else and there is no interval in which the lock is
absent. **The restore branch — the source of every lock defect in rounds 12, 14
and 15 — does not exist any more, because nothing is taken away to restore.**
Two, three and four-racer interleavings all reduce to one `link` winner per
generation.

## The second headline: I measured my own fix away

The round-14/15 carry list contained *"`prog.*.hash` slices at a fixed offset 45,
which is wrong when a program's upgrade authority is absent — the ELF starts at
13 then"*, accepted from two auditors across two rounds. I fixed it. Then I went
to the chain.

`bpf_loader_upgradeable::set_authority` rewrites the header **into the existing
account** and never resizes it, and `size_of_programdata_metadata()` is 45
unconditionally. Measured on two live immutable mainnet programs — Token Metadata
and Squads v4 — byte 12 is 0, bytes 13..45 are non-zero **stale authority bytes**,
and `\x7fELF` is at 45.

**The original code was right and the finding was wrong.** Shipping the "fix"
would have folded 32 bytes of stale authority into the fingerprint and fired a
spurious CRITICAL on **Metaplex Core** — the most important entry in the drift
watch — the day Metaplex made it immutable. A local validator cannot produce an
immutable program with a stale authority still in its header, which is precisely
why the claim survived two rounds unmeasured. It is now asserted against mainnet,
where facts a validator cannot reproduce belong.

---

## ACCEPTED AND FIXED

### 1. HIGH — the impossibility theorem, and the double hold under it (opus)
Above. Mechanism replaced; 20 lock assertions rewritten to speak POLICY rather
than layout, so the next mechanism change costs three lines instead of
twenty-four.

### 2. HIGH — `/var/lock` is tmpfs; every money cron would have died at the first reboot (grok, opus, kimi)
Round 16 installed `flock -n` on every money cron as "the durable answer" and put
the lock directory in `/var/lock/cbob`. Measured on this box: `/var/lock` is a
symlink to `/run/lock`, a **5 MB tmpfs**. After a reboot the directory is gone,
`flock` exits 1, and the watcher, the daily payout, the revenue cycle and the
reconcile all stop — silently, except for the watcher, which has a deadman.

The durable answer, installed in the one directory that does not survive the
event that most often leaves a stale lock behind. Moved under the tree, plus
`mkdir -p` on every cron line so a deleted directory self-heals rather than
killing a job.

### 3. HIGH — `judgeCronTemplate` could not see the property it was written for (grok, opus, luna, deepseek)
The gate matched `flock` or `$FLOCK` and stopped. `flock` **without `-n` waits**,
and a queued second distribute run pays the same day twice the moment the first
finishes — the exact bug the whole file exists to prevent, and the suite stayed
green. **The same class as the litter ternary round 15 fixed.** Now requires
`-n`, and accepts `$FLOCK` only when the variable is *defined* with `-n` in the
same file, so deleting that line cannot slip past by being one indirection away.

### 4. MEDIUM/HIGH — the DAS fail-open fix reached one of THREE sites (grok, luna)
Round 15 hardened `cosign.mjs`'s `scanPda` and left `alarm.mjs`'s `listVaults` on
`j.result?.items || []` — **in the same commit whose verdict named one-of-two-
sites as this project's most repeated defect.** Contained, not harmless:
`detectVaultSetChange`'s 10% guard fires CRITICAL, but `detectNestedVaults` and
`detectUndeclaredTokenAccounts` — the entire post-hoc half of the control table —
would each report a clean all-clear over an empty list.

Now ONE `judgeDasEnvelope` with three callers. **And the gate written to catch a
third copy found one on its first run**: `distribute.mjs`, which I did not know
was there. The gate now DISCOVERS DAS readers rather than checking a list of two,
because a hardcoded list of two is how you fix two of three.

### 5. HIGH — an ack silenced conditions that are actionable (terra, luna, kimi, opus, glm)
Round 15 scoped acks to three kinds "whose condition is unanswerable BY
CONSTRUCTION". Five models pointed out that is false of the kinds as a class: a
`nested_vault` inside a **LIVE** host is recoverable — its owner can Execute the
inner vault straight back out — and only a burnt host makes it permanent;
`unredeemable_owner` on a marketplace escrow clears on delisting.

This file cannot judge recoverability per asset. It CAN bound how long a human's
judgement is trusted, which is the blind spot `detectors.mjs` had already named
in writing: *"an ack that was true when written and is not any more."* **Acks now
expire**: `{"why": "...", "until": "YYYY-MM-DD"}`, both mandatory, no bare-string
form — a string cannot carry an expiry, and accepting both would make the shape
that never expires the easiest one to write. An expired or malformed ack is
REPORTED, not ignored.

### 6. MEDIUM — a CRITICAL that said the wrong thing (kimi, glm)
`banks_disagree` asserted "REDEMPTION IS ALREADY HALTED" for **any** divergence.
A seal/mint divergence halts MINTING. The wrong-CRITICAL-text class, on the
product's most sensitive path, on a case the selftest never exercised — it only
ever built seal-vs-burn. Now names the diverging pair and what each one halts.

### 7. MEDIUM — the fee-payer arm asserted its own fail-OPEN direction (glm)
Round 15 wrote `t('...and an UNKNOWN fee payer does not refuse on its own', …,
true)`. `null` means the caller LOOKED and could not tell, and the fee payer is
the one debit no instruction lists — the exact case a judge whose job is to
refuse what it cannot see must stop on. Flipped. `undefined` still means "this
caller is not using the arm".

### 8. MEDIUM — `readProgramData` called a malformed tag "IMMUTABLE" (luna)
`data[12] === 1` folded every other byte value into `hasAuth: false`, which the
caller renders as the word IMMUTABLE — a confident claim about an account we
could not read. A tag that is neither 0 nor 1 is now a stated problem.

### 9. MEDIUM — `WATCH` carried `seal.bank` twice (glm)
The literal entry plus the new `BANK_KEYS` spread, so one landed rotation emitted
two identical `config_drift` findings. The spread is the single source now.

### 10. MEDIUM — the mainnet probe was the only suite with no floor
Found while adding assertions to it. Ten lines below the two that have one, in
the file that enforces them, `node probe | tail -2` also threw the body away:
delete every assertion in the probe and the build stayed green. One of three
identical sites, in the runner that gates the other two. `MAINNET_FLOOR=19`.

---

## REJECTED, WITH THE REASON

- **"Arm 1 can be bypassed via CPI with the Bank as an unlisted signer"**
  (deepseek, CRITICAL). The runtime requires every account a program passes to a
  CPI to be among the accounts of the instruction that invoked it. A program that
  does not list the Bank cannot conjure it. grok checked the same four candidates
  independently and concluded arm 1 is complete for Bank authority.
- **"`ComputeBudget SetComputeUnitLimit` can inflate fees to drain the Bank"**
  (deepseek, HIGH). Fees come from the fee payer, which arm 3 refuses to let be
  the Bank — and now refuses when it cannot be determined at all.
- **"`flock -n` is not atomic for the cron's compound command"** (deepseek,
  CRITICAL). `flock -n <file> <cmd>` opens, locks and execs; `cd && flock …` does
  not change that.
- **"The 165-byte test misidentifies Token-2022 accounts that are exactly 165
  bytes"** (deepseek). A T22 account with no extensions IS exactly 165 and is
  safe to declare; any extended account carries the account-type byte at 165 plus
  TLV and is longer.
- **"`readProgramData`'s Option tag is at byte 12, but the Anchor discriminator
  is 8 bytes"** (deepseek). ProgramData is a loader account with no Anchor
  discriminator — measured: bytes 0..4 are the loader enum (3), byte 12 is the
  Option tag, on two live mainnet programs.

---

## ACCEPTED, NOT FIXED — carried to round 17

1. **NOTHING IS WIRED TO THE CO-SIGNER.** Still the most important item. No cron,
   no service and no client calls `bank/cosign.mjs`. The one-reader assertion
   makes a second signer a build failure; it does not make the first one
   mandatory.
2. **`judgeRedemptionCoverage` refuses the correct remedy and there is no
   override** (opus). The customer's answer to a dust airdrop is to declare it and
   let the burn destroy it; the `undeclarable` refusal blocks that too, and the
   "a human can sign by hand" escape is rhetorical — the tool has no flag for it.
3. **The Bank may still be named `payer` inside the pair itself** (kimi, opus).
   Arm 1 exempts the two approved instructions entirely.
4. **The allowlist permits a bare Core `BurnV1` of a SECOND vault** beside a real
   redemption (opus, kimi). The owner harming their own property, and
   `correlateBurns` is per-asset so B stays CRITICAL — but the Bank puts its name
   on it.
5. **An aborted `flock` run is indistinguishable from one that never fired** in
   the log (grok, opus, glm, deepseek).
6. **A wedged-but-alive holder is now a permanent silent skip under `flock -n`**
   (glm).
7. **The judge never looks at where the swept money goes** (kimi).
8. Compute units unmeasured; foreign nested Core assets; MINT's dead redemption
   stamp; distribution's self-written ledger; no per-cycle swap operator wallet;
   duplicate attribute keys; a vault minted during a proposal may vote.

---

## STATE

`270` on-chain · `355` detector · `17` allocation · `19` mainnet. Coverage
**GREEN** — 26 files, every one of them read by at least one auditor.

**Nothing is deployed. Nothing has minted. Nothing holds real value.**

Sixteen rounds; **sixteen with a real finding.** THE SHIP GATE has been met
**zero** times.

Two things this round establishes that the previous fifteen did not:

> **A theorem in a comment is a claim, and this project had never tried to break
> one.** "No arrangement of rename, link and unlink is a CAS" read like a fact
> about POSIX. It was an assertion about my own imagination, it was load-bearing
> for leaving a measured double-hold open, and one auditor refuted it in a
> sentence.

> **A carried finding is not a verified finding.** The ELF-offset item sat on the
> accept list for two rounds because it was plausible, and it was wrong. Accepting
> it into a fix was one commit away from breaking the drift watch on the one
> program we do not control. Measure a carry BEFORE you fix it, not after.
