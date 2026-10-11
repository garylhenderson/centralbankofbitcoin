#!/usr/bin/env node
// Deterministic CSP and asset integrity for the committed, read-only documents.
// --write makes a reviewable source diff; default checks without changing files.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
const root = new URL('../web/site/', import.meta.url), write = process.argv.includes('--write')
const hash = (data, algorithm = 'sha384') => createHash(algorithm).update(data).digest('base64')
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])
let changed = 0
for (const file of walk(root.pathname).filter(f => f.endsWith('.html'))) {
  const old = fs.readFileSync(file, 'utf8')
  let html = old.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/gi, '')
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m => !/\bsrc=/.test(m[1])).map(m => `'sha256-${hash(m[2], 'sha256')}'`)
  const csp = `default-src 'none'; script-src 'self' ${scripts.join(' ')}; style-src 'self'${/<style\b|\sstyle=/i.test(html) ? " 'unsafe-inline'" : ''}; img-src 'self' https://cdn.gary.club; media-src https://cdn.gary.club; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'`
  html = html.replace(/<meta charset="utf-8">\s*/i, () => '<meta charset="utf-8">' + `\n<meta http-equiv="Content-Security-Policy" content="${csp}">`)
  for (const name of ['ecosystem-nav.css', 'bank-home.js']) {
    const src = fs.readFileSync(new URL(`assets/${name}`, root)), version = createHash('sha256').update(src).digest('hex').slice(0, 12)
    const attr = name.endsWith('.css') ? 'href' : 'src'
    html = html.replace(new RegExp(`${attr}="/assets/${name.replace('.', '\\.')}[^\"]*"(?: integrity="[^\"]*")?`, 'g'), `${attr}="/assets/${name}?v=${version}" integrity="sha384-${hash(src)}"`)
  }
  if (!html.includes('name="theme-color"')) html = html.replace('</head>', '<meta name="theme-color" content="#f8f1e2">\n</head>')
  if (html !== old) { changed++; if (write) fs.writeFileSync(file, html); else console.error(path.relative(root.pathname, file) + ': needs CSP/integrity refresh') }
}
console.log(`${changed} static documents ${write ? 'prepared for review' : 'differ'}`)
if (changed && !write) process.exitCode = 1
