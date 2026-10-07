# Adversarial review: CBOB holder pages (`web/`), 2026-10-07

Scope: `web/src` (vault, redeem, claim, buy, ceremony and their libs), `web/meta/generate.mjs`, `web/deploy/rpc-proxy.mjs` and `nginx-rpc.conf`, checked against SPEC items 9, 42, 44, 50 ("What a redemption client must do"), 52, 54, 58, Known limits C5 and F1, and HOLDER-GUIDE.md.
Method: I read all the code. I ran `node web/test/run-all.mjs` (393/393 pass) and offline repros against the pages' own pure functions, with no validator and no live job. I also curled every external URL.
Nothing outside this file was modified. `run-all.mjs` rebuilds `web/dist` and `web/src/generated/errors.json` as it always does.

Labels: **CONFIRMED** means reproduced, or certain from the code path. **SUSPECTED** means plausible but not exercised.

---

## H1 (HIGH, CONFIRMED). Any stranger can permanently block a vault's opening on the redeem page for about 0.002 SOL

**Where:** `web/src/lib/plan-redeem.mjs:122` (an unparsed account is refused), `:127-129` (a frozen stray is skipped and left uncovered), `:163-173` (every uncovered coverage reason other than a foreign NFT becomes a `refuse`). Also `web/src/lib/reads.mjs:111` (an NFT that cannot be parsed is marked `unreadable` and refused), and `web/src/lib/decode.mjs:45-48,77` (the plugin list stops at 17, and an unknown type throws).

**Failure.** BURN never sees undeclared accounts, so the program would let the opening through. The page refuses instead, for good, in each of these cases. All were reproduced against `planRedemption` and `parseCoreAsset`:

1. **An empty Token-2022 ATA.** Anyone can create one for the vault's deposit address, for any Token-2022 mint, by paying about 0.0021 SOL of rent. Token-2022 ATAs always carry ImmutableOwner, so the account is 170 bytes. `classifyPdaTokenAccount` marks it `undeclarable`, and the page refuses with "The vault holds something this page cannot take out". The holder cannot close it first, because the sealed vault cannot `Execute` before `open`.
2. **A frozen account the stranger controls.** The stranger makes their own classic mint with a freeze authority, initializes an account owned by the deposit address, mints 1 unit into it and freezes it. The page refuses, and only the stranger can ever unfreeze it.
3. **A pNFT sent to the deposit address.** Token Metadata keeps pNFT token accounts frozen, so the page refuses (same path as case 2).
4. **A Core asset with the `Groups` plugin (type 18), sent to the deposit address.** The mainnet Core dump in `.cache/core-mainnet.so` contains the Groups processors, and mpl-core 1.10.0 defines `PluginType 18 = Groups`. `parseCoreAsset` throws "unknown plugin type 18", the asset comes back `unreadable`, and the page refuses. The same throw also makes `/vault/` and `/claim/` misread such an asset.

**Consequence.** The redeem page is the only client allowed to run the coverage check (SPEC item 50). Once blocked, the holder's cbBTC, $GARY and $GIRAFFISH cannot be taken out through it, ever, until the page changes. Doing this to all 2,100 vaults costs about 4.4 SOL.

This breaks HOLDER-GUIDE.md:227, which says "Someone could send a tiny amount into your vault while you are opening it. On the redeem page that cannot block the opening." The test suite contradicts itself on this point:
- `web/test/plan.test.mjs:183` asserts "nothing refused (a stranger cannot block an opening with junk)", but only for 8 strays the helper can sweep.
- `:152` and `:156` assert that the blocking cases are refused.

SPEC C5 ("refuses only an account that still holds a balance it cannot move (a frozen one, or Token-2022)") rules the behaviour. It does not mention that a stranger can create that state at will and for good.

**Fix.**
- Refuse only problems with the three reserve accounts, and nested vaults (those go to the rescue).
- For anything else of a non-reserve mint that the page cannot move (frozen with a balance, Token-2022, an unparseable foreign asset), require a ticked acknowledgement naming it, as is already done for foreign NFTs and the strays left behind for lack of room. It cannot be the holder's reserve value.
- For an empty Token-2022 account, add a Core `ExecuteV1` of Token-2022 `CloseAccount` (destination: the owner) to the opening. Token-2022 itself refuses to close an account with a confidential or withheld balance, so this proves on chain that it is empty, sends the griefer's rent to the holder, and reverts safely if it is not empty.
- Parse the Core header (key, owner, update authority, collection) separately from the plugins. Walk unknown plugin types by their registry offsets, and add `Groups` (18).

## M1 (MEDIUM, CONFIRMED). The RPC proxy is an open relay with the provider key for any non-browser client, and its `getProgramAccounts` "shape" check can be bypassed

**Where:** `web/deploy/rpc-proxy.mjs:107`, `:58-70`, `:136-143`.

- **No Origin check for clients that send no Origin.** `if (origin && req.headers.origin && req.headers.origin !== origin)` lets through any request without an Origin header. Repro: a request with no Origin got 200 and was forwarded; the same request with `Origin: https://evil.example` got 403. So curl or any script can use our provider key for all 15 methods, including `sendTransaction`, `getMultipleAccounts` (100 accounts per call) and DAS. The README's "same origin only" holds only for browsers, and `proxy.test.mjs` never tests a request without an Origin.
- **The `getProgramAccounts` filters are checked by offset only, never by their bytes.** These calls were all ALLOWED (repro):
  - Core with `{offset:1, bytes:'1'}`: a 1-byte owner prefix, which matches 1/256 of every Core asset on mainnet. `bytes:''` passes too.
  - Core with `{offset:34, bytes:'2'}`.
  - MINT with any value at offset 177.
  - `getAssetsByGroup` for any collection while `CBOB_VAULT_COLLECTION` is unset (the README lists it as optional).

  So the claim that the endpoint "cannot be used to dump a whole program" is false.
- **The 8 MB response cap is checked only after `await r.text()` has buffered the whole upstream body.** That is unbounded memory against `max_memory_restart: 200M`.
- **Rate limits are per address** (`$binary_remote_addr`). A single IPv6 /64 holds 2^64 of them.

**Consequence:** the provider's credits get drained, or the provider rate-limits or bans the key. Every page fails closed for every holder (a denial of service on openings and claims), and the provider's bill rises.

**Fix:**
- Require `Origin === CBOB_RPC_ORIGIN`. Browsers always send Origin on a POST, so a missing Origin should be refused; `Sec-Fetch-Site: same-origin` can be required as well.
- Require each required memcmp's `bytes` to decode to exactly 32 bytes. Require offset 33 to be `[2]` with the configured collection at 34. Require MINT's offset 177 to be exactly `'2'`.
- Refuse to start without `CBOB_VAULT_COLLECTION`.
- Cap the response while streaming it.
- Bucket IPv6 addresses by /64.
- Consider forwarding `sendTransaction` only for transactions that name a CBOB program.

## M2 (MEDIUM, CONFIRMED). The ceremony cannot resume between step 0 and SEAL initialize: a reload offers to create a SECOND collection

**Where:** `web/src/pages/ceremony.mjs:74-76` and `:123`; `web/src/lib/ceremony-reads.mjs` (`resolveCollection`).

**Failure.** The collection address made in step 0 lives only in `ctx.created`. Suppose that, after step 0 lands and before SEAL initialize, Gary reloads the page (or the Phantom in-app browser drops it). If `config.js` and `launch/mainnet-init.json` have not yet been rebuilt with the address, every source is empty: `config.js` is null, SEAL is not initialized and the launch value is OPEN. The page then shows step 0 as "next" and makes a new keypair. The ceremony test asserts exactly this result ("resume: nothing anywhere -> step 0 is next", `ceremony.test.mjs:188`). It cannot tell this case apart from one where step 0 already created a collection.

Gary can then initialize the four programs, permanently, against collection #2 while he records #1 (the one the page showed him first) in `config.js` and the launch file. No value is lost: the holder pages and generator refuse on the mismatch. But the RULED `vault_collection` record is wrong, the orphan collection is created for good, and resolving it takes a manual investigation on launch day.

**Fix.** Before offering step 0, list Core `CollectionV1` accounts (key 5) whose update authority at offset 1 is MINT's `["mint"]` PDA. STOP if any exists that no source names. Alternatively, persist the created address (for example in `localStorage`) and refuse to continue until it is recorded.

## M3 (MEDIUM, CONFIRMED). The public ceremony bundle tells anyone where the hot keys live

**Where:** `web/src/pages/ceremony.mjs:18` imports all of `launch/mainnet-init.json`, including its `source` strings, into `dist/ceremony-0cfecdcaf80584b6/app.js`, which will be served publicly.

**Failure.** Running grep over the built bundle finds:
- "secret at bank/keys/swap-operator.json (600, gitignored)";
- "the full supply minted into a dedicated release wallet on the box (bank/keys/cbob-release.json, 600, in the nightly R2 backup)";
- the ruling-channel notes ("Linq text: 2 - yes").

That is reconnaissance on the box that holds all 2.1B $CBOB (SPEC accepted limit 56), published at a URL whose slug is in the repository.

**Fix.** Embed only `{value, status}` for each key, stripping `source` and `_comment` at build time, and add a bundle test that greps for `bank/keys` and `/opt/`.

## M4 (MEDIUM, SUSPECTED, operational). The ceremony signs whatever the public site serves

The ceremony is served from the public site, behind Cloudflare, with an `app.js` name that is not content-hashed. Anyone who can change that file, or poison the edge cache, can make Gary's INIT_AUTHORITY sign initialize values of their choosing: a guardian, swap operator or bank_treasury. Those values are immutable once written. The page's description lines, its dry run and its `judgeLaunch` check all run inside the same tampered JS, so none of them protect against this. Phantom shows opaque instruction data.

**Fix.** Run road step 10 from a locally built copy served on localhost (the `localnet` build path already exists), or have Gary check the served `app.js` against `BUILD.txt` before he connects. Better still, decode the signed message independently (a CLI that re-runs `judgeLaunch` on the instruction bytes) before signing.

## L1 (LOW-MEDIUM, CONFIRMED). The check for things inside a vault misses some assets, and one acknowledgement says something false

**Where:** `web/src/lib/reads.mjs:87-116`; `plan-redeem.mjs:171`.

- **Compressed NFTs are never checked.** Bubblegum v1/v2 cNFTs owned by the deposit address have no account, so they are invisible on the getProgramAccounts path, which is the normal one. On the DAS fallback they are listed, then dropped because `accounts()` returns null for them. They are destroyed with no warning, although the page says it "checks the vault for anything that would be destroyed".
- **The fallback hides errors.** Any getProgramAccounts error (a 429 from the proxy's 1/s bucket, for example) silently downgrades the check to the lagging DAS index. Only a note is shown; no acknowledgement is asked for.
- **The foreign-NFT acknowledgement is untrue.** It says "Nothing can take it out". In fact, after `open_for_redemption`, a Core `ExecuteV1` wrapping a `TransferV1` of the nested asset to the owner could move a foreign Core NFT out. A nested vault is correctly refused (item 58 M1).

**Fix:** call DAS `getAssetsByOwner` as well and count compressed assets, retry getProgramAccounts on a 429 instead of falling back, and either offer to move foreign Core NFTs out or correct the wording.

## L2 (LOW, CONFIRMED). A stranger can loop the re-plan refusal and charge the holder ATA rent each time

**Where:** `web/src/pages/redeem.mjs:120-127`.

**Failure.** Between the prior transaction and the opening, a stranger adds a new stray of a new mint. The fresh plan then needs a prior transaction for it, so the page answers "Something changed ... Check it again". The next attempt pays about 0.002 SOL of rent for the stranger's mint's ATA, and the stranger can repeat.

**Fix:** in the re-plan, treat new strays that need a new ATA as "left behind" with an acknowledgement, instead of refusing.

## L3 (LOW, CONFIRMED). C5 transfers move the amount read at planning time

**Where:** `plan-redeem.mjs:144-145`.

**Failure.** Anything that lands in such an account after the read is destroyed, although the note says the balance "moves to you". It is a stranger's account, so the loss is the stranger's own dust.

**Fix:** reword the note, or accept the behaviour explicitly.

## L4 (LOW, SUSPECTED). The metadata generator can overwrite a good file after a lagging read, and one of its texts is false

**Where:** `web/meta/generate.mjs:155-159` and `:63-65`.

- **A null cbBTC account is written as 0 cbBTC.** A vault's ATA cannot close while the vault is sealed, so a null for a vault whose file showed a balance, or for an active or pending vault, is a bad read.
- **Nothing stops a drawn level from regressing to "Not drawn yet" with no image**, for example when a load-balanced RPC answers from a node that is behind. Levels never undraw, and "Opened" never reverses.
- **"Opened" says "everything it held went to its owner"**, which is false for a bare `BurnV1`. There, the contents were destroyed.

**Fix:** make the file monotonic (never downgrade a drawn level or an opened state, and keep the previous file when a known account reads as null), and change the text for burned-but-not-redeemed vaults.

## L5 (LOW, SUSPECTED). The page's clock is not the one the programs use

`chainNow` (`reads.mjs:48-53`) reads `getBlockTime` of the latest *confirmed* slot. Providers often answer "Block not available" for very recent slots, which makes claim, buy, redeem and the ceremony fail now and then. The figure is also the RPC's estimate, not the `Clock` sysvar the programs check.

**Fix:** read `SysvarC1ock11111111111111111111111111111111` with `getAccountInfo`, a method the proxy already allows.

## L6 (LOW, CONFIRMED). Smaller page defects

- **A rescued vault is described wrongly.** A vault held by `bank_treasury` (after a rescue) shows on `/vault/` as "held by an address that cannot sign ... cannot be opened", with a host-paste rescue form. It should say it is with the Bank's multisig, waiting to be returned (`vault.mjs:65-72,145`).
- **Ceremony lists collapse into one line.** Multi-line refusals (the `judgeLaunch` list, "WRONG ON CHAIN") are joined with `\n`, and `.box` has no `white-space: pre-line`, so at 375px they render as one run-on line.
- **The fund step can pay twice.** If `sendSigned` times out after the funding transaction actually landed, rerunning the dry run sends the shortfall again, from Gary's own SOL.
- **The buy page overstates the price.** It says "You pay exactly <price>", but the program charges the live price, which can only be equal or lower (`max_price`).
- **A frozen cbBTC account is described wrongly.** `planActivate` says "does not hold any cbBTC yet" when the vault's cbBTC account is frozen.

---

## Checked and found sound

- **XSS:** every piece of chain or URL data is inserted with `textContent` (`ui.mjs el`). There is no `innerHTML` or `eval`. Links are built from base58 values or `location`.
- **Wallet tampering:** `signExact` refuses any change to the message and verifies signatures before extra keypairs sign. The pages never use `signAndSend`.
- **Rescue:** the destination is always MINT `bank_treasury`, read on chain. The page refuses exactly what `rescue_nested` refuses (self, burned host, or live CBOB vault host; `NotNested`). Spoofed hosts (an update authority set to the Address of the collection) cannot collide, because a deposit address is unique to its asset.
- **Opening:**
  - The helper names all three reserve ATAs and moves balances and lamports as they are when it runs.
  - Missing reserve and owner ATAs are created in a prior transaction.
  - There is no `claim` while the pool is frozen, and an owed share then needs an acknowledgement.
  - `burn_vault` declares both ATA derivations.
  - The size is fitted to 1,232 bytes, and strays that do not fit need an acknowledgement.
  - A fresh re-read and re-plan comes before the dry run, and the dry run must burn the asset.
- **Ownership and vault checks:**
  - Claim: the window, supply, root recompute, Proof of Burn owner, frozen flag and external plugins are all checked.
  - Buy: `max_price` is the price read on chain.
- **Instruction bytes** equal the suite and sim builders (`ix.test`). The `pending` offset 177 is correct against the Rust struct.
- **Ceremony:**
  - It refuses any key other than INIT_AUTHORITY.
  - It checks the genesis hash, then runs `judgeLaunch` at both clocks, with the stand-in only for the OPEN `vault_collection`.
  - It checks program bytes and the probe.
  - It re-reads every field after each step, and stops on any mismatch without offering a later step.
  - It stops on a conflicting collection.
- **Proxy:** CORS is safe (no ACAO header, OPTIONS denied, wrong Origin refused). Real client IPs reach nginx through `10-cloudflare-realip.conf`, and the site already sends `X-Frame-Options: DENY`.
- **Copy and layout:** there are no em dashes in rendered copy (`el()` rewrites them in the shared Bank text). The 375px CSS rules hold: 16px inputs, 44px buttons, wrapping addresses.
- **URLs** (curl, 2026-10-07):
  - `cdn.gary.club/cbob/vaults/v1/level-{1..5}/master.png` answer 200 image/png, and the record page links exactly these, in I-to-V order.
  - `centralbankofbitcoin.com`, `/seal.png` and `/favicon-32.png` answer 200.
  - `phantom.com/ul/browse/...` answers 200 (`phantom.app` 301s to it), and `docs.phantom.com` answers 200.
  - `centralbankofbitcoin.com/rpc`, `/v/collection.json` and `/vault/` answer **404** today. They are staged and not guessed, but `collection.json` becomes a permanent on-chain URI at step 0 and each vault's `/v/<asset>.json` at mint. Serve `v/` before step 0 and before the first claim.

## How much the offline tests actually prove

- **plan.test** (`:183`) claims "a stranger cannot block an opening with junk" while `:152` and `:156` assert the opposite for frozen and Token-2022 junk (H1). The claim is true only for strays the helper can sweep.
- **proxy.test** never sends a request without an Origin and never sends a filter with the wrong byte length, so "same-origin only" and "cannot dump a program" are untested (M1).
- **ceremony.test** asserts the case that causes M2 to resolve to "step 0 next".
- **decode.test** has no Core asset with plugin 18 (H1 case 4).
- **meta.test** has no regression or stale-read cases (L4).
- **Nothing the pages build has landed on a validator.** The opening shape (claim first, C5 Execute(Transfer), multi-pair helper), claim, buy and the ceremony are byte-compared with builders or driven through `mock-rpc.mjs`; `e2e-localnet.sh` has not been run (README says so). The SPEC S8 transaction that did land was open, claim, sweep, burn. The programs' pairing scan does not depend on order (checked in BURN and SEAL), so the claim-first order is very likely fine, but it is unmeasured, and so are the compute units of the C5 path.
- **bundle.test** checks the CSS with regexes, with no render. The 375px pass was done by hand against the mock.
