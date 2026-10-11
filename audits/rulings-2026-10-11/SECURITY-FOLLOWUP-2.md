# Follow-up to the signing and prelock reviews

The live public site/data remain 7298f12. The approved alarm v2 was applied,
committed and pushed in 73a21db: actual-function 8/8 and real ubuntu dry-runs
before and after both exited 0. No cron, DNS, service or holder switch changed.

Prelock NB1: rehearsal now uses the same root sealer, separate root archive and
shared final verifier. It never qualifies for --verify certification. Archive
failure may retry only the identical revalidated result. NB2: digests hash raw
Buffers; a non-UTF-8 fixture agrees with Python, and file-list parity is tested.
NB3: root-installed isolated Python helper, noninteractive sudo, explicit
documented threat model. This box already grants ubuntu unrestricted sudo;
root ownership is operational protection, not a boundary against that account.
The owner must witness certification and capture its digest independently.
SF2: prelock pins the deployed upgrade authority from SPEC step 9 for all five
Bank programs. SF6/N9: the canonical full suite gates all 55 preparation tests
(35 receipt, 8 alarm, 12 artifact/runtime). Full archive rehearsal is next,
after this review and helper installation. No actual lock certification today.
Alarm SF3/SF4 remain operational follow-ups: mismatch fails loudly, and checking
the committed HEAD does not independently prove that a local commit was reviewed.

Signing N1: install now requires an explicitly supplied review commit and an
independent artifact digest, through a root-installed isolated Python helper;
it checks committed attestation bytes against that digest. No installation
will run until an independent build comparison is available. Signing remains
blocked by that comparison, D2/D10/D13/timing and day-of delivery checks.
N2 correction: node_modules IS a tracked symlink (git mode 120000), so checkout
already contains it. The added ln command was wrong and removed BEFORE any
builder run. The build asserts the existing tracked target. There is no package
lockfile in this repository and no npm install is authorized. Build-time input
hashes and tool versions are recorded; dependency provenance remains disclosed,
not claimed solved. Failed builds stay in a temporary directory; candidates
appear only after success. Program bytes come from the isolated copy.
N3: warnings fail; nonbuiltin externals fail; optional native converters are
disabled in favor of existing JS fallbacks; runtime require is builtin-only.
N4: unit strips Node injection variables, checks root-owned env metadata via
isolated Python, launcher refuses execArgv. No env files were printed or changed.
N5: unverifiable saved collection stops step 0; correction of the misleading
browser-memory advice; existing refusal test strengthened. N6/N7: independent
creator signatures must agree and name launch on both providers; aligned-slot
account cross-check now covers collection, mints, ATAs and funding as well as
setup configs. N8 remains fail-closed if discovery is incomplete; no current
unverified collection exists. N11: teardown retains a refusal-only signing
vhost through DNS expiry. N12: complete review record required and its actual
review file is copied and hash-bound in the artifact.

Evidence: PREFLIGHT-0f964ce.json is the successful retry the earlier read-only
review did not see. It is not claimed to cover the latest changes. Targeted
ceremony tests pass 164/164; all 55 preparation tests pass. The bundle test
starts one ephemeral loopback listener without node_modules or any RPC request;
the real listener test serves reviewed bytes and refuses a planted file.
Current-source preflight, full offline suite, inert candidate build and full
archive rehearsal still follow this commit. No READY-to-sign claim is made.
