# ROUND 15 AUDIT — R1 (cosign.mjs), R2 (lock.mjs), R3 (repairs), R4 (comments)

Ordered as requested. Every finding names the construct, the gain, the evidence that would exist if I am right, and the fix. Where a question in the prompt checks out, I answer it in one line without endorsing the surrounding work.

---

## R1 — `bank/cosign.mjs`

### R1-1. CRITICAL — The Bank's signature authorizes the whole transaction; the judge inspects only the redemption pair

**Construct.** `judgeRedemptionTx` filters instructions by program: the only "extra instruction" refusal is

```js
if (ix.programId === cfg.sealProgram || ix.programId === cfg.burnProgram) { bad.push(...) }
```

Everything else in the transaction passes the shape check. Then `--live` does `tx.partialSign(bank)` and serializes. A Solana signature is an authorization for **every instruction in the transaction that lists the Bank as a required signer**, including via CPI pass-through. The judge also maps `accounts: ix.keys.map(k => k.pubkey.toBase58())` — it **discards the `isSigner`/`isWritable` flags**, so it is structurally incapable of seeing where the Bank's signature is being spent. It never inspects `tx.feePayer`.

**What a redeeming customer gains.** Concretely, added to a perfectly well-formed redemption:

1. **A bundled `mint_vault`.** MINT is not in the refusal filter. `mint_vault` requires `bank: Signer` — satisfied by the Bank's transaction signature. The customer supplies asset/payer/owner signatures themselves. The Bank has now co-signed a mint without any check of its two written duties (SPEC: refuse mints while a proposal's voting window is open; refuse charter-priced mints without a burned Proof of Burn). The tool that was built to make "the Bank sees the whole transaction" true does not look at the one instruction class the Bank has documented duties over.
2. **`SystemProgram.transfer({fromPubkey: BANK, ...})`.** The System program requires the source to sign; the Bank's signature satisfies it. Whatever SOL the Bank wallet holds is drained.
3. **Any SPL Token instruction on a Bank-owned account** (transfer, approve, close), and **any call to any program where the Bank is a signer** — including CPI pass-through: a program X invoked with the Bank as signer can CPI onward with the Bank's authority. An allowlist of *programs* does not fix this; only the signer metas do.
4. **The Bank as fee payer** (never checked) — recurring fee drain.

**Evidence if I am right.** Build a base64 redemption, append one `SystemProgram.transfer(BANK → attacker, 1 SOL)`, run `node bank/cosign.mjs --tx ...`. `inspect` returns `ok: true` — the judge never examines the instruction. On the local validator with a funded Bank key, run `--live`, submit the output: the transfer lands and the Bank balance drops. No reasoning required; this is a two-minute test. The same test with a bundled `mint_vault` shows `minted_total` advancing on a Bank co-signature the operator never saw.

**Fix.** The judge must treat the transaction as hostile in full: (a) refuse any instruction to MINT or GOV outright; (b) for every instruction, refuse if any account meta with `isSigner: true` is the Bank outside the open/burn pair; (c) refuse `feePayer == bank`; (d) allowlist the remaining programs (Core Execute on *this* asset, SPL Token, ATA, System) and within them require that writable/signer accounts are the PDA, the owner, or the fee payer; (e) assert the message's required-signature set is exactly {owner, Bank, feePayer ≠ Bank}. Keep the flags — the current mapping throws away the only field that answers "where is my signature being spent?"

### R1-2. CRITICAL — Any Core asset transferred into a vault's PDA permanently bricks that vault's redemption under this tool

**Construct.** The coverage half refuses to sign unless *every* holding the scan sees is declared. Combine with three already-measured facts:

- Core permits transferring any asset to any owner, including a vault's asset-signer PDA (measured, 9.1).
- `burn_vault` refuses a **declared** live Core asset — any live Core asset, foreign or ours (`VaultStillHoldsAVault`, measured 9.4).
- Nothing can ever move an asset owned by a PDA (measured fact 3 / 9.3): Execute and Transfer both need the owner's signature, and a PDA cannot sign.

**What an attacker gains.** Buy or mint any cheap Core asset — it does not need to be one of ours; `scanPda`'s DAS query returns *all* assets owned by the PDA — and transfer it into the victim's derivable asset-signer PDA. From that moment:

- undeclared → `cosign` refuses at coverage, forever;
- declared → the burn refuses on-chain, forever;
- removal → impossible by construction.

The victim's vault cannot be redeemed by anyone, ever, and the customer's Bitcoin is sealed permanently. Cost to the attacker: one NFT and a transfer fee. The vault remains transferable, so this is also a fraud vector: sell the bricked vault to a buyer who cannot cheaply verify the PDA's contents (a known limit, carry-over #9).

Note the author's own facts recombine against the *intended* case too. For a nested **CBOB** vault, the header says the refusal "closes the nested-vault case in practice." But the inner vault was *already* unrecoverable while nested (9.3) — nesting is irreversible. The old measured-ALLOW policy (9.5) destroyed the inner vault and let the outer's Bitcoin out: one vault lost. The new policy refuses: **two** vaults lost, permanently. The refusal makes the author's own considered tradeoff strictly worse, and the header presents it as a closure.

**Evidence if I am right.** On the validator: mint funded vault V; `create()` a standalone foreign Core asset; `transfer()` it to V's PDA (9.1 proves this lands); then (a) run `cosign --tx` with a redemption that does not declare it → REFUSED at coverage; (b) declare it → `VaultStillHoldsAVault` (9.4); (c) enumerate every instruction in all four programs that could move an asset owned by a PDA — there is none. Therefore no transaction sequence redeems V. The suite already contains every ingredient of this proof; nobody has assembled it.

**Fix.** This is a policy decision the tool made silently, reversing the documented tradeoff ("an UNDECLARED holding is DESTROYED by a burn, not stranded. Measured and asserted as ALLOW on purpose"). The scan's DAS items carry collection grouping: **refuse only undeclared assets that belong to the CBOB collection** (a real vault with real Bitcoin — and even then, state that the inner vault is already lost and the refusal costs the outer one), and permit foreign assets to be destroyed per the old policy. Document the residual: attacker-planted foreign NFTs parked in your PDA die with the vault. Whatever the decision, it must be written into SPEC's control table and asserted in both directions — right now the tool enforces a policy that exists nowhere.

### R1-3. HIGH — The declare-everything policy plus the 1232-byte ceiling means one junk SPL token makes a 3-mint vault unredeemable

**Construct.** 9.14a pins the 3-mint worst case at 1119 bytes; headroom is 113. A junk token airdropped into the PDA must now be **declared** (R1-2's policy) and **swept in the same transaction** (the burn refuses non-empty declared accounts, and the PDA can only sign during the thaw, which exists only inside the redemption transaction). One extra declared token account costs roughly: +32 (junk ATA key) +32 (junk mint key for a token burn, or +32 for a destination ATA) + instruction overheads ≈ 130–200 bytes — the same order as the harness's own 144 bytes per reserve mint. One junk token exceeds the headroom; the transaction cannot be serialized; the redemption cannot be built. The griefer pays ~0.004 SOL (mint rent + ATA rent + fee).

**Evidence if I am right.** Extend the 9.14 harness: one extra declared-and-swept junk account at N=3 → `sizeFor` returns > 1232. That is a five-line change to a harness that already exists.

**Fix.** Same policy decision as R1-2 (permit undeclared dust/foreign value to be destroyed), plus: measure and document the per-extra-account byte cost next to 9.14a, because "headroom 113" currently reads as margin when it is less than one account.

### R1-4. MEDIUM — A short DAS page below the limit reads as "owns nothing"

**Construct.** The truncation guard is `items.length >= 1000`. The DAS response carries `result.total`, which the code ignores. If the provider returns fewer items than requested — a deployment-specific cap below 1000, a partial page, an indexer hiccup that returns an empty list — the scan reads "the PDA holds nothing" and the tool signs. The full-page refusal catches exactly one shape of incomplete answer. DAS lag is acknowledged elsewhere in this repository ("blind to anything DAS has not indexed yet") and nothing here checks currency.

**Evidence if I am right.** Inspect any actual `getAssetsByOwner` response: `result.total` and `result.total_pages` are present. A test with a recorded response where `total: 3, items: []` shows `scanPda` returning `[]` and the coverage check passing.

**Fix.** Refuse when `j.result.total > items.length`, and refuse when `total_pages > 1`. Add a fetch timeout. Both are two lines.

### R1-5. LOW — The scan discards what it can see

- Zero-balance token accounts are dropped (`if (amount !== '0')`), so their rent (~0.002 SOL each) is destroyed undeclared and the closing claim "every holding this scan can see is declared" is false for accounts literally in the response. Report them; let the policy decide.
- `BURN_FIXED_ACCOUNTS = 11` and indices 0/2/3: **drift fails closed in every direction I can construct** — a reordered asset breaks the binding check and SEAL's on-chain pairing first; an inserted fixed account breaks the stated-count check; the comment's claim that 3.1c–3.1f assert the constant is false (they assert the Rust index constants, not this JS constant — see R4-5). But nothing derives 11 from the program; share a builder with the suite or assert it against the Rust source the way 3.1c–3.1f do.
- SEAL-config Bank vs BURN's own copy: they **cannot usefully disagree** — BURN's on-handler cross-checks `seal_config.bank == cfg.bank` (`WiringDiverged`), so a disagreement halts burns on-chain, and the judge's use of SEAL's bank for both halves refuses the mismatched shape. Fails closed. (Related gap: no *standing* check that `seal.bank == burn.bank == mint.bank`; a launch misconfiguration is adopted silently as the first baseline. One more `collections_disagree`-style check would close it.)
- Refusing two redemptions per transaction: correct as a Bank policy; the programs permit the shape and nothing legitimate breaks (two transactions instead of one). It is stricter than the chain, which is the right direction for a co-signer.
- `Transaction.from` rejects versioned transactions in current web3.js (the 0x80 version byte) — fails closed, but nothing asserts it; one selftest line would pin it.

---

## R2 — `bank/lock.mjs`

### R2-1. HIGH — The restore path re-opens the double hold: three racers, or one racer and a crash

**Construct.** The rename is exclusive for the *stale* lock — two racers renaming the same source cannot both succeed; the loser gets ENOENT. That part is sound. But the restore branch performs a **second** taking: it can rename away a *replacement* (the winner's fresh lock), and between that rename and the `wx` restore the lock path does not exist.

Three racers:

1. Stale lock T. A and B both pass read/stale/dead/re-read (both see T).
2. A: `rename(file → A.stolen)`; token matches; `claim(file)`; A **holds** and starts paying.
3. B (descheduled at the re-read) wakes: `rename(file → B.stolen)` — `file` exists (A's fresh lock) — **succeeds**. A's lock is now out of the way.
4. C (the cron firing, a manual run — any `acquireLock`): `claim(file)` — path absent — **C holds**, starts paying.
5. B: reads `B.stolen`, token is A's ≠ T → restore: `openSync(file,'wx')` → EEXIST (C's lock) → **swallowed**; `unlink(B.stolen)` — A's lock bytes are deleted; B reports lostRace.
6. **A and C both held. Both paid.** A discovers this only at `releaseLock`, after it has finished paying.

Crash variant, no third racer needed at step 4: B is killed (OOM, `kill -9`, power) between its rename and its restore. A's live lock now sits in `.breaking.<B-token>`, `file` is absent, and the next runner claims and runs beside A. The window is two `readFileSync`s wide — microseconds — but this file's own header says "that TOCTOU *is* the double-payment this file exists to prevent, so admitting it was not a fix." By that standard, "ROUND 14 CLOSED THE TOCTOU" and "two racers can never both take the lock out of the way" claim more than is delivered: the re-read→rename TOCTOU still exists (B can rename a replacement), and its compensation is non-atomic and crash-unsafe.

**Evidence if I am right.** A real two-process harness: spawn N node processes looping `acquireLock` on a stale lock, each holder heartbeating a per-token file; assert never two simultaneous heartbeats, over millions of iterations, plus a `kill -9` injector at each seam. The seam-injected single-process selftest cannot produce step 4 and never will.

**Fix.** The recorded next step — an OS lease (`flock`/`fcntl`) on an open fd — is the only durable answer; build it. Interim: after a failed `wx` restore, do not silently delete the stolen bytes — leave them at `stolen` and SCREAM (the current code destroys a live holder's lock and returns quietly); and `releaseLock` still uses a bare read-then-unlink with the same TOCTOU shape — give it the rename-verify pattern too.

### R2-2. MEDIUM — The "no litter" selftest assertion scans the wrong directory and can never fail

**Construct.**

```js
t('the steal leaves no temp file behind',
  fsx.readdirSync(fsx.existsSync(L) ? '.' : '.').filter(x => x.includes('.breaking.')).length, 0)
```

Both branches of the ternary are `'.'`. `L` lives in `os_tmp`; the assertion reads the **current working directory**. It passes regardless of what was left in `/tmp`, and would *false-fail* if the operator happened to run the selftest from a directory containing a `.breaking.` file. This is precisely the project's "a gate that has only ever said OK is untested" class, written into the commit that adds the branch the assertion claims to cover.

**Evidence if I am right.** Read the line: `fsx.existsSync(L) ? '.' : '.'`. Or run the selftest after manually creating `${L}.breaking.x` in `os_tmp` — the assertion still passes.

**Fix.** `fsx.readdirSync(require('path').dirname(L))`.

### R2-3. LOW — ledger durability details

`writeLedger` fsyncs the file but never the directory, so on power loss the rename (and the marker's creation) may not persist. The consequences are loud rather than silent in the current design (an unledgered sweep raises `unledgered_sweep`; an intent row with no sig is ambiguous, not re-sent), but a lost marker plus a later deleted ledger reads as day one. Add `fsync` on the directory after the marker write and after the rename.

---

## R3 — Round 14's other repairs

### R3-1. MEDIUM — An ack on an *event* kind mutes every future event of that kind on that asset

**Construct.** `applyAcks` keys on `<kind>:<asset>` with no memory of what was acked. `reserve_fell`, `deactivated`, `vault_burned`, `vault_vanished` are point-in-time events, not permanent conditions; `undeclared_token_account` names a *specific account* in its detail but is keyed by vault. Consequences: ack `reserve_fell:X` once ("known drain, being handled") and a **second, later drain of X is muted**; ack `undeclared_token_account:X` and every **new account an attacker plants on X's PDA** is muted in the daily reconcile. The docstring admits blindness to stale acks, but this is sharper: the ack is permanent while the condition it described was ephemeral.

**Evidence if I am right.** `applyAcks([crit('reserve_fell', A)], { 'reserve_fell:A': 'x' })` twice with different details — both come back INFO. The selftest only ever acks `vault_owns_itself`/`nested_vault`, the two genuinely permanent kinds.

**Fix.** For event kinds, either refuse to ack (they are answerable: look at the chain) or make the ack one-shot (consumed on first use). For `undeclared_token_account`, include the account address in the key. Findings without `asset` (approve, non_ata_token_account) are correctly un-ackable — that direction is sound.

### R3-2. LOW — `unredeemable_owner` fires on burnt vaults

The general arm iterates `everyVault` including `burnt: true` entries. A burnt vault that was DAO-owned when destroyed fires CRITICAL every 30 minutes forever about a condition that is moot — the vault no longer exists. Nothing has minted, so this is zero-cost today; at scale it is exactly the alarm-fatigue the round-14 ack work was done to prevent. Skip `burnt` in the general arm (the nested arm's inclusion of burnt hosts is deliberate and correct — a burnt host's PDA still holds things).

### R3-3. LOW — `correlateBurns` downgrade discards the original detail

`REDEMPTION_NOISE[f.kind](f.asset)` replaces the detail, so the amounts ("fell 79,000,000 sats (…→…)") vanish from the report. Keep the original detail and append the canned explanation. The allowlist itself I could not break: failed transactions are skipped (`if (s.err) continue`), so a `burn_via_program` finding implies a *successful* `burn_vault`, which implies the on-chain pairing held; and an asset cannot be both program-burned and bare-burned. The four kinds are the right four.

### R3-4. LOW — `validate-core-gate.sh`: a copy, and half a gate

The rewritten script now fails when it should (verified by reading `must_fire`/`must_pass` under `set -euo pipefail`; the boot loop's `solana && return 0` does not trip `set -e` because the failure is on the left of `&&`). Two residuals: (a) `gate()` is a **hand copy** of run-tests.sh's logic under a comment claiming "the EXACT logic" — the second-copy-of-a-fact class this project keeps re-finding; extract or source it. (b) It validates the dump-and-`cmp` arm only. The **pinned-sha256 arm** (`CORE_SHA256_EXPECTED`, the check that guards against a tampered *cache*) has no both-directions validation anywhere; delete that check from run-tests.sh and nothing goes red.

### R3-5. LOW — The verdict's own state line contradicts the floors in the same commit

`VERDICT.md` STATE: "`267` on-chain · **`250` detector** · `17` allocation". `selftest.mjs` FLOOR and `run-tests.sh` DET_FLOOR are both **275**. Since the suite reportedly passes, the real count is ≥275 and the verdict's 250 is wrong — a stale count in the document future rounds are told to attack, in the same class as SPEC's stale counts (see R4-6). The floors themselves I could not defeat without a source edit: hardcoded, `CBOB_TEST_FILE` refused, numerator must equal denominator. The residual defeat — hollowing an assertion while keeping the `rec()`/`t()` call — only diff review catches; that is a structural limit, not a flaw in the floor.

---

## R4 — Comments

### R4-1. HIGH — SEAL's header still denies the control that now runs

SEAL's header, unchanged by this diff: "**NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.** Nothing scans before it signs, because nothing signs. Until that is built, the pre-signature control is a human procedure, not a control." `bank/cosign.mjs` now exists, scans, and signs. The prompt's warning is exactly this case: a comment denying a control that now runs is the same defect as claiming one that doesn't. Update to point at the SPEC control table.

### R4-2. HIGH — BURN's header, same defect

BURN's header, also untouched by the diff: "but **no Bank co-signing tool exists in this repository**, so nothing scans before it signs. The pre-signature refusal is a human procedure until one is built. Do not read the co-signature as a control that runs." False as of this commit.

### R4-3. HIGH — SPEC contradicts itself about the co-signer

The control table lists `bank/cosign.mjs` as the **pre-signature** control. Proven impossibility 2, in the same document: "which today is two post-hoc detectors and, explicitly, **NOT the Bank co-signature, because nothing in this repository signs a redemption**." One of these two sentences is wrong. Given the tool exists, impossibility 2 is the wrong one — and it is the sentence the round-14 verdict claims was fixed to point at the table.

### R4-4. LOW — `detectNestedVaults`' "NOTHING DOES IT" is now half-false

The comment says a per-vault DAS owner search for foreign assets is done by nothing. The alarm still doesn't do it — but `cosign.mjs`'s `scanPda` does exactly that search, pre-signature, and SPEC says so ("caught by the co-signer but not by the alarm"). Qualify the comment to the alarm, or it is the deny-direction drift again.

### R4-5. LOW — `BURN_FIXED_ACCOUNTS`' comment claims an assertion that does not exist

"Asserted against the suite's own builder in 3.1c-3.1f." 3.1c–3.1f assert the **Rust** index constants (`BURN_IX_ASSET_IDX` etc.) read out of the source; nothing anywhere asserts the JS constant `11`, and the selftest's `mkBurn` matches it by construction, not by verification. Either assert it (read the Rust account-struct order the way 3.1c–3.1f read the indices) or delete the claim.

### R4-6. LOW — stale counts, again, now including the verdict

SPEC "Running the tests": "178 assertions", "(69 assertions)", "93 detector and 14 allocation" — all wrong against 267/275/17. Plus R3-5's 250. The class the round-14 verdict says it closed ("every floor equals its real count") is alive in three documents.

### R4-7. LOW — MINT's "strictly stronger" comment

Still present, still false (a PDA passed as a CPI signer satisfies `is_signer`). Carried, unfixed, confirmed.

---

## CARRY-OVER LIST — status

1. **Cross-pass correlation lag** — unchanged. The ack mechanism does not worsen it for `vault_burned` (an asset burns once), but see R3-1 for the recurring kinds.
2. **Compute units** — unchanged, and now doubly relevant: the junk-sweep scenario of R1-3 is CU-bound as well as byte-bound.
3. **`prog.*.hash` offset 45** — unchanged; still wrong for authority-less ProgramData; still applies to Core.
4. **Foreign nested asset invisible to the alarm** — the alarm gap is unchanged, but its *consequence* is now the R1-2 brick: the tool that sees foreign assets converts them from destroyed junk into a permanent seal. Materially worse in effect.
5. **`burn_via_program` caller-supplied key** — weaker than stated: a *successful* `burn_vault` is always one of our vaults (on-chain `ForeignVault`), so the correlation key cannot be pointed at an arbitrary asset by a successful call.
6. **SPEC contradictions/stale counts** — worse: R4-3's new self-contradiction plus R4-6.
7. **MINT dead stamp / "strictly stronger"** — unchanged (R4-7).
8. **Distribution ledger self-testimony; fresh operator wallet** — unchanged.
9. **Duplicate attribute keys; vote-during-proposal; reserve continuity** — unchanged, and R1-1 makes the first two more expensive: the Bank's mint duties were the stated control, and the new tool will co-sign their violation without looking.

---

## VERDICT CHALLENGES

**Admin exemption from `detectBankIsNotSignable` — I cannot break it.** Every admin instruction in all four programs (`update_config`, `update_wiring`, `set_paused`, `set_collection_royalties`, `cancel_pending_*`, `update_gov_config`) is a single top-level call whose only signer constraint is `Signer`/`has_one`; a Squads vault PDA satisfies both by CPI. `apply_pending_*` take no signer. The exemption stands. **But the detector is overbroad on `mint.bank`**: `mint_vault` is a single top-level instruction with no introspection, so a multisig `mint.bank` works on-chain, and `detectBankIsNotSignable` would fire CRITICAL on a legal configuration forever — the cry-wolf failure the file's own header warns about. The redemption-pairing rationale applies to `seal.bank` and `burn.bank` only.

**Closed-ATA delegate ALLOW (3.3a) — confirmed safe.** The delegated account no longer exists; a delegate dies with its account; a re-created ATA is fresh; the PDA cannot sign after the burn. No surviving authority.

**"Only two fit with destination-ATA creation" — the written requirement is necessary, not sufficient, and unenforced.** A client that ignores it fails loudly at 3 mints (serialization refuses; no funds move), so the direct risk is a broken client, not lost money. But the requirement addresses one byte source while the ceiling is a general budget: R1-3 shows ~one extra declared account consumes the entire remaining headroom. "Create destination ATAs in a prior transaction" should be one line of a written byte budget that the cosign tool actually checks (it could compute the serialized size itself and refuse within, say, 64 bytes of the limit).

**Are any of the seven fixes wrong?** #5 (comment repairs) is incomplete in a way that recreates the class in the deny-direction (R4-1/2/3) — the highest-value miss, since the round existed to close that class. #4 (acks) carries R3-1. #7 (ceiling harness) is correct as far as it measures but its interaction with the new co-signer is unexamined (R1-2/R1-3). #3 has R3-2. #1, #2, #6 are sound modulo R3-4/R3-5.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Fifteen rounds have converged on a pattern: the models find *logical* defects by reading, and the worst surviving defects are the ones reading cannot reach. Spend the next effort on machines, not prompts:

1. **Adversarial execution of the signer.** The suite tests the four programs; nothing tests the thing that signs for the Bank. Build a harness that composes hostile redemption transactions (R1-1's transfer, R1-2's nested asset, bundled mints), runs `cosign --live` against the validator with a funded Bank key, submits the output, and asserts what the Bank did and did not authorize. R1-1 and R1-2 are both two-minute tests that fifteen rounds of reading took one round to find.
2. **Property/fuzz testing of the judgements.** `judgeRedemptionTx` should be fuzzed with random instruction lists against one invariant: *nothing the tool signs may name the Bank as a signer outside the pair, and nothing may touch MINT.* The BURN_FIXED_ACCOUNTS constant should be derived from or asserted against the Rust source, not mirrored.
3. **Real concurrency and crash injection for the lock.** Spawn actual processes; heartbeat holders; kill -9 at syscall seams; assert "never two holders" over millions of iterations. The seam-injected single-process selftest structurally cannot produce R2-1's interleaving, and every round re-litigating a microsecond window is the signal that the primitive (a lock file) is wrong — build the OS lease.
4. **Pin and corpus-test the external readers.** Core's bytes are pinned; DAS's *behavior* is not, and two controls now rest on it. Record a corpus of DAS responses (full page, short page, `total` mismatch, empty-with-assets, lag) and test `scanPda` against it. Add the `total` check.
5. **Mechanize the comment audit.** `audit-coverage.sh` measures which *files* were seen; nothing measures which *claims* drifted. A linter that extracts control-claiming sentences (the "covered by", "must refuse", "nothing does it" patterns) and diffs them against SPEC's control table would have caught R4-1/2/3 automatically — that class has now survived seven rounds and appears twice in this diff alone, once in each direction.
6. **Make policy explicit before encoding it.** R1-2 happened because a tool silently reversed a measured, documented tradeoff (destroy-junk vs strand-vault). Every refusal in `cosign.mjs` should trace to a line in SPEC's control table with a both-directions assertion in the suite — the same discipline the on-chain programs already follow. A tool whose refusals have no written policy is a comment claiming a control, in executable form.