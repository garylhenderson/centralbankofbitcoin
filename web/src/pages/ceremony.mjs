/**
 * THE LAUNCH CEREMONY (SPEC road step 10). Unlisted, noindex, linked from
 * nowhere. Refuses unless:
 *   * the connected key is INIT_AUTHORITY (the programs refuse any other key too);
 *   * on mainnet, the cluster's genesis hash is mainnet's, and the embedded copy
 *     of launch/mainnet-init.json passes scripts/check-launch-params.mjs's OWN
 *     judgeLaunch (bundled unchanged), judged at both this computer's clock and
 *     the cluster's, so the page refuses whenever the checker refuses;
 *   * every one of the five programs is the audited build (its ProgramData
 *     hashed against config programBytes) and answers a harmless probe the way
 *     the real program does and the launch placeholder does not.
 * Then, in order and resumable: the vault collection (step 0), SEAL, MINT, BURN, GOV, the three cbBTC accounts,
 * the revenue address's rent. Each step: plain-English values, a dry run, Gary's
 * signature, then the account is re-read and every field must equal the ruled
 * value or the page stops for good.
 */
import { Keypair, PublicKey } from '@solana/web3.js'
import LAUNCH from '../generated/launch.json' with { type: 'json' }
import POB_SET from '../generated/pob-set.json' with { type: 'json' }
import { judgeLaunch, judgeRehearsal as judgeRehearsalFile } from '../../../scripts/check-launch-params.mjs'
import { activeProfile } from '../config.js'
import { makeIds } from '../lib/ids.mjs'
import { connect, account, chainNow, genesisHash, collectionsOfMint, checkNewAddress, TAKEN_NOTE } from '../lib/reads.mjs'
import { parseProgramAccount, parseProgramData, parseMint } from '../lib/decode.mjs'
import { sha256Hex } from '../lib/enc.mjs'
import * as IX from '../lib/ix.mjs'
import { valuesFrom, judgeRehearsal, judgeFor, squadsFor, STEPS, launchWithCollection, walletRefusal,
  judgeProgramBytes, judgeProbe, collectionRecordCopy } from '../lib/plan-ceremony.mjs'
import { buildTx, simulate, signExact, sendSigned, setProgramNames } from '../lib/tx.mjs'
import { readStep, stepVerdict, resolveCollection, withCollection } from '../lib/ceremony-reads.mjs'
import { connectWallet } from '../lib/wallet.mjs'
import { $, el, clear, addr, box, action } from '../lib/ui.mjs'

const P = activeProfile()
const out = $('#result')
let wallet = null

function boot() { $('#connect').addEventListener('click', () => run().catch(e => out.append(box('refuse', String(e?.message || e))))) }

const launchJson = () => P.launchJudge === 'mainnet' ? LAUNCH : P.launchValues

// ── which collection (review M2): remembered in this browser the moment step 0 is
//    signed, and looked for on chain, so a reload can never offer a second one ──
const memKey = () => `cbob-ceremony-collection:${P.name}:${P.programs.mint}`
const remember = a => { try { localStorage.setItem(memKey(), a) } catch { /* private mode: the chain scan still finds it */ } }
const recall = () => { try { return localStorage.getItem(memKey()) } catch { return null } }
async function collectionSources(conn, launch, created) {
  const base = makeIds({ ...P, collection: null })
  let remembered = recall()
  if (remembered) { const a = await account(conn, remembered, 'the remembered collection').catch(() => null); if (!a || !a.owner.equals(base.CORE)) remembered = null }
  let discovered = [], discoverErr = null
  try { discovered = await collectionsOfMint(conn, base) } catch (e) { discoverErr = e.message }
  const r = await resolveCollection(conn, P, base, { created, fromLaunch: launch.vault_collection?.value || null, remembered, discovered })
  return { ...r, discoverErr }
}
// round 37 V2: a collection someone else created naming MINT's PDA is named, never used, never a stop
const ignoredBox = i => box('warn', `Ignored: another collection on chain names MINT's PDA (${i.address}), ${i.why}. This ceremony does not use it. Anyone can create one for a few cents; it changes nothing.`)
// round 39 B4: with nothing pinned and nothing verified, a collection whose creator cannot be
// checked is named prominently and step 0 is STILL offered (a stranger's padded decoy must not
// stop the launch); if one of them is really the one Gary created, he pins it instead
const unverifiedBox = list => box('warn', el('p', {}, el('strong', {}, `Check before step 0: ${list.length === 1 ? 'a collection on chain names' : `${list.length} collections on chain name`} MINT's PDA and this page cannot check who created ${list.length === 1 ? 'it' : 'them'}.`)),
  el('ul', {}, ...list.map(i => el('li', {}, addr(i.address), ` ${i.why}`))),
  el('p', {}, `If one of these is the vault collection you created, do NOT create another: pin it instead. Open this page in the browser that signed step 0 (it remembers it), or pin it in ${collectionRecordCopy(P, '').pins} and rebuild. If you did not create any of them, they are a stranger's and step 0 below creates the real one.`))
// Round 44 (V44-1): the dress rehearsal is judged by check-launch-params' OWN
// --rehearsal judge over launch/rehearsal-init.json, as mainnet is by judgeLaunch.
const judgeValues = judgeFor(P, { judgeLaunch, judgeRehearsalFile, judgeRehearsal, mainnetJson: LAUNCH, pobSet: POB_SET })

async function run() {
  clear(out)
  wallet = await connectWallet(P)
  out.append(el('p', {}, 'Connected: ', addr(wallet.publicKey.toBase58())))
  // Round 46: the wallet must be the launch key AND the value file's init_authority,
  // before anything is read or built (the hosted rehearsal page: only Gary's wallet signs)
  const refusal = walletRefusal(wallet.publicKey.toBase58(), P.initAuthority, launchJson()?.init_authority?.value)
  if (refusal) { out.append(box('refuse', refusal)); return }
  const ready = await preflight()
  if (!ready) { out.append(box('refuse', 'NOT READY. Nothing can be signed until every line above passes.')); return }
  await steps(ready)
}

/** Everything that must hold before the first signature. Returns ctx or null. */
async function preflight() {
  const sec = el('div', {}); out.append(el('h2', {}, 'Before anything is signed'), sec)
  const fails = []
  const line = (ok, text) => { sec.append(box(ok ? 'ok' : 'refuse', text)); if (!ok) fails.push(text) }
  let ids
  try { ids = makeIds(P) } catch (e) { line(false, e.message); return null }
  setProgramNames(P.programs)
  const conn = connect(P)
  // the cluster
  const gh = await genesisHash(conn)
  if (P.expectedGenesisHash) line(gh === P.expectedGenesisHash, `Cluster: ${gh === P.expectedGenesisHash ? P.label : `NOT ${P.label} (genesis ${gh})`}`)
  else line(P.name !== 'mainnet', `Cluster genesis ${gh} (${P.label}; not pinned on this profile)`)
  // the values: the file, with vault_collection standing for the collection this
  // ceremony uses (a throwaway address before step 0), as launchWithCollection says
  const lj0 = launchJson()
  if (!lj0) { line(false, 'No launch values are configured for this profile.'); return null }
  let found
  try { found = await collectionSources(conn, lj0, null) } catch (e) { line(false, `STOP: ${e.message}`); return null }
  const { collection, conflict, discoverErr, source, ignored } = found
  if (conflict) { line(false, `STOP: ${conflict}.`); return null }
  if (!collection && discoverErr) { line(false, `STOP: ${discoverErr}`); return null }
  if (collection) sec.append(box('note', `Vault collection ${collection}, named by ${source}.`))
  for (const i of ignored) if (!found.unverified?.includes(i)) sec.append(ignoredBox(i))
  if (found.unverified?.length) sec.append(unverifiedBox(found.unverified))
  const stand = collection || Keypair.generate().publicKey.toBase58()
  const sub = launchWithCollection(lj0, stand)
  if (sub.conflict) { line(false, `STOP: ${sub.conflict}.`); return null }
  const lj = sub.json
  sec.append(box('note', collection ? `The vault collection: ${collection}.`
    : 'The vault collection does not exist yet: step 0 creates it. Until then the launch values are judged with a stand-in address in its place, so every OTHER value is checked now.'))
  const nowChain = await chainNow(conn), nowLocal = Math.floor(Date.now() / 1000)
  for (const [label, now] of [['this computer\'s clock', nowLocal], ['the cluster\'s clock', nowChain]]) {
    const bad = judgeValues(lj, now)
    line(bad.length === 0, bad.length === 0 ? `Launch values pass ${P.launchJudge === 'mainnet' ? 'scripts/check-launch-params.mjs (judgeLaunch, unchanged)' : P.launchJudge === 'rehearsal-file' ? 'scripts/check-launch-params.mjs --rehearsal (the dress rehearsal\'s judge, NOT the mainnet gate)' : 'the rehearsal bounds (NOT the mainnet gate)'} at ${label}`
      : `Launch values REFUSED at ${label} (${bad.length}):\n${bad.map(b => `  - ${b}`).join('\n')}`)
  }
  const v = valuesFrom(lj)
  line(v.initAuthority === P.initAuthority, `The values' init_authority is ${v.initAuthority === P.initAuthority ? 'this wallet' : `${v.initAuthority}, not this profile's ${P.initAuthority}`}`)
  line(v.bankTreasury === squadsFor(P, v), `The 15% destination is ${v.bankTreasury === squadsFor(P, v) ? (P.squads ? 'the CBOBTC Squads' : 'the rehearsal treasury the value file names') : `${v.bankTreasury}, not the profile's Squads ${P.squads}`}`)
  // Round 46 (V46-6): refused values end the preflight HERE, as NOT READY; a value file
  // with an OPEN mint would otherwise reach the mint reads below and show a network error.
  if (fails.length) return null
  // the programs
  for (const [k, kind] of [['seal', 'anchor'], ['mint', 'anchor'], ['burn', 'anchor'], ['gov', 'anchor'], ['sweep', 'sweep']]) {
    const id = new PublicKey(P.programs[k])
    const acct = await account(conn, id, `the ${k} program`)
    if (!acct || !acct.executable || !acct.owner.equals(new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))) { line(false, `${k.toUpperCase()}: not an executable upgradeable program at ${id}`); continue }
    const pdAddr = parseProgramAccount(acct.data).programData
    const pdAcct = await account(conn, pdAddr, `the ${k} program's data`)
    if (!pdAcct) { line(false, `${k.toUpperCase()}: its program data account is missing`); continue }
    const pd = parseProgramData(pdAcct.data)
    const bytes = judgeProgramBytes(pd, P.programBytes?.[k] || null, sha256Hex)
    const unchecked = !P.programBytes?.[k]
    if (unchecked && P.name === 'mainnet') line(false, `${k.toUpperCase()}: no audited hash configured`)
    else line(unchecked || bytes.length === 0, `${k.toUpperCase()}: ${bytes.length ? bytes.join('; ') : 'the deployed bytes are the audited build (sha256 of dist/, then zeros)'}`)
    const { tx } = await buildTx(conn, [kind === 'anchor' ? IX.anchorProbe(id) : IX.sweepProbe(id)], wallet.publicKey)
    const probe = judgeProbe(kind, await simulate(conn, tx))
    line(probe.length === 0, `${k.toUpperCase()}: ${probe.length ? probe.join('; ') : 'answers the probe as the real program does'}`)
    sec.append(box('note', `${k.toUpperCase()} upgrade authority: ${pd.upgradeAuthority ? `${pd.upgradeAuthority} (still upgradeable, as expected now: only road step 11, after this ceremony, removes it and makes the program final)` : 'none (final)'}`))
  }
  // the mints the initializes name
  for (const m of [...v.reserveMints, v.cbobMint]) {
    const a = await account(conn, m, 'a mint')
    let ok = false; try { ok = !!a && a.owner.equals(new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')) && parseMint(a.data).initialized } catch { ok = false }
    line(ok, `${m}: ${ok ? 'a classic SPL mint' : 'NOT a classic SPL mint (SEAL or MINT would refuse it)'}`)
  }
  sec.append(box('note', 'Road step 9 (deploying the audited bytes over the placeholders and checking them) is done before this, by the command line, and this page checks its result. Road step 11 (removing the upgrade authority, which makes the programs final) comes after this ceremony.'))
  return fails.length ? null : { ids, conn, v, launch: lj0 }
}

async function steps(ctx) {
  const head = el('h2', {}, 'Road step 10, in order'), list = el('ol', { class: 'steps' }); out.append(head, list)
  ctx.squads = squadsFor(P, ctx.v)
  // which collection: config.js, else the one SEAL already names, else the one made here
  let found
  try { found = await collectionSources(ctx.conn, ctx.launch, ctx.created) } catch (e) { list.append(el('li', {}, box('refuse', `STOP: ${e.message}`))); return }
  const { collection, conflict, discoverErr, ignored } = found
  if (conflict) { list.append(el('li', {}, box('refuse', `STOP: ${conflict}.`))); return }
  for (const i of ignored) if (!found.unverified?.includes(i)) list.append(el('li', {}, ignoredBox(i)))
  if (found.unverified?.length) list.append(el('li', {}, unverifiedBox(found.unverified)))
  if (!collection && discoverErr) { list.append(el('li', {}, box('refuse', `STOP: ${discoverErr}`))); return }
  ctx.ids = withCollection(P, collection)
  if (collection) {
    const sub = launchWithCollection(ctx.launch, collection)
    const bad = sub.conflict ? [sub.conflict] : [...judgeValues(sub.json, Math.floor(Date.now() / 1000)), ...judgeValues(sub.json, await chainNow(ctx.conn))]
    if (bad.length) { list.append(el('li', {}, box('refuse', `STOP: with this collection the launch values are refused:\n${[...new Set(bad)].join('\n')}`))); return }
    ctx.v = valuesFrom(sub.json)
  }
  if (collection && !P.collection) {
    remember(collection)   // round 39 B4: persisted again once it exists, whichever way it was found
    const li = el('li', { class: 'box warn' },
      el('p', {}, el('strong', {}, 'Record the vault collection now: '), addr(collection)),
      ...collectionRecordCopy(P, collection).lines.map(t => el('p', {}, t)))
    list.append(li)
    // round 39 B4: nothing after step 0 continues until Gary says he has recorded it
    if (ctx.recordedCollection !== collection) {
      const tick = el('input', { type: 'checkbox', id: 'recorded' })
      li.append(el('div', { class: 'ack' }, tick, el('label', { for: 'recorded' }, collectionRecordCopy(P, collection).ack)),
        action('Continue', async () => {
          if (!tick.checked) throw new Error('Tick the box first: record the collection address before continuing.')
          ctx.recordedCollection = collection
          head.remove(); list.remove(); await steps(ctx)
        }, { out: li }))
      return
    }
  }
  for (const s of STEPS) {
    const li = el('li', {}, el('div', { class: 'status wait' }, 'checking'), el('strong', {}, s.title))
    list.append(li)
    const state = await readStep(ctx, s.id)
    const tag = li.firstChild
    const verdict = stepVerdict(state)
    if (verdict === 'done') { tag.className = 'status done'; tag.textContent = 'done, verified on chain'; continue }
    if (verdict === 'absent') {
      tag.className = 'status broken'; tag.textContent = 'THE PIN IS WRONG: STOP'
      li.append(box('refuse', `${state.absent}. Nothing on chain is wrong: the address pinned in ${collectionRecordCopy(P, '').pins} names an account that does not exist. Correct the pin to the collection step 0 created (or clear it so this page finds or offers it), rebuild, and reload.`))
      return
    }
    if (verdict === 'broken') {
      tag.className = 'status broken'; tag.textContent = 'WRONG ON CHAIN: STOP'
      li.append(box('refuse', `This account exists and does not hold the ruled values. It can never be rewritten. Stop and decide with the team before anything else:\n${state.join('\n')}`))
      return
    }
    tag.className = 'status next'; tag.textContent = 'next'
    li.append(el('ul', {}, ...s.describe(ctx.ids, ctx.v, ctx).map(t => el('li', {}, t))))
    const ixs = s.build(ctx.ids, wallet.publicKey, ctx.v, ctx)
    const builtFor = JSON.stringify({ shortfall: ctx.shortfall ?? null, existing: [...(ctx.existing || [])].sort() })
    const area = el('div', {}); li.append(area)
    area.append(action(`Dry run: ${s.title}`, async () => {
      // Round 42 (C12): a collection address someone funded first can never be
      // created; one Core already owns landed from an earlier attempt. Either way,
      // re-read (a re-render builds step 0 with a fresh key).
      if (s.id === 'collection') {
        // only the PUBLIC address is passed (C04: the key is used to sign, nothing else)
        const na = await checkNewAddress(ctx.conn, ctx.ids, { publicKey: new PublicKey(ctx.newCollection.publicKey.toBase58()) }, () => null)
        if (na.state !== 'fresh') {
          if (na.state === 'landed') { remember(ctx.newCollection.publicKey.toBase58()); ctx.created = ctx.newCollection.publicKey.toBase58(); ctx.ids = withCollection(P, ctx.created) }
          area.append(box('note', na.state === 'taken' ? `${TAKEN_NOTE(na.was, 'the vault collection')} Re-reading.` : 'This collection already landed from an earlier attempt. Re-reading.'))
          head.remove(); list.remove(); await steps(ctx); return
        }
      }
      const { tx, blockhash, lastValidBlockHeight, size } = await buildTx(ctx.conn, ixs, wallet.publicKey)
      const sim = await simulate(ctx.conn, tx)
      area.append(el('pre', { class: 'logs' }, sim.logs.join('\n')))
      if (sim.err) { area.append(box('refuse', `The dry run failed: ${sim.explained}. Nothing was signed.`)); return }
      area.append(box('ok', `Dry run passed (${size} bytes, ${sim.unitsConsumed ?? '?'} compute units).`))
      area.append(action(`Sign and send: ${s.title}`, async () => {
        // re-read FIRST: a step that landed after a time-out (or whose amounts moved) is
        // never sent a second time (review L6: the funding step could pay twice)
        const again = await readStep(ctx, s.id)
        if (again !== null || JSON.stringify({ shortfall: ctx.shortfall ?? null, existing: [...(ctx.existing || [])].sort() }) !== builtFor) {
          area.append(box('note', 'The chain changed since the dry run (this step may already have landed). Nothing was sent; re-reading.'))
          head.remove(); list.remove(); await steps(ctx); return
        }
        if (s.id === 'collection') remember(ctx.newCollection.publicKey.toBase58())   // BEFORE it can land
        // round 47 (V47-4): the judge's compute floor, from this step's own dry run. The
        // measured need, not pageUnits(): the ceremony sets no budget of its own, Phantom's
        // fixed 200,000 landed every step on mainnet, and a wallet limit below what the step
        // consumed can only fail on the network, so it is refused here, by name
        const signed = await signExact(wallet, tx, s.id === 'collection' ? [ctx.newCollection] : [], { minUnits: sim.unitsConsumed || null })
        const sig = await sendSigned(ctx.conn, signed, blockhash, lastValidBlockHeight)
        area.append(box('ok', 'Landed: ', el('code', {}, sig)))
        if (s.id === 'collection') { ctx.created = ctx.newCollection.publicKey.toBase58(); ctx.ids = withCollection(P, ctx.created) }
        const after = await readStep(ctx, s.id)
        if (stepVerdict(after) !== 'done') { area.append(box('refuse', `AFTER LANDING, THE ACCOUNT DOES NOT HOLD THE RULED VALUES. STOP.\n${(Array.isArray(after) ? after : [after?.absent || 'the account is missing']).join('\n')}`)); return }
        area.append(box('ok', 'Re-read from the chain: every field equals the ruled value.'))
        head.remove(); list.remove()
        await steps(ctx)
      }, { out: area }))
    }, { out: area }))
    return
  }
  out.append(box('ok', 'Road step 10 is complete: the vault collection exists, all four programs are initialized with the ruled values, the three cbBTC accounts exist, and the revenue address holds its rent.'))
}

document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot()
