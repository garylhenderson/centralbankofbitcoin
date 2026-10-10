import { connect } from '../src/lib/reads.mjs'
import { createHash } from 'node:crypto'
import { PublicKey, Keypair, Transaction, SystemProgram } from '@solana/web3.js'
import { bankTotals, chairmanStatement, historyWindow, vaultLink } from '../src/lib/ecosystem.mjs'
import { eventTotals, emptyTotals, scanLedger, financialEvents } from '../../bank/market-ledger.mjs'
import { serverConfig, hostedListener } from '../deploy/ceremony-local.mjs'
import { judgeInput, signPrepared, tradeInstructions } from '../server/club-engine.mjs'
import { harness } from './ref.mjs'
const H = harness('ecosystem'), rejects = f => { try { f(); return false } catch { return true } }
const now = 1800000000, index = { generated_at: now, collection: null, totals: { minted: 0, opened: 0 } }
H.t('Chairman reports no issuance before initialization', chairmanStatement(index, now).includes('No vault has been issued'))
H.t('Chairman declines stale data', chairmanStatement(index, now + 1801).includes('unavailable'))
H.t('Chairman recognizes the first vault only from its count', chairmanStatement({ ...index, collection: 'C', totals: { minted: 1, opened: 0 } }, now).includes('first vault'))
H.t('charter window is not claimed after its seven days', !chairmanStatement({ ...index, collection: 'C', charter_opens_at: now - 604800 }, now).includes('window is open'))
H.eq('history window excludes old and unavailable values', historyWindow([[now - 86401, 1], [now, 2], [now, null]], 1, now), [[now, 2]])
H.eq('deep link rejects injected paths', vaultLink('../bad'), '/market/')
const config = { owed_scaled: 1000000000001n, active_count: 1n, pending_count: 2n, bare_burns_retired: 0n }
const b = bankTotals([{ status: 'earning', reserves: { cbBTC: '9007199254740993' } }, { status: 'opened', opened: { paid: { GARY: '100' } } }], config, 10n)
H.eq('reserve totals preserve integer precision and exclude releases', b.held.cbBTC, '9007199254740993')
H.eq('owed pool uses ceiling; available never spends fractional liabilities', [b.owed_sats, b.available_sats], ['2', '8'])
H.eq('release sums are separate from live reserves', b.released.GARY, '100')
H.eq('incomplete opening history withholds release totals', bankTotals([{ status: 'opened' }]).released, null)
H.eq('pool shortage cannot become negative available', bankTotals([], config, 1n).available_sats, '0')
const hosted = { CBOB_CEREMONY_PROFILE: 'mainnet-hosted', CBOB_CEREMONY_ORIGINS: 'https://centralbankofbitcoin.com', CBOB_CEREMONY_HOSTED_AUTH: 'nginx-basic' }
H.eq('hosted ceremony accepts the Bank origin only', serverConfig(hosted).origins, ['https://centralbankofbitcoin.com'])
H.t('hosted ceremony refuses without declared nginx auth', rejects(() => serverConfig({ ...hosted, CBOB_CEREMONY_HOSTED_AUTH: '' })))
H.t('hosted ceremony refuses any other host', rejects(() => serverConfig({ ...hosted, CBOB_CEREMONY_ORIGINS: 'https://evil.example' })))
H.t('tunnel mainnet profile still refuses hosted origins', rejects(() => serverConfig({ ...hosted, CBOB_CEREMONY_PROFILE: 'mainnet-local' })))
H.t('server planner rejects arbitrary transaction signing', rejects(() => judgeInput('sign', { tx: 'anything' })))
H.t('server planner rejects destination overrides', rejects(() => judgeInput('buy', { destination: Keypair.generate().publicKey.toBase58() })))
H.t('server planner rejects malformed vault addresses', rejects(() => judgeInput('open', { asset: 'wrong' })))
const mint = Keypair.generate().publicKey.toBase58(), other = Keypair.generate().publicKey.toBase58(), payment = Keypair.generate().publicKey.toBuffer()
const event = Buffer.alloc(28); createHash('sha256').update('event:Claimed').digest().copy(event, 0, 0, 8); event.writeBigUInt64LE(123n, 20)
const data = `Program data: ${event.toString('base64')}`, tx = logs => ({ meta: { err: null, logMessages: logs } })
H.eq('financial totals accept genuine MINT events', eventTotals(tx([`Program ${mint} invoke [1]`, data, `Program ${mint} success`]), mint, payment).paid_sats, '123')
H.eq('another program cannot forge financial events', eventTotals(tx([`Program ${other} invoke [1]`, data, `Program ${other} success`]), mint, payment), emptyTotals())
H.eq('a caught CPI failure discards its earlier events', eventTotals(tx([`Program ${other} invoke [1]`, `Program ${mint} invoke [2]`, data, `Program ${mint} failed: refused`, `Program ${other} success`]), mint, payment), emptyTotals())
H.t('truncated financial history is not reported as complete', rejects(() => eventTotals(tx([`Program ${mint} invoke [1]`, data, 'Log truncated']), mint, payment)))
H.t('unterminated financial stack is not accepted', rejects(() => eventTotals(tx([`Program ${mint} invoke [1]`, data]), mint, payment)))
const scanned = await scanLedger({ getSignaturesForAddress: async () => [] }, { MINT_CFG: new PublicKey(mint) }, new PublicKey(payment))
H.eq('empty complete history reports genuine zeros', scanned.financial, { coverage: 'complete', ...emptyTotals() })
const owner = Keypair.generate(), dest = Keypair.generate(), blockhash = Keypair.generate().publicKey.toBase58()
const t = new Transaction({ feePayer: owner.publicKey, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: dest.publicKey, lamports: 1 }))
const raw = await signPrepared({ tx: t.serialize({ requireAllSignatures: false }).toString('base64'), minUnits: null }, owner)
H.t('server wallet uses exact signing and produces a valid unchanged message', Transaction.from(raw).verifySignatures() && Transaction.from(raw).serializeMessage().equals(t.serializeMessage()))
H.t('Chairman refuses an index with no timestamp', chairmanStatement({ ...index, generated_at: null }, now).includes('unavailable'))
H.eq('future history is not plotted', historyWindow([[now+1, 2]], 7, now), [])
H.eq('stranded reserves are accounted separately from live vaults', bankTotals([{status:'opened',stranded:{cbBTC:'42'},opened:{coverage:'bare_burn',paid:{}}}]).stranded.cbBTC, '42')
H.eq('a confirmed bare burn creates no false release gap', bankTotals([{status:'opened',opened:{coverage:'bare_burn',paid:{}}}]).released.cbBTC, '0')
H.t('hosted ceremony requires a separate private loopback credential', rejects(()=>hostedListener('/tmp',()=>{},'')))
let status=0;const res={set statusCode(v){status=v},end(){}};hostedListener('/tmp',()=>{},'a'.repeat(64))({headers:{},url:'/rpc'},res)
H.eq('hosted loopback rejects missing proxy credential',status,403)
const oldLocation=globalThis.location
globalThis.location={origin:'https://centralbankofbitcoin.com',href:'https://centralbankofbitcoin.com/private-path/ceremony-123/'}
H.eq('hosted ceremony RPC stays inside its authenticated prefix',connect({name:'mainnet-local',rpc:'same-origin:/rpc'}).rpcEndpoint,'https://centralbankofbitcoin.com/private-path/rpc')
globalThis.location={origin:'http://localhost:8790',href:'http://localhost:8790/ceremony-123/'}
H.eq('tunnel ceremony RPC stays at its loopback root',connect({name:'mainnet-local',rpc:'same-origin:/rpc'}).rpcEndpoint,'http://localhost:8790/rpc')
globalThis.location=oldLocation
const retirement=Buffer.alloc(65);createHash('sha256').update('event:VaultRetired').digest().copy(retirement,0,0,8);owner.publicKey.toBuffer().copy(retirement,8);retirement[40]=0;retirement.writeBigUInt64LE(42n,41)
H.eq('authenticated retirement records distinguish bare burns from openings',financialEvents(tx([`Program ${mint} invoke [1]`,`Program data: ${retirement.toString('base64')}`,`Program ${mint} success`]),mint,payment).retirements,[{asset:owner.publicKey.toBase58(),redeemed:false,returned_sats:'42'}])
H.t('server requires the exact action addresses',rejects(()=>judgeInput('open',{}))&&rejects(()=>judgeInput('claim',{})))
const revenue=Keypair.generate().publicKey, collection=Keypair.generate().publicKey
const trade=tradeInstructions({REVENUE:revenue,COLL:collection},'http://127.0.0.1:8999',owner.publicKey.toBase58(),Keypair.generate().publicKey.toBase58(),dest.publicKey.toBase58(),owner.publicKey.toBase58(),100001n)
H.eq('trade payment instructions preserve the exact royalty rounding',[trade[1].data.readBigUInt64LE(4),trade[2].data.readBigUInt64LE(4)],[90001n,10000n])
H.t('trade payment destinations are the seller and Bank REVENUE',trade[1].keys[1].pubkey.equals(dest.publicKey)&&trade[2].keys[1].pubkey.equals(revenue))
export default H.done()
