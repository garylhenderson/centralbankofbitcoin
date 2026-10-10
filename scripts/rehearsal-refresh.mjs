#!/usr/bin/env node
/**
 * A KEY-PRESERVING REFRESH OF A REHEARSAL TREE (round 46).
 *
 * scripts/rehearsal-tree.sh makes a rehearsal tree; the old refresh helper made a
 * new one by REMOVING the worktree, which deletes every throwaway key and state
 * file inside it. Once a dress rehearsal has started, those keys hold value (role
 * SOL, the throwaway deployer that is the rehearsal programs' upgrade authority,
 * the program keypairs), so that refresh must never run then.
 *
 * This one moves the tree to a new commit IN PLACE and loses nothing:
 *   1. the tree must be the recorded rehearsal tree: its tracked changes are
 *      exactly its .rehearsal-files, and each reverses to its HEAD under the map;
 *   2. it snapshots EVERY untracked and ignored path outside the build caches
 *      (target/ except its deploy keypairs, node_modules, web/dist*), symlinks as
 *      links: .rehearsal-keys/*, bank/keys/*, .rehearsal-run/, the filled values,
 *      the .cache link, any backup tarball;
 *   3. it restores the patched files to HEAD, checks out the new commit (git
 *      refuses rather than overwrite an untracked file), and re-applies the SAME
 *      recorded map, with rehearsal-tree.sh's own proof (the reverse recreates the
 *      new HEAD byte for byte, the keyed programs and layout are patched, no
 *      abbreviated mainnet id is left);
 *   4. it rewrites the record (commit, patch sha256, files) and REQUIRES every
 *      snapshotted path to be byte-identical afterwards, or it exits non-zero.
 *
 *   node scripts/rehearsal-refresh.mjs --tree <rehearsal tree> [--repo <release repo>] [--to <commit>]
 *
 * It never builds, deploys or sends anything.
 */
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const sha = b => createHash('sha256').update(b).digest('hex')
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' })
export const PATCH_SCOPE = ['programs', 'bank', 'scripts', 'tests', 'sim', 'launch', 'Anchor.toml']
export const MUST_PATCH = ['programs/cbob-vaults/src/lib.rs', 'programs/cbob-vault-mint/src/lib.rs', 'programs/cbob-vault-burn/src/lib.rs', 'programs/cbob-vault-gov/src/lib.rs', 'bank/layout.mjs']

/** The paths a refresh must keep: untracked or ignored, outside the build caches. */
export const REWRITTEN = ['REHEARSAL-RECORD.txt', '.rehearsal-sha', '.rehearsal-files']   // the record a refresh rewrites by design; .rehearsal-map is KEPT
export const keepPath = p => !REWRITTEN.includes(p) && !/^(node_modules|web\/dist[^/]*)(\/|$)/.test(p) && (!/^target\//.test(p) || /^target\/deploy\/[^/]+-keypair\.json$/.test(p))

/** Every kept path, with what it IS (a link's target, or a file's sha256). */
export function snapshot(tree, list) {
  const out = {}
  for (const rel of list) {
    const f = path.join(tree, rel)
    let st; try { st = fs.lstatSync(f) } catch { continue }
    out[rel] = st.isSymbolicLink() ? `link:${fs.readlinkSync(f)}` : st.isFile() ? `sha256:${sha(fs.readFileSync(f))}` : null
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v))
}
/** Whatever differs between two snapshots: a path dropped or changed. Empty = kept. */
export function judgeKept(before, after) {
  const bad = []
  for (const [k, v] of Object.entries(before)) {
    if (!(k in after)) bad.push(`${k} was LOST`)
    else if (after[k] !== v) bad.push(`${k} CHANGED`)
  }
  return bad
}
/** Untracked + ignored paths git reports (directories expanded, symlinks as paths). */
export function untracked(tree) {
  const raw = git(tree, 'ls-files', '--others', '-z').split('\0').filter(Boolean)
  const all = []
  const walk = rel => { const f = path.join(tree, rel), st = fs.lstatSync(f)
    if (st.isDirectory() && !st.isSymbolicLink()) for (const x of fs.readdirSync(f)) walk(path.join(rel, x)); else all.push(rel) }
  for (const r of raw) { if (!keepPath(r)) continue; try { walk(r.replace(/\/$/, '')) } catch { /* vanished */ } }
  return all.filter(keepPath)
}
export const readMap = tree => fs.readFileSync(path.join(tree, '.rehearsal-map'), 'utf8').split('\n').filter(l => l.trim()).map(l => l.split(/\s+/).slice(0, 2))
const reverse = (text, pairs) => { let t = text; for (const [o, n] of pairs) t = t.split(n).join(o); return t }
const forward = (text, pairs) => { let t = text; for (const [o, n] of pairs) t = t.split(o).join(n); return t }

/** Apply the map to the checked-out HEAD and prove it, as rehearsal-tree.sh does. */
export function applyMap(tree, pairs) {
  const olds = pairs.map(p => p[0]), news = pairs.map(p => p[1])
  for (const a of [...olds, ...news]) for (const b of [...olds, ...news]) if (a !== b && b.includes(a)) throw new Error(`map key ${a} is inside ${b}; the reverse would be ambiguous`)
  const files = git(tree, 'ls-files', '--', ...PATCH_SCOPE).split('\n').filter(Boolean)
  const changed = [], h = createHash('sha256')
  for (const f of files) {
    let src; try { src = fs.readFileSync(path.join(tree, f), 'utf8') } catch { continue }
    if (Buffer.from(src, 'utf8').compare(fs.readFileSync(path.join(tree, f))) !== 0) continue   // not text
    if (news.some(n => src.includes(n))) throw new Error(`${f} already contains a throwaway id or the rehearsal path`)
    const out = forward(src, pairs)
    if (reverse(out, pairs) !== src) throw new Error(`${f} does not reverse to HEAD`)
    if (out !== src) { fs.writeFileSync(path.join(tree, f), out); changed.push(f); h.update(f); h.update(out) }
  }
  const diff = git(tree, 'diff', '--name-only').split('\n').filter(Boolean).sort()
  if (JSON.stringify(diff) !== JSON.stringify([...changed].sort())) throw new Error(`git sees ${diff.join(',')} changed, not ${changed.join(',')}`)
  for (const f of diff) if (Buffer.from(reverse(fs.readFileSync(path.join(tree, f), 'utf8'), pairs)).compare(execFileSync('git', ['-C', tree, 'show', `HEAD:${f}`])) !== 0) throw new Error(`${f} is not HEAD under the reverse map`)
  for (const f of files) { let now; try { now = fs.readFileSync(path.join(tree, f), 'utf8') } catch { continue }
    for (const [o] of pairs.slice(0, -1)) if (now.includes(o.slice(0, 4))) throw new Error(`${f} still holds '${o.slice(0, 4)}', an abbreviated mainnet id`) }
  return { changed, patchSha: h.digest('hex') }
}

export function refresh({ tree, repo, to = null, log = () => {} }) {
  if (!fs.existsSync(path.join(tree, 'REHEARSAL-RECORD.txt'))) throw new Error(`${tree} is not a recorded rehearsal tree`)
  const pairs = readMap(tree)
  const recorded = fs.readFileSync(path.join(tree, '.rehearsal-files'), 'utf8').split('\n').filter(Boolean).sort()
  // 1. the tree is exactly the recorded patch of its HEAD
  const diff = git(tree, 'diff', '--name-only').split('\n').filter(Boolean).sort()
  if (JSON.stringify(diff) !== JSON.stringify(recorded)) throw new Error(`the tree's tracked changes (${diff.join(',')}) are not its recorded patch (${recorded.join(',')}): refusing`)
  for (const f of diff) if (Buffer.from(reverse(fs.readFileSync(path.join(tree, f), 'utf8'), pairs)).compare(execFileSync('git', ['-C', tree, 'show', `HEAD:${f}`])) !== 0) throw new Error(`${f} is not the recorded patch of HEAD: refusing`)
  // always the FULL id: the driver reads `source commit` as 40 hex and refuses anything
  // shorter (2026-10-10: `--to 0b8a204` wrote a short id and the resume was refused)
  const target = git(repo, 'rev-parse', '--verify', `${to || 'HEAD'}^{commit}`).trim()
  if (!/^[0-9a-f]{40}$/.test(target)) throw new Error(`cannot resolve ${to} to a full commit id`)
  // 2. everything to keep
  const before = snapshot(tree, untracked(tree))
  log(`keeping ${Object.keys(before).length} untracked paths`)
  // a path the new commit TRACKS where this tree holds an untracked file would stop
  // the checkout half way: refuse BEFORE anything is touched
  const tracked = new Set(git(repo, 'ls-tree', '-r', '--name-only', target).split('\n').filter(Boolean))
  const clash = Object.keys(before).filter(k => tracked.has(k))
  if (clash.length) throw new Error(`the commit ${target.slice(0, 7)} tracks ${clash.join(', ')}, which this tree keeps untracked: refusing before anything is touched`)
  // 3. restore, move, re-apply the SAME map
  git(tree, 'checkout', '-q', '--', ...recorded)
  git(tree, 'checkout', '-q', '--detach', target)
  const { changed, patchSha } = applyMap(tree, pairs)
  for (const need of MUST_PATCH) if (!changed.includes(need)) throw new Error(`${need} was not patched; the map is incomplete`)
  fs.writeFileSync(path.join(tree, '.rehearsal-files'), changed.join('\n') + '\n')
  fs.writeFileSync(path.join(tree, '.rehearsal-sha'), patchSha)
  const rec = fs.readFileSync(path.join(tree, 'REHEARSAL-RECORD.txt'), 'utf8')
  const mapLines = rec.split('\n').filter(l => /^  \S+ \S+ \S+$/.test(l) && !l.includes('/'))
  const rootLine = rec.split('\n').find(l => /^  \S+ \S+ root$/.test(l))
  fs.writeFileSync(path.join(tree, 'REHEARSAL-RECORD.txt'), [
    'REHEARSAL TREE — NOT THE SHIPPED CODE', `source commit  ${target}`, `made           ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}`,
    `patch sha256   ${patchSha}`, `refreshed      in place by scripts/rehearsal-refresh.mjs (keys and state kept byte for byte)`,
    'id map (mainnet -> rehearsal):', ...mapLines, ...(rootLine ? [rootLine] : []), 'files patched:', ...changed.map(f => `  ${f}`), ''].join('\n'))
  // 4. nothing lost, nothing changed
  const after = snapshot(tree, Object.keys(before))
  const bad = judgeKept(before, after)
  if (bad.length) throw new Error(`KEYS OR STATE WERE NOT KEPT: ${bad.join('; ')}`)
  return { commit: target, kept: Object.keys(before).length, changed: changed.length, patchSha }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null }
  const tree = arg('--tree'), repo = arg('--repo') || ['', 'opt', 'cbob-vaults'].join('/')
  if (!tree) { console.error('usage: node scripts/rehearsal-refresh.mjs --tree <rehearsal tree> [--repo <repo>] [--to <commit>]'); process.exit(2) }
  try {
    const r = refresh({ tree: path.resolve(tree), repo, to: arg('--to'), log: m => console.log(`  ${m}`) })
    console.log(`REFRESHED to ${r.commit}: ${r.changed} files patched under the SAME map, patch sha256 ${r.patchSha}; ${r.kept} untracked paths kept byte for byte`)
  } catch (e) { console.error(`FATAL: ${e.message}`); process.exit(1) }
}
