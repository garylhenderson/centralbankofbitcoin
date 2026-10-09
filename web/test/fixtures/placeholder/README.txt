THE CBOB ID PLACEHOLDER (round 46, V46o-4)

What the five mainnet program ids hold today (SPEC road step 9): 20,920 bytes,
sha256 94f750995689a59f2b4cc3e4c5336a34bce1697ae7ff040e41a9d57040e64219. It holds
nothing, creates nothing and refuses every instruction with Custom(0).

It used to live only in the untracked .cache/placeholder, so the offline web suite
(web/test/ceremony.test.mjs) could not run from the repository. The source, the
manifest and lockfile it was built from, and the binary itself are tracked here;
SHA256SUMS pins each, and the test refuses a copy that does not match.

  src/lib.rs, Cargo.toml, Cargo.lock   the source, as built on 2026-10-07
  cbob_placeholder.so                  the binary deployed at the five ids
  SHA256SUMS                           sha256 of all four

The program keypair it was first deployed with is NOT here and never belongs here.
