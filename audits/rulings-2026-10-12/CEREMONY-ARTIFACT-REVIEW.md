# Audit: inert signing-artifact install for CBOB source `a9dcaca08e6db389a24333009d7008ba8c9d235d`

## Verdict

**The evidence supports the narrow inert install. I found no blocker.** The installer will only install bytes whose attestation hashes to the GitHub-produced digest `d1b17742…b94b9f`, so a wrong local byte makes it refuse rather than install. Five low-severity pre-checks and post-checks are listed below. One verification step, the owner confirming the digest from their own device, is required before any service start or signing. It is not required for this install.

## What I checked myself

**Manifest against the off-box log**
- All 35 hashes in `launch/ceremony-artifact.json` appear in `offbox-rebuild-38275119471.log` (Grep count: 35 in the manifest, 36 in the log). The extra hit is the lock hash at log line 213.
- I compared paths and order line by line: log lines 219-253 against manifest lines 4-38. They are identical.
- The local `/scratch/.../a9dcaca…/ARTIFACT.json` is identical to the manifest.
- The local candidate directory holds exactly those 35 files plus `ARTIFACT.json`.

**The GitHub run itself**
- From `offbox-run-38275119471.json`: `workflow_dispatch` by `garylhenderson`, branch `v6`, `head_sha` a9dcaca, workflow path `.github/workflows/ceremony-rebuild.yml`, attempt 1, conclusion success.
- Line 215 of the log shows `artifact_sha256` `d1b17742…`, which matches the digest in the status note.
- The workflow YAML ran from a9dcaca. Because the off-box `rebuild-ceremony.mjs` passed its review-chain checks (`:21-27`), only `web/README.md` and the review file changed between 1173a21 and a9dcaca. So the YAML and `install-ceremony.py` are byte-identical to what DEPENDENCY-PIN-RETRIAGE reviewed at 1173a21. That is stronger evidence than the `workflow_sha256` receipt.
- The five release-binary hashes in the log (line 214) equal the on-chain programdata sha256 values for the seal, mint, burn, gov and sweep programs in `ceremony-preflight-passed-a9dcaca.json`.

**The approved fingerprints**
- In the candidate `web/README.md`, the `Pin review` line records sha256 `4937d2e5…`. That equals the artifact's `web/deploy/pin-review.md` hash. The file content matches `DEPENDENCY-PIN-RETRIAGE.md`.
- All 10 `mainnet-local` after-hashes approved in that review equal the manifest and `BUILD.txt` entries.
- `BUILD.txt` names commit a9dcaca, profile `mainnet-local`, and rows identical to the manifest.

**Hosted rehearsal log**
- The deploy hashes for `pin-review.md` and `page-build-inputs.json` differ from the manifest. That is expected: `ceremony-hosted-rehearsal.mjs:53-55` writes synthetic versions of both files.
- The launcher, `ceremony-build`, `check-env` and server bundle hashes all equal the manifest, so the real attested launch path was tested.
- `/opt/cbob-ceremony` does not exist now, so the fixture was cleaned up.

**Current state of the box**
- No `cbob-ceremony@` unit is installed in `/etc/systemd/system`.
- Nothing in `/etc/nginx/sites-enabled` matches `*cbob*` or `*central*`.
- `/usr/local/sbin/cbob-install-ceremony` is absent.
- Installing the artifact therefore cannot start anything.

## Findings

### F-1 · MEDIUM (missing verification, required before activation, not before install): the off-box digest has only been seen by this server

- **Where:**
  - `CEREMONY-WINDOW.md:63-70` and `:141` say the ubuntu operator has passwordless sudo, so on-box evidence is not independent, and the digest must arrive through a separate channel.
  - The run JSON, job log, the action-tag "official ref" checks in `ceremony-offbox-trust.json` and the artifact-expiry date were all fetched by this box.
- **Failure path:** if this box were compromised, all of those receipts could be fabricated together. The installer's `expected` argument (`install-ceremony.py:24,26`) would then simply be whatever the operator typed.
- **Fix:** before any `systemctl start`, DNS, nginx or signing step, Gary opens run 38275119471 from his own device and confirms:
  - the step summary shows `artifact_sha256 d1b17742d19a1082f89f0d6bb105e69ac5a6a3da575602d6e62b883da5b94b9f` and source a9dcaca;
  - the workflow file at a9dcaca on GitHub still uses the action SHAs `11d5960a…` and `49933ea5…`.

  Record that he did. It does not need to block the inert install.
- **Unverified on my side:**
  - I cannot confirm offline that `actions/checkout@11d5960a…` is the official v4.4.0 tag.
  - The log shows a checkout input, `allow-unsafe-pr-checkout`, that I do not recognize. It may be from a release newer than my knowledge.

### F-2 · LOW (operational): the identity file is written after the irreversible rename

- **Where:** `install-ceremony.py:46-50`.
- **Failure path:** `stage.rename(target)` happens before the existence check and `os.open` of `/etc/cbob/ceremony-<commit>.env`.
  - If `/etc/cbob` is missing, or an identity file already exists, the 0555 root tree stays installed with no identity file.
  - Any retry then refuses with "Artifact already exists".
  - It fails closed, but recovery needs a manual root delete of a reviewed artifact.
- **I could not confirm the state:** Glob found no `ceremony-*` file in `/etc/cbob`, but cannot tell an empty directory from an unreadable one.
- **Fix for this operation (no code change):** immediately before invoking, check as root that:
  - `/etc/cbob` is a root-owned directory with no group/other write bit;
  - `/etc/cbob/ceremony-a9dcaca08e6db389a24333009d7008ba8c9d235d.env` does not exist;
  - `/opt/cbob-ceremony/a9dcaca…` does not exist.
- **Fix in code (later, hardening branch):** move the identity checks above the rename and create the file first.

### F-3 · LOW: the review-commit argument is not tied to the source or to `v6`

- **Where:** `prepare-ceremony.sh:10,13-15` and `install-ceremony.py:20,25`.
- **Gap:**
  - `$3` (review) is only regex-checked and passed to `git show`.
  - Nothing requires it to be an ancestor of `origin/v6`, or a descendant of `$commit`, or to differ from the source only in the attestation and audit files.
- **Why it is LOW:** integrity is pinned by the digest, so this does not change what gets installed. It only weakens the meaning of "review commit".
- **Fix for this operation:** before running, confirm `git diff --name-only a9dcaca <attestation-commit>` lists only:
  - `launch/ceremony-artifact.json`
  - `audits/rulings-2026-10-12/` evidence files and this review.

  Also confirm that `<attestation-commit>` equals `origin/v6`. The script already requires HEAD to equal `origin/v6`; the explicit argument still has to be checked by eye.

### F-4 · LOW (missing verification): the installer does not run the launcher's own verification

- **Where:** `install-ceremony.py` checks per-file hashes and provenance. It does not check:
  - the `BUILD.txt` commit and profile;
  - the README fingerprint rows;
  - the Pin-review linkage;
  - the "Unattested page file" rule (`ceremony-build.mjs:6-38,60-86`).
- **Why it is LOW:** the identical bytes passed that function off-box (`rebuild-ceremony.mjs:53`, with `requireRootOwned:false`). The checks that remain are ownership, mode and path, which only the installed copy can show.
- **Fix:** after install, run `verifyCeremonyArtifact('/opt/cbob-ceremony/a9dcaca…', 'a9dcaca…', 'd1b17742…')` once with the default `requireRootOwned:true`:
  - as an unprivileged user (e.g. `nobody`), under `env -i PATH=/usr/bin:/bin`, with `/usr/bin/node`;
  - import-only, with no listener.

  Also record:
  - `find /opt/cbob-ceremony/a9dcaca… -printf '%u:%g %m %p\n'`: every entry should be `root:root`, directories 555, files 444;
  - `stat -c '%u:%g %a'` on `/etc/cbob/ceremony-a9dcaca….env`: expect `0:0 600`, metadata only, never read the file;
  - the sha256 of `/usr/local/sbin/cbob-install-ceremony` next to the sha256 of `git show a9dcaca:web/deploy/install-ceremony.py`.

### F-5 · LOW (evidence gaps)

- **Two local builds without receipts:** `CEREMONY-ARTIFACT-STATUS.md:24-27` claims two matching same-server builds (snapshots A and B). No receipt for either is among the a9dcaca evidence files. Either add the receipts or mark the claim as unrecorded. They are supplementary, so this is not a blocker.
- **Offline log not bound to a commit:** `ceremony-offline-a9dcaca.log` has no commit or clean-tree line inside it. Only the filename ties it to a9dcaca. The hosted log does embed `source_commit` and `source_dirty:false`. Add the same header to the offline runner.

### F-6 · INFO (for the later delivery review, not this install)

- **Holder and market pages are attested and will be served.** The artifact includes the vault, claim, buy, market, account, governance, redeem and history pages. The hosted server's allowed set is every attested file (`ceremony-build.mjs:38`).
  - `BUILD.txt:4` says `collection TODO (pages refuse until set)`, so those pages are inert in this artifact.
  - The private signing host should still be considered for serving only the ceremony path and its assets.
- **A legacy nginx block sits in `sites-available`.** `/etc/nginx/sites-available/centralbankofbitcoin:110-131` has a `/initialize-979f88…` location that proxies to `127.0.0.1:8790`, the same port the new service uses, on the apex host. It is not enabled now. Make sure it is never enabled while `cbob-ceremony@` runs, or delete it during the delivery change.
- **The chain preflight is time-bound.** The preflight saw live upgrade authorities on all six programs: `bfQVv6…` on core, `FZjLB4…` on the other five. The 16:09 pass therefore says nothing about signing time. The runbook's in-window preflight remains mandatory.
- **Leftovers in the cache.** An older candidate `ec8008a8…` and a `.source-iUQ5sBER` directory remain in `.cache/ceremony-artifacts`. They are harmless, because the installer only accepts the path for the source commit.

## Confirmation of the proposed operation's limits

- **Commit and push:** commit and push only the attestation, evidence and this review, then confirm F-3.
- **Install the installer:** install exactly `git show a9dcaca:web/deploy/install-ceremony.py` as `/usr/local/sbin/cbob-install-ceremony`, owned `root:root`, mode 0755. `prepare-ceremony.sh:14` enforces the 0:0 755 mode and a byte-for-byte `cmp`.
- **Run the install:** do the F-2 pre-check, then run `prepare-ceremony.sh --install a9dcaca08e6db389a24333009d7008ba8c9d235d <attestation-commit> d1b17742d19a1082f89f0d6bb105e69ac5a6a3da575602d6e62b883da5b94b9f`.
- **Verify:** do the F-4 checks.
- **Out of scope:** no unit-template install, `systemctl`, DNS, nginx, signing, capability switch or publication.

Nothing in this artifact changes frozen programs or release-binary pins. The `cbob-release-hardening` branch is not involved.

## Still required before signing (unchanged)

- F-1, the owner's own check of the digest on GitHub.
- Private-host DNS, certificate and nginx review.
- Real systemd unit checks against the installed artifact.
- The in-window preflight.
- Fresh Brave/Phantom acceptance.
- Independent triage of this report.

Holder and trading switches stay off.
