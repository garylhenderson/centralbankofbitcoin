# Rulings Batch 1: triage report (R2 correction and naming, R1–R3 record)

**Verdict.** The site text and the R1–R3 record can be published once the Section VI dated note in F1 is added. Pinning new bundle fingerprints cannot be approved yet, because no diff and no fingerprints were supplied (B1). The later hosted ceremony rebuild (step 3) is a separate gate and is not covered here.

I made 5 reads plus targeted Greps. I did not read `rulings-batch-1-review.md`, so this report does not depend on it.

## Blocker

**B1. The batch artifacts are missing, so the ceremony changes and fingerprints can't be verified. Severity: blocks the pins only.**
- `/home/ubuntu/cbob-ecosystem-audit/rulings-batch-1.patch` is 0 bytes.
- `/opt/cbob-vaults/audits/rulings-2026-10-11/BATCH-1.md` does not exist. No path matching `*ulings*` exists under `/opt/cbob-vaults` except `launch/RULINGS-2026-10-11.md`.
- **Consequence:**
  - I can't prove by diff that the two ceremony modules changed only explanatory text.
  - I can't prove that the original P&F Section V and the numbered statement bodies are byte-identical to what was published.
  - There are no new bundle fingerprints in front of me to approve.
- **What the working tree does show:**
  - `web/src/lib/plan-ceremony.mjs:261`: the new wording sits inside a `describe:` template string. The instruction builder `build: (ids, a, v) => [IX.sealInit(...)]` on line 258 is shaped as expected, and `expectMint` at lines 167–175 still passes `bank_treasury: v.bankTreasury, split_bps: 8500`.
  - `web/src/pages/ceremony.mjs:120`: the change is in the message branch of `line(...)`. The predicate `v.bankTreasury === squadsFor(P, v)` is unchanged in shape, and `squadsFor` at plan-ceremony.mjs:150 behaves the same.
  - Nothing I saw touches instruction arguments. That is an inspection of the current text, not a diff.
- **Fix:** regenerate the patch with `git diff <published-sha> -- web/src/lib/plan-ceremony.mjs web/src/pages/ceremony.mjs web/site/...`. Write BATCH-1.md listing the old and new sha256 of each bundle file from the rebuilt `BUILD.txt`. A re-triage limited to those two module hunks is a few minutes' work. Pin only fingerprints taken from a rebuild of that exact diff.

## Findings

**F1. P&F Section VI was renamed in place with no dated entry. Severity: medium; fix before publishing.**
- `purposes-and-functions/index.html:487` now reads "Fifteen percent to the Bank’s treasury". According to R2, this text named Gary Club as first issued.
- The page's revision note at line 355 lists the level draw, the payout weight and the opening procedure, but not this change.
- The new correction at line 453 corrects "references to another recipient in the **original Section V**" only.
- The retained Section V at line 475 still says "the parent organization's compensation is addressed in Section VI". Section VI no longer mentions the parent organization.
- Section VI itself says "There is no revised schedule" (line 497).
- Owner ruling D4 does authorize current copy to say "Bank’s treasury", and the split itself is unchanged. But a silent edit in a document whose method is dated entries invites a "rewrote the record" charge.
- **Fix:** one sentence. Either extend the line 355 note ("Section VI now names the fifteen-percent recipient the Bank’s treasury; as first issued it named Gary Club."), or widen line 453 to "…in the original Section V and in Section VI as first issued…".

**F2. Who controls the "Bank’s treasury" is not stated. Severity: medium; this is an owner disclosure call, not a blocker.**
- The program comment at `cbob-vault-mint/src/lib.rs:454` says the treasury is the CBOBTC Squads.
- Original Section V (line 475) told holders that Gary Club receives the 15%. The correction now says the recipient is the Bank’s treasury and that the Section V wording is "corrected".
- A reader could take that to mean Gary Club no longer receives it. If Gary Club or Gary controls the Squads signers, the rename hides the beneficiary.
- **Recommendation:** add one line naming the treasury address and who signs for it, on P&F or on the Schedule of Vaults. I don't know who the signers are; the owner should confirm the wording.

**F3. "Charter vaults are issued at no cost" is ambiguous. Severity: low.**
- At line 452 this matches R2 word for word. But Section IV (lines 443–444) calls sale-round vaults "Subsequent Charters".
- Line 454 does narrow it to "the free charter exchange".
- **Optional fix:** "Founding charter vaults…", or "Vaults issued at the charter exchange…".

**F4. Pages use different words for the vaults that get the 85%. Severity: low.**
- `buy.html:28` says "85% to participating vaults".
- P&F line 452 and the R2 text say "activated vaults".
- Pick one word.

**F5. The rulings record was added inside `launch/`. Severity: low; please confirm.**
- `launch/RULINGS-2026-10-11.md` is new in `launch/`.
- Next-step 2 forbids editing `launch/` while the live drop-in reads from the editing checkout.
- A new markdown file is probably harmless. Confirm that the drop-in and hosted root don't list or hash every file in `launch/` (the ceremony's `BUILD.txt` "lists the sha256 of every file", per `deploy/ceremony-local.mjs:140`).

## Verified

- **R1–R3 record:** `launch/RULINGS-2026-10-11.md` matches `/home/ubuntu/CBOB-RULINGS-2026-10-11.md` word for word, plus a one-line RULED status header.
  - Epochs checked by hand: 1792170000 is 2026-10-16 17:00 UTC (12:00 CDT), and 1792429200 is 2026-10-19 17:00 UTC.
- **No date edit:** in `launch/mainnet-init.json`, `charter_opens_at` (line 68) and `lock_deadline` (line 138) are both still `null` / `OPEN`.
- **R2 content:** the correction is a separate dated `<aside>` (lines 449–455) placed above `#section-v`. All three ruled points are present.
  - The Section V body is still there (lines 456–480), including the original "Zero satoshis are paid to Gary Club" (line 463) and "Gary Club receives…" (line 475). I couldn't confirm it is byte-identical (see B1).
- **"Paid to the Bank’s revenue address" is accurate.** The mint program's split handler (`cbob-vault-mint/src/lib.rs:1009–1043`) moves revenue to the pool and to `bank_treasury`'s ATA at `split_bps` 8500. This matches `buy.mjs:69`. The split is a separate permissionless step, and the copy does not claim it happens in the same transaction as the purchase.
- **Statement 2026-3:** the dated notice at line 235 maps "the Bank" to the Bank’s treasury. The original body at line 243 is retained, and `feed.xml:121` carries the notice.
- **No other current page names the wrong recipient.** No current copy in `/opt/cbob-vaults/web/src` or `/opt/gary-club-cbob/src` names Gary Club or "the Bank" as the 15% recipient. The remaining "throwaway treasury" strings (`config.js:123`, `club-engine.cjs:126`) are rehearsal-only.

## Not verified

- **R3 CSP:** I did not open any CSP or header files. "Scope unchanged" is the batch's claim, not something I checked.
- **Other "Bank’s treasury" files:** Schedule of Vaults, `HOLDER-GUIDE.md`, `README.md` and `DESIGN-v6.md` came up in a search but were not reviewed.
- **The step-3 rebuild:** the hosted ceremony rebuild and the A3/D2 delivery concern need their own triage. They are not covered by this report.

## Recommendation

- **Publish:** proceed after the one-sentence F1 note. F2–F5 are owner calls or follow-ups.
- **Fingerprint pins:** hold until B1 is closed: regenerate the diff, rebuild, list the old and new sha256 values, and run a short targeted re-triage.
