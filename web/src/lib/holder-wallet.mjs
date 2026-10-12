// Holder wallet chooser. Ceremony continues to use its reviewed Phantom adapter.
import {PublicKey,Transaction} from '@solana/web3.js'
import {getWallets} from '@wallet-standard/app'
import {provider as phantomProvider,isPhone,openInPhantomLink} from './wallet.mjs'
import {el} from './ui.mjs'
export {isPhone,openInPhantomLink}
export const externalWalletMode=()=>['external','phantom'].includes(new URLSearchParams(location.search).get('wallet'))
const chainFor=p=>p.name==='localnet'?'solana:localnet':p.name==='devnet'?'solana:devnet':'solana:mainnet'
const supports=(w,chain)=>w.chains?.includes(chain)&&typeof w.features?.['standard:connect']?.connect==='function'&&typeof w.features?.['solana:signTransaction']?.signTransaction==='function'&&w.features['solana:signTransaction'].supportedTransactionVersions?.includes('legacy')
export function choices(profile) {
  const chain=chainFor(profile),standard=getWallets().get().filter(w=>supports(w,chain))
  const result=standard.map(w=>({name:w.name,wallet:w,chain}))
  const p=phantomProvider(profile)
  if(p&&!standard.some(w=>w.name==='Phantom'))result.push({name:profile.allowTestWallet&&p===window.cbobTestWallet?'Test wallet':'Phantom',legacy:p})
  return result
}
export const provider=profile=>choices(profile)[0]||null
function choose(items,title) {
  return new Promise((resolve,reject)=>{
    const dialog=el('dialog',{class:'wallet-dialog','aria-label':title}),list=el('div',{class:'wallet-options'})
    const finish=value=>{dialog.close();dialog.remove();value?resolve(value):reject(Error('Wallet connection cancelled.'))}
    for(const item of items)list.append(el('button',{type:'button',class:'btn',onclick:()=>finish(item)},item.name))
    dialog.append(el('h2',{},title),list,el('button',{type:'button',class:'btn secondary',onclick:()=>finish(null)},'Cancel'))
    dialog.addEventListener('cancel',e=>{e.preventDefault();finish(null)})
    document.body.append(dialog);dialog.showModal()
  })
}
export function standardAdapter(wallet,account,chain) {
  const publicKey=new PublicKey(account.publicKey)
  if(publicKey.toBase58()!==account.address||!account.chains?.includes(chain)||!account.features?.includes('solana:signTransaction'))throw Error('This wallet account cannot sign on the selected network.')
  return {publicKey,provider:wallet,name:wallet.name,signTransaction:async tx=>{
    const current=wallet.accounts.find(a=>a.address===account.address&&new PublicKey(a.publicKey).equals(publicKey)&&a.chains.includes(chain)&&a.features.includes('solana:signTransaction'))
    if(!current)throw Error('Your wallet account changed. Return to the ballot and reconnect your wallet.')
    const results=await wallet.features['solana:signTransaction'].signTransaction({account:current,chain,transaction:tx.serialize({requireAllSignatures:false,verifySignatures:false})})
    if(results.length!==1)throw Error('The wallet returned an unexpected transaction count.')
    return Transaction.from(results[0].signedTransaction)
  }}
}
export async function connectWallet(profile) {
  const available=choices(profile)
  if(!available.length)throw Error('No compatible Solana wallet was found. Enable your wallet extension or open this page in its browser.')
  const selected=available.length===1?available[0]:await choose(available,'Connect your wallet')
  if(selected.legacy) {
    const p=selected.legacy,r=await p.connect(),publicKey=new PublicKey((r?.publicKey||p.publicKey).toString())
    return {publicKey,provider:p,name:selected.name,signTransaction:tx=>{
      if(!p.publicKey||!new PublicKey(p.publicKey.toString()).equals(publicKey))throw Error('Your wallet account changed. Connect again.')
      return p.signTransaction(tx)
    }}
  }
  const w=selected.wallet,connected=await w.features['standard:connect'].connect()
  const accounts=connected.accounts.filter(a=>a.chains.includes(selected.chain)&&a.features.includes('solana:signTransaction'))
  if(!accounts.length)throw Error('The wallet did not share a compatible Solana account.')
  const account=accounts.length===1?accounts[0]:(await choose(accounts.map(a=>({name:`${a.label||'Account'} · ${a.address}`,account:a})),'Choose your account')).account
  return standardAdapter(w,account,selected.chain)
}
export function mountWalletChoice(anchor) {
  if(!anchor||document.querySelector('.wallet-choice'))return
  const url=new URL(location.href),club=new URL(url),external=new URL(url)
  club.searchParams.delete('wallet');external.searchParams.set('wallet','external')
  const active=externalWalletMode()
  anchor.before(el('nav',{class:'wallet-choice','aria-label':'Wallet choice'},
    el('a',{class:`btn${active?' secondary':''}`,href:club.pathname+club.search+club.hash,'aria-current':active?null:'page'},'Gary Club account'),
    el('a',{class:`btn${active?'':' secondary'}`,href:external.pathname+external.search+external.hash,'aria-current':active?'page':null},'Connect your own wallet')))
}
