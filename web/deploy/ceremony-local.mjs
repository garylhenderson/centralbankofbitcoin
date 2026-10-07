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
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { handler, forwardFetch } from './rpc-proxy.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-mainnet-local')
const PORT = Number(process.env.CBOB_LOCAL_PORT || 8790)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.txt': 'text/plain; charset=utf-8' }

export function staticFile(root, urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0])
  if (p.endsWith('/')) p += 'index.html'
  const f = path.resolve(root, '.' + p)
  if (!f.startsWith(root + path.sep)) return null
  try { if (!fs.statSync(f).isFile()) return null } catch { return null }
  return f
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(ROOT)) { console.error(`build it first: node web/build.mjs --profile mainnet-local (${ROOT} is missing)`); process.exit(2) }
  const rpc = handler({ upstream: process.env.CBOB_RPC_UPSTREAM, das: process.env.CBOB_DAS_UPSTREAM || process.env.CBOB_RPC_UPSTREAM,
    origins: [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`], collection: process.env.CBOB_VAULT_COLLECTION || null, requireCollection: false,
    forward: forwardFetch, log: (...a) => console.log(new Date().toISOString(), ...a) })
  http.createServer((req, res) => {
    if (req.url === '/rpc') return rpc(req, res)
    if (req.method !== 'GET') { res.statusCode = 405; return res.end() }
    const f = staticFile(ROOT, req.url)
    if (!f) { res.statusCode = 404; return res.end('not found') }
    res.setHeader('content-type', TYPES[path.extname(f)] || 'application/octet-stream')
    res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('x-frame-options', 'DENY')
    fs.createReadStream(f).pipe(res)
  }).listen(PORT, '127.0.0.1', () => console.log(`local ceremony on http://127.0.0.1:${PORT}/ (serving ${ROOT}); BUILD.txt lists the sha256 of every file`))
}
