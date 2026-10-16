# Five-program permanent lock, 16 October 2026

All five Bank program upgrade authorities were permanently removed on Solana mainnet-beta,
completed at 2026-10-16T11:56:21.000Z (06:56:21 CDT). Gary explicitly approved the irreversible
five-program removal after the final results were presented. No unattended lock was scheduled.

The actual owner-launched R1 run, from reviewed clean source `935fd644821427bd101829a7e248f135374d3a34`,
passed 913 program assertions, 16 swap-fork assertions, 71 simulation assertions and
160 holder assertions. Its sealed evidence digest was `d8fd039a9a0188e59d56a9fcbb5fa38d7c8feb0b1a62e28e0a2b982d24cc7b83`,
recorded outside the server through the existing private owner conversation.
Immediately before the first removal, the canonical receipt verifier passed again.
The 41 initial ceremony checks, 29 readiness checks, all five OtterSec remote build
verifications and published Core disclosure also passed. Remote builds match
release `d2ae5fcedb2d3435e0e9d0ae2814bd52714f7fb8`.

| Program | Address | Lock receipt | Finalized slot |
|---|---|---|---|
| SEAL | `9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273` | [Finalized transaction](https://explorer.solana.com/tx/5hw2hFD4kggXEfiCvicfcYqFR5x7ZEQmrvw4AG63ntj9mFwE1NvukyRsrDFqRpYZRLYjiD2kqu1VUYzHbdVeGTPx) | 457627582 |
| MINT | `Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo` | [Finalized transaction](https://explorer.solana.com/tx/48c47g9z6huWft7YvECSY9Mg9HqLasZnprqFopome8xSjgR8wfmm5VizYTYaRendSoaVM1jDyhUzV9y1Srk2u9YQ) | 457627698 |
| BURN | `8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8` | [Finalized transaction](https://explorer.solana.com/tx/5Wa5AXWeyQyrkAvp7KzaNaHhrmo6AGsC17zKvirUubwmNytRbzrwMS4DHufeLWDc8gdSzTdiqRFrzJsFRjaLXU27) | 457628345 |
| GOV | `2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2` | [Finalized transaction](https://explorer.solana.com/tx/2VKTRSq9bLZDdibkQp11H8LdqB2XiZ5vfKu85JEtjW9k92ung7Vn4QzfgUroSyVxVECiDuZDVXdgSk81Wo8PQoFD) | 457628473 |
| SWEEP | `EB2uVvsaThLp4PWt3LwAWveTCa9ZynPVbWzZfUhMf2aa` | [Finalized transaction](https://explorer.solana.com/tx/37RJC5MujtNNRKi5SytfAP4YBC1TR4KsiFbHPoWKeHPQgJEue6Ka93rLnVBFzbp1MyBpkacdxJBDWTYyKLtrTwpH) | 457628657 |

Each transaction was independently fetched as successful and finalized from the dedicated
provider and Solana public mainnet. Each instruction was checked as loader-v3 SetAuthority(4)
on the correct ProgramData with the old authority signer and no new authority. Before and
after every removal, both providers agreed on the code hash, zero-tail check, upgrade slot,
program identity and expected authorities of all five programs and Metaplex Core. All five
upgrade authorities now read null. The final all-five observation passed before source advanced.
See [the machine-readable record](program-lock.json) for exact hashes, sizes, times and signatures.

BURN's first attempt was rejected by RPC preflight simulation before broadcast; both
providers confirmed its authority remained unchanged. Fresh unsigned simulation passed
on both providers. A temporary read rate limit cleared before the fresh precheck and
successful normal-preflight retry. No preflight check was bypassed. The five successful
transactions each cost 5,000 lamports; combined network fee 25,000 lamports (0.000025 SOL).

The existing Core watcher remains enabled and healthy. Its missing, already-reviewed
hourly stale-state alarm was restored from `scripts/cron-install.sh` with exact cron readback,
preserving every previous cron byte; the healthy-state predicate was tested without sending
an alert. Core remains upgradeable by Metaplex; its observed hash and upgrade slot did not change.
No Bank program can be upgraded to adapt to an incompatible future Core change.

Holder actions and trading remain separately disabled. The permanent charter window is
19 October 2026 17:00 UTC through 26 October 2026 17:00 UTC (noon Austin on each date).
A program lock does not enable the holder or trading releases. Historical Chairman
statement bodies are preserved as issued; the new public lock notice is separately dated.
