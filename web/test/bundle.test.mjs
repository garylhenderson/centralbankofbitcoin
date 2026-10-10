/**
 * THE BROWSER BUNDLE computes what node computes, and the built HTML keeps the
 * house rules.
 *
 * 1. A test entry is bundled with EXACTLY the page build's browser settings
 *    (platform browser, the crypto/fs/url shims, the injected Buffer/process),
 *    then imported here: judgeLaunch from the bundle refuses and passes exactly
 *    as the real scripts/check-launch-params.mjs does, the Bank's layout decoder
 *    works on the shimmed sha256, and the bundled planRedemption, RUN on six synthetic
 *    snapshots, gives byte-identical instructions and the same boxes as node's (round 39 C03).
 * 2. Static checks on web/dist (build it first): no external script, no inline
 *    script, a CSP, a viewport, the ceremony noindex and linked from nowhere, no
 *    em dash in any page or in any holder-facing string in web/src.
 */
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { createHash } from 'crypto'
import { judgeLaunch } from '../../scripts/check-launch-params.mjs'
import { CEREMONY_SLUG } from '../src/config.js'
import { harness, ROOT } from './ref.mjs'
import { execFileSync } from 'child_process'
import { Keypair } from '@solana/web3.js'

const require = createRequire(import.meta.url)
const esbuild = require('/home/ubuntu/luna-remotion/node_modules/esbuild')
const H = harness('bundle')
const WEB = `${ROOT}/web`, OUTD = `${WEB}/test/.out`
fs.mkdirSync(OUTD, { recursive: true })
const entry = `${OUTD}/entry.mjs`
fs.writeFileSync(entry, `export { judgeLaunch } from '../../../scripts/check-launch-params.mjs'
export { decode, encode } from '../../../bank/layout.mjs'
export { planRedemption } from '../../src/lib/plan-redeem.mjs'
export { makeIds } from '../../src/lib/ids.mjs'
export { PROFILES } from '../../src/config.js'
export { judgeRedemptionCoverage } from '../../../bank/detectors.mjs'
`)
const shim = f => `${WEB}/src/shims/${f}`
const r = esbuild.buildSync({ entryPoints: [entry], outfile: `${OUTD}/browser-lib.mjs`, bundle: true, format: 'esm', platform: 'browser',
  alias: { crypto: shim('crypto.mjs'), fs: shim('empty.mjs'), url: shim('url.mjs') }, inject: [shim('globals.mjs')],
  define: { 'import.meta.url': '""' }, logLevel: 'error' })
H.t('the browser-settings bundle builds', r.errors.length === 0)
const src = fs.readFileSync(`${OUTD}/browser-lib.mjs`, 'utf8')
H.t('the browser bundle does not import node\'s crypto, fs or url', !/from\s*["'](node:)?(crypto|fs|url)["']|require\(["'](crypto|fs|url)["']\)/.test(src))
const B = await import(`${OUTD}/browser-lib.mjs?${Date.now()}`)

const launch = JSON.parse(fs.readFileSync(`${ROOT}/launch/mainnet-init.json`, 'utf8'))
const pobSet = JSON.parse(fs.readFileSync(`${ROOT}/scripts/pob-set.json`, 'utf8'))
const NOW = Math.floor(Date.now() / 1000)
H.eq('bundled judgeLaunch == node judgeLaunch on the committed file (refuses today)', B.judgeLaunch(launch, { nowSec: NOW, pobSet }), judgeLaunch(launch, { nowSec: NOW, pobSet }))
const filled = JSON.parse(JSON.stringify(launch))
filled.charter_opens_at = { value: NOW + 14 * 86400, status: 'RULED' }; filled.lock_deadline = { value: NOW + 7 * 86400, status: 'RULED' }
filled.vault_collection = { value: 'HqznL4EpJTbWZmqqetb4sJPftBUN1s6uNdQURBAfAsBr', status: 'RULED' }
H.eq('bundled judgeLaunch passes the filled values, as node does (the PoB root recomputed with the shimmed sha256)', B.judgeLaunch(filled, { nowSec: NOW, pobSet }), [])
const badRoot = JSON.parse(JSON.stringify(filled)); badRoot.pob_root.value = '11'.repeat(32)
H.eq('bundled judgeLaunch refuses a wrong PoB root exactly as node does', B.judgeLaunch(badRoot, { nowSec: NOW, pobSet }), judgeLaunch(badRoot, { nowSec: NOW, pobSet }))
const seal = { version: 2, collection: '11111111111111111111111111111112', reserve_mints: ['cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'], bump: 254 }
H.eq('bundled layout decode(encode(x)) == x (discriminator via the shimmed sha256)', B.decode('SealConfig', B.encode('SealConfig', seal)), seal)
H.eq('bundled judgeRedemptionCoverage is the Bank\'s', B.judgeRedemptionCoverage([{ address: 'a', kind: 'asset' }], []).ok, false)

// ── round 39 C03: the BUNDLED planRedemption, run, and compared with node's, byte for byte ──
{
  const F = await import('./redeem-fixtures.mjs')
  const { planRedemption: nodePlan } = await import('../src/lib/plan-redeem.mjs')
  const { makeIds: nodeIds } = await import('../src/lib/ids.mjs')
  const nIds = nodeIds(F.P), bIds = B.makeIds({ ...B.PROFILES.mainnet, collection: F.COLL.toBase58() })
  const ixBytes = ix => ({ p: ix.programId.toBase58(), k: ix.keys.map(k => `${k.pubkey.toBase58()}:${+k.isSigner}${+k.isWritable}`), d: Buffer.from(ix.data).toString('hex') })
  const canon = p => JSON.stringify({ refuse: p.refuse, ack: p.ack.map(a => [a.id, a.text]), note: p.note, late: p.lateInfo, press: p.pressInfo, size: p.size,
    redemption: p.redemption.map(ixBytes), prior: p.prior.map(g => [!!g.optional, g.map(x => [x.why, ixBytes(x.ix)])]) }, (k, v) => typeof v === 'bigint' ? String(v) : v)
  const freeze = new Proxy({ [F.CBBTC.toBase58()]: F.kp(190).toBase58(), [F.kp(240).toBase58()]: F.kp(203).toBase58() }, { get: (t, k) => k in t ? t[k] : null })
  const cases = {
    'plain': F.snap(),
    'missing accounts (a prior transaction)': F.snap({ pdaTokens: [F.tok(F.kp(200), F.CBBTC, 5)].map(t => ({ ...t, address: F.snap().pdaTokens[0].address })), ownerAtaExists: new Set() }),
    'a stray, a C5 account and freezable strays (grouped)': F.snap({ mintFreeze: freeze, pdaTokens: [...F.snap().pdaTokens, F.tok(F.kp(70), F.kp(71), 55), F.tok(F.kp(72), F.kp(73), 1, { closeAuthority: F.stranger }),
      ...Array.from({ length: 22 }, (_, i) => F.tok(F.kp(100 + i), F.kp(240), 1))] }),
    'a nested CBOB vault (rescued in the set-up step) and a foreign NFT': F.snap({ nested: [{ address: F.kp(80).toBase58(), ourVault: true }, { address: F.kp(81).toBase58(), ourVault: false, name: 'x' }] }),
    'the pool frozen with a share owed': F.snap({ pool: { state: 2, amount: 1000n }, record: F.record({ debt_scaled: 0n }) }),
    'the press: known, consented, seen, a late stray and a missing promised one': F.snap({ noPrior: true, known: new Set([F.kp(70).toBase58(), F.kp(74).toBase58()]), consented: new Set(['late-arrivals']),
      seen: new Set([F.kp(70).toBase58()]), pdaTokens: [...F.snap().pdaTokens, F.tok(F.kp(70), F.kp(71), 55), F.tok(F.kp(75), F.kp(76), 3)], ownerAtaExists: new Set([...F.snap().ownerAtaExists]),
      strayReadIncomplete: { unlisted: 'x', unexamined: 0, cap: 200 }, nftReadIncomplete: { unlisted: false, unexamined: 4, cap: 200 } }),
  }
  for (const [name, sn] of Object.entries(cases)) {
    const run = f => { try { return { ok: true, v: canon(f()) } } catch (e) { return { ok: false, v: `threw: ${e?.message || e}` } } }
    const n = run(() => nodePlan(nIds, sn)), b = run(() => B.planRedemption(bIds, sn))
    H.t(`C03: the BUNDLED planRedemption equals node's, byte for byte: ${name}`, n.ok && b.ok && n.v === b.v && n.v.length > 200, `node ${n.v.slice(0, 80)} / bundle ${b.v.slice(0, 80)}`)
  }
}

// ── static checks on the built pages ──
const DIST = `${WEB}/dist`
if (!fs.existsSync(DIST)) { H.t('web/dist exists (run node web/build.mjs first)', false) }
else {
  const pages = ['vault', 'redeem', 'claim', 'buy', 'market', 'account', `ceremony-${CEREMONY_SLUG}`]
  for (const p of pages) {
    const html = fs.readFileSync(`${DIST}/${p}/index.html`, 'utf8')
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    H.t(`${p}: exactly one script, our own app.js, no inline code`, scripts.length === 1 && /src="app\.js"/.test(scripts[0][1]) && scripts[0][2].trim() === '')
    H.t(`${p}: no external stylesheet or script host`, !/<(script|link)[^>]+(src|href)="(https?:)?\/\//.test(html))
    H.t(`${p}: a Content-Security-Policy with script-src 'self'`, /http-equiv="Content-Security-Policy" content="[^"]*script-src 'self'/.test(html))
    H.t(`${p}: phone viewport`, /name="viewport" content="width=device-width, initial-scale=1/.test(html))
    H.t(`${p}: no em dash`, !html.includes('\u2014'))
    H.t(`${p}: no unfilled template marker`, !/\{\{\w+\}\}/.test(html))
  }
  const cer = fs.readFileSync(`${DIST}/ceremony-${CEREMONY_SLUG}/index.html`, 'utf8')
  H.t('ceremony: <meta name="robots" content="noindex,nofollow">', cer.includes('<meta name="robots" content="noindex,nofollow">'))
  const linked = ['vault', 'redeem', 'claim', 'buy'].some(p => fs.readFileSync(`${DIST}/${p}/index.html`, 'utf8').includes('ceremony') || fs.readFileSync(`${DIST}/${p}/app.js`, 'utf8').includes(`ceremony-${CEREMONY_SLUG}`))
  H.t('ceremony: not linked from any holder page (HTML or script)', !linked)
  const css = fs.readFileSync(`${DIST}/assets/style.css`, 'utf8')
  H.t('css: inputs are 16px (no iOS zoom), buttons and copy buttons are at least 44px tall', /input\[type=text\]\{[^}]*font-size:16px/.test(css) && /\.btn\{[^}]*min-height:44px/.test(css) && /\.copy\{[^}]*min-height:44px/.test(css))
  H.t('css: the page cannot scroll sideways; addresses wrap', /body\{[^}]*overflow-x:hidden/.test(css) && /code\{[^}]*word-break:break-all/.test(css))
  // REVIEW M3: nothing about the box ships
  const leak = /bank\/keys|\/opt\/|\/home\/|R2 backup|nightly|Linq|\.env\b|secret at/
  for (const p of pages) H.t(`${p}: the bundle names no key file, path on the box, backup or ruling channel`, !leak.test(fs.readFileSync(`${DIST}/${p}/app.js`, 'utf8')))
  H.t('the embedded launch values carry only value and status (no notes)', Object.values(JSON.parse(fs.readFileSync(`${WEB}/src/generated/launch.json`, 'utf8'))).every(e => Object.keys(e).join() === 'value,status'))
  // REVIEW M4: subresource integrity, and the ceremony shows its own hash
  for (const p of pages) {
    const html = fs.readFileSync(`${DIST}/${p}/index.html`, 'utf8')
    const want = `sha384-${createHash('sha384').update(fs.readFileSync(`${DIST}/${p}/app.js`)).digest('base64')}`
    const css = `sha384-${createHash('sha384').update(fs.readFileSync(`${DIST}/assets/style.css`)).digest('base64')}`
    H.t(`${p}: app.js and style.css carry subresource integrity that matches the files`, html.includes(`src="app.js" defer integrity="${want}"`) && html.includes(`integrity="${css}"`))
  }
  H.t('ceremony: the page prints its app.js sha256 (to check against BUILD.txt)', cer.includes(createHash('sha256').update(fs.readFileSync(`${DIST}/ceremony-${CEREMONY_SLUG}/app.js`)).digest('hex')))
  for (const p of pages) H.t(`${p}: BUILD.txt lists its app.js`, fs.readFileSync(`${DIST}/BUILD.txt`, 'utf8').includes(`${p}/app.js`))
}
// ── round 36 gate 5, item 5 (L4): the build REFUSES unless dist/ is a clean build of
//    the release commit config.js names, and its sums equal the pins ──
{
  const fake = `${OUTD}/fakedist`
  const prep = (manifest, sums) => { fs.rmSync(fake, { recursive: true, force: true }); fs.mkdirSync(fake, { recursive: true })
    for (const f of fs.readdirSync(`${ROOT}/dist`)) if (f.endsWith('.so')) fs.copyFileSync(`${ROOT}/dist/${f}`, `${fake}/${f}`)
    fs.writeFileSync(`${fake}/MANIFEST.txt`, manifest); fs.writeFileSync(`${fake}/SHA256SUMS`, sums) }
  const realMan = fs.readFileSync(`${ROOT}/dist/MANIFEST.txt`, 'utf8'), realSums = fs.readFileSync(`${ROOT}/dist/SHA256SUMS`, 'utf8')
  const build = () => { try { execFileSync(process.execPath, [`${WEB}/build.mjs`, '--dist', fake, '--out', `${OUTD}/dist-check`], { stdio: 'pipe' }); return 'built' }
    catch (e) { return String(e.stderr || '') } }
  prep(realMan, realSums)
  H.eq('L4: CONTROL: an exact copy of the release build is accepted', build(), 'built')
  prep(realMan.replace(/^commit\s+\S+/m, 'commit    1281ab4ca42a816f1b912ca888b8a5ff38c94898'), realSums)
  H.t('L4: a dist/ built from ANOTHER commit is refused, naming it', /not the release commit/.test(build()))
  prep(realMan.replace(/^dirty\s+no/m, 'dirty     yes'), realSums)
  H.t('L4: a dist/ built from a DIRTY tree is refused', /dirty tree/.test(build()))
  prep(realMan, realSums.replace(/^[0-9a-f]{64}(  cbob_vault_mint\.so)$/m, '00'.repeat(32) + '$1'))
  H.t('L4: a dist/ whose MINT sum differs from the pin is refused', /programBytes\.mint/.test(build()))
  fs.rmSync(fake, { recursive: true, force: true })
}

// ── review round 36 L5: the committed hash table (README) is the reference the ceremony
//    footer points at; it must cover BOTH the public and the local-mode ceremony and
//    equal a fresh build of each, or this fails ──
{
  const LOCAL = `${OUTD}/dist-mainnet-local`
  execFileSync(process.execPath, [`${WEB}/build.mjs`, '--profile', 'mainnet-local', '--out', LOCAL], { stdio: 'ignore' })
  const readme = fs.readFileSync(`${WEB}/README.md`, 'utf8')
  const rows = [...readme.matchAll(/^\| `(mainnet|mainnet-local)` \| `([^`]+)` \| `([0-9a-f]{64})` \|$/gm)].map(m => [m[1], m[2], m[3]])
  const actual = (dir, f) => createHash('sha256').update(fs.readFileSync(`${dir}/${f}`)).digest('hex')
  const files = ['vault', 'redeem', 'claim', 'buy', 'market', 'account', `ceremony-${CEREMONY_SLUG}`].map(p => `${p}/app.js`).concat('assets/style.css')
  for (const [prof, dir] of [['mainnet', DIST], ['mainnet-local', LOCAL]])
    for (const f of files) {
      const row = rows.find(r => r[0] === prof && r[1] === f)
      H.t(`README hash table: ${prof} ${f} equals a fresh build`, !!row && row[2] === actual(dir, f), row ? `${row[2]} vs ${actual(dir, f)}` : 'no row')
    }
  H.t('the local-mode ceremony is NOT the public one byte for byte (different RPC), so it needs its own row', actual(LOCAL, `ceremony-${CEREMONY_SLUG}/app.js`) !== actual(DIST, `ceremony-${CEREMONY_SLUG}/app.js`))
  H.t('the ceremony footer points at the README table, not at a build output that is not in the repository',
    /compare it with the table in web\/README\.md/.test(fs.readFileSync(`${DIST}/ceremony-${CEREMONY_SLUG}/index.html`, 'utf8')) && !/against BUILD\.txt from the repository/.test(fs.readFileSync(`${DIST}/ceremony-${CEREMONY_SLUG}/index.html`, 'utf8')))
}

// ── ROUND 46 (V46-5): a profile judged by the MAINNET gate (mainnet, mainnet-local)
//    takes NO override, at build time or at run time; the rehearsal build takes its
//    record, its value file (Gary's init key only) and its program bytes ──
{
  const tryBuild = args => { try { execFileSync(process.execPath, [`${WEB}/build.mjs`, ...args], { stdio: 'pipe' }); return 'built' } catch (e) { return String(e.stderr || '') } }
  const LJ = `${ROOT}/launch/mainnet-init.json`, COLL = '7DiXsBWmwJ8WQZdgoyyic1wh5FGtib3Xe8vtfugSwhXG'
  const refusedLocal = [['--rpc', 'http://127.0.0.1:8899'], ['--collection', COLL], ['--launch-json', LJ]]
    .map(a => /takes every value from web\/src\/config\.js/.test(tryBuild(['--profile', 'mainnet-local', ...a, '--out', `${OUTD}/r46-refused`])))
  H.eq('R46 V46-5: a mainnet-local build REFUSES --rpc, --collection and --launch-json (it is judged by the mainnet gate)', refusedLocal, [true, true, true])
  H.t('R46 V46-5: ...as the mainnet build does, and --rehearsal-bytes is for the rehearsal profile only',
    /takes every value/.test(tryBuild(['--profile', 'mainnet', '--rpc', 'http://127.0.0.1:8899', '--out', `${OUTD}/r46-refused`]))
    && /rehearsal profile only/.test(tryBuild(['--profile', 'mainnet-local', '--rehearsal-bytes', LJ, '--out', `${OUTD}/r46-refused`])))
  const cfgNow = async (name, over) => { globalThis.__CBOB_PROFILE__ = name; globalThis.__CBOB_OVERRIDES__ = over
    try { return (await import(`../src/config.js?r46=${name}-${Math.random()}`)).activeProfile() } finally { delete globalThis.__CBOB_PROFILE__; delete globalThis.__CBOB_OVERRIDES__ } }
  const C = await import('../src/config.js')
  H.eq('R46 V46-5: at run time an injected override is IGNORED on mainnet and mainnet-local, and applied on the rehearsal and localnet profiles',
    [(await cfgNow('mainnet', { rpc: 'http://evil.invalid' })).rpc, (await cfgNow('mainnet-local', { rpc: 'http://evil.invalid' })).rpc,
      (await cfgNow('rehearsal', { rpc: 'http://ok.invalid' })).rpc, (await cfgNow('localnet', { rpc: 'http://ok.invalid' })).rpc],
    [C.PROFILES.mainnet.rpc, C.PROFILES['mainnet-local'].rpc, 'http://ok.invalid', 'http://ok.invalid'])
  H.eq('R46 V46-5: takesOverrides is false exactly for the profiles the mainnet gate judges', Object.fromEntries(Object.entries(C.PROFILES).map(([k, p]) => [k, C.takesOverrides(p)])),
    Object.fromEntries(Object.entries(C.PROFILES).map(([k, p]) => [k, p.launchJudge !== 'mainnet'])))
  // the rehearsal page, as the driver builds it (ceremony-values): a record, the value
  // file (init key = Gary's wallet), the shipping bytes, and its RPC under the unlisted path
  const rk = n => Keypair.fromSeed(Buffer.alloc(32, n)).publicKey.toBase58()
  const reh = { seal: rk(71), mint: rk(72), burn: rk(73), gov: rk(74), sweep: rk(75) }
  fs.mkdirSync(`${OUTD}/r46`, { recursive: true })
  fs.writeFileSync(`${OUTD}/r46/REHEARSAL-RECORD.txt`, ['REHEARSAL TREE', 'id map (mainnet -> rehearsal):', ...Object.keys(reh).map(k => `  ${C.MAINNET_PROGRAMS[k]} ${reh[k]} ${k}`), ''].join('\n'))
  fs.writeFileSync(`${OUTD}/r46/bytes.json`, JSON.stringify(Object.fromEntries(Object.keys(reh).map((k, i) => [k, { sha256: String(i + 1).repeat(64), len: 1000 + i }]))))
  const REHF = JSON.parse(fs.readFileSync(`${ROOT}/launch/rehearsal-init.json`, 'utf8'))
  const local = JSON.parse(JSON.stringify(REHF)); local.init_authority.value = 'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB'
  fs.writeFileSync(`${OUTD}/r46/local-init.json`, JSON.stringify(local))
  const rehBuild = lj => tryBuild(['--profile', 'rehearsal', '--rehearsal-record', `${OUTD}/r46/REHEARSAL-RECORD.txt`, '--launch-json', lj,
    '--rpc', 'same-origin:/unlisted/rpc', '--rehearsal-bytes', `${OUTD}/r46/bytes.json`, '--out', `${OUTD}/r46/dist-rehearsal`])
  const built = rehBuild(`${ROOT}/launch/rehearsal-init.json`)
  const app = built === 'built' ? fs.readFileSync(`${OUTD}/r46/dist-rehearsal/ceremony-${CEREMONY_SLUG}/app.js`, 'utf8') : ''
  H.eq('R46 the rehearsal page builds from its record, Gary\'s init key and the shipping bytes, and carries all five rehearsal ids, their bytes and the unlisted RPC path',
    [built, Object.values(reh).every(id => app.includes(id)), ['1', '5'].every(d => app.includes(d.repeat(64))), app.includes('same-origin:/unlisted/rpc')], ['built', true, true, true])
  H.t('R46 ...a value file naming the localnet test key is refused by the rehearsal build',
    /is not the rehearsal profile's Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb/.test(rehBuild(`${OUTD}/r46/local-init.json`)))
  fs.rmSync(`${OUTD}/r46`, { recursive: true, force: true }); fs.rmSync(`${OUTD}/r46-refused`, { recursive: true, force: true })
}

// ── no em dash anywhere in web/src (holder copy, and the generated error names) ──
const walk = d => fs.readdirSync(d).flatMap(f => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? walk(p) : [p] })
const withDash = walk(`${WEB}/src`).filter(f => fs.readFileSync(f, 'utf8').includes('\u2014'))
H.eq('no em dash in any file under web/src (copy, comments, the generated error messages)', withDash, [])
export default H.done()
