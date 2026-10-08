# Round 37, PROGRAMS pass: NOT CLEAN; QUORUM MET

**Independent triage verdict against audited HEAD `0ae07d23d572c3acc7c2c25b918a98a690bcaa50` (`0ae07d2`, round 36's validated repairs, scope-frozen). All eight reports are substantive and counted against a required six, so quorum is met. Three findings are independently confirmed (two LOW, one INFO). All three are in `web/` (the redeem page, the ceremony page and the vault page). None is documentation-only, so none qualifies for the round-37 documentation exception, and the pass is not clean.**

The clean-round counter remains **0/2**.

**28 deduplicated claim groups: 3 confirmed (0 CRITICAL, 0 HIGH, 0 MEDIUM, 2 LOW, 1 INFO), 0 confirmed under the documentation exception, 9 already stated or accepted, 0 uncertain and 16 disproved.** Nothing confirmed is in the five programs, and no auditor and no measurement here found a path that moves value out of a vault, the pool or the revenue address. Every round-36 repair (H1, L1-L5, I1, I2) was re-checked at its site by at least five reports and by this triage. None regressed. The three confirmed items are:

- **V1 (LOW).** A stranger who parks about 18,700 empty token accounts at a vault's deposit address makes the redeem page unable to read that vault, so the page cannot open it. That is about 28 SOL of rent, and the stranger gets it all back later. This contradicts "no stranger can block an opening" in SPEC, the web README and the page's own code comment.
- **V2 (LOW).** Anyone can stop the ceremony page for good, for one Core collection's rent, by creating a collection that names MINT's PDA as its update authority.
- **V3 (INFO).** The vault page tells a holder whose cbBTC account is frozen that the vault "cannot activate", but MINT's `activate` does not read the account's state.

## Auditor dispositions

`MANIFEST-programs.json`: head `0ae07d2`, `dirty: []`, prompt 1,828,556 characters, requested 8, runner-counted 8, required 6, every model `ok: true`, `finish: stop`, none disqualified. HEAD is still `0ae07d2`, and `git status` shows only `audits/round37/` untracked. I read every report in full and did not take the runner's counts on trust.

| Auditor | Disposition |
|---|---|
| anthropic/claude-fable-5.1 | **Counted.** `stop`, 28,585 characters. It re-walks the R36 table, recomputes every offset and space, and lists unexercised refusals. **M-A confirmed at LOW (V2)**, and its I-1 is merged into V2. **L-A's volume half is merged into V1**, but its premise that empty 165-byte Token-2022 accounts each get a box is disproved (W10). L-B: the fact is true and it is disproved as a defect (W6). L-C already stated (A1). I-2 disproved (W8). I-3 disproved (W9). I-4 already stated (A3, A4). |
| anthropic/claude-sonnet-5.5 | **Counted.** `stop`, 14,988 characters. Read-only, with a recomputation of the arithmetic and offsets. **F1 confirmed at LOW (V1)**. F2 is the same as Fable L-B (W6). F3 already stated (A3). F4 already stated or recommended (A4). F5 disproved (W8). Its limit-47 note is not a finding (W15). |
| z-ai/glm-5.3 | **Counted.** `stop`, 23,719 characters. It verifies every round-36 repair and re-tests the refutations. **F3 confirmed (V3)**. F1 disproved (W5). F2 already stated (A2). |
| meta/muse-spark-1.3 | **Counted.** `stop`, 13,560 characters. Short, but it covers R0-R8 with recomputed offsets. F1 disproved (W1). F2 already stated (A2). |
| qwen/qwen3.8-max-0902 | **Counted.** `stop`, 22,369 characters. Full R0-R8 walk and a field-by-field MINT layout. LOW-1 disproved (W3). INFO-1 and INFO-2 confirm repairs and make no claim. |
| qwen/qwen3.8-2.4t-a95b | **Counted.** `stop`, 21,048 characters. F1 disproved (W4). F2 is a measurement boundary, not a finding (A6). |
| xiaomi/mimo-v2.6-pro | **Counted.** `stop`, 20,277 characters. Its LOW (negative arms with no reason pin) is already stated (A5). Its INFO makes no claim. |
| meituan/longcat-2.0 | **Counted.** `stop`, 31,240 characters. A substantive walk with no findings. It says it "re-ran" the offline tests and the detector selftest, which a bundle reader cannot do, so I disregard those sentences. Its R8 "not exercised" list: the C5 half is disproved (W14), and the limit-55 and hand-recovery halves are already stated (A7). |

**Quorum: 8 of 8 seats substantive and counted, 6 required. MET.**

## Method and evidence

- I read all eight reports in full, along with round 36's `VERDICT-programs.md`, `VERDICT-offchain.md` and `VALIDATION.md`, SPEC gate 3's ruling (`SPEC.md:2429-2440`), and the source at `0ae07d2`.
- **The allowed runs, at HEAD:**
  - `node web/test/run-all.mjs`: **518/518** in 10 files at their floors, exit 0.
  - `node bank/selftest.mjs`: **920/920**, exit 0.
  - `node scripts/check-launch-params.mjs --selftest`: **49/49**, exit 0.
  - `node bank/redemption-poster.mjs --selftest`: **24/24**, exit 0.
- **One offline measurement script** (`m37.mjs`, kept in the session scratchpad). It imports the shipped `web/` modules and `bank/layout.mjs` and uses no network and no validator. To resolve the repository's `node_modules` it was run once as a temporary file inside `web/test/` and deleted straight after. `git status` before and after shows only `audits/round37/`. Its parts:
  - V1a-V1c: `planRedemption` with 300 empty 165-byte Token-2022 strays, 300 empty 170-byte Token-2022 ATAs, and 300 one-unit strays of freezable classic mints.
  - F3: `planActivate` on a frozen cbBTC account.
  - MA: `resolveCollection` with a decoy collection.
  - LB: `txRefusal` on a no-op CBOB instruction bundled with a stranger's transfer, and a plain-transfer control.
- A second script (`size37.mjs`, scratchpad) measures the JSON size of a `getTokenAccountsByOwner` response per account, using web3.js's base64 encoding of a 165-byte account.
- **Not run:** no validator, `scripts/run-tests.sh`, `web/test/e2e-localnet.sh`, `bank/alarm.mjs`, crank, revenue job or any live, money or notification job. No tracked file was touched. Apart from the deleted temporary script, the only file this triage adds is this verdict.

## Confirmed findings

| ID | Severity | Independent disposition and minimal repair |
|---|---|---|
| **V1**: Sonnet F1; Fable L-A (volume half) | **LOW** (claimed LOW, LOW) | **Enough stranger accounts at a deposit address make the redeem page unable to read the vault, so the page cannot open it.** Two documents say a stranger never can. SPEC C5 says "no stranger can block an opening" (`SPEC.md:937-939`) and SPEC item 50 says the same (`:1954`). The web README says "A stranger cannot block an opening" (`web/README.md:79`) and "nothing a stranger can put at a deposit address refuses an opening" (`:285-286`). The page's own invariant is "NOTHING here may block an opening" (`plan-redeem.mjs:118-121`).<br><br>**The mechanism.** `tokenAccountsOf` makes one unpaged `getTokenAccountsByOwner` call per token program (`web/src/lib/reads.mjs:63-75`). The page's RPC is the proxy (`web/src/config.js:64`). The proxy aborts any upstream response over `MAX_RESPONSE` = 8 MB (`web/deploy/rpc-proxy.mjs:46, 216-235`). The failure becomes a `ReadError` (`reads.mjs:22-27`), and the redeem page then shows only a refusal (`redeem.mjs:74`).<br><br>**Measured** (`size37.mjs`): 448 bytes of response per 165-byte account, so 18,723 accounts exceed the cap. At mainnet rent of 5,080 lamports a byte (`SPEC.md:2468`), that is about **27.9 SOL**. The attacker gets it back: empty classic accounts handed to the PDA with the close authority kept (the round-35 C5 class, R36.C5) can be closed by the attacker later. So the real cost is fees plus capital tied up for as long as the block lasts.<br><br>**The volume half below the cap is a nuisance, not a block.** Measured (`m37.mjs` V1b, V1c): 300 empty 170-byte Token-2022 ATAs, or 300 one-unit strays of freezable mints, each produce their own box, 300 in all. The page renders one checkbox per box with no "tick all" (`redeem.mjs:97-104`), and it still opens once all are ticked. Fable's premise that empty 165-byte Token-2022 accounts also get boxes is false (V1a: 0 boxes; W10).<br><br>Nothing is lost, no program is involved, and the holder can still open by hand without the page's warnings. Rated **LOW** because each blocked vault ties up tens of SOL, unlike round 36 H1's pennies (HIGH).<br><br>**Repair (page only).** Read the vault's three reserve accounts by address, as the plan already does through `covered`. When the full listing cannot be read, never refuse: show ONE box ("the vault wallet holds more accounts than this page can list; anything in them is lost when the vault is opened"). Collapse more than about 20 stranger boxes into one grouped box with a count and an expandable list. Amend SPEC `:937-939`, `:1954` and README `:79`, `:285-287` to match. While there, README `:286`'s "a Token-2022 account (empty or funded)" should say that an empty 165-byte one is skipped (V1a). |
| **V2**: Fable M-A, I-1 | **LOW** (claimed MEDIUM) | **Anyone can stop the launch ceremony page for good, for one Core collection's rent.**<br><br>**Why anyone can.** Core's collection create takes the update authority as a read-only non-signer (`web/src/lib/ix.mjs:132-134`, `R(updateAuthority)`). The ceremony's own step 0 relies on exactly that to name MINT's `["mint"]` PDA, which cannot sign. The PDA is public (`rpc-proxy.mjs:41`).<br><br>**What it does to the page.** `collectionsOfMint` lists every such collection (`reads.mjs:221-227`). `resolveCollection` returns a hard conflict whenever it finds more than one, before it looks at any pinned source (`web/src/lib/ceremony-reads.mjs:78`). `preflight` and `steps` both return on a conflict (`web/src/pages/ceremony.mjs:88-89, 139-140`), and there is no override. A Core collection whose update authority is a PDA that cannot sign can never be burned, so a decoy is permanent. **Measured** (`m37.mjs` MA): with `config.js`, SEAL and the launch file all naming collection A, plus one decoy on chain, the result is `conflict: "2 collections on chain name MINT's PDA … only one may exist"`. Before step 0, a single chain-only collection is adopted silently (`source: "the chain"`). If it does not match the ruled name and URI, the identity check refuses it. If it does match, the vaults' collection is one Gary never signed for, though it is functionally identical (I-1).<br><br>The page's assumption "only one may ever exist" (`web/test/ceremony.test.mjs:199`, `web/README.md:155-157`) is false. Every vector fails closed and no value is at risk. But the page that encodes every check on the permanent `initialize` values can be disabled before or partway through road step 10, which leaves Gary with hand-built transactions. Rated **LOW** for consistency with round 36's ceremony items (L4, L5), but it **must be repaired before road step 10.**<br><br>**Repair (web only).** Once `config.js`, SEAL or the launch file names a collection, use that one and WARN, naming any other chain collection. Before any pin exists, never adopt a chain-only collection silently: show "found on chain, not created here" and require an explicit confirmation or the `config.js` pin. STOP only when the authoritative sources disagree with each other. |
| **V3**: GLM F3 | **INFO** (claimed INFO) | **The vault page misstates what MINT does with a frozen cbBTC account.** `planActivate` refuses with "This vault's cbBTC account is frozen by Coinbase, so it cannot activate until Coinbase unfreezes it" (`web/src/lib/plan-vault.mjs:65`; measured, `m37.mjs` F3). MINT's `activate` discards the state: `let (amount, _) = read_token(…)` (`programs/cbob-vault-mint/src/lib.rs:1439`). `read_token` checks only the owner program, the length, the mint and the owner (`:2121-2130`), and the request moves no tokens (`:1413-1452`). So a frozen vault account CAN activate, and its payouts then wait under limit 28. The off-chain crank's own comment says so: "A frozen account still activates (the program reads the balance, not the state)" (`bank/crank.mjs:352-355`). `web/test/plan.test.mjs:338` pins the false sentence. Nothing is lost, but the page tells a holder that waiting is necessary when it is not, and a vault that activates late misses distributions it could have been owed. **Repair:** build the request and add a note ("payouts to a frozen account wait until Coinbase unfreezes it"), or keep the refusal and reword it as the page's own choice. Replace the plan.test arm. |

### Why none of the three qualifies for the documentation exception (SPEC gate 3, round-37 ruling)

The exception covers only confirmed findings that are documentation-only, rated LOW or INFO, change no code, test, page or build, and do not misstate a holder's money, a holder's rights, or what the programs do.

- **V1:** the repair changes page code (`reads.mjs`, `plan-redeem.mjs`, `redeem.mjs`), and the false statement is in `web/README.md`. It also concerns a holder's ability to open their vault, which is a holder's right.
- **V2:** the repair is in `web/src/lib/ceremony-reads.mjs` and `ceremony.mjs`, plus a test.
- **V3:** the defect is rendered page copy in `web/` and a test (`plan.test.mjs:338`), and it misstates what the programs do.

**Confirmed under the documentation exception: none.**

## Already stated or accepted (not counted as defects)

| ID / reports | Disposition |
|---|---|
| A1: Fable L-C (a retired guardian leaves no instant stop on a leaked swap-operator key) | **Already stated.** `SPEC.md:353` ("for the guardian, `None`: the brake retired"). `:1719` and `DESIGN-v6.md:273-274` ("the community can also retire the brake entirely"). SPEC limit 10 (`:1180-1185`) names `emergency_stop_sweep` as the only stop. The holder guide (`:204-208`) states the 10 SOL per 6 h exposure and that "Replacing the key takes a vote and a week's notice". Retiring the guardian needs half of all live vaults, so the holders choose it. Optional: one guide sentence naming the combination. |
| A2: Muse F2; GLM F2 (the guide says each opening "is announced on X and on the Bank's website"; the poster has no sender) | **Already stated as OPEN AND BLOCKING.** SPEC item 50 (`:1884-1895`) quotes this exact promise and records that `bank/redemption-poster.mjs` "drafts posts and has no sender". Also SPEC `:2321` and README open decision 9 (`:293-294`). The guide is DRAFT (`HOLDER-GUIDE.md:3`) and cannot be published before item 50 closes. |
| A3: Sonnet F3; Fable I-4; Longcat (web tests and e2e not in `run-tests.sh`; no e2e floor) | **Already stated.** Round 36 A8, still true (`grep` finds no `web/test` in `scripts/run-tests.sh`). Item 50 OPEN. |
| A4: Sonnet F4; Fable R8 (untested shapes: a delegated or native-wSOL helper source, a duplicate destination, `BadClaimList` above 30 records, `WrongAsset` on reveal and boost, `ReserveHasExtensions` in BURN's second loop, the rescue host branches) | Round 36 A7 covers the rescue branches. The others are coverage gaps with no claimed defect, and each branch reads correctly in the code. Recommended arms. |
| A5: Mimo LOW (8 negative arms without a `because` pin) | **Already stated** (round 36 A12 and its measurement row listed all eight). Gate-5 item 8 is met for R34.G2 by R36.G2a/b (`tests/3prog.test.ts:3857-3858`). The other seven (R32.A22a, R33.G3, OR.5, R31.W1a, R31.W1b, R28.A2, R35.N8) still have no pin (`grep` count 0). Their labels and outcome fields are right, so this is strengthening, not a defect. |
| A6: Qwen-2.4t F2 (`bank/layout.mjs`, `bank/detectors.mjs` and `scripts/check-launch-params.mjs` are imported by `web/` but not bundled in this pass) | A measurement boundary, not a finding. The off-chain pass covers those modules. `bundle.test.mjs` proves the bundled copies equal the node copies. |
| A7: Longcat (limit 55's same-pass join, and the hand recovery, are not landed in the suite) | Limit 55 is accepted and costed. The hand recovery is item 22's rehearsal (OPEN). |
| A8: Fable R2 (with weight but an empty pool, pending vaults cannot join until revenue arrives) | Fable itself calls this a design consequence, and it matches the holder text ("joins at the next distribution"). |
| A9: Sonnet R0 (`config.js` can only name a commit earlier than the one it sits in) | Sonnet itself calls this sound while the programs do not change between those commits. `build.mjs` binds `dist/MANIFEST.txt` to `RELEASE_COMMIT`. |

## Disproved or unsupported

| ID / reports | Independent disposition |
|---|---|
| W1: Muse F1 ("the default compute budget is 200,000 CU per transaction, so the 800,000 in SPEC is overstated") | The default limit is 200,000 per non-builtin instruction, capped at 1.4 M. The redemption carries four (claim, open, Core Execute, burn). Round 36 W5 said the same. In any case, the measured shapes fit even Muse's reading: S8.1a 168,343 CU (`SPEC.md:1935`), and the largest C5 opening at 180,852 CU (round 36 VALIDATION). |
| W3: Qwen-max LOW-1 (`expire_boosts` reverts the whole batch on a non-record account, so a griefer can make it fail) | The sender chooses the remaining accounts, and nobody can add an account to someone else's transaction. The refusal fails closed (`lib.rs:1545-1547`). The page passes only records filtered by `dueBoostRecords` (`reads.mjs:233-243`). No third-party effect. |
| W4: Qwen-2.4t F1 (the guide says the $CBOB boost price "helped put bitcoin in the pool") | The sentence before it says "The $CBOB is **burned**, gone for good", and "a payout is only as big as the sales and royalties behind it" (`HOLDER-GUIDE.md:99-101`). "Your own purchase" is the vault purchase whose sale funded the pool. The quoted text is in `SPEC.md:2163-2164`, not DESIGN §3. |
| W5: GLM F1 (the H1 freezable-mint rule destroys USDC-like tokens, and the guide over-promises) | The policy is stated where a holder reads it: "a token whose issuer can freeze accounts" is named among the things the page cannot take out, to be ticked (`HOLDER-GUIDE.md:121-125`). Also SPEC `:933-939` and README `:96-101`. Optimistic delivery with `dropStrays` is a design alternative, not a defect. |
| W6: Sonnet F2; Fable L-B (the round-36 L1 repair is bypassed by any no-op CBOB instruction) | **The fact is true** (`m37.mjs` LB): `[expire_boosts(any record), SystemProgram.transfer(a→b)]` passes `txRefusal`, while a plain-transfer control is refused. A not-yet-due `expire_boosts` lands as a no-op (`lib.rs:1548-1556`).<br><br>**As a defect it is disproved.** The README states the rule exactly: relayed transactions must "call at least one CBOB program … A plain SOL or token transfer is not relayed" (`web/README.md:203-208`). Both clauses are true. It also says a script "can forge an Origin, so the method, shape and transaction rules and the rate limits are what bound it" (`:209-212`). The implementation is round 36 L1's prescribed repair. The residual is the same rate-limited provider cost (1 send per second per IP or /64) that any CBOB-calling transaction already carries, and no holder is exposed. Optional hardening: an instruction-shape whitelist. |
| W8: Fable I-2; Sonnet F5 (`BadSweepBound`'s message says "cooldown 1s to 7 days", while `initialize` caps the cooldown at 24 h) | **Previously ruled WRONG** in round 25 (W15). The one enum covers both the cooldown (1 s-24 h) and its tighten ceiling (≤7 days) (`lib.rs:592-599, 2933`). Only `INIT_AUTHORITY` can trigger it, and only behind `check-launch-params.mjs`'s exact bounds. |
| W9: Fable I-3 (the prior transaction makes the holder pay rent for receiving accounts of stray mints) | These are the holder's own ATAs, which receive the holder's tokens. Each is listed with its reason ("create your own … account to receive it"). They are limited by the packet and recoverable by the holder. No false statement. |
| W10: Fable L-A premise (provably empty 165-byte Token-2022 accounts each get a mandatory box) | `classifyPdaTokenAccount` returns `null` for `dataLen 165, amount 0` (`bank/detectors.mjs:944-948`), and `plan-redeem.mjs` boxes a Token-2022 account only `if (c)`. **Measured** (V1a): 300 such accounts produce 0 boxes, and the opening goes ahead. The volume concern itself is V1. |
| W14: Longcat ("C5 is exercised by the e2e but not by the 895-assertion suite") | R36.C5 is a suite arm with a reason pin (`tests/3prog.test.ts:3859`). |
| W15: Sonnet (limit 47 is "slightly pessimistic") | A conservative statement is not a misstatement. Sonnet itself keeps it as accurate. |
| W16: Fable R8 (`C.2` cannot fail) | A failed claim aborts the suite before the arm, so it is not a false pass (Fable agrees). |
| W2, W7, W11, W12, W13: the re-checks of round 36's refutations (W1-W14) by GLM, Qwen-max, Fable and Muse | Each report re-derived and upheld them. No report reopened one. |

## Gate-5 obligations

SPEC ship gate 5 requires two things before certification: every confirmed defect's repair becomes a suite assertion, and so does every rejected finding that could be measured. These are requirements, not findings.

1. **V1:**
   - an offline arm: a snapshot whose token-account listing cannot be read whole still produces an opening, with one named box;
   - an arm with 300 or more strays, asserting a bounded, grouped acknowledgement;
   - an e2e arm with a few hundred stranger accounts;
   - a recorded measurement of the real provider and proxy limit for `getTokenAccountsByOwner`.
2. **V2:**
   - `ceremony.test.mjs`: SEAL, `config.js` or the launch file names A, and the chain holds A plus a decoy. The page proceeds and warns.
   - Before step 0, a chain-only collection that matches the identity is not adopted silently.
   - An e2e arm where a stranger creates a decoy collection naming MINT's PDA, and the ceremony still completes.
3. **V3:** replace `plan.test.mjs:338`. Add a suite or e2e arm that lands `activate` on a vault whose cbBTC account is frozen, which measures the program behaviour the page will then state.
4. **W6:** a `proxy.test.mjs` arm for a no-op CBOB instruction plus a stranger's transfer, asserting the chosen rule: refused after hardening, or accepted with the README saying so.
5. **W3:** a suite arm: `expire_boosts` naming a non-record account reverts (`BadVaultRecord`) and changes nothing.
6. **W1:** the e2e's largest redemption asserts that it lands with no compute-budget instruction and records its CU (measured at 180,852; pin it as an assertion if it is not one already).
7. **W10:** a `plan.test.mjs` arm: an empty 165-byte Token-2022 stray gets no box.
8. **Recommended (A4, A5):** the helper and refusal arms listed in A4, and reason pins for the seven arms in A5.

## Measurements

| Measurement | Result | Evidence |
|---|---|---|
| Allowed selftests at HEAD | web 518/518 (10 files at floor); detectors 920/920; launch 49/49; poster 24/24; all exit 0 | session logs |
| `getTokenAccountsByOwner` response per 165-byte account (base64) | 448 bytes. 18,723 accounts exceed the proxy's 8 MB cap, about 27.9 SOL of rent at 5,080 lamports a byte | `size37.mjs` |
| `planRedemption` on 300 strays | empty 165-byte Token-2022: opens, **0** boxes. Empty 170-byte Token-2022 ATAs: opens, **300** boxes. One-unit freezable classic strays: opens, **300** boxes | `m37.mjs` V1a-V1c |
| `planActivate`, cbBTC frozen with 50,000 sats | `ok: false`, "…so it cannot activate until Coinbase unfreezes it." | `m37.mjs` F3 |
| `resolveCollection`: A pinned by config, SEAL and launch, plus a decoy on chain | `conflict` (STOP). Before step 0 with one decoy: adopted, `source: "the chain"` | `m37.mjs` MA |
| `txRefusal`: no-op `expire_boosts` plus a stranger's System transfer, and a plain-transfer control | `null` (relayed); control refused | `m37.mjs` LB |

## Measurement limits

- **No validator was run.** Three on-chain halves rest on reading the code and on standard program semantics, not on a run here:
  - V2: a stranger's `CreateCollectionV2` naming MINT's PDA lands. Inferred from the instruction's account flags and from step 0 itself landing with a PDA that cannot sign.
  - V3: `activate` lands on a frozen account. Inferred from `read_token` discarding the state; no suite arm lands it.
  - V1: an empty classic account handed to the PDA stays closable by its kept close authority. This is the measured C5 class.
- **V1's threshold is an estimate.** The proxy cap is code, and the per-account size was measured on a synthetic response. The upstream provider may refuse, paginate or time out (20 s) earlier or later. This needs a measurement against the real provider, Gate-5 item 1.
- **The prompt was not re-rendered.** HEAD equals the manifest's head and the tree is clean, so the manifest was checked instead.
- **Unmeasured here, as round 36 also stated:** a real Phantom modifying messages (U1), a real Squads v4 return (U2), and the e2e itself. In `bank/`, only `layout.mjs`, `detectors.mjs` (`classifyPdaTokenAccount`), `crank.mjs` (one comment) and the allowed selftests were read or run. No measurement here can show whether a holder understands any page sentence.

## Remaining requirements

- Repair V1, V2 and V3 in `web/` (V2 before road step 10; V1 before item 50 closes), with the Gate-5 arms above. Repairs cannot retroactively clean round 37.
- The tree stays scope-frozen (SPEC gate 3): only these fixes and their tests. A drift sweep runs before round 38.
- Items 22, 38, 50, 52 and 53 remain OPEN AND BLOCKING. `charter_opens_at`, `lock_deadline` and `vault_collection` remain OPEN in `launch/mainnet-init.json`. No deployment, initialization, lock, ceremony, cron installation or publication follows from this audit.

**Result: QUORUM MET (8 substantive of 8 seats; six required). NOT CLEAN (0 CRITICAL, 0 HIGH, 0 MEDIUM, 2 LOW, 1 INFO; none under the documentation exception; nothing in the programs; no value path). Counter 0/2.**
