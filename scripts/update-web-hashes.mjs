#!/usr/bin/env node
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let readme = fs.readFileSync(path.join(root,'web/README.md'),'utf8'), rows = []
for (const profile of ['mainnet','mainnet-local']) {
  execFileSync(process.execPath,[path.join(root,'web/build.mjs'),'--profile',profile],{stdio:'ignore'})
  const dir=path.join(root,'web',profile==='mainnet'?'dist':'dist-mainnet-local')
  for(const line of fs.readFileSync(path.join(dir,'BUILD.txt'),'utf8').split('\n')) {
    const m=/^([a-f0-9]{64})  (.+)$/.exec(line)
    if(m&&(m[2].endsWith('/app.js')||m[2]==='assets/style.css')) rows.push(`| \`${profile}\` | \`${m[2]}\` | \`${m[1]}\` |`)
  }
}
readme=readme.replace(/(?:^\| `(mainnet|mainnet-local)` \| `[^`]+` \| `[a-f0-9]{64}` \|\n)+/m,rows.join('\n')+'\n')
fs.writeFileSync(path.join(root,'web/README.md'),readme)
console.log('Both reviewed web profile hash tables refreshed.')
