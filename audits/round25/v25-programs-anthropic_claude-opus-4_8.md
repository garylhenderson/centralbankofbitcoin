I'll focus this audit on the highest-value targets, especially the never-audited sweep helper (R1s) and round 24's repairs (R0), which the prompt identifies as the primary risk. I'll say what evidence would exist if each claim were true.

---

# FINDINGS

## R1s — THE SWEEP HELPER (`programs/cbob-vault-sweep/src/lib.rs`)

### CRITICAL — The lamport sweep sends `signer.lamports()` INCLUDING the rent that funds the source token accounts being closed in the same call, but ordering makes it worse: a closed source's rent goes to `dest`, yet the final transfer drains the asset-signer to zero while token-account close CPIs have already credited `dest`. Re-examine: actually the real defect is that **the helper closes the source token accounts to `dest` (the destination WALLET), not to the owner's system account, and then separately sweeps the asset-signer lamports to `dest` — but `dest` is chosen by whoever builds the transaction and is never checked against the asset's owner.**

Let me state this precisely and correctly, because it is the core of R1s(c).

**The construct.** `process()` accepts `dest = accounts[1]`, writable, chosen by the transaction builder. The only checks on it are:
- `signer.key != dest.key` (source-signer cannot be destination),
- each pair's `to_owner == *dest.key` and `to_mint == src_mint`,
- the final `system_instruction::transfer(signer.key, dest.key, lamports)`.

The program **never compares `dest` to the asset's owner.** The comment and the prompt (R1s(c)) claim this is "safe given (a)" — i.e., because only the owner can invoke through Core's `ExecuteV1`, only the owner can move value, so the owner choosing a wrong `dest` only hurts themselves.

**Why that reasoning is incomplete — the griefer angle.** The safety argument assumes the *owner* builds the transaction. But the redeem flow is: SEAL open → Core `ExecuteV1`(sweep) → BURN burn, one transaction, owner signs. The owner signs the whole transaction. A malicious *redeem page* (or any client the holder is tricked into using, or a compromised front end — and the real redeem page is NOT BUILT, item 50) builds the `ExecuteV1` with `dest` = the attacker's wallet. The owner signs once (Core requires the owner's signature for `ExecuteV1`), and **every reserve token and every lamport goes to the attacker**, while BURN still sees an empty vault and burns it. The owner believes they are redeeming to themselves.

This is not a new trust assumption relative to "the owner must use a good client" — but it is strictly worse than v5, where the Bank co-signed and `judgeRedemptionCoverage`/the destination were checked. The prompt's MEASURED FACTS and SPEC repeatedly state the destination "was always the holder's to choose" (discharged item 5), but that was for the SOL *sweep operator* path, not for a redemption that drains all three reserve assets plus SOL in one owner signature.

**The cheap fix that the design already has the material for.** Core's `ExecuteV1` runs with the asset-signer as signer and the asset's owner is known to Core. The helper cannot read "who the owner is" cheaply — but it does not need to. The correct invariant is: **`dest` must equal the asset's owner.** The owner's pubkey is not passed to the helper. The fix is to require the destination wallet to be passed and checked, OR (simplest) to require every destination token account and the lamport destination to be owned by the same key that owns the *source* accounts' authority chain — which is the asset-signer PDA's controller. Neither is currently done.

**Evidence that would exist if I am right:** build a redemption where the `ExecuteV1` sweep names `dest = bob` (a stranger) while `alice` owns and signs. The current SR.2 arm (`3prog.test.ts`) tests exactly `dest = ata(bob)` for the *token* pair and expects REJECT with `CBOB_SWEEP refused: destination`. **So the per-pair check catches a wrong token destination.** Let me recheck the lamport path: the final `system_instruction::transfer(signer.key, dest.key, lamports)` goes to `dest.key` = `bob`. The token pairs would be refused first (the loop runs before the lamport transfer), so SR.2 reverts at the token check. 

**So: is there any `dest` that passes the token checks but is not the owner?** Yes. If the attacker names `dest` = attacker's wallet AND provides `to` accounts that are the attacker's ATAs for each mint, every pair check passes (`to_owner == dest`, `to_mint == src_mint`), and the lamports go to the attacker. SR.2 only fails because it reused `alice`'s `dest` wallet with `bob`'s token account (`to_owner = bob ≠ dest = alice`). **A consistent attacker (dest and all `to` accounts belonging to the attacker) is NOT tested and is NOT refused.**

This is the real hole: **the per-pair check only enforces internal consistency (all destinations belong to the single named `dest`), never that `dest` is the owner.** A malicious client drains a redemption to the attacker and the owner signs it believing it redeems to them. **Severity: CRITICAL**, bounded by "the holder used a hostile client" — but that is precisely the trust the Bank used to remove, the redeem page is unbuilt, and the helper is immutable.

**Fix.** Pass the asset account (or the owner pubkey) into the helper and require `dest == owner`. The asset is already in the `ExecuteV1` context; the helper can read the owner from `data[1..33]` of the asset account (as MINT does). Without this the helper trusts the client absolutely, forever.

---

### HIGH — The sweep helper does not reject a `src` that is frozen, and does not reject `src == to` or duplicate sources, with a concrete double-close / revert consequence.

**(b) duplicate source.** If the same `src` appears in two pairs: the first pair transfers `amount` and closes `src`; the second pair's `read_token(src)` reads a now-closed account (owner no longer `SPL_TOKEN_ID`, or data length 0) and returns `IllegalOwner`/`InvalidAccountData`, reverting the whole transaction. **Consequence: denial, not theft** — a buggy client reverts. Acceptable but worth noting the helper gives no clean error.

**`src == to` within a pair.** `read_token` is called on both; if `src == to`, `src_owner == signer` must hold (source check) AND `to_owner == dest`. Since `signer != dest` is enforced, and `src_owner == signer` while `to_owner == dest`, the same account cannot satisfy both. So `src == to` is refused. OK.

**(b) frozen source.** `read_token` reads only mint/owner/amount at offsets 0/32/64; it never checks `state` byte 108. A **frozen** source token account: the `IX_TRANSFER` CPI will fail (SPL refuses transfer from a frozen account), reverting the redemption. This is the same outcome as the on-chain path (accepted limit 28), so it is not new — but note the helper claims to "move what is there at the moment it runs," and a frozen cbBTC vault account silently reverts the whole redemption. The holder cannot redeem their $GARY/$GIRAFFISH either. This matches limit 28, so **not a new finding**, but the helper's design does not improve it.

**(c) lamport transfer to a non-system / below-rent destination.** `system_instruction::transfer(signer, dest, lamports)` requires `signer` (the asset-signer PDA) to be System-owned. MEASURED FACT 4 says Core's BurnV1 does not sweep the PDA and the PDA holds lamports; is the asset-signer PDA System-owned? It is a PDA with no data (a plain wallet), so yes, System-owned, and `invoke` of a System transfer with the PDA as `from` works because Core made it a signer via `ExecuteV1`. If `dest` is a non-system account that cannot receive via System transfer — System transfer to any account works as long as it is not required to be rent-exempt-creating. **If `dest` is a brand-new account below rent exemption after receiving only `lamports`,** the transfer still succeeds (receiving lamports never fails for rent). OK. But: **if `dest` is itself a token account (owned by SPL Token, not System), the System `transfer` with `dest` as a plain recipient still works** (System transfer credits any account's lamports). So the lamport leg is robust. No new finding here beyond the CRITICAL above.

**Fix for duplicate-source robustness:** none strictly required (fails closed), but the helper should at least document that a client must not name a source twice.

---

### MEDIUM — (e) The sweep closes reserve accounts, but a stranger can create a Token-2022 ATA or a non-ATA token account for the vault's asset-signer PDA that the sweep cannot name and BURN will not skip — re-examine BURN's skip rule precisely.

The prompt R1s(e) asks whether there is any account a stranger can create that neither the sweep can name nor BURN will skip.

**BURN's emptiness proof, second loop** (`cbob-vault-burn/src/lib.rs`): for every `remaining_account`:
- if owned by `MPL_CORE_ID` → must not be a live asset (nested-vault check);
- if `lamports() == 0` → skip;
- if owner is **neither `SPL_TOKEN_ID` nor `SPL_TOKEN_2022_ID`** → skip (`continue`);
- else if `d.len() >= TOKEN_ACCOUNT_LEN` and the account's owner field == pda → run the delegate/extension/amount checks.

**Crucially, this loop only inspects accounts that are DECLARED (passed in `remaining_accounts`).** BURN cannot enumerate; it checks only `declared`. The first (reserve) loop *derives* the canonical ATAs for the three reserve mints under both token programs and *requires* them declared (`ReserveNotDeclared`). So:

- A **Token-2022 ATA for a reserve mint**: derived and required by the reserve loop (`for token_program in [SPL_TOKEN_ID, SPL_TOKEN_2022_ID]`). The sweep helper only handles classic SPL (`*a.owner != SPL_TOKEN_ID` → `IllegalOwner`), so it **cannot empty a Token-2022 ATA.** If a stranger funds the Token-2022 ATA of a reserve mint, the reserve loop finds it declared, owned by Token-2022, length... a T22 ATA is 170 bytes (`ImmutableOwner`), so `d.len() == TOKEN_ACCOUNT_LEN` (165) FAILS → `ReserveHasExtensions`. **BURN refuses.** The vault cannot be redeemed until the stranger's T22 balance is... but it can never be emptied (the sweep is classic-only, and no instruction can sign for the PDA to close a T22 account except Core Execute with a custom instruction the page does not build). **This is a permanent brick of the specific vault** reachable by any stranger, for any reserve mint, if a T22 ATA for a reserve mint can be created. 

But — can a classic-SPL mint even *have* a Token-2022 ATA funded? You cannot mint a classic-SPL mint's tokens into a Token-2022 account; the token program must match the mint's owner program. cbBTC/$GARY/$GIRAFFISH are classic SPL, so their Token-2022 ATAs can be *created* (ATA program allows it) but can never hold a balance (no transfer into them from a classic mint succeeds). An empty T22 ATA: length 170, amount 0. BURN's reserve loop: `acc.owner == SPL_TOKEN_2022_ID` (not skipped), `d.len() < TOKEN_ACCOUNT_LEN`? 170 ≥ 165, so it proceeds; `require!(d.len() == TOKEN_ACCOUNT_LEN)` → **`ReserveHasExtensions` fires on an EMPTY, zero-balance T22 ATA.** 

**So a stranger who creates the Token-2022 ATA (permissionless, costs rent) of ANY reserve mint for ANY vault's asset-signer PDA permanently bricks that vault's redemption.** The reserve loop requires both token-program ATAs declared and refuses on the T22 one's length. The sweep cannot close it. Nothing can sign to close it after the (impossible) burn.

**Wait — is the T22 ATA required to be DECLARED?** The reserve loop does `find(|a| a.key() == expected).ok_or(ReserveNotDeclared)`. So the page must declare both. If the page declares the T22 ATA and it exists (created by the stranger) with length 170 → `ReserveHasExtensions`. If the page does NOT declare it → `ReserveNotDeclared`. Either way BURN refuses. **The vault is unredeemable.**

**Is this new?** The suite's 6.13/`ReserveMintNotClassicSpl` only guards *reserve mints* at SEAL init. The *runtime* T22-ATA-exists case is the `ReserveHasExtensions` path, exercised only for a vault the redeemer griefs themselves. I find **no suite arm where a stranger creates a Token-2022 ATA of a classic reserve mint for a victim's vault PDA and the redemption is then shown to be permanently blocked.** This is a griefing DoS on redemption, permanent per vault, costing the attacker one ATA rent (~0.002 SOL) per victim.

**Evidence if true:** `createAssociatedTokenAccountIdempotentInstruction(stranger, ata(V.pda, cbBTC, T22), V.pda, cbBTC, TOKEN_2022_PROGRAM_ID)` by a stranger, then any redemption of V refuses `ReserveHasExtensions` (if declared) or `ReserveNotDeclared` (if not), forever. This should be an arm; it is not.

**Severity: HIGH** (permanent per-vault redemption DoS, permissionless, cheap, immutable). The mitigation space is narrow: BURN's reserve loop could skip a zero-balance account regardless of extensions (`amount == 0` → empty, whatever the length), which closes it — but that is a program change under the freeze. **This should block launch** until resolved or proven impossible (e.g., if creating a T22 ATA for a classic mint actually fails at the ATA program, which I do not believe it does — the ATA program does not validate the mint's program against the token program passed).

I flag that I have not executed this; the claim rests on: ATA program allows creating a T22 ATA for a classic mint (needs verification on the real validator), and BURN's `require!(d.len() == TOKEN_ACCOUNT_LEN)` firing on a 170-byte empty account. Both are readable from the code; the ATA-creation behavior is the one empirical uncertainty and must be tested before dismissing this.

---

## R0 — ROUND 24's REPAIRS

### MEDIUM (confirms R0/C7-style gap is worse) — SR.3's `because` pin reads `custom program error: 0xb` and claims it is "NonNativeHasBalance: the old sweep cannot even close the account the dust landed in," but SR.3 uses the OLD `sweep()` helper (manual transfer+close), not the new on-chain helper — so SR.3 proves the *old defect* exists, which is fine, but SR.4 (the fix) and SR.4a are the only arms proving the helper works, and SR.4a's assertion is weak.

`SR.4a` asserts `(balance delta) > 500_000` for the stranger's 1,000,000-lamport deposit "less the fee she paid." A `> 500_000` floor passes even if the helper swept only part of the lamports or if fees ate 499,999. The exact invariant should be: owner received `heldT + 1` tokens (SR.4 checks this, good) AND the PDA ended at 0 (SR.4 checks `conn.getBalance(T.pda) == 0`, good). So SR.4 is actually solid on the lamport-zeroing. SR.4a is redundant/weak but not load-bearing. **Downgrade to LOW/INFO** — the lamport sweep *is* pinned by SR.4's `getBalance(T.pda) == 0`. Withdrawn as a real gap.

### LOW — R0/A6: SEAL's `assert_classic_spl` kept its bytes, but the round-24 claim that "MINT's bytes changed and nothing assumes old line numbers" is only partially checkable from the bundle.

The alarm's program-hash baselines (`CORE_SHA256_EXPECTED`, and the per-program sha in `build-mainnet.sh`'s `SHA256SUMS`) are re-pinned at build time, not hardcoded against MINT's old bytes, so a line shift in MINT does not break a pinned-baseline check — `build-mainnet.sh` regenerates `SHA256SUMS` every run. **No surviving assumption found in the bundle.** The one place a source-line-keyed pin could exist is the alarm's `test_value_in_production`, which keys on *values*, not lines. I cannot see `bank/alarm.mjs` or `bank/detectors.mjs` to fully confirm no arm/reason pin is keyed to a MINT source line, so I flag this as **unverifiable from the bundle** — the off-chain files that R0 says must be checked are not all included. If any detector greps MINT source by line, A6's repair is incomplete; the bundle does not let me close this.

---

## R2 — THE COMMUNITY POOL / R2b — THE BOOST

### LOW — `retire` with `forfeit = true` subtracts the full `pending` from `owed_scaled` but logs only `pending / ACC_SCALE`; the sub-sat remainder is forfeited silently. Correct by construction, not a defect: `owed_scaled -= pending` keeps the invariant `pool_balance >= ceil(owed)` intact (the forfeited share stays in the pool, owed by nobody). No finding.

I attacked the pool invariant `pool >= ceil(owed)` across `credit`/`claim`/`join`/`retire`/`reweigh`/`expire_boost` and found the accounting consistent: `credit` adds `delta*w` to `owed`; `claim` subtracts exactly the whole-sat `settled` it paid and carries the remainder in `carry_scaled` (not in `owed`); `reweigh` moves owed into carry and resets debt, touching neither `acc` nor `owed`; `retire`/`expire_boost` subtract `pending` from `owed`. The one subtlety: `owed_of = weight*acc + carry - debt`. After a claim, `debt = weight*acc` and `carry = remainder < ACC_SCALE`, so `owed_of = carry`, and `owed_scaled` retains `carry` for that vault — consistent with the sub-sat dust staying owed. **Invariant holds.** P.32 asserts it. No finding.

### INFO (confirms accepted limit 27 is as stated, not worse) — a boosted dead vault's weight (`+12`) dilutes everyone until `retire_burned`. This is limit 27, correctly bounded. The crank retires first each pass. Not worse than stated.

---

## R3 — THE LEVEL DRAW

### Confirms A1 is correctly WORSE-than-old-text and now stated. 

I recomputed the C-leader selection: C is `blockhash_in_window(.., want_C)` = smallest produced slot in `[want_C, want_C+64]`. A leader holding C's 4-slot group who also could extend into skips can pick among `MAX_SKIPPED_SLOTS`-worth of candidate slots for C's hash plus block-content grinding. SPEC 26 and HOLDER-GUIDE now say "choose among many." **HOLDER-GUIDE:38 and :129-131 now say "pick among several results … choose the level … within the levels still left … one choice affects every vault created in that moment."** That matches the code. **A1 appears repaired in the guide.** No surviving false sentence found for A1.

---

## R5 — THE CHARTER CLAIM / SPEC 46

### HIGH (SPEC 46 is complete as text, but one mechanism it omits) — `claim_charter_vault` passes `pob_extra` accounts to Core's BurnV1 as non-signers, and the burn's fixed account #2 is `payer (signer)` and #3 is `owner (signer)`. An Oracle plugin on the Moments collection that Core consults on burn is given these accounts. SPEC 46 covers "reject every claim" and "admit only its own PoBs." It does **not** discuss whether a malicious Oracle can observe/condition on the *passed-through writable accounts* to do something beyond approve/reject.

W3/A5 established (from Core source `e72d63e`) that Core never CPIs into lifecycle hooks — an Oracle is read-only data Core compares. So an Oracle cannot *act*; it can only approve/reject. **SPEC 46's enumeration (brick, or capture) is therefore complete for the Oracle mechanism.** The one residual the prompt asks about — a third party or PoB holder doing something SPEC 46 omits — I find none beyond what 46 states. **No new finding; SPEC 46 is complete given W3/A5 hold, which depend on the pinned Core binary matching source `e72d63e` (NOT PROVEN — the verdict itself flags `f03e75… not proven identical to e72d63e`).** This dependency is the real open risk: the entire "no owner adapters / Oracles can't act" defense rests on reading a *scratch clone at a different hash than the pinned binary*. Flag as **the single most important unverified assumption in the whole bundle.**

---

## R6 — ONE-TIME CONFIG

### Confirms A6/limit 38: SEAL checks only owners. Correct, mitigated by `check-launch-params.mjs` (JSON, not the signed tx). Limit 38 OPEN. Not worse than stated. The on-curve guardian acceptance means a guardian set to an off-curve key could never pull the brake — but that is caught only by the launch checker, not on-chain. Stated. No new finding.

---

# THE FOUR QUESTIONS ON ACCEPTED LIMITS

1. **Worse than stated:** **Limit 44 (undeclared/destroyed) is worse via the MEDIUM/HIGH above** — a stranger can *permanently brick* a vault's redemption (not just destroy the owner's own junk) by creating a Token-2022 ATA for a reserve mint. This is a *third-party griefing* dimension not captured by limit 44 (which frames it as "the holder, to their own property"). **This should be re-classified and resolved before launch.**

2. **Listed as a limit but actually exploitable/not-closed:** the R1s CRITICAL (`dest` unchecked against owner) is not listed as any accepted limit — it is a new hole in never-audited code.

3. **DISCHARGED not actually discharged:** Item 51's "A5 CRITICAL branch is WRONG" and SPEC 46's completeness both rest on Core source `e72d63e` ≠ the pinned binary `f03e75…`. **The discharge of the owner-adapter-CRITICAL is not soundly discharged** against the actual deployed Core.

4. **OPEN AND BLOCKING treated as accepted:** none improperly demoted; items 38, 50, 52, 53 remain correctly OPEN.

---

# WHAT AI AUDIT STRUCTURALLY CANNOT DO — DO THIS BEFORE LAUNCH

1. **Run the T22-ATA brick test on the real validator.** The HIGH above hinges on whether the ATA program lets a stranger create a Token-2022 ATA for a classic-SPL reserve mint, and whether BURN's `ReserveHasExtensions`/`ReserveNotDeclared` then permanently blocks redemption. This is one `createAssociatedTokenAccount(...TOKEN_2022_PROGRAM_ID)` call plus one redemption attempt. AI reasoned it; only execution settles it. **If it bricks, the sweep helper and BURN are immutable and it cannot be fixed post-launch.**

2. **Add an on-chain `dest == owner` check to the sweep helper before it is locked.** AI cannot guarantee the redeem page (unbuilt) will always set `dest` correctly; the immutable program must not trust the client. Pass the asset account, read owner from `data[1..33]`, require `dest == owner`. This is the single highest-leverage pre-launch change.

3. **Pin the audit to the ACTUAL Core binary, not a scratch clone.** The owner-adapter and Oracle-can't-act defenses (A5/W3, SPEC 46) were read from source at `e72d63e`, explicitly *not* proven equal to the deployed `f03e75…`. Disassemble or behaviorally test the pinned binary for: (a) owner `AddExternalPluginAdapterV1` → `NoApprovals`; (b) Oracle never invoked. AI read the wrong artifact.

4. **Fuzz the pool accumulator with real random draws over thousands of distributions on-chain**, not the host model. The host test models `advance_epoch` only (C2 confirmed). The arithmetic is where silent, permanent value loss hides, and it is the youngest code.