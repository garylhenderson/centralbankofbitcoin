# Round 16 audit — round 15/16 repairs

Evidence standard: for each claim I say what would be true on disk, in a shell, or in `node bank/selftest.mjs` if I am right.

---

## R1 — Co-signer refusals

### Arm 1 is complete for *Bank authority*. The four candidates are not theft paths.

| Candidate | Real? | Why |
|---|---|---|
| Address lookup tables | Not against this parser | `Transaction.from` rejects v0 (3.1i). Legacy messages list every key. |
| Duplicate account metas | No | Presence still sees the Bank. |
| Nested CPI | No | Runtime only forwards signers that appear on the parent instruction. Spending the Bank requires the Bank in that instruction’s account list. |
| Instructions-sysvar reader | No against this allowlist | A *custom* program could inspect the signer set; Token, System, Core, ATA and ComputeBudget do not spend the Bank unless the Bank is in *their* account list. Custom programs fail the allowlist. |

The fee-payer hole is real and is a separate arm. I cannot name a remaining way to *exercise the Bank’s authority* from an instruction that does not list the Bank, on a legacy transaction this parser will accept.

### The allowlist does not make confinement moot. The carried gaps are not worse than stated.

With System / Core / Token / Token22 / ATA / ComputeBudget, a customer can, in the same transaction:

- create + fund a PDA-owned token account (deterministic coverage defeat);
- sweep reserves to someone other than the owner;
- `CloseAccount` rent to an arbitrary destination;
- Core Transfer/Burn/Update on *other* assets they already own, including a bare `BurnV1` of another CBOB vault.

None of those spend the Bank. A bare `BurnV1` of vault B beside a real redemption of vault A does not need the Bank and is already possible without this tool (measured fact 1). `correlateBurns` is per-asset, so B stays CRITICAL.

In-transaction deposit is customer-signed destruction of *their* (or their counterparties’) tokens, not a Bank theft. A hostile frontend still needs the owner’s signature on the same message. Not worse than the author stated.

The line (confine the Bank, allowlist the programs a redemption actually uses, refuse to build a sweep grammar) is the right line for a signer whose job is “do not rob the Bank.” It is not a proof that the redemption is honest. The code already says that.

### 165-byte discriminator — right call, right test.

It is the same predicate `burn_vault` uses (`TOKEN_ACCOUNT_LEN == 165`). A TLV parser would be a new defect class. Visible block vs silent orphan is the correct trade *for a signer*. It is a griefing surface of the *tool*, not of the vault: on-chain, an undeclared T22 account still burns (9.9). Human escape is `--live` after inspect, or a raw sign. Do not “fix” this by ignoring non-165 accounts.

### DAS — one remaining fail-open, and the fix was applied to one of three sites.

`scanPda` now throws on `!r.ok`, `j.error`, and non-array `items`. Remaining hole in *this* function: Helius `getAssetsByOwner` returns `{ total, items }`. `{ result: { total: 7, items: [] } }` is a valid shape, `items` is an array, length `< 1000`, and the burn is blessed on “owns nothing.”

**Evidence if true:** a stubbed DAS 200 with `{"result":{"total":7,"items":[]}}` makes `inspect()` return `ok: true` with `owned: []`.

**Fix:** refuse unless `typeof result.total === 'number' && result.total === items.length` (and treat a missing `total` as unknown, not zero).

**MEDIUM — same repair, sibling sites still open.** `alarm.mjs` `listVaults` and `distribute.mjs` still do `j.result?.items || []` with no `r.ok` and no `Array.isArray`. Round 15’s own class, inside the repair. Mitigated: alarm’s mass-drop guard (`vault_index_shrank`, `trustCurrent: false`) and distribute’s `minted_total` equality throw. Not mitigated: first alarm pass / `--first-run` adopting an empty set as baseline; a 200 with a non-JSON body that `r.json()` does not throw on.

**Evidence:** `grep -n "items || \\[\\]" bank/alarm.mjs bank/distribute.mjs` still hits. A fixture 200 `{}` into `listVaults` returns `{ live: [], burnt: [], all: [] }`.

---

## R1 finding

### MEDIUM — durable-nonce arm is not in the judge and is not asserted

**Construct.** Verdict: four arms, “all asserted both ways.” Arms 1–3 live in `judgeRedemptionTx` and have both-way tests. Arm 4 lives only in `inspect()` in `cosign.mjs` (`ADVANCE_NONCE` prefix on any System ix). `bank/selftest.mjs` has no nonce case. A second caller of `judgeRedemptionTx` inherits no nonce rule.

**Gain.** The airdrop race with the clock removed — the thing the comment says this arm exists to stop — is back the moment anyone judges through the pure function, or the `inspect` loop is edited and the suite stays green.

**Evidence.** `grep -n 'nonce\\|ADVANCE_NONCE\\|advanceNonce' bank/selftest.mjs bank/detectors.mjs` — hits in detectors comments / cosign, none in selftest. `judgeRedemptionTx([advanceNonce, open, burn], CFG, curve).ok === true`.

**Fix.** Move the check into `judgeRedemptionTx`. Assert both ways (nonce+pair refused; pair alone accepted; a System ix whose data is *not* `[4,0,0,0]` accepted).

---

## R2 — Lock restore and `flock`

### Interleavings (2 / 3 / 4)

- **Two breakers, one stale dead lock.** `rename` of the same path: one winner, one `ENOENT`. True exclusion on the break. Holds.
- **Three: A holds a fresh lock; B steals a replacement; C `claim()`s the empty path.** `rename` back overwrites C’s file with A’s bytes (Linux `rename` replaces). A’s lock **file** survives. C **believes it holds** and is already inside `fn`. Both pay. Author’s header is accurate: this is a narrowing, not a close.
- **Four.** `link` on the hole is exclusive, so only one interloper enters. Same as three.

True holder’s *pathname* is now preserved unless `rename` back throws (then it throws — correct). Mutual exclusion is not.

### “No arrangement of rename/link/unlink is CAS” — true

Portable POSIX has no compare-and-swap on a path. `link` is create-if-absent. `rename` is replace. `renameat2(RENAME_EXCHANGE)` is a swap, still not “replace only if inode/token is X.” Every stale-break is check-then-act. A pure-filesystem close without `flock`/`fcntl` is not a finding because it does not exist.

### HIGH — `/var/lock/cbob` is on tmpfs; every money cron dies across reboot

**Construct.** `scripts/cron-install.sh` does `sudo install -d … /var/lock/cbob` once, then `flock -n $LOCKDIR/<job>.flock`. On systemd Ubuntu `/var/lock` → `/run/lock`, a tmpfs. After reboot the directory is gone. `flock` cannot create a file in a missing directory; it exits 1. The jobs do not run.

**Gain / accident.** After every reboot: no watcher, no daily payout, no revenue cycle, until a human re-runs `cron-install.sh` or `mkdir`. The deadman pages the *watcher* after two hours. Distribute and revenue have no equivalent. This is the “durable answer” for the lock, installed in the one directory that does not survive the event (reboot) that most often leaves stale in-process locks around.

**Evidence.** `readlink -f /var/lock` is `/run/lock`. `df -T /var/lock` is `tmpfs`. `sudo reboot` then `ls /var/lock/cbob` → missing; the next `flock -n /var/lock/cbob/distribute.flock echo ok` prints `No such file or directory` and exit 1. Cron log gets that line, no `node` output.

**Fix.** Lock dir under the tree (`/opt/cbob-vaults/bank/locks`) or a systemd-tmpfiles snippet, **and** `mkdir -p` on every cron line before `flock`. Do not use `/tmp`.

### HIGH — `judgeCronTemplate` does not gate `-n`; a wait-flock double-pays

**Construct.** The header: “`-n` and not a wait: two overlapping distribute runs must ABORT, never queue. A queued second run pays the same day twice.” The gate:

```javascript
if (!/\bflock\b|\$FLOCK\b/.test(line)) bad.push(line.trim())
```

`flock` without `-n` (or `$FLOCK` redefined as `/usr/bin/flock` with the `-n` line deleted) is quiet.

**Gain.** The exact double-pay this file exists to prevent, and the suite stays green. Same class as the litter ternary: a gate that cannot see the property.

**Evidence.** In the selftest:

```javascript
D.judgeCronTemplate('7 9 * * * cd $R && flock /var/lock/x /usr/bin/node bank/distribute.mjs')
// returns []  — should be length 1
```

**Fix.** Require `flock -n` or `$FLOCK` **and** assert the assignment `FLOCK="$FLOCK -n"` (or the expanded `/usr/bin/flock -n`) in the real file, both ways.

### `judgeCronTemplate` reads the template, not the installed crontab

Stated, true, acceptable **if** the in-process lock remains. It does. Not a new finding. Combined with the two HIGH items above, the “OS lease is installed where it matters” sentence is currently false in production after reboot and unenforced against the wait-vs-abort bug.

`cd $R && $FLOCK … node …` under cron `sh -c` is otherwise composed correctly: unquoted heredoc expands at install time; `/usr/bin/flock -n file cmd` does not go through `flock -c`; `-n` is non-blocking; a held lock is exit 1 with flock’s stderr in the job log (distinguishable from a node stack by text, not by exit code). If `/var/lock/cbob` exists but is not writable, same fail-stop as a missing dir.

---

## R3 — Ack allowlist

### MEDIUM — `nested_vault` is ackable; a live host is actionable

**Construct.** `ACKABLE_KINDS = {vault_owns_itself, nested_vault, unredeemable_owner}`. The comment says acks are for conditions unanswerable **by construction**. `vault_owns_itself` is. `nested_vault` is only unanswerable when the **host is already burnt**. A live host is “transfer the inner out, do not burn the host.” An operator can act. An ack silences paging for the exact CRITICAL that exists to stop a host redemption destroying the inner vault.

`unredeemable_owner` is mixed (marketplace escrow is recoverable). Leaving it ackable is defensible because the finding itself names both readings. `nested_vault` is not mixed in the detector: it names the host.

**Gain.** `acks.json` line `nested_vault:<inner>` → INFO forever. Host is later burned (especially while nothing is wired to the co-signer). Inner orphaned. The mute button the allowlist was written to remove, for the one nesting case that is still fixable.

**Evidence.** `applyAcks([{kind:'nested_vault', severity:'CRITICAL', asset: INNER, detail:'x'}], {[`nested_vault:${INNER}`]:'later'})[0].severity === 'INFO'`. Detector fires for live hosts (selftest already has that case).

**Fix.** Split kinds: `nested_in_burnt_host` (ackable) vs `nested_vault` (not). Or refuse acks on `nested_vault` unless the host is in the burnt set the same pass.

### Refused-ack flood

Needs write access to `acks.json`. Refused acks keep full severity; they add lines, they do not drop paging. Not a useful abuse path.

No missing kind that is unanswerable by construction. Do not add `vault_burned` / `vault_left_index`.

---

## R4 — Round 16’s own repairs

### `readProgramData` 13/45 — right. Option tag at byte 12 — right.

BPF upgradeable `ProgramData`: u32 disc (3) + u64 slot + `Option<Pubkey>` (u8 tag, then 32 bytes if `Some`). ELF at 45 if `Some`, 13 if `None`. Matches `size_of_programdata_metadata()`. Residual: no check that `data.length >= 45` when `hasAuth`; a truncated account throws in `PublicKey(subarray(13,45))` (loud) or hashes an empty ELF slice. Acceptable fail-closed. Not a finding.

### MEDIUM — `banks_disagree` lies when only `mint.bank` differs

**Construct.** `BANK_KEYS = ['seal.bank','mint.bank','burn.bank']`. Any two distinct values → CRITICAL, detail `REDEMPTION IS ALREADY HALTED`. On-chain `WiringDiverged` is SEAL’s bank vs BURN’s bank only. MINT disagreeing with a unanimous SEAL/BURN pair does **not** halt redemption. A legitimate staged mint-only rotation (or a mint apply that landed first) pages as “redemption is down.”

CRITICAL is right when SEAL ≠ BURN. It is the wrong sentence, and the wrong runbook, when only MINT differs. Staged SEAL-then-BURN *should* page CRITICAL. Adding the keys to `WATCH` is correct; see LOW below for the duplicate.

**Evidence.** `detectStandingRisks({ 'seal.bank': A, 'burn.bank': A, 'mint.bank': B })` emits `banks_disagree` whose detail includes `ALREADY HALTED`. `burn_vault` would not revert. Selftest never uses this triple.

**Fix.** If `seal.bank !== burn.bank` → CRITICAL, halted. If only `mint.bank` differs → HIGH, mint path / mint co-sign key, redemption not claimed down.

### `if (s.err) continue` reasoning — sound. The regex is not.

A successful `burn_vault` burned that asset: emptiness, Bank signer, collection check. A failed `burn_vault` beside a successful bare `BurnV1` is skipped before decode, so the caller-supplied key cannot launder. Inner CPI `burn_vault` fails `NoPrecedingOpen` unless a real top-level pair ran, in which case the asset *was* burned through the program.

A successful transaction cannot produce `burn_via_program` for an asset that did not go through `burn_vault`.

The assertion `/if \(s\.err\) continue/` matches **any** occurrence. Moving the guard off the signature loop, or leaving it in a comment, keeps the suite green.

**Evidence.** Insert `// if (s.err) continue` and delete the real line: `/if \(s\.err\) continue/.test(src)` is still true.

**Fix.** Assert against a slice of `main` that still contains both `for (const s of sigs)` and the guard, or parse the walk. LOW (process), not a live laundering hole.

### “Exactly one file reads the Bank key” — not a control

The assembled regex is `CBOB_BANK_KEY|keys/bank\.json`, only over `bank/*.mjs`. A reader in `scripts/`, a client, or `const f = 'bank.json'` without that substring does not trip it. It is a tripwire against a second *accidental* reader in `bank/`. It does not make the co-signer a control. See carry-over 1.

### MINT `is_signer` comment — now correct

`is_signer` is true for a PDA passed as a CPI signer. A Squads treasury can receive a vault that v5 can never redeem. Test 5.2 is a different property. Off-chain `unredeemable_owner` is the whole control. The corrected text matches the chain.

---

## R4 extra

### LOW — `seal.bank` / `mint.bank` / `burn.bank` are in `WATCH` twice

Explicit rows plus `...BANK_KEYS.map(...)`. `detectConfigDrift` emits two `config_drift` CRITICALs per key. `WATCHED_KEYS` is a `Set`, so the standing-key check stays quiet.

**Evidence.** `detectConfigDrift({'seal.bank':'A'},{'seal.bank':'B'}).filter(f => f.detail.startsWith('seal.bank')).length === 2`.

**Fix.** Drop the three explicit bank rows, keep `BANK_KEYS` as the single source.

---

## R5 — Comment drift (either direction)

| Location | Drift |
|---|---|
| `burn_vault` rustdoc (“must SCAN THE PDA BEFORE IT SIGNS”) | **Claims a control that does not run.** SPEC’s table says the tool is unwired. Same class, seventh+ round, in a function header the module header just stopped lying about. |
| `banks_disagree` detail | **Over-claims.** Redemption is halted only if SEAL ≠ BURN. |
| `cron-install.sh` / lock header | **Over-claims the durable answer** while the lease directory is tmpfs and `-n` is unasserted. |
| `inspect` nonce comment (“first instruction”) vs code (any System ix) | Code is stricter. Harmless. |
| MINT `ATTR_REDEMPTION` / “SEAL … rewrites it on every close” | **Claims a writer that v5 deleted.** Carry-over 6, still live. |
| SPEC revenue table: `sweep_sol_for_swap` “permissionless” | **Still false.** Operator must sign. Named last round, still not fixed. |
| SEAL / BURN module headers, SPEC impossibility 2 | Now point at the table. No new deny/claim there. |
| MINT owner comment | Matches execution. |

The `burn_vault` rustdoc is the one that will teach the next editor that the scan is part of signing.

---

## R6 — Gates

Already above: nonce arm unasserted; `judgeCronTemplate` ignores `-n`; `if (s.err) continue` is a bag-of-words match.

### MEDIUM — several new gates die if the regex stops matching for the wrong reason

| Gate | Failure mode |
|---|---|
| `3.1g` `BurnVault<'info> {…}` field count | If the struct grows a nested `{` or the first `\n}` is a comment/impl, count goes to 0 → `3.1h` fails (closed). If it over-matches and counts more `pub` lines, `3.1g` fails (closed). OK. |
| SPEC `# (\d+) assertions, real cloned Core` | Reword the heading → `NOT FOUND` → red. Closed. |
| Bank-key reader | Easy to bypass (see R4). Gives a green “exactly one reader” while a second signer exists. **Open.** |
| `judgeCronTemplate` `node\s+bank\/` | `node /opt/cbob-vaults/bank/distribute.mjs` is not a “job.” Hand-edited crontab is invisible. Stated, but it means the gate never sees the installed file. |

No second “ternary of the same string” in this diff. The flock `-n` miss is the new “structurally cannot fail on the property that matters.”

---

## Carry-over

1. **Nothing is wired to the co-signer.** Not worse as a theft path (the Bank key is still only in `cosign.mjs` if people obey the repo). **Worse as a process:** the new “exactly one reader” assertion will be cited as if it closed this. It did not. Smallest thing that would make it a control: the Bank key lives in a wrapper that *only* `cosign.mjs --live` can open (permissions + a one-line exec), and the published redemption client’s only sign path is that wrapper. A grep is not that.
2. **In-process three-way hole.** Confirmed: C pays beside A. `flock -n` was supposed to cover unattended runs; see R2 — after reboot it covers nothing. **Worse than stated** until the lock dir is persistent.
3. Cross-pass CRITICAL never retracted. Unchanged.
4. CU still unmeasured. A 3-mint redemption with Core Execute + closes may have a CU ceiling under 1.4M before it hits 1232 bytes. Still unknown. Not new.
5. Foreign nested Core. Unchanged. Co-signer DAS *can* see it if used; alarm cannot.
6–8. As stated. Dead Attributes authority and reserved `redemption` key are still in the mint path.

---

## Verdict challenges

**“Collection / owner not checked — signature on a revert is worthless.”** Hold. Solana has no account nonce; the message is fixed; the blockhash dies in ~60–90s; they refuse durable nonce. A Bank signature on `NotTheOwner` / `ForeignVault` cannot be replayed after a later transfer except inside that window, which is not a sale. No fee-payer spend. I cannot name a state where that signature is worth funds. Rejection stands.

**“Legacy-only is HIGH availability.”** Hold. Fail-closed is the correct direction for a signer. A fourth mint is forbidden by `MAX_RESERVE_MINTS` and 9.15/9.16 until someone measures a v0 path *and* teaches the judge to resolve (or refuse) ALTs. Rejection stands.

**“Declare-everything bricks a vault.”** Hold as a *vault* finding. It bricks the *tool*. The chain still burns (and orphans dust). Inspect-only default + human escape is coherent. It is a cheap DoS of automated co-sign, which is already unwired. Not a permanent brick. Rejection stands; do not “fix” it by signing through undeclared accounts.

**“Judge does not check owner/bank `isSigner`.”** Hold. Anchor `Signer` on both halves; the tx does not land without those signatures. The co-signer’s job is what the Bank’s signature *authorises*, not whether the owner remembered to sign.

**A round-15 fix that is wrong / incomplete — highest value this round:** the durable answer (`flock -n` in `cron-install.sh`) was installed on a tmpfs path and the assertion that was supposed to keep it from rotting does not check `-n`. That is a repair of the lock that fails the same way this project’s repairs keep failing: the property that matters is not the property the gate measures.

The DAS shape fix and the nonce arm repeat “one of N sites” / “comment names a test that does not exist” — the two classes round 15 said it was ending.

---

## Other (Cargo.toml / Anchor.toml, first time in a bundle)

`overflow-checks = true` is on `[profile.release]` only. `cargo-build-sbf` is a release build. The arithmetic argument rests on that profile; it is actually there. Not a finding.

`Anchor.toml` `[programs.mainnet]` lists **only** `cbob_vaults`. Mint/burn/gov are absent. Harmless if nobody runs `anchor deploy`. `[provider] cluster = "mainnet"` plus `anchor test` → ts-mocha against mainnet with `~/.config/solana/id.json` is an operator footgun. LOW, not in the money path they actually run.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Sixteen rounds keep finding the same two shapes: (1) a fix applied to one of N identical sites; (2) a comment or assertion that names a control the suite cannot fail. AI re-reading a diff is structurally bad at (1) unless the *sibling sites are in the prompt as a checklist*, and bad at (2) unless every new sentence that says “asserted” is mechanically bound to a test name.

Do these, none of which is in SPEC’s SHIP GATE:

1. **A sibling-site script, in CI, that fails the build.** For every repair that touches a pattern (`j.result?.items || []`, `readBigUInt64LE(64)`, `mode & 0o077`, `if (s.err) continue`, `flock`), `rg` the tree for the *old* pattern and require an allowlist file that names each remaining hit and why. Round 15’s DAS fix would have gone red on `alarm.mjs` and `distribute.mjs` before commit.

2. **Run the money crons once on a box that has just rebooted**, before any `cron-install.sh`, and assert they either create their lock dir or page immediately. No model will reliably remember that `/var/lock` is tmpfs. A reboot test would have.

3. **Stop treating `bank/selftest.mjs` FLOOR bumps as certification of new arms.** Require a named test id (`nonce.1`, `flock.n`) in a table in SPEC that the selftest prints and the runner greps. “Four arms, all asserted” would have been a missing id, not a paragraph.

4. **Put the Bank key behind an executable, not a comment.** Until `cosign.mjs` is the only inode that can open that file, R1 is literature. Sixteen rounds of “remember to use the tool” will not become a control.

5. **Measure compute units on the same 9.14 harness** that measures bytes. One `simulateTransaction` per N. An unmeasured ceiling under 1232 bytes is the kind of thing this process will keep carrying until a customer hits it on mainnet.

Do not add a seventeenth free-form round on a fresh repair of `cron-install.sh` without (1) and (2) already red-green on that repair.