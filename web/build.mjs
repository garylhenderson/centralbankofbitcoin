#!/usr/bin/env node
/**
 * Build the static pages.
 *
 *   node web/build.mjs                         # mainnet profile -> web/dist/
 *   node web/build.mjs --profile localnet --collection <addr> [--rpc <url>] [--launch-json <file>]
 *                                              # -> web/dist-localnet/ (local tests only)
 *
 * Output (copy as-is into the site root):
 *   vault/index.html, vault/app.js
 *   redeem/index.html, redeem/app.js
 *   claim/index.html, claim/app.js, buy/index.html, buy/app.js
 *   ceremony-<slug>/index.html, ceremony-<slug>/app.js   (unlisted, noindex)
 *   assets/style.css
 *   BUILD.txt (commit, profile, sha256 of every file)
 *
 * It REFUSES when config.js's audited program hashes differ from /opt/cbob-vaults/dist,
 * and when an override is given for the mainnet profile. No network, no installs:
 * esbuild bundles what is already in node_modules.
 */
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { PROFILES, CEREMONY_SLUG } from './src/config.js'
import { generate } from './gen-errors.mjs'

const require = createRequire(import.meta.url)
const esbuild = require('/home/ubuntu/luna-remotion/node_modules/esbuild')
const WEB = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(WEB, '..')
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null }
const die = m => { console.error(`build refused: ${m}`); process.exit(1) }

const profileName = arg('--profile') || 'mainnet'
const P = PROFILES[profileName]; if (!P) die(`unknown profile ${profileName}`)
const overrides = {}
if (arg('--collection')) overrides.collection = arg('--collection')
if (arg('--rpc')) overrides.rpc = arg('--rpc')
if (arg('--launch-json')) overrides.launchValues = JSON.parse(fs.readFileSync(arg('--launch-json'), 'utf8'))
if (profileName === 'mainnet' && Object.keys(overrides).length) die('the mainnet build takes every value from web/src/config.js; overrides are for local tests only')
const OUT = path.resolve(arg('--out') || path.join(WEB, profileName === 'mainnet' ? 'dist' : `dist-${profileName}`))

// 1. the audited bytes table must match dist/ exactly
if (P.programBytes) {
  const sums = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'dist/SHA256SUMS'), 'utf8').trim().split('\n').map(l => l.split(/\s+/)).map(([h, f]) => [f, h]))
  for (const [k, v] of Object.entries(P.programBytes)) {
    const f = path.join(ROOT, 'dist', v.file)
    if (sums[v.file] !== v.sha256) die(`config programBytes.${k} sha256 is not dist/SHA256SUMS's (${sums[v.file]}); update web/src/config.js from the release build`)
    if (fs.statSync(f).size !== v.len) die(`config programBytes.${k} len is not the size of dist/${v.file}`)
    if (createHash('sha256').update(fs.readFileSync(f)).digest('hex') !== v.sha256) die(`dist/${v.file} does not hash to its own SHA256SUMS line`)
  }
}

// 2. the program error names, regenerated from the Rust
fs.mkdirSync(path.join(WEB, 'src/generated'), { recursive: true })
fs.writeFileSync(path.join(WEB, 'src/generated/errors.json'), JSON.stringify(generate(), null, 1) + '\n')

// 2b. what the public bundles may embed: the launch values and the Proof of Burn set,
//     WITHOUT their notes (review M3: the notes name key files and backups on the box)
const launchSrc = JSON.parse(fs.readFileSync(path.join(ROOT, 'launch/mainnet-init.json'), 'utf8'))
const launchPub = Object.fromEntries(Object.entries(launchSrc).filter(([k]) => !k.startsWith('_')).map(([k, e]) => [k, { value: e.value, status: e.status }]))
fs.writeFileSync(path.join(WEB, 'src/generated/launch.json'), JSON.stringify(launchPub, null, 1) + '\n')
const pobSrc = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/pob-set.json'), 'utf8'))
fs.writeFileSync(path.join(WEB, 'src/generated/pob-set.json'), JSON.stringify({ collection: pobSrc.collection, count: pobSrc.count, root: pobSrc.root,
  assets: pobSrc.assets.map(a => ({ edition: a.edition, address: a.address })) }) + '\n')

// 3. bundle
fs.rmSync(OUT, { recursive: true, force: true })
const pages = { vault: 'vault', redeem: 'redeem', claim: 'claim', buy: 'buy', [`ceremony-${CEREMONY_SLUG}`]: 'ceremony' }
const shim = f => path.join(WEB, 'src/shims', f)
for (const [dir, page] of Object.entries(pages)) {
  const r = esbuild.buildSync({
    entryPoints: [path.join(WEB, 'src/pages', `${page}.mjs`)], outfile: path.join(OUT, dir, 'app.js'),
    bundle: true, format: 'iife', platform: 'browser', target: ['es2020', 'safari14'], minify: false, sourcemap: false,
    legalComments: 'none', logLevel: 'error', charset: 'utf8',
    alias: { crypto: shim('crypto.mjs'), fs: shim('empty.mjs'), url: shim('url.mjs') },
    inject: [shim('globals.mjs')],
    define: { __CBOB_PROFILE__: JSON.stringify(profileName), __CBOB_OVERRIDES__: JSON.stringify(overrides), 'import.meta.url': '""' },
    supported: { bigint: true },
  })
  if (r.errors.length) die(r.errors.map(e => e.text).join('\n'))
}
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true })
fs.copyFileSync(path.join(WEB, 'src/style.css'), path.join(OUT, 'assets/style.css'))

// 4. html, with a CSP that lets the page talk only to its own RPC endpoints, and
//    subresource integrity on every script and stylesheet (review M4)
const eff = { ...P, ...overrides }
const origins = [...new Set([eff.rpc, eff.dasRpc].filter(u => u && !u.startsWith('same-origin:')).map(u => new URL(u).origin))]
const CSP = [`default-src 'none'`, `script-src 'self'`, `style-src 'self'`, `img-src 'self'`, `connect-src 'self'${origins.map(o => ` ${o}`).join('')}`,
  `base-uri 'none'`, `form-action 'self'`, `object-src 'none'`].join('; ')
const label = profileName === 'mainnet' ? 'Solana mainnet' : profileName === 'mainnet-local' ? 'Solana mainnet, local ceremony mode' : `${P.label}: NOT FOR PUBLICATION`
const sri = f => `sha384-${createHash('sha384').update(fs.readFileSync(f)).digest('base64')}`
let commit = 'unknown', dirty = ''
try { commit = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD']).toString().trim()
  dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', 'web']).toString().trim() ? ' (web/ has uncommitted changes)' : '' } catch { /* not a checkout */ }
const cssSri = sri(path.join(OUT, 'assets/style.css'))
for (const [dir, page] of Object.entries(pages)) {
  const app = path.join(OUT, dir, 'app.js')
  const html = fs.readFileSync(path.join(WEB, 'src/html', `${page}.html`), 'utf8').replaceAll('{{CSP}}', CSP).replaceAll('{{LABEL}}', label)
    .replaceAll('{{APP_SRI}}', sri(app)).replaceAll('{{CSS_SRI}}', cssSri).replaceAll('{{COMMIT}}', commit.slice(0, 12) + dirty)
    .replaceAll('{{APP_SHA256}}', createHash('sha256').update(fs.readFileSync(app)).digest('hex'))
  fs.writeFileSync(path.join(OUT, dir, 'index.html'), html)
}

// 5. the record
const files = []
const walk = d => { for (const f of fs.readdirSync(d).sort()) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p) } }
walk(OUT)
const lines = files.map(f => `${createHash('sha256').update(fs.readFileSync(f)).digest('hex')}  ${path.relative(OUT, f)}`)
fs.writeFileSync(path.join(OUT, 'BUILD.txt'), [`profile   ${profileName}${Object.keys(overrides).length ? ` + overrides ${JSON.stringify(Object.keys(overrides))}` : ''}`,
  `commit    ${commit}${dirty}`, `rpc       ${eff.rpc || 'TODO (pages refuse until set)'}`, `collection ${eff.collection || 'TODO (pages refuse until set)'}`,
  `ceremony  /ceremony-${CEREMONY_SLUG}/ (unlisted, noindex)`, '', ...lines, ''].join('\n'))
console.log(`built ${profileName} -> ${path.relative(process.cwd(), OUT) || OUT}`)
for (const l of lines) console.log(`  ${l}`)
