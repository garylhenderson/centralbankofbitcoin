# Inactive artifact installation, October 12

Installed source: `a9dcaca08e6db389a24333009d7008ba8c9d235d`.
Attestation commit: `9998c9f6ed5670951619fc092c9ca3120c826491`.
Independent GitHub artifact digest:
`d1b17742d19a1082f89f0d6bb105e69ac5a6a3da575602d6e62b883da5b94b9f`.

The explicit attestation commit equaled the pushed origin/v6 tip immediately
before installation. Its delta from the candidate contained only the eleven
attestation/evidence files. The installer source was byte-identical to a9dcaca.
The candidate target and identity file were absent before installation.

`/etc/cbob` is now root:ubuntu 0750. Existing RPC and ceremony environment file
contents and file ownership were preserved. Their later service-ready ownership
and private origin settings remain outstanding. The directory permits the
existing ubuntu read-only jobs to traverse it.

Installed `/usr/local/sbin/cbob-install-ceremony` as root:root 0755. Its SHA-256
equals both the source file and the candidate's committed installer:
`ef30b624f2395ce7ea301b48e67616d7ef672f580b988f970528064cfa4cd623`.

Ran the committed `prepare-ceremony.sh --install` with the three explicit
identities above. It installed `/opt/cbob-ceremony/a9dcaca08e6db389a24333009d7008ba8c9d235d`.
Post-install verification established:

- 36 regular files, including ARTIFACT.json, are root:root mode 0444.
- All 15 artifact directories are root:root mode 0555, with no symlinks.
- The source-specific identity file is root:root mode 0600. Its contents were
  never printed.
- The attested `verifyCeremonyArtifact` passed with default root-ownership
  enforcement, imported by `/usr/bin/node` as nobody (uid 65534) under
  `env -i PATH=/usr/bin:/bin`. It verified all artifact hashes, provenance,
  fingerprints, source identity and 26 attested page files. No listener started.

The existing port-8790 listener remains PID 640933. No unit template was
installed, no service started, and no DNS/nginx or public publication changed.
Holder and trading switches remain off. The owner's independent GitHub digest
confirmation is still pending before activation. Real private-host delivery,
Brave/Phantom acceptance, in-window chain checks and owner signatures remain.
