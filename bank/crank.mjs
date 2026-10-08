#!/usr/bin/env node
/**
 * THE CRANK — layer one of "everything that can be automatic is" (v6).
 *
 * A Solana program never runs by itself; something has to send a transaction.
 * v6 gives every one of these jobs to ANYONE (they are permissionless) and has
 * ordinary traffic do the urgent ones in-line (Gary, 2026-10-03: "if our server
 * fails #2 picks up and if #2 fails #3 picks up"). This is #1: our own job, run
 * by cron, so that in the normal case nothing waits on a stranger.
 *
 * What one pass does (the order it SENDS is: reschedule, capture, reveal,
 * rescue, retire, join eligible vaults, distribute, activate, claim; see main()):
 *   1. RESCHEDULE every vault whose level-draw window lapsed with no entropy
 *      (never a default level: "We can't lock everyone in the lowest level").
 *   2. CAPTURE entropy for every vault whose three slot hashes now exist.
 *   3. REVEAL levels strictly in mint order, re-sending each vault's minted
 *      attributes, which are read off the asset and checked against the hash
 *      the program stored before anything is sent.
 *   3a. RESCUE every vault nested in another CBOB vault (or in its own deposit
 *      address) to the CBOBTC Squads with MINT's permissionless `rescue_nested`,
 *      which pins that destination (round 43, V43-1). Full pass only.
 *   4. RETIRE vaults destroyed by a bare Core burn (their unpaid share returns
 *      to the pool and they stop counting toward the vote).
 *   5. ACTIVATE every live, revealed vault holding >= 21,000 sats of cbBTC, so
 *      a holder never has to learn the word. Since stage 3c that is a REQUEST:
 *      the vault joins the schedule only after the next distribution.
 *   6. DISTRIBUTE, free, once the period has passed (the monthly path; no burn).
 *      With nobody joined yet but vaults waiting, that run credits nothing and
 *      only advances the epoch so they can join (the launch case).
 *   7. DELIVER claims in batches of 14 to every vault owed a whole sat, skipping
 *      (and reporting) a frozen cbBTC account rather than wasting a fee on it,
 *      and JOIN every waiting vault a distribution has passed, in those batches.
 *
 * WHAT IT CAN NEVER DO: move value anywhere but where the program already sends
 * it. Every one of these instructions is permissionless and pins its own
 * destination; the crank's key signs only as FEE PAYER. It pays transaction fees
 * AND, on every reveal, Core's rent for the `level` attribute the reveal writes
 * (about 0.0001 SOL each, round 23 L14), so reveals are budgeted to keep a fixed floor in reserve.
 * That key is a dedicated low-balance wallet (`bank/keys/crank.json`). Above a
 * small ceiling the crank still RUNS and WARNS, once a day (round 22 F8:
 * refusing let anyone stop every lane by sending it 0.25 SOL); the excess is a
 * honeypot a human must move.
 *
 * Every LIVE full pass ends by stamping `bank/.crank-heartbeat` (round 23 M3),
 * so the alarm can page when an armed crank stops completing passes.
 *
 * DEFAULTS TO DRY RUN: it plans and prints. `--live` sends. Installed opt-in,
 * like revenue.mjs: arming it is a launch decision, not a side effect of
 * installing the crontab.
 *
 *   node bank/crank.mjs                        # plan only
 *   node bank/crank.mjs --live                 # plan and send
 *   node bank/crank.mjs --reveal-only [--live] # the every-minute fast lane:
 *                                              # reschedule, capture, reveal only
 */
import fs from 'fs'
import { createHash } from 'crypto'
import { fileURLToPath } from 'url'
import * as L from './layout.mjs'
import { pendingSats, pendingScaled, available, ACC_SCALE } from './accrual.mjs'
import { defangForRouter, detectNestedVaults, rehearsalNotice, REHEARSAL_MARKER } from './detectors.mjs'

export const CORE_ID = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
export const SLOT_HASHES_ID = 'SysvarS1otHashes111111111111111111111111111'
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111'
/** Fee-payer bounds. The ceiling is the honeypot line: above it the crank runs
 *  and warns (round 22 F8), it is never refused for holding too much. The floor
 *  is the least a pass may start with; a plan that costs more raises it. */
export const FEE_CEILING_LAMPORTS = 250_000_000n     // 0.25 SOL
export const FEE_FLOOR_LAMPORTS = 5_000_000n          // 0.005 SOL
/** Round 23 (L14): one signature per transaction, and Core's rent for the
 *  `level` attribute each reveal writes: up to 16 bytes at 6,960 lamports/byte. */
export const SIG_FEE_LAMPORTS = 5_000n
export const REVEAL_RENT_LAMPORTS = 16n * 6_960n

/** What a plan costs its fee payer, at most: every transaction main() sends, plus
 *  the attribute rent of every reveal. Pure, so the floor is proven both ways. */
export function planCostLamports(p) {
  const ceil = (n, k) => BigInt(Math.ceil(n / k))
  const txs = BigInt(p.reschedule.length + p.capture.length + p.reveal.length + (p.rescue?.length ?? 0) + p.retireBurned.length + p.activate.length
    + p.claims.length + (p.split ? 1 : 0) + (p.distribute ? 1 : 0))
    + ceil(p.preJoins.length, L.CLAIM_BATCH) + ceil(p.preExpires.length, L.EXPIRE_BATCH) + ceil(p.postExpires.length, L.EXPIRE_BATCH)
  return txs * SIG_FEE_LAMPORTS + BigInt(p.reveal.length) * REVEAL_RENT_LAMPORTS
}

/** Round 23 (L14): the over-ceiling warning went out on EVERY run, including the
 *  every-minute lane, i.e. 1,440 identical emails a day. Once a day is enough
 *  to get a honeypot moved. `lastSec` null means never warned. */
export function warnDue(lastSec, nowSec, everySecs = 24 * 3600) {
  return !(Number(lastSec) > 0) || Number(nowSec) - Number(lastSec) >= everySecs
}

/**
 * RACES ARE NOT FAILURES (round 22, F1/F2). Ordinary traffic captures and
 * reveals too, the two lanes overlap, and `readySlot` is only a LOWER bound when
 * a leader skipped a slot. Each of these refusals means "already done" or "not
 * yet", and the next pass picks it up; the alarm's reveal_queue_stalled and
 * crank_silent are what page if nothing ever moves.
 *
 * Round 23 (L1) added the races round 22 missed: a vault retired by someone else
 * (`AlreadyRetired`), a holder activating first (`AlreadyActive`, `VaultRetired`,
 * `ActivationPending`), and a capture window that closed between plan and send
 * (`RevealWindowExpired`, `NeedsReschedule`). Round 43 (V43-1): a rescue whose
 * vault is no longer nested (`NotNested`: rescued by someone else, or taken out by
 * its host's owner since the plan). NOT benign, and asserted: a refusal
 * that means OUR plan is wrong (`BoostsExpireFirst`, `JoinWaitingFirst`) or the
 * key is empty.
 */
export const BENIGN = /RevealTooEarly|AlreadyCaptured|AlreadyRevealed|RevealOutOfOrder|RescheduleTooEarly|MonthNotElapsed|AlreadyRetired|AlreadyActive|VaultRetired|ActivationPending|RevealWindowExpired|NeedsReschedule|NothingToSplit|NotNested/

/** Confirmation failures can carry only a numeric custom code. Retrieve their
 * logs once, with a bound; only a named Anchor error emitted by MINT itself is
 * eligible for race handling. CPI errors and unavailable logs remain failures. */
export async function mintFailureCode(error, conn, { timeoutMs = 5000 } = {}) {
  let logs = error?.logs
  if ((!Array.isArray(logs) || !logs.length) && typeof error?.getLogs === 'function') {
    let timer
    try { logs = await Promise.race([error.getLogs(conn), new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs) })]) }
    catch { logs = null }
    finally { clearTimeout(timer) }
  }
  const stack = []
  let code = null
  for (const line of Array.isArray(logs) ? logs : []) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line)
    if (invoke) { stack.push(invoke[1]); continue }
    const anchor = /^Program log: AnchorError\b.*\bError Code: (\w+)\./.exec(line)
    if (anchor && stack.at(-1) === L.PROGRAM_IDS.mint) code = anchor[1]
    const end = /^Program (\w+) (success|failed:.*)$/.exec(line)
    if (end) {
      if (stack.at(-1) !== end[1]) return null
      stack.pop()
      if (end[1] === L.PROGRAM_IDS.mint && end[2].startsWith('failed:')) return code
      if (end[1] === L.PROGRAM_IDS.mint) code = null
    }
  }
  return null
}

/**
 * A REFUSED DISTRIBUTION THAT SOMEONE ELSE'S DISTRIBUTION EXPLAINS (round 24, L1).
 *
 * `split_revenue` is anyone's, every hour, so a stranger splitting between our
 * plan and our send leaves `NothingToSplit`: in `BENIGN` above. A distribution is
 * subtler. MINT checks `boosts_due` (BoostsExpireFirst), then `JoinWaitingFirst`
 * on the tick, then PoolShort / NothingToDistribute, all BEFORE `MonthNotElapsed`,
 * so a host's in-line monthly run or a 100 $GARY burn landing between plan and
 * send is refused with one of THOSE, never the benign code, and paged "action
 * failed" (and under H1 kept the crank's stream open for a griefer). So: on a
 * refused distribute the caller re-reads the config, and the race codes are
 * benign exactly when `dist_epoch` or `last_distribute_at` MOVED since the plan,
 * i.e. somebody else distributed. Unmoved, they mean our plan was wrong: a fault.
 * `PoolShort` is never a race (the pool holds less than it owes): always a fault.
 */
export const DISTRIBUTE_RACE = /NothingToDistribute|BoostsExpireFirst|JoinWaitingFirst/
export function judgeDistributeRefusal(message, planned, fresh) {
  const m = String(message ?? '')
  if (/PoolShort/.test(m)) return 'fail'
  if (BENIGN.test(m)) return 'benign'
  if (!DISTRIBUTE_RACE.test(m) || !planned || !fresh) return 'fail'
  const moved = String(planned.dist_epoch) !== String(fresh.dist_epoch)
    || String(planned.last_distribute_at) !== String(fresh.last_distribute_at)
  return moved ? 'benign' : 'fail'
}

/**
 * RESCUE WHAT IS NESTED, EVERY PASS (round 43, V43-1). A vault sent into another
 * live vault's deposit address can be kept by that vault's owner, who opens
 * their own vault before anyone runs the rescue: the opening may move anything in
 * its wallet. The rescue is permissionless and MINT pins its destination (the
 * CBOBTC Squads, which returns it to whoever sent it), so the crank sends it
 * itself instead of waiting for the sender to notice.
 *
 * Which ones: exactly the vaults `detectNestedVaults` names (`nested_vault`,
 * `vault_owns_itself`), whose host is therefore one of OUR vaults, and only when
 * the program would take it: the nested vault reads LIVE, and its host is itself,
 * a LIVE vault, or a POSITIVELY burned one. A host that reads as anything else
 * (a null RPC answer) waits for the next pass. A vault in a FOREIGN asset's
 * wallet is never in the list (the detector names it `unredeemable_owner`), as
 * MINT refuses it `HostUnresolved`. Pure; the destination is added by main().
 *
 * @param vaults  [{ id, owner }] for every vault record, owner null when unread
 * @param pdaOf   id -> asset-signer PDA
 * @param assets  { [id]: 'live' | 'burned' | 'other' }
 */
export function planRescues(vaults, pdaOf, assets = {}) {
  const hostOf = new Map()
  for (const v of vaults) { const p = pdaOf(v.id); if (p) hostOf.set(p, v.id) }
  const ownerOf = new Map(vaults.map(v => [v.id, v.owner]))
  const out = []
  for (const f of detectNestedVaults(vaults, pdaOf, () => true)) {
    if (f.kind !== 'nested_vault' && f.kind !== 'vault_owns_itself') continue
    const host = hostOf.get(ownerOf.get(f.asset))
    if (host === undefined || assets[f.asset] !== 'live') continue
    if (host !== f.asset && assets[host] !== 'live' && assets[host] !== 'burned') continue
    out.push({ vault: f.asset, host })
  }
  return out
}

/** Round 24 (L2): what a reveal sends as the minted attribute list. 'read' it off
 *  a LIVE asset; '[]' only for a positively BURNED one (MINT does not compare a
 *  burned asset's attributes); anything else ('other', a null RPC answer) is
 *  SKIPPED: sent with [] it was refused AttributesMismatch on a live asset, which
 *  broke the lane and paged. Round 23's live-only rule missed this third site. */
export function revealAttrSource(assetState) {
  return assetState === 'live' ? 'read' : assetState === 'burned' ? 'empty' : 'skip'
}
/** Round 24 (L2): the payment mint's decimals as ONE BYTE, or null. A null mint
 *  read made `Buffer.from([undefined])`, which is 00, so a split went out with
 *  decimals 0. */
export function splitDecimalsByte(raw) {
  return Number.isInteger(raw) && raw >= 0 && raw <= 255 ? raw : null
}
/** Round 24 (I2): the chain's own clock (the Clock sysvar's `unix_timestamp`, an
 *  i64 at byte 32). `due` used the box clock, and a box ahead of the chain spent
 *  fees on distributions the program then refused. Null when unreadable. */
export function clockUnixTimestamp(data) {
  if (!data || data.length < 40) return null
  const v = Number(Buffer.from(data).readBigInt64LE(32))
  return Number.isFinite(v) && v > 0 ? v : null
}

/**
 * WHAT A LIVE CRANK PASS TELLS THE ROUTER (round 24, H1, the crank's half).
 * Every page used to share `cbob-vault-crank`, so the first failure opened the
 * stream and every later one, of either lane, was suppressed for 12 hours, and
 * nothing ever closed it. Each lane now has its own stream; a pass with failures
 * pages its FULL list; the first clean live pass after a failing one sends a
 * RECOVERY, so the next failure opens a fresh stream. A lane failing is a LEVEL
 * condition (it re-asserts every pass), so these are never ALERT_URGENT.
 * `prevFailing` is the lane's marker; returns `{ notices, failing }`.
 */
export const CRANK_LABEL = 'cbob-vault-crank'
export function crankNotices({ lane, failures = [], prevFailing = false }) {
  const label = `${CRANK_LABEL}:${lane}`
  if (failures.length) return { failing: true, notices: [{ label, urgent: false,
    text: defangForRouter(`CBOB crank (${lane} lane): ${failures.length} action(s) failed${failures.map(f => `\n- ${f}`).join('')}`).slice(0, 60_000) }] }
  if (prevFailing) return { failing: false, notices: [{ label, urgent: false,
    text: `CBOB crank (${lane} lane) RECOVERED: a live pass completed with no failed action.` }] }
  return { failing: false, notices: [] }
}

/**
 * IS THIS ATTRIBUTE LIST THE ONE THE PROGRAM HASHED? (round 23, M2)
 *
 * 'send'      it hashes to the stored `attrs_hash`: reveal it.
 * 'revealed'  it carries the program-owned `level` key and WITHOUT it hashes to
 *             the stored value: someone (the other lane, or traffic) revealed it
 *             between our plan and our read. MINT appends `level` at the reveal
 *             and refuses it at mint (`ReservedAttribute`), so this is "done
 *             elsewhere", the benign break, never a fault.
 * 'mismatch'  anything else: this reader and the program disagree about the
 *             asset, a fault to page.
 *
 * Both crank lanes plan the same queue head under separate locks, so before this
 * every sale hour's :37 pass could page a false "reader and program disagree".
 */
export function judgeRevealAttrs(list, hash) {
  if (attrsHash(list) === hash) return 'send'
  const minted = list.filter(a => a.key !== 'level')
  if (minted.length < list.length && attrsHash(minted) === hash) return 'revealed'
  return 'mismatch'
}

/** Anchor instruction discriminator: sha256("global:<name>")[..8]. Computed. */
export const ixDisc = n => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8)

/** Borsh `Vec<VaultAttribute>` exactly as the program hashes it. */
export function attrsBorsh(list) {
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
  const str = s => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([u32(b.length), b]) }
  return Buffer.concat([u32(list.length), ...list.flatMap(({ key, value }) => [str(key), str(value)])])
}
/** solana `hashv` is sha256 over the concatenated slices; one slice here. */
export const attrsHash = list => createHash('sha256').update(attrsBorsh(list)).digest('hex')

/** The slot after which all three entropy slot hashes exist on a fork that skips
 *  nothing: each is two 4-slot leader groups past the last (MINT `try_capture`).
 *  Skipped slots only push it later, and a NotYet answer is harmless. */
export function readySlot(revealSlot) {
  let a = Number(revealSlot)
  for (let i = 0; i < 2; i++) a = (Math.floor(a / 4) + 2) * 4
  return a
}

/** The fee payer's balance, judged: refused below the floor (raised to what this
 *  pass's plan costs, `need`), warned above the ceiling. */
export function judgeFeePayer(lamports, { ceiling = FEE_CEILING_LAMPORTS, floor = FEE_FLOOR_LAMPORTS, need = 0n } = {}) {
  const l = BigInt(lamports)
  // ROUND 23 (L14): 0.005 SOL covered about 45 reveals, and a sale hour can queue
  // more. A pass that runs dry halfway stops its reveal run at a failure and
  // pages; refusing it up front names the shortfall instead.
  const min = BigInt(need) > BigInt(floor) ? BigInt(need) : BigInt(floor)
  // ⚠️ ROUND 24 (L6a): THE MINIMUM FIRST. The ceiling branch returned ok before
  // `need` was looked at, so a plan costing more than 0.25 SOL (about 2,100
  // captures plus reveals) passed a key holding less than it needed.
  if (l < min) return { ok: false, why: `the crank key holds ${l} lamports, below the ${min} this pass needs (fees, plus about ${REVEAL_RENT_LAMPORTS} of Core attribute rent per reveal). Top it up.` }
  // OVER THE CEILING: RUN, AND SAY SO (round 22, F8). Refusing protected nothing
  // once the funds were already on the key, and it let ANYONE stop every crank
  // lane by sending it 0.25 SOL. The key still only ever signs as fee payer; the
  // excess is a honeypot a human must move (main() warns once a day, L14).
  if (l > ceiling) return { ok: true, warn: `the crank key holds ${l} lamports, above the ${ceiling} ceiling. It only pays fees and reveal attribute rent, so the excess is a honeypot: move it out. The crank ran anyway.`, why: null }
  return { ok: true, why: null }
}

/**
 * SPEND WHAT THE KEY HAS ON WHAT IS CHEAP FIRST (round 24, L6b). The plan-sized
 * floor was all-or-nothing: a key short of the reveals' attribute rent refused
 * the WHOLE pass, captures included, so draws lapsed into the limit-25 re-roll
 * class until someone topped it up. Now the pass runs everything but the
 * reveals, plus as many reveals (in mint order) as the balance covers, and
 * names the ones it dropped; only a key that cannot cover even the rest is
 * refused. Round 30 (L2): the reveals keep the floor in reserve, and the rest
 * runs whenever it is covered, even below the floor. Returns `{ ok, plan, dropped, warn, why }`.
 */
export function budgetPlan(plan, lamports, { ceiling = FEE_CEILING_LAMPORTS, floor = FEE_FLOOR_LAMPORTS } = {}) {
  const base = { ...plan, reveal: [] }
  // ⚠️ ROUND 30 (L2): THE BASE PLAN RUNS WHENEVER THE KEY COVERS IT, AND THE
  // REVEALS NEVER SPEND THE KEY BELOW THE FLOOR, on EVERY branch. The floor used
  // to gate the base plan too, while reveals were budgeted down to zero (and a
  // key covering the whole plan by one lamport ran every reveal and ended at
  // zero), so the NEXT pass sent nothing, captures included: the very lapse this
  // function exists to prevent.
  const baseJ = judgeFeePayer(lamports, { ceiling, floor: 0n, need: planCostLamports(base) })
  if (!baseJ.ok) return { ok: false, plan, dropped: plan.reveal.length, warn: null,
    why: judgeFeePayer(lamports, { ceiling, floor, need: planCostLamports(plan) }).why }
  const room = BigInt(lamports) - planCostLamports(base) - BigInt(floor)
  const n = room > 0n ? Number(room / (SIG_FEE_LAMPORTS + REVEAL_RENT_LAMPORTS)) : 0
  const keep = Math.max(0, Math.min(plan.reveal.length, n))
  const low = BigInt(lamports) < BigInt(floor)
    ? `the crank key holds ${BigInt(lamports)} lamports, below the ${BigInt(floor)} floor: this pass ran only what it covers and kept the floor for later passes. Top it up.` : null
  return { ok: true, plan: { ...plan, reveal: plan.reveal.slice(0, keep) }, dropped: plan.reveal.length - keep,
    warn: [baseJ.warn, low].filter(Boolean).join(' ') || null, warnKind: low ? 'floor' : baseJ.warn ? 'ceiling' : null, why: null }
}

/**
 * PLAN ONE PASS. Pure: everything it needs is passed in, so it is proven both
 * ways in bank/selftest.mjs and the I/O below is only fetching and sending.
 *
 * @param s.cfg       decoded MintConfig (layout.mjs; BigInt fields)
 * @param s.records   [{ address, ...decoded VaultRecord }]
 * @param s.assets    { [asset]: 'live' | 'burned' | 'other' }
 * @param s.tokens    { [asset]: { state, amount: bigint, frozen, address } } — the
 *                    vault's CANONICAL cbBTC account (for activation), and for an
 *                    active vault its RECORDED account (for claims)
 * @param s.pool      { state, amount: bigint, frozen }
 * @param s.slot      current slot; s.nowSec — current unix time
 */
export function planCrank(s, opts = {}) {
  const { cfg, records, assets = {}, tokens = {}, pool, slot, nowSec, revenue = null, bank = null } = s
  const batch = opts.batch ?? L.CLAIM_BATCH
  // `owed` (round 23, L4): what each vault in a claim batch is owed at the
  // post-distribution accumulator, so the selftest asserts SATS, not batch counts.
  const plan = { reschedule: [], capture: [], reveal: [], retireBurned: [], activate: [],
    split: false, distribute: false, distributeKind: null, preJoins: [], joins: [], claims: [], deferredFrozen: [], problems: [],
    preExpires: [], postExpires: [], owed: {} }
  const byIndex = new Map(records.map(r => [BigInt(r.mint_index), r]))
  const capturedThisPass = new Set()

  for (const r of records) {
    if (r.level !== 0 || r.entropy_set) continue
    const rs = BigInt(r.reveal_slot)
    if (BigInt(slot) > rs + BigInt(L.REVEAL_WINDOW_SLOTS)) plan.reschedule.push(r.address)
    else if (slot > readySlot(r.reveal_slot)) { plan.capture.push(r.address); capturedThisPass.add(r.address) }
  }

  // REVEAL IN MINT ORDER, from `revealed_total`, while the next vault is ready.
  // One not ready stops the run: the program refuses out-of-order draws anyway.
  for (let i = BigInt(cfg.revealed_total); ; i++) {
    const r = byIndex.get(i)
    if (!r || r.level !== 0) break
    if (!(r.entropy_set || capturedThisPass.has(r.address))) break
    plan.reveal.push(r.address)
  }

  // THE FAST LANE ends here. The capture window is ~300 slots (about two
  // minutes), so the reveal steps run every minute with only the unrevealed
  // records fetched; everything below runs on the slower full pass.
  if (opts.revealOnly) return plan

  // RETIRE BARE BURNS. A vault the program has not retired whose asset is
  // positively burned. (A redemption retires itself inside burn_vault.)
  // Round 23 (I1): AT ANY LEVEL. `retire_burned` does not need a drawn level and
  // `reveal_level` does not read `retired`, so an unrevealed bare burn no longer
  // counts as live supply (the vote and the 2.1% cap) until its turn to reveal.
  for (const r of records) {
    if (!r.retired && assets[r.asset] === 'burned') plan.retireBurned.push(r.address)
  }

  // ACTIVATE (a request, stage 3c): revealed, not active, not already waiting,
  // not retired, LIVE, and >= 21,000 sats in its own canonical cbBTC account. A
  // frozen account still activates (the program reads the balance, not the
  // state) — the claim is what defers.
  for (const r of records) {
    if (r.level === 0 || r.active || r.pending || r.retired || assets[r.asset] !== 'live') continue
    const t = tokens[r.asset]
    if (!t || t.state !== 'ok') continue
    if (BigInt(t.amount) >= L.ACTIVATION_SATS) plan.activate.push(r.address)
  }

  // JOIN FIRST (stage 3c). A vault that asked in an EARLIER epoch is eligible, and
  // the program refuses every distribution while one waits (`JoinWaitingFirst`),
  // so they are joined in their own claim batches BEFORE the distribution.
  const destOf = r => r.pending ? r.vault_ata : tokens[r.asset]?.address
  // Round 23 (L2): ONLY A POSITIVELY LIVE ASSET IS JOINED OR PAID. `'other'` is a
  // null RPC answer (a burned Core asset persists as a 1-byte account), and it
  // used to be joined and claimed like a live one. An eligible vault we cannot
  // read is not joined, and since the program refuses every distribution while
  // one waits (`JoinWaitingFirst`), there is no distribution this pass either.
  let unreadableEligible = 0
  for (const r of records) {
    if (r.retired || r.active || !r.pending) continue
    // A burned vault is RETIRED (above), never joined: joining adds weight to a
    // dead vault (red-team 3 finding 2).
    if (assets[r.asset] === 'burned') continue
    if (BigInt(r.request_epoch) >= BigInt(cfg.dist_epoch)) continue
    if (assets[r.asset] !== 'live') { unreadableEligible++; plan.problems.push(`vault ${r.asset} is eligible to join but its asset reads as ${assets[r.asset] ?? 'unread'}; not joined, so no distribution this pass`); continue }
    plan.preJoins.push([r.address, r.vault_ata])
  }
  const preJoinWeight = plan.preJoins.reduce((a, [addr]) => {
    const r = records.find(x => x.address === addr); return a + L.LEVEL_WEIGHTS[r.level - 1] }, 0n)
  // A vault's weight NOW: its level's plus a live $CBOB boost's (2026-10-04).
  const boostOf = r => BigInt(r.boost_weight ?? 0)
  const wOf = r => L.LEVEL_WEIGHTS[r.level - 1] + boostOf(r)
  // PLAN AGAINST THE STATE THIS PASS WILL HAVE MADE (round 22, F5): an active
  // vault retired above leaves the schedule before the distribution runs.
  const retiringWeight = plan.retireBurned.reduce((a, addr) => {
    const r = records.find(x => x.address === addr); return r.active ? a + wOf(r) : a }, 0n)
  // EXPIRE DUE BOOSTS FIRST. The program refuses every distribution while one is
  // due (`BoostsExpireFirst`), and `expire_boosts` needs only the records. A
  // burned vault is retired above, which removes its boost with it.
  const retiring = new Set(plan.retireBurned)
  for (const r of records) {
    if (r.retired || !r.active || boostOf(r) === 0n || retiring.has(r.address)) continue
    if (BigInt(cfg.dist_epoch) >= BigInt(r.boost_end_epoch)) plan.preExpires.push(r.address)
  }
  const expiringWeight = plan.preExpires.reduce((a, addr) => a + boostOf(records.find(x => x.address === addr)), 0n)
  // SPLIT THE MINT-PRICE cbBTC EVERY PASS (round 22, S1): it used to be split only
  // at the end of a SOL swap cycle, so a quiet royalty week left every sale
  // unsplit and undistributed. Permissionless; destinations pinned on chain.
  let splitToPool = 0n
  // Round 23 (L9): a FROZEN revenue account cannot be split (the transfer out of
  // it refuses), so it is reported, not sent hourly into the same refusal, and
  // its balance is not counted toward this pass's distribution.
  // ⚠️ ROUND 24 (L3): AND NEITHER CAN A SPLIT INTO A FROZEN OR ABSENT DESTINATION.
  // `split_revenue` moves BOTH halves in one instruction, so the pool and the
  // CBOBTC Squads' cbBTC account must each be a live, unfrozen account too.
  // Round 23 checked only the source; the Squads ATA was never even read, and a
  // blocked split was still counted toward the distribution, which then failed
  // NothingToDistribute at the month boundary. Each blocker is named.
  if (revenue && revenue.state === 'ok' && revenue.frozen) plan.problems.push('the revenue address\'s cbBTC account is FROZEN; nothing in it can be split until it is thawed')
  else if (revenue && revenue.state === 'ok' && BigInt(revenue.amount) > 0n) {
    const blockers = [['the community pool', pool], ['the CBOBTC Squads', bank]]
      .filter(([, a]) => !a || a.state !== 'ok' || a.frozen)
      .map(([n, a]) => `${n}'s cbBTC account is ${!a ? 'unread' : a.state !== 'ok' ? a.state : 'FROZEN'}`)
    if (blockers.length) plan.problems.push(`the revenue address holds ${revenue.amount} sats and cannot be split: ${blockers.join('; ')}`)
    else {
      plan.split = true
      const total = BigInt(revenue.amount)
      splitToPool = total - total * 1500n / 10000n
    }
  }

  // DISTRIBUTE (the free monthly path): due, someone to pay, something to pay.
  let acc = BigInt(cfg.acc_scaled)
  const w = BigInt(cfg.total_active_weight) + preJoinWeight - retiringWeight - expiringWeight
  const poolOk = pool && pool.state === 'ok'
  if (!poolOk) plan.problems.push(`the pool account is ${pool ? pool.state : 'unread'}; nothing can be distributed or claimed`)
  else if (pool.frozen) plan.problems.push('the pool cbBTC account is FROZEN; nothing can be paid until it is thawed (the free tick and joins still go through)')
  const due = BigInt(nowSec) >= BigInt(cfg.last_distribute_at) + BigInt(cfg.monthly_secs)
  // Activations are sent AFTER the distribution (red-team 3 finding 6: an
  // activate runs the monthly in-line first, so sending them first made the
  // explicit distribute fail as already-done), so only requests already on
  // chain can make this pass's run a tick.
  // ROUND 23 (L3): MINUS THIS EPOCH'S REQUESTERS THIS PASS RETIRES. Round 22's F5
  // planned against the retirements for the credit and not for the tick: with
  // nobody joined and the only requester bare-burned, the retire above takes
  // `pending_this_epoch` to 0 and the program then refuses the tick
  // (`NoActiveVaults`), paging once a month for nothing.
  const retiringThisEpoch = BigInt(records.filter(r => retiring.has(r.address) && r.pending && !r.retired
    && BigInt(r.request_epoch) === BigInt(cfg.dist_epoch)).length)
  const waitingThisEpoch = BigInt(cfg.pending_this_epoch ?? 0) - retiringThisEpoch > 0n
  // An eligible vault we could not read stays waiting, and the program refuses
  // any distribution while one does (round 23, L2): plan none.
  const joinable = unreadableEligible === 0
  // No CREDIT from a FROZEN pool (round 22, F7): it could deliver nothing, and
  // the program's own in-line run declines to for the same reason. The free TICK
  // still runs from a frozen pool (round 37 C02, below).
  // ROUND 24 (I1): A RETIREMENT FREES WHAT THE VAULT WAS OWED. `retire` takes the
  // retiring vault's unpaid share off `owed_scaled`, so it becomes undistributed
  // again before our distribution runs; planning against the old `owed_scaled`
  // under-counted it, and a claim batch's in-line monthly run then distributed it
  // unplanned (and a boost ending at that epoch stayed due for up to an hour).
  let retiringOwed = 0n
  for (const addr of plan.retireBurned) {
    const r = records.find(x => x.address === addr)
    if (!r?.active) continue
    try { retiringOwed += pendingScaled({ level: r.level, debt: r.debt_scaled, boost: r.boost_weight ?? 0, carry: r.carry_scaled ?? 0n }, cfg.acc_scaled) }
    catch (e) { plan.problems.push(`vault ${r.asset}: ${e.message}`) }
  }
  const owedAfterRetire = BigInt(cfg.owed_scaled) > retiringOwed ? BigInt(cfg.owed_scaled) - retiringOwed : 0n
  if (joinable && poolOk && !pool.frozen && due && w > 0n) {
    const avail = available(BigInt(pool.amount) + splitToPool, owedAfterRetire)
    if (avail > 0n) {
      plan.distribute = true; plan.distributeKind = 'credit'
      acc += avail * L.ACC_SCALE / w        // so this pass also delivers it
    }
  } else if (joinable && poolOk && due && w === 0n && waitingThisEpoch) {
    // Nobody joined, some asked this epoch (or are about to, earlier in this same
    // pass): the free run only advances the epoch, so they can join below.
    // ROUND 37 (off-chain C02): EVEN FROM A FROZEN POOL. The tick moves nothing,
    // MINT ticks before its frozen check, and a waiting vault's claim JOINS and
    // continues without touching the pool (MINT `claim`, the r.pending branch), so
    // a freeze only delays payouts, never the launch's first joins.
    plan.distribute = true; plan.distributeKind = 'tick'
  }
  // JOIN AFTER: every vault this pass's distribution makes eligible (asked in
  // the current epoch, already on chain). Requests this pass sends land in the
  // NEW epoch and join on a later pass.
  // ...and every boost THIS pass's distribution makes due, right after it, so the
  // next distribution (ours or anyone's) is never held by one.
  if (plan.distribute) {
    for (const r of records) {
      if (r.retired || !r.active || boostOf(r) === 0n || retiring.has(r.address) || plan.preExpires.includes(r.address)) continue
      if (BigInt(r.boost_end_epoch) === BigInt(cfg.dist_epoch) + 1n) plan.postExpires.push(r.address)
    }
  }
  if (plan.distribute) {
    for (const r of records) {
      // Live only (round 23, L2); one we cannot read joins on a later pass.
      if (r.retired || r.active || !r.pending || assets[r.asset] !== 'live') continue
      if (BigInt(r.request_epoch) !== BigInt(cfg.dist_epoch)) continue
      const dest = destOf(r)
      if (dest) plan.joins.push([r.address, dest])
    }
  }

  // DELIVER: active, owed >= 1 whole sat at the post-distribution acc. A missing
  // recorded account would refuse the WHOLE batch on chain, so it is reported
  // instead of sent; a frozen one is skipped and stays owed.
  if (poolOk && !pool.frozen) {
    const ready = []
    const preJoined = new Set(plan.preJoins.map(([a]) => a))
    const preExpired = new Set(plan.preExpires)
    for (const r of records) {
      // A vault joined at the start of this pass enters at the accumulator as it
      // stands and shares this pass's distribution (F5): plan its delivery too.
      const joinedNow = preJoined.has(r.address)
      if ((!r.active && !joinedNow) || r.retired) continue
      // Paying a burned vault destroys the sats; retiring it returns them. And
      // only a POSITIVELY live one is paid (round 23, L2): an unreadable asset
      // is reported and stays owed in full for the next pass.
      if (assets[r.asset] === 'burned') continue
      if (assets[r.asset] !== 'live') { plan.problems.push(`vault ${r.asset} is active but its asset reads as ${assets[r.asset] ?? 'unread'}; left out of every claim batch`); continue }
      let owed
      try {
        if (joinedNow) owed = pendingSats({ level: r.level, debt: L.LEVEL_WEIGHTS[r.level - 1] * BigInt(cfg.acc_scaled) }, acc)
        else if (preExpired.has(r.address)) {
          // Expired at the accumulator as it stands, then earns this pass's
          // distribution at its level weight alone.
          const atExpiry = pendingScaled({ level: r.level, debt: r.debt_scaled, boost: r.boost_weight, carry: r.carry_scaled }, cfg.acc_scaled)
          owed = (atExpiry + L.LEVEL_WEIGHTS[r.level - 1] * (acc - BigInt(cfg.acc_scaled))) / ACC_SCALE
        } else owed = pendingSats({ level: r.level, debt: r.debt_scaled, boost: r.boost_weight ?? 0, carry: r.carry_scaled ?? 0n }, acc)
      } catch (e) { plan.problems.push(`vault ${r.asset}: ${e.message}`); continue }
      if (owed < 1n) continue
      const t = tokens[r.asset]
      if (!t || t.state !== 'ok' || t.address !== r.vault_ata) {
        plan.problems.push(`vault ${r.asset} is owed ${owed} sats but its recorded cbBTC account ${r.vault_ata} is ${t ? t.state : 'unread'}; a claim never creates one, so it was left out of every batch`)
        continue
      }
      if (t.frozen) { plan.deferredFrozen.push({ asset: r.asset, owed }); continue }
      plan.owed[r.address] = owed
      ready.push([r.address, r.vault_ata])
    }
    // A pre-joined vault already has its own batch (it must be joined BEFORE the
    // distribution); its delivery goes in the claims after it.
    ready.push(...plan.joins)
    for (let i = 0; i < ready.length; i += batch) plan.claims.push(ready.slice(i, i + batch))
  } else if (poolOk && pool.frozen && plan.joins.length) {
    // ROUND 38 (C01): the joins round 37 planned from a frozen pool were never
    // SENT, because only the block above batches claims. A join-only claim moves
    // no tokens (MINT `claim`, the r.pending branch), so the frozen pool cannot
    // refuse it: send the joins in their own batches.
    for (let i = 0; i < plan.joins.length; i += batch) plan.claims.push(plan.joins.slice(i, i + batch))
  }
  return plan
}

/** One line per action, for the log and for a human reading a dry run. */
export function describePlan(p) {
  return [
    `reschedule ${p.reschedule.length}, capture ${p.capture.length}, reveal ${p.reveal.length} (in mint order), `
      + `rescue ${p.rescue?.length ?? 0}, retire bare burns ${p.retireBurned.length}, split ${p.split ? 'YES' : 'no'}, activate ${p.activate.length}, `
      + `distribute ${p.distribute ? `YES (monthly, free${p.distributeKind === 'tick' ? ', epoch tick only' : ''})` : 'no'}, `
      + `expire boosts before ${p.preExpires.length}, after ${p.postExpires.length}, `
      + `join before ${p.preJoins.length}, join after ${p.joins.length}, claim batches ${p.claims.length} `
      + `(${p.claims.reduce((a, b) => a + b.length, 0)} vaults), frozen deferred ${p.deferredFrozen.length}`,
    ...p.problems.map(x => `  PROBLEM: ${x}`),
  ].join('\n')
}

// ═══════════════════════════════════ I/O ═══════════════════════════════════
async function main() {
  const { PublicKey, Connection, Keypair, Transaction, TransactionInstruction, SystemProgram,
    sendAndConfirmTransaction } = await import('@solana/web3.js')
  const { readTokenAccount } = await import('./spl.mjs')
  const { execFileSync } = await import('child_process')
  const LIVE = process.argv.includes('--live')
  const REVEAL_ONLY = process.argv.includes('--reveal-only')
  const NOTIFY = '/opt/scripts/notify-gary-sms.sh'
  const env = fs.readFileSync('/opt/gary-club/.env.local', 'utf8')
  const rpc = (env.match(/^HELIUS_RPC_URL=(.*)$/m) || [])[1]?.trim()
  if (!rpc) throw new Error('HELIUS_RPC_URL not found')
  const conn = new Connection(rpc, 'confirmed')
  const P = k => new PublicKey(k)
  const MINT = P(L.PROGRAM_IDS.mint)
  const pda = (seeds, prog) => PublicKey.findProgramAddressSync(seeds, prog)[0]
  const MINT_CFG = pda([Buffer.from(L.SEEDS.mintConfig)], MINT)
  const MINT_AUTH = pda([Buffer.from(L.SEEDS.mintAuthority)], MINT)
  const vrec = a => pda([Buffer.from(L.SEEDS.vault), P(a).toBuffer()], MINT)
  const signerPda = a => pda([Buffer.from('mpl-core-execute'), P(a).toBuffer()], P(CORE_ID))
  const ataOf = (mint, owner) => pda([owner.toBuffer(), P(TOKEN_PROGRAM_ID).toBuffer(), mint.toBuffer()],
    P('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))

  const cfgAcc = await conn.getAccountInfo(MINT_CFG, 'confirmed')
  const cfg = L.readPinned('MintConfig', cfgAcc, PublicKey)
  if (!cfg) { console.log('MINT config not initialised — nothing to crank'); return }

  // Every VaultRecord: filtered by discriminator, each one pinned by layout.
  const disc = createHash('sha256').update('account:VaultRecord').digest().subarray(0, 8)
  const bs58 = (await import('bs58')).default
  // The fast lane fetches only records whose level is still 0 (offset from the
  // layout, never typed): at 2,100 vaults that is the difference between ~460 KB
  // a minute and a few records.
  const raw = await conn.getProgramAccounts(MINT, { commitment: 'confirmed',
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(disc) } },
      ...(REVEAL_ONLY ? [{ memcmp: { offset: L.offsets('VaultRecord').level, bytes: bs58.encode(Buffer.from([0])) } }] : [])] })
  const records = raw.map(({ pubkey, account }) => ({ address: pubkey.toBase58(), ...L.decode('VaultRecord', account.data) }))

  const getMany = async keys => {
    const out = []
    for (let i = 0; i < keys.length; i += 100) out.push(...await conn.getMultipleAccountsInfo(keys.slice(i, i + 100), 'confirmed'))
    return out
  }
  const assetInfos = await getMany(records.map(r => P(r.asset)))
  const assets = {}
  records.forEach((r, i) => {
    const a = assetInfos[i]
    assets[r.asset] = !a ? 'other'
      : a.owner.toBase58() === CORE_ID && a.data.length === 1 && a.data[0] === 0 ? 'burned'
      : a.owner.toBase58() === CORE_ID && a.data[0] === 1 ? 'live' : 'other'
  })
  const payMint = P(cfg.payment_mint)
  const tokenAddr = r => r.active ? r.vault_ata : ataOf(payMint, signerPda(r.asset)).toBase58()
  const tokInfos = await getMany(records.map(r => P(tokenAddr(r))))
  const tokens = {}
  records.forEach((r, i) => {
    const info = tokInfos[i], t = readTokenAccount(info)
    tokens[r.asset] = { ...t, address: tokenAddr(r),
      frozen: t.state === 'ok' && info.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN }
  })
  const poolInfo = await conn.getAccountInfo(P(cfg.pool_ata), 'confirmed')
  const pt = readTokenAccount(poolInfo)
  const pool = { ...pt, frozen: pt.state === 'ok' && poolInfo.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN }
  const REVENUE = pda([Buffer.from(L.SEEDS.revenue)], MINT)
  const revAta = ataOf(payMint, REVENUE), bankAta = ataOf(payMint, P(cfg.bank_treasury))
  // The state byte too (round 23, L9): a frozen revenue account is reported, not split.
  const revInfo = await conn.getAccountInfo(revAta, 'confirmed'), rt = readTokenAccount(revInfo)
  const revenue = { ...rt, frozen: rt.state === 'ok' && revInfo.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN }
  // Round 24 (L3): the split's OTHER destination, read like the two it already read.
  const bankInfo = await conn.getAccountInfo(bankAta, 'confirmed'), bt = readTokenAccount(bankInfo)
  const bank = { ...bt, frozen: bt.state === 'ok' && bankInfo.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN }
  const payDecimals = splitDecimalsByte((await conn.getAccountInfo(payMint, 'confirmed'))?.data?.[44])
  const slot = await conn.getSlot('confirmed')
  const nowSec = Math.floor(Date.now() / 1000)
  // Round 24 (I2): PLAN against the chain's clock, which is what MINT checks.
  const { SYSVAR_CLOCK_PUBKEY } = await import('@solana/web3.js')
  let chainSec = null
  try { chainSec = clockUnixTimestamp((await conn.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'confirmed'))?.data) } catch { chainSec = null }
  if (chainSec === null) throw new Error('Clock sysvar unreadable; no plan or transaction sent')

  let plan = planCrank({ cfg, records, assets, tokens, pool, slot, nowSec: chainSec, revenue, bank }, { revealOnly: REVEAL_ONLY })
  // Round 43 (V43-1): nested vaults, from the asset reads above (owner = bytes
  // 1..33 of a live AssetV1). Full pass only.
  plan.rescue = REVEAL_ONLY ? [] : planRescues(records.map((r, i) => ({ id: r.asset,
    owner: assets[r.asset] === 'live' ? new PublicKey(assetInfos[i].data.subarray(1, 33)).toBase58() : null })),
    id => signerPda(id).toBase58(), assets)
  console.log(`crank ${new Date().toISOString()}  slot ${slot}  records ${records.length}`)
  console.log(describePlan(plan))
  if (!LIVE) { console.log('\nDRY RUN. Re-run with --live to send.'); return }

  // ── the fee payer: dedicated, low balance, refused only below what the plan without its reveals
  //    costs, warned (once a day) above a ceiling ──
  const KEY = process.env.CBOB_CRANK_KEY || '/opt/cbob-vaults/bank/keys/crank.json'
  const mode = fs.statSync(KEY).mode & 0o777
  if (mode & 0o077) throw new Error(`${KEY} is mode ${mode.toString(8)}; it must be 600`)
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEY, 'utf8'))))
  // Round 24 (L6b): budgeted, not all-or-nothing. A key short of the reveals'
  // rent still sends everything else, and the reveals it dropped page below.
  const fee = budgetPlan(plan, BigInt(await conn.getBalance(payer.publicKey, 'confirmed')))
  if (!fee.ok) throw new Error(fee.why)
  plan = fee.plan
  if (fee.warn) {
    console.error(fee.warn)
    // ONCE A DAY (round 23, L14): this ran on every pass of both lanes.
    // Round 30 (L2 review): a floor warning has its own stream and its own
    // once-a-day marker, so a ceiling warning cannot mute it for a day.
    const WARNED = (process.env.CBOB_CRANK_FEE_WARNED || '/opt/cbob-vaults/bank/.crank-fee-warned') + (fee.warnKind === 'floor' ? '-floor' : '')
    let last = null
    try { last = Number(fs.readFileSync(WARNED, 'utf8').trim()) } catch { last = null }
    if (warnDue(last, nowSec)) {
      const fn = rehearsalNotice({ text: `CBOB crank: ${fee.warn}`, label: `${CRANK_LABEL}:fee_${fee.warnKind === 'floor' ? 'floor' : 'ceiling'}` }, fs.existsSync(REHEARSAL_MARKER))
      try { execFileSync(NOTIFY, [fn.text, fn.label], { stdio: 'ignore' }) } catch {}
      try { fs.writeFileSync(WARNED, String(nowSec)) } catch {}
    }
  }

  const d = n => ixDisc(n)
  const W = (pubkey, w = true) => ({ pubkey: P(pubkey), isSigner: false, isWritable: w })
  const R = pubkey => W(pubkey, false)
  const byAddr = new Map(records.map(r => [r.address, r]))
  const failures = []
  if (fee.dropped) failures.push(`the crank key could not pay for ${fee.dropped} reveal(s) this pass (about ${SIG_FEE_LAMPORTS + REVEAL_RENT_LAMPORTS} lamports each); they were NOT sent and their draws may lapse. Top the key up.`)
  let lastFailure = ''
  // RACES ARE NOT FAILURES: see `BENIGN` above (exported, so the selftest proves
  // which refusals it does and does not swallow).
  const send = async (label, ixs) => {
    try {
      const sig = await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer], { commitment: 'confirmed' })
      console.log(`  ok   ${label}  ${sig}`); return 'ok'
    } catch (e) {
      const code = await mintFailureCode(e, conn)
      const m = String(e.message) + ' ' + (e.logs || []).join(' ')
      if (code && BENIGN.test(code)) { console.log(`  skip ${label}: ${code} (done by other traffic, or not yet)`); return 'benign' }
      lastFailure = code || ''
      console.log(`  FAIL ${label}: ${m.slice(0, 200)}`); return 'fail'
    }
  }
  const run = async (label, ixs) => { if ((await send(label, ixs)) === 'fail') failures.push(label) }

  for (const a of plan.reschedule) await run(`reschedule ${a}`, [new TransactionInstruction({ programId: MINT,
    data: d('reschedule_reveal'), keys: [W(a)] })])
  for (const a of plan.capture) await run(`capture ${a}`, [new TransactionInstruction({ programId: MINT,
    data: d('capture_entropy'), keys: [W(a), R(SLOT_HASHES_ID)] })])
  for (const a of plan.reveal) {
    const r = byAddr.get(a)
    let list = []
    // Round 24 (L2): [] ONLY for a positively burned asset. 'other' is a null RPC
    // answer, and [] against a live asset is refused AttributesMismatch.
    const how = revealAttrSource(assets[r.asset])
    if (how === 'skip') { console.log(`  skip reveal #${r.mint_index} ${r.asset}: its asset reads as ${assets[r.asset] ?? 'unread'}, neither live nor burned; next pass`); break }
    if (how === 'read') {
      // One RPC blip used to abort the WHOLE pass from here, outside any try
      // (round 23, L1): it ends this reveal run instead, and the next pass, a
      // minute away, reads again. A run that never moves pages as
      // reveal_queue_stalled.
      try { list = await mintedAttributes(conn, P(r.asset)) }
      catch (e) { console.log(`  skip reveal #${r.mint_index} ${r.asset}: could not read its attributes (${e.message}); next pass`); break }
      // THE HASH IS CHECKED HERE, BEFORE A FEE IS SPENT. The program checks it
      // too; a mismatch means this reader and the program disagree about the
      // asset, which is a fault to report, never a reveal to retry blindly. A
      // list that already carries `level` was revealed by the other lane or by
      // traffic since we planned (round 23, M2): done elsewhere, not a fault.
      const j = judgeRevealAttrs(list, r.attrs_hash)
      if (j === 'revealed') { console.log(`  skip reveal #${r.mint_index} ${r.asset}: already revealed (done by the other lane or by traffic)`); break }
      if (j === 'mismatch') { failures.push(`reveal ${r.asset}: attributes read off the asset do not hash to the stored attrs_hash`); break }
    }
    const ok = await send(`reveal #${r.mint_index} ${r.asset}`, [new TransactionInstruction({ programId: MINT,
      data: Buffer.concat([d('reveal_level'), attrsBorsh(list)]),
      keys: [W(MINT_CFG.toBase58()), W(a), W(r.asset), W(cfg.collection),
        { pubkey: payer.publicKey, isSigner: true, isWritable: true }, R(MINT_AUTH.toBase58()),
        R(SLOT_HASHES_ID), R(CORE_ID), R(SystemProgram.programId.toBase58())] })])
    if (ok === 'fail') { failures.push(`reveal ${r.asset}`); break }     // strictly in order: stop at the first failure
    if (ok === 'benign') break                                        // not yet, or done elsewhere: next pass
  }
  // Round 43 (V43-1): every nested vault to the CBOBTC Squads. MINT refuses any
  // other destination (WrongRescueDestination), so the crank cannot send it anywhere else.
  const RESCUE = pda([Buffer.from(L.SEEDS.rescue)], MINT)
  for (const { vault, host } of plan.rescue ?? []) await run(`rescue ${vault} (host ${host}) to the CBOBTC Squads`, [new TransactionInstruction({
    programId: MINT, data: d('rescue_nested'),
    keys: [R(MINT_CFG.toBase58()), W(vault), R(cfg.collection), R(host), R(cfg.bank_treasury),
      { pubkey: payer.publicKey, isSigner: true, isWritable: true }, R(RESCUE.toBase58()), R(CORE_ID),
      R(SystemProgram.programId.toBase58())] })])
  for (const a of plan.retireBurned) { const r = byAddr.get(a)
    await run(`retire ${r.asset}`, [new TransactionInstruction({ programId: MINT, data: d('retire_burned'),
      keys: [W(MINT_CFG.toBase58()), W(a), R(r.asset)] })]) }
  // Eligible vaults are joined FIRST: the program refuses a distribution while one waits.
  for (let i = 0; i < plan.preJoins.length; i += L.CLAIM_BATCH) { const pairs = plan.preJoins.slice(i, i + L.CLAIM_BATCH)
    await run(`join batch ${i / L.CLAIM_BATCH + 1} (${pairs.length})`, [new TransactionInstruction({
      programId: MINT, data: Buffer.concat([d('claim'), Buffer.from([0])]),
      keys: [W(MINT_CFG.toBase58()), W(cfg.pool_ata), R(TOKEN_PROGRAM_ID), ...pairs.flatMap(([rec, ata]) => [W(rec), W(ata)])] })]) }
  // Due boosts are expired BEFORE the distribution: the program refuses one while any is due.
  const expire = async (when, list) => { for (let i = 0; i < list.length; i += L.EXPIRE_BATCH) { const recs = list.slice(i, i + L.EXPIRE_BATCH)
    await run(`expire boosts ${when} ${i / L.EXPIRE_BATCH + 1} (${recs.length})`, [new TransactionInstruction({ programId: MINT,
      data: d('expire_boosts'), keys: [W(MINT_CFG.toBase58()), ...recs.map(a => W(a))] })]) } }
  await expire('before', plan.preExpires)
  if (plan.split && payDecimals === null) failures.push('split_revenue NOT sent: the payment mint\'s decimals could not be read as a byte (a null read would have sent decimals 0)')
  else if (plan.split) await run('split_revenue (85/15, pinned destinations)', [new TransactionInstruction({ programId: MINT,
    data: Buffer.concat([d('split_revenue'), Buffer.from([payDecimals])]),
    keys: [R(MINT_CFG.toBase58()), W(REVENUE.toBase58()), R(payMint.toBase58()), W(revAta.toBase58()), W(cfg.pool_ata),
      W(bankAta.toBase58()), R(TOKEN_PROGRAM_ID)] })])
  if (plan.distribute) {
    const ok = await send('distribute (monthly, free)', [new TransactionInstruction({ programId: MINT,
      data: Buffer.concat([d('distribute'), Buffer.from([0])]), keys: [W(MINT_CFG.toBase58()), R(cfg.pool_ata)] })])
    if (ok === 'fail') {
      // Round 24 (L1): did SOMEONE ELSE distribute between our plan and our send?
      let fresh = null
      try { fresh = L.readPinned('MintConfig', await conn.getAccountInfo(MINT_CFG, 'confirmed'), PublicKey) } catch { fresh = null }
      if (judgeDistributeRefusal(lastFailure, cfg, fresh) === 'benign') console.log('  skip distribute: another distribution landed since the plan (in-line or a burn); not a fault')
      else failures.push('distribute (monthly, free)')
    }
  }
  if (plan.distribute) await expire('after', plan.postExpires)
  for (const a of plan.activate) { const r = byAddr.get(a)
    await run(`activate ${r.asset}`, [new TransactionInstruction({ programId: MINT, data: d('activate'),
      keys: [W(MINT_CFG.toBase58()), W(a), R(r.asset), R(tokens[r.asset].address), R(cfg.pool_ata)] })]) }
  for (const [i, pairs] of plan.claims.entries()) await run(`claim batch ${i + 1} (${pairs.length})`, [new TransactionInstruction({
    programId: MINT, data: Buffer.concat([d('claim'), Buffer.from([0])]),
    keys: [W(MINT_CFG.toBase58()), W(cfg.pool_ata), R(TOKEN_PROGRAM_ID), ...pairs.flatMap(([rec, ata]) => [W(rec), W(ata)])] })])

  // THE HEARTBEAT (round 23, M3): a LIVE full pass that got this far ran, whatever
  // its individual failures (they page below). The alarm pages `crank_silent`
  // when an armed crank has not stamped this in 3 hours, which is the stall no
  // other detector sees: owed shares growing with nobody delivering them.
  if (!REVEAL_ONLY) {
    const BEAT = process.env.CBOB_CRANK_HEARTBEAT || '/opt/cbob-vaults/bank/.crank-heartbeat'
    // Round 24 (L4b/c): the problems too, so a vault left out of every batch pages
    // from the alarm when it repeats, not only into this log.
    try { fs.writeFileSync(BEAT, JSON.stringify({ atSec: Math.floor(Date.now() / 1000), failures: failures.length,
      problems: plan.problems }) + '\n') }
    catch (e) { failures.push(`heartbeat ${BEAT}: ${e.message}`) }
  }

  // ROUND 24 (H1): ONE STREAM PER LANE, the full list, and a RECOVERY. This sent
  // the first three failures on the one `cbob-vault-crank` label every pass, and
  // the router suppressed all but the first for 12 hours while nothing closed it.
  const lane = REVEAL_ONLY ? 'reveal' : 'full'
  const MARK = laneMarker(lane)
  const cn = crankNotices({ lane, failures, prevFailing: fs.existsSync(MARK) })
  if (failures.length) { console.error(cn.notices[0].text); process.exitCode = 1 }
  let told = true
  const REHEARSAL = fs.existsSync(REHEARSAL_MARKER)   // round 44 (V44o-5): never a production stream
  for (const n0 of cn.notices) { const n = rehearsalNotice(n0, REHEARSAL); try { execFileSync(NOTIFY, [n.text, n.label], { stdio: 'ignore' }) } catch { told = false } }
  if (told) { try { if (cn.failing) fs.writeFileSync(MARK, new Date().toISOString()); else if (fs.existsSync(MARK)) fs.unlinkSync(MARK) } catch {} }
}

/** Round 24 (H1): a lane's "last live pass failed" marker, which is what lets the
 *  next clean pass send that lane's RECOVERY. */
function laneMarker(lane) {
  return lane === 'reveal'
    ? (process.env.CBOB_CRANK_REVEAL_FAILING || '/opt/cbob-vaults/bank/.crank-reveal-failing')
    : (process.env.CBOB_CRANK_FAILING || '/opt/cbob-vaults/bank/.crank-failing')
}

/** The vault's minted attribute list, read off its Core Attributes plugin. Before
 *  the reveal that list IS what the program hashed at mint (the reveal is what
 *  adds `level`), and the caller checks the hash before sending anything. */
export async function mintedAttributes(conn, assetPk) {
  const { deserializeAssetV1 } = await import('@metaplex-foundation/mpl-core')
  const info = await conn.getAccountInfo(assetPk, 'confirmed')
  if (!info) throw new Error(`asset ${assetPk.toBase58()} not found`)
  const a = deserializeAssetV1({ publicKey: assetPk.toBase58(), data: new Uint8Array(info.data),
    executable: false, owner: info.owner.toBase58(), lamports: { basisPoints: BigInt(info.lamports), identifier: 'SOL', decimals: 9 } })
  return (a.attributes?.attributeList || []).map(({ key, value }) => ({ key, value }))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { withLock } = await import('./lock.mjs')
  // Two lanes, two locks: a slow full pass must not starve the every-minute reveal.
  const LOCK = process.env.CBOB_CRANK_LOCK || `/opt/cbob-vaults/bank/.crank${process.argv.includes('--reveal-only') ? '-reveal' : ''}.lock`
  const { execFileSync } = await import('child_process')
  // A crank that cannot run must never look like a quiet one. Dry runs print
  // only; a LIVE run that fails to start pages, because then nobody is cranking.
  // The every-minute reveal lane is short: a crashed holder's lock goes stale in
  // 10 minutes, not 2 hours (round 22, F3: a fresh lock with a dead pid blocked the
  // lane for 2 h and paged every minute). Since round 23 (L15) lock.mjs breaks a
  // DEAD or recycled holder at any age, so `staleMs` now only bounds a record
  // with no pid. A LIVE holder is still never stolen from.
  withLock(LOCK, main, { staleMs: process.argv.includes('--reveal-only') ? 10 * 60_000 : 2 * 3600_000 }).catch(e => {
    console.error(`CBOB CRANK FAILED TO RUN: ${e.message}`)
    if (process.argv.includes('--live')) {
      // The lane's own stream, and its marker, so the next clean pass recovers it
      // (round 24, H1).
      const lane = process.argv.includes('--reveal-only') ? 'reveal' : 'full'
      try { fs.writeFileSync(laneMarker(lane), new Date().toISOString()) } catch {}
      const fn = rehearsalNotice({ text: `CBOB CRANK FAILED TO RUN: ${e.message}`, label: `${CRANK_LABEL}:${lane}` }, fs.existsSync(REHEARSAL_MARKER))
      try { execFileSync('/opt/scripts/notify-gary-sms.sh', [fn.text, fn.label]) } catch {}
    }
    process.exit(3)
  })
}
