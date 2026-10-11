# Step 10 signing window

Status: prepared workflow, not permission to sign. D2 delivery, D10 picture,
D13 royalty ratification and owner timing acknowledgement remain pending.
Never turn a passing dates check into a claim that the hosted path is approved.

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
   This builds from an isolated checkout and bundles the server dependencies.
   Review the candidate ARTIFACT.json, which covers HTML, scripts, styles, the
   server bundle and bootstrap. Commit its exact bytes as
   `launch/ceremony-artifact.json`, with the Claude review, and push. Then run
   `prepare-ceremony.sh --install <source-commit>`. The root installer reads the
   attestation from that committed git object, verifies each copied byte and
   writes a separate root-only expected digest. No writable dependency symlink
   is installed. The dynamic-user service checks the full artifact before it
   executes the server bundle. Nothing starts a service or changes DNS.
4. Review the delivery trust boundary explicitly. The public apex is refused, proxied or not. The prepared hosted profile
   accepts only `https://sign.centralbankofbitcoin.com`, with DNS-only delivery,
   its own certificate, no other content and Origin-Agent-Cluster. The existing
   SSH tunnel is the fallback. Do not create or activate the new hostname until
   this change passes Claude review and Gary rules D2. Browser memory is now only
   accepted after verifying the collection was created by the launch key.

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
- Send the credential through the established secure channel, never a text.
  Open in Brave with Phantom. Only the ruled launch wallet passes the page gate.
- Use `Cache-Control: no-store, no-transform`; never add analytics to this page.
- The owner signs each displayed step. Record the real collection address after
  step 0, then re-read all setup accounts independently.

## After signing

Run `node scripts/verify-ceremony.mjs --after <recorded-collection>` from the reviewed source.
The address must come from the owner's step-0 receipt or the committed launch file,
not browser storage or discovery alone. It must report every step done and every immutable field matching. Missing,
conflicting or partly initialized accounts fail. Preserve the public receipt.
Record the collection in launch/config, review the resulting build, and repeat
the full R1 checks against the exact live Core before any lock.

Stop `cbob-ceremony@<commit>.service`. Remove the dedicated signing vhost after
validating its replacement/absence; no public Bank vhost is changed. Remove the one nginx ceremony location
(identified by its dedicated upstream and authentication file, never by a broad
directory wipe), validate with `nginx -t`, then reload. Remove its dedicated
proxy-secret include, htpasswd and ceremony environment file after the route is
gone. Keep the shared RPC environment file. Check the private URL now refuses
access and port 8790 is closed. Restore the prior DNS proxy setting if changed.
Keep the root-owned artifact and private backup as audit evidence.

No step here enables claims or trading, initializes by command line, or removes
an upgrade authority. Step 11 remains a separately authorized irreversible act.
