# Prelock helper follow-up: install and rehearsal decision at `/opt/cbob-vaults`

**What I checked:** read-only, 5 reads and 1 grep. I read `PRELOCK-ARCHIVE-RETRIAGE.md`, `prelock-final-followup.patch`, the working-tree `scripts/seal-prelock.py` and `bank/live-programs.mjs`, and grepped `prelock-check.sh` for the core-read calls. I ran nothing, read no env or sudoers files, and didn't count the tests myself.

## Verdict

- **Installing the root sealer: OK.**
- **Running `--rehearse`: OK.** No new blocker. There is one ordering condition (P1) and a few non-blocking items.
- **Certification and lock: not assessed and not authorized** by this review.

## Prior findings

**B1 (archive parent created 0700): closed.**
- `seal-prelock.py:5` sets `os.umask(0o022)` before anything else runs.
- Line 18 now actually creates the parent as 0755.
- If a parent already exists as `root 0700` from some earlier attempt, it passes the refusal at line 19, because no group/other write bits are set. Line 20 then corrects it to 0755.
- The refusal still runs before the chmod. A parent that is non-root, a symlink, or group/world-writable is refused, not silently fixed.
- Staging is safe under the new umask. `mkdtemp` is always 0700, so files written 0644 for an instant are not reachable before they are chowned to 0440. The folder then goes to 0550 and is renamed atomically.

**S1 (helper owner and mode): mostly closed.** `prelock-check.sh` now requires `-x` and `0:0 755`. The `/usr/local/sbin` ancestor check is still missing (LOW, see N3).

**S3 (security failures reported as RPC glitches): partly closed.**
- An authority mismatch now exits 2 with its own message.
- `matches:false` now exits 2 with its own message.
- `observe()` now passes stderr through.
- What remains is N2.

**HTTP 429 retry (`live-programs.mjs:18-30`): sound, and it fails closed.**
- It resends the same `opts` every time. The body is the JSON string web3.js builds, so `minContextSlot` and the commitment are unchanged.
- The 30 s timeout covers all attempts, and there are at most 4 attempts (backoff 1+2+4 s).
- It retries only on HTTP 429, HTTP 503, or JSON-RPC `-32016`. Every other error comes back after one attempt.
- web3.js's own retry is still disabled (`disableRetryOnRateLimit:true`), so the two don't stack.
- A final 429 or `-32016` still reaches web3.js as an error. `prelock-core` turns that into "NO LOCK".
- No check is relaxed:
  - the genesis, loader, ELF and `judgeProgramBytes` checks are unchanged;
  - the two providers must still agree exactly on `identities`;
  - the authority pin is still enforced.
- A retried finalized read is exactly as authoritative as a first-try read.
- The new test file uses stubbed fetches against `example.invalid`, so it makes no network calls. A floor of 58 (55 + 3) is consistent with that.

## Condition before rehearsal

**P1. Commit the follow-up patch, then install from the committed bytes. Don't install from a dirty tree.**
- The patch includes `PRELOCK-ARCHIVE-RETRIAGE.md` as a new file, so the working tree is probably uncommitted right now.
- `getCommit` refuses a dirty tree.
- `prelock-check.sh:15` byte-compares the installed helper with `scripts/seal-prelock.py`. If you install now and then edit the file again, the run is refused early. That costs nothing, but it is avoidable.
- Order: `git commit` → `sudo install -o root -g root -m 0755 scripts/seal-prelock.py /usr/local/sbin/cbob-seal-prelock` → optionally `sudo install -d -o root -g root -m 0755 /var/lib/cbob-prelock /var/lib/cbob-prelock-rehearse` → `--rehearse`.

## New, non-blocking findings

**N1. Rate-limit retries can now run past the 90 s observe timeout and the 30 s per-call budget — LOW (operational only, fails closed).**
- Each run makes about 6 RPC calls, each with up to 7 s of backoff. On top of that, `observe()` has a 90 s `execFileSync` timeout (`prelock-receipt.mjs`).
- Public mainnet limits large account-data reads over a roughly 30 s window, which a 7 s total backoff won't outlast. `Retry-After` is also ignored.
- If this happens at `core-after` (`prelock-check.sh:41`), you lose the run after the suites. If it happens at `--verify-rehearsal`, that step can be re-run on its own against the archived folder with the same `--expect`, so nothing is lost.
- Fix: honour `Retry-After`, capped within the 30 s budget. Optionally give `core-after` its own bounded retry by re-running the whole read; never accept a partial read.
- Rehearsal evidence item 4 (four successful two-provider reads) will show whether this matters.

**N2. Other security-relevant failures still get the generic "inspect the independent read" message with exit 1 — LOW.**
- `prelock-core.mjs` puts `Independent providers disagree`, `Bank program differs from audited build`, `Wrong genesis` and `Invalid program` all in the same bucket as a provider glitch.
- At least the first two are integrity signals, not glitches.
- Fix: put these four errors in the escalate class too (exit 2), or print their fixed `e.message` text. All four messages are fixed literals, so printing them leaks nothing.

**N3. `/usr/local/sbin` ancestors are not checked to be root-owned and non-writable — LOW.** This was part of the S1 fix. Ubuntu already has unrestricted sudo, so this protects operations only.

**N4. Bodies of responses that get retried are never consumed — INFO.** These are the 429/503 originals and the original of a `-32016` response. With at most 4 attempts this only holds a socket until garbage collection. You can call `response.body?.cancel()` before the delay.

**N5. Test gaps — INFO.**
- No test for 503.
- No test that a timeout during backoff throws.
- No end-to-end test that a final 429 through `readConnection` makes `prelock-core` refuse.

**S2 is still open.** The rehearsal will be the first time the real Python digest and archive code run. That is acceptable, because the rehearsal exists to produce that evidence. Item 2 (the Python digest equals the printed JS digest) must be checked explicitly.

## The rehearsal must still show

These are the same five items as the retriage (`PRELOCK-ARCHIVE-RETRIAGE.md` lines 104–111):

1. The helper is installed root 0755, and both archive parents are root 0755.
2. The Python digest equals the printed JS digest on real logs.
3. The archived run folder is 0550 and its files are 0440 `root:ubuntu`, and `--verify-rehearsal` passes as ubuntu.
4. All four two-provider reads succeed. Record any retries.
5. The tree is still clean after all three suites, and `# tests 58` appears in `full-suite.log`. The retriage said 55; the floor is now 58.
