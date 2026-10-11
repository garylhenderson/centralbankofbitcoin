# Correction batch validation, 11 October 2026

Reviewed Bank source: ecd31bff77b142dd64d3b95e7faab1d3e4a503ac, v6, pushed.
Gary adapter: 3403fd3303e1cd52854e7613f9e4a24b341b88df, cbob-ecosystem, pushed.
Subsequent handoff changes are audit documents only.

## Executed checks

- `node web/test/run-all.mjs`: 1,005 assertions passed in 17 files, including 133/133 bundle and 56/56 ecosystem assertions. Log: /tmp/cbob-final-offline-suite.log.
- `python3 web/test/public-data-deploy.test.py`: 9/9 passed, with temporary source trees and injected activation/rollback callbacks. This does not exercise production systemd.
- Gary `npm run test:cbob`: 9/9 groups passed. Log: /tmp/cbob-owner-triage-gary-tests.log.
- `bash web/deploy/publish-ecosystem.sh --check ecd31bff77b142dd64d3b95e7faab1d3e4a503ac`: passed; zero static documents differ; reviewed commit, pins and build checked. Log: /tmp/cbob-final-publish-preflight.log.
- `bash web/deploy/pin-public-data.sh --prepare ecd31bff77b142dd64d3b95e7faab1d3e4a503ac`: passed with a real fresh detached worktree, actual runtime imports and read-only chain snapshot. Timer unchanged. Log: /tmp/cbob-final-data-source-preflight.log.
- Browser checks: 24 page/viewport combinations at 375 and 1440 pixels, no runtime exceptions or horizontal overflow. Targeted session, invalid-asset and census/CSP flows passed. Log: /tmp/cbob-owner-triage-browser.log.
- Seven original numbered statement bodies and titles preserved against 1ddbb43. Feed XML and JSON-LD parse. Added links and anchors verified; triage-links.json records follow-up targets.
- Frozen paths `programs/`, root `dist/`, Anchor.toml, Cargo.toml and Cargo.lock have no diff against 1ddbb43.
- Final deployment delta since 5f6b993 consists of deployment scripts, deployment tests, handoff documentation and two README copy corrections. README changes do not alter hash pins or executable source.

## Review boundary

owner-triage-review.md approved bundle-pin acceptance. deployment-followup-review.md resolves its deployment R1-R3 findings with no new blocker. These reviews used first-party Claude and no OpenRouter. The reviewer used read-only tools; executed test evidence above was obtained separately by Codex.

The reviews do not authorize publishing. Production activation, runuser/systemctl integration and live rollback were not exercised. Remaining nonblocking risks are listed in the review and handoff, including shared dependency contents and partial data writes on failed activation.

## Current production and next step

The website still serves the prior release. Gary production remains at 13f2e1b6, build ycyfKqOsIeeT_F-e-bS47. Holder/trading actions remain off. No initialization, signing, locking, charter-date write or financial job was performed. D5(b) still requires public, verified Metaplex Core before lock and leaves dates unconfirmed.

The existing public-data timer was isolated to reviewed 61a4cf6 while this batch was edited; the prepared ecd31bf source is not activated. The 61a4cf6 override must remain in place until the replacement is approved. Its old launch-file path remains unchanged. Legacy destructive entrypoints refuse, and three backup script copies were made non-executable without changing contents.

Next: owner-arranged Claude re-triage of this committed handoff, then an explicit publication decision. Remaining ecosystem and launch work is tracked in STATUS.md.
