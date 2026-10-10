**Round 47, off-chain pass: LAUNCH-CLEAN; QUORUM MET. REQUIRES CHANGES: V47o-1 to V47o-9.**

**Seats counted: 7 of 8 (6 needed):**
- first runs: Sonnet 5.5, GLM 5.3, Fable 5.1, Qwen max;
- re-runs (same head and prompt): Muse, Qwen 2.4T, MiMo.

**Not counted:** Longcat. Its only finding is round 46's already-repaired SPEC sentence, and it invents a `nestedSent` flag in the crank.

**Confirmed, all outside (a)-(d):**
- **V47o-1, LOW (Core watch):** a passing diagnostic suite writes invalid JSON (`"0\n0"`), so no PASS email is sent and the suite restarts every tick. A failure with no `XX` line never sends FAILED. Measured.
- **V47o-2, LOW (runners):** the watch's validator lock is honoured by nothing else. Any runner's EXIT trap kills the diagnostic and triggers a false URGENT FAILED, and `run-tests.sh:193` asserts "pinned" unchecked.
- **V47o-3, LOW (SPEC/README):** items 22 and 53 are stale against the rehearsal, 22.2's FAIL has no ruling, and the README road row reads "done".
- **V47o-4, INFO (session claim):** readme-facts counts untracked round directories, so `run-tests.sh` stops mid-audit. Measured.
- **V47o-5, INFO (triage):** readme-facts would publish "REQUIRES CHANGES: NONE" as "yes, repairs not yet validated". Measured.
- **V47o-6, INFO:** the Core watch is hand-installed, with no flock and no deadman.
- **V47o-7, INFO:** a second Core change drops the first result.
- **V47o-8, INFO:** the offline mock lacks `getTokenAccountsByOwner`. Measured.
- **V47o-9, INFO:** README's reproduce order fails on a clean clone.

**Disproved or already stated:**
- Muse's MEDIUM (`host_fee_in`: limit 10(c), settled since round 36);
- MiMo's reveal-run LOW (design);
- Fable's `NoActiveVaults` race (round 31);
- Longcat's stale-SPEC LOW (repaired).

**Rounds 42-46:** all 51 confirmed findings remain outside (a)-(d). Round 46's off-chain repairs hold; V46o-1's arm is red under its mutant.

**Selftests:** 1072, 801, 69, 24, 39 and core-watch 18, all green.

**Gate-5 obligations (all discharged):** V47o-1 to V47o-9 with arms 1-8 (each shown red at `487a8b4`), plus V47o-3/V47o-9 text. No (a)-(d) findings; launch-clean under SPEC gate 3.

**What this project should do before launch that AI audit structurally cannot:** 
- Run the full certifying suite (913 on-chain + 1081 detectors + 801 web + 69 launch + 39 allocation + 24 poster + 4 expiry + 35 mainnet + 16 swap-fork) on a **fresh mainnet fork** with real cbBTC/$GARY/$GIRAFFISH and two real PoB assets (not synthetic genesis), including one full revenue cycle through both pools and one forced post-sweep failure walked through hand recovery (item 22.3/22.4). This is the only way to exercise the 2,100-vault scale, the real RPC, and the alarm's full I/O (backlogs, gaps, unreadable signatures, log truncation, the revenue ledger walk). The current suite uses a local validator with cloned state; it cannot catch RPC-specific failures or scale-dependent races.
- Deploy to a **staging cluster** (not mainnet) with the exact release build (`d2ae5fc`), run the full rehearsal (item 22) end-to-end with real amounts, then lock the programs and re-run every test against the immutable binaries. AI cannot execute on-chain or measure post-lock behaviour.
- Have a human review the **final README, HOLDER-GUIDE, and SPEC road row** (after V47o-3/V47o-9) for buyer-facing accuracy, then publish the pages and run a live dress rehearsal with real holders (item 50). AI cannot own the product narrative or the final "this is what you bought" contract.