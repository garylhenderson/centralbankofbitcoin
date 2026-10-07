/**
 * Generates web/src/generated/errors.json from the four programs' #[error_code]
 * enums (read only). Anchor numbers them from 6000 in declaration order. Each
 * message is rewritten for holders: no em dash (the house rule for holder copy).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SOURCES = { seal: 'programs/cbob-vaults/src/lib.rs', mint: 'programs/cbob-vault-mint/src/lib.rs',
  burn: 'programs/cbob-vault-burn/src/lib.rs', gov: 'programs/cbob-vault-gov/src/lib.rs' }

export function parseErrors(src) {
  const m = /#\[error_code\]\s*pub enum \w+\s*\{([\s\S]*?)\n\}/.exec(src)
  if (!m) throw new Error('no #[error_code] enum')
  const out = []
  const re = /#\[msg\("((?:[^"\\]|\\.)*)"\)\]\s*(\w+)\s*,/g
  let x
  while ((x = re.exec(m[1]))) out.push({ name: x[2], message: x[1].replace(/\\"/g, '"').replace(/\s*\u2014\s*/g, ': ') })
  // every variant line must have been consumed: count bare variants too
  const variants = m[1].split('\n').map(l => l.replace(/\/\/.*$/, '').trim()).filter(l => /\w+\s*,\s*$/.test(l) && !l.startsWith('//')).length
  if (variants !== out.length) throw new Error(`parsed ${out.length} messages but the enum has ${variants} variants`)
  return out
}

export function generate() {
  const out = {}
  for (const [k, f] of Object.entries(SOURCES)) out[k] = parseErrors(fs.readFileSync(path.join(ROOT, f), 'utf8'))
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.join(ROOT, 'web/src/generated')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'errors.json'), JSON.stringify(generate(), null, 1) + '\n')
  console.log('web/src/generated/errors.json written')
}
