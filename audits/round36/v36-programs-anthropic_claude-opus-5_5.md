# Round 36 audit: v6 at `9480314` (five programs, the off-chain pipeline, and `web/`)

## Summary

- **No CRITICAL** found in the four vault programs or the sweep helper. The rescue change (item 58) holds up under the attacks below.
- **One HIGH**, in `web/`. Review 35's H1 fix is incomplete: a stranger can still block every opening on the redeem page, for good, for about 0.004 SOL. This makes a HOLDER-GUIDE promise false.
- **Three MEDIUM**:
  - **M-1:** the shipped bytes are not tied to the audited commit. The ceremony would accept a deployed round-34 MINT, which has no `rescue_nested`.
  - **M-2:** item 58 turned MINT's upgrade authority into custody over every vault. Limits 13 and 39 do not say so, and nothing hard-gates "no vault exists before the lock".
  - **M-3:** the dress rehearsal cannot exercise the pages. Item 53 regressed.
- Several LOW and INFO items follow.

Each finding states what would exist on chain or in a test run if the claim is true, so it can be checked.

---

## R0. Round 35's record and its repairs

**NOT-COUNTED.md.** I accept it. With 7 usable reports out of 16 there was no quorum, and nothing in this round treats round 35 as a clean round.

**TRIAGE.** I re-checked each verdict against the source.

- **C1 / C2 / C15 (road steps):** repaired. Step 9 no longer runs `--final`, step 10 re-verifies before initialize, and step 11 verifies, makes final, then verifies again.
  - The ceremony page's preflight still says *"road step 9 makes it final"* (`ceremony.mjs`, the upgrade-authority note). That is stale text. **INFO.**
- **C3:** repaired by arm R35.C3.
- **C4:** custody of the placeholder upgrade key is now stated. See M-2: the stakes of that key rose with item 58.
- **C5:** the verdict was correct. The page now moves the balance and leaves the account undeclared.
  - SPEC Known limits, C5, still says the page *"refuses only an account that still holds a balance it cannot move (a frozen one, or Token-2022)"*. After the H1 fix the code acknowledges those accounts instead of refusing them. Stale doc. **LOW.**
- **C9:** correctly superseded by item 58.
- **C10, C18:** now stated as limits. I accept both.
- **Disproved claims (C6, C7, C19–C23):** I agree with each.

**REVIEW-rescue.md.**
- **M1 and M2:** fixed. Every rescue now goes to `bank_treasury`, and a foreign live host is refused (`HostUnresolved`).
- **L2 (the Squads can vote with a held vault):** now disclosed as a custody rule. See L-2 for the related contradiction with the rulings.
- **L1 (wrong "sender"):** the runbook still says *"Find the wallet that sent it there"*. When a host is sold and then burned, the rightful recipient is the host's last owner at burn time. This needs human judgment; no change of verdict.
- **I1 (one signing site), I2 (delegate scope), I3 (fixed destination):** re-verified by reading.
  - `RESCUE_SEED` appears in exactly one `invoke_signed`. That call has a constant program id, constant data `[14,0]`, and `new_owner` pinned to `config.bank_treasury`.

**REVIEW-web.md.**
- **H1:** fixed for the reproduced vectors only. A sibling vector survives; see H-1.
- **M1:** the proxy refuses requests with no Origin or another site's Origin, filters must be exact, and the response cap now applies while streaming. Fixed. Residue is in L-7.
- **M2:** the ceremony remembers the collection address before step 0 lands, scans the chain, and stops on two candidates. Fixed.
- **M3:** the bundles are stripped of notes. Fixed.
- **M4:** a local ceremony mode and SRI were added. They mitigate but do not close it; see the final section.
- **L1–L6:** addressed as described in the review.

---

## R1 / R1s. Custody and the sweep helper

I found no program defect.

**The open/burn pairing.**
- Consider: open A, sweep, transfer A to W2, burn A naming W1. SEAL bound owner W1 at the burn's account 2. BURN then checks `asset_owner == owner`, so the burn reverts, and the whole transaction with it.
- Variants that transfer A back to W1 before the burn end in an ordinary redemption.
- No instruction re-freezes A, and a thawed A must reach `burn_vault`, which burns it. A thawed vault cannot survive the transaction.

**Inserting `rescue_nested` into a redemption.** It requires the owner to be an asset-signer PDA. That makes `open` unsignable, so it cannot be inserted.

**R1s (a): who can drive the helper.** Only the owner can make Core run it on a vault (SR.5–SR.5e).
- Outside a redemption, the vault is frozen and Core refuses (3.7, 0x9).
- The rescue PDA gets no Execute rights. Core's PermanentTransferDelegate implements only `validate_add_plugin` and `validate_transfer`.

**R1s (b), (c): the pair checks hold.**
- A destination wallet that is another vault's asset-signer is allowed. That is the owner choosing to fund another vault; it is not a hole.
- A destination below rent that does not exist fails, which is measured and on the client contract.

**R1s (e): emptiness.**
- A Token-2022 derivation for a classic reserve mint cannot be created. The ATA program refuses (probe measured on mainnet), and nobody can sign for the PDA address.
- SOL sent to that derivation address is System-owned and is skipped for the right reason.
- No stranger-creatable account escapes both the sweep and BURN's skip rule.

**R1s (f), (g):** the S8.0 and S8.1a measurements cover the shape that was measured. Every other web shape, including the C5 Executes, depends on the runtime fitting check in `plan-redeem.mjs`.

---

## R2 / R2b. The pool and the boost

I re-derived the invariant `balance >= ceil(owed)`.
- `credit` adds `d <= avail * 1e12` to `owed`, so `ceil(owed + d) <= ceil(owed) + avail`.
- `claim` removes exactly what it settles, `reweigh` and `expire_boost` leave `owed` unchanged, and `retire` subtracts the pending share.

The same record twice in one claim is paid once (BO.32). The ring index `(head + 64 − k) mod 64` is the k-th most recent entry, so the rate-limit read is correct. I found no defect.

---

## R3. The level draw

**L-4 (LOW): limit 26 overstates "removes every other leader's influence".**
- `reveal_slot = mint_slot + 16` has arbitrary alignment.
- If `reveal_slot` is the last slot of a group, A's leader can skip it. A then moves into the next group, which shifts B's and C's target groups by one, and so changes which validator is C's leader.
- A validator that holds a group near A and a group near C can therefore steer C into its own rotation from the A position, not only by timing a mint.

Fix: state this in limit 26. Optionally, round `reveal_slot` up to a group boundary in a future build. This tree is frozen.

---

## R4–R7

**R4–R6:** no new defects beyond the accepted limits.

**R7: offsets recomputed.**
- VaultRecord is 221 bytes, with `pending` at 177, `request_epoch` at 178, `boost_weight` at 186, `boost_end_epoch` at 187 and `carry_scaled` at 195–211.
- In MintConfig, `cbob_mint` is at 679, and `max_boost_weight` and `max_boost_epochs` are at 711 and 712.
- The web proxy's `pending = 1` filter at offset 177 is correct.

---

## web/ (first audit)

### H-1 (HIGH): a stranger can block the redeem page permanently by freezing the owner's destination account

**Where.** In `web/src/lib/reads.mjs` (`readRedemptionSnapshot`), `ownerAtaExists = new Set(ownerAtas.filter((_, i) => !!infos[i]))` records existence only, never the frozen state. `plan-redeem.mjs` then names every unfrozen classic stray in the helper, paired with the owner's ATA for that mint.

**Attack.**
1. A stranger creates mint M and keeps its freeze authority.
2. The stranger creates the vault PDA's ATA for M and mints 1 unit into it.
3. The holder opens the page. The prior transaction creates the owner's ATA for M.
4. The stranger freezes the owner's ATA for M (any M account can be frozen by M's freeze authority).
5. From then on every plan names (stray → frozen owner ATA). The helper's Transfer fails with Token 0x11, and the dry run fails with *"nothing was sent"*.

The holder has no path forward on the page: the plan never excludes that stray. The cost is about 0.004 SOL per vault.

**A racing variant.** Instead, freeze and thaw the stray source itself repeatedly. A plan that reads it as unfrozen fails if the account is frozen when the transaction lands.

**Same class, the holder's own case.** If Coinbase freezes the owner's own cbBTC ATA, the page also fails only at the dry run, with no plain explanation.

**What it breaks.** HOLDER-GUIDE, honest list: *"On the redeem page that cannot block the opening."* It also breaks the review-H1 claim "a stranger cannot block an opening".

**Evidence if true.** On localnet, with the steps above, `planRedemption` returns `helperStrays` containing the stray, and the simulation fails with `InstructionError[2] Custom(0x11)` (or the equivalent for the Core Execute). This is reproducible in `e2e-localnet.mjs`.

**Fix.**
- Parse the owner's destination accounts and their state.
- Treat a frozen destination, or a source whose mint has a freeze authority and is not a reserve, as "cannot move", and list it in a box the holder ticks.
- On any dry-run failure caused by a stray, re-plan automatically without the strays.
- Add both-ways tests in `plan.test.mjs` and the e2e.

### M-1 (MEDIUM): nothing binds the deployed bytes to the audited commit, and the pinned hashes are pre-rescue

**The gap.**
- `web/src/config.js` pins `MAINNET_PROGRAM_BYTES` from `dist/` at **commit 1281ab4**, which predates `rescue_nested`.
- `web/build.mjs` checks only that config matches `dist/SHA256SUMS`. It never checks that `dist/MANIFEST.txt`'s commit equals HEAD, or a named release commit.
- `scripts/build-mainnet.sh` writes the commit and dirty state, and nothing reads them back.

**Consequence.** Suppose step 9 deploys today's `dist/`. MINT would lack the rescue delegate and `rescue_nested`, yet the ceremony's hash check and probe would pass, because any real Anchor program answers 101 to the probe. Vaults would be born without the delegate that the holder guide promises. The vault page's Rescue button would then build an instruction that fails `InstructionFallbackNotFound`.

**Evidence.** Compare `dist/MANIFEST.txt` with `git log -1 programs/cbob-vault-mint`. The `mint` sha in config.js equals that of 1281ab4.

**Fix.**
- `build.mjs` and the ceremony preflight refuse unless the MANIFEST commit equals the release commit, is clean, and descends from the audited HEAD.
- Rebuild `dist/` now and update config.js in the same commit.

### M-3 (MEDIUM): the dress rehearsal cannot run the pages (item 53 regressed)

`scripts/rehearsal-tree.sh` patches `programs bank scripts tests sim launch Anchor.toml`, but not `web/`, which hard-codes the five mainnet ids. Its abbreviated-id check also skips `web/`. The `rehearsal` profile is all TODO and refuses.

So road step 8 cannot run the pages, and item 50 makes them a precondition of step 11. Item 22's named rehearsal items do not include the pages either.

**Fix.**
- Add `web` to both path lists.
- Generate the rehearsal profile from the map.
- Add "every page drives one real action at throwaway ids" to item 22.

### L-1 (LOW–MEDIUM): the claim page refuses any external plugin, so a benign Oracle bricks claims for page users

`planClaim` refuses whenever the Proof of Burn collection or a Proof of Burn carries an external plugin. The page always sends `pob_extra = 0`. The only shipped mitigation for limit 46 (pass-through accounts) therefore has no client.

The charter window cannot reopen (limit 48), so "needs a person" amounts to lost claims at scale.

**Fix (pick one).**
- Read the Oracle adapter's base address from the registry and pass it through (≤4 accounts in the widest legacy shape).
- Or state the gap in SPEC 46 and item 50, and staff a manual claim path for the whole window.

### L-6 (UNCERTAIN): wallet-side modification makes the pages fail closed

`signExact` refuses any change to the message. That is correct. If Phantom, or a Phantom update, appends Lighthouse or priority-fee instructions in `signTransaction`, every page refuses every transaction. During the charter week that would be a total outage of the only client.

**Evidence needed.** One real-Phantom signature per page on mainnet, desktop and mobile, against a dry run only. Nothing in the tree measures this.

### L-7 (LOW): the proxy allows more than the pages need

`sendTransaction` allows arbitrary System and Token instructions, so the endpoint relays generic SOL and SPL transfers on our provider key. `getMultipleAccounts` and `getTokenAccountsByOwner` accept arbitrary addresses. Both are rate-limited only.

**Fix (optional).** Require at least one CBOB program, or Core, in every relayed transaction.

### INFO: redeem page payout block

The payout block does not expire due boosts first. A due boost makes `distribute` fail `BoostsExpireFirst` at the dry run. Prepend `expire_boosts`.

---

## The accepted limits: four questions

### 1. Worse than stated

**M-2 (MEDIUM): limits 13 and 39, and item 58, state the old blast radius.**

Before round 35, MINT's upgrade authority could rewrite levels (limit 13). It could not move a vault: the permanent delegates cannot be added after creation, and owner-managed plugins need the owner.

Since round 35, every vault carries a PermanentTransferDelegate held by a MINT PDA. A malicious MINT upgrade can sign as `["rescue"]` and transfer every existing vault, contents included, anywhere. The upgrade key `FZjLB4…` is hot, sits on the box, and is in the nightly backup.

What keeps vaults from existing before the lock is procedural only:
- `lock_deadline < charter_opens_at` is a JSON check plus an alarm.
- MINT `initialize` accepts `charter_opens_at <= now`, so a late ceremony opens claims at once under upgradeable programs.
- The ceremony only *reports* upgrade authorities.

**Fix.**
- The ceremony refuses MINT initialize unless `charter_opens_at > now + 48h`, or unless all five programs are already final.
- Rewrite limit 13 as custody of all vault contents until the lock.
- Consider making step 11 precede initialize: nothing in initialize needs upgradeability.

**Limit 26:** worse than stated (L-4).

**HOLDER-GUIDE:** H-1 falsifies a promise in the honest list.

### 2. A limit that is not a limit (closed elsewhere)

The SPEC C5 sentence about refusing frozen or Token-2022 accounts is superseded by the page's acknowledgement path. It is stale.

### 3. Discharged items that are not discharged

None found. Item 54 still binds the pages: any page that adds a crank must set the compute-unit limit. Today the pages send none.

### 4. OPEN AND BLOCKING items quietly treated as accepted

- **Item 50:** the pages are built, but H-1 and L-1 mean it must stay OPEN.
- **Item 53:** M-3 makes it more open than its text says.
- **Item 38:** correctly gained `vault_collection` (OPEN).
- **Item 22:** remains OPEN.

### L-2 (LOW): ruling contradiction

DESIGN ruling 3 and SPEC say the CBOBTC Squads *"signs nothing, ever"*. Item 58 now requires it to sign every return of a rescued vault.

The return path is also measured only with a keypair standing in for the Squads (R35.N2a). No arm drives a real Squads v4 vault transaction that CPI-signs a Core `TransferV1`.

**Fix.** Amend the ruling text, and run one mainnet or fork drill of a real Squads return.

---

## What this project should do before launch that AI audit cannot

1. **Reproducible build from an independent machine.**
   - A second person rebuilds the release commit on a clean host and posts the five sha256s.
   - Step 9 deploys only if both match, and only if `dist/MANIFEST.txt` names that commit (closes M-1).
2. **Real-wallet acceptance run.**
   - On mainnet with tiny values, Gary uses the actual Phantom builds (desktop extension and the iOS and Android in-app browsers).
   - Sign one claim dry run, buy, activate, rescue, and redeem against a throwaway deployment, and record whether Phantom alters any message (L-6).
3. **Dress rehearsal that includes `web/`** at throwaway ids (fix M-3 first).
   - Include one Squads v4 return of a rescued vault, a frozen-destination griefing attempt against the redeem page (H-1), and one charter claim with a benign Oracle on a test collection (L-1).
4. **Key ceremony for the upgrade key.**
   - Move `FZjLB4…` off the box onto a hardware wallet before step 9.
   - Use it only on an air-gapped signer for steps 9 and 11.
   - Lock (step 11) before any vault can exist. Item 58 made this key a master key over all custody (M-2).
5. **Have a human sit with Gary during the ceremony.**
   - A person, not the page, confirms each instruction's decoded bytes from a separate decoder (CLI) against `launch/mainnet-init.json`.
   - A tampered page signs whatever it says; SRI and local mode reduce the risk but cannot remove it.
6. **A public bounty and time-boxed review window** on the frozen release commit before step 11. Real adversaries with money at stake find what models do not, and after step 11 nothing can be fixed.
7. **An operations drill with on-call humans.**
   - Page the guardian; stop sales and the sweep from the phone; complete one hand recovery of a revenue cycle.
   - Run one manual Squads return under the `vault_awaiting_return` page.
   - The alarm only detects. People must respond within the cap-times-cooldown windows the limits assume.
8. **Check every major marketplace and wallet** against a test vault that carries a PermanentTransferDelegate: does it list it, flag it, or refuse it? Then publish the result before the charter window opens.