/**
 * A LOCAL-ONLY STAND-IN FOR DAS, for the dress-rehearsal driver's local proof
 * (sim/rehearsal-local.sh). It is NOT DAS and proves nothing about DAS: item 22.5
 * (whether DAS sets `burnt` on a burned Core asset) is a mainnet read only.
 *
 * A local validator has no DAS, and the alarm lists every vault through
 * `getAssetsByGroup`, so without this it cannot complete one pass locally. This
 * proxy forwards every JSON-RPC call (and the websocket port) to the validator
 * unchanged, and answers `getAssetsByGroup` / `getAsset` from Core accounts read
 * off that same validator: live assets by their collection field, and assets it
 * has seen before that are now one-byte tombstones as `burnt: true` (DAS keeps a
 * burned asset in its group; a tombstone no longer names its collection).
 * Round 46: also `getAssetsByOwner` (the holder pages' "show my vaults"), from live
 * Core assets by their owner field. The pages verify every one on chain anyway.
 *
 *   node sim/das-shim.mjs <listenPort> <validatorRpcPort>     (ws: each + 1)
 */
import http from 'http'
import net from 'net'
import bs58 from 'bs58'

const [listen, upstream] = process.argv.slice(2).map(Number)
const UP = `http://127.0.0.1:${upstream}`
const CORE = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
const seen = new Map()   // asset -> collection, for assets later burned

const rpc = async (method, params) => (await (await fetch(UP, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result

async function group(collection) {
  const live = await rpc('getProgramAccounts', [CORE, { encoding: 'base64', filters: [{ memcmp: { offset: 0, bytes: bs58.encode(Buffer.from([1])) } },
    { memcmp: { offset: 33, bytes: bs58.encode(Buffer.from([2])) } }, { memcmp: { offset: 34, bytes: collection } }] }])
  const items = live.map(a => { const d = Buffer.from(a.account.data[0], 'base64'); seen.set(a.pubkey, collection)
    return { id: a.pubkey, burnt: false, ownership: { owner: bs58.encode(d.subarray(1, 33)) } } })
  const gone = [...seen].filter(([id, c]) => c === collection && !items.some(i => i.id === id)).map(([id]) => id)
  if (gone.length) {
    const infos = await rpc('getMultipleAccounts', [gone, { encoding: 'base64' }])
    infos.value.forEach((a, k) => { const d = a && Buffer.from(a.data[0], 'base64')
      if (d && a.owner === CORE && d.length === 1 && d[0] === 0) items.push({ id: gone[k], burnt: true, ownership: { owner: null } }) })
  }
  return items
}

async function byOwner(owner) {
  const live = await rpc('getProgramAccounts', [CORE, { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, filters: [{ memcmp: { offset: 0, bytes: bs58.encode(Buffer.from([1])) } },
    { memcmp: { offset: 1, bytes: owner } }] }])
  return live.map(a => ({ id: a.pubkey, interface: 'MplCoreAsset', burnt: false, compression: { compressed: false }, ownership: { owner } }))
}

http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c
  let j; try { j = JSON.parse(body) } catch { j = null }
  if (j && !Array.isArray(j) && (j.method === 'getAssetsByGroup' || j.method === 'getAsset' || j.method === 'getAssetsByOwner')) {
    try {
      let result
      if (j.method === 'getAssetsByGroup') { const p = j.params; const all = await group(p.groupValue); const lim = p.limit || 1000, pg = p.page || 1
        result = { total: all.length, limit: lim, page: pg, items: all.slice((pg - 1) * lim, pg * lim) } }
      else if (j.method === 'getAssetsByOwner') { const p = j.params; const all = await byOwner(p.ownerAddress); const lim = p.limit || 1000, pg = p.page || 1
        result = { total: all.length, limit: lim, page: pg, items: all.slice((pg - 1) * lim, pg * lim) } }
      else { const id = j.params.id, a = (await rpc('getAccountInfo', [id, { encoding: 'base64' }]))?.value
        const d = a && Buffer.from(a.data[0], 'base64')
        result = !a ? null : { id, burnt: d.length === 1 && d[0] === 0, ownership: { owner: d.length > 33 ? bs58.encode(d.subarray(1, 33)) : null } } }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result }))
    } catch (e) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, error: { code: -32000, message: `das-shim: ${e.message}` } })) }
    return
  }
  const up = await fetch(UP, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  res.writeHead(up.status, { 'Content-Type': 'application/json' }); res.end(Buffer.from(await up.arrayBuffer()))
}).listen(listen, '127.0.0.1')
// the websocket port, byte for byte (subscriptions for confirmations)
net.createServer(s => { const u = net.connect(upstream + 1, '127.0.0.1'); s.pipe(u).pipe(s); s.on('error', () => u.destroy()); u.on('error', () => s.destroy()) }).listen(listen + 1, '127.0.0.1')
console.log(`das-shim on ${listen} (ws ${listen + 1}) -> validator ${upstream}`)
