# Step 10 signing window

Status: Gary approved building the direct hosted page, the collection image and
royalty, and will personally sign all transactions (launch/RULINGS-2026-10-12.md).
Technical delivery, independent rebuild and exact-artifact checks remain required.
Never turn policy approval or a dates check into a claim the page is ready.

## What is permanent

MINT initialize writes the charter opening, 19 October 2026 noon Austin time,
permanently. The lock target, 16 October noon Austin time, is off-chain alarm
configuration. The charter claim instruction has a date gate and no guardian
pause gate. Turning off Gary Club does not stop direct on-chain claims.
If the later R1 check fails, do not lock. An initialized charter date cannot be
postponed by switching the website off. Recommendation sent to Gary: sign after
the fresh full test on Thursday 15 October, keeping Friday's lock target.

## Preparation

1. Commit and push a Claude-reviewed clean source. Run the offline web suite and
   launch selftest; explicitly accept reviewed fingerprints from fresh builds.
2. Run `node scripts/verify-ceremony.mjs --preflight`. It uses the dedicated minimal RPC configuration, never the Gary Club secrets
   file or a browser page. An unrelated public provider must agree on genesis,
   program bytes, authorities and setup-account state. It checks the real launch judge at both
   clocks, collection identity, genesis, audited program bytes, harmless unsigned
   probes and reserve mints. No key is read, signature made or transaction sent.
3. Run `bash web/deploy/prepare-ceremony.sh --build <full-reviewed-commit>`.
   This invokes the same portable builder used off-box, from the clean reviewed source, with a minimal child environment and frozen dependencies.
   Review the candidate ARTIFACT.json, which covers HTML, scripts, styles, the
   server bundle and bootstrap. Commit its exact bytes as
   `launch/ceremony-artifact.json`, with the Claude review, and push. Install the
   reviewed installer as root-owned mode-0755 `/usr/local/sbin/cbob-install-ceremony`.
   After an independent rebuild and out-of-band comparison, run
   `prepare-ceremony.sh --install <source-commit> <review-commit> <independent-artifact-sha256>`.
   Never derive those last two arguments from HEAD automatically. The root installer reads the
   attestation from that committed git object, verifies each copied byte and
   requires the independently supplied digest and writes a root-only expected digest. No writable dependency symlink
   is installed. The dynamic-user service checks the full artifact before it
   executes the server bundle. Nothing starts a service or changes DNS.
4. Review the delivery trust boundary explicitly. The public apex is refused, proxied or not. The prepared hosted profile
   accepts only `https://sign.centralbankofbitcoin.com`, with DNS-only delivery,
   its own certificate, no other content and Origin-Agent-Cluster. The existing
   SSH tunnel is the fallback. Do not create or activate the new hostname until
   this change passes Claude review. Gary has now ruled D2. Browser memory is now only
   accepted after verifying the collection was created by the launch key.

5. Run `sudo --preserve-env=CBOB_BUILD_DEPS,CBOB_BUILD_DEPS_SHA256 /usr/bin/node web/deploy/ceremony-hosted-rehearsal.mjs` from the
   reviewed source. It builds as the invoking user, creates a temporary
   root-owned synthetic artifact, and runs the real launcher and bundled hosted
   server as an unprivileged user. It checks authentication, served bytes,
   unlisted-file refusal and startup refusal after tampering. It uses no real
   wallet, RPC credentials, DNS or production service. This is a startup-path
   test; the real nginx, certificate and owner-browser checks below remain required.
   The systemd wrapper (environment checks, stripping, sandbox and expiry) is also
   not covered here. Re-run on the exact clean source commit after any launcher,
   verifier, listener, relay or bundler change; keep the commit and hash-bearing
   log with the review. `--development` permits work-in-progress checks but never
   satisfies this release gate. V2-7 stays partial until the real unit and nginx
   delivery checks pass against the installed artifact.

### Trust boundary and remaining delivery gate

The ubuntu operator has unrestricted passwordless sudo on this box. Root-owned
artifacts and DynamicUser isolate normal services and prevent accidental edits;
they cannot protect against a malicious ubuntu/root operator. An attestation
created and reviewed only on this box is not independent evidence against that
threat. Before signing, rebuild independently off-box or as a separately trusted
operator, compare the complete artifact and deliver the expected digest outside
the Bank website. Until that comparison and the technical delivery checks are satisfied, candidates are
inert preparation, not an approved signing delivery.

The signing build now uses `launch/build-dependency-lock.json`: exact registry
versions, tarball SHA-512 integrity, the consumed dependency file hashes, the
Node/esbuild versions and the full snapshot-manifest digest. Reconstruct it in
an isolated directory with the reviewed script; this downloads only public npm
registry tarballs and never runs npm or lifecycle scripts:

```
mkdir -m 700 /scratch/cbob-signing-work
env -i PATH=/usr/bin:/bin python3 -I -B web/deploy/freeze-build-deps.py --out /scratch/cbob-signing-work/deps launch/build-dependency-lock.json
export CBOB_BUILD_DEPS=/scratch/cbob-signing-work/deps
export CBOB_BUILD_DEPS_SHA256=8b6263c38564d9ae4197f80d305324d569d4f6af45190e7e34146640c0038e94
```

Use the exact Node version in the lock on Linux x64. Existing output directories
are never replaced. The script validates tarball integrity, rejects redirects,
links and unsafe archive paths, checks package identity and consumed file hashes,
then refuses if the reconstructed manifest differs from the committed digest.
The resulting tree has no symlinks and is read-only. Each frozen build verifies
its complete file/directory set and bytes and refuses hardlinks before loading
esbuild; provenance generation checks again after bundling. The browser and server resolve packages inside
this snapshot, never through the live Gary Club dependency tree.

`prepare-ceremony.sh --build` and `update-web-hashes.mjs --accept-reviewed`
require that snapshot and its committed digest. Ordinary development builds
can still use the existing dependency tree, but cannot authorize fingerprints
or a signing artifact. The installer compares the artifact lock to the committed source object; the installer and launcher both reject missing, installed-mode, mismatched or unpinned provenance. The candidate includes both `page-build-inputs.json`
and `build-inputs.json`; each lists source/dependency hashes and package
provenance. The full artifact attestation covers both records. No dependency
installation or change to Gary Club's live node_modules is required.

A second same-box registry reconstruction is a reproducibility check, not the
independent operator/off-box check above. The independent rebuilder obtains the
committed lock and source through its trusted channel, fetches packages directly
from the registry with the same integrity checks, compares all artifact bytes,
and supplies the digest out of band. A changed dependency pin needs a fresh
source/bundle review and fingerprint acceptance. Node itself must come from the
rebuilder's trusted toolchain; matching its version alone is not its provenance.

### Portable off-box reconstruction

`rebuild-ceremony.mjs` takes four paths: the clean reviewed source, frozen
snapshot, verified release `dist` input, and a NEW output directory. It runs
children with a minimal environment, requires frozen mode explicitly, validates
the reviewed fingerprints and emits a fully attested but inactive artifact.
No server paths, sudo, GitHub credentials or chain connection are required.

The release binaries are inputs, not rebuilt programs. Obtain the existing
verified build archive from GitHub artifact `11672956089` (run `38059530380`,
source `a30924c7f6fb1fc7b54043c3975a56a0f5465ab2`). Treat it as untrusted:
produce the pins JSON from the reviewed source's `PROFILES.mainnet.programBytes`
and `RELEASE_COMMIT`, then run `python3 -I -B web/deploy/recover-release-dist.py
<pins.json> <archive.zip> <new-dist>`. That helper reads exactly the five known
files without extracting paths, verifies every size and SHA-256 against source,
and never compiles or executes a program. The builder checks those pins again.
If that artifact expires, obtain another copy of the same audited bytes and
review the retrieval path; never replace the program hashes to make it pass.

```
env -i PATH=/usr/bin:/bin /path/to/trusted/node web/deploy/rebuild-ceremony.mjs   /path/to/reviewed/source /path/to/frozen/deps /path/to/verified/dist /path/to/new/artifact
```

The manual-only `.github/workflows/ceremony-rebuild.yml` performs this on a
standard GitHub runner from an explicit full source commit. It uses pinned
checkout/setup-node actions, read-only permissions, fresh registry downloads,
and the existing release artifact. It writes the artifact digest and file
hashes to the run log/summary, with no uploads, caches, model calls, signing or
deployment. No workflow is triggered just by pushing source. Once fingerprints
are reviewed, run it for the exact signing build commit, compare every manifest
entry and the digest with the local candidate, and preserve its GitHub run URL
and digest outside the Bank website. The owner can verify that independent
channel before installation/signing. Real nginx and owner-browser delivery
checks remain separate even when the off-box artifact matches.

## At the approved window

- Re-run the preflight within the signing window, minutes before the first signature.
- Independently rebuild the same commit and compare every served file to the
  staged manifest. The expected fingerprint must come through a channel other
  than the Bank website; a hash printed by the page cannot authenticate itself.
- Verify the origin's public certificate fingerprint and expiry independently.
  Do not rely on its issuer name. Re-check immediately before connecting.
- Check real-IP trust is confined to the published edge ranges. The current
  configuration has explicit ranges, no trust-all range. If direct-origin DNS is
  chosen, test direct delivery, absence of edge headers, certificate identity and
  authenticated bytes from the actual owner browser. Prepare a DNS rollback.
- Install `cbob-ceremony@.service`, start only the reviewed instance, and verify
  its root and authenticated response hashes. It reads existing root-managed RPC
  and ceremony environment files, listens only on loopback, and expires after
  90 minutes. Never enable it at boot. Stop the old ad-hoc process only after
  identifying it as the old ceremony server; do not kill unrelated listeners.
  Assert that the actual port-8790 listener PID equals the unit MainPID. Fetch
  every manifest file through the actual owner delivery path and compare bytes.
  Use a fresh Brave profile; the signing origin must never host other content.
  Environment files must be root-owned and not writable by other users. The RPC
  file may be root:ubuntu 0640 for the unprivileged independent reads. The unit
  strips Node injection variables and checks file ownership before starting.
- Send the credential through the established secure channel, never a text.
  Open in Brave with Phantom. Only the ruled launch wallet passes the page gate.
- Use exactly one signing origin for the whole ceremony. Never open the hosted
  page and an SSH tunnel page at the same time: browser locks and saved pending
  receipts are scoped to one origin and cannot coordinate between those origins.
- Use `Cache-Control: no-store, no-transform`; never add analytics to this page.
- The owner signs each displayed step. Save both the collection address and
  step-0 transaction signature outside the browser. The page shows that receipt
  before sending the transaction. A signature by itself does not prove success:
  the recovery path fetches the exact successful finalized transaction. If the
  page is reloaded, use its receipt recovery controls instead of creating another
  collection. Then re-read all setup accounts independently.

## After signing

Run `node scripts/verify-ceremony.mjs --after <recorded-collection> --creation-signature <step-0-signature>` from the reviewed source.
The address must come from the owner's step-0 receipt or the committed launch file,
not browser storage or discovery alone. It must report every step done and every immutable field matching. Missing,
conflicting or partly initialized accounts fail. Both independent providers must
confirm the exact creation receipt; unrelated transactions added to the address's
history do not affect that check. Preserve the public receipt.
Record the collection in launch/config, review the resulting build, and repeat
the full R1 checks against the exact live Core before any lock.

Stop `cbob-ceremony@<commit>.service`. Replace the dedicated signing vhost with a
TLS refusal-only vhost before removing its DNS record. Keep that refusal vhost
through DNS cache expiry (or indefinitely), so a cached signing hostname cannot
fall through to the public Bank site. No public Bank vhost is changed. Remove the one nginx ceremony location
(identified by its dedicated upstream and authentication file, never by a broad
directory wipe), validate with `nginx -t`, then reload. Remove its dedicated
proxy-secret include, htpasswd and ceremony environment file after the route is
gone. Keep the shared RPC environment file. Check the private URL now refuses
access and port 8790 is closed. Restore the prior DNS proxy setting if changed.
Keep the root-owned artifact and private backup as audit evidence.

No step here enables claims or trading, initializes by command line, or removes
an upgrade authority. Step 11 remains a separately authorized irreversible act.
