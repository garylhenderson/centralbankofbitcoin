**V47-1: LOW.** The README facts check counts untracked `audits/roundN` directories, so the 487a8b4 certifying suite stopped before its on-chain arms (V47-1, V47o-4). `readme-facts.mjs:96` (`all` = every directory on disk); `run-tests.sh:420` (`--check` fatal before detector floors, probe, `[7/7]`). Measured on a copy: untracked directory exits 1; clean exits 0. **Class: none.** Tooling.

**Repair:** count only tracked rounds (`git ls-files audits/`) or rounds with both verdicts; run README check after on-chain arms. One selftest arm: untracked empty `roundN` leaves `--check` green.

**V47-2: LOW.** `REQUIRES CHANGES: NONE` reads as owing repairs (V47-2, V47o-5). `readme-facts.mjs:92` (`/^REQUIRES CHANGES: \S/m`; `NONE` matches `\S`). Measured: two verdicts headed LAUNCH-CLEAN with `REQUIRES CHANGES: NONE` generate "yes, repairs not yet validated". **Class: none.** Repair: `/^REQUIRES CHANGES: (?!NONE\b)\S/m`, selftest for NONE/list/no line.

**V47-3: LOW.** Suite arm R.4 cannot see seven plugin kinds (AgentIdentity included). `tests/3prog.test.ts:468` regex over fetched keys; against mpl-core 1.10.0, seven never match. On-chain floor 912→913. **Class: none.** Test. **Repair:** assert raw registry (1 plugin, Royalties, 0 external) or enumerate SDK keys; red with omitted kind on control.

**V47-4: LOW.** Ceremony page gives wallet-edit judge no compute floor. Judge allows wallet budget only if `opts.minUnits` set (`tx.mjs:134`); ceremony dry-runs (`ceremony.mjs:224`) but calls `signExact` without it. Measured: limit 1 accepted. **Class: none.** **Repair:** pass `{minUnits: pageUnits(sim.unitsConsumed)}` from step dry run; one `ceremony.test.mjs` arm.

**V47-5: LOW.** Judge does not refuse wallet-removed writable/signer. `sameIx` compares program/data/addresses but not flags (`tx.mjs:84-85`); `roles` refuses only added (`:125-126`). Measured: writable-to-readonly passes. **Class: none.** **Repair:** compare sets both directions; one `tx.test.mjs` arm.

**V47-6: INFO.** README says SEAL holds and BURN pays out reserves. `README.md:101` ("holds each vault's reserves"), `:103` ("pays out its reserves"). Reserves in Core asset-signer PDA; SEAL holds seal; BURN proves emptiness (`burn/src/lib.rs:325-391`); helper moves value (`sweep/src/lib.rs:52-75`). **Class: none.** Docs. **Repair:** strings in `readme-facts.mjs:28,30` ("keeps each vault sealed..."; "opening a vault: proves it empty..."); regenerate.

**V47-7: INFO.** README shows road step 8 "done" without 22.2 FAIL. SPEC row says "done... 22.2 recorded FAIL"; generator keeps pre-colon text (`readme-facts.mjs:111-113`). **Class: none.** Docs. **Repair:** carry qualifier ("done... 22.2 FAIL (true detection), scale not exercised").

**V47-8: INFO.** SPEC 53 says rehearsal "has not yet run to its end". `RECORD.md` records every step done; SPEC road row says done. Round 46 V46-7 precedent. **Class: none.** **Repair:** strike sentence; keep "every repair commit needs same in-tree run" (last `e7c192a`).

**V47-9: INFO.** Proxy header says "eight exact filtered shapes". `gpaShape` accepts five (`rpc-proxy.mjs:65,76-104`); round 46 moved token reads. **Class: none.** **Repair:** "five".

**All outside (a)-(d):** none in programs, no value path, no refused crack, no HIGH/MEDIUM. Round 46 programs repairs hold at every site checked.

**Quorum met (7/8 counted, 6 required). LAUNCH-CLEAN.** No confirmed finding in (a)-(d). REQUIRES CHANGES: V47-1..9 (all LOW/INFO, outside programs; none blocks launch). Not no-change round.

**Repairs hold:** V47-1..9 and V47o-1..9 verified at all sites, no regressions; re-tested claims they disproved. No re-filed old claim without surviving defect.

**Suite, simulation, build as evidence:** all arms exercise claims; no arm cannot fail or negative fires for wrong reason; no unexercised claim; mainnet bytes proven (build-mainnet.sh, verifiable-build workflow). 

**Accepted limits:** none worse than stated, none closed, all discharged items discharged, none in OPEN AND BLOCKING treated as accepted.

**GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?**

1. **Run the full certifying suite (913 on-chain + 1081 detectors + 805 web + 152 e2e + 71 sim + 69 launch + 35 mainnet probe + 16 swap fork) inside the recorded rehearsal tree at the final commit** (item 53, last proven `e7c192a`; every commit since needs it). The rehearsal tree substitutes throwaway ids; the gate proves the difference is exactly the recorded map (reverse recreates RELEASE_COMMIT bytes, keyed programs patched). This is the only way to certify the shipped off-chain code unchanged against the final on-chain tree.

2. **Have Gary sign road step 10 on the hosted rehearsal signing page** (the page built from the rehearsal profile with the filled `launch/rehearsal-init.json`, the five throwaway ids, and the shipping bytes pinned). The driver waits and reads back; it never signs on mainnet. This proves the page, the relay, and the ceremony contract with a real wallet.

3. **Deploy the stripped release build (`d2ae5fc`, verifiable-build workflow on GitHub's runner reproduces it) to the five ids, verify each on-chain (solana-verify parameters uploaded by the upgrade authority), then remove every upgrade authority.** The alarm must page any still upgradeable past the lock date. This is the only way to certify the exact bytes on chain match the audited, stripped release.

4. **Publish the holder pages (`/vault/`, `/redeem/`, `/claim/`, `/buy/`) and run the metadata generator cron.** Item 50 is OPEN AND BLOCKING; the guide may not be published before. The pages must run `judgeRedemptionCoverage` before the holder signs and sweep through the helper.

5. **Run one full live revenue cycle through each pinned pool (Orca first, Meteora only on real refusal) and one forced post-sweep failure walked through the hand recovery, with the alarm live in rehearsal mode.** Item 22 stays OPEN only for ~2,100-vault scale; these named items must PASS.

These are concrete, mechanical acts no AI round can perform: they require a live mainnet deployment, a real wallet signing on the page, and the exact bytes on chain matching the audited release. The AI process certifies the tree up to the freeze; these close the loop.