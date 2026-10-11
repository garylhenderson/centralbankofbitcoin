import { assertStableMint, consistentSnapshot } from '../../bank/vault-index.mjs'
import { harness } from './ref.mjs'
const H = harness('public-data')
let reads = 0
const result = await consistentSnapshot(async () => {
  const before = { charter_claimed: BigInt(++reads), active_count: 0n }
  const after = { ...before, charter_claimed: before.charter_claimed + (reads < 3 ? 1n : 0n) }
  assertStableMint(before, after)
  return after.charter_claimed
})
H.eq('a claim changing MintConfig causes a new complete read', reads, 3)
H.eq('only the stable snapshot is returned for publication', result, 3n)
reads = 0
let code = null
try { await consistentSnapshot(async () => { reads++; assertStableMint({dist_epoch:0n},{dist_epoch:1n}) }) } catch(e) { code=e.code }
H.eq('a continuously changing snapshot stops after four attempts', reads, 4)
H.eq('retry exhaustion refuses publication', code, 'CBOB_SNAPSHOT_CHANGED')
reads = 0
try { await consistentSnapshot(async () => { reads++; throw new Error('Invalid account owner') }) } catch {}
H.eq('invalid account reads are never hidden by snapshot retries', reads, 1)
export default H.done()
