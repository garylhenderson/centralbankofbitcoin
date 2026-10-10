#!/usr/bin/env node
// Bundle the reviewed Bank planners for Gary Club. Never compiles programs/dist.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
const require = createRequire(import.meta.url)
const esbuild = require('/home/ubuntu/luna-remotion/node_modules/esbuild')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2]
if (!target || !path.isAbsolute(target)) throw new Error('Pass an absolute destination for club-engine.cjs')
await esbuild.build({ absWorkingDir: root, define: { 'import.meta.url': '""' }, entryPoints: [path.join(root, 'web/server/club-engine.mjs')], outfile: target, bundle: true, platform: 'node', format: 'cjs', target: 'node20', packages: 'external' })
fs.writeFileSync(`${target}.sha256`, createHash('sha256').update(fs.readFileSync(target)).digest('hex') + '\n')
console.log('Built Gary Club adapter and checksum. No program binaries changed.')
