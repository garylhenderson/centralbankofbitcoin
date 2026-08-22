# ROUND 15 — VERDICT

**Pointed at the two things that did not exist last round** — `bank/cosign.mjs`,
never in any audit prompt in fifteen rounds, and the rewritten break in
`bank/lock.mjs` — plus round 14's other repairs and its own verdict.

Eight models. qwen returned `finish=error` mid-stream; its partial reasoning is
in this directory and produced one accepted finding anyway.

**First round where the author measured the headline before the reports landed.**
The blind-signing CRITICAL was reproduced on a real serialized transaction ~20
minutes into the round; six of the eight models then wrote it independently. That
is the corroboration this process is supposed to produce, and it is the reason
the finding is stated as measured rather than argued.

## The headline

**THE FILE BUILT TO MAKE "THE BANK SEES THE WHOLE TRANSACTION" TRUE SIGNED A
THEFT.** `judgeRedemptionTx` refused only a second instruction to SEAL or BURN.
A Solana signature authorises the whole message, so:

```
[ open_for_redemption, SystemProgram.transfer(from=BANK, to=attacker), burn_vault ]
```

returned `ok:true` with an **empty reasons array**, and `--live` would have
partial-signed it. The customer composes the transaction; the input is hostile by
construction.

**The control was already written, thirty lines into a sibling file.**
`bank/revenue.mjs` refuses to put the operator key on a Jupiter response without
bounding the signer set and the programs — *"LOOK AT IT BEFORE SIGNING IT ... is
a blank cheque"*. The newer and far more valuable signer had none of it. **One of
two identical sites, sixth round running**, and this time the unguarded site was
the one holding the key that co-signs the only instruction that can permanently
remove value.

**Zero findings in the four programs again.** Everything landed in the newest
file, in a repair, or in the tooling that certifies the rest.

---

## ACCEPTED AND FIXED

### 1. CRITICAL — the co-signer signed arbitrary customer-chosen instructions
Measured before the reports (real serialized legacy transaction, decompiled
exactly as `inspect()` does), then written independently by terra, kimi, grok,
glm, opus and luna. What a redeeming customer could obtain the Bank's signature
for: `SystemProgram.transfer` out of the Bank, `assign`/`allocate` on the Bank's
account, SPL `approve`/`transfer`/`setAuthority`/`closeAccount` on any
Bank-owned token account, and any program at all that treats the Bank as an
authority. Plus the Bank as **fee payer**, which no instruction lists at all.

Four arms, all asserted both ways:
- **The Bank's pubkey may appear ONLY in the two approved instructions.** A
  program can exercise the Bank's authority only if the Bank is in its account
  list, so confining the pubkey closes the whole class. Stricter than an
  `isSigner` test and it needs no signer flags plumbed through.
- **A program ALLOWLIST** (Core, both token programs, ATA, ComputeBudget,
  System), **fail-closed when the caller omits it** — an absent allowlist used to
  mean "no constraint", which is the wrong default for a judge whose job is to
  refuse, and a second caller would have silently inherited the defect.
- **The Bank may not be the fee payer.**
- **A durable-nonce transaction is refused** (kimi): the Bank's signature on one
  never expires, which is the airdrop race with the clock removed.

**What this is still NOT:** a full redemption grammar. It does not verify that a
sweep sends the vault's tokens to the OWNER, and an in-transaction deposit into
an undeclared PDA-owned account defeats the coverage scan deterministically
rather than by luck. Neither can rob the Bank; both are stated in the code and
carried rather than half-built.

### 2. HIGH — an ack was a general mute button (terra, qwen)
`applyAcks` downgraded ANY asset-scoped finding, so one line reading
`vault_burned:<asset>` in `bank/acks.json` silenced the paging for a **real bare
Core BurnV1** — the one attack the programs structurally cannot prevent. The ack
was built for three findings that are unanswerable BY CONSTRUCTION, and
"nobody can act on this" is a property of those kinds, not of an asset.
`ACKABLE_KINDS` is now those three, and **an ack on any other kind is itself
reported at full severity** rather than ignored — a mute button that quietly does
nothing is as bad as one that quietly works.

### 3. HIGH — the lock's restore window DESTROYED the true holder's lock
Measured with the file's own seams before the reports; then terra, luna, kimi,
grok and glm each wrote the interleaving. Between the rename and the `wx` restore
**the pathname does not exist**, so a third runner's ordinary `claim()` succeeds
there; the `wx` restore then failed EEXIST, the catch ate it, and the next line
unlinked the copy — the true holder's lock, destroyed, while it was paying.

- The restore is now an atomic `rename` back, so the true holder always survives;
  a failure to restore **throws** instead of being swallowed.
- `releaseLock` returned **true** on ENOENT, so the one state meaning "somebody
  took our lock" was the one state `withLock` printed nothing for. Now false.

> **THIS IS A NARROWING AND NOT A CLOSE, AND THE HEADER SAYS SO.** Round 14's
> header claimed the TOCTOU was closed; "exactly one process can take the lock out
> of the way" is true and is not the property that matters. A rename is atomic; it
> is not a compare-and-swap. No arrangement of `rename`, `link` and `unlink` gives
> one — every scheme reduces to check-then-act.

**So the durable answer is installed where it matters**: `scripts/cron-install.sh`
now wraps every money job in **`flock -n`**, a kernel lease on an open fd that
needs no break, releases on death and cannot race. `-n` and never a wait: two
overlapping distribute runs must ABORT, because a queued second run pays the same
day twice as soon as the first finishes. The prefix is asserted **against the real
file** — a prefix dropped in an edit leaves the crons working and merely
non-exclusive, which is invisible until the day two runs overlap.

### 4. MEDIUM — a zero in the base `amount` is not an empty account
`scanPda` was one line: `if (amount !== '0')` off `readBigUInt64LE(64)`. **BURN's
own second loop was fixed for exactly this a round earlier and says why in the
code** — *"a confidential balance reads zero in the base `amount`"*. One of two
identical sites, again. `classifyPdaTokenAccount` now refuses any PDA-owned token
account that is not exactly 165 bytes: its value may sit in a confidential balance
or in `TransferFeeAmount.withheld_amount`, and `burn_vault` refuses it as a
declared account, so it can be neither swept-and-declared nor safely destroyed.

*Stated rather than hidden:* this is a griefing surface. Anyone can create such an
account for any vault's PDA for dust and block its clean redemption. The choice is
a **visible block against an invisible loss** — without the refusal the burn
silently orphans whatever is there — and the refusal now names the human escape.

### 5. MEDIUM — a DAS reply with no answer in it read as "owns nothing"
`j.result?.items || []`: a 200 carrying `{}`, `{result:null}` or a provider
envelope without `items` and without `error` fell through as "this vault owns no
Core assets", one line below a guard written for exactly that rule. HTTP status
and response shape are now both fail-closed.

### 6. MEDIUM — an assertion that could never fail (glm)
`fsx.readdirSync(fsx.existsSync(L) ? '.' : '.')` — **a ternary whose two branches
are the same string** — scanned the process CWD while the lock and its
`.breaking.` files live in a temp directory. It reported 0 forever. A gate that
has only ever said OK is untested; this one was structurally incapable of saying
anything else. Now reads the lock's own directory, proven by planting litter.

### 7. MEDIUM — `BURN_FIXED_ACCOUNTS` claimed an assertion that does not exist (opus)
The comment said *"Asserted against the suite's own builder in 3.1c-3.1f"*.
3.1c-3.1f assert the four index constants inside the Rust; `grep -rn
BURN_FIXED_ACCOUNTS tests/` returned nothing. **The seventh round of the comment
class, in the newest file, in the commit written to end it.** Now genuinely
asserted: 3.1g counts `BurnVault<'info>`'s fields in BURN's source and pins the
constant to them; 3.1h proves the regex still matches the struct.

*Rejected within the same finding:* opus's "fails OPEN" headline. Its own body
walks four drift cases and finds all four fail closed. The residual — a widened
`declared` argument making `burn.data[8]` read a different field — is covered by
3.1g going red on any account-list change.

### 8. MEDIUM — three comments DENY a control that now runs
SEAL's header, BURN's header, and **SPEC's proven impossibility 2, which
contradicted SPEC's own control table two sections above it**. Six rounds of
comments claiming a control that does not exist; this is the first round of the
inverse, and it is the same defect. All three now point at the control table.

### 9. LOW — the newest key-holder did not check its key file's mode (kimi)
`revenue.mjs` and `distribute.mjs` both refuse a group- or world-readable signing
key. `cosign.mjs`, holding the key that co-signs the only irreversible
instruction, did not. **One of three identical sites.**

### 10. LOW — SPEC's stated assertion counts, stale since round 8
"Running the tests" read **178 / 93 / 14** against a real **270 / 315 / 17**.
Nobody is misled about safety by a stale number, and that is the problem: a
documented count that is visibly wrong teaches the reader that the floors beside
it are decorative too. It is four numbers and a regex, so it is a **gate** now —
and it went red on the author's own next edit, minutes later.

### 11. HIGH (coverage) — the coverage gate excluded the build configuration (terra)
`Cargo.toml` carries `overflow-checks = true`, quoted to every auditor in every
round as **measured fact 6**, in a file no auditor has ever been shown. So is
`Anchor.toml`, which pins the toolchain and the cluster. A coverage gate that
excludes the files controlling the certification is the same shape as the defect
it exists to catch. Widened — and it immediately reports both files.

> ⚠️ **COVERAGE IS THEREFORE RED, AND THAT IS CORRECT.** They go into round 16's
> bundle. Back-filling them into `audit15.ts` after the round ran would be a lie
> about what was shown, and the script's whole premise is that the prompts are the
> record of what was actually sent.

### 12. MEDIUM — `writeLedger` did not fsync the directory after the rename (luna)
The bytes were durable; the rename is a directory operation and was not. A power
loss between them leaves a fsynced ledger that no name points at — which reads as
day one on the next run and pays everyone again. Best-effort fsync of the parent.

---

## REJECTED, WITH THE REASON

- **"The co-signer never checks the vault's collection or its on-chain owner"**
  (opus, HIGH). Both SEAL and BURN refuse a foreign asset (`ForeignVault`) and a
  non-owner (`NotTheOwner`) on chain, and the suite asserts it. A Bank signature
  on such a transaction buys the attacker nothing: it reverts.
- **"Legacy-only parsing is a HIGH availability failure"** (luna, opus). The
  limitation is real — a v0 transaction with an address lookup table cannot be
  co-signed — but the direction it fails in is the correct one for a signer, and
  a lookup table would hide the account list the judgement depends on. **Converted
  to assertion 3.1i** rather than changed, so a future web3.js that parses a
  versioned message here turns the suite red first.
- **"The judge does not verify owner and bank are actual signers"** (minimax).
  The transaction cannot land without them; Anchor's `Signer` constraints are the
  control, and they are asserted on chain.
- **"Declare-everything bricks a vault"** (glm, CRITICAL/HIGH). That is the
  design, not a defect: a coverage refusal is a refusal to bless the DESTRUCTION
  of what a vault holds. Stated in SPEC as a griefing surface, and the refusal
  now names the human escape. The tool is inspect-only by default for this reason.

---

## ACCEPTED, NOT FIXED — carried to round 16

1. **NOTHING IS WIRED TO THE CO-SIGNER** (luna, terra). No cron, no service and
   no client calls `bank/cosign.mjs`, so nothing forces a redemption through it
   and a separate signer implementation bypasses every check above. It is a tool,
   not yet a control. **This is the most important item on this list.**
2. **The lock's three-way hole is not closed in-process.** `flock -n` covers every
   unattended run; a hand-run job is still on the pathname lock.
3. `Cargo.toml` and `Anchor.toml` must be in round 16's bundle.
4. Cross-pass correlation lag: a CRITICAL that already went out is never retracted.
5. Compute units are unmeasured; there may be a CU ceiling below the byte ceiling.
6. `prog.*.hash` slices at a fixed offset 45, wrong when an upgrade authority is
   absent. Now applies to Core too.
7. `detectNestedVaults` cannot see a FOREIGN Core asset nested in a vault.
8. `burn_via_program` does not verify the asset is one of ours.
9. MINT still carries the dead redemption stamp and the "strictly stronger" comment.
10. Distribution reconciles against a ledger the payer wrote; no fresh per-cycle
    swap operator wallet.
11. Duplicate attribute keys at mint; a vault minted during a proposal may vote; a
    buyer cannot verify reserve continuity atomically. All stated limits.
12. `bank/cosign.mjs` reads the Bank from SEAL's config; BURN keeps its own copy.
    They can disagree, and a divergence halts redemption (`WiringDiverged`) rather
    than permitting one — availability, not safety, and unwatched.

---

## STATE

`270` on-chain · `315` detector · `17` allocation · `11` mainnet. Every floor
equals its real count, and SPEC's stated counts are now asserted against them.

**Nothing is deployed. Nothing has minted. Nothing holds real value.**

Fifteen rounds; **fifteen with a real finding.** THE SHIP GATE has been met
**zero** times, and round 15 resets nothing because the counter was already zero.

The pattern held again, in both of its known shapes at once. **A fix is a change,
and a change is a place a defect can live** — every accepted finding above is in
code written since round 14 read the tree, or in the tooling that certifies it.
And **one of two identical sites** appeared three times in one round: the blind
cheque `revenue.mjs` already refused, the base-`amount` read BURN already fixed,
and the key-file mode two sibling jobs already check.

The newest thing this round adds to that list is smaller and worse:
**`bank/cosign.mjs` was written specifically to end a defect class, and shipped
carrying four of them.**
