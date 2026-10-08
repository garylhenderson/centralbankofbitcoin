/**
 * THE ONE CONFIG FILE for the CBOB holder pages (/vault/, /redeem/) and the
 * unlisted launch ceremony page.
 *
 * Every program id, the RPC URL, the vault collection and every other address the
 * pages use comes from HERE and nowhere else. The profile is baked into the bundle
 * at build time (`node web/build.mjs --profile <name>`); there is deliberately NO
 * URL parameter that switches it, because a holder page that a link could point
 * at other program ids is a phishing kit.
 *
 * Values marked TODO are decisions not yet made. A page with a TODO it needs
 * REFUSES to act and says which value is missing. It never guesses.
 */

/** The unlisted ceremony page lives at /ceremony-<CEREMONY_SLUG>/. Generated once
 *  from 8 random bytes (2026-10-07). It is unlisted, NOT secret: anyone who reads
 *  this repository can find it. The page's real protection is that it refuses
 *  every key except INIT_AUTHORITY, and the programs refuse every other key too. */
export const CEREMONY_SLUG = '0cfecdcaf80584b6'

const CORE = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'

/** The five program ids as claimed on mainnet 2026-10-07 (SPEC road step 9) and
 *  as pinned in bank/layout.mjs PROGRAM_IDS. web/test/ids.test.mjs asserts the
 *  two agree, so this copy cannot drift from the Bank's. */
export const MAINNET_PROGRAMS = {
  seal: '9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273',
  mint: 'Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo',
  burn: '8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8',
  gov: '2pj5jTmeAXrUQvdkc3rXeXAdDKf1V13EXHuhMuyRGBr2',
  sweep: 'EB2uVvsaThLp4PWt3LwAWveTCa9ZynPVbWzZfUhMf2aa',
}

/** THE RELEASE BUILD these pages pin: dist/MANIFEST.txt must name exactly this
 *  commit, built from a clean tree (round 35, built 2026-10-07T17:12:25Z), or the
 *  build refuses (review round 36 L4: pins that only had to match dist/ could both
 *  be stale together). */
export const RELEASE_COMMIT = '0b3ddb3dab13438fb6f4b4bc11ba4f03541641be'

/** sha256 and byte length of each program's audited bytes, from dist/SHA256SUMS of
 *  the release build above (commit 0b3ddb3). The build REFUSES to run if these
 *  differ from /opt/cbob-vaults/dist, so a new release build forces this table to
 *  be updated in the same change. The ceremony page
 *  hashes each deployed ProgramData and requires the first `len` bytes of the
 *  program to hash to this value and every byte after them to be zero, which is
 *  the check SPEC road step 9 makes with `solana program dump`. */
const MAINNET_PROGRAM_BYTES = {
  seal: { file: 'cbob_vaults.so', sha256: '077a344cd37976a75b9cc5cce0dd055e8ee50d9065702eaeb265104e33edad60', len: 285520 },
  mint: { file: 'cbob_vault_mint.so', sha256: '0d91662a2aac1a270ec5d91700eb8b698950c9a74790ad32c156faa06575b63d', len: 707664 },
  burn: { file: 'cbob_vault_burn.so', sha256: '83d6a628c1cc1ede3a3e9f3f3f6c9137c6e399b0ba095f3883c1008985fc5113', len: 317048 },
  gov: { file: 'cbob_vault_gov.so', sha256: 'd66bde7bd3de561f6565272c812ec39fdec46396bae2494b3dd93a4a76687a64', len: 384120 },
  sweep: { file: 'cbob_vault_sweep.so', sha256: '9e21cc9c6474b172fdcd65b1fa5f0482b00b0696a75a007dac5ddf42aaa5f6af', len: 107584 },
}

export const PROFILES = {
  mainnet: {
    name: 'mainnet',
    label: 'Solana mainnet',
    // RULED (Gary, 2026-10-07): a SAME-ORIGIN proxy on the site itself, so no
    // provider key ever reaches a browser. web/deploy/rpc-proxy.mjs allowlists
    // exactly the methods these pages call; it is a STAGED step (README.md) and
    // until it is live every read fails closed with a plain message.
    rpc: 'https://centralbankofbitcoin.com/rpc',
    // Optional second endpoint for DAS (getAssetsByOwner). null = use `rpc`.
    dasRpc: null,
    expectedGenesisHash: MAINNET_GENESIS,
    programs: MAINNET_PROGRAMS,
    programBytes: MAINNET_PROGRAM_BYTES,
    core: CORE,
    // THE VAULT COLLECTION. Created by the ceremony's step 0 (Gary, 2026-10-07:
    // "Central Bank of Bitcoin Vaults", update authority MINT's ["mint"] PDA, no
    // plugin). Until the ceremony has created it this stays null: the ceremony then
    // offers step 0, and every holder page refuses. Record the address the
    // ceremony shows HERE, then rebuild.
    collection: null,
    initAuthority: 'Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb',
    // The CBOBTC Squads vault (DESIGN-v6 ruling 3), whose cbBTC ATA the ceremony
    // checks or creates. Must equal launch/mainnet-init.json bank_treasury.
    squads: 'bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1',
    garyMint: '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk',
    // Display names for the reserve mints. The LIST itself is read from SEAL's
    // config on chain, never from here.
    tokenNames: {
      cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: 'cbBTC',
      '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk': '$GARY',
      Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump: '$GIRAFFISH',
    },
    // 'mainnet': the ceremony runs scripts/check-launch-params.mjs judgeLaunch
    // itself over the embedded launch/mainnet-init.json, and refuses unless the
    // chain's genesis hash is mainnet's.
    launchJudge: 'mainnet',
    // A test wallet (window.cbobTestWallet) is NEVER accepted on mainnet.
    allowTestWallet: false,
  },

  /** SPEC road step 8: the dress rehearsal at throwaway ids. Built with
   *    node web/build.mjs --profile rehearsal --rehearsal-record <tree>/REHEARSAL-RECORD.txt \
   *      --launch-json <filled launch/rehearsal-init.json> --rpc <url>
   *  which fills the five program ids from the record and the launch values from
   *  the value file (its REHEARSAL-OPEN keys filled at rehearsal time). */
  rehearsal: {
    name: 'rehearsal',
    label: 'Mainnet dress rehearsal (throwaway program ids)',
    rpc: null, // TODO: same decision as mainnet
    dasRpc: null,
    expectedGenesisHash: MAINNET_GENESIS,
    programs: { seal: null, mint: null, burn: null, gov: null, sweep: null }, // filled by --rehearsal-record
    programBytes: null, // TODO: the rehearsal build's sha256 and length, or null to report "not checked"
    core: CORE,
    collection: null, // step 0 of the rehearsal's own ceremony creates it
    // RULED, Gary 2026-10-08 ("you sign the transactions"): the rehearsal deploys
    // the `--features localnet` build, so INIT_AUTHORITY is the test key and the
    // box signs. Must equal launch/rehearsal-init.json init_authority (tested).
    initAuthority: 'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB',
    // No Squads: the 15% goes to the throwaway treasury the value file names
    // (bank_treasury, REHEARSAL-OPEN), never the real one (its judge refuses it).
    squads: null,
    garyMint: '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk',
    tokenNames: {
      cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: 'cbBTC',
      '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk': '$GARY',
      Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump: '$GIRAFFISH',
    },
    // SPEC item 53: judged by check-launch-params.mjs's --rehearsal judge over
    // launch/rehearsal-init.json (round 44 V44-1). With no --launch-json the
    // ceremony refuses (launchValues null).
    launchJudge: 'rehearsal-file',
    launchValues: null,
    // A test wallet is NEVER accepted on a mainnet-genesis profile, this one
    // included (ids.test). The box signs (the ruling above) by driving the
    // ceremony's own STEPS from plan-ceremony.mjs with the localnet key, as
    // web/test/e2e-localnet.mjs does, not this page in a browser.
    allowTestWallet: false,
  },

  /** A local validator running the LOCALNET build (INIT_AUTHORITY is the suite's
   *  deterministic test key GmaDrpp..., Keypair.fromSeed(32 x 7)). For the
   *  end-to-end plan in README.md. Never published. */
  localnet: {
    name: 'localnet',
    label: 'Local test validator',
    rpc: 'http://127.0.0.1:8999',
    dasRpc: null,
    expectedGenesisHash: null,
    programs: MAINNET_PROGRAMS,
    programBytes: null, // the localnet build differs from dist/ by its INIT_AUTHORITY
    core: CORE,
    collection: null, // set by web/test/e2e-localnet.mjs, which writes its own copy
    initAuthority: 'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB',
    squads: 'bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1',
    garyMint: '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk',
    tokenNames: {
      cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: 'cbBTC',
      '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk': '$GARY',
      Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump: '$GIRAFFISH',
    },
    launchJudge: 'rehearsal',
    launchValues: null, // supplied by the e2e harness
    allowTestWallet: true,
  },
}

/** LOCAL CEREMONY MODE (review M4): the mainnet profile, byte for byte, except that
 *  the page talks to the server that served it (`same-origin:/rpc`), so Gary can
 *  run the ceremony from a copy built and served on the box and reached through an
 *  SSH tunnel, instead of trusting whatever the public site serves. README.md. */
PROFILES['mainnet-local'] = { ...PROFILES.mainnet, name: 'mainnet-local', label: 'Solana mainnet (local ceremony mode)', rpc: 'same-origin:/rpc' }

/** What every vault and the collection are named, and where their metadata
 *  lives (Gary, 2026-10-07). web/meta/generate.mjs writes those files. */
export const SITE = {
  origin: 'https://centralbankofbitcoin.com',
  vaultName: 'CBOB Vault',
  metadataBase: 'https://centralbankofbitcoin.com/v/',
  collectionName: 'Central Bank of Bitcoin Vaults',
  collectionUri: 'https://centralbankofbitcoin.com/v/collection.json',
}

/** Phantom's documented "browse" universal link (docs.phantom.com, Deeplinks,
 *  Other methods, Browse; checked 2026-10-07): opens a page inside Phantom's
 *  in-app browser on a phone. The page URL is the page's own location at run
 *  time, never a hard-coded address. */
export const PHANTOM_BROWSE = 'https://phantom.com/ul/browse/'

/** Resolve a profile, refusing any TODO the caller needs. */
export function profile(name) {
  const p = PROFILES[name]
  if (!p) throw new Error(`unknown profile ${name}`)
  return p
}

/* The profile this bundle was built for (web/build.mjs --profile). Build-time
 * overrides (--collection, --rpc, --launch-json) exist for the LOCAL validator
 * test only; mainnet ignores them, so the published pages read this file alone. */
/* global __CBOB_PROFILE__, __CBOB_OVERRIDES__ */
export const ACTIVE_PROFILE = typeof __CBOB_PROFILE__ !== 'undefined' ? __CBOB_PROFILE__ : 'mainnet'
export function activeProfile() {
  const p = { ...profile(ACTIVE_PROFILE) }
  if (ACTIVE_PROFILE !== 'mainnet' && typeof __CBOB_OVERRIDES__ !== 'undefined') Object.assign(p, __CBOB_OVERRIDES__)
  return p
}
