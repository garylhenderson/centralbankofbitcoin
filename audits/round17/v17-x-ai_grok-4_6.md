# ROUND 17 AUDIT — repairs in `2f84b40..HEAD`

Evidence standard: every claim below names what would appear on a validator, in a selftest run, or in `git grep` if it is true. Claims that contradict a measured suite result are omitted.

---

## R1 — SEAL’s on-chain Bank confinement

### HIGH — Comments and SPEC understate a control that now runs
**Construct.** The walk in `open_for_redemption` starts at index 0, never breaks, and refuses `config.bank` in any top-level ix that is not SEAL/`open_for_redemption` or BURN/`burn_vault`. Tests 4.7 / 4.10 assert `BankKeyOutsidePair`. Known-limit 1a in this prompt even says the confinement was moved on-chain.

The same commit leaves the opposite sentence in three customer-facing places:

- SEAL crate header: *“this function does not bound what else is in the transaction. The forward scan below stops at the matching burn; it never enumerates the rest.”*
- `bank/cosign.mjs` header: *“Moving them on-chain is possible and is not done.”*
- SPEC control table + the paragraph *“THE TWO CHECKS THAT MATTER MOST ARE IN THE POLICY HALF”*: bank-pubkey confinement is still listed only under **PROCEDURE** `cosign.mjs`.

**Gain.** Same shape the owner caught last round, inverted onto the new control. A buyer (or the next model) reads that the Bank’s signature can still authorise a bolted-on `SystemProgram.transfer`. It cannot, unless the Bank is fee-payer or is named *inside* an exempt open/burn. The table is the one document SPEC says is allowed to describe what runs. It is wrong.

**Evidence if true.** `git grep -n "never enumerates the rest\|is not done\|POLICY HALF" programs/cbob-vaults/src/lib.rs bank/cosign.mjs SPEC.md`. Suite 4.7 already rejects the theft on-chain. The table parser will stay green because it only checks that the *named programs* contain `bank: Signer` + `require_keys_eq!`, not that the table’s *prose* matches the new walk.

**Fix.** Split the table: confinement = **ON-CHAIN** (SEAL); allowlist + fee-payer = **PROCEDURE**. Delete the three stale sentences. Point them at the table.

### LOW — Exemption is not a theft path; the stated gaps are real
The check is `program_id` + first 8 bytes only. A forged open/burn sent to the real program is dispatched to the real handler. If it fails, the tx fails; if it succeeds, it *is* a redemption half and is supposed to name the Bank. Inner CPIs cannot conjure the Bank as a signer unless an outer ix lists it — and a non-exempt outer that lists the Bank is refused.

**Fee-payer gap (concrete tx).**  
`feePayer = config.bank`, `SetComputeUnitPrice` large, then a legal `[open, sweep, burn]`. No instruction account list contains the Bank; the sysvar cannot see the debit. Bank SOL is burned as fees. `judgeRedemptionTx` refuses this; the program does not. Author’s reasoning is correct.

**Allowlist gap (concrete tx).**  
`[open, Core BurnV1 of a second vault, sweep, burn]` — known limit 4. Confinement does not fire (Bank not in the Core ix). An on-chain allowlist that still permitted System (rent + SOL sweep) would not have stopped the round-15 theft either. Author’s reasoning is correct.

**BURN-needs-no-copy.** True *of these binaries*. `burn_vault` requires a preceding top-level open for the same asset and owner (3.8, 9.0). Every burn that can commit sat in a tx where this walk already ran. A transaction that contains a burn whose confinement was never checked would require a succeeding `burn_vault` with no succeeding `open_for_redemption` in the same top-level list — the suite says that tx does not exist. The claim dies the moment 3.8/9.0 die, or the moment SEAL is deployed without this walk and BURN is deployed with it (separate upgrade authorities). That dependency is not asserted as a *pair of binaries*; only as two source tests.

**Old invariant.** `found` still requires `i > current`. Burn-before-open: 3.8 / NoTerminalBurn. Two redemptions: 4.9. Open-by-CPI: `current` is the outer index; the wrapper must list the Bank to pass it in, is not exempt, and is now refused. Stronger than before, not weaker.

**CU.** Packet is still 1232 bytes, so the walk cannot see an unbounded ix list on a legacy redemption. The unmeasured ceiling is Core Execute + token CPIs, as before. Worse only in that every ix is now deserialized; still unmeasured (limit 12). Not a new theft.

---

## R2 — Weighted distribution

### HIGH — Fail-closed on unlevelled + no writer + third-party activation is a halt switch
**Construct.** `allocateWeighted` refuses the *entire* drop if any activated vault has no `LEVEL_WEIGHTS[levels[v]]`. `loadLevels` refuses a missing/bad file. Nothing in this repository *writes* `levels.json`. Activation is `balance >= 21_000` on a DAS-listed vault; anyone can transfer cbBTC into a vault ATA.

**Gain.** After every `mint_vault`, there is a window (or a permanent hole) where the asset is live, not in the register, and 21_000 sats from anyone — the owner, a buyer, a griefer — stops **every** holder’s payout until a human edits a JSON file. Spite: a holder omitted from the file deposits 21k and halts the product. Accident: 190 charter vaults, one forgotten line, nobody is paid. Fail-closed is the right *integrity* call. Combined with “no assignment path” it is an availability bug sitting on the money cron.

**Evidence if true.** `grep -n "levels\[" bank/` — readers only. Mint a vault, do not edit `levels.json`, send 21_000 sats to its cbBTC ATA, run `allocateWeighted` / `distribute.mjs --dry-run`. `skip` names that asset; cron 09:07 pays nobody. `detectDistribution` will then HIGH `distribution_missed` / `nothingToDo` depending on how the skip is recorded — it will not pay.

**Fix.** Assignment must exist before the vault can activate: write the level in the same ops step as mint (or refuse mint without a commitment), or treat “live & unlevelled” as a per-vault skip + alarm, not a global abort, *after* a commitment scheme exists so a skip cannot be used to silence a holder.

### MEDIUM — `holdDays` does not measure a payout
**Construct.** Comment and test say “last day that actually PAID somebody.” Code:

```js
Object.keys(st.days[d]?.paid || {}).length > 0
```

Any key counts: `skipped`, `rejected`, `sig: null`, a mid-run burned vault. A day that wrote a plan, failed every send, or only recorded skips resets the 31-day force clock.

**Gain.** Holders can wait another full month after a day in which nobody received cbBTC. Inverse of the comment. Forced dust payouts (`smallestPer = 1`, day 31) become avoidable by a failed run.

**Evidence if true.** The existing selftest uses `paid: { x: 1 }`. Add:

```js
holdDays({ days: { '2026-08-01': { paid: { v: { sig: null, skipped: 'burned' } } } } }, '2026-08-08')
```

Want: 7 only if you treat skip as unpaid; current code returns 7 from a “paid” day that paid nothing. Then a 31-day gap after only-rejected days never sets `forced: true`.

**Fix.** Count a day only when some row has `paymentState(row) === 'paid'` (a signature).

### MEDIUM — Resume + shrunken pool pays in pubkey order until dry
**Construct.** Cadence and allocation are skipped on resume. The plan’s per-vault amounts are replayed against whatever the distributor ATA now holds. If the pool shrank (external drain, wrong token account, a transfer that landed after a crash but was not the planned one), `createTransferCheckedInstruction` fails `insufficient funds` for later vaults; earlier vaults (`.sort()` of addresses) already got the *old* full share.

**Gain.** Not equal-by-level. Deterministic winner = low pubkey. Author skipped cadence on resume to avoid “paying half then changing its mind.” That does not address a smaller pool.

**Evidence if true.** Write a plan for 1000 sats, pay one vault, drain the ATA to below the next `per[v]`, resume. Ledger: first vault `sig` set, later `rejected: true`. `plan.total` on resume is also missing (`?? ''` in the log) — cosmetic, same path.

**Fix.** On resume, if `available < remaining planned total`, abort and page; do not send a prefix of the plan.

### Dust / over-distribution / `smallest` / deleted `allocate()`
`floor(available * w_i / den)` summed is ≤ `available` (JS BigInt). `smallest` after the empty-activated return is well-defined. Dust ≤ `den - 1` per successful drop; it does not run away. A changing activated set can make a holder worse off than largest-remainder would have — that is the ruling, not a bug.

`denominator()` returns a Number; `BigInt(den)` is safe while `max_supply = 2100` (`den ≤ 12600`). Not a bug today.

`allocate()` callers in the shipped tree were retargeted. Leftover *prose* still describes it — see R5. `cron-install.sh`’s “WHAT EACH LINE IS FOR” still says “equal per vault.”

### Level register blast radius — slightly worse than written
Same uid as `distributor.json` can already steal the pool. Worse: `loadLevels` does **not** check file mode (the three key readers do). A world-writable `levels.json` lets any local user retarget emissions without the key. Census printed at settlement will *agree* with the forged weights, so holders cannot detect it from the log.

**Evidence.** `stat` the file on the box; there is no `mode & 0o077` check in `loadLevels`.

---

## R3 — `scripts/bank-sign.sh`

No CRITICAL/HIGH.

- Arguments: one or two; second must be `--live`; first cannot start `--`. No `"$@"`. Selftest regex pins the `exec` line.
- Read-before-`cd` is real and tested both ways.
- `[ -f "$SRC" ]` rejects FIFOs, devices, directories. `cat --` is used.
- Base64: strip space, then `*[!A-Za-z0-9+/=]*` refuse. That *does* close the `Buffer.from(..., 'base64')` silent-ignore hole. Remaining Node leniency (padding) decodes the exact alphabet the operator supplied after whitespace strip — not a different paste.
- `exec` replaces the process; cosign’s 0/1/2/3/4/5/9 are not swallowed. `set -e` on `cat` failure exits with `cat`’s code (not 2) — LOW.
- `$0` under a symlink outside `scripts/` : `cd "$(dirname "$0")/.."` leaves the repo; `node bank/cosign.mjs` is the wrong file or a missing file. LOW. Do not install this via a symlink in `/usr/local/bin`.
- TOCTOU on a path in `/tmp` the operator does not control: LOW, same as any `cat` wrapper.
- ARG_MAX vs ~1.6k base64: not an issue.

Not a control. The header says so. Correct.

---

## R4 — Gates written this round

### MEDIUM — Signer set is blind to `Keypair.fromSeed` (and anything not `fromSecretKey`)
**Construct.** C2 greps `fromSecretKey` (assembled). `Keypair.fromSeed(bytes)` is a signer. A fourth money signer, or `cosign.mjs` growing a second path, is invisible if it uses `fromSeed` / raw ed25519.

**Evidence if true.** Plant `bank/impostor.mjs` with `Keypair.fromSeed(...)` and no `fromSecretKey`. `signerSet` stays the three expected rows. C1 stays green unless the Bank path string is also present.

**Fix.** Pin every `Keypair.from*` / `ed25519` secret constructor, or require every signer file to appear in an allowlist of paths (not a regex on one method name).

### MEDIUM — ON-CHAIN pin is source text; MINT would pass
**Construct.** `onChainBankPin` is two regexes. `programs/cbob-vault-mint/src/lib.rs` has both `pub bank: Signer<'info>` and `require_keys_eq!(ctx.accounts.bank.key(),` — on **mint**, not redemption. A table row that named MINT as the redemption 2-of-2 would print `claims ON-CHAIN, source says ON-CHAIN`. Comments containing those two strings would also pass. GOV is the only negative they simulate.

**Evidence if true.** In a scratch REPL, run `onChainBankPin('programs/cbob-vault-mint/src/lib.rs')` — expect `true`. That is not a redemption multi-sig.

**Fix.** Require the pin *inside* `open_for_redemption` / `burn_vault` (or assert the instruction name appears within N lines). Do not treat MINT as evidence of the product 2-of-2.

### LOW — Parser fail-closed in the directions they tested; still fooled by unclassified rows
Unnamed PROCEDURE → `NO FILE NAMED` → red. ON-CHAIN with no program → red. A fifth row that does **not** match `**ON-CHAIN|AUTOMATIC|PROCEDURE.**` is invisible; count is hardcoded to 4, so they will notice only if they also add a classified row. Fail-open for “forgot the fourth column entirely on a new row.”

Search is non-recursive (`readdirSync` of three dirs). `scripts/foo/sign.sh` would not exist today and would not be seen.

Self-match arm: defeatable by not spelling the four literals; that is the point of the arm (keep *this* file from tripping C1/C2). It does not make C2 complete (see `fromSeed`).

### `payer: aliceU`
Correct fix. umi’s identity is the Bank; ExecuteV1 is **not** exempt; naming the Bank there is now `BankKeyOutsidePair`. Production: the customer pays for Execute. The old suite tested a shape the new check (and `judgeRedemptionTx`) refuse. Failure mode of getting this wrong in prod is a clean refuse, not a stranded vault — as the comment says.

### 4.7–4.10a at the end
Coupling is real: `minted_total` is monotonic; quorum uses `max(snapshot, minted_now)`. Redeeming does not decrement. Any `mkVault` before section 7 still breaks 7.13-class asserts. Nothing after 7 reads `minted_total`. Understood for *this* file; the next person who inserts a mint in section 5 will not see a comment there, only in 9c.

---

## R5 — Comments, both directions

| Location | Direction | What’s wrong |
|---|---|---|
| SEAL `//!` header (the bullet they “corrected”) | **Under-claim** | Says the scan stops at the burn and does not bound the rest. The new walk bounds the Bank key over the whole tx. |
| `bank/cosign.mjs` header | **Under-claim** | “Moving them on-chain is not done.” Confinement is done. |
| SPEC control table + “POLICY HALF” paragraph | **Under-claim** | Same defect the owner just caught, now about the *new* guarantee. Confinement is ON-CHAIN; table says PROCEDURE. |
| `holdDays` doc + selftest name | **Over-claim** | “Actually paid somebody.” Code: any key in `paid`. |
| `bank/distribute.mjs` **file header** | **Over-claim / stale product** | Still: *“Equal per activated vault, because one vault is one unit and one vote.”* The allocator that sentence describes was deleted in this diff. |
| `scripts/cron-install.sh` “WHAT EACH LINE IS FOR” | **Stale** | “equal per vault.” Cron still runs the weighted job. |
| New SEAL function comments + C5 comments | Honest about fee-payer, allowlist, BURN dependency | Keep; they match the code. |
| `cosign.mjs` “SIGNATURE IS MANDATORY / POLICY IS SKIPPABLE” | Correct after the owner’s catch | Do not weaken. |
| `allocate()` deletion comment | Accurate | Two allocators would have been a live hazard. |

The gates only fail a claim that is **too strong**. Every under-claim in this table is invisible to them. That is the instrumentation hole the owner named.

---

## R6 — Card arithmetic (independent)

Weights 2/3/4/5/6.

| | census | den |
|---|---|---|
| 240 | 108+60+36+24+12 = 240 | 216+180+144+120+72 = **732** |
| 2100 | 945+525+315+210+105 = 2100 | 1890+1575+1260+1050+630 = **6405** |

V/I = 6/2 = 3.

Per $1,000 @ 240: 2000/732=2.732…, 4.098…, 5.464…, 6.830…, 8.196… → 2.73 / 4.10 / 5.46 / 6.83 / 8.20.

Per $1,000 @ 2100: 2000/6405=0.312… → 0.31 / 0.47 / 0.62 / 0.78 / 0.94.

Shares @ 2100: 189000/6405=29.508…, 24.590…, 19.672…, 16.393…, 9.836… → 29.5 / 24.6 / 19.7 / 16.4 / 9.8. Sum of those one-decimal figures is 100.0; unrounded sum is exactly 100.

Card is not wrong. Do not change a weight without changing the card in the same commit (the selftest already fails that way).

---

## Carry-over — worse than written, or exploitable

**1a.** Worse in the documentation, better on-chain. Confinement *is* on-chain; SPEC still says it is not. Fee-payer + allowlist remain skippable. The fee-payer tx above is the exploit for the remaining gap.

**3.** Still true for `payer` on **open/burn** (exempt). No longer true for ExecuteV1: Bank as Core payer is now refused. Limit 3 should say “inside the two exempt instructions,” not “inside the pair” if a reader thinks the pair includes sweeps.

**12.** Slightly worse (full walk). Bounded by packet size. Still unmeasured.

**16.** Worse in combination with R2’s fail-closed halt: not only unverifiable, but a missing row stops *all* money. No writer exists.

**17.** Still provisional. Forced monthly path will send 1 sat if you never ratify and volume is dead — `decideEmission` allows `smallestPer >= 1` at day 31.

Do not treat absence of VRF / $CBOB ladder / FOMC gate as a bug. The code does not assume them. `levels.json` being hand-edited *does* assume a human process that is not in the tree.

---

## Verdict challenges (round 16 write-up)

Not re-litigating `link()`-as-CAS or the ELF offset: both were measured. The pattern that write-up named — *a theorem in a comment is a claim* — is exactly what this commit shipped again, in the opposite direction, about the confinement it just built. The ELF lesson (*measure a carry before you fix it*) was not applied to the SPEC sentences that still describe the pre-confinement world.

Rejected CPI-unlisted-signer / ComputeBudget-drain-via-Bank remain rejected: runtime account-passing rules, and fees come from the fee-payer arm.

---

## Other

`Cargo.toml` `[profile.release] overflow-checks = true` is what `cargo-build-sbf` ships. Fact 6 is real for the deployed profile. `Anchor.toml` lists only `cbob_vaults` under `[programs.mainnet]`; the other three IDs live only in source. Harmless if they never `anchor deploy` from that file; a landmine if someone does.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Do not add another comment-vs-source regex. Eight rounds trained that machine to catch *over*-claims. This round’s worst live defect is an *under*-claim of a control that holds real Bitcoin, plus a halt switch on the payout cron. Sixteen models will keep missing that class.

Concrete work this process cannot substitute for:

1. **One measured CU number for the real worst-case redemption** (3-mint, lamport sweep, ATA already exists) on the same validator the suite uses. Write it next to 9.14a. If it is close to 1.4M, the byte ceiling is the wrong ceiling. No model can invent that number honestly.

2. **A levels commitment that a holder can check without trusting the box**, or do not ship weighted payouts. Until then, treat `levels.json` like a signing key: mode `0600`, asserted, and a writer that cannot forget a minted asset. Run the experiment: mint, do not edit the file, deposit 21k, watch 09:07 skip the world.

3. **Prove the Bank key has one home**, on the machine, not in git. The one-reader gate cannot see `solana-keygen`, a hardware wallet, a copied `bank.json` in `/root`, or `fromSeed`. Custody is the only half of “2-of-2” that is not in this repo; write an ops checklist that is executed, not an assertion that greps for `fromSecretKey`.

4. **Fix the table, then freeze.** The SHIP GATE already says two clean rounds against a frozen tree. Do not start those rounds while SPEC still describes the pre-confinement program. The next roster will either “find” a theft that 4.7 already rejects, or miss that the table under-sells the product — both have happened.

5. **Run `bank-sign.sh` from a foreign cwd, via a symlink, on a FIFO, and on a file that changes between `-f` and `cat`.** The read-before-`cd` bug was found by running it. The gates still only read text. One hour on the box is worth more than another prompt.