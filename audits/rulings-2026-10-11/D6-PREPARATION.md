# D6 controls: preparation only, 2026-10-11

Owner recommendation: approve separate Gary Club holder and trading controls, with
both remaining off until their respective launch checks and owner enablement.
D6 is still pending. This branch is not published and does not enable any action.

Companion backend: Gary Club `a97feac6` on `cbob-ecosystem`, pushed, not deployed.
The backend exposes holderActionsEnabled and tradingEnabled; the UI strictly
requires the corresponding boolean true. Old responses leave new entry points off.
Cancellation is drawn before either control and before the vault ownership read.
Holder controls no longer sit behind trading. A later review choice suppresses a
slower earlier successful response. Making and accepting offers use distinct labels.

Validation: TypeScript and all nine Gary test groups pass (42 portal checks).
`node web/test/club-controls-browser.cjs` passes 20 browser scenarios using only
synthetic local responses. This is a local Chrome/CDP fixture, not real member or
built-app integration evidence. No signatures, chain transactions or messages occur.
Claude first-party review and delta triage are alongside this note. No OpenRouter.

Release gates remain: owner D6 ruling; coordinated backend/UI deployment; built-app
HTTP tests of all four flag combinations; real backend/browser integration; prior
R3 migration permissions verified over HTTP; deployed flags absent or zero.
Do not accept public fingerprints or publish this branch on the strength of the
browser fixture alone. Bank root ec8008a is running its full rehearsal separately.

Followups carried from Claude's reports: stale rejected requests can append errors
to a newer review; confirm outcomes can replace a newer review; standing-order quote
identity and arithmetic should be checked in the browser; account cancellation and
member-owned order completeness still need work. A trading pause preserves existing
unexpired authorizations, which may settle when trading resumes. Governance's legacy
actionsEnabled field correctly aliases the holder flag today. These remain explicit
followups, not claims of completed trading acceptance or launch readiness.
