# Central Bank of Bitcoin: Vaults

> Good afternoon. The Bank did not print today.
>
> It cannot print. This repository is the reason. Everything the Bank does with
> a vault is written here, in five programs on Solana, and is read into the
> record below. Nothing is withheld. Questions.

## Prepared remarks

A vault is a Metaplex Core NFT with a wallet of its own. The wallet holds three
reserve tokens: cbBTC, $GARY and $GIRAFFISH. Nothing in that wallet can leave
while the vault is closed, not even for its owner.

The holder does four things, and only four:

1. **Obtains a vault.** One Proof of Burn, burned during the seven-day charter
   window, is one vault. Otherwise a vault is bought in a sale round the holders
   voted for, priced in cbBTC, never below 21,000 sats.
2. **Fills it.** Reserves are sent to the vault's deposit address, which is not
   the NFT's own address. At 21,000 sats of cbBTC the vault is activated and
   joins the monthly payouts.
3. **Votes, if inclined.** One vault, one vote, on sale rounds and prices.
4. **Opens it, once.** Opening pays the reserves out to the owner and burns the
   vault. It is not reversible. There is no way to open a vault and keep it.

Sales, and the 10% royalty on resales where a marketplace pays it, flow into the
Bank. Sales arrive in cbBTC. Royalties arrive in SOL, and a swap bot holding an
online key turns that SOL into cbBTC before the split. The split is fixed in the
programs: 85% to a pool held by the programs for the activated vaults, 15% to the
Bank's treasury multisig. Anyone may run the payment of a vault's share into that
vault.

Where launch stands is read into the record under "The road to launch" below.

For the plain-English account of what is true about a vault, read
[`HOLDER-GUIDE.md`](HOLDER-GUIDE.md) before anything else in this repository. Its
"Things to know before you open" and "The honest list" are the Bank's most
important pages. Open a vault only on the Bank's redeem page: burning the NFT any
other way destroys everything inside it.

## Who may do what

No Bank key co-signs a mint or an opening. The second party to each is the
programs' own rules.

| | may | may not |
|---|---|---|
| **A vault's owner** | open that vault, vote, trigger a payout | open anyone else's |
| **The holder vote** | open sale rounds, set prices (21,000 sats minimum), set the $CBOB boost terms within the launch ceilings, restart what the guardian stopped, replace the guardian or the swap bot's key (half of all vaults, after a week's notice) | change the 85/15 split, the 10% royalty or the 2,100 cap, or touch any vault |
| **The guardian wallet** | stop sales or the swap bot in an emergency, and cancel a new swap-bot key before it takes over | restart anything, open a vault, move any money, change any rule, or block its own replacement |
| **Anyone** | run a payout into a vault, record a level draw, run the rescue that returns a vault sent into another vault | anything that moves value except as the rules direct |

Keys the Bank's operators do hold, each with its limit stated in the holder
guide's "Who can do what" and "The honest list":

- the swap bot's online key (at most 10 SOL of royalty money every 6 hours, never a vault or the pool);
- the online wallet holding the $CBOB not yet released;
- during the seven-day charter window only, the Giraffish Moments collection key, which could block charter claims;
- the key of any custodial Gary Club wallet a holder chooses to keep a vault in;
- the deploy authority of the five programs, until launch removes it for good (road step 11).

Every opening also waits its turn: at most 2.1% of the sealed vaults may open in
any hour, and a Coinbase freeze on a vault's cbBTC stops its opening until lifted.
A vault held by a multisig or a DAO cannot be opened.

The full control table, with every instruction, is in [`SPEC.md`](SPEC.md) under
"THE CONTROL TABLE". The design and the rulings behind it are in
[`DESIGN-v6.md`](DESIGN-v6.md).

## What the Bank relies on and does not control

The Bank reads these into the record because it cannot change them.

- **Metaplex Core.** Every vault is a Core asset, and Metaplex can upgrade Core.
  The Bank's programs will be locked and cannot adapt. Metaplex upgraded Core
  three times in the five weeks before launch (3 September, 7 October and
  9 October 2026). [`scripts/core-watch.mjs`](scripts/core-watch.mjs) reads the
  deployed Core and, when it differs from the build the tests were run against,
  runs the whole suite against the new one
  ([`scripts/core-watch-suite.sh`](scripts/core-watch-suite.sh)). The Bank cannot
  prevent a change.
- **cbBTC.** Coinbase issues it and can freeze it.
- **Solana.** The network the programs run on.

The complete list, with what each one could do to a vault, is "The honest list"
in [`HOLDER-GUIDE.md`](HOLDER-GUIDE.md) and "Known limits" in [`SPEC.md`](SPEC.md).

## The record

Every figure in this section is generated from the file that owns it by
[`scripts/readme-facts.mjs`](scripts/readme-facts.mjs). It is not typed by hand,
and the test suite refuses to pass while it disagrees with its sources.

<!-- readme-facts:begin (generated by scripts/readme-facts.mjs --write; edits here are overwritten) -->

### The five programs

| program | address | source | what it does |
|---|---|---|---|
| SEAL | `9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273` | [`programs/cbob-vaults`](programs/cbob-vaults) | keeps each vault sealed: nothing leaves its wallet until the owner opens it on the way to a burn |
| MINT | `Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo` | [`programs/cbob-vault-mint`](programs/cbob-vault-mint) | charter claims and sale rounds, the on-chain level draw, the revenue split and the community pool |
| BURN | `8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8` | [`programs/cbob-vault-burn`](programs/cbob-vault-burn) | opening a vault: proves its wallet empty, burns it and retires its record |
| GOV | `2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2` | [`programs/cbob-vault-gov`](programs/cbob-vault-gov) | one vault, one vote: rounds, prices, and restarting anything the guardian stopped |
| SWEEP | `EB2uVvsaThLp4PWt3LwAWveTCa9ZynPVbWzZfUhMf2aa` | [`programs/cbob-vault-sweep`](programs/cbob-vault-sweep) | stateless helper the open page calls, through Core, to pay a vault's reserves to its owner |

### What launch writes once, and who holds what

| launch value | set to | status |
|---|---|---|
| `init_authority`: signs the one-time setup (the guardian wallet) | `Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb` | RULED |
| `guardian`: may only stop sales or the swap bot, or cancel a new swap-bot key; only a vote restarts | `Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb` | RULED |
| `bank_treasury`: receives the Bank's 15% (the CBOBTC Squads multisig); signs nothing | `bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1` | RULED |
| `payment_mint`: sale rounds are priced in | `cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij` | RULED |
| `reserve_mints`: the three tokens a vault holds | `cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij`, `8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk`, `Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump` | RULED |
| `vault_collection`: the Core collection every vault belongs to | not set yet | OPEN |

### What the tests run against

- **Program source released for launch:** commit `d2ae5fcedb2d3435e0e9d0ae2814bd52714f7fb8` (`d2ae5fc`). `web/src/config.js` RELEASE_COMMIT; the build refuses any other.
- **Metaplex Core build every test runs against:** sha256 `51d41542456639a01820c747e72b9d3b4ca258930a5bbb7e78db0cda133dc209` (the bytes after the 45-byte ProgramData header, as `solana program dump` writes them). `scripts/run-tests.sh` CORE_SHA256_EXPECTED.

### Tests

| test set | assertions (must equal, not just reach) | run by |
|---|---|---|
| on-chain suite (real mainnet Core, real SPL tokens) | 913 | `scripts/run-tests.sh` |
| alarm detectors, each proven to fire and to stay quiet | 1081 | `bank/selftest.mjs` |
| holder pages, ceremony and RPC relay (offline) | 805 | `web/test/run-all.mjs` |
| holder pages end to end on a local chain | 152 | `web/test/e2e-localnet.sh` |
| Test Vault simulation: one vault's whole life | 71 | `sim/run-sim.sh` |
| launch values judge | 69 | `scripts/check-launch-params.mjs` |
| payout arithmetic | 39 | `bank/accrual.mjs` |
| live mainnet facts (Core build, token programs, Proof of Burn set) | 35 | `scripts/probe-mainnet-facts.mjs` |
| swap fork against real pools | 16 | `sim/swap-fork.sh` |

### Audits

44 audit rounds are in [`audits/`](audits) (rounds 5 to 48; the log of every one is [`audits/FREEZE.md`](audits/FREEZE.md)). The launch gate needs a round whose findings require NO changes. The latest 6:

| round | five programs | off-chain code | needed changes |
|---|---|---|---|
| [43](audits/round43) | LAUNCH-CLEAN | LAUNCH-CLEAN | yes, [validated](audits/round43/VALIDATION.md) |
| [44](audits/round44) | LAUNCH-CLEAN | LAUNCH-CLEAN | yes, [validated](audits/round44/VALIDATION.md) |
| [45](audits/round45) | LAUNCH-CLEAN | LAUNCH-CLEAN | yes, [validated](audits/round45/VALIDATION.md) |
| [46](audits/round46) | LAUNCH-CLEAN | LAUNCH-CLEAN | yes, [validated](audits/round46/VALIDATION.md) |
| [47](audits/round47) | LAUNCH-CLEAN | LAUNCH-CLEAN | yes, [validated](audits/round47/VALIDATION.md) |
| [48](audits/round48) | NOT LAUNCH-CLEAN | LAUNCH-CLEAN | yes, repairs not yet validated |

### The road to launch

| step | | state (from SPEC.md) |
|---|---|---|
| 1 | Design approved | done 2026-10-03 |
| 2 | Programs built | built, stage 3c committed 9312275 |
| 3 | Test suite and off-chain pipeline | built; run-tests.sh green |
| 4 | Independent red-team passes | three done; RT3 found no CRITICAL or HIGH, everything fixed or accepted |
| 5 | Test Vault simulation | done, 71/71 (every refusal pinned to its reason) |
| 6 | Launch values and holder pages | values in launch/mainnet-init.json, refused by scripts/check-launch-params.mjs until complete |
| 7 | Audit rounds (the launch gate) | frozen; current round results and clean-round counter in audits/FREEZE.md |
| 8 | Mainnet dress rehearsal | done on mainnet 2026-10-09 to 10-10; 22.2 FAIL accepted by Gary (a true detection); scale not exercised |
| 9 | Deploy the five programs | in progress (ids claimed) |
| 10 | Create the collection and initialize (the guardian wallet signs) | not started |
| 11 | Lock: remove every upgrade authority, forever | not started |

<!-- readme-facts:end -->

## Reading order

| file | what it is |
|---|---|
| [`HOLDER-GUIDE.md`](HOLDER-GUIDE.md) | what is true about a vault, in plain English. The source for every holder page. |
| [`DESIGN-v6.md`](DESIGN-v6.md) | the design, and the rulings behind it |
| [`SPEC.md`](SPEC.md) | the specification, written from the implementation: every program, every limit, the ship gate, the road to launch |
| [`audits/FREEZE.md`](audits/FREEZE.md) | the audit log: every round, what it found, what was done |
| [`audits/`](audits) | each round's auditor reports, verdicts and validation |
| [`web/README.md`](web/README.md) | the holder pages, the launch ceremony page and the RPC relay |

## The repository

| path | contents |
|---|---|
| `programs/` | the five on-chain programs (Anchor 0.31.1) |
| `tests/` | the on-chain suite, run against real mainnet Core and real SPL Token programs on a local validator |
| `bank/` | the off-chain pipeline: the payout crank, the revenue swap, the alarm and its detectors, account layouts proven against the Rust |
| `web/` | the holder pages (look up, open, claim, buy), the ceremony page, vault metadata and the RPC relay |
| `sim/` | the Test Vault simulation: one vault's whole life on its own validator |
| `launch/` | every value the one-time setup writes, with its ruling |
| `scripts/` | the test runner, the mainnet build, the live mainnet probe, the audit runners, the Core watch |
| `audits/` | the audit record |

## Reproducing the tests

The runners were written for the Bank's build machine and expect the repository
at `/opt/cbob-vaults`. Required: the Solana CLI (Agave) with platform-tools v1.54
(the runner refuses any other; the Bank builds with `cargo-build-sbf` 4.1.0), and
Node.js (the Bank runs 20).

```bash
./scripts/run-tests.sh       # the on-chain suite and every off-chain selftest, each
                             # behind a floor its count must EQUAL (see Tests above)
./sim/run-sim.sh             # the Test Vault simulation
./web/test/e2e-localnet.sh   # the holder pages end to end on a local chain
node web/test/run-all.mjs    # the holder pages offline
```

The holder-page tests check the pages against the release build in `dist/`,
which is built, not committed, and must be a clean build of the release commit
named under The record above. On a fresh clone, build it first:

```bash
git checkout <the release commit>
./scripts/run-tests.sh       # builds and deploys, then stops at the holder-page
                             # tests because dist/ does not exist yet
./scripts/build-mainnet.sh   # writes dist/, dist/SHA256SUMS and dist/MANIFEST.txt,
                             # comparing against the build the first run made
git checkout -               # dist/ is untracked, so it stays; now run the above
```

On its first run the runner fetches the Core deployed on mainnet and refuses to
test unless it is byte-identical to the pinned build in the record above. If
Metaplex has upgraded Core since, it stops there, by design: the suite has not yet
been run against that Core. The live mainnet probe and the swap fork read a
mainnet RPC address from the build machine; without one they print SKIPPED and
their figures above are not reproduced. The full list of commands is in
[`SPEC.md`](SPEC.md) under "Running the tests".

## Verifying what is deployed

Do not take the Bank's word for the bytes. Until road step 9, the five addresses
hold an inert placeholder that refuses every instruction (its source is in
[`web/test/fixtures/placeholder`](web/test/fixtures/placeholder)). After it:

```bash
git checkout <the release commit, under The record above>
./scripts/build-mainnet.sh                       # writes dist/ and dist/SHA256SUMS
solana program dump <program address> deployed.so
```

The first bytes of `deployed.so`, as many as the matching file in `dist/`, must
hash to that file's line in `dist/SHA256SUMS`, and every byte after them must be
zero. `dist/` is not committed; it is built, with the Solana toolchain
`scripts/run-tests.sh` names (cargo-build-sbf 4.1.0, platform-tools v1.54), and
stripped as Solana's verifiable-build container strips.

A machine that is not the Bank's has done this. The repository's
[`verifiable-build`](.github/workflows/verifiable-build.yml) workflow, on GitHub's
runners, builds all five programs in that container and again one by one through
`solana-verify`, the way a remote verification rebuilds them, and fails unless
both equal the hashes the pages pin in `web/src/config.js`. In a fork with
Actions enabled, push a tag `verify-<commit>` and it does the same for you.
After road step 9, each program's build is also submitted for remote
verification against this repository, and the record will say what came back. After launch, the upgrade
authority of every program must read as none:

```bash
solana program show <program address>
```

## Reporting a fault

A fault that could move value out of a vault, the pool or the revenue address
should not be described in a public issue. Report it privately: on this
repository's **Security** tab, choose **Report a vulnerability**
(https://github.com/garylhenderson/centralbankofbitcoin/security/advisories/new).
Only the reporter and the repository maintainers can see it. Everything else may
be filed as an issue.

## On the keeping of this document

The figures above are regenerated with `node scripts/readme-facts.mjs --write`
and checked by every test run (`--check`). When a fact changes at its source, this
document changes in the same commit, or the tests do not pass. The prose is held
to the same standard by review: every sentence here must stay true of the
programs.

No license has been granted. The code is published so that anyone can read it and
verify it.

---

ROY E. MINTER, ACTING CHAIRMAN<br>
Central Bank of Bitcoin
