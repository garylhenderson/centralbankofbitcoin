/**
 * The dress rehearsal's steps (SPEC road step 8, item 22), in order. Driven by
 * scripts/rehearsal-run.mjs, which owns the refusals, the --max-sol cap and the
 * never-resend rule; each step here owns three things: its estimate, its run,
 * and `done`, the ON-CHAIN read-back that decides whether it happened.
 *
 * Every key a step creates is written to .rehearsal-keys (mode 600, never
 * overwritten) BEFORE anything is sent with it, so a crash mid-step can always be
 * re-read. The holder pages' own planners build every holder transaction, as in
 * web/test/e2e-localnet.mjs; the shipped jobs (crank, alarm, revenue) run as
 * themselves, routed by the rehearsal-only overrides in bank/rehearsal-env.mjs.
 */
import fs from 'fs'
import path from 'path'
import { execFileSync, spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, TransactionInstruction } from '@solana/web3.js'
import * as spl from '@solana/spl-token'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { keypairIdentity, publicKey as pk, createSignerFromKeypair } from '@metaplex-foundation/umi'
import { mplCore, transfer as coreTransfer, createCollection, create as coreCreate } from '@metaplex-foundation/mpl-core'
import { toWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters'
import { PROFILES, SITE } from '../web/src/config.js'
import { makeIds, ata } from '../web/src/lib/ids.mjs'
import * as IX from '../web/src/lib/ix.mjs'
import { disc } from '../web/src/lib/enc.mjs'
import { STEPS, valuesFrom, launchWithCollection } from '../web/src/lib/plan-ceremony.mjs'
import { readStep } from '../web/src/lib/ceremony-reads.mjs'
import { readRedemptionSnapshot, readConfigs, readVault, account, accounts, chainNow, anchorAccount, checkNewAddress } from '../web/src/lib/reads.mjs'
import { planRedemption, rateLimit } from '../web/src/lib/plan-redeem.mjs'
import { planActivate } from '../web/src/lib/plan-vault.mjs'
import { planClaim, planBuy, readPobs } from '../web/src/lib/plan-get.mjs'
import { parseCoreAsset, parseCoreCollection, parseProgramAccount, parseProgramData, parseTokenAccount } from '../web/src/lib/decode.mjs'
import { judgeRehearsal } from './check-launch-params.mjs'
import { rootOf } from './pob-merkle.mjs'
import { judgeNoMainnetKeys, PROGRAM_FILES, judgeDeployKey, solanaArgv, judgeArgv, bufferCloseArgv, deployerNeed,
  judgeForcedFailureAlarm, judgeAlarmPass, judgeDas, judgeRevenueCycles, ALARM_GRACE_MS } from './rehearsal-run.mjs'
import { ORCA, METEORA } from '../bank/swap.mjs'

const SOL = LAMPORTS_PER_SOL
const sleep = ms => new Promise(r => setTimeout(r, ms))
const CBBTC = new PublicKey('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij')
const GARY = new PublicKey('8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk')
const GIRAFFISH = new PublicKey('Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump')
const INIT = Keypair.fromSeed(Buffer.alloc(32, 7))     // the localnet INIT_AUTHORITY (GmaDrpp...)
const PRICE = 21_000n, ROUND_CAP = 2
const NEED = { cbbtc: 2n * PRICE + 21_000n + 1_000n, gary: 1_000_000_000n, giraffish: 1_000_000n }
const ROLE_SOL = { holder: 0.08, crank: 0.03, 'swap-operator': 0.025, stranger: 0.01, treasury: 0.005 }
/** THE ONE PLACE the rehearsal's swap-operator key lives, relative to the tree root:
 *  exactly where bank/revenue.mjs reads it in a rehearsal tree (round 44 V44o-5), 600.
 *  Every other throwaway key stays in .rehearsal-keys. */
export const SWAP_OPERATOR_KEY = path.join('bank', 'keys', 'swap-operator.json')
/** `deployer` (round 45 V45-3): the rehearsal programs' payer and upgrade authority,
 *  funded by the deploy wallet, so the real programs' upgrade key never signs a deploy. */
const ROLES = ['holder', 'guardian', 'treasury', 'swap-operator', 'cbob-release', 'pob-authority', 'crank', 'stranger', 'deployer']


export function makeSteps(ctx) {
  const { conn, ROOT, keysDir, funding } = ctx
  // the driver signs only with throwaway keys in its tree's own key directory
  if (path.basename(keysDir) !== '.rehearsal-keys') throw new Error(`refusing a key directory that is not .rehearsal-keys: ${keysDir}`)
  const RUN = path.join(ROOT, '.rehearsal-run'); fs.mkdirSync(RUN, { recursive: true, mode: 0o700 })
  const keyPath = n => n === 'swap-operator' ? path.join(ROOT, SWAP_OPERATOR_KEY) : path.join(keysDir, `${n}.json`)
  const haveKey = n => fs.existsSync(keyPath(n))
  const key = n => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath(n), 'utf8'))))
  const newKey = n => { if (!haveKey(n)) { fs.mkdirSync(path.dirname(keyPath(n)), { recursive: true, mode: 0o700 }); } if (!haveKey(n)) fs.writeFileSync(keyPath(n), JSON.stringify([...Keypair.generate().secretKey]), { mode: 0o600, flag: 'wx' }); return key(n) }
  const filledPath = path.join(ROOT, 'launch', 'rehearsal-init.filled.json')
  const pobSetPath = path.join(RUN, 'pob-set.json')
  const st = ctx.st
  ctx.item22 = st.item22

  // ── the profile and ids: the rehearsal's own program ids, never the web config's ──
  const profile = () => ({ ...PROFILES.rehearsal, rpc: ctx.A.rpcResolved, programs: ctx.programs, collection: st.collection || null, squads: haveKey('treasury') ? key('treasury').publicKey.toBase58() : null })
  const ids = () => makeIds(profile())
  const filled = () => JSON.parse(fs.readFileSync(filledPath, 'utf8'))
  const values = () => valuesFrom(st.collection ? launchWithCollection(filled(), st.collection).json : filled())

  // ── sending: the signature is recorded BEFORE it is sent ──
  async function send(rec, ixs, signers, feePayer = signers[0]) {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed')
    const tx = new Transaction({ feePayer: feePayer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs)
    tx.sign(...signers)
    const sig = require58(tx.signature)
    rec.sigs = [...(rec.sigs || []), { sig, lastValidBlockHeight }]; ctx.save()
    try { await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' }) }
    catch (e) { if (/simulation failed/i.test(String(e?.message))) { rec.sigs.at(-1).preflightRefused = true; ctx.save() } throw e }
    const c = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
    if (c.value.err) throw new Error(`transaction ${sig} failed: ${JSON.stringify(c.value.err)}`)
    return sig
  }
  /** The init key (a PUBLIC seed) is funded INSIDE the transaction that spends it, sized
   *  by simulation, so it never holds SOL between transactions for a sweeper to take. */
  async function sendWithInit(rec, ixs, extraSigners = []) {
    const probeLamports = Math.round(0.1 * SOL)
    const pre = await conn.getBalance(INIT.publicKey, 'confirmed')
    const build = l => new Transaction({ feePayer: funding.publicKey, recentBlockhash: '11111111111111111111111111111111' })
      .add(...(l > 0 ? [SystemProgram.transfer({ fromPubkey: funding.publicKey, toPubkey: INIT.publicKey, lamports: l })] : []), ...ixs)
    const { blockhash } = await conn.getLatestBlockhash('confirmed')
    const probe = build(probeLamports); probe.recentBlockhash = blockhash
    const sim = await conn.simulateTransaction(probe, undefined, [INIT.publicKey])
    if (sim.value.err) throw new Error(`simulation refused: ${JSON.stringify(sim.value.err)} ${(sim.value.logs || []).slice(-6).join(' | ')}`)
    const post = sim.value.accounts?.[0]?.lamports ?? 0
    const used = pre + probeLamports - post
    const fund = Math.max(0, used - pre)
    return send(rec, [...(fund > 0 ? [SystemProgram.transfer({ fromPubkey: funding.publicKey, toPubkey: INIT.publicKey, lamports: fund })] : []), ...ixs],
      [funding, INIT, ...extraSigners], funding)
  }

  const umiFor = kp => createUmi(ctx.A.rpcResolved, { commitment: 'confirmed' }).use(mplCore())
    .use(keypairIdentity(createUmi(ctx.A.rpcResolved).eddsa.createKeypairFromSecretKey(kp.secretKey)))
  /** A Core transfer built by Umi, SENT through send() so its signature is recorded (V45-4). */
  const coreTransferIxs = (from, assetAddr, newOwner) => coreTransfer(umiFor(from), { asset: { publicKey: pk(assetAddr.toBase58()), owner: pk(from.publicKey.toBase58()) },
    collection: { publicKey: pk(st.collection) }, newOwner: pk(newOwner.toBase58()) }).getInstructions().map(toWeb3JsInstruction)

  // ── the shipped jobs, routed to the rehearsal ──
  const notifyScript = path.join(RUN, 'notify.sh')
  if (!fs.existsSync(notifyScript)) fs.writeFileSync(notifyScript, `#!/bin/sh\n# REHEARSAL notices land here, never with Gary.\nprintf '%s\\t%s\\t%s\\n' "$(date -u +%FT%TZ)" "$2" "$1" | tr '\\n' ' ' >> '${path.join(RUN, 'notices.log')}'\necho >> '${path.join(RUN, 'notices.log')}'\n`, { mode: 0o700 })
  function job(name, argv, extraEnv = {}) {
    const env = { ...process.env, CBOB_REHEARSAL_NOTIFY: notifyScript, CBOB_ALARM_REHEARSAL: '1', ...extraEnv }
    if (ctx.network !== 'mainnet') env.CBOB_REHEARSAL_RPC = ctx.A.jobsRpc || ctx.A.rpcResolved   // local: sim/das-shim.mjs in front of the validator
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bank', name), ...argv], { cwd: ROOT, env, encoding: 'utf8', timeout: 20 * 60_000 })
    const out = `${r.stdout}${r.stderr}`
    fs.appendFileSync(path.join(RUN, `${name}.log`), `\n===== ${new Date().toISOString()} ${argv.join(' ')} (exit ${r.status})\n${out}`)
    return { code: r.status, out }
  }
  const crankEnv = () => ({ CBOB_CRANK_KEY: keyPath('crank') })
  const revEnv = (x = {}) => ({ ...x })   // revenue.mjs reads SWAP_OPERATOR_KEY from the tree itself
  const item = (n, verdict, evidence) => { st.item22[n] = { verdict, evidence, at: new Date().toISOString() }; ctx.save() }

  // ── reads ──
  const vaultKeyNames = ['vault-1', 'vault-2', 'vault-3', 'vault-4', 'vault-5']
  const vaultAddr = n => haveKey(n) ? key(n).publicKey : null
  const assetOf = async a => { const i = a && await conn.getAccountInfo(a, 'confirmed'); return i && i.data.length > 1 ? parseCoreAsset(i.data) : null }
  const isBurned = async a => { const i = a && await conn.getAccountInfo(a, 'confirmed'); return !!i && i.data.length === 1 && i.data[0] === 0 }
  const tokBal = async a => { const i = await conn.getAccountInfo(a, 'confirmed'); return i ? parseTokenAccount(i.data).amount : 0n }
  const rent = n => conn.getMinimumBalanceForRentExemption(n)

  // ═══════════════════════════════ THE STEPS ═══════════════════════════════
  const S = []
  const step = (name, title, estimate, done, run, opts = {}) => S.push({ name, title, estimate, done, run, ...opts })

  step('keys', 'throwaway keys into .rehearsal-keys (600, never overwritten)', async () => 0,
    async () => ROLES.every(haveKey),
    async () => { for (const r of ROLES) newKey(r); return Object.fromEntries(ROLES.map(r => [r, key(r).publicKey.toBase58()])) })

  // the localnet build at the rehearsal ids
  const soPath = f => path.join(ROOT, 'target', 'deploy', `${f}.so`)
  const shaOf = b => createHash('sha256').update(b).digest('hex')
  step('build', 'cargo-build-sbf --arch v3 --features localnet (only INIT_AUTHORITY differs from the shipped build)', async () => 0,
    async () => !!st.build && Object.entries(st.build).every(([k, b]) => fs.existsSync(soPath(PROGRAM_FILES[k])) && shaOf(fs.readFileSync(soPath(PROGRAM_FILES[k]))) === b.sha256),
    async () => {
      execFileSync('cargo-build-sbf', ['--arch', 'v3', '--features', 'localnet'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.HOME}/.local/share/solana/install/active_release/bin:${process.env.PATH}` } })
      st.build = {}
      for (const [k, f] of Object.entries(PROGRAM_FILES)) {
        const rel = path.join(ROOT, 'target', 'sbpfv3-solana-solana', 'release', `${f}.so`)
        fs.copyFileSync(rel, soPath(f))
        const b = fs.readFileSync(soPath(f)); st.build[k] = { sha256: shaOf(b), len: b.length }
      }
      ctx.save(); return st.build
    })

  // deploy, largest first, so each buffer is refunded before the next is written. The
  // order is the BUILD's (st.build, measured), decided when each step runs.
  const order = () => st.build ? Object.keys(st.build).sort((a, b) => st.build[b].len - st.build[a].len) : null
  const nth = i => { const o = order(); if (!o) throw new Error('the build has not run'); return o[i] }
  /** V45-2: the CLI reads the RPC from ctx.cliConfig (600); no URL ever enters its argv. */
  const solanaCli = (argv) => {
    const full = solanaArgv(ctx.cliConfig, argv)
    const bad = judgeArgv(full, [ctx.A.rpcResolved, ctx.A.rpc === 'box' ? null : ctx.A.rpc].filter(x => x && /^https?:/.test(x)))
    if (bad.length) throw new Error(`REFUSED: ${bad.join('; ')}`)
    return execFileSync('solana', full, { encoding: 'utf8', env: { ...process.env, PATH: `${process.env.HOME}/.local/share/solana/install/active_release/bin:${process.env.PATH}` } })
  }
  const deployerPath = () => keyPath('deployer')
  const programKeyPath = k => path.join(keysDir, `${PROGRAM_FILES[k]}-keypair.json`)
  async function deployed(k) {
    const id = new PublicKey(ctx.programs[k]), a = await conn.getAccountInfo(id, 'confirmed')
    if (!a || !a.executable || !st.build?.[k]) return false
    const pa = parseProgramAccount(a.data), pdAcc = await conn.getAccountInfo(new PublicKey(pa.programData), 'confirmed')
    if (!pdAcc) return false
    const pd = parseProgramData(pdAcc.data)
    if (pd.upgradeAuthority !== key('deployer').publicKey.toBase58()) return false
    const b = st.build[k], elf = pd.elf
    return elf.length >= b.len && shaOf(elf.subarray(0, b.len)) === b.sha256 && elf.subarray(b.len).every(x => x === 0)
  }
  /** What the deployer must hold for the deploys not yet done (V45-3), in deploy order. */
  async function deployerShortfall() {
    const o = order(); if (!o) return 0
    const remaining = []
    for (const k of o) if (!(await deployed(k))) { const len = st.build[k].len; remaining.push({ programData: await rent(len + 45), buffer: await rent(len + 37) }) }
    if (!remaining.length) return 0
    const need = deployerNeed(remaining, remaining.length * (Math.ceil(400_000 / 1000) * 5000) + 50_000_000)
    return Math.max(0, need - await conn.getBalance(key('deployer').publicKey, 'confirmed'))
  }

  step('fund-roles', `SOL to the throwaway roles (${Object.entries(ROLE_SOL).map(([r, s]) => `${r} ${s}`).join(', ')})`,
    async () => Math.round(Object.values(ROLE_SOL).reduce((a, b) => a + b, 0) * SOL) + 10_000,
    async () => { for (const [r, s] of Object.entries(ROLE_SOL)) if ((await conn.getBalance(key(r).publicKey, 'confirmed')) < Math.round(s * SOL * 0.5)) return false; return true },
    async (c, rec) => {
      const ixs = []
      for (const [r, s] of Object.entries(ROLE_SOL)) { const have = await conn.getBalance(key(r).publicKey, 'confirmed'), want = Math.round(s * SOL)
        if (have < want) ixs.push(SystemProgram.transfer({ fromPubkey: funding.publicKey, toPubkey: key(r).publicKey, lamports: want - have })) }
      return ixs.length ? send(rec, ixs, [funding]) : 'already funded'
    })

  // the rehearsal's own Proof of Burn set: a Core collection and three assets the holder owns
  step('pob-set', 'a throwaway Proof of Burn collection with 3 assets owned by the holder, and its root',
    async () => 4 * (3_500_000 + 1_500_000),
    async () => {
      if (!fs.existsSync(pobSetPath)) return false
      const s = JSON.parse(fs.readFileSync(pobSetPath, 'utf8'))
      const c = await conn.getAccountInfo(new PublicKey(s.collection), 'confirmed')
      if (!c) return false
      for (const a of s.assets) { const x = await assetOf(new PublicKey(a.address)); if (!x || x.owner !== key('holder').publicKey.toBase58()) return false }
      return rootOf(s.assets.map(a => new PublicKey(a.address).toBytes())).toString('hex') === s.root
    },
    async () => {
      const umi = umiFor(funding)
      const pobAuth = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(key('pob-authority').secretKey))
      const collKp = newKey('pob-collection'), coll = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(collKp.secretKey))
      if (!(await conn.getAccountInfo(collKp.publicKey, 'confirmed')))
        await createCollection(umi, { collection: coll, name: 'Proof of Burn (REHEARSAL)', uri: 'rehearsal', updateAuthority: pobAuth.publicKey }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
      const assets = []
      for (let e = 1; e <= 3; e++) {
        const kp = newKey(`pob-${e}`)
        if (!(await conn.getAccountInfo(kp.publicKey, 'confirmed'))) {
          const s = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(kp.secretKey))
          await coreCreate(umi, { asset: s, collection: { publicKey: coll.publicKey }, authority: pobAuth, owner: pk(key('holder').publicKey.toBase58()), name: `Proof of Burn #${e}`, uri: 'rehearsal' })
            .sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
        }
        assets.push({ edition: e, address: kp.publicKey.toBase58() })
      }
      const set = { collection: collKp.publicKey.toBase58(), assets, root: rootOf(assets.map(a => new PublicKey(a.address).toBytes())).toString('hex') }
      fs.writeFileSync(pobSetPath, JSON.stringify(set, null, 1)); return set
    })

  step('cbob-mint', 'a throwaway $CBOB mint, 2.1B to its release wallet, mint authority then revoked',
    async () => (await rent(82)) + (await rent(165)) + 20_000,
    async () => {
      if (!haveKey('cbob-mint')) return false
      const m = await conn.getAccountInfo(key('cbob-mint').publicKey, 'confirmed')
      if (!m) return false
      const mi = spl.unpackMint(key('cbob-mint').publicKey, m)
      return mi.mintAuthority === null && mi.freezeAuthority === null && mi.supply === 2_100_000_000_000_000n
        && (await tokBal(ata(key('cbob-release').publicKey, key('cbob-mint').publicKey))) === mi.supply
    },
    async (c, rec) => {
      const mk = newKey('cbob-mint'), mint = mk.publicKey, rel = key('cbob-release').publicKey, relAta = ata(rel, mint)
      const ixs = []
      if (!(await conn.getAccountInfo(mint, 'confirmed'))) ixs.push(
        SystemProgram.createAccount({ fromPubkey: funding.publicKey, newAccountPubkey: mint, lamports: await rent(82), space: 82, programId: spl.TOKEN_PROGRAM_ID }),
        spl.createInitializeMint2Instruction(mint, 6, funding.publicKey, null))
      ixs.push(spl.createAssociatedTokenAccountIdempotentInstruction(funding.publicKey, relAta, rel, mint),
        spl.createMintToInstruction(mint, relAta, funding.publicKey, 2_100_000_000_000_000n),
        spl.createSetAuthorityInstruction(mint, funding.publicKey, spl.AuthorityType.MintTokens, null))
      return send(rec, ixs, [funding, mk])
    })

  // the filled value file, judged by the checker's rehearsal judge and the driver's own
  step('fill-values', 'fill launch/rehearsal-init.filled.json and judge it (check-launch-params --rehearsal + no mainnet key)', async () => 0,
    async () => {
      if (!fs.existsSync(filledPath) || !st.filledJudged) return false
      const mintDone = !!(await conn.getAccountInfo(ids().MINT_CFG, 'confirmed'))
      return mintDone || Number(filled().charter_opens_at.value) > (await chainNow(conn)) + 240
    },
    async () => {
      const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'launch', 'rehearsal-init.json'), 'utf8'))
      const set = JSON.parse(fs.readFileSync(pobSetPath, 'utf8'))
      const put = (k, v) => { p[k] = { ...p[k], value: v, source: `${p[k]?.source ?? ''} [filled at rehearsal time ${new Date().toISOString()} by scripts/rehearsal-run.mjs]` } }
      put('guardian', key('guardian').publicKey.toBase58()); put('bank_treasury', key('treasury').publicKey.toBase58())
      put('swap_operator', key('swap-operator').publicKey.toBase58()); put('cbob_release_wallet', key('cbob-release').publicKey.toBase58())
      put('cbob_mint', key('cbob-mint').publicKey.toBase58()); put('pob_collection', set.collection); put('pob_root', set.root)
      // V45-6: values are filled BEFORE the deploys, so the window opens after them
      put('charter_opens_at', (await chainNow(conn)) + 1800)
      const standin = Keypair.generate().publicKey.toBase58()
      const withStandin = { ...JSON.parse(JSON.stringify(p)), vault_collection: { ...p.vault_collection, value: standin } }   // status stays REHEARSAL-OPEN
      const bad = [...judgeRehearsal(withStandin, { nowSec: await chainNow(conn) }),
        ...judgeNoMainnetKeys(p, { network: ctx.network, funding: funding.publicKey.toBase58() })]
      if (bad.length) throw new Error(`the filled values are refused: ${bad.join('; ')}`)
      fs.writeFileSync(filledPath, JSON.stringify(p, null, 1)); st.filledJudged = true; ctx.save()
      return { charter_opens_at: p.charter_opens_at.value }
    })

  // ROUND 45 (V45-3, V45-6): the deploys run AFTER every preparation step, then the
  // ceremony initializes at once. The deploy wallet only funds the throwaway deployer,
  // which pays every deploy and is every rehearsal program's upgrade authority.
  step('fund-deployer', 'SOL to the throwaway deployer: every ProgramData rent, plus the largest buffer outstanding, plus fees',
    async () => deployerShortfall(),
    async () => order() ? (await deployerShortfall()) === 0 : false,
    async (c, rec) => { const short = await deployerShortfall()
      return short > 0 ? send(rec, [SystemProgram.transfer({ fromPubkey: funding.publicKey, toPubkey: key('deployer').publicKey, lamports: short })], [funding]) : 'already funded' })
  for (let i = 0; i < 5; i++) {
    step(`deploy-${i + 1}`, `deploy the ${['largest', 'second largest', 'third largest', 'fourth largest', 'smallest'][i]} program, payer and upgrade authority the throwaway deployer`,
      async () => 0,
      () => order() ? deployed(nth(i)) : false,
      async () => {
        const k = nth(i)
        // the key this deploy signs for is JUDGED before anything is sent (V45-3)
        let kpPub = null; try { kpPub = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(programKeyPath(k), 'utf8')))).publicKey.toBase58() } catch {}
        const bad = judgeDeployKey({ name: k, keypairPubkey: kpPub, programs: ctx.programs, deployer: key('deployer').publicKey.toBase58(), funding: funding.publicKey.toBase58() })
        if (bad.length) throw new Error(`REFUSED: ${bad.join('; ')}`)
        // this deploy's OWN buffer, recorded before it is written: a failed attempt
        // resumes into it, and only it is ever closed (never --buffers)
        const bufKp = newKey(`buffer-${k}`)
        st.buffers = { ...(st.buffers || {}), [k]: bufKp.publicKey.toBase58() }; ctx.save()
        const out = solanaCli(['program', 'deploy', soPath(PROGRAM_FILES[k]), '--program-id', programKeyPath(k), '--buffer', keyPath(`buffer-${k}`),
          '--keypair', deployerPath(), '--upgrade-authority', deployerPath()])
        return `${k} ${ctx.programs[k]}: ${out.trim().split('\n').slice(-1)[0]}`
      })
  }

  // ROAD STEP 10, the ceremony's own steps, read back field by field
  const cctx = () => ({ ids: ids(), conn, v: values(), squads: key('treasury').publicKey.toBase58() })
  const broken = (id, r) => { throw new Error(`STOP: the ${id} account exists with WRONG values (${r.join('; ')}). Nothing can rewrite it. Close every rehearsal program (solana program close <id> --bypass-warning), make a NEW rehearsal tree (new throwaway ids) and start again. No token has moved.`) }
  step('ceremony-collection', 'road step 10, step 0: the vault collection (update authority MINT\'s PDA, no plugins)',
    async () => 3_500_000 + 20_000,
    async () => { if (!st.collection) return false; const r = await readStep({ ...cctx(), ids: ids() }, 'collection'); if (Array.isArray(r) && r.length) broken('collection', r); return Array.isArray(r) },
    async (c, rec) => {
      // V45-11: the page's fresh / landed / taken check (limit 59). An address a stranger
      // funded first gets a FRESH key, never the close-everything remedy.
      const pre = makeIds({ ...profile(), collection: null })
      let name = st.collectionKey || 'vault-collection'
      const chk = await checkNewAddress(conn, pre, newKey(name), () => { name = `vault-collection-${(st.collectionTaken || 0) + 2}`; return newKey(name) })
      if (chk.state === 'taken') { st.collectionTaken = (st.collectionTaken || 0) + 1; st.collectionTakenWas = [...(st.collectionTakenWas || []), chk.was] }
      st.collectionKey = name; ctx.save()
      const kp = chk.kp
      if (chk.state !== 'landed')
        await sendWithInit(rec, [IX.coreCreateCollection(pre, kp.publicKey, pre.MINT_AUTH, INIT.publicKey, SITE.collectionName, SITE.collectionUri)], [kp])
      st.collection = kp.publicKey.toBase58(); ctx.save()
      const p = filled(); p.vault_collection = { ...p.vault_collection, value: st.collection, source: `${p.vault_collection?.source ?? ''} [created by the rehearsal's road step 10, step 0, ${new Date().toISOString()}]` }
      const bad = [...judgeRehearsal(p, { nowSec: await chainNow(conn) }), ...judgeNoMainnetKeys(p, { network: ctx.network, funding: funding.publicKey.toBase58() })]
      if (bad.length) throw new Error(`with the collection recorded, the values are refused: ${bad.join('; ')}`)
      fs.writeFileSync(filledPath, JSON.stringify(p, null, 1)); return st.collection
    })
  for (const id of ['seal', 'mint', 'burn', 'gov']) {
    step(`ceremony-${id}`, `initialize ${id.toUpperCase()} (init key funded inside the same transaction), every field read back`,
      async () => 5_000_000,
      async () => { const r = await readStep(cctx(), id); if (Array.isArray(r) && r.length) broken(id, r); return Array.isArray(r) },
      async (c, rec) => { const x = cctx(); const s = STEPS.find(q => q.id === id); return sendWithInit(rec, s.build(x.ids, INIT.publicKey, x.v, x)) })
  }
  for (const id of ['atas', 'fund']) {
    step(`ceremony-${id}`, id === 'atas' ? 'the three cbBTC accounts (pool, revenue, treasury)' : 'the revenue address above rent exemption',
      async () => 3 * 2_100_000,
      async () => { const r = await readStep(cctx(), id); if (Array.isArray(r) && r.length) broken(id, r); return Array.isArray(r) },
      async (c, rec) => { const x = cctx(); await readStep(x, id); const ixs = STEPS.find(q => q.id === id).build(x.ids, funding.publicKey, x.v, x); return ixs.length ? send(rec, ixs, [funding]) : 'nothing to send' })
  }
  step('verify-configs', 'BEFORE ANY TOKEN MOVES: every ceremony account re-read against the filled values', async () => 0,
    async () => st.configsVerified === true,
    async () => { for (const s of STEPS) { const r = await readStep(cctx(), s.id); if (!Array.isArray(r)) throw new Error(`STOP: ${s.id} is not on chain`); if (r.length) broken(s.id, r) }
      st.configsVerified = true; ctx.save(); return 'all seven ceremony steps equal the filled values' })

  // ═══ THE HOLDER'S SIDE (the pages' own planners) ═══
  async function claimSnapshot() {
    const set = JSON.parse(fs.readFileSync(pobSetPath, 'utf8')), i = ids()
    const [cfg, nowSec, pobs, pc] = await Promise.all([readConfigs(conn, i), chainNow(conn), readPobs(conn, accounts, i, set, parseCoreAsset), account(conn, set.collection)])
    return { mintConfig: cfg.mint, nowSec, owner: key('holder').publicKey.toBase58(), pobSet: set, pobs, pobCollection: pc ? parseCoreCollection(pc.data) : null }
  }
  for (let n = 1; n <= 3; n++) {
    step(`claim-${n}`, `charter claim ${n}: Proof of Burn #${n} burned, vault-${n} minted to the holder`,
      async () => 6_000_000,
      async () => { const a = vaultAddr(`vault-${n}`); const x = await assetOf(a); return !!x && x.owner === key('holder').publicKey.toBase58() && await isBurned(new PublicKey(JSON.parse(fs.readFileSync(pobSetPath, 'utf8')).assets[n - 1].address)) },
      async (c, rec) => {
        const opens = Number(filled().charter_opens_at.value)
        while ((await chainNow(conn)) <= opens + 1) await sleep(5000)
        const kp = newKey(`vault-${n}`), set = JSON.parse(fs.readFileSync(pobSetPath, 'utf8'))
        const plan = planClaim(ids(), SITE, await claimSnapshot(), kp.publicKey, set.assets[n - 1].address)
        if (!plan.ok) throw new Error(`the claim page refuses: ${plan.refuse.join('; ')}`)
        return send(rec, [plan.ix], [key('holder'), kp])
      })
  }
  const revealed = async n => { const a = vaultAddr(n); if (!a) return false; const v = await readVault(conn, ids(), a); return !!v?.record && v.record.level >= 1 && v.record.level <= 5 }
  async function crankUntil(rec, lane, until, maxPasses, gapMs) {
    const passes = rec.passes ||= []
    for (let i = 0; i < maxPasses; i++) {
      if (await until()) return passes
      const r = job('crank.mjs', lane === 'reveal' ? ['--live', '--reveal-only'] : ['--live'], crankEnv())
      passes.push({ at: new Date().toISOString(), lane, code: r.code, tail: r.out.trim().split('\n').slice(-3).join(' | ').slice(0, 400) }); ctx.save()
      if (r.code !== 0) throw new Error(`the crank (${lane}) exited ${r.code}: ${passes.at(-1).tail}`)
      await sleep(gapMs)
    }
    if (!(await until())) throw new Error(`after ${maxPasses} ${lane} passes the crank had not done it`)
    return passes
  }
  step('crank-reveal-charter', 'the crank\'s reveal lane, live, until the three charter vaults are revealed', async () => 3 * 30_000,
    async () => (await Promise.all(['vault-1', 'vault-2', 'vault-3'].map(revealed))).every(Boolean),
    async (c, rec) => crankUntil(rec, 'reveal', async () => (await Promise.all(['vault-1', 'vault-2', 'vault-3'].map(revealed))).every(Boolean), 40, 15_000))

  step('provision-tokens', 'the holder\'s cbBTC, $GARY and $GIRAFFISH for two buys, one activation deposit and the payout',
    async () => 3 * 2_100_000,
    async () => (await tokBal(ata(key('holder').publicKey, CBBTC))) >= NEED.cbbtc || st.boughtAll === true,
    async (c, rec) => {
      const h = key('holder').publicKey, ixs = []
      for (const [m, amt] of [[CBBTC, NEED.cbbtc], [GARY, NEED.gary], [GIRAFFISH, NEED.giraffish]]) {
        ixs.push(spl.createAssociatedTokenAccountIdempotentInstruction(funding.publicKey, ata(h, m), h, m))
        if (ctx.network === 'local') ixs.push(spl.createMintToInstruction(m, ata(h, m), ctx.localMintAuth.publicKey, amt))
        else {
          const have = await tokBal(ata(funding.publicKey, m))
          if (have < amt) throw new Error(`the deploy wallet holds ${have} of ${m.toBase58()}; the rehearsal needs ${amt}. Send it there first.`)
          ixs.push(spl.createTransferInstruction(ata(funding.publicKey, m), ata(h, m), funding.publicKey, amt))
        }
      }
      return send(rec, ixs, ctx.network === 'local' ? [funding, ctx.localMintAuth] : [funding])
    })

  // a sale round, voted in by the three charter vaults (the ruled 21% / 51%), then two buys
  const u64b = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
  const i64b = n => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b }
  const u32b = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
  const K = (k, sg, w) => ({ pubkey: new PublicKey(k), isSigner: sg, isWritable: w })
  step('sale-round', `a sale round (price ${PRICE} sats, cap ${ROUND_CAP}) proposed, voted YES by the charter vaults, executed`,
    async () => 10_000_000,
    async () => { const c = (await readConfigs(conn, ids())).mint; return Number(c.round_id) >= 1 && BigInt(c.price) === PRICE },
    async (c, rec) => {
      const i = ids(), h = key('holder')
      // GOV refuses any proposal before the charter window closes (CharterNotClosed)
      const closes = Number(values().charterClosesAt)
      while ((await chainNow(conn)) <= closes + 1) await sleep(10_000)
      const gov = await anchorAccount(conn, 'GovConfig', i.GOV_CFG, i.GOV_PROG)
      let id = st.proposalId
      if (!id) { id = Number(gov.proposal_count) + 1; st.proposalId = id; ctx.save() }
      const prop = PublicKey.findProgramAddressSync([Buffer.from('proposal'), u64b(id)], i.GOV_PROG)[0]
      const now = await chainNow(conn)
      if (!(await conn.getAccountInfo(prop, 'confirmed'))) {
        const ends = now + Number(values().minVotingSecs) + 5
        st.proposalEnds = ends; ctx.save()
        const act = Buffer.concat([Buffer.from([0]), i64b(now - 60), i64b(now + 4 * 3600), u64b(PRICE), u32b(ROUND_CAP)])
        await send(rec, [new TransactionInstruction({ programId: i.GOV_PROG, data: Buffer.concat([disc('create_proposal'), u32b(1), act, i64b(ends)]),
          keys: [K(i.GOV_CFG, false, true), K(prop, false, true), K(i.MINT_CFG, false, false), K(i.BURN_CFG, false, false), K(vaultAddr('vault-1'), false, false), K(h.publicKey, true, true), K(SystemProgram.programId, false, false)] })], [h])
      }
      for (const n of ['vault-1', 'vault-2', 'vault-3']) {
        const v = vaultAddr(n), vote = PublicKey.findProgramAddressSync([Buffer.from('vote'), prop.toBuffer(), v.toBuffer()], i.GOV_PROG)[0]
        if (await conn.getAccountInfo(vote, 'confirmed')) continue
        await send(rec, [new TransactionInstruction({ programId: i.GOV_PROG, data: Buffer.concat([disc('cast_vote'), Buffer.from([1])]),
          keys: [K(i.GOV_CFG, false, false), K(prop, false, true), K(vote, false, true), K(v, false, false), K(i.vaultRecord(v), false, false), K(h.publicKey, true, false), K(h.publicKey, true, true), K(SystemProgram.programId, false, false)] })], [h])
      }
      while ((await chainNow(conn)) <= Number(st.proposalEnds) + 1) await sleep(5000)
      return send(rec, [new TransactionInstruction({ programId: i.GOV_PROG, data: disc('execute_proposal'),
        keys: [K(i.GOV_CFG, false, true), K(prop, false, true), K(i.MINT_CFG, false, true), K(i.GOV_PDA, false, false), K(i.MINT_PROG, false, false)] })], [key('stranger')])
    })
  for (let n = 4; n <= 5; n++) {
    step(`buy-${n}`, `buy vault-${n} at ${PRICE} sats through the buy page's plan`, async () => 6_000_000,
      async () => { const x = await assetOf(vaultAddr(`vault-${n}`)); return !!x && x.owner === key('holder').publicKey.toBase58() },
      async (c, rec) => {
        const i = ids(), h = key('holder').publicKey, kp = newKey(`vault-${n}`), cfg = (await readConfigs(conn, i)).mint
        const payer = await conn.getAccountInfo(ata(h, cfg.payment_mint), 'confirmed')
        const plan = planBuy(i, SITE, { mintConfig: cfg, nowSec: await chainNow(conn), owner: h.toBase58(), payerToken: payer ? parseTokenAccount(payer.data) : null,
          revenueTokenExists: !!(await conn.getAccountInfo(ata(i.REVENUE, cfg.payment_mint), 'confirmed')) }, kp.publicKey)
        if (!plan.ok) throw new Error(`the buy page refuses: ${plan.refuse.join('; ')}`)
        const sig = await send(rec, [plan.ix], [key('holder'), kp])
        if (n === 5) { st.boughtAll = true; ctx.save() }
        return sig
      })
  }
  step('crank-reveal-sold', 'the crank\'s reveal lane until the two sold vaults are revealed (the census is then exhausted)', async () => 2 * 30_000,
    async () => (await Promise.all(['vault-4', 'vault-5'].map(revealed))).every(Boolean),
    async (c, rec) => crankUntil(rec, 'reveal', async () => (await Promise.all(['vault-4', 'vault-5'].map(revealed))).every(Boolean), 40, 15_000))

  step('deposit-activate', 'vault-1 loaded with 21,000 sats, $GARY and $GIRAFFISH, then activation requested (the vault page\'s plan)',
    async () => 3 * 2_100_000,
    async () => { const v = await readVault(conn, ids(), vaultAddr('vault-1')); return !!v?.record && (v.record.pending === true || v.record.active === true) },
    async (c, rec) => {
      const i = ids(), h = key('holder'), pda = i.depositAddress(vaultAddr('vault-1')), ixs = []
      for (const [m, amt] of [[CBBTC, 21_000n], [GARY, NEED.gary / 2n], [GIRAFFISH, NEED.giraffish / 2n]]) {
        ixs.push(spl.createAssociatedTokenAccountIdempotentInstruction(h.publicKey, ata(pda, m), pda, m))
        const have = await tokBal(ata(pda, m)); if (have < amt) ixs.push(spl.createTransferInstruction(ata(h.publicKey, m), ata(pda, m), h.publicKey, amt - have))
      }
      await send(rec, ixs, [h])
      const v = await readVault(conn, i, vaultAddr('vault-1'))
      const act = planActivate(i, (await readConfigs(conn, i)).mint, vaultAddr('vault-1'), v.info, v.record, parseTokenAccount((await conn.getAccountInfo(ata(pda, CBBTC))).data))
      if (!act.ok) throw new Error(`the vault page refuses activation: ${JSON.stringify(act)}`)
      return send(rec, [act.ix], [h])
    })

  // ITEM 22.1: the crank's FULL lane, live, until it has split the sales revenue,
  // run a distribution, and joined vault-1 (which then holds a share)
  step('crank-full', 'ITEM 22.1: the crank\'s full lane, live, until the sales are split, a payout runs and vault-1 is joined and owed a share',
    async () => 10 * 30_000,
    async () => { const v = await readVault(conn, ids(), vaultAddr('vault-1')); return !!v?.record?.active && st.crankFullOk === true },
    async (c, rec) => {
      const i = ids()
      const startEpoch = BigInt((await readConfigs(conn, i)).mint.dist_epoch)
      const passes = await crankUntil(rec, 'full', async () => {
        const cfg = (await readConfigs(conn, i)).mint, v = await readVault(conn, i, vaultAddr('vault-1'))
        return !!v?.record?.active && BigInt(cfg.dist_epoch) >= startEpoch + 2n
      }, 60, 30_000)
      st.crankFullOk = true; ctx.save()
      // V45-8: five vaults prove the crank's live I/O, not its scale (SPEC item 22: ~2,100)
      item(1, 'PASS at 5 vaults (scale not exercised)', { passes: passes.length, everyPassExited0: passes.every(p => p.code === 0), log: '.rehearsal-run/crank.mjs.log',
        scale: 'not exercised: SPEC item 22 names ~2,100 vaults (cost, rate limits, paging, a transient RPC error deep in the walk); that stays open' })
      return passes.length
    })

  // ITEM 22.2: the alarm, live, in rehearsal mode, its notices to the rehearsal log only
  const alarmStep = (n, when) => step(`alarm-pass-${n}`, `ITEM 22.2: the alarm's live pass in rehearsal mode (${when}); notices to .rehearsal-run/notices.log only`,
    async () => 0, async () => !!st[`alarm${n}`],
    async () => {
      const r = job('alarm.mjs', [], {})
      const kinds = [...new Set((r.out.match(/^\s*(CRITICAL|HIGH|MEDIUM|LOW|INFO)\b[^\n]*$/gm) || []).map(x => x.trim().slice(0, 160)))]
      if (r.code === 3 || r.code === 2) throw new Error(`the alarm did not complete (exit ${r.code}): ${r.out.trim().split('\n').slice(-3).join(' | ')}`)
      if (!/REHEARSAL/.test(r.out)) throw new Error('the alarm\'s report does not say REHEARSAL; it must, in rehearsal mode')
      // V45-1 (22.2): a CRITICAL the rehearsal does not explain is a FAIL. The only one
      // explained: no revenue ledger yet, while no revenue cycle has run on this tree.
      const explained = fs.existsSync(path.join(ROOT, 'bank', 'revenue-ledger.json')) ? [] : ['revenue_ledger_unreadable']
      const j = judgeAlarmPass({ code: r.code, out: r.out, explained })
      st[`alarm${n}`] = { code: r.code, findings: kinds, verdict: j.verdict, why: j.why, explained }; ctx.save()
      if (n === 2) { const a = [st.alarm1, st.alarm2]; const fail = a.find(x => x?.verdict !== 'PASS')
        item(2, fail ? 'FAIL' : 'PASS', { pass1: st.alarm1, pass2: st.alarm2, notices: '.rehearsal-run/notices.log', ...(fail ? { why: fail.why } : {}) }) }
      return st[`alarm${n}`]
    })
  alarmStep(1, 'after the payout')

  // ITEMS 22.3 and 22.4: the revenue cycle needs the real pinned pools and Pyth.
  const poolsHere = async () => !!(await conn.getAccountInfo(ORCA.pool, 'confirmed')) && !!(await conn.getAccountInfo(METEORA.pool, 'confirmed'))
  const ledger = () => { const f = path.join(ROOT, 'bank', 'revenue-ledger.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { cycles: [] } }
  const closedCycles = () => (ledger().cycles || []).filter(c => c.swapSig && c.returnSig && (c.splitSig || c.splitByOther))
  // V45-5: cycle n is done when n cycles have CLOSED, whatever venue each used: a
  // genuine Orca refusal closes cycle 1 on Meteora, a recorded outcome. Item 22.3 is
  // then judged by its purpose, one closed cycle on EACH venue (judgeRevenueCycles).
  const revenueCycle = (n, venueWant, extraEnv) => step(`revenue-cycle-${n}`, `ITEM 22.3: one full live revenue cycle (sweep, swap ${venueWant === 'orca' ? 'on Orca unless it refuses for real' : 'with Orca forced to refuse, so on Meteora'}, return, split, ledger closed, --audit clean)`,
    async () => 60_000_000,
    async () => st[`rev${n}`] === 'not-here' || closedCycles().length >= n,
    async (c, rec) => {
      if (!(await poolsHere())) { st[`rev${n}`] = 'not-here'; ctx.save(); item(3, 'NOT-RUN-HERE', 'the pinned Orca/Meteora pools and Pyth are not on this cluster: the cycle can only run on mainnet (a local fork clones Pyth once and it is stale after 180 s)'); return 'not-here' }
      const i = ids()
      await waitCooldown()
      await topUp(i.REVENUE, Math.round(0.05 * SOL) + Number(values().solReserveLamports), rec)
      const r = job('revenue.mjs', ['--live'], revEnv(extraEnv))
      if (r.code !== 0) throw new Error(`revenue.mjs --live exited ${r.code}: ${r.out.trim().split('\n').slice(-4).join(' | ')}`)
      const a = job('revenue.mjs', ['--audit'], revEnv())
      if (a.code !== 0) throw new Error(`--audit is not clean after cycle ${n}: ${a.out.trim().split('\n').slice(-4).join(' | ')}`)
      const cyc = closedCycles()[n - 1]
      if (!cyc) throw new Error(`revenue.mjs --live exited 0 but cycle ${n} did not close`)
      if (n === 2) { const j = judgeRevenueCycles(closedCycles()); item(3, j.verdict, { orca: j.orca, meteora: j.meteora, ...(j.why ? { why: j.why } : {}) }) }
      return { venue: cyc.swapVenue, wanted: venueWant, sweepSig: cyc.sweepSig, swapSig: cyc.swapSig, returnSig: cyc.returnSig, splitSig: cyc.splitSig }
    })
  async function waitCooldown() {
    const cfg = (await readConfigs(conn, ids())).mint
    const last = Number(cfg.last_sweep_at ?? 0), cd = Number(cfg.sweep_cooldown_secs ?? values().sweepCooldownSecs)
    while (last && (await chainNow(conn)) < last + cd + 5) await sleep(30_000)
  }
  async function topUp(addr, lamports, rec) { const have = await conn.getBalance(addr, 'confirmed'); if (have < lamports) await send(rec, [SystemProgram.transfer({ fromPubkey: funding.publicKey, toPubkey: addr, lamports: lamports - have })], [funding]) }
  revenueCycle(1, 'orca', {})
  revenueCycle(2, 'meteora', { CBOB_REHEARSAL_FORCE_ORCA_REFUSAL: '1' })
  // V45-1 (22.4): the failure is SENT in one step and JUDGED in the next, because the
  // alarm stays quiet on an open cycle for its whole grace (an hour): the judge waits
  // it out and requires the specific `[unreconciled_swap]` CRITICAL, nothing looser.
  const openCycles = () => (ledger().cycles || []).filter(x => x.sweepSig && !x.returnSig && !x.splitSig && !x.splitByOther)
  step('revenue-forced-failure', 'ITEM 22.4: a cycle whose sweep lands and then fails (the open cycle is then in the ledger)',
    async () => 60_000_000,
    async () => st.rev4 === 'not-here' || openCycles().length === 1,
    async (c, rec) => {
      if (!(await poolsHere())) { st.rev4 = 'not-here'; ctx.save(); item(4, 'NOT-RUN-HERE', 'needs the real pools and Pyth (mainnet only)'); return 'not-here' }
      const i = ids()
      await waitCooldown(); await topUp(i.REVENUE, Math.round(0.05 * SOL) + Number(values().solReserveLamports), rec)
      const f = job('revenue.mjs', ['--live'], revEnv({ CBOB_REHEARSAL_FAIL_AFTER_SWEEP: '1' }))
      if (f.code === 0 || !/REHEARSAL \(item 22\.4\)/.test(f.out)) throw new Error(`the forced failure did not happen as designed (exit ${f.code})`)
      const o = openCycles()
      if (o.length !== 1) throw new Error(`expected one open cycle after the forced failure, found ${o.length}`)
      st.forcedCycleStartedAt = o[0].startedAt; ctx.save()
      return { startedAt: o[0].startedAt, sweepSig: o[0].sweepSig }
    }, { resumable: true })
  step('revenue-forced-alarm', 'ITEM 22.4: the alarm raises [unreconciled_swap] CRITICAL once its 60-minute grace has passed; the next run is refused at the open-cycle guard',
    async () => 0,
    async () => st.rev4 === 'not-here' || !!st.forcedFailure,
    async () => {
      const started = Date.parse(openCycles()[0]?.startedAt ?? st.forcedCycleStartedAt)
      if (!Number.isFinite(started)) throw new Error('no open cycle to judge')
      while (Date.now() < started + ALARM_GRACE_MS + 60_000) await sleep(60_000)
      let critical = false, passes = 0
      for (; passes < 6 && !critical; passes++) { const a = job('alarm.mjs', [], {}); critical = judgeForcedFailureAlarm(a.out); if (!critical) await sleep(60_000) }
      const again = job('revenue.mjs', ['--live'], revEnv())
      const guarded = again.code !== 0 && /never recorded a cbBTC return/.test(again.out)
      st.forcedFailure = { alarmCritical: critical, alarmPasses: passes, guarded, open: openCycles().length }; ctx.save()
      if (!critical || !guarded) throw new Error(`item 22.4 checks failed: [unreconciled_swap] CRITICAL ${critical}, open-cycle guard ${guarded}`)
      return st.forcedFailure
    })
  step('revenue-hand-recovery', 'ITEM 22.4: the open cycle recovered BY HAND as SPEC limit 10 says, then --audit clean',
    async () => 1_000_000,
    async () => st.rev4 === 'not-here' || st.handRecovered === true,
    async () => {
      const { handRecover } = await import('./rehearsal-recover.mjs')
      const out = await handRecover({ ROOT, conn, ids: ids(), operator: key('swap-operator'), bankWallet: key('treasury').publicKey })
      const a = job('revenue.mjs', ['--audit'], revEnv())
      if (a.code !== 0) throw new Error(`--audit is not clean after the hand recovery: ${a.out.trim().split('\n').slice(-4).join(' | ')}`)
      st.handRecovered = true; ctx.save(); item(4, 'PASS', { ...st.forcedFailure, recovery: out })
      return out
    })

  // a vault nested in another's deposit address: the crank rescues it to the treasury (V43-1)
  // V45-4: every transfer goes through send() (its signature recorded first), and the
  // run is IDEMPOTENT on read-back: it looks at where vault-3 is and sends only what is
  // missing, so a lost confirmation resumes (--resume rescue) instead of bricking.
  step('rescue', 'vault-3 sent into vault-2\'s deposit address; the crank\'s full pass rescues it to the treasury, which returns it',
    async () => 2 * 30_000,
    async () => { const x = await assetOf(vaultAddr('vault-3')); return !!x && x.owner === key('holder').publicKey.toBase58() && st.nestedSent === true },
    async (c, rec) => {
      const i = ids(), holder = key('holder').publicKey.toBase58(), treasury = key('treasury').publicKey.toBase58()
      const nest = i.depositAddress(vaultAddr('vault-2')).toBase58()
      let x = await assetOf(vaultAddr('vault-3'))
      if (x.owner === holder && !st.nestedSent) {
        await send(rec, coreTransferIxs(key('holder'), vaultAddr('vault-3'), new PublicKey(nest)), [key('holder')])
        st.nestedSent = true; ctx.save(); x = await assetOf(vaultAddr('vault-3'))
      }
      if (x.owner === nest) {
        await crankUntil(rec, 'full', async () => (await assetOf(vaultAddr('vault-3'))).owner === treasury, 5, 10_000)
        x = await assetOf(vaultAddr('vault-3'))
      }
      if (x.owner === treasury) await send(rec, coreTransferIxs(key('treasury'), vaultAddr('vault-3'), new PublicKey(holder)), [key('treasury')])
      if ((await assetOf(vaultAddr('vault-3'))).owner !== holder) throw new Error(`vault-3 is with ${(await assetOf(vaultAddr('vault-3'))).owner}, not back with the holder`)
      st.rescued = true; ctx.save(); return 'rescued by the crank to the treasury, returned to the holder'
    }, { resumable: true })

  // the crack: vault-1 (active, owed a share) opened through the redeem page's plan
  step('crack', 'vault-1 opened (cracked) through the redeem page\'s plan: claim first, sweep, burn',
    async () => 2 * 2_100_000,
    async () => await isBurned(vaultAddr('vault-1')),
    async (c, rec) => {
      const i = ids(), P = profile(), h = key('holder')
      let plan = planRedemption(i, await readRedemptionSnapshot(P, conn, i, h.publicKey, vaultAddr('vault-1')))
      if (plan.refuse.length) throw new Error(`the redeem page refuses: ${plan.refuse.join('; ')}`)
      for (const g of plan.prior) await send(rec, g.map(x => x.ix), [h])
      for (;;) { const s = await readRedemptionSnapshot(P, conn, i, h.publicKey, vaultAddr('vault-1')); if (rateLimit(s.burnConfig, s.mintConfig, s.nowSec).allowed) break; await sleep(5000) }
      plan = planRedemption(i, await readRedemptionSnapshot(P, conn, i, h.publicKey, vaultAddr('vault-1')))
      if (plan.refuse.length || plan.prior.length) throw new Error(`the redeem page still wants: ${JSON.stringify({ refuse: plan.refuse, prior: plan.prior.length })}`)
      const before = await tokBal(ata(h.publicKey, CBBTC))
      const sig = await send(rec, plan.redemption, [h])
      return { sig, cbbtcReceived: String((await tokBal(ata(h.publicKey, CBBTC))) - before) }
    })

  // ITEM 22.5: one DAS read of the collection now holding a burned Core asset
  step('das-read', 'ITEM 22.5: one DAS read of the vault collection holding the cracked (burned) vault', async () => 0,
    async () => !!st.das,
    async () => {
      if (ctx.network !== 'mainnet') { st.das = 'not-here'; ctx.save(); item(5, 'NOT-RUN-HERE', 'a local validator has no DAS; this read is mainnet only'); return 'not-here' }
      const { jobRpc } = await import('../bank/rehearsal-env.mjs')
      const r = await fetch(jobRpc(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id: vaultAddr('vault-1').toBase58() } }) })
      const j = await r.json()
      st.das = { burnt: j?.result?.burnt ?? null, error: j?.error?.message ?? null }; ctx.save()
      // V45-1 (22.5): only a boolean `burnt` answers the question; an error is a FAIL
      item(5, judgeDas(st.das), { question: 'does DAS set burnt on a burned Core asset?', answer: st.das })
      return st.das
    })
  alarmStep(2, 'at the end, after the crack and the revenue cycles')

  // everything the throwaway roles hold comes back. What CANNOT come back is stated (V45-7):
  // the throwaway $CBOB supply and its account's rent (cbob-release), the rehearsal pool's
  // remainder, and the configs' and records' rent, which the closed programs can no longer
  // release. The deployer is swept last, after it has signed the closes.
  step('sweep-back', 'the roles\' cbBTC, $GARY, $GIRAFFISH and SOL back to the funding wallet (the $CBOB supply, the pool remainder and config/record rent stay behind)', async () => 50_000,
    async () => st.sweptBack === true,
    async (c, rec) => {
      const out = {}
      for (const r of ['holder', 'treasury', 'crank', 'swap-operator', 'stranger', 'guardian', 'pob-authority', 'cbob-release']) {
        const k = key(r), ixs = []
        for (const m of [CBBTC, GARY, GIRAFFISH]) { const b = await tokBal(ata(k.publicKey, m)); if (b > 0n) ixs.push(
          spl.createAssociatedTokenAccountIdempotentInstruction(funding.publicKey, ata(funding.publicKey, m), funding.publicKey, m),
          spl.createTransferInstruction(ata(k.publicKey, m), ata(funding.publicKey, m), k.publicKey, b)) }
        for (const m of [CBBTC, GARY, GIRAFFISH]) if (await conn.getAccountInfo(ata(k.publicKey, m), 'confirmed')) ixs.push(spl.createCloseAccountInstruction(ata(k.publicKey, m), funding.publicKey, k.publicKey))
        const lam = await conn.getBalance(k.publicKey, 'confirmed')
        if (lam > 0) ixs.push(SystemProgram.transfer({ fromPubkey: k.publicKey, toPubkey: funding.publicKey, lamports: lam }))
        if (ixs.length) { out[r] = await send(rec, ixs, [funding, k], funding) }
      }
      // the public init key's dust, if any survived its in-transaction funding
      const dust = await conn.getBalance(INIT.publicKey, 'confirmed')
      if (dust > 0) out.init = await send(rec, [SystemProgram.transfer({ fromPubkey: INIT.publicKey, toPubkey: funding.publicKey, lamports: dust })], [funding, INIT], funding)
      st.sweptBack = true; ctx.save(); return out
    })

  // the programs are closed, never made final: their rent comes back. Signed by the
  // throwaway deployer (their upgrade authority); a buffer is closed only by its
  // RECORDED address (V45-3), never every buffer a key owns.
  for (let i = 4; i >= 0; i--) {
    step(`close-${i + 1}`, `close the program deploy-${i + 1} made (and its recorded buffer, if one survived); the rent returns to the funding wallet`, async () => 10_000,
      async () => { const k = nth(i); const b = st.buffers?.[k]
        return (st[`closed_${k}`] === true || !(await conn.getAccountInfo(new PublicKey(ctx.programs[k]), 'confirmed'))) && !(b && await conn.getAccountInfo(new PublicKey(b), 'confirmed')) },
      async () => { const k = nth(i), outs = []
        if (await conn.getAccountInfo(new PublicKey(ctx.programs[k]), 'confirmed'))
          outs.push(solanaCli(['program', 'close', ctx.programs[k], '--authority', deployerPath(), '--keypair', deployerPath(), '--recipient', funding.publicKey.toBase58(), '--bypass-warning']).trim().split('\n').slice(-1)[0])
        const b = st.buffers?.[k]
        if (b && await conn.getAccountInfo(new PublicKey(b), 'confirmed')) outs.push(solanaCli(bufferCloseArgv(b, deployerPath(), funding.publicKey.toBase58())).trim().split('\n').slice(-1)[0])
        st[`closed_${k}`] = true; ctx.save(); return outs.join(' | ') })
  }
  step('sweep-deployer', 'the throwaway deployer\'s remaining SOL back to the funding wallet', async () => 10_000,
    async () => (await conn.getBalance(key('deployer').publicKey, 'confirmed')) === 0,
    async (c, rec) => { const lam = await conn.getBalance(key('deployer').publicKey, 'confirmed')
      return lam > 0 ? send(rec, [SystemProgram.transfer({ fromPubkey: key('deployer').publicKey, toPubkey: funding.publicKey, lamports: lam })], [funding, key('deployer')], funding) : 'empty' })
  return S
}

function require58(sigBytes) { return bs58encode(sigBytes) }
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function bs58encode(buf) {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex')), s = ''
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n }
  for (const b of buf) { if (b === 0) s = '1' + s; else break }
  return s
}

/** The rehearsal record: every step's state and each item-22 verdict, as JSON and markdown. */
export function writeRecord(ctx) {
  const st = ctx.st, base = ctx.A.state
  const items = { 1: 'the crank\'s live passes', 2: 'the alarm\'s live passes in rehearsal mode', 3: 'one full live revenue cycle through each pool', 4: 'one forced post-sweep failure, walked through the hand recovery', 5: 'one DAS read of a collection holding a burned Core asset' }
  // V45-1 (22.2): the verdict is the alarm step's own judgement (judgeAlarmPass), never assumed here
  const rec = { network: st.network, programs: st.programs, funding: st.funding, fundingStartLamports: st.fundingStartLamports, costs: st.costs,
    item22: Object.fromEntries(Object.keys(items).map(n => [n, st.item22[n] || { verdict: 'NOT RUN' }])), steps: st.steps }
  fs.writeFileSync(`${base}.record.json`, JSON.stringify(rec, null, 1))
  const lines = [`# Dress rehearsal record (${st.network})`, '', `Programs: ${Object.entries(st.programs).map(([k, v]) => `${k} \`${v}\``).join(', ')}`, '', '| item 22 | verdict |', '|---|---|',
    ...Object.entries(items).map(([n, t]) => `| ${n}. ${t} | ${rec.item22[n].verdict} |`), '', '| step | status | funding wallet delta (lamports) |', '|---|---|---|',
    ...Object.entries(st.steps).map(([k, v]) => `| ${k} | ${v.status} | ${st.costs[k] ?? ''} |`)]
  fs.writeFileSync(`${base}.record.md`, lines.join('\n') + '\n')
}
