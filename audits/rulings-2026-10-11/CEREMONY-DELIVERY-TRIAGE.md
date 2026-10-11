# Audit report: hosted step-10 signing page delivery (A3/D2)

Scope: 15 targeted reads, read-only. I read the rulings file, the audit's A3/D2/A7/A10 rows, `ceremony-local.mjs` in full, the README local-mode and hosted sections, the nginx example and the live nginx server block, `ceremony.html`, the ceremony preflight (`ceremony.mjs:30-139`), `config.js:169-173`, `reads.mjs` RPC resolution, and remediation `STATUS.md` and `DRAFTS.md`. I did not print the unlisted path, any credential, or the proxy secret. I ran nothing.

## Verdict

**The current setup (Cloudflare-proxied HTTPS plus nginx basic auth) should not be approved for signing step 10.**

- Basic auth controls who can open the page. It does nothing for the integrity of the JavaScript, which is the threat M4 names.
- With the zone proxied under Full (strict) (`sites-enabled/centralbankofbitcoin:13`), Cloudflare decrypts and re-serves every byte of the ceremony HTML and `app.js`. Anyone who can change zone behaviour is in the signing trust base: Cloudflare itself, a takeover of the Cloudflare account or an API token, or a Worker, Snippet or transform rule.
- Phantom will not decode these init instructions. So the page's JavaScript is the only thing standing between Gary and wrong immutable values.

A hosted page **can** be approved with the edge removed and an out-of-band identity check. That is set out below, and it is less disruptive than it first looks.

## M4 requirement vs owner preference

- **M4 was an explicit, code-enforced design, not just a suggestion.**
  - `ceremony-local.mjs:3-13` and README:370-375 say "never through the public site".
  - The `mainnet-local` profile refuses any extra origin with "the mainnet ceremony is reached through the SSH tunnel" (`ceremony-local.mjs:119`).
  - Round 36 Claude accepted M4 as "mitigated, not eliminated" on the basis of the tunnel.
- **`mainnet-hosted` is a later exception driven by the owner's preference** (`ceremony-local.mjs:112-116`). README:643 now just says "The hosted page trusts the Bank origin and its delivery path, as the rehearsal did."
  - The rehearsal is not a precedent. It signed throwaway programs; step 10 writes mainnet values that can never be changed.
- **D2 is still OPEN.** R1-R3 do not rule on it. DRAFTS.md:73 recommends "hosted ceremony only with the agreed edge bypass, independently checked bundle hash and immediate teardown". None of those three conditions exists today.

## Does the in-page checksum authenticate itself? No.

- The footer's `app.js sha256` (`ceremony.html:27`) is text baked in at build time (`build.mjs:139`). It arrives over the same channel as the code it describes.
- Someone who can alter delivery can serve a modified `app.js`, change the SRI `integrity` attribute to match (`ceremony.html:12`), and leave the footer showing the genuine hash.
- SRI only ties `app.js` to the HTML, and the HTML comes through the same edge. The meta CSP is also inside that HTML.
- Script running in the page also cannot vouch for its own hash.

So the audit's D2 suggestion, "make checking the published sha256 a mandatory on-page step", **does not protect against the threat it was written for.** It only catches accidental drift, such as a stale build or a cache mismatch. Real authentication needs both values to come from outside the page:
- the expected value from a reviewed artifact, delivered by a channel that does not go through the Bank's domain;
- the observed value measured by something other than the page.

## Recommended remediation (least disruptive that actually closes A3)

**1. DNS-only (grey cloud) on the apex record, for the ceremony window only.**
- The origin already serves a publicly trusted Let's Encrypt certificate covering the apex and www (`sites-enabled/centralbankofbitcoin:73-74`), renewed by HTTP-01 webroot (`:31-34`). Switching to DNS-only needs no TLS change and no code change.
- A separate DNS-only hostname would be cleaner for the public site, but would need code changes and a new review. `mainnet-hosted` hard-requires the exact apex origin (`ceremony-local.mjs:114`).
- Cost: for roughly an hour the public site loses Cloudflare caching, WAF and analytics.
- First check that nginx's `set_real_ip_from` only trusts Cloudflare ranges (still open in publisher-review.md:86-88). Otherwise direct clients could forge `CF-Connecting-IP` and dodge rate limits.

**2. Out-of-band origin identity check by Gary. This is the check that actually authenticates delivery.**
- The agent reads the SHA-256 fingerprint of the public origin certificate (the cert only, never the key) and gives it to Gary by a channel that does not touch the Bank's domain.
- In the browser, Gary confirms the padlock certificate fingerprint matches, and that responses have no `cf-ray` / `server: cloudflare`.
- This also covers a Cloudflare account takeover that flips the record back to proxied or re-points it, because Cloudflare's edge certificate would have a different fingerprint.
- Do not rely on the certificate issuer name. Cloudflare's edge can also use Let's Encrypt.
- Check the cert expiry so renewal does not fall inside the window.

**3. Box-side integrity of what is served, done independently.** This answers "is the box serving the reviewed commit".
- An independent session does a clean export of the dates commit and a fresh `--profile mainnet-local` build.
- Every file hash is compared to the served root's `BUILD.txt` and to a review-linked pin (per A10) that is committed and pushed.
- The bytes are then fetched through the origin itself (`--resolve` to the origin IP, credentials read from file and not printed) and compared again.

With 1-3 in place, the hosted page trusts the same things as the SSH tunnel (the box and its build), plus a Let's Encrypt certificate that Gary has pinned. That is defensible.

**The SSH tunnel is still the zero-infrastructure fallback.** It already works (`localListener`, tunnel origins). Offer it to Gary with this recommendation; don't drop it.

## Defects found

| # | Sev | Where | Failure path | Fix |
|---|---|---|---|---|
| H1 | High (signing blocker) | live nginx `:110-131`; zone proxied | Covered above: an edge or Cloudflare-account compromise serves altered JS, and Gary signs wrong immutable values with the real key. The footer hash cannot detect it. | Recommendations 1-3, plus the D2 ruling. |
| M1 | Medium | `ceremony-local.mjs:41,116` | The served root is `/opt/cbob-vaults/web/dist-mainnet-local`, i.e. the editing checkout, read on every request. If another session commits and rebuilds (for example with a different launch file), Gary is served the new bytes mid-ceremony. The dirty check (`:81`) only catches *uncommitted* builds. Rebuilds are also non-atomic. | Serve from an immutable, root-owned staged copy of the reviewed commit. Pin that commit in the unit's environment and refuse if `BUILD.txt`'s commit differs. This matches the ruling's own "do not edit `launch/` while the live drop-in reads it" warning. |
| M2 | Medium (needs checking) | `web/src/lib/reads.mjs:159` | `connect()` correctly resolves `../rpc` under the unlisted path (`:19-20`). But `das()` resolves `same-origin:` to `location.origin + '/rpc'`, the **public** root `/rpc`. Under the tunnel these are the same server; hosted, they are not. Today `/rpc` returns 404. After go-live step 5 it would be a different relay with a different collection requirement. If any ceremony path (collection discovery, NFT check) calls `das()`, the hosted ceremony either STOPs or quietly depends on the public relay. I did not confirm whether the ceremony calls `das()`. | Use the same `new URL('../rpc', location.href)` rule in `das()` for `mainnet-local`, and add a test that drives it with a nested path. |
| M3 | Medium (missing verification) | `ceremony.mjs:74-77` | `walletRefusal` runs **before** preflight, so only Gary's launch wallet can ever see READY. "Rebuild so it reads READY" (ruling step 3) cannot be confirmed by the agent through the page. Gary would be the first to see the live preflight over the hosted path. | Before telling Gary, run the same judges from the box in node: `check-launch-params` against mainnet at the chain clock, program-byte comparison against the chain, genesis, and the collection scan. Record the output as the "dates-ready" evidence. |
| M4 | Medium (missing verification) | step 10 → step 11 | The page's "re-reads the chain and stops" step is the same JavaScript that may be compromised. No independent read-back of the step-10 accounts against `launch/mainnet-init.json` has been prepared for use before the step-11 lock. | Write a committed, read-only box-side verifier using the provider RPC (not the page). Run it after each step or at least after step 10, and make a clean result a precondition for step 11. |
| L1 | Low | live nginx `:122` | `Cache-Control: no-store` without `no-transform`. While proxied, Cloudflare features (beacon injection, Rocket Loader and similar) may rewrite the HTML. | Add `no-transform`. This matters less once the record is DNS-only. |
| L2 | Low | A7 | The ceremony is still an ad-hoc process with no teardown. | Run it as a transient systemd unit. Right after step 10: remove the location, include, htpasswd and `/etc/cbob/ceremony.env`, then reload nginx and re-enable the Cloudflare proxy. |
| L3 | Low | live nginx `:102` | When the placeholder was filled in, the real unlisted path was also written into the comment line. This is not public, but it spreads the slug. Separately, G-C8: the README names a different path. | Put the comment placeholder back. Keep the hosted slug out of docs. |
| L4 | Low | README:394-415 | The pinned `mainnet-local` ceremony hash is from before the dates. It will change once the dates are written. A10 notes the pins used to be rewritten automatically. | Re-pin after the dates commit through the review-linked step. Gary compares against a pin he receives out-of-band, not the README served from the Bank's domain. |

## What must be true before Gary hears each status

**"Dates-ready"** (the page will show READY to his wallet):
1. The dates are written to `launch/mainnet-init.json` as RULED, quoting R1, via the approved install, and `check-launch-params.mjs` leaves only `vault_collection` OPEN.
2. A clean `mainnet-local` build of that commit is in an immutable served root pinned to that commit (M1), with a review-linked pin (L4).
3. The box-side preflight equivalent passes (M3).
4. M2 is resolved or shown not to apply.

**"READY TO SIGN"** (everything above, plus):
5. **Gary rules on D2.** The tunnel stays on offer.
6. The DNS-only window is scheduled with a revert plan, `set_real_ip_from` is checked, and the origin cert fingerprint and expiry are delivered out-of-band (recommendation 2).
7. The independent served-bytes check passes through the origin (recommendation 3).
8. The post-sign verifier is ready and is a gate for step 11 (M4).
9. The teardown plan (L2) is ready to run straight after step 10.
10. The basic-auth credential is delivered out-of-band.
11. **Owner acknowledgement:** signing step 10 on Tue/Wed permanently writes the 10-16 lock deadline and the 10-19 charter date. R1's 24-hour suite against the live Core bytes only runs afterwards. Gary should be told plainly what happens if R1's conditions fail after he has signed. I did not check how the program treats a lock deadline that passes without a lock.

## Not verified in this pass

- The live Cloudflare proxy status and settings: the analytics injection mode, and whether any Workers or rules exist on the zone.
- Whether `das()` is reached during the ceremony.
- How the running process was started and what root it is serving.
- The live nginx real-IP configuration.
- The origin certificate's expiry.
- Whether the repo's published pins are reachable over a channel independent of the Bank's domain.
