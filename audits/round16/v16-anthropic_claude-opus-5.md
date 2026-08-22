# INDEPENDENT AUDIT — ROUND 16 TARGETS

Ordering as requested: R1–R6, carry‑over, verdict challenges, then other. For each finding I state the exact construct, the gain, **the evidence that would exist if I am right** (so you can check me cheaply), and a fix.

I have tried hard not to spend your time on wrong CRITICALs. Where I am uncertain I say so and downgrade. Two of my findings say a round‑15/16 *repair* is built on a false premise; those are the ones to check first.

---

# R1 — THE CO‑SIGNER'S NEW REFUSALS

## R1‑1 (MEDIUM–HIGH) `judgeRedemptionCoverage` refuses the *correct* remedy for every griefed vault, and there is no override

**Construct.** `judgeRedemptionCoverage(owned, declared)` compares a **pre‑transaction state scan** against the burn's `remaining_accounts`. It never looks at the sweep instructions. Combined with `classifyPdaTokenAccount`'s unconditional `undeclarable` refusal:

```js
if (h.undeclarable) { bad.push(...); continue }   // refused whether declared or not
if (seen.has(h.address)) continue
bad.push(`... is owned by this vault and is NOT declared ... would be DESTROYED`)
```

**What this means in practice.** Somebody creates a Token‑2022 ATA (170 bytes, `ImmutableOwner`) for a vault's asset‑signer PDA for ~0.002 SOL. The *correct* redemption is: `open` → ExecuteV1 containing `CloseAccount(t22ata, owner, pda)` (and the reserve sweeps and the lamport sweep) → `burn_vault`. That transaction is completely safe: at burn time the account no longer exists, BURN's second loop skips it (`lamports()==0`), nothing is orphaned. **The co‑signer refuses it anyway**, because the scan saw the account before the transaction ran. The same is true of a *classic* undeclared airdrop that the redemption sweeps **and closes** — `owned` still shows it funded, `declared` may omit it, `seen.has` is false, "would be DESTROYED" fires on an account the transaction destroys correctly and deliberately.

For the classic case there is an escape (sweep+close inside Execute **and** declare the now‑closed address: `lamports()==0 → continue` on chain, `seen.has` → pass off chain). For the **Token‑2022 case there is no escape through the tool at all** — `undeclarable` short‑circuits before `seen.has`, so declaring it does not help and closing it does not help.

`cosign.mjs` has **no `--force` / `--i-have-looked`**. `main()` does `process.exit(1)` on a coverage refusal. So the documented "escape is a human who has looked" is, operationally, *sign it with some other tool* — i.e. exactly the bypass carry‑over 1 describes. **The griefing surface does not merely block a redemption; it manufactures the bypass of the control.**

**Evidence if I am right.** Build the transaction above on the validator: create a T22 ATA for a vault PDA, then run a redemption that closes it inside ExecuteV1. The transaction **lands** on chain (assert ALLOW). Then feed the same serialized transaction to `inspect()` — it returns `stage:'coverage'`, `ok:false`. A test that does both is ~30 lines and belongs in the suite.

**Fix (both halves).**
1. Credit the transaction: build the set of accounts the transaction *closes or empties* by decoding the ExecuteV1 inner instructions (Token `CloseAccount`=9, `Transfer`=3/`TransferChecked`=12 to the owner, Core `TransferV1`), and treat those as covered. That is a small grammar, but it is the grammar you already need.
2. Failing that, add an explicit, logged override: `--i-have-looked "<reason>"` that prints the full `owned` list and the reason into a file the alarm reads, so a bypass is *recorded* rather than invisible. Refusing with no override is not "fail closed"; it is "fail elsewhere".

## R1‑2 (MEDIUM) The program allowlist lets the Bank co‑sign a **bare Core `BurnV1`** of another vault

**Construct.** `ALLOWED_PROGRAMS` includes `D.CORE_ID` for any instruction that does not name the Bank. Nothing constrains *which asset* a Core instruction touches or *which opcode* it is.

**Gain.** In one transaction: `[open(A), sweeps(A), Core BurnV1(B), burn_vault(A)]`. The Bank's signature goes on a message containing a bare `BurnV1` of vault B — the single attack SPEC calls the one thing the programs structurally cannot prevent, and the thing the alarm exists to shout about. Also permitted: `Core TransferV1(C → OUTER's asset‑signer PDA)` (nesting, destroying C in the same or a later burn), `RemovePluginV1`, `ApprovePluginAuthorityV1` on other assets.

Yes, all of it is the owner harming their own property, and yes `detectBurns`/`correlateBurns` will still report B's bare burn at CRITICAL (the correlation is per‑asset — I checked). But the Bank putting its name on a bare burn is a reputational and evidentiary problem you have written three paragraphs about elsewhere, and the fix is three lines.

**Evidence if I am right.** `judgeRedemptionTx([mkOpen(), {programId: CORE_ID, data:[12,0], accounts:['OtherAsset', ...]}, mkBurn()], CFG, curve).ok === true` today.

**Fix.** For `programId === CORE_ID`: require `ix.accounts[0] === shape.asset` (Core puts the asset first in ExecuteV1/UpdatePluginV1/BurnV1/TransferV1), and refuse `data[0] === 12` (BurnV1) outright — a redemption never calls Core's burn directly. Add both directions to the selftest.

## R1‑3 (MEDIUM) The DAS "owns nothing" guard assumes the provider honours `limit`

**Construct.**
```js
params: { ownerAddress: ..., page: 1, limit: 1000 }
...
if (items.length >= 1000) throw new Error('DAS returned a full page ...')
```

`1000` is hard‑coded twice: once as the request, once as the truncation test. Providers clamp. If the endpoint (or a future plan tier, or a proxy) clamps `limit` to 100, a PDA holding 400 Core assets returns 100 items, the guard does not fire, and 300 nested assets are read as absent. The response also carries `result.total` and `result.limit` in the DAS spec and both are ignored.

**Evidence if I am right.** `POST getAssetsByOwner {limit: 1000}` against your Helius endpoint and read `result.limit` in the reply. If it comes back as anything other than 1000 for a large owner, the guard is already dead. (I expect Helius honours 1000 today — that is exactly why this is a latent trap rather than a live bug.)

**Fix.** `const LIMIT = 1000` used in both places; then `if (items.length >= LIMIT) throw`; **and** `if (j.result.total !== undefined && Number(j.result.total) > items.length) throw`; **and** `if (j.result.limit !== undefined && Number(j.result.limit) !== LIMIT) throw` — a provider that silently gave you a smaller page is a provider you cannot judge on.

Also: the `fetch` has no `AbortSignal.timeout`. A hung indexer hangs the co‑signer indefinitely (availability only, but it is the same one‑line fix as everywhere else in this repo).

## R1‑4 (LOW) Arm 1 is complete against direct debits — but the pair itself is unchecked, including the `payer` slot

I take the four bypass routes the brief names seriously and report honestly:

* **Address lookup tables — not real for this tool.** `Transaction.from` rejects v0 (asserted, 3.1i). If it ever did not, this would be a CRITICAL, because the ALT‑resolved account list is not in the bytes. The assertion is the right control.
* **Duplicate account metas — not real.** Duplicates collapse to the same base58 string in `ix.keys`; `includes` finds any of them.
* **Nested CPI — not real.** A CPI can only pass account infos the caller received. An instruction that does not list the Bank cannot hand the Bank to a callee. This is a runtime invariant, not a convention.
* **A program reading the signer set from the instructions sysvar — not real for theft.** Such a program can *learn* the Bank signed (it is `is_signer` in instructions 0 and N), but knowledge is not authority: to debit the Bank the account must be in that instruction's own list. Arm 1 therefore does close the theft class.

**What is genuinely unchecked** is *inside* the pair. The judge validates index 0 (asset), 2 (owner) and 3 (bank), and nothing else. So a customer may name the Bank as **`payer`** — `open_for_redemption.accounts[4]` and `burn_vault.accounts[5]`, both `mut` + `Signer`, both handed to Metaplex Core as a writable signer. Today the flows are neutral‑to‑favourable (Core's `BurnV1` credits the asset's rent to the payer; toggling a bool in `UpdatePluginV1` grows nothing). But it is an unconstrained writable‑signer slot for the Bank passed into **the one program you do not control**, and `prog.core.hash` detects a Core change only after the fact.

The comment overstates this: *"confining the pubkey to the two approved instructions makes it impossible for any other instruction to spend it, delegate it, reassign it or close it."* True of *other* instructions; the pair can still spend it as rent.

**Fix.** Two lines: `if (open.accounts?.[4] === cfg.bank || burn.accounts?.[5] === cfg.bank) bad.push('the BANK is the payer of the pair — it would fund Core's rent')`. Assert both ways.

## R1‑5 (MEDIUM) `classifyPdaTokenAccount`: 165 is the right *discriminator*, the *unconditional* refusal is not

165 is correct and measured (F4.1/F4.3): classic base is 165, every T22 ATA is ≥170 because of `ImmutableOwner`, and reserve mints can never have a T22 derivation (F4.2 REJECT). So "not 165 ⇒ may hold value you cannot read" is sound.

Two things are wrong around it:

1. The `dataLen < 165` case is **dead in production** — `scanPda` throws first. Harmless, but a reader will believe it is live.
2. The refusal is unconditional, which is R1‑1. A T22 account that the transaction **closes** is refused; a T22 account that is *provably* empty by TLV parse is refused. You reject TLV parsing as "a new parser and a new place for a defect" — fair — but you then have to accept the override in R1‑1, or the choice is not "visible block vs invisible loss", it is "visible block vs no redemption".

---

# R2 — THE LOCK, AND THE `flock` THAT IS NOW LOAD‑BEARING

## R2‑1 (HIGH) `/var/lock` is tmpfs on Ubuntu. After every reboot, **all four money jobs stop**

**Construct.** `cron-install.sh`:
```sh
LOCKDIR=/var/lock/cbob
sudo install -d -o ubuntu -g ubuntu -m 750 "$LOCKDIR"
...
23,53 * * * * cd $R && $FLOCK $LOCKDIR/alarm.flock /usr/bin/node bank/alarm.mjs >> ...
```

On Ubuntu (and every systemd distro) `/var/lock` is a **symlink to `/run/lock`, a tmpfs**. It is recreated empty at boot; `/run/lock/cbob` does not survive. `flock -n /run/lock/cbob/alarm.flock cmd` then fails with `flock: cannot open lock file ...: No such file or directory` and **exits 1 without running the command**.

So after the first reboot: the watcher stops, the reconcile stops, the distribution stops, the revenue cycle stops. Nothing in the crontab recreates the directory. The comment in the file even explains why it is *not* in `$LOGDIR` ("logrotate acts on that directory") — the right instinct, the wrong destination.

The blast radius is partly contained: the deadman (`find $ALARM_STATE -mmin +120`) fires an SMS because the watcher's state file goes stale. But the SMS says *"the watcher is not running, or its baseline has been deleted"* — it does not say "and so are the payouts", and `bank/distribute.mjs` and `bank/revenue.mjs` have **no deadman of their own**.

**Evidence if I am right.** `ls -ld /var/lock` on the box shows `lrwxrwxrwx ... /var/lock -> /run/lock`; `findmnt /run/lock` shows tmpfs. Reboot and `ls /var/lock/cbob` → no such directory. Then run one cron line by hand and read exit status 1 with an empty log.

**Fix.** Put the lock directory somewhere persistent and owned by the job (`/opt/cbob-vaults/bank/locks`, mode 700), **or** create it at run time in the cron line: `mkdir -p $LOCKDIR && $FLOCK ...`. Add a `systemd-tmpfiles` drop‑in only if you insist on `/run/lock`. And extend the deadman to distribute and revenue: a per‑job heartbeat file plus a `find -mmin` check, because the money jobs are exactly the ones with no watcher.

## R2‑2 (HIGH) "No arrangement of `rename`, `link` and `unlink` is a compare‑and‑swap" is **false**, and that claim is load‑bearing

This is the claim the brief invites me to break, and it breaks. `link()` (and `mkdir()`) **is** a compare‑and‑swap: CAS(absent → mine), atomic, kernel‑enforced, and you already rely on it in `claim()`. What you do not have is CAS(theirs → mine) — and you do not need it. You need to **stop deleting the contended name**. The hole exists only because the break removes the pathname and then tries to put it back.

**A pure‑filesystem exclusion algorithm with stale‑breaking, no native module:** generation‑numbered locks.

* Lock state is the set of files `L.0, L.1, L.2, …` in a directory. The **holder is the record in the highest‑numbered file**.
* `acquire()`:
  1. `readdir`, find the max generation `G` and read its record `H`. If none, `link(tmp, L.0)`; success ⇒ held.
  2. If `H` is unreadable, or fresh, or its pid is alive with a matching `/proc` start time ⇒ **refuse** (unchanged policy).
  3. If `H` is stale **and** gone ⇒ `link(tmp, L.(G+1))`. **Exactly one racer can win this link.** Losers get `EEXIST`, re‑read, see a record that is not theirs, and refuse.
  4. The winner then unlinks `L.G … L.0` (garbage below its own generation).
* `release()`: unlink `L.<mine>` only if it still carries your token.

**Why this closes the hole the current code cannot.** The pathname a live holder occupies is *never* removed by a racer — a breaker creates a **new** name and only ever deletes generations strictly below its own. There is no interval in which "the lock" is absent, so there is no hole for a third runner's ordinary `claim()` to land in, and the "restore" branch — the source of every failure in rounds 12, 14 and 15 — ceases to exist. Two‑, three‑ and four‑racer interleavings all reduce to "one `link` winner per generation", which is the same primitive `claim()` already trusts.

Cost: `readdir` instead of one `read`, and generation numbers that reset to 0 on a clean release. That is it.

**Evidence if I am right.** Re‑run the round‑15 `_beforeSteal`/`_afterUnlink` seam scenario against the generation scheme: the interloper's `acquireLock` returns `ok:false` (it cannot `link` `L.(G+1)`, it already exists), instead of today's phantom hold. Today, replace the test's raw `writeFileSync(..., {flag:'wx'})` interloper with a real `LK.acquireLock(L, {alive: dead})` and assert `.ok` — **it will be `true`**, which is the double‑payment the file exists to prevent, and no current assertion states it.

**Why this matters more than a lock:** the impossibility claim is the justification for leaving the in‑process hole open and for making `flock` in cron the only real answer — and `flock` in cron is broken by R2‑1. Two mitigations, both defective, resting on a false theorem.

## R2‑3 (MEDIUM) The new restore can **leak** a lock for `staleMs`

Interleaving: A holds and is paying. B steals (rename → `stolen`), then A finishes and calls `releaseLock` — the pathname is empty, so `releaseLock` now returns **false** (correct, per the round‑15 fix) and A only prints a warning. B then renames A's record back. Result: a lock file carrying a dead run's token sits at the pathname. Nothing will remove it until `staleMs` elapses — **6 h for the alarm/reconcile, 20 h for distribute**. A missed distribution day is the outcome, reported as `distribution_missed` HIGH the next morning.

**Fix.** Under the generation scheme this cannot happen (A unlinks its own generation successfully because nobody removed it). Under the current scheme, at minimum: when the restore puts a record back, stamp `restoredAt` into it and treat a restored lock as breakable after a much shorter window, and have `withLock`'s failed‑release warning name the pathname and the token so the operator can clear it.

## R2‑4 (MEDIUM) `judgeCronTemplate` gates less than it claims — three ways

1. **It returns `[]` for "I recognised nothing."** The job filter is `/node\s+bank\/\S+\.mjs/`. Change `/usr/bin/node` to `$NODE` (a wholly reasonable refactor) and *zero* lines match: the gate reports green having inspected nothing. Same for wrapping a job in a shell script.
2. **It reads `$FLOCK` unexpanded.** Set `FLOCK=` (or delete the `[ -x ]` guard) and the heredoc text still contains `$FLOCK`, so the gate stays green while the installed crontab has no exclusion at all.
3. **It reads the template, not `crontab -l`** — stated, and fine, but see (2): it does not even verify the template *expands* to something with flock in it.

**Fix.** Return `{bad, matched}` and assert `matched === 4` in the selftest. Better: have `cron-install.sh` write the crontab and then re‑read it (`crontab -l`), run `judgeCronTemplate` over the **installed** lines, and `exit 1` if anything is unwrapped — the installer is the one place that can check the real artifact.

## R2‑5 (MEDIUM) An aborted run is indistinguishable from a quiet one in the log

`flock -n` exits **1** and prints nothing on contention. Cron's output goes to `>> $LOGDIR/x.log 2>&1`; the exit code is discarded and no `MAILTO` is set. The comment claims *"The exit code is 1 with nothing written, which is what the log should show"* — the log shows **nothing**, which is also what a successful skip‑day distribute nearly shows.

**Fix.** `$FLOCK -E 99 $LOCK cmd; rc=$?; [ $rc -ne 99 ] || echo "$(date -Is) SKIPPED: another run holds $LOCK" >> $LOG`. Then a contended run is a line in the log, and the alarm can be taught to read it.

---

# R3 — THE ACK ALLOWLIST

## R3‑1 (MEDIUM) Two of the three ackable kinds are **not** unanswerable by construction

`ACKABLE_KINDS = {vault_owns_itself, nested_vault, unredeemable_owner}`. The stated rule is "unanswerable BY CONSTRUCTION". Applying that rule:

* `vault_owns_itself` — genuinely permanent (proven impossibility 3). Correct.
* **`nested_vault` — actionable whenever the host is LIVE.** The remedy exists and your own suite implies it: in one transaction, `open(HOST)` → ExecuteV1 containing a Core `TransferV1` moving the inner asset out to a real wallet → sweeps → `burn_vault(HOST)`. 9.4 shows that a declared *live* nested asset refuses the burn precisely to force this. The comment in `detectors.mjs` is careful — *"`nested_vault` inside a **BURNT** host is unrecoverable"* — and then the allowlist ignores the qualifier. So an ack silences a recoverable loss of a whole vault's contents.
* **`unredeemable_owner` — ambiguous by construction, which is worse than actionable.** The finding's own text names two readings: "either this vault is listed on a marketplace that escrows it (recoverable: delist and it returns) or its contents are sealed for good." A permanently‑sealed customer vault and a listed vault look identical from here. An operator who acks it as "gary: marketplace listing" mutes a customer's total loss, forever, on a guess.

**Fix.** Condition the ack on the *unanswerable* state, not the kind. `detectNestedVaults` already knows `burnt` for every vault: emit `nested_vault` (host live, **not** ackable) and `nested_vault_orphaned` (host burnt, ackable). For `unredeemable_owner`, either resolve the ambiguity (check whether the off‑curve owner is a known marketplace escrow program's PDA) or make the ack **expire**: `{"why": "...", "until": "2026-09-30"}` and re‑raise at full severity after the date. An ack that never expires on a condition you have not diagnosed is a mute button with a good excuse.

## R3‑2 (LOW) The refusal path is not summarised, and a typo'd ack is silent

`report()` counts `f.acked` and puts it in the header line. `f.ackRefused` is counted nowhere — you must read the CRITICAL's detail to learn someone tried to mute it. And an ack whose `kind:asset` matches **no finding at all** (typo, or the condition cleared) is invisible: nobody learns the mute is dead.

Flooding: not an attack (only a box‑local operator writes `acks.json`), and refused acks do not change severity, so paging survives. Low.

**Fix.** Add `refused` and `unused` counts to the report header; list unused ack keys once a day.

---

# R4 — ROUND 16'S OWN REPAIRS

## R4‑1 (HIGH, and it is a *wrong repair*) `readProgramData`'s `elfOffset: 13` is factually wrong. The original `45` was correct

**The claim under audit.** *"When a program is IMMUTABLE the tag is `None` and the ELF starts at 13, so the watch was fingerprinting the ELF with its first 32 bytes cut off … those bytes include the ENTRY POINT."*

**This is not how `bpf_loader_upgradeable` works.** The ProgramData account layout is `4 (enum) + 8 (slot) + 1 (Option tag) + 32 (pubkey) = 45` — and **45 is a constant in the loader, not a function of the tag**:

```rust
pub const fn size_of_programdata_metadata() -> usize { 45 }
pub const fn size_of_programdata(program_len: usize) -> usize {
    Self::size_of_programdata_metadata().saturating_add(program_len)
}
```

Every `Write` instruction copies bytes to `45 + offset`. `DeployWithMaxDataLen` allocates `45 + max_len`. `SetAuthority` writing `upgrade_authority_address: None` calls `set_state`, which does `bincode::serialize_into(&mut data[..], state)` — that writes **13 bytes and stops**. It does not shrink the account, does not memmove the ELF, and does not zero bytes 13..45 (they keep the *stale* authority pubkey).

So for an immutable program the ELF still begins at **45**, and bytes 13..45 are dead stale key bytes.

**Consequences of the repair as shipped.**
* It is not dangerous — hashing from 13 is a *superset*, so no change is missed and (because 13..45 is stable) there are no false positives. So this is not a live money bug.
* But it is a **repair for a defect that did not exist**, its comment now asserts a false mechanism about a program you do not control, and — worst — `bank/selftest.mjs` **enshrines the false model in an assertion** (`'...and an IMMUTABLE one puts it at 13'`). The next person who reasons from that assertion (e.g. "then the authority read should also be conditional", or "then we should parse the ELF header") will be reasoning from a fabricated layout.

Note the shape: the correct comment two lines above the old code — *"[13..45] authority when present, then the ELF"* — was read as *"the ELF starts wherever the authority ends"*. That is a misreading of a correct comment, dressed as "the one‑of‑two‑sites shape again". It is not that shape at all.

**Evidence if I am right (cheap, and decisive).**
1. Pick any `--final` mainnet program. `solana account <programdata_pda>` and check: `data[12] == 0`; `data[13..45]` is **non‑zero** (a stale pubkey, not padding); `data[45..49] == 7f 45 4c 46`.
2. Or: `solana program dump <program_id> out.so` and compare `out.so` to `tail -c +46` of the programdata account bytes — **byte identical**. If the ELF started at 13, they would differ by 32 bytes.
3. Or read the loader source for `size_of_programdata_metadata()` and every use of it in `write`/`deploy`.

**Fix.** Revert `elfOffset` to a constant 45. Keep `readProgramData` (the `hasAuth` split is still useful and the length guard is good), and **replace the fabricated‑buffer assertion with a real one**: assert `data[45..49] === '7f454c46'` for every program in the watch list, both when `hasAuth` and when `IMMUTABLE`. That is the assertion that would have caught this and will catch a genuine loader change.

**Two smaller defects in the same function.**
* The short‑data branch returns `{authority, elfOffset, problem}` and **no `hasAuth`**. `alarm.mjs` then does `pd.hasAuth ? … : 'IMMUTABLE'` → reports **IMMUTABLE** for an unreadable account, and `acc.data.subarray(null)` → `subarray(0)` → hashes the whole account including the enum, the slot and the authority. A malformed read is reported as a *fact about the program*.
* `problem` is returned by `readProgramData` and **read by nobody**. That is the wired‑to‑nothing class this repo names, in code written today.

## R4‑2 (HIGH) MINT's corrected comment is still wrong on the one point that matters: **this IS refusable on chain**

The new text says: *"Nothing on-chain can refuse it; the whole control is `unredeemable_owner` in `bank/alarm.mjs`, off-chain, at CRITICAL."* SPEC repeats it (*"Nothing on-chain can refuse it (`is_on_curve` panics on BPF)"*).

`is_on_curve` is indeed unavailable — but that is not the only way to test the property, and **the technique you need is already running in two sibling programs**. The property "this owner can sign a TOP‑LEVEL instruction" is exactly equivalent to "**this** instruction is top‑level and `owner` is one of its signers":

```rust
let sysvar = ctx.accounts.instructions.to_account_info();
let idx = load_current_index_checked(&sysvar)?;
let me = load_instruction_at_checked(idx as usize, &sysvar)?;
require_keys_eq!(me.program_id, crate::ID, MintError::MustBeTopLevel);
```

If `mint_vault` is reached by CPI (a Squads execution, a smart‑wallet relayer, anything), `load_current_index_checked` returns the index of the **outer** instruction, whose `program_id` is not MINT, and this refuses. If it is top‑level, then `owner: Signer` means the runtime verified a **message‑level ed25519 signature** from that pubkey — which means it is on curve, which means it can sign the two top‑level instructions a redemption needs. The check is complete for the case that costs a customer a whole vault.

Cost: one extra account (`instructions` sysvar) on `MintVault`, ~2 k CU, and the loss of exactly one flow — "a program mints on behalf of somebody" — which SPEC already declares impossible by design ("this makes it impossible to mint a vault FOR an absent member"). `MintVault`'s account list is not cross‑pinned by any other program (only `BurnVault` and `OpenForRedemption` are), so adding an account is safe.

**Evidence if I am right.** Test: mint via a CPI wrapper program passing a PDA as `owner` with `isSigner: true` (a Squads‑shaped call). Today it **succeeds** and produces a permanently sealed vault — test 5.2 does not cover this and the comment admits it. With the check, it fails with `MustBeTopLevel`. Both arms are ~40 lines in the suite and they turn an off‑chain CRITICAL into an on‑chain refusal.

This is the highest‑value change in this report: it removes a class where a paying customer's cbBTC is sealed forever, and it replaces "detection is the whole control" with prevention.

## R4‑3 (MEDIUM) `banks_disagree`: the consequence text is wrong for the `mint.bank` case, and a legitimate rotation pages every 30 minutes for days

**Wrong consequence.** `burn_vault` cross‑checks **SEAL's** bank against **BURN's** own (`WiringDiverged`). `mint.bank` is read by `mint_vault` only. So `{seal.bank: X, burn.bank: X, mint.bank: Y}` halts **minting**, not redemption — yet the detail says, unconditionally, *"burn_vault cross-checks SEAL's bank against its own and reverts with WiringDiverged, so REDEMPTION IS ALREADY HALTED."* The selftest even asserts the wrong sentence is present (`detail.includes('ALREADY HALTED')`) on a fixture that only sets `seal.bank` and `burn.bank`. An operator paged at 3 a.m. is told the wrong thing about which business function is down.

**Guaranteed false positive.** SEAL and BURN use a hard‑coded `ROTATION_NOTICE_SECS = 7 days`; MINT uses the configurable `governance_timelock_secs`. If those differ (and SPEC tells you to set MINT's to "days", not necessarily seven), the three `apply_pending`s **cannot** be landed together, and every pass in the gap raises a CRITICAL. `report()` calls `NOTIFY` on any CRITICAL, every pass — so a *correct* Bank rotation pages every 30 minutes for up to four days. And `banks_disagree` has no `asset`, so `applyAcks` cannot mute it: there is no off switch.

**`DEFAULT_PUBKEY` is not excluded** — one of two identical sites, in code written today. `detectBankIsNotSignable` explicitly skips `DEFAULT_PUBKEY`; `banks_disagree` does not, so a program initialised with a default bank produces a permanent CRITICAL.

**Evidence if I am right.** `D.detectStandingRisks({'seal.bank': X, 'burn.bank': X, 'mint.bank': Y})` → detail claims redemption halted. `D.detectStandingRisks({'seal.bank': X, 'mint.bank': D.DEFAULT_PUBKEY})` → fires. Both are one line in the selftest.

**Fix.** Split it: `{seal.bank, burn.bank}` disagreeing ⇒ CRITICAL, "redemption is halted (WiringDiverged)". `mint.bank` differing from those ⇒ HIGH, "minting is halted (WiringDiverged in mint_vault)". Filter `DEFAULT_PUBKEY`. And **suppress while the lagging program has a matching `pending_bank` armed** — that is the signature of an operator mid‑rotation, and `rotation_armed` is already shouting about it.

## R4‑4 (MEDIUM) The `if (s.err) continue` assertion: the *reasoning* is sound, the *gate* is not

**The reasoning is correct**, and I checked the ways it could fail:
* `normalise()` includes **inner** instructions, so an inner `burn_vault` counts. But an inner `burn_vault` still needs a genuine *top‑level* `open_for_redemption` naming the same asset and owner (it reads the instructions sysvar and `load_current_index_checked` returns the outer index), so it still burned that asset.
* A failed CPI cannot be swallowed by its caller on modern Solana — an inner instruction error aborts the transaction. So there is no "successful transaction containing a failed `burn_vault`".
* The discriminator check rejects shorter data (`undefined === b` is false).

So: a successful transaction cannot produce `burn_via_program` for an asset that was not burned through the program. **Verdict: the reasoning holds.**

**The gate does not.** `/if \(s\.err\) continue/.test(alarmSrc)` is a text match on a formatting choice:
* Reformat to `if (s.err) { continue }`, or `if (s.err !== null) continue`, or hoist the filter to `sigs.filter(s => !s.err)` — the property is **preserved** and the gate goes **RED**, so somebody deletes the assertion.
* Add `if (s.err) continue` inside a different loop while removing the real one — the property is **broken** and the gate stays **GREEN**.

Both directions wrong is the definition of a gate that is not one. And the assertion reads **`/opt/cbob-vaults/bank/alarm.mjs`**, an absolute path, so it validates the *installed* copy, not the tree under test (see R6‑2).

**Fix.** Make it behavioural. Export the per‑signature decision from `alarm.mjs` as a tiny pure predicate (`export const shouldDecode = s => !s.err`), assert it both ways in the selftest, and use it at the call site. Then the coupling is a function, not a regex.

## R4‑5 (LOW) "Exactly one file in `bank/` reads the Bank key" is a tripwire, not a control

* The pattern is two literal spellings (`CBOB_BANK_KEY`, `keys/bank.json`). A second signer that reads `process.argv[2]`, or `BANK_KEYFILE`, or `bank/keys/bank2.json`, or stdin, matches nothing.
* The scan is `bank/*.mjs` only. A signer in `scripts/`, a systemd unit, a Python helper, or the web app in `/opt/gary-club` is invisible — and the web app is the *likely* place a redemption client gets built.
* The "capable of finding a second one" assertion tests the **regex against synthetic strings**, not the directory walk. It proves the regex matches; it does not prove a new file in `bank/` would be caught (it would, but that is not what is asserted).

Keep it — it is nearly free — but do not count it toward carry‑over 1, and do not let it substitute for process isolation (see the carry‑over section).

---

# R5 — THE COMMENTS, AGAIN (EIGHTH ROUND)

## R5‑1 (HIGH) SPEC's control table — the one designated source of truth — lists as a **control** something SPEC itself calls "an open gap, not a control"

Round 15's rule is: every claim **points at** the control table and never restates it. So the table is now the single load‑bearing statement in the repository, and all four program headers inherit whatever it says. It says:

> | **`bank/cosign.mjs`** — the Bank's co-signer | the whole redemption, BEFORE a signature: … | **pre-signature** |

and, three paragraphs later, in the same section:

> **It is not wired into anything**: no cron, no service and no client calls it, so nothing forces a redemption through it. That is an open gap, not a control.

A table row is a claim that a control runs. A file nobody calls does not run. **This is the same defect class, in its eighth round, in the file written to be the one place it cannot happen — and it has now been *propagated* into SEAL's header and BURN's header, both of which point here.** SEAL's header states flatly: *"`bank/cosign.mjs` refuses in the moment, PRE-SIGNATURE."* It refuses only if a human types the command.

**Fix.** One column, filled in honestly:

| control | catches | when | **wired?** |
|---|---|---|---|
| `bank/cosign.mjs` | … | pre‑signature | **NO — operator‑invoked CLI. Nothing forces a redemption through it.** |
| `detectNestedVaults` | … | ≤30 min | yes (cron) |
| `detectUndeclaredTokenAccounts` | … | daily | yes (cron) |

And add a gate: `judgeControlTable(SPEC.md)` — for every row, require the "wired?" cell to be `NO` unless the named file appears in `scripts/cron-install.sh`'s heredoc or a systemd unit. That is ten lines and it converts an eight‑round‑old prose defect into a build failure.

## R5‑2 (MEDIUM) `cosign.mjs`'s own header contradicts `judgeRedemptionTx`'s own comment, sixty lines apart

Header: *"the honest claim is: **it refuses everything it can see**, and what it can see is one slot old."*

`judgeRedemptionTx`: *"**WHAT THIS IS STILL NOT**: a full redemption grammar. It does not verify that a sweep sends the vault's tokens to the OWNER rather than to a third party, and an in-transaction deposit into an undeclared PDA-owned account defeats the coverage scan deterministically."*

Both cases are things it **can** see (they are in the instruction list it already decodes) and does not refuse. The honest claim is "it refuses a fixed list of things, one slot old" — and that list belongs in the control table, not in a superlative.

## R5‑3 (MEDIUM) "TWO ARMS" describes four; "impossible" describes three of four

The `judgeRedemptionTx` comment says *"TWO ARMS, and the first is the one that closes the theft"* and then enumerates two, while the code implements three in this function (bank presence, allowlist, fee payer) plus the nonce refusal in `cosign.mjs`. The verdict and the audit brief both say four. A comment that undercounts the controls it documents is how the fee‑payer arm gets deleted by someone tidying up.

And *"makes it **impossible** for any other instruction to spend it, delegate it, reassign it or close it"* — true of other instructions, false of the pair (R1‑4).

## R5‑4 (MEDIUM) `lock.mjs`'s header now claims a coverage that R2‑1 breaks

> *"`scripts/cron-install.sh` wraps every money job in `flock -n`, a kernel lease … **cannot race. That covers every unattended run.**"*

It covers every unattended run **while `/var/lock/cbob` exists**, which is until the next reboot, and **while the installed crontab matches the template**, which `judgeCronTemplate` does not check. Two conditions, neither stated, one of them false today.

## R5‑5 (LOW) Round 15 gated three stale numbers in SPEC and left a fourth, five‑fold wrong, in the same file

`bank/selftest.mjs` now asserts SPEC's three floors in "Running the tests". SPEC's Bank‑alarm section still reads:

> Every detector is proven in BOTH directions by `bank/selftest.mjs` (**69 assertions**).

against a real 328. **One of two identical sites**, in the round whose headline finding was that class, in the fix for that class. The gate should scan SPEC for *every* `\d+ assertion` occurrence, not the one block.

Also stale in SPEC: *"Thirteen AI audit rounds"*, *"Thirteen rounds, thirteen with a real finding"*, and *"Rounds 6, 7, 8, 9 and 10 each produced live defects"* — against fifteen. Nobody is endangered by a wrong round count; the point (yours, not mine) is that a visibly wrong number teaches the reader the numbers beside it are decorative.

## R5‑6 (LOW) `readProgramData`'s comment is now the drift

Per R4‑1, the entire header of that function describes a mechanism the loader does not have, in a function written today, about the program you do not control.

---

# R6 — THE GATES THEMSELVES

## R6‑1 (MEDIUM) 3.1g counts **lines that begin with `pub`**, not fields — so it can pass while the constant is wrong

```ts
const burnFixed = (BURN_SRC.match(/pub struct BurnVault<'info> \{([\s\S]*?)\n\}/)?.[1]
  ?.match(/^\s*pub \w+:/gm) || []).length
```

`^\s*pub \w+:` with `/m` matches the **first** `pub` on each line. `BurnVault` happens to have one field per line today. `BurnConfig`, in the same file, is written `pub admin: Pubkey, pub collection: Pubkey, pub bank: Pubkey, pub bump: u8,` — i.e. the codebase's own style admits multiple fields per line. Add a field to `BurnVault` on an existing line and `burnFixed` stays 11, `BURN_FIXED_ACCOUNTS` stays 11, the gate stays **green**, and `cosign.mjs` slices `declared` one account short — which means the co‑signer reads a real declared account as part of the fixed prefix and *fails to require it in coverage*. That is fail‑**open**.

**Fix.** `body.match(/\bpub\s+\w+\s*:/g)` (global, no line anchor), and add a third assertion: the count must equal the number of `AccountMeta`s the suite's own `ixBurn` builder emits before `extra` — i.e. pin it to the *builder*, which is what the original comment claimed and what actually matters.

## R6‑2 (MEDIUM) The new source‑reading gates read `/opt/cbob-vaults/...`, not the tree under test

`bank/selftest.mjs` reads `alarm.mjs`, `SPEC.md`, `scripts/run-tests.sh`, `scripts/cron-install.sh` and the `bank/` directory listing by **absolute path**, while importing `detectors.mjs` and `lock.mjs` **relatively**. Run the suite from a git worktree, a CI checkout, or a reviewer's clone and every source assertion is about a different copy of the code — green here, red nowhere. Given `run-tests.sh` `cd "$ROOT"` where `ROOT=/opt/cbob-vaults`, this is latent today and becomes live the first time anyone builds from a checkout (which is exactly what "reproduce the sha256 from $COMMIT" in `build-mainnet.sh` asks a reviewer to do).

**Fix.** `new URL('../SPEC.md', import.meta.url)` etc. throughout. One sed.

## R6‑3 (MEDIUM) `judgeCronTemplate` — see R2‑4. A gate that returns `[]` for "recognised nothing" is a gate that green‑lights a rename.

## R6‑4 (LOW) Round 16 reintroduced the crash‑instead‑of‑report pattern the file has a rule against

```js
t('...and it says redemption is already halted',
  D.detectStandingRisks({...}).find(f => f.kind === 'banks_disagree').detail.includes('ALREADY HALTED'), true)
```

Stub `banks_disagree` dead and `.find()` returns `undefined` → `TypeError` → the file aborts with a stack trace and **every later assertion never runs**, including the `FLOOR` check. The file's own round‑13 comment ("`[0].kind` THROWS when a detector returns nothing … the `?.` makes a dead detector read as `null`") exists for exactly this. Use `?.detail?.includes(...) ?? 'DETECTOR DEAD'`.

## R6‑5 (LOW) `readProgramData`'s "asserted both ways" is a tautology over its own arithmetic

`Buffer.alloc(200); pd[12] = 1` → asserts the function returns 45. That tests nothing about ProgramData; it tests that a ternary is a ternary. Per R4‑1 the assertion is also asserting a falsehood. Replace with the ELF‑magic assertion against real accounts.

---

# THE CARRY‑OVER LIST

### CO‑1 (HIGH) Nothing is wired to the co‑signer — and it is **worse than stated**, in three specific ways

1. The "exactly one file reads the Bank key" assertion (R4‑5) creates the appearance of enforcement where there is none, and the round‑15 verdict lists it as if it partly answers this item. It does not.
2. **The fail‑closed choices manufacture the bypass.** Legacy‑only parsing (verdict challenge 2) and the unconditional coverage refusal (R1‑1) both produce "the tool will not sign this legitimate redemption." The operational answer to that is *sign it with the CLI*, which is a Bank signature with **zero** checks. So every fail‑closed refusal you add increases the probability of a wholly unchecked signature. That is the inversion that matters, and it is not in the carry‑over text.
3. The key file will live at `/opt/cbob-vaults/bank/keys/bank.json`, owned by `ubuntu` — **the same uid that runs the alarm, holds both money ledgers, holds the distributor and swap‑operator keys, and can `rm state.json`**. Mode 0600 is checked; the uid boundary is not there to be checked.

**The smallest thing that makes it a control** (concrete, and small):

* A tiny local signing service: its own unix user `cbob-bank`, key `0400 cbob-bank:cbob-bank`, one endpoint `POST /cosign {tx_b64}` on `127.0.0.1`, whose handler is literally `const v = await inspect(b64); if (!v.ok) return 400; return partialSign(...)`. No `--live`, no flag, no path to a signature that skips `inspect()`.
* `ubuntu` cannot read the key; the redemption client cannot obtain a Bank signature any other way.
* Add the override from R1‑1 as a *second* endpoint that requires a separate, logged authorisation, so "a human who has looked" is a recorded event rather than the absence of a control.
* Then the "exactly one reader" assertion becomes true *by permissions* rather than by grep, and `judgeControlTable` (R5‑1) can flip that row to "wired".

### CO‑2 The in‑process lock hole — see R2‑2. It is closable, and both mitigations are currently defective (R2‑1, R2‑4).

### CO‑3 Cross‑pass correlation lag — unchanged, correctly stated. One addition: with `banks_disagree` now paging every pass and unmutable (R4‑3), the un‑retractable CRITICAL problem got materially worse this round.

### CO‑4 (MEDIUM) Compute units: I have **no evidence** of a CU ceiling below 3 mints — but the byte ceiling is now thinner than SPEC says

Rough per‑instruction estimate for the 3‑mint worst case: `open` (sysvar introspection + one Core `UpdatePluginV1` CPI) ~30–50 k; one `ExecuteV1` carrying 7 inner CPIs ~50–80 k; `burn_vault` (SEAL config read + 6 × `find_program_address` at ~1.5–3 k each + remaining‑account loop + Core `BurnV1` CPI) ~50–80 k. Total on the order of 150–200 k against a **default budget of 200 k × 3 top‑level instructions**. I do not believe there is a live CU bug, and I decline to file one.

What I will file: **the measured 1119 bytes assumes no `ComputeBudget` instruction, and your own allowlist explicitly permits one.** `SetComputeUnitLimit` costs ~9 bytes of data plus a new account key (32) plus a meta — call it ~45 bytes, and `SetComputeUnitPrice` another ~45. So the real headroom at 3 mints is ~68 bytes, or ~23 if a client sets both. That is inside the noise of one extra account meta.

**Fix.** In test 4.2 and in `sizeFor(3)`, add a `ComputeBudget.setComputeUnitLimit` instruction and re‑assert `<= 1232`; and read `meta.computeUnitsConsumed` from `getTransaction` on the happy path and assert it against a pinned literal (the same discipline as 9.14a). Both are a handful of lines and they close the last unmeasured dimension of the ceiling argument.

### CO‑5 (MEDIUM) `detectNestedVaults` blind to foreign Core assets — and the co‑signer's coverage of it is a refusal, not a remedy

The co‑signer's DAS scan does *not* filter by collection, so it **does** see a foreign Core asset nested in a vault — but only to refuse (`a Core ASSET at X … is NOT declared`). And if you declare it, BURN refuses (`VaultStillHoldsAVault`). The actual remedy — sweeping it out with a Core `TransferV1` inside the ExecuteV1 — is again the thing the coverage judge cannot credit (R1‑1). So the practical state is: **anyone can mint a Core asset for ~0.003 SOL, send it to a vault's asset‑signer PDA, and force that vault's redemption off the tool permanently.** Not stranded — recoverable with a bespoke client — but off the control.

### CO‑6 MINT's dead redemption stamp and the SEAL‑PDA Attributes delegate — unchanged. One note: because the Attributes plugin authority is a SEAL PDA that no longer writes attributes, `ATTR_REDEMPTION`'s reservation is now a rule enforcing nothing on behalf of a writer that does not exist. Delete both together or keep both; the half‑state is what invites a wrong "cleanup".

### CO‑7 Distribution reconciles against a ledger the payer wrote; no fresh per‑cycle swap wallet — unchanged and correctly stated.

### CO‑8 Duplicate attribute keys / vault minted during a proposal / no atomic reserve proof at purchase — unchanged. On the last one, note that under v5 there is a stronger statement available to a buyer than SPEC admits: the *only* way a live vault's reserve can fall is a redemption that destroys the vault, so "the vault exists and its ATA reads N sats at slot S" is a much stronger guarantee than it was under v2–v4. Worth saying in SPEC, because it is a selling point you have not claimed.

---

# ATTACKING THE ROUND‑15 VERDICT

### V‑1 REJECTED: "the co-signer never checks the vault's collection or its on-chain owner"

**The rejection is *conditionally* right and the conditions are not stated.** "It reverts" is a claim about *state*, used to justify omitting a *static* check. A Bank‑signed message whose only obstacle is mutable state is a bearer instrument for as long as it can land. Two things keep that safe today, and both are new and fragile:

* the ~150‑block (≈60–90 s) blockhash window, and
* **arm 4** (durable nonces refused) — which is *also* what stops a `NotTheOwner` transaction from being banked indefinitely and fired the instant the attacker acquires the asset.

So the safety of the rejection rests on the arm the same round added. Remove arm 4 and the rejection becomes false: Mallory gets the Bank's signature on `[open(Alice's asset, owner=Mallory), sweeps→Mallory, burn]` (reverts today), banks it on a nonce, buys the vault, and fires it — and every sweep destination is Mallory, which is legal in the grammar you declined to build.

**And the fix is one RPC call you are already making.** `inspect()` already opens a `Connection` and fetches the SEAL config. Fetching the 66 bytes of the asset — `owner = data[1..33]`, `collection = data[34..66]` — and requiring `owner === shape.owner` and `collection === cfg.collection` costs one `getAccountInfo`, removes the entire argument, and makes the tool's verdict independent of a dynamic property. Do it.

### V‑2 REJECTED: "legacy-only parsing is a HIGH availability failure"

**Fail‑closed is the right direction** and 3.1i is the right way to pin it — I agree with the rejection on the merits. But the interaction is unexamined and it cuts against you: 9.14b measures that **only two** reserve mints fit if the redeemer must create destination ATAs, and MAX_RESERVE_MINTS is three. So the first redemption by any customer who does not already hold three ATAs *requires* either a prior transaction (documented in prose, enforced nowhere, and no client exists) or a v0 transaction with an ALT — which the co‑signer cannot parse. The consequence is not "unavailability"; it is **CO‑1(2)**: the hardest redemptions are exactly the ones that get signed by something other than the tool.

Keep the rejection. Add the missing control: make the prior‑ATA‑creation requirement a *checked* precondition — `inspect()` should verify the owner already holds an ATA for every reserve mint and say so plainly when it does not, rather than leaving the client to discover it at 1215 bytes.

### V‑3 REJECTED: "declare-everything bricks a vault" — **I move to accept this, with a narrower fix**

The design argument ("a coverage refusal is a refusal to bless DESTRUCTION") is sound *for a redemption that would destroy something*. It is not sound for a redemption that **cleans up correctly**, and per R1‑1 the judge cannot tell those apart because it never looks at the sweeps. So the current behaviour refuses the right transaction, the Token‑2022 variant is refusable no matter what the client does, and there is no `--force`. That is a cheap permanent denial of the tool per vault at ~0.002 SOL, and — because the escape is "use another signer" — a denial of the *control*, not just of the tool.

Not "bricks a vault" (the on‑chain redemption still works, and the grief is sweepable inside ExecuteV1). But "hands an attacker a cheap, permanent, per‑vault removal of your only pre‑signature control" is worse than what the verdict rejected.

### V‑4 REJECTED: "the judge does not verify owner and bank are actual signers" — **CONFIRMED CORRECT**

Anchor's `Signer` on `owner` and `bank` in both `OpenForRedemption` and `BurnVault` means the runtime verified message‑level ed25519 signatures; the transaction cannot land otherwise, and the suite exercises it (3.1 rejects with `NotTheBank`, 5.2 with `AccountNotSigner`). There is also nothing for the judge to *verify* about the Bank: adding the Bank's signature is what it is deciding to do. And if the Bank is not in the message's signer set at all, `tx.partialSign(bank)` throws `unknown signer` in web3.js — loud, not silent. The rejection is right.

### V‑5 Was one of the twelve fixes wrong, or aimed at the wrong thing?

Yes, on both counts, and both are in this report:

* **Wrong:** R4‑1 — `readProgramData`'s `elfOffset: 13` (round 16's own repair) is based on a loader behaviour that does not exist. Harmless in effect, wrong in model, and now asserted.
* **Aimed at the wrong thing:** R2‑2 — fix #3 corrected the *symptom* (the true holder's lock survives) while the header declared the *cause* unclosable on the strength of a false impossibility claim. `link()` at a monotonic generation closes it. Everything about `flock` being "the durable answer" follows from that claim, and `flock` is currently broken by R2‑1.

---

# OTHER FINDINGS (not in the brief)

## X‑1 (HIGH) `Anchor.toml` points `anchor test` at **mainnet**, pins no toolchain, and knows about one of four programs

```toml
[toolchain]                      # EMPTY — no anchor_version, no solana_version
[programs.mainnet]
cbob_vaults = "9YKV..."          # MINT, BURN, GOV absent
[provider]
cluster = "mainnet"
wallet = "~/.config/solana/id.json"
[scripts]
test = "yarn run ts-mocha ... tests/**/*.ts"
```

`anchor test` / `anchor deploy` / `anchor run test` use `[provider]`. So `anchor test` runs `tests/**/*.ts` — including `3prog.test.ts`, which calls `requestAirdrop`, `initialize`, `set_round`, `mint_vault` and `burn_vault` — with **mainnet** as the configured cluster and the operator's default hot wallet. (The suite hard‑codes `http://127.0.0.1:8999`, so today it would just fail to connect; `initauth.test.ts` likewise. That is luck, not design, and the `[scripts] test` glob will pick up the next test file somebody writes with `provider.connection`.)

`[toolchain]` being empty means `anchor build` uses whatever is installed, while `run-tests.sh` greps for `platform-tools v1.54`. Two pins, one of them absent, in the file that decides what gets compiled.

**This file has never been audited and it is in the ship path.** Evidence: `anchor test --skip-local-validator` from the repo root and watch which cluster it resolves.

**Fix.** `cluster = "localnet"` (or a deliberately dead URL), pin `anchor_version` and `solana_version` in `[toolchain]`, list all four program ids under `[programs.localnet]` and `[programs.mainnet]`, and delete `[scripts] test` — `run-tests.sh` is the certifying runner and a second, weaker entry point is a false pass waiting to be run.

## X‑2 (HIGH) The coverage gate and the freeze gate cannot see the dependencies the money jobs actually run on

`scripts/audit-coverage.sh` was widened this round to `Cargo.toml Anchor.toml`. Its `have` list is a **hand‑maintained allowlist**, so "every file has been read" means "every file somebody remembered to list". Still outside it:

* **`programs/*/Cargo.toml`** — the four files that pin `anchor-lang`. The workspace root has no `[workspace.dependencies]`, so the *actual* dependency versions live in files no auditor has seen. `overflow-checks = true` was the headline of last round's coverage finding; the anchor version is a bigger lever and it is still invisible.
* **`package.json` / `yarn.lock`** — and worse, `bank/cosign.mjs`, `bank/revenue.mjs`, `bank/distribute.mjs` and `bank/alarm.mjs` all import web3.js from **`/opt/gary-club/node_modules/@solana/web3.js/lib/index.cjs.js`** — a *different project's* `node_modules`, unpinned, unhashed, unwatched, and **outside the three directories SHIP GATE item 2 freezes**. Arm 3 of the co‑signer depends on `Transaction.populate` setting `feePayer = accountKeys[0]`; assertion 3.1i depends on `Transaction.from` throwing on a versioned message. A `yarn upgrade` in an unrelated project changes both, and nothing in this repo notices. (3.1i would at least go red on the second behaviour; nothing covers the first.)
* **`scripts/notify-gary-sms.sh`** — the entire alert delivery path. If it is broken, every CRITICAL in this system is a `console.log`.
* **`bank/acks.json`** — the mute file.
* `tsconfig.json`, `/etc/logrotate.d/cbob-vaults`, the installed crontab.

**Fix.** Two changes, both small. (1) Make the `have` list a *deny*list: `git ls-files` minus an explicit, commented exclusion list, so a new file is unaudited **by default** rather than unlisted by default. (2) Vendor or pin the JS dependencies inside this repo (`bank/node_modules` or a lockfile plus a `sha256` of the resolved `@solana/web3.js` version, asserted in the selftest), and add that hash to the drift watch. A freeze gate that cannot freeze your crypto library is not a freeze.

## X‑3 (LOW) `MINT_CONFIG_DISC` in MINT is declared and never read

MINT declares `pub const MINT_CONFIG_DISC` and never uses it (GOV keeps its own copy). Assigned‑and‑never‑read is the shape that produced the `minted_total` and `mint.pending_bank` findings. Either use it (it is the natural thing for `pinnedAccountData` in `revenue.mjs`/`distribute.mjs` to compare against) or delete it. Same for the fact that **no assertion anywhere pins `SEAL_CONFIG_DISC` / `MINT_CONFIG_DISC` to `sha256("account:<Struct>")[..8]`** — they are exercised implicitly by the happy path (4.2 would fail), which is enough today and is not an assertion.

## X‑4 (LOW) `ALLOWED_PROGRAMS` omits the Memo program

A redemption client that attaches a memo (an entirely ordinary thing for a customer‑facing product, and useful for your own reconciliation) is refused. Trivial, but it is the kind of refusal that produces CO‑1(2).

---

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Not repeating SHIP GATE's five items. Six things sixteen rounds of AI review structurally cannot do, each with the concrete thing to do instead.

**1. Nobody has ever operated this system. Run a 90‑day adversarial staging deployment on devnet with real crons, real reboots, and a paid griefer.**
Every model here reads code. None of them has watched `/var/lock` disappear at boot (R2‑1), or been paged every 30 minutes for four days by a correct Bank rotation (R4‑3), or discovered that the co‑signer refuses the redemption a customer actually needs (R1‑1). Those are the three most operationally significant findings in this report and all three are *behavioural over time*, which is the one axis no round can traverse. Deploy all four programs to devnet, mint 200 vaults, run the crons for 90 days, **reboot the box unannounced at least three times**, and pay somebody a bounty to grief individual vaults (dust airdrops, T22 ATAs, foreign Core assets, 1‑lamport PDA funding, poisoned distributor ATAs). Score yourself on: did anything page that should not have; did anything fail to page that should have; how many vaults ended up needing a human.

**2. Nothing in sixteen rounds has measured the *cost* of a control firing.** Every finding is "does it refuse the bad thing". No round has asked "how often does it refuse the good thing, and what does the operator do then". That question is what produced R1‑1, R4‑3 and CO‑1(2), and it is the question that decides whether the controls survive contact with customers. Instrument it: every refusal, from `judgeRedemptionTx`, `judgeRedemptionCoverage` and `withLock`, appends a line to a counted log, and a weekly report gives you refusals‑per‑redemption and false‑page rate. A control with a false‑positive rate you have never measured is a control that will be turned off.

**3. Make the *cheap* on‑chain checks that models keep declaring impossible.** Both this round's highest‑value structural findings (R4‑2 top‑level introspection for `mint_vault`; R2‑2 generation‑numbered `link`) are cases where a confident impossibility claim in a comment stopped anyone looking. Institute a rule with teeth: **any comment containing "cannot", "impossible", or "nothing on-chain can" must cite a measurement or a source line, and a gate greps for those words and requires an adjacent `MEASURED:` or `SOURCE:` tag.** You already do this for measured facts; do it for measured *impossibilities*, because those are the ones that suppress future findings.

**4. Get one adversarial *execution* engagement, even without a firm.** Not a review — a bounty. Fund a public devnet bug bounty (a few thousand dollars, scoped to the deployed devnet programs plus the off‑chain pipeline running on a real box you hand over) with a clear payout table. That buys the one thing this process cannot produce: somebody whose incentive is to *run* your code hostilely, not reason about it. A third of "CRITICAL" findings here are wrong on measurement; zero percent of a working exploit is.

**5. Rehearse the four disasters, on the real system, with a stopwatch.** Write and *execute* runbooks for: (a) the Bank key is compromised — how long from detection to a rotated Bank, given SEAL 7 days / BURN 7 days / MINT `governance_timelock_secs`, and what happens to in‑flight redemptions; (b) Metaplex upgrade Core — `prog.core.hash` fires, then what, given that you cannot roll back and every vault is a CPI into it; (c) `distributions.json` is lost — the marker refuses, and who decides to remove it; (d) a customer's vault is permanently sealed (`unredeemable_owner`) — what do you tell them and what do you pay them. Each of these is currently a paragraph of intent. None has a measured time‑to‑recovery. Sixteen rounds cannot produce one because the recovery involves a seven‑day timelock and a human.

**6. Publish the limits in the product, not in `SPEC.md`.** The things a buyer must know are: an undeclared holding is *destroyed* by a redemption; a DAO or multisig cannot hold a vault; a T22 ATA airdropped to your vault's PDA means your redemption needs a bespoke client; the SOL→cbBTC hop is trusted; one holder has ~21% of the votes. Those live in a 3,000‑line spec that no purchaser will read. Put them on the mint page, in the asset's `uri` metadata, and in the redemption client's confirmation dialog. No amount of AI review substitutes for a customer having been *told*; and of everything in this report, the item most likely to end in a real complaint is a DAO buying a charter vault — which R4‑2 shows you can simply refuse on chain instead.