# CBOB holder pages, launch ceremony, metadata and RPC proxy (`web/`)

Static pages for centralbankofbitcoin.com, built from `web/src/` into `web/dist/`, plus
two server pieces that are written but NOT installed: the vault metadata generator
(`web/meta/`) and the same-origin RPC proxy (`web/deploy/`). Nothing here is published.
Nothing outside `web/` is edited; `programs/`, `bank/`, `scripts/`, `launch/`,
`tests/` and `sim/` are only read, and three pure modules are bundled unchanged:
`bank/layout.mjs` (`decode`), `bank/detectors.mjs` (`judgeRedemptionCoverage`) and
`scripts/check-launch-params.mjs` (`judgeLaunch`), with `scripts/pob-merkle.mjs`.

| page | path | who |
|---|---|---|
| Vault lookup | `/vault/` (`?a=<vault>`) | anyone |
| Open a vault | `/redeem/` (`?a=<vault>`) | the vault's owner |
| Claim a charter vault | `/claim/` | a Proof of Burn holder, inside the charter window |
| Buy a vault | `/buy/` | anyone, in an open voted round |
| Launch ceremony | `/ceremony-0cfecdcaf80584b6/` (unlisted, `noindex,nofollow`, linked from nowhere) | INIT_AUTHORITY only |

The ceremony path is unlisted, not secret (the slug is in `web/src/config.js`). Its
protection is that it refuses every key except INIT_AUTHORITY, and so do the programs.

## One config file

`web/src/config.js`: every program id, the RPC URL, the vault collection, the
INIT_AUTHORITY, the CBOBTC Squads, the audited program hashes, the ceremony slug, and
`SITE` (the ruled names and links: vault name `CBOB Vault`, metadata at
`https://centralbankofbitcoin.com/v/<asset>.json`, collection `Central Bank of Bitcoin
Vaults` at `https://centralbankofbitcoin.com/v/collection.json`). Profiles: `mainnet`
(what `web/dist/` is built for), `rehearsal` (road step 8, ids TODO) and `localnet`.
The profile is fixed at build time; no URL parameter can point a page elsewhere.

* **RPC (ruled):** `https://centralbankofbitcoin.com/rpc`, the same-origin proxy below.
  Until it is live every read fails closed with a plain message.
* **Collection:** `null` until the ceremony's step 0 creates it; then record it here
  and in `launch/mainnet-init.json` `vault_collection` (value, status RULED) and
  rebuild. Every holder page refuses until it is set.
* The build refuses unless `dist/MANIFEST.txt` is a clean build of `RELEASE_COMMIT`
  (`0b3ddb3`, round 35) and the audited hashes equal its `dist/SHA256SUMS` (round 36 L4).

## What each page reads and writes

**Vault lookup** reads the SEAL, MINT and BURN configs (owner, discriminator, version
pinned), the vault NFT, its record MINT `["vault", asset]` (the LEVEL comes from here,
never from the NFT's name or traits, and the page says so), every token account its
DEPOSIT ADDRESS owns (Core's `["mpl-core-execute", asset]` PDA, shown with "this is NOT
the NFT's own address" and "never send the vault NFT itself, or any other NFT, to a
deposit address"), its SOL, the NFTs inside it, and for a vault held off-curve, the
vault whose deposit address holds it. It shows level, deposit address, owner, sealed,
the three reserve balances, SOL, activation state and the credited payout. Writes (any
connected wallet signs and pays): **Activate** (MINT `activate`), **Rescue** and
**Draw my level** (below).

**Rescue** follows MINT `rescue_nested` as ruled 2026-10-07: the vault ALWAYS goes to
MINT `bank_treasury` (the CBOBTC Squads, "which returns it to whoever sent it in"), and
only when the holder is the deposit address of the vault itself, of a burned NFT (a
Core tombstone), or of a LIVE vault of our collection. A foreign NFT, a collection or
an address that never existed is refused on the page exactly as MINT refuses it
(`HostUnresolved`).

**Draw my level** (vault, claim and buy pages): `reveal_level` when the vault is next in
mint order and its blocks exist (re-supplying the attributes it was minted with, read
from the NFT); `capture_entropy` when it is in its window but not next; 
`reschedule_reveal` when its two-minute window passed with nothing recorded; otherwise
it says how long to wait. Each is sent alone (no compute-budget instruction needed:
SPEC 54 measures a reveal with its capture at 150,344 CU).

**Open a vault.** A prior transaction creates missing accounts; ONE legacy
redemption: `claim` (only activated, never while the pool is frozen), 
`open_for_redemption`, Core `ExecuteV1` into the sweep helper (all three reserves plus
each classic stray holding a balance that it can close and safely deliver; the rest are
named in boxes, below), one `ExecuteV1` of an SPL `Transfer` per
round 35 C5 account (left undeclared; only the balance read a moment before moves), and
`burn_vault` declaring every reserve ATA under both token programs; 1,061 bytes for the
plain shape, exactly SPEC's. "Run a payout" does what the crank does (round 36 L2): it expires every DUE $CBOB boost
first (MINT refuses a payout until then), joins every waiting vault, then distributes,
burning exactly 100 $GARY; it re-reads MINT's settings when pressed and refuses before
anything is burned if the counts it finds differ from MINT's.

**A stranger cannot block an opening (review H1).** The programs never look at
anything the burn is not shown, so the page refuses ONLY what the programs refuse or
what would lose the holder's own value: a problem with one of the vault's three
reserve accounts (Coinbase freeze, unreadable, not classic, a foreign close authority),
a CBOB vault nested inside (rescue it first), or not being the owner. Everything else a
stranger can put at a deposit address for pennies (an empty or funded Token-2022
account, a frozen account of a stranger's mint, a programmable NFT, a Core NFT with any
plugin, an NFT or token account the page cannot read, a compressed NFT, strays that do
not fit the packet) is named, one by one, in a box the holder must tick ("this is lost
when the vault is opened"), and the opening goes ahead. Empty Token-2022 accounts are
NOT closed inside the opening: a hidden confidential or withheld balance would make the
close revert the whole opening, and a stranger could time a deposit to do that; their
rent belongs to whoever created them. `judgeRedemptionCoverage` still runs as a
cross-check: anything it finds that the page has not already named is a refusal. The
re-plan just before signing never asks for another set-up transaction (L2): something
new is either moved or added to the boxes. Round 36 H1: a stray whose mint has a freeze authority (anyone's, unless it is one
of the three reserves), or whose receiving account is already frozen, or whose mint
cannot be read, is never delivered: whoever can freeze it could freeze the holder's
receiving account between the plan and the send and fail every opening. It is left in
the vault and named in a box. If a dry run still fails while the opening carries extra
tokens, the page leaves them all behind, names them, and asks again. The holder's OWN
receiving account for a reserve being frozen is a refusal with the reason (the reserve
must be delivered). Compressed NFTs are looked for with DAS; if
the index does not answer the page says it could not look (L1). The Core reader never
fails on a plugin it does not know (Groups, 18, or anything newer): it reads the owner
and collection and lists the plugin by number.

**Claim a charter vault** reads MINT (window, supply, PoB collection and root, pool),
all 240 Proofs of Burn listed in `scripts/pob-set.json` (getMultipleAccounts: no
index needed), and the Proof of Burn collection. It refuses outside the window, when
the supply is used up, when the wallet holds no Proof of Burn, when the page's set does
not recompute to MINT's `pob_root`, when the Proof of Burn is frozen, and when the Proof
of Burn or its collection carries an external plugin (the page cannot know the
pass-through accounts such a rule needs, SPEC 46, so it sends `pob_extra = 0` and no
crank, and refuses rather than guess). The proof is `scripts/pob-merkle.mjs`
`proofOf`. Write: `claim_charter_vault` named `CBOB Vault` with its metadata link,
signed by the wallet and by the new vault's address (made in the browser, signing after
the wallet, so the wallet sees exactly the message the page built). The widest real
shape (depth-8 proof) is well inside a legacy packet; no v0 table is used (the tests
use v0 only for the redemption experiment, S9b).

**Buy a vault** reads MINT (round, price, cap, sold, stop flag, supply) and the
wallet's and the revenue address's cbBTC accounts. It refuses when sales are stopped,
no round has been voted, the round has not opened or has closed, it is sold out, every
level is allotted, the wallet lacks cbBTC (or it is frozen), or the revenue account is
missing. Write: `mint_vault` with `max_price` = the price read on chain (a vote that
raises it first makes the mint fail instead of charging more), no crank.

Both mints dry-run first, show exactly what is signed (what is burned or paid, the new
vault's address and metadata link, the SOL cost from the simulated balance), then
after landing show the vault's `/vault/?a=` link, its deposit address and the draw.

**Ceremony** (road step 10), refusing unless: the key is INIT_AUTHORITY; the genesis
hash is mainnet's; `judgeLaunch` (unchanged) passes the embedded
`launch/mainnet-init.json` at this computer's clock and the cluster's; every program's
ProgramData is the audited `dist/` bytes then zeros and answers a probe as the real
program does (not as the placeholder); the mints are classic SPL. **Today it shows NOT
READY** (charter date and lock deadline OPEN). Then, resumable:

0. **Create the vault collection**: Core `CreateCollectionV2` exactly as mpl-core's
   `createCollection` sends it with no plugins (the helper `tests/3prog.test.ts` and
   `sim/test-vault.ts` use), name `Central Bank of Bitcoin Vaults`, link
   `.../v/collection.json`, update authority MINT's `["mint"]` PDA, a keypair made in the
   browser (signs once, never kept), Gary pays. The page then shows the address to record. Before
   any step is signed the page re-reads that step, so a step that landed after a
   time-out (the funding step, notably) is never sent twice (L6).
1. SEAL, 2. MINT, 3. BURN, 4. GOV initialize (byte-identical to the suite's builders with
   the ruled values), 5. the three cbBTC accounts, 6. the revenue address's rent.

`launch/mainnet-init.json` now carries `vault_collection` OPEN and `judgeLaunch` refuses
any OPEN value, while the ceremony itself creates that value. So the ceremony judges a
COPY in which that one field holds the collection it is using (before step 0, a
throwaway stand-in, so every OTHER value is judged before anything is signed); nothing
else changes, and a value already in the file must BE that collection. Which collection:
`config.js`, the one SEAL already names (a resumed ceremony), the file's, or the one made
this session, the address this browser remembered when it signed step 0 (stored
BEFORE signing, used only if it exists on chain), and every Core collection on chain
whose update authority is MINT's PDA (review M2). Any two that differ, or two such
collections on chain, is a STOP; if the chain scan cannot run, step 0 is refused, so a
reload can never create a second collection. After each step the account is re-read and
every field compared with the ruling (the collection: name, link, MINT's PDA, clean
before MINT, exactly the fixed 10% royalty after).

## Vault metadata (`web/meta/generate.mjs`, run by cron later, NOT installed)

```bash
CBOB_META_RPC=<operator provider URL> node web/meta/generate.mjs --out <site root>/v --state /var/lib/cbob/meta-state.json [--dry-run]
```

It lists every vault record (getProgramAccounts on MINT, so give it the operator's
provider, not the public proxy), reads each NFT and its cbBTC account, and writes
`<asset>.json` (Metaplex shape: `name` "CBOB Vault #<mint_index + 1>", `symbol`,
`description`, `image`, `external_url` = the vault lookup page, `attributes` Level,
Charter, Activated (Yes, Joining, No, Gone) and cbBTC, `properties.files`) and
`collection.json`. Pictures: the five ratified level shells
`https://cdn.gary.club/cbob/vaults/v1/level-{1..5}/master.png` (named by the art log's
PROMOTED v1 section and the v1 record page; each answered 200 image/png on 2026-10-07,
and every run checks them again before use); and for a vault not drawn yet,
`https://cdn.gary.club/cbob/vaults/v1/undrawn/master.png`, checked the same way. FAIL CLOSED: a vault whose record, NFT or
cbBTC account cannot be read, that is not in our collection, or whose picture does not
answer 200 right now, KEEPS ITS PREVIOUS FILE; nothing is ever deleted; if the vault
list cannot be read nothing is written. Exit 0 / 1 (named vaults kept) / 2 (nothing).
Never backwards (review L4): every read carries its slot, kept in a PRIVATE state file
(`--state`, outside the public directory); a file is never replaced from an older slot,
a drawn level never reads as undrawn, a gone vault never comes back, and an earning
vault's cbBTC account reading as missing keeps the file. A vault that no longer exists
says it was either opened on the redeem page or burned some other way (the chain does
not record which).
Suggested cron, every 5 minutes, writing into the site's `v/` directory.

## Enabling the RPC proxy (a staged step)

nginx alone cannot read a request body to allowlist JSON-RPC methods, so
`web/deploy/rpc-proxy.mjs` (Node, loopback :8789) does it, and nginx puts TLS, a per-IP
rate limit and a 16 KB body cap in front (`web/deploy/nginx-rpc.conf`). After review M1:

* EXACTLY the 14 methods the pages call (a test proves the list equals what `web/src`
  calls; `getBlockTime` is gone, the pages read the Clock sysvar).
* `getProgramAccounts` only in the five exact shapes the pages send (the fifth: MINT
  vault records, bytes 125..195 only, to find due boosts), filter for filter
  and value for value: Core assets owned by one 32-byte address; Core assets of THE
  vault collection (with the collection tag at 33); Core collections whose update
  authority is MINT's PDA; MINT vault records with pending = 1. Addresses only on Core.
  A 1-byte, empty, extra, base64 or wrong-valued filter is refused.
* `sendTransaction` / `simulateTransaction` only for transactions of at most 1,232
  bytes that call nothing but the CBOB programs, Core, ATA, Token, System and Compute
  Budget, AND call at least one CBOB program, unless they are exactly one of the three
  shapes the pages send without one: associated-token-account creations only, the
  ceremony's collection create (MINT's PDA as update authority), or System transfers to
  the revenue address (round 36 L1). A plain SOL or token transfer is not relayed.
* No Origin, or another site's, is refused (browsers always send Origin on a POST), as
  is `Sec-Fetch-Site` other than same-origin; no CORS header is ever sent. A script can
  forge an Origin, so the method, shape and transaction rules and the rate limits are
  what bound it.
* Per-IP limits (10/s general, 1/s `sendTransaction`, 3/s simulate, 1/s
  getProgramAccounts), IPv6 keyed by /64; the upstream response capped at 8 MB while it
  streams; it refuses to start without `CBOB_VAULT_COLLECTION`.

1. Create `/etc/cbob/rpc-proxy.env`, owned by the user PM2 runs as, mode 600:
   `CBOB_RPC_UPSTREAM=` (the provider URL with its key), optional `CBOB_DAS_UPSTREAM=`,
   `CBOB_RPC_ORIGIN=https://centralbankofbitcoin.com`, `CBOB_RPC_PORT=8789`,
   `CBOB_VAULT_COLLECTION=` (after step 0). The provider must allow DAS or
   getProgramAccounts (the redeem page needs one of them).
2. `pm2 start /opt/cbob-vaults/web/deploy/ecosystem.rpc-proxy.config.cjs && pm2 save`.
3. Add the `limit_req_zone` line to the http context and the `location = /rpc` block to
   the centralbankofbitcoin.com server block; `nginx -t`; reload.
4. Check (send `Origin: https://centralbankofbitcoin.com` on each POST): a POST of `getSlot`
   answers; a GET is refused (403 from nginx); a POST without that Origin is 403;
   `requestAirdrop` is 403.

## Local mode: how Gary should run the ceremony (review M4)

The ceremony writes values that can never be changed, and the copy the public site
serves is only as trustworthy as everything between this repository and Gary's
browser. The recommended way is to build it on the box and reach it through an SSH
tunnel, never through the public site:

```bash
# on the box
node web/build.mjs --profile mainnet-local          # -> web/dist-mainnet-local/ (mainnet values; RPC = the server that served the page)
node --env-file=/etc/cbob/rpc-proxy.env web/deploy/ceremony-local.mjs   # 127.0.0.1:8790 only
# on Gary's laptop
ssh -N -L 8790:127.0.0.1:8790 ubuntu@<box>
# in the browser that has Phantom
http://localhost:8790/ceremony-0cfecdcaf80584b6/
```

`ceremony-local.mjs` serves that build read-only and answers `/rpc` through the same
proxy rules (accepting only the tunnel's two origins). Every page also carries
subresource integrity on its script and stylesheet, and the ceremony prints its own
`app.js` sha256 and the build commit in its footer, to compare with the table
below (or with a build made from the release commit) before connecting. The committed reference is this table (a bundle test fails if it does not
equal a fresh build of BOTH profiles; any source change changes them):

| profile | file | sha256 |
|---|---|---|
| `mainnet` | `vault/app.js` | `c22121de3af9ec7324fe8ba0d69f60bee96613cab387ad17ff7b74e664024133` |
| `mainnet` | `redeem/app.js` | `911cdea19635a8d5398c9551a59642310bed741fef42673a682ce3724f592bf9` |
| `mainnet` | `claim/app.js` | `78468bab92bafe5eb8cb250814bcd16e3c9a722fc2ccc08378edad70590eee3a` |
| `mainnet` | `buy/app.js` | `5688357c97f6fe8ff9a290d852007a4c9091ff08eba1b42108ef3484a78e0cad` |
| `mainnet` | `ceremony-0cfecdcaf80584b6/app.js` | `4a5402d18a81150dadfe684289d89ecae048011edd99758165d791126baa1233` |
| `mainnet` | `assets/style.css` | `3007d0d5f8a519d58edde67e352a15430e4269a96cd64567084b6762b83a5758` |
| `mainnet-local` | `vault/app.js` | `fc1bc8b3ffa2406c85938877612a2398c5bad63af1dc2fbeff1895993ff19105` |
| `mainnet-local` | `redeem/app.js` | `b63a4ca68bb5f88b3eda158350d797ec61e7f1675d12683b982a8a38c7fdfe87` |
| `mainnet-local` | `claim/app.js` | `e975112bce654ab0ae731aa32c853be672c5b33c11b06194913a9af0f10add39` |
| `mainnet-local` | `buy/app.js` | `9978fae7be652c2eae4497bbd8de59ffa43cc4fdb99ef2d3a8bba03dbd85c337` |
| `mainnet-local` | `ceremony-0cfecdcaf80584b6/app.js` | `28b4f16883e1d5ac2968142872254cd4649977a334d29584d7810e7843ab766e` |
| `mainnet-local` | `assets/style.css` | `3007d0d5f8a519d58edde67e352a15430e4269a96cd64567084b6762b83a5758` |

The public bundles embed the launch values as value and status only, and the Proof of
Burn set as addresses only: the notes in `launch/mainnet-init.json` (key files, backups,
ruling channels) never ship (review M3; a bundle test greps for them).

## Open decisions and known gaps

1. **The undrawn picture** is the covered vault (Gary, 2026-10-07):
   `https://cdn.gary.club/cbob/vaults/v1/undrawn/master.png` (200 image/png), checked by
   every run like the five level shells. An undrawn vault whose picture does not answer
   keeps its previous file.
2. **The collection's picture** is the site's seal (`/seal.png`, 200): a choice made
   here, not a ruling.
3. **"CBOB Vault #<mint_index + 1>"** (Gary, 2026-10-07: people count from one).
   `mint_index` stays 0-based on chain, so the first vault is "#1".
4. **Rehearsal mode** (SPEC 53) is still not built; the `rehearsal` profile refuses.
5. **Road step 9 vs 11:** the ceremony says step 9 deploys and checks the bytes and only step 11 makes the programs final (SPEC); it reports each upgrade authority and does not refuse on it.
6. **Revenue funding** is topped up to rent exemption only (SPEC: "above rent").
7. Griefing policy, stated: nothing a stranger can put at a deposit address refuses an
   opening. A foreign NFT, a Token-2022 account (empty or funded), a frozen account, a
   stray whose mint someone can freeze, and strays that do not fit are each named in a
   box the holder ticks. Only the vault's three reserve accounts (or the holder's own
   account for one of them being frozen), a nested CBOB vault, or a non-owner signer
   refuse.
8. A Proof of Burn (or its collection) with an external plugin cannot be claimed on this
   page; it needs a person (and the claim then goes through the pass-through accounts).
9. No priority fee is added; listing a wallet's vaults needs an indexer; announcing
   openings on X and the site is still `bank/redemption-poster.mjs`'s missing sender.

## Build, test, stage, publish

```bash
node web/build.mjs                 # mainnet -> web/dist/ (BUILD.txt lists every file's sha256)
node web/test/run-all.mjs          # rebuilds, then 518 offline assertions in 10 files, each at its exact floor
```

Offline (no validator, no network): `ix` (every instruction, byte for byte, against the
builders EXTRACTED from `tests/3prog.test.ts` and `sim/test-vault.ts` and against
mpl-core / spl-token: the redemption set, the four initializes, `claim_charter_vault`,
`mint_vault`, `capture_entropy`, `reveal_level`, `reschedule_reveal`, `rescue_nested`,
`activate`, `distribute`, `CreateCollectionV2`), `ids`, `decode`, `plan` (redemption and
the new rescue rule, checked also against MINT's source), `get` (claim with the real
240-address set and proof, buy, draw, every refusal), `ceremony` (step 0, the
`vault_collection` substitution, every field check), `tx`, `proxy`, `meta`, `bundle`
(the browser bundle equals node; static checks on all five pages).

Browser wiring without a validator (`node web/test/mock-rpc.mjs`, a `--profile localnet
--rpc http://127.0.0.1:8977` build served on localhost, a test wallet that signs through
the mock; accepted by localnet builds only). Done 2026-10-07 at 375px: the redeem page
(prior transaction, re-plan, dry run, 1,152-byte redemption identical to the plan), the
claim page and the buy page (each sent transaction signed by wallet and new vault and
byte-identical to `planClaim` / `planBuy` from the same state; the new vault's link,
deposit address and draw shown), and the vault page.

**End to end on a local validator (for you to run; not run here):**
`bash web/test/e2e-localnet.sh` (refuses while the suite's ports are held; rebuilds
`target/deploy` with `--features localnet`, so rerun `scripts/build-mainnet.sh` before
any mainnet step). It drives the pages' own library: probes and program hashes; step 0
then road step 10 with every step re-read, a resume pass, SEAL found on reload, a
refused second initialize; two vaults claimed through `planClaim` with real Proofs of
Burn (named `CBOB Vault`, linked to `/v/<asset>.json`, the Proof of Burn burned);
levels drawn by a stranger through `planDraw`; Activate; GATE 5: the vault is joined after
a payout epoch, the pool funded, "Run a payout" distributes, and the opening of that
ACTIVE vault claims first (MINT claim, then SEAL open) and delivers the share, with a
MONTH DUE at the opening, so the claim runs the month in-line first: it asserts the
in-line distribution is in the logs, `retire_redeemed` did not refuse, the pool fell by
exactly the delivered share and nothing is owed afterwards (gate 5 item 4); a DUE $CBOB
boost (a real boost-terms vote, a boost, one distribution) cleared by the page's
"Run a payout" (expiry first, then distribute; the control distribute without the expiry
is refused, BoostsExpireFirst) (item 3); and a redemption carrying the most C5 transfers
that fit (4 offered), its bytes and compute units printed and asserted under 1,232 and
the default budget (item 6); a vault nested in another
(the host's redemption refuses; the rescue sends it to `bank_treasury`, a local key here
that returns it), then in its own deposit address (to `bank_treasury`), and a foreign
holder refused; and an opening with a stray, a C5 account, a late 1-sat deposit and a stray whose
mint the stranger can freeze, with the holder's own account for it frozen by the
stranger (round 36 H1: left behind, named, and the opening lands). The
buy page needs a voted round, which this harness does not run (its instruction is
byte-checked against the suite and the sim, and wired in the mock test).

**Staging and publishing** (only on Gary's go-ahead):
1. Serve `v/` (at least `collection.json`) BEFORE step 0 and before the first claim:
   the collection link becomes permanent on chain at step 0, each vault's at its mint.
   Enable the RPC proxy (above). Run the ceremony (local mode); record the collection in
   `web/src/config.js` and `launch/mainnet-init.json`; update the audited hashes from the
   release `dist/`; `node web/test/run-all.mjs`.
2. Copy `web/dist/{vault,redeem,claim,buy,ceremony-<slug>,assets}` into the site root.
   The pages use the site's own `/seal.png` and `/favicon-32.png`. Keep `BUILD.txt` out
   of the public root.
3. Create `v/` in the site root and install the metadata cron; check `v/collection.json`.
4. Never list the ceremony in `sitemap.xml` or `robots.txt`. Add the four holder pages to
   the sitemap, with canonical/OG tags, when they go live.
5. `app.js` names are not content-hashed: short cache lifetime or a query string on
   release. Keep any server CSP at least as strict as the pages' meta CSP.
6. The holder guide (DRAFT) may be published only after these pages are live (SPEC 50).

`web/dist/` is ignored by the root `.gitignore`; `web/.gitignore` ignores `dist-*/` and
`test/.out/`.
