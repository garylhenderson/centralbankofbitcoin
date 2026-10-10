# Dress rehearsal record (mainnet)

Programs: seal `ComPmE6SaRAiGHfgykVHDfvGHjjFruM86YRHExuuthva`, mint `F5dRE71CRRjiCDvKz7trPrwyanppwXhdRa6ffxq63FbX`, burn `CkufWohnxQh8ccGgx9FxZ4X1qRjDwJQepFFVzbnCJEnQ`, gov `J7f9RTQZ6EGxWyFsS2AzRMeAw7s84b9CmQDmRiLHz659`, sweep `HhUMazuRSppAe2LNfpbo1jDsRgskocrFwEG8RpSsicxB`

| item 22 | verdict |
|---|---|
| 1. the crank's live passes | PASS at 5 vaults (scale not exercised) |
| 2. the alarm's live passes in rehearsal mode | FAIL |
| 3. one full live revenue cycle through each pool | PASS |
| 4. one forced post-sweep failure, walked through the hand recovery | PASS |
| 5. one DAS read of a collection holding a burned Core asset | PASS |

| step | status | funding wallet delta (lamports) |
|---|---|---|
| keys | done | 0 |
| build | done | 0 |
| fund-roles | done |  |
| pob-set | done | 9101600 |
| cbob-mint | done | 2565240 |
| fill-values | done | 0 |
| fund-deployer | done | 10122108320 |
| deploy-1 | done | 0 |
| deploy-2 | done | 0 |
| deploy-3 | done | 0 |
| deploy-4 | done | 0 |
| deploy-5 | done | 0 |
| ceremony-collection | done | 0 |
| build-shipping | done | 0 |
| fund-upgrade | done | 2695087680 |
| upgrade-1 | done | 0 |
| upgrade-2 | done | 0 |
| upgrade-3 | done | 0 |
| upgrade-4 | done | 0 |
| upgrade-5 | done |  |
| ceremony-values | done | 0 |
| ceremony-seal | done | 0 |
| ceremony-mint | done |  |
| ceremony-burn | done | 0 |
| ceremony-gov | done | 0 |
| ceremony-atas | done | 0 |
| ceremony-fund | done | 0 |
| verify-configs | done | 0 |
| claim-1 | done | 0 |
| claim-2 | done |  |
| claim-3 | done | 0 |
| crank-reveal-charter | done | 0 |
| provision-tokens | done | 4470320 |
| sale-round | done | 0 |
| buy-4 | done | 0 |
| buy-5 | done | 0 |
| crank-reveal-sold | done | 0 |
| deposit-activate | done | 0 |
| crank-full | done | 0 |
| alarm-pass-1 | done | 0 |
| revenue-cycle-1 | done | 50354760 |
| revenue-cycle-2 | done | 50005000 |
| revenue-forced-failure | done | 50005000 |
| revenue-forced-alarm | done | 0 |
| revenue-hand-recovery | done | 0 |
| rescue | done | 0 |
| crack | done | 0 |
| das-read | done | 0 |
| alarm-pass-2 | done | 0 |
| sweep-back | done | -108573680 |
| close-5 | done | -547405560 |
| close-4 | done | -1451320440 |
| close-3 | done | -1611482680 |
| close-2 | done | -1952208440 |
| close-1 | done | -3595811960 |
| sweep-deployer | done | -3637292320 |

## Reading the record (written 2026-10-10, after the run)

**Item 22.2 reads FAIL, and the cause is a true detection.** Alarm pass 1
(2026-10-09 18:09 UTC) passed. Between the passes, Metaplex upgraded Core on
mainnet (2026-10-09 21:21 UTC, slot 455005931); the rehearsal paused until the
full suite had passed against the new build, and resumed at 00:33 UTC. Pass 2
then raised exactly what it exists to raise:

    CRITICAL [config_drift] prog.core.hash: "30dce56b6b70ea524a3882ef7bc73936" -> "51d41542456639a01820c747e72b9d3b"
             (THE DEPLOYED METAPLEX CORE BYTES CHANGED)
    HIGH     [watchdog_gap] this pipeline last ran 202 minutes ago (expected every 30)

Both are true: Core did change under the programs, and nothing watched during
the deliberate pause. The driver marks any CRITICAL it was not told to expect as
FAIL, and this one was not in its list, so the verdict is recorded as the driver
wrote it and is not edited. What the run proves for item 22.2: the alarm's live
pass ran twice on mainnet in rehearsal mode, every notice went to
`.rehearsal-run/notices.log` only, and it caught a real third-party change to a
dependency within one pass. What it does not prove: a pass 2 with nothing to
report, which no live pass after this Core change could have produced without
re-baselining.

**Also on mainnet, outside the driver:** Gary signed road step 10 in Phantom on
the hosted page (collection `5MRJrKUEZ8A5f8eTAtxaqe7Byp8CbJgGKskFX4esksti`), and
opened three vaults in real Phantom, each landing unchanged: vault 4
`2DZi7S6uw5qbLtWFPVfA7FBnmmmUEV6VtnMjHitecpFR` (only the reserves), vault 5
`HX2wxcCQE2LApJKLyHqyJ1bi2rHCh7M1xve9B8SRR7NA` (a stray token left behind,
before the listing fix), vault 2 `9cnb2iH4B4RAHEsoYrfY3NiQGich5W74bp7h5BzVDsuR`
(a stray $CBOB recovered, nothing left).

**SOL:** the funding wallet went from 13.656416396 SOL at the first step to
13.426828556 after the last (0.229587840 SOL net, fees and rent the closes
cannot return). All five rehearsal programs are closed (their ProgramData rent
returned); the program ids cannot be reused. The roles' cbBTC, $GARY and
$GIRAFFISH were swept back to the funding wallet.

**Taken down after the run:** the hosted page's nginx location (the site config
restored byte for byte from its pre-rehearsal backup, `nginx -t` passed, the
unlisted path now 404s), its htpasswd file, and the page server.
