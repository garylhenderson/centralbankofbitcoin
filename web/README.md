# CBOB holder pages, launch ceremony, metadata and RPC proxy (`web/`)

Static pages for centralbankofbitcoin.com, built from `web/src/` into `web/dist/`.
Public pages and metadata are deployed; financial actions remain disabled pending
initialization and the activation checks. The authenticated hosted ceremony uses the
existing exact signing path. No frozen program or release binary is changed by this UI.

| page | path | who |
|---|---|---|
| Voting and proposal history | `/governance/` (`?p=<proposal>`) | public reads; Gary Club owners of vaults eligible under the proposal snapshot |
| Opening history | `/history/` (`?a=<vault>`) | anyone |
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
(what `web/dist/` is built for), `rehearsal` (road step 8: ids from the rehearsal tree's record, values from `launch/rehearsal-init.json`) and `localnet`.
The profile is fixed at build time; no URL parameter can point a page elsewhere.

* **RPC (ruled):** `https://centralbankofbitcoin.com/rpc`, the same-origin proxy below.
  Until it is live every read fails closed with a plain message.
* **Collection:** `null` until the ceremony's step 0 creates it; then record it here
  and in `launch/mainnet-init.json` `vault_collection` (value, status RULED) and
  rebuild. Every holder page refuses until it is set.
* The build refuses unless `dist/MANIFEST.txt` is a clean build of `RELEASE_COMMIT`
  (`d2ae5fc`: round 35's program source, built stripped) and the audited hashes equal
  its `dist/SHA256SUMS` (round 36 L4).

## What each page reads and writes

**Vault lookup** reads the SEAL, MINT and BURN configs (owner, discriminator, version
pinned), the vault NFT, its record MINT `["vault", asset]` (the LEVEL comes from here,
never from the NFT's name or traits, and the page says so), the token accounts its
DEPOSIT ADDRESS owns, read in bounded pieces (below, round 37 V1) (Core's `["mpl-core-execute", asset]` PDA, shown with "this is NOT
the NFT's own address" and "never send the vault NFT itself, or any other NFT, to a
deposit address"), its SOL, the NFTs inside it, and for a vault held off-curve, the
vault whose deposit address holds it. It shows level, deposit address, owner, sealed,
the three reserve balances, SOL, activation state and the credited payout. Writes (any
connected wallet signs and pays): **Activate** (MINT `activate`; round 37 V3: MINT reads
the cbBTC balance, never the account's state, so a vault whose cbBTC account Coinbase
has frozen CAN activate and join; the page builds it and says that payouts into a frozen
account are credited and wait for the unfreeze, limit 28), **Rescue** and
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
redemption: `claim` (activated, or waiting to join since round 48 V48-1; never while the pool is frozen),
`open_for_redemption`, Core `ExecuteV1` into the sweep helper (all three reserves plus
each classic stray holding a balance that it can close and safely deliver; the rest are
named in boxes, below), one `ExecuteV1` of an SPL `Transfer` per
round 35 C5 account (left undeclared; only the balance read a moment before moves), and
`burn_vault` declaring every reserve ATA under both token programs; 1,061 bytes for the
plain shape, exactly SPEC's. "Run a payout" does what the crank does (round 36 L2): it expires every DUE $CBOB boost
first (MINT refuses a payout until then), joins every waiting vault, then distributes,
burning exactly 100 $GARY; it re-reads MINT's settings when pressed and refuses before
anything is burned if the counts it finds differ from MINT's.

**A stranger cannot block an opening (review H1, round 37 V1).** The token accounts at
a deposit address are never read as one unbounded listing (about 18,700 parked
accounts pushed that past the RPC proxy's 8 MB cap and blocked the page, round 37 V1).
The vault's three reserve accounts are read BY ADDRESS, always; the rest are listed as
balances only (since round 46, one `getTokenAccountsByOwner` per token program, each
with an 8-byte balance slice and each account's full size, served from the RPC's owner
index; our RPC refuses `getProgramAccounts` on Token-2022 outright, and each program's
listing stands on its own, so a refused one is named and never hides the other); only
classic accounts holding a balance and Token-2022 accounts that are not empty plain
165-byte ones are then read in full, at most 200. Whatever cannot be listed or examined is ONE box ("this
page could not list ... anything in them is lost"), never a refusal. More than 20 boxes
for things left behind become ONE box with the count and the first 20 listed. The programs never look at
anything the burn is not shown, so the page refuses ONLY what the programs refuse, what
would lose the holder's own value, or what cannot be built: a problem with one of the
vault's three reserve accounts (Coinbase freeze, unreadable, not classic, a foreign close
authority) or the holder's own account for one being frozen, not being the owner, a
vault that is gone, foreign, unrecorded or retired, an opening that does not fit one
transaction (a stranger can cause none of these: strays are dropped to fit, and the base
shape is 1,061 to 1,209 bytes); and the coverage cross-check, which by construction finds
only what the page did not name. A CBOB vault someone sent inside never refuses it (round 39
V39-2): the set-up step rescues it (alone, optional) to the Bank's multisig, which
returns it to whoever sent it in, with a box saying so; if that cannot be done, or it
arrives after the check, the vault still opens and the inner vault is rescued afterwards
from its own page (item 58). Round 40 V40-1: lamports a stranger sends to the ADDRESS of
a token account that does not exist yet leave a System-owned, 0-byte account there; every
reader treats that as ABSENT: the redeem page's set-up and the ceremony's step 5 still
create it (the ATA program's create lands on it, suite R34.G2), the vault page and the
metadata generator read it as holding nothing, the buy page as not set up, and nothing
calls it unreadable, frozen or broken. A token account that
cannot be parsed still refuses. Round 41 V41-1 generalises the rule to every address that is
expected to be CREATED later: the four program config PDAs (the ceremony's preflight and
steps 1 to 4, and every page's settings read), vault record PDAs, the payout pool and the
collection-to-be. Dust there reads as "not created yet" (Anchor's init lands on it, suite
R31.W2a); an account there owned by another program, or System-owned WITH data, is still
refused. Everything else a
stranger can put at a deposit address for pennies (a funded Token-2022 account or one
with extensions, a frozen account of a stranger's mint, a programmable NFT, a Core NFT with any
plugin, an NFT or token account the page cannot read, a compressed NFT, strays that do
not fit the packet) is named in a box the holder must tick (one by one up to 20; more become one grouped box) ("this is lost
when the vault is opened"), and the opening goes ahead. An EMPTY 165-byte Token-2022
account holds and can hide nothing, so it gets no box (W10). Token-2022 accounts are
NOT closed inside the opening: a hidden confidential or withheld balance would make the
close revert the whole opening, and a stranger could time a deposit to do that; their
rent belongs to whoever created them. `judgeRedemptionCoverage` still runs as a
cross-check: anything it finds that the page has not already named is a refusal.
**Late arrivals never stall the send (round 38 V38-2).** Besides the boxes for what is
there at the check, the holder ticks ONE standing consent, shown before signing:
"Anything that arrives at this vault's deposit address after this check and before the
opening lands is lost when it opens, except cbBTC, $GARY, $GIRAFFISH and SOL in the
vault's own accounts, which come to you." Its id carries no address, count or digest.
The press re-reads, re-plans and dry-runs (`prepareOpening`); anything that arrived
after the check is never delivered (delivering it could fail), is shown as information,
and asks for no new tick or set-up transaction. Only these still stop the press: a
refusal (a reserve-account problem, a non-owner, a vault no longer openable, an opening
that does not fit, or the coverage cross-check); a failed re-read of the promised
accounts; a set-up transaction the re-plan would need; a payout forfeited
because Coinbase froze the pool since the check; a stray the holder was told would come
to them that can no longer be delivered (its issuer froze it, the holder's own account
for it is gone, or the dry run failed while carrying it; asked once, by its own
address); or a dry run that still fails. The warning names which of these it is
(round 39 A2). At most two dry runs a press, no retry loop. Round 39 V39-1: at the press every account the holder was told would come to them is re-read BY ADDRESS with the three reserve accounts
(`getMultipleAccounts`, at most 100), never through the listing, so neither a failed
listing nor the 200 cap can hide it; one that is missing, unreadable or no longer
movable stops the press with its own box, and a failed re-read stops it with the error.
"Arrived after your check" is said only of what the page did not see at the check
(an account present then but beyond the 200 it read in full, or unlisted, counts as
unseen). The re-plan also removes a stray
only from the list that holds it (V38-1). Anything sent after the check into an account
someone else handed to the vault and kept the right to close stays in it (V38-5). Round 36 H1: a stray whose mint has a freeze authority (anyone's, unless it is one
of the three reserves), or whose receiving account is already frozen, or whose mint
cannot be read, is never delivered: whoever can freeze it could freeze the holder's
receiving account between the plan and the send and fail every opening. It is left in
the vault and named in a box. If a dry run still fails while the opening carries extra
tokens, the page leaves them all behind, names them, and asks again. The holder's OWN
receiving account for a reserve being frozen is a refusal with the reason (the reserve
must be delivered). The NFTs at a deposit address are listed by address (Core
`getProgramAccounts`, else the DAS index, at most 20 pages of 1,000) and at most 200
are read in full. A CBOB vault the page finds inside is rescued in the set-up step,
never a refusal (round 39 V39-2, above). If the page cannot complete that check (both reads fail, for example a
stranger's flood past the proxy's 8 MB cap, or more than 200 NFTs), it is ONE box ("any
NFT there is lost, except a CBOB vault, which anyone can then rescue to the Bank's
multisig"), never a refusal: since item 58 a vault left inside a burned host is still
rescued. Compressed NFTs are looked for with DAS; if the index does not answer the page
says it could not look (L1). The Core reader never
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
this session, or the address this browser remembered when it signed step 0 (stored
BEFORE signing, used only if it exists on chain) (review M2). Any two of those that
differ is a STOP. Round 37 V2: anyone can create a Core collection naming MINT's PDA
(the update authority need not sign), so the chain is never authoritative: once one of
those names the collection, every other collection on chain naming MINT's PDA is
IGNORED and named in a warning. With none of them (a reload in another browser before
SEAL), each collection on chain is adopted only if its CREATE (the oldest successful
transaction holding Core `CreateCollectionV2` for exactly that address; a collection is
created once) was paid and signed by the launch key; the page says it found it that way.
Failed transactions are skipped, and a stranger's transaction naming the address before
the create (a front-run, or a retry reusing the keypair) changes nothing (round 42
V42-2). A decoy never stops the page; two created by the launch key is a STOP (write one
in `config.js`). A collection whose creator cannot be checked (a history padded past
5,000 transactions, which costs a stranger about 0.025 SOL, a create the RPC no longer
serves, or none among the first 25 successful transactions naming it) is listed
by address as ignored when exactly one other IS verified as the launch key's (that one
is adopted). When none verifies, the page lists each such collection with its reason in
a prominent warning ("if one of these is the vault collection you created, do NOT create
another: pin it instead", by opening the page in the browser that signed step 0, or in
`config.js` or the launch file) and STILL offers step 0, so a stranger's decoy can never
stop the launch (round 39 B4, replacing round 38 V38-3's stop). Step 0 stores the new
address in this browser before it is signed, again once it exists, and the page shows
it and continues only after an explicit "I have copied it and recorded it" tick. If the chain scan cannot run, step 0 is
refused, so a reload can never create a second collection. After each step the account is re-read and
every field compared with the ruling (the collection: name, link, MINT's PDA, clean
before MINT, exactly the fixed 10% royalty after).

## The Vault Market (`/market/`, 2026-10-10)

Gary, 2026-10-10: *"it should be visual and like a built in marketplace ... browse vaults,
filter, sort, see only yours, see opened vaults to track + or - had they waited ... Existing
vaults we should show performance."*

The register is public. `/account/` uses the holder's existing Gary Club account and
custodial wallet, with an explicit account confirmation at Gary Club. Signup, email,
Google and wallet login preserve the Bank return path. No wallet key or bearer token
is sent to the Bank browser. The same account may enter from Gary Club's `/dashboard/cbob`.

Vault issuance and opening reuse the audited page planners through `web/server/club-engine.mjs`.
`scripts/build-club-engine.mjs` produces the checked server adapter in Gary Club. No
program binary is changed. The marketplace is a bolt-on: it can be updated after the
five Bank programs lose their upgrade authorities.

Listings last thirty days and offers seven days. Both require a reviewed price, an
explicit standing authorization and a revealed vault level. Settlement is one Core
transfer plus two SOL transfers in one transaction: 90% to the seller, 10% to Bank
REVENUE, rounded down for the royalty. Offers reserve no funds. The member accepting
pays network fees. Changed ownership, reserve balances or level/activation state refuses settlement.
The existing Gary Club confirmation registry records every send; replay uses the same
signed bytes. An ambiguous result keeps the order reserved until reconciliation.

The public data publisher (`bank/public-data.mjs`, read-only) writes `/data/vaults.json`,
`/data/history.json` and `/v/*.json`. Its systemd timer runs every ten minutes under a
kernel lock. The register includes per-token reserves, estimated USD values, the payout
pool and its owed balance read together, authenticated cumulative MINT events, and
reserves remaining at retired addresses. Unknown or incomplete history is labelled.
The pool and live reserves are distinct. Value changes include deposits and distributions;
they are not an investment return. cbBTC is valued using BTC/USD, without a depeg model.
Warehouse quotes for the other tokens do not report their age; the page discloses this.

Opening signatures come from authenticated `VaultRetired` events. A bare burn is
separate from a redemption. The counterfactual reprices the actual released tokens;
its historical baseline needs an hourly observation at or before the opening, no more
than one hour old. Without one, the comparison is unavailable. It does not project
payouts the destroyed vault might have earned later.

Before initialization, the page reports no issuance. The October 16 lock and October 19
charter opening, both noon Austin time, remain targets until Gary confirms the launch
values. Neither a page deployment nor a marketplace update locks a program.

## Vault metadata (`web/meta/generate.mjs`, through the public data timer)

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

* EXACTLY the 16 methods the pages call (a test proves the list equals what `web/src`
  calls; `getBlockTime` is gone, the pages read the Clock sysvar).
* `getProgramAccounts` only in the five exact shapes the pages send (MINT vault records,
  bytes 125..195 only, to find due boosts; round 46: the token-account shapes are gone,
  because Helius refuses any getProgramAccounts on Token-2022), filter for filter
  and value for value: Core assets owned by one 32-byte address; Core assets of THE
  vault collection (with the collection tag at 33); Core collections whose update
  authority is MINT's PDA; MINT vault records with pending = 1. Addresses only on Core.
  A 1-byte, empty, extra, base64 or wrong-valued filter is refused.
* `getTokenAccountsByOwner` (round 46) only as one owner, one `programId` filter (classic
  Token or Token-2022), base64 with the 8-byte balance slice (offset 64, length 8): the
  vault and redeem pages list a deposit address's token accounts this way, one call per
  program, and a failed one is named in its own box without hiding the other. Its own
  2/s per-IP bucket; the slice bounds the bytes per account under the 8 MB cap.
* `sendTransaction` / `simulateTransaction` only for transactions of at most 1,232
  bytes that call nothing but the CBOB programs, Core, ATA, Token, System and Compute
  Budget, AND call at least one CBOB program, unless they are exactly one of the three
  shapes the pages send without one: associated-token-account creations only, the
  ceremony's collection create (MINT's PDA as update authority), or System transfers to
  the revenue address (round 36 L1). A plain SOL or token transfer is not relayed. One
  CBOB instruction carries the rest, even one that does nothing (an `expire_boosts` of a
  boost not yet due plus a stranger's transfer IS relayed, round 37 W6, tested); the rate
  limits bound that, as they bound any CBOB-calling transaction.
* `getSignaturesForAddress` (one address, at most 1,000 a page) and `getTransaction`
  (one signature, JSON) for the ceremony's creator check (round 37 V2).
* No Origin, or another site's, is refused (browsers always send Origin on a POST), as
  is `Sec-Fetch-Site` other than same-origin; no CORS header is ever sent. A script can
  forge an Origin, so the method, shape and transaction rules and the rate limits are
  what bound it.
* Per-IP limits (10/s general, 1/s `sendTransaction`, 3/s simulate, 2/s
  getProgramAccounts, 2/s getTokenAccountsByOwner, 2/s each for the two history reads), IPv6 keyed by /64; the upstream response capped at 8 MB while it
  streams; it refuses to start without `CBOB_VAULT_COLLECTION`.

1. Create `/etc/cbob/rpc-proxy.env`, owned by the user PM2 runs as, mode 600:
   `CBOB_RPC_UPSTREAM=` (the provider URL with its key), optional `CBOB_DAS_UPSTREAM=`,
   `CBOB_RPC_ORIGIN=https://centralbankofbitcoin.com`, `CBOB_RPC_PORT=8789`,
   `CBOB_VAULT_COLLECTION=` (after step 0). The provider must allow
   getTokenAccountsByOwner with a dataSlice for both token programs (the vault and redeem
   pages list a deposit address's token accounts with it; a program it will not list
   carries its own "could not list" box), getProgramAccounts on MINT,
   DAS or Core getProgramAccounts for the NFT check, and
   getSignaturesForAddress/getTransaction with enough history to reach a
   collection's creating transaction (the ceremony's creator check).
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
| `mainnet` | `account/app.js` | `36f8fb5facd3917eab93fe8cae3480f899a89728c4a1f9eec079dddc7813a663` |
| `mainnet` | `assets/style.css` | `3085e60282d8743e2c0fc4148662ff3ad130b346647ecec6a83505c1c5291656` |
| `mainnet` | `buy/app.js` | `de4a1eceab6edd46465e70d57221d4c1d45f9875b32b3f5fb5d2cc449803fef2` |
| `mainnet` | `ceremony-0cfecdcaf80584b6/app.js` | `a534895096fa6d4d6424b19930e3561ff30b5a2550519e3558bd9707fe512453` |
| `mainnet` | `claim/app.js` | `a46cf2ede07fd471583e4317a7a8836db81317579b53d65bdc310c26e63ca671` |
| `mainnet` | `governance/app.js` | `388867209dea280552919f4a63d04d88757abfc8e147dcffa6a4ed5536c5c494` |
| `mainnet` | `history/app.js` | `0eaaa91c0590cd73dad1ad3534ddca7eb666186cc67793d64c9b9ab9c85ad44e` |
| `mainnet` | `market/app.js` | `5d119f12e0a507c098f5b6c3c008fc55c1378b1dd86479134df159654ffdc62b` |
| `mainnet` | `redeem/app.js` | `bc7080e43915aa1c88938fdbc662461eda7d4926095ce45b558e6d44578b2b9d` |
| `mainnet` | `vault/app.js` | `18947481bc1d9940a0f607c4c3b57f61042bf5d99d700ec276c0a4f6b65efedf` |
| `mainnet-local` | `account/app.js` | `36f8fb5facd3917eab93fe8cae3480f899a89728c4a1f9eec079dddc7813a663` |
| `mainnet-local` | `assets/style.css` | `3085e60282d8743e2c0fc4148662ff3ad130b346647ecec6a83505c1c5291656` |
| `mainnet-local` | `buy/app.js` | `39c1ea635b6c203d231ca686d429e3e6d5477dfd8aca1fa8fea83c18159a10e2` |
| `mainnet-local` | `ceremony-0cfecdcaf80584b6/app.js` | `32b5d47bd8a4bf472ec644047c4ba4313d036090658a712213a9dcfd7a2b99da` |
| `mainnet-local` | `claim/app.js` | `facfabf65ec1ef4079bf735a63fe0f28b774725c895d1503f0d363340fe89203` |
| `mainnet-local` | `governance/app.js` | `388867209dea280552919f4a63d04d88757abfc8e147dcffa6a4ed5536c5c494` |
| `mainnet-local` | `history/app.js` | `0eaaa91c0590cd73dad1ad3534ddca7eb666186cc67793d64c9b9ab9c85ad44e` |
| `mainnet-local` | `market/app.js` | `7116c8ec5f50530e74e23554ebb968c867e2829e6ce755d024c450fd282b0cff` |
| `mainnet-local` | `redeem/app.js` | `09e9358e002ff6692d1ffed8e50fca8d1e205a64cf5990e2767ec71fe19978cf` |
| `mainnet-local` | `vault/app.js` | `0a6f27dc43ef2bcf31407ab804a073de006f9454a8d8fa0d7c43eab28e488797` |

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
4. **Rehearsal mode** (SPEC 53, round 44; round 46, Gary's option 1, 2026-10-09): `node web/build.mjs
   --profile rehearsal --rehearsal-record <tree>/REHEARSAL-RECORD.txt --launch-json <filled
   rehearsal-init.json> --rpc <url> --rehearsal-bytes <tree>/.rehearsal-run/shipping-bytes.json`.
   The record supplies the five throwaway ids (each must map the mainnet id), the value file the
   launch values (its init key must be the profile's: **Gary's wallet**, because on mainnet the
   rehearsal programs are the SHIPPING build, which compiles it in; the seed-7 localnet key,
   which mainnet will not let pay, is refused there), and the bytes file the sha256 and length
   of each shipping build the driver deployed, so the page checks the rehearsal programs' bytes.
   The ceremony judges the values with `check-launch-params.mjs`'s own `--rehearsal` judge on
   mainnet genesis. The 15% goes to the value file's throwaway treasury. Without a value file the
   profile refuses. **Only the launch key signs:** before anything is read or built the page
   refuses every wallet but `initAuthority`, and refuses even that one if the value file names
   another init key (`walletRefusal`). The driver (`scripts/rehearsal-run.mjs --ceremony page`,
   the mainnet default) builds this page itself at its `ceremony-values` step, right before
   step 10 with the charter date re-filled, prints the URL and the page's `app.js` sha256, then
   only WAITS and reads each account back as Gary signs; it never signs on mainnet. A local
   rehearsal keeps the box path (`--ceremony box`), or proves the page path with
   `sim/rehearsal-ceremony-helper.mjs` standing in for Gary (`CBOB_LOCAL_CEREMONY=page`).
   Overrides are refused on every profile the MAINNET gate judges (`mainnet`, `mainnet-local`),
   at build time and at run time (round 46, V46-5).

   **Serving it (hosted, unlisted).** From INSIDE the recorded rehearsal tree:
   `CBOB_CEREMONY_PROFILE=rehearsal CBOB_CEREMONY_ORIGINS=https://centralbankofbitcoin.com node
   web/deploy/ceremony-local.mjs`. It listens on 127.0.0.1:8790, serves `web/dist-rehearsal`
   with `Cache-Control: no-store`, reads the provider inside the process (never argv), relays
   transactions only to the five ids in that tree's record, and accepts the tunnel origins plus
   the HTTPS origins named (never `*`, http or a path; the `mainnet-local` mode refuses any).
   `web/deploy/nginx-rehearsal-ceremony.conf.example` is the reviewed, NOT installed, nginx
   location: one unlisted path behind basic auth, proxied to 8790, no-store, with how to remove
   it. The footer still prints the page's `app.js` sha256 and build commit; compare it with the
   sha256 the driver printed (rehearsal pages are not in the table above).
5. **Road step 9 vs 11:** the ceremony says step 9 deploys and checks the bytes and only step 11 makes the programs final (SPEC); it reports each upgrade authority and does not refuse on it.
6. **Revenue funding** is topped up to rent exemption only (SPEC: "above rent").
7. Griefing policy, stated: nothing a stranger can put at a deposit address refuses an
   opening, at any volume. A foreign NFT, a funded or extended Token-2022 account, a
   frozen account, a stray whose mint someone can freeze, and strays that do not fit are
   each named in a box the holder ticks (more than 20 become one box with the count);
   an empty 165-byte Token-2022 account gets none; accounts or NFTs the page could not
   list or examine are one box each; anything that arrives after the check is covered
   by one standing consent and never stops the send; a CBOB vault sent inside is rescued
   in the set-up step or afterwards, never a refusal. Only the vault's three reserve
   accounts (or the holder's own account for one of them being frozen), a non-owner
   signer, a vault that is gone, foreign, unrecorded or retired, an opening that does not
   fit one transaction (none of which a stranger can cause; round 40 V40-1/V40-4), or the
   coverage cross-check (which by construction finds only what the page did not name)
   refuse.
8. A Proof of Burn (or its collection) with an external plugin cannot be claimed on this
   page; it needs a person (and the claim then goes through the pass-through accounts).
9. The page's own priority fee is small (100,000 micro-lamports a compute unit, at most
   0.00014 SOL at the 1,400,000 cap) and is added only where it fits (round 47, below);
   announcing openings on X and the site is still `bank/redemption-poster.mjs`'s missing
   sender. (Listing a wallet's vaults no longer needs an indexer: round 46, below.)

## Build, test, stage, publish

```bash
node web/build.mjs                 # mainnet -> web/dist/ (BUILD.txt lists every file's sha256)
node web/test/run-all.mjs          # rebuilds, then 1010 offline assertions in 16 files, each at its exact floor
```

Offline (no validator, no network): `ix` (every instruction, byte for byte, against the
builders EXTRACTED from `tests/3prog.test.ts` and `sim/test-vault.ts` and against
mpl-core / spl-token: the redemption set, the four initializes, `claim_charter_vault`,
`mint_vault`, `capture_entropy`, `reveal_level`, `reschedule_reveal`, `rescue_nested`,
`activate`, `distribute`, `CreateCollectionV2`), `ids`, `decode`, `plan` (redemption and
the new rescue rule, checked also against MINT's source), `get` (claim with the real
240-address set and proof, buy, draw, every refusal), `ceremony` (step 0, the
`vault_collection` substitution, every field check), `tx`, `proxy`, `meta`, `bundle`
(the browser bundle equals node; static checks on all five pages), `mine` (show my vaults).

**Show my vaults (round 46; Gary: "why do I have to put my address in. It should show me
my vaults and let me pick").** Once Phantom connects, the redeem page (and the vault
page's "Show my vaults" button) lists the vaults the wallet holds and fills the address
box with the one picked; the paste box always stays. The list comes from Core's own
accounts owned by the wallet (the relay's `core-owner` shape), and from the DAS index
only when that cannot be read; either way every vault listed is VERIFIED ON CHAIN: a
live Core asset owned by this wallet, in the vault collection, with a MINT `VaultRecord`
that names it and is not retired. The index can fail to suggest a vault; it can never
list one (an asset not owned, another collection, burned, unrecorded or retired lists
nothing; `mine.test.mjs`, and the e2e through `sim/das-shim.mjs`). If nothing can be
listed the page says so and the paste box is the way in. Nothing is signed from the list.

**Dry runs and a lagging node (round 46, Gary on the hosted rehearsal page:
"BlockhashNotFound").** Behind a load-balanced RPC the node that simulates may not yet
know the blockhash the page fetched from another. The dry run now asks the node for its
own (`replaceRecentBlockhash: true`; it judges outcomes, never the blockhash); what the
wallet signs and the page sends keeps the page's own blockhash, and a send whose preflight
says "Blockhash not found" is sent again, the same signed bytes, at most 4 more times a
second apart (one signature, so it can land at most once).

Browser wiring without a validator (`node web/test/mock-rpc.mjs`, a `--profile localnet
--rpc http://127.0.0.1:8981` build served on localhost, a test wallet that signs through
the mock; accepted by localnet builds only). Done 2026-10-07 at 375px: the redeem page
(prior transaction, re-plan, dry run, 1,152-byte redemption identical to the plan), the
claim page and the buy page (each sent transaction signed by wallet and new vault and
byte-identical to `planClaim` / `planBuy` from the same state; the new vault's link,
deposit address and draw shown), and the vault page. Re-run 2026-10-08 at 375px after
round 39's redeem changes (the promised re-read, `seen`, `pressInfo`, the optional rescue
group): the redeem page checked, ticked once, set up, re-planned, dry-ran and sent a
1,152-byte redemption identical to the plan, no page-level horizontal scroll; and with
`MOCK_ADVERSARY=1` (round 38) it sent after one press while the mock landed a new stray on
every listing. The optional rescue step's rendering is not exercised by the mock (it has
no nested vault); its logic is in `plan.test.mjs` and the e2e. Re-run 2026-10-08 at 375px after round 40's reader and copy
changes, with `MOCK_DUST=1` (a stranger's lamports at the vault's missing $GIRAFFISH account
address and the holder's missing $GARY account address): the vault page showed $GIRAFFISH as
0 with no "unreadable" or "frozen" text; the redeem page refused nothing, listed both creates
in its set-up, and after one set of ticks and one press sent the 1,152-byte redemption
identical to the plan; no page-level horizontal scroll. Not exercised in the browser: the
buy page with a dusted cbBTC address and the ceremony's step 5 (the mock refuses the chain
scan the ceremony needs). The buy page's own read (`readBuySnapshot`, which `buy.mjs` calls)
is driven offline with a dusted revenue and a dusted holder cbBTC address in `get.test.mjs`
(round 41 C2); step 5 is in `ceremony.test.mjs` and the e2e.

**Phantom on the holder pages (round 47).** Phantom returns a transaction wrapped as
[compute budget: limit 200,000 and a price; Lighthouse checks; the page's instructions; a
Lighthouse check on the payer]. Every holder page now accepts exactly that wrap, under one
judge (`judgeWalletEdits` in `src/lib/tx.mjs`): every instruction the page built, its own
compute budget included, is still there in order and byte for byte, the work as one
unbroken block; the only additions are Lighthouse checks and, only where the page set no
budget, a wallet budget whose limit is at least what the page measured and whose fee is at
most 0.01 SOL; no signer, no writable account, no fee payer or blockhash change. Anything
else is refused before sending, naming what was added. The old exclusion of SEAL and BURN
instructions is gone because it was measured unnecessary: with the real Lighthouse program
on a local chain, every holder transaction wrapped that way lands, the crack included
(SEAL's and BURN's walks find their pair wherever the wallet's instructions sit). What
the measurement did find is that Phantom's fixed 200,000-unit limit is below a
claim-first opening's need (194,694 units bare, about 207,500 with Lighthouse), so every
page builds through `buildForWallet`: dry run, then the page's OWN budget (measured +10%
+ 20,000 for the wallet's checks) whenever it still fits the packet. Phantom documents that
it adds no priority fee to a transaction that already has one. The two widest openings
(about 1,200 bytes) fit no budget at all and go with the cluster default (200,000 a
instruction), exactly as built; whether Phantom then adds Lighthouse to them is not
documented, and only a v0 transaction with a lookup table would make room (a decision, not
built). The e2e drives every holder flow through a Phantom-like signer to a landing.

**End to end on a local validator (for you to run; not run here):**
`bash web/test/e2e-localnet.sh` (refuses while the suite's ports are held; rebuilds
`target/deploy` with `--features localnet`, so rerun `scripts/build-mainnet.sh` before
any mainnet step). It drives the pages' own library: probes and program hashes; step 0
then road step 10 with every step re-read, a resume pass, SEAL found on reload, a
refused second initialize; every HOLDER transaction (claim, draw, activate, rescue, payout,
redeem set-up, both openings, buy) through `buildForWallet`, a Phantom-like signer that wraps
as Phantom does with the pinned mainnet Lighthouse program loaded and its checks run, `signExact`,
the relay's rule and `sendSigned`, each landing (round 47); two vaults claimed through `planClaim` with real Proofs of
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
the default budget with no compute-budget instruction (item 6, W1), with 320 accounts a
stranger parked at that deposit address (200 empty, 120 holding a freezable mint: one
grouped box, the opening lands, round 37 V1), and, after one set of ticks, three presses with a stranger landing a freezable stray and a kept-close-authority account before every re-plan, 112 more balance-holding accounts before the first and the listing failing on the second (no new box, the late items left behind, every promised balance still moved, the opening lands, round 38 V38-2 and round 39 V39-1); a stranger's decoy collection created
before step 0 (not adopted, ignored after, the creator check run on the real chain,
round 37 V2); a stranger's lamports at the pool's cbBTC account address before step 5
(read as not run, then created, round 40 V40-2), and at all four program config addresses
before step 0 (no conflict, every step still initializes and re-reads done, round 41 V41-1), and at a vault's missing $GIRAFFISH account and the
holder's missing account for a stray's mint before an opening (no refusal, the set-up lands on
both, the opening lands, round 40 V40-1); a classic stray a stranger delegated and then handed to the vault with SetAuthority(AccountOwner) (the delegate is cleared, the opening moves its 4 units to the holder, round 39 W2); a vault nested in another
(round 39 V39-2: the host's plan does not refuse and its set-up step carries exactly the
live-host rescue, dry-run clean; the rescue sends it to `bank_treasury`, a local key here
that returns it), the same vault sent into the host just before its press (the opening
lands, then it is rescued from the burned host), then in its own deposit address (to `bank_treasury`), and a foreign
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

## Gary Club account bridge and hosted signing

The bridge migration and server live in the Gary Club repository. `/club/*` proxies only
the named portal actions to that server. The Bank session is Secure, HttpOnly and
host-only, CSRF checked, capped at its parent token expiry, and rejected when its Gary
Club auth session is revoked. Handoff codes are state-bound, single-use and expire in
thirty seconds. Expired credentials are cleaned up as new handoffs are issued.

`web/deploy/nginx-club.conf.example` is the route map. Actions remain disabled until
initialization and validation (`CBOB_PORTAL_ACTIONS_ENABLED=1` in Gary Club). Reconciliation
is independent of this switch. A market read by either party resolves pending trades;
the Gary Club reconciliation timer also processes abandoned actions. Standing order quotes use a
dedicated derived HMAC key and cannot be supplied as plaintext.

For the requested hosted step 10, use `CBOB_CEREMONY_PROFILE=mainnet-hosted`, the Bank's
exact HTTPS origin, nginx basic authentication and the private loopback credential.
The nginx example gives the remaining headers and rate limit. The page's RPC resolves
under its unlisted path, never the public `/rpc`. The server refuses dirty builds and
serves only ceremony assets. Compare the clean build hash in this README with the page.
The hosted page trusts the Bank origin and its delivery path, as the rehearsal did.
The SSH tunnel remains available. Only the pinned initialization wallet may sign.

Reviews are performed through first-party Claude sessions, with independent triage.
They do not use OpenRouter. No alarm, distribution or revenue job is armed by this work.


### Ecosystem presentation (October 11)

The market's five-level showcase uses the existing 720px vault art in `src/assets`.
Design-specimen exports are marked as unissued; public vault cards carry their original
observation time and distinguish missing opening records from zero payouts. Saved vaults
stay on the visitor's device. The payout-weight explorer is explicitly illustrative.
The private account desk shows the existing Gary Club wallet and owned vaults. These
presentation changes add no signing authority. Scripts and styles carry content-hash
query versions alongside SRI; public HTML currently has a five-minute cache lifetime.

### Decisions and opening records (October 11)

`bank/governance-index.mjs` publishes the read-only proposal and ballot register to
`/data/governance.json` through the existing public-data job. It validates addresses,
configuration, proposal count, and complete ballot tallies before replacing the previous
snapshot. Failed reads preserve the prior data and surface freshness. The index currently
scans all governance accounts; pagination is a future scaling requirement.

The voting room lists exact proposed actions, outcomes, per-vault votes, permanent links,
and downloadable observation cards. Casting rechecks live ownership, snapshot eligibility,
prior votes, proposal identity and deadline. The immutable proposal actions and chosen
ballot enter the reviewed effect hash; changing tallies do not. Gary Club persists member
consent before signing. Proposal creation and execution are not added in this release.

The opening register separates observed releases, missing records and burns outside
redemption. “Then and now” reprices only released tokens and excludes hypothetical
later payouts. See `audits/ecosystem-records-2026-10-11/VALIDATION.md` for release scope.




Pin review: `audits/rulings-2026-10-11/BATCH-2-RETRIAGE.md` · sha256 `d42149948683c1ee68746082c7cfaabae420a3fa76885d1bcf0128b1284aec60` · source commit `03e1c1e63f6e20bb9aab6a0f0a34d7a91ed4d5ed`.
