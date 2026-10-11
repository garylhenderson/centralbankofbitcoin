# October 11 owner triage follow-up

Requested source: /home/ubuntu/CBOB-TRIAGE-2026-10-11.md. No website publication or Gary Club deployment is authorized until the owner's next Claude re-triage. No holder/trading switch, program, date or financial job was changed.

## Findings

1. Pin acceptance is complete in 5f6b993, following the first-party Claude application review and owner-triage-review.md. The README records the review artifact, checksum and source commit. Both ceremony script hashes are unchanged. All 1,005 offline assertions across 17 files pass, including all 133 bundle assertions; the committed publisher preflight passes.
2. Buy explains revenue, 85/15, empty initial vault and the separate 21,000-sat deposit, activation request and joining distribution. The audit's proposed immediate-earning sentence was intentionally corrected, consistent with the owner's timing direction. P&F section V remains D3, unchanged pending owner approval.
3. The 2026-3 dated notice now includes Bank-only opening, stranded reserves from other burns, the 2.1% rolling-hour limit and Gary Club signing. It links directly to P&F IX; feed marker matches.
4. Statements index says originals are retained with corrections above them.
5. 2026-2 has a dated issuance/activation correction, index marker, feed marker and JSON-LD modification date. Original bodies and titles are preserved.
6. Finalized chain verification found 374 destroyed today, 371 by 17 August 12:00:03 UTC, 369 through the recorded Proof of Burn process and two outside it by the close. The three later burns are excluded from the closing census. Every one of the 374 destroyed mints has a successful parsed token-burn transaction; all 1,030 indexed mint accounts were read, leaving 656 live. Public signatures and block times are in burn-chain-receipt.json. P&F now dates and distinguishes the closing count rather than mislabelling it as today's figure.
7. Cloudflare analytics hosts are allowed on the read-only web/site documents. Compiled wallet and ceremony CSPs remain strict. Gary has been asked whether to keep this recommended scope, expand it to every page, or turn analytics off. This scoped change does not claim analytics is enabled on signing pages.
8. The live timer was moved to the already-reviewed clean worktree /opt/cbob-public-data/61a4cf63524c0497c0e79754f38144ce49b32abe while this batch was edited; it cannot import the editing checkout's changed modules. No timer was armed. The committed follow-up installer pins each future publication to its exact reviewed commit; the launcher rejects dirty, untracked and ignored source, and a wrong commit directory. Launch parameters are now read from that source worktree; mutable ledger cache remains separate. The committed deployment test covers five launcher checks and four activation/rollback cases. The new source will not be installed until re-triage/publication.
9. A MintConfig change triggers up to four complete snapshot reads before retaining the old public record. Five tests cover a simulated mid-read claim, eventual success, exhaustion and non-retryable invalid accounts. A read with a detected MintConfig change is never published; the absence of minContextSlot remains a documented limitation.
10. Opening-limit times and public share/record cards use America/Chicago, including its daylight-saving offset. The generated Gary adapter has only the corresponding formatter change and checksum; it is prepared, not deployed.
11-13. One mobile scroll cue, boost-qualified metadata, grammar/repetition cleanup, plain preopening governance language, holder-specific status headings, full founding timing, payout-weight wording, and non-executable legacy backup scripts. Original backup contents remain intact.

## Remaining gates

Owner's Claude re-triage before publication. D3 financial wording and analytics scope remain owner decisions. D5(b) remains in force; no permanent date is written. Existing holder/trading enablement blockers and remaining audit items in STATUS.md remain open.

## Internal review follow-up

owner-triage-review.md approves bundle-pin acceptance. Pins were accepted with both ceremony hashes unchanged. The new deployment findings are addressed in a separate reviewed delta: dependency imports are checked and a read-only snapshot is tested before switching the timer; the fail-closed base unit is installed; activation verifies its first refresh and restores the previous override on failure; failed activation restores the prior site files and exits nonzero. New data code is activated only after pages publish successfully.

The review’s R1 premise was false: node_modules is a tracked symlink, git mode 120000, blob ebbc58a104bee3ac41904d5b35f43db1234b7a9b, targeting /opt/gary-club/node_modules. A fresh worktree included it automatically, and imports of bs58, web3.js and all three data libraries passed without provisioning. The import preflight was added anyway. The shared dependency install remains an existing operational dependency, not an isolated vendored tree.

The temporary live61a4cf6 producer still reads the unchanged OPEN launch file from the editing checkout. Do not edit that launch file before the source-relative replacement is approved and installed. No launch-file change occurred in this pass. Other nonblocking review notes (RPC context slots, state storage location, non-JSON session errors, initial loading text and status-heading polish) remain recorded in the review; this pass does not claim full launch readiness.

## Final handoff

Application/data source last changed in 88d12e4; bundle pins were accepted in 5f6b993; deployment follow-up source is ecd31bff77b142dd64d3b95e7faab1d3e4a503ac. Gary adapter: 3403fd3303e1cd52854e7613f9e4a24b341b88df. The final handoff commit changes audit documentation only.

First-party Claude's deployment-followup-review.md resolves R1-R3 and finds no new release blocker. It approves this delta for the owner-arranged re-triage, not deployment. VALIDATION.md records the executed checks separately from the read-only review. No new pages or adapter were deployed, and no holder/trading action was enabled.

Residual deployment limitations are explicit in the review: shared mutable dependencies; no timeout on the installer's direct first refresh; partial data/ledger writes are not rolled back with pages; rollback failure diagnostics need improvement; private raw failure logs; and transient RPC/lock failures fail closed. The real production activation and restore paths have not been exercised in this pass. The successful real --prepare check imported the actual dependencies and read a live snapshot without switching the timer. These are remaining risks, not owner approvals.

## Subsequent owner re-triage

The follow-up to CBOB-RETRIAGE-2026-10-11.md is complete and documented in RETRIAGE-FOLLOWUP.md. It supersedes the prior prepared hashes and validation totals: 1,006 offline assertions, 20 deployment/identity checks, nine Gary test groups. First-party Claude cleared the final source and pins. This follow-up includes JavaScript/deployment changes and therefore awaits owner publication approval under the copy-only condition.
