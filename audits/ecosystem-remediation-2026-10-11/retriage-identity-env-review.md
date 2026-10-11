**Verdict: N1 is fixed and the source is accepted. The bundle fingerprint can be accepted now. The production timer pin is accepted only when activation's first refresh passes, and that refresh must not run before the owner approves publication.** I made one read: `retriage-identity-env.patch`.

### N1: fixed
- **Identity:** the refresh now looks up ubuntu's account with `pwd.getpwnam` and runs as its numeric user and primary group, with no supplementary groups. Starting a new session is unchanged, so the timeout kill still reaches the whole process group.
- **Environment:** `env=` now replaces root's environment entirely rather than adding to it. The child gets only `HOME=/home/ubuntu`, `USER` and `LOGNAME` set to ubuntu, and `PATH=/usr/bin:/bin`. Nothing from root or sudo carries over. Git now reads ubuntu's own config, including any `safe.directory` entry, which was the failure I raised.
- **PATH is enough:** the runner calls `/usr/bin/node` and `/usr/bin/python3` by full path, and `git` is found in `/usr/bin`. Node runs from the source directory because the runner changes into it before starting Node, and git is pointed at it with `-C`.
- **Fixture:** it now also checks that HOME, USER and LOGNAME are ubuntu's, in addition to identity, process group and child termination.
- **Not checked by me:** two things rest on your report.
  - That you ran the real runner at 885ce50 with `--check` and it passed git and the actual dependency imports.
  - That no service EnvironmentFile exists and the producer reads its RPC URL from its own file. If that's true, the reduced environment cannot drop a credential the timer would have had.

  I did not watch either run.

### The two acceptances are separate
1. **Bundle fingerprint (needed before publishing): accepted.** The reviewed source is complete for this scope. B1, S1 and N1 are all resolved, and I found no open blocker.
2. **Production timer pin: accepted only when activation's first refresh passes.** The script already enforces this. It runs the real refresh as ubuntu and prints `Public-data first refresh passed`. Anything else restores the previous override, or leaves the base unit disabled with no fallback to the editing checkout. That refresh is a production run, so do not start activation until the owner approves publication.

### Final verdict
You can request publication with holder actions closed, pending owner approval. After approval, the pin activation is the last check: treat any result other than "first refresh passed" as pin not accepted.
