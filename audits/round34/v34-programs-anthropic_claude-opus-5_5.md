# Round 34 programs audit (independent): the full tree at `82bb3ef`

**Result: one MEDIUM (launch-blocking and cheap to cause; it must be measured before anyone relies on it), one LOW, and three INFO. I found no on-chain value defect.**

I have no validator, so nothing below was executed. Each finding states what a measurement would show if I am right. Where I reason from third-party source, I say so.

---

## R0. Round 33's verdict and its repairs

**Verdict and quorum.** The verdict reads "NOT CLEAN; QUORUM MET". It counted 7 of 8 seats. Longcat was correctly excluded: it imitated round 32's text and named round 32's head and roster. I re-read the arithmetic behind the four confirmed items:

- **L1 (pre-funded program id).** The mechanism holds. See finding **F1**: the repair is incomplete.
- **D1 (SPEC REDEEMING step 1).** SPEC step 1 now carries limit 42's measured sizes: 1,367 bytes padded, 1,219 bytes narrow. Repaired.
- **D2 (DESIGN on `MIN_ROUND_PRICE_SATS`).** DESIGN now says "a constant compiled into the program (no `initialize` argument sets it)". This matches MINT, which declares `pub const MIN_ROUND_PRICE_SATS: u64 = 21_000;` and checks it in `set_round`. Repaired.
- **D3 (vacuous suite arm 2.1).** `rec('2.1', …, vMint.ok ? 'ALLOW' : 'REJECT')` now records the mint's own outcome. Repaired.

**Gate-5 obligations.** All three now have arms (R33.G1, R33.G2a/b, R33.G3). R33.G1 does not build the shape the verdict specified (finding **F3**), so obligation W1(a) is still only partly discharged.

**Round-32 and round-33 repairs.** These are present at their sites:
- `14/14` gate cases.
- `last_sweep_at` is in the watched keys.
- The symmetric half-cooldown window.
- The smallest-ever-seen cooldown.

I re-derived the window argument. An honest landed sweep at H forces a thief to wait until at least H + cooldown, which is beyond H + cooldown/2. A vote can only lengthen the cooldown, so the smallest value ever seen is a valid lower bound. The argument holds.

**Independent re-derivation of the raw layouts.** I recomputed these from the structs:

| Account | Result |
|---|---|
| MintConfig | 1,005 + 256 = **1,261** bytes. Every GOV and BURN offset matches: 41, 141, 191/192, 257, 266, 274, 442, 454, 518, 526, 631/639/647, 711, 712. |
| VaultRecord | 211 + 10 = **221** bytes. GOV's offsets (`asset` at 9, `mint_index` at 41) match. |
| BurnConfig | **827** bytes. `burned_total` at 42, ring at 59. |
| SEAL Config | 398 bytes. `collection` at 9, reserve list at 41. |
| GOV Proposal | `ACTIONS_SPACE` 4 + 5 × 37. The largest action is Brakes at 37 bytes (1 + 3 + 33). |

All agree with the code.

---

## Findings

### F1. MEDIUM: a stranger can pre-fund the ProgramData PDA, which the round-33 L1 runbook does not cover

**Construct.** SPEC road step 9, the deploy runbook added by round 33 (L1).

Round 33 measured only one thing: pre-funding the **program account** (the keypair address). The upgradeable loader's `DeployWithMaxDataLen` also creates the **ProgramData** account at `find_program_address([program_id], BPFLoaderUpgradeab1e11111111111111111111111)`.

My reading of the Agave loader-v3 source is that it creates that account with a nested `system_instruction::create_account`, signed by the loader's seeds. System `CreateAccount` refuses a target holding any lamports (`AccountAlreadyInUse`). The ProgramData address is a loader PDA, not the program keypair. So the round-33 recovery (Allocate and Assign signed by the program keypair) cannot apply to it, and nobody else can sign for it.

**What an attacker gains.** About 0.0033 SOL on mainnet (5 × 650,240 lamports) could make all five public ids undeployable under loader-v3. Possibly permanently: the lamports sit in a System-owned PDA that nothing can drain.

The way out would be new program ids. That edits every `declare_id!` and every cross-pinned id (SEAL↔BURN↔MINT↔GOV and the helper) and rebuilds. It also resets the freeze. The ids are already public (SPEC, this prompt, the repository), so nothing prevents this today.

No funds are at risk. This is a launch denial of service that compounds the treadmill.

**Evidence if I am right.** On a throwaway validator:
1. Fund `PDA([pid], BPFLoaderUpgradeable)` with at least the rent minimum for 0 bytes.
2. Run `solana program deploy --program-id <kp>`.
3. Separately, try the hand-built `write-buffer` + `DeployWithMaxDataLen` path.

Both should fail inside the loader, at its inner System `CreateAccount`, with "already in use". If they land, this finding is refuted. That would mean the loader tolerates a pre-funded ProgramData account, and I would want the measurement pinned.

**Fix (no program change).**
1. Deploy all five programs **now**, at their real ids, as ordinary upgradeable programs. This reserves the ids. It is harmless: every `initialize` is gated on `INIT_AUTHORITY`, and the upgrade authority stays ours until step 11. Each later fix becomes an upgrade, not a deploy.
2. Alternatively, measure whether loader-v4 is active on mainnet and can host these ids. It has no ProgramData PDA.
3. In either case, the step-9 runbook must check both addresses, not just the program account.
4. If ids ever have to change, generate them privately and deploy before publishing any source that names them.

### F2. INFO: the step-9 lamport figures are the test validator's, not mainnet's

**Construct.** SPEC road step 9 says "at least 890,880 lamports" and "top it up to … 1,141,440".

Those are local-validator rent figures. Fact 9 and SPEC's own measurement give mainnet's 0-byte rent minimum as 650,240 lamports. On mainnet:
- The smallest blocking deposit is **650,240** lamports.
- The 36-byte rent-exempt minimum is about **833,120** lamports.

The rehearsal the runbook prescribes, "exactly 890,880", cannot reproduce the mainnet minimum on a local validator: a 650,240 transfer to a new account would be refused there.

**Fix.** State both rates, and parameterise the recovery script on `getMinimumBalanceForRentExemption` read from the target cluster.

### F3. INFO (evidence): R33.G1 is labelled "the worst single-signature shape" but does not build it

**Construct.** `tests/3prog.test.ts`, the R33.G1 arm and the shape it builds before it.

The arm mints via `ixMint(...)` with the default `name: 'CBOBTC Vault'` and the short URI. It adds only the Autograph plugin. The round-33 verdict's W1(a) shape, which gate 5 was meant to pin, also had:
- a 64-character name and a 200-character URI;
- all five owner-managed plugins;
- the 640-byte attribute list.

The missing parts are roughly 250 bytes of name and URI plus four plugin headers. In Core's fixed 32 KiB heap, asset size is the variable that matters.

R33.G2 also measures only 0-byte signature messages. Round 33 measured heap exhaustion earlier at 47 signatures (8-byte messages) and 22 (64-byte).

No false pass is implied: triage measured the full shape once. But the label claims coverage the arm does not have. The prompt's "worst single-signature … reveal shapes" claim rests on it.

**Fix.** Give R33.G1 a 64-character name and a 200-character URI, and add the other four owner plugins before the autograph. Alternatively, relabel the arm and leave W1(a) open. Optionally, run R33.G2 at a 64-byte message.

### F4. LOW (an accepted limit is wider than stated): the C-leader cohort is a 4-slot leader group, not a slot

**Construct.** `try_capture`, which computes `want = (slot / 4 + 2) * 4`.

Every vault whose A slot falls in the same 4-slot group gets the same B target, and therefore the same hB and hC. Reveal slots are mint slot + 16, so this covers mints across up to four consecutive slots. More join if skips collapse A, or if a rescheduled vault lands there.

SPEC 26 says "every vault minted in the same slot". The holder guide says "a vault created in the same moment". C's leader's single choice therefore serves a cohort up to about 4× wider than written.

**Evidence.** Check with the host-test model: reveal slots 1000–1003 with every slot produced yield identical (B, C).

**Fix.** Amend SPEC 26 and the honest list ("… created within the same few seconds").

### F5. INFO: the R1s(e) question resolved

BURN requires only the six canonical reserve ATAs to be declared, and skips every undeclared account. Of those six:
- Token-2022 ATAs for classic mints cannot be created (measured, F4.2).
- Classic ATAs, once the prior transaction creates them, cannot be closed while the vault is sealed.

So no stranger-created account exists that BURN must check but the sweep cannot name. The prior transaction is sufficient as well as necessary. Everything else (non-ATA classic accounts, Token-2022 accounts, nested Core assets) is skipped and destroyed, as items 44 and 9 state.

---

## Targets checked with no defect found

**R1. Custody.**
- SEAL and BURN pairing: both directions bind asset and owner by top-level index.
- Wrappers: covered by WR.1–3.
- Ownership changes mid-transaction: a transfer during the thaw makes the burn refuse `NotTheOwner`.
- A nested vault's PDA can sign via Execute during its host's thaw. It still cannot redeem the nested vault, because a top-level owner signature is required.
- The emptiness loops agree with each other.
- The lamports check sees exactly what the helper left. Nothing in the redemption between the sweep and the burn credits the asset-signer.

**R1s. The sweep helper.**
- (a) Access: SR.5–5d match Core's rule as read.
- (b) A duplicate source fails at the second, already-closed account. A source can never also be a destination, because their owners differ.
- (c) The destination is the owner's own choice.
- (d) Nothing credits the asset-signer between the sweep and the burn.
- A close authority set on a source would block the close. Only the owner can set one, and only during their own thaw.

**R2. The pool.**
- The invariant holds. `credit` adds at most `avail × S`. `ceil(owed)` grows by at most `avail`, and `avail` is the balance minus the old `ceil(owed)`. Each claim removes exactly what it pays.
- The counters are consistent under join, retire in the same epoch versus a later one, and `advance_epoch` resetting `pending_this_epoch`.
- No permanent block: every eligible-but-unjoined vault can be joined by a free claim (no liveness or account check), or retired.

**R2b. The boost.**
- Ring slots cannot collide: live end epochs lie within 63 of the current epoch, and due boosts leave the ring at advance.
- `reweigh` conserves what a vault is owed.
- `retire` handles both the due and the not-yet-due branch.

**R3. The draw.** The parse is fail-closed. FIFO holds, including a burned vault at the head of the queue.

**R4. Governance.** Per-kind ordering is correct. Restart halves skip consistently with MINT (`>=` versus `<`). The half-of-all-vaults rule applies even when the guardian arm itself is skipped, which is stricter, not looser.

**R6. Initialize, royalty and rate limit.** The `initialize` gates are correct. The rate limit's k-th-most-recent index `(head + 64 − k) % 64` is correct. The royalty with authority None is correct (R33.G3).

**R7. Raw reads.** All match, per the table above.

---

## The four questions about the accepted limits

1. **Worse than stated:** item 26 (F4). Item 25 is unchanged.
2. **Listed as a limit but already closed:** none found.
3. **Discharged but not actually discharged:** round 33's L1 repair, the runbook (F1). Item 54 still binds the pages, as it says.
4. **Open items quietly treated as accepted:** none. Items 22, 38, 50, 52 and 53 remain open in the text.

---

## Before launch: what an AI audit structurally cannot do

1. **Claim the ids now (F1).** Deploy all five programs upgradeable today, and verify both the program accounts and the ProgramData accounts exist and are ours. Nothing in a model's reading can protect a public address from a 0.003 SOL griefer.
2. **Rebuild from source on independent machines.** Two people on two machines rebuild `82bb3ef`. Both match `dist/SHA256SUMS`, and both match the bytes read back from mainnet before the lock.
3. **Prove Gary's key is the compiled constant.** On a throwaway mainnet deployment of the *mainnet* artifacts, have Gary sign `initialize` with his real key. This is the one proof `build-mainnet.sh` admits it cannot give.
4. **Read back every initialize value from chain.** Diff each against `launch/mainnet-init.json` by a second person, before anything mints and before the lock.
5. **Get human-reviewed, testnet-proven evidence for each third-party assumption** (Core's Execute and heap behaviour, the loader, Pyth, Orca, Meteora). Pin each to a dated transaction signature, not to source reading. Several conclusions here, F1 included, rest on reading Agave or Core source that the pinned binaries are not proven to match.
6. **Hold the Moments update-authority key cold through the 7-day window** (limit 46). An AI cannot secure a hot key. It is Gary's call, but it is the single largest pre-launch exposure.
7. **Run a paid bug bounty** against the rehearsal deployment, with real economic incentive, for at least the length of the dress rehearsal. Adversaries with money behave unlike models with prompts.