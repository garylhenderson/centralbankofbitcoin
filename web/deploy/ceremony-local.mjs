#!/usr/bin/env node
/**
 * LOCAL CEREMONY MODE (review M4). The ceremony signs immutable values; the copy
 * the public site serves is only as trustworthy as everything between this repo
 * and Gary's browser (the site, its cache, Cloudflare). So the recommended way is
 * to build the ceremony on the box and serve it to Gary's browser over an SSH
 * tunnel, never through the public site:
 *
 *   on the box:   node web/build.mjs --profile mainnet-local
 *                 node --env-file=/etc/cbob/rpc-proxy.env web/deploy/ceremony-local.mjs
 *   on the laptop: ssh -N -L 8790:127.0.0.1:8790 ubuntu@<box>
 *   in the browser (with Phantom): http://localhost:8790/ceremony-<slug>/
 *
 * It listens on 127.0.0.1 ONLY, serves web/dist-mainnet-local read-only (no
 * directory listings, no path outside it), and answers /rpc through the same
 * proxy rules as the public endpoint (rpc-proxy.mjs), accepting only the two
 * tunnel origins. The provider URL comes from the env file, never the repo.
 *
 * THE DRESS REHEARSAL (round 46; Gary 2026-10-09: "put a page up where I click and
 * sign each transaction so it's easy? ONLY my wallet can sign"). Run from INSIDE a
 * recorded rehearsal tree with CBOB_CEREMONY_PROFILE=rehearsal, it serves
 * web/dist-rehearsal (the rehearsal profile's build), takes the five program ids
 * from that tree's REHEARSAL-RECORD.txt (so /rpc relays transactions to those
 * programs and no others), reads the provider from the box's env file when
 * CBOB_RPC_UPSTREAM is unset (never from argv), and accepts, besides the two
 * tunnel origins, the HTTPS origins named in CBOB_CEREMONY_ORIGINS: the site
 * that reverse-proxies an unlisted, basic-auth path to it
 * (web/deploy/nginx-rehearsal-ceremony.conf.example). Never '*', never http,
 * never a path; the mainnet-local mode accepts none of them. The page itself
 * still refuses every wallet but the value file's init_authority.
 */
import { verifyCeremonyBuild } from './ceremony-build.mjs'
import http from 'http'
import { timingSafeEqual } from 'node:crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { handler, forwardFetch } from './rpc-proxy.mjs'
import { MAINNET_PROGRAMS } from '../src/config.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TREE = path.resolve(HERE, '..', '..')
const PORT = Number(process.env.CBOB_LOCAL_PORT || 8790)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.txt': 'text/plain; charset=utf-8' }

export function staticFile(root, urlPath) {
  // Round 42 (V42-1): a malformed escape such as /%E0 throws URIError; inside a
  // request listener that would end the process mid-ceremony. It is a 404.
  let p
  try { p = decodeURIComponent(String(urlPath).split('?')[0]) } catch { return null }
  if (p.endsWith('/')) p += 'index.html'
  const f = path.resolve(root, '.' + p)
  if (!f.startsWith(root + path.sep)) return null
  try { if (!fs.realpathSync(f).startsWith(fs.realpathSync(root) + path.sep) || !fs.statSync(f).isFile()) return null } catch { return null }
  return f
}

/** The server's own request listener, exported so a test drives exactly what
 *  runs (round 42, V42-1). Anything it throws is a 500, never a dead process. */
export function localListener(root, rpc, allowed = null) {
  return (req, res) => {
    try {
      if (req.url === '/rpc') return rpc(req, res)
      if (req.method !== 'GET') { res.statusCode = 405; return res.end() }
      const f = staticFile(root, req.url)
      if (!f || (allowed && !allowed.has(path.relative(root, f)))) { res.statusCode = 404; return res.end('not found') }
      res.setHeader('content-type', TYPES[path.extname(f)] || 'application/octet-stream')
      res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('x-frame-options', 'DENY')
      fs.createReadStream(f).on('error', () => { if (!res.headersSent) res.statusCode = 500; res.end() }).pipe(res)
    } catch { if (!res.headersSent) res.statusCode = 500; res.end() }
  }
}

/** Hosted access is authenticated by nginx and a separate loopback credential. */
export function hostedListener(root, rpc, secret, allowed = null) {
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) throw new Error('A hosted ceremony needs its private proxy credential')
  const listener = localListener(root, rpc, allowed)
  return (req, res) => {
    const supplied = String(req.headers['x-cbob-ceremony'] || '')
    if (supplied.length !== secret.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))) { res.statusCode = 403; return res.end('forbidden') }
    try {
      if (/uncommitted|dirty/i.test(fs.readFileSync(path.join(root, 'BUILD.txt'), 'utf8'))) { res.statusCode = 503; return res.end('A reviewed build is being published. Please reload shortly.') }
    } catch { res.statusCode = 503; return res.end('The signing page is being published. Please reload shortly.') }
    const pathname = String(req.url).split('?')[0]
    if (!/^\/(rpc|BUILD\.txt|assets\/style\.css|ceremony-[a-f0-9]+\/(index\.html|app\.js)?)$/.test(pathname)) { res.statusCode = 404; return res.end('not found') }
    listener(req, res)
  }
}

/** Round 46: the extra (hosted) origins, judged. Each must be exactly
 *  https://<host>[:port]: no '*', no http, no path, query or credentials. */
export function judgeOrigins(raw) {
  const list = String(raw || '').split(',').map(s => s.trim()).filter(Boolean)
  const bad = list.filter(o => o.includes('*') || !/^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(o))
  return { origins: bad.length ? [] : list, refuse: bad.map(o => `CBOB_CEREMONY_ORIGINS: ${JSON.stringify(o)} is not an https://host origin (never '*', http, a path or credentials)`) }
}

/** The rehearsal's five program ids, from its record: each line must map the MAINNET id. */
export function rehearsalPrograms(recordText, mainnet = MAINNET_PROGRAMS) {
  const ids = {}
  for (const l of String(recordText).split('\n')) {
    const m = l.match(/^\s+([1-9A-HJ-NP-Za-km-z]{32,44}) ([1-9A-HJ-NP-Za-km-z]{32,44}) (seal|mint|burn|gov|sweep)$/)
    if (m) { if (m[1] !== mainnet[m[3]]) throw new Error(`the record's ${m[3]} entry does not map the mainnet ${m[3]} id`); ids[m[3]] = m[2] }
  }
  if (Object.keys(ids).length !== 5) throw new Error('the rehearsal record does not name all five programs')
  return ids
}

/** What this server serves and accepts, from the environment. Pure (fs injected). */
export function serverConfig(env, { tree = TREE, port = PORT, readFile = f => fs.readFileSync(f, 'utf8'), exists = f => fs.existsSync(f) } = {}) {
  const tunnel = [`http://localhost:${port}`, `http://127.0.0.1:${port}`]
  const profile = env.CBOB_CEREMONY_PROFILE || 'mainnet-local'
  if (profile === 'mainnet-hosted') {
    const extra = judgeOrigins(env.CBOB_CEREMONY_ORIGINS)
    if (extra.refuse.length || extra.origins.length !== 1 || extra.origins[0] !== 'https://sign.centralbankofbitcoin.com') throw new Error('Hosted mainnet ceremony accepts only the dedicated https://sign.centralbankofbitcoin.com origin; the public apex is refused')
    if (env.CBOB_CEREMONY_HOSTED_AUTH !== 'nginx-basic') throw new Error('Hosted mainnet ceremony requires the nginx basic-auth deployment profile')
    return { profile, root: path.join(tree, 'web', 'dist-mainnet-local'), origins: extra.origins, programs: null }
  }
  if (profile === 'mainnet-local') {
    if (env.CBOB_CEREMONY_ORIGINS) throw new Error('CBOB_CEREMONY_ORIGINS is for the rehearsal profile only; the mainnet ceremony is reached through the SSH tunnel')
    return { profile, root: path.join(tree, 'web', 'dist-mainnet-local'), origins: tunnel, programs: null }
  }
  if (profile !== 'rehearsal') throw new Error(`CBOB_CEREMONY_PROFILE ${profile} is not mainnet-local or rehearsal`)
  const record = path.join(tree, 'REHEARSAL-RECORD.txt')
  if (!exists(record)) throw new Error(`${tree} is not a recorded rehearsal tree (no REHEARSAL-RECORD.txt): the rehearsal page is served only from one`)
  const extra = judgeOrigins(env.CBOB_CEREMONY_ORIGINS)
  if (extra.refuse.length) throw new Error(extra.refuse.join('; '))
  return { profile, root: path.join(tree, 'web', 'dist-rehearsal'), origins: [...tunnel, ...extra.origins], programs: rehearsalPrograms(readFile(record)) }
}

export function pinnedBuildFor(tree, cfg, env, verify = verifyCeremonyBuild) {
  const pinned = env.CBOB_CEREMONY_COMMIT || tree.startsWith('/opt/cbob-ceremony/')
    ? verify(cfg.root, env.CBOB_CEREMONY_COMMIT) : null
  if (cfg.profile === 'mainnet-hosted' && !pinned) throw new Error('Hosted signing requires a pinned artifact')
  return pinned
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = serverConfig(process.env)
  if (!fs.existsSync(cfg.root)) { console.error(`build it first: node web/build.mjs --profile ${cfg.profile} ... (${cfg.root} is missing)`); process.exit(2) }
  const pinned = pinnedBuildFor(TREE, cfg, process.env)
  const allowed = pinned ? new Set(pinned.allowed) : null
  let upstream = process.env.CBOB_RPC_UPSTREAM
  // the box's provider, read inside the process (security.md #67: never a URL in argv)
  if (!upstream && cfg.profile === 'rehearsal') upstream = (await import('../../bank/rehearsal-env.mjs')).jobRpc()
  const rpc = handler({ upstream, das: process.env.CBOB_DAS_UPSTREAM || upstream,
    origins: cfg.origins, collection: process.env.CBOB_VAULT_COLLECTION || null, requireCollection: false, programs: cfg.programs,
    forward: forwardFetch, log: (...a) => console.log(new Date().toISOString(), ...a) })
  if (cfg.profile === 'mainnet-hosted' && /uncommitted|dirty/i.test(fs.readFileSync(path.join(cfg.root, 'BUILD.txt'), 'utf8'))) throw new Error('Hosted ceremony refuses an uncommitted build')
  http.createServer(cfg.profile === 'mainnet-hosted' ? hostedListener(cfg.root, rpc, process.env.CBOB_CEREMONY_PROXY_SECRET, allowed) : localListener(cfg.root, rpc, allowed)).listen(PORT, '127.0.0.1', () => console.log(`local ceremony (${cfg.profile}) on http://127.0.0.1:${PORT}/ (serving ${cfg.root}); origins ${cfg.origins.join(', ')}; BUILD.txt lists the sha256 of every file`))
}
