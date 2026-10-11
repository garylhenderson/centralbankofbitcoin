import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

/** Read-only startup gate for the root-owned hosted artifact. */
export function verifyCeremonyBuild(root, commit, { requireRootOwned = true } = {}) {
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('A reviewed ceremony commit is required')
  if (fs.realpathSync(root) !== path.resolve(root)) throw new Error('Ceremony root may not contain symlinks')
  if (requireRootOwned && root !== `/opt/cbob-ceremony/${commit}/web/dist-mainnet-local`) throw new Error('Ceremony must serve its pinned artifact')
  const trusted = file => {
    const s = fs.lstatSync(file)
    if (s.isSymbolicLink() || (requireRootOwned && (s.uid !== 0 || (s.mode & 0o022)))) throw new Error('Ceremony artifact is not root-owned and read-only')
  }
  for (let dir = root; dir !== path.dirname(dir); dir = path.dirname(dir)) trusted(dir)
  trusted(path.join(root, 'BUILD.txt'))
  const manifest = fs.readFileSync(path.join(root, 'BUILD.txt'), 'utf8')
  if (!new RegExp(`^commit    ${commit}$`, 'm').test(manifest) || !/^profile   mainnet-local$/m.test(manifest)) throw new Error('Ceremony build identity differs')
  const rows = [...manifest.matchAll(/^([a-f0-9]{64})  (.+)$/gm)]
  const files = new Set()
  for (const [, hash, rel] of rows) {
    if (files.has(rel) || rel.includes('..') || path.isAbsolute(rel)) throw new Error('Invalid ceremony manifest path')
    files.add(rel)
    const file = path.join(root, rel)
    if (fs.realpathSync(file) !== file) throw new Error('Ceremony file may not contain symlinks')
    trusted(path.dirname(file)); trusted(file)
    if (createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== hash) throw new Error('Ceremony file differs from manifest')
  }
  const apps = [...files].filter(x => /^ceremony-[a-f0-9]+\/app.js$/.test(x))
  if (apps.length !== 1 || !files.has(apps[0].replace('app.js', 'index.html')) || !files.has('assets/style.css')) throw new Error('Ceremony manifest is incomplete')
  const readmePath = path.resolve(root, '../README.md')
  trusted(readmePath)
  const readme = fs.readFileSync(readmePath, 'utf8')
  for (const rel of [apps[0], 'assets/style.css']) {
    const row = rows.find(x => x[2] === rel)
    if (!readme.includes(`| \`mainnet-local\` | \`${rel}\` | \`${row[1]}\` |`)) throw new Error('Ceremony differs from reviewed fingerprint')
  }
  if (!/^Pin review: /m.test(readme)) throw new Error('Ceremony fingerprint has no review record')
  return { commit, files: files.size, app: apps[0] }
}
