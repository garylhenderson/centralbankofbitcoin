/**
 * THE BROWSER BUNDLE computes what node computes, and the built HTML keeps the
 * house rules.
 *
 * 1. A test entry is bundled with EXACTLY the page build's browser settings
 *    (platform browser, the crypto/fs/url shims, the injected Buffer/process),
 *    then imported here: judgeLaunch from the bundle refuses and passes exactly
 *    as the real scripts/check-launch-params.mjs does, the Bank's layout decoder
 *    works on the shimmed sha256, and the redemption plan is byte-identical.
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

// ── static checks on the built pages ──
const DIST = `${WEB}/dist`
if (!fs.existsSync(DIST)) { H.t('web/dist exists (run node web/build.mjs first)', false) }
else {
  const pages = ['vault', 'redeem', 'claim', 'buy', `ceremony-${CEREMONY_SLUG}`]
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
// ── no em dash anywhere in web/src (holder copy, and the generated error names) ──
const walk = d => fs.readdirSync(d).flatMap(f => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? walk(p) : [p] })
const withDash = walk(`${WEB}/src`).filter(f => fs.readFileSync(f, 'utf8').includes('\u2014'))
H.eq('no em dash in any file under web/src (copy, comments, the generated error messages)', withDash, [])
export default H.done()
