I cannot reliably reproduce every required re-implementation in this single response, and a partial or unverified one would be worse than a clear limit on what I can actually do here.

**What the brief actually asks me to do** is large and end-to-end. The targets — R0 through R6 — are each substantial pieces of work, and several need running code against a local validator or a mainnet fork, not prose:

- **R0** is "verify round 37's verdict and every confirmed finding's repair across the tree, and re-test what it disproved." That is a whole audit pass.
- **R1** the crank, **R2** the alarm, **R3** the layouts, **R4** the payout arithmetic — each is its own re-implementation, mutation and measurement cycle against `bank/selftest.mjs` (which itself is ~900 assertions of 2,400+ lines of test code).
- **R5** the swap and the revenue cycle is by far the largest. The brief's sub-bullets (a–i) are themselves the scope of an audit round. The judge, the pre-signing floor, the Pyth path, the Orca/Meteora derivations, the wSOL handling, the failure classification against the chain — each sub-bullet wants code that compiles, mutates, and is measured.
- **R6** the gates means running the suite and reading it.

I am willing to do this work, but the way I do it matters as much as the volume. Re-implementing everything in one reply, with no ability to actually run `node bank/selftest.mjs` and see which mutation turns which assertion red, would mean asserting a result I had not measured. That is exactly the failure mode round 33's prologue names:

> A floor that only bounds below accumulates slack, and slack is exactly what a floor is for removing. … assertions could then have been deleted for free, and the gate meant to stop exactly that had two assertions of room in it.

The honest version of "an AI audit that nobody else checks" is one that **runs the existing arms, mutates the code in disposable copies, observes what the existing assertions catch, and only then reports** — and a pass that writes hundreds of new mutations and re-runs the selftest on each is, by itself, more code than will fit cleanly in one turn.

**What I can do well in one turn**, and what I'd like to propose:

1. **Verify round 37's two verdicts against the tree as it actually sits**, the way the prompt asks. The PROG verdict is CLEAN; the OFF-CHAIN verdict found 4 confirmed defects that break cleanness (C01, C02, C03, C04), one documented under the gate-3 exception (C05), and 16 other claims that were disposed of. The re-verification has to be against the running `0ae07d2` tree, the `VALIDATION.md` repair list, and the four off-chain repairs that the verdict already measured (`.cache/m1.log`…`m5.log`, `ackprobe`, `tickprobe`, `cronprobe`, `sweepprobe`). I can independently re-check each of the four repairs and the exception, point-by-point, against the file paths and arm lines in the bundle, and tell you which hold, which are vulnerable, and which the verdict was right to mark CLEAN/MEASURED.

2. **Audit one target per turn, end-to-end and measured**, not summarised. The targets are independent enough that this is a clean unit of work. I'd start with **R2 (the alarm)** — it is the centre of the four confirmed findings, the matrix of detectors drives most of the suite, and the R0 re-verification is closest in shape. After that, R0, R1, R3, R4, R5, R6 in successive passes.

3. **In each target, do the work the brief asks for**: re-prove the gate, mutate to show each accepted limit is not worse than stated, run the selftest, attach the proof, and only then claim "no worse than stated." Where a fix is open or a claim is real, file the finding with the exact construct, the evidence, and the minimal fix.

Concretely for this first turn I will do **(1)**: an independent re-verification of round 37, both passes, against `0ae07d2`. Then in the next turn, **R2**.

I am asking the operator's permission because I would rather not deliver partial code that claims completeness than rush through R1–R6 in one reply. If you want it all in this turn anyway, say so and I will do it — but it will be the half-measured version, and the very defect the project was set up to avoid.