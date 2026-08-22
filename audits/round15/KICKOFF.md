# ROUND 15 — kickoff

Working tree `/opt/cbob-vaults` (private repo `garylhenderson/centralbankofbitcoin`).
Clean at `2f84b40`. **Nothing is deployed. Nothing has minted. Nothing holds real
value.** Read these first, in this order:

1. `SPEC.md` → the section **THE SHIP GATE**. It is now the only thing that
   decides whether this ever holds Bitcoin.
2. `audits/round14/VERDICT.md` → what was accepted, rejected and carried.
3. `~/.claude/projects/-home-ubuntu/memory/project_cbob_vault_programs.md` and
   `project_cbob_vault_acceptance_mechanics.md`.

## The ruling that governs everything

**Gary, 2026-08-22: "We will NOT use a human audit firm. We MUST audit ourselves
with AI."** Every earlier document leaned on a professional firm reviewing a
frozen version. That backstop is gone. The AI process carries the whole weight,
and the three things it structurally cannot do are answered rather than deferred —
see the table in THE SHIP GATE.

## What round 15 is

**Round 15 audits the NEWEST code, which is the code round 14 could not see.**
Fourteen rounds, fourteen with a real finding. Rounds 11, 12, 13 and 14 each found
their worst defects in the PREVIOUS round's repairs or in a file no auditor had
ever read. Assume that again.

Aim it at, in order:

- **`bank/cosign.mjs`** — brand new, never audited. The Bank's pre-signature
  co-signer that every document claimed existed for five rounds and did not. It
  judges shape then coverage, scans the asset-signer PDA by state
  (`getTokenAccountsByOwner` on both token programs + DAS `getAssetsByOwner`), and
  reads the Bank from chain through `pinnedAccountData`. **It is a mitigation and
  never a proof** — the scan is one slot old. Attack: can a redemption it blesses
  still destroy something? Is the DAS paging refusal right? Does the shape
  judgement have a hole? Is refusing two redemptions per transaction correct?
- **`bank/lock.mjs`** — the break is now one atomic `rename` to a name only that
  process knows, plus a "we stole a replacement" branch that restores with an
  exclusive create. Three round-14 auditors named the old interleaving. Is the new
  one actually exclusive, and does the restore path have its own race?
- **Round 14's other repairs**: `applyAcks` / `parseAcks` + `bank/acks.json`
  (an ack DOWNGRADES, never deletes; reason mandatory); `unredeemable_owner` in
  `detectNestedVaults`; the `REDEMPTION_NOISE` allowlist in `correlateBurns`; the
  rewritten `scripts/validate-core-gate.sh`; the ceiling harness 9.14 / 9.14a /
  9.14b and `MAX_RESERVE_MINTS = 3`.
- **The carry-over list** in `audits/round14/VERDICT.md` — 11 items, including
  cross-pass correlation lag, unmeasured compute units, the `prog.*.hash` fixed
  offset 45 being wrong when an upgrade authority is absent, and the foreign
  nested-asset gap.

## Before you launch it

```bash
cd /opt/cbob-vaults
./scripts/audit-coverage.sh        # MUST exit 0. It will flag bank/cosign.mjs
                                   # until you put it in round 15's bundle.
./scripts/run-tests.sh             # 267 on-chain / 275 detector / 17 alloc / 11 mainnet
```

Copy `scripts/audit14.ts` to `scripts/audit15.ts` and edit the prompt. Keep: the
no-human-firm framing, the "a wrong CRITICAL costs real engineering time" warning,
the measured-facts list, and the instruction to report what evidence would exist
if the claim were true. Include `audits/round14/VERDICT.md` so the auditors can
attack the accept/reject calls — that has produced real findings twice.

```bash
nohup npx tsx scripts/audit15.ts > /tmp/audit15.log 2>&1 &   # ~35 min, 8 models
```

## The discipline that is not negotiable

- **Measure before believing.** Roughly a third of fourteen rounds' CRITICALs were
  wrong. The 267-assertion suite runs against real mainnet Core cloned onto a
  validator; it is what has disproven every wrong claim.
- **Every ACCEPTED finding gets a gate that FAILS THE BUILD, proven in BOTH
  directions.** A gate that has only ever said OK is untested.
- **Every REJECTED-but-measurable finding becomes an ASSERTION.** Do not win the
  argument and move on — convert it, so nobody re-litigates it and a change that
  quietly makes it true turns the suite red. Round 13 did this twice (9.12/9.13,
  9.14–9.16).
- **Move every floor with the suite.** `MIN_ASSERTIONS` in `run-tests.sh`,
  `DET_FLOOR`, `ALLOC_FLOOR`, and `FLOOR` inside `bank/selftest.mjs` — that last
  one was 26 below reality until round 14.
- **A comment claiming a control that does not run is a defect.** Six rounds
  running. Point at the control table in `SPEC.md`; never restate it.
- **Do not redesign the mechanics.** The v5 pairing has now held two full rounds
  against eight models each. The redemption path is `open_for_redemption` →
  sweeps → `burn_vault`, atomic, no close, all-or-nothing.

## Where the gate stands

Clean rounds so far: **0**. The gate needs **two consecutive**, against a tree
with no commit to `programs/`, `bank/` or `scripts/` since the first of them, and
**the second must use a different model roster** — the same eight re-reading an
unchanged tree is one round run twice.

So: if round 15 finds nothing that survives measurement, that is clean round 1 and
the freeze has begun — do not touch the tree. If it finds something, fix it with a
gate, and the counter stays at zero.
