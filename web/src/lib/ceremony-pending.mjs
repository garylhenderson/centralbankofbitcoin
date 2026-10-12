import {PublicKey} from '@solana/web3.js'
import bs58 from 'bs58'
import {collectionFromReceipt} from './ceremony-reads.mjs'

export function readPending(storage,key) {
  const raw=storage.getItem(key)
  if(!raw)return null
  const record=JSON.parse(raw)
  new PublicKey(record.collection)
  if(!Number.isSafeInteger(record.lastValidBlockHeight)||record.lastValidBlockHeight<1)throw Error('The saved step-0 validity window is unreadable. Recover using the independent receipt.')
  if(record.signature!==null&&(typeof record.signature!=='string'||bs58.decode(record.signature).length!==64))throw Error('The saved step-0 signature is unreadable. Recover using the independent receipt.')
  return record
}
export function writePending(storage,key,record) {
  storage.setItem(key,JSON.stringify(record))
  if(JSON.stringify(readPending(storage,key))!==JSON.stringify(record))throw Error('The browser could not save the pending step-0 receipt. Nothing was sent.')
}

/** Browser state is only a hint. A landed collection needs the exact finalized
 * receipt. A new attempt needs finalized expiry AND absence of its account. */
export async function pendingVerdict(conn,ids,authority,record) {
  if(record.signature) {
    const status=(await conn.getSignatureStatuses([record.signature],{searchTransactionHistory:true})).value[0]
    if(status?.confirmationStatus==='finalized') {
      if(status.err)return {state:'clear',reason:'The earlier step-0 transaction failed on chain.'}
      const creator=await collectionFromReceipt(conn,ids,record.collection,authority,record.signature)
      if(creator.by!=='launch')throw Error('The saved step-0 receipt could not be verified. Use the independent receipt recovery controls.')
      return {state:'landed',receipt:{collection:record.collection,signature:record.signature}}
    }
    if(status)return {state:'waiting'}
  }
  const height=await conn.getBlockHeight('finalized')
  if(height<=record.lastValidBlockHeight)return {state:'waiting'}
  // Even a dusted address stays blocked until it can be reviewed. Never infer
  // that an unknown signature failed when its collection account exists.
  if(await conn.getAccountInfo(new PublicKey(record.collection),'finalized'))return {state:'waiting'}
  return {state:'clear',reason:'The earlier step-0 transaction expired without creating its collection.'}
}
