/**
 * REHEARSAL-ONLY OVERRIDES (SPEC road step 8, item 22).
 *
 * The dress rehearsal runs the shipped jobs (crank, alarm, revenue) unchanged
 * against throwaway program ids, so it must be able to point them at a rehearsal
 * RPC, a rehearsal-only notice log, and the two
 * forced failures item 22 names (Orca refusing once; a cycle failing after its
 * sweep). Those knobs are dangerous in production, so each one is honoured ONLY
 * inside a recorded rehearsal tree: scripts/rehearsal-tree.sh writes
 * REHEARSAL-RECORD.txt at the tree's root, production never has one, and the
 * cron installer refuses a tree that does.
 *
 * Outside such a tree a SET override is REFUSED with an error, never ignored: a
 * job that silently ran on the production RPC while someone believed it pointed
 * at a test validator would be the worse failure. Unset, every job behaves
 * exactly as before.
 */
import fs from 'fs'
import { fileURLToPath } from 'url'

export const REHEARSAL_RECORD = fileURLToPath(new URL('../REHEARSAL-RECORD.txt', import.meta.url))
export const inRehearsalTree = (record = REHEARSAL_RECORD) => fs.existsSync(record)

/** The override's value, or `fallback` when unset. Throws if set outside a rehearsal tree. */
export function rehearsalOnly(name, fallback, { env = process.env, inTree = inRehearsalTree() } = {}) {
  const v = env[name]
  if (v === undefined || v === '') return fallback
  if (!inTree) throw new Error(`${name} is a rehearsal-only override and this is not a recorded rehearsal tree (no REHEARSAL-RECORD.txt): refusing to run`)
  return v
}

/** A rehearsal-only switch: true only when set to exactly '1' inside a rehearsal tree. */
export const rehearsalFlag = (name, opts) => rehearsalOnly(name, '', opts) === '1'

/** EVERY rehearsal-only override, by name (round 45, V45o-2). The two forced
 *  failures used to be read only where they act, after the sweep had already
 *  moved SOL, so outside a rehearsal tree a stray one was refused too late and
 *  left a production cycle open. A job calls this at load, before it reads or
 *  sends anything: a SET override outside a recorded tree stops the job there. */
export const REHEARSAL_OVERRIDES = ['CBOB_REHEARSAL_RPC', 'CBOB_REHEARSAL_NOTIFY', 'CBOB_REHEARSAL_FAIL_AFTER_SWEEP', 'CBOB_REHEARSAL_FORCE_ORCA_REFUSAL']
export function refuseStrayOverrides(opts) { for (const n of REHEARSAL_OVERRIDES) rehearsalOnly(n, '', opts) }

/** The RPC URL the jobs use: the mainnet provider from the box's env file, unless
 *  a rehearsal points them elsewhere (CBOB_REHEARSAL_RPC). */
export function jobRpc(readEnvFile = () => fs.readFileSync('/opt/gary-club/.env.local', 'utf8'), opts) {
  const o = rehearsalOnly('CBOB_REHEARSAL_RPC', '', opts)
  if (o) return o
  const m = readEnvFile().match(/^HELIUS_RPC_URL=(.*)$/m)
  if (!m) throw new Error('HELIUS_RPC_URL not found in /opt/gary-club/.env.local')
  return m[1].trim()
}
