import {createHash} from 'node:crypto'
import {parseMint,parseTokenAccount,parseCoreCollection} from '../web/src/lib/decode.mjs'

// Compare authority/configuration bytes. Permissionless balance and supply
// changes between finalized slots cannot change the ceremony's immutable values.
export function stableSetupAccount(account, kind='config') {
  if (!account) return null
  const data=Buffer.from(account.data)
  if(kind==='mint') { parseMint(data); data.fill(0,36,44) }
  if(kind==='token') { parseTokenAccount(data); data.fill(0,64,72) }
  if(kind==='collection') {
    parseCoreCollection(data)
    const uriOffset=37+data.readUInt32LE(33)
    const countsOffset=uriOffset+4+data.readUInt32LE(uriOffset)
    data.fill(0,countsOffset,countsOffset+8)
  }
  return {owner:account.owner.toBase58(),executable:account.executable,data:createHash('sha256').update(data).digest('hex')}
}

export function programFailureCheck(error) {
  if(error?.message==='Independent providers disagree') return 'independent program bytes and authority agreement'
  if(error?.message==='Bank program differs from audited build') return 'independent audited program bytes'
  if(['Wrong genesis','Invalid program','Invalid ProgramData owner','Missing program bytes'].includes(error?.message)) return 'independent program identity'
  return 'independent program network or configuration read'
}
