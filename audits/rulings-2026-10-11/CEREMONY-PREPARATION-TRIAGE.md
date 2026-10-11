# CBOB step-10 ceremony preparation: audit report

**Scope:** `ceremony-r1-preparation.patch` (verify-ceremony.mjs, prepare-ceremony.sh, ceremony-build.mjs plus its test, the cbob-ceremony@.service unit, and the ceremony-local.mjs and nginx example deltas), `web/deploy/CEREMONY-WINDOW.md`, the `ceremony-chain-preflight.json` evidence, and the parts of ceremony.mjs, ceremony-reads.mjs and rpc-proxy.mjs that bear on the origin question. I used Read, Grep and Glob only. I made no edits and called no external services.

**Verdict:**
- **Origin:** the apex DNS-only bypass does **not** close the same-origin threat (C2), and it is concretely exploitable (F1). Do not use the apex, proxied or not, as the signing origin. Use the existing SSH tunnel (`mainnet-local`). A dedicated origin is a fallback only, and it needs new code and a new review.
- **Staging:** the artifact may be staged as a rehearsal of the procedure. It is **not** cleared as the signing artifact until F2–F5 are fixed. Those fixes change the commit anyway, so the staged directory will be rebuilt under a new commit.
- **Signing:** blocked (see the final section).

---

## F1 — HIGH, blocks signing: any script on the apex can pick the vault collection
**Files:** `web/src/pages/ceremony.mjs:44-50`, `web/src/lib/ceremony-reads.mjs:160-163`, `web/deploy/ceremony-local.mjs:115`

- **What the page does:** it treats `localStorage['cbob-ceremony-collection:<name>:<mintProg>']` as a **pin** called "this browser". The only check (line 50) is that the address exists and is owned by Core.
- **Why that is a hole before step 0:** at that point config.js, SEAL, the launch file and "this session" are all empty, so this one value is the only pin and "one pin wins" (line 163).

**Attack path:**
1. Anyone can create a decoy Core collection that names MINT's PDA, for a few cents. The code itself acknowledges this (round 37 V2).
2. Any script running on `https://centralbankofbitcoin.com` writes the decoy address under that key. That includes:
   - the site pages' inline scripts;
   - `static.cloudflareinsights.com`, which the site pages' CSP allows;
   - first-party market, account and club pages;
   - Cloudflare itself while the apex is proxied.
3. localStorage is per-origin and persistent. So the value can be planted on **any earlier visit** by Gary's Brave profile, days before the window, including while the apex is still proxied.
4. At the window, the hosted page (origin hard-wired to the apex at `ceremony-local.mjs:115`) treats the decoy as Gary's collection. It skips step 0 and offers the next steps, which bind the decoy permanently.
5. The page's `script-src 'self'` CSP does nothing here: the attacker never injects into the ceremony document, only into shared storage.

**Why the apex bypass doesn't help:** DNS-only removes the edge but leaves every other script on the origin, and storage written before the switch survives it. A second channel is also unaffected: Phantom's trust is keyed by origin, so a signing request from any page on the apex looks identical to one from the ceremony.

**Fixes:**
- Do not serve the mainnet ceremony from the apex. Use the SSH tunnel (`http://localhost:8790`, the `mainnet-local` profile, which needs no code change), in a fresh Brave profile or with that origin's site data cleared. The rehearsal used the same origin; its storage key differs, but clear it anyway.
- In `resolveCollection` / `collectionSources`, accept a remembered address only if it passes the same creator check (`creatorOf`, creating transaction signed by `initAuthority`) used for verified discovery. Otherwise drop it with a warning.
- Show the pin's source and require Gary to compare the address against the receipt he recorded out of band.

**If a dedicated origin is chosen instead:**
- `serverConfig` (line 115) and the build's CSP origins must change. That is new code and needs its own review.
- The host must serve nothing else, never be connected to Phantom for any other use, have its own certificate, and set `Origin-Agent-Cluster: ?1`.
- It adds DNS, TLS and basic-auth surface for no security gain over the tunnel.

## F2 — HIGH: the "root-owned" server runs dependency code the server user can write
**File:** `prepare-ceremony.sh:27`, which runs `sudo ln -s /opt/gary-club/node_modules "$target/node_modules"`

- `rpc-proxy.mjs:34-35` imports `@solana/web3.js` and `bs58`. In the staged tree these resolve through the symlink into `/opt/gary-club/node_modules`.
- That directory is owned by `ubuntu`, which every app and agent session on the box runs as. It is also the service's own user.
- **Attack path:** a modified module loaded at startup can patch `fs` or `http` after `verifyCeremonyBuild` has passed. It could then serve a different `app.js` together with a matching `index.html` SRI, possibly only to Gary's IP, user agent or basic-auth user, or falsify RPC reads. The startup manifest check cannot see this.
- It is also a correctness drift: the gary-club tree (bs58 6.0.0 there) is not what the ceremony server was tested against.
- **Fixes:**
  - Bundle `ceremony-local.mjs` + `rpc-proxy.mjs` with their dependencies into a single file, or vendor a lockfile-pinned `node_modules`, inside the root-owned artifact.
  - Add those bytes, plus `web/deploy/*.mjs` and `web/src/config.js`, to the manifest.
  - Verify them at startup against `git` object hashes for the commit.
  - Never symlink to a writable tree.

## F3 — HIGH: the pin guard does not run on the profile the runbook prefers
**File:** `ceremony-local.mjs:134` (`if (cfg.profile === 'mainnet-hosted') verifyCeremonyBuild(...)`)

- If `/etc/cbob/ceremony.env` sets `mainnet-local` (the tunnel), the systemd instance serves `/opt/cbob-ceremony/<c>/web/dist-mainnet-local` with **no** commit, manifest or README-pin check. The dirty-build refusal (line 141) is also skipped, and `localListener` serves any file under the root.
- **Fix:** run `verifyCeremonyBuild` for every mainnet profile whenever `CBOB_CEREMONY_COMMIT` is set or the tree is under `/opt/cbob-ceremony/`, and make the unit require it. Restrict `localListener` to manifest-listed files.

## F4 — MEDIUM: the "review-linked fingerprint" is anchored to a writable temp copy, not to git
**Files:** `prepare-ceremony.sh:11, 13, 16-19, 24, 28-31`; `ceremony-build.mjs:30-37`

- The stage lives in `/tmp` (mode 0700 but owned by `ubuntu`). Between the stage check (line 16) and `sudo cp` (line 24), any `ubuntu` process can rewrite `app.js`, `BUILD.txt` **and** `web/README.md` consistently.
- The root-owned recheck (lines 28-31) compares against that copied README. The guard's "review" test is only `/^Pin review: /m`, a line that anything can contain.
- The final check also imports the **working-tree** verifier (`./web/deploy/ceremony-build.mjs` under `/opt/cbob-vaults`), not the root-owned copy.
- **Fixes:**
  - Compare the target README bytes to `git show $commit:web/README.md`.
  - Run the verifier from `$target/web/deploy/`.
  - Bind "Pin review" to a specific review ID or hash that is checked out of band.

## F5 — MEDIUM: the build reads the shared working tree, and index.html is not pinned
**Files:** `prepare-ceremony.sh:14`; `ceremony-build.mjs:33` (only `app.js` and `assets/style.css` are compared to the README); the test fixture omits index.html deliberately (test line 259)

- **Failure path:** a concurrent session edits the tree during `build.mjs`, then reverts it, so the clean-status check at line 15 still passes. Any change to `index.html` (an extra `<script src>`, a relaxed CSP meta, a changed SRI) passes, because `BUILD.txt` comes from the same build.
- **Fix:** build from the extracted `git archive` of the commit in an isolated directory, and pin the `index.html` hash (or the whole `BUILD.txt` hash) in the reviewed README.

## F6 — MEDIUM: service identity and secret exposure
**File:** `cbob-ceremony@.service`, lines 6-10

- `User=ubuntu` means every same-UID process can read `/proc/<pid>/environ`. That exposes `CBOB_CEREMONY_PROXY_SECRET` and the provider URL from `rpc-proxy.env`, and lets those processes signal the server.
- **Fix:** use `DynamicUser=yes` or a dedicated `cbob-ceremony` user, and add `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`.
- **Note:** `EnvironmentFile=` values override `Environment=`. A stray `CBOB_CEREMONY_COMMIT` in `ceremony.env` overrides `%i`. That fails closed through the root-path check, but document it or reject the key.

## F7 — MEDIUM: the port-8790 handover can serve an unpinned build
**File:** CEREMONY-WINDOW.md, "At the approved window"

- If the old ad-hoc server still holds 8790, the new unit fails with EADDRINUSE. The tunnel or nginx then delivers the old, unpinned `/opt/cbob-vaults/web/dist-mainnet-local`.
- **Fix:** before Gary connects, assert that the 8790 listener's PID equals `systemctl show -p MainPID cbob-ceremony@<c>`, then fetch every manifest file through the actual delivery path and compare hashes.

## F8 — MEDIUM: preflight blind spots
**File:** `scripts/verify-ceremony.mjs`

- **No step state is read before step 0 (line 68):** with no collection found, no setup account is checked at all. A squatted or partly initialized collection-independent PDA (MINT, GOV or SWEEP config) would not be reported. Fix: read every setup PDA that doesn't depend on the collection and require it to be absent, or require the verdict `next`.
- **Single provider (line 32):** the preflight uses one provider read from `/opt/gary-club/.env.local`, and loads that whole secrets file into the process. The page's `/rpc` relay probably uses the same Helius account, so the "independent" byte and genesis checks share one trust root. Fixes:
  - read from a dedicated minimal env file;
  - cross-check genesis, programdata hashes and account absence against a second, unrelated provider;
  - record the slot.
- **`--after` takes the collection from chain discovery (line 41):** it should require the address Gary recorded from the step-0 receipt (an argument or the committed launch file) and refuse if they differ.

---

## Evidence: `ceremony-chain-preflight.json`
- It is complete and all 28 checks are true at commit `d151026f…`, at 2026-10-11T18:57Z, with collection null.
- **Not verified:**
  - that `d151026` contains exactly this patch (I could not run git);
  - which provider was used, and at what slot.
- Launch values were judged on today's clock, so they are **stale for a 15 October window.** The runbook must rerun `--preflight` inside the window, minutes before the first signature.
- The evidence says nothing about delivery or origin.

## Doc corrections (CEREMONY-WINDOW.md)
- **Line 27-28:** "owned by root and unwritable by the server user" and "Startup checks commit, manifest…" are untrue until F2 and F3 are fixed.
- **Line 32:** replace "A dedicated direct origin or the existing SSH tunnel is preferable" with: "The SSH tunnel is the signing path; the apex is refused; a dedicated origin requires new reviewed code."

## What blocks signing
1. F1–F5 fixed in a new commit, and the artifact re-staged from that commit.
2. A test proving the guard runs under `mainnet-local`.
3. A test proving a planted, unverified localStorage collection is refused.
4. The decisions still open in CEREMONY-WINDOW.md (D2 delivery, D10 picture, D13 royalty ratification, owner timing acknowledgement), and independent triage of this report.
5. On the day:
   - rerun the preflight against two providers;
   - check that the listener PID is the unit's MainPID;
   - compare every served file's hash through the tunnel, using an expected fingerprint delivered out of band.
6. Out of scope here: if the hosted route is ever reconsidered, the market, account and club signing pages on the apex need their own review. They share the origin with anything hosted there.
