#!/usr/bin/env node
// Bundle the reviewed Bank planners for Gary Club. Never compiles programs/dist.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
const require = createRequire(import.meta.url)
const esbuild = require('/home/ubuntu/luna-remotion/node_modules/esbuild')
if (esbuild.version !== '0.25.0') throw new Error('Review the adapter build before changing esbuild 0.25.0')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2]
if (!target || !path.isAbsolute(target)) throw new Error('Pass an absolute destination for club-engine.cjs')
// Keep the encoder and its implementation together. The host uses bs58 v6;
// externalizing this ESM import double-wraps its CommonJS default export.
const codecs = { name: 'bundle-base58', setup(build) {
  build.onResolve({ filter: /^[^./]/ }, args => {
    if (['bs58', 'base-x'].includes(args.path)) return
    return { path: args.path, external: true }
  })
} }
const built = await esbuild.build({ metafile: true, absWorkingDir: root, define: { 'import.meta.url': '""' }, entryPoints: [path.join(root, 'web/server/club-engine.mjs')], outfile: target, bundle: true, platform: 'node', format: 'cjs', target: 'node20', plugins: [codecs] })
// Fail closed if package resolution stops selecting the reviewed ESM codecs.
const expected = { bs58: '6.0.0', 'base-x': '5.0.1' }
for (const [name, version] of Object.entries(expected)) {
  const inputs = Object.keys(built.metafile.inputs).filter(p => p.includes(`/node_modules/${name}/`))
  if (inputs.length !== 1 || !inputs[0].endsWith('/src/esm/index.js')) throw new Error(`Unexpected ${name} codec resolution`)
  const pkg = JSON.parse(fs.readFileSync(path.resolve(root, path.dirname(inputs[0]), '../../package.json'), 'utf8'))
  if (pkg.version !== version) throw new Error(`Review ${name} ${pkg.version} before bundling it`)
}
const artifact = fs.readFileSync(target, 'utf8')
if (/require\(["'](?:bs58|base-x)["']\)|__toESM/.test(artifact)) throw new Error('Unexpected codec interop in adapter')
fs.writeFileSync(target, `// Reviewed codecs: bs58 6.0.0; base-x 5.0.1; esbuild 0.25.0.\n${artifact}`)
fs.writeFileSync(`${target}.sha256`, createHash('sha256').update(fs.readFileSync(target)).digest('hex') + '\n')
console.log('Built Gary Club adapter and checksum. No program binaries changed.')
