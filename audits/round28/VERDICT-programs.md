# Round 28, PROGRAMS pass: NOT CLEAN; INCOMPLETE QUORUM

**Final verdict against frozen HEAD `93f8c366a0d822895ee981818e3b667912b9dc0e` (repair code `e109b31`). All eight requests finished or failed. Five substantive completed auditors were counted; six are required. This pass cannot count toward convergence.**

The clean-round counter remains **0/2**. Independently confirmed surviving findings also make this tree **NOT CLEAN**, irrespective of quorum. Later repairs cannot retroactively clean this audit.

**30 deduplicated claim groups: five confirmed new topics — 0 CRITICAL, 0 HIGH, one MEDIUM, one LOW and three INFO — and 25 other dispositions.** The runtime-log topic and stale audit-status component overlap the off-chain verdict and must be counted only once in the combined round.

## Auditor dispositions

`MANIFEST-programs.json` records the frozen HEAD, an empty dirty-path list, eight requests, five auditors and a six-auditor requirement. The runner exited 1 because quorum was not met.

| Auditor | Disposition |
|---|---|
| anthropic/claude-opus-5.5 | Counted. Completed current-tree review, 23,391 characters. |
| minimax/minimax-m3 | Counted. Completed, 30,962 characters. Its opening commit/round label is inaccurate and several claims are false, but its body substantively analyzes the current reader, repaired fixtures, counts and controls. Incorrect conclusions alone do not exclude an audit. |
| qwen/qwen3.8-max-prime | Counted. Completed, 22,085 characters; current-tree review with a refuted v1-format premise. |
| fireworks/ember-1 | Counted. Completed, 31,344 characters; current repair verification and source-specific findings. |
| z-ai/glm-5.3-prime | Counted. Completed, 31,450 characters; current repair verification and concrete measurement questions. |
| xiaomi/mimo-v2.6-pro | **Excluded:** `finish_reason:length`, 128,000 output tokens, 562,522 characters. Reasoning-only output ends in an unfinished loop; one launch-branch sentence repeats 755 times. Bounded head/tail/candidate scanning found no completed verdict. |
| anthropic/claude-opus-5 | **Excluded:** `finish_reason:length`, 128,000 output tokens, 37,716 characters; report ends mid-discussion. Its entire available partial was nevertheless read and concrete claims investigated, including Autograph growth. It is not a completed audit vote. |
| moonshotai/kimi-k3 | **Excluded:** request timed out/aborted. Entire 39-character file is `FETCH FAILED This operation was aborted`; no substantive report. |

## Method and evidence

All five completed reports were read in full, as was the substantial Opus 5 partial. Mimo's degenerate partial was scanned within the boundary above. Claims were checked against frozen source, round-27 verdict/validation records, retained execution evidence and bounded independent measurements. No audited source, production send, live alarm/crank/revenue import, notification or key/secret dump was performed by this triage.

Fresh host checks passed **6/6**, and PoB checks passed **14/14** (`.cache/triage28p-host.log`, `.cache/triage28p-pob.log`). All five localnet control artifacts in `.cache/ln/sbpfv3-solana-solana/release/` independently equaled current `target/deploy/`; the sweep helper also equals certified mainnet `dist/`. This establishes current comparisons, not an automatic provenance guard for every future run.

Retained prior validation is **848 on-chain / 860 detector / 39 allocation / 22 poster / 14 PoB / 47 launch / 33 mainnet checks actually run / 6 host / 16 swap-fork**, with five unchanged mainnet artifact hashes and rehearsal reverse proof. The **71/71** simulation was reused for unchanged CBOB logic/artifacts, not rerun here. Changed dependency binaries require fresh validation rather than silently extending that reuse.

Two coordinated validator windows were used: read-only dependency dumps during the off-chain agent's expiry probe, and this agent's isolated Autograph measurements. This agent's validator processes exited and ports 8999/9900 were free afterward.

## Confirmed new findings

| ID | Severity | Independent disposition and repair |
|---|---|---|
| M1 — Opus 5.5 M1; shared off-chain M1 | **MEDIUM** | `txread.mjs` accepts the standalone runtime `Log truncated` marker as complete string-array logs. The valid v1 fixture still passes after replacement with truncated logs (`.cache/triage28p-log-truncation-probe.log`). The off-chain pass measured actual alarm/poster fragments advancing across this incomplete evidence, losing event-only notices/drafts. Agave's default collector limit is 10,000 bytes and emits the marker when a line is omitted. Later smaller lines can still fit; not every later line is necessarily lost. Refuse the runtime marker before cursor progress; ordinary `Program log: Log truncated` is a different string. No CBOB log-filling attack was sent. |
| L1 — Opus 5.5 L3 | **LOW** | Bundled Token-2022 and ATA binaries differ from actual mainnet bytes; direct mainnet/local comparison confirms both differences, while classic Token exactly matches. This is a dependency-evidence gap, **not a demonstrated CBOB behavior failure**. Generic prior runtime limits do not explicitly disclose these current differences. Pin actual binaries, load and verify them on each validator, and rerun affected suite/simulation/fork checks. Program IDs or executable presence do not prove byte identity. |
| D1 — Opus 5.5 I1/I7; Ember F1; GLM F1 | **INFO** | Missed description siblings survive: SPEC's opening denies any multi-model round; “Where this stands” ties current counts to round 26 and omits completed round 27; discharged 12/17 calls historical 58,956-CU/890-byte **v5** figures “the artifact” without the v5 scope already at SPEC 956. Use durable FREEZE references and label historical measurements. Historical round records should remain historical. |
| D2 — Opus 5.5 I2; excluded Opus 5 F9 | **INFO** | C.13 tests truthiness of unconditional `mkV` after separate PDA claim controls; 7.6 repeats R27.V1's result. These assertions add no distinct state evidence. Actual EOA/PDA success coverage remains elsewhere; alleged loss of all EOA coverage is false. Replace them with stopped-sales charter-count increment and exact YES/NO tally delta, preserving fixture population and assertion count. |
| D3 — Opus 5.5 I5/I6 | **INFO** | DESIGN 204, MINT 349 and BO.7 say anyone boosts, while live owner is required; MINT 327–328 retains the deleted monthly per-weight minimum; an operator-replacement doc block attaches to `set_boost_terms`; GOV's action summary omits `SetBoostTerms`. Repair these siblings. Permissionless **expiry** and explicitly historical deleted-cadence text are correct. Preserve Rust line positions and prove actual artifact equality after comment edits. |

## Accepted limits, bounded coverage and optional work

| ID / reports | Disposition |
|---|---|
| A1 — Opus 5.5 L1; excluded Opus 5 F7 | Automatic all-five localnet/deployed-file comparison is missing from the build script, but current five comparisons independently match. The runner rebuilds, copies and logs deployment hashes. No current stale artifact was demonstrated. Future provenance hardening is useful, not proof that present measured bytes are wrong. |
| A2 — Opus 5.5 L2 | Explicit free distribution at zero active weight is not separately demonstrated by the inline launch-tick arm. Shared inline ticking, burn refusal and joining gates have measurements. Additional branch coverage is useful; no wrong program result was shown. |
| A3 — Opus 5.5 L4; excluded Opus 5 item 19 | Future Core tombstone changes can break retirement/reveal. SPEC 40 declares that immutable dependency and redemption/queue-halting consequences. Item 19 closes activated-but-unlevelled/levels.json behavior, not every possible Core failure. No absent-account fallback or record-only reveal redesign is justified by this hypothesis. |
| A4 — Opus 5.5 I3 | Frozen owner destinations can fail transfers atomically. The issuer may freeze accounts beyond vault sources; clients need usable destinations. This is the existing limit-28/client-preparation boundary, not stranger theft. |
| A5 — Opus 5.5 I4; GLM helper fit | The 1,061-byte base and padded legacy shapes are bounded measurements, not guarantees for arbitrary rescue pairs, ATA creations or wallet additions. Items 42/50 and prior round-26 L13/round-27 L5 state this. v0 execution was measured; wallet/client integration remains open. |
| A6 — Opus 5.5 I8 | Lost/unavailable vaults can make snapshot participation unreachable. SPEC 47 expressly allows permanent stop below the required half. PDA ownership does not prohibit voting: R27.V1 measures it. No denominator bypass was found. |
| A7 — Opus 5.5 I9 | Boosted full BURN redemption is not separately exercised by bare-retirement boost arms. Shared unscheduling and normal redeemed guards have evidence, but this cross-product remains unexecuted here. No incorrect program result was demonstrated. |
| A8 — Opus 5.5 I10; excluded Opus 5 F3 | Governance can choose any positive boost price, or zero to disable, under fixed weight/epoch bounds. Ordinary voting threshold and concentration effects are disclosed. A worked cheap-price coalition example is explanation, not a newly discovered authority or reason to invent a price floor. |
| A9 — Ember F2; excluded Opus 5 F5 | Initialization does not enforce absent CBOB mint/freeze authorities. Item 38 makes ruled-value selection/signed-transaction construction a ceremony obligation; the actual ruled mint lacks both authorities. “No arm accepts an authority-bearing mint” is false: suite 307 creates synthetic CBOB with deployer mint authority and successful initialization uses it. |
| A10 — Ember nesting observation | Moving an inner asset out of a thawed outer vault ends nesting before burn. This does not contradict destruction of an **undeclared asset still held at burn**, or inability to redeem while nested. No rescue client/complete rescue transaction was executed here. |
| A11 — Qwen G1/G2; excluded Opus 5 F8 sampler | Programs-only bundle cannot prove every consumer cursor path; the other pass covers them. Missing/null metadata intentionally means unknown coverage. Refusing a certification sample is not a silent green or reason to normalize unknown history to empty. Historical/provider omissions remain bounded availability concerns. |
| A12 — all reports | Holder pages, wallets, deployment/initialization, key ceremonies, live revenue cycles/recovery, independent builds and operational rehearsals remain open where the ship gate says so. Mutation/fuzz/long-duration exercises are further evidence, not completed work or automatically new defects. |
| A13 — excluded Opus 5 F4 | Durable custody vote aggregation follows measured PDA-vote/transfer capability and the existing transferable-vault/vote-rental model. No extra vote, minority bypass or new authority was demonstrated. Custodied redemption restrictions remain stated. |
| A14 — excluded Opus 5 F2/F6; other coverage notes | More wSOL, delegate/close-authority, alternate destination, interposed-deposit and discriminator arms are useful coverage. No broken current instruction/offset was identified. MINT's SEAL discriminator is exercised by successful mint paths; an unused exported constant is not a runtime mismatch. |
| A15 — excluded Opus 5 F10 | Inline third-layer behavior is monthly distribution; activation and delivery require named permissionless instructions. Guide is explicitly DRAFT, crank explicitly dry-run, and item 50 already includes holder-triggered payout/join obligations. A clearer fallback label is reasonable; no activation/claim page or live automation was certified here. |

## Refuted or unsupported concrete premises

| ID / reports | Independent disposition |
|---|---|
| W1 — Minimax/Qwen v1 findings; excluded Opus 5 F8 | **Wrong format premise:** v1 has inline addresses, no lookup tables and a described transactionConfig. v0 lookup keys remain accepted. Existing negative/positive assertions cover the distinction. Removing guards on an invented valid-v1-ALT premise is not a repair. |
| W2 — Minimax lock finding | **Wrong source:** selftest imports lock.mjs at line 10 and executes real lock tests. “Unimported/untested” is false. |
| W3 — Minimax permanent boost halt | **Wrong permanence:** later voting can change price; zero already intentionally disables purchasing. High positive price is not irreversible. |
| W4 — GLM F2 | **Measured counterexample:** a real CPI-less legacy Vote at mainnet slot 453761274 returned innerInstructions `[]` and passed the actual reader. Fixture/log retained. This does not certify every provider/history response; missing metadata stays unknown. |
| W5 — GLM F3 | **Unsupported frozen-destination acceptance premise; regression required.** Classic Token refuses frozen endpoints. The cited suite does not directly measure the frozen Squads destination; draft a split refusal with exact Token `0x11`, unchanged three token balances and unfrozen control under the rejected-but-measurable rule. This triage did not run that new arm. |
| W6 — excluded Opus 5 F1 | **No confirmed HIGH/CRITICAL:** complete-vector Autograph updates are not unconstrained appends. Six legally written large-message states and a sequential distinct-signature state were revealed by actual MINT. A further append failed before persistence. Detailed boundaries below; arbitrary mixed shapes remain unproven. |
| W7 — excluded Opus 5 F9's C.2/2.1 extension | These markers follow awaited claim/mkVault calls; failed actual sends throw and fail the runner. They do not let failed creation silently pass. Their presentation could be more locally attributable, but actual success is gated, unlike the detached constructor check in D2. |
| W8 — excluded Opus 5 withdrawn allocation attack | Funding an allocated asset-signer leaves lamports and makes paired burn fail, reverting allocation; zero-lamport account state does not persist as alleged. The report withdrew its premise. |
| W9 — excluded Opus 5 withdrawn duplicate keys | Runtime rejects loading the same account twice; no valid landed duplicate-key response was shown. The report withdrew its claim. |
| W10 — excluded Opus 5 withdrawn destination binding | Owner-authorized Execute already allows a chosen destination. A different helper destination is not stranger authorization; the report withdrew the claim. Client transaction review remains required. |

## Dependency-byte measurement

Mainnet program/programdata reads shared slot **453760776**; coordinated local validator was read at slot **74**. Programdata headers were removed; legacy-loader ATA bytes were hashed directly.

| Program | Mainnet SHA-256 | Local bundled result |
|---|---|---|
| Classic Token | `8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b6237f3311a98f697` | Exact match, 108,600 bytes. |
| Token-2022 | `0999dbf708971e723b08d1caafc988826a59c6001ed6dc02260da07defbe1469` | Mainnet 1,382,016 bytes versus local 506,896 bytes, local hash `a794161408080f690dac00832f45b3c3e2b71f1339586667ad1f979cf91d5b68`. Difference survives trimming trailing zeros. |
| ATA | `6804554e69fd3a58caa191dc4a58f4c67223d30ca28ab8987f39fc18d2f7374d` | Both 105,032 bytes; local hash `e5e7aed11ad3969eea2aa76c8b4d2e73ea25be7e6b5cce989b7710cf5452496e`; 1,506 differing bytes, including .text. |

Evidence: `.cache/r28-token-byte-comparison.json`, mainnet/local token-byte manifests, retained `.so` files and `.cache/triage28p-token-byte-probe.mjs`. All mainnet ELF flags are `0x0`. Headers motivate Core's SBPFv0 feature configuration; they do not prove every dependency lifecycle. The drafted shared helper must verify actual local dumps, not just boot arguments. The full subsequently drafted pinned-dependency suite was not executed by this triage.

## Autograph measurements and limits

Pinned Core (`f03e7537…`) and existing localnet MINT (`0590a074…`) ran in fresh isolated validators. Genesis supplied canonical valid-layout config/record fixtures, captured entropy and 600-byte user attribute content. Core collections/assets were actually created and plugin writes actually authorized. A scratch test-only CPI writer generated large instruction payloads; oversized Core account state was not injected. Actual MINT reveal transactions then landed with expected levels.

| Written message bytes | Asset bytes before reveal | Reveal simulation CU |
|---:|---:|---:|
| 1,000 | 1,861 | 45,867 |
| 3,000 | 3,861 | 47,014 |
| 5,000 | 5,861 | 48,179 |
| 7,000 | 7,861 | 49,344 |
| 9,000 | 9,861 | 50,509 |
| 10,150 | 11,011 | 51,200 |

All six writes and reveals landed. Separately, sequential real Core updates added **56 distinct PDA autographs** with empty messages. Adding the **57th** failed inside Core with an allocation error and rolled back, leaving 56. The retained 2,841-byte asset's reveal landed; its simulation consumed **52,158 CU**.

Both probes supplied 1,400,000 CU and requested a 262,144-byte heap frame. These are **bounded observations, not a global maximum reachable-state proof**, not every message/count combination and not all five owner plugins at these sizes. Genesis config/record fixtures mean this is **not a complete mint/activation lifecycle replay**. Failure to write a larger state is not evidence that revealing it would fail. No FIFO-skipping program repair is supported.

Evidence: `.cache/r28-autograph-probe.mjs`, its log, `.cache/r28-autograph/results.json` and simulations; `.cache/r28-autograph-count-probe.mjs`, its log/results; scratch writer under `.cache/r28-autograph-writer/`. All owned validator processes stopped; both ports were free.

A durable narrow regression was drafted on existing C1 using test-only `PADTAIL!` to write the SDK-encoded 10,150-byte final message before the existing real FIFO-head reveal. The tail guard, payload bound and inherited signer flags were reviewed; full-suite execution with all plugins and cleanup is still needed. The draft **852** on-chain count and other draft counts are not results of this triage.

## Remaining requirements

Repair all five topics, execute the frozen-destination and durable Autograph regressions, rerun pinned-dependency suite/simulation/fork, and record fresh build/rehearsal proofs before another frozen round. A new independent expiry validator must run after the main suite's validator stops; its initially incorrect draft placement was identified and corrected, not a defect in this frozen tree.

Primary references: [Solana transaction formats](https://solana.com/docs/core/transactions/versioned-transactions), [Agave log collector](https://raw.githubusercontent.com/anza-xyz/agave/master/svm-log-collector/src/lib.rs), and [optimized Token release description](https://solana.com/upgrades/p-token). Captured byte comparisons, not release prose, establish actual dependency equality/differences.

**Result: INCOMPLETE QUORUM (5/8; six required) and NOT CLEAN. Counter 0/2.** Holder surfaces, live rehearsal, initialization and lock ceremony remain separate open ship gates.
