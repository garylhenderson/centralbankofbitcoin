**APPROVE** the check record and presenting these drafts to the owner for exact-copy approval, with three narrow, non-blocking corrections. This is a read-only document and evidence review. I ran no tests, and it grants no publication or release authority.

**Evidence categories are kept distinct.**
- `PREOPEN-CHECKS-2026-10-13.md` separates live read-only probes, synthetic tests, the earlier rehearsal and the owner's own words. It also says the rehearsal is not Thursday certification.
- The owner's statement is limited to successful login. The three browser checks (wallet comparison, signout/re-entry, public-page Phantom) are listed as pending, and `preopen-live-verification.json` records `expected_wallet_and_signout_acceptance: false` and `holder_or_trading_release: false`.
- The counts match the artifacts I read:
  - **Offline log:** 1153 assertions in 21 files, plus 87 cases.
  - **Live verification:** 29 checks, all passing.
  - **Rehearsal continuity:** 913, 16, 71 and 160, marked "REHEARSAL ONLY… no validator rerun".
- I did not open the other preopen logs or the five-probe and fee artifacts. I did not recompute any log hashes.

**The drafts match the source rules.**
- **Charter dates:** `mainnet-init.json` has the charter opening at 1792429200 (October 19, 17:00 UTC, noon CDT) with a 604800-second window. That closes October 26 at noon.
- **Lock:** the lock deadline is 1792170000 (October 16, noon CDT) and is off-chain. It is conditional on a fresh full suite against live Core within 24 hours. The drafts say "targeted" and "conditional", and "the programs will not be locked" on failure.
- **Payout timing:** `DESIGN-v6.md` lines 175-178 give no credit before close + 30 days and the first free payout at close + 60 days. Around November 25 and December 25 are correct for an October 26 close. The 100 $GARY burn "sooner" wording is consistent with that.
- **Other rules:**
  - The 21,000-sat deposit matches the rulings.
  - The 2.1% per hour opening limit matches `HOLDER-GUIDE.md`.
  - Redeem-page-only opening and Gary Club key custody match the guide.
  - Governance with all-or-split voting matches `RULINGS-2026-10-12.md`.
- **Style and length:** the drafts contain no em dashes, en dashes or " -- ". I counted the X post at about 257 characters with the full URL, so it is under 280, and lower still with X's 23-character URL weighting. The chairman voice and sign-off are intact.

**Narrow corrections, none blocking:**
1. **Standard wallet connection:** the holder notice says "standard wallet connection is also available" and the Chairman statement says to "connect the wallet that holds your Proof of Burn." The public-page Phantom check is still pending. Either hold publication until the owner reports that check, or say "available" only after it passes. The claim page does show the wallet choices, so this is a publication-time gate, not a wording error.
2. **Release status at publication:** the drafts tell holders to use the claim page, and both financial switches are off. At publication, confirm the claim page's visible status doesn't contradict "prepare". The notice already says "Claims and trading have separate release checks", which covers this.
3. **Evidence note:** `bank_source` in the live verification JSON is `2beafb3a…`, and the rehearsal's `source_commit` is `92197156…`. Neither is the 10807b1 under review. Add a line saying 10807b1 changes only documentation and drafts, so the commit mapping is auditable.

Exact-copy approval from the owner is still pending, and this review does not grant it.
