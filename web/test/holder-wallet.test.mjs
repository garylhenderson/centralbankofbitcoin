import test from 'node:test'
import assert from 'node:assert/strict'
import {Keypair,Transaction,SystemProgram} from '@solana/web3.js'
import {getWallets} from '@wallet-standard/app'
import {choices,standardAdapter} from '../src/lib/holder-wallet.mjs'
import {signExact} from '../src/lib/tx.mjs'
const chain='solana:mainnet',key=Keypair.generate(),recipient=Keypair.generate().publicKey
function fixture() {
  const account={address:key.publicKey.toBase58(),publicKey:key.publicKey.toBytes(),chains:[chain],features:['solana:signTransaction']}
  let signed=0
  const wallet={name:'Synthetic wallet',version:'1.0.0',icon:'data:image/svg+xml;base64,',chains:[chain],accounts:[account],features:{
    'standard:connect':{version:'1.0.0',connect:async()=>({accounts:[account]})},
    'solana:signTransaction':{version:'1.0.0',supportedTransactionVersions:['legacy'],signTransaction:async input=>{
      signed++;assert.equal(input.chain,chain);assert.equal(input.account,account)
      const tx=Transaction.from(input.transaction);tx.partialSign(key)
      return [{signedTransaction:tx.serialize()}]
    }},
    'solana:signAndSendTransaction':{signAndSendTransaction:()=>{throw Error('Must never broadcast through the wallet')}}
  }}
  return {account,wallet,signed:()=>signed}
}
const tx=()=>new Transaction({feePayer:key.publicKey,recentBlockhash:recipient.toBase58()}).add(SystemProgram.transfer({fromPubkey:key.publicKey,toPubkey:recipient,lamports:1}))
test('standard wallet signs the exact requested transaction and never broadcasts',async()=>{
  const f=fixture(),adapter=standardAdapter(f.wallet,f.account,chain),want=tx(),message=want.serializeMessage()
  const got=await signExact(adapter,want)
  assert.deepEqual(got.serializeMessage(),message);assert.ok(got.verifySignatures());assert.equal(f.signed(),1)
})
test('account and chain validation refuse unsupported or changed ownership before signing',async()=>{
  const f=fixture()
  assert.throws(()=>standardAdapter(f.wallet,{...f.account,address:recipient.toBase58()},chain))
  assert.throws(()=>standardAdapter(f.wallet,f.account,'solana:devnet'))
  const adapter=standardAdapter(f.wallet,f.account,chain)
  for(const accounts of [[],[{...f.account,publicKey:recipient.toBytes()}],[{...f.account,chains:[]}],[{...f.account,features:[]}]]) {
    f.wallet.accounts=accounts;await assert.rejects(adapter.signTransaction(tx()),/account changed/)
  }
  assert.equal(f.signed(),0)
})
test('wallet discovery respects chain and legacy signing support',()=>{
  const f=fixture(),unregister=getWallets().register(f.wallet)
  try {assert.equal(choices({name:'mainnet'}).length,1);assert.equal(choices({name:'devnet'}).length,0)
    f.wallet.features['solana:signTransaction'].supportedTransactionVersions=[0];assert.equal(choices({name:'mainnet'}).length,0)
  } finally {unregister()}
})
test('wallet-added transfer or wrong response count cannot be signed as the reviewed action',async()=>{
  const f=fixture(),adapter=standardAdapter(f.wallet,f.account,chain)
  f.wallet.features['solana:signTransaction'].signTransaction=async({transaction})=>{
    const changed=Transaction.from(transaction);changed.instructions[0].data[4]=2;changed.partialSign(key)
    return [{signedTransaction:changed.serialize()}]
  }
  await assert.rejects(signExact(adapter,tx()),/wallet changed/)
  f.wallet.features['solana:signTransaction'].signTransaction=async()=>[]
  await assert.rejects(adapter.signTransaction(tx()),/unexpected transaction count/)
})
