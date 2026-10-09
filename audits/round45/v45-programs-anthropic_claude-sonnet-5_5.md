# Round 45 audit: confirmation of the final tree and the new rehearsal driver

**Scope and method.** I read the five programs, SPEC, the guide, the suite, the sim and the web layer from the bundle. I ran nothing. Every finding is a source reading, and I say below where one needs a measurement to settle it. `bank/*.mjs` (crank, revenue, swap, alarm) is not in this pass's bundle.

**Headline: I found no defect in the five programs.** I found no CRITICAL, HIGH or MEDIUM issue anywhere. The findings below are LOW or INFO and sit in the new rehearsal driver and its evidence predicates. By the launch gate's (a)-(d) none blocks launch: none is in the programs, none moves value on a holder's behalf, and none refuses a crack. Two of them (F1, F2) do raise the risk of the rehearsal itself, because it signs with the real deploy-authority key on mainnet.

## R0. Round 44 and the rehearsal driver

I did not re-file round 44's seven findings. The repairs I checked at their sites hold:
- the release gate's id source;
- the rehearsal profile's init key;
- `judgeFor`.

### F1 (LOW): `--rpc box` does not keep the provider key out of argv
- **Where:** `rehearsal-steps.mjs` `solanaCli` runs `execFileSync('solana', ['--url', ctx.A.rpcResolved, ...])`.
- **Why it matters:** `rpcResolved` is the key-bearing Helius URL. `rehearsal-run.mjs` introduced `--rpc box` precisely so the key never sits in a process's argv. Every `solana program deploy`, `close` and `close --buffers` puts it in `/proc/<pid>/cmdline` for the length of the deploy, which on mainnet is minutes.
- **Evidence if I am right:** `ps -ef | grep 'solana.*program deploy'` during deploy-1 shows `api-key=`.
- **Fix:** write a mode-600 solana config file in `.rehearsal-run/` and pass `--config`.

### F2 (LOW, blast radius): the driver mandates the real upgrade-authority key and closes buffers wide
- **The key:** `judgeNoMainnetKeys` requires the mainnet funding wallet to equal `DEPLOY_WALLET`, which is the upgrade authority of the five real placeholder ids.
- **The close:** each deploy step first runs `solana program close --buffers --buffer-authority <deploy key>`. That closes every buffer that wallet is authority of, including any real step-9 buffer already uploaded.
- **Consequences:** nothing is lost, since the rent returns, but it silently destroys prepared launch work. A ~600-line new driver also holds the one key that must survive to step 11.
- **Fix:** use a dedicated rehearsal funding wallet and drop the equality check. Close only the buffer addresses parsed from the driver's own deploy output.

### F3 (LOW): "resumable" is false for any multi-transaction step
- **Mechanism:** `send()` appends every signature to `rec.sigs`. `judgeSigs` returns `'landed'` if any one landed. `nextAction` returns `'stop'` when status is `unknown`/`sending`, the signature landed, and `done()` is false.
- **Steps affected:** sale-round (proposal, three votes, execute), deposit-activate, sweep-back, the crack's prior transactions, and the rescue.
- **Effect:** a failure after the first landed transaction makes the step unrunnable until someone hand-edits the state file. Hand-editing a state file is exactly where double sends happen.
- **Fix:** let idempotent steps declare `resumable: true`. For those, re-run after `done()` instead of stopping on a landed signature.

### F4 (LOW): item 22 verdicts can be recorded PASS without the evidence
- **Item 22.4:** the predicate is `/CRITICAL/.test(out) && /(unreconciled|sweep)/i.test(out)` over the whole alarm output. Any unrelated CRITICAL line that contains the word "sweep" passes. It should assert the specific finding kind and the cycle's sweep signature.
- **Item 22.5:** `item(5,'PASS', st.das)` is recorded even when `st.das` is `{burnt:null, error:'…'}`. The question the item exists to settle (does DAS set `burnt` on a burned Core asset?) is then unanswered, but the record says PASS.
- **Item 22.2:** it is PASS whenever two passes ran, whatever they found.
- **Fix:** each predicate must fail on the negative control.

### F5 (INFO): the init-key exposure window is wider than SPEC 53's text
- **The sequence:** SPEC says "initialize follows the deploy at once". The step order is deploy ×5, fund-roles, pob-set, cbob-mint, fill-values, collection, SEAL, and so on. That is many minutes with the seed-7 INIT key live.
- **What a front-runner can do:** if the seed is not private, someone can pre-initialize a program with wrong values. `readStep`/`broken()` and `verify-configs` do catch this before any token moves, so the cost is a redeploy.
- **Fix:** move keys, fund-roles, pob-set, cbob-mint and fill-values before the deploys.

### F6 (INFO): `MAINNET_ONLY` is a hand-copied second source
- **The risk:** `rehearsal-run.mjs` keeps its own list of mainnet-only keys beside `launch/mainnet-init.json`. I could not confirm by eye that the $CBOB mint literal equals the launch file's.
- **Fix:** add a selftest arm asserting that every `REHEARSAL_OWN_KEYS` value in `mainnet-init.json` is a key of `MAINNET_ONLY`.

### F7 (INFO): `rehearsal-env.mjs` and its consumers
- **What I verified:** `rehearsal-env.mjs` itself cannot change production behaviour. A set override outside a tree with `REHEARSAL-RECORD.txt` throws.
- **What I could not verify:** the consumers of `CBOB_REHEARSAL_FORCE_ORCA_REFUSAL`, `CBOB_REHEARSAL_FAIL_AFTER_SWEEP`, `CBOB_CRANK_KEY` and `--reveal-only` are in `bank/*.mjs`, which is not bundled.
- **Residue:** the gate is a file-existence check. Anyone who can create `REHEARSAL-RECORD.txt` in a production tree turns every override on. The cron installer refuses such a tree, and the box-owner residue is already accepted in item 10(3).

### F8 (INFO): `handRecover` returns the whole token balance but records the delta
- **Mechanism:** it transfers the operator ATA's entire balance but ledgers `returnedSats = delta`. If that ATA held pre-existing cbBTC, `--audit` reconciles against the wrong number.
- **Likelihood:** low, since cycles return everything.

### F9 (INFO): expiry batch size
- `MAX_EXPIRE_BATCH` is 30, but the 4-assertion gate and the crank use 20. A caller using 30 at the default budget is unmeasured. This is harmless and fails closed.

## R1 and R1s: custody and the sweep helper

I could not break the pairing. I checked these points:
- **Pairing and index binding:** SEAL walks forward only through top-level instructions, binding asset at account 0 and owner at account 2. BURN walks backward and binds the same pair.
- **Emptiness proof:** every reserve ATA under both token programs must be declared. A nested Core asset is refused, and a stranger cannot create a Token-2022 ATA for a classic mint (F4.2).
- **Sweep helper, same source twice:** the second read hits a closed account and fails `IllegalOwner`.
- **Sweep helper, source equals destination:** a token account cannot be owned by both the signer and the destination wallet.
- **Sweep helper, odd or zero pair lists:** both are handled.
- **Sweep helper, lamports:** the sweep reads `signer.lamports()` live, and BURN's `lamports == 0` check sees exactly what it leaves.
- **Sweep helper, access control:** the real control is Core's owner-only `ExecuteV1` on a thawed vault. SR.5-5e measure it.

**Residual (a measurement, not a defect).** One shape is unmeasured: the many-signer autograph at the heap boundary, combined with the 640-byte attribute budget and a maximum name and URI.
- R33.G2a used `mkVault(0n)`. R34.G1b used one signature.
- If `reveal_level` OOMs for the FIFO head, the level queue halts for everyone, which is the worst consequence in the design.
- By Core's mechanics (validation deserializes the autograph once, while the grow path needs more) I expect headroom, so I rate this INFO. One arm settles it.

## R2 / R2b: pool and boost

I re-derived these and found no counterexample:
- **Pool invariant:** `credit` adds `delta·w ≤ avail·SCALE`. A claim subtracts exactly the settled amount from `owed`. `retire` subtracts the full `pending`. So `owed ≤ balance·SCALE` always holds.
- **Reweigh:** it preserves `owed`, because `carry = owed` and `debt = after·acc`.
- **Boost exactness:**
  - End slot is `(e+N) mod 64` with `1 ≤ N ≤ 63`, so a live slot is never aliased.
  - `advance_epoch` moves a slot into `boosts_due` and clears it.
  - No distribution runs while `boosts_due > 0`.
  - A tick only happens at `w == 0`, when no boost can exist.
- **Expiry cannot be blocked:** `expire_boosts` needs only the records. A duplicate record in a batch is skipped, because the second sees `boost_weight == 0`.
- **No stall from joins:** `claim` joins a pending vault without touching the token account, and `retire_burned` decrements both pending counters.

## R3 to R7

- **R3 (level draw):**
  - The SlotHashes parse is defensive.
  - The window is consistent: C lands within about 208 slots against a 300-slot window.
  - FIFO and the burned-head case are handled.
  - I found nothing worse than limits 25 and 26 state.
  - The guide says it truthfully.
- **R4 (governance):**
  - I found no minority path to key changes.
  - I found no vote path to money.
  - Skipped actions do not revert the bundle.
- **R5 / SPEC 46:** complete as far as I can tell. One refinement worth a sentence: the authority can censor a selected subset of holders, not only block all or capture.
- **R6 (one-time config):**
  - Wrong-but-accepted values are guarded only by the launch checker. `pob_collection`, `bank_treasury` and `guardian` are checked by MINT only as non-default.
  - The royalty authority `None` cannot be re-delegated (R33.G3).
  - The rolling ring is exactly a k-th-most-recent test.
- **R7 (raw offsets):** I recomputed MintConfig (1,005 + 256), VaultRecord (221), BurnConfig and the helper's 0/32/64 offsets. All match GOV, BURN and the proxy's `mint-boosts` slice (125..195).

## R8: evidence

The floors equal the counts (912, 1004, 695, 71, 132, 16, 4). Arms I could not verify here are listed under F4 and F7 above.

## Accepted limits

1. **Worse than stated?** None that I found. Limit 47's permanent-stop caveat is already explicit.
2. **Not actually a limit?** None. Limit 59's cost figure (890,880) is the test validator's, as round 44 noted.
3. **DISCHARGED but not discharged?** None that I found.
4. **OPEN AND BLOCKING treated as accepted?** Item 22 is the risk. F4 shows its verdict recording can say PASS without the evidence.

## What the project should do before launch that AI cannot

1. **Run the dress rehearsal on mainnet, with a dedicated funding wallet (F2), and read the records by hand.** Items 22.3-22.5 are mainnet-only. A person must confirm each PASS against the transactions, not the driver's own predicate.
2. **Stateful randomized fuzzing of MINT against `bank/accrual.mjs`.**
   - Cover random mint, activate, boost, expire, claim, distribute and retire sequences, in the style of Trident or LiteSVM.
   - Assert `pool ≥ ceil(owed)`, `Σ owed = owed_scaled`, and the boost counters at every step.
   - Today's arms are scripted scenarios plus one host test.
3. **Independent reproducible-build verification.** Have a third party rebuild from the release commit and compare the five hashes on mainnet. Today the proof is the author's own `build-mainnet.sh`.
4. **Hardware-wallet custody for the guardian and `INIT_AUTHORITY`.** Both are Gary's hot Phantom wallet, and a stolen key can freeze sales permanently (limit 47).
5. **Consider a short post-launch window before step 11.** Keep the upgrade authority behind a hardware multisig for a few weeks while the guide caps what holders deposit, then lock. This conflicts with the immutability ruling, so it is Gary's call; I list it because it is the one control that addresses unknown unknowns.
6. **Pre-agree the response to a Core upgrade.** The alarm only detects it (limit 40).
7. **Real wallet and marketplace testing.** Test real Phantom, a real Squads return and the proxy behind Cloudflare, none of which any suite touches.