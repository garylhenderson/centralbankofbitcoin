CBOB Vaults — audit round 6. Fresh eyes, top models, iterate until nothing survives.

READ FIRST, do not re-derive any of it:
  ~/.claude/projects/-home-ubuntu/memory/project_cbob_vault_programs.md
  ~/.claude/projects/-home-ubuntu/memory/reference_cbob_vault_core_primitive.md
  ~/.claude/projects/-home-ubuntu/memory/reference_solana_program_toolchain.md
  ~/.claude/projects/-home-ubuntu/memory/project_cbob_vault_economics.md
  /opt/cbob-vaults/SPEC.md
  /opt/cbob-vaults/audits/round5/VERDICT.md   <- every finding accepted AND rejected, with reasons

STATE
Repo /opt/cbob-vaults, pushed to github.com/garylhenderson/centralbankofbitcoin (private).
Four Anchor programs, ~2,000 lines: seal, mint, burn, gov. 82/82 green on a local
validator running REAL Metaplex Core cloned from mainnet with REAL SPL tokens.
Five audit rounds done; every round found something real. NOTHING HAS MINTED and
nothing holds value.

  ./scripts/run-tests.sh            82 assertions
  ./scripts/validate-core-gate.sh   proves the runner's Core check fires both ways
  node bank/selftest.mjs            29 alarm detector assertions, both directions
  node bank/distribute.mjs --selftest   10 payout allocation assertions
  ./scripts/build-mainnet.sh        mainnet artifacts + proof of which key shipped

DO THIS
1. Round 6 via OpenRouter (OPENROUTER_API_KEY in /opt/gary-club/.env.local).
   Reuse /opt/cbob-vaults/scripts/audit5c.ts as the harness. Use the TOP model of
   each family plus opus: openai/gpt-5.6-terra-pro, x-ai/grok-4.20-multi-agent,
   moonshotai/kimi-k3, anthropic/claude-opus-5. Check the live model list first —
   these move.
   Feed them ALL FOUR programs plus the bank/ pipeline. Round 5 audited three
   programs; gov, the revenue path, the distribution engine and the alarm have
   had ONE round or none.
2. Triage every finding. Fix what survives. Record what you REJECT and why.
3. Re-run every suite to green.
4. Repeat rounds until a round produces no finding that survives scrutiny.
5. Email gary@gary.club a complete report (/opt/scripts/send-as-gary.py, no em
   dashes, body via --body-file).

THE STOPPING CONDITION, HONESTLY
"Until AI comes back clean" is the goal, but these models are PROMPTED to find
faults and will always return something. A round that returns nothing may mean
nothing is left, or may mean the prompt has taught them what is already fixed.
So the bar is: NO FINDING SURVIVES MEASUREMENT — not "no findings returned".
Two rounds in a row where every finding is either already-known, already-fixed,
or disproved by a test you actually ran, is the real signal. Say plainly which
of those you reached. AI rounds sharpen this; they do not sign it off, and a
human audit firm on a frozen version is still owed before real Bitcoin.

ABOUT THE AUDITORS — roughly a third of "CRITICAL" findings across five rounds
were WRONG. Never apply a finding unread. Ask what evidence would exist on-chain
if the claim were true, then go look. Three of round 5's rejections were settled
by measuring on a validator, not by arguing.

REJECTED ALREADY — do not re-apply, and be suspicious if a model re-raises one:
  * "the trailing 0 byte breaks Borsh so every mint/burn reverts" — refuted by
    the suite against real cloned Core. [12,0] is BurnV1 + Option::None.
  * "the COption tag is 1 byte, a revoked delegate traps a vault" — MEASURED: the
    tag is 4 bytes, reads [0,0,0,0] after revoke, and the stale 32-byte payload
    is never read. The proposed fix was strictly weaker.
  * "payment before the CPI can strand a buyer" — transaction atomicity.
  * "drop burn's lamports==0 check, Core BurnV1 sweeps the PDA" (grok) — MEASURED
    FALSE. After a real burn the PDA still held all 5,000,000 lamports.
    APPLYING THIS WOULD HAVE DESTROYED CUSTOMER SOL. Core's BurnV1 account list
    never includes the asset-signer PDA.
  * "vaults may be born unfrozen" — MEASURED: plugin decodes frozen=true and an
    owner's bare Execute with no open is refused on-chain (Core 0x9).
  * "require a minimum mint price" — REJECTED ON THE BUSINESS. price 0 is a
    requirement: the charter round is free by design.

PROVEN IMPOSSIBILITIES — do not file as bugs:
  1. A bare Core BurnV1 by the owner cannot be prevented while the vault stays
     freely transferable. There is no burn-only lock.
  2. Token accounts owned by a PDA cannot be enumerated on-chain. Same for nested
     Core assets. That gap is the Bank alarm's job and is stated, not hidden.
  3. A vault transferred to its own asset-signer PDA is bricked forever.
  4. Core's BurnV1 does NOT sweep the asset-signer PDA.
  5. Pubkey::is_on_curve is HOST-ONLY — compiles for BPF, panics at runtime.
     There is no on-chain test for "is this a PDA"; require a signature instead.
  6. The SOL->cbBTC swap cannot be trustless without a DEX CPI. The SPLIT is
     enforced on-chain; the SWAP is the one trusted hop, and it is bounded,
     ledgered and reconciled rather than pretended away.

TOOLCHAIN TRAPS THAT COST REAL TIME — all encoded in scripts/run-tests.sh:
  * Build with cargo-build-sbf --arch v3 --features localnet. "sbpf_version not
    enabled" means the binary is too OLD, not too new.
  * The validator needs --deactivate-feature for SIMD-0500 AND SIMD-0161, or real
    mainnet Core (which is SBPFv0) will not load — with the SAME error string a
    stale toolchain gives.
  * core-mainnet.so must come from `solana program dump`, NOT `solana account`
    (which prepends 45 bytes of programdata header before the ELF magic).
  * pkill -x solana-test-validator matches NOTHING (comm truncates to 15 chars →
    solana-test-val). Get this wrong and you certify against the WRONG validator,
    green. The runner now hard-gates on Core being byte-identical to mainnet.
  * FRESH ledger every run: config PDAs survive a redeploy and collection is
    non-rotatable, so a re-run against a used ledger correctly fails.
  * --features localnet swaps a test INIT_AUTHORITY in, because the real one is a
    Squads vault PDA that cannot sign locally. A byte search CANNOT tell which key
    shipped (the compiler folds the compare into immediates). build-mainnet.sh
    verifies by behaviour instead.

TEST DISCIPLINE — these caught real defects in round 5:
  * ALWAYS read the error string on a passing negative test. Three tests "passed"
    on AccountNotEnoughKeys, i.e. Anchor bouncing a short account list before the
    code under test ever ran. A REJECT for the wrong reason is a FALSE PASS.
    Every negative test now asserts WHY it rejected — keep that up.
  * A gate that has only ever said OK is untested. Prove every new check in BOTH
    directions.
  * Never weaken a check to satisfy an auditor. If a finding says a guard is too
    strict, first ask what breaks if you loosen it.

WHERE THE REMAINING RISK ACTUALLY IS — spend the round here, not on the seal:
The seal program has survived five rounds and the last three found nothing in it.
The unexamined surface is: the gov program (one round), the revenue path
(mint's split_revenue / sweep_sol_for_swap / set_collection_royalties, one
round), the hand-built Core CPI for the Royalties plugin (NEVER TESTED against
real Core — set_collection_royalties has no test at all yet, write one), the
off-chain bank/ pipeline (alarm, distribute, revenue) which no model has ever
seen, and the operational setup: key handling in bank/keys, the crons, and what
happens when a job half-fails.
