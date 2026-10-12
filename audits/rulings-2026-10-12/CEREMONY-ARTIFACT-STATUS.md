# Signing artifact comparison, October 12

Candidate source: `a9dcaca08e6db389a24333009d7008ba8c9d235d`.
Full artifact SHA-256:
`d1b17742d19a1082f89f0d6bb105e69ac5a6a3da575602d6e62b883da5b94b9f`.

The owner manually dispatched the independently hosted reconstruction after the
server token was refused permission to start Actions. The completed run is
https://github.com/garylhenderson/centralbankofbitcoin/actions/runs/38275119471
(job `114898570405`). Its workflow and source commit both equal the candidate
commit. The workflow bytes match the reviewed YAML. Both action pins were
checked against their official v4.4.0 tags; the existing release archive expires
January 8, 2027. Standard public runner, no model calls or new artifact uploads.

The runner reconstructed dependencies from registry tarballs, recovered only
the five pinned program binaries from the existing verified archive, and built
the complete inactive artifact. It did not compile programs, sign, install or
publish. Its manifest was retrieved from the job log through GitHub. The exact
manifest bytes match the local candidate, and every one of its 35 file hashes
was checked against the local files. `launch/ceremony-artifact.json` is that
exact manifest, including its terminating newline. The comparison and trust
receipts are adjacent to this note.

Two local constructions also match: one uses the existing audited release
directory and snapshot A; another uses the recovered archive and separately
reconstructed snapshot B. These are supplementary same-server checks; the
GitHub run supplies the off-server evidence.

The clean candidate passed all 1,018 offline assertions plus 20 ballot/wallet/
recovery cases. Its actual hosted launcher rehearsal passed authentication,
origin/method restrictions, file integrity and startup refusal checks. This is
a synthetic isolated server fixture, not real nginx or owner-browser delivery.

The first fresh preflight at 16:08:10 UTC refused an independent network or
configuration read. No check was bypassed. Safe diagnostics found readable RPC
configuration and successful genesis and program observations at both providers.
The full repeat at 16:09:23 UTC passed all 35 checks. Both attempts are retained.
The passing result is preparation evidence, not the fresh signing-window or
Friday lock check.

## Proposed next operation

After Claude reviews this exact attestation and evidence, commit and push the
attestation and review. Install the unchanged reviewed installer from candidate
source as root-owned mode 0755. Use the existing `prepare-ceremony.sh --install`
with explicit candidate source, attestation commit and the GitHub digest above.
Verify all installed files, ownership and permissions. Do not start the service,
create DNS or nginx routes, sign or change capability switches in that operation.

The separate `cbob-release-hardening` branch is not merged and is not part of
this artifact. Its later review findings do not silently alter these bytes.
Future artifacts from that branch require their own fingerprint acceptance.

Private-host DNS/certificate/nginx delivery review, real service-wrapper checks,
fresh Brave/Phantom acceptance and the owner's signatures remain outstanding.
Holder and trading actions remain off. No installation or publication has yet
occurred. No OpenRouter or other model-provider fallback was used.

## Review disposition before installation

`CEREMONY-ARTIFACT-REVIEW.md` supports the narrowly scoped inactive install.
Both supplementary local build receipts have now been included. The offline
log records its passing counts but does not embed a source commit; the operator
observed it running on clean a9dcaca. Do not present it as a self-contained,
machine-bound source attestation. The hosted and chain logs do embed the commit.

Two observations in the review need correction. The Bank nginx vhost is enabled
as a symlink; the old apex ceremony route must be handled in the later delivery
change. Also, `hostedListener` in candidate source `ceremony-local.mjs` restricts
paths to the ceremony page, its app script, style, BUILD.txt and RPC. Inclusion
of the other pages in the artifact does not make them hosted-accessible. Neither
correction changes the inactive installation decision.

Immediately before install, verify the attestation tip equals origin/v6 and its
delta from a9dcaca contains only this attestation and audit evidence. Check the
target and identity file do not exist. Make `/etc/cbob` root-owned, group ubuntu,
mode 0750 so current read-only jobs retain traversal; preserve the existing RPC
and ceremony file contents. Their service-ready ownership and hosted-origin
configuration are part of the later delivery change. After install, verify all
files using the attested verifier as nobody, and check metadata without printing
environment values. No listener or service is started.

The owner has been asked to compare the full source and artifact digest on the
GitHub run summary from their own device. That confirmation is pending and is
required before activation. It does not block this inactive installation.
