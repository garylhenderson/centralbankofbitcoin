/** Untrusted public snapshots never authorize purchases. Expired asks are removed locally. */
const asset = s => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)
const price = s => typeof s === 'string' && /^[1-9][0-9]{0,14}$/.test(s)
const time = n => Number.isSafeInteger(n) && n > 0
export function marketBook(data, now = Math.floor(Date.now()/1000)) {
  const unavailable = { available:false, fresh:false, enabled:false, listings:new Map(), offers:new Map(), sales:[], at:null, partial:true }
  if (!data || data.version!==1 || !time(data.generated_at) || data.generated_at>now+30 || typeof data.trading_enabled!=='boolean' || typeof data.sales_partial!=='boolean' || data.sales_limit!==200 || !Array.isArray(data.listings) || data.listings.length>5000 || !Array.isArray(data.offers) || data.offers.length>5000 || !Array.isArray(data.sales) || data.sales.length>200) return unavailable
  const listings = new Map(), offers = new Map(), signatures = new Set()
  let offerTotal = 0
  for (const l of data.listings) {
    if (!asset(l.asset) || !price(l.price_lamports) || !time(l.expires_at) || listings.has(l.asset)) return unavailable
    listings.set(l.asset,l)
  }
  for (const o of data.offers) {
    if (!asset(o.asset) || offers.has(o.asset) || !Array.isArray(o.expires_at) || !o.expires_at.every(time)) return unavailable
    offerTotal += o.expires_at.length
    if (offerTotal>5000) return unavailable
    offers.set(o.asset,o.expires_at.filter(t=>t>now).length)
  }
  for (const s of data.sales) {
    if (!asset(s.asset) || !price(s.price_lamports) || !time(s.sold_at) || s.sold_at>data.generated_at+30 || typeof s.signature!=='string' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(s.signature) || signatures.has(s.signature)) return unavailable
    signatures.add(s.signature)
  }
  const fresh = now-data.generated_at<=1800
  for (const [key,l] of listings) if (!fresh || l.expires_at<=now) listings.delete(key)
  if (!fresh) offers.clear()
  return { available:true, fresh, enabled:data.trading_enabled && fresh, listings, offers, sales:[...data.sales].sort((a,b)=>b.sold_at-a.sold_at), at:data.generated_at, partial:data.sales_partial }
}
export function marketVaults(vaults, book) {
  return vaults.map(v=>({...v, listing:v.status==='opened'?null:book.listings.get(v.asset)||null, offer_count:v.status==='opened'?0:book.offers.get(v.asset)||0}))
}
export function levelFloors(vaults) {
  return [1,2,3,4,5].map(level=>{
    const asks=vaults.filter(v=>v.level===level&&v.status!=='opened'&&v.listing).map(v=>v.listing.price_lamports)
    return {level,count:asks.length,price:asks.reduce((a,b)=>a===null||BigInt(b)<BigInt(a)?b:a,null)}
  })
}
export function compareAsks(a,b) {
  if (!a.listing) return b.listing?1:a.no-b.no
  if (!b.listing) return -1
  const diff=BigInt(a.listing.price_lamports)-BigInt(b.listing.price_lamports)
  return diff<0n?-1:diff>0n?1:a.no-b.no
}
export function exactSol(raw) {
  if(!price(raw))return 'Unavailable'
  const n=BigInt(raw), fraction=String(n%1000000000n).padStart(9,'0').replace(/0+$/,'')
  return `${(n/1000000000n).toLocaleString('en-US')}${fraction?'.'+fraction:''} SOL`
}

export const receiptLink = signature => /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature) ? `https://explorer.solana.com/tx/${signature}` : '/market/'
