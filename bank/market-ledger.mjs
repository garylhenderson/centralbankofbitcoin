/** Read-only financial totals from authenticated MINT events. Never sends a transaction. */
import bs58 from 'bs58'
import { createHash } from 'node:crypto'
import { readParsedTransaction } from './txread.mjs'
const disc = name => createHash('sha256').update(`event:${name}`).digest().subarray(0, 8).toString('hex')
const EVENTS = { [disc('SolSweptForSwap')]: ['swept_lamports', 8, 56], [disc('Distributed')]: ['distributed_sats', 8, 49],
  [disc('Claimed')]: ['paid_sats', 20, 28], [disc('RevenueSplit')]: ['revenue_sats', 40, 66] }
export const emptyTotals = () => ({ swept_lamports: '0', distributed_sats: '0', paid_sats: '0', revenue_sats: '0' })
export const eventTotals = (tx, mint, paymentMintBytes) => financialEvents(tx, mint, paymentMintBytes).totals
export function financialEvents(tx, mint, paymentMintBytes) {
  const totals = emptyTotals()
  if (tx.meta?.err) return { totals, retirements: [] }
  if (!Array.isArray(tx.meta?.logMessages)) throw new Error('Financial event history has no logs')
  const frames = [], accepted = []
  for (const line of tx.meta.logMessages) {
    if (/Log truncated/i.test(line)) throw new Error('Financial event history was truncated')
    let m
    if ((m = /^Program (\w+) invoke \[(\d+)\]$/.exec(line))) {
      if (Number(m[2]) !== frames.length + 1) throw new Error('Financial event invocation depth is incomplete')
      frames.push({ program: m[1], events: [] }); continue
    }
    if ((m = /^Program (\w+) (success|failed.*)$/.exec(line))) {
      const f = frames.pop()
      if (!f || f.program !== m[1]) throw new Error('Financial event invocation stack is incomplete')
      if (m[2] === 'success') (frames.length ? frames.at(-1).events : accepted).push(...f.events)
      continue
    }
    if (!line.startsWith('Program data: ') || frames.at(-1)?.program !== mint) continue
    const raw = Buffer.from(line.slice(14), 'base64'), spec = EVENTS[raw.subarray(0, 8).toString('hex')]
    if (raw.subarray(0, 8).toString('hex') === disc('VaultRetired')) {
      if (raw.length !== 65 || raw[40] > 1) throw new Error('Retirement event layout changed')
      frames.at(-1).events.push(['retired', { asset: bs58.encode(raw.subarray(8, 40)), redeemed: !!raw[40], returned_sats: String(raw.readBigUInt64LE(41)) }]); continue
    }
    if (!spec) continue
    const [name, offset, length] = spec
    if (raw.length !== length) throw new Error('Financial event layout changed')
    if (name === 'revenue_sats' && !raw.subarray(8, 40).equals(paymentMintBytes)) continue
    frames.at(-1).events.push([name, raw.readBigUInt64LE(offset)])
  }
  if (frames.length) throw new Error('Financial event invocation did not finish')
  const retirements = []
  for (const [k, n] of accepted) { if (k === 'retired') retirements.push(n); else totals[k] = String(BigInt(totals[k]) + n) }
  return { totals, retirements }
}
/** Bounded resumable scan. The complete flag is false until the full gap is read.
 * Caller saves the returned state atomically. A failed read advances nothing.
 */
export async function scanLedger(conn, ids, paymentMint, previous = null) {
  const state = structuredClone(previous || { totals: emptyTotals(), head: null, before: null, nextHead: null, initialized: false })
  state.retirements ||= {}; state.gaps ||= {}
  // A transient RPC failure must not leave a permanent hole. Re-read a bounded
  // set of gaps; none of their totals were accepted on the earlier failed read.
  for (const signature of Object.keys(state.gaps).slice(0, 10)) {
    try {
      const tx = await readParsedTransaction(conn, signature)
      if (!tx) continue
      const read = financialEvents(tx, ids.MINT_PROG.toBase58(), paymentMint.toBuffer())
      for (const k of Object.keys(read.totals)) state.totals[k] = String(BigInt(state.totals[k]) + BigInt(read.totals[k]))
      for (const retirement of read.retirements) state.retirements[retirement.asset] = { ...retirement, signature, block_time: tx.blockTime }
      delete state.gaps[signature]
    } catch { /* Kept explicitly incomplete; retry next pass. */ }
  }
  const sigs = await conn.getSignaturesForAddress(ids.MINT_CFG, { limit: 1000, ...(state.before ? { before: state.before } : {}), ...(state.head ? { until: state.head } : {}) }, 'finalized')
  if (!state.before && sigs.length) state.nextHead = sigs[0].signature
  for (const s of sigs) {
    if (s.err) continue
    try {
      const tx = await readParsedTransaction(conn, s.signature)
      if (!tx) throw new Error('Financial history is not yet readable')
      const read = financialEvents(tx, ids.MINT_PROG.toBase58(), paymentMint.toBuffer())
      for (const k of Object.keys(read.totals)) state.totals[k] = String(BigInt(state.totals[k]) + BigInt(read.totals[k]))
      for (const retirement of read.retirements) state.retirements[retirement.asset] = { ...retirement, signature: s.signature, block_time: s.blockTime }
    } catch { state.gaps[s.signature] = 'unreadable events' }

  }
  const complete = sigs.length < 1000
  if (complete) { state.head = state.nextHead || state.head; state.nextHead = null; state.before = null; state.initialized = true }
  else state.before = sigs.at(-1).signature
  state.complete = complete
  return { state, financial: { coverage: Object.keys(state.gaps).length ? 'incomplete' : complete ? 'complete' : 'catching_up', ...(Object.keys(state.gaps).length ? { gaps: Object.keys(state.gaps) } : {}), ...(complete && !Object.keys(state.gaps).length ? state.totals : Object.fromEntries(Object.keys(state.totals).map(k => [k, null]))) } }
}
