// Read-only, independently observed program identities. No signing keys or sends.
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {Connection,PublicKey} from '@solana/web3.js'
import {profile} from '../web/src/config.js'
import {parseProgramData} from '../web/src/lib/decode.mjs'
import {judgeProgramBytes} from '../web/src/lib/plan-ceremony.mjs'
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
export function providerRpc() {
 const raw=fs.readFileSync('/etc/cbob/rpc-proxy.env','utf8').match(/^CBOB_RPC_UPSTREAM=(.*)$/m)?.[1]?.trim()
 const value=raw?.replace(/^(['"])(.*)\1$/,'$2')
 if(!value||new URL(value).protocol!=='https:')throw new Error('Dedicated provider RPC is not configured')
 return value
}
export function readConnection(url) {
 return new Connection(url,{commitment:'finalized',disableRetryOnRateLimit:true,fetch:(u,opts)=>fetch(u,{...opts,signal:AbortSignal.timeout(30000)})})
}
export async function programObservation(conn) {
 const p=profile('mainnet'), names=['core',...Object.keys(p.programs)],addresses=[p.core,...Object.values(p.programs)]
 const genesis=await conn.getGenesisHash()
 if(genesis!==p.expectedGenesisHash)throw new Error('Wrong genesis')
 const programs=await conn.getMultipleAccountsInfoAndContext(addresses.map(a=>new PublicKey(a)),{commitment:'finalized'})
 const loader='BPFLoaderUpgradeab1e11111111111111111111111'
 const dataAddresses=programs.value.map(a=>{if(!a?.executable||a.owner.toBase58()!==loader||a.data.readUInt32LE(0)!==2)throw new Error('Invalid program');return new PublicKey(a.data.subarray(4,36))})
 const data=await conn.getMultipleAccountsInfoAndContext(dataAddresses,{commitment:'finalized',minContextSlot:programs.context.slot})
 const identities={}
 for(let i=0;i<names.length;i++){
  const a=data.value[i]
  if(!a||a.owner.toBase58()!==loader)throw new Error('Invalid ProgramData owner')
  const pd=parseProgramData(a.data)
  if(pd.elf.subarray(0,4).toString('hex')!=='7f454c46')throw new Error('Missing program bytes')
  if(names[i]!=='core'&&judgeProgramBytes(pd,p.programBytes[names[i]],sha).length)throw new Error('Bank program differs from audited build')
  identities[names[i]]={program:addresses[i],programdata:dataAddresses[i].toBase58(),upgrade_slot:Number(a.data.readBigUInt64LE(4)),upgrade_authority:pd.upgradeAuthority?.toString()||null,bytes:pd.elf.length,sha256:sha(pd.elf)}
 }
 return {genesis,observed_slot:data.context.slot,identities}
}
export async function independentPrograms() {
 const first=await programObservation(readConnection(providerRpc()))
 const second=await programObservation(readConnection('https://api.mainnet-beta.solana.com'))
 if(first.genesis!==second.genesis||JSON.stringify(first.identities)!==JSON.stringify(second.identities))throw new Error('Independent providers disagree')
 return {...first,second_observed_slot:second.observed_slot,providers:['dedicated provider','Solana public mainnet']}
}
